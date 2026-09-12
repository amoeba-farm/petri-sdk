use super::*;
use proptest::prelude::*;
use serde::Deserialize;

fn call(strike: u64, cap: u64, external_oi_atoms: u64) -> WriterSeries {
    WriterSeries {
        kind: OptionKind::CallSpread,
        strike_price_atomic: strike,
        cap_price_atomic: cap,
        contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
        max_payout_per_contract_atoms: cap - strike,
        external_oi_atoms,
    }
}

fn put(strike: u64, floor: u64, external_oi_atoms: u64) -> WriterSeries {
    WriterSeries {
        kind: OptionKind::PutSpread,
        strike_price_atomic: strike,
        cap_price_atomic: floor,
        contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
        max_payout_per_contract_atoms: strike - floor,
        external_oi_atoms,
    }
}

fn brute_force_reserve(series: &[WriterSeries], maximum_settlement: u64) -> u64 {
    (0..=maximum_settlement)
        .map(|settlement| {
            let numerator = series.iter().fold(0u128, |total, item| {
                let payout = match item.kind {
                    OptionKind::CallSpread => settlement
                        .min(item.cap_price_atomic)
                        .saturating_sub(item.strike_price_atomic),
                    OptionKind::PutSpread => item
                        .strike_price_atomic
                        .saturating_sub(settlement.max(item.cap_price_atomic)),
                };
                total + u128::from(item.external_oi_atoms) * u128::from(payout)
            });
            let scale = u128::from(WRITER_CONTRACT_ATOMIC_SCALE);
            u64::try_from(numerator / scale + u128::from(!numerator.is_multiple_of(scale))).unwrap()
        })
        .max()
        .unwrap()
}

fn brute_force_reserve_and_binding(series: &[WriterSeries], maximum_settlement: u64) -> (u64, u64) {
    let mut reserve = 0;
    let mut binding = 0;
    for settlement in 0..=maximum_settlement {
        let liability = aggregate_liability(series, settlement).unwrap();
        if liability > reserve {
            reserve = liability;
            binding = settlement;
        }
    }
    (reserve, binding)
}

fn brute_force_safe_withdrawal(
    assets_atoms: u64,
    flat_supply_atoms: u64,
    flat_to_burn_atoms: u64,
    before: &[WriterSeries],
    after: &[WriterSeries],
    maximum_settlement: u64,
) -> (u64, u64) {
    let contract_scale = u128::from(WRITER_CONTRACT_ATOMIC_SCALE);
    let assets_numerator = u128::from(assets_atoms) * contract_scale;
    let denominator = u128::from(flat_supply_atoms) * contract_scale;
    let mut minimum = u64::MAX;
    let mut binding = 0;
    for settlement in 0..=maximum_settlement {
        let before_numerator = aggregate_liability_numerator(before, settlement).unwrap();
        let after_numerator = aggregate_liability_numerator(after, settlement).unwrap();
        assert!(before_numerator <= assets_numerator);
        assert!(after_numerator <= before_numerator);
        let numerator = u128::from(flat_to_burn_atoms) * (assets_numerator - before_numerator)
            + u128::from(flat_supply_atoms) * (before_numerator - after_numerator);
        let safe = u64::try_from(numerator / denominator).unwrap();
        if safe < minimum {
            minimum = safe;
            binding = settlement;
        }
    }
    (minimum, binding)
}

fn post_basket_book(
    series: &[WriterSeries],
    flat_supply_atoms: u64,
    flat_to_burn_atoms: u64,
) -> Vec<WriterSeries> {
    let basket = proportional_close_basket(series, flat_supply_atoms, flat_to_burn_atoms).unwrap();
    series
        .iter()
        .zip(basket.as_slice())
        .map(|(item, required)| WriterSeries {
            external_oi_atoms: item.external_oi_atoms - required,
            ..*item
        })
        .collect()
}

fn brute_force_safe_issue(
    series: &[WriterSeries],
    series_index: usize,
    bid_price_per_contract_atoms: u64,
    maximum_quantity_atoms: u64,
    limits: WriterIssueAdmissionLimits,
) -> u64 {
    let maximum_contracts = maximum_quantity_atoms / WRITER_CONTRACT_ATOMIC_SCALE;
    let mut safe = 0u64;
    for contracts in 0..=maximum_contracts {
        let quantity = contracts * WRITER_CONTRACT_ATOMIC_SCALE;
        let mut candidate = series.to_vec();
        candidate[series_index].external_oi_atoms += quantity;
        let reserve = exact_reserve(
            &candidate,
            limits.lower_tail_max_settlement_atomic,
            limits.upper_tail_min_settlement_atomic,
        )
        .unwrap();
        let exposure =
            security_exposure(limits.security_mode, &candidate, reserve.reserve_atoms).unwrap();
        let premium = contracts * bid_price_per_contract_atoms;
        let assets = limits.accounted_asset_atoms + premium;
        let locked = limits.locked_primary_premium_atoms + premium;
        let drawdown = drawdown_checks(
            &reserve,
            locked,
            limits.writer_principal_atoms,
            limits.worst_drawdown_limit,
            limits.lower_drawdown_limit,
            limits.upper_drawdown_limit,
        )
        .unwrap();
        if exposure <= limits.security_cap_atoms
            && assets >= reserve.reserve_atoms + limits.operational_buffer_atoms
            && drawdown.all_pass()
        {
            safe = quantity;
        }
    }
    safe
}

#[test]
fn one_pass_issue_admission_matches_full_recomputation() {
    let series = vec![
        call(100_000_000, 112_000_000, 1_500_001),
        put(100_000_000, 88_000_000, 2_250_001),
        call(96_000_000, 106_000_000, 750_001),
        put(104_000_000, 92_000_000, 1_125_001),
    ];
    for security_mode in [
        WriterSecurityMode::GrossExternalMaximumPayout,
        WriterSecurityMode::ExactExternalEnvelope,
    ] {
        for bid_price_per_contract_atoms in [1_000_000, 6_000_000, 12_000_000, 15_000_000] {
            let limits = WriterIssueAdmissionLimits {
                security_mode,
                security_cap_atoms: 120_000_000,
                accounted_asset_atoms: 60_000_000,
                locked_primary_premium_atoms: 5_000_000,
                writer_principal_atoms: 50_000_000,
                operational_buffer_atoms: 1_000_000,
                worst_drawdown_limit: 1_000_000,
                lower_drawdown_limit: 800_000,
                upper_drawdown_limit: 500_000,
                lower_tail_max_settlement_atomic: 88_000_000,
                upper_tail_min_settlement_atomic: 112_000_000,
            };
            let maximum = 16 * WRITER_CONTRACT_ATOMIC_SCALE;
            assert_eq!(
                maximum_safe_issue_quantity(
                    &series,
                    0,
                    bid_price_per_contract_atoms,
                    maximum,
                    limits,
                )
                .unwrap(),
                brute_force_safe_issue(&series, 0, bid_price_per_contract_atoms, maximum, limits,),
                "mode={security_mode:?} price={bid_price_per_contract_atoms}",
            );
        }
    }
}

