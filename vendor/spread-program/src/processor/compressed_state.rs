use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};
use solana_sdk_ids::system_program;
use std::mem::MaybeUninit;

use crate::{
    compression::{
        apply_compressed_state_leaf_mutations, derive_compressed_state_leaf_address,
        CompressedStateLeafClose, CompressedStateLeafCreate, CompressedStateLeafReadOnly,
        CompressedStateLeafUpdate,
    },
    constants::{
        MAX_COMPRESSED_INNER_INSTRUCTION_BYTES, MAX_COMPRESSED_STATE_SESSION_RECORDS,
        ORACLE_SAMBA_WINNING_VOTE_PDA_SEED, ORACLE_SKU_COVERAGE_RECORD_PDA_SEED,
        ORACLE_SOURCE_PDA_SEED, ORACLE_SUPPORT_POSITION_PDA_SEED,
        ORACLE_USDC_REWARD_REGISTRATION_PDA_SEED, ORACLE_USDC_REWARD_REGISTRATION_VERSION_SEED,
        ORACLE_USDC_SKU_POOL_PDA_SEED, ORACLE_USDC_SOURCE_REWARD_PDA_SEED,
    },
    error::VaultError,
    fixed_codec::{
        invalid_fixed_borsh, FixedCursor, FixedField, FixedStateDecode, FixedStateEncode,
        FixedWriter,
    },
    instruction::{CompressedStateAccess, ExecuteCompressedStateParams, VaultInstructionTag},
    state::{
        derive_oracle_samba_vote_settlement_pda, derive_oracle_samba_winning_vote_pda,
        derive_oracle_sku_coverage_record_pda, derive_oracle_usdc_reward_receipt_pda,
        derive_oracle_usdc_reward_registration_pda, derive_oracle_usdc_reward_schedule_pda,
        derive_oracle_usdc_reward_vault_pda, derive_oracle_usdc_sku_pool_pda,
        derive_oracle_usdc_source_reward_pda, CompressedAmebaStateLeaf, CompressedStateDomain,
        OracleEscrowDisposition, OracleSambaVoteSettlementReceipt, OracleSambaWinningVote,
        OracleSkuCoverageRecord, OracleSourceState, OracleSourceStatus, OracleSupportPosition,
        OracleUsdcRewardKind, OracleUsdcRewardReceipt, OracleUsdcRewardRegistration,
        OracleUsdcRewardSchedule, OracleUsdcSkuPool, OracleUsdcSourceReward,
    },
};

struct CaptureVec<T> {
    items: [MaybeUninit<T>; MAX_COMPRESSED_STATE_SESSION_RECORDS],
    len: u8,
}

impl<T> CaptureVec<T> {
    #[inline(always)]
    fn new() -> Self {
        Self {
            items: [const { MaybeUninit::uninit() }; MAX_COMPRESSED_STATE_SESSION_RECORDS],
            len: 0,
        }
    }

    #[inline(always)]
    fn push(&mut self, value: T) {
        debug_assert!(usize::from(self.len) < self.items.len());
        self.items[usize::from(self.len)].write(value);
        self.len += 1;
    }

    #[inline(always)]
    fn as_slice(&self) -> &[T] {
        // SAFETY: `push` initializes every element below `len`, and the session-wide access bound
        // prevents capacity overflow.
        unsafe { std::slice::from_raw_parts(self.items.as_ptr().cast::<T>(), self.len.into()) }
    }
}

impl<T> Drop for CaptureVec<T> {
    fn drop(&mut self) {
        for item in &mut self.items[..usize::from(self.len)] {
            // SAFETY: Every element below `len` was initialized exactly once by `push`.
            unsafe { item.assume_init_drop() };
        }
    }
}

#[cfg(test)]
use crate::constants::MAX_COMPRESSED_STATE_LEAF_BYTES;
#[cfg(test)]
use crate::fixed_codec::ReferenceBorsh;
#[cfg(test)]
use crate::{bytes32_is_zero, pubkey_is_default};

