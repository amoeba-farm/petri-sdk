use super::*;

pub(super) fn sorted_signers() -> Vec<Keypair> {
    let mut signers: Vec<Keypair> = (0..5).map(|_| Keypair::new()).collect();
    signers.sort_by_key(Signer::pubkey);
    signers
}

pub(super) fn signer_array(signers: &[Keypair]) -> [Pubkey; MAX_SETTLEMENT_SIGNER_COUNT] {
    let mut result = [Pubkey::default(); MAX_SETTLEMENT_SIGNER_COUNT];
    for (destination, signer) in result.iter_mut().zip(signers) {
        *destination = signer.pubkey();
    }
    result
}

pub(super) fn ed25519_verify_instruction(signer: &Keypair, message: &[u8]) -> Instruction {
    const DATA_START: usize = 16;
    const PUBKEY_SIZE: usize = 32;
    const SIGNATURE_SIZE: usize = 64;

    let public_key_offset = DATA_START as u16;
    let signature_offset = (DATA_START + PUBKEY_SIZE) as u16;
    let message_offset = (DATA_START + PUBKEY_SIZE + SIGNATURE_SIZE) as u16;
    let signature = signer.sign_message(message);

    let mut data = Vec::with_capacity(usize::from(message_offset) + message.len());
    data.extend_from_slice(&[1, 0]);
    data.extend_from_slice(&signature_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&public_key_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&message_offset.to_le_bytes());
    data.extend_from_slice(
        &u16::try_from(message.len())
            .expect("rotation digest fits u16")
            .to_le_bytes(),
    );
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(signer.pubkey().as_ref());
    data.extend_from_slice(signature.as_ref());
    data.extend_from_slice(message);

    Instruction {
        program_id: solana_program::ed25519_program::id(),
        accounts: vec![],
        data,
    }
}

pub(super) fn rotation_digest(
    registry: Pubkey,
    current_set_key: Pubkey,
    current_set: &SettlementSignerSet,
    proposal_nonce: u64,
    pending_set_key: Pubkey,
    pending_set: &SettlementSignerSet,
) -> Vec<u8> {
    hashv(&[
        b"ameba_settlement_signer_rotation_v1",
        light_token_minter::id().as_ref(),
        registry.as_ref(),
        current_set_key.as_ref(),
        &current_set.version.to_le_bytes(),
        &current_set.set_hash,
        &proposal_nonce.to_le_bytes(),
        pending_set_key.as_ref(),
        &pending_set.version.to_le_bytes(),
        &pending_set.set_hash,
        &pending_set.activate_after_slot.to_le_bytes(),
        &pending_set.rotation_delay_slots.to_le_bytes(),
        &[u8::from(pending_set.emergency)],
    ])
    .to_bytes()
    .to_vec()
}

pub(super) fn pending_set_for_digest(
    registry: Pubkey,
    set_key: Pubkey,
    version: u64,
    signers: [Pubkey; MAX_SETTLEMENT_SIGNER_COUNT],
    rotation_delay_slots: u64,
    activate_after_slot: u64,
    emergency: bool,
    proposer: Pubkey,
) -> SettlementSignerSet {
    let (_, bump) = derive_settlement_signer_set_pda(&light_token_minter::id(), version);
    assert_eq!(
        set_key,
        derive_settlement_signer_set_pda(&light_token_minter::id(), version).0
    );
    let mut set = SettlementSignerSet {
        is_initialized: true,
        bump,
        account_discriminator: SettlementSignerSet::ACCOUNT_DISCRIMINATOR,
        account_version: SettlementSignerSet::ACCOUNT_VERSION,
        registry,
        version,
        threshold: 3,
        signer_count: 5,
        signers,
        set_hash: [0; 32],
        rotation_delay_slots,
        proposed_slot: 0,
        activate_after_slot,
        emergency,
        proposer,
    };
    set.set_hash = set.compute_set_hash();
    set
}