#[test]
fn capped_call_and_put_match_current_payoff_shape() {
    let call = call(100_000_000, 112_000_000, WRITER_CONTRACT_ATOMIC_SCALE);
    assert_eq!(payout_per_contract(&call, 99_000_000), Ok(0));
    assert_eq!(payout_per_contract(&call, 106_000_000), Ok(6_000_000));
    assert_eq!(payout_per_contract(&call, 200_000_000), Ok(12_000_000));

    let put = put(100_000_000, 88_000_000, WRITER_CONTRACT_ATOMIC_SCALE);
    assert_eq!(payout_per_contract(&put, 101_000_000), Ok(0));
    assert_eq!(payout_per_contract(&put, 94_000_000), Ok(6_000_000));
    assert_eq!(payout_per_contract(&put, 1), Ok(12_000_000));
}

#[test]
fn writer_pack_wmt_001_002_payoff_boundary_vectors_cover_fractional_oi() {
    let call_boundaries = [(9, 0), (10, 0), (11, 1), (13, 3), (14, 4), (15, 4)];
    let put_boundaries = [(5, 4), (6, 4), (7, 3), (9, 1), (10, 0), (11, 0)];
    for external_oi_atoms in [WRITER_CONTRACT_ATOMIC_SCALE, 1_500_001] {
        let call = call(10, 14, external_oi_atoms);
        for (settlement, payout) in call_boundaries {
            assert_eq!(payout_per_contract(&call, settlement), Ok(payout));
            let numerator = u128::from(external_oi_atoms) * u128::from(payout);
            let expected = u64::try_from(
                numerator / u128::from(WRITER_CONTRACT_ATOMIC_SCALE)
                    + u128::from(
                        !numerator.is_multiple_of(u128::from(WRITER_CONTRACT_ATOMIC_SCALE)),
                    ),
            )
            .unwrap();
            assert_eq!(aggregate_liability(&[call], settlement), Ok(expected));
        }

        let put = put(10, 6, external_oi_atoms);
        for (settlement, payout) in put_boundaries {
            assert_eq!(payout_per_contract(&put, settlement), Ok(payout));
            let numerator = u128::from(external_oi_atoms) * u128::from(payout);
            let expected = u64::try_from(
                numerator / u128::from(WRITER_CONTRACT_ATOMIC_SCALE)
                    + u128::from(
                        !numerator.is_multiple_of(u128::from(WRITER_CONTRACT_ATOMIC_SCALE)),
                    ),
            )
            .unwrap();
            assert_eq!(aggregate_liability(&[put], settlement), Ok(expected));
        }
    }
}

#[test]
fn writer_pack_wmt_003_malformed_series_fail_before_reserve_arithmetic() {
    let malformed = [
        WriterSeries {
            kind: OptionKind::CallSpread,
            strike_price_atomic: 10,
            cap_price_atomic: 10,
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
            max_payout_per_contract_atoms: 1,
            external_oi_atoms: 1,
        },
        WriterSeries {
            kind: OptionKind::CallSpread,
            strike_price_atomic: 10,
            cap_price_atomic: 9,
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
            max_payout_per_contract_atoms: 1,
            external_oi_atoms: 1,
        },
        WriterSeries {
            kind: OptionKind::PutSpread,
            strike_price_atomic: 10,
            cap_price_atomic: 10,
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
            max_payout_per_contract_atoms: 1,
            external_oi_atoms: 1,
        },
        WriterSeries {
            kind: OptionKind::PutSpread,
            strike_price_atomic: 10,
            cap_price_atomic: 11,
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
            max_payout_per_contract_atoms: 1,
            external_oi_atoms: 1,
        },
        WriterSeries {
            max_payout_per_contract_atoms: 3,
            ..call(10, 14, 1)
        },
        WriterSeries {
            max_payout_per_contract_atoms: 0,
            ..call(10, 14, 1)
        },
        WriterSeries {
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE - 1,
            ..call(10, 14, 1)
        },
    ];
    for item in malformed {
        assert_eq!(
            payout_per_contract(&item, 12),
            Err(WriterMathError::InvalidSeries)
        );
        assert_eq!(
            exact_reserve(&[item], 5, 20),
            Err(WriterMathError::InvalidSeries)
        );
    }
}

#[test]
fn writer_pack_wmt_032_rejects_duplicate_instruments_and_preserves_unique_permutations() {
    let combined = [call(10, 11, 2)];
    assert_eq!(
        gross_external_maximum_payout(&combined),
        Ok(1),
        "the minimized unsplit fractional-OI instrument rounds once"
    );

    let duplicate_split = [call(10, 11, 1), call(10, 11, 1)];
    assert_eq!(
        exact_reserve(&duplicate_split, 0, 20),
        Err(WriterMathError::InvalidSeries)
    );
    assert_eq!(
        gross_external_maximum_payout(&duplicate_split),
        Err(WriterMathError::InvalidSeries)
    );
    assert_eq!(
        proportional_close_basket(&duplicate_split, 2, 1),
        Err(WriterMathError::InvalidSeries)
    );

    let canonical = [
        call(10, 11, WRITER_CONTRACT_ATOMIC_SCALE),
        put(10, 9, WRITER_CONTRACT_ATOMIC_SCALE),
    ];
    let permuted = [canonical[1], canonical[0]];
    assert_eq!(
        exact_reserve(&canonical, 0, 20),
        exact_reserve(&permuted, 0, 20)
    );
    assert_eq!(
        gross_external_maximum_payout(&canonical),
        gross_external_maximum_payout(&permuted)
    );
}

#[test]
fn candidates_are_sorted_unique_and_bounded_at_twenty_live_series() {
    let mut series = Vec::new();
    for index in 0..10u64 {
        let strike = 50_000_000 + index * 3_000_000;
        series.push(call(strike, strike + 12_000_000, 1_000_000));
        series.push(put(strike, strike - 12_000_000, 1_000_000));
    }
    let candidates = canonical_candidate_points(&series, 40_000_000, 120_000_000).unwrap();
    assert!(candidates.len() <= WRITER_MAX_CANDIDATE_POINTS);
    assert!(candidates
        .as_slice()
        .windows(2)
        .all(|pair| pair[0] < pair[1]));
}

#[test]
fn writer_pack_wmt_007_every_valid_adjacent_breakpoint_atom_is_canonical() {
    let series = [
        call(5, 9, 500_001),
        put(13, 7, 500_003),
        call(11, 17, 250_007),
    ];
    let lower_tail = 4;
    let upper_tail = 18;
    let candidates = canonical_candidate_points(&series, lower_tail, upper_tail).unwrap();
    for breakpoint in [5, 9, 13, 7, 11, 17, lower_tail, upper_tail] {
        assert!(candidates.as_slice().contains(&(breakpoint - 1)));
        assert!(candidates.as_slice().contains(&breakpoint));
        assert!(candidates.as_slice().contains(&(breakpoint + 1)));
    }

    // Fractional OI makes a rounded maximum include the predecessor of the cap/floor breakpoint.
    // A membership assertion is intentional: an adjacent-point omission mutant must fail even
    // when aggregate rounding leaves the breakpoint itself on the same maximum plateau.
    let predecessor_case = [put(10, 6, 873_835), call(1, 6, 168_221)];
    let predecessor_reserve = exact_reserve(&predecessor_case, 6, 7).unwrap();
    assert_eq!(aggregate_liability(&predecessor_case, 5), Ok(5));
    assert_eq!(predecessor_reserve.reserve_atoms, 5);
    assert!(canonical_candidate_points(&predecessor_case, 6, 7)
        .unwrap()
        .as_slice()
        .contains(&5));

    // The successor of a plateau breakpoint is likewise canonical and can itself attain the
    // rounded maximum for fractional OI.
    let successor_case = [call(0, 1, 1)];
    let successor_reserve = exact_reserve(&successor_case, 1, 2).unwrap();
    assert_eq!(aggregate_liability(&successor_case, 2), Ok(1));
    assert_eq!(successor_reserve.reserve_atoms, 1);
    assert!(canonical_candidate_points(&successor_case, 1, 2)
        .unwrap()
        .as_slice()
        .contains(&2));
}

