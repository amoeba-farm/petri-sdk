//! Strict portable validation for RC44 collective-DLMM tag-254 plans.
//!
//! This layer decodes no price or reserve formula. It binds an already
//! Lean-admitted semantic request to the exact native payload, account grammar,
//! canonical PDA chain, writable set, signer role, and plan commitments.

use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use solana_program::{
    hash::hash,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use thiserror::Error;

use crate::{
    ID as CURRENT_PROGRAM_ID,
    ameba_dlmm_state::{
        derive_ameba_dlmm_authority_pda, derive_ameba_dlmm_bin_page_pda,
        derive_ameba_dlmm_pool_pda, derive_ameba_dlmm_vault_pda,
    },
    constants::{LIGHT_TOKEN_COMPRESSIBLE_CONFIG, LIGHT_TOKEN_RENT_SPONSOR},
    current_finalized_observation::{
        CurrentFinalizedObservation, validate_current_finalized_observation,
    },
    protocol::{
        CURRENT_LIGHT_TOKEN_CPI_AUTHORITY, CURRENT_LIGHT_TOKEN_PROGRAM_ID,
        CURRENT_SPL_TOKEN_PROGRAM_ID, CURRENT_SYSTEM_PROGRAM_ID, derive_light_spl_interface_pda,
        derive_vault_config_pda,
    },
    writer_sleeve::{derive_writer_series_book_pda, derive_writer_sleeve_pda},
};

pub const COLLECTIVE_SWAP_OPERATION_SCHEMA_VERSION: u8 = 1;
pub const COLLECTIVE_SWAP_OPERATION: &str = "collective_swap_exact_in";
pub const COLLECTIVE_SWAP_EXACT_IN_TAG: u8 = 254;
pub const COLLECTIVE_SWAP_MAX_RESERVE_PAGES: usize = 8;
pub const COLLECTIVE_SWAP_DEADLINE_TTL_SECONDS: u64 = 120;
pub const COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT: u32 = 1_000_000;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CollectiveSwapOperationError {
    #[error("collective swap operation JSON is invalid: {0}")]
    InvalidJson(String),
    #[error("collective swap operation plan is invalid: {0}")]
    InvalidPlan(&'static str),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CollectiveSwapDirection {
    QuoteForOption,
    OptionForQuote,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectiveSwapSemanticInput {
    pub trader: String,
    pub market: String,
    pub oracle_month: String,
    pub writer_settlement_group: String,
    pub writer_sleeve: String,
    pub writer_series_book: String,
    pub pool: String,
    pub option_mint: String,
    pub quote_mint: String,
    pub direction: CollectiveSwapDirection,
    pub amount_in: String,
    pub minimum_amount_out: String,
    pub limit_bin_id: u16,
    pub deadline_ts: String,
    pub reserve_page_indices: Vec<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectiveSwapInstructionAccountMeta {
    pub address: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectiveSwapInstructionManifest {
    pub program_id: String,
    pub instruction_name: String,
    pub instruction_tag: u8,
    pub data_base64: String,
    pub accounts: Vec<CollectiveSwapInstructionAccountMeta>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectiveSwapSignerRole {
    pub pubkey: String,
    pub role: String,
    pub instruction_indexes: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollectiveSwapOperationPlan {
    pub schema_version: u8,
    pub operation: String,
    pub operation_id: String,
    pub current_observation: CurrentFinalizedObservation,
    pub current_observation_digest: String,
    pub lean_admission_digest: String,
    pub semantic: CollectiveSwapSemanticInput,
    pub instruction: CollectiveSwapInstructionManifest,
    pub write_set: Vec<String>,
    pub signer_roles: Vec<CollectiveSwapSignerRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compute_unit_limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_lookup_table: Option<crate::collective_lookup_table::CurrentCollectiveLookupTableWitnessV1>,
    pub prepared_plan_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedCollectiveSwapOperation {
    pub plan: CollectiveSwapOperationPlan,
    pub instruction: Instruction,
    pub execution_instructions: Vec<Instruction>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpectedCollectiveSwapRequest {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub direction: CollectiveSwapDirection,
    pub amount_in: u64,
    pub minimum_amount_out: u64,
    pub limit_bin_id: u16,
}

/// Parse a complete portable plan and enforce the exact RC44 tag-254 grammar.
pub fn parse_collective_swap_operation_json(
    encoded: &str,
) -> Result<ValidatedCollectiveSwapOperation, CollectiveSwapOperationError> {
    let plan: CollectiveSwapOperationPlan = serde_json::from_str(encoded)
        .map_err(|error| CollectiveSwapOperationError::InvalidJson(error.to_string()))?;
    validate_collective_swap_operation(plan)
}

/// Validate a parsed plan without accepting any alternate tag or account form.
pub fn validate_collective_swap_operation(
    plan: CollectiveSwapOperationPlan,
) -> Result<ValidatedCollectiveSwapOperation, CollectiveSwapOperationError> {
    crate::governed_operation::require_historical_operation_mode_v1()
        .map_err(|_| invalid("historical swap plans are offline-only"))?;
    validate_collective_swap_operation_inner(plan, None)
}

fn validate_collective_swap_operation_inner(
    plan: CollectiveSwapOperationPlan,
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>,
) -> Result<ValidatedCollectiveSwapOperation, CollectiveSwapOperationError> {
    if plan.schema_version != COLLECTIVE_SWAP_OPERATION_SCHEMA_VERSION
        || plan.operation != COLLECTIVE_SWAP_OPERATION
        || plan.current_observation_digest != plan.current_observation.current_observation_digest
        || !lowercase_sha256(&plan.lean_admission_digest)
        || !lowercase_sha256(&plan.operation_id)
        || !lowercase_sha256(&plan.prepared_plan_digest)
    {
        return Err(invalid(
            "schema, operation, observation, or digest is not canonical",
        ));
    }
    validate_current_finalized_observation(&plan.current_observation)
        .map_err(|_| invalid("current finalized observation is invalid"))?;

    let trader = canonical_pubkey(&plan.semantic.trader)?;
    let market = canonical_pubkey(&plan.semantic.market)?;
    let oracle_month = canonical_pubkey(&plan.semantic.oracle_month)?;
    let group = canonical_pubkey(&plan.semantic.writer_settlement_group)?;
    let sleeve = canonical_pubkey(&plan.semantic.writer_sleeve)?;
    let book = canonical_pubkey(&plan.semantic.writer_series_book)?;
    let pool = canonical_pubkey(&plan.semantic.pool)?;
    let option_mint = canonical_pubkey(&plan.semantic.option_mint)?;
    let quote_mint = canonical_pubkey(&plan.semantic.quote_mint)?;
    let amount_in = positive_u64(&plan.semantic.amount_in)?;
    let minimum_amount_out = positive_u64(&plan.semantic.minimum_amount_out)?;
    let deadline_ts = positive_u64(&plan.semantic.deadline_ts)?;
    let observed_block_time = positive_u64(
        plan.current_observation
            .observed_block_time_unix_seconds
            .as_deref()
            .ok_or_else(|| invalid("finalized observation has no block time"))?,
    )?;
    if observed_block_time.checked_add(COLLECTIVE_SWAP_DEADLINE_TTL_SECONDS) != Some(deadline_ts) {
        return Err(invalid(
            "deadline is not finalized block time plus 120 seconds",
        ));
    }
    if !(if context.is_some() { 0 } else { 1 }..=COLLECTIVE_SWAP_MAX_RESERVE_PAGES).contains(&plan.semantic.reserve_page_indices.len())
        || plan
            .semantic
            .reserve_page_indices
            .iter()
            .copied()
            .collect::<HashSet<_>>()
            .len()
            != plan.semantic.reserve_page_indices.len()
        || sleeve != derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &group).0
        || book != derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
        || pool != derive_ameba_dlmm_pool_pda(&CURRENT_PROGRAM_ID, &market).0
    {
        return Err(invalid(
            "semantic identities or reserve-page route are not canonical",
        ));
    }

    let manifest = &plan.instruction;
    if manifest.program_id != CURRENT_PROGRAM_ID.to_string()
        || manifest.instruction_name != "SwapCollectiveDlmmExactInV1"
        || manifest.instruction_tag != COLLECTIVE_SWAP_EXACT_IN_TAG
        || manifest.accounts.len()
            != (if context.is_some() { 32 + 1 } else { 23 }) + plan.semantic.reserve_page_indices.len()
    {
        return Err(invalid(
            "instruction identity or account count is not canonical",
        ));
    }
    let raw_data = BASE64
        .decode(&manifest.data_base64)
        .map_err(|_| invalid("instruction data is not canonical base64"))?;
    if BASE64.encode(&raw_data) != manifest.data_base64 {
        return Err(invalid("instruction data is not the exact tag-254 payload"));
    }
    let raw_metas = manifest
        .accounts
        .iter()
        .map(|meta| {
            Ok(AccountMeta {
                pubkey: canonical_pubkey(&meta.address)?,
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
        })
        .collect::<Result<Vec<_>, CollectiveSwapOperationError>>()?;
    let raw_instruction = Instruction {
        program_id: CURRENT_PROGRAM_ID,
        accounts: raw_metas,
        data: raw_data,
    };
    let business = if let Some(context) = context {
        crate::governed_operation::inspect_current_governed_instruction_v1(
            context,
            &raw_instruction,
        )
        .map_err(|_| invalid("swap governance envelope is invalid"))?
        .business_instruction
    } else {
        raw_instruction.clone()
    };
    let data = &business.data;
    if data.len() != 28 || data[0] != COLLECTIVE_SWAP_EXACT_IN_TAG {
        return Err(invalid("instruction data is not the exact tag-254 payload"));
    }
    let direction_byte = match plan.semantic.direction {
        CollectiveSwapDirection::QuoteForOption => 0,
        CollectiveSwapDirection::OptionForQuote => 1,
    };
    if data[1] != direction_byte
        || u64::from_le_bytes(data[2..10].try_into().expect("exact data length")) != amount_in
        || u64::from_le_bytes(data[10..18].try_into().expect("exact data length"))
            != minimum_amount_out
        || u16::from_le_bytes(data[18..20].try_into().expect("exact data length"))
            != plan.semantic.limit_bin_id
        || u64::from_le_bytes(data[20..28].try_into().expect("exact data length")) != deadline_ts
    {
        return Err(invalid(
            "instruction payload differs from admitted semantics",
        ));
    }

    let metas = &business.accounts;
    let mut flags = vec![
        (true, true),
        (false, false),
        (false, false),
        (false, false),
        (false, false),
        (false, false),
        (false, false),
        (false, true),
        (false, false),
        (false, false),
        (false, false),
        (false, true),
        (false, true),
        (false, true),
        (false, true),
        (false, false),
        (false, false),
        (false, true),
        (false, true),
        (false, false),
        (false, false),
        (false, false),
        (false, true),
    ];
    if context.is_some() {
        for index in [2, 4, 6, 9] { flags[index] = (false, true); }
        flags.extend([(false, false), (false, true), (false, false), (false, true),
            (false, true), (false, true), (false, true), (false, false), (false, true)]);
    }
    if metas.iter().enumerate().any(|(index, meta)| {
        let expected = flags.get(index).copied().unwrap_or((false, true));
        (meta.is_signer, meta.is_writable) != expected
    }) {
        return Err(invalid("instruction account flags are not canonical"));
    }
    let expected_fixed = [
        trader,
        derive_vault_config_pda(&CURRENT_PROGRAM_ID).0,
        market,
        oracle_month,
        sleeve,
        group,
        book,
        pool,
        derive_ameba_dlmm_authority_pda(&CURRENT_PROGRAM_ID, &pool).0,
        option_mint,
        quote_mint,
        derive_ameba_dlmm_vault_pda(&CURRENT_PROGRAM_ID, &pool, &option_mint).0,
        derive_ameba_dlmm_vault_pda(&CURRENT_PROGRAM_ID, &pool, &quote_mint).0,
    ];
    if expected_fixed
        .iter()
        .enumerate()
        .any(|(index, expected)| metas[index].pubkey != *expected)
        || metas[13].pubkey == Pubkey::default()
        || metas[14].pubkey == Pubkey::default()
        || metas[15].pubkey != CURRENT_LIGHT_TOKEN_PROGRAM_ID
        || metas[16].pubkey != CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
        || metas[17].pubkey != derive_light_spl_interface_pda(&option_mint).0
        || metas[18].pubkey != derive_light_spl_interface_pda(&quote_mint).0
        || metas[19].pubkey != CURRENT_SPL_TOKEN_PROGRAM_ID
        || metas[20].pubkey != CURRENT_SYSTEM_PROGRAM_ID
        || metas[21].pubkey != LIGHT_TOKEN_COMPRESSIBLE_CONFIG
        || metas[22].pubkey != LIGHT_TOKEN_RENT_SPONSOR
    {
        return Err(invalid(
            "instruction fixed account identities are not canonical",
        ));
    }
    if context.is_some() {
        use crate::writer_sleeve::*;
        let registry = derive_writer_policy_registry_pda(&CURRENT_PROGRAM_ID).0;
        if metas[23].pubkey != ameba_spread_program::scoped_settlement::derive_collective_settlement_delegate(&CURRENT_PROGRAM_ID, &trader, &option_mint).0
            || metas[24].pubkey != crate::writer_dlmm::derive_writer_dlmm_policy_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            || metas[26].pubkey != crate::writer_dlmm::derive_writer_dlmm_position_pda(&CURRENT_PROGRAM_ID, &pool, &sleeve).0
            || metas[27].pubkey != derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            || metas[28].pubkey != crate::protocol::derive_contract_mint_staging_pda(&CURRENT_PROGRAM_ID, &market).0
            || metas[29].pubkey != derive_writer_retirement_custody_pda(&CURRENT_PROGRAM_ID, &sleeve, &market).0
            || metas[30].pubkey != registry || metas[31].pubkey != derive_writer_protocol_fee_vault_pda(&CURRENT_PROGRAM_ID, &registry).0 {
            return Err(invalid("writer swap custody identities are not canonical"));
        }
    }
    for (offset, page_index) in plan.semantic.reserve_page_indices.iter().enumerate() {
        if metas[(if context.is_some() { 32 } else { 23 }) + offset].pubkey
            != derive_ameba_dlmm_bin_page_pda(&CURRENT_PROGRAM_ID, &pool, *page_index).0
        {
            return Err(invalid("instruction reserve-page PDA is not canonical"));
        }
    }
    require_observed_state_binding(&plan.current_observation, metas, context.is_some())?;

    let mut expected_write_set = metas
        .iter()
        .filter(|meta| meta.is_writable)
        .map(|meta| meta.pubkey.to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    expected_write_set.sort();
    if plan.write_set != expected_write_set
        || plan.signer_roles.len() != 1
        || plan.signer_roles[0].pubkey != trader.to_string()
        || plan.signer_roles[0].role != "trader"
        || plan.signer_roles[0].instruction_indexes
            != [usize::from(plan.compute_unit_limit.is_some())]
    {
        return Err(invalid("write set or signer coverage is not exact"));
    }

    if plan
        .compute_unit_limit
        .is_some_and(|limit| limit != COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT)
    {
        return Err(invalid("swap compute limit is not canonical"));
    }
    let mut operation_commitment = json!({
        "domain": "ameba:collective_swap_operation_id:v1",
        "operation": COLLECTIVE_SWAP_OPERATION,
        "currentObservationDigest": plan.current_observation_digest,
        "leanAdmissionDigest": plan.lean_admission_digest,
        "semantic": plan.semantic,
        "instruction": plan.instruction,
        "writeSet": plan.write_set,
        "signerRoles": plan.signer_roles,
    });
    if let Some(limit) = plan.compute_unit_limit {
        operation_commitment["computeUnitLimit"] = json!(limit);
    }
    if let Some(witness) = &plan.transaction_lookup_table {
        if context.is_none() { return Err(invalid("historical swap cannot use a current lookup table")); }
        crate::collective_lookup_table::decode_current_collective_lookup_table_v1(witness, &plan.current_observation)
            .map_err(|_| invalid("swap lookup table observation is invalid"))?;
        operation_commitment["transactionLookupTable"] = json!(witness);
    }
    let operation_id = digest_canonical(&operation_commitment)?;
    let mut without_digest =
        serde_json::to_value(&plan).map_err(|_| invalid("plan cannot be canonicalized"))?;
    without_digest
        .as_object_mut()
        .expect("serialized struct is object")
        .remove("preparedPlanDigest");
    let prepared_plan_digest = digest_canonical(&json!({
        "domain": "ameba:collective_swap_prepared_plan:v1",
        "plan": without_digest,
    }))?;
    if plan.operation_id != operation_id || plan.prepared_plan_digest != prepared_plan_digest {
        return Err(invalid(
            "operation or prepared-plan commitment does not match",
        ));
    }

    let mut execution_instructions = Vec::new();
    if let Some(limit) = plan.compute_unit_limit {
        let mut data = vec![2];
        data.extend_from_slice(&limit.to_le_bytes());
        execution_instructions.push(Instruction {
            program_id: solana_sdk_ids::compute_budget::id(),
            accounts: vec![],
            data,
        });
    }
    execution_instructions.push(raw_instruction.clone());
    Ok(ValidatedCollectiveSwapOperation {
        instruction: raw_instruction,
        execution_instructions,
        plan,
    })
}

pub fn parse_current_governed_collective_swap_operation_json_v1(
    context: &crate::governed_operation::CurrentGovernedWriteContextV1,
    encoded: &str,
) -> Result<crate::governed_operation::CurrentGovernedOperationV1, CollectiveSwapOperationError> {
    let plan = serde_json::from_str(encoded).map_err(|error: serde_json::Error| {
        CollectiveSwapOperationError::InvalidJson(error.to_string())
    })?;
    let validated = validate_collective_swap_operation_inner(plan, Some(context))?;
    crate::governed_operation::CurrentGovernedOperationV1::swap(context, validated)
        .map_err(|_| invalid("swap finalized context or transaction privilege closure is invalid"))
}

fn require_observed_state_binding(
    observation: &CurrentFinalizedObservation,
    metas: &[AccountMeta],
    current: bool,
) -> Result<(), CollectiveSwapOperationError> {
    let observed = observation
        .ordered_accounts
        .iter()
        .map(|account| (account.address.as_str(), account))
        .collect::<HashMap<_, _>>();
    let mut required_indexes = vec![1, 2, 3, 5, 4, 6, 7, 9, 10, 11, 12, 13, 14, 17, 18, 22];
    required_indexes.extend((if current { 32 } else { 23 })..metas.len());
    if current { required_indexes.extend([25, 27, 30, 31]); }
    for index in required_indexes {
        let account = observed
            .get(metas[index].pubkey.to_string().as_str())
            .copied()
            .ok_or_else(|| invalid("finalized observation omits a swap state account"))?;
        if account.owner.is_none()
            || account.executable.is_none()
            || account.data_length.is_none()
            || account.data_sha256.is_none()
        {
            return Err(invalid("finalized observation has incomplete swap state"));
        }
    }
    let mut program_owned_indexes = vec![1, 2, 3, 4, 5, 6, 7];
    program_owned_indexes.extend((if current { 32 } else { 23 })..metas.len());
    if current { program_owned_indexes.extend([25, 30]); }
    for index in program_owned_indexes {
        let address = metas[index].pubkey.to_string();
        let account = observed
            .get(address.as_str())
            .copied()
            .ok_or_else(|| invalid("finalized observation omits a program state account"))?;
        if account.owner.as_deref() != Some(CURRENT_PROGRAM_ID.to_string().as_str())
            || account.executable != Some(false)
        {
            return Err(invalid(
                "finalized observation has a noncanonical program owner",
            ));
        }
    }
    if current {
        for index in [23, 24, 26, 28, 29] {
            let address = metas[index].pubkey.to_string();
            let account = observed.get(address.as_str()).ok_or_else(|| invalid("swap omits optional account observation"))?;
            let absent = account.owner.is_none() && account.executable.is_none() && account.data_length.is_none() && account.data_sha256.is_none();
            let empty = account.owner.as_deref() == Some(CURRENT_SYSTEM_PROGRAM_ID.to_string().as_str())
                && account.executable == Some(false) && account.data_length.as_deref() == Some("0");
            let present = account.executable == Some(false) && account.data_length.is_some() && account.data_sha256.is_some()
                && account.owner.as_deref() == Some(if index >= 28 { CURRENT_SPL_TOKEN_PROGRAM_ID } else { CURRENT_PROGRAM_ID }.to_string().as_str());
            if !absent && !empty && !present { return Err(invalid("swap optional account owner is invalid")); }
        }
    }
    Ok(())
}

/// Bind user-controlled semantic fields to the already strict portable plan.
pub fn require_expected_collective_swap_request(
    validated: &ValidatedCollectiveSwapOperation,
    expected: &ExpectedCollectiveSwapRequest,
) -> Result<(), CollectiveSwapOperationError> {
    let semantic = &validated.plan.semantic;
    if canonical_pubkey(&semantic.trader)? != expected.trader
        || canonical_pubkey(&semantic.market)? != expected.market
        || semantic.direction != expected.direction
        || positive_u64(&semantic.amount_in)? != expected.amount_in
        || positive_u64(&semantic.minimum_amount_out)? != expected.minimum_amount_out
        || semantic.limit_bin_id != expected.limit_bin_id
    {
        return Err(invalid("plan differs from the explicit user request"));
    }
    Ok(())
}

fn canonical_pubkey(value: &str) -> Result<Pubkey, CollectiveSwapOperationError> {
    let key = Pubkey::from_str(value).map_err(|_| invalid("public key is invalid"))?;
    if key.to_string() != value {
        return Err(invalid("public key is not canonical base58"));
    }
    Ok(key)
}

fn positive_u64(value: &str) -> Result<u64, CollectiveSwapOperationError> {
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(invalid(
            "amount or deadline is not a canonical positive u64",
        ));
    }
    value
        .parse()
        .map_err(|_| invalid("amount or deadline exceeds u64"))
}

fn lowercase_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn digest_canonical(value: &Value) -> Result<String, CollectiveSwapOperationError> {
    let sorted = canonical_value(value);
    let encoded =
        serde_json::to_vec(&sorted).map_err(|_| invalid("plan cannot be canonicalized"))?;
    let bytes = hash(&encoded).to_bytes();
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical_value).collect()),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical_value(&object[key]));
            }
            Value::Object(sorted)
        }
        other => other.clone(),
    }
}

fn invalid(message: &'static str) -> CollectiveSwapOperationError {
    CollectiveSwapOperationError::InvalidPlan(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: u8) -> Pubkey {
        Pubkey::new_from_array([seed; 32])
    }

    fn manifest_meta(
        pubkey: Pubkey,
        is_signer: bool,
        is_writable: bool,
    ) -> CollectiveSwapInstructionAccountMeta {
        CollectiveSwapInstructionAccountMeta {
            address: pubkey.to_string(),
            is_signer,
            is_writable,
        }
    }

    fn refresh_commitments(plan: &mut CollectiveSwapOperationPlan) {
        let mut operation_commitment = json!({
            "domain": "ameba:collective_swap_operation_id:v1",
            "operation": COLLECTIVE_SWAP_OPERATION,
            "currentObservationDigest": plan.current_observation_digest,
            "leanAdmissionDigest": plan.lean_admission_digest,
            "semantic": plan.semantic,
            "instruction": plan.instruction,
            "writeSet": plan.write_set,
            "signerRoles": plan.signer_roles,
        });
        if let Some(limit) = plan.compute_unit_limit {
            operation_commitment["computeUnitLimit"] = json!(limit);
        }
        plan.operation_id = digest_canonical(&operation_commitment).unwrap();
        let mut without_digest = serde_json::to_value(&*plan).unwrap();
        without_digest
            .as_object_mut()
            .unwrap()
            .remove("preparedPlanDigest");
        plan.prepared_plan_digest = digest_canonical(&json!({
            "domain": "ameba:collective_swap_prepared_plan:v1",
            "plan": without_digest,
        }))
        .unwrap();
    }

    fn plan() -> CollectiveSwapOperationPlan {
        let fixture: Value =
            serde_json::from_str(crate::CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_JSON).unwrap();
        let mut observation: CurrentFinalizedObservation =
            serde_json::from_value(fixture["observation"].clone()).unwrap();
        validate_current_finalized_observation(&observation).unwrap();
        let trader = key(1);
        let market = key(2);
        let oracle_month = key(3);
        let group = key(4);
        let sleeve = derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &group).0;
        let book = derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0;
        let pool = derive_ameba_dlmm_pool_pda(&CURRENT_PROGRAM_ID, &market).0;
        let option_mint = key(5);
        let quote_mint = key(6);
        let page = derive_ameba_dlmm_bin_page_pda(&CURRENT_PROGRAM_ID, &pool, 0).0;
        let mut data = vec![COLLECTIVE_SWAP_EXACT_IN_TAG, 0];
        data.extend_from_slice(&1_000_000_u64.to_le_bytes());
        data.extend_from_slice(&900_000_u64.to_le_bytes());
        data.extend_from_slice(&0_u16.to_le_bytes());
        data.extend_from_slice(&1_787_529_720_u64.to_le_bytes());
        let metas = vec![
            manifest_meta(trader, true, true),
            manifest_meta(derive_vault_config_pda(&CURRENT_PROGRAM_ID).0, false, false),
            manifest_meta(market, false, false),
            manifest_meta(oracle_month, false, false),
            manifest_meta(sleeve, false, false),
            manifest_meta(group, false, false),
            manifest_meta(book, false, false),
            manifest_meta(pool, false, true),
            manifest_meta(
                derive_ameba_dlmm_authority_pda(&CURRENT_PROGRAM_ID, &pool).0,
                false,
                false,
            ),
            manifest_meta(option_mint, false, false),
            manifest_meta(quote_mint, false, false),
            manifest_meta(
                derive_ameba_dlmm_vault_pda(&CURRENT_PROGRAM_ID, &pool, &option_mint).0,
                false,
                true,
            ),
            manifest_meta(
                derive_ameba_dlmm_vault_pda(&CURRENT_PROGRAM_ID, &pool, &quote_mint).0,
                false,
                true,
            ),
            manifest_meta(key(7), false, true),
            manifest_meta(key(8), false, true),
            manifest_meta(CURRENT_LIGHT_TOKEN_PROGRAM_ID, false, false),
            manifest_meta(CURRENT_LIGHT_TOKEN_CPI_AUTHORITY, false, false),
            manifest_meta(derive_light_spl_interface_pda(&option_mint).0, false, true),
            manifest_meta(derive_light_spl_interface_pda(&quote_mint).0, false, true),
            manifest_meta(CURRENT_SPL_TOKEN_PROGRAM_ID, false, false),
            manifest_meta(CURRENT_SYSTEM_PROGRAM_ID, false, false),
            manifest_meta(LIGHT_TOKEN_COMPRESSIBLE_CONFIG, false, false),
            manifest_meta(LIGHT_TOKEN_RENT_SPONSOR, false, true),
            manifest_meta(page, false, true),
        ];
        let mut write_set = metas
            .iter()
            .filter(|meta| meta.is_writable)
            .map(|meta| meta.address.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        write_set.sort();
        let program_owned = [1_usize, 2, 3, 4, 5, 6, 7, 23]
            .into_iter()
            .collect::<HashSet<_>>();
        let required = [
            1_usize, 2, 3, 5, 4, 6, 7, 9, 10, 11, 12, 13, 14, 17, 18, 22, 23,
        ];
        observation.ordered_accounts = required
            .into_iter()
            .enumerate()
            .map(|(position, index)| crate::CurrentFinalizedObservedAccount {
                address: metas[index].address.clone(),
                owner: Some(if program_owned.contains(&index) {
                    CURRENT_PROGRAM_ID.to_string()
                } else {
                    key(30).to_string()
                }),
                executable: Some(false),
                data_length: Some("1".to_owned()),
                data_sha256: Some(format!("{position:064x}")),
            })
            .collect();
        observation.current_observation_digest =
            crate::compute_current_finalized_observation_digest(&observation).unwrap();
        let mut plan = CollectiveSwapOperationPlan {
            schema_version: 1,
            operation: COLLECTIVE_SWAP_OPERATION.to_owned(),
            operation_id: String::new(),
            current_observation_digest: observation.current_observation_digest.clone(),
            current_observation: observation,
            lean_admission_digest: "a".repeat(64),
            semantic: CollectiveSwapSemanticInput {
                trader: trader.to_string(),
                market: market.to_string(),
                oracle_month: oracle_month.to_string(),
                writer_settlement_group: group.to_string(),
                writer_sleeve: sleeve.to_string(),
                writer_series_book: book.to_string(),
                pool: pool.to_string(),
                option_mint: option_mint.to_string(),
                quote_mint: quote_mint.to_string(),
                direction: CollectiveSwapDirection::QuoteForOption,
                amount_in: "1000000".to_owned(),
                minimum_amount_out: "900000".to_owned(),
                limit_bin_id: 0,
                deadline_ts: "1787529720".to_owned(),
                reserve_page_indices: vec![0],
            },
            instruction: CollectiveSwapInstructionManifest {
                program_id: CURRENT_PROGRAM_ID.to_string(),
                instruction_name: "SwapCollectiveDlmmExactInV1".to_owned(),
                instruction_tag: COLLECTIVE_SWAP_EXACT_IN_TAG,
                data_base64: BASE64.encode(data),
                accounts: metas,
            },
            write_set,
            signer_roles: vec![CollectiveSwapSignerRole {
                pubkey: trader.to_string(),
                role: "trader".to_owned(),
                instruction_indexes: vec![0],
            }],
            prepared_plan_digest: String::new(),
            compute_unit_limit: None,
            transaction_lookup_table: None,
        };
        refresh_commitments(&mut plan);
        plan
    }

    #[test]
    fn strict_portable_plan_accepts_bin_zero_and_explicit_request() {
        let plan = plan();
        let encoded = serde_json::to_string(&plan).unwrap();
        assert!(matches!(
            parse_collective_swap_operation_json(&encoded),
            Err(CollectiveSwapOperationError::InvalidPlan(
                "historical swap plans are offline-only"
            ))
        ));
        let validated = validate_collective_swap_operation_inner(plan.clone(), None).unwrap();
        assert_eq!(validated.instruction.data[0], 254);
        require_expected_collective_swap_request(
            &validated,
            &ExpectedCollectiveSwapRequest {
                trader: canonical_pubkey(&plan.semantic.trader).unwrap(),
                market: canonical_pubkey(&plan.semantic.market).unwrap(),
                direction: CollectiveSwapDirection::QuoteForOption,
                amount_in: 1_000_000,
                minimum_amount_out: 900_000,
                limit_bin_id: 0,
            },
        )
        .unwrap();
    }

    #[test]
    fn current_governed_swap_preserves_exact_plan_and_rejects_rehashed_envelope_tampering() {
        let fixture = crate::governed_operation::tests::Fixture::new();
        let context = crate::observe_current_governed_write_context_v1(
            &fixture.release,
            fixture.observation(1_000_000_000),
            101,
        )
        .unwrap();
        let mut draft = plan();
        let mut data = BASE64.decode(&draft.instruction.data_base64).unwrap();
        data.extend_from_slice(&crate::encode_governance_instruction_tail_v1(
            context.epoch(),
        ));
        draft.instruction.data_base64 = BASE64.encode(data);
        draft.instruction.accounts.push(manifest_meta(
            context.release().gate_address(),
            false,
            false,
        ));
        refresh_commitments(&mut draft);
        let encoded = serde_json::to_string(&draft).unwrap();
        let admitted =
            parse_current_governed_collective_swap_operation_json_v1(&context, &encoded).unwrap();
        assert_eq!(admitted.swap_operation().unwrap().plan, draft);
        assert!(parse_collective_swap_operation_json(&encoded).is_err());
        let mut budgeted = draft.clone();
        budgeted.compute_unit_limit = Some(COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT);
        budgeted.signer_roles[0].instruction_indexes = vec![1];
        refresh_commitments(&mut budgeted);
        let admitted_budgeted = parse_current_governed_collective_swap_operation_json_v1(
            &context,
            &serde_json::to_string(&budgeted).unwrap(),
        )
        .unwrap();
        let execution = &admitted_budgeted
            .swap_operation()
            .unwrap()
            .execution_instructions;
        assert_eq!(execution.len(), 2);
        assert_eq!(
            execution[0].program_id,
            solana_sdk_ids::compute_budget::id()
        );
        assert!(execution[0].accounts.is_empty());
        assert_eq!(BASE64.encode(&execution[0].data), "AkBCDwA=");
        assert_eq!(execution[1], admitted.swap_operation().unwrap().instruction);
        for change in 0..3 {
            let mut altered = budgeted.clone();
            match change {
                0 => altered.compute_unit_limit = Some(999_999),
                1 => altered.signer_roles[0].instruction_indexes = vec![0],
                2 => altered.compute_unit_limit = None,
                _ => unreachable!(),
            }
            refresh_commitments(&mut altered);
            assert!(
                parse_current_governed_collective_swap_operation_json_v1(
                    &context,
                    &serde_json::to_string(&altered).unwrap(),
                )
                .is_err()
            );
        }
        for change in 0..6 {
            let mut altered = draft.clone();
            match change {
                0 => altered.instruction.accounts.last_mut().unwrap().is_writable = true,
                1 => altered.instruction.accounts.last_mut().unwrap().is_signer = true,
                2 => {
                    altered.instruction.accounts.pop();
                }
                3 => altered.semantic.minimum_amount_out = "1".to_owned(),
                4 => {
                    let mut data = BASE64.decode(&altered.instruction.data_base64).unwrap();
                    *data.last_mut().unwrap() ^= 1;
                    altered.instruction.data_base64 = BASE64.encode(data);
                }
                5 => altered.instruction.accounts[11].address = key(99).to_string(),
                _ => unreachable!(),
            }
            refresh_commitments(&mut altered);
            assert!(
                parse_current_governed_collective_swap_operation_json_v1(
                    &context,
                    &serde_json::to_string(&altered).unwrap()
                )
                .is_err(),
                "change {change}"
            );
        }
    }

    #[test]
    fn strict_portable_plan_rejects_rehashed_fixed_meta_and_request_substitution() {
        let mut forged = plan();
        forged.instruction.accounts[11].address = key(99).to_string();
        refresh_commitments(&mut forged);
        assert!(matches!(
            validate_collective_swap_operation_inner(forged, None),
            Err(CollectiveSwapOperationError::InvalidPlan(
                "instruction fixed account identities are not canonical"
            ))
        ));

        let validated = validate_collective_swap_operation_inner(plan(), None).unwrap();
        let mut expected = ExpectedCollectiveSwapRequest {
            trader: canonical_pubkey(&validated.plan.semantic.trader).unwrap(),
            market: canonical_pubkey(&validated.plan.semantic.market).unwrap(),
            direction: CollectiveSwapDirection::QuoteForOption,
            amount_in: 1_000_000,
            minimum_amount_out: 900_000,
            limit_bin_id: 0,
        };
        expected.limit_bin_id = 1;
        assert!(require_expected_collective_swap_request(&validated, &expected).is_err());
    }

    #[test]
    fn strict_portable_plan_rejects_unbound_observation_and_replayable_deadline() {
        let mut missing = plan();
        missing.current_observation.ordered_accounts.remove(0);
        missing.current_observation.current_observation_digest =
            crate::compute_current_finalized_observation_digest(&missing.current_observation)
                .unwrap();
        missing.current_observation_digest = missing
            .current_observation
            .current_observation_digest
            .clone();
        refresh_commitments(&mut missing);
        assert!(matches!(
            validate_collective_swap_operation_inner(missing, None),
            Err(CollectiveSwapOperationError::InvalidPlan(
                "finalized observation omits a swap state account"
            ))
        ));

        for deadline in [1_787_529_719_u64, 1_787_539_720_u64] {
            let mut replayable = plan();
            replayable.semantic.deadline_ts = deadline.to_string();
            let mut data = BASE64.decode(&replayable.instruction.data_base64).unwrap();
            data[20..28].copy_from_slice(&deadline.to_le_bytes());
            replayable.instruction.data_base64 = BASE64.encode(data);
            refresh_commitments(&mut replayable);
            assert!(matches!(
                validate_collective_swap_operation_inner(replayable, None),
                Err(CollectiveSwapOperationError::InvalidPlan(
                    "deadline is not finalized block time plus 120 seconds"
                ))
            ));
        }
    }
}
