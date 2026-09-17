use super::proof;
use crate::g3_light_support::*;
use borsh::{BorshDeserialize, BorshSerialize};
use light_program_test::Rpc;
use light_token_minter::{constants::*, state::*};
use solana_sdk::{clock::Clock, instruction::AccountMeta, pubkey::Pubkey};
use solana_system_interface::program as system_program;

#[tokio::test]
async fn actual_sbf_sixteen_source_membership_and_rank_continuation() {
    run_membership_population(16).await;
}

#[tokio::test]
async fn actual_sbf_membership_page_boundaries_six_seven_eight_nine_seventeen() {
    for count in [6, 7, 8, 9, 17] {
        run_membership_population(count).await;
    }
}

async fn run_membership_population(count: u16) {
    use light_token_minter::instruction::{IndexOracleRecipeSourceV1Params, VaultInstruction};
    use light_token_minter::processor::{
        advance_oracle_weight_manifest_hash, canonical_recipe_digest,
        initial_oracle_weight_manifest_hash,
    };
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100_000;
    rpc.context.set_sysvar(&clock);
    let expiry = 2_000_000u64;
    let market_id = [71; 32];
    let bucket_id = [72; 32];
    let (market, mb) = pda(&[MARKET_PDA_SEED, &market_id]);
    let (month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market.as_ref(),
        &expiry.to_le_bytes(),
    ]);
    let mut sources = Vec::new();
    let mut hashes = vec![initial_oracle_weight_manifest_hash(&month, count, 1)];
    let mut leaves = Vec::new();
    for i in 1..=u8::try_from(count).unwrap() {
        let source_id = [i; 32];
        let (source, bump) = pda(&[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id]);
        let state = OracleSourceState {
            is_initialized: true,
            bump,
            month,
            source_id,
            bucket_id,
            source_type_hash: [3; 32],
            canonical_locator_hash: [4; 32],
            source_definition_hash: [5; 32],
            proposer: payer.pubkey(),
            baseline_state: 100,
            current_state: 100 + u64::from(i),
            bucket_weight_bps: 10_000,
            status: OracleSourceStatus::Active,
            opening_submitted: true,
            opening_evidence_hash: [6; 32],
            observation_count: 2,
            latest_source_time: 100,
            rolling_observation_hash: [i; 32],
            ..Default::default()
        };
        hashes.push(advance_oracle_weight_manifest_hash(
            hashes.last().unwrap(),
            &bucket_id,
            &state,
            10_000,
        ));
        let bytes = state.try_to_vec().unwrap();
        let mut compact = bytes[34..98].to_vec();
        compact.extend(&bytes[194..]);
        leaves.push(proof::leaf(
            CompressedStateDomain::OracleSourceState,
            source,
            compact,
        ));
        leaves.push(proof::leaf(
            CompressedStateDomain::OracleSourceDescriptor,
            source,
            bytes[98..194].to_vec(),
        ));
        sources.push((source, state));
    }
    let final_hash = *hashes.last().unwrap();
    let recipe_hash = canonical_recipe_digest(&month, &final_hash);
    let (manifest, rb) = derive_oracle_recipe_weight_manifest_pda(&program(), &month);
    install(
        &mut rpc,
        market,
        &Market {
            is_initialized: true,
            bump: mb,
            market_id,
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                expiry_ts: expiry,
                ..Default::default()
            },
            ..Default::default()
        },
        Market::LEN,
    );
    install(
        &mut rpc,
        month,
        &OracleMonthState {
            is_initialized: true,
            bump: ob,
            market,
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            phase: OraclePhase::Opening,
            recipe_hash,
            frozen_source_count: count,
            opening_resolved_source_count: count,
            opened_source_count: count,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: final_hash,
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    install(
        &mut rpc,
        manifest,
        &OracleRecipeWeightManifest {
            is_initialized: true,
            bump: rb,
            account_discriminator: OracleRecipeWeightManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleRecipeWeightManifest::ACCOUNT_VERSION,
            month,
            phase: OracleRecipeWeightPhase::Finalized,
            expected_source_count: count,
            expected_bucket_count: 1,
            recipe_hash,
            rolling_manifest_hash: final_hash,
            processed_source_count: count,
            processed_bucket_count: 1,
            declared_weight_total_bps: 10_000,
            ..Default::default()
        },
        OracleRecipeWeightManifest::LEN,
    );
    let index = derive_oracle_recipe_source_index_pda(&program(), &month).0;
    let root = derive_oracle_bucket_source_index_pda(&program(), &month, &bucket_id).0;
    let ro = |k| AccountMeta::new_readonly(k, false);
    for (reverse, (i, (_, state))) in sources.iter().enumerate().rev().enumerate() {
        let page = pda(&[
            b"g3-oracle-members-page",
            root.as_ref(),
            &(reverse as u16 / 6).to_le_bytes(),
        ])
        .0;
        let params = IndexOracleRecipeSourceV1Params {
            previous_hash: hashes[i],
            bucket_id,
            source_id: state.source_id,
            source_type_hash: state.source_type_hash,
            canonical_locator_hash: state.canonical_locator_hash,
            source_definition_hash: state.source_definition_hash,
            bucket_weight_bps: 10_000,
        };
        let mut bytes = vec![200];
        bytes.extend(params.try_to_vec().unwrap());
        let ix = govern(
            vec![
                AccountMeta::new(payer.pubkey(), true),
                ro(market),
                ro(month),
                ro(manifest),
                AccountMeta::new(index, false),
                AccountMeta::new(root, false),
                ro(system_program::id()),
                AccountMeta::new(page, false),
            ],
            VaultInstruction::try_from_slice(&bytes).unwrap(),
        );
        proof::send(&mut rpc, &payer, ix.clone(), "source_member_append_16").unwrap();
        let before = proof::snapshot(&rpc, &[index, root, page]);
        assert!(proof::send(&mut rpc, &payer, ix, "source_member_replay").is_err());
        assert_eq!(proof::snapshot(&rpc, &[index, root, page]), before);
    }
    assert_eq!(rpc.context.get_account(&root).unwrap().data.len(), 110);
    for page in 0..count.div_ceil(6) {
        assert_eq!(
            rpc.context
                .get_account(
                    &pda(&[
                        b"g3-oracle-members-page",
                        root.as_ref(),
                        &page.to_le_bytes()
                    ])
                    .0
                )
                .unwrap()
                .data
                .len(),
            233
        );
    }
    proof::seed(&mut rpc, &payer, &leaves).await;
    let nonce = [11; 32];
    let candidate = pda(&[
        b"g3-bucket-rank-v1",
        root.as_ref(),
        payer.pubkey().as_ref(),
        &nonce,
    ])
    .0;
    // Independent sorted population is [100, 200, ..., count * 100].
    let lower = (1u64 << 63) + u64::from(count.div_ceil(2)) * 100;
    let upper = (1u64 << 63) + u64::from(count / 2 + 1) * 100;
    let mut data = vec![30, 11, 2];
    data.extend(lower.to_le_bytes());
    data.extend(upper.to_le_bytes());
    data.extend(nonce);
    let ix = govern(
        vec![
            AccountMeta::new(payer.pubkey(), true),
            ro(market),
            ro(month),
            ro(index),
            ro(root),
            AccountMeta::new(candidate, false),
            ro(system_program::id()),
        ],
        VaultInstruction::try_from_slice(&data).unwrap(),
    );
    proof::send(&mut rpc, &payer, ix, "bucket_rank_begin_16").unwrap();
    for (i, (source, _)) in sources.iter().enumerate() {
        let page = pda(&[
            b"g3-oracle-members-page",
            root.as_ref(),
            &((count - 1 - u16::try_from(i).unwrap()) / 6).to_le_bytes(),
        ])
        .0;
        let ix = proof::readonly_instruction(
            &rpc,
            vec![
                AccountMeta::new(payer.pubkey(), true),
                ro(market),
                ro(month),
                ro(index),
                ro(root),
                ro(*source),
                ro(page),
                ro(Pubkey::new_unique()),
                AccountMeta::new(candidate, false),
            ],
            &[(5, leaves[i * 2].clone()), (5, leaves[i * 2 + 1].clone())],
            vec![30, 12],
        )
        .await;
        if i + 1 < usize::from(count) {
            assert_eq!(
                rpc.context.get_account(&candidate).unwrap().data[241],
                0,
                "an incomplete population cannot be finalized"
            );
        }
        proof::send(&mut rpc, &payer, ix, "bucket_rank_scan").unwrap();
    }
    let result = rpc.context.get_account(&candidate).unwrap();
    println!(
        "bucket_rank_proposal: bytes={} lamports={}",
        result.data.len(),
        result.lamports
    );
    println!(
        "membership_root: bytes=110 lamports={}",
        rpc.context.get_account(&root).unwrap().lamports
    );
    println!(
        "membership_page: bytes=233 lamports={}",
        rpc.context
            .get_account(
                &pda(&[
                    b"g3-oracle-members-page",
                    root.as_ref(),
                    &0u16.to_le_bytes()
                ])
                .0
            )
            .unwrap()
            .lamports
    );
    assert_eq!(result.data.len(), 242);
    assert_eq!(result.data[241], 1);
    assert_eq!(
        u32::from_le_bytes(result.data[220..224].try_into().unwrap()),
        u32::from(count)
    );
    println!(
        "closure source_population={count} pages={} exact_middle=[{lower},{upper}]",
        count.div_ceil(6)
    );
}

#[tokio::test]
async fn actual_sbf_history_33_checkpoint_pages_begin_resume_and_reject_replay() {
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let expiry = 2_000_000u64;
    let market_id = [61; 32];
    let (market, mb) = pda(&[MARKET_PDA_SEED, &market_id]);
    let (month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market.as_ref(),
        &expiry.to_le_bytes(),
    ]);
    install(
        &mut rpc,
        market,
        &Market {
            is_initialized: true,
            bump: mb,
            market_id,
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                expiry_ts: expiry,
                ..Default::default()
            },
            ..Default::default()
        },
        Market::LEN,
    );
    install(
        &mut rpc,
        month,
        &OracleMonthState {
            is_initialized: true,
            bump: ob,
            market,
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            phase: OraclePhase::Game,
            recipe_hash: [1; 32],
            frozen_source_count: 1,
            opening_resolved_source_count: 1,
            opened_source_count: 1,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: [2; 32],
            active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
            active_weight_group_count: 1,
            active_weight_manifest_hash: [3; 32],
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    let source_id = [62; 32];
    let (source, sb) = pda(&[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id]);
    let (obs, obs_bump) = pda(&[ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, source.as_ref()]);
    let (journal, jb) = pda(&[b"g3-oracle-knowledge", source.as_ref()]);
    let mut observations = OracleSourceObservations {
        is_initialized: true,
        bump: obs_bump,
        account_discriminator: *b"OSO",
        account_version: OracleSourceObservations::ACCOUNT_VERSION,
        month,
        source,
        ..Default::default()
    };
    let mut pages = Vec::new();
    let mut previous = Pubkey::default();
    for n in 1..=33u32 {
        let event = Pubkey::new_unique();
        let (key, bump) = pda(&[b"g3-oracle-checkpoint", source.as_ref(), event.as_ref()]);
        let mut data = b"OKC".to_vec();
        data.extend([1, 1, bump]);
        for key in [source, month, event, previous] {
            data.extend(key.to_bytes());
        }
        data.extend(n.to_le_bytes());
        data.extend(expiry.to_le_bytes());
        data.extend((100 + u64::from(n)).to_le_bytes());
        data.extend((expiry - 1000 + u64::from(n) * 10).to_le_bytes());
        data.extend([7; 32]);
        data.extend([8; 32]);
        for key in [payer.pubkey(), source, key] {
            data.extend(key.to_bytes());
        }
        if n <= 32 {
            observations.states[(n - 1) as usize] = 100 + u64::from(n);
            observations.source_times[(n - 1) as usize] = expiry - 1000 + u64::from(n) * 10;
        }
        pages.push(proof::leaf(
            CompressedStateDomain::OracleCarryCheckpoint,
            key,
            data,
        ));
        previous = key;
    }
    let snapshot = [9; 32];
    let state = OracleSourceState {
        is_initialized: true,
        bump: sb,
        month,
        source_id,
        bucket_id: [63; 32],
        source_type_hash: [1; 32],
        canonical_locator_hash: [2; 32],
        source_definition_hash: [3; 32],
        proposer: payer.pubkey(),
        baseline_state: 101,
        current_state: 133,
        status: OracleSourceStatus::Active,
        opening_submitted: true,
        opening_evidence_hash: [7; 32],
        observation_count: 33,
        latest_source_time: expiry - 670,
        rolling_observation_hash: snapshot,
        ..Default::default()
    };
    let full = state.try_to_vec().unwrap();
    let mut compact = full[34..98].to_vec();
    compact.extend(&full[194..]);
    let mut jbts = b"OKJ".to_vec();
    jbts.extend([2, 1, jb]);
    jbts.extend(source.to_bytes());
    jbts.extend(previous.to_bytes());
    jbts.extend(snapshot);
    jbts.extend(33u32.to_le_bytes());
    jbts.extend(33u32.to_le_bytes());
    let mut source_leaves = vec![
        (
            3,
            proof::leaf(CompressedStateDomain::OracleSourceState, source, compact),
        ),
        (
            3,
            proof::leaf(
                CompressedStateDomain::OracleSourceDescriptor,
                source,
                full[98..194].to_vec(),
            ),
        ),
        (
            4,
            proof::leaf(
                CompressedStateDomain::OracleSourceObservations,
                obs,
                observations.try_to_vec().unwrap(),
            ),
        ),
        (
            5,
            proof::leaf(CompressedStateDomain::OracleCarryJournal, journal, jbts),
        ),
    ];
    let prefix = source_leaves.remove(2).1;
    source_leaves[2].0 = 4;
    let mut seed = pages.clone();
    seed.push(prefix);
    seed.extend(source_leaves.iter().map(|(_, l)| l.clone()));
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100_000;
    clock.unix_timestamp = (expiry + ORACLE_SETTLEMENT_GRACE_SECONDS + 1) as i64;
    rpc.context.set_sysvar(&clock);
    proof::seed(&mut rpc, &payer, &seed).await;
    let median = 117u64;
    let (candidate, _) = pda(&[
        b"g3-history-median-v1",
        source.as_ref(),
        payer.pubkey().as_ref(),
        &snapshot,
        &[0],
        &median.to_le_bytes(),
        &median.to_le_bytes(),
    ]);
    let ro = |k| AccountMeta::new_readonly(k, false);
    let mut begin = vec![30, 8, 0];
    begin.extend(median.to_le_bytes());
    begin.extend(median.to_le_bytes());
    let ix = proof::readonly_instruction(
        &rpc,
        vec![
            AccountMeta::new(payer.pubkey(), true),
            ro(market),
            ro(month),
            ro(source),
            ro(journal),
            AccountMeta::new(candidate, false),
            ro(system_program::id()),
        ],
        &source_leaves,
        begin,
    )
    .await;
    proof::send(&mut rpc, &payer, ix, "history_begin_33").unwrap();
    for (i, leaf) in pages.iter().rev().enumerate() {
        let ix = proof::readonly_instruction(
            &rpc,
            vec![
                AccountMeta::new(payer.pubkey(), true),
                ro(source),
                AccountMeta::new(candidate, false),
                ro(leaf.canonical_pda),
            ],
            &[(3, leaf.clone())],
            vec![30, 9],
        )
        .await;
        let before = rpc.context.get_account(&candidate).unwrap();
        if i == 0 {
            let mut bad = ix.clone();
            bad.accounts[3].pubkey = pages[31].canonical_pda;
            assert!(proof::send(&mut rpc, &payer, bad, "history_wrong_page").is_err());
            assert_eq!(rpc.context.get_account(&candidate).unwrap(), before);
        }
        proof::send(&mut rpc, &payer, ix.clone(), "history_scan_33").unwrap();
        let current = rpc.context.get_account(&candidate).unwrap();
        let remaining = u32::from_le_bytes(current.data[138..142].try_into().unwrap());
        assert_eq!(remaining, 32 - i as u32);
        if i == 0 || i == 32 {
            assert!(proof::send(&mut rpc, &payer, ix, "history_duplicate_page").is_err());
            assert_eq!(rpc.context.get_account(&candidate).unwrap(), current);
        }
        assert_eq!(proof::read(&rpc, leaf).await, *leaf);
    }
    let result = rpc.context.get_account(&candidate).unwrap();
    assert_eq!(result.data.len(), 213);
    println!("history_proposal: bytes=213 lamports={}", result.lamports);
    assert_eq!(result.data[212], 1);
    assert_eq!(
        u32::from_le_bytes(result.data[190..194].try_into().unwrap()),
        33
    );
    for leaf in seed {
        assert_eq!(proof::read(&rpc, &leaf).await, leaf);
    }
}