#[test]
fn twenty_one_live_series_fail_closed() {
    let series =
        vec![call(100_000_000, 112_000_000, WRITER_CONTRACT_ATOMIC_SCALE); WRITER_MAX_SERIES + 1];
    assert_eq!(
        exact_reserve(&series, 88_000_000, 112_000_000),
        Err(WriterMathError::TooManySeries)
    );
}

#[test]
fn neutral_pair_requires_one_shared_twelve_dollar_reserve() {
    let series = [
        call(100_000_000, 112_000_000, 20_000_000),
        put(100_000_000, 88_000_000, 15_000_000),
    ];
    let reserve = exact_reserve(&series, 88_000_000, 112_000_000).unwrap();
    assert_eq!(reserve.reserve_atoms, 240_000_000);
    assert_eq!(reserve.lower_tail_reserve_atoms, 180_000_000);
    assert_eq!(reserve.upper_tail_reserve_atoms, 240_000_000);
}

#[test]
fn aggregate_rounding_removes_the_per_series_floor_counterexample() {
    // Dividing each term before summation produces a false candidate maximum: at scale 10 the
    // per-series floors reach 6 at z=12, while every breakpoint-adjacent candidate reaches only 5.
    // Aggregate-first arithmetic has numerator 60 at both z=12 and candidate z=13, so the bounded
    // candidate proof remains exact. The quantities below scale that example to canonical atoms.
    let series = [
        call(16, 19, 100_000),
        call(7, 14, 600_000),
        put(17, 9, 600_000),
    ];
    let reserve = exact_reserve(&series, 9, 17).unwrap();
    assert_eq!(aggregate_liability(&series, 12), Ok(6));
    assert_eq!(aggregate_liability(&series, 13), Ok(6));
    assert_eq!(reserve.reserve_atoms, 6);
    assert_eq!(reserve.reserve_settlement_atomic, 8);
    assert_eq!(brute_force_reserve(&series, 20), reserve.reserve_atoms);
}

#[test]
fn writer_pack_wmt_004_aggregate_ceiling_kills_per_series_ceiling_mutant() {
    let series = [call(0, 1, 1), call(0, 2, 1)];
    let numerator = aggregate_liability_numerator(&series, 1).unwrap();
    assert_eq!(numerator, 2);
    assert_eq!(aggregate_liability(&series, 1), Ok(1));
    let per_series_ceiling_mutant = series
        .iter()
        .map(|item| aggregate_liability(core::slice::from_ref(item), 1).unwrap())
        .sum::<u64>();
    assert_eq!(per_series_ceiling_mutant, 2);
}

#[test]
fn writer_pack_wmt_005_006_008_011_012_013_reserve_geometry() {
    for call_contracts in 1..=4 {
        for put_contracts in 1..=4 {
            let clean = [
                call(
                    100_000_000,
                    112_000_000,
                    call_contracts * WRITER_CONTRACT_ATOMIC_SCALE,
                ),
                put(
                    100_000_000,
                    88_000_000,
                    put_contracts * WRITER_CONTRACT_ATOMIC_SCALE,
                ),
            ];
            let reserve = exact_reserve(&clean, 88_000_000, 112_000_000).unwrap();
            assert_eq!(
                reserve.reserve_atoms,
                12_000_000 * call_contracts.max(put_contracts)
            );
            for settlement in [
                0,
                87_999_999,
                88_000_000,
                99_999_999,
                100_000_000,
                100_000_001,
                111_999_999,
                112_000_000,
                112_000_001,
            ] {
                assert!(aggregate_liability(&clean, settlement).unwrap() <= reserve.reserve_atoms);
            }
        }
    }

    // The call is fully paid above 10 and the put is fully paid below 10. Their shared maximum
    // is the interior overlap at 10, where a clean mirrored-count shortcut under-reserves by 50%.
    let overlap = [
        call(0, 10, WRITER_CONTRACT_ATOMIC_SCALE),
        put(20, 10, WRITER_CONTRACT_ATOMIC_SCALE),
    ];
    let reserve = exact_reserve(&overlap, 0, 20).unwrap();
    assert_eq!(reserve.reserve_atoms, 20);
    assert_eq!(reserve.reserve_settlement_atomic, 10);
    assert_eq!(reserve.lower_tail_reserve_atoms, 10);
    assert_eq!(reserve.upper_tail_reserve_atoms, 10);
    assert!(canonical_candidate_points(&overlap, 0, 20)
        .unwrap()
        .as_slice()
        .contains(&21));
    assert_eq!(brute_force_reserve_and_binding(&overlap, 21), (20, 10));

    let mixed = [
        call(3, 7, 2_500_001),
        put(11, 5, 1_250_003),
        call(8, 17, 3_000_007),
    ];
    let mixed_reserve = exact_reserve(&mixed, 2, 18).unwrap();
    let (brute_reserve, brute_binding) = brute_force_reserve_and_binding(&mixed, 18);
    assert_eq!(
        (
            mixed_reserve.reserve_atoms,
            mixed_reserve.reserve_settlement_atomic
        ),
        (brute_reserve, brute_binding)
    );

    // Aggregate rounding can begin a maximum plateau between canonical candidates. The stored
    // binding is deliberately the first canonical maximizing candidate, not the first atom in
    // the rounded plateau.
    let rounded_tie = [put(10, 6, 873_835), call(1, 6, 168_221)];
    let rounded_tie_reserve = exact_reserve(&rounded_tie, 6, 7).unwrap();
    assert_eq!(brute_force_reserve_and_binding(&rounded_tie, 11), (5, 4));
    assert_eq!(
        (
            rounded_tie_reserve.reserve_atoms,
            rounded_tie_reserve.reserve_settlement_atomic,
        ),
        (5, 5)
    );
    assert_eq!(aggregate_liability(&rounded_tie, 4), Ok(5));
    assert_eq!(aggregate_liability(&rounded_tie, 5), Ok(5));
}