pub(super) fn initialize_registry_instruction(
    admin: Pubkey,
    oracle_authority: Pubkey,
    recovery_authority: Pubkey,
    config: Pubkey,
    registry: Pubkey,
    signer_set: Pubkey,
    signers: [Pubkey; MAX_SETTLEMENT_SIGNER_COUNT],
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new_readonly(oracle_authority, true),
            AccountMeta::new_readonly(recovery_authority, true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(registry, false),
            AccountMeta::new(signer_set, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: VaultInstruction::InitializeSettlementSignerRegistry {
            params: InitializeSettlementSignerRegistryParams {
                signer_set_version: 1,
                threshold: 3,
                signer_count: 5,
                signers,
                rotation_delay_slots: MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
                recovery_authority,
            },
        }
        .try_to_vec()
        .expect("serialize registry initialization"),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn propose_rotation_instruction(
    admin: Pubkey,
    oracle_authority: Pubkey,
    recovery_authority: Option<Pubkey>,
    config: Pubkey,
    registry: Pubkey,
    current_set: Pubkey,
    pending_set: Pubkey,
    signers: [Pubkey; MAX_SETTLEMENT_SIGNER_COUNT],
    target_version: u64,
    activate_after_slot: u64,
) -> Instruction {
    let emergency = recovery_authority.is_some();
    let mut accounts = vec![
        AccountMeta::new(admin, true),
        AccountMeta::new_readonly(oracle_authority, true),
    ];
    if let Some(recovery_authority) = recovery_authority {
        accounts.push(AccountMeta::new_readonly(recovery_authority, true));
    }
    accounts.extend([
        AccountMeta::new_readonly(config, false),
        AccountMeta::new(registry, false),
        AccountMeta::new_readonly(current_set, false),
        AccountMeta::new(pending_set, false),
    ]);
    if !emergency {
        accounts.push(AccountMeta::new_readonly(
            solana_sdk::sysvar::instructions::id(),
            false,
        ));
    }
    accounts.push(AccountMeta::new_readonly(
        solana_sdk::system_program::id(),
        false,
    ));

    let params = ProposeSettlementSignerRotationParams {
        target_version,
        threshold: 3,
        signer_count: 5,
        signers,
        rotation_delay_slots: MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
        activate_after_slot,
    };
    let data = if emergency {
        VaultInstruction::ProposeEmergencySettlementSignerRecovery { params }
    } else {
        VaultInstruction::ProposeSettlementSignerRotation { params }
    };
    Instruction {
        program_id: light_token_minter::id(),
        accounts,
        data: data.try_to_vec().expect("serialize rotation proposal"),
    }
}

pub(super) fn cancel_rotation_instruction(
    admin: Pubkey,
    oracle_authority: Pubkey,
    config: Pubkey,
    registry: Pubkey,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new_readonly(oracle_authority, true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(registry, false),
        ],
        data: VaultInstruction::CancelSettlementSignerRotation
            .try_to_vec()
            .expect("serialize rotation cancellation"),
    }
}

pub(super) fn activate_rotation_instruction(
    registry: Pubkey,
    pending_set: Pubkey,
    config: Pubkey,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(registry, false),
            AccountMeta::new_readonly(pending_set, false),
            AccountMeta::new_readonly(config, false),
        ],
        data: VaultInstruction::ActivateSettlementSignerRotation
            .try_to_vec()
            .expect("serialize rotation activation"),
    }
}

pub(super) fn update_pause_instruction(
    admin: Pubkey,
    config: Pubkey,
    collateral_mint: Pubkey,
    collateral_vault: Pubkey,
    paused: bool,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(collateral_mint, false),
            AccountMeta::new_readonly(collateral_vault, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::UpdateConfig {
            new_admin: None,
            new_oracle_authority: None,
            new_usdc_mint: None,
            new_vault_token_account: None,
            paused: Some(paused),
        }
        .try_to_vec()
        .expect("serialize pause update"),
    }
}

pub(super) fn activate_vault_v2_instruction(
    admin: Pubkey,
    config: Pubkey,
    registry: Pubkey,
    current_signer_set: Pubkey,
    collateral_mint: Pubkey,
    vault_token: Pubkey,
    expected_collateral_freeze_authority: Option<Pubkey>,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new_readonly(current_signer_set, false),
            AccountMeta::new_readonly(collateral_mint, false),
            AccountMeta::new_readonly(vault_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::ActivateVaultV2 {
            params: ActivateVaultV2Params {
                expected_collateral_freeze_authority,
            },
        }
        .try_to_vec()
        .expect("serialize governed vault activation"),
    }
}

