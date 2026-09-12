use super::*;

#[test]
fn post_expiry_stale_challenge_cleanup_is_fail_closed_and_not_repeatable() {
    let expiry = 10_000_000u64;
    let scramble_start = expiry - ORACLE_PRE_LISTING_WINDOW_SECONDS;
    let challenge_key = Pubkey::new_unique();
    let challenge_id = [4; 32];
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        pending_resolution_count: 1,
        scramble_start_ts: scramble_start,
        listing_ts: expiry,
        ..OracleMonthState::default()
    };
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 3,
        covered_sku_count: 3,
        coverage_finalized: true,
        coverage_complete_ts: 99,
        ..OracleSkuCoverageManifest::default()
    };
    let mut challenge = OracleSourceChallenge {
        challenge_id,
        source: Pubkey::new_unique(),
        source_id: [5; 32],
        bond: 10,
        required_bond: 10,
        status: OracleChallengeStatus::RuleReview,
        ..OracleSourceChallenge::default()
    };
    let mut guard = OracleSourceChallengeGuard {
        active_challenge: challenge_key,
        active_challenge_id: challenge_id,
        ..OracleSourceChallengeGuard::default()
    };
    cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        None,
        expiry + 1,
        77,
    )
    .unwrap();
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert_eq!(month.pending_resolution_count, 0);
    assert!(!coverage.coverage_finalized);
    assert_eq!(coverage.coverage_complete_ts, 0);
    assert_eq!(coverage.covered_sku_count, 3);
    assert_eq!(challenge.status, OracleChallengeStatus::Cancelled);
    assert_eq!(guard.active_challenge, Pubkey::default());

    let snapshot = (
        month.clone(),
        coverage.clone(),
        challenge.clone(),
        guard.clone(),
    );
    assert!(cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        None,
        expiry + 2,
        78,
    )
    .is_err());
    assert_eq!(snapshot, (month, coverage, challenge, guard));
}

#[test]
fn stale_cleanup_releases_unopened_rule_review_snapshot_lock_once() {
    let expiry = 10_000_000u64;
    let scramble_start = expiry - ORACLE_PRE_LISTING_WINDOW_SECONDS;
    let challenge_key = Pubkey::new_unique();
    let challenge_id = [6; 32];
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        pending_resolution_count: 1,
        scramble_start_ts: scramble_start,
        listing_ts: expiry,
        ..OracleMonthState::default()
    };
    let mut coverage = OracleSkuCoverageManifest {
        coverage_finalized: true,
        coverage_complete_ts: 1,
        ..OracleSkuCoverageManifest::default()
    };
    let mut challenge = OracleSourceChallenge {
        challenge_id,
        source: Pubkey::new_unique(),
        source_id: [7; 32],
        bond: 10,
        required_bond: 10,
        status: OracleChallengeStatus::RuleReviewUnresolved,
        rule_review_slot: 50,
        emergency_snapshot_total_major_tokens: 500,
        emergency_snapshot_version: 2,
        ..OracleSourceChallenge::default()
    };
    let mut guard = OracleSourceChallengeGuard {
        active_challenge: challenge_key,
        active_challenge_id: challenge_id,
        ..OracleSourceChallengeGuard::default()
    };
    let mut pool = OracleStakingPool {
        governance_lock_count: 1,
        samba_supply: 500,
        ..OracleStakingPool::default()
    };
    cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        Some(&mut pool),
        expiry + 1,
        80,
    )
    .unwrap();
    assert_eq!(pool.governance_lock_count, 0);
    assert_eq!(pool.last_updated_slot, 80);
    assert_eq!(challenge.status, OracleChallengeStatus::Cancelled);
    assert!(cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        Some(&mut pool),
        expiry + 2,
        81,
    )
    .is_err());
    assert_eq!(pool.governance_lock_count, 0);
}

#[test]
fn stale_cleanup_accepts_scramble_after_prior_resolution_cleared_coverage() {
    let expiry = 10_000_000u64;
    let scramble_start = expiry - ORACLE_PRE_LISTING_WINDOW_SECONDS;
    let challenge_key = Pubkey::new_unique();
    let challenge_id = [8; 32];
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        pending_resolution_count: 1,
        scramble_start_ts: scramble_start,
        listing_ts: expiry,
        ..OracleMonthState::default()
    };
    let mut coverage = OracleSkuCoverageManifest {
        coverage_finalized: false,
        covered_sku_count: 2,
        required_sku_count: 3,
        ..OracleSkuCoverageManifest::default()
    };
    let mut challenge = OracleSourceChallenge {
        challenge_id,
        source: Pubkey::new_unique(),
        source_id: [9; 32],
        bond: 10,
        required_bond: 10,
        status: OracleChallengeStatus::RuleReview,
        ..OracleSourceChallenge::default()
    };
    let mut guard = OracleSourceChallengeGuard {
        active_challenge: challenge_key,
        active_challenge_id: challenge_id,
        ..OracleSourceChallengeGuard::default()
    };
    cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        None,
        expiry + 1,
        82,
    )
    .unwrap();
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert_eq!(month.pending_resolution_count, 0);
}