#[test]
fn aggregate_ceiling_is_allocated_exactly_across_series_and_claim_chunks() {
    let series = [call(10, 20, 400_000), call(10, 21, 400_000)];
    let (liabilities, total) = settlement_series_liabilities(&series, 11).unwrap();
    assert_eq!(total, 1);
    assert_eq!(liabilities.as_slice(), &[1, 0]);

    let first = cumulative_allocation_delta(400_000, 400_000, 100_000, 1).unwrap();
    let final_part = cumulative_allocation_delta(400_000, 300_000, 300_000, 1).unwrap();
    assert_eq!(first, 0);
    assert_eq!(final_part, 1);
}

#[test]
fn proportional_close_is_statewise_non_dilutive() {
    let series = [
        call(100_000_000, 112_000_000, 20_000_000),
        put(100_000_000, 88_000_000, 15_000_000),
    ];
    let preview = proportional_close_preview(
        365_000_000,
        115_000_000,
        11_500_000,
        &series,
        88_000_000,
        112_000_000,
    )
    .unwrap();
    assert_eq!(
        preview.required_claim_atoms.as_slice(),
        &[2_000_000, 1_500_000]
    );
    assert_eq!(preview.reserve_before_atoms, 240_000_000);
    assert_eq!(preview.reserve_after_atoms, 216_000_000);
    assert_eq!(preview.lower_tail_reserve_before_atoms, 180_000_000);
    assert_eq!(preview.lower_tail_reserve_after_atoms, 162_000_000);
    assert_eq!(preview.upper_tail_reserve_before_atoms, 240_000_000);
    assert_eq!(preview.upper_tail_reserve_after_atoms, 216_000_000);
    assert_eq!(preview.reserve_released_atoms, 24_000_000);
    assert_eq!(preview.withdrawal_atoms, 11_500_000);
    assert_eq!(
        preview.reserve_before_atoms,
        exact_reserve(&series, 88_000_000, 112_000_000)
            .unwrap()
            .reserve_atoms
    );

    let mut after = series;
    for (item, required) in after
        .iter_mut()
        .zip(preview.required_claim_atoms.as_slice())
    {
        item.external_oi_atoms -= *required;
    }
    for settlement in (0..=200_000_000).step_by(1_000_000) {
        let before_n = aggregate_liability_numerator(&series, settlement).unwrap();
        let after_n = aggregate_liability_numerator(&after, settlement).unwrap();
        let scale = u128::from(WRITER_CONTRACT_ATOMIC_SCALE);
        let left = u128::from(115_000_000u64)
            * (u128::from(365_000_000u64 - preview.withdrawal_atoms) * scale - after_n);
        let right = u128::from(115_000_000u64 - 11_500_000)
            * (u128::from(365_000_000u64) * scale - before_n);
        assert!(left >= right, "dilution at settlement {settlement}");
    }
}

#[test]
fn drawdown_and_security_use_external_book_only() {
    let series = [
        call(100_000_000, 112_000_000, 20_000_000),
        put(100_000_000, 88_000_000, 15_000_000),
    ];
    let reserve = exact_reserve(&series, 88_000_000, 112_000_000).unwrap();
    let checks = drawdown_checks(
        &reserve,
        125_000_000,
        115_000_000,
        1_000_000,
        500_000,
        1_000_000,
    )
    .unwrap();
    assert!(checks.all_pass());
    assert_eq!(gross_external_maximum_payout(&series), Ok(420_000_000));
    assert_eq!(
        security_exposure(
            WriterSecurityMode::ExactExternalEnvelope,
            &series,
            reserve.reserve_atoms,
        ),
        Ok(240_000_000)
    );
}

#[test]
fn writer_pack_wmt_015_016_security_and_reserve_inputs_remain_separate() {
    let series = [
        call(90, 101, 3_500_001),
        put(107, 93, 2_250_003),
        call(99, 104, 7_000_005),
    ];
    let reserve = exact_reserve(&series, 80, 120).unwrap();
    assert!(reserve.reserve_atoms <= gross_external_maximum_payout(&series).unwrap());
    assert_eq!(
        security_exposure(
            WriterSecurityMode::ExactExternalEnvelope,
            &series,
            reserve.reserve_atoms,
        ),
        Ok(reserve.reserve_atoms)
    );
    for (premium, principal) in [(0, 1), (10, 1), (10, 1_000), (u64::MAX, u64::MAX)] {
        let _ = drawdown_checks(
            &reserve,
            premium,
            principal,
            WRITER_RATIO_SCALE_PPM,
            WRITER_RATIO_SCALE_PPM,
            WRITER_RATIO_SCALE_PPM,
        )
        .unwrap();
        assert_eq!(exact_reserve(&series, 80, 120).unwrap(), reserve);
    }
}

#[test]
fn writer_pack_wmt_019_021_issue_admission_is_monotone_and_exact_at_zero_one() {
    let series = [call(10, 20, 0)];
    let limits = |assets, security, principal, worst, lower, upper| WriterIssueAdmissionLimits {
        security_mode: WriterSecurityMode::ExactExternalEnvelope,
        security_cap_atoms: security,
        accounted_asset_atoms: assets,
        locked_primary_premium_atoms: 0,
        writer_principal_atoms: principal,
        operational_buffer_atoms: 0,
        worst_drawdown_limit: worst,
        lower_drawdown_limit: lower,
        upper_drawdown_limit: upper,
        lower_tail_max_settlement_atomic: 0,
        upper_tail_min_settlement_atomic: 20,
    };
    let maximum = 10 * WRITER_CONTRACT_ATOMIC_SCALE;
    let issue = |book: &[WriterSeries], maximum, limits| {
        maximum_safe_issue_quantity(book, 0, 0, maximum, limits).unwrap()
    };

    assert_eq!(
        issue(
            &series,
            0,
            limits(100, 100, 100, 1_000_000, 1_000_000, 1_000_000)
        ),
        0
    );
    assert_eq!(
        issue(
            &series,
            WRITER_CONTRACT_ATOMIC_SCALE,
            limits(100, 9, 100, 1_000_000, 1_000_000, 1_000_000)
        ),
        0
    );
    assert_eq!(
        issue(
            &series,
            WRITER_CONTRACT_ATOMIC_SCALE,
            limits(100, 10, 100, 1_000_000, 1_000_000, 1_000_000)
        ),
        WRITER_CONTRACT_ATOMIC_SCALE
    );
    assert_eq!(
        issue(
            &series,
            WRITER_CONTRACT_ATOMIC_SCALE,
            limits(9, 100, 100, 1_000_000, 1_000_000, 1_000_000)
        ),
        0
    );
    assert_eq!(
        issue(
            &series,
            WRITER_CONTRACT_ATOMIC_SCALE,
            limits(10, 100, 100, 1_000_000, 1_000_000, 1_000_000)
        ),
        WRITER_CONTRACT_ATOMIC_SCALE
    );
    assert_eq!(
        issue(
            &series,
            WRITER_CONTRACT_ATOMIC_SCALE,
            limits(100, 100, 9, 1_000_000, 1_000_000, 1_000_000)
        ),
        0
    );
    assert_eq!(
        issue(
            &series,
            WRITER_CONTRACT_ATOMIC_SCALE,
            limits(100, 100, 10, 1_000_000, 1_000_000, 1_000_000)
        ),
        WRITER_CONTRACT_ATOMIC_SCALE
    );

    let assets_limited = issue(
        &series,
        maximum,
        limits(40, 100, 100, 1_000_000, 1_000_000, 1_000_000),
    );
    let more_assets = issue(
        &series,
        maximum,
        limits(80, 100, 100, 1_000_000, 1_000_000, 1_000_000),
    );
    assert!(more_assets >= assets_limited);
    let security_limited = issue(
        &series,
        maximum,
        limits(100, 40, 100, 1_000_000, 1_000_000, 1_000_000),
    );
    let more_security = issue(
        &series,
        maximum,
        limits(100, 80, 100, 1_000_000, 1_000_000, 1_000_000),
    );
    assert!(more_security >= security_limited);
    let principal_limited = issue(
        &series,
        maximum,
        limits(100, 100, 40, 1_000_000, 1_000_000, 1_000_000),
    );
    let more_principal = issue(
        &series,
        maximum,
        limits(100, 100, 80, 1_000_000, 1_000_000, 1_000_000),
    );
    assert!(more_principal >= principal_limited);

    let with_existing_liability = [call(10, 20, WRITER_CONTRACT_ATOMIC_SCALE)];
    assert!(
        issue(
            &with_existing_liability,
            maximum,
            limits(100, 80, 100, 1_000_000, 1_000_000, 1_000_000)
        ) <= more_security
    );
}

