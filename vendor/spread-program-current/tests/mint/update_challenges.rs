use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_update_challenge_rejects_initialized_pda_without_debit_or_overwrite() {
    let mut harness = setup_harness().await;
    let fixture = setup_oracle_update_security_fixture(&mut harness, 151).await;
    let fixture = set_oracle_update_security_checkpoint(&mut harness, fixture, false).await;
    let program_id = light_token_minter::id();

    let source: OracleSourceState = read_program_state(&mut harness.context, fixture.source).await;
    let alternative_state: u64 = 90_000_000;
    let alternative_source_time: u64 = 1_000_000;
    let archive_url = "https://web.archive.org/web/19700112134640/https://example.com/feed";
    let evidence_hash = hashv(&[
        light_token_minter::constants::ORACLE_UPDATE_EVIDENCE_HASH_DOMAIN,
        fixture.month.as_ref(),
        fixture.source.as_ref(),
        &source.source_id,
        &alternative_state.to_le_bytes(),
        &alternative_source_time.to_le_bytes(),
        &source.canonical_locator_hash,
        &source.source_definition_hash,
        archive_url.as_bytes(),
    ])
    .to_bytes();
    let (schedule, _) = light_token_minter::state::derive_oracle_usdc_reward_schedule_pda(
        &program_id,
        &fixture.month,
    );
    let (sku, sku_bump) = light_token_minter::state::derive_oracle_usdc_sku_pool_pda(
        &program_id,
        &schedule,
        &source.bucket_id,
    );
    set_program_state(
        &mut harness.context,
        sku,
        &light_token_minter::state::OracleUsdcSkuPool {
            is_initialized: true,
            bump: sku_bump,
            account_discriminator:
                light_token_minter::state::OracleUsdcSkuPool::ACCOUNT_DISCRIMINATOR,
            account_version: light_token_minter::state::OracleUsdcSkuPool::ACCOUNT_VERSION,
            schedule,
            month: fixture.month,
            bucket_id: source.bucket_id,
            challenge_min_bond: 250,
            challenge_max_bond: 250,
            challenge_bond_bps: 2_500,
            ..light_token_minter::state::OracleUsdcSkuPool::default()
        },
        light_token_minter::state::OracleUsdcSkuPool::LEN,
    )
    .await;

    let challenger = harness.attacker.pubkey();
    let (collateral, collateral_bump) = find_current_program_address(
        &[USER_COLLATERAL_PDA_SEED, challenger.as_ref()],
        &program_id,
    );
    let collateral_before = UserCollateral {
        is_initialized: true,
        bump: collateral_bump,
        owner: challenger,
        available_balance: 10_000,
        position_locked_balance: 0,
        last_action_slot: 0,
    };
    set_program_state(
        &mut harness.context,
        collateral,
        &collateral_before,
        UserCollateral::LEN,
    )
    .await;

    let challenge_id = [153u8; 32];
    let (challenge, challenge_bump) = find_current_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_UPDATE_CHALLENGE_PDA_SEED,
            fixture.month.as_ref(),
            fixture.claim.as_ref(),
            &challenge_id,
        ],
        &program_id,
    );
    let (challenge_guard, _) = light_token_minter::state::derive_oracle_update_challenge_guard_pda(
        &program_id,
        &fixture.month,
        &fixture.claim,
    );
    let original = OracleUpdateChallenge {
        is_initialized: true,
        bump: challenge_bump,
        month: fixture.month,
        challenge_id,
        claim: fixture.claim,
        claim_id: fixture.claim_id,
        challenger: harness.user.pubkey(),
        alternative_state: 99_000_000,
        bond: 250,
        required_bond: 250,
        status: OracleChallengeStatus::RuleReviewUnresolved,
        evidence_hash: [154u8; 32],
        rule_review_slot: 7,
        escrow_disposition: OracleEscrowDisposition::Unsettled,
        account_discriminator: OracleUpdateChallenge::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUpdateChallenge::ACCOUNT_VERSION,
        ..OracleUpdateChallenge::default()
    };
    set_program_state(
        &mut harness.context,
        challenge,
        &original,
        OracleUpdateChallenge::LEN,
    )
    .await;

    let url_hash = hashv(&[
        b"amoeba-oracle-opening-archive-url-v1",
        archive_url.as_bytes(),
    ])
    .to_bytes();
    let (url_object, url_bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-evidence-bytes-v1",
            challenger.as_ref(),
            &[3],
            &url_hash,
        ],
        &program_id,
    );
    let (url_link, _) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-evidence-link-v1",
            challenge.as_ref(),
            &[5],
            &evidence_hash,
        ],
        &program_id,
    );
    let mut url_data = vec![0u8; 76 + archive_url.len()];
    url_data[..6].copy_from_slice(&[b'O', b'E', b'B', 1, 1, url_bump]);
    url_data[6..38].copy_from_slice(challenger.as_ref());
    url_data[38] = 3;
    url_data[39..71].copy_from_slice(&url_hash);
    url_data[71..73].copy_from_slice(&(archive_url.len() as u16).to_le_bytes());
    url_data[73..75].copy_from_slice(&(archive_url.len() as u16).to_le_bytes());
    url_data[75] = 1;
    url_data[76..].copy_from_slice(archive_url.as_bytes());
    harness.context.set_account(
        &url_object,
        &solana_sdk::account::AccountSharedData::from(solana_sdk::account::Account {
            lamports: 10_000_000,
            data: url_data,
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        }),
    );

    let err = send_ix(
        &mut harness.context,
        Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(challenger, true),
                AccountMeta::new_readonly(fixture.market, false),
                AccountMeta::new_readonly(fixture.month, false),
                AccountMeta::new_readonly(sku, false),
                AccountMeta::new_readonly(fixture.claim, false),
                AccountMeta::new_readonly(fixture.source, false),
                AccountMeta::new(collateral, false),
                AccountMeta::new(challenge, false),
                AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
                AccountMeta::new(challenge_guard, false),
                AccountMeta::new_readonly(url_object, false),
                AccountMeta::new(url_link, false),
            ],
            data: VaultInstruction::ChallengeOracleUpdateClaimV2 {
                params: ChallengeOracleUpdateClaimParams {
                    challenge_id,
                    alternative_state,
                    alternative_source_time,
                    bond: 250,
                    evidence_hash,
                    archive_url: String::new(),
                },
            }
            .try_to_vec()
            .unwrap(),
        },
        &[&harness.attacker],
    )
    .await
    .unwrap_err();
    assert_custom_error(err, VaultError::AlreadyInitialized);

    let challenge_after: OracleUpdateChallenge =
        read_program_state(&mut harness.context, challenge).await;
    let collateral_after: UserCollateral =
        read_program_state(&mut harness.context, collateral).await;
    assert_eq!(challenge_after, original);
    assert_eq!(collateral_after, collateral_before);
    assert!(harness
        .context
        .banks_client
        .get_account(challenge_guard)
        .await
        .unwrap()
        .is_none());
}
