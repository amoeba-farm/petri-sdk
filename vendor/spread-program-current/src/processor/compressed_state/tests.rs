use super::{
    apply_materialized_source_descriptor, capture_compact_state_data, decode_compact_state,
    encode_compact_state, materialized_coverage_bytes, materialized_reward_registration_bytes,
    materialized_sku_pool_bytes, materialized_source_bytes, materialized_source_reward_bytes,
    materialized_support_bytes, reference_validate_typed_state_data, required_access_contract,
    validate_compact_state_data, validate_typed_state_data, CompactOracleSkuCoverageRecord,
    CompactOracleSourceDescriptor, CompactOracleSourceState, CompactOracleSupportPosition,
    CompactOracleUsdcRewardReceipt, CompactOracleUsdcRewardRegistration, CompactOracleUsdcSkuPool,
    CompactOracleUsdcSourceReward, RequiredAccessKind, RequiredAccessSpec,
};
use crate::{
    constants::{
        CURRENT_STATE_NAMESPACE_SEED, MAX_COMPRESSED_STATE_LEAF_BYTES,
        ORACLE_SKU_COVERAGE_RECORD_PDA_SEED, ORACLE_SOURCE_PDA_SEED,
        ORACLE_SUPPORT_POSITION_PDA_SEED, ORACLE_USDC_SKU_POOL_PDA_SEED,
        ORACLE_USDC_SOURCE_REWARD_PDA_SEED,
    },
    fixed_codec::ReferenceBorsh,
    state::{
        derive_oracle_usdc_reward_receipt_pda, derive_oracle_usdc_reward_registration_pda,
        CompressedStateDomain, OracleEscrowDisposition, OracleSkuCoverageRecord, OracleSourceState,
        OracleSourceStatus, OracleSupportPosition, OracleUsdcRewardKind, OracleUsdcRewardReceipt,
        OracleUsdcRewardRegistration, OracleUsdcSkuPool, OracleUsdcSourceReward,
    },
};
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

mod codecs;
mod contracts;
mod current_domains;
mod payloads;

fn assert_compact_codec_matches_borsh<T>(value: T)
where
    T: BorshDeserialize + BorshSerialize + ReferenceBorsh + std::fmt::Debug + Eq,
{
    let encoded = borsh::to_vec(&value).expect("serialize compact leaf");
    assert_eq!(encoded, value.reference_borsh_bytes());
    assert_eq!(
        T::try_from_slice(&encoded).expect("decode compact leaf"),
        value
    );
}

fn assert_fixed_projection<T: BorshSerialize>(
    domain: CompressedStateDomain,
    value: &T,
    expected: &[u8],
) {
    let typed = value.try_to_vec().expect("serialize typed state");
    assert_eq!(capture_compact_state_data(domain, &typed), expected);
}

fn fixed_account_bytes<T: BorshSerialize>(value: &T, len: usize) -> Vec<u8> {
    let mut data = value.try_to_vec().expect("serialize typed state");
    data.resize(len, 0);
    data
}

