//! RC44 collective-writer account, PDA, decoder, and user-transaction surface.

use borsh::BorshDeserialize;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

use crate::{
    constants::{
        CURRENT_STATE_NAMESPACE_SEED, WRITER_AUCTION_ESCROW_PDA_SEED, WRITER_AUCTION_PDA_SEED,
        WRITER_BID_INDEX_PDA_SEED, WRITER_BID_PDA_SEED, WRITER_CLOSE_FLAT_ESCROW_PDA_SEED,
        WRITER_CLOSE_REQUEST_PDA_SEED, WRITER_FLAT_BURN_CUSTODY_PDA_SEED,
        WRITER_FLAT_MINT_PDA_SEED, WRITER_FLAT_STAGING_PDA_SEED, WRITER_POLICY_REGISTRY_PDA_SEED,
        WRITER_POLICY_SNAPSHOT_PDA_SEED, WRITER_PROTOCOL_FEE_VAULT_PDA_SEED,
        WRITER_RETIREMENT_CUSTODY_PDA_SEED, WRITER_SERIES_BOOK_PDA_SEED,
        WRITER_SETTLEMENT_GROUP_PDA_SEED, WRITER_SLEEVE_PDA_SEED,
        WRITER_SLEEVE_USDC_VAULT_PDA_SEED,
    },
    instruction::{
        BeginWriterCloseV1Params, ClaimCollectiveLongV1Params, ClaimWriterFlatResidualV1Params,
        PlaceWriterBidV1Params, ProcessWriterCloseCancellationV1Params, VaultInstruction,
        VaultInstructionTag, WriterAmountV1Params, WriterSeriesIndexV1Params,
    },
    protocol::{
        CURRENT_SYSTEM_PROGRAM_ID, CurrentAccountData, CurrentProtocolError,
        build_current_vault_instruction, decode_zero_padded, require_program_account,
    },
    state::{
        WriterAuctionV1, WriterBidIndexRecordV1, WriterBidIndexV1, WriterBidV1,
        WriterCloseRequestV1, WriterPolicyRegistryV1, WriterPolicySnapshotV1, WriterSeriesBookV1,
        WriterSeriesRecordV1, WriterSettlementGroupV1, WriterSleeveV1,
    },
};

pub const WRITER_POLICY_REGISTRY_ACCOUNT_SIZE: usize = WriterPolicyRegistryV1::LEN;
pub const WRITER_POLICY_SNAPSHOT_ACCOUNT_SIZE: usize = WriterPolicySnapshotV1::LEN;
pub const WRITER_SETTLEMENT_GROUP_ACCOUNT_SIZE: usize = WriterSettlementGroupV1::LEN;
pub const WRITER_SLEEVE_ACCOUNT_SIZE: usize = WriterSleeveV1::LEN;
pub const WRITER_SERIES_RECORD_SIZE: usize = WriterSeriesRecordV1::LEN;
pub const WRITER_SERIES_BOOK_ACCOUNT_SIZE: usize = WriterSeriesBookV1::LEN;
pub const WRITER_AUCTION_ACCOUNT_SIZE: usize = WriterAuctionV1::LEN;
pub const WRITER_BID_INDEX_RECORD_SIZE: usize = WriterBidIndexRecordV1::LEN;
pub const WRITER_BID_INDEX_ACCOUNT_SIZE: usize = WriterBidIndexV1::LEN;
pub const WRITER_BID_ACCOUNT_SIZE: usize = WriterBidV1::LEN;
pub const WRITER_CLOSE_REQUEST_ACCOUNT_SIZE: usize = WriterCloseRequestV1::LEN;
pub const WRITER_SHARED_FIXTURE_BYTES: usize = 5_393;
pub const WRITER_SHARED_FIXTURE_SHA256: &str =
    "2a6da8a7d76b85cfc73e6395ade978e944679a000d4f8e181b85118b725c2f58";
pub const CURRENT_LIGHT_FIXTURE_AGGREGATE_SHA256: &str =
    "75b702570e9ca7d56450c706758c57e8d0504e6245897252ba754fbb020c6804";
/// Selector reserved by RC44 for the final Flat cancellation stage.
pub const WRITER_CLOSE_FLAT_SENTINEL: u8 = u8::MAX;

pub fn derive_writer_policy_registry_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_POLICY_REGISTRY_PDA_SEED,
        ],
        program_id,
    )
}

pub fn derive_writer_protocol_fee_vault_pda(
    program_id: &Pubkey,
    registry: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_PROTOCOL_FEE_VAULT_PDA_SEED,
            registry.as_ref(),
        ],
        program_id,
    )
}

pub fn derive_writer_settlement_group_pda(
    program_id: &Pubkey,
    underlying_id: &[u8; 32],
    expiry_ts: u64,
    settlement_mint: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_SETTLEMENT_GROUP_PDA_SEED,
            underlying_id,
            &expiry_ts.to_le_bytes(),
            settlement_mint.as_ref(),
        ],
        program_id,
    )
}

fn derive_writer_child(program_id: &Pubkey, seed: &[u8], parent: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, seed, parent.as_ref()],
        program_id,
    )
}

pub fn derive_writer_sleeve_pda(program_id: &Pubkey, group: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_SLEEVE_PDA_SEED, group)
}

pub fn derive_writer_series_book_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_SERIES_BOOK_PDA_SEED, sleeve)
}

pub fn derive_writer_sleeve_usdc_vault_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_SLEEVE_USDC_VAULT_PDA_SEED, sleeve)
}

