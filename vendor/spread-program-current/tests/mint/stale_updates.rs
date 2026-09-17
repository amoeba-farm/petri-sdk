use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_tag_201_absent_guard_is_fail_closed_until_exact_cleanup_boundary() {
    let mut harness = setup_harness().await;
    let program_id = light_token_minter::id();
    let fixture = setup_oracle_update_security_fixture(&mut harness, 166).await;
    let fixture = set_oracle_update_security_checkpoint(&mut harness, fixture, false).await;
    let (guard, _) = light_token_minter::state::derive_oracle_update_challenge_guard_pda(
        &program_id,
        &fixture.month,
        &fixture.claim,
    );
    let market: Market = read_program_state(&mut harness.context, fixture.market).await;
    let cleanup_boundary = market
        .instrument
        .expiry_ts
        .checked_add(ORACLE_SETTLEMENT_GRACE_SECONDS)
        .unwrap();
    let instruction =
        || cancel_stale_update_instruction(program_id, fixture.admin, &fixture, guard, None, None);

    let valid_claim: OracleUpdateClaimV2 =
        read_program_state(&mut harness.context, fixture.claim).await;
    let mut wrong_layout = valid_claim.clone();
    wrong_layout.claim.account_version = 0;
    set_program_state(
        &mut harness.context,
        fixture.claim,
        &wrong_layout,
        OracleUpdateClaimV2::LEN,
    )
    .await;
    let wrong_layout_err = send_ix(&mut harness.context, instruction(), &[])
        .await
        .unwrap_err();
    assert_custom_error(wrong_layout_err, VaultError::InvalidOracleUpdateAccount);
    set_program_state(
        &mut harness.context,
        fixture.claim,
        &valid_claim,
        OracleUpdateClaimV2::LEN,
    )
    .await;

    advance_program_test_blockhash(&mut harness.context).await;
    let mut clock = harness
        .context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    clock.unix_timestamp = i64::try_from(cleanup_boundary - 1).unwrap();
    harness.context.set_sysvar(&clock);
    let early_err = send_ix(&mut harness.context, instruction(), &[])
        .await
        .unwrap_err();
    assert_custom_error(early_err, VaultError::OracleTimingWindowClosed);

    advance_program_test_blockhash(&mut harness.context).await;
    clock = harness
        .context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    clock.unix_timestamp = i64::try_from(cleanup_boundary).unwrap();
    harness.context.set_sysvar(&clock);
    send_ix(&mut harness.context, instruction(), &[])
        .await
        .unwrap();
    let terminal_claim: OracleUpdateClaimV2 =
        read_program_state(&mut harness.context, fixture.claim).await;
    let terminal_month: OracleMonthState =
        read_program_state(&mut harness.context, fixture.month).await;
    assert_eq!(terminal_claim.claim.status, OracleClaimStatus::TimedOut);
    assert_eq!(
        terminal_claim.claim.escrow_disposition,
        OracleEscrowDisposition::Unsettled
    );
    assert!(!terminal_claim.council_review_pending);
    assert_eq!(terminal_month.pending_resolution_count, 0);

    let claimant_collateral =
        install_user_collateral_for_test(&mut harness.context, fixture.admin, 0).await;
    send_ix(
        &mut harness.context,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(fixture.admin, true),
                AccountMeta::new_readonly(fixture.market, false),
                AccountMeta::new_readonly(fixture.month, false),
                AccountMeta::new_readonly(fixture.source, false),
                AccountMeta::new(fixture.claim, false),
                AccountMeta::new(claimant_collateral, false),
                AccountMeta::new_readonly(guard, false),
            ],
            data: VaultInstruction::SettleOracleUsdcEscrow {
                params: SettleOracleEscrowParams {
                    kind: OracleEscrowKind::UpdateClaim,
                },
            }
            .try_to_vec()
            .unwrap(),
        },
        &[],
    )
    .await
    .unwrap();
    let refunded_collateral: UserCollateral =
        read_program_state(&mut harness.context, claimant_collateral).await;
    let refunded_claim: OracleUpdateClaimV2 =
        read_program_state(&mut harness.context, fixture.claim).await;
    assert_eq!(
        refunded_collateral.available_balance,
        terminal_claim.claim.stake
    );
    assert_eq!(
        refunded_claim.claim.escrow_disposition,
        OracleEscrowDisposition::Refunded
    );

    advance_program_test_blockhash(&mut harness.context).await;
    let replay_err = send_ix(&mut harness.context, instruction(), &[])
        .await
        .unwrap_err();
    assert_custom_error(replay_err, VaultError::InvalidOracleUpdateAccount);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_tag_201_handles_guarded_and_checkpointed_stale_claims_exactly_once() {
    let mut harness = setup_harness().await;
    let program_id = light_token_minter::id();

    let guarded_fixture = setup_oracle_update_security_fixture(&mut harness, 169).await;
    let guarded_fixture =
        set_oracle_update_security_checkpoint(&mut harness, guarded_fixture, false).await;
    let mut guarded_source: OracleSourceState =
        read_program_state(&mut harness.context, guarded_fixture.source).await;
    guarded_source.current_state = guarded_source.current_state.checked_add(1).unwrap();
    set_program_state(
        &mut harness.context,
        guarded_fixture.source,
        &guarded_source,
        OracleSourceState::LEN,
    )
    .await;
    let (guarded_challenge, guarded_guard) = install_current_update_challenge_for_test(
        &mut harness,
        &guarded_fixture,
        [170; 32],
        OracleChallengeStatus::RuleReview,
        0,
        0,
        Pubkey::new_unique(),
    )
    .await;
    let guarded_instruction = || {
        cancel_stale_update_instruction(
            program_id,
            guarded_fixture.admin,
            &guarded_fixture,
            guarded_guard,
            Some(guarded_challenge),
            None,
        )
    };
    let active_dispute_err = send_ix(&mut harness.context, guarded_instruction(), &[])
        .await
        .unwrap_err();
    assert_custom_error(active_dispute_err, VaultError::InvalidOracleUpdateAccount);
    let mut guard_state: OracleUpdateChallengeGuard =
        read_program_state(&mut harness.context, guarded_guard).await;
    guard_state.active_dispute = Pubkey::default();
    set_program_state(
        &mut harness.context,
        guarded_guard,
        &guard_state,
        OracleUpdateChallengeGuard::LEN,
    )
    .await;
    advance_program_test_blockhash(&mut harness.context).await;
    send_ix(&mut harness.context, guarded_instruction(), &[])
        .await
        .unwrap();
    let guarded_claim: OracleUpdateClaimV2 =
        read_program_state(&mut harness.context, guarded_fixture.claim).await;
    let guarded_challenge_state: OracleUpdateChallenge =
        read_program_state(&mut harness.context, guarded_challenge).await;
    assert_eq!(guarded_claim.claim.status, OracleClaimStatus::TimedOut);
    assert_eq!(
        guarded_challenge_state.status,
        OracleChallengeStatus::Cancelled
    );

    let checkpoint_fixture = setup_oracle_update_security_fixture(&mut harness, 172).await;
    let checkpoint_fixture =
        set_oracle_update_security_checkpoint(&mut harness, checkpoint_fixture, true).await;
    let mut checkpoint_source: OracleSourceState =
        read_program_state(&mut harness.context, checkpoint_fixture.source).await;
    checkpoint_source.last_finalized_step = 1;
    set_program_state(
        &mut harness.context,
        checkpoint_fixture.source,
        &checkpoint_source,
        OracleSourceState::LEN,
    )
    .await;
    let (checkpoint_challenge, checkpoint_guard) = install_current_update_challenge_for_test(
        &mut harness,
        &checkpoint_fixture,
        [173; 32],
        OracleChallengeStatus::RuleReviewUnresolved,
        1,
        1,
        Pubkey::default(),
    )
    .await;
    let checkpoint_instruction = cancel_stale_update_instruction(
        program_id,
        checkpoint_fixture.admin,
        &checkpoint_fixture,
        checkpoint_guard,
        Some(checkpoint_challenge),
        None,
    );
    send_ix(&mut harness.context, checkpoint_instruction, &[])
        .await
        .unwrap();
    let checkpoint_claim: OracleUpdateClaimV2 =
        read_program_state(&mut harness.context, checkpoint_fixture.claim).await;
    let checkpoint_month_after: OracleMonthState =
        read_program_state(&mut harness.context, checkpoint_fixture.month).await;
    assert_eq!(checkpoint_claim.claim.status, OracleClaimStatus::TimedOut);
    assert!(!checkpoint_claim.council_review_pending);
    assert_eq!(checkpoint_month_after.pending_resolution_count, 0);
}
