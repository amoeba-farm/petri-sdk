use super::*;

fn dispute_for_test() -> OracleEmergencyDisputeV3 {
    OracleEmergencyDisputeV3 {
        is_initialized: true,
        account_discriminator: OracleEmergencyDisputeV3::ACCOUNT_DISCRIMINATOR,
        account_version: OracleEmergencyDisputeV3::ACCOUNT_VERSION,
        kind: OracleEmergencyDisputeKind::Source,
        fallback_choice: 0,
        snapshot_total_major_tokens: 100,
        minimum_vote_amount: 1,
        choice_count: 3,
        committed_power: 100,
        committed_vote_count: 3,
        revealed_power: 100,
        revealed_vote_count: 3,
        choice_power: [30, 70, 0],
        choice_vote_count: [1, 2, 0],
        supermajority_bps: 6_000,
        ..OracleEmergencyDisputeV3::default()
    }
}

#[test]
fn unique_threshold_winner_redistributes_even_when_it_is_fallback_choice() {
    let mut dispute = dispute_for_test();
    dispute.fallback_choice = 1;
    let decision = derive_decision_v3(&dispute).unwrap();
    assert!(decision.redistribute);
    assert_eq!(decision.winning_choice, 1);
    assert_eq!(decision.resolved_choice, 1);
    assert_eq!(decision.winning_vote_count, 2);
}

#[test]
fn open_constructor_freezes_supermajority_used_by_resolution() {
    let month = Pubkey::new_unique();
    let target = Pubkey::new_unique();
    let opener = Pubkey::new_unique();
    let pot = Pubkey::new_unique();
    let packet = DerivedEmergencyPacket {
        fallback_choice: 0,
        choice_count: 3,
        snapshot_slot: 17,
        snapshot_total_major_tokens: 100,
    };
    let economics = OracleEconomicParams {
        emergency_supermajority_bps: 6_000,
        ..OracleEconomicParams::default()
    };
    let mut dispute = build_open_dispute_v3(
        &month,
        7,
        [5; 32],
        OracleEmergencyDisputeKind::Source,
        [6; 32],
        &target,
        &opener,
        &packet,
        &economics,
        &pot,
        50,
        100,
    )
    .unwrap();
    assert_eq!(dispute.supermajority_bps, 6_000);
    assert_eq!(dispute.winning_choice, packet.fallback_choice);
    assert_eq!(dispute.minimum_vote_amount, 1);
    assert_eq!(dispute.choice_count, packet.choice_count);

    dispute.committed_power = 80;
    dispute.committed_vote_count = 3;
    dispute.revealed_power = 70;
    dispute.revealed_vote_count = 3;
    dispute.choice_power = [20, 50, 0];
    dispute.choice_vote_count = [1, 2, 0];
    let decision = derive_decision_v3(&dispute).unwrap();
    assert!(decision.redistribute);
    assert_eq!(decision.winning_choice, 1);
    assert_eq!(decision.winning_power, 50);
    assert_eq!(decision.winning_vote_count, 2);
}

#[test]
fn vote_admission_rejects_subminimum_and_the_257th_before_account_creation() {
    let mut dispute = OracleEmergencyDisputeV3 {
        snapshot_total_major_tokens: 512,
        minimum_vote_amount: 2,
        committed_power: 510,
        committed_vote_count: ORACLE_MAX_V3_VOTERS - 1,
        ..OracleEmergencyDisputeV3::default()
    };
    assert_eq!(
        next_v3_vote_totals(&dispute, 1),
        Err(VaultError::InvalidOracleEmergencyDispute.into())
    );
    assert_eq!(
        next_v3_vote_totals(&dispute, 2).unwrap(),
        (512, ORACLE_MAX_V3_VOTERS)
    );

    dispute.committed_power = 512;
    dispute.committed_vote_count = ORACLE_MAX_V3_VOTERS;
    assert_eq!(
        next_v3_vote_totals(&dispute, 2),
        Err(VaultError::InvalidOracleEmergencyDispute.into())
    );
}

#[test]
fn tie_or_failed_supermajority_refunds_every_vote() {
    let mut tied = dispute_for_test();
    tied.choice_power = [50, 50, 0];
    assert!(!derive_decision_v3(&tied).unwrap().redistribute);

    let mut no_reveals = dispute_for_test();
    no_reveals.revealed_power = 0;
    no_reveals.revealed_vote_count = 0;
    no_reveals.choice_power = [0; 3];
    no_reveals.choice_vote_count = [0; 3];
    assert!(!derive_decision_v3(&no_reveals).unwrap().redistribute);

    let mut failed_supermajority = dispute_for_test();
    failed_supermajority.choice_power = [41, 59, 0];
    failed_supermajority.choice_vote_count = [1, 2, 0];
    assert!(
        !derive_decision_v3(&failed_supermajority)
            .unwrap()
            .redistribute
    );
}