pub fn derive_writer_flat_mint_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_FLAT_MINT_PDA_SEED, sleeve)
}

pub fn derive_writer_flat_staging_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_FLAT_STAGING_PDA_SEED, sleeve)
}

pub fn derive_writer_flat_burn_custody_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_FLAT_BURN_CUSTODY_PDA_SEED, sleeve)
}

pub fn derive_writer_policy_snapshot_pda(
    program_id: &Pubkey,
    sleeve: &Pubkey,
    policy_version: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_POLICY_SNAPSHOT_PDA_SEED,
            sleeve.as_ref(),
            &policy_version.to_le_bytes(),
        ],
        program_id,
    )
}

pub fn derive_writer_retirement_custody_pda(
    program_id: &Pubkey,
    sleeve: &Pubkey,
    market: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_RETIREMENT_CUSTODY_PDA_SEED,
            sleeve.as_ref(),
            market.as_ref(),
        ],
        program_id,
    )
}

pub fn derive_writer_auction_pda(program_id: &Pubkey, sleeve: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_AUCTION_PDA_SEED,
            sleeve.as_ref(),
            &nonce.to_le_bytes(),
        ],
        program_id,
    )
}

pub fn derive_writer_bid_index_pda(program_id: &Pubkey, auction: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_BID_INDEX_PDA_SEED, auction)
}

pub fn derive_writer_auction_escrow_pda(program_id: &Pubkey, auction: &Pubkey) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_AUCTION_ESCROW_PDA_SEED, auction)
}

pub fn derive_writer_bid_pda(
    program_id: &Pubkey,
    auction: &Pubkey,
    bidder: &Pubkey,
    order_id: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_BID_PDA_SEED,
            auction.as_ref(),
            bidder.as_ref(),
            &order_id.to_le_bytes(),
        ],
        program_id,
    )
}

pub fn derive_writer_close_request_pda(
    program_id: &Pubkey,
    sleeve: &Pubkey,
    nonce: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_CLOSE_REQUEST_PDA_SEED,
            sleeve.as_ref(),
            &nonce.to_le_bytes(),
        ],
        program_id,
    )
}

pub fn derive_writer_close_flat_escrow_pda(
    program_id: &Pubkey,
    close_request: &Pubkey,
) -> (Pubkey, u8) {
    derive_writer_child(program_id, WRITER_CLOSE_FLAT_ESCROW_PDA_SEED, close_request)
}

fn decode_writer_account<T: BorshDeserialize>(
    account: CurrentAccountData<'_>,
    expected_len: usize,
    program_id: &Pubkey,
) -> Result<T, CurrentProtocolError> {
    require_program_account(account, expected_len, program_id)?;
    decode_zero_padded(account.data)
}

fn require_initialized_layout(
    is_initialized: bool,
    has_current_layout: bool,
) -> Result<(), CurrentProtocolError> {
    if !is_initialized {
        return Err(CurrentProtocolError::Uninitialized);
    }
    if !has_current_layout {
        return Err(CurrentProtocolError::StaleLayout);
    }
    Ok(())
}

