use super::proof;
use crate::g3_light_support::*;
use borsh::{BorshDeserialize, BorshSerialize};
use light_client::indexer::Indexer;
use light_program_test::{LightProgramTest, Rpc};
use light_token_minter::{
    constants::*,
    instruction::{
        OracleCarryForwardActionV1 as Action, RevealOracleUpdateClaimV3Params, VaultInstruction,
    },
    state::*,
};
use solana_sdk::{clock::Clock, hash::hashv, instruction::AccountMeta, pubkey::Pubkey};
use solana_system_interface::program as system_program;

fn object(payer: &Pubkey, kind: u8, h: &[u8; 32]) -> Pubkey {
    pda(&[b"g3-evidence-bytes-v1", payer.as_ref(), &[kind], h]).0
}

// A real reveal above is the shared branch point. Market/opening history are
// declared fixtures; each boundary runs from exactly the same produced reveal.
#[allow(clippy::too_many_arguments)]
async fn exercise_revealed_timing(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    market: Pubkey,
    month: Pubkey,
    manifest: Pubkey,
    claim: Pubkey,
    source_value: &OracleSourceState,
    source_leaf: &CompressedAmebaStateLeaf,
    expiry: u64,
) {
    use light_token_minter::{error::VaultError, instruction::FinalizeOracleUpdateClaimV2Params};
    use solana_sdk::{instruction::InstructionError, transaction::TransactionError};
    let source = source_leaf.canonical_pda;
    let (config, cb) = pda(&[VAULT_PDA_SEED]);
    install(
        rpc,
        config,
        &VaultConfig {
            is_initialized: true,
            bump: cb,
            admin: Pubkey::new_unique(),
            oracle_authority: payer.pubkey(),
            usdc_mint: Pubkey::new_unique(),
            vault_token_account: Pubkey::new_unique(),
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        },
        VaultConfig::LEN,
    );
    let (bucket, bb) = derive_oracle_bucket_median_pda(&program(), &month, &source_value.bucket_id);
    install(
        rpc,
        bucket,
        &OracleBucketMedianState {
            is_initialized: true,
            bump: bb,
            account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketMedianState::ACCOUNT_VERSION,
            month,
            bucket_id: source_value.bucket_id,
            bucket_weight_bps: 10000,
            frozen_source_count: 1,
            active_source_count: 1,
            status: OracleBucketMedianStatus::Live,
            ..Default::default()
        },
        OracleBucketMedianState::LEN,
    );
    let (obs, ob) = pda(&[ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, source.as_ref()]);
    let mut observations = OracleSourceObservations {
        is_initialized: true,
        bump: ob,
        month,
        source,
        account_discriminator: OracleSourceObservations::ACCOUNT_DISCRIMINATOR,
        account_version: OracleSourceObservations::ACCOUNT_VERSION,
        ..Default::default()
    };
    observations.states[0] = 100;
    observations.source_times[0] = source_value.latest_source_time;
    let (journal, jb) = pda(&[b"g3-oracle-knowledge", source.as_ref()]);
    let mut raw = b"OKJ".to_vec();
    raw.extend([2, 1, jb]);
    raw.extend(source.as_ref());
    raw.extend(Pubkey::new_unique().as_ref());
    raw.extend(source_value.rolling_observation_hash);
    raw.extend(1u32.to_le_bytes());
    raw.extend(1u32.to_le_bytes());
    let obs_leaf = proof::leaf(
        CompressedStateDomain::OracleSourceObservations,
        obs,
        observations.try_to_vec().unwrap(),
    );
    let journal_leaf = proof::leaf(CompressedStateDomain::OracleCarryJournal, journal, raw);
    proof::seed(rpc, payer, &[obs_leaf.clone(), journal_leaf.clone()]).await;
    let checkpoint = pda(&[b"g3-oracle-checkpoint", source.as_ref(), claim.as_ref()]).0;
    let guard = derive_oracle_update_challenge_guard_pda(&program(), &month, &claim).0;
    let keys = [
        payer.pubkey(),
        market,
        config,
        month,
        source,
        obs,
        manifest,
        claim,
        bucket,
        guard,
        journal,
        checkpoint,
        system_program::id(),
    ];
    let core = keys
        .iter()
        .enumerate()
        .map(|(i, k)| {
            if matches!(i, 1 | 2 | 6 | 9 | 12) {
                AccountMeta::new_readonly(*k, false)
            } else {
                AccountMeta::new(*k, i == 0)
            }
        })
        .collect::<Vec<_>>();
    let inputs = [
        (4, true, source_leaf.clone()),
        (5, true, obs_leaf.clone()),
        (10, true, journal_leaf.clone()),
    ];
    let creates = [(11, CompressedStateDomain::OracleCarryCheckpoint, checkpoint)];
    let inner = VaultInstruction::FinalizeOracleUpdateClaimV2 {
        params: FinalizeOracleUpdateClaimV2Params {
            outcome: OracleUpdateClaimOutcome::AcceptClaim,
            current_step: 2,
        },
    }
    .try_to_vec()
    .unwrap();
    let revealed = rpc.context.get_sysvar::<Clock>().unix_timestamp as u64;
    let initial_context = rpc.context.clone();
    let initial_indexer = rpc.indexer.clone();
    for (at, expected, label) in [
        (
            revealed,
            Some(VaultError::OracleTimingWindowClosed),
            "reveal-exact",
        ),
        (
            revealed + 86_399,
            Some(VaultError::OracleTimingWindowClosed),
            "challenge-minus-one",
        ),
        (revealed + 86_400, None, "challenge-exact"),
        (revealed + 86_401, None, "challenge-plus-one"),
        (
            expiry + 86_400,
            Some(VaultError::OracleTimingWindowClosed),
            "grace-exact",
        ),
    ] {
        rpc.context = initial_context.clone();
        rpc.indexer = initial_indexer.clone();
        let mut clock = rpc.context.get_sysvar::<Clock>();
        clock.unix_timestamp = at as i64;
        clock.slot += 10;
        rpc.context.set_sysvar(&clock);
        let ix =
            proof::mixed_instruction(rpc, core.clone(), &inputs, &creates, inner.clone()).await;
        let guarded = ix
            .accounts
            .iter()
            .filter(|m| m.pubkey != payer.pubkey())
            .map(|m| m.pubkey)
            .collect::<Vec<_>>();
        let before = proof::snapshot(rpc, &guarded);
        if let Some(error) = expected {
            assert_eq!(
                proof::send(rpc, payer, ix, label).unwrap_err(),
                TransactionError::InstructionError(1, InstructionError::Custom(error as u32))
            );
            assert_eq!(before, proof::snapshot(rpc, &guarded));
        } else {
            let mut bad = ix.clone();
            bad.accounts[12].pubkey = Pubkey::new_unique();
            assert_eq!(
                proof::send(rpc, payer, bad, "ordinary-late-checkpoint-rollback").unwrap_err(),
                TransactionError::InstructionError(
                    1,
                    InstructionError::Custom(VaultError::InvalidSystemProgram as u32)
                )
            );
            assert_eq!(before, proof::snapshot(rpc, &guarded));
            proof::send(rpc, payer, ix, label).unwrap();
            let stored = rpc.context.get_account(&claim).unwrap();
            let accepted = OracleUpdateClaimV2::deserialize(&mut stored.data.as_slice()).unwrap();
            assert_eq!(accepted.claim.status, OracleClaimStatus::Finalized);
            let after = proof::read(rpc, source_leaf).await;
            assert_eq!(
                u64::from_le_bytes(after.data[104..112].try_into().unwrap()),
                110
            );
            let history = proof::read(rpc, &obs_leaf).await;
            assert_ne!(history, obs_leaf);
            let domain = CompressedStateDomain::OracleCarryCheckpoint;
            let value = proof::read(
                rpc,
                &proof::leaf(domain, checkpoint, vec![0; domain.compact_data_len()]),
            )
            .await;
            assert!(!value.data.is_empty());
        }
        println!(
            "closure timing={label} now={at} revealed={revealed} C=86400 H={}",
            expiry + 86_400
        );
    }
}
fn link(event: &Pubkey, role: u8, h: &[u8; 32]) -> Pubkey {
    pda(&[b"g3-evidence-link-v1", event.as_ref(), &[role], h]).0
}
fn write_ix(
    payer: &Pubkey,
    kind: u8,
    h: [u8; 32],
    total: usize,
    offset: usize,
    bytes: &[u8],
) -> solana_sdk::instruction::Instruction {
    govern(
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(object(payer, kind, &h), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        VaultInstruction::OracleCarryForwardV1 {
            action: Action::WriteEvidence {
                kind,
                hash: h,
                total: total as u16,
                offset: offset as u16,
                bytes: bytes.to_vec(),
            },
        },
    )
}
fn upload(rpc: &mut LightProgramTest, payer: &Keypair, kind: u8, h: [u8; 32], bytes: &[u8]) {
    for (i, chunk) in bytes.chunks(192).enumerate() {
        proof::send(
            rpc,
            payer,
            write_ix(&payer.pubkey(), kind, h, bytes.len(), i * 192, chunk),
            "evidence_upload",
        )
        .unwrap();
    }
    let a = rpc
        .context
        .get_account(&object(&payer.pubkey(), kind, &h))
        .unwrap();
    assert_eq!(a.data[75], 1);
    assert_eq!(&a.data[76..], bytes);
    println!(
        "evidence storage kind={kind} bytes={} lamports={}",
        a.data.len(),
        a.lamports
    );
}
#[tokio::test]
async fn actual_sbf_evidence_chunk_resume_seal_and_reject_overwrite() {
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100_000;
    rpc.context.set_sysvar(&clock);
    let bytes = vec![65; 4096];
    let h = hashv(&[&bytes]).to_bytes();
    let key = object(&payer.pubkey(), 2, &h);
    proof::send(
        &mut rpc,
        &payer,
        write_ix(&payer.pubkey(), 2, h, 4096, 0, &bytes[..192]),
        "evidence_begin_max_definition",
    )
    .unwrap();
    let before = proof::snapshot(&rpc, &[key]);
    assert!(proof::send(
        &mut rpc,
        &payer,
        write_ix(&payer.pubkey(), 2, h, 4096, 384, &bytes[384..576]),
        "evidence_reordered_chunk"
    )
    .is_err());
    assert_eq!(before, proof::snapshot(&rpc, &[key]));
    proof::send(
        &mut rpc,
        &payer,
        write_ix(&payer.pubkey(), 2, h, 4096, 0, &bytes[..192]),
        "evidence_exact_replay",
    )
    .unwrap();
    assert_eq!(before, proof::snapshot(&rpc, &[key]));
    for offset in (192..4096).step_by(192) {
        proof::send(
            &mut rpc,
            &payer,
            write_ix(
                &payer.pubkey(),
                2,
                h,
                4096,
                offset,
                &bytes[offset..(offset + 192).min(4096)],
            ),
            "evidence_resume",
        )
        .unwrap();
    }
    let sealed = proof::snapshot(&rpc, &[key]);
    let maximum = rpc.context.get_account(&key).unwrap();
    println!(
        "evidence maximum definition bytes={} lamports={}",
        maximum.data.len(),
        maximum.lamports
    );
    assert!(proof::send(
        &mut rpc,
        &payer,
        write_ix(&payer.pubkey(), 2, h, 4096, 0, &[66; 192]),
        "evidence_conflicting_replay"
    )
    .is_err());
    assert_eq!(sealed, proof::snapshot(&rpc, &[key]));
    let close = govern(
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(key, false),
        ],
        VaultInstruction::OracleCarryForwardV1 {
            action: Action::CloseEvidenceDraft,
        },
    );
    assert!(proof::send(&mut rpc, &payer, close, "evidence_sealed_close_rejected").is_err());
    assert_eq!(sealed, proof::snapshot(&rpc, &[key]));
    let bad = [77; 32];
    let draft = object(&payer.pubkey(), 2, &bad);
    proof::send(
        &mut rpc,
        &payer,
        write_ix(&payer.pubkey(), 2, bad, 200, 0, &bytes[..192]),
        "evidence_bad_digest_draft",
    )
    .unwrap();
    let snapshot = proof::snapshot(&rpc, &[draft]);
    assert!(proof::send(
        &mut rpc,
        &payer,
        write_ix(&payer.pubkey(), 2, bad, 200, 192, &bytes[192..200]),
        "evidence_seal_digest_rejected"
    )
    .is_err());
    assert_eq!(snapshot, proof::snapshot(&rpc, &[draft]));
    let close = govern(
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(draft, false),
        ],
        VaultInstruction::OracleCarryForwardV1 {
            action: Action::CloseEvidenceDraft,
        },
    );
    proof::send(&mut rpc, &payer, close, "evidence_draft_refund").unwrap();
    assert!(rpc.context.get_account(&draft).is_none());
}
#[tokio::test]
async fn actual_sbf_reveal_requires_metadata_and_rolls_back_missing_binding() {
    run_reveal(false).await;
}