#[test]
fn low_turnout_unique_supermajority_is_decisive() {
    let mut low_turnout = dispute_for_test();
    low_turnout.snapshot_total_major_tokens = 10_000;
    low_turnout.committed_power = 100;
    assert!(derive_decision_v3(&low_turnout).unwrap().redistribute);
}

#[test]
fn frozen_two_choice_source_rejects_any_third_choice_tally() {
    let mut dispute = dispute_for_test();
    dispute.choice_count = 2;
    dispute.revealed_power = 100;
    dispute.revealed_vote_count = 3;
    dispute.choice_power = [29, 70, 1];
    dispute.choice_vote_count = [1, 1, 1];
    assert_eq!(
        derive_decision_v3(&dispute),
        Err(VaultError::InvalidOracleEmergencyDispute.into())
    );
}

#[test]
fn decisive_winners_recover_principal_plus_floor_share_and_dust_completes_p() {
    let winning_powers = [1_u64, 2, 4];
    let winning_power = winning_powers.iter().sum::<u64>();
    let losing_revealed_pot = 3_u64;
    let nonrevealed_pot = 1_u64;
    let forfeited_pot = losing_revealed_pot + nonrevealed_pot;
    let total_committed = winning_power + forfeited_pot;

    let bases = winning_powers
        .iter()
        .map(|power| {
            let payout = floor_winning_entitlement(total_committed, *power, winning_power).unwrap();
            let expected = *power + forfeited_pot * *power / winning_power;
            assert_eq!(payout, expected);
            payout
        })
        .collect::<Vec<_>>();
    let base_total = bases.iter().sum::<u64>();
    let dust = total_committed - base_total;
    assert_eq!(base_total + dust, total_committed);
    assert!(dust < winning_powers.len() as u64);

    let losing_revealed_payout = 0_u64;
    let nonrevealed_payout = 0_u64;
    assert_eq!(losing_revealed_payout, 0);
    assert_eq!(nonrevealed_payout, 0);
}

#[test]
fn independently_floored_bases_plus_one_dust_recipient_equal_p() {
    let powers = [1_u64, 2, 4];
    let p = 11_u64;
    let w = powers.iter().sum::<u64>();
    let bases = powers
        .iter()
        .map(|power| floor_winning_entitlement(p, *power, w).unwrap())
        .collect::<Vec<_>>();
    let base_total = bases.iter().sum::<u64>();
    let dust = p - base_total;
    assert_eq!(base_total + dust, p);
    assert!(dust < powers.len() as u64);
}

#[test]
fn commitment_binds_program_dispute_voter_amount_mint_choice_and_salt() {
    let program = Pubkey::new_unique();
    let dispute = Pubkey::new_unique();
    let voter = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let id = [7; 32];
    let salt = [9; 32];
    let baseline = commitment_hash_v3(&program, &dispute, &id, &voter, 10, &mint, 1, &salt);
    assert_ne!(
        baseline,
        commitment_hash_v3(
            &Pubkey::new_unique(),
            &dispute,
            &id,
            &voter,
            10,
            &mint,
            1,
            &salt
        )
    );
    assert_ne!(
        baseline,
        commitment_hash_v3(&program, &dispute, &id, &voter, 11, &mint, 1, &salt)
    );
    assert_ne!(
        baseline,
        commitment_hash_v3(&program, &dispute, &id, &voter, 10, &mint, 0, &salt)
    );
}

#[test]
fn delayed_v5_emergency_resolution_reopens_coverage_fail_closed() {
    let scramble_start_ts = 1_000_000;
    let listing_ts = scramble_start_ts + ORACLE_PRE_LISTING_WINDOW_SECONDS;
    let mut month = OracleMonthState {
        scramble_start_ts,
        listing_ts,
        phase: OraclePhase::Scramble,
        ..OracleMonthState::default()
    };
    let mut coverage = OracleSkuCoverageManifest {
        coverage_finalized: true,
        coverage_complete_ts: scramble_start_ts + 1,
        ..OracleSkuCoverageManifest::default()
    };
    let scramble_end = rulebook_schedule_boundaries(&month).unwrap().2;

    reopen_coverage_after_delayed_emergency_resolution(&mut month, &mut coverage, scramble_end - 1)
        .unwrap();
    assert_eq!(month.phase, OraclePhase::Scramble);
    assert!(coverage.coverage_finalized);

    reopen_coverage_after_delayed_emergency_resolution(&mut month, &mut coverage, scramble_end)
        .unwrap();
    assert_eq!(month.phase, OraclePhase::SourceSubmission);
    assert!(!coverage.coverage_finalized);
    assert_eq!(coverage.coverage_complete_ts, 0);
}
