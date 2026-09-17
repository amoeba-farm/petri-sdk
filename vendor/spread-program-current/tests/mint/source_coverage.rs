use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_v5_source_rejection_invalidates_coverage_and_reopens_submission() {
    let mut harness = setup_harness().await;
    let program_id = light_token_minter::id();
    let admin = harness.context.payer.pubkey();
    let mut clock = harness
        .context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let now = 1_800_000_000u64;
    clock.unix_timestamp = now as i64;
    harness.context.set_sysvar(&clock);

    let scramble_start_ts = now - ORACLE_PLACEMENT_WINDOW_SECONDS - ORACLE_KILL_WINDOW_SECONDS;
    let listing_ts = scramble_start_ts + ORACLE_PRE_LISTING_WINDOW_SECONDS;
    let expiry_ts = listing_ts + 90 * ORACLE_CALENDAR_DAY_SECONDS;
    let market_id = [171u8; 32];
    let source_id = [172u8; 32];
    let sku_id = [173u8; 32];
    let challenge_id = [174u8; 32];
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
    let (source, source_bump) = find_current_program_address(
        &[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id],
        &program_id,
    );
    let (challenge, challenge_bump) = find_current_program_address(
        &[
            ORACLE_SOURCE_CHALLENGE_PDA_SEED,
            month.as_ref(),
            source.as_ref(),
            &challenge_id,
        ],
        &program_id,
    );
    let (guard, guard_bump) = light_token_minter::state::derive_oracle_source_challenge_guard_pda(
        &program_id,
        &month,
        &source,
    );
    let (coverage, coverage_bump) =
        light_token_minter::state::derive_oracle_sku_coverage_manifest_pda(&program_id, &month);
    let (coverage_record, coverage_record_bump) =
        light_token_minter::state::derive_oracle_sku_coverage_record_pda(
            &program_id,
            &month,
            &sku_id,
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
                underlying_id: [175u8; 32],
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
            scramble_start_ts,
            listing_ts,
            phase: OraclePhase::Scramble,
            source_count: 1,
            pending_resolution_count: 1,
            ..OracleMonthState::default()
        }),
        OracleMonthState::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        source,
        &OracleSourceState {
            is_initialized: true,
            bump: source_bump,
            month,
            source_id,
            bucket_id: sku_id,
            proposer: harness.user.pubkey(),
            listing_bond_locked: 500,
            support_stake_total: 1_000,
            status: OracleSourceStatus::Candidate,
            ..OracleSourceState::default()
        },
        OracleSourceState::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        challenge,
        &OracleSourceChallenge {
            is_initialized: true,
            bump: challenge_bump,
            month,
            challenge_id,
            source,
            source_id,
            challenger: harness.attacker.pubkey(),
            reason: 1,
            bond: 250,
            required_bond: 250,
            status: OracleChallengeStatus::RuleReview,
            evidence_hash: [176u8; 32],
            escrow_disposition: OracleEscrowDisposition::Unsettled,
            ..OracleSourceChallenge::default()
        },
        OracleSourceChallenge::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        guard,
        &light_token_minter::state::OracleSourceChallengeGuard {
            is_initialized: true,
            bump: guard_bump,
            account_discriminator:
                light_token_minter::state::OracleSourceChallengeGuard::ACCOUNT_DISCRIMINATOR,
            account_version: light_token_minter::state::OracleSourceChallengeGuard::ACCOUNT_VERSION,
            month,
            source,
            source_id,
            active_challenge: challenge,
            active_challenge_id: challenge_id,
            active_dispute: Pubkey::default(),
            last_updated_slot: 1,
        },
        light_token_minter::state::OracleSourceChallengeGuard::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        coverage,
        &light_token_minter::state::OracleSkuCoverageManifest {
            is_initialized: true,
            bump: coverage_bump,
            account_discriminator:
                light_token_minter::state::OracleSkuCoverageManifest::ACCOUNT_DISCRIMINATOR,
            account_version: light_token_minter::state::OracleSkuCoverageManifest::ACCOUNT_VERSION,
            month,
            required_sku_root: [177u8; 32],
            required_sku_count: 1,
            covered_sku_count: 1,
            planned_scramble_start_ts: scramble_start_ts,
            planned_listing_ts: listing_ts,
            coverage_finalized: true,
            coverage_complete_ts: now - 1,
            last_updated_slot: 1,
        },
        light_token_minter::state::OracleSkuCoverageManifest::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        coverage_record,
        &light_token_minter::state::OracleSkuCoverageRecord {
            is_initialized: true,
            bump: coverage_record_bump,
            account_discriminator:
                light_token_minter::state::OracleSkuCoverageRecord::ACCOUNT_DISCRIMINATOR,
            account_version: light_token_minter::state::OracleSkuCoverageRecord::ACCOUNT_VERSION,
            month,
            sku_id,
            sku_index: 0,
            active_supported_source_count: 1,
            last_updated_slot: 1,
        },
        light_token_minter::state::OracleSkuCoverageRecord::LEN,
    )
    .await;
    send_ix(
        &mut harness.context,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(admin, true),
                AccountMeta::new_readonly(harness.vault_pda, false),
                AccountMeta::new(month, false),
                AccountMeta::new(source, false),
                AccountMeta::new(challenge, false),
                AccountMeta::new(guard, false),
                AccountMeta::new(coverage, false),
                AccountMeta::new(coverage_record, false),
            ],
            data: VaultInstruction::ResolveOracleSourceChallengeV2 {
                params: ResolveOracleSourceChallengeParams {
                    outcome: OracleSourceChallengeOutcome::RejectSource,
                },
            }
            .try_to_vec()
            .unwrap(),
        },
        &[],
    )
    .await
    .unwrap();

    let source_after: OracleSourceState = read_program_state(&mut harness.context, source).await;
    let challenge_after: OracleSourceChallenge =
        read_program_state(&mut harness.context, challenge).await;
    let guard_after: light_token_minter::state::OracleSourceChallengeGuard =
        read_program_state(&mut harness.context, guard).await;
    let coverage_after: light_token_minter::state::OracleSkuCoverageManifest =
        read_program_state(&mut harness.context, coverage).await;
    let record_after: light_token_minter::state::OracleSkuCoverageRecord =
        read_program_state(&mut harness.context, coverage_record).await;
    let month_after: OracleMonthState = read_program_state(&mut harness.context, month).await;
    assert_eq!(source_after.status, OracleSourceStatus::Rejected);
    assert_eq!(challenge_after.status, OracleChallengeStatus::Accepted);
    assert_eq!(guard_after.active_challenge, Pubkey::default());
    assert_eq!(coverage_after.covered_sku_count, 0);
    assert!(!coverage_after.coverage_finalized);
    assert_eq!(coverage_after.coverage_complete_ts, 0);
    assert_eq!(record_after.active_supported_source_count, 0);
    assert_eq!(month_after.pending_resolution_count, 0);
    assert_eq!(month_after.source_count, 0);
    assert_eq!(month_after.phase, OraclePhase::Scramble);

    send_ix(
        &mut harness.context,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(admin, true),
                AccountMeta::new_readonly(market, false),
                AccountMeta::new(month, false),
                AccountMeta::new(coverage, false),
            ],
            data: VaultInstruction::ReopenOracleSkuCoverage
                .try_to_vec()
                .unwrap(),
        },
        &[],
    )
    .await
    .unwrap();

    let reopened_month: OracleMonthState = read_program_state(&mut harness.context, month).await;
    let reopened_coverage: light_token_minter::state::OracleSkuCoverageManifest =
        read_program_state(&mut harness.context, coverage).await;
    assert_eq!(reopened_month.phase, OraclePhase::SourceSubmission);
    assert!(!reopened_coverage.coverage_finalized);
    assert_eq!(reopened_coverage.covered_sku_count, 0);
}