pub(super) fn single_admin_authority_update_instruction(
    admin: Pubkey,
    config: Pubkey,
    collateral_mint: Pubkey,
    collateral_vault: Pubkey,
    new_admin: Pubkey,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(collateral_mint, false),
            AccountMeta::new_readonly(collateral_vault, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::UpdateConfig {
            new_admin: Some(new_admin),
            new_oracle_authority: None,
            new_usdc_mint: None,
            new_vault_token_account: None,
            paused: None,
        }
        .try_to_vec()
        .expect("serialize single-admin authority update"),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn rotate_authorities_v2_instruction(
    current_admin: Pubkey,
    current_oracle: Pubkey,
    new_admin: Pubkey,
    new_oracle: Pubkey,
    signer_flags: [bool; 4],
    config: Pubkey,
    registry: Pubkey,
    current_set: Pubkey,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(current_admin, signer_flags[0]),
            AccountMeta::new_readonly(current_oracle, signer_flags[1]),
            AccountMeta::new_readonly(new_admin, signer_flags[2]),
            AccountMeta::new_readonly(new_oracle, signer_flags[3]),
            AccountMeta::new(config, false),
            AccountMeta::new_readonly(registry, false),
            AccountMeta::new_readonly(current_set, false),
        ],
        data: VaultInstruction::RotateVaultAuthoritiesV2 {
            params: RotateVaultAuthoritiesV2Params {
                new_admin,
                new_oracle_authority: new_oracle,
            },
        }
        .try_to_vec()
        .expect("serialize governed authority rotation"),
    }
}

async fn send_instructions(
    context: &mut ProgramTestContext,
    instructions: Vec<Instruction>,
    extra_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let recent_blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut signers: Vec<&Keypair> = vec![&context.payer];
    signers.extend_from_slice(extra_signers);
    let transaction = Transaction::new_signed_with_payer(
        &instructions,
        Some(&context.payer.pubkey()),
        &signers,
        recent_blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

async fn read_state<T: BorshDeserialize>(context: &mut ProgramTestContext, key: Pubkey) -> T {
    let account = context
        .banks_client
        .get_account(key)
        .await
        .unwrap()
        .expect("program account exists");
    T::deserialize(&mut account.data.as_slice()).expect("deserialize program state")
}

pub(super) fn borsh_account<T: BorshSerialize>(value: &T, owner: Pubkey, len: usize) -> Account {
    let serialized = value.try_to_vec().expect("serialize preloaded state");
    assert_eq!(serialized.len(), len);
    Account {
        lamports: 10_000_000,
        data: serialized,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

pub(super) fn mint_account() -> Account {
    let mut data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::None,
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    Account {
        lamports: 10_000_000,
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

pub(super) fn token_account(mint: Pubkey, owner: Pubkey) -> Account {
    let mut data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(
        TokenAccount {
            mint,
            owner,
            amount: 0,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    Account {
        lamports: 10_000_000,
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

pub(super) fn typed_config_account(config: &VaultConfig) -> Account {
    let serialized = config.try_to_vec().expect("serialize typed config");
    assert_eq!(serialized.len(), VaultConfig::LEN);
    borsh_account(config, light_token_minter::id(), VaultConfig::LEN)
}

pub(super) fn assert_custom_error(error: BanksClientError, expected: VaultError) {
    match error {
        BanksClientError::TransactionError(
            solana_sdk::transaction::TransactionError::InstructionError(
                _,
                solana_sdk::instruction::InstructionError::Custom(actual),
            ),
        ) => assert_eq!(actual, expected as u32),
        other => panic!("expected custom error {}, got {other:?}", expected as u32),
    }
}

pub(super) fn assert_instruction_error(
    error: BanksClientError,
    expected: solana_sdk::instruction::InstructionError,
) {
    match error {
        BanksClientError::TransactionError(
            solana_sdk::transaction::TransactionError::InstructionError(_, actual),
        ) => assert_eq!(actual, expected),
        other => panic!("expected instruction error {expected:?}, got {other:?}"),
    }
}
