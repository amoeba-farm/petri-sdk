use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_oracle_month_finalization_enforces_full_grace_without_mutation() {
    let mut harness = setup_harness().await;
    let program_id = light_token_minter::id();
    let admin = harness.context.payer.pubkey();
    let now = u64::try_from(
        harness
            .context
            .banks_client
            .get_sysvar::<solana_sdk::clock::Clock>()
            .await
            .unwrap()
            .unix_timestamp,
    )
    .unwrap();
    let expiry_ts = now + 20;
    let market_id = [146u8; 32];
    let (market, market_bump) =
        find_current_program_address(&[MARKET_PDA_SEED, &market_id], &program_id);
    let (month, month_bump) = find_current_program_address(
        &[
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry_ts.to_le_bytes(),
        ],
        &program_id,
    );
    set_program_state(
        &mut harness.context,
        market,
        &Market {
            is_initialized: true,
            bump: market_bump,
            created_by: admin,
            market_id,
            collateral_mint: harness.usdc_mint,
            long_contract_mint: None,
            instrument: InstrumentDefinition {
                underlying_id: [147u8; 32],
                expiry_ts,
                strike_price: 100_000_000,
                cap_price: 125_000_000,
                contract_size: 10,
                max_payout_per_contract: 250,
                kind: OptionKind::CallSpread,
                settlement: SettlementStyle::CashSettledMonthly,
            },
            params: MarketParameters {
                tick_size: 1,
                lot_size: 10,
                min_order_qty: 10,
                min_cancel_slots: 0,
                max_fills_per_instruction: 1,
            },
            total_position_collateral_locked: 0,
            paused: false,
            mint_accounting: MarketMintAccounting::canonical_empty(),
        },
        Market::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        month,
        &stamp_current_oracle_month(OracleMonthState {
            is_initialized: true,
            bump: month_bump,
            market,
            authority: admin,
            scramble_start_ts: 1,
            listing_ts: 1 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            phase: OraclePhase::Game,
            source_count: 3,
            frozen_source_count: 3,
            opened_source_count: 3,
            opening_resolved_source_count: 3,
            recipe_hash: [149u8; 32],
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: [150u8; 32],
            active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
            active_weight_group_count: 1,
            active_weight_manifest_hash: [151u8; 32],
            ..OracleMonthState::default()
        }),
        OracleMonthState::LEN,
    )
    .await;
    let bucket_id = [148u8; 32];
    let (bucket, bucket_bump) = derive_oracle_bucket_median_pda(&program_id, &month, &bucket_id);
    set_program_state(
        &mut harness.context,
        bucket,
        &OracleBucketMedianState {
            is_initialized: true,
            bump: bucket_bump,
            account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketMedianState::ACCOUNT_VERSION,
            month,
            bucket_id,
            group_index: 0,
            bucket_weight_bps: 10_000,
            frozen_source_count: 3,
            active_source_count: 3,
            eligible_source_count: 3,
            status: OracleBucketMedianStatus::SettlementReady,
            last_recomputed_ts: expiry_ts,
            source_snapshot_hash: [152u8; 32],
            ..OracleBucketMedianState::default()
        },
        OracleBucketMedianState::LEN,
    )
    .await;
    let before: OracleMonthState = read_program_state(&mut harness.context, month).await;

    for target in [
        now,
        expiry_ts - 1,
        expiry_ts,
        expiry_ts + ORACLE_SETTLEMENT_GRACE_SECONDS - 1,
    ] {
        warp_to_unix_timestamp_at_least(&mut harness.context, target).await;
        let err = send_ix(
            &mut harness.context,
            finalize_oracle_month_ix(harness.user.pubkey(), market, month, &[bucket]),
            &[&harness.user],
        )
        .await
        .unwrap_err();
        assert_custom_error(err, VaultError::SettlementGracePeriodActive);
        assert_eq!(
            read_program_state::<OracleMonthState>(&mut harness.context, month).await,
            before
        );
    }

    let ready_at = expiry_ts + ORACLE_SETTLEMENT_GRACE_SECONDS;
    warp_to_unix_timestamp_at_least(&mut harness.context, ready_at).await;
    send_ix(
        &mut harness.context,
        finalize_oracle_month_ix(harness.user.pubkey(), market, month, &[bucket]),
        &[&harness.user],
    )
    .await
    .unwrap();
    let finalized: OracleMonthState = read_program_state(&mut harness.context, month).await;
    assert_eq!(finalized.settlement_status, OracleSettlementStatus::Final);
    assert_eq!(finalized.finalized_at_ts, ready_at);
}