#[tokio::test]
async fn actual_sbf_real_reveal_24_hour_boundaries_and_checkpoint_rollback() {
    run_reveal(true).await;
}

async fn run_reveal(timing: bool) {
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100_000;
    clock.unix_timestamp = 1_800_000_300;
    rpc.context.set_sysvar(&clock);
    let listing = 1_800_000_000u64;
    let expiry = listing + 1_000_000;
    let market_id = [81; 32];
    let source_id = [82; 32];
    let claim_id = [83; 32];
    let salt = [84; 32];
    let bucket_id = [85; 32];
    let (market, mb) = pda(&[MARKET_PDA_SEED, &market_id]);
    let (month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market.as_ref(),
        &expiry.to_le_bytes(),
    ]);
    let (source, sb) = pda(&[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id]);
    let (manifest, ab) = derive_oracle_active_weight_manifest_pda(&program(), &month);
    let (claim, cb) =
        derive_oracle_update_claim_v2_pda(&program(), &month, &source, &payer.pubkey(), &claim_id);
    let locator = b"https://example.com/price?x=%2f";
    let definition = b"source-definition-v1\0USD\0region=global\0field=spot\0tier=retail";
    let url = "https://web.archive.org/web/20270115080320/https://example.com/price?x=%2f";
    let lh = hashv(&[b"locator", locator]).to_bytes();
    let dh = hashv(&[definition]).to_bytes();
    let ah = hashv(&[ORACLE_OPENING_ARCHIVE_URL_HASH_DOMAIN, url.as_bytes()]).to_bytes();
    let source_time = listing + 200;
    let eh = hashv(&[
        ORACLE_UPDATE_EVIDENCE_HASH_DOMAIN,
        month.as_ref(),
        source.as_ref(),
        &source_id,
        &110u64.to_le_bytes(),
        &source_time.to_le_bytes(),
        &lh,
        &dh,
        url.as_bytes(),
    ])
    .to_bytes();
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
    let month_value = OracleMonthState {
        is_initialized: true,
        bump: ob,
        market,
        account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
        account_version: OracleMonthState::ACCOUNT_VERSION,
        scramble_start_ts: listing - ORACLE_PRE_LISTING_WINDOW_SECONDS,
        listing_ts: listing,
        phase: OraclePhase::Game,
        source_count: 1,
        recipe_hash: [90; 32],
        weight_manifest_hash: [91; 32],
        frozen_source_count: 1,
        opened_source_count: 1,
        opening_resolved_source_count: 1,
        weight_scheme_version: 1,
        effective_weight_total_bps: 10000,
        active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
        active_weight_group_count: 1,
        active_weight_manifest_hash: [86; 32],
        pending_resolution_count: 1,
        ..Default::default()
    };
    install(&mut rpc, month, &month_value, OracleMonthState::LEN);
    install(
        &mut rpc,
        manifest,
        &OracleActiveWeightManifest {
            is_initialized: true,
            bump: ab,
            account_discriminator: OracleActiveWeightManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleActiveWeightManifest::ACCOUNT_VERSION,
            month,
            phase: OracleRecipeWeightPhase::Finalized,
            expected_source_count: 1,
            processed_source_count: 1,
            expected_group_count: 1,
            processed_group_count: 1,
            processed_bucket_weight_bps: 10000,
            rolling_manifest_hash: month_value.active_weight_manifest_hash,
            ..Default::default()
        },
        OracleActiveWeightManifest::LEN,
    );
    let source_value = OracleSourceState {
        is_initialized: true,
        bump: sb,
        month,
        source_id,
        bucket_id,
        source_type_hash: [87; 32],
        canonical_locator_hash: lh,
        source_definition_hash: dh,
        proposer: payer.pubkey(),
        baseline_state: 100,
        current_state: 100,
        bucket_weight_bps: 10000,
        status: OracleSourceStatus::Active,
        opening_submitted: true,
        opening_evidence_hash: [88; 32],
        last_finalized_step: 1,
        observation_count: 1,
        latest_source_time: listing + 100,
        rolling_observation_hash: [89; 32],
        ..Default::default()
    };
    let raw = source_value.try_to_vec().unwrap();
    let mut compact = raw[34..98].to_vec();
    compact.extend(&raw[194..]);
    let source_leaf = proof::leaf(CompressedStateDomain::OracleSourceState, source, compact);
    let descriptor = proof::leaf(
        CompressedStateDomain::OracleSourceDescriptor,
        source,
        raw[98..194].to_vec(),
    );
    proof::seed(&mut rpc, &payer, &[source_leaf.clone(), descriptor.clone()]).await;
    upload(&mut rpc, &payer, 1, lh, locator);
    upload(&mut rpc, &payer, 2, dh, definition);
    let source_metadata_core = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new_readonly(month, false),
        AccountMeta::new(source, false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 1, &lh), false),
        AccountMeta::new(link(&source, 0, &lh), false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 2, &dh), false),
        AccountMeta::new(link(&source, 1, &dh), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];
    let source_metadata_ix = proof::readonly_instruction(
        &rpc,
        source_metadata_core.clone(),
        &[(2, source_leaf.clone()), (2, descriptor.clone())],
        VaultInstruction::OracleCarryForwardV1 {
            action: Action::BackfillSourceEvidence,
        }
        .try_to_vec()
        .unwrap(),
    )
    .await;
    proof::send(
        &mut rpc,
        &payer,
        source_metadata_ix,
        "evidence_exact_source_backfill",
    )
    .unwrap();
    let before = proof::snapshot(&rpc, &[link(&source, 0, &lh), link(&source, 1, &dh)]);
    let source_metadata_ix = proof::readonly_instruction(
        &rpc,
        source_metadata_core,
        &[(2, source_leaf.clone()), (2, descriptor.clone())],
        VaultInstruction::OracleCarryForwardV1 {
            action: Action::BackfillSourceEvidence,
        }
        .try_to_vec()
        .unwrap(),
    )
    .await;
    proof::send(
        &mut rpc,
        &payer,
        source_metadata_ix,
        "evidence_source_backfill_replay",
    )
    .unwrap();
    assert_eq!(
        before,
        proof::snapshot(&rpc, &[link(&source, 0, &lh), link(&source, 1, &dh)])
    );
    let sponsor = Keypair::new();
    rpc.context
        .set_account(sponsor.pubkey(), account(system_program::id(), vec![]))
        .unwrap();
    upload(&mut rpc, &sponsor, 1, lh, locator);
    upload(&mut rpc, &sponsor, 2, dh, definition);
    let sponsor_core = vec![
        AccountMeta::new(sponsor.pubkey(), true),
        AccountMeta::new_readonly(month, false),
        AccountMeta::new(source, false),
        AccountMeta::new_readonly(object(&sponsor.pubkey(), 1, &lh), false),
        AccountMeta::new(link(&source, 0, &lh), false),
        AccountMeta::new_readonly(object(&sponsor.pubkey(), 2, &dh), false),
        AccountMeta::new(link(&source, 1, &dh), false),
        AccountMeta::new_readonly(system_program::id(), false),
    ];
    let sponsor_ix = proof::readonly_instruction(
        &rpc,
        sponsor_core,
        &[(2, source_leaf.clone()), (2, descriptor.clone())],
        vec![30, 16],
    )
    .await;
    proof::send(
        &mut rpc,
        &sponsor,
        sponsor_ix,
        "evidence_new_payer_same_preimage_retains_original_pointer",
    )
    .unwrap();
    assert_eq!(
        before,
        proof::snapshot(&rpc, &[link(&source, 0, &lh), link(&source, 1, &dh)])
    );
    let commit = light_token_minter::processor::oracle_update_claim_v2_commitment_hash(
        &program(),
        &month,
        &source,
        &source_id,
        &payer.pubkey(),
        &claim_id,
        100,
        110,
        source_time,
        &eh,
        &ah,
        &salt,
    );
    let claim_value = OracleUpdateClaimV2 {
        claim: OracleUpdateClaimData {
            is_initialized: true,
            bump: cb,
            month,
            claim_id,
            source,
            source_id,
            claimant: payer.pubkey(),
            stake: 1,
            status: OracleClaimStatus::Committed,
            account_discriminator: OracleUpdateClaimV2::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUpdateClaimV2::ACCOUNT_VERSION,
            ..Default::default()
        },
        freshness_reward_multiplier: 1,
        commit_hash: commit,
        commit_slot: 1,
        earliest_reveal_slot: 1 + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS,
        reveal_deadline_slot: 1
            + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS
            + ORACLE_UPDATE_REVEAL_WINDOW_SLOTS,
        ..Default::default()
    };
    install(&mut rpc, claim, &claim_value, OracleUpdateClaimV2::LEN);
    // Keep the test inside the real slot-based reveal interval.
    clock.slot = claim_value.earliest_reveal_slot;
    rpc.context.set_sysvar(&clock);
    let archive_object = object(&payer.pubkey(), 3, &ah);
    let binding = link(&claim, 4, &eh);
    let core = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new_readonly(market, false),
        AccountMeta::new_readonly(month, false),
        AccountMeta::new(source, false),
        AccountMeta::new_readonly(manifest, false),
        AccountMeta::new(claim, false),
        AccountMeta::new_readonly(system_program::id(), false),
        AccountMeta::new_readonly(archive_object, false),
        AccountMeta::new(binding, false),
    ];
    let inner = VaultInstruction::RevealOracleUpdateClaimV3 {
        params: RevealOracleUpdateClaimV3Params {
            claim_id,
            prior_state: 100,
            new_state: 110,
            source_time,
            evidence_hash: eh,
            archive_url: String::new(),
            secret_salt: salt,
        },
    }
    .try_to_vec()
    .unwrap();
    let inputs = [(3, source_leaf.clone()), (3, descriptor.clone())];
    let ix = proof::readonly_instruction(&rpc, core.clone(), &inputs, inner.clone()).await;
    let before = proof::snapshot(&rpc, &[claim, month, binding]);
    assert!(proof::send(&mut rpc, &payer, ix, "evidence_missing_reveal_rollback").is_err());
    assert_eq!(before, proof::snapshot(&rpc, &[claim, month, binding]));
    assert_eq!(proof::read(&rpc, &source_leaf).await, source_leaf);
    upload(&mut rpc, &payer, 3, ah, url.as_bytes());
    let ix = proof::readonly_instruction(&rpc, core.clone(), &inputs, inner.clone()).await;
    proof::send(&mut rpc, &payer, ix, "evidence_reveal_published").unwrap();
    let stored = rpc.context.get_account(&claim).unwrap();
    let value = OracleUpdateClaimV2::deserialize(&mut stored.data.as_slice()).unwrap();
    assert_eq!(value.claim.status, OracleClaimStatus::Revealed);
    assert_eq!(value.revealed_at_ts, clock.unix_timestamp as u64);
    assert_eq!(value.claim.archive_url_hash, ah);
    let receipt = rpc.context.get_account(&binding).unwrap();
    assert_eq!(receipt.data.len(), 251);
    assert_eq!(&receipt.data[187..219], &eh);
    assert_eq!(&receipt.data[219..], &source_id);
    assert_eq!(proof::read(&rpc, &source_leaf).await, source_leaf);
    let before = proof::snapshot(&rpc, &[claim, month, binding, archive_object]);
    let ix = proof::readonly_instruction(&rpc, core, &inputs, inner).await;
    assert!(proof::send(&mut rpc, &payer, ix, "evidence_duplicate_reveal_rejected").is_err());
    assert_eq!(
        before,
        proof::snapshot(&rpc, &[claim, month, binding, archive_object])
    );
    if timing {
        exercise_revealed_timing(
            &mut rpc,
            &payer,
            market,
            month,
            manifest,
            claim,
            &source_value,
            &source_leaf,
            expiry,
        )
        .await;
        return;
    }
    // The alternate evidence is independently funded and bound to this exact claim.
    let challenger = Keypair::new();
    rpc.context
        .set_account(challenger.pubkey(), account(system_program::id(), vec![]))
        .unwrap();
    let (collateral, bump) = pda(&[USER_COLLATERAL_PDA_SEED, challenger.pubkey().as_ref()]);
    install(
        &mut rpc,
        collateral,
        &UserCollateral {
            is_initialized: true,
            bump,
            owner: challenger.pubkey(),
            available_balance: 100,
            ..Default::default()
        },
        UserCollateral::LEN,
    );
    let schedule = derive_oracle_usdc_reward_schedule_pda(&program(), &month).0;
    let (sku, bump) = derive_oracle_usdc_sku_pool_pda(&program(), &schedule, &bucket_id);
    let sku_value = OracleUsdcSkuPool {
        is_initialized: true,
        bump,
        account_discriminator: OracleUsdcSkuPool::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcSkuPool::ACCOUNT_VERSION,
        schedule,
        month,
        bucket_id,
        challenge_bond_bps: 10000,
        challenge_min_bond: 1,
        challenge_max_bond: 1,
        ..Default::default()
    };
    let raw = sku_value.try_to_vec().unwrap();
    let sku_leaf = proof::leaf(
        CompressedStateDomain::OracleUsdcSkuPool,
        sku,
        raw[70..226].to_vec(),
    );
    proof::seed(&mut rpc, &payer, std::slice::from_ref(&sku_leaf)).await;
    let challenge_id = [119; 32];
    let challenge = pda(&[
        ORACLE_UPDATE_CHALLENGE_PDA_SEED,
        month.as_ref(),
        claim.as_ref(),
        &challenge_id,
    ])
    .0;
    let guard = pda(&[
        ORACLE_UPDATE_CHALLENGE_GUARD_PDA_SEED,
        month.as_ref(),
        claim.as_ref(),
    ])
    .0;
    let alt = hashv(&[
        ORACLE_UPDATE_EVIDENCE_HASH_DOMAIN,
        month.as_ref(),
        source.as_ref(),
        &source_id,
        &100u64.to_le_bytes(),
        &source_time.to_le_bytes(),
        &lh,
        &dh,
        url.as_bytes(),
    ])
    .to_bytes();
    let alternative_binding = link(&challenge, 5, &alt);
    let core = vec![
        AccountMeta::new(challenger.pubkey(), true),
        AccountMeta::new_readonly(market, false),
        AccountMeta::new_readonly(month, false),
        AccountMeta::new(sku, false),
        AccountMeta::new_readonly(claim, false),
        AccountMeta::new(source, false),
        AccountMeta::new(collateral, false),
        AccountMeta::new(challenge, false),
        AccountMeta::new_readonly(system_program::id(), false),
        AccountMeta::new(guard, false),
        AccountMeta::new_readonly(archive_object, false),
        AccountMeta::new(alternative_binding, false),
    ];
    let inner = VaultInstruction::ChallengeOracleUpdateClaimV2 {
        params: light_token_minter::instruction::ChallengeOracleUpdateClaimParams {
            challenge_id,
            alternative_state: 100,
            alternative_source_time: source_time,
            evidence_hash: alt,
            bond: 1,
            archive_url: String::new(),
        },
    }
    .try_to_vec()
    .unwrap();
    let inputs = [
        (3, sku_leaf),
        (5, source_leaf.clone()),
        (5, descriptor.clone()),
    ];
    let ix = proof::readonly_instruction(&rpc, core.clone(), &inputs, inner.clone()).await;
    proof::send(&mut rpc, &challenger, ix, "evidence_update_alternative").unwrap();
    assert_eq!(
        rpc.context.get_account(&alternative_binding).unwrap().data[166],
        5
    );
    let before = proof::snapshot(
        &rpc,
        &[claim, challenge, guard, collateral, alternative_binding],
    );
    let ix = proof::readonly_instruction(&rpc, core, &inputs, inner).await;
    assert!(proof::send(
        &mut rpc,
        &challenger,
        ix,
        "evidence_alternative_duplicate_rollback"
    )
    .is_err());
    assert_eq!(
        before,
        proof::snapshot(
            &rpc,
            &[claim, challenge, guard, collateral, alternative_binding]
        )
    );
    let keys = [
        object(&payer.pubkey(), 1, &lh),
        object(&payer.pubkey(), 2, &dh),
        archive_object,
        link(&source, 0, &lh),
        link(&source, 1, &dh),
        binding,
    ];
    let rows:Vec<_>=keys.iter().map(|key|{let a=rpc.context.get_account(key).unwrap();serde_json::json!({"address":key.to_string(),"owner":a.owner.to_string(),"lamports":a.lamports,"executable":a.executable,"data":a.data})}).collect();
    std::fs::write("/tmp/g3-evidence-recovery-accounts.json",serde_json::to_vec_pretty(&serde_json::json!({"program":program().to_string(),"event":claim.to_string(),"source":source.to_string(),"url":url,"accounts":rows,"adjudications":([claim,challenge,alternative_binding].iter().map(|key|{let a=rpc.context.get_account(key).unwrap();serde_json::json!({"address":key.to_string(),"owner":a.owner.to_string(),"lamports":a.lamports,"executable":a.executable,"data":a.data})}).collect::<Vec<_>>()),"alternativeEvent":challenge.to_string()})).unwrap()).unwrap();
    println!(
        "evidence binding bytes={} lamports={} immutable_url={url}",
        receipt.data.len(),
        receipt.lamports
    );
}

