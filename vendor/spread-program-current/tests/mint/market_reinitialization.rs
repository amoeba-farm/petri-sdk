use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_init_market_rejects_reinitialization_after_issuance_and_settlement() {
    let mut harness = setup_harness().await;
    let admin = harness.context.payer.pubkey();

    let issued_market_id = [90u8; 32];
    let issued_underlying_id = [91u8; 32];
    let (issued_market_pda, _) = find_current_program_address(
        &[MARKET_PDA_SEED, &issued_market_id],
        &light_token_minter::id(),
    );
    let issued_params = InitMarketV2Params {
        market_id: issued_market_id,
        instrument: InstrumentDefinition {
            underlying_id: issued_underlying_id,
            expiry_ts: 4_000_000_000,
            strike_price: 100_000_000,
            cap_price: 112_000_000,
            contract_size: 1_000_000,
            max_payout_per_contract: 12_000_000,
            kind: OptionKind::CallSpread,
            settlement: SettlementStyle::CashSettledMonthly,
        },
        params: MarketParameters {
            tick_size: 50_000,
            lot_size: 1,
            min_order_qty: 1,
            min_cancel_slots: 4,
            max_fills_per_instruction: 8,
        },
        collateral_mint: harness.usdc_mint,
    };
    send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            issued_market_pda,
            harness.vault_pda,
            issued_params.clone(),
        ),
        &[],
    )
    .await
    .unwrap();

    let mut issued_market: Market =
        read_program_state(&mut harness.context, issued_market_pda).await;
    issued_market.total_position_collateral_locked = 750;
    set_program_state(
        &mut harness.context,
        issued_market_pda,
        &issued_market,
        Market::LEN,
    )
    .await;

    let mut replacement_params = issued_params.clone();
    replacement_params.instrument.strike_price = 200_000_000;
    replacement_params.instrument.cap_price = 212_000_000;
    replacement_params.instrument.max_payout_per_contract = 12_000_000;
    let issued_err = send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            issued_market_pda,
            harness.vault_pda,
            replacement_params,
        ),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(issued_err, VaultError::AlreadyInitialized);
    let issued_market_after: Market =
        read_program_state(&mut harness.context, issued_market_pda).await;
    assert_eq!(issued_market_after, issued_market);

    let settled_market_id = [92u8; 32];
    let settled_underlying_id = [93u8; 32];
    let settled_expiry_ts = 4_100_000_000;
    let (settled_market_pda, _) = find_current_program_address(
        &[MARKET_PDA_SEED, &settled_market_id],
        &light_token_minter::id(),
    );
    let settled_params = InitMarketV2Params {
        market_id: settled_market_id,
        instrument: InstrumentDefinition {
            underlying_id: settled_underlying_id,
            expiry_ts: settled_expiry_ts,
            strike_price: 150_000_000,
            cap_price: 162_000_000,
            contract_size: 1_000_000,
            max_payout_per_contract: 12_000_000,
            kind: OptionKind::CallSpread,
            settlement: SettlementStyle::CashSettledMonthly,
        },
        params: issued_params.params,
        collateral_mint: harness.usdc_mint,
    };
    send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            settled_market_pda,
            harness.vault_pda,
            settled_params.clone(),
        ),
        &[],
    )
    .await
    .unwrap();
    let settled_market: Market = read_program_state(&mut harness.context, settled_market_pda).await;

    let (settlement_pda, settlement_bump, settlement_month) = test_settlement_v2_pda(
        &light_token_minter::id(),
        &settled_market_pda,
        settled_expiry_ts,
    );
    let settlement = test_settlement_record_v2(
        settlement_bump,
        settled_market_pda,
        settlement_month,
        settled_underlying_id,
        settled_expiry_ts,
        320_000_000,
        [94u8; 32],
        admin,
    );
    set_program_state(
        &mut harness.context,
        settlement_pda,
        &settlement,
        SettlementRecordV2::LEN,
    )
    .await;

    let mut settled_replacement_params = settled_params;
    settled_replacement_params.instrument.expiry_ts = 4_200_000_000;
    settled_replacement_params.instrument.strike_price = 400_000_000;
    settled_replacement_params.instrument.cap_price = 412_000_000;
    settled_replacement_params
        .instrument
        .max_payout_per_contract = 12_000_000;
    let settled_err = send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            settled_market_pda,
            harness.vault_pda,
            settled_replacement_params,
        ),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(settled_err, VaultError::AlreadyInitialized);
    let settled_market_after: Market =
        read_program_state(&mut harness.context, settled_market_pda).await;
    let settlement_after: SettlementRecordV2 =
        read_program_state(&mut harness.context, settlement_pda).await;
    assert_eq!(settled_market_after, settled_market);
    assert_eq!(settlement_after, settlement);
}
