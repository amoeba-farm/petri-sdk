use super::*;

pub(super) fn test_settlement_v2_pda(
    program_id: &Pubkey,
    market: &Pubkey,
    expiry_ts: u64,
) -> (Pubkey, u8, Pubkey) {
    let (oracle_month, _) = find_current_program_address(
        &[
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry_ts.to_le_bytes(),
        ],
        program_id,
    );
    let (settlement, bump) = find_current_program_address(
        &[
            SETTLEMENT_V2_PDA_SEED,
            market.as_ref(),
            oracle_month.as_ref(),
        ],
        program_id,
    );
    (settlement, bump, oracle_month)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn test_settlement_record_v2(
    bump: u8,
    market: Pubkey,
    oracle_month: Pubkey,
    _underlying_id: [u8; 32],
    settlement_ts: u64,
    settlement_price_atomic: u64,
    _source_digest: [u8; 32],
    submitted_by: Pubkey,
) -> SettlementRecordV2 {
    SettlementRecordV2 {
        is_initialized: true,
        bump,
        account_discriminator: SettlementRecordV2::ACCOUNT_DISCRIMINATOR,
        account_version: SettlementRecordV2::ACCOUNT_VERSION,
        market,
        oracle_month,
        settlement_ts,
        settlement_price_atomic,
        signed_leaf_commitment: [99; 32],
        submitted_by,
        signer_set_version: 1,
    }
}

pub(super) fn initialize_ix(
    admin: Pubkey,
    vault_pda: Pubkey,
    usdc_mint: Pubkey,
    vault_token: Pubkey,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new_readonly(vault_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: VaultInstruction::Initialize.try_to_vec().unwrap(),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn update_ix(
    admin: Pubkey,
    vault_pda: Pubkey,
    mint: Pubkey,
    vault_token: Pubkey,
    new_admin: Option<Pubkey>,
    new_oracle_authority: Option<Pubkey>,
    new_usdc_mint: Option<Pubkey>,
    new_vault_token_account: Option<Pubkey>,
    paused: Option<bool>,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(vault_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::UpdateConfig {
            new_admin,
            new_oracle_authority,
            new_usdc_mint,
            new_vault_token_account,
            paused,
        }
        .try_to_vec()
        .unwrap(),
    }
}

pub(super) fn deposit_ix(
    user: Pubkey,
    user_token: Pubkey,
    vault_token: Pubkey,
    vault_pda: Pubkey,
    usdc_mint: Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(user, true),
            AccountMeta::new(user_token, false),
            AccountMeta::new(vault_token, false),
            AccountMeta::new_readonly(vault_pda, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::DepositUsdc { amount }
            .try_to_vec()
            .unwrap(),
    }
}

pub(super) fn deposit_collateral_ix(
    user: Pubkey,
    user_token: Pubkey,
    vault_token: Pubkey,
    vault_pda: Pubkey,
    collateral: Pubkey,
    usdc_mint: Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(user, true),
            AccountMeta::new(user_token, false),
            AccountMeta::new(vault_token, false),
            AccountMeta::new_readonly(vault_pda, false),
            AccountMeta::new(collateral, false),
            AccountMeta::new_readonly(usdc_mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::DepositCollateral { amount }
            .try_to_vec()
            .unwrap(),
    }
}

pub(super) fn init_user_collateral_ix(user: Pubkey, collateral: Pubkey) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(user, true),
            AccountMeta::new(collateral, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: VaultInstruction::InitUserCollateral.try_to_vec().unwrap(),
    }
}

pub(super) fn finalize_oracle_month_ix(
    cranker: Pubkey,
    market: Pubkey,
    month: Pubkey,
    bucket_medians: &[Pubkey],
) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(cranker, true),
        AccountMeta::new_readonly(market, false),
        AccountMeta::new(month, false),
    ];
    accounts.extend(
        bucket_medians
            .iter()
            .map(|bucket| AccountMeta::new_readonly(*bucket, false)),
    );
    Instruction {
        program_id: light_token_minter::id(),
        accounts,
        data: VaultInstruction::FinalizeOracleMonth.try_to_vec().unwrap(),
    }
}