fn reference_validate_compact_state_data(
    domain: CompressedStateDomain,
    data: &[u8],
) -> solana_program::entrypoint::ProgramResult {
    use crate::error::VaultError;

    match domain {
        CompressedStateDomain::OracleSourceObservations => {
            return current_domains::reference_observations(data);
        }
        CompressedStateDomain::OracleCarryJournal => {
            return current_domains::reference_journal(data);
        }
        CompressedStateDomain::OracleCarryCheckpoint => {
            return current_domains::reference_checkpoint(data);
        }
        CompressedStateDomain::OracleSkuCoverageRecord => {
            let _: CompactOracleSkuCoverageRecord =
                decode_compact_state(data, VaultError::InvalidOracleSkuCoverageRecord)?;
        }
        CompressedStateDomain::OracleUsdcSkuPool => {
            let _: CompactOracleUsdcSkuPool =
                decode_compact_state(data, VaultError::InvalidOracleUsdcSkuPool)?;
        }
        CompressedStateDomain::OracleUsdcSourceReward => {
            let _: CompactOracleUsdcSourceReward =
                decode_compact_state(data, VaultError::InvalidOracleUsdcSourceReward)?;
        }
        CompressedStateDomain::OracleSupportPosition => {
            let state: CompactOracleSupportPosition =
                decode_compact_state(data, VaultError::InvalidOracleState)?;
            if crate::pubkey_is_default(&state.source)
                || crate::pubkey_is_default(&state.supporter)
                || state.support_stake == 0
                || (state.released && state.escrow_disposition != OracleEscrowDisposition::Refunded)
                || (!state.released
                    && state.escrow_disposition != OracleEscrowDisposition::Unsettled)
                || (state.failed_schedule_escrow_counted && !state.released)
            {
                return Err(VaultError::InvalidOracleState.into());
            }
        }
        CompressedStateDomain::OracleUsdcRewardRegistration => {
            let state: CompactOracleUsdcRewardRegistration =
                decode_compact_state(data, VaultError::InvalidOracleUsdcRewardRegistration)?;
            if crate::pubkey_is_default(&state.sku_pool)
                || crate::pubkey_is_default(&state.subject)
                || crate::pubkey_is_default(&state.recipient)
                || state.reward_units == 0
            {
                return Err(VaultError::InvalidOracleUsdcRewardRegistration.into());
            }
        }
        CompressedStateDomain::OracleUsdcRewardReceipt => {
            let state: CompactOracleUsdcRewardReceipt =
                decode_compact_state(data, VaultError::InvalidOracleUsdcRewardReceipt)?;
            if crate::pubkey_is_default(&state.subject)
                || crate::pubkey_is_default(&state.recipient)
                || state.amount == 0
            {
                return Err(VaultError::InvalidOracleUsdcRewardReceipt.into());
            }
        }

        CompressedStateDomain::OracleSourceState => {
            let state: CompactOracleSourceState =
                decode_compact_state(data, VaultError::InvalidOracleSourceAccount)?;
            if crate::bytes32_is_zero(&state.source_id)
                || crate::bytes32_is_zero(&state.bucket_id)
                || crate::pubkey_is_default(&state.proposer)
            {
                return Err(VaultError::InvalidOracleSourceAccount.into());
            }
        }
        CompressedStateDomain::OracleSourceDescriptor => {
            let state: CompactOracleSourceDescriptor =
                decode_compact_state(data, VaultError::InvalidOracleSourceAccount)?;
            if crate::bytes32_is_zero(&state.source_type_hash)
                || crate::bytes32_is_zero(&state.canonical_locator_hash)
                || crate::bytes32_is_zero(&state.source_definition_hash)
            {
                return Err(VaultError::InvalidOracleSourceAccount.into());
            }
        }
    }
    Ok(())
}

fn assert_compact_validator_parity(domain: CompressedStateDomain, data: &[u8]) {
    let assert_same = |candidate: &[u8]| {
        assert_eq!(
            validate_compact_state_data(domain, candidate).is_ok(),
            reference_validate_compact_state_data(domain, candidate).is_ok(),
            "validator parity for {domain:?} and {} bytes",
            candidate.len(),
        );
    };
    assert_same(data);
    for length in 0..data.len() {
        assert_same(&data[..length]);
    }
    let mut candidate = data.to_vec();
    candidate.push(0);
    assert_same(&candidate);
    candidate.push(1);
    assert_same(&candidate);
    candidate.truncate(data.len());
    for index in 0..candidate.len() {
        let original = candidate[index];
        for replacement in [0, 1, 2, u8::MAX] {
            candidate[index] = replacement;
            assert_same(&candidate);
        }
        candidate[index] = original;
    }
}

fn assert_valid<T: BorshSerialize>(
    program_id: &Pubkey,
    key: Pubkey,
    domain: CompressedStateDomain,
    value: &T,
    len: usize,
) {
    let mut data = value.try_to_vec().unwrap();
    data.resize(len, 0);
    let assert_same = |candidate: &[u8], candidate_key: &Pubkey| {
        assert_eq!(
            validate_typed_state_data(program_id, candidate_key, domain, candidate, None),
            reference_validate_typed_state_data(program_id, candidate_key, domain, candidate, None,),
            "typed validator parity for {domain:?} and {} bytes",
            candidate.len(),
        );
    };
    assert_same(&data, &key);
    assert_same(&data, &Pubkey::new_unique());
    for length in 0..data.len() {
        assert_same(&data[..length], &key);
    }
    data.push(0);
    assert_same(&data, &key);
    *data.last_mut().unwrap() = 1;
    assert_same(&data, &key);
    data.pop();
    for index in 0..data.len() {
        let original = data[index];
        for replacement in [0, 1, 2, u8::MAX] {
            data[index] = replacement;
            assert_same(&data, &key);
        }
        data[index] = original;
    }
}
