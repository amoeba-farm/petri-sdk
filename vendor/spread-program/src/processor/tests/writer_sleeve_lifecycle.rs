use super::*;
use crate::{
    constants::{WRITER_MAX_LIVE_SERIES, WRITER_RATIO_SCALE_PPM},
    state::{
        WriterAuctionPriorityRule, WriterPolicySnapshotV1, WriterReserveRoundingMode,
        WriterSecurityMode, WriterSeriesBookV1, WriterSeriesCustodyStatus, WriterSeriesRecordV1,
        WriterSeriesSettlementStatus, WriterSleeveStatus, WriterSleeveV1,
    },
    writer_sleeve_math::{
        aggregate_liability, cumulative_allocation_delta, proportional_close_preview,
    },
};

fn collective_record(
    id: u8,
    kind: OptionKind,
    strike: u64,
    cap_or_floor: u64,
) -> WriterSeriesRecordV1 {
    WriterSeriesRecordV1 {
        active: true,
        option_kind: kind,
        custody_status: WriterSeriesCustodyStatus::Absent,
        settlement_status: WriterSeriesSettlementStatus::Open,
        series_id: [id; 32],
        market: Pubkey::new_unique(),
        contract_mint: Pubkey::new_unique(),
        retirement_custody: Pubkey::new_unique(),
        strike_price_atomic: strike,
        cap_or_floor_price_atomic: cap_or_floor,
        contract_size_atoms: MarketMintAccounting::CANONICAL_ATOMIC_SCALE,
        max_payout_per_contract_atoms: strike.abs_diff(cap_or_floor),
        payoff_digest: [id.wrapping_add(40); 32],
        ..WriterSeriesRecordV1::EMPTY
    }
}

