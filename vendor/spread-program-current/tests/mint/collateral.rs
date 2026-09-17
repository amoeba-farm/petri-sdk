use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn test_protocol_deposit_requires_admin_and_succeeds() {
    let mut harness = setup_harness().await;

    let admin = harness.context.payer.pubkey();
    let admin_token_account =
        create_token_account(&mut harness.context, &harness.usdc_mint, &admin).await;
    let deposit_amount = 700_000;
    mint_to(
        &mut harness.context,
        &harness.usdc_mint,
        &admin_token_account,
        &harness.usdc_mint_authority,
        deposit_amount,
    )
    .await;

    let user_before = token_balance(&mut harness.context, harness.user_token_account).await;
    let vault_before = token_balance(&mut harness.context, harness.vault_token_account).await;
    let unauthorized_err = send_ix(
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
    assert_custom_error(unauthorized_err, VaultError::Unauthorized);
    assert_eq!(
        token_balance(&mut harness.context, harness.user_token_account).await,
        user_before
    );
    assert_eq!(
        token_balance(&mut harness.context, harness.vault_token_account).await,
        vault_before
    );

    send_ix(
        &mut harness.context,
        deposit_ix(
            admin,
            admin_token_account,
            harness.vault_token_account,
            harness.vault_pda,
            harness.usdc_mint,
            deposit_amount,
        ),
        &[],
    )
    .await
    .unwrap();

    assert_eq!(
        token_balance(&mut harness.context, admin_token_account).await,
        0
    );
    assert_eq!(
        token_balance(&mut harness.context, harness.vault_token_account).await,
        deposit_amount
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_user_collateral_init_is_create_only_and_preserves_prefunded_pdas() {
    let mut harness = setup_harness().await;
    let user = harness.user.pubkey();
    fund_account(&mut harness.context, &user, 10_000_000).await;
    let (collateral, _) = find_current_program_address(
        &[USER_COLLATERAL_PDA_SEED, user.as_ref()],
        &light_token_minter::id(),
    );

    send_ix(
        &mut harness.context,
        init_user_collateral_ix(user, collateral),
        &[&harness.user],
    )
    .await
    .unwrap();
    send_ix(
        &mut harness.context,
        deposit_collateral_ix(
            user,
            harness.user_token_account,
            harness.vault_token_account,
            harness.vault_pda,
            collateral,
            harness.usdc_mint,
            444_000,
        ),
        &[&harness.user],
    )
    .await
    .unwrap();
    let before = harness
        .context
        .banks_client
        .get_account(collateral)
        .await
        .unwrap()
        .unwrap();
    let live_collateral = UserCollateral::deserialize(&mut &before.data[..]).unwrap();
    assert_eq!(live_collateral.available_balance, 444_000);
    // Give the retry a distinct transaction signature so ProgramTest executes the create-only
    // guard instead of returning the cached result for the original initialization transaction.
    advance_program_test_blockhash(&mut harness.context).await;
    let duplicate_err = send_ix(
        &mut harness.context,
        init_user_collateral_ix(user, collateral),
        &[&harness.user],
    )
    .await
    .unwrap_err();
    assert_custom_error(duplicate_err, VaultError::AlreadyInitialized);
    let after = harness
        .context
        .banks_client
        .get_account(collateral)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after, before);
    let preserved = UserCollateral::deserialize(&mut &after.data[..]).unwrap();
    assert_eq!(preserved.available_balance, 444_000);

    let prefunded_user = harness.attacker.pubkey();
    fund_account(&mut harness.context, &prefunded_user, 10_000_000).await;
    let (prefunded_collateral, _) = find_current_program_address(
        &[USER_COLLATERAL_PDA_SEED, prefunded_user.as_ref()],
        &light_token_minter::id(),
    );
    set_system_account_with_lamports(&mut harness.context, prefunded_collateral, 1).await;
    send_ix(
        &mut harness.context,
        init_user_collateral_ix(prefunded_user, prefunded_collateral),
        &[&harness.attacker],
    )
    .await
    .unwrap();
    let prefunded_state: UserCollateral =
        read_program_state(&mut harness.context, prefunded_collateral).await;
    assert!(prefunded_state.is_initialized);
    assert_eq!(prefunded_state.owner, prefunded_user);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_reject_zero_amount_deposit() {
    let mut harness = setup_harness().await;

    let err = send_ix(
        &mut harness.context,
        deposit_ix(
            harness.user.pubkey(),
            harness.user_token_account,
            harness.vault_token_account,
            harness.vault_pda,
            harness.usdc_mint,
            0,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();

    assert_custom_error(err, VaultError::AmountMustBePositive);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_reject_wrong_mint_on_deposit() {
    let mut harness = setup_harness().await;

    let other_mint_authority = Keypair::new();
    let other_mint = create_mint(&mut harness.context, &other_mint_authority.pubkey(), 6).await;
    let other_user_token =
        create_token_account(&mut harness.context, &other_mint, &harness.user.pubkey()).await;

    mint_to(
        &mut harness.context,
        &other_mint,
        &other_user_token,
        &other_mint_authority,
        500_000,
    )
    .await;

    let err = send_ix(
        &mut harness.context,
        deposit_ix(
            harness.user.pubkey(),
            other_user_token,
            harness.vault_token_account,
            harness.vault_pda,
            other_mint,
            100_000,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();

    assert_custom_error(err, VaultError::InvalidMint);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_admin_assisted_withdraw_requires_exact_owner_ledger_and_ata() {
    let mut harness = setup_harness().await;
    let admin = harness.context.payer.pubkey();
    let owner = harness.user.pubkey();
    let attacker = harness.attacker.pubkey();
    let (collateral_pda, collateral_bump) = find_current_program_address(
        &[USER_COLLATERAL_PDA_SEED, owner.as_ref()],
        &light_token_minter::id(),
    );
    set_program_state(
        &mut harness.context,
        collateral_pda,
        &UserCollateral {
            is_initialized: true,
            bump: collateral_bump,
            owner,
            available_balance: 1_000,
            position_locked_balance: 700,
            last_action_slot: 0,
        },
        UserCollateral::LEN,
    )
    .await;
    mint_to(
        &mut harness.context,
        &harness.usdc_mint,
        &harness.vault_token_account,
        &harness.usdc_mint_authority,
        1_700,
    )
    .await;

    let owner_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &owner,
        &harness.usdc_mint,
        &spl_token::id(),
    );
    let attacker_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &attacker,
        &harness.usdc_mint,
        &spl_token::id(),
    );
    for create_ata in [
        spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            &admin,
            &owner,
            &harness.usdc_mint,
            &spl_token::id(),
        ),
        spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            &admin,
            &attacker,
            &harness.usdc_mint,
            &spl_token::id(),
        ),
    ] {
        send_ix(&mut harness.context, create_ata, &[])
            .await
            .unwrap();
    }

    let mut missing_owner_signature_ix = admin_assisted_withdraw_collateral_ix(
        admin,
        owner,
        harness.vault_token_account,
        owner_ata,
        harness.vault_pda,
        collateral_pda,
        harness.usdc_mint,
        1,
    );
    missing_owner_signature_ix.accounts[1].is_signer = false;
    let missing_owner_err = send_ix(&mut harness.context, missing_owner_signature_ix, &[])
        .await
        .unwrap_err();
    assert_instruction_error(
        missing_owner_err,
        solana_sdk::instruction::InstructionError::MissingRequiredSignature,
    );

    let wrong_admin_err = send_ix(
        &mut harness.context,
        admin_assisted_withdraw_collateral_ix(
            attacker,
            owner,
            harness.vault_token_account,
            owner_ata,
            harness.vault_pda,
            collateral_pda,
            harness.usdc_mint,
            1,
        ),
        &[&harness.attacker, &harness.user],
    )
    .await
    .unwrap_err();
    assert_custom_error(wrong_admin_err, VaultError::Unauthorized);

    let generic_user_err = send_ix(
        &mut harness.context,
        admin_assisted_withdraw_collateral_ix(
            admin,
            attacker,
            harness.vault_token_account,
            attacker_ata,
            harness.vault_pda,
            collateral_pda,
            harness.usdc_mint,
            1,
        ),
        &[&harness.attacker],
    )
    .await
    .unwrap_err();
    assert_custom_error(generic_user_err, VaultError::InvalidUserCollateralAccount);

    let noncanonical_destination_err = send_ix(
        &mut harness.context,
        admin_assisted_withdraw_collateral_ix(
            admin,
            owner,
            harness.vault_token_account,
            harness.user_token_account,
            harness.vault_pda,
            collateral_pda,
            harness.usdc_mint,
            1,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();
    assert_custom_error(
        noncanonical_destination_err,
        VaultError::InvalidTokenAccount,
    );

    let encumbered_err = send_ix(
        &mut harness.context,
        admin_assisted_withdraw_collateral_ix(
            admin,
            owner,
            harness.vault_token_account,
            owner_ata,
            harness.vault_pda,
            collateral_pda,
            harness.usdc_mint,
            1_001,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();
    assert_custom_error(encumbered_err, VaultError::InsufficientAvailableCollateral);

    send_ix(
        &mut harness.context,
        admin_assisted_withdraw_collateral_ix(
            admin,
            owner,
            harness.vault_token_account,
            owner_ata,
            harness.vault_pda,
            collateral_pda,
            harness.usdc_mint,
            600,
        ),
        &[&harness.user],
    )
    .await
    .unwrap();

    let collateral: UserCollateral = read_program_state(&mut harness.context, collateral_pda).await;
    assert_eq!(collateral.available_balance, 400);
    assert_eq!(collateral.position_locked_balance, 700);
    assert_eq!(token_balance(&mut harness.context, owner_ata).await, 600);
    assert_eq!(
        token_balance(&mut harness.context, harness.vault_token_account).await,
        1_100
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_reject_malformed_instruction_data() {
    let mut harness = setup_harness().await;

    let malformed_ix = Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![],
        data: vec![255, 0, 1],
    };

    let err = send_ix(&mut harness.context, malformed_ix, &[])
        .await
        .unwrap_err();

    assert_custom_error(err, VaultError::InvalidInstructionData);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_dynamic_borsh_length_amplification_fails_before_account_validation() {
    let mut harness = setup_harness().await;
    let mut fixed_prefix = vec![VaultInstructionTag::SubmitOracleOpeningClaimV2 as u8];
    fixed_prefix.extend_from_slice(&[0u8; 88]);

    for malformed_length in [u32::MAX.to_le_bytes().to_vec(), vec![1, 0, 0]] {
        let mut data = fixed_prefix.clone();
        data.extend_from_slice(&malformed_length);
        let err = send_ix(
            &mut harness.context,
            Instruction {
                program_id: light_token_minter::id(),
                accounts: vec![],
                data,
            },
            &[],
        )
        .await
        .unwrap_err();
        assert_custom_error(err, VaultError::InvalidInstructionData);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_pause_blocks_deposit() {
    let mut harness = setup_harness().await;
    let admin = harness.context.payer.pubkey();

    send_ix(
        &mut harness.context,
        update_ix(
            admin,
            harness.vault_pda,
            harness.usdc_mint,
            harness.vault_token_account,
            None,
            None,
            None,
            None,
            Some(true),
        ),
        &[],
    )
    .await
    .unwrap();

    let err = send_ix(
        &mut harness.context,
        deposit_ix(
            harness.user.pubkey(),
            harness.user_token_account,
            harness.vault_token_account,
            harness.vault_pda,
            harness.usdc_mint,
            10_000,
        ),
        &[&harness.user],
    )
    .await
    .unwrap_err();

    assert_custom_error(err, VaultError::ContractPaused);
}