#[test]
fn writer_pack_wmt_022_zero_principal_drawdown_uses_uncovered_risk() {
    let zero = WriterReserveSummary::default();
    assert!(drawdown_checks(&zero, 0, 0, 0, 0, 0).unwrap().all_pass());

    let premium_covered = WriterReserveSummary {
        reserve_atoms: 10,
        lower_tail_reserve_atoms: 5,
        upper_tail_reserve_atoms: 10,
        ..WriterReserveSummary::default()
    };
    assert!(drawdown_checks(&premium_covered, 10, 0, 0, 0, 0)
        .unwrap()
        .all_pass());
    let uncovered = drawdown_checks(&premium_covered, 9, 0, 0, 0, 0).unwrap();
    assert!(!uncovered.full_book_passes);
    assert!(uncovered.lower_tail_passes);
    assert!(!uncovered.upper_tail_passes);
    assert_eq!(
        drawdown_checks(&zero, 0, 0, WRITER_RATIO_SCALE_PPM + 1, 0, 0),
        Err(WriterMathError::InvalidRiskLimit)
    );
}

#[test]
fn writer_pack_wmt_023_full_book_gate_rejects_when_both_tails_pass() {
    let overlap = [
        call(0, 10, WRITER_CONTRACT_ATOMIC_SCALE),
        put(20, 10, WRITER_CONTRACT_ATOMIC_SCALE),
    ];
    let reserve = exact_reserve(&overlap, 0, 20).unwrap();
    assert_eq!(
        (
            reserve.reserve_atoms,
            reserve.lower_tail_reserve_atoms,
            reserve.upper_tail_reserve_atoms,
        ),
        (20, 10, 10)
    );
    let checks = drawdown_checks(&reserve, 0, 20, 750_000, 750_000, 750_000).unwrap();
    assert!(!checks.full_book_passes);
    assert!(checks.lower_tail_passes);
    assert!(checks.upper_tail_passes);
    assert!(!checks.all_pass());
}

#[test]
fn writer_pack_wmt_025_statewise_close_ceiling_equals_exhaustive_minimum() {
    let before = [
        call(4, 9, 20 * WRITER_CONTRACT_ATOMIC_SCALE),
        put(8, 2, 15 * WRITER_CONTRACT_ATOMIC_SCALE),
        call(7, 12, 9 * WRITER_CONTRACT_ATOMIC_SCALE + 1),
    ];
    let flat_supply = 115 * WRITER_CONTRACT_ATOMIC_SCALE;
    let flat_to_burn = 11 * WRITER_CONTRACT_ATOMIC_SCALE + 1;
    let after = post_basket_book(&before, flat_supply, flat_to_burn);
    let candidates = canonical_candidate_points(&before, 1, 13).unwrap();
    let production =
        statewise_safe_withdrawal(365, flat_supply, flat_to_burn, &before, &after, &candidates)
            .unwrap();
    let brute = brute_force_safe_withdrawal(365, flat_supply, flat_to_burn, &before, &after, 13);
    assert_eq!(production, brute);

    let preview =
        proportional_close_preview(365, flat_supply, flat_to_burn, &before, 1, 13).unwrap();
    assert_eq!(preview.statewise_safe_withdrawal_atoms, brute.0);
    assert_eq!(preview.statewise_binding_settlement_atomic, brute.1);
    assert_eq!(
        preview.withdrawal_atoms,
        flat_to_burn
            .min(preview.reserve_released_atoms)
            .min(brute.0)
    );
}

#[test]
fn writer_pack_wmt_026_single_binding_claim_delta_reserve_is_unsafe() {
    let before = [
        call(100_000_000, 112_000_000, 20_000_000),
        put(100_000_000, 88_000_000, 15_000_000),
    ];
    let after = [
        call(100_000_000, 112_000_000, 19_000_000),
        put(100_000_000, 88_000_000, 15_000_000),
    ];
    let candidates = canonical_candidate_points(&before, 88_000_000, 112_000_000).unwrap();
    let (safe, binding) = statewise_safe_withdrawal(
        365_000_000,
        115_000_000,
        1_000_000,
        &before,
        &after,
        &candidates,
    )
    .unwrap();
    let reserve_before = exact_reserve(&before, 88_000_000, 112_000_000)
        .unwrap()
        .reserve_atoms;
    let reserve_after = exact_reserve(&after, 88_000_000, 112_000_000)
        .unwrap()
        .reserve_atoms;
    let delta_reserve = reserve_before - reserve_after;
    assert_eq!(delta_reserve, 12_000_000);
    // Every settlement at or below the put floor has the same binding downside economics.
    // Canonical tie-breaking retains the first candidate, zero.
    assert_eq!(binding, 0);
    assert_eq!(
        aggregate_liability(&before, binding),
        aggregate_liability(&before, 88_000_000)
    );
    assert_eq!(safe, 1_608_695);
    assert!(safe < delta_reserve);
}

#[test]
fn writer_pack_wmt_027_028_proportional_basket_rounding_is_bounded() {
    let book = [call(1, 2, 1), put(2, 1, 2), call(2, 3, 9)];
    for flat_to_burn in 1..10 {
        let basket = proportional_close_basket(&book, 10, flat_to_burn).unwrap();
        for (item, required) in book.iter().zip(basket.as_slice()) {
            let retired_scaled = u128::from(*required) * 10;
            let exact_scaled = u128::from(item.external_oi_atoms) * u128::from(flat_to_burn);
            assert!(retired_scaled >= exact_scaled);
            assert!(retired_scaled - exact_scaled < 10);
            assert!(*required <= item.external_oi_atoms);
        }
    }
    let maximal = [call(1, 2, u64::MAX)];
    let basket = proportional_close_basket(&maximal, u64::MAX, u64::MAX - 1).unwrap();
    assert_eq!(basket.as_slice(), &[u64::MAX - 1]);

    let before = [call(1, 2, 1)];
    let after_with_more_oi = [call(1, 2, 2)];
    let candidates = canonical_candidate_points(&before, 0, 3).unwrap();
    assert_eq!(
        statewise_safe_withdrawal(1, 2, 1, &before, &after_with_more_oi, &candidates),
        Err(WriterMathError::IncompatibleSeriesBooks)
    );
}

