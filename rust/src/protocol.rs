//! Strict historical host helpers layered over the synchronized RC44 wire ABI.

use borsh::{BorshDeserialize, BorshSerialize};
use light_sdk::{address::AddressSeed, address::v2::derive_address};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    program_option::COption,
    program_pack::Pack,
    pubkey,
    pubkey::Pubkey,
};
use spl_token::state::{Account as SplTokenAccount, AccountState, Mint as SplTokenMint};

use ameba_spread_program::ID as CURRENT_PROGRAM_ID;

use crate::{
    ameba_dlmm_state::{
        AMOEBA_DLMM_BIN_PAGE_LIGHT_DISCRIMINATOR, AMOEBA_DLMM_POOL_LIGHT_DISCRIMINATOR,
        AMOEBA_DLMM_POSITION_LIGHT_DISCRIMINATOR, AMOEBA_DLMM_SHARE_PAGE_LIGHT_DISCRIMINATOR,
        AmoebaDlmmBinPageV1, AmoebaDlmmPoolV1, AmoebaDlmmPositionV1, AmoebaDlmmSharePageV1,
        derive_ameba_dlmm_bin_page_pda, derive_ameba_dlmm_pool_pda, derive_ameba_dlmm_position_pda,
        derive_ameba_dlmm_share_page_pda, derive_ameba_dlmm_vault_pda,
    },
    constants::{
        COMPRESSED_STATE_LEAF_ADDRESS_SEED, CONTRACT_MINT_PDA_SEED, CONTRACT_MINT_STAGING_PDA_SEED,
        CURRENT_STATE_NAMESPACE_SEED, MARKET_PAGE_LEAF_ADDRESS_SEED, MARKET_PDA_SEED,
        ORACLE_MONTH_PDA_SEED, SETTLEMENT_LEAF_ADDRESS_SEED, SETTLEMENT_V2_PDA_SEED,
        USER_COLLATERAL_PDA_SEED, VAULT_PDA_SEED,
    },
    state::{
        CompressedMarketPageLeaf, CompressedSettlementLeaf, CompressedStateDomain, Market,
        OracleMonthState, SettlementRecordV2, SettlementSignerRegistry, SettlementSignerSet,
        UserCollateral, VaultConfig,
    },
};

#[cfg(test)]
use crate::state::CompressedAmebaStateLeaf;

pub const CURRENT_PROTOCOL_SOURCE_COMMIT: &str = "1b2230d96e51f6582155d8284900fbfc11ff1f18";
pub const CURRENT_PROTOCOL_RELEASE: &str = "v0.1.0-rc.44";
pub const HISTORICAL_RC44_PROTOCOL_SOURCE_COMMIT: &str = CURRENT_PROTOCOL_SOURCE_COMMIT;
pub const HISTORICAL_RC44_PROTOCOL_RELEASE: &str = CURRENT_PROTOCOL_RELEASE;
pub const CURRENT_PROTOCOL_CLUSTER: &str = "devnet";
pub const CURRENT_PROTOCOL_DEVNET_GENESIS_HASH: &str =
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
pub const CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS: &str =
    "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
pub const CURRENT_PROTOCOL_PROGRAMDATA_BYTES: usize = 1_241_821;
pub const CURRENT_PROTOCOL_UPGRADE_AUTHORITY: Pubkey =
    pubkey!("D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq");
pub const CURRENT_PROTOCOL_DEPLOYED_SLOT: u64 = 487_702_729;
pub const CURRENT_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT: u64 = 487_703_026;
pub const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES: usize = 1_142_664;
pub const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256: &str =
    "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
pub const CURRENT_PROTOCOL_BUILD_RECEIPT_SHA256: &str =
    "3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322";
pub const CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE: &str =
    "24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65";
pub const CURRENT_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256: &str =
    "c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31";
pub const CURRENT_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256: &str =
    "8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94";
pub const HISTORICAL_RC44_PROTOCOL_CLUSTER: &str = CURRENT_PROTOCOL_CLUSTER;
pub const HISTORICAL_RC44_PROTOCOL_DEVNET_GENESIS_HASH: &str = CURRENT_PROTOCOL_DEVNET_GENESIS_HASH;
pub const HISTORICAL_RC44_PROTOCOL_PROGRAMDATA_ADDRESS: &str = CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS;
pub const HISTORICAL_RC44_PROTOCOL_PROGRAMDATA_BYTES: usize = CURRENT_PROTOCOL_PROGRAMDATA_BYTES;
pub const HISTORICAL_RC44_PROTOCOL_UPGRADE_AUTHORITY: Pubkey = CURRENT_PROTOCOL_UPGRADE_AUTHORITY;
pub const HISTORICAL_RC44_PROTOCOL_DEPLOYED_SLOT: u64 = CURRENT_PROTOCOL_DEPLOYED_SLOT;
pub const HISTORICAL_RC44_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT: u64 =
    CURRENT_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT;
pub const HISTORICAL_RC44_PROTOCOL_PROGRAM_PAYLOAD_BYTES: usize =
    CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES;
pub const HISTORICAL_RC44_PROTOCOL_PROGRAM_PAYLOAD_SHA256: &str =
    CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256;
pub const HISTORICAL_RC44_PROTOCOL_BUILD_RECEIPT_SHA256: &str =
    CURRENT_PROTOCOL_BUILD_RECEIPT_SHA256;
pub const HISTORICAL_RC44_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE: &str =
    CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE;
pub const HISTORICAL_RC44_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256: &str =
    CURRENT_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256;
pub const HISTORICAL_RC44_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256: &str =
    CURRENT_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256;
/// Exact taker fee admitted by the current RC44 Market layout validator.
pub const CURRENT_MARKET_TAKER_FEE_BPS: u16 = 20;

pub const CURRENT_MARKET_ACCOUNT_SIZE: usize = Market::LEN;
pub const CURRENT_ORACLE_MONTH_ACCOUNT_SIZE: usize = OracleMonthState::LEN;
pub const CURRENT_AMOEBA_DLMM_POOL_ACCOUNT_SIZE: usize = AmoebaDlmmPoolV1::LEN;
pub const CURRENT_AMOEBA_DLMM_BIN_PAGE_ACCOUNT_SIZE: usize = AmoebaDlmmBinPageV1::LEN;
pub const CURRENT_AMOEBA_DLMM_SHARE_PAGE_ACCOUNT_SIZE: usize = AmoebaDlmmSharePageV1::LEN;
pub const CURRENT_AMOEBA_DLMM_POSITION_ACCOUNT_SIZE: usize = AmoebaDlmmPositionV1::LEN;

pub const CURRENT_LIGHT_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m");
pub const CURRENT_LIGHT_TOKEN_CPI_AUTHORITY: Pubkey =
    pubkey!("GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy");
pub const CURRENT_LIGHT_SPL_INTERFACE_PDA_SEED: &[u8] = b"pool";
pub const CURRENT_SPL_TOKEN_PROGRAM_ID: Pubkey = spl_token::ID;
pub const CURRENT_SYSTEM_PROGRAM_ID: Pubkey = solana_sdk_ids::system_program::ID;

#[derive(Clone, Copy, Debug)]
pub struct CurrentAccountData<'a> {
    pub address: Pubkey,
    pub owner: Pubkey,
    pub executable: bool,
    pub data: &'a [u8],
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum CurrentProtocolError {
    #[error("program id does not match the pinned current protocol identity")]
    ProgramIdMismatch,
    #[error("account owner does not match the current protocol identity")]
    WrongOwner,
    #[error("an executable account cannot be decoded as protocol state")]
    ExecutableAccount,
    #[error("account length mismatch: expected {expected}, received {actual}")]
    AccountLength { expected: usize, actual: usize },
    #[error("current account data is malformed or contains nonzero trailing bytes")]
    InvalidAccountData,
    #[error("account is not initialized")]
    Uninitialized,
    #[error("account discriminator or version is not current")]
    StaleLayout,
    #[error("account address, bump, or embedded identity is not canonical")]
    InvalidIdentity,
    #[error("current account invariants are not satisfied")]
    InvalidInvariant,
    #[error("instruction data is malformed or does not belong to the current ABI")]
    InvalidInstruction,
}

pub(crate) fn require_current_program_id(program_id: &Pubkey) -> Result<(), CurrentProtocolError> {
    if *program_id != CURRENT_PROGRAM_ID {
        return Err(CurrentProtocolError::ProgramIdMismatch);
    }
    Ok(())
}

pub(crate) fn require_program_account(
    account: CurrentAccountData<'_>,
    expected_len: usize,
    program_id: &Pubkey,
) -> Result<(), CurrentProtocolError> {
    require_current_program_id(program_id)?;
    if account.owner != *program_id {
        return Err(CurrentProtocolError::WrongOwner);
    }
    if account.executable {
        return Err(CurrentProtocolError::ExecutableAccount);
    }
    if account.data.len() != expected_len {
        return Err(CurrentProtocolError::AccountLength {
            expected: expected_len,
            actual: account.data.len(),
        });
    }
    Ok(())
}

pub(crate) fn decode_zero_padded<T: BorshDeserialize>(
    data: &[u8],
) -> Result<T, CurrentProtocolError> {
    let mut remaining = data;
    let value =
        T::deserialize(&mut remaining).map_err(|_| CurrentProtocolError::InvalidAccountData)?;
    if remaining.iter().any(|byte| *byte != 0) {
        return Err(CurrentProtocolError::InvalidAccountData);
    }
    Ok(value)
}

pub fn derive_vault_config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED], program_id)
}

pub fn derive_market_pda(program_id: &Pubkey, market_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED, market_id],
        program_id,
    )
}

pub fn derive_contract_mint_pda(program_id: &Pubkey, market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            CONTRACT_MINT_PDA_SEED,
            market.as_ref(),
        ],
        program_id,
    )
}

pub fn derive_contract_mint_staging_pda(program_id: &Pubkey, market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            CONTRACT_MINT_STAGING_PDA_SEED,
            market.as_ref(),
        ],
        program_id,
    )
}

pub fn derive_light_spl_interface_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CURRENT_LIGHT_SPL_INTERFACE_PDA_SEED, mint.as_ref()],
        &CURRENT_LIGHT_TOKEN_PROGRAM_ID,
    )
}

pub fn derive_oracle_month_pda(
    program_id: &Pubkey,
    market: &Pubkey,
    expiry_ts: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry_ts.to_le_bytes(),
        ],
        program_id,
    )
}

pub fn derive_user_collateral_pda(program_id: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            USER_COLLATERAL_PDA_SEED,
            owner.as_ref(),
        ],
        program_id,
    )
}

pub fn derive_settlement_record_v2_pda(
    program_id: &Pubkey,
    market: &Pubkey,
    oracle_month: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            SETTLEMENT_V2_PDA_SEED,
            market.as_ref(),
            oracle_month.as_ref(),
        ],
        program_id,
    )
}

pub fn derive_compressed_state_leaf_address(
    program_id: &Pubkey,
    tree_pubkey: &Pubkey,
    domain: CompressedStateDomain,
    canonical_pda: &Pubkey,
) -> ([u8; 32], AddressSeed) {
    let domain_seed = [domain.address_tag()];
    derive_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            COMPRESSED_STATE_LEAF_ADDRESS_SEED,
            &domain_seed,
            canonical_pda.as_ref(),
        ],
        tree_pubkey,
        program_id,
    )
}

pub fn derive_market_page_leaf_address(
    program_id: &Pubkey,
    tree_pubkey: &Pubkey,
    page: &CompressedMarketPageLeaf,
) -> ([u8; 32], AddressSeed) {
    derive_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            MARKET_PAGE_LEAF_ADDRESS_SEED,
            page.item_id.as_bytes(),
            &page.underlying_id,
        ],
        tree_pubkey,
        program_id,
    )
}

pub fn derive_settlement_leaf_address(
    program_id: &Pubkey,
    tree_pubkey: &Pubkey,
    settlement: &CompressedSettlementLeaf,
) -> ([u8; 32], AddressSeed) {
    derive_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            SETTLEMENT_LEAF_ADDRESS_SEED,
            settlement.oracle_month.as_ref(),
            settlement.item_id.as_bytes(),
            &settlement.underlying_id,
            settlement.expiry_id.as_bytes(),
        ],
        tree_pubkey,
        program_id,
    )
}

