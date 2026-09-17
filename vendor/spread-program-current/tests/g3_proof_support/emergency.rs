use super::proof;
use crate::g3_light_support::*;
use borsh::{BorshDeserialize, BorshSerialize};
use light_program_test::Rpc;
use light_token_minter::error::VaultError;
use light_token_minter::{constants::*, state::*};
use light_token_minter::{
    governance_gate::*,
    instruction::{OracleCarryForwardActionV1, OracleCouncilActionV1, VaultInstruction},
    processor::{CouncilCase, CouncilRound},
};
use solana_program::hash::hashv;
use solana_sdk::{clock::Clock, instruction::AccountMeta, pubkey::Pubkey};
use solana_sdk::{instruction::InstructionError, transaction::TransactionError};
use solana_system_interface::program as system_program;

#[tokio::test]
async fn actual_sbf_emergency_compressed_checkpoint_and_rollback() {
    run_emergency(false, 1).await;
}

#[tokio::test]
async fn actual_sbf_keep_prior_preserves_history_after_expiry_grace() {
    run_emergency(true, 1).await;
}

#[tokio::test]
async fn actual_sbf_33rd_observation_preserves_first_page() {
    run_emergency(false, 32).await;
}

async fn run_emergency(keep_prior: bool, history_count: u32) {
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let program = program();
    let market_id = [51; 32];
    let (market_key, market_bump) = pda(&[MARKET_PDA_SEED, &market_id]);
    let (month_key, month_bump) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market_key.as_ref(),
        &100_000u64.to_le_bytes(),
    ]);
    install(
        &mut rpc,
        market_key,
        &Market {
            is_initialized: true,
            bump: market_bump,
            market_id,
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                expiry_ts: 100_000,
                ..Default::default()
            },
            ..Default::default()
        },
        Market::LEN,
    );
    let source_id = [31; 32];
    let claim_id = [32; 32];
    let challenge_id = [33; 32];
    let bucket_id = [35; 32];
    let contributor = Pubkey::new_unique();
    let (source_key, sb) = pda(&[ORACLE_SOURCE_PDA_SEED, month_key.as_ref(), &source_id]);
    let (obs_key, ob) = pda(&[ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, source_key.as_ref()]);
    let (claim_key, cb) = derive_oracle_update_claim_v2_pda(
        &program,
        &month_key,
        &source_key,
        &contributor,
        &claim_id,
    );
    let (challenge_key, hb) = pda(&[
        ORACLE_UPDATE_CHALLENGE_PDA_SEED,
        month_key.as_ref(),
        claim_key.as_ref(),
        &challenge_id,
    ]);
    let (guard_key, gb) =
        derive_oracle_update_challenge_guard_pda(&program, &month_key, &claim_key);
    let (dispute_key, case_bump) = pda(&[
        b"g3-council-case-v1",
        month_key.as_ref(),
        challenge_key.as_ref(),
    ]);
    let (manifest_key, mb) = derive_oracle_active_weight_manifest_pda(&program, &month_key);
    let (bucket_key, bb) = derive_oracle_bucket_median_pda(&program, &month_key, &bucket_id);
    let journal_key = pda(&[b"g3-oracle-knowledge", source_key.as_ref()]).0;
    let checkpoint_key = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-oracle-checkpoint",
            source_key.as_ref(),
            dispute_key.as_ref(),
        ],
        &program,
    )
    .0;

    let month = OracleMonthState {
        bump: month_bump,
        market: market_key,
        account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
        account_version: OracleMonthState::ACCOUNT_VERSION,
        is_initialized: true,
        phase: OraclePhase::Game,
        pending_resolution_count: 1,
        recipe_hash: [36; 32],
        frozen_source_count: 1,
        opening_resolved_source_count: 1,
        opened_source_count: 1,
        weight_scheme_version: 1,
        effective_weight_total_bps: 10_000,
        weight_manifest_hash: [37; 32],
        active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
        active_weight_group_count: 1,
        active_weight_manifest_hash: [38; 32],
        ..Default::default()
    };
    let source = OracleSourceState {
        proposer: contributor,
        is_initialized: true,
        bump: sb,
        month: month_key,
        source_id,
        bucket_id,
        status: OracleSourceStatus::Active,
        opening_submitted: true,
        baseline_state: 100,
        current_state: 100,
        observation_count: history_count,
        latest_source_time: 100,
        rolling_observation_hash: [39; 32],
        last_finalized_step: 1,
        ..Default::default()
    };
    let mut observations = OracleSourceObservations {
        is_initialized: true,
        bump: ob,
        account_discriminator: OracleSourceObservations::ACCOUNT_DISCRIMINATOR,
        account_version: OracleSourceObservations::ACCOUNT_VERSION,
        month: month_key,
        source: source_key,
        ..Default::default()
    };
    for i in 0..history_count.min(32) as usize {
        observations.states[i] = 100;
        observations.source_times[i] = 100 - u64::from(history_count) + i as u64 + 1;
    }

    let earliest = 1 + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS;
    let claim = OracleUpdateClaimV2 {
        claim: OracleUpdateClaimData {
            is_initialized: true,
            bump: cb,
            month: month_key,
            claim_id,
            source: source_key,
            source_id,
            claimant: contributor,
            prior_state: 100,
            new_state: 110,
            source_time: 200,
            stake: 1,
            status: OracleClaimStatus::Revealed,
            evidence_hash: [40; 32],
            archive_url_hash: [41; 32],
            account_discriminator: OracleUpdateClaimV2::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUpdateClaimV2::ACCOUNT_VERSION,
            ..Default::default()
        },
        commit_hash: [42; 32],
        commit_slot: 1,
        earliest_reveal_slot: earliest,
        reveal_deadline_slot: earliest + ORACLE_UPDATE_REVEAL_WINDOW_SLOTS,
        revealed_slot: earliest,
        council_review_pending: true,
        freshness_reward_multiplier: 1,
        revealed_at_ts: 200,
        prior_finalized_step: source.last_finalized_step,
    };
    let challenge = OracleUpdateChallenge {
        status: OracleChallengeStatus::RuleReviewUnresolved,
        council_authority_version: 1,
        rule_review_slot: 10,
        is_initialized: true,
        bump: hb,
        month: month_key,
        challenge_id,
        claim: claim_key,
        claim_id,
        challenger: Pubkey::new_unique(),
        alternative_state: if keep_prior { 100 } else { 120 },
        alternative_source_time: 200,
        bond: 1,
        required_bond: 1,
        evidence_hash: [43; 32],
        archive_url_hash: [44; 32],
        account_discriminator: OracleUpdateChallenge::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUpdateChallenge::ACCOUNT_VERSION,
        ..Default::default()
    };
    let guard = OracleUpdateChallengeGuard {
        is_initialized: true,
        bump: gb,
        account_discriminator: OracleUpdateChallengeGuard::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUpdateChallengeGuard::ACCOUNT_VERSION,
        month: month_key,
        claim: claim_key,
        claim_id,
        challenge: challenge_key,
        challenge_id,
        active_dispute: dispute_key,
        resolution_step: 2,
        created_slot: 1,
        ..Default::default()
    };
    let manifest = OracleActiveWeightManifest {
        is_initialized: true,
        bump: mb,
        account_discriminator: OracleActiveWeightManifest::ACCOUNT_DISCRIMINATOR,
        account_version: OracleActiveWeightManifest::ACCOUNT_VERSION,
        month: month_key,
        phase: OracleRecipeWeightPhase::Finalized,
        expected_source_count: 1,
        processed_source_count: 1,
        expected_group_count: 1,
        processed_group_count: 1,
        processed_bucket_weight_bps: 10_000,
        rolling_manifest_hash: month.active_weight_manifest_hash,
        ..Default::default()
    };
    let bucket = OracleBucketMedianState {
        is_initialized: true,
        bump: bb,
        account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
        account_version: OracleBucketMedianState::ACCOUNT_VERSION,
        month: month_key,
        bucket_id,
        bucket_weight_bps: 10_000,
        frozen_source_count: 1,
        active_source_count: 1,
        status: OracleBucketMedianStatus::Live,
        ..Default::default()
    };

    // Prepared adjudication fixture, separate from the actual-controller lifecycle test.
    // This fixture qualifies the production compressed apply path and its rollback.
    let mut config = vec![0u8; 384];
    config[..8].copy_from_slice(b"AG3CFG01");
    config[8] = 1;
    config[9] = Pubkey::find_program_address(
        &[b"ameba-governance-v3", b"council"],
        &PINNED_CONTROLLER_PROGRAM_ID,
    )
    .1;
    config[10] = 1;
    config[11..43].copy_from_slice(PINNED_CONTROLLER_PROGRAM_ID.as_ref());
    config[43..75].copy_from_slice(
        Pubkey::find_program_address(
            &[PINNED_CONTROLLER_PROGRAM_ID.as_ref()],
            &solana_sdk::bpf_loader_upgradeable::id(),
        )
        .0
        .as_ref(),
    );
    config[75..107].copy_from_slice(
        Pubkey::find_program_address(
            &[b"ameba-governance-v3", b"authority"],
            &PINNED_CONTROLLER_PROGRAM_ID,
        )
        .0
        .as_ref(),
    );
    config[107..139].copy_from_slice(Pubkey::new_unique().as_ref());
    for i in 0..5 {
        config[139 + i * 32..171 + i * 32].copy_from_slice(Pubkey::new_unique().as_ref());
    }
    for (offset, value) in [
        (299, 1u64),
        (307, 1),
        (315, 1_512_000),
        (323, 4_500),
        (331, 2_000_000),
        (339, 1),
    ] {
        config[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
    let seats_hash = hashv(&[b"amoeba-council-seats-v1", &config[139..299]]).to_bytes();
    rpc.context
        .set_account(
            PINNED_CONTROLLER_CONFIG_PDA,
            account(PINNED_CONTROLLER_PROGRAM_ID, config),
        )
        .unwrap();
    let mut evidence_bytes = challenge.try_to_vec().unwrap();
    evidence_bytes.resize(OracleUpdateChallenge::LEN, 0);
    let evidence = hashv(&[
        b"amoeba-council-evidence-v1",
        challenge_key.as_ref(),
        &evidence_bytes,
    ])
    .to_bytes();
    let mut dispute = CouncilCase {
        discriminator: *b"OCC",
        version: 1,
        initialized: true,
        bump: case_bump,
        month: month_key,
        target: challenge_key,
        target_id: challenge_id,
        case_hash: [0; 32],
        evidence_hash: evidence,
        kind: OracleEmergencyDisputeKind::Update,
        choices: 3,
        fallback: 2,
        snapshot_slot: 10,
        opened_slot: 10,
        deadline: 30,
        finalized: false,
        outcome: 2,
        reason: 0,
        decision_epoch: 0,
        seat_mask: 0,
        resolved_slot: 0,
    };
    #[cfg(feature = "mainnet-v3")]
    let scope = b"solana-mainnet-beta:council-oracle-v1".as_slice();
    #[cfg(not(feature = "mainnet-v3"))]
    let scope = b"solana-devnet:council-oracle-v1".as_slice();
    dispute.case_hash = hashv(&[
        b"amoeba-council-case-v1",
        scope,
        program.as_ref(),
        PINNED_CONTROLLER_CONFIG_PDA.as_ref(),
        month_key.as_ref(),
        challenge_key.as_ref(),
        &challenge_id,
        &[1, 3, 2],
        &evidence,
        &10u64.to_le_bytes(),
        &10u64.to_le_bytes(),
        &30u64.to_le_bytes(),
    ])
    .to_bytes();
    let (round_key, round_bump) = pda(&[
        b"g3-council-round-v1",
        dispute_key.as_ref(),
        &1u64.to_le_bytes(),
    ]);
    let choice = if keep_prior { 1 } else { 0 };
    let round = CouncilRound {
        discriminator: *b"OCR",
        version: 1,
        initialized: true,
        bump: round_bump,
        case: dispute_key,
        epoch: 1,
        seats_hash,
        ballots: [choice, choice, choice, 255, 255],
    };
    install(&mut rpc, round_key, &round, CouncilRound::LEN);
    let inner = VaultInstruction::OracleCarryForwardV1 {
        action: OracleCarryForwardActionV1::Council(OracleCouncilActionV1 {
            operation: 2,
            kind: OracleEmergencyDisputeKind::Update,
            target_id: challenge_id,
            expected_case_hash: dispute.case_hash,
            expected_epoch: 1,
            expected_seats_hash: seats_hash,
            choice: 0,
        }),
    }
    .try_to_vec()
    .unwrap();
    install(&mut rpc, month_key, &month, OracleMonthState::LEN);
    install(&mut rpc, claim_key, &claim, OracleUpdateClaimV2::LEN);
    install(
        &mut rpc,
        challenge_key,
        &challenge,
        OracleUpdateChallenge::LEN,
    );
    install(&mut rpc, guard_key, &guard, OracleUpdateChallengeGuard::LEN);
    install(
        &mut rpc,
        manifest_key,
        &manifest,
        OracleActiveWeightManifest::LEN,
    );
    install(&mut rpc, bucket_key, &bucket, OracleBucketMedianState::LEN);
    install(&mut rpc, dispute_key, &dispute, CouncilCase::LEN);
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.slot = 100_000;
    clock.unix_timestamp = 100_000 + ORACLE_SETTLEMENT_GRACE_SECONDS as i64 + 1;
    rpc.context.set_sysvar(&clock);
    let mut source_bytes = vec![];
    source.source_id.serialize(&mut source_bytes).unwrap();
    source.bucket_id.serialize(&mut source_bytes).unwrap();
    source.proposer.serialize(&mut source_bytes).unwrap();
    source.baseline_state.serialize(&mut source_bytes).unwrap();
    source.current_state.serialize(&mut source_bytes).unwrap();
    source
        .listing_bond_locked
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .support_stake_total
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .bucket_weight_bps
        .serialize(&mut source_bytes)
        .unwrap();
    source.status.serialize(&mut source_bytes).unwrap();
    source
        .opening_submitted
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .opening_evidence_hash
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .last_finalized_step
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .observation_count
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .latest_source_time
        .serialize(&mut source_bytes)
        .unwrap();
    source
        .rolling_observation_hash
        .serialize(&mut source_bytes)
        .unwrap();

    let mut journal_bytes = vec![];
    journal_bytes.extend_from_slice(b"OKJ");
    journal_bytes.extend_from_slice(&[2, 1, pda(&[b"g3-oracle-knowledge", source_key.as_ref()]).1]);
    journal_bytes.extend_from_slice(source_key.as_ref());
    let previous_checkpoint = Pubkey::new_unique();
    journal_bytes.extend_from_slice(previous_checkpoint.as_ref());
    journal_bytes.extend_from_slice(&source.rolling_observation_hash);
    journal_bytes.extend_from_slice(&history_count.to_le_bytes());
    journal_bytes.extend_from_slice(&history_count.to_le_bytes());
    let inputs = vec![
        proof::leaf(
            CompressedStateDomain::OracleSourceState,
            source_key,
            source_bytes,
        ),
        proof::leaf(
            CompressedStateDomain::OracleSourceObservations,
            obs_key,
            observations.try_to_vec().unwrap(),
        ),
        proof::leaf(
            CompressedStateDomain::OracleCarryJournal,
            journal_key,
            journal_bytes,
        ),
    ];
    proof::seed(&mut rpc, &payer, &inputs).await;
    let core_keys = [
        payer.pubkey(),
        market_key,
        month_key,
        dispute_key,
        challenge_key,
        PINNED_CONTROLLER_CONFIG_PDA,
        round_key,
        system_program::id(),
        claim_key,
        source_key,
        obs_key,
        manifest_key,
        guard_key,
        bucket_key,
        journal_key,
        checkpoint_key,
        system_program::id(),
    ];
    let core: Vec<_> = core_keys
        .iter()
        .take(if keep_prior { 14 } else { 17 })
        .enumerate()
        .map(|(i, k)| {
            if matches!(i, 1 | 5 | 7 | 11 | 16) {
                AccountMeta::new_readonly(*k, false)
            } else {
                AccountMeta::new(*k, i == 0)
            }
        })
        .collect();
    let ix = proof::emergency_instruction(
        &rpc,
        core,
        &inputs[..if keep_prior { 2 } else { 3 }],
        checkpoint_key,
        inner,
    )
    .await;
    let mut guarded = ix
        .accounts
        .iter()
        .filter(|m| m.pubkey != payer.pubkey())
        .map(|m| m.pubkey)
        .collect::<Vec<_>>();
    guarded.sort();
    guarded.dedup();
    let before = proof::snapshot(&rpc, &guarded);
    let initial_context = rpc.context.clone();
    if keep_prior {
        let journal_before = proof::read(&rpc, &inputs[2]).await;
        proof::send(&mut rpc, &payer, ix.clone(), "keep-prior-after-grace").unwrap();
        let after = proof::read(&rpc, &inputs[0]).await;
        let history = proof::read(&rpc, &inputs[1]).await;
        assert_eq!(
            u64::from_le_bytes(after.data[104..112].try_into().unwrap()),
            100
        );
        assert_eq!(after.data[172], 1);
        assert_eq!(history.data, inputs[1].data);
        assert_eq!(proof::read(&rpc, &inputs[2]).await, journal_before);
        assert!(rpc.context.get_account(&checkpoint_key).is_none());
        let claim_after = OracleUpdateClaimV2::deserialize(
            &mut &rpc.context.get_account(&claim_key).unwrap().data[..],
        )
        .unwrap();
        let challenge_after = OracleUpdateChallenge::deserialize(
            &mut &rpc.context.get_account(&challenge_key).unwrap().data[..],
        )
        .unwrap();
        let month_after = OracleMonthState::deserialize(
            &mut &rpc.context.get_account(&month_key).unwrap().data[..],
        )
        .unwrap();
        assert_eq!(claim_after.claim.status, OracleClaimStatus::Rejected);
        assert!(!claim_after.council_review_pending);
        assert_eq!(challenge_after.status, OracleChallengeStatus::Accepted);
        assert_eq!(month_after.pending_resolution_count, 0);
        assert_eq!(month_after.accepted_cash_update_count, 0);
        let completed = proof::snapshot(&rpc, &guarded);
        proof::send(&mut rpc, &payer, ix, "keep-prior-replay").unwrap_err();
        assert_eq!(proof::snapshot(&rpc, &guarded), completed);
        return;
    }
    // Keep the outer materialization System account intact. Only the inner
    // checkpoint helper's System account is wrong, so failure occurs after
    // applying the accepted source update, before the atomic transaction commits.
    let mut late_checkpoint_failure = ix.clone();
    late_checkpoint_failure.accounts[16].pubkey = Pubkey::new_unique();
    let error = proof::send(
        &mut rpc,
        &payer,
        late_checkpoint_failure,
        "emergency_late_checkpoint_failure",
    )
    .unwrap_err();
    println!("late checkpoint error={error:?}");
    assert_eq!(
        error,
        TransactionError::InstructionError(
            1,
            InstructionError::Custom(VaultError::InvalidSystemProgram as u32)
        )
    );
    assert_eq!(proof::snapshot(&rpc, &guarded), before);
    let mut wrong_checkpoint = ix.clone();
    wrong_checkpoint.accounts[15].pubkey = Pubkey::new_unique();
    let checkpoint_error = proof::send(
        &mut rpc,
        &payer,
        wrong_checkpoint,
        "emergency_wrong_checkpoint",
    )
    .unwrap_err();
    assert_eq!(proof::snapshot(&rpc, &guarded), before);
    println!("checkpoint error={checkpoint_error:?}");
    assert_eq!(
        checkpoint_error,
        TransactionError::InstructionError(
            1,
            InstructionError::Custom(VaultError::InvalidOracleState as u32)
        )
    );
    let mut bad_proof = ix.clone();
    assert_eq!(bad_proof.data[3], 1);
    bad_proof.data[4] ^= 1;
    let proof_error =
        proof::send(&mut rpc, &payer, bad_proof, "emergency_corrupt_proof").unwrap_err();
    assert_eq!(proof::snapshot(&rpc, &guarded), before);
    println!("proof error={proof_error:?}");
    assert_eq!(
        proof_error,
        TransactionError::InstructionError(1, InstructionError::Custom(6043))
    );
    proof::send(&mut rpc, &payer, ix.clone(), "emergency_checkpoint_success").unwrap();
    let source_after = proof::read(&rpc, &inputs[0]).await;
    assert_eq!(source_after.revision, 1);
    assert_eq!(
        u64::from_le_bytes(source_after.data[104..112].try_into().unwrap()),
        110
    );
    assert_eq!(
        u32::from_le_bytes(source_after.data[172..176].try_into().unwrap()),
        history_count + 1
    );
    let observations_after = proof::read(&rpc, &inputs[1]).await;
    assert_eq!(observations_after.revision, 1);
    assert_eq!(
        u64::from_le_bytes(observations_after.data[78..86].try_into().unwrap()),
        if history_count == 1 { 110 } else { 100 }
    );
    let journal_after = proof::read(&rpc, &inputs[2]).await;
    assert_eq!(journal_after.revision, 1);
    assert_eq!(&journal_after.data[38..70], checkpoint_key.as_ref());
    assert_eq!(
        u32::from_le_bytes(journal_after.data[102..106].try_into().unwrap()),
        history_count + 1
    );
    let checkpoint_template = proof::leaf(
        CompressedStateDomain::OracleCarryCheckpoint,
        checkpoint_key,
        vec![0; CompressedStateDomain::OracleCarryCheckpoint.compact_data_len()],
    );
    let checkpoint = proof::read(&rpc, &checkpoint_template).await;
    assert_eq!(checkpoint.revision, 0);
    assert_eq!(&checkpoint.data[70..102], dispute_key.as_ref());
    assert_eq!(&checkpoint.data[102..134], previous_checkpoint.as_ref());
    assert_eq!(
        u64::from_le_bytes(checkpoint.data[146..154].try_into().unwrap()),
        110
    );
    for key in [source_key, obs_key, journal_key, checkpoint_key] {
        assert!(
            rpc.context
                .get_account(&key)
                .is_none_or(|a| a.lamports == 0 && a.data.is_empty()),
            "temporary account remains {key}"
        );
    }
    let stored = |key| rpc.context.get_account(&key).unwrap().data;
    assert_eq!(
        CouncilCase::deserialize(&mut &stored(dispute_key)[..])
            .unwrap()
            .outcome,
        0
    );
    assert_eq!(
        OracleUpdateClaimV2::deserialize(&mut &stored(claim_key)[..])
            .unwrap()
            .claim
            .status,
        OracleClaimStatus::Finalized
    );
    let completed = proof::snapshot(&rpc, &guarded);
    proof::send(&mut rpc, &payer, ix.clone(), "emergency_duplicate_replay").unwrap_err();
    assert_eq!(proof::snapshot(&rpc, &guarded), completed);
    // Isolate stale proof admission from already-finalized business status in a
    // local fixture fork. Keep actual Light trees at their advanced state.
    let final_context = rpc.context.clone();
    for key in [
        month_key,
        dispute_key,
        challenge_key,
        round_key,
        claim_key,
        guard_key,
        bucket_key,
    ] {
        rpc.context
            .set_account(key, initial_context.get_account(&key).unwrap())
            .unwrap();
    }
    let fork_before = proof::snapshot(&rpc, &guarded);
    let stale = proof::send(&mut rpc, &payer, ix, "emergency_consumed_proof_replay").unwrap_err();
    assert_eq!(proof::snapshot(&rpc, &guarded), fork_before);
    println!("consumed-proof error={stale:?}");
    assert_eq!(
        stale,
        TransactionError::InstructionError(1, InstructionError::Custom(14307))
    );
    rpc.context = final_context;
}
