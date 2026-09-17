use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_close_oracle_month_rejects_incomplete_openings() {
    let mut harness = setup_harness().await;
    let admin = harness.context.payer.pubkey();
    let program_id = light_token_minter::id();

    let market_id = [81u8; 32];
    let underlying_id = [82u8; 32];
    let expiry_ts = 4_000_000_000;
    let instrument = InstrumentDefinition {
        underlying_id,
        expiry_ts,
        strike_price: 100_000_000,
        cap_price: 125_000_000,
        contract_size: 10,
        max_payout_per_contract: 250,
        kind: OptionKind::CallSpread,
        settlement: SettlementStyle::CashSettledMonthly,
    };
    let market_params = MarketParameters {
        tick_size: 1,
        lot_size: 10,
        min_order_qty: 10,
        min_cancel_slots: 0,
        max_fills_per_instruction: 1,
    };
    let (market_pda, market_bump) =
        find_current_program_address(&[MARKET_PDA_SEED, &market_id], &program_id);
    let (month_pda, month_bump) = find_current_program_address(
        &[
            ORACLE_MONTH_PDA_SEED,
            market_pda.as_ref(),
            &expiry_ts.to_le_bytes(),
        ],
        &program_id,
    );
    let (settlement_pda, settlement_bump, settlement_month) =
        test_settlement_v2_pda(&program_id, &market_pda, expiry_ts);
    assert_eq!(settlement_month, month_pda);

    set_program_state(
        &mut harness.context,
        market_pda,
        &Market {
            is_initialized: true,
            bump: market_bump,
            created_by: admin,
            market_id,
            collateral_mint: harness.usdc_mint,
            long_contract_mint: None,
            instrument,
            params: market_params,
            total_position_collateral_locked: 0,
            paused: false,
            mint_accounting: MarketMintAccounting::canonical_empty(),
        },
        Market::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        month_pda,
        &stamp_current_oracle_month(OracleMonthState {
            is_initialized: true,
            bump: month_bump,
            market: market_pda,
            authority: admin,
            scramble_start_ts: 1,
            listing_ts: 1 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            phase: OraclePhase::Game,
            source_count: 1,
            frozen_source_count: 1,
            opened_source_count: 0,
            opening_resolved_source_count: 0,
            recipe_hash: [84u8; 32],
            settlement_base_oracle_atomic: 100,
            index_delta_bps: 1_000,
            settlement_status: OracleSettlementStatus::Final,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: [85u8; 32],
            ..OracleMonthState::default()
        }),
        OracleMonthState::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        settlement_pda,
        &test_settlement_record_v2(
            settlement_bump,
            market_pda,
            settlement_month,
            underlying_id,
            expiry_ts,
            110_000_000,
            [85u8; 32],
            admin,
        ),
        SettlementRecordV2::LEN,
    )
    .await;

    let incomplete_close_err = send_ix(
        &mut harness.context,
        close_oracle_month_ix(
            admin,
            harness.vault_pda,
            market_pda,
            month_pda,
            settlement_pda,
        ),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(incomplete_close_err, VaultError::InvalidOracleState);

    let month_after_failed_close: OracleMonthState =
        read_program_state(&mut harness.context, month_pda).await;
    assert_eq!(month_after_failed_close.phase, OraclePhase::Game);
    assert_eq!(month_after_failed_close.settlement_record, None);
}