#[test]
fn writer_pack_wmt_029_030_cumulative_allocations_conserve_dust_under_permutation() {
    let permutations = [
        [1, 2, 4],
        [1, 4, 2],
        [2, 1, 4],
        [2, 4, 1],
        [4, 1, 2],
        [4, 2, 1],
    ];
    for chunks in permutations {
        let mut remaining_quantity = 7;
        let mut remaining_liability = 5;
        let mut total = 0;
        for consumed in chunks {
            let allocation =
                cumulative_allocation_delta(7, remaining_quantity, consumed, 5).unwrap();
            assert!(allocation <= remaining_liability);
            remaining_quantity -= consumed;
            remaining_liability -= allocation;
            total += allocation;
        }
        assert_eq!(remaining_quantity, 0);
        assert_eq!(remaining_liability, 0);
        assert_eq!(total, 5);
    }
}

#[test]
fn writer_pack_wmt_031_checked_arithmetic_fails_closed_at_u64_boundaries() {
    let maximal = call(0, u64::MAX, u64::MAX);
    assert_eq!(
        aggregate_liability(&[maximal], u64::MAX),
        Err(WriterMathError::ArithmeticOverflow)
    );
    assert_eq!(
        aggregate_liability_numerator(&[maximal, call(1, u64::MAX, u64::MAX)], u64::MAX,),
        Err(WriterMathError::ArithmeticOverflow)
    );
    assert_eq!(
        gross_external_maximum_payout(&[maximal]),
        Err(WriterMathError::ArithmeticOverflow)
    );

    let limits = WriterIssueAdmissionLimits {
        security_mode: WriterSecurityMode::ExactExternalEnvelope,
        security_cap_atoms: u64::MAX,
        accounted_asset_atoms: u64::MAX,
        locked_primary_premium_atoms: u64::MAX,
        writer_principal_atoms: u64::MAX,
        operational_buffer_atoms: 0,
        worst_drawdown_limit: 1,
        lower_drawdown_limit: 1,
        upper_drawdown_limit: 1,
        lower_tail_max_settlement_atomic: 0,
        upper_tail_min_settlement_atomic: 3,
    };
    assert_eq!(
        maximum_safe_issue_quantity(&[call(1, 2, 0)], 0, 0, 0, limits),
        Err(WriterMathError::ArithmeticOverflow)
    );

    assert_eq!(
        proportional_close_preview(
            u64::MAX,
            u64::MAX,
            u64::MAX - 1,
            &[call(1, 2, WRITER_CONTRACT_ATOMIC_SCALE)],
            0,
            3,
        ),
        Err(WriterMathError::ArithmeticOverflow)
    );
}

