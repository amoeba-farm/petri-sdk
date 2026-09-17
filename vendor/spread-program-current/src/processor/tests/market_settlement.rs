use super::*;

#[test]
fn neutral_one_unit_pairs_have_symmetric_twelve_usdc_max_payout() {
    let approved: [(OptionKind, u64, u64, u64); 4] = [
        (OptionKind::CallSpread, 100_000_000, 112_000_000, 1_000_000),
        (OptionKind::PutSpread, 100_000_000, 88_000_000, 1_000_000),
        (OptionKind::CallSpread, 100_000_000, 112_000_000, 1_000_000),
        (OptionKind::PutSpread, 100_000_000, 88_000_000, 1_000_000),
    ];

    for (kind, strike, cap, contract_size) in approved {
        let spread_width = strike.abs_diff(cap);
        assert_eq!(
            scaled_contract_payout(spread_width, contract_size),
            Ok(12_000_000)
        );
        assert_eq!(
            validate_instrument_definition(&six_decimal_spread_instrument(
                kind,
                strike,
                cap,
                contract_size,
                12_000_000,
            )),
            Ok(())
        );
    }
}

#[test]
fn current_market_parameters_lock_one_contract_lots_and_the_five_cent_grid() {
    let params = crate::state::MarketParameters {
        tick_size: 50_000,
        lot_size: 1,
        min_order_qty: 1,
        min_cancel_slots: 32,
        max_fills_per_instruction: 8,
    };
    assert_eq!(validate_market_parameters(&params, 12_000_000), Ok(()));

    let mut one_cent = params.clone();
    one_cent.tick_size = crate::constants::AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC / 5;
    assert_eq!(
        validate_market_parameters(&one_cent, 12_000_000),
        Err(ProgramError::Custom(VaultError::InvalidMarketConfig as u32))
    );
    let mut ten_contract_lot = params.clone();
    ten_contract_lot.lot_size = 10;
    assert_eq!(
        validate_market_parameters(&ten_contract_lot, 12_000_000),
        Err(ProgramError::Custom(VaultError::InvalidMarketConfig as u32))
    );
}

#[test]
fn six_decimal_contract_payout_floors_and_fails_closed_at_boundaries() {
    assert_eq!(scaled_contract_payout(1, 999_999), Ok(0));
    assert_eq!(scaled_contract_payout(1, 1_000_000), Ok(1));
    assert_eq!(scaled_contract_payout(1, 1_999_999), Ok(1));
    assert_eq!(scaled_contract_payout(u64::MAX, 1_000_000), Ok(u64::MAX));
    assert_eq!(
        scaled_contract_payout(u64::MAX, 1_000_001),
        Err(ProgramError::Custom(VaultError::ArithmeticOverflow as u32))
    );

    let zero_after_scaling =
        six_decimal_spread_instrument(OptionKind::CallSpread, 100, 101, 999_999, 1);
    assert_eq!(
        validate_instrument_definition(&zero_after_scaling),
        Err(ProgramError::Custom(VaultError::InvalidMarketConfig as u32))
    );

    let mismatched_max = six_decimal_spread_instrument(
        OptionKind::CallSpread,
        104_250_000,
        116_250_000,
        25_000_000,
        299_999_999,
    );
    assert_eq!(
        validate_instrument_definition(&mismatched_max),
        Err(ProgramError::Custom(VaultError::InvalidMarketConfig as u32))
    );

    let noncanonical_overflowing_scale =
        six_decimal_spread_instrument(OptionKind::CallSpread, 0, u64::MAX, 1_000_001, 1);
    assert_eq!(
        validate_instrument_definition(&noncanonical_overflowing_scale),
        Err(ProgramError::Custom(VaultError::InvalidMarketConfig as u32))
    );
}

#[test]
fn current_instrument_rejects_noncanonical_contract_size_on_chain() {
    let canonical = six_decimal_spread_instrument(
        OptionKind::CallSpread,
        100_000_000,
        112_000_000,
        1_000_000,
        12_000_000,
    );
    assert_eq!(validate_instrument_definition(&canonical), Ok(()));
    for contract_size in [999_999, 1_000_001] {
        let mut malformed = canonical.clone();
        malformed.contract_size = contract_size;
        malformed.max_payout_per_contract =
            scaled_contract_payout(12_000_000, contract_size).unwrap();
        assert_eq!(
            validate_instrument_definition(&malformed),
            Err(ProgramError::Custom(VaultError::InvalidMarketConfig as u32))
        );
    }
}

