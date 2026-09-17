use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_tag2_rejects_authority_rotation_and_original_admin_controls_market_pause() {
    let mut harness = setup_harness().await;
    let original_admin = harness.context.payer.pubkey();
    let rejected_admin = Keypair::new();

    let market_id = [201u8; 32];
    let (market_pda, _) =
        find_current_program_address(&[MARKET_PDA_SEED, &market_id], &light_token_minter::id());
    send_ix(
        &mut harness.context,
        init_market_ix(
            original_admin,
            market_pda,
            harness.vault_pda,
            InitMarketV2Params {
                market_id,
                instrument: InstrumentDefinition {
                    underlying_id: [202u8; 32],
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
                    min_cancel_slots: 0,
                    max_fills_per_instruction: 8,
                },
                collateral_mint: harness.usdc_mint,
            },
        ),
        &[],
    )
    .await
    .unwrap();

    let (contract_mint, _) = find_current_program_address(
        &[CONTRACT_MINT_PDA_SEED, market_pda.as_ref()],
        &light_token_minter::id(),
    );
    set_test_mint_account(
        &mut harness.context,
        contract_mint,
        spl_token::id(),
        market_pda,
        0,
        6,
    )
    .await;
    let mut market: Market = read_program_state(&mut harness.context, market_pda).await;
    market.long_contract_mint = Some(contract_mint);
    set_program_state(&mut harness.context, market_pda, &market, Market::LEN).await;
    let (month_pda, month_bump) = find_current_program_address(
        &[
            ORACLE_MONTH_PDA_SEED,
            market_pda.as_ref(),
            &market.instrument.expiry_ts.to_le_bytes(),
        ],
        &light_token_minter::id(),
    );
    set_program_state(
        &mut harness.context,
        month_pda,
        &stamp_current_oracle_month(OracleMonthState {
            is_initialized: true,
            bump: month_bump,
            market: market_pda,
            authority: original_admin,
            scramble_start_ts: 1,
            listing_ts: 1 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            phase: OraclePhase::Game,
            frozen_source_count: 1,
            opened_source_count: 1,
            recipe_hash: [0x31; 32],
            opening_resolved_source_count: 1,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: [0x32; 32],
            ..OracleMonthState::default()
        }),
        OracleMonthState::LEN,
    )
    .await;
    let tag2_rotation_err = send_ix(
        &mut harness.context,
        update_ix(
            original_admin,
            harness.vault_pda,
            harness.usdc_mint,
            harness.vault_token_account,
            Some(rejected_admin.pubkey()),
            None,
            None,
            None,
            None,
        ),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        tag2_rotation_err,
        VaultError::SettlementSignerGovernanceRequired,
    );

    let stale_pause_err = send_ix(
        &mut harness.context,
        set_market_paused_ix(rejected_admin.pubkey(), harness.vault_pda, market_pda, true),
        &[&rejected_admin],
    )
    .await
    .unwrap_err();
    assert_custom_error(stale_pause_err, VaultError::Unauthorized);
    send_ix(
        &mut harness.context,
        set_market_paused_ix(original_admin, harness.vault_pda, market_pda, true),
        &[],
    )
    .await
    .unwrap();
    let paused_market: Market = read_program_state(&mut harness.context, market_pda).await;
    assert!(paused_market.paused);
    send_ix(
        &mut harness.context,
        set_market_unpaused_ix(original_admin, harness.vault_pda, market_pda, month_pda),
        &[],
    )
    .await
    .unwrap();
    let unpaused_market: Market = read_program_state(&mut harness.context, market_pda).await;
    assert!(!unpaused_market.paused);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_program_account_creation_tolerates_prefunding_and_rejects_squatted_targets() {
    let mut harness = setup_harness().await;
    let admin = harness.context.payer.pubkey();
    let usdc_mint = harness.usdc_mint;
    let market_params = |market_id: [u8; 32], underlying_id: [u8; 32]| InitMarketV2Params {
        market_id,
        instrument: InstrumentDefinition {
            underlying_id,
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
            min_cancel_slots: 0,
            max_fills_per_instruction: 8,
        },
        collateral_mint: usdc_mint,
    };

    let prefunded_market_id = [211u8; 32];
    let (prefunded_market, _) = find_current_program_address(
        &[MARKET_PDA_SEED, &prefunded_market_id],
        &light_token_minter::id(),
    );
    set_system_account_with_lamports(&mut harness.context, prefunded_market, 1).await;
    send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            prefunded_market,
            harness.vault_pda,
            market_params(prefunded_market_id, [212u8; 32]),
        ),
        &[],
    )
    .await
    .unwrap();
    let prefunded_market_account = harness
        .context
        .banks_client
        .get_account(prefunded_market)
        .await
        .unwrap()
        .expect("prefunded market is allocated and assigned");
    assert_eq!(prefunded_market_account.owner, light_token_minter::id());
    assert_eq!(prefunded_market_account.data.len(), Market::LEN);
    assert!(prefunded_market_account.lamports > 1);

    let foreign_market_id = [213u8; 32];
    let (foreign_market, _) = find_current_program_address(
        &[MARKET_PDA_SEED, &foreign_market_id],
        &light_token_minter::id(),
    );
    let foreign_owner = Pubkey::new_unique();
    let foreign_account = AccountSharedData::new(1, 0, &foreign_owner);
    harness
        .context
        .set_account(&foreign_market, &foreign_account);
    let foreign_err = send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            foreign_market,
            harness.vault_pda,
            market_params(foreign_market_id, [214u8; 32]),
        ),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(foreign_err, VaultError::InvalidPda);
    let foreign_after = harness
        .context
        .banks_client
        .get_account(foreign_market)
        .await
        .unwrap()
        .expect("foreign squatter remains unchanged");
    assert_eq!(foreign_after.owner, foreign_owner);
    assert_eq!(foreign_after.data.len(), 0);

    let data_market_id = [215u8; 32];
    let (data_market, _) = find_current_program_address(
        &[MARKET_PDA_SEED, &data_market_id],
        &light_token_minter::id(),
    );
    set_empty_account(
        &mut harness.context,
        data_market,
        &solana_sdk::system_program::id(),
        1,
    )
    .await;
    let data_err = send_ix(
        &mut harness.context,
        init_market_ix(
            admin,
            data_market,
            harness.vault_pda,
            market_params(data_market_id, [216u8; 32]),
        ),
        &[],
    )
    .await
    .unwrap_err();
    assert_custom_error(data_err, VaultError::InvalidPda);
    let data_after = harness
        .context
        .banks_client
        .get_account(data_market)
        .await
        .unwrap()
        .expect("data-bearing squatter remains unchanged");
    assert_eq!(data_after.owner, solana_sdk::system_program::id());
    assert_eq!(data_after.data.len(), 1);
}