#[test]
fn collective_book_lifecycle_preserves_reserve_close_and_settlement_partitions() {
    let mut book = WriterSeriesBookV1 {
        is_initialized: true,
        account_discriminator: WriterSeriesBookV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterSeriesBookV1::ACCOUNT_VERSION,
        series_count: 2,
        max_series: WRITER_MAX_LIVE_SERIES as u8,
        frozen: true,
        ..WriterSeriesBookV1::default()
    };
    book.records[0] = collective_record(1, OptionKind::CallSpread, 100_000_000, 112_000_000);
    book.records[1] = collective_record(2, OptionKind::PutSpread, 100_000_000, 88_000_000);

    let policy_hash = [71; 32];
    let mut sleeve = WriterSleeveV1 {
        is_initialized: true,
        account_discriminator: WriterSleeveV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterSleeveV1::ACCOUNT_VERSION,
        policy_version: 1,
        policy_hash,
        writer_principal_atoms: 30_000_000,
        accounted_asset_atoms: 30_000_000,
        flat_par_supply_atoms: 30_000_000,
        series_count: 2,
        status: WriterSleeveStatus::Active,
        security_mode: WriterSecurityMode::GrossExternalMaxPayout,
        ..WriterSleeveV1::default()
    };
    let snapshot = WriterPolicySnapshotV1 {
        is_initialized: true,
        account_discriminator: WriterPolicySnapshotV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterPolicySnapshotV1::ACCOUNT_VERSION,
        policy_version: 1,
        policy_hash,
        scenario_set_hash: [72; 32],
        risk_limit_hash: [73; 32],
        series_family_hash: writer_sleeve::writer_series_family_hash(&book),
        security_mode: WriterSecurityMode::GrossExternalMaxPayout,
        reserve_rounding_mode: WriterReserveRoundingMode::AggregateBookCeiling,
        auction_priority_rule: WriterAuctionPriorityRule::PayAsBidPriceThenSeriesProRata,
        max_series: WRITER_MAX_LIVE_SERIES as u8,
        drawdown_scale: WRITER_RATIO_SCALE_PPM,
        worst_drawdown_limit: WRITER_RATIO_SCALE_PPM,
        upper_drawdown_limit: WRITER_RATIO_SCALE_PPM,
        lower_drawdown_limit: WRITER_RATIO_SCALE_PPM,
        lower_tail_max_settlement_atomic: 88_000_000,
        upper_tail_min_settlement_atomic: 112_000_000,
        operational_buffer_atoms: 1_000_000,
        max_auction_issue_atoms: 10_000_000,
        max_close_flat_atoms: 10_000_000,
        ..WriterPolicySnapshotV1::default()
    };

    // Funding/activation begins with no external liability and exactly one Flat atom per
    // contributed settlement atom.
    writer_sleeve::recompute_writer_metrics(&mut sleeve, &book, &snapshot, Some(40_000_000), true)
        .unwrap();
    assert_eq!(sleeve.exact_reserve_atoms, 0);
    assert_eq!(sleeve.security_exposure_atoms, 0);
    assert_eq!(sleeve.writer_principal_atoms, sleeve.flat_par_supply_atoms);

    // One accepted primary auction atomically creates external OI and locks the paid premium.
    book.records[0].external_open_interest_atoms = 2_000_000;
    book.records[0].total_physical_supply_atoms = 2_000_000;
    book.records[0].primary_premium_collected_atoms = 2_000_000;
    book.records[1].external_open_interest_atoms = 1_000_000;
    book.records[1].total_physical_supply_atoms = 1_000_000;
    book.records[1].primary_premium_collected_atoms = 1_000_000;
    sleeve.locked_primary_premium_atoms = 3_000_000;
    sleeve.accounted_asset_atoms = 33_000_000;
    writer_sleeve::recompute_writer_metrics(&mut sleeve, &book, &snapshot, Some(40_000_000), true)
        .unwrap();
    assert_eq!(sleeve.exact_reserve_atoms, 24_000_000);
    assert_eq!(sleeve.lower_tail_reserve_atoms, 12_000_000);
    assert_eq!(sleeve.upper_tail_reserve_atoms, 24_000_000);
    assert_eq!(sleeve.security_exposure_atoms, 36_000_000);
    assert_eq!(
        sleeve.accounted_asset_atoms,
        sleeve.writer_principal_atoms + sleeve.locked_primary_premium_atoms
    );
    for record in book.records.iter().take(2) {
        assert_eq!(
            record.total_physical_supply_atoms,
            record.issuer_controlled_atoms + record.external_open_interest_atoms
        );
    }

    // A staged close becomes economic only at finalization: the whole-book basket moves from
    // external OI into issuer custody together, then the statewise-safe USDC amount is released.
    let before = writer_sleeve::writer_book_math_series(&book).unwrap();
    let close = proportional_close_preview(
        sleeve.accounted_asset_atoms,
        sleeve.flat_par_supply_atoms,
        10_000_000,
        &before,
        snapshot.lower_tail_max_settlement_atomic,
        snapshot.upper_tail_min_settlement_atomic,
    )
    .unwrap();
    assert_eq!(close.required_claim_atoms.values[0], 666_667);
    assert_eq!(close.required_claim_atoms.values[1], 333_334);
    assert!(close.withdrawal_atoms > 0);
    assert!(close.withdrawal_atoms <= 10_000_000);
    for index in 0..2 {
        let retired = close.required_claim_atoms.values[index];
        book.records[index].external_open_interest_atoms -= retired;
        book.records[index].issuer_controlled_atoms += retired;
        assert_eq!(
            book.records[index].total_physical_supply_atoms,
            book.records[index].issuer_controlled_atoms
                + book.records[index].external_open_interest_atoms
        );
    }
    sleeve.accounted_asset_atoms -= close.withdrawal_atoms;
    sleeve.writer_principal_atoms -= 10_000_000;
    sleeve.flat_par_supply_atoms -= 10_000_000;
    writer_sleeve::recompute_writer_metrics(&mut sleeve, &book, &snapshot, Some(40_000_000), true)
        .unwrap();
    assert_eq!(sleeve.exact_reserve_atoms, close.reserve_after_atoms);
    assert_eq!(
        sleeve.lower_tail_reserve_atoms,
        close.lower_tail_reserve_after_atoms
    );
    assert_eq!(
        sleeve.upper_tail_reserve_atoms,
        close.upper_tail_reserve_after_atoms
    );

    // Bounded cleanup burns only issuer-controlled claims and cannot alter external OI or reserve.
    let reserve_before_cleanup = sleeve.exact_reserve_atoms;
    for record in book.records.iter_mut().take(2) {
        record.total_physical_supply_atoms -= record.issuer_controlled_atoms;
        record.issuer_controlled_atoms = 0;
        record.custody_status = WriterSeriesCustodyStatus::Absent;
        assert_eq!(
            record.total_physical_supply_atoms,
            record.external_open_interest_atoms
        );
    }
    writer_sleeve::recompute_writer_metrics(&mut sleeve, &book, &snapshot, Some(40_000_000), true)
        .unwrap();
    assert_eq!(sleeve.exact_reserve_atoms, reserve_before_cleanup);

    // Final settlement freezes disjoint long and Flat ledgers. Their sum is the complete sleeve
    // asset ledger, and cumulative allocation sends deterministic dust to the final Flat claim.
    let settled_series = writer_sleeve::writer_book_math_series(&book).unwrap();
    let long_reserve = aggregate_liability(&settled_series, 112_000_000).unwrap();
    assert_eq!(long_reserve, sleeve.exact_reserve_atoms);
    let flat_residual = sleeve.accounted_asset_atoms - long_reserve;
    sleeve.long_liability_initial_atoms = long_reserve;
    sleeve.long_liability_remaining_atoms = long_reserve;
    sleeve.flat_residual_initial_atoms = flat_residual;
    sleeve.flat_residual_remaining_atoms = flat_residual;
    sleeve.flat_supply_snapshot_atoms = sleeve.flat_par_supply_atoms;
    sleeve.flat_claim_supply_remaining_atoms = sleeve.flat_par_supply_atoms;
    sleeve.status = WriterSleeveStatus::SettlementFinalized;
    assert_eq!(
        sleeve.long_liability_remaining_atoms + sleeve.flat_residual_remaining_atoms,
        sleeve.accounted_asset_atoms
    );

    let first_flat = 7_000_000;
    let second_flat = sleeve.flat_supply_snapshot_atoms - first_flat;
    let first_payout = cumulative_allocation_delta(
        sleeve.flat_supply_snapshot_atoms,
        sleeve.flat_supply_snapshot_atoms,
        first_flat,
        sleeve.flat_residual_initial_atoms,
    )
    .unwrap();
    let final_payout = cumulative_allocation_delta(
        sleeve.flat_supply_snapshot_atoms,
        second_flat,
        second_flat,
        sleeve.flat_residual_initial_atoms,
    )
    .unwrap();
    assert_eq!(
        first_payout + final_payout,
        sleeve.flat_residual_initial_atoms
    );
    assert_eq!(sleeve.long_liability_remaining_atoms, long_reserve);
}