#[test]
fn vault_initializer_is_restricted_to_bootstrap_authority() {
    assert!(is_authorized_vault_initializer(
        &VAULT_CONFIG_BOOTSTRAP_AUTHORITY
    ));
    assert!(!is_authorized_vault_initializer(&Pubkey::new_unique()));

    let source = PROCESSOR_SOURCE;
    let initialize_source = top_level_function_source(source, "process_initialize");
    assert!(initialize_source.contains("is_authorized_vault_initializer(admin_info.key)"));
    assert!(initialize_source.contains("VaultError::Unauthorized"));
}

#[test]
fn settlement_v2_identity_is_scoped_to_market_and_oracle_month() {
    let program_id = Pubkey::new_unique();
    let market_a = Pubkey::new_unique();
    let market_b = Pubkey::new_unique();
    let oracle_month_a = Pubkey::new_unique();
    let oracle_month_b = Pubkey::new_unique();

    let (record_a, _) = derive_settlement_v2_pda(&program_id, &market_a, &oracle_month_a);
    let (record_b, _) = derive_settlement_v2_pda(&program_id, &market_b, &oracle_month_b);

    assert_ne!(record_a, record_b);
}

#[test]
fn settlement_v2_rewrite_requires_identical_signed_semantics_and_provenance() {
    let market = Pubkey::new_unique();
    let oracle_month = Pubkey::new_unique();
    let submitter = Pubkey::new_unique();
    let leaf = CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month,
        recipe_hash: [4; 32],
        underlying_id: [5; 32],
        item_id: "ramx".to_string(),
        expiry_id: "NOV26".to_string(),
        settlement_ts: 1_796_083_200,
        price_display_decimals: 2,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 0,
        observations: vec![],
        settlement_price_atomic: 10_500,
        source_uri: "https://oracle.example/ramx/NOV26".to_string(),
        source_digest: [6; 32],
        base_oracle_atomic: 10_000,
        index_delta_bps: 500,
        submitted_by: submitter,
        submitted_slot: 77,
        signer_set_version: 1,
        signer_set_hash: [7; 32],
    };
    let commitment = settlement_signed_leaf_commitment(&leaf).expect("commitment");
    let record =
        settlement_record_v2_from_leaf(1, market, oracle_month, &leaf, commitment, submitter);

    assert!(settlement_record_v2_matches_submission(
        &record,
        &market,
        &oracle_month,
        &leaf,
        &commitment,
        &submitter,
    ));

    let mut conflicting = leaf.clone();
    conflicting.settlement_price_atomic += 1;
    let conflicting_commitment =
        settlement_signed_leaf_commitment(&conflicting).expect("conflicting commitment");
    assert!(!settlement_record_v2_matches_submission(
        &record,
        &market,
        &oracle_month,
        &conflicting,
        &conflicting_commitment,
        &submitter,
    ));
    assert!(!settlement_record_v2_matches_submission(
        &record,
        &Pubkey::new_unique(),
        &oracle_month,
        &leaf,
        &commitment,
        &submitter,
    ));
    assert!(!settlement_record_v2_matches_submission(
        &record,
        &market,
        &oracle_month,
        &leaf,
        &commitment,
        &Pubkey::new_unique(),
    ));
    let mut forged_timestamp = leaf.clone();
    forged_timestamp.settlement_ts += 1;
    let forged_timestamp_commitment =
        settlement_signed_leaf_commitment(&forged_timestamp).expect("forged commitment");
    assert!(!settlement_record_v2_matches_submission(
        &record,
        &market,
        &oracle_month,
        &forged_timestamp,
        &forged_timestamp_commitment,
        &submitter,
    ));
}

#[test]
fn settlement_grace_is_checked_by_upsert_finalize_and_collective_group_publication() {
    let source = PROCESSOR_SOURCE;
    let upsert = top_level_function_source(source, "process_upsert_settlement");
    let binding = upsert
        .find("validate_settlement_market_binding")
        .expect("upsert binds settlement to market expiry");
    let grace = upsert
        .find("ensure_settlement_finalization_ready")
        .expect("upsert enforces settlement grace");
    let signatures = upsert
        .find("verify_settlement_oracle_attestations")
        .expect("upsert verifies signer quorum");
    let create = upsert
        .find("load_or_create_settlement_record_v2")
        .expect("upsert creates or loads record");
    assert!(binding < grace && grace < signatures && signatures < create);

    let finalize = top_level_function_source(source, "process_finalize_oracle_month");
    assert!(finalize.contains("ensure_settlement_finalization_ready_at"));

    for consumer in [
        "process_close_oracle_month",
        "process_publish_writer_group_settlement",
    ] {
        let body = top_level_function_source(source, consumer);
        assert!(
            body.contains("load_valid_settlement_record_v2"),
            "{consumer} must use the grace-enforcing canonical settlement loader"
        );
    }
}