#[test]
fn tag191_aborts_keep_source_month_after_latest_safe_without_entering_game() {
    let expiry = 10_000_000u64;
    let latest_safe = oracle_source_submission_latest_safe_ts(expiry).unwrap();
    let coverage_complete = latest_safe - 1;
    let scramble_start = coverage_complete - ORACLE_PLACEMENT_WINDOW_SECONDS;
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        source_count: 1,
        pending_resolution_count: 0,
        scramble_start_ts: scramble_start,
        listing_ts: scramble_start + ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ..OracleMonthState::default()
    };
    let scramble_end = rulebook_schedule_boundaries(&month).unwrap().2;
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 1,
        covered_sku_count: 1,
        coverage_finalized: true,
        coverage_complete_ts: coverage_complete,
        ..OracleSkuCoverageManifest::default()
    };
    let mut source = OracleSourceState {
        status: OracleSourceStatus::Candidate,
        support_stake_total: 100,
        ..OracleSourceState::default()
    };
    let mut record = OracleSkuCoverageRecord {
        active_supported_source_count: 1,
        ..OracleSkuCoverageRecord::default()
    };
    assert_eq!(
        expire_unlistable_oracle_source_state(
            &mut month,
            &mut coverage,
            &mut source,
            Some(&mut record),
            expiry,
            latest_safe - 1,
            1,
        ),
        Err(ProgramError::Custom(
            VaultError::OracleTimingWindowClosed as u32
        ))
    );
    assert_eq!(
        expire_unlistable_oracle_source_state(
            &mut month,
            &mut coverage,
            &mut source,
            Some(&mut record),
            expiry,
            latest_safe,
            2,
        ),
        Err(ProgramError::Custom(
            VaultError::OracleTimingWindowClosed as u32
        ))
    );
    expire_unlistable_oracle_source_state(
        &mut month,
        &mut coverage,
        &mut source,
        Some(&mut record),
        expiry,
        scramble_end,
        3,
    )
    .unwrap();
    assert_eq!(source.status, OracleSourceStatus::TimedOut);
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert_eq!(month.source_count, 0);
    assert_eq!(coverage.covered_sku_count, 0);
    assert!(!coverage.coverage_finalized);
    assert_eq!(record.active_supported_source_count, 0);
}

#[test]
fn promised_shifted_review_window_blocks_tag192_until_effective_scramble_end() {
    let expiry = 20_000_000u64;
    let latest_safe = oracle_source_submission_latest_safe_ts(expiry).unwrap();
    let coverage_complete = latest_safe - 1;
    let scramble_start = coverage_complete - ORACLE_PLACEMENT_WINDOW_SECONDS;
    let challenge_key = Pubkey::new_unique();
    let challenge_id = [10; 32];
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        pending_resolution_count: 1,
        scramble_start_ts: scramble_start,
        listing_ts: scramble_start + ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ..OracleMonthState::default()
    };
    let scramble_end = rulebook_schedule_boundaries(&month).unwrap().2;
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 1,
        covered_sku_count: 1,
        coverage_finalized: true,
        coverage_complete_ts: coverage_complete,
        ..OracleSkuCoverageManifest::default()
    };
    let mut challenge = OracleSourceChallenge {
        challenge_id,
        source: Pubkey::new_unique(),
        source_id: [11; 32],
        bond: 10,
        required_bond: 10,
        status: OracleChallengeStatus::RuleReview,
        ..OracleSourceChallenge::default()
    };
    let mut guard = OracleSourceChallengeGuard {
        active_challenge: challenge_key,
        active_challenge_id: challenge_id,
        ..OracleSourceChallengeGuard::default()
    };
    let snapshot = (
        month.clone(),
        coverage.clone(),
        challenge.clone(),
        guard.clone(),
    );
    assert!(cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        None,
        latest_safe,
        90,
    )
    .is_err());
    assert_eq!(
        snapshot,
        (
            month.clone(),
            coverage.clone(),
            challenge.clone(),
            guard.clone()
        )
    );

    cancel_stale_oracle_source_challenge_state(
        &mut month,
        &mut coverage,
        &challenge_key,
        &mut challenge,
        &mut guard,
        None,
        None,
        scramble_end,
        91,
    )
    .unwrap();
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert_eq!(month.pending_resolution_count, 0);
    assert!(!coverage.coverage_finalized);
    assert_eq!(challenge.status, OracleChallengeStatus::Cancelled);
}