/// Decode a policy registry only after binding its current PDA, bump, vault-config parent,
/// and protocol-fee-vault child. This identity-bound form is suitable for plan admission.
pub fn decode_writer_policy_registry(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_vault_config: &Pubkey,
) -> Result<WriterPolicyRegistryV1, CurrentProtocolError> {
    let value: WriterPolicyRegistryV1 =
        decode_writer_account(account, WriterPolicyRegistryV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) = derive_writer_policy_registry_pda(program_id);
    let fee_vault = derive_writer_protocol_fee_vault_pda(program_id, &expected).0;
    if account.address != expected
        || value.bump != bump
        || value.vault_config != *expected_vault_config
        || value.protocol_fee_vault != fee_vault
        || value.policy_authority == Pubkey::default()
        || (value.pending_policy_authority == Pubkey::default())
            != (value.pending_activation_slot == 0)
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Decode a sealed policy snapshot only after binding its sleeve, registry, version, PDA, and bump.
pub fn decode_writer_policy_snapshot(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_sleeve: &Pubkey,
    expected_registry: &Pubkey,
    expected_version: u64,
) -> Result<WriterPolicySnapshotV1, CurrentProtocolError> {
    let value: WriterPolicySnapshotV1 =
        decode_writer_account(account, WriterPolicySnapshotV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) =
        derive_writer_policy_snapshot_pda(program_id, expected_sleeve, expected_version);
    if account.address != expected
        || value.bump != bump
        || value.sleeve != *expected_sleeve
        || value.registry != *expected_registry
        || value.policy_version != expected_version
        || value.max_series != crate::constants::WRITER_MAX_LIVE_SERIES as u8
        || value.drawdown_scale != crate::constants::WRITER_RATIO_SCALE_PPM
        || value.lower_tail_max_settlement_atomic >= value.upper_tail_min_settlement_atomic
        || value.policy_hash == [0; 32]
        || value.scenario_set_hash == [0; 32]
        || value.risk_limit_hash == [0; 32]
        || value.series_family_hash == [0; 32]
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Decode a settlement group only after deriving its full tuple-addressed PDA and sleeve child.
pub fn decode_writer_settlement_group(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
) -> Result<WriterSettlementGroupV1, CurrentProtocolError> {
    let value: WriterSettlementGroupV1 =
        decode_writer_account(account, WriterSettlementGroupV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) = derive_writer_settlement_group_pda(
        program_id,
        &value.underlying_id,
        value.expiry_ts,
        &value.settlement_mint,
    );
    if account.address != expected
        || value.bump != bump
        || value.underlying_id == [0; 32]
        || value.expiry_ts == 0
        || value.settlement_ts != value.expiry_ts
        || value.settlement_mint == Pubkey::default()
        || value.anchor_market == Pubkey::default()
        || value.anchor_oracle_month == Pubkey::default()
        || value.signer_registry == Pubkey::default()
        || value.sleeve != derive_writer_sleeve_pda(program_id, &expected).0
        || usize::from(value.series_count) > crate::constants::WRITER_MAX_LIVE_SERIES
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Decode a sleeve only after binding its group parent and every deterministic child account.
pub fn decode_writer_sleeve(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_group: &Pubkey,
) -> Result<WriterSleeveV1, CurrentProtocolError> {
    let value: WriterSleeveV1 = decode_writer_account(account, WriterSleeveV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) = derive_writer_sleeve_pda(program_id, expected_group);
    let registry = derive_writer_policy_registry_pda(program_id).0;
    if account.address != expected
        || value.bump != bump
        || value.settlement_group != *expected_group
        || value.series_book != derive_writer_series_book_pda(program_id, &expected).0
        || value.usdc_vault != derive_writer_sleeve_usdc_vault_pda(program_id, &expected).0
        || value.flat_mint != derive_writer_flat_mint_pda(program_id, &expected).0
        || value.flat_staging != derive_writer_flat_staging_pda(program_id, &expected).0
        || value.flat_burn_custody != derive_writer_flat_burn_custody_pda(program_id, &expected).0
        || value.policy_registry != registry
        || value.policy_snapshot
            != derive_writer_policy_snapshot_pda(program_id, &expected, value.policy_version).0
        || usize::from(value.series_count) > crate::constants::WRITER_MAX_LIVE_SERIES
        || value.exact_reserve_atoms > value.accounted_asset_atoms
        || value.long_liability_remaining_atoms > value.long_liability_initial_atoms
        || value.flat_residual_remaining_atoms > value.flat_residual_initial_atoms
        || value.flat_claim_supply_remaining_atoms > value.flat_supply_snapshot_atoms
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Decode a series book only after binding its sleeve/group parents and every live record custody.
pub fn decode_writer_series_book(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_sleeve: &Pubkey,
    expected_group: &Pubkey,
) -> Result<WriterSeriesBookV1, CurrentProtocolError> {
    let value: WriterSeriesBookV1 =
        decode_writer_account(account, WriterSeriesBookV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) = derive_writer_series_book_pda(program_id, expected_sleeve);
    if account.address != expected
        || value.bump != bump
        || value.sleeve != *expected_sleeve
        || value.settlement_group != *expected_group
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    for (index, record) in value
        .records
        .iter()
        .take(usize::from(value.series_count))
        .enumerate()
    {
        let supply = record
            .issuer_controlled_atoms
            .checked_add(record.external_open_interest_atoms)
            .ok_or(CurrentProtocolError::InvalidInvariant)?;
        if !record.active
            || record.reserved != [0; 4]
            || record.contract_size_atoms
                != crate::state::MarketMintAccounting::CANONICAL_ATOMIC_SCALE
            || record.total_physical_supply_atoms != supply
            || record.retirement_custody
                != derive_writer_retirement_custody_pda(program_id, expected_sleeve, &record.market)
                    .0
            || (index != 0 && value.records[index - 1].series_id >= record.series_id)
        {
            return Err(CurrentProtocolError::InvalidInvariant);
        }
    }
    Ok(value)
}

/// Decode an auction only after binding the sleeve/nonce parent tuple and deterministic children.
pub fn decode_writer_auction(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_sleeve: &Pubkey,
    expected_nonce: u64,
) -> Result<WriterAuctionV1, CurrentProtocolError> {
    let value: WriterAuctionV1 = decode_writer_account(account, WriterAuctionV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) = derive_writer_auction_pda(program_id, expected_sleeve, expected_nonce);
    let registry = derive_writer_policy_registry_pda(program_id).0;
    if account.address != expected
        || value.bump != bump
        || value.sleeve != *expected_sleeve
        || value.auction_nonce != expected_nonce
        || value.series_book != derive_writer_series_book_pda(program_id, expected_sleeve).0
        || value.policy_snapshot
            != derive_writer_policy_snapshot_pda(program_id, expected_sleeve, value.policy_version)
                .0
        || value.bid_index != derive_writer_bid_index_pda(program_id, &expected).0
        || value.escrow != derive_writer_auction_escrow_pda(program_id, &expected).0
        || value.fee_vault != derive_writer_protocol_fee_vault_pda(program_id, &registry).0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Decode a bid index only after binding its auction parent, PDA, bump, and each occupied bid PDA.
pub fn decode_writer_bid_index(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_auction: &Pubkey,
) -> Result<WriterBidIndexV1, CurrentProtocolError> {
    let value: WriterBidIndexV1 =
        decode_writer_account(account, WriterBidIndexV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) = derive_writer_bid_index_pda(program_id, expected_auction);
    if account.address != expected || value.bump != bump || value.auction != *expected_auction {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    for record in value.records.iter().take(usize::from(value.bid_count)) {
        if !record.occupied
            || record.reserved != 0
            || record.bidder == Pubkey::default()
            || record.bid
                != derive_writer_bid_pda(
                    program_id,
                    expected_auction,
                    &record.bidder,
                    record.order_id,
                )
                .0
        {
            return Err(CurrentProtocolError::InvalidIdentity);
        }
    }
    Ok(value)
}

/// Decode a bid only after binding its auction/bidder/order tuple, PDA, and stored bump.
pub fn decode_writer_bid(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_auction: &Pubkey,
) -> Result<WriterBidV1, CurrentProtocolError> {
    let value: WriterBidV1 = decode_writer_account(account, WriterBidV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) =
        derive_writer_bid_pda(program_id, expected_auction, &value.bidder, value.order_id);
    let accounted = value
        .premium_charged_atoms
        .checked_add(value.fee_charged_atoms)
        .and_then(|charged| charged.checked_add(value.refunded_atoms))
        .ok_or(CurrentProtocolError::InvalidInvariant)?;
    if account.address != expected
        || value.bump != bump
        || value.auction != *expected_auction
        || value.bidder == Pubkey::default()
        || value.refund_token_account == Pubkey::default()
        || value.claim_destination == Pubkey::default()
        || value.requested_contract_atoms == 0
        || value.bid_price_per_contract_atoms == 0
        || value.accepted_contract_atoms > value.requested_contract_atoms
        || value.executed_contract_atoms > value.accepted_contract_atoms
        || accounted > value.escrowed_atoms
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

/// Decode a close request only after binding its sleeve/nonce tuple, flat escrow, and flat mint.
pub fn decode_writer_close_request(
    account: CurrentAccountData<'_>,
    program_id: &Pubkey,
    expected_sleeve: &Pubkey,
    expected_nonce: u64,
) -> Result<WriterCloseRequestV1, CurrentProtocolError> {
    let value: WriterCloseRequestV1 =
        decode_writer_account(account, WriterCloseRequestV1::LEN, program_id)?;
    require_initialized_layout(value.is_initialized, value.has_current_layout())?;
    let (expected, bump) =
        derive_writer_close_request_pda(program_id, expected_sleeve, expected_nonce);
    if account.address != expected
        || value.bump != bump
        || value.sleeve != *expected_sleeve
        || value.request_nonce != expected_nonce
        || value.flat_escrow != derive_writer_close_flat_escrow_pda(program_id, &expected).0
        || value.flat_mint != derive_writer_flat_mint_pda(program_id, expected_sleeve).0
        || value.owner == Pubkey::default()
        || value.flat_amount_atoms == 0
        || value.series_count == 0
    {
        return Err(CurrentProtocolError::InvalidIdentity);
    }
    Ok(value)
}

pub fn decode_current_writer_instruction(
    data: &[u8],
) -> Result<VaultInstruction, CurrentProtocolError> {
    if data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let tag = *data
        .first()
        .ok_or(CurrentProtocolError::InvalidInstruction)?;
    if tag != 159 && !(220..=249).contains(&tag) {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    let instruction = VaultInstruction::try_from_slice(data)
        .map_err(|_| CurrentProtocolError::InvalidInstruction)?;
    if matches!(&instruction, VaultInstruction::PrepareWriterBidIndexV1 { params } if params.phase > 1)
    {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(instruction)
}

fn writable(pubkey: Pubkey, signer: bool) -> AccountMeta {
    AccountMeta {
        pubkey,
        is_signer: signer,
        is_writable: true,
    }
}

fn readonly(pubkey: Pubkey, signer: bool) -> AccountMeta {
    AccountMeta {
        pubkey,
        is_signer: signer,
        is_writable: false,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DepositWriterPrincipalAccounts {
    pub depositor: Pubkey,
    pub vault_config: Pubkey,
    pub sleeve: Pubkey,
    pub policy_snapshot: Pubkey,
    pub sleeve_usdc_vault: Pubkey,
    pub depositor_usdc_source: Pubkey,
    pub settlement_mint: Pubkey,
    pub flat_mint: Pubkey,
    pub flat_staging: Pubkey,
    pub depositor_flat_destination: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_interface: Pubkey,
    pub spl_token_program: Pubkey,
    pub system_program: Pubkey,
    pub compressible_config: Pubkey,
    pub rent_sponsor: Pubkey,
}

pub fn build_deposit_writer_principal_instruction(
    program_id: Pubkey,
    a: DepositWriterPrincipalAccounts,
    amount_atoms: u64,
) -> Result<Instruction, CurrentProtocolError> {
    if amount_atoms == 0 || a.system_program != CURRENT_SYSTEM_PROGRAM_ID {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.depositor, true),
            readonly(a.vault_config, false),
            writable(a.sleeve, false),
            readonly(a.policy_snapshot, false),
            writable(a.sleeve_usdc_vault, false),
            writable(a.depositor_usdc_source, false),
            readonly(a.settlement_mint, false),
            writable(a.flat_mint, false),
            writable(a.flat_staging, false),
            writable(a.depositor_flat_destination, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            writable(a.spl_interface, false),
            readonly(a.spl_token_program, false),
            readonly(a.system_program, false),
            readonly(a.compressible_config, false),
            writable(a.rent_sponsor, false),
            readonly(crate::writer_dlmm::derive_writer_dlmm_policy_pda(&program_id, &a.sleeve).0, false),
        ],
        VaultInstruction::DepositWriterPrincipalV1 {
            params: WriterAmountV1Params { amount_atoms },
        },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WithdrawWriterPrincipalAccounts {
    pub depositor: Pubkey, pub vault_config: Pubkey, pub sleeve: Pubkey,
    pub sleeve_usdc_vault: Pubkey, pub depositor_usdc_destination: Pubkey,
    pub settlement_mint: Pubkey, pub flat_mint: Pubkey, pub depositor_flat_source: Pubkey,
    pub flat_burn_custody: Pubkey, pub flat_spl_interface: Pubkey,
    pub light_token_program: Pubkey, pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey, pub system_program: Pubkey,
}

pub fn build_withdraw_writer_principal_instruction(program_id: Pubkey, a: WithdrawWriterPrincipalAccounts,
    amount_atoms: u64) -> Result<Instruction, CurrentProtocolError> {
    if amount_atoms == 0 || a.system_program != CURRENT_SYSTEM_PROGRAM_ID { return Err(CurrentProtocolError::InvalidInvariant); }
    build_current_vault_instruction(program_id, vec![
        writable(a.depositor, true), readonly(a.vault_config, false), writable(a.sleeve, false),
        writable(a.sleeve_usdc_vault, false), writable(a.depositor_usdc_destination, false),
        readonly(a.settlement_mint, false), writable(a.flat_mint, false), writable(a.depositor_flat_source, false),
        writable(a.flat_burn_custody, false), writable(a.flat_spl_interface, false),
        readonly(a.light_token_program, false), readonly(a.compressed_token_authority, false),
        readonly(a.spl_token_program, false), readonly(a.system_program, false),
    ], VaultInstruction::WithdrawWriterPrincipalV1 { params: WriterAmountV1Params { amount_atoms } })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CancelOrRefundWriterBidAccounts {
    pub actor: Pubkey, pub sleeve: Pubkey, pub auction: Pubkey, pub bid_index: Pubkey,
    pub bid: Pubkey, pub auction_escrow: Pubkey, pub refund_token_account: Pubkey,
    pub settlement_mint: Pubkey, pub spl_token_program: Pubkey,
}

pub fn build_cancel_or_refund_writer_bid_instruction(program_id: Pubkey, a: CancelOrRefundWriterBidAccounts)
    -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(program_id, vec![readonly(a.actor, true), readonly(a.sleeve, false),
        writable(a.auction, false), writable(a.bid_index, false), writable(a.bid, false),
        writable(a.auction_escrow, false), writable(a.refund_token_account, false),
        readonly(a.settlement_mint, false), readonly(a.spl_token_program, false),
    ], VaultInstruction::CancelOrRefundWriterBidV1)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlaceWriterBidAccounts {
    pub bidder: Pubkey,
    pub sleeve: Pubkey,
    pub auction: Pubkey,
    pub bid_index: Pubkey,
    pub bid: Pubkey,
    pub series_book: Pubkey,
    pub policy_snapshot: Pubkey,
    pub bidder_usdc_source: Pubkey,
    pub auction_escrow: Pubkey,
    pub settlement_mint: Pubkey,
    pub claim_destination: Pubkey,
    pub spl_token_program: Pubkey,
}

pub fn build_place_writer_bid_instruction(
    program_id: Pubkey,
    a: PlaceWriterBidAccounts,
    params: PlaceWriterBidV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    if params.bid_price_per_contract_atoms == 0 || params.requested_contract_atoms == 0 {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.bidder, true),
            readonly(a.sleeve, false),
            writable(a.auction, false),
            writable(a.bid_index, false),
            writable(a.bid, false),
            readonly(a.series_book, false),
            readonly(a.policy_snapshot, false),
            writable(a.bidder_usdc_source, false),
            writable(a.auction_escrow, false),
            readonly(a.settlement_mint, false),
            readonly(a.claim_destination, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        VaultInstruction::PlaceWriterBidV1 { params },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BeginWriterCloseAccounts {
    pub owner: Pubkey,
    pub vault_config: Pubkey,
    pub sleeve: Pubkey,
    pub settlement_group: Pubkey,
    pub series_book: Pubkey,
    pub policy_snapshot: Pubkey,
    pub close_request: Pubkey,
    pub flat_mint: Pubkey,
    pub owner_flat_source: Pubkey,
    pub close_flat_escrow: Pubkey,
    pub flat_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
}

pub fn build_begin_writer_close_instruction(
    program_id: Pubkey,
    a: BeginWriterCloseAccounts,
    params: BeginWriterCloseV1Params,
) -> Result<Instruction, CurrentProtocolError> {
    if params.flat_amount_atoms == 0 || params.deadline_ts == 0 {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.owner, true),
            readonly(a.vault_config, false),
            writable(a.sleeve, false),
            readonly(a.settlement_group, false),
            readonly(a.series_book, false),
            readonly(a.policy_snapshot, false),
            writable(a.close_request, false),
            writable(a.flat_mint, false),
            writable(a.owner_flat_source, false),
            writable(a.close_flat_escrow, false),
            writable(a.flat_spl_interface, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        VaultInstruction::BeginWriterCloseV1 { params },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DepositWriterCloseBasketAccounts {
    pub owner: Pubkey,
    pub sleeve: Pubkey,
    pub series_book: Pubkey,
    pub close_request: Pubkey,
    pub market: Pubkey,
    pub contract_mint: Pubkey,
    pub owner_claim_source: Pubkey,
    pub retirement_custody: Pubkey,
    pub contract_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
}

pub fn build_deposit_writer_close_basket_instruction(
    program_id: Pubkey,
    a: DepositWriterCloseBasketAccounts,
    series_index: u8,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.owner, true),
            readonly(a.sleeve, false),
            readonly(a.series_book, false),
            writable(a.close_request, false),
            readonly(a.market, false),
            readonly(a.contract_mint, false),
            writable(a.owner_claim_source, false),
            writable(a.retirement_custody, false),
            writable(a.contract_spl_interface, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        VaultInstruction::DepositWriterCloseBasketV1 {
            params: WriterSeriesIndexV1Params { series_index },
        },
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FinalizeWriterCloseAccounts {
    pub owner: Pubkey,
    pub vault_config: Pubkey,
    pub sleeve: Pubkey,
    pub settlement_group: Pubkey,
    pub series_book: Pubkey,
    pub policy_snapshot: Pubkey,
    pub close_request: Pubkey,
    pub sleeve_usdc_vault: Pubkey,
    pub owner_usdc_destination: Pubkey,
    pub settlement_mint: Pubkey,
    pub flat_mint: Pubkey,
    pub close_flat_escrow: Pubkey,
    pub spl_token_program: Pubkey,
    pub series_burn_accounts_in_book_order: Vec<[Pubkey; 3]>,
}

pub fn build_finalize_writer_close_instruction(
    program_id: Pubkey,
    a: FinalizeWriterCloseAccounts,
) -> Result<Instruction, CurrentProtocolError> {
    if !(1..=crate::constants::WRITER_MAX_LIVE_SERIES)
        .contains(&a.series_burn_accounts_in_book_order.len())
    {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    let mut metas = vec![
        readonly(a.owner, true),
        readonly(a.vault_config, false),
        writable(a.sleeve, false),
        readonly(a.settlement_group, false),
        writable(a.series_book, false),
        readonly(a.policy_snapshot, false),
        writable(a.close_request, false),
        writable(a.sleeve_usdc_vault, false),
        writable(a.owner_usdc_destination, false),
        readonly(a.settlement_mint, false),
        writable(a.flat_mint, false),
        writable(a.close_flat_escrow, false),
        readonly(a.spl_token_program, false),
        readonly(crate::writer_dlmm::derive_writer_dlmm_policy_pda(&program_id, &a.sleeve).0, false),
    ];
    metas.extend(
        a.series_burn_accounts_in_book_order
            .into_iter()
            .flatten()
            .map(|key| writable(key, false)),
    );
    build_current_vault_instruction(program_id, metas, VaultInstruction::FinalizeWriterCloseV1)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProcessWriterCloseSeriesCancellationAccounts {
    pub actor: Pubkey,
    pub sleeve: Pubkey,
    pub series_book: Pubkey,
    pub close_request: Pubkey,
    pub market: Pubkey,
    pub contract_mint: Pubkey,
    pub retirement_custody: Pubkey,
    pub owner_claim_destination: Pubkey,
    pub contract_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
}

pub fn build_process_writer_close_series_cancellation_instruction(
    program_id: Pubkey,
    a: ProcessWriterCloseSeriesCancellationAccounts,
    series_index: u8,
) -> Result<Instruction, CurrentProtocolError> {
    if series_index == WRITER_CLOSE_FLAT_SENTINEL {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.actor, true),
            writable(a.sleeve, false),
            readonly(a.series_book, false),
            writable(a.close_request, false),
            readonly(a.market, false),
            readonly(a.contract_mint, false),
            writable(a.retirement_custody, false),
            writable(a.owner_claim_destination, false),
            writable(a.contract_spl_interface, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        VaultInstruction::ProcessWriterCloseCancellationV1 {
            params: ProcessWriterCloseCancellationV1Params {
                selector: series_index,
            },
        },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProcessWriterCloseFlatCancellationAccounts {
    pub actor: Pubkey,
    pub sleeve: Pubkey,
    pub close_request: Pubkey,
    pub flat_mint: Pubkey,
    pub close_flat_escrow: Pubkey,
    pub owner_flat_destination: Pubkey,
    pub flat_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
}

pub fn build_process_writer_close_flat_cancellation_instruction(
    program_id: Pubkey,
    a: ProcessWriterCloseFlatCancellationAccounts,
) -> Result<Instruction, CurrentProtocolError> {
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.actor, true),
            writable(a.sleeve, false),
            writable(a.close_request, false),
            readonly(a.flat_mint, false),
            writable(a.close_flat_escrow, false),
            writable(a.owner_flat_destination, false),
            writable(a.flat_spl_interface, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        ],
        VaultInstruction::ProcessWriterCloseCancellationV1 {
            params: ProcessWriterCloseCancellationV1Params {
                selector: WRITER_CLOSE_FLAT_SENTINEL,
            },
        },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClaimCollectiveLongAccounts {
    pub holder: Pubkey,
    pub vault_config: Pubkey,
    pub sleeve: Pubkey,
    pub settlement_group: Pubkey,
    pub series_book: Pubkey,
    pub market: Pubkey,
    pub contract_mint: Pubkey,
    pub holder_claim_source: Pubkey,
    pub retirement_custody: Pubkey,
    pub contract_spl_interface: Pubkey,
    pub sleeve_usdc_vault: Pubkey,
    pub holder_usdc_destination: Pubkey,
    pub settlement_mint: Pubkey,
    pub usdc_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
    pub compressible_config: Pubkey,
    pub rent_sponsor: Pubkey,
}

pub fn build_claim_collective_long_instruction(
    program_id: Pubkey,
    a: ClaimCollectiveLongAccounts,
    claim_atoms: u64,
) -> Result<Instruction, CurrentProtocolError> {
    if claim_atoms == 0 {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.holder, true),
            readonly(a.vault_config, false),
            writable(a.sleeve, false),
            readonly(a.settlement_group, false),
            writable(a.series_book, false),
            writable(a.market, false),
            writable(a.contract_mint, false),
            writable(a.holder_claim_source, false),
            writable(a.retirement_custody, false),
            writable(a.contract_spl_interface, false),
            writable(a.sleeve_usdc_vault, false),
            writable(a.holder_usdc_destination, false),
            readonly(a.settlement_mint, false),
            writable(a.usdc_spl_interface, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
            readonly(a.compressible_config, false),
            writable(a.rent_sponsor, false),
        ],
        VaultInstruction::ClaimCollectiveLongV1 {
            params: ClaimCollectiveLongV1Params { claim_atoms },
        },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClaimWriterFlatResidualAccounts {
    pub holder: Pubkey,
    pub vault_config: Pubkey,
    pub sleeve: Pubkey,
    pub flat_mint: Pubkey,
    pub holder_flat_source: Pubkey,
    pub flat_burn_custody: Pubkey,
    pub flat_spl_interface: Pubkey,
    pub sleeve_usdc_vault: Pubkey,
    pub holder_usdc_destination: Pubkey,
    pub settlement_mint: Pubkey,
    pub usdc_spl_interface: Pubkey,
    pub light_token_program: Pubkey,
    pub compressed_token_authority: Pubkey,
    pub spl_token_program: Pubkey,
    pub compressible_config: Pubkey,
    pub rent_sponsor: Pubkey,
}

pub fn build_claim_writer_flat_residual_instruction(
    program_id: Pubkey,
    a: ClaimWriterFlatResidualAccounts,
    flat_atoms: u64,
) -> Result<Instruction, CurrentProtocolError> {
    if flat_atoms == 0 {
        return Err(CurrentProtocolError::InvalidInvariant);
    }
    build_current_vault_instruction(
        program_id,
        vec![
            writable(a.holder, true),
            readonly(a.vault_config, false),
            writable(a.sleeve, false),
            writable(a.flat_mint, false),
            writable(a.holder_flat_source, false),
            writable(a.flat_burn_custody, false),
            writable(a.flat_spl_interface, false),
            writable(a.sleeve_usdc_vault, false),
            writable(a.holder_usdc_destination, false),
            readonly(a.settlement_mint, false),
            writable(a.usdc_spl_interface, false),
            readonly(a.light_token_program, false),
            readonly(a.compressed_token_authority, false),
            readonly(a.spl_token_program, false),
            readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
            readonly(a.compressible_config, false),
            writable(a.rent_sponsor, false),
        ],
        VaultInstruction::ClaimWriterFlatResidualV1 {
            params: ClaimWriterFlatResidualV1Params { flat_atoms },
        },
    )
}

pub fn writer_instruction_tag(instruction: &VaultInstruction) -> Result<u8, CurrentProtocolError> {
    let data = crate::protocol::encode_current_vault_instruction(instruction)?;
    let tag = data[0];
    if VaultInstructionTag::from_byte(tag).is_none() || !(220..=249).contains(&tag) {
        return Err(CurrentProtocolError::InvalidInstruction);
    }
    Ok(tag)
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshSerialize;

    #[test]
    fn prepare_bid_index_has_exact_normal_tag_and_two_phase_payloads() {
        for phase in [0, 1] {
            let instruction = VaultInstruction::PrepareWriterBidIndexV1 {
                params: crate::instruction::PrepareWriterBidIndexV1Params {
                    auction_nonce: 7,
                    phase,
                },
            };
            let bytes = borsh::to_vec(&instruction).unwrap();
            assert_eq!(bytes.len(), 10);
            assert_eq!(bytes[0], 249);
            assert_eq!(&bytes[1..9], &7_u64.to_le_bytes());
            assert_eq!(bytes[9], phase);
            assert_eq!(writer_instruction_tag(&instruction).unwrap(), 249);
            assert_eq!(
                decode_current_writer_instruction(&bytes).unwrap(),
                instruction
            );
            assert!(decode_current_writer_instruction(&bytes[..9]).is_err());
            let mut trailing = bytes.clone();
            trailing.push(0);
            assert!(decode_current_writer_instruction(&trailing).is_err());
            let mut bad_phase = bytes;
            bad_phase[9] = 2;
            assert!(decode_current_writer_instruction(&bad_phase).is_err());
        }
        for tag in [250, 251] {
            assert!(decode_current_writer_instruction(&[tag, 0]).is_err());
        }
    }

    #[test]
    fn finalize_close_encodes_complete_ordered_burn_triples() {
        let key = Pubkey::new_unique;
        let roles = vec![[key(), key(), key()], [key(), key(), key()]];
        let accounts = FinalizeWriterCloseAccounts {
            owner: key(),
            vault_config: key(),
            sleeve: key(),
            settlement_group: key(),
            series_book: key(),
            policy_snapshot: key(),
            close_request: key(),
            sleeve_usdc_vault: key(),
            owner_usdc_destination: key(),
            settlement_mint: key(),
            flat_mint: key(),
            close_flat_escrow: key(),
            spl_token_program: key(),
            series_burn_accounts_in_book_order: roles.clone(),
        };
        let instruction = build_finalize_writer_close_instruction(crate::ID, accounts).unwrap();
        assert_eq!(instruction.data, vec![242]);
        assert_eq!(instruction.accounts.len(), 19);
        for (actual, expected) in instruction.accounts[13..]
            .iter()
            .zip(roles.into_iter().flatten())
        {
            assert_eq!(actual.pubkey, expected);
            assert!(actual.is_writable);
            assert!(!actual.is_signer);
        }
    }

    fn fixed_account_bytes<T: BorshSerialize>(value: &T, len: usize) -> Vec<u8> {
        let mut data = borsh::to_vec(value).unwrap();
        assert!(data.len() <= len);
        data.resize(len, 0);
        data
    }

    #[test]
    fn rc44_writer_layouts_and_tag_domain_are_exact() {
        assert_eq!(
            [
                WRITER_POLICY_REGISTRY_ACCOUNT_SIZE,
                WRITER_POLICY_SNAPSHOT_ACCOUNT_SIZE,
                WRITER_SETTLEMENT_GROUP_ACCOUNT_SIZE,
                WRITER_SLEEVE_ACCOUNT_SIZE,
                WRITER_SERIES_RECORD_SIZE,
                WRITER_SERIES_BOOK_ACCOUNT_SIZE,
                WRITER_AUCTION_ACCOUNT_SIZE,
                WRITER_BID_INDEX_RECORD_SIZE,
                WRITER_BID_INDEX_ACCOUNT_SIZE,
                WRITER_BID_ACCOUNT_SIZE,
                WRITER_CLOSE_REQUEST_ACCOUNT_SIZE,
            ],
            [
                198, 344, 558, 764, 256, 8_312, 1_534, 116, 14_936, 230, 1_088
            ],
        );
        for tag in 220..=249 {
            assert_eq!(
                VaultInstructionTag::from_byte(tag).map(|value| value as u8),
                Some(tag)
            );
        }
        for tag in [29, 31, 34, 35, 69, 97, 189, 204, 206, 211, 212, 214] {
            assert!(decode_current_writer_instruction(&[tag]).is_err());
        }
        let mut oversized = vec![0; crate::constants::MAX_INSTRUCTION_DATA_BYTES + 1];
        oversized[0] = 220;
        assert_eq!(
            decode_current_writer_instruction(&oversized),
            Err(CurrentProtocolError::InvalidInstruction)
        );
    }

    #[test]
    fn writer_registry_decode_binds_address_bump_and_parent_identities() {
        let program_id = crate::ID;
        let vault_config = Pubkey::new_unique();
        let (address, bump) = derive_writer_policy_registry_pda(&program_id);
        let mut value = WriterPolicyRegistryV1 {
            is_initialized: true,
            bump,
            account_discriminator: WriterPolicyRegistryV1::ACCOUNT_DISCRIMINATOR,
            account_version: WriterPolicyRegistryV1::ACCOUNT_VERSION,
            vault_config,
            policy_authority: Pubkey::new_unique(),
            protocol_fee_vault: derive_writer_protocol_fee_vault_pda(&program_id, &address).0,
            ..WriterPolicyRegistryV1::default()
        };
        let data = fixed_account_bytes(&value, WriterPolicyRegistryV1::LEN);
        let account = CurrentAccountData {
            address,
            owner: program_id,
            executable: false,
            data: &data,
        };
        assert!(decode_writer_policy_registry(account, &program_id, &vault_config).is_ok());
        assert_eq!(
            decode_writer_policy_registry(account, &program_id, &Pubkey::new_unique()),
            Err(CurrentProtocolError::InvalidIdentity)
        );

        value.bump = value.bump.wrapping_add(1);
        let wrong_bump_data = fixed_account_bytes(&value, WriterPolicyRegistryV1::LEN);
        assert_eq!(
            decode_writer_policy_registry(
                CurrentAccountData {
                    data: &wrong_bump_data,
                    ..account
                },
                &program_id,
                &vault_config,
            ),
            Err(CurrentProtocolError::InvalidIdentity)
        );
    }

    #[test]
    fn writer_pdas_are_namespace_bound_and_deterministic() {
        let group =
            derive_writer_settlement_group_pda(&crate::ID, &[7; 32], 42, &Pubkey::new_unique()).0;
        let sleeve = derive_writer_sleeve_pda(&crate::ID, &group).0;
        assert_eq!(derive_writer_sleeve_pda(&crate::ID, &group).0, sleeve);
        assert_ne!(derive_writer_series_book_pda(&crate::ID, &sleeve).0, sleeve);
        assert_ne!(
            derive_writer_auction_pda(&crate::ID, &sleeve, 1).0,
            derive_writer_auction_pda(&crate::ID, &sleeve, 2).0
        );
    }

    #[test]
    fn bid_builder_emits_exact_tag_and_ordered_meta_count() {
        let key = || Pubkey::new_unique();
        let accounts = PlaceWriterBidAccounts {
            bidder: key(),
            sleeve: key(),
            auction: key(),
            bid_index: key(),
            bid: key(),
            series_book: key(),
            policy_snapshot: key(),
            bidder_usdc_source: key(),
            auction_escrow: key(),
            settlement_mint: key(),
            claim_destination: key(),
            spl_token_program: key(),
        };
        let instruction = build_place_writer_bid_instruction(
            crate::ID,
            accounts,
            PlaceWriterBidV1Params {
                order_id: 9,
                series_index: 1,
                delivery_mode: crate::state::WriterBidDeliveryMode::LightToken,
                bid_price_per_contract_atoms: 12,
                requested_contract_atoms: 34,
            },
        )
        .unwrap();
        assert_eq!(instruction.data[0], 234);
        assert_eq!(instruction.accounts.len(), 13);
    }
}
