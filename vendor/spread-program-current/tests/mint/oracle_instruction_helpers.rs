use super::*;

pub(super) fn init_market_ix(
    admin: Pubkey,
    market: Pubkey,
    config: Pubkey,
    params: InitMarketV2Params,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new(market, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: VaultInstruction::InitMarketV2 { params }
            .try_to_vec()
            .unwrap(),
    }
}

pub(super) fn set_market_paused_ix(
    admin: Pubkey,
    config: Pubkey,
    market: Pubkey,
    paused: bool,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(market, false),
        ],
        data: VaultInstruction::SetMarketPaused {
            params: SetMarketPausedParams { paused },
        }
        .try_to_vec()
        .unwrap(),
    }
}

pub(super) fn set_market_unpaused_ix(
    admin: Pubkey,
    config: Pubkey,
    market: Pubkey,
    month: Pubkey,
) -> Instruction {
    let mut instruction = set_market_paused_ix(admin, config, market, false);
    instruction
        .accounts
        .push(AccountMeta::new_readonly(month, false));
    instruction
}

#[allow(clippy::too_many_arguments)]
pub(super) fn admin_assisted_withdraw_collateral_ix(
    admin: Pubkey,
    owner: Pubkey,
    vault_token: Pubkey,
    destination_ata: Pubkey,
    config: Pubkey,
    collateral: Pubkey,
    mint: Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(admin, true),
            AccountMeta::new_readonly(owner, true),
            AccountMeta::new(vault_token, false),
            AccountMeta::new(destination_ata, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(collateral, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: VaultInstruction::AdminAssistedWithdrawCollateral { amount }
            .try_to_vec()
            .unwrap(),
    }
}

pub(super) fn opening_original_url(source_index: u8) -> String {
    format!("https://oracle.example/opening/{source_index}")
}

pub(super) fn opening_locator_hash(source_index: u8) -> [u8; 32] {
    hashv(&[b"locator", opening_original_url(source_index).as_bytes()]).to_bytes()
}

pub(super) fn opening_archive_url(source_index: u8, source_time: u64) -> String {
    let mut days = source_time / 86_400;
    let seconds = source_time % 86_400;
    let hour = seconds / 3_600;
    let minute = seconds % 3_600 / 60;
    let second = seconds % 60;
    let mut year = 1970u64;
    loop {
        let leap =
            year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
        let year_days = 365 + u64::from(leap);
        if days < year_days {
            break;
        }
        days -= year_days;
        year += 1;
    }
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let month_days = [
        31u64,
        28 + u64::from(leap),
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u64;
    for count in month_days {
        if days < count {
            break;
        }
        days -= count;
        month += 1;
    }
    let day = days + 1;
    format!(
        "https://web.archive.org/web/{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}/{}",
        opening_original_url(source_index)
    )
}

pub(super) fn close_oracle_month_ix(
    authority: Pubkey,
    config: Pubkey,
    market: Pubkey,
    month: Pubkey,
    settlement_record: Pubkey,
) -> Instruction {
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(market, false),
            AccountMeta::new(month, false),
            AccountMeta::new_readonly(settlement_record, false),
        ],
        data: VaultInstruction::CloseOracleMonth.try_to_vec().unwrap(),
    }
}