#[test]
fn tag186_reopens_finalized_full_coverage_only_after_effective_scramble_end() {
    let scramble_start = 3_000_000u64;
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        scramble_start_ts: scramble_start,
        listing_ts: scramble_start + ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ..OracleMonthState::default()
    };
    let scramble_end = rulebook_schedule_boundaries(&month).unwrap().2;
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 2,
        covered_sku_count: 2,
        coverage_finalized: true,
        coverage_complete_ts: scramble_start + ORACLE_PLACEMENT_WINDOW_SECONDS,
        ..OracleSkuCoverageManifest::default()
    };
    let snapshot = (month.clone(), coverage.clone());
    assert!(
        reopen_oracle_sku_coverage_state(&mut month, &mut coverage, scramble_end - 1, 100,)
            .is_err()
    );
    assert_eq!(snapshot, (month.clone(), coverage.clone()));

    reopen_oracle_sku_coverage_state(&mut month, &mut coverage, scramble_end, 101).unwrap();
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert!(!coverage.coverage_finalized);
    assert_eq!(coverage.coverage_complete_ts, 0);
}

#[test]
fn delayed_tag193_keep_source_reopens_coverage_for_a_fresh_schedule() {
    let scramble_start = 4_000_000u64;
    let mut month = OracleMonthState {
        phase: OraclePhase::Scramble,
        scramble_start_ts: scramble_start,
        listing_ts: scramble_start + ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ..OracleMonthState::default()
    };
    let scramble_end = rulebook_schedule_boundaries(&month).unwrap().2;
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 1,
        covered_sku_count: 1,
        coverage_finalized: true,
        coverage_complete_ts: scramble_start + ORACLE_PLACEMENT_WINDOW_SECONDS,
        ..OracleSkuCoverageManifest::default()
    };
    oracle_samba_pot::reopen_coverage_after_delayed_emergency_resolution(
        &mut month,
        &mut coverage,
        scramble_end - 1,
    )
    .unwrap();
    assert_eq!(month.phase, OraclePhase::Scramble);
    assert!(coverage.coverage_finalized);

    oracle_samba_pot::reopen_coverage_after_delayed_emergency_resolution(
        &mut month,
        &mut coverage,
        scramble_end,
    )
    .unwrap();
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert!(!coverage.coverage_finalized);
    assert_eq!(coverage.coverage_complete_ts, 0);
}

#[test]
fn v5_source_emergency_resolution_requires_tag193_but_other_kinds_use_tag178() {
    let v5 = OracleMonthState {
        ..OracleMonthState::default()
    };
    assert!(oracle_samba_pot::ensure_emergency_resolver_coverage_lane(
        &v5,
        OracleEmergencyDisputeKind::Source,
        false
    )
    .is_err());
    assert_eq!(
        oracle_samba_pot::ensure_emergency_resolver_coverage_lane(
            &v5,
            OracleEmergencyDisputeKind::Source,
            true
        ),
        Ok(())
    );
    for kind in [
        OracleEmergencyDisputeKind::Update,
        OracleEmergencyDisputeKind::Opening,
    ] {
        assert_eq!(
            oracle_samba_pot::ensure_emergency_resolver_coverage_lane(&v5, kind, false),
            Ok(())
        );
        assert!(
            oracle_samba_pot::ensure_emergency_resolver_coverage_lane(&v5, kind, true).is_err()
        );
    }
}

#[test]
fn tag193_removes_sku_coverage_only_for_the_first_contributing_terminalization() {
    let mut month = OracleMonthState {
        source_count: 1,
        ..OracleMonthState::default()
    };
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 1,
        covered_sku_count: 1,
        coverage_finalized: true,
        coverage_complete_ts: 10,
        ..OracleSkuCoverageManifest::default()
    };
    let mut record = OracleSkuCoverageRecord {
        active_supported_source_count: 1,
        ..OracleSkuCoverageRecord::default()
    };
    assert_eq!(
        oracle_samba_pot::remove_emergency_supported_candidate_coverage(
            &mut month,
            Some(&mut coverage),
            Some(&mut record),
            true,
        ),
        Ok(true)
    );
    assert_eq!(month.source_count, 0);
    assert_eq!(coverage.covered_sku_count, 0);
    assert!(!coverage.coverage_finalized);
    assert_eq!(record.active_supported_source_count, 0);

    assert_eq!(
        oracle_samba_pot::remove_emergency_supported_candidate_coverage(
            &mut month,
            Some(&mut coverage),
            Some(&mut record),
            false,
        ),
        Ok(false)
    );
    assert_eq!(month.source_count, 0);
    assert_eq!(coverage.covered_sku_count, 0);
    assert_eq!(record.active_supported_source_count, 0);
}