#[tokio::test]
async fn actual_sbf_new_source_requires_both_preimages_before_bond_lock() {
    source_admission(false).await;
}
#[tokio::test]
async fn actual_sbf_carry_import_preserves_definition_links_and_creates_no_observation() {
    source_admission(true).await;
}
async fn source_admission(carry: bool) {
    use light_token_minter::instruction::ProposeOracleSourceV3Params;
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100000;
    clock.unix_timestamp = 1800000000;
    rpc.context.set_sysvar(&clock);
    let expiry = 1803000000u64;
    let market_id = [101; 32];
    let source_id = [102; 32];
    let bucket_id = [103; 32];
    let (market, mb) = pda(&[MARKET_PDA_SEED, &market_id]);
    let (month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market.as_ref(),
        &expiry.to_le_bytes(),
    ]);
    let (source, _) = pda(&[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id]);
    let (obs, _) = pda(&[ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, source.as_ref()]);
    let (schedule, rb) = derive_oracle_usdc_reward_schedule_pda(&program(), &month);
    let (sku, kb) = derive_oracle_usdc_sku_pool_pda(&program(), &schedule, &bucket_id);
    let (reward, _) = derive_oracle_usdc_source_reward_pda(&program(), &schedule, &source);
    let (coverage, cvb) = derive_oracle_sku_coverage_manifest_pda(&program(), &month);
    let (collateral, cb) = pda(&[USER_COLLATERAL_PDA_SEED, payer.pubkey().as_ref()]);
    install(
        &mut rpc,
        market,
        &Market {
            is_initialized: true,
            bump: mb,
            market_id,
            paused: true,
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
            phase: OraclePhase::SourceSubmission,
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    install(
        &mut rpc,
        schedule,
        &OracleUsdcRewardSchedule {
            is_initialized: true,
            bump: rb,
            account_discriminator: OracleUsdcRewardSchedule::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUsdcRewardSchedule::ACCOUNT_VERSION,
            month,
            authority: payer.pubkey(),
            reward_vault: derive_oracle_usdc_reward_vault_pda(&program()).0,
            phase: OracleUsdcRewardSchedulePhase::Funded,
            ..Default::default()
        },
        OracleUsdcRewardSchedule::LEN,
    );
    // A governed test fixture with one SKU: product bootstrap is outside this metadata test.
    let root = hashv(&[ORACLE_SKU_LEAF_HASH_DOMAIN, &0u16.to_le_bytes(), &bucket_id]).to_bytes();
    install(
        &mut rpc,
        coverage,
        &OracleSkuCoverageManifest {
            is_initialized: true,
            bump: cvb,
            account_discriminator: OracleSkuCoverageManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleSkuCoverageManifest::ACCOUNT_VERSION,
            month,
            required_sku_root: root,
            required_sku_count: 1,
            planned_scramble_start_ts: 1799999900,
            planned_listing_ts: 1799999900 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            ..Default::default()
        },
        OracleSkuCoverageManifest::LEN,
    );
    install(
        &mut rpc,
        collateral,
        &UserCollateral {
            is_initialized: true,
            bump: cb,
            owner: payer.pubkey(),
            available_balance: 100,
            ..Default::default()
        },
        UserCollateral::LEN,
    );
    let sku_value = OracleUsdcSkuPool {
        is_initialized: true,
        bump: kb,
        account_discriminator: OracleUsdcSkuPool::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcSkuPool::ACCOUNT_VERSION,
        schedule,
        month,
        bucket_id,
        listing_bond: 10,
        ..Default::default()
    };
    let sku_raw = sku_value.try_to_vec().unwrap();
    let leaf = proof::leaf(
        CompressedStateDomain::OracleUsdcSkuPool,
        sku,
        sku_raw[70..226].to_vec(),
    );
    proof::seed(&mut rpc, &payer, std::slice::from_ref(&leaf)).await;
    let locator = b"https://example.com/source";
    let definition = b"source-definition-v1\0USD\0spot";
    let lh = hashv(&[b"locator", locator]).to_bytes();
    let dh = hashv(&[definition]).to_bytes();
    upload(&mut rpc, &payer, 1, lh, locator);
    let mut core = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new_readonly(market, false),
        AccountMeta::new(month, false),
        AccountMeta::new(schedule, false),
        AccountMeta::new(sku, false),
        AccountMeta::new(source, false),
        AccountMeta::new(obs, false),
        AccountMeta::new(reward, false),
        AccountMeta::new(collateral, false),
        AccountMeta::new_readonly(system_program::id(), false),
        AccountMeta::new_readonly(coverage, false),
        AccountMeta::new_readonly(pda(&[b"g3-oracle-carry-period", month.as_ref()]).0, false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 1, &lh), false),
        AccountMeta::new(link(&source, 0, &lh), false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 2, &dh), false),
        AccountMeta::new(link(&source, 1, &dh), false),
    ];
    let mut inner = VaultInstruction::ProposeOracleSourceV3 {
        params: ProposeOracleSourceV3Params {
            source_id,
            bucket_id,
            source_type_hash: [104; 32],
            canonical_locator_hash: lh,
            source_definition_hash: dh,
            listing_bond: 10,
            sku_index: 0,
            sku_proof: vec![],
        },
    }
    .try_to_vec()
    .unwrap();
    let creates = [
        (5, CompressedStateDomain::OracleSourceState, source),
        (5, CompressedStateDomain::OracleSourceDescriptor, source),
        (6, CompressedStateDomain::OracleSourceObservations, obs),
        (7, CompressedStateDomain::OracleUsdcSourceReward, reward),
    ];
    let mut inputs = vec![(4, false, leaf.clone())];
    if carry {
        configure_carry_import(
            &mut rpc,
            &payer,
            market,
            month,
            expiry,
            source,
            source_id,
            bucket_id,
            lh,
            dh,
            &mut core,
            &mut inputs,
        )
        .await;
        inner = vec![30, 3, 0, 0, 0];
    }
    let before = proof::snapshot(
        &rpc,
        &[
            collateral,
            schedule,
            month,
            link(&source, 0, &lh),
            link(&source, 1, &dh),
        ],
    );
    let ix = proof::mixed_instruction(&rpc, core.clone(), &inputs, &creates, inner.clone()).await;
    assert!(proof::send(
        &mut rpc,
        &payer,
        ix,
        "evidence_source_missing_definition_rollback"
    )
    .is_err());
    assert_eq!(
        before,
        proof::snapshot(
            &rpc,
            &[
                collateral,
                schedule,
                month,
                link(&source, 0, &lh),
                link(&source, 1, &dh)
            ]
        )
    );
    upload(&mut rpc, &payer, 2, dh, definition);
    let ix = proof::mixed_instruction(&rpc, core, &inputs, &creates, inner).await;
    proof::send(
        &mut rpc,
        &payer,
        ix,
        if carry {
            "evidence_carry_import"
        } else {
            "evidence_source_admission"
        },
    )
    .unwrap();
    if carry {
        for (_, _, leaf) in inputs.iter().skip(1) {
            assert_eq!(proof::read(&rpc, leaf).await, *leaf);
        }
        let key = pda(&[b"g3-oracle-carry-source", source.as_ref()]).0;
        let c = rpc.context.get_account(&key).unwrap();
        assert_eq!(c.data[438], 0);
        let parent_source = inputs[1].2.canonical_pda;
        assert_eq!(&c.data[102..134], parent_source.as_ref());
    }
    let a = rpc.context.get_account(&collateral).unwrap();
    let c = UserCollateral::deserialize(&mut a.data.as_slice()).unwrap();
    assert_eq!(c.available_balance, 90);
    assert_eq!(
        rpc.context
            .get_account(&link(&source, 0, &lh))
            .unwrap()
            .data
            .len(),
        251
    );
    assert_eq!(
        rpc.context
            .get_account(&link(&source, 1, &dh))
            .unwrap()
            .data
            .len(),
        251
    );
    let source_address = light_token_minter::compression::derive_compressed_state_leaf_address(
        &program(),
        &LIGHT_DEFAULT_ADDRESS_TREE_V2,
        CompressedStateDomain::OracleSourceState,
        &source,
    )
    .0;
    let stored = rpc
        .get_compressed_account(source_address, None)
        .await
        .unwrap()
        .value
        .unwrap();
    let source_leaf = CompressedAmebaStateLeaf::try_from_slice(&stored.data.unwrap().data).unwrap();
    assert_eq!(source_leaf.data[130], OracleSourceStatus::Candidate as u8);
    assert_eq!(
        u64::from_le_bytes(source_leaf.data[112..120].try_into().unwrap()),
        10
    );
}
#[tokio::test]
async fn actual_sbf_opening_and_alternative_bind_maximum_archive_url() {
    use light_token_minter::instruction::{
        ChallengeOracleOpeningClaimParams, SubmitOracleOpeningClaimParams,
    };
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let challenger = Keypair::new();
    rpc.context
        .set_account(challenger.pubkey(), account(system_program::id(), vec![]))
        .unwrap();
    let listing = 1_800_001_000u64;
    let expiry = listing + 1_000_000;
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100000;
    clock.unix_timestamp = 1_800_000_300;
    rpc.context.set_sysvar(&clock);
    let source_time = 1_800_000_200u64;
    let (market, mb) = pda(&[MARKET_PDA_SEED, &[111; 32]]);
    let (month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market.as_ref(),
        &expiry.to_le_bytes(),
    ]);
    let source_id = [112; 32];
    let bucket_id = [113; 32];
    let (source, sb) = pda(&[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id]);
    let schedule = derive_oracle_usdc_reward_schedule_pda(&program(), &month).0;
    let (sku, kb) = derive_oracle_usdc_sku_pool_pda(&program(), &schedule, &bucket_id);
    let claim = pda(&[
        ORACLE_OPENING_CLAIM_PDA_SEED,
        month.as_ref(),
        source.as_ref(),
    ])
    .0;
    let locator = format!("https://example.com/{}", "x".repeat(321));
    let url = format!("https://web.archive.org/web/20270115080320/{locator}");
    assert_eq!(url.len(), 384);
    let lh = hashv(&[b"locator", locator.as_bytes()]).to_bytes();
    let dh = hashv(&[b"definition-v1"]).to_bytes();
    let ah = hashv(&[ORACLE_OPENING_ARCHIVE_URL_HASH_DOMAIN, url.as_bytes()]).to_bytes();
    install(
        &mut rpc,
        market,
        &Market {
            is_initialized: true,
            bump: mb,
            market_id: [111; 32],
            paused: true,
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
            scramble_start_ts: listing - ORACLE_PRE_LISTING_WINDOW_SECONDS,
            listing_ts: listing,
            phase: OraclePhase::Opening,
            source_count: 1,
            frozen_source_count: 1,
            recipe_hash: [114; 32],
            weight_manifest_hash: [115; 32],
            weight_scheme_version: 1,
            effective_weight_total_bps: 10000,
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    let source_value = OracleSourceState {
        is_initialized: true,
        bump: sb,
        month,
        source_id,
        bucket_id,
        source_type_hash: [116; 32],
        canonical_locator_hash: lh,
        source_definition_hash: dh,
        proposer: payer.pubkey(),
        status: OracleSourceStatus::Frozen,
        bucket_weight_bps: 10000,
        ..Default::default()
    };
    let raw = source_value.try_to_vec().unwrap();
    let mut compact = raw[34..98].to_vec();
    compact.extend(&raw[194..]);
    let source_leaf = proof::leaf(CompressedStateDomain::OracleSourceState, source, compact);
    let descriptor = proof::leaf(
        CompressedStateDomain::OracleSourceDescriptor,
        source,
        raw[98..194].to_vec(),
    );
    let sku_value = OracleUsdcSkuPool {
        is_initialized: true,
        bump: kb,
        account_discriminator: OracleUsdcSkuPool::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcSkuPool::ACCOUNT_VERSION,
        schedule,
        month,
        bucket_id,
        opening_bond: 10,
        challenge_bond_bps: 10000,
        challenge_min_bond: 10,
        challenge_max_bond: 10,
        ..Default::default()
    };
    let raw = sku_value.try_to_vec().unwrap();
    let sku_leaf = proof::leaf(
        CompressedStateDomain::OracleUsdcSkuPool,
        sku,
        raw[70..226].to_vec(),
    );
    proof::seed(
        &mut rpc,
        &payer,
        &[source_leaf.clone(), descriptor.clone(), sku_leaf.clone()],
    )
    .await;
    for owner in [payer.pubkey(), challenger.pubkey()] {
        let (key, bump) = pda(&[USER_COLLATERAL_PDA_SEED, owner.as_ref()]);
        install(
            &mut rpc,
            key,
            &UserCollateral {
                is_initialized: true,
                bump,
                owner,
                available_balance: 100,
                ..Default::default()
            },
            UserCollateral::LEN,
        );
    }
    upload(&mut rpc, &payer, 3, ah, url.as_bytes());
    let eh = hashv(&[
        ORACLE_OPENING_EVIDENCE_HASH_DOMAIN,
        month.as_ref(),
        source.as_ref(),
        &100u64.to_le_bytes(),
        &source_time.to_le_bytes(),
        &lh,
        &dh,
        url.as_bytes(),
    ])
    .to_bytes();
    let core = vec![
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new_readonly(market, false),
        AccountMeta::new(month, false),
        AccountMeta::new(sku, false),
        AccountMeta::new(source, false),
        AccountMeta::new(
            pda(&[USER_COLLATERAL_PDA_SEED, payer.pubkey().as_ref()]).0,
            false,
        ),
        AccountMeta::new(claim, false),
        AccountMeta::new_readonly(system_program::id(), false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 3, &ah), false),
        AccountMeta::new(link(&claim, 2, &eh), false),
    ];
    let inner = VaultInstruction::SubmitOracleOpeningClaimV2 {
        params: SubmitOracleOpeningClaimParams {
            opening_state: 100,
            source_time,
            stake: 10,
            canonical_locator_hash: lh,
            source_definition_hash: dh,
            archive_url: String::new(),
        },
    }
    .try_to_vec()
    .unwrap();
    let ix = proof::mixed_instruction(
        &rpc,
        core,
        &[
            (3, false, sku_leaf.clone()),
            (4, true, source_leaf.clone()),
            (4, false, descriptor.clone()),
        ],
        &[],
        inner,
    )
    .await;
    proof::send(&mut rpc, &payer, ix, "evidence_opening_maximum_url").unwrap();
    let updated = proof::read(&rpc, &source_leaf).await;
    let cid = [117; 32];
    let challenge = pda(&[
        ORACLE_OPENING_CLAIM_CHALLENGE_PDA_SEED,
        month.as_ref(),
        claim.as_ref(),
        &cid,
    ])
    .0;
    let alt = hashv(&[
        ORACLE_OPENING_EVIDENCE_HASH_DOMAIN,
        month.as_ref(),
        source.as_ref(),
        &90u64.to_le_bytes(),
        &source_time.to_le_bytes(),
        &lh,
        &dh,
        url.as_bytes(),
    ])
    .to_bytes();
    let core = vec![
        AccountMeta::new(challenger.pubkey(), true),
        AccountMeta::new_readonly(market, false),
        AccountMeta::new(month, false),
        AccountMeta::new(sku, false),
        AccountMeta::new(source, false),
        AccountMeta::new(claim, false),
        AccountMeta::new(
            pda(&[USER_COLLATERAL_PDA_SEED, challenger.pubkey().as_ref()]).0,
            false,
        ),
        AccountMeta::new(challenge, false),
        AccountMeta::new_readonly(system_program::id(), false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 3, &ah), false),
        AccountMeta::new(link(&challenge, 3, &alt), false),
    ];
    let inner = VaultInstruction::ChallengeOracleOpeningClaimV2 {
        params: ChallengeOracleOpeningClaimParams {
            challenge_id: cid,
            alternative_opening_state: 90,
            alternative_source_time: source_time,
            bond: 10,
            canonical_locator_hash: lh,
            source_definition_hash: dh,
            archive_url: String::new(),
        },
    }
    .try_to_vec()
    .unwrap();
    let ix = proof::readonly_instruction(
        &rpc,
        core,
        &[(3, sku_leaf), (4, updated), (4, descriptor)],
        inner,
    )
    .await;
    proof::send(
        &mut rpc,
        &challenger,
        ix,
        "evidence_opening_alternative_maximum_url",
    )
    .unwrap();
    assert_eq!(
        rpc.context
            .get_account(&link(&challenge, 3, &alt))
            .unwrap()
            .data[166],
        3
    );
}
#[allow(clippy::too_many_arguments)]
async fn configure_carry_import(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    _market: Pubkey,
    month: Pubkey,
    expiry: u64,
    source: Pubkey,
    source_id: [u8; 32],
    bucket_id: [u8; 32],
    lh: [u8; 32],
    dh: [u8; 32],
    core: &mut Vec<AccountMeta>,
    inputs: &mut Vec<(u8, bool, CompressedAmebaStateLeaf)>,
) {
    let (parent_market, mb) = pda(&[MARKET_PDA_SEED, &[105; 32]]);
    let parent_expiry = expiry - 100000;
    let (parent_month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        parent_market.as_ref(),
        &parent_expiry.to_le_bytes(),
    ]);
    let (parent_source, sb) = pda(&[ORACLE_SOURCE_PDA_SEED, parent_month.as_ref(), &source_id]);
    let recipe = [106; 32];
    let manifest = [107; 32];
    install(
        rpc,
        parent_market,
        &Market {
            is_initialized: true,
            bump: mb,
            market_id: [105; 32],
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                expiry_ts: parent_expiry,
                ..Default::default()
            },
            ..Default::default()
        },
        Market::LEN,
    );
    install(
        rpc,
        parent_month,
        &OracleMonthState {
            is_initialized: true,
            bump: ob,
            market: parent_market,
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            phase: OraclePhase::Game,
            recipe_hash: recipe,
            weight_manifest_hash: manifest,
            frozen_source_count: 1,
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    let parent = OracleSourceState {
        is_initialized: true,
        bump: sb,
        month: parent_month,
        source_id,
        bucket_id,
        source_type_hash: [104; 32],
        canonical_locator_hash: lh,
        source_definition_hash: dh,
        proposer: payer.pubkey(),
        status: OracleSourceStatus::Active,
        baseline_state: 100,
        current_state: 101,
        observation_count: 2,
        rolling_observation_hash: [109; 32],
        latest_source_time: 1799999000,
        opening_submitted: true,
        opening_evidence_hash: [108; 32],
        ..Default::default()
    };
    let raw = parent.try_to_vec().unwrap();
    let mut compact = raw[34..98].to_vec();
    compact.extend(&raw[194..]);
    let a = proof::leaf(
        CompressedStateDomain::OracleSourceState,
        parent_source,
        compact,
    );
    let b = proof::leaf(
        CompressedStateDomain::OracleSourceDescriptor,
        parent_source,
        raw[98..194].to_vec(),
    );
    proof::seed(rpc, payer, &[a.clone(), b.clone()]).await;
    inputs.push((11, false, a));
    inputs.push((11, false, b));
    let (index, ib) = derive_oracle_recipe_source_index_pda(&program(), &parent_month);
    let (bucket, bb) = derive_oracle_bucket_source_index_pda(&program(), &parent_month, &bucket_id);
    install(
        rpc,
        index,
        &OracleRecipeSourceIndex {
            is_initialized: true,
            bump: ib,
            account_discriminator: OracleRecipeSourceIndex::ACCOUNT_DISCRIMINATOR,
            account_version: OracleRecipeSourceIndex::ACCOUNT_VERSION,
            month: parent_month,
            recipe_hash: recipe,
            manifest_hash: manifest,
            remaining_hash: light_token_minter::processor::initial_oracle_weight_manifest_hash(
                &parent_month,
                1,
                1,
            ),
            expected_source_count: 1,
            expected_bucket_count: 1,
            indexed_bucket_count: 1,
            indexed_bucket_weight_bps: 10000,
            last_bucket_id: bucket_id,
            last_source_id: source_id,
            complete: true,
            ..Default::default()
        },
        OracleRecipeSourceIndex::LEN,
    );
    install(
        rpc,
        bucket,
        &OracleBucketSourceIndex {
            is_initialized: true,
            bump: bb,
            account_discriminator: OracleBucketSourceIndex::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketSourceIndex::ACCOUNT_VERSION,
            month: parent_month,
            recipe_hash: recipe,
            bucket_id,
            bucket_weight_bps: 10000,
            source_count: 1,
            ..Default::default()
        },
        OracleBucketSourceIndex::LEN,
    );
    let (page, pb) = pda(&[
        b"g3-oracle-members-page",
        bucket.as_ref(),
        &0u16.to_le_bytes(),
    ]);
    let mut data = vec![0; 233];
    data[..6].copy_from_slice(&[1, pb, b'O', b'M', b'P', 1]);
    data[6..38].copy_from_slice(bucket.as_ref());
    data[40] = 1;
    data[41..73].copy_from_slice(&source_id);
    rpc.context
        .set_account(page, account(program(), data))
        .unwrap();
    let (period, pb) = pda(&[b"g3-oracle-carry-period", month.as_ref()]);
    let mut data = b"OCP".to_vec();
    data.extend([1, 1, pb]);
    data.extend(month.to_bytes());
    data.extend([0; 32]);
    data.extend(parent_month.to_bytes());
    data.extend(recipe);
    data.extend(expiry.to_le_bytes());
    data.extend(1799000000u64.to_le_bytes());
    data.extend(1u16.to_le_bytes());
    data.extend(0u16.to_le_bytes());
    assert_eq!(data.len(), 154);
    rpc.context
        .set_account(period, account(program(), data))
        .unwrap();
    core.truncate(11);
    core.extend([
        AccountMeta::new(parent_source, false),
        AccountMeta::new_readonly(parent_market, false),
        AccountMeta::new_readonly(parent_month, false),
        AccountMeta::new_readonly(index, false),
        AccountMeta::new_readonly(bucket, false),
        AccountMeta::new(period, false),
        AccountMeta::new(pda(&[b"g3-oracle-carry-source", source.as_ref()]).0, false),
        AccountMeta::new_readonly(page, false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 1, &lh), false),
        AccountMeta::new(link(&source, 0, &lh), false),
        AccountMeta::new_readonly(object(&payer.pubkey(), 2, &dh), false),
        AccountMeta::new(link(&source, 1, &dh), false),
    ]);
}
