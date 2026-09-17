use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_unauthorized_signer_cannot_initialize_vault_config() {
    let mut program_test = ProgramTest::new(
        "light_token_minter",
        light_token_minter::id(),
        processor!(process_instruction),
    );
    program_test.prefer_bpf(false);
    let mut context = program_test.start_with_context().await;
    let unauthorized = context.payer.pubkey();
    let (vault_pda, _) = find_current_program_address(&[VAULT_PDA_SEED], &light_token_minter::id());

    let err = send_ix(
        &mut context,
        initialize_ix(
            unauthorized,
            vault_pda,
            solana_sdk::system_program::id(),
            solana_sdk::system_program::id(),
        ),
        &[],
    )
    .await
    .unwrap_err();

    assert_custom_error(err, VaultError::Unauthorized);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_paused_bootstrap_can_create_paused_market_but_cannot_move_value() {
    let mut harness = setup_harness().await;
    let program_id = light_token_minter::id();
    let admin = harness.context.payer.pubkey();
    set_vault_paused_fixture(&mut harness.context, harness.vault_pda, true).await;

    let market_id = [0x97; 32];
    let expiry_ts = 4_102_444_800;
    let (market_pda, _) = find_current_program_address(&[MARKET_PDA_SEED, &market_id], &program_id);
    send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            market_pda,
            harness.vault_pda,
            InitMarketV2Params {
                market_id,
                instrument: InstrumentDefinition {
                    underlying_id: [0x98; 32],
                    expiry_ts,
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
                    min_cancel_slots: 32,
                    max_fills_per_instruction: 8,
                },
                collateral_mint: harness.usdc_mint,
            },
        ),
        &[],
    )
    .await
    .unwrap();

    let config: VaultConfig = read_program_state(&mut harness.context, harness.vault_pda).await;
    let market: Market = read_program_state(&mut harness.context, market_pda).await;
    assert!(config.paused, "bootstrap must not activate the vault");
    assert!(market.paused, "new markets must remain fail-closed");

    let (month_pda, _) = find_current_program_address(
        &[
            ORACLE_MONTH_PDA_SEED,
            market_pda.as_ref(),
            &expiry_ts.to_le_bytes(),
        ],
        &program_id,
    );
    set_system_account_with_lamports(&mut harness.context, month_pda, 1).await;
    advance_program_test_blockhash(&mut harness.context).await;
    let activation_err = send_ix(
        &mut harness.context,
        set_market_unpaused_ix(admin, harness.vault_pda, market_pda, month_pda),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(activation_err, VaultError::ContractPaused);
    let still_paused: Market = read_program_state(&mut harness.context, market_pda).await;
    assert!(still_paused.paused);

    let user_before = token_balance(&mut harness.context, harness.user_token_account).await;
    let vault_before = token_balance(&mut harness.context, harness.vault_token_account).await;
    let value_flow_err = send_ix(
        &mut harness.context,
        deposit_ix(
            harness.user.pubkey(),
            harness.user_token_account,
            harness.vault_token_account,
            harness.vault_pda,
            harness.usdc_mint,
            1,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();
    assert_custom_error(value_flow_err, VaultError::ContractPaused);
    assert_eq!(
        token_balance(&mut harness.context, harness.user_token_account).await,
        user_before
    );
    assert_eq!(
        token_balance(&mut harness.context, harness.vault_token_account).await,
        vault_before
    );
}