pub fn decode_current_vault_config(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
) -> Result<VaultConfig, CurrentProtocolError> {
    require_program_account(account, VaultConfig::LEN, program_id)?;
    let value: VaultConfig = decode_zero_padded(account.data)?;
    let (expected, bump) = derive_vault_config_pda(program_id);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    if account.address != expected || value.bump != bump {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

pub fn decode_current_market(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
) -> Result<Market, CurrentProtocolError> {
    require_program_account(account, Market::LEN, program_id)?;
    let value: Market = decode_zero_padded(account.data)?;
    let (expected, bump) = derive_market_pda(program_id, &value.market_id);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if !value.mint_accounting.has_canonical_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    if account.address != expected || value.bump != bump {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let spread_width = match value.instrument.kind {
        crate::state::OptionKind::CallSpread => value
            .instrument
            .cap_price
            .checked_sub(value.instrument.strike_price),
        crate::state::OptionKind::PutSpread => value
            .instrument
            .strike_price
            .checked_sub(value.instrument.cap_price),
    }
    .ok_or(CurrentProtocolError::InvalidInvariant)?;
    let expected_max_payout = u64::try_from(
        u128::from(spread_width)
            .checked_mul(u128::from(value.instrument.contract_size))
            .ok_or(CurrentProtocolError::InvalidInvariant)?
            / u128::from(crate::state::MarketMintAccounting::CANONICAL_ATOMIC_SCALE),
    )
    .map_err(|_| CurrentProtocolError::InvalidInvariant)?;
    let expected_maximum_bin_id = value
        .instrument
        .max_payout_per_contract
        .checked_div(crate::constants::AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC)
        .ok_or(CurrentProtocolError::InvalidInvariant)?;
    if value.mint_accounting.total_burned > value.mint_accounting.total_consumed
        || value.mint_accounting.total_consumed > value.mint_accounting.total_issued
        || value.created_by == Pubkey::default()
        || value.collateral_mint == Pubkey::default()
        || value.instrument.expiry_ts == 0
        || value.instrument.contract_size == 0
        || value.instrument.max_payout_per_contract == 0
        || expected_max_payout == 0
        || expected_max_payout != value.instrument.max_payout_per_contract
        || value.params.tick_size != crate::constants::AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC
        || value.instrument.max_payout_per_contract % value.params.tick_size != 0
        || expected_maximum_bin_id == 0
        || expected_maximum_bin_id > u64::from(crate::constants::MAX_AMOEBA_DLMM_BIN_COUNT)
        || value.params.lot_size != 1
        || value.params.min_order_qty != 1
        || value.params.maker_fee_bps > 10_000
        || value.params.taker_fee_bps != CURRENT_MARKET_TAKER_FEE_BPS
        || value.params.cancel_fee_bps > 10_000
        || value.params.max_fills_per_instruction != crate::constants::MAX_AMOEBA_DLMM_BINS_PER_SWAP
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn decode_current_oracle_month(
    account: CurrentAccountData<'_>,
    expiry_ts: u64,
    program_id: &Pubkey,
) -> Result<OracleMonthState, CurrentProtocolError> {
    require_program_account(account, OracleMonthState::LEN, program_id)?;
    let value: OracleMonthState = decode_zero_padded(account.data)?;
    let (expected, bump) = derive_oracle_month_pda(program_id, &value.market, expiry_ts);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if !value.has_current_layout()
        || !value.has_rulebook_schedule()
        || value.work_reward_currency_version != OracleMonthState::WORK_REWARD_CURRENCY_USDC_V1
        || value.candidate_count_tracking_version != 1
        || value.active_weight_initialization_version != 1
    {
        return Err(CurrentProtocolError::StaleLayout);
    }
    if account.address != expected || value.bump != bump {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

pub fn decode_current_user_collateral(
    account: CurrentAccountData<'_>,
    expected_owner: &Pubkey,
    program_id: &Pubkey,
) -> Result<UserCollateral, CurrentProtocolError> {
    require_program_account(account, UserCollateral::LEN, program_id)?;
    let value: UserCollateral = decode_zero_padded(account.data)?;
    let (expected, bump) = derive_user_collateral_pda(program_id, expected_owner);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if account.address != expected || value.bump != bump || value.owner != *expected_owner {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

pub fn decode_current_settlement_record_v2(
    account: CurrentAccountData<'_>,
    market: &Pubkey,
    oracle_month: &Pubkey,
    program_id: &Pubkey,
) -> Result<SettlementRecordV2, CurrentProtocolError> {
    require_program_account(account, SettlementRecordV2::LEN, program_id)?;
    let value: SettlementRecordV2 = decode_zero_padded(account.data)?;
    let (expected, bump) = derive_settlement_record_v2_pda(program_id, market, oracle_month);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if value.account_discriminator != SettlementRecordV2::ACCOUNT_DISCRIMINATOR
        || value.account_version != SettlementRecordV2::ACCOUNT_VERSION
    {
        return Err(CurrentProtocolError::StaleLayout);
    }
    if account.address != expected
        || value.bump != bump
        || value.market != *market
        || value.oracle_month != *oracle_month
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    if value.signed_leaf_commitment == [0; 32]
        || value.submitted_by == Pubkey::default()
        || value.signer_set_version == 0
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn decode_current_settlement_signer_registry(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
) -> Result<SettlementSignerRegistry, CurrentProtocolError> {
    require_program_account(account, SettlementSignerRegistry::LEN, program_id)?;
    let value: SettlementSignerRegistry = decode_zero_padded(account.data)?;
    let (expected, bump) = crate::state::derive_settlement_signer_registry_pda(program_id);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    if account.address != expected
        || value.bump != bump
        || value.current_set == Pubkey::default()
        || value.current_version == 0
        || value.recovery_authority == Pubkey::default()
        || (value.pending_set == Pubkey::default()) != (value.pending_version == 0)
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

pub fn decode_current_settlement_signer_set(
    account: CurrentAccountData<'_>,
    registry: &Pubkey,
    program_id: &Pubkey,
) -> Result<SettlementSignerSet, CurrentProtocolError> {
    require_program_account(account, SettlementSignerSet::LEN, program_id)?;
    let value: SettlementSignerSet = decode_zero_padded(account.data)?;
    let (expected, bump) =
        crate::state::derive_settlement_signer_set_pda(program_id, value.version);
    if !value.is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    if account.address != expected
        || value.bump != bump
        || value.registry != *registry
        || value.proposer == Pubkey::default()
        || value.activate_after_slot < value.proposed_slot
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let signer_count = usize::from(value.signer_count);
    let threshold = usize::from(value.threshold);
    if value.version == 0
        || signer_count == 0
        || signer_count > value.signers.len()
        || threshold == 0
        || threshold > signer_count
        || threshold.saturating_mul(2) <= signer_count
        || value.rotation_delay_slots < crate::constants::MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS
        || value.signers[..signer_count]
            .iter()
            .any(|signer| *signer == Pubkey::default())
        || value.signers[..signer_count]
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || value.signers[signer_count..]
            .iter()
            .any(|signer| *signer != Pubkey::default())
        || value.compute_set_hash() != value.set_hash
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn decode_current_contract_mint(
    account: CurrentAccountData<'_>,
    market_address: &Pubkey,
    market: &Market,
    program_id: &Pubkey,
) -> Result<SplTokenMint, CurrentProtocolError> {
    require_current_program_id(program_id)?;
    if account.owner != CURRENT_SPL_TOKEN_PROGRAM_ID || account.executable {
        return Err(CurrentProtocolError::WrongOwner);
    }
    if account.data.len() != SplTokenMint::LEN {
        return Err(CurrentProtocolError::AccountLength {
            expected: SplTokenMint::LEN,
            actual: account.data.len(),
        });
    }
    if account.address != derive_contract_mint_pda(program_id, market_address).0
        || market.long_contract_mint != Some(account.address)
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let mint =
        SplTokenMint::unpack(account.data).map_err(|_| CurrentProtocolError::InvalidAccountData)?;
    if mint.mint_authority != COption::Some(*market_address)
        || mint.freeze_authority != COption::None
        || mint.decimals != crate::state::MarketMintAccounting::CANONICAL_DECIMALS
        || !mint.is_initialized
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    let accounting = &market.mint_accounting;
    let expected_supply = accounting
        .total_issued
        .checked_sub(accounting.total_burned)
        .ok_or(CurrentProtocolError::InvalidInvariant)?;
    if !accounting.has_canonical_layout()
        || accounting.total_burned > accounting.total_consumed
        || accounting.total_consumed > accounting.total_issued
        || mint.supply != expected_supply
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(mint)
}

pub fn decode_current_light_spl_interface(
    account: CurrentAccountData<'_>,
    mint: &Pubkey,
) -> Result<SplTokenAccount, CurrentProtocolError> {
    if account.owner != CURRENT_SPL_TOKEN_PROGRAM_ID || account.executable {
        return Err(CurrentProtocolError::WrongOwner);
    }
    if account.data.len() != SplTokenAccount::LEN {
        return Err(CurrentProtocolError::AccountLength {
            expected: SplTokenAccount::LEN,
            actual: account.data.len(),
        });
    }
    if account.address != derive_light_spl_interface_pda(mint).0 {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let token = SplTokenAccount::unpack(account.data)
        .map_err(|_| CurrentProtocolError::InvalidAccountData)?;
    if token.mint != *mint
        || token.owner != CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
        || token.state != AccountState::Initialized
        || token.delegate != COption::None
        || token.delegated_amount != 0
        || token.is_native != COption::None
        || token.close_authority != COption::None
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(token)
}

#[cfg(test)]
fn decode_current_compressed_state_leaf_identity(
    data: &[u8],
    address: [u8; 32],
    address_tree: Pubkey,
    canonical_pda: Pubkey,
    domain: CompressedStateDomain,
) -> Result<CompressedAmebaStateLeaf, CurrentProtocolError> {
    let value = CompressedAmebaStateLeaf::try_from_slice(data)
        .map_err(|_| CurrentProtocolError::InvalidAccountData)?;
    if !value.has_canonical_envelope() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    let expected =
        derive_compressed_state_leaf_address(&crate::ID, &address_tree, domain, &canonical_pda).0;
    if address_tree != crate::constants::LIGHT_DEFAULT_ADDRESS_TREE_V2
        || address != expected
        || value.domain != domain
        || value.canonical_pda != canonical_pda
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Truthful host capability for compressed-state authentication.
///
/// The SDK intentionally exposes no verifier-issued authentication token here. A valid verifier
/// must bind the canonical StateV2 tree, queue, CPI context, compressed address, leaf hash, and a
/// validity proof to a finalized root. That production verifier is not available in this crate;
/// the CLI therefore retains its local current-only proof seam.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentCompressedStateAuthenticationCapability {
    Unavailable,
}

pub const CURRENT_COMPRESSED_STATE_AUTHENTICATION_CAPABILITY:
    CurrentCompressedStateAuthenticationCapability =
    CurrentCompressedStateAuthenticationCapability::Unavailable;

/// Decode and identity-check a compressed leaf without asserting proof authentication.
///
/// This is intentionally named `candidate`: callers may inspect the current envelope and
/// canonical address binding, but must not use the result as authenticated state. The SDK does
/// not export an authenticated decoder until a production verifier can validate the canonical
/// Light validity proof against a finalized state-tree root.
///
/// Caller-asserted authentication is not part of the current host ABI:
///
/// ```compile_fail
/// use ameba_sdk::CurrentCompressedStateAuthentication;
/// ```
///
/// Nor is there an authenticated decoder that can accept caller-supplied root/proof assertions:
///
/// ```compile_fail
/// use ameba_sdk::decode_authenticated_current_compressed_state_leaf;
/// ```
///
/// Mutated root/proof assertions cannot be appended to the identity-only API:
///
/// ```compile_fail
/// use ameba_sdk::{decode_current_compressed_state_leaf_candidate, state::CompressedStateDomain};
/// use solana_program::pubkey::Pubkey;
/// let mutated_root = [9; 32];
/// let mutated_proof = [8; 128];
/// let _ = decode_current_compressed_state_leaf_candidate(
///     &[],
///     [0; 32],
///     Pubkey::new_from_array([1; 32]),
///     Pubkey::new_from_array([2; 32]),
///     CompressedStateDomain::OracleSkuCoverageRecord,
///     mutated_root,
///     mutated_proof,
/// );
/// ```
#[cfg(test)]
pub(crate) fn decode_current_compressed_state_leaf_candidate(
    data: &[u8],
    address: [u8; 32],
    address_tree: Pubkey,
    canonical_pda: Pubkey,
    domain: CompressedStateDomain,
) -> Result<CompressedAmebaStateLeaf, CurrentProtocolError> {
    decode_current_compressed_state_leaf_identity(
        data,
        address,
        address_tree,
        canonical_pda,
        domain,
    )
}

fn decode_dlmm_body<T: BorshDeserialize>(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_len: usize,
    discriminator: &[u8; 8],
) -> Result<T, CurrentProtocolError> {
    require_program_account(account, expected_len, program_id)?;
    if account.data.get(..8) != Some(discriminator.as_slice()) {
        return Err(CurrentProtocolError::StaleLayout);
    }
    T::try_from_slice(&account.data[8..]).map_err(|_| CurrentProtocolError::InvalidAccountData)
}

pub fn decode_current_ameba_dlmm_pool(
    account: CurrentAccountData<'_>,
    market_address: &Pubkey,
    market: &Market,
    oracle_month: &Pubkey,
    config: &VaultConfig,
    program_id: &Pubkey,
) -> Result<AmoebaDlmmPoolV1, CurrentProtocolError> {
    let value: AmoebaDlmmPoolV1 = decode_dlmm_body(
        account,
        program_id,
        AmoebaDlmmPoolV1::LEN,
        &AMOEBA_DLMM_POOL_LIGHT_DISCRIMINATOR,
    )?;
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    let (expected, bump) = derive_ameba_dlmm_pool_pda(program_id, &value.market);
    if account.address != expected
        || value.bump != bump
        || value.market != *market_address
        || *market_address != derive_market_pda(program_id, &market.market_id).0
        || value.oracle_month != *oracle_month
        || *oracle_month
            != derive_oracle_month_pda(program_id, market_address, market.instrument.expiry_ts).0
        || value.option_mint != market.long_contract_mint.unwrap_or_default()
        || value.quote_mint != market.collateral_mint
        || value.quote_mint != config.usdc_mint
        || value.expiry_ts != market.instrument.expiry_ts
        || value.option_vault
            != derive_ameba_dlmm_vault_pda(program_id, &account.address, &value.option_mint).0
        || value.quote_vault
            != derive_ameba_dlmm_vault_pda(program_id, &account.address, &value.quote_mint).0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let expected_maximum_bin_id = market
        .instrument
        .max_payout_per_contract
        .checked_div(market.params.tick_size)
        .and_then(|value| u16::try_from(value).ok())
        .ok_or(CurrentProtocolError::InvalidInvariant)?;
    let expected_maximum_bins_per_swap = market
        .params
        .max_fills_per_instruction
        .min(crate::constants::MAX_AMOEBA_DLMM_BINS_PER_SWAP);
    let (maximum_page, _) = crate::ameba_dlmm_math::bin_to_page(value.maximum_bin_id)
        .map_err(|_| CurrentProtocolError::InvalidInvariant)?;
    let retained_bits = u32::from(maximum_page) + 1;
    let allowed_page_bitmap = if retained_bits == 64 {
        u64::MAX
    } else {
        (1_u64 << retained_bits) - 1
    };
    let first_ask_page =
        (value.ask_page_bitmap != 0).then(|| value.ask_page_bitmap.trailing_zeros() as u16);
    let last_bid_page =
        (value.bid_page_bitmap != 0).then(|| 63_u16 - value.bid_page_bitmap.leading_zeros() as u16);
    let best_ask_matches = match first_ask_page {
        None => value.best_ask_bin_id == crate::ameba_dlmm_state::AMOEBA_DLMM_EMPTY_BIN_ID,
        Some(page) => {
            value.best_ask_bin_id != crate::ameba_dlmm_state::AMOEBA_DLMM_EMPTY_BIN_ID
                && value.best_ask_bin_id <= value.maximum_bin_id
                && crate::ameba_dlmm_math::bin_to_page(value.best_ask_bin_id)
                    .is_ok_and(|location| location.0 == page)
        }
    };
    let best_bid_matches = match last_bid_page {
        None => value.best_bid_bin_id == crate::ameba_dlmm_state::AMOEBA_DLMM_EMPTY_BIN_ID,
        Some(page) => {
            value.best_bid_bin_id != crate::ameba_dlmm_state::AMOEBA_DLMM_EMPTY_BIN_ID
                && value.best_bid_bin_id <= value.maximum_bin_id
                && crate::ameba_dlmm_math::bin_to_page(value.best_bid_bin_id)
                    .is_ok_and(|location| location.0 == page)
        }
    };
    if value.market == Pubkey::default()
        || value.oracle_month == Pubkey::default()
        || value.liquidity_manager == Pubkey::default()
        || value.option_mint == Pubkey::default()
        || value.quote_mint == Pubkey::default()
        || value.option_mint == value.quote_mint
        || value.option_vault == Pubkey::default()
        || value.quote_vault == Pubkey::default()
        || value.option_vault == value.quote_vault
        || value.expiry_ts == 0
        || value.tick_size_quote_atomic == 0
        || value.maximum_price_quote_atomic == 0
        || value.maximum_bin_id == 0
        || value.maximum_bin_id > crate::constants::MAX_AMOEBA_DLMM_BIN_COUNT
        || value
            .tick_size_quote_atomic
            .checked_mul(u64::from(value.maximum_bin_id))
            != Some(value.maximum_price_quote_atomic)
        || value.tick_size_quote_atomic != market.params.tick_size
        || value.maximum_price_quote_atomic != market.instrument.max_payout_per_contract
        || value.maximum_bin_id != expected_maximum_bin_id
        || value.swap_fee_bps != market.params.taker_fee_bps
        || value.swap_fee_bps > crate::constants::MAX_AMOEBA_DLMM_SWAP_FEE_BPS
        || value.protocol_fee_share_bps > 10_000
        || value.maximum_bins_per_swap != expected_maximum_bins_per_swap
        || !(1..=crate::constants::MAX_AMOEBA_DLMM_BINS_PER_SWAP)
            .contains(&value.maximum_bins_per_swap)
        || value.initialized_page_bitmap & !allowed_page_bitmap != 0
        || (value.bid_page_bitmap | value.ask_page_bitmap) & !value.initialized_page_bitmap != 0
        || !best_ask_matches
        || !best_bid_matches
        || (value.last_trade_bin_id != crate::ameba_dlmm_state::AMOEBA_DLMM_EMPTY_BIN_ID
            && value.last_trade_bin_id > value.maximum_bin_id)
        || value
            .accounted_option_reserve
            .checked_add(value.protocol_fee_option)
            .is_none()
        || value
            .accounted_quote_reserve
            .checked_add(value.protocol_fee_quote)
            .is_none()
        || !config.has_current_layout()
        || config.admin == Pubkey::default()
        || config.oracle_authority == Pubkey::default()
        || config.usdc_mint == Pubkey::default()
        || config.vault_token_account == Pubkey::default()
        || !market.mint_accounting.has_canonical_layout()
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn decode_current_ameba_dlmm_bin_page(
    account: CurrentAccountData<'_>,
    expected_pool: &Pubkey,
    program_id: &Pubkey,
) -> Result<AmoebaDlmmBinPageV1, CurrentProtocolError> {
    let value: AmoebaDlmmBinPageV1 = decode_dlmm_body(
        account,
        program_id,
        AmoebaDlmmBinPageV1::LEN,
        &AMOEBA_DLMM_BIN_PAGE_LIGHT_DISCRIMINATOR,
    )?;
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    let (expected, bump) =
        derive_ameba_dlmm_bin_page_pda(program_id, &value.pool, value.page_index);
    if account.address != expected
        || value.bump != bump
        || value.pool != *expected_pool
        || value.page_index >= crate::constants::MAX_AMOEBA_DLMM_PAGE_COUNT
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    if crate::ameba_dlmm_math::page_first_bin(value.page_index)
        .map_err(|_| CurrentProtocolError::InvalidInvariant)?
        != value.first_bin_id
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    if crate::ameba_dlmm_math::refresh_local_liquidity_bits(
        &value.option_reserve,
        &value.quote_reserve,
    ) != (value.bid_bitmap, value.ask_bitmap)
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn decode_current_ameba_dlmm_share_page(
    account: CurrentAccountData<'_>,
    expected_pool: &Pubkey,
    program_id: &Pubkey,
) -> Result<AmoebaDlmmSharePageV1, CurrentProtocolError> {
    let value: AmoebaDlmmSharePageV1 = decode_dlmm_body(
        account,
        program_id,
        AmoebaDlmmSharePageV1::LEN,
        &AMOEBA_DLMM_SHARE_PAGE_LIGHT_DISCRIMINATOR,
    )?;
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    let (expected, bump) =
        derive_ameba_dlmm_share_page_pda(program_id, &value.pool, value.page_index);
    if account.address != expected
        || value.bump != bump
        || value.pool != *expected_pool
        || value.page_index >= crate::constants::MAX_AMOEBA_DLMM_PAGE_COUNT
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    if crate::ameba_dlmm_math::page_first_bin(value.page_index)
        .map_err(|_| CurrentProtocolError::InvalidInvariant)?
        != value.first_bin_id
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn decode_current_ameba_dlmm_position(
    account: CurrentAccountData<'_>,
    expected_pool: &Pubkey,
    maximum_bin_id: u16,
    program_id: &Pubkey,
) -> Result<AmoebaDlmmPositionV1, CurrentProtocolError> {
    let value: AmoebaDlmmPositionV1 = decode_dlmm_body(
        account,
        program_id,
        AmoebaDlmmPositionV1::LEN,
        &AMOEBA_DLMM_POSITION_LIGHT_DISCRIMINATOR,
    )?;
    if !value.has_current_layout() {
        return Err(CurrentProtocolError::StaleLayout);
    }
    let (expected, bump) =
        derive_ameba_dlmm_position_pda(program_id, &value.pool, &value.owner, value.position_nonce);
    if account.address != expected
        || value.bump != bump
        || value.pool != *expected_pool
        || value.owner == Pubkey::default()
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let expected_initialized_bitmap = value
        .liquidity_shares
        .iter()
        .enumerate()
        .fold(0_u32, |bitmap, (index, shares)| {
            bitmap | (u32::from(*shares != 0) << index)
        });
    let upper_bin_id = value
        .lower_bin_id
        .checked_add(u16::from(value.bin_count).saturating_sub(1))
        .ok_or(CurrentProtocolError::InvalidInvariant)?;
    if !(1..=32).contains(&value.bin_count)
        || value.lower_bin_id == 0
        || upper_bin_id > maximum_bin_id
        || value.initialized_bitmap != expected_initialized_bitmap
        || (value.bin_count < 32 && value.initialized_bitmap >> value.bin_count != 0)
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(value)
}

pub fn validate_current_ameba_dlmm_page_pair(
    bin_page: &AmoebaDlmmBinPageV1,
    share_page: &AmoebaDlmmSharePageV1,
) -> Result<(), CurrentProtocolError> {
    if bin_page.pool != share_page.pool
        || bin_page.page_index != share_page.page_index
        || bin_page.first_bin_id != share_page.first_bin_id
        || bin_page
            .option_reserve
            .iter()
            .zip(&bin_page.quote_reserve)
            .zip(&share_page.total_liquidity_shares)
            .any(|((option, quote), shares)| (*option != 0 || *quote != 0) != (*shares != 0))
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(())
}

pub fn validate_current_ameba_dlmm_pool_pages(
    pool_address: &Pubkey,
    pool: &AmoebaDlmmPoolV1,
    pages: &[AmoebaDlmmBinPageV1],
) -> Result<(), CurrentProtocolError> {
    let mut initialized = 0_u64;
    let mut bids = 0_u64;
    let mut asks = 0_u64;
    let mut option_reserve = 0_u64;
    let mut quote_reserve = 0_u64;
    for page in pages {
        if page.pool != *pool_address
            || page.page_index >= crate::constants::MAX_AMOEBA_DLMM_PAGE_COUNT
        {
            return Err(CurrentProtocolError::InvalidIdentity);
        }
        let bit = 1_u64 << page.page_index;
        if initialized & bit != 0 {
            return Err(CurrentProtocolError::InvalidInvariant);
        }
        initialized |= bit;
        if page.bid_bitmap != 0 {
            bids |= bit;
        }
        if page.ask_bitmap != 0 {
            asks |= bit;
        }
        for reserve in &page.option_reserve {
            option_reserve = option_reserve
                .checked_add(*reserve)
                .ok_or(CurrentProtocolError::InvalidInvariant)?;
        }
        for reserve in &page.quote_reserve {
            quote_reserve = quote_reserve
                .checked_add(*reserve)
                .ok_or(CurrentProtocolError::InvalidInvariant)?;
        }
    }
    if initialized != pool.initialized_page_bitmap
        || bids != pool.bid_page_bitmap
        || asks != pool.ask_page_bitmap
        || option_reserve != pool.accounted_option_reserve
        || quote_reserve != pool.accounted_quote_reserve
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    Ok(())
}

/// Validates the complete current reserve/share page set against one pool.
///
/// The pool-level accounting check is intentionally separate from per-account
/// decoding: only the complete initialized-page set can prove exact reserve
/// totals and that no LP shares survive outside the configured grid.
pub fn validate_current_ameba_dlmm_pool_page_pairs(
    pool_address: &Pubkey,
    pool: &AmoebaDlmmPoolV1,
    pairs: &[(AmoebaDlmmBinPageV1, AmoebaDlmmSharePageV1)],
) -> Result<(), CurrentProtocolError> {
    let reserve_pages: Vec<_> = pairs.iter().map(|(reserve, _)| reserve.clone()).collect();
    validate_current_ameba_dlmm_pool_pages(pool_address, pool, &reserve_pages)?;
    for (reserve, shares) in pairs {
        validate_current_ameba_dlmm_page_pair(reserve, shares)?;
        if reserve.pool != *pool_address || shares.pool != *pool_address {
            return Err(CurrentProtocolError::InvalidIdentity);
        }
        for (index, total_shares) in shares.total_liquidity_shares.iter().enumerate() {
            let bin_id = reserve
                .first_bin_id
                .checked_add(index as u16)
                .ok_or(CurrentProtocolError::InvalidInvariant)?;
            if bin_id > pool.maximum_bin_id && *total_shares != 0 {
                return Err(CurrentProtocolError::InvalidInvariant);
            }
        }
    }
    Ok(())
}

fn writable(pubkey: Pubkey, signer: bool) -> AccountMeta {
    AccountMeta::new(pubkey, signer)
}

fn readonly(pubkey: Pubkey, signer: bool) -> AccountMeta {
    AccountMeta::new_readonly(pubkey, signer)
}

pub fn encode_current_vault_instruction(
    instruction: &crate::instruction::VaultInstruction,
) -> Result<Vec<u8>, CurrentProtocolError> {
    let data = instruction
        .try_to_vec()
        .map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    if data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let decoded = crate::instruction::VaultInstruction::try_from_slice(&data)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    if decoded != *instruction {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(data)
}

pub fn decode_current_vault_instruction(
    data: &[u8],
) -> Result<crate::instruction::VaultInstruction, CurrentProtocolError> {
    if data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    crate::instruction::VaultInstruction::try_from_slice(data)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)
}

pub fn build_current_vault_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    instruction: crate::instruction::VaultInstruction,
) -> Result<Instruction, CurrentProtocolError> {
    require_current_program_id(&program_id)?;
    Ok(Instruction {
        program_id,
        accounts,
        data: encode_current_vault_instruction(&instruction)?,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProposeEmergencySettlementSignerRecoveryAccounts {
    pub admin: Pubkey,
    pub oracle_authority: Pubkey,
    pub recovery_authority: Pubkey,
    pub vault_config: Pubkey,
    pub signer_registry: Pubkey,
    pub current_signer_set: Pubkey,
    pub pending_signer_set: Pubkey,
}

pub fn build_propose_emergency_settlement_signer_recovery_instruction(
    program_id: Pubkey,
    accounts: ProposeEmergencySettlementSignerRecoveryAccounts,
    params: crate::instruction::ProposeSettlementSignerRotationParams,
) -> Result<Instruction, CurrentProtocolError> {
    let signer_count = usize::from(params.signer_count);
    let threshold = usize::from(params.threshold);
    if accounts.admin == accounts.oracle_authority
        || accounts.admin == accounts.recovery_authority
        || accounts.oracle_authority == accounts.recovery_authority
        || accounts.current_signer_set == Pubkey::default()
        || accounts.current_signer_set == accounts.pending_signer_set
        || accounts.vault_config != derive_vault_config_pda(&program_id).0
        || accounts.signer_registry
            != crate::state::derive_settlement_signer_registry_pda(&program_id).0
        || accounts.pending_signer_set
            != crate::state::derive_settlement_signer_set_pda(&program_id, params.target_version).0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    if params.target_version == 0
        || signer_count == 0
        || signer_count > params.signers.len()
        || threshold == 0
        || threshold > signer_count
        || threshold.saturating_mul(2) <= signer_count
        || params.rotation_delay_slots
            < crate::constants::MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS
        || params.signers[..signer_count]
            .iter()
            .any(|signer| *signer == Pubkey::default())
        || params.signers[..signer_count]
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || params.signers[signer_count..]
            .iter()
            .any(|signer| *signer != Pubkey::default())
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            readonly(accounts.admin, true),
            readonly(accounts.oracle_authority, true),
            readonly(accounts.recovery_authority, true),
            readonly(accounts.vault_config, false),
            writable(accounts.signer_registry, false),
            readonly(accounts.current_signer_set, false),
            writable(accounts.pending_signer_set, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::ProposeEmergencySettlementSignerRecovery { params },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InitUserCollateralAccounts {
    pub user: Pubkey,
    pub user_collateral: Pubkey,
}

pub fn build_init_user_collateral_instruction(
    program_id: Pubkey,
    accounts: InitUserCollateralAccounts,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        vec![
            writable(accounts.user, true),
            writable(accounts.user_collateral, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::InitUserCollateral,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DepositCollateralAccounts {
    pub user: Pubkey,
    pub user_token_account: Pubkey,
    pub vault_token_account: Pubkey,
    pub vault_config: Pubkey,
    pub user_collateral: Pubkey,
    pub collateral_mint: Pubkey,
}

pub fn build_deposit_collateral_instruction(
    program_id: Pubkey,
    accounts: DepositCollateralAccounts,
    amount: u64,
) -> Result<Instruction, CurrentProtocolError> {
    if amount == 0 {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(accounts.user, true),
            writable(accounts.user_token_account, false),
            writable(accounts.vault_token_account, false),
            readonly(accounts.vault_config, false),
            writable(accounts.user_collateral, false),
            readonly(accounts.collateral_mint, false),
            readonly(CURRENT_SPL_TOKEN_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::DepositCollateral { amount },
    )
}

pub type WithdrawCollateralAccounts = DepositCollateralAccounts;

pub fn build_withdraw_collateral_instruction(
    program_id: Pubkey,
    accounts: WithdrawCollateralAccounts,
    amount: u64,
) -> Result<Instruction, CurrentProtocolError> {
    if amount == 0 {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(accounts.user, true),
            writable(accounts.vault_token_account, false),
            writable(accounts.user_token_account, false),
            readonly(accounts.vault_config, false),
            writable(accounts.user_collateral, false),
            readonly(accounts.collateral_mint, false),
            readonly(CURRENT_SPL_TOKEN_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::WithdrawCollateral { amount },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InitMarketV2Accounts {
    pub admin: Pubkey,
    pub market: Pubkey,
    pub vault_config: Pubkey,
}

pub fn build_init_market_v2_instruction(
    program_id: Pubkey,
    accounts: InitMarketV2Accounts,
    params: crate::instruction::InitMarketV2Params,
) -> Result<Instruction, CurrentProtocolError> {
    if accounts.market != derive_market_pda(&program_id, &params.market_id).0
        || accounts.vault_config != derive_vault_config_pda(&program_id).0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(accounts.admin, true),
            writable(accounts.market, false),
            readonly(accounts.vault_config, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::InitMarketV2 { params },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CreateMarketContractMintV3Accounts {
    pub payer: Pubkey,
    pub market: Pubkey,
    pub vault_config: Pubkey,
    pub contract_mint: Pubkey,
    pub light_spl_interface: Pubkey,
}

pub fn build_create_market_contract_mint_v3_instruction(
    program_id: Pubkey,
    accounts: CreateMarketContractMintV3Accounts,
) -> Result<Instruction, CurrentProtocolError> {
    if accounts.vault_config != derive_vault_config_pda(&program_id).0
        || accounts.contract_mint != derive_contract_mint_pda(&program_id, &accounts.market).0
        || accounts.light_spl_interface != derive_light_spl_interface_pda(&accounts.contract_mint).0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(accounts.payer, true),
            writable(accounts.market, false),
            readonly(accounts.vault_config, false),
            writable(accounts.contract_mint, false),
            writable(accounts.light_spl_interface, false),
            readonly(CURRENT_LIGHT_TOKEN_PROGRAM_ID, false),
            readonly(CURRENT_LIGHT_TOKEN_CPI_AUTHORITY, false),
            readonly(CURRENT_SPL_TOKEN_PROGRAM_ID, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::CreateMarketContractMintV3,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InitializeOracleMonthV5Accounts {
    pub authority: Pubkey,
    pub payer: Pubkey,
    pub market: Pubkey,
    pub oracle_month: Pubkey,
    pub sku_coverage_manifest: Pubkey,
    pub vault_config: Pubkey,
    pub economics_config: Pubkey,
    pub product_sku_manifest: Pubkey,
    pub maturity_ladder_registry: Pubkey,
}

pub fn build_initialize_oracle_month_v5_instruction(
    program_id: Pubkey,
    accounts: InitializeOracleMonthV5Accounts,
    params: crate::instruction::InitializeOracleMonthV5Params,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        vec![
            writable(accounts.authority, true),
            writable(accounts.payer, true),
            readonly(accounts.market, false),
            writable(accounts.oracle_month, false),
            writable(accounts.sku_coverage_manifest, false),
            readonly(accounts.vault_config, false),
            readonly(accounts.economics_config, false),
            readonly(accounts.product_sku_manifest, false),
            writable(accounts.maturity_ladder_registry, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::instruction::VaultInstruction::InitializeOracleMonthV5 { params },
    )
}

pub fn build_upsert_market_page_v2_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    params: crate::instruction::UpsertMarketPageParams,
    proof: light_sdk::proof::borsh_compat::ValidityProof,
    new_page_output: Option<crate::instruction::CompressionOutput>,
    existing_page: Option<crate::instruction::CompressedMarketPageWitness>,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        accounts,
        crate::instruction::VaultInstruction::UpsertMarketPageV2 {
            params,
            proof: Box::new(proof),
            new_page_output: new_page_output.map(Box::new),
            existing_page: existing_page.map(Box::new),
        },
    )
}

pub fn build_upsert_settlement_v3_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    params: crate::instruction::UpsertSettlementParams,
    proof: light_sdk::proof::borsh_compat::ValidityProof,
    new_settlement_output: Option<crate::instruction::CompressionOutput>,
    existing_settlement: Option<crate::instruction::CompressedSettlementWitness>,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        accounts,
        crate::instruction::VaultInstruction::UpsertSettlementV3 {
            params,
            proof: Box::new(proof),
            new_settlement_output: new_settlement_output.map(Box::new),
            existing_settlement: existing_settlement.map(Box::new),
        },
    )
}

pub fn build_execute_compressed_state_v1_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    params: crate::instruction::ExecuteCompressedStateParams,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        accounts,
        crate::instruction::VaultInstruction::ExecuteCompressedStateV1 { params },
    )
}

fn encode_ameba_dlmm_payload<
    P: BorshSerialize + crate::ameba_dlmm_instruction::AmoebaDlmmDecode,
>(
    tag: crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag,
    params: &P,
) -> Result<Vec<u8>, CurrentProtocolError> {
    let mut data = vec![tag as u8];
    params
        .serialize(&mut data)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    if data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    P::decode_exact(&data[1..]).map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    Ok(data)
}

fn build_ameba_dlmm_with_params<
    P: BorshSerialize + crate::ameba_dlmm_instruction::AmoebaDlmmDecode,
>(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    tag: crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag,
    params: &P,
) -> Result<Instruction, CurrentProtocolError> {
    require_current_program_id(&program_id)?;
    Ok(Instruction {
        program_id,
        accounts,
        data: encode_ameba_dlmm_payload(tag, params)?,
    })
}

fn build_ameba_dlmm_raw(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    tag: crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag,
    payload: &[u8],
) -> Result<Instruction, CurrentProtocolError> {
    require_current_program_id(&program_id)?;
    if payload.len().saturating_add(1) > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let mut data = Vec::with_capacity(payload.len() + 1);
    data.push(tag as u8);
    data.extend_from_slice(payload);
    decode_current_ameba_dlmm_instruction(&data)?;
    Ok(Instruction {
        program_id,
        accounts,
        data,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentAmoebaDlmmRentConfig {
    pub base_rent: u16,
    pub compression_cost: u16,
    pub lamports_per_byte_per_epoch: u8,
    pub max_funded_epochs: u8,
    pub max_top_up: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentAmoebaDlmmInitializeLightConfigParams {
    pub rent_sponsor: Pubkey,
    pub compression_authority: Pubkey,
    pub rent_config: CurrentAmoebaDlmmRentConfig,
    pub write_top_up: u32,
    pub address_tree: Pubkey,
    pub config_bump: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentAmoebaDlmmUpdateLightConfigParams {
    pub new_update_authority: Option<Pubkey>,
    pub new_rent_sponsor: Option<Pubkey>,
    pub new_compression_authority: Option<Pubkey>,
    pub new_rent_config: Option<CurrentAmoebaDlmmRentConfig>,
    pub new_write_top_up: Option<u32>,
    pub new_address_tree: Option<Pubkey>,
}

#[derive(Clone, Debug)]
pub struct CurrentAmoebaDlmmCompressLightStateParams {
    pub proof: light_sdk::proof::borsh_compat::ValidityProof,
    /// Exact ten-byte `PackedStateTreeInfo + output_state_tree_index` records.
    pub compressed_accounts: Vec<[u8; 10]>,
    pub system_accounts_offset: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum CurrentAmoebaDlmmLightStateKind {
    Pool = 0,
    BinPage = 1,
    SharePage = 2,
    Position = 3,
}

impl CurrentAmoebaDlmmLightStateKind {
    fn from_byte(value: u8) -> Result<Self, CurrentProtocolError> {
        match value {
            0 => Ok(Self::Pool),
            1 => Ok(Self::BinPage),
            2 => Ok(Self::SharePage),
            3 => Ok(Self::Position),
            _ => Err(CurrentProtocolError::InvalidInstruction),
        }
    }

    fn body_len(self) -> usize {
        match self {
            Self::Pool => AmoebaDlmmPoolV1::BODY_LEN,
            Self::BinPage => AmoebaDlmmBinPageV1::BODY_LEN,
            Self::SharePage => AmoebaDlmmSharePageV1::BODY_LEN,
            Self::Position => AmoebaDlmmPositionV1::BODY_LEN,
        }
    }

    fn identity_len(self) -> usize {
        match self {
            Self::Pool => 0,
            Self::BinPage | Self::SharePage => 2,
            Self::Position => 8,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentAmoebaDlmmPackedCompressedAccountData {
    /// Exact nine-byte current `PackedStateTreeInfo` encoding.
    pub packed_state_tree_info: [u8; 9],
    pub kind: CurrentAmoebaDlmmLightStateKind,
    pub body: Vec<u8>,
    /// Empty for pools, page index bytes for pages, and position nonce bytes for positions.
    pub identity: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct CurrentAmoebaDlmmDecompressLightStateParams {
    pub system_accounts_offset: u8,
    pub token_accounts_offset: u8,
    pub output_queue_index: u8,
    pub proof: light_sdk::proof::borsh_compat::ValidityProof,
    pub accounts: Vec<CurrentAmoebaDlmmPackedCompressedAccountData>,
}

fn take_current_bytes<'a>(
    input: &mut &'a [u8],
    length: usize,
) -> Result<&'a [u8], CurrentProtocolError> {
    if input.len() < length {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let (value, rest) = input.split_at(length);
    *input = rest;
    Ok(value)
}

fn take_current_array<const LENGTH: usize>(
    input: &mut &[u8],
) -> Result<[u8; LENGTH], CurrentProtocolError> {
    take_current_bytes(input, LENGTH)?
        .try_into()
        .map_err(|_| CurrentProtocolError::InvalidInstruction)
}

fn take_current_u8(input: &mut &[u8]) -> Result<u8, CurrentProtocolError> {
    Ok(take_current_array::<1>(input)?[0])
}

fn take_current_u16(input: &mut &[u8]) -> Result<u16, CurrentProtocolError> {
    Ok(u16::from_le_bytes(take_current_array(input)?))
}

fn take_current_u32(input: &mut &[u8]) -> Result<u32, CurrentProtocolError> {
    Ok(u32::from_le_bytes(take_current_array(input)?))
}

fn take_current_pubkey(input: &mut &[u8]) -> Result<Pubkey, CurrentProtocolError> {
    Ok(Pubkey::new_from_array(take_current_array(input)?))
}

fn decode_current_dlmm_rent_config(
    input: &mut &[u8],
) -> Result<CurrentAmoebaDlmmRentConfig, CurrentProtocolError> {
    Ok(CurrentAmoebaDlmmRentConfig {
        base_rent: take_current_u16(input)?,
        compression_cost: take_current_u16(input)?,
        lamports_per_byte_per_epoch: take_current_u8(input)?,
        max_funded_epochs: take_current_u8(input)?,
        max_top_up: take_current_u16(input)?,
    })
}

fn decode_current_optional_pubkey(
    input: &mut &[u8],
) -> Result<Option<Pubkey>, CurrentProtocolError> {
    match take_current_u8(input)? {
        0 => Ok(None),
        1 => Ok(Some(take_current_pubkey(input)?)),
        _ => Err(CurrentProtocolError::InvalidInstruction),
    }
}

fn decode_current_optional_rent_config(
    input: &mut &[u8],
) -> Result<Option<CurrentAmoebaDlmmRentConfig>, CurrentProtocolError> {
    match take_current_u8(input)? {
        0 => Ok(None),
        1 => Ok(Some(decode_current_dlmm_rent_config(input)?)),
        _ => Err(CurrentProtocolError::InvalidInstruction),
    }
}

fn decode_current_optional_u32(input: &mut &[u8]) -> Result<Option<u32>, CurrentProtocolError> {
    match take_current_u8(input)? {
        0 => Ok(None),
        1 => Ok(Some(take_current_u32(input)?)),
        _ => Err(CurrentProtocolError::InvalidInstruction),
    }
}

fn decode_current_optional_address_tree(
    input: &mut &[u8],
) -> Result<Option<Pubkey>, CurrentProtocolError> {
    match take_current_u8(input)? {
        0 => Ok(None),
        1 if take_current_u32(input)? == 1 => Ok(Some(take_current_pubkey(input)?)),
        _ => Err(CurrentProtocolError::InvalidInstruction),
    }
}

pub fn decode_current_ameba_dlmm_initialize_light_config_params(
    payload: &[u8],
) -> Result<CurrentAmoebaDlmmInitializeLightConfigParams, CurrentProtocolError> {
    if payload.len() != 113 {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let mut input = payload;
    let value = CurrentAmoebaDlmmInitializeLightConfigParams {
        rent_sponsor: take_current_pubkey(&mut input)?,
        compression_authority: take_current_pubkey(&mut input)?,
        rent_config: decode_current_dlmm_rent_config(&mut input)?,
        write_top_up: take_current_u32(&mut input)?,
        address_tree: {
            if take_current_u32(&mut input)? != 1 {
                return Err(CurrentProtocolError::InvalidInstruction);
            }
            take_current_pubkey(&mut input)?
        },
        config_bump: take_current_u8(&mut input)?,
    };
    if !input.is_empty() || value.config_bump != 0 {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(value)
}

pub fn decode_current_ameba_dlmm_update_light_config_params(
    payload: &[u8],
) -> Result<CurrentAmoebaDlmmUpdateLightConfigParams, CurrentProtocolError> {
    let mut input = payload;
    let value = CurrentAmoebaDlmmUpdateLightConfigParams {
        new_update_authority: decode_current_optional_pubkey(&mut input)?,
        new_rent_sponsor: decode_current_optional_pubkey(&mut input)?,
        new_compression_authority: decode_current_optional_pubkey(&mut input)?,
        new_rent_config: decode_current_optional_rent_config(&mut input)?,
        new_write_top_up: decode_current_optional_u32(&mut input)?,
        new_address_tree: decode_current_optional_address_tree(&mut input)?,
    };
    if !input.is_empty() {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(value)
}

fn decode_current_validity_proof(
    input: &mut &[u8],
) -> Result<light_sdk::proof::borsh_compat::ValidityProof, CurrentProtocolError> {
    <light_sdk::proof::borsh_compat::ValidityProof as BorshDeserialize>::deserialize(input)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)
}

pub fn decode_current_ameba_dlmm_compress_light_state_params(
    payload: &[u8],
) -> Result<CurrentAmoebaDlmmCompressLightStateParams, CurrentProtocolError> {
    let mut input = payload;
    let proof = decode_current_validity_proof(&mut input)?;
    let count = usize::try_from(take_current_u32(&mut input)?)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    if count.checked_mul(10).and_then(|size| size.checked_add(1)) != Some(input.len()) {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let mut compressed_accounts = Vec::with_capacity(count);
    for _ in 0..count {
        compressed_accounts.push(take_current_array(&mut input)?);
    }
    let system_accounts_offset = take_current_u8(&mut input)?;
    if !input.is_empty() {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(CurrentAmoebaDlmmCompressLightStateParams {
        proof,
        compressed_accounts,
        system_accounts_offset,
    })
}

pub fn decode_current_ameba_dlmm_decompress_light_state_params(
    payload: &[u8],
) -> Result<CurrentAmoebaDlmmDecompressLightStateParams, CurrentProtocolError> {
    let mut input = payload;
    let system_accounts_offset = take_current_u8(&mut input)?;
    let token_accounts_offset = take_current_u8(&mut input)?;
    let output_queue_index = take_current_u8(&mut input)?;
    let proof = decode_current_validity_proof(&mut input)?;
    let count = usize::try_from(take_current_u32(&mut input)?)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    if count > input.len() / 10 {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let mut accounts = Vec::with_capacity(count);
    for _ in 0..count {
        let packed_state_tree_info = take_current_array(&mut input)?;
        let kind = CurrentAmoebaDlmmLightStateKind::from_byte(take_current_u8(&mut input)?)?;
        let body = take_current_bytes(&mut input, kind.body_len())?.to_vec();
        if body[0] > 1
            || (kind == CurrentAmoebaDlmmLightStateKind::Pool && body[327] > 4)
            || body[body.len() - 10] > 2
        {
            return Err(CurrentProtocolError::InvalidInstruction);
        }
        let identity = take_current_bytes(&mut input, kind.identity_len())?.to_vec();
        let expected_identity = match kind {
            CurrentAmoebaDlmmLightStateKind::Pool => &body[0..0],
            CurrentAmoebaDlmmLightStateKind::BinPage
            | CurrentAmoebaDlmmLightStateKind::SharePage => &body[38..40],
            CurrentAmoebaDlmmLightStateKind::Position => &body[70..78],
        };
        if identity != expected_identity {
            return Err(CurrentProtocolError::InvalidInstruction);
        }
        accounts.push(CurrentAmoebaDlmmPackedCompressedAccountData {
            packed_state_tree_info,
            kind,
            body,
            identity,
        });
    }
    if !input.is_empty() {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(CurrentAmoebaDlmmDecompressLightStateParams {
        system_accounts_offset,
        token_accounts_offset,
        output_queue_index,
        proof,
        accounts,
    })
}

#[derive(Clone, Debug)]
pub enum CurrentAmoebaDlmmInstruction {
    InitializeCollectivePool(crate::ameba_dlmm_instruction::InitializeAmoebaDlmmPoolV1Params),
    InitializeBinPage(crate::ameba_dlmm_instruction::InitializeAmoebaDlmmBinPageV1Params),
    InitializePosition(crate::ameba_dlmm_instruction::InitializeAmoebaDlmmPositionV1Params),
    AddLiquidity(crate::ameba_dlmm_instruction::AddAmoebaDlmmLiquidityV1Params),
    RemoveLiquidity(crate::ameba_dlmm_instruction::RemoveAmoebaDlmmLiquidityV1Params),
    SwapCollectiveExactIn(crate::ameba_dlmm_instruction::SwapAmoebaDlmmExactInV1Params),
    SetCollectivePoolStatus(crate::ameba_dlmm_instruction::SetAmoebaDlmmPoolStatusV1Params),
    CollectProtocolFees(crate::ameba_dlmm_instruction::CollectAmoebaDlmmProtocolFeesV1Params),
    SettleCollectivePool,
    ClosePool,
    InitializeLightConfig(CurrentAmoebaDlmmInitializeLightConfigParams),
    UpdateLightConfig(CurrentAmoebaDlmmUpdateLightConfigParams),
    CompressLightState(CurrentAmoebaDlmmCompressLightStateParams),
    DecompressLightState(CurrentAmoebaDlmmDecompressLightStateParams),
}

fn decode_ameba_dlmm_params<T: crate::ameba_dlmm_instruction::AmoebaDlmmDecode>(
    payload: &[u8],
) -> Result<T, CurrentProtocolError> {
    T::decode_exact(payload).map_err(|_| CurrentProtocolError::InvalidInstruction)
}

pub fn decode_current_ameba_dlmm_instruction(
    data: &[u8],
) -> Result<CurrentAmoebaDlmmInstruction, CurrentProtocolError> {
    use crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag as Tag;
    if data.is_empty() || data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let tag = Tag::from_byte(data[0]).ok_or(CurrentProtocolError::InvalidInstruction)?;
    let payload = &data[1..];
    Ok(match tag {
        Tag::InitializeCollectiveDlmmPoolV1 => {
            CurrentAmoebaDlmmInstruction::InitializeCollectivePool(decode_ameba_dlmm_params(
                payload,
            )?)
        }
        Tag::InitializeBinPageV1 => {
            CurrentAmoebaDlmmInstruction::InitializeBinPage(decode_ameba_dlmm_params(payload)?)
        }
        Tag::InitializePositionV1 => {
            CurrentAmoebaDlmmInstruction::InitializePosition(decode_ameba_dlmm_params(payload)?)
        }
        Tag::AddLiquidityV1 => {
            CurrentAmoebaDlmmInstruction::AddLiquidity(decode_ameba_dlmm_params(payload)?)
        }
        Tag::RemoveLiquidityV1 => {
            CurrentAmoebaDlmmInstruction::RemoveLiquidity(decode_ameba_dlmm_params(payload)?)
        }
        Tag::SwapCollectiveDlmmExactInV1 => {
            CurrentAmoebaDlmmInstruction::SwapCollectiveExactIn(decode_ameba_dlmm_params(payload)?)
        }
        Tag::SetCollectiveDlmmPoolStatusV1 => {
            CurrentAmoebaDlmmInstruction::SetCollectivePoolStatus(decode_ameba_dlmm_params(
                payload,
            )?)
        }
        Tag::CollectProtocolFeesV1 => {
            CurrentAmoebaDlmmInstruction::CollectProtocolFees(decode_ameba_dlmm_params(payload)?)
        }
        Tag::SettleCollectiveDlmmPoolV1 if payload.is_empty() => {
            CurrentAmoebaDlmmInstruction::SettleCollectivePool
        }
        Tag::ClosePoolV1 if payload.is_empty() => CurrentAmoebaDlmmInstruction::ClosePool,
        Tag::InitializeLightConfig => CurrentAmoebaDlmmInstruction::InitializeLightConfig(
            decode_current_ameba_dlmm_initialize_light_config_params(payload)?,
        ),
        Tag::UpdateLightConfig => CurrentAmoebaDlmmInstruction::UpdateLightConfig(
            decode_current_ameba_dlmm_update_light_config_params(payload)?,
        ),
        Tag::CompressLightState => CurrentAmoebaDlmmInstruction::CompressLightState(
            decode_current_ameba_dlmm_compress_light_state_params(payload)?,
        ),
        Tag::DecompressLightState => CurrentAmoebaDlmmInstruction::DecompressLightState(
            decode_current_ameba_dlmm_decompress_light_state_params(payload)?,
        ),
        _ => return Err(CurrentProtocolError::InvalidInstruction),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializeCollectiveAmoebaDlmmPoolAccounts {
    pub admin: Pubkey,
    pub vault_config: Pubkey,
    pub market: Pubkey,
    pub oracle_month: Pubkey,
    pub writer_sleeve: Pubkey,
    pub writer_settlement_group: Pubkey,
    pub writer_series_book: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub option_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub light_token_program: Pubkey,
    pub light_cpi_authority: Pubkey,
    pub state_compression_config: Pubkey,
    pub state_rent_sponsor: Pubkey,
    pub token_compression_config: Pubkey,
    pub token_rent_sponsor: Pubkey,
    pub light_lifecycle_accounts: Vec<AccountMeta>,
}

pub fn build_initialize_collective_ameba_dlmm_pool_instruction(
    program_id: Pubkey,
    accounts: InitializeCollectiveAmoebaDlmmPoolAccounts,
    params: crate::ameba_dlmm_instruction::InitializeAmoebaDlmmPoolV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    if accounts.pool != derive_ameba_dlmm_pool_pda(&program_id, &accounts.market).0
        || accounts.authority
            != crate::ameba_dlmm_state::derive_ameba_dlmm_authority_pda(&program_id, &accounts.pool)
                .0
        || accounts.light_token_program != CURRENT_LIGHT_TOKEN_PROGRAM_ID
        || accounts.light_cpi_authority != CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let mut metas = vec![
        writable(accounts.admin, true),
        readonly(accounts.vault_config, false),
        readonly(accounts.market, false),
        readonly(accounts.oracle_month, false),
        readonly(accounts.writer_sleeve, false),
        readonly(accounts.writer_settlement_group, false),
        readonly(accounts.writer_series_book, false),
        writable(accounts.pool, false),
        readonly(accounts.authority, false),
        readonly(accounts.option_mint, false),
        readonly(accounts.quote_mint, false),
        writable(accounts.option_vault, false),
        writable(accounts.quote_vault, false),
        readonly(accounts.light_token_program, false),
        readonly(accounts.light_cpi_authority, false),
        readonly(accounts.state_compression_config, false),
        writable(accounts.state_rent_sponsor, false),
        readonly(accounts.token_compression_config, false),
        writable(accounts.token_rent_sponsor, false),
        readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
    ];
    metas.extend(accounts.light_lifecycle_accounts);
    build_ameba_dlmm_with_params(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeCollectiveDlmmPoolV1,
        &params,
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializeAmoebaDlmmBinPageAccounts {
    pub manager: Pubkey,
    pub pool: Pubkey,
    pub reserve_page: Pubkey,
    pub share_page: Pubkey,
    pub state_compression_config: Pubkey,
    pub state_rent_sponsor: Pubkey,
    pub light_lifecycle_accounts: Vec<AccountMeta>,
}

pub fn build_initialize_ameba_dlmm_bin_page_instruction(
    program_id: Pubkey,
    accounts: InitializeAmoebaDlmmBinPageAccounts,
    params: crate::ameba_dlmm_instruction::InitializeAmoebaDlmmBinPageV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    if accounts.reserve_page
        != derive_ameba_dlmm_bin_page_pda(&program_id, &accounts.pool, params.page_index).0
        || accounts.share_page
            != derive_ameba_dlmm_share_page_pda(&program_id, &accounts.pool, params.page_index).0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let mut metas = vec![
        writable(accounts.manager, true),
        writable(accounts.pool, false),
        writable(accounts.reserve_page, false),
        writable(accounts.share_page, false),
        readonly(accounts.state_compression_config, false),
        writable(accounts.state_rent_sponsor, false),
        readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
    ];
    metas.extend(accounts.light_lifecycle_accounts);
    build_ameba_dlmm_with_params(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeBinPageV1,
        &params,
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializeAmoebaDlmmPositionAccounts {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub position: Pubkey,
    pub state_compression_config: Pubkey,
    pub state_rent_sponsor: Pubkey,
    pub light_lifecycle_accounts: Vec<AccountMeta>,
}

pub fn build_initialize_ameba_dlmm_position_instruction(
    program_id: Pubkey,
    accounts: InitializeAmoebaDlmmPositionAccounts,
    params: crate::ameba_dlmm_instruction::InitializeAmoebaDlmmPositionV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    if accounts.position
        != derive_ameba_dlmm_position_pda(
            &program_id,
            &accounts.pool,
            &accounts.owner,
            params.position_nonce,
        )
        .0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let mut metas = vec![
        writable(accounts.owner, true),
        writable(accounts.pool, false),
        writable(accounts.position, false),
        readonly(accounts.state_compression_config, false),
        writable(accounts.state_rent_sponsor, false),
        readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
    ];
    metas.extend(accounts.light_lifecycle_accounts);
    build_ameba_dlmm_with_params(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializePositionV1,
        &params,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AmoebaDlmmPagePairAccounts {
    pub page_index: u16,
    pub reserve_page: Pubkey,
    pub share_page: Pubkey,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmoebaDlmmLiquidityAccounts {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub position: Pubkey,
    pub authority: Pubkey,
    pub option_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub owner_option_account: Pubkey,
    pub owner_quote_account: Pubkey,
    pub light_token_program: Pubkey,
    pub light_cpi_authority: Pubkey,
    pub option_interface: Pubkey,
    pub quote_interface: Pubkey,
    pub spl_token_program: Pubkey,
    pub page_pairs: Vec<AmoebaDlmmPagePairAccounts>,
}

fn ameba_dlmm_liquidity_metas(
    program_id: &Pubkey,
    accounts: &AmoebaDlmmLiquidityAccounts,
) -> Result<Vec<AccountMeta>, CurrentProtocolError> {
    if accounts.light_token_program != CURRENT_LIGHT_TOKEN_PROGRAM_ID
        || accounts.light_cpi_authority != CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
        || accounts.spl_token_program != CURRENT_SPL_TOKEN_PROGRAM_ID
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    let mut previous_page = None;
    for pair in &accounts.page_pairs {
        if previous_page.is_some_and(|previous| previous >= pair.page_index)
            || pair.reserve_page
                != derive_ameba_dlmm_bin_page_pda(program_id, &accounts.pool, pair.page_index).0
            || pair.share_page
                != derive_ameba_dlmm_share_page_pda(program_id, &accounts.pool, pair.page_index).0
        {
            return Err(CurrentProtocolError::InvalidIdentity);
        }
        previous_page = Some(pair.page_index);
    }
    let mut metas = vec![
        writable(accounts.owner, true),
        writable(accounts.pool, false),
        writable(accounts.position, false),
        readonly(accounts.authority, false),
        readonly(accounts.option_mint, false),
        readonly(accounts.quote_mint, false),
        writable(accounts.option_vault, false),
        writable(accounts.quote_vault, false),
        writable(accounts.owner_option_account, false),
        writable(accounts.owner_quote_account, false),
        readonly(accounts.light_token_program, false),
        readonly(accounts.light_cpi_authority, false),
        writable(accounts.option_interface, false),
        writable(accounts.quote_interface, false),
        readonly(accounts.spl_token_program, false),
        readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
    ];
    for pair in &accounts.page_pairs {
        metas.push(writable(pair.reserve_page, false));
        metas.push(writable(pair.share_page, false));
    }
    Ok(metas)
}

pub fn build_add_ameba_dlmm_liquidity_instruction(
    program_id: Pubkey,
    accounts: AmoebaDlmmLiquidityAccounts,
    params: crate::ameba_dlmm_instruction::AddAmoebaDlmmLiquidityV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    let metas = ameba_dlmm_liquidity_metas(&program_id, &accounts)?;
    build_ameba_dlmm_with_params(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::AddLiquidityV1,
        &params,
    )
}

pub fn build_remove_ameba_dlmm_liquidity_instruction(
    program_id: Pubkey,
    accounts: AmoebaDlmmLiquidityAccounts,
    params: crate::ameba_dlmm_instruction::RemoveAmoebaDlmmLiquidityV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    let metas = ameba_dlmm_liquidity_metas(&program_id, &accounts)?;
    build_ameba_dlmm_with_params(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::RemoveLiquidityV1,
        &params,
    )
}

#[derive(Clone, Copy, Debug)]
pub struct CurrentAmoebaDlmmSwapContext<'a> {
    pub vault_config: &'a VaultConfig,
    pub market: &'a Market,
    pub oracle_month: &'a OracleMonthState,
    pub pool: &'a AmoebaDlmmPoolV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CollectiveAmoebaDlmmReservePageAccount {
    pub page_index: u16,
    pub address: Pubkey,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollectiveAmoebaDlmmSwapAccounts {
    pub trader: Pubkey,
    pub vault_config: Pubkey,
    pub market: Pubkey,
    pub oracle_month: Pubkey,
    pub writer_sleeve: Pubkey,
    pub writer_settlement_group: Pubkey,
    pub writer_series_book: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub option_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub trader_option_account: Pubkey,
    pub trader_quote_account: Pubkey,
    pub light_token_program: Pubkey,
    pub light_cpi_authority: Pubkey,
    pub option_interface: Pubkey,
    pub quote_interface: Pubkey,
    pub spl_token_program: Pubkey,
    pub system_program: Pubkey,
    pub light_compressible_config: Pubkey,
    pub light_rent_sponsor: Pubkey,
    pub reserve_pages: Vec<CollectiveAmoebaDlmmReservePageAccount>,
}

fn current_swap_route_page_indices(
    pool: &AmoebaDlmmPoolV1,
    direction: crate::ameba_dlmm_instruction::AmoebaDlmmSwapDirection,
) -> Vec<u16> {
    let bitmap = match direction {
        crate::ameba_dlmm_instruction::AmoebaDlmmSwapDirection::QuoteForOption => {
            pool.ask_page_bitmap
        }
        crate::ameba_dlmm_instruction::AmoebaDlmmSwapDirection::OptionForQuote => {
            pool.bid_page_bitmap
        }
    };
    let mut pages: Vec<u16> = (0..crate::constants::MAX_AMOEBA_DLMM_PAGE_COUNT)
        .filter(|page_index| bitmap & (1_u64 << page_index) != 0)
        .collect();
    if matches!(
        direction,
        crate::ameba_dlmm_instruction::AmoebaDlmmSwapDirection::OptionForQuote
    ) {
        pages.reverse();
    }
    pages
}

fn validate_current_collective_ameba_dlmm_swap_accounts(
    program_id: &Pubkey,
    accounts: &CollectiveAmoebaDlmmSwapAccounts,
    context: CurrentAmoebaDlmmSwapContext<'_>,
    params: &crate::ameba_dlmm_instruction::SwapAmoebaDlmmExactInV1Params,
) -> Result<(), CurrentProtocolError> {
    require_current_program_id(program_id)?;
    let (expected_vault_config, vault_bump) = derive_vault_config_pda(program_id);
    let (expected_market, market_bump) = derive_market_pda(program_id, &context.market.market_id);
    let (expected_oracle_month, oracle_bump) = derive_oracle_month_pda(
        program_id,
        &expected_market,
        context.market.instrument.expiry_ts,
    );
    let (expected_pool, pool_bump) = derive_ameba_dlmm_pool_pda(program_id, &expected_market);
    let expected_authority =
        crate::ameba_dlmm_state::derive_ameba_dlmm_authority_pda(program_id, &expected_pool).0;
    let expected_option_mint = context
        .market
        .long_contract_mint
        .ok_or(CurrentProtocolError::InvalidIdentity)?;
    let expected_quote_mint = context.market.collateral_mint;
    let expected_option_vault =
        derive_ameba_dlmm_vault_pda(program_id, &expected_pool, &expected_option_mint).0;
    let expected_quote_vault =
        derive_ameba_dlmm_vault_pda(program_id, &expected_pool, &expected_quote_mint).0;

    if !context.vault_config.is_initialized
        || !context.vault_config.has_current_layout()
        || context.vault_config.bump != vault_bump
        || context.vault_config.paused
        || context.vault_config.usdc_mint != expected_quote_mint
        || !context.market.is_initialized
        || context.market.bump != market_bump
        || context.market.paused
        || !context.market.mint_accounting.has_canonical_layout()
        || !context.oracle_month.is_initialized
        || !context.oracle_month.has_current_layout()
        || !context.oracle_month.has_rulebook_schedule()
        || context.oracle_month.bump != oracle_bump
        || context.oracle_month.market != expected_market
        || context.oracle_month.phase != crate::state::OraclePhase::Game
        || context.oracle_month.settlement_record.is_some()
        || context.oracle_month.settlement_status == crate::state::OracleSettlementStatus::Final
        || !context.pool.has_current_layout()
        || context.pool.bump != pool_bump
        || context.pool.status != crate::ameba_dlmm_state::AmoebaDlmmPoolStatus::Active
        || context.pool.market != expected_market
        || context.pool.oracle_month != expected_oracle_month
        || context.pool.option_mint != expected_option_mint
        || context.pool.quote_mint != expected_quote_mint
        || context.pool.option_vault != expected_option_vault
        || context.pool.quote_vault != expected_quote_vault
        || context.pool.expiry_ts != context.market.instrument.expiry_ts
        || context.pool.tick_size_quote_atomic != context.market.params.tick_size
        || context.pool.maximum_price_quote_atomic
            != context.market.instrument.max_payout_per_contract
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }

    if accounts.vault_config != expected_vault_config
        || accounts.market != expected_market
        || accounts.oracle_month != expected_oracle_month
        || accounts.writer_sleeve
            != crate::writer_sleeve::derive_writer_sleeve_pda(
                program_id,
                &accounts.writer_settlement_group,
            )
            .0
        || accounts.writer_series_book
            != crate::writer_sleeve::derive_writer_series_book_pda(
                program_id,
                &accounts.writer_sleeve,
            )
            .0
        || accounts.pool != expected_pool
        || accounts.authority != expected_authority
        || accounts.option_mint != expected_option_mint
        || accounts.quote_mint != expected_quote_mint
        || accounts.option_vault != expected_option_vault
        || accounts.quote_vault != expected_quote_vault
        || accounts.light_token_program != CURRENT_LIGHT_TOKEN_PROGRAM_ID
        || accounts.light_cpi_authority != CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
        || accounts.option_interface != derive_light_spl_interface_pda(&expected_option_mint).0
        || accounts.quote_interface != derive_light_spl_interface_pda(&expected_quote_mint).0
        || accounts.spl_token_program != CURRENT_SPL_TOKEN_PROGRAM_ID
        || accounts.system_program != CURRENT_SYSTEM_PROGRAM_ID
        || accounts.light_compressible_config != crate::constants::LIGHT_TOKEN_COMPRESSIBLE_CONFIG
        || accounts.light_rent_sponsor != crate::constants::LIGHT_TOKEN_RENT_SPONSOR
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    if params.amount_in == 0
        || params.minimum_amount_out == 0
        || params.deadline_ts == 0
        || params.limit_bin_id > context.pool.maximum_bin_id
        || !(1..=usize::from(crate::constants::MAX_AMOEBA_DLMM_PAGE_HOPS_PER_SWAP))
            .contains(&accounts.reserve_pages.len())
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }

    let canonical_route = current_swap_route_page_indices(context.pool, params.direction);
    if accounts.reserve_pages.len() > canonical_route.len() {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    for (route_offset, page) in accounts.reserve_pages.iter().enumerate() {
        if page.page_index != canonical_route[route_offset]
            || page.address
                != derive_ameba_dlmm_bin_page_pda(program_id, &expected_pool, page.page_index).0
        {
            return Err(CurrentProtocolError::InvalidIdentity);
        }
    }
    Ok(())
}

pub fn build_collective_ameba_dlmm_swap_exact_in_instruction(
    program_id: Pubkey,
    accounts: CollectiveAmoebaDlmmSwapAccounts,
    context: CurrentAmoebaDlmmSwapContext<'_>,
    params: crate::ameba_dlmm_instruction::SwapAmoebaDlmmExactInV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    validate_current_collective_ameba_dlmm_swap_accounts(&program_id, &accounts, context, &params)?;
    let mut metas = vec![
        writable(accounts.trader, true),
        readonly(accounts.vault_config, false),
        readonly(accounts.market, false),
        readonly(accounts.oracle_month, false),
        readonly(accounts.writer_sleeve, false),
        readonly(accounts.writer_settlement_group, false),
        readonly(accounts.writer_series_book, false),
        writable(accounts.pool, false),
        readonly(accounts.authority, false),
        readonly(accounts.option_mint, false),
        readonly(accounts.quote_mint, false),
        writable(accounts.option_vault, false),
        writable(accounts.quote_vault, false),
        writable(accounts.trader_option_account, false),
        writable(accounts.trader_quote_account, false),
        readonly(accounts.light_token_program, false),
        readonly(accounts.light_cpi_authority, false),
        writable(accounts.option_interface, false),
        writable(accounts.quote_interface, false),
        readonly(accounts.spl_token_program, false),
        readonly(accounts.system_program, false),
        readonly(accounts.light_compressible_config, false),
        writable(accounts.light_rent_sponsor, false),
    ];
    metas.extend(
        accounts
            .reserve_pages
            .into_iter()
            .map(|page| writable(page.address, false)),
    );
    build_ameba_dlmm_with_params(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::SwapCollectiveDlmmExactInV1,
        &params,
    )
}

pub fn validate_current_collective_ameba_dlmm_swap_exact_in_instruction(
    instruction: &Instruction,
    accounts: &CollectiveAmoebaDlmmSwapAccounts,
    context: CurrentAmoebaDlmmSwapContext<'_>,
    params: &crate::ameba_dlmm_instruction::SwapAmoebaDlmmExactInV1Params,
) -> Result<(), CurrentProtocolError> {
    let expected = build_collective_ameba_dlmm_swap_exact_in_instruction(
        instruction.program_id,
        accounts.clone(),
        context,
        *params,
    )?;
    if *instruction != expected {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SetCollectiveAmoebaDlmmPoolStatusAccounts {
    pub admin: Pubkey,
    pub vault_config: Pubkey,
    pub market: Pubkey,
    pub oracle_month: Pubkey,
    pub coverage_manifest: Pubkey,
    pub active_weight_manifest: Pubkey,
    pub writer_sleeve: Pubkey,
    pub writer_settlement_group: Pubkey,
    pub writer_series_book: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
}

pub fn build_set_collective_ameba_dlmm_pool_status_instruction(
    program_id: Pubkey,
    accounts: SetCollectiveAmoebaDlmmPoolStatusAccounts,
    params: crate::ameba_dlmm_instruction::SetAmoebaDlmmPoolStatusV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_with_params(
        program_id,
        vec![
            readonly(accounts.admin, true),
            readonly(accounts.vault_config, false),
            readonly(accounts.market, false),
            readonly(accounts.oracle_month, false),
            readonly(accounts.coverage_manifest, false),
            readonly(accounts.active_weight_manifest, false),
            readonly(accounts.writer_sleeve, false),
            readonly(accounts.writer_settlement_group, false),
            readonly(accounts.writer_series_book, false),
            writable(accounts.pool, false),
            readonly(accounts.authority, false),
            writable(accounts.option_vault, false),
            writable(accounts.quote_vault, false),
        ],
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::SetCollectiveDlmmPoolStatusV1,
        &params,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CollectAmoebaDlmmProtocolFeesAccounts {
    pub admin: Pubkey,
    pub vault_config: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub option_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub option_destination: Pubkey,
    pub quote_destination: Pubkey,
    pub option_interface: Pubkey,
    pub quote_interface: Pubkey,
}

pub fn build_collect_ameba_dlmm_protocol_fees_instruction(
    program_id: Pubkey,
    accounts: CollectAmoebaDlmmProtocolFeesAccounts,
    params: crate::ameba_dlmm_instruction::CollectAmoebaDlmmProtocolFeesV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_with_params(
        program_id,
        vec![
            writable(accounts.admin, true),
            readonly(accounts.vault_config, false),
            writable(accounts.pool, false),
            readonly(accounts.authority, false),
            readonly(accounts.option_mint, false),
            readonly(accounts.quote_mint, false),
            writable(accounts.option_vault, false),
            writable(accounts.quote_vault, false),
            writable(accounts.option_destination, false),
            writable(accounts.quote_destination, false),
            readonly(CURRENT_LIGHT_TOKEN_PROGRAM_ID, false),
            readonly(CURRENT_LIGHT_TOKEN_CPI_AUTHORITY, false),
            writable(accounts.option_interface, false),
            writable(accounts.quote_interface, false),
            readonly(CURRENT_SPL_TOKEN_PROGRAM_ID, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::CollectProtocolFeesV1,
        &params,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SettleCollectiveAmoebaDlmmPoolAccounts {
    pub cranker: Pubkey,
    pub vault_config: Pubkey,
    pub market: Pubkey,
    pub anchor_oracle_month: Pubkey,
    pub writer_settlement_group: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub quote_mint: Pubkey,
    pub quote_vault: Pubkey,
    pub reward_vault: Pubkey,
    pub reward_token_account: Pubkey,
    pub reward_schedule: Pubkey,
    pub quote_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
}

pub fn build_settle_collective_ameba_dlmm_pool_instruction(
    program_id: Pubkey,
    accounts: SettleCollectiveAmoebaDlmmPoolAccounts,
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_raw(
        program_id,
        vec![
            readonly(accounts.cranker, true),
            readonly(accounts.vault_config, false),
            readonly(accounts.market, false),
            readonly(accounts.anchor_oracle_month, false),
            readonly(accounts.writer_settlement_group, false),
            writable(accounts.pool, false),
            readonly(accounts.authority, false),
            readonly(accounts.quote_mint, false),
            writable(accounts.quote_vault, false),
            writable(accounts.reward_vault, false),
            writable(accounts.reward_token_account, false),
            writable(accounts.reward_schedule, false),
            writable(accounts.quote_spl_interface, false),
            readonly(accounts.light_token_program, false),
            readonly(accounts.compressed_token_authority, false),
            readonly(accounts.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::SettleCollectiveDlmmPoolV1,
        &[],
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CloseAmoebaDlmmPoolAccounts {
    pub admin: Pubkey,
    pub vault_config: Pubkey,
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub page_pair: Option<(Pubkey, Pubkey)>,
}

pub fn build_close_ameba_dlmm_pool_instruction(
    program_id: Pubkey,
    accounts: CloseAmoebaDlmmPoolAccounts,
) -> Result<Instruction, CurrentProtocolError> {
    let mut metas = vec![
        writable(accounts.admin, true),
        readonly(accounts.vault_config, false),
        writable(accounts.pool, false),
        readonly(accounts.authority, false),
        writable(accounts.option_vault, false),
        writable(accounts.quote_vault, false),
    ];
    if let Some((reserve_page, share_page)) = accounts.page_pair {
        metas.push(writable(reserve_page, false));
        metas.push(writable(share_page, false));
    }
    build_ameba_dlmm_raw(
        program_id,
        metas,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::ClosePoolV1,
        &[],
    )
}

pub fn build_initialize_ameba_dlmm_light_config_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    light_payload: &[u8],
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_raw(
        program_id,
        accounts,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeLightConfig,
        light_payload,
    )
}

pub fn build_update_ameba_dlmm_light_config_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    light_payload: &[u8],
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_raw(
        program_id,
        accounts,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::UpdateLightConfig,
        light_payload,
    )
}

pub fn build_compress_ameba_dlmm_light_state_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    light_payload: &[u8],
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_raw(
        program_id,
        accounts,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::CompressLightState,
        light_payload,
    )
}

pub fn build_decompress_ameba_dlmm_light_state_instruction(
    program_id: Pubkey,
    accounts: Vec<AccountMeta>,
    light_payload: &[u8],
) -> Result<Instruction, CurrentProtocolError> {
    build_ameba_dlmm_raw(
        program_id,
        accounts,
        crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::DecompressLightState,
        light_payload,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ameba_dlmm_instruction::{
            AmoebaDlmmInstructionTag, AmoebaDlmmSwapDirection, SwapAmoebaDlmmExactInV1Params,
        },
        instruction::{
            ProposeSettlementSignerRotationParams, VaultInstruction, VaultInstructionTag,
        },
        state::{
            InstrumentDefinition, MarketMintAccounting, MarketParameters, OptionKind,
            SettlementStyle,
        },
    };
    use light_sdk::proof::borsh_compat::ValidityProof;

    fn key(value: u8) -> Pubkey {
        Pubkey::new_from_array([value; 32])
    }

    fn current_market(long_contract_mint: Option<Pubkey>) -> (Pubkey, Market) {
        let program_id = crate::ID;
        let market_id = [7; 32];
        let (address, bump) = derive_market_pda(&program_id, &market_id);
        (
            address,
            Market {
                is_initialized: true,
                bump,
                created_by: key(20),
                market_id,
                collateral_mint: key(21),
                long_contract_mint,
                instrument: InstrumentDefinition {
                    underlying_id: [8; 32],
                    expiry_ts: 2_000_000_000,
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
                    maker_fee_bps: 0,
                    taker_fee_bps: 20,
                    cancel_fee_bps: 0,
                    min_cancel_slots: 0,
                    max_fills_per_instruction: 8,
                },
                total_position_collateral_locked: 0,
                paused: true,
                mint_accounting: MarketMintAccounting::canonical_empty(),
            },
        )
    }

    fn market_account_data(market: &Market) -> Vec<u8> {
        let mut data = market.try_to_vec().unwrap();
        data.resize(Market::LEN, 0);
        data
    }

    fn decompressed_pool(mut pool: AmoebaDlmmPoolV1) -> AmoebaDlmmPoolV1 {
        let mut body = pool.try_to_vec().unwrap();
        assert_eq!(body.len(), AmoebaDlmmPoolV1::BODY_LEN);
        body[AmoebaDlmmPoolV1::BODY_LEN - 10] = 1;
        pool = AmoebaDlmmPoolV1::try_from_slice(&body).unwrap();
        pool
    }

    fn pool_account_data(pool: &AmoebaDlmmPoolV1) -> Vec<u8> {
        let mut data = Vec::with_capacity(AmoebaDlmmPoolV1::LEN);
        data.extend_from_slice(&AMOEBA_DLMM_POOL_LIGHT_DISCRIMINATOR);
        pool.serialize(&mut data).unwrap();
        assert_eq!(data.len(), AmoebaDlmmPoolV1::LEN);
        data
    }

    fn current_swap_fixture() -> (
        VaultConfig,
        Market,
        OracleMonthState,
        AmoebaDlmmPoolV1,
        CollectiveAmoebaDlmmSwapAccounts,
        SwapAmoebaDlmmExactInV1Params,
    ) {
        let program_id = crate::ID;
        let (market_address, mut market) = current_market(None);
        market.paused = false;
        let contract_mint = derive_contract_mint_pda(&program_id, &market_address).0;
        market.long_contract_mint = Some(contract_mint);
        let (vault_config_address, vault_bump) = derive_vault_config_pda(&program_id);
        let vault_config = VaultConfig {
            is_initialized: true,
            bump: vault_bump,
            admin: key(24),
            oracle_authority: key(25),
            usdc_mint: market.collateral_mint,
            vault_token_account: key(26),
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        };
        let (oracle_month_address, oracle_bump) =
            derive_oracle_month_pda(&program_id, &market_address, market.instrument.expiry_ts);
        let mut oracle_month = OracleMonthState::default();
        oracle_month.is_initialized = true;
        oracle_month.bump = oracle_bump;
        oracle_month.account_discriminator = OracleMonthState::ACCOUNT_DISCRIMINATOR;
        oracle_month.account_version = OracleMonthState::ACCOUNT_VERSION;
        oracle_month.market = market_address;
        oracle_month.authority = key(27);
        oracle_month.scramble_start_ts = 1;
        oracle_month.listing_ts = 2;
        oracle_month.phase = crate::state::OraclePhase::Game;
        oracle_month.schedule_version = OracleMonthState::SKU_COVERAGE_SCHEDULE_VERSION;
        oracle_month.work_reward_currency_version = OracleMonthState::WORK_REWARD_CURRENCY_USDC_V1;
        oracle_month.candidate_count_tracking_version = 1;
        oracle_month.active_weight_initialization_version = 1;

        let (pool_address, pool_bump) = derive_ameba_dlmm_pool_pda(&program_id, &market_address);
        let option_vault =
            derive_ameba_dlmm_vault_pda(&program_id, &pool_address, &contract_mint).0;
        let quote_vault =
            derive_ameba_dlmm_vault_pda(&program_id, &pool_address, &market.collateral_mint).0;
        let pool = decompressed_pool(AmoebaDlmmPoolV1 {
            is_initialized: true,
            bump: pool_bump,
            market: market_address,
            oracle_month: oracle_month_address,
            liquidity_manager: key(28),
            option_mint: contract_mint,
            quote_mint: market.collateral_mint,
            option_vault,
            quote_vault,
            expiry_ts: market.instrument.expiry_ts,
            tick_size_quote_atomic: market.params.tick_size,
            maximum_price_quote_atomic: market.instrument.max_payout_per_contract,
            maximum_bin_id: 240,
            initialized_page_bitmap: 0b11,
            bid_page_bitmap: 0b11,
            ask_page_bitmap: 0b11,
            swap_fee_bps: market.params.taker_fee_bps,
            protocol_fee_share_bps: 1_000,
            maximum_bins_per_swap: market.params.max_fills_per_instruction,
            status: crate::ameba_dlmm_state::AmoebaDlmmPoolStatus::Active,
            ..AmoebaDlmmPoolV1::default()
        });
        let writer_settlement_group = key(40);
        let writer_sleeve =
            crate::writer_sleeve::derive_writer_sleeve_pda(&program_id, &writer_settlement_group).0;
        let writer_series_book =
            crate::writer_sleeve::derive_writer_series_book_pda(&program_id, &writer_sleeve).0;
        let accounts = CollectiveAmoebaDlmmSwapAccounts {
            trader: key(41),
            vault_config: vault_config_address,
            market: market_address,
            oracle_month: oracle_month_address,
            writer_sleeve,
            writer_settlement_group,
            writer_series_book,
            pool: pool_address,
            authority: crate::ameba_dlmm_state::derive_ameba_dlmm_authority_pda(
                &program_id,
                &pool_address,
            )
            .0,
            option_mint: contract_mint,
            quote_mint: market.collateral_mint,
            option_vault,
            quote_vault,
            trader_option_account: key(49),
            trader_quote_account: key(50),
            light_token_program: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
            light_cpi_authority: CURRENT_LIGHT_TOKEN_CPI_AUTHORITY,
            option_interface: derive_light_spl_interface_pda(&contract_mint).0,
            quote_interface: derive_light_spl_interface_pda(&market.collateral_mint).0,
            spl_token_program: CURRENT_SPL_TOKEN_PROGRAM_ID,
            system_program: CURRENT_SYSTEM_PROGRAM_ID,
            light_compressible_config: crate::constants::LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
            light_rent_sponsor: crate::constants::LIGHT_TOKEN_RENT_SPONSOR,
            reserve_pages: vec![
                CollectiveAmoebaDlmmReservePageAccount {
                    page_index: 0,
                    address: derive_ameba_dlmm_bin_page_pda(&program_id, &pool_address, 0).0,
                },
                CollectiveAmoebaDlmmReservePageAccount {
                    page_index: 1,
                    address: derive_ameba_dlmm_bin_page_pda(&program_id, &pool_address, 1).0,
                },
            ],
        };
        let params = SwapAmoebaDlmmExactInV1Params {
            direction: AmoebaDlmmSwapDirection::QuoteForOption,
            amount_in: 1_000_000,
            minimum_amount_out: 900_000,
            limit_bin_id: 240,
            deadline_ts: 2_000_000_000,
        };
        (vault_config, market, oracle_month, pool, accounts, params)
    }

    #[test]
    fn deployment_and_all_preserved_lane_tags_are_exact() {
        assert_eq!(
            crate::ID.to_string(),
            "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw"
        );
        assert_eq!(CURRENT_STATE_NAMESPACE_SEED, b"ameba-spread-v2");
        assert_eq!(CURRENT_PROTOCOL_PROGRAMDATA_BYTES, 1_241_821);
        assert_eq!(
            CURRENT_PROTOCOL_UPGRADE_AUTHORITY.to_string(),
            "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq"
        );
        const CURRENT_VAULT_TAGS: &[u8] = &[
            0, 2, 3, 9, 10, 11, 59, 63, 64, 65, 75, 80, 81, 84, 86, 87, 89, 90, 91, 92, 93, 94, 96,
            109, 110, 113, 116, 121, 122, 124, 128, 129, 131, 133, 135, 136, 137, 138, 139, 140,
            141, 154, 155, 156, 157, 158, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171,
            173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 190, 191,
            192, 193, 194, 195, 196, 197, 198, 199, 201, 202, 203, 205, 220, 221, 222, 223, 224,
            225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241,
            242, 243, 244, 245, 246, 247, 248, 249,
        ];
        for tag in 0_u8..=u8::MAX {
            assert_eq!(
                VaultInstructionTag::from_byte(tag).is_some(),
                CURRENT_VAULT_TAGS.contains(&tag),
                "vault tag membership mismatch for {tag}"
            );
        }
        assert!(matches!(
            VaultInstructionTag::from_byte(94),
            Some(VaultInstructionTag::ProposeEmergencySettlementSignerRecovery)
        ));
        for tag in [
            207, 208, 209, 210, 213, 215, 216, 217, 218, 219, 252, 253, 254, 255,
        ] {
            assert!(
                AmoebaDlmmInstructionTag::from_byte(tag).is_some(),
                "missing DLMM tag {tag}"
            );
        }
        for tag in [29, 31, 34, 35, 69, 97, 189, 204, 206, 211, 212, 214] {
            assert!(VaultInstructionTag::from_byte(tag).is_none());
            assert!(AmoebaDlmmInstructionTag::from_byte(tag).is_none());
        }
    }

    #[test]
    fn emergency_signer_recovery_is_tag_94_with_exact_current_metas() {
        let program_id = crate::ID;
        let registry = crate::state::derive_settlement_signer_registry_pda(&program_id).0;
        let current_set = crate::state::derive_settlement_signer_set_pda(&program_id, 1).0;
        let pending_set = crate::state::derive_settlement_signer_set_pda(&program_id, 2).0;
        let instruction = build_propose_emergency_settlement_signer_recovery_instruction(
            program_id,
            ProposeEmergencySettlementSignerRecoveryAccounts {
                admin: key(1),
                oracle_authority: key(2),
                recovery_authority: key(3),
                vault_config: derive_vault_config_pda(&program_id).0,
                signer_registry: registry,
                current_signer_set: current_set,
                pending_signer_set: pending_set,
            },
            ProposeSettlementSignerRotationParams {
                target_version: 2,
                threshold: 3,
                signer_count: 5,
                signers: [
                    key(10),
                    key(11),
                    key(12),
                    key(13),
                    key(14),
                    Pubkey::default(),
                    Pubkey::default(),
                    Pubkey::default(),
                ],
                rotation_delay_slots: crate::constants::MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
                activate_after_slot: 1_000_000,
            },
        )
        .unwrap();
        assert_eq!(instruction.data[0], 94);
        assert_eq!(instruction.accounts.len(), 8);
        assert!(instruction.accounts[0].is_signer && !instruction.accounts[0].is_writable);
        assert!(instruction.accounts[1].is_signer && !instruction.accounts[1].is_writable);
        assert!(instruction.accounts[2].is_signer && !instruction.accounts[2].is_writable);
        assert!(instruction.accounts[4].is_writable);
        assert!(!instruction.accounts[5].is_writable);
        assert!(instruction.accounts[6].is_writable);
        assert_eq!(instruction.accounts[7].pubkey, CURRENT_SYSTEM_PROGRAM_ID);
        assert!(matches!(
            decode_current_vault_instruction(&instruction.data).unwrap(),
            VaultInstruction::ProposeEmergencySettlementSignerRecovery { .. }
        ));
    }

    #[test]
    fn market_decoder_accepts_only_current_namespaced_identity() {
        let program_id = crate::ID;
        let (address, market) = current_market(None);
        let data = market_account_data(&market);
        let decoded = decode_current_market(
            CurrentAccountData {
                address,
                owner: program_id,
                executable: false,
                data: &data,
            },
            &program_id,
        )
        .unwrap();
        assert_eq!(decoded, market);
        let mut poisoned = data.clone();
        *poisoned.last_mut().unwrap() = 1;
        assert_eq!(
            decode_current_market(
                CurrentAccountData {
                    address,
                    owner: program_id,
                    executable: false,
                    data: &poisoned,
                },
                &program_id,
            ),
            Err(CurrentProtocolError::InvalidAccountData)
        );
    }

    #[test]
    fn market_and_oracle_decoders_reject_noncurrent_accounting_and_versions() {
        let program_id = crate::ID;
        let (market_address, mut market) = current_market(None);
        market.mint_accounting.total_issued = 10;
        market.mint_accounting.total_consumed = 9;
        market.mint_accounting.total_burned = 10;
        let market_data = market_account_data(&market);
        assert_eq!(
            decode_current_market(
                CurrentAccountData {
                    address: market_address,
                    owner: program_id,
                    executable: false,
                    data: &market_data,
                },
                &program_id,
            ),
            Err(CurrentProtocolError::InvalidInvariant)
        );

        let expiry_ts = 2_000_000_000;
        let (oracle_address, bump) =
            derive_oracle_month_pda(&program_id, &market_address, expiry_ts);
        let mut oracle = OracleMonthState::default();
        oracle.is_initialized = true;
        oracle.bump = bump;
        oracle.account_discriminator = OracleMonthState::ACCOUNT_DISCRIMINATOR;
        oracle.account_version = OracleMonthState::ACCOUNT_VERSION;
        oracle.market = market_address;
        oracle.authority = key(22);
        oracle.scramble_start_ts = 1;
        oracle.listing_ts = 2;
        oracle.schedule_version = OracleMonthState::SKU_COVERAGE_SCHEDULE_VERSION;
        oracle.work_reward_currency_version = OracleMonthState::WORK_REWARD_CURRENCY_USDC_V1;
        oracle.candidate_count_tracking_version = 1;
        oracle.active_weight_initialization_version = 1;
        let mut oracle_data = oracle.try_to_vec().unwrap();
        oracle_data.resize(OracleMonthState::LEN, 0);
        assert!(
            decode_current_oracle_month(
                CurrentAccountData {
                    address: oracle_address,
                    owner: program_id,
                    executable: false,
                    data: &oracle_data,
                },
                expiry_ts,
                &program_id,
            )
            .is_ok()
        );
        for stale_field in 0..3 {
            let mut stale = oracle.clone();
            match stale_field {
                0 => stale.work_reward_currency_version = 0,
                1 => stale.candidate_count_tracking_version = 0,
                _ => stale.active_weight_initialization_version = 0,
            }
            let mut stale_data = stale.try_to_vec().unwrap();
            stale_data.resize(OracleMonthState::LEN, 0);
            assert_eq!(
                decode_current_oracle_month(
                    CurrentAccountData {
                        address: oracle_address,
                        owner: program_id,
                        executable: false,
                        data: &stale_data,
                    },
                    expiry_ts,
                    &program_id,
                ),
                Err(CurrentProtocolError::StaleLayout)
            );
        }
    }

    #[test]
    fn every_program_bound_current_decoder_and_builder_rejects_the_rc29_program() {
        let foreign_program = pubkey!("6GREs3vv94fTkhp1pQPZ2tPFMB7PD8tyHrmGCWAtDoVU");
        assert_ne!(foreign_program, crate::ID);

        let (_, mut market) = current_market(None);
        let (foreign_market_address, foreign_market_bump) =
            derive_market_pda(&foreign_program, &market.market_id);
        market.bump = foreign_market_bump;
        let market_data = market_account_data(&market);
        let foreign_market_account = CurrentAccountData {
            address: foreign_market_address,
            owner: foreign_program,
            executable: false,
            data: &market_data,
        };
        assert_eq!(
            decode_current_market(foreign_market_account, &foreign_program),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );
        assert_eq!(
            decode_current_market(foreign_market_account, &crate::ID),
            Err(CurrentProtocolError::WrongOwner)
        );

        let (foreign_vault_address, foreign_vault_bump) = derive_vault_config_pda(&foreign_program);
        let vault = VaultConfig {
            is_initialized: true,
            bump: foreign_vault_bump,
            admin: key(241),
            oracle_authority: key(242),
            usdc_mint: key(243),
            vault_token_account: key(244),
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        };
        let mut vault_data = vault.try_to_vec().unwrap();
        vault_data.resize(VaultConfig::LEN, 0);
        assert_eq!(
            decode_current_vault_config(
                CurrentAccountData {
                    address: foreign_vault_address,
                    owner: foreign_program,
                    executable: false,
                    data: &vault_data,
                },
                &foreign_program,
            ),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );

        let expiry_ts = market.instrument.expiry_ts;
        let (foreign_oracle_address, foreign_oracle_bump) =
            derive_oracle_month_pda(&foreign_program, &foreign_market_address, expiry_ts);
        let mut oracle = OracleMonthState::default();
        oracle.is_initialized = true;
        oracle.bump = foreign_oracle_bump;
        oracle.account_discriminator = OracleMonthState::ACCOUNT_DISCRIMINATOR;
        oracle.account_version = OracleMonthState::ACCOUNT_VERSION;
        oracle.market = foreign_market_address;
        oracle.authority = key(245);
        oracle.scramble_start_ts = 1;
        oracle.listing_ts = 2;
        oracle.schedule_version = OracleMonthState::SKU_COVERAGE_SCHEDULE_VERSION;
        oracle.work_reward_currency_version = OracleMonthState::WORK_REWARD_CURRENCY_USDC_V1;
        oracle.candidate_count_tracking_version = 1;
        oracle.active_weight_initialization_version = 1;
        let mut oracle_data = oracle.try_to_vec().unwrap();
        oracle_data.resize(OracleMonthState::LEN, 0);
        assert_eq!(
            decode_current_oracle_month(
                CurrentAccountData {
                    address: foreign_oracle_address,
                    owner: foreign_program,
                    executable: false,
                    data: &oracle_data,
                },
                expiry_ts,
                &foreign_program,
            ),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );

        let (foreign_pool_address, foreign_pool_bump) =
            derive_ameba_dlmm_pool_pda(&foreign_program, &foreign_market_address);
        let foreign_pool = decompressed_pool(AmoebaDlmmPoolV1 {
            is_initialized: true,
            bump: foreign_pool_bump,
            market: foreign_market_address,
            oracle_month: foreign_oracle_address,
            liquidity_manager: key(246),
            option_mint: key(247),
            quote_mint: vault.usdc_mint,
            option_vault: derive_ameba_dlmm_vault_pda(
                &foreign_program,
                &foreign_pool_address,
                &key(247),
            )
            .0,
            quote_vault: derive_ameba_dlmm_vault_pda(
                &foreign_program,
                &foreign_pool_address,
                &vault.usdc_mint,
            )
            .0,
            expiry_ts,
            tick_size_quote_atomic: market.params.tick_size,
            maximum_price_quote_atomic: market.instrument.max_payout_per_contract,
            maximum_bin_id: 240,
            maximum_bins_per_swap: market.params.max_fills_per_instruction,
            ..AmoebaDlmmPoolV1::default()
        });
        let foreign_pool_data = pool_account_data(&foreign_pool);
        assert_eq!(
            decode_current_ameba_dlmm_pool(
                CurrentAccountData {
                    address: foreign_pool_address,
                    owner: foreign_program,
                    executable: false,
                    data: &foreign_pool_data,
                },
                &foreign_market_address,
                &market,
                &foreign_oracle_address,
                &vault,
                &foreign_program,
            ),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );
        assert_eq!(
            decode_current_ameba_dlmm_pool(
                CurrentAccountData {
                    address: foreign_pool_address,
                    owner: foreign_program,
                    executable: false,
                    data: &foreign_pool_data,
                },
                &foreign_market_address,
                &market,
                &foreign_oracle_address,
                &vault,
                &crate::ID,
            ),
            Err(CurrentProtocolError::WrongOwner)
        );

        let foreign_contract_mint =
            derive_contract_mint_pda(&foreign_program, &foreign_market_address).0;
        let token_bytes = [0_u8; SplTokenMint::LEN];
        assert_eq!(
            decode_current_contract_mint(
                CurrentAccountData {
                    address: foreign_contract_mint,
                    owner: CURRENT_SPL_TOKEN_PROGRAM_ID,
                    executable: false,
                    data: &token_bytes,
                },
                &foreign_market_address,
                &market,
                &foreign_program,
            ),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );

        assert_eq!(
            build_current_vault_instruction(
                foreign_program,
                vec![],
                VaultInstruction::InitUserCollateral,
            ),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );
        assert_eq!(
            build_initialize_ameba_dlmm_light_config_instruction(foreign_program, vec![], &[],),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );
    }

    #[test]
    fn compressed_state_candidate_is_identity_only_and_auth_api_is_absent() {
        assert_eq!(
            CURRENT_COMPRESSED_STATE_AUTHENTICATION_CAPABILITY,
            CurrentCompressedStateAuthenticationCapability::Unavailable
        );
        let canonical_pda = key(23);
        let domain = CompressedStateDomain::OracleSkuCoverageRecord;
        let address_tree = crate::constants::LIGHT_DEFAULT_ADDRESS_TREE_V2;
        let address =
            derive_compressed_state_leaf_address(&crate::ID, &address_tree, domain, &canonical_pda)
                .0;
        let leaf = CompressedAmebaStateLeaf {
            schema_version: CompressedAmebaStateLeaf::CURRENT_SCHEMA_VERSION,
            domain,
            canonical_pda,
            revision: 1,
            data: vec![0; domain.compact_data_len()],
        };
        let data = leaf.try_to_vec().unwrap();
        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &data,
                address,
                address_tree,
                canonical_pda,
                domain,
            )
            .unwrap(),
            leaf
        );

        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &data,
                [0; 32],
                address_tree,
                canonical_pda,
                domain,
            ),
            Err(CurrentProtocolError::InvalidIdentity)
        );
        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &data,
                address,
                key(40),
                canonical_pda,
                domain,
            ),
            Err(CurrentProtocolError::InvalidIdentity)
        );
        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &data,
                address,
                address_tree,
                key(41),
                domain,
            ),
            Err(CurrentProtocolError::InvalidIdentity)
        );
        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &data,
                address,
                address_tree,
                canonical_pda,
                CompressedStateDomain::OracleUsdcSkuPool,
            ),
            Err(CurrentProtocolError::InvalidIdentity)
        );

        let mut stale = leaf.clone();
        stale.schema_version = 0;
        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &stale.try_to_vec().unwrap(),
                address,
                address_tree,
                canonical_pda,
                domain,
            ),
            Err(CurrentProtocolError::StaleLayout)
        );
        let mut trailing = data.clone();
        trailing.push(0);
        assert_eq!(
            decode_current_compressed_state_leaf_candidate(
                &trailing,
                address,
                address_tree,
                canonical_pda,
                domain,
            ),
            Err(CurrentProtocolError::InvalidAccountData)
        );

        let source = include_str!("protocol.rs");
        for forbidden_export in [
            ["pub struct CurrentCompressedState", "Authentication"].concat(),
            [
                "pub fn decode_authenticated_current_",
                "compressed_state_leaf",
            ]
            .concat(),
            ["pub proof_", "verified: bool"].concat(),
        ] {
            assert!(!source.contains(&forbidden_export));
        }
        assert!(
            !source
                .contains(&["pub fn decode_current_", "compressed_state_leaf_candidate"].concat())
        );
    }

    #[test]
    fn dlmm_pool_decoder_enforces_current_grid_identities_and_page_accounting() {
        let program_id = crate::ID;
        let (market_address, mut market) = current_market(None);
        let contract_mint = derive_contract_mint_pda(&program_id, &market_address).0;
        market.long_contract_mint = Some(contract_mint);
        let oracle_month =
            derive_oracle_month_pda(&program_id, &market_address, market.instrument.expiry_ts).0;
        let config = VaultConfig {
            is_initialized: true,
            bump: derive_vault_config_pda(&program_id).1,
            admin: key(24),
            oracle_authority: key(25),
            usdc_mint: market.collateral_mint,
            vault_token_account: key(26),
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        };
        let (pool_address, bump) = derive_ameba_dlmm_pool_pda(&program_id, &market_address);
        let pool = decompressed_pool(AmoebaDlmmPoolV1 {
            is_initialized: true,
            bump,
            market: market_address,
            oracle_month,
            liquidity_manager: key(27),
            option_mint: contract_mint,
            quote_mint: market.collateral_mint,
            option_vault: derive_ameba_dlmm_vault_pda(&program_id, &pool_address, &contract_mint).0,
            quote_vault: derive_ameba_dlmm_vault_pda(
                &program_id,
                &pool_address,
                &market.collateral_mint,
            )
            .0,
            expiry_ts: market.instrument.expiry_ts,
            tick_size_quote_atomic: market.params.tick_size,
            maximum_price_quote_atomic: market.instrument.max_payout_per_contract,
            maximum_bin_id: 240,
            swap_fee_bps: market.params.taker_fee_bps,
            protocol_fee_share_bps: 1_000,
            maximum_bins_per_swap: market.params.max_fills_per_instruction,
            ..AmoebaDlmmPoolV1::default()
        });
        let pool_data = pool_account_data(&pool);
        assert_eq!(
            decode_current_ameba_dlmm_pool(
                CurrentAccountData {
                    address: pool_address,
                    owner: program_id,
                    executable: false,
                    data: &pool_data,
                },
                &market_address,
                &market,
                &oracle_month,
                &config,
                &program_id,
            )
            .unwrap(),
            pool
        );

        let mut invalid_grid = pool.clone();
        invalid_grid.tick_size_quote_atomic = 2;
        invalid_grid.maximum_bin_id = 2;
        invalid_grid.maximum_price_quote_atomic = 5;
        let invalid_data = pool_account_data(&invalid_grid);
        assert_eq!(
            decode_current_ameba_dlmm_pool(
                CurrentAccountData {
                    address: pool_address,
                    owner: program_id,
                    executable: false,
                    data: &invalid_data,
                },
                &market_address,
                &market,
                &oracle_month,
                &config,
                &program_id,
            ),
            Err(CurrentProtocolError::InvalidInvariant)
        );

        let mut overflow_pool = pool.clone();
        overflow_pool.initialized_page_bitmap = 1;
        overflow_pool.accounted_option_reserve = u64::MAX;
        let mut overflow_page = AmoebaDlmmBinPageV1 {
            pool: pool_address,
            page_index: 0,
            first_bin_id: 0,
            ..AmoebaDlmmBinPageV1::default()
        };
        overflow_page.option_reserve[0] = u64::MAX;
        overflow_page.option_reserve[1] = 1;
        assert_eq!(
            validate_current_ameba_dlmm_pool_pages(&pool_address, &overflow_pool, &[overflow_page]),
            Err(CurrentProtocolError::InvalidInvariant)
        );
    }

    #[test]
    fn bounded_encoders_reject_oversized_current_payloads() {
        let oversized = VaultInstruction::ExecuteCompressedStateV1 {
            params: crate::instruction::ExecuteCompressedStateParams {
                core_account_count: 0,
                rent_payer_index: 0,
                proof: ValidityProof(None),
                accesses: vec![],
                inner_instruction: vec![
                    0;
                    crate::constants::MAX_COMPRESSED_INNER_INSTRUCTION_BYTES + 1
                ],
            },
        };
        assert_eq!(
            encode_current_vault_instruction(&oversized),
            Err(CurrentProtocolError::InvalidInstruction)
        );
        assert_eq!(
            decode_current_vault_instruction(&vec![
                0;
                crate::constants::MAX_INSTRUCTION_DATA_BYTES + 1
            ]),
            Err(CurrentProtocolError::InvalidInstruction)
        );
    }

    #[test]
    fn compressed_settlement_and_market_page_builders_preserve_96_116_205() {
        let proof = ValidityProof(None);
        let page = build_upsert_market_page_v2_instruction(
            crate::ID,
            vec![],
            crate::instruction::UpsertMarketPageParams {
                page: CompressedMarketPageLeaf::default(),
            },
            proof.clone(),
            None,
            None,
        )
        .unwrap();
        assert_eq!(page.data[0], 96);
        let settlement = build_upsert_settlement_v3_instruction(
            crate::ID,
            vec![],
            crate::instruction::UpsertSettlementParams {
                settlement: CompressedSettlementLeaf::default(),
            },
            proof.clone(),
            None,
            None,
        )
        .unwrap();
        assert_eq!(settlement.data[0], 116);
        let compressed = build_execute_compressed_state_v1_instruction(
            crate::ID,
            vec![],
            crate::instruction::ExecuteCompressedStateParams {
                core_account_count: 0,
                rent_payer_index: 0,
                proof,
                accesses: vec![],
                inner_instruction: vec![9],
            },
        )
        .unwrap();
        assert_eq!(compressed.data[0], 205);
    }

    #[test]
    fn collective_swap_has_twenty_three_fixed_metas_then_one_to_eight_reserve_pages() {
        let (vault_config, market, oracle_month, pool, accounts, mut params) =
            current_swap_fixture();
        params.limit_bin_id = 0;
        let context = CurrentAmoebaDlmmSwapContext {
            vault_config: &vault_config,
            market: &market,
            oracle_month: &oracle_month,
            pool: &pool,
        };
        let instruction = build_collective_ameba_dlmm_swap_exact_in_instruction(
            crate::ID,
            accounts.clone(),
            context,
            params,
        )
        .unwrap();
        assert_eq!(instruction.data[0], 254);
        assert_eq!(instruction.accounts.len(), 25);
        assert_eq!(
            instruction.accounts[21].pubkey,
            crate::constants::LIGHT_TOKEN_COMPRESSIBLE_CONFIG
        );
        assert!(!instruction.accounts[21].is_writable);
        assert_eq!(
            instruction.accounts[22].pubkey,
            crate::constants::LIGHT_TOKEN_RENT_SPONSOR
        );
        assert!(instruction.accounts[22].is_writable);
        assert_eq!(
            instruction.accounts[23].pubkey,
            accounts.reserve_pages[0].address
        );
        assert_eq!(
            instruction.accounts[24].pubkey,
            accounts.reserve_pages[1].address
        );
        assert!(matches!(
            decode_current_ameba_dlmm_instruction(&instruction.data).unwrap(),
            CurrentAmoebaDlmmInstruction::SwapCollectiveExactIn(_)
        ));
        validate_current_collective_ameba_dlmm_swap_exact_in_instruction(
            &instruction,
            &accounts,
            context,
            &params,
        )
        .unwrap();
    }

    #[test]
    fn swap_rejects_every_deterministic_account_route_and_meta_mutation() {
        let (vault_config, market, oracle_month, pool, accounts, params) = current_swap_fixture();
        let context = CurrentAmoebaDlmmSwapContext {
            vault_config: &vault_config,
            market: &market,
            oracle_month: &oracle_month,
            pool: &pool,
        };
        let instruction = build_collective_ameba_dlmm_swap_exact_in_instruction(
            crate::ID,
            accounts.clone(),
            context,
            params,
        )
        .unwrap();

        let deterministic_mutations: &[fn(&mut CollectiveAmoebaDlmmSwapAccounts)] = &[
            |value| value.vault_config = key(200),
            |value| value.market = key(200),
            |value| value.oracle_month = key(200),
            |value| value.writer_sleeve = key(200),
            |value| value.writer_settlement_group = key(200),
            |value| value.writer_series_book = key(200),
            |value| value.pool = key(200),
            |value| value.authority = key(200),
            |value| value.option_mint = key(200),
            |value| value.quote_mint = key(200),
            |value| value.option_vault = key(200),
            |value| value.quote_vault = key(200),
            |value| value.light_token_program = key(200),
            |value| value.light_cpi_authority = key(200),
            |value| value.option_interface = key(200),
            |value| value.quote_interface = key(200),
            |value| value.spl_token_program = key(200),
            |value| value.system_program = key(200),
            |value| value.light_compressible_config = key(200),
            |value| value.light_rent_sponsor = key(200),
        ];
        for mutate in deterministic_mutations {
            let mut mutated = accounts.clone();
            mutate(&mut mutated);
            assert!(
                build_collective_ameba_dlmm_swap_exact_in_instruction(
                    crate::ID,
                    mutated,
                    context,
                    params,
                )
                .is_err()
            );
        }

        let mut wrong_page_address = accounts.clone();
        wrong_page_address.reserve_pages[0].address = key(201);
        assert!(
            build_collective_ameba_dlmm_swap_exact_in_instruction(
                crate::ID,
                wrong_page_address,
                context,
                params,
            )
            .is_err()
        );
        let mut wrong_page_index = accounts.clone();
        wrong_page_index.reserve_pages[0].page_index = 2;
        assert!(
            build_collective_ameba_dlmm_swap_exact_in_instruction(
                crate::ID,
                wrong_page_index,
                context,
                params,
            )
            .is_err()
        );
        let mut wrong_page_order = accounts.clone();
        wrong_page_order.reserve_pages.swap(0, 1);
        assert!(
            build_collective_ameba_dlmm_swap_exact_in_instruction(
                crate::ID,
                wrong_page_order,
                context,
                params,
            )
            .is_err()
        );
        let mut sell_accounts = accounts.clone();
        sell_accounts.reserve_pages.reverse();
        let sell_params = SwapAmoebaDlmmExactInV1Params {
            direction: AmoebaDlmmSwapDirection::OptionForQuote,
            limit_bin_id: 1,
            ..params
        };
        build_collective_ameba_dlmm_swap_exact_in_instruction(
            crate::ID,
            sell_accounts.clone(),
            context,
            sell_params,
        )
        .unwrap();
        sell_accounts.reserve_pages.reverse();
        assert!(
            build_collective_ameba_dlmm_swap_exact_in_instruction(
                crate::ID,
                sell_accounts,
                context,
                sell_params,
            )
            .is_err()
        );
        assert_eq!(
            build_collective_ameba_dlmm_swap_exact_in_instruction(
                key(202),
                accounts.clone(),
                context,
                params,
            ),
            Err(CurrentProtocolError::ProgramIdMismatch)
        );

        let mut wrong_meta_address = instruction.clone();
        wrong_meta_address.accounts[1].pubkey = key(203);
        assert_eq!(
            validate_current_collective_ameba_dlmm_swap_exact_in_instruction(
                &wrong_meta_address,
                &accounts,
                context,
                &params,
            ),
            Err(CurrentProtocolError::InvalidInstruction)
        );
        let mut wrong_meta_flag = instruction.clone();
        wrong_meta_flag.accounts[22].is_writable = false;
        assert_eq!(
            validate_current_collective_ameba_dlmm_swap_exact_in_instruction(
                &wrong_meta_flag,
                &accounts,
                context,
                &params,
            ),
            Err(CurrentProtocolError::InvalidInstruction)
        );
        let mut wrong_meta_order = instruction.clone();
        wrong_meta_order.accounts.swap(23, 24);
        assert_eq!(
            validate_current_collective_ameba_dlmm_swap_exact_in_instruction(
                &wrong_meta_order,
                &accounts,
                context,
                &params,
            ),
            Err(CurrentProtocolError::InvalidInstruction)
        );
        let mut wrong_data = instruction.clone();
        wrong_data.data[2] ^= 1;
        assert_eq!(
            validate_current_collective_ameba_dlmm_swap_exact_in_instruction(
                &wrong_data,
                &accounts,
                context,
                &params,
            ),
            Err(CurrentProtocolError::InvalidInstruction)
        );
    }

    #[test]
    fn light_lifecycle_builders_accept_only_exact_current_payloads() {
        let program_id = crate::ID;
        let mut initialize = Vec::new();
        initialize.extend_from_slice(key(60).as_ref());
        initialize.extend_from_slice(key(61).as_ref());
        initialize.extend_from_slice(&1_u16.to_le_bytes());
        initialize.extend_from_slice(&2_u16.to_le_bytes());
        initialize.push(3);
        initialize.push(4);
        initialize.extend_from_slice(&5_u16.to_le_bytes());
        initialize.extend_from_slice(&6_u32.to_le_bytes());
        initialize.extend_from_slice(&1_u32.to_le_bytes());
        initialize.extend_from_slice(key(62).as_ref());
        initialize.push(0);
        assert_eq!(initialize.len(), 113);
        let instruction =
            build_initialize_ameba_dlmm_light_config_instruction(program_id, vec![], &initialize)
                .unwrap();
        assert_eq!(instruction.data[0], 216);
        assert!(matches!(
            decode_current_ameba_dlmm_instruction(&instruction.data).unwrap(),
            CurrentAmoebaDlmmInstruction::InitializeLightConfig(params)
                if params.rent_sponsor == key(60)
                    && params.compression_authority == key(61)
                    && params.address_tree == key(62)
        ));
        let mut invalid_initialize = initialize.clone();
        *invalid_initialize.last_mut().unwrap() = 1;
        assert_eq!(
            build_initialize_ameba_dlmm_light_config_instruction(
                program_id,
                vec![],
                &invalid_initialize,
            ),
            Err(CurrentProtocolError::InvalidInstruction)
        );

        let update = [0_u8; 6];
        let instruction =
            build_update_ameba_dlmm_light_config_instruction(program_id, vec![], &update).unwrap();
        assert_eq!(instruction.data[0], 217);
        assert!(matches!(
            decode_current_ameba_dlmm_instruction(&instruction.data).unwrap(),
            CurrentAmoebaDlmmInstruction::UpdateLightConfig(_)
        ));

        let mut compress = Vec::new();
        ValidityProof(None).serialize(&mut compress).unwrap();
        compress.extend_from_slice(&0_u32.to_le_bytes());
        compress.push(0);
        let instruction =
            build_compress_ameba_dlmm_light_state_instruction(program_id, vec![], &compress)
                .unwrap();
        assert_eq!(instruction.data[0], 218);
        assert!(matches!(
            decode_current_ameba_dlmm_instruction(&instruction.data).unwrap(),
            CurrentAmoebaDlmmInstruction::CompressLightState(params)
                if params.compressed_accounts.is_empty()
        ));

        let mut decompress = vec![0, 0, 0];
        ValidityProof(None).serialize(&mut decompress).unwrap();
        decompress.extend_from_slice(&0_u32.to_le_bytes());
        let instruction =
            build_decompress_ameba_dlmm_light_state_instruction(program_id, vec![], &decompress)
                .unwrap();
        assert_eq!(instruction.data[0], 219);
        assert!(matches!(
            decode_current_ameba_dlmm_instruction(&instruction.data).unwrap(),
            CurrentAmoebaDlmmInstruction::DecompressLightState(params)
                if params.accounts.is_empty()
        ));
        let mut malformed = instruction.data;
        malformed.push(0);
        assert!(matches!(
            decode_current_ameba_dlmm_instruction(&malformed),
            Err(CurrentProtocolError::InvalidInstruction)
        ));
    }

    #[test]
    fn share_wire_values_remain_u128() {
        let maximum = u128::MAX;
        let entry = crate::ameba_dlmm_instruction::AmoebaDlmmDepositEntry {
            bin_id: 1,
            maximum_option_amount: 1,
            maximum_quote_amount: 1,
            minimum_shares: maximum,
        };
        assert_eq!(entry.minimum_shares, maximum);
        assert_eq!(core::mem::size_of_val(&entry.minimum_shares), 16);
    }
}