/// Only fields that cannot be reconstructed from canonical instruction accounts are stored in
/// Light. This is deliberately byte-for-byte lossless for the mutable hot-account view presented to
/// the transition core.
#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleUsdcSkuPool {
    bucket_id: [u8; 32],
    source_reward_budget: u64,
    remaining_source_reward_budget: u64,
    opening_reward_budget: u64,
    remaining_opening_reward_budget: u64,
    update_reward_budget: u64,
    remaining_update_reward_budget: u64,
    proposer_reward_bps: u16,
    listing_bond: u64,
    support_bond: u64,
    opening_bond: u64,
    update_min_bond: u64,
    challenge_min_bond: u64,
    challenge_max_bond: u64,
    challenge_bond_bps: u16,
    registered_source_count: u32,
    registered_opening_count: u32,
    registered_update_count: u32,
    registered_update_reward_units: u32,
    last_updated_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleUsdcSourceReward {
    source: Pubkey,
    supporter_count: u32,
    registered: bool,
    terminal_status: OracleSourceStatus,
    opening_claim: Pubkey,
    last_updated_slot: u64,
    merged_into_source: Pubkey,
    max_merge_depth: u8,
    listing_escrow_counted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleSkuCoverageRecord {
    sku_id: [u8; 32],
    sku_index: u16,
    active_supported_source_count: u16,
    last_updated_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleUsdcRewardRegistration {
    sku_pool: Pubkey,
    subject: Pubkey,
    recipient: Pubkey,
    reward_units: u8,
    last_updated_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleUsdcRewardReceipt {
    kind: OracleUsdcRewardKind,
    subject: Pubkey,
    recipient: Pubkey,
    amount: u64,
    claimed_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleSambaWinningVote {
    base_entitlement: u64,
    registered_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleSambaVoteSettlementReceipt {
    amount: u64,
    disposition: OracleEscrowDisposition,
    settled_slot: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleSupportPosition {
    source: Pubkey,
    supporter: Pubkey,
    support_stake: u64,
    released: bool,
    escrow_disposition: OracleEscrowDisposition,
    failed_schedule_escrow_counted: bool,
    /// The source may already have been compacted when a retained merge-lineage reward is
    /// claimed. Keep its immutable logical id in the support leaf so materialization never
    /// requires a second source leaf merely to reconstruct the unchanged typed account.
    source_id: [u8; 32],
}

/// Mutable source state plus the immutable identities used by ordinary lifecycle checks. The
/// three large immutable descriptor hashes live in a separate read-only compressed leaf.
#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleSourceState {
    source_id: [u8; 32],
    bucket_id: [u8; 32],
    proposer: Pubkey,
    baseline_state: u64,
    current_state: u64,
    listing_bond_locked: u64,
    support_stake_total: u64,
    bucket_weight_bps: u16,
    status: OracleSourceStatus,
    opening_submitted: bool,
    opening_evidence_hash: [u8; 32],
    last_finalized_step: u64,
    observation_count: u8,
    rolling_observation_hash: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CompactOracleSourceDescriptor {
    source_type_hash: [u8; 32],
    canonical_locator_hash: [u8; 32],
    source_definition_hash: [u8; 32],
}

crate::fixed_codec::fixed_state_deserialize!(CompactOracleUsdcSkuPool, 156, {
    bucket_id: [u8; 32],
    source_reward_budget: u64,
    remaining_source_reward_budget: u64,
    opening_reward_budget: u64,
    remaining_opening_reward_budget: u64,
    update_reward_budget: u64,
    remaining_update_reward_budget: u64,
    proposer_reward_bps: u16,
    listing_bond: u64,
    support_bond: u64,
    opening_bond: u64,
    update_min_bond: u64,
    challenge_min_bond: u64,
    challenge_max_bond: u64,
    challenge_bond_bps: u16,
    registered_source_count: u32,
    registered_opening_count: u32,
    registered_update_count: u32,
    registered_update_reward_units: u32,
    last_updated_slot: u64,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleUsdcSourceReward, 112, {
    source: Pubkey,
    supporter_count: u32,
    registered: bool,
    terminal_status: OracleSourceStatus,
    opening_claim: Pubkey,
    last_updated_slot: u64,
    merged_into_source: Pubkey,
    max_merge_depth: u8,
    listing_escrow_counted: bool,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleSkuCoverageRecord, 44, {
    sku_id: [u8; 32],
    sku_index: u16,
    active_supported_source_count: u16,
    last_updated_slot: u64,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleUsdcRewardRegistration, 105, {
    sku_pool: Pubkey,
    subject: Pubkey,
    recipient: Pubkey,
    reward_units: u8,
    last_updated_slot: u64,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleUsdcRewardReceipt, 81, {
    kind: OracleUsdcRewardKind,
    subject: Pubkey,
    recipient: Pubkey,
    amount: u64,
    claimed_slot: u64,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleSambaWinningVote, 16, {
    base_entitlement: u64,
    registered_slot: u64,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleSambaVoteSettlementReceipt, 17, {
    amount: u64,
    disposition: OracleEscrowDisposition,
    settled_slot: u64,
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleSupportPosition, 107, {
    source: Pubkey,
    supporter: Pubkey,
    support_stake: u64,
    released: bool,
    escrow_disposition: OracleEscrowDisposition,
    failed_schedule_escrow_counted: bool,
    source_id: [u8; 32],
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleSourceState, 205, {
    source_id: [u8; 32],
    bucket_id: [u8; 32],
    proposer: Pubkey,
    baseline_state: u64,
    current_state: u64,
    listing_bond_locked: u64,
    support_stake_total: u64,
    bucket_weight_bps: u16,
    status: OracleSourceStatus,
    opening_submitted: bool,
    opening_evidence_hash: [u8; 32],
    last_finalized_step: u64,
    observation_count: u8,
    rolling_observation_hash: [u8; 32],
});

crate::fixed_codec::fixed_state_deserialize!(CompactOracleSourceDescriptor, 96, {
    source_type_hash: [u8; 32],
    canonical_locator_hash: [u8; 32],
    source_definition_hash: [u8; 32],
});

impl CompactOracleUsdcSkuPool {
    #[cfg(test)]
    fn from_full(state: &OracleUsdcSkuPool) -> Self {
        Self {
            bucket_id: state.bucket_id,
            source_reward_budget: state.source_reward_budget,
            remaining_source_reward_budget: state.remaining_source_reward_budget,
            opening_reward_budget: state.opening_reward_budget,
            remaining_opening_reward_budget: state.remaining_opening_reward_budget,
            update_reward_budget: state.update_reward_budget,
            remaining_update_reward_budget: state.remaining_update_reward_budget,
            proposer_reward_bps: state.proposer_reward_bps,
            listing_bond: state.listing_bond,
            support_bond: state.support_bond,
            opening_bond: state.opening_bond,
            update_min_bond: state.update_min_bond,
            challenge_min_bond: state.challenge_min_bond,
            challenge_max_bond: state.challenge_max_bond,
            challenge_bond_bps: state.challenge_bond_bps,
            registered_source_count: state.registered_source_count,
            registered_opening_count: state.registered_opening_count,
            registered_update_count: state.registered_update_count,
            registered_update_reward_units: state.registered_update_reward_units,
            last_updated_slot: state.last_updated_slot,
        }
    }

    #[cfg(test)]
    fn into_full(self, bump: u8, schedule: Pubkey, month: Pubkey) -> OracleUsdcSkuPool {
        OracleUsdcSkuPool {
            is_initialized: true,
            bump,
            account_discriminator: OracleUsdcSkuPool::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUsdcSkuPool::ACCOUNT_VERSION,
            schedule,
            month,
            bucket_id: self.bucket_id,
            source_reward_budget: self.source_reward_budget,
            remaining_source_reward_budget: self.remaining_source_reward_budget,
            opening_reward_budget: self.opening_reward_budget,
            remaining_opening_reward_budget: self.remaining_opening_reward_budget,
            update_reward_budget: self.update_reward_budget,
            remaining_update_reward_budget: self.remaining_update_reward_budget,
            proposer_reward_bps: self.proposer_reward_bps,
            listing_bond: self.listing_bond,
            support_bond: self.support_bond,
            opening_bond: self.opening_bond,
            update_min_bond: self.update_min_bond,
            challenge_min_bond: self.challenge_min_bond,
            challenge_max_bond: self.challenge_max_bond,
            challenge_bond_bps: self.challenge_bond_bps,
            registered_source_count: self.registered_source_count,
            registered_opening_count: self.registered_opening_count,
            registered_update_count: self.registered_update_count,
            registered_update_reward_units: self.registered_update_reward_units,
            last_updated_slot: self.last_updated_slot,
        }
    }
}

impl CompactOracleUsdcSourceReward {
    #[cfg(test)]
    fn from_full(state: &OracleUsdcSourceReward) -> Self {
        Self {
            source: state.source,
            supporter_count: state.supporter_count,
            registered: state.registered,
            terminal_status: state.terminal_status,
            opening_claim: state.opening_claim,
            last_updated_slot: state.last_updated_slot,
            merged_into_source: state.merged_into_source,
            max_merge_depth: state.max_merge_depth,
            listing_escrow_counted: state.listing_escrow_counted,
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    fn into_full(
        self,
        bump: u8,
        month: Pubkey,
        schedule: Pubkey,
        sku_pool: Pubkey,
        source_id: [u8; 32],
        proposer: Pubkey,
    ) -> OracleUsdcSourceReward {
        OracleUsdcSourceReward {
            is_initialized: true,
            bump,
            account_discriminator: OracleUsdcSourceReward::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUsdcSourceReward::ACCOUNT_VERSION,
            month,
            schedule,
            sku_pool,
            source: self.source,
            source_id,
            proposer,
            supporter_count: self.supporter_count,
            registered: self.registered,
            terminal_status: self.terminal_status,
            opening_claim: self.opening_claim,
            last_updated_slot: self.last_updated_slot,
            merged_into_source: self.merged_into_source,
            max_merge_depth: self.max_merge_depth,
            listing_escrow_counted: self.listing_escrow_counted,
        }
    }
}

impl CompactOracleUsdcRewardRegistration {
    #[cfg(test)]
    fn from_full(state: &OracleUsdcRewardRegistration) -> Self {
        Self {
            sku_pool: state.sku_pool,
            subject: state.subject,
            recipient: state.recipient,
            reward_units: state.reward_units,
            last_updated_slot: state.last_updated_slot,
        }
    }

    #[cfg(test)]
    fn into_full(self, bump: u8, month: Pubkey, schedule: Pubkey) -> OracleUsdcRewardRegistration {
        OracleUsdcRewardRegistration {
            is_initialized: true,
            bump,
            account_discriminator: OracleUsdcRewardRegistration::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUsdcRewardRegistration::ACCOUNT_VERSION,
            month,
            schedule,
            sku_pool: self.sku_pool,
            kind: OracleUsdcRewardKind::Update,
            subject: self.subject,
            recipient: self.recipient,
            reward_units: self.reward_units,
            last_updated_slot: self.last_updated_slot,
        }
    }
}

impl CompactOracleUsdcRewardReceipt {
    #[cfg(test)]
    fn from_full(state: &OracleUsdcRewardReceipt) -> Self {
        Self {
            kind: state.kind,
            subject: state.subject,
            recipient: state.recipient,
            amount: state.amount,
            claimed_slot: state.claimed_slot,
        }
    }
}

impl CompactOracleSambaWinningVote {
    #[cfg(test)]
    fn from_full(state: &OracleSambaWinningVote) -> Self {
        Self {
            base_entitlement: state.base_entitlement,
            registered_slot: state.registered_slot,
        }
    }

    #[cfg(test)]
    fn into_full(
        self,
        bump: u8,
        pot: Pubkey,
        dispute: Pubkey,
        vote: Pubkey,
        voter: Pubkey,
        voting_power: u64,
    ) -> OracleSambaWinningVote {
        OracleSambaWinningVote {
            is_initialized: true,
            bump,
            account_discriminator: OracleSambaWinningVote::ACCOUNT_DISCRIMINATOR,
            account_version: OracleSambaWinningVote::ACCOUNT_VERSION,
            pot,
            dispute,
            vote,
            voter,
            voting_power,
            base_entitlement: self.base_entitlement,
            registered_slot: self.registered_slot,
        }
    }
}

impl CompactOracleSambaVoteSettlementReceipt {
    #[cfg(test)]
    fn from_full(state: &OracleSambaVoteSettlementReceipt) -> Self {
        Self {
            amount: state.amount,
            disposition: state.disposition,
            settled_slot: state.settled_slot,
        }
    }
}

impl CompactOracleSupportPosition {
    #[cfg(test)]
    fn from_full(state: &OracleSupportPosition) -> Self {
        Self {
            source: state.source,
            supporter: state.supporter,
            support_stake: state.support_stake,
            released: state.released,
            escrow_disposition: state.escrow_disposition,
            failed_schedule_escrow_counted: state.failed_schedule_escrow_counted,
            source_id: state.source_id,
        }
    }

    #[cfg(test)]
    fn into_full(self, bump: u8, month: Pubkey) -> OracleSupportPosition {
        OracleSupportPosition {
            is_initialized: true,
            bump,
            month,
            supporter: self.supporter,
            source: self.source,
            source_id: self.source_id,
            support_stake: self.support_stake,
            released: self.released,
            escrow_disposition: self.escrow_disposition,
            failed_schedule_escrow_counted: self.failed_schedule_escrow_counted,
        }
    }
}

impl CompactOracleSourceState {
    #[cfg(test)]
    fn from_full(state: &OracleSourceState) -> Self {
        Self {
            source_id: state.source_id,
            bucket_id: state.bucket_id,
            proposer: state.proposer,
            baseline_state: state.baseline_state,
            current_state: state.current_state,
            listing_bond_locked: state.listing_bond_locked,
            support_stake_total: state.support_stake_total,
            bucket_weight_bps: state.bucket_weight_bps,
            status: state.status,
            opening_submitted: state.opening_submitted,
            opening_evidence_hash: state.opening_evidence_hash,
            last_finalized_step: state.last_finalized_step,
            observation_count: state.observation_count,
            rolling_observation_hash: state.rolling_observation_hash,
        }
    }

    #[cfg(test)]
    fn into_full(self, bump: u8, month: Pubkey) -> OracleSourceState {
        OracleSourceState {
            is_initialized: true,
            bump,
            month,
            source_id: self.source_id,
            bucket_id: self.bucket_id,
            source_type_hash: [0; 32],
            canonical_locator_hash: [0; 32],
            source_definition_hash: [0; 32],
            proposer: self.proposer,
            baseline_state: self.baseline_state,
            current_state: self.current_state,
            listing_bond_locked: self.listing_bond_locked,
            support_stake_total: self.support_stake_total,
            bucket_weight_bps: self.bucket_weight_bps,
            status: self.status,
            opening_submitted: self.opening_submitted,
            opening_evidence_hash: self.opening_evidence_hash,
            last_finalized_step: self.last_finalized_step,
            observation_count: self.observation_count,
            rolling_observation_hash: self.rolling_observation_hash,
        }
    }
}

impl CompactOracleSourceDescriptor {
    #[cfg(test)]
    fn from_full(state: &OracleSourceState) -> Self {
        Self {
            source_type_hash: state.source_type_hash,
            canonical_locator_hash: state.canonical_locator_hash,
            source_definition_hash: state.source_definition_hash,
        }
    }

    #[cfg(test)]
    fn apply_to(self, state: &mut OracleSourceState) {
        state.source_type_hash = self.source_type_hash;
        state.canonical_locator_hash = self.canonical_locator_hash;
        state.source_definition_hash = self.source_definition_hash;
    }
}

impl CompactOracleSkuCoverageRecord {
    #[cfg(test)]
    fn from_full(state: &OracleSkuCoverageRecord) -> Self {
        Self {
            sku_id: state.sku_id,
            sku_index: state.sku_index,
            active_supported_source_count: state.active_supported_source_count,
            last_updated_slot: state.last_updated_slot,
        }
    }

    #[cfg(test)]
    fn into_full(self, bump: u8, month: Pubkey) -> OracleSkuCoverageRecord {
        OracleSkuCoverageRecord {
            is_initialized: true,
            bump,
            account_discriminator: OracleSkuCoverageRecord::ACCOUNT_DISCRIMINATOR,
            account_version: OracleSkuCoverageRecord::ACCOUNT_VERSION,
            month,
            sku_id: self.sku_id,
            sku_index: self.sku_index,
            active_supported_source_count: self.active_supported_source_count,
            last_updated_slot: self.last_updated_slot,
        }
    }
}

mod contracts;
mod execute;
mod materialize;
mod validation;

pub(super) use contracts::*;
pub(super) use execute::*;
pub(super) use materialize::*;
pub(super) use validation::*;

#[cfg(test)]
mod tests;
