//! Candidate source bindings. Requires the matching native dependency before release.
use solana_program::{instruction::{AccountMeta, Instruction}, pubkey::Pubkey};
use crate::protocol::{build_current_vault_instruction, CurrentProtocolError, CURRENT_SYSTEM_PROGRAM_ID};
pub use ameba_spread_program::writer_dlmm_instruction::{BeginWriterDlmmPolicyV1Params, ManageWriterDlmmV1Params};
pub use ameba_spread_program::state::{WriterDlmmBinV1, WriterDlmmSeriesPolicyV1, WriterDlmmPolicyV1,
    WriterDlmmPositionV1, derive_writer_dlmm_policy_pda, derive_writer_dlmm_position_pda};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WriterDlmmPolicyAccountsV1 {
    pub actor: Pubkey, pub vault_config: Pubkey, pub policy_registry: Pubkey,
    pub sleeve: Pubkey, pub settlement_group: Pubkey, pub series_book: Pubkey, pub policy_snapshot: Pubkey,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WriterDlmmPositionAccountsV1 {
    pub actor: Pubkey, pub vault_config: Pubkey, pub sleeve: Pubkey, pub settlement_group: Pubkey,
    pub series_book: Pubkey, pub policy_snapshot: Pubkey, pub pool: Pubkey, pub market: Pubkey, pub oracle_month: Pubkey,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WriterDlmmLiquidityAccountsV1 {
    pub position: WriterDlmmPositionAccountsV1,
    pub option_mint: Pubkey, pub quote_mint: Pubkey, pub option_vault: Pubkey, pub quote_vault: Pubkey,
    pub sleeve_usdc_vault: Pubkey, pub market_staging: Pubkey, pub retirement_custody: Pubkey,
    pub light_token_program: Pubkey, pub compressed_token_authority: Pubkey,
    pub option_spl_interface: Pubkey, pub quote_spl_interface: Pubkey, pub spl_token_program: Pubkey,
    pub compressible_config: Pubkey, pub rent_sponsor: Pubkey,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriterDlmmAccountsV1 { Policy(WriterDlmmPolicyAccountsV1), Position(WriterDlmmPositionAccountsV1), Liquidity(WriterDlmmLiquidityAccountsV1) }

fn r(key: Pubkey) -> AccountMeta { AccountMeta::new_readonly(key, false) }
fn w(key: Pubkey) -> AccountMeta { AccountMeta::new(key, false) }
fn actor(key: Pubkey) -> AccountMeta { AccountMeta::new(key, true) }

pub fn build_manage_writer_dlmm_instruction_v1(program_id: Pubkey, accounts: WriterDlmmAccountsV1,
    params: ManageWriterDlmmV1Params) -> Result<Instruction, CurrentProtocolError> {
    let keys = match (accounts, params.selector()) {
        (WriterDlmmAccountsV1::Policy(a), 0..=2) => vec![actor(a.actor), r(a.vault_config), r(a.policy_registry),
            r(a.sleeve), r(a.settlement_group), r(a.series_book), r(a.policy_snapshot),
            w(derive_writer_dlmm_policy_pda(&program_id, &a.sleeve).0), r(CURRENT_SYSTEM_PROGRAM_ID)],
        (WriterDlmmAccountsV1::Position(a), 3) => vec![actor(a.actor), r(a.vault_config), r(a.sleeve),
            r(a.settlement_group), r(a.series_book), r(a.policy_snapshot),
            r(derive_writer_dlmm_policy_pda(&program_id, &a.sleeve).0), w(a.pool),
            w(derive_writer_dlmm_position_pda(&program_id, &a.pool, &a.sleeve).0),
            r(a.market), r(a.oracle_month), r(CURRENT_SYSTEM_PROGRAM_ID)],
        (WriterDlmmAccountsV1::Liquidity(a), 4..=6) => {
            let p = a.position;
            vec![actor(p.actor), r(p.vault_config), w(p.sleeve), r(p.settlement_group), w(p.series_book), r(p.policy_snapshot),
                w(derive_writer_dlmm_policy_pda(&program_id, &p.sleeve).0), w(p.market), r(p.oracle_month), w(p.pool),
                r(crate::ameba_dlmm_state::derive_ameba_dlmm_authority_pda(&program_id, &p.pool).0),
                w(derive_writer_dlmm_position_pda(&program_id, &p.pool, &p.sleeve).0), w(a.option_mint), r(a.quote_mint),
                w(a.option_vault), w(a.quote_vault), w(a.sleeve_usdc_vault), w(a.market_staging), w(a.retirement_custody),
                r(a.light_token_program), r(a.compressed_token_authority), w(a.option_spl_interface), w(a.quote_spl_interface),
                r(a.spl_token_program), r(CURRENT_SYSTEM_PROGRAM_ID), r(a.compressible_config), w(a.rent_sponsor)]
        }
        _ => return Err(CurrentProtocolError::InvalidInstruction),
    };
    if keys.iter().map(|meta| meta.pubkey).collect::<std::collections::HashSet<_>>().len() != keys.len() {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    build_current_vault_instruction(program_id, keys, crate::instruction::VaultInstruction::ManageWriterDlmmV1 { params })
}

pub fn decode_writer_dlmm_policy_v1(program_id: &Pubkey, account: crate::protocol::CurrentAccountData<'_>,
    sleeve: &Pubkey) -> Result<WriterDlmmPolicyV1, CurrentProtocolError> {
    let (expected, bump) = derive_writer_dlmm_policy_pda(program_id, sleeve);
    crate::protocol::require_program_account(account, WriterDlmmPolicyV1::LEN, program_id)?;
    if account.address != expected { return Err(CurrentProtocolError::InvalidIdentity); }
    let value: WriterDlmmPolicyV1 = crate::protocol::decode_zero_padded(account.data)?;
    if !value.has_current_layout() || value.bump != bump || value.sleeve != *sleeve { return Err(CurrentProtocolError::InvalidIdentity); }
    Ok(value)
}

pub fn decode_writer_dlmm_position_v1(program_id: &Pubkey, account: crate::protocol::CurrentAccountData<'_>,
    pool: &Pubkey, sleeve: &Pubkey) -> Result<WriterDlmmPositionV1, CurrentProtocolError> {
    let (expected, bump) = derive_writer_dlmm_position_pda(program_id, pool, sleeve);
    crate::protocol::require_program_account(account, WriterDlmmPositionV1::LEN, program_id)?;
    if account.address != expected { return Err(CurrentProtocolError::InvalidIdentity); }
    let value: WriterDlmmPositionV1 = crate::protocol::decode_zero_padded(account.data)?;
    if !value.has_current_layout() || value.bump != bump || value.pool != *pool || value.sleeve != *sleeve {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}
