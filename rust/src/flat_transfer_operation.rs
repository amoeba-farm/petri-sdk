//! Exact Light Token transfer policy for collective-sleeve Flat custody.
//!
//! Writer deposits use classic SPL only as staging; holder Flat custody is the
//! Light associated-token account. This validator therefore admits only an
//! official Light ATA creation (when truly absent) followed by Light
//! TransferChecked. A cold source or destination is admitted only when an
//! independently reconstructed payer-bound load shares the final transaction
//! batch with the transfer; earlier load batches are never allowed to detach
//! the main action from its fresh proof.

use std::str::FromStr;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use solana_program::program_option::COption;
use solana_program::{
    hash::hash,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
};
use spl_token::state::{Account as TokenAccount, AccountState, Mint};
use thiserror::Error;

use crate::{
    ID as CURRENT_PROGRAM_ID,
    current_finalized_observation::{
        CurrentFinalizedObservation, CurrentFinalizedObservedAccount,
        validate_current_finalized_observation,
    },
    protocol::CURRENT_SPL_TOKEN_PROGRAM_ID,
    writer_sleeve::derive_writer_flat_mint_pda,
};

pub const FLAT_TRANSFER_OPERATION_SCHEMA_VERSION: u8 = 1;
pub const FLAT_TRANSFER_OPERATION: &str = "transfer_flat";

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FlatTransferOperationError {
    #[error("Flat transfer operation JSON is invalid: {0}")]
    InvalidJson(String),
    #[error("Flat transfer operation plan is invalid: {0}")]
    InvalidPlan(&'static str),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferSemantic {
    pub owner: String,
    pub sleeve: String,
    pub destination_owner: String,
    pub amount_atoms: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferObservedBytes {
    pub mint_data_base64: String,
    pub source_light_data_base64: Option<String>,
    pub destination_light_data_base64: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FlatTransferSourceState {
    Hot,
    Cold,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FlatTransferDestinationState {
    Hot,
    Cold,
    Absent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferColdAccountProofFacts {
    pub ata: String,
    pub owner: String,
    pub mint: String,
    pub amount_atoms: String,
    pub includes_cold_balance: bool,
    pub provider_origin_sha256: String,
    pub payer: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferAccountMeta {
    pub address: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferInstructionManifest {
    pub program_id: String,
    pub instruction_name: String,
    pub data_base64: String,
    pub accounts: Vec<FlatTransferAccountMeta>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferSignerRole {
    pub pubkey: String,
    pub role: String,
    pub instruction_indexes: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferSetupSignerRole {
    pub pubkey: String,
    pub role: String,
    pub setup_batch_index: usize,
    pub instruction_indexes: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlatTransferOperationPlan {
    pub schema_version: u8,
    pub operation: String,
    pub operation_id: String,
    pub current_observation: CurrentFinalizedObservation,
    pub current_observation_digest: String,
    pub semantic: FlatTransferSemantic,
    pub source_state: FlatTransferSourceState,
    pub destination_state: FlatTransferDestinationState,
    pub source_proof_facts: Option<FlatTransferColdAccountProofFacts>,
    pub destination_proof_facts: Option<FlatTransferColdAccountProofFacts>,
    pub observed_bytes: FlatTransferObservedBytes,
    pub setup_instruction_batches: Vec<Vec<FlatTransferInstructionManifest>>,
    pub setup_signer_roles: Vec<FlatTransferSetupSignerRole>,
    pub instructions: Vec<FlatTransferInstructionManifest>,
    pub execution_instruction_batches: Vec<Vec<FlatTransferInstructionManifest>>,
    pub action_batch_index: usize,
    pub write_set: Vec<String>,
    pub signer_roles: Vec<FlatTransferSignerRole>,
    pub prepared_plan_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedFlatTransferOperation {
    pub plan: FlatTransferOperationPlan,
    pub setup_instruction_batches: Vec<Vec<Instruction>>,
    pub instructions: Vec<Instruction>,
    pub execution_instruction_batches: Vec<Vec<Instruction>>,
}

pub fn parse_flat_transfer_operation_json(
    encoded: &str,
) -> Result<ValidatedFlatTransferOperation, FlatTransferOperationError> {
    parse_flat_transfer_operation_json_with_setup(encoded, &[])
}

/// Parse a cold-capable plan and require exact equality with independently
/// rebuilt official Light load instructions before admitting it for signing.
pub fn parse_flat_transfer_operation_json_with_setup(
    encoded: &str,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<ValidatedFlatTransferOperation, FlatTransferOperationError> {
    let plan: FlatTransferOperationPlan = serde_json::from_str(encoded)
        .map_err(|error| FlatTransferOperationError::InvalidJson(error.to_string()))?;
    validate_flat_transfer_operation_with_setup(plan, independently_rebuilt_setup)
}

pub fn validate_flat_transfer_operation(
    plan: FlatTransferOperationPlan,
) -> Result<ValidatedFlatTransferOperation, FlatTransferOperationError> {
    validate_flat_transfer_operation_with_setup(plan, &[])
}

pub fn validate_flat_transfer_operation_with_setup(
    plan: FlatTransferOperationPlan,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<ValidatedFlatTransferOperation, FlatTransferOperationError> {
    crate::governed_operation::require_historical_operation_mode_v1()
        .map_err(|_| invalid("historical Flat plans are offline-only"))?;
    validate_flat_transfer_operation_with_setup_inner(plan, independently_rebuilt_setup)
}

pub fn parse_current_governed_flat_transfer_operation_json_v1(
    context: &crate::governed_operation::CurrentGovernedWriteContextV1,
    encoded: &str,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<crate::governed_operation::CurrentGovernedOperationV1, FlatTransferOperationError> {
    let plan = serde_json::from_str(encoded).map_err(|error: serde_json::Error| {
        FlatTransferOperationError::InvalidJson(error.to_string())
    })?;
    let validated =
        validate_flat_transfer_operation_with_setup_inner(plan, independently_rebuilt_setup)?;
    crate::governed_operation::CurrentGovernedOperationV1::flat(context, validated)
        .map_err(|_| invalid("Flat finalized context or transaction privilege closure is invalid"))
}

fn validate_flat_transfer_operation_with_setup_inner(
    plan: FlatTransferOperationPlan,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<ValidatedFlatTransferOperation, FlatTransferOperationError> {
    if plan.schema_version != FLAT_TRANSFER_OPERATION_SCHEMA_VERSION
        || plan.operation != FLAT_TRANSFER_OPERATION
        || plan.current_observation_digest != plan.current_observation.current_observation_digest
        || !lowercase_sha256(&plan.operation_id)
        || !lowercase_sha256(&plan.prepared_plan_digest)
    {
        return Err(invalid(
            "schema, operation, observation, or digest is not canonical",
        ));
    }
    validate_current_finalized_observation(&plan.current_observation)
        .map_err(|_| invalid("current finalized observation is invalid"))?;

    let owner = canonical_pubkey(&plan.semantic.owner)?;
    let sleeve = canonical_pubkey(&plan.semantic.sleeve)?;
    let destination_owner = canonical_pubkey(&plan.semantic.destination_owner)?;
    let amount = positive_u64(&plan.semantic.amount_atoms)?;
    let flat_mint = derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0;
    let source = light_token::instruction::derive_associated_token_account(&owner, &flat_mint);
    let destination =
        light_token::instruction::derive_associated_token_account(&destination_owner, &flat_mint);
    let light_program = Pubkey::from(light_token::LIGHT_TOKEN_PROGRAM_ID);

    let mint_data = canonical_base64(&plan.observed_bytes.mint_data_base64)?;
    require_observed_bytes(
        &plan.current_observation,
        flat_mint,
        CURRENT_SPL_TOKEN_PROGRAM_ID,
        &mint_data,
    )?;
    let mint = unpack_flat_mint(&mint_data)?;

    let mut setup_instruction_batches = Vec::new();
    match plan.source_state {
        FlatTransferSourceState::Hot => {
            if plan.source_proof_facts.is_some() {
                return Err(invalid("hot Flat source cannot carry a cold proof"));
            }
            let source_data = canonical_base64(
                plan.observed_bytes
                    .source_light_data_base64
                    .as_deref()
                    .ok_or_else(|| invalid("hot source Light bytes are missing"))?,
            )?;
            require_observed_bytes(
                &plan.current_observation,
                source,
                light_program,
                &source_data,
            )?;
            let decoded_source = unpack_light_token_account(&source_data)?;
            if !canonical_transferable_light_account(&decoded_source)
                || decoded_source.mint != flat_mint
                || decoded_source.owner != owner
                || decoded_source.amount < amount
            {
                return Err(invalid("Flat mint or source Light account is invalid"));
            }
        }
        FlatTransferSourceState::Cold => {
            if plan.destination_state == FlatTransferDestinationState::Cold {
                return Err(invalid(
                    "two cold Flat accounts require sequential fresh preparation",
                ));
            }
            if plan.observed_bytes.source_light_data_base64.is_some()
                || !account_absent(observed(&plan.current_observation, source)?)
            {
                return Err(invalid(
                    "cold Flat source is not explicitly absent from hot state",
                ));
            }
            let proof = plan
                .source_proof_facts
                .as_ref()
                .ok_or_else(|| invalid("cold Flat source proof facts are missing"))?;
            setup_instruction_batches = validate_cold_setup(
                &plan,
                proof,
                source,
                owner,
                flat_mint,
                owner,
                amount,
                independently_rebuilt_setup,
            )?;
        }
    }

    let destination_observation = observed(&plan.current_observation, destination)?;
    match plan.destination_state {
        FlatTransferDestinationState::Hot => {
            if plan.destination_proof_facts.is_some() || destination_observation.owner.is_none() {
                return Err(invalid("hot destination state or proof is invalid"));
            }
            let encoded = plan
                .observed_bytes
                .destination_light_data_base64
                .as_deref()
                .ok_or_else(|| invalid("destination Light bytes are missing"))?;
            let destination_data = canonical_base64(encoded)?;
            require_observed_bytes(
                &plan.current_observation,
                destination,
                light_program,
                &destination_data,
            )?;
            let destination_account = unpack_light_token_account(&destination_data)?;
            if !canonical_transferable_light_account(&destination_account)
                || destination_account.mint != flat_mint
                || destination_account.owner != destination_owner
            {
                return Err(invalid("destination Light account is invalid"));
            }
        }
        FlatTransferDestinationState::Absent => {
            if plan.destination_proof_facts.is_some()
                || plan.observed_bytes.destination_light_data_base64.is_some()
                || !account_absent(destination_observation)
            {
                return Err(invalid(
                    "absent destination Light account is not represented canonically",
                ));
            }
        }
        FlatTransferDestinationState::Cold => {
            if plan.source_state == FlatTransferSourceState::Cold
                || plan.observed_bytes.destination_light_data_base64.is_some()
                || !account_absent(destination_observation)
            {
                return Err(invalid("cold destination hot-state evidence is invalid"));
            }
            let proof = plan
                .destination_proof_facts
                .as_ref()
                .ok_or_else(|| invalid("cold destination proof facts are missing"))?;
            setup_instruction_batches = validate_cold_setup(
                &plan,
                proof,
                destination,
                destination_owner,
                flat_mint,
                owner,
                0,
                independently_rebuilt_setup,
            )?;
        }
    }
    if plan.source_state == FlatTransferSourceState::Hot
        && plan.destination_state != FlatTransferDestinationState::Cold
        && (!plan.setup_instruction_batches.is_empty()
            || !plan.setup_signer_roles.is_empty()
            || !independently_rebuilt_setup.is_empty())
    {
        return Err(invalid("hot Flat transfer cannot carry cold setup"));
    }

    let mut expected = Vec::new();
    if plan.destination_state == FlatTransferDestinationState::Absent {
        expected.push(
            light_token::instruction::CreateAssociatedTokenAccount::new(
                owner,
                destination_owner,
                flat_mint,
            )
            .idempotent()
            .instruction()
            .map_err(|_| invalid("Light ATA creation cannot be built"))?,
        );
    }
    expected.push(
        light_token::instruction::TransferChecked {
            source,
            mint: flat_mint,
            destination,
            amount,
            decimals: mint.decimals,
            authority: owner,
            fee_payer: owner,
        }
        .instruction()
        .map_err(|_| invalid("Light TransferChecked cannot be built"))?,
    );
    if plan.instructions.len() != expected.len() {
        return Err(invalid("Flat instruction count is invalid"));
    }
    for (manifest, instruction) in plan.instructions.iter().zip(&expected) {
        require_manifest(
            manifest,
            instruction,
            if instruction.data.first() == Some(&12) {
                "LightTransferChecked"
            } else {
                "CreateLightAssociatedTokenAccountIdempotent"
            },
        )?;
    }
    let mut execution_instruction_batches = if setup_instruction_batches.is_empty() {
        vec![expected.clone()]
    } else {
        let mut batches = setup_instruction_batches.clone();
        batches
            .last_mut()
            .expect("nonempty cold setup")
            .extend(expected.clone());
        batches
    };
    if plan.action_batch_index + 1 != execution_instruction_batches.len()
        || plan.execution_instruction_batches.len() != execution_instruction_batches.len()
    {
        return Err(invalid("Flat action batch grouping is invalid"));
    }
    for (batch_index, (manifest_batch, instruction_batch)) in plan
        .execution_instruction_batches
        .iter()
        .zip(&execution_instruction_batches)
        .enumerate()
    {
        if manifest_batch.len() != instruction_batch.len() {
            return Err(invalid("Flat execution batch shape is invalid"));
        }
        let setup_count = setup_instruction_batches
            .get(batch_index)
            .map_or(0, Vec::len);
        for (instruction_index, (manifest, instruction)) in
            manifest_batch.iter().zip(instruction_batch).enumerate()
        {
            let name = if instruction_index < setup_count {
                "LightAccountLoad"
            } else if instruction.data.first() == Some(&12) {
                "LightTransferChecked"
            } else {
                "CreateLightAssociatedTokenAccountIdempotent"
            };
            require_manifest(manifest, instruction, name)?;
        }
    }
    if !setup_instruction_batches.is_empty() {
        let final_setup_count = setup_instruction_batches
            .last()
            .expect("nonempty cold setup")
            .len();
        let final_batch = execution_instruction_batches
            .last()
            .expect("execution always has an action batch");
        if final_batch.len() != final_setup_count + expected.len() {
            return Err(invalid(
                "final cold load and Flat transfer are not one atomic batch",
            ));
        }
    }
    let all_instructions = setup_instruction_batches
        .iter()
        .flat_map(|batch| batch.iter())
        .chain(expected.iter())
        .collect::<Vec<_>>();
    require_observed_instruction_accounts(&plan.current_observation, &all_instructions)?;
    let mut write_set = all_instructions
        .iter()
        .flat_map(|instruction| instruction.accounts.iter())
        .filter(|meta| meta.is_writable)
        .map(|meta| meta.pubkey.to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    write_set.sort();
    let signer_indexes = (0..expected.len()).collect::<Vec<_>>();
    if plan.write_set != write_set
        || plan.signer_roles
            != [FlatTransferSignerRole {
                pubkey: owner.to_string(),
                role: "owner".to_string(),
                instruction_indexes: signer_indexes,
            }]
    {
        return Err(invalid("Flat write set or signer coverage is not exact"));
    }

    let operation_id = digest_canonical(&json!({
        "domain": "ameba:flat_transfer_operation_id:v1", "operation": FLAT_TRANSFER_OPERATION,
        "currentObservationDigest": plan.current_observation_digest, "semantic": plan.semantic,
        "sourceState": plan.source_state, "destinationState": plan.destination_state,
        "sourceProofFacts": plan.source_proof_facts,
        "destinationProofFacts": plan.destination_proof_facts,
        "observedBytes": plan.observed_bytes, "setupInstructionBatches": plan.setup_instruction_batches,
        "setupSignerRoles": plan.setup_signer_roles,
        "instructions": plan.instructions,
        "executionInstructionBatches": plan.execution_instruction_batches,
        "actionBatchIndex": plan.action_batch_index,
        "writeSet": plan.write_set, "signerRoles": plan.signer_roles,
    }))?;
    let mut without_digest =
        serde_json::to_value(&plan).map_err(|_| invalid("Flat plan cannot be canonicalized"))?;
    without_digest
        .as_object_mut()
        .expect("plan is object")
        .remove("preparedPlanDigest");
    let prepared_plan_digest = digest_canonical(&json!({
        "domain": "ameba:flat_transfer_prepared_plan:v1", "plan": without_digest,
    }))?;
    if plan.operation_id != operation_id || plan.prepared_plan_digest != prepared_plan_digest {
        return Err(invalid(
            "Flat operation or prepared-plan commitment does not match",
        ));
    }
    Ok(ValidatedFlatTransferOperation {
        plan,
        setup_instruction_batches,
        instructions: expected,
        execution_instruction_batches: std::mem::take(&mut execution_instruction_batches),
    })
}

pub fn require_expected_flat_transfer(
    validated: &ValidatedFlatTransferOperation,
    owner: &Pubkey,
    sleeve: &Pubkey,
    destination_owner: &Pubkey,
    amount_atoms: u64,
) -> Result<(), FlatTransferOperationError> {
    let semantic = &validated.plan.semantic;
    if canonical_pubkey(&semantic.owner)? != *owner
        || canonical_pubkey(&semantic.sleeve)? != *sleeve
        || canonical_pubkey(&semantic.destination_owner)? != *destination_owner
        || positive_u64(&semantic.amount_atoms)? != amount_atoms
    {
        return Err(invalid(
            "Flat transfer differs from the explicit user request",
        ));
    }
    Ok(())
}

fn validate_cold_setup(
    plan: &FlatTransferOperationPlan,
    proof: &FlatTransferColdAccountProofFacts,
    target: Pubkey,
    token_owner: Pubkey,
    mint: Pubkey,
    payer: Pubkey,
    minimum_amount: u64,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<Vec<Vec<Instruction>>, FlatTransferOperationError> {
    if canonical_pubkey(&proof.ata)? != target
        || canonical_pubkey(&proof.owner)? != token_owner
        || canonical_pubkey(&proof.mint)? != mint
        || canonical_pubkey(&proof.payer)? != payer
        || !proof.includes_cold_balance
        || !lowercase_sha256(&proof.provider_origin_sha256)
        || canonical_u64(&proof.amount_atoms)? < minimum_amount
        || independently_rebuilt_setup.is_empty()
        || plan.setup_instruction_batches.len() != independently_rebuilt_setup.len()
    {
        return Err(invalid("cold Flat proof or independent setup is invalid"));
    }
    let mut rebuilt = Vec::with_capacity(independently_rebuilt_setup.len());
    let mut expected_setup_roles = Vec::with_capacity(independently_rebuilt_setup.len());
    let mut loads_target = false;
    for (setup_batch_index, (manifest_batch, expected_batch)) in plan
        .setup_instruction_batches
        .iter()
        .zip(independently_rebuilt_setup)
        .enumerate()
    {
        if manifest_batch.is_empty()
            || manifest_batch.len() > 8
            || manifest_batch.len() != expected_batch.len()
        {
            return Err(invalid("cold Flat setup batch shape is invalid"));
        }
        let mut signer_indexes = Vec::new();
        for (instruction_index, (manifest, instruction)) in
            manifest_batch.iter().zip(expected_batch).enumerate()
        {
            require_manifest(manifest, instruction, "LightAccountLoad")?;
            if instruction
                .accounts
                .iter()
                .filter(|meta| meta.is_signer)
                .any(|meta| meta.pubkey != payer)
            {
                return Err(invalid("cold Flat setup contains a foreign signer"));
            }
            loads_target |= instruction
                .accounts
                .iter()
                .any(|meta| meta.pubkey == target && meta.is_writable && !meta.is_signer);
            if instruction
                .accounts
                .iter()
                .any(|meta| meta.pubkey == payer && meta.is_signer)
            {
                signer_indexes.push(instruction_index);
            }
        }
        if signer_indexes.is_empty() {
            return Err(invalid("cold Flat setup batch omits the payer signer"));
        }
        expected_setup_roles.push(FlatTransferSetupSignerRole {
            pubkey: payer.to_string(),
            role: "owner".to_string(),
            setup_batch_index,
            instruction_indexes: signer_indexes,
        });
        rebuilt.push(expected_batch.clone());
    }
    if rebuilt.len() > 8 || !loads_target || plan.setup_signer_roles != expected_setup_roles {
        return Err(invalid(
            "cold Flat setup does not load the canonical target with exact signer coverage",
        ));
    }
    Ok(rebuilt)
}

fn unpack_light_token_account(data: &[u8]) -> Result<TokenAccount, FlatTransferOperationError> {
    if data.len() != 272
        || data[165] != 2
        || data[166] != 1
        || u32::from_le_bytes(data[167..171].try_into().expect("fixed trailer slice")) != 1
        || data[171] != 32
    {
        return Err(invalid("Light token account layout is invalid"));
    }
    TokenAccount::unpack_from_slice(&data[..TokenAccount::LEN])
        .map_err(|_| invalid("Light token account bytes are invalid"))
}
fn unpack_flat_mint(data: &[u8]) -> Result<Mint, FlatTransferOperationError> {
    if data.len() != Mint::LEN {
        return Err(invalid("Flat mint length is invalid"));
    }
    let mint = Mint::unpack_from_slice(data).map_err(|_| invalid("Flat mint bytes are invalid"))?;
    if !mint.is_initialized {
        return Err(invalid("Flat mint is invalid"));
    }
    Ok(mint)
}
fn canonical_transferable_light_account(account: &TokenAccount) -> bool {
    account.state == AccountState::Initialized
        && account.delegate == COption::None
        && account.delegated_amount == 0
        && account.is_native == COption::None
        && account.close_authority == COption::None
}
fn require_manifest(
    manifest: &FlatTransferInstructionManifest,
    expected: &Instruction,
    name: &str,
) -> Result<(), FlatTransferOperationError> {
    let data = canonical_base64(&manifest.data_base64)?;
    let accounts = manifest
        .accounts
        .iter()
        .map(|meta| {
            Ok(AccountMeta {
                pubkey: canonical_pubkey(&meta.address)?,
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
        })
        .collect::<Result<Vec<_>, FlatTransferOperationError>>()?;
    if manifest.program_id != expected.program_id.to_string()
        || manifest.instruction_name != name
        || data != expected.data
        || accounts != expected.accounts
    {
        return Err(invalid(
            "Flat Light instruction differs from native reconstruction",
        ));
    }
    Ok(())
}
fn observed(
    observation: &CurrentFinalizedObservation,
    address: Pubkey,
) -> Result<&CurrentFinalizedObservedAccount, FlatTransferOperationError> {
    observation
        .ordered_accounts
        .iter()
        .find(|account| account.address == address.to_string())
        .ok_or_else(|| invalid("finalized observation omits a Flat account"))
}
fn require_observed_instruction_accounts(
    observation: &CurrentFinalizedObservation,
    instructions: &[&Instruction],
) -> Result<(), FlatTransferOperationError> {
    for address in instructions
        .iter()
        .flat_map(|instruction| instruction.accounts.iter().map(|meta| meta.pubkey))
        .collect::<std::collections::HashSet<_>>()
    {
        let account = observed(observation, address)?;
        let complete = account.owner.is_some()
            && account.executable.is_some()
            && account.data_length.is_some()
            && account.data_sha256.is_some();
        if !complete && !account_absent(account) {
            return Err(invalid("Flat setup observation contains partial state"));
        }
    }
    Ok(())
}
fn account_absent(account: &CurrentFinalizedObservedAccount) -> bool {
    account.owner.is_none()
        && account.executable.is_none()
        && account.data_length.is_none()
        && account.data_sha256.is_none()
}
fn require_observed_bytes(
    observation: &CurrentFinalizedObservation,
    address: Pubkey,
    owner: Pubkey,
    data: &[u8],
) -> Result<(), FlatTransferOperationError> {
    let account = observed(observation, address)?;
    let length = data.len().to_string();
    let digest = hex_sha256(data);
    let owner = owner.to_string();
    if account.owner.as_deref() != Some(owner.as_str())
        || account.executable != Some(false)
        || account.data_length.as_deref() != Some(length.as_str())
        || account.data_sha256.as_deref() != Some(digest.as_str())
    {
        return Err(invalid(
            "Flat account bytes do not match the finalized observation",
        ));
    }
    Ok(())
}
fn canonical_base64(value: &str) -> Result<Vec<u8>, FlatTransferOperationError> {
    let data = BASE64
        .decode(value)
        .map_err(|_| invalid("Flat bytes are not base64"))?;
    if data.is_empty() || BASE64.encode(&data) != value {
        return Err(invalid("Flat bytes are not canonical base64"));
    }
    Ok(data)
}
fn canonical_pubkey(value: &str) -> Result<Pubkey, FlatTransferOperationError> {
    let key = Pubkey::from_str(value).map_err(|_| invalid("Flat public key is invalid"))?;
    if key.to_string() != value {
        return Err(invalid("Flat public key is not canonical"));
    }
    Ok(key)
}
fn positive_u64(value: &str) -> Result<u64, FlatTransferOperationError> {
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(invalid("Flat amount is not a canonical positive u64"));
    }
    value
        .parse()
        .map_err(|_| invalid("Flat amount exceeds u64"))
}
fn canonical_u64(value: &str) -> Result<u64, FlatTransferOperationError> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(invalid("Flat amount is not a canonical u64"));
    }
    value
        .parse()
        .map_err(|_| invalid("Flat amount exceeds u64"))
}
fn lowercase_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn hex_sha256(data: &[u8]) -> String {
    hash(data)
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn digest_canonical(value: &Value) -> Result<String, FlatTransferOperationError> {
    let encoded = serde_json::to_vec(&canonical_value(value))
        .map_err(|_| invalid("Flat plan cannot be canonicalized"))?;
    Ok(hex_sha256(&encoded))
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
fn invalid(message: &'static str) -> FlatTransferOperationError {
    FlatTransferOperationError::InvalidPlan(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical_light_account(owner: Pubkey, mint: Pubkey, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; 272];
        TokenAccount::pack(
            TokenAccount {
                mint,
                owner,
                amount,
                delegate: COption::None,
                state: AccountState::Initialized,
                is_native: COption::None,
                delegated_amount: 0,
                close_authority: COption::None,
            },
            &mut data[..TokenAccount::LEN],
        )
        .expect("pack token account");
        data[165] = 2;
        data[166] = 1;
        data[167..171].copy_from_slice(&1u32.to_le_bytes());
        data[171] = 32;
        data
    }

    #[test]
    fn official_light_transfer_and_create_bytes_are_exact() {
        let owner = Pubkey::new_unique();
        let destination_owner = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let source = light_token::instruction::derive_associated_token_account(&owner, &mint);
        let destination =
            light_token::instruction::derive_associated_token_account(&destination_owner, &mint);
        let transfer = light_token::instruction::TransferChecked {
            source,
            mint,
            destination,
            amount: 7,
            decimals: 6,
            authority: owner,
            fee_payer: owner,
        }
        .instruction()
        .expect("official transfer");
        assert_eq!(transfer.data, [12, 7, 0, 0, 0, 0, 0, 0, 0, 6]);
        assert_eq!(transfer.accounts.len(), 6);
        assert_eq!(transfer.accounts[0], AccountMeta::new(source, false));
        assert_eq!(transfer.accounts[2], AccountMeta::new(destination, false));
        assert_eq!(transfer.accounts[3], AccountMeta::new_readonly(owner, true));
        assert_eq!(transfer.accounts[5], AccountMeta::new(owner, true));

        let create = light_token::instruction::CreateAssociatedTokenAccount::new(
            owner,
            destination_owner,
            mint,
        )
        .idempotent()
        .instruction()
        .expect("official create ATA");
        assert_eq!(create.data, [102, 1, 3, 16, 1, 254, 2, 0, 0, 0]);
        assert_eq!(create.accounts[3], AccountMeta::new(destination, false));
    }

    #[test]
    fn canonical_light_layout_and_transfer_policy_are_exact() {
        let owner = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let data = canonical_light_account(owner, mint, 9);
        let account = unpack_light_token_account(&data).expect("canonical Light layout");
        assert!(canonical_transferable_light_account(&account));

        for index in [165usize, 166, 167, 171] {
            let mut mutated = data.clone();
            mutated[index] ^= 1;
            assert!(unpack_light_token_account(&mutated).is_err());
        }
        let mut extended = data.clone();
        extended.push(0);
        assert!(unpack_light_token_account(&extended).is_err());

        let mut delegated = account;
        delegated.delegate = COption::Some(Pubkey::new_unique());
        delegated.delegated_amount = 1;
        assert!(!canonical_transferable_light_account(&delegated));
    }

    #[test]
    fn flat_mint_requires_the_exact_classic_spl_length() {
        let mut data = vec![0u8; Mint::LEN];
        Mint::pack(
            Mint {
                mint_authority: COption::None,
                supply: 9,
                decimals: 6,
                is_initialized: true,
                freeze_authority: COption::None,
            },
            &mut data,
        )
        .expect("pack mint");
        assert!(unpack_flat_mint(&data).is_ok());
        data.push(0);
        assert_eq!(
            unpack_flat_mint(&data),
            Err(invalid("Flat mint length is invalid"))
        );
    }
}