#[test]
fn gross_security_rounds_each_series_up() {
    let series = [call(100, 101, 1), put(100, 99, 1)];
    // Each one-atom OI series has a one-atom numerator over the 1_000_000 contract scale.
    // Gross mode is ceil(1/C) + ceil(1/C) = 2, while the shared exact envelope is 1.
    assert_eq!(gross_external_maximum_payout(&series), Ok(2));
    let reserve = exact_reserve(&series, 99, 101).unwrap();
    assert!(reserve.reserve_atoms <= gross_external_maximum_payout(&series).unwrap());
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSet {
    schema_version: u8,
    arithmetic_version: String,
    liability_rounding: String,
    scales: FixtureScales,
    series_storage_capacity: String,
    max_series: String,
    max_candidate_points: String,
    reserve_cases: Vec<ReserveFixture>,
    close_cases: Vec<CloseFixture>,
    settlement_cases: Vec<SettlementFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureScales {
    contract_atoms: String,
    ratio_ppm: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSeries {
    kind: String,
    strike_price_atomic: String,
    cap_price_atomic: String,
    external_oi_atoms: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReserveFixture {
    name: String,
    lower_tail_max_settlement_atomic: String,
    upper_tail_min_settlement_atomic: String,
    series: Vec<FixtureSeries>,
    expected_candidates: Vec<String>,
    expected_liability_numerators: Vec<String>,
    expected_liability_atoms: Vec<String>,
    expected_reserve_atoms: String,
    expected_lower_tail_reserve_atoms: String,
    expected_upper_tail_reserve_atoms: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseFixture {
    name: String,
    assets_atoms: String,
    flat_supply_atoms: String,
    flat_to_burn_atoms: String,
    lower_tail_max_settlement_atomic: String,
    upper_tail_min_settlement_atomic: String,
    series: Vec<FixtureSeries>,
    expected_required_claim_atoms: Vec<String>,
    expected_reserve_before_atoms: String,
    expected_reserve_after_atoms: String,
    expected_reserve_released_atoms: String,
    expected_statewise_safe_withdrawal_atoms: String,
    expected_statewise_binding_settlement_atomic: String,
    expected_withdrawal_atoms: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettlementFixture {
    name: String,
    settlement_price_atomic: String,
    series: Vec<FixtureSeries>,
    expected_series_liability_atoms: Vec<String>,
    expected_long_liability_atoms: String,
    claim_chunks: Vec<ClaimChunkFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimChunkFixture {
    series_index: String,
    remaining_before_atoms: String,
    consumed_atoms: String,
    expected_allocation_atoms: String,
}

fn fixture_u64(value: &str) -> u64 {
    value
        .parse()
        .expect("fixture integer must be a u64 decimal string")
}

fn fixture_series(value: &FixtureSeries) -> WriterSeries {
    let strike = fixture_u64(&value.strike_price_atomic);
    let cap = fixture_u64(&value.cap_price_atomic);
    match value.kind.as_str() {
        "CallSpread" => call(strike, cap, fixture_u64(&value.external_oi_atoms)),
        "PutSpread" => put(strike, cap, fixture_u64(&value.external_oi_atoms)),
        other => panic!("unknown fixture series kind {other}"),
    }
}

#[test]
fn shared_writer_math_fixtures_match_exact_engine() {
    let fixtures: FixtureSet = serde_json::from_str(include_str!(
        "../../../../fixtures/writer_sleeve_math_v1.json"
    ))
    .unwrap();
    assert_eq!(fixtures.schema_version, 1);
    assert_eq!(fixtures.arithmetic_version, "writer-sleeve-math-v1");
    assert_eq!(
        fixtures.liability_rounding,
        "ceil-after-complete-book-numerator"
    );
    assert_eq!(
        fixture_u64(&fixtures.scales.contract_atoms),
        WRITER_CONTRACT_ATOMIC_SCALE
    );
    assert_eq!(
        fixture_u64(&fixtures.scales.ratio_ppm),
        WRITER_RATIO_SCALE_PPM
    );
    assert_eq!(
        fixture_u64(&fixtures.series_storage_capacity),
        WRITER_SERIES_CAPACITY as u64
    );
    assert_eq!(fixture_u64(&fixtures.max_series), WRITER_MAX_SERIES as u64);
    assert_eq!(
        fixture_u64(&fixtures.max_candidate_points),
        WRITER_MAX_CANDIDATE_POINTS as u64
    );

    for fixture in fixtures.reserve_cases {
        let series = fixture
            .series
            .iter()
            .map(fixture_series)
            .collect::<Vec<_>>();
        let lower = fixture_u64(&fixture.lower_tail_max_settlement_atomic);
        let upper = fixture_u64(&fixture.upper_tail_min_settlement_atomic);
        let candidates = canonical_candidate_points(&series, lower, upper).unwrap();
        let expected_candidates = fixture
            .expected_candidates
            .iter()
            .map(|value| fixture_u64(value))
            .collect::<Vec<_>>();
        assert_eq!(
            candidates.as_slice(),
            expected_candidates,
            "{}",
            fixture.name
        );
        assert_eq!(
            fixture.expected_liability_numerators.len(),
            candidates.len(),
            "{} numerator vector length",
            fixture.name
        );
        assert_eq!(
            fixture.expected_liability_atoms.len(),
            candidates.len(),
            "{} liability vector length",
            fixture.name
        );
        for ((settlement, expected_numerator), expected_atoms) in candidates
            .as_slice()
            .iter()
            .zip(&fixture.expected_liability_numerators)
            .zip(&fixture.expected_liability_atoms)
        {
            assert_eq!(
                aggregate_liability_numerator(&series, *settlement).unwrap(),
                expected_numerator.parse::<u128>().unwrap(),
                "{} numerator at {}",
                fixture.name,
                settlement
            );
            assert_eq!(
                aggregate_liability(&series, *settlement).unwrap(),
                fixture_u64(expected_atoms),
                "{} liability at {}",
                fixture.name,
                settlement
            );
        }
        let reserve = exact_reserve(&series, lower, upper).unwrap();
        assert_eq!(
            reserve.reserve_atoms,
            fixture_u64(&fixture.expected_reserve_atoms),
            "{}",
            fixture.name
        );
        assert_eq!(
            reserve.lower_tail_reserve_atoms,
            fixture_u64(&fixture.expected_lower_tail_reserve_atoms),
            "{}",
            fixture.name
        );
        assert_eq!(
            reserve.upper_tail_reserve_atoms,
            fixture_u64(&fixture.expected_upper_tail_reserve_atoms),
            "{}",
            fixture.name
        );
    }

    for fixture in fixtures.close_cases {
        let series = fixture
            .series
            .iter()
            .map(fixture_series)
            .collect::<Vec<_>>();
        let preview = proportional_close_preview(
            fixture_u64(&fixture.assets_atoms),
            fixture_u64(&fixture.flat_supply_atoms),
            fixture_u64(&fixture.flat_to_burn_atoms),
            &series,
            fixture_u64(&fixture.lower_tail_max_settlement_atomic),
            fixture_u64(&fixture.upper_tail_min_settlement_atomic),
        )
        .unwrap();
        let expected_required = fixture
            .expected_required_claim_atoms
            .iter()
            .map(|value| fixture_u64(value))
            .collect::<Vec<_>>();
        assert_eq!(
            preview.required_claim_atoms.as_slice(),
            expected_required,
            "{}",
            fixture.name
        );
        assert_eq!(
            preview.reserve_before_atoms,
            fixture_u64(&fixture.expected_reserve_before_atoms),
            "{}",
            fixture.name
        );
        assert_eq!(
            preview.reserve_after_atoms,
            fixture_u64(&fixture.expected_reserve_after_atoms),
            "{}",
            fixture.name
        );
        assert_eq!(
            preview.reserve_released_atoms,
            fixture_u64(&fixture.expected_reserve_released_atoms),
            "{}",
            fixture.name
        );
        assert_eq!(
            preview.statewise_safe_withdrawal_atoms,
            fixture_u64(&fixture.expected_statewise_safe_withdrawal_atoms),
            "{}",
            fixture.name
        );
        assert_eq!(
            preview.statewise_binding_settlement_atomic,
            fixture_u64(&fixture.expected_statewise_binding_settlement_atomic),
            "{}",
            fixture.name
        );
        assert_eq!(
            preview.withdrawal_atoms,
            fixture_u64(&fixture.expected_withdrawal_atoms),
            "{}",
            fixture.name
        );
    }

    for fixture in fixtures.settlement_cases {
        let series = fixture
            .series
            .iter()
            .map(fixture_series)
            .collect::<Vec<_>>();
        let (liabilities, total) =
            settlement_series_liabilities(&series, fixture_u64(&fixture.settlement_price_atomic))
                .unwrap();
        let expected = fixture
            .expected_series_liability_atoms
            .iter()
            .map(|value| fixture_u64(value))
            .collect::<Vec<_>>();
        assert_eq!(liabilities.as_slice(), expected, "{}", fixture.name);
        assert_eq!(
            total,
            fixture_u64(&fixture.expected_long_liability_atoms),
            "{}",
            fixture.name
        );
        for chunk in fixture.claim_chunks {
            let index = usize::try_from(fixture_u64(&chunk.series_index)).unwrap();
            let allocation = cumulative_allocation_delta(
                series[index].external_oi_atoms,
                fixture_u64(&chunk.remaining_before_atoms),
                fixture_u64(&chunk.consumed_atoms),
                liabilities.values[index],
            )
            .unwrap();
            assert_eq!(
                allocation,
                fixture_u64(&chunk.expected_allocation_atoms),
                "{} series {}",
                fixture.name,
                index
            );
        }
    }
}

prop_compose! {
    fn arb_series()
        (kind in any::<bool>(), a in 1u64..40, width in 1u64..12, quantity in 0u64..3_000_000)
        -> WriterSeries
    {
        if kind {
            call(a, a + width, quantity)
        } else {
            put(a + width, a, quantity)
        }
    }
}

fn arb_unique_series(max_len: usize) -> impl Strategy<Value = Vec<WriterSeries>> {
    prop::collection::vec(arb_series(), 1..=max_len).prop_filter(
        "writer books use one canonical record per payoff instrument",
        |series| {
            series.iter().enumerate().all(|(index, item)| {
                !series[..index]
                    .iter()
                    .any(|previous| item.same_instrument(previous))
            })
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn aggregate_ceiling_matches_one_complete_book_division(
        series in arb_unique_series(8),
        settlement in 0u64..60,
    ) {
        let numerator = aggregate_liability_numerator(&series, settlement).unwrap();
        let scale = u128::from(WRITER_CONTRACT_ATOMIC_SCALE);
        let expected = u64::try_from(
            numerator / scale + u128::from(!numerator.is_multiple_of(scale)),
        ).unwrap();
        let per_series_ceiling_mutant = series.iter().map(|item| {
            aggregate_liability(core::slice::from_ref(item), settlement).unwrap()
        }).sum::<u64>();
        prop_assert_eq!(aggregate_liability(&series, settlement).unwrap(), expected);
        prop_assert!(per_series_ceiling_mutant >= expected);
    }

    #[test]
    fn candidate_reserve_matches_independent_full_grid(
        series in arb_unique_series(8),
        lower in 0u64..20,
        tail_width in 1u64..30,
    ) {
        let upper = lower + tail_width;
        let candidate = exact_reserve(&series, lower, upper).unwrap();
        let maximum_breakpoint = series.iter().fold(upper, |largest, item| {
            largest.max(item.strike_price_atomic).max(item.cap_price_atomic)
        });
        let brute = brute_force_reserve(&series, maximum_breakpoint + 2);
        prop_assert_eq!(candidate.reserve_atoms, brute);
        let canonical_points = canonical_candidate_points(&series, lower, upper).unwrap();
        let canonical_binding = canonical_points.as_slice().iter().copied().find(|settlement| {
            aggregate_liability(&series, *settlement).unwrap() == brute
        }).unwrap();
        prop_assert_eq!(candidate.reserve_settlement_atomic, canonical_binding);
        for settlement in 0..=maximum_breakpoint + 2 {
            prop_assert!(aggregate_liability(&series, settlement).unwrap() <= candidate.reserve_atoms);
        }
    }

    #[test]
    fn gross_security_upper_bounds_the_exact_external_envelope(
        series in arb_unique_series(8),
        lower in 0u64..20,
        tail_width in 1u64..30,
    ) {
        let reserve = exact_reserve(&series, lower, lower + tail_width).unwrap();
        let gross = gross_external_maximum_payout(&series).unwrap();
        prop_assert!(reserve.reserve_atoms <= gross);
        prop_assert_eq!(
            security_exposure(
                WriterSecurityMode::ExactExternalEnvelope,
                &series,
                reserve.reserve_atoms,
            ).unwrap(),
            reserve.reserve_atoms,
        );
    }

    #[test]
    fn proportional_basket_never_under_retires(
        series in arb_unique_series(8),
        flat_supply in 2u64..=10_000_000,
        burn_seed in any::<u64>(),
    ) {
        let burn = burn_seed % (flat_supply - 1) + 1;
        let basket = proportional_close_basket(&series, flat_supply, burn).unwrap();
        for (item, required) in series.iter().zip(basket.as_slice()) {
            let retired_scaled = u128::from(*required) * u128::from(flat_supply);
            let exact_scaled = u128::from(item.external_oi_atoms) * u128::from(burn);
            prop_assert!(retired_scaled >= exact_scaled);
            prop_assert!(retired_scaled - exact_scaled < u128::from(flat_supply));
            prop_assert!(*required <= item.external_oi_atoms);
        }
    }

    #[test]
    fn statewise_close_ceiling_matches_every_settlement_atom(
        series in arb_unique_series(6),
        lower in 0u64..20,
        tail_width in 1u64..30,
        flat_supply in 2u64..=10_000_000,
        burn_seed in any::<u64>(),
    ) {
        let upper = lower + tail_width;
        let burn = burn_seed % (flat_supply - 1) + 1;
        let after = post_basket_book(&series, flat_supply, burn);
        let reserve = exact_reserve(&series, lower, upper).unwrap();
        let assets = reserve.reserve_atoms.checked_add(100).unwrap();
        let candidates = canonical_candidate_points(&series, lower, upper).unwrap();
        let production = statewise_safe_withdrawal(
            assets,
            flat_supply,
            burn,
            &series,
            &after,
            &candidates,
        ).unwrap();
        let maximum_breakpoint = series.iter().fold(upper, |largest, item| {
            largest.max(item.strike_price_atomic).max(item.cap_price_atomic)
        });
        let brute = brute_force_safe_withdrawal(
            assets,
            flat_supply,
            burn,
            &series,
            &after,
            maximum_breakpoint + 2,
        );
        prop_assert_eq!(production, brute);
    }

    #[test]
    fn issue_capacity_is_monotone_when_all_independent_headroom_increases(
        width in 1u64..13,
        existing_contracts in 0u64..5,
        low_capacity in 0u64..80,
        added_capacity in 0u64..80,
        maximum_contracts in 0u64..13,
    ) {
        let series = [call(
            10,
            10 + width,
            existing_contracts * WRITER_CONTRACT_ATOMIC_SCALE,
        )];
        let limits = |capacity| WriterIssueAdmissionLimits {
            security_mode: WriterSecurityMode::ExactExternalEnvelope,
            security_cap_atoms: capacity,
            accounted_asset_atoms: capacity,
            locked_primary_premium_atoms: 0,
            writer_principal_atoms: capacity.max(1),
            operational_buffer_atoms: 0,
            worst_drawdown_limit: WRITER_RATIO_SCALE_PPM,
            lower_drawdown_limit: WRITER_RATIO_SCALE_PPM,
            upper_drawdown_limit: WRITER_RATIO_SCALE_PPM,
            lower_tail_max_settlement_atomic: 0,
            upper_tail_min_settlement_atomic: 10 + width,
        };
        let maximum = maximum_contracts * WRITER_CONTRACT_ATOMIC_SCALE;
        let low = maximum_safe_issue_quantity(&series, 0, 0, maximum, limits(low_capacity)).unwrap();
        let high = maximum_safe_issue_quantity(
            &series,
            0,
            0,
            maximum,
            limits(low_capacity + added_capacity),
        ).unwrap();
        prop_assert!(high >= low);
    }

    #[test]
    fn one_pass_issue_admission_matches_random_full_recomputation(
        series in arb_unique_series(8),
        lower in 0u64..20,
        tail_width in 1u64..30,
        series_seed in any::<usize>(),
        bid_price_per_contract_atoms in 1u64..16,
        maximum_contracts in 0u64..13,
        security_headroom in 0u64..101,
        exact_security in any::<bool>(),
    ) {
        let upper = lower + tail_width;
        let base_reserve = exact_reserve(&series, lower, upper).unwrap();
        let security_mode = if exact_security {
            WriterSecurityMode::ExactExternalEnvelope
        } else {
            WriterSecurityMode::GrossExternalMaximumPayout
        };
        let base_exposure = security_exposure(
            security_mode,
            &series,
            base_reserve.reserve_atoms,
        ).unwrap();
        let limits = WriterIssueAdmissionLimits {
            security_mode,
            security_cap_atoms: base_exposure + security_headroom,
            accounted_asset_atoms: base_reserve.reserve_atoms + 10,
            locked_primary_premium_atoms: base_reserve.reserve_atoms,
            writer_principal_atoms: 10,
            operational_buffer_atoms: 10,
            worst_drawdown_limit: WRITER_RATIO_SCALE_PPM,
            lower_drawdown_limit: WRITER_RATIO_SCALE_PPM,
            upper_drawdown_limit: WRITER_RATIO_SCALE_PPM,
            lower_tail_max_settlement_atomic: lower,
            upper_tail_min_settlement_atomic: upper,
        };
        let series_index = series_seed % series.len();
        let maximum = maximum_contracts * WRITER_CONTRACT_ATOMIC_SCALE;
        prop_assert_eq!(
            maximum_safe_issue_quantity(
                &series,
                series_index,
                bid_price_per_contract_atoms,
                maximum,
                limits,
            ).unwrap(),
            brute_force_safe_issue(
                &series,
                series_index,
                bid_price_per_contract_atoms,
                maximum,
                limits,
            ),
        );
    }
}
