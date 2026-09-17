//! Strict portable validation for user-authorized RC44 collective-writer plans.
//!
//! The parser binds exact caller semantics, finalized observations, native
//! instruction bytes, the builder-defined account grammar, deterministic PDA
//! relationships, writable accounts, signer coverage, and plan commitments.
//! It performs no financial calculation.

use std::{collections::HashSet, str::FromStr};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use num_bigint::BigUint;
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
    constants::{LIGHT_TOKEN_COMPRESSIBLE_CONFIG, LIGHT_TOKEN_RENT_SPONSOR},
    current_finalized_observation::{
        CurrentFinalizedObservation, validate_current_finalized_observation,
    },
    instruction::VaultInstruction,
    protocol::{
        CURRENT_LIGHT_TOKEN_CPI_AUTHORITY, CURRENT_LIGHT_TOKEN_PROGRAM_ID,
        CURRENT_SPL_TOKEN_PROGRAM_ID, CURRENT_SYSTEM_PROGRAM_ID, derive_light_spl_interface_pda,
        derive_vault_config_pda,
    },
    writer_sleeve::{
        WithdrawWriterPrincipalAccounts, CancelOrRefundWriterBidAccounts,
        build_withdraw_writer_principal_instruction, build_cancel_or_refund_writer_bid_instruction,
        BeginWriterCloseAccounts, ClaimCollectiveLongAccounts, ClaimWriterFlatResidualAccounts,
        DepositWriterCloseBasketAccounts, DepositWriterPrincipalAccounts,
        FinalizeWriterCloseAccounts, PlaceWriterBidAccounts,
        ProcessWriterCloseFlatCancellationAccounts, ProcessWriterCloseSeriesCancellationAccounts,
        WRITER_CLOSE_FLAT_SENTINEL, build_begin_writer_close_instruction,
        build_claim_collective_long_instruction, build_claim_writer_flat_residual_instruction,
        build_deposit_writer_close_basket_instruction, build_deposit_writer_principal_instruction,
        build_finalize_writer_close_instruction, build_place_writer_bid_instruction,
        build_process_writer_close_flat_cancellation_instruction,
        build_process_writer_close_series_cancellation_instruction,
        decode_current_writer_instruction, derive_writer_auction_escrow_pda,
        derive_writer_bid_index_pda, derive_writer_bid_pda, derive_writer_close_flat_escrow_pda,
        derive_writer_flat_burn_custody_pda, derive_writer_flat_mint_pda,
        derive_writer_flat_staging_pda, derive_writer_retirement_custody_pda,
        derive_writer_series_book_pda, derive_writer_sleeve_pda,
        derive_writer_sleeve_usdc_vault_pda,
    },
};

pub const WRITER_OPERATION_SCHEMA_VERSION: u8 = 1;
pub const WRITER_OPERATION_SETUP_SCHEMA_VERSION: u8 = 2;
pub const WRITER_OPERATION_MAX_INSTRUCTIONS: usize = 32;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum WriterOperationError {
    #[error("writer operation JSON is invalid: {0}")]
    InvalidJson(String),
    #[error("writer operation plan is invalid: {0}")]
    InvalidPlan(&'static str),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WriterOperationKind {
    WriterLiquidityPolicyBegin,
    WriterLiquidityPolicyAppend,
    WriterLiquidityPolicySeal,
    WriterLiquidityInitialize,
    WriterLiquidityAdd,
    WriterLiquidityRemove,
    WriterLiquiditySweep,
    WithdrawPrincipal,
    AuctionRefund,
    Deposit,
    Bid,
    CloseBegin,
    CloseBasket,
    CloseFinalize,
    CloseCancel,
    SettlementClaimCollective,
    SettlementClaimFlat,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterInstructionAccountMeta {
    pub address: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterInstructionManifest {
    pub program_id: String,
    pub instruction_name: String,
    pub instruction_tag: u8,
    pub data_base64: String,
    pub accounts: Vec<WriterInstructionAccountMeta>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterSignerRole {
    pub pubkey: String,
    pub role: String,
    pub instruction_indexes: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterColdAccountProofFacts {
    pub ata: String,
    pub owner: String,
    pub mint: String,
    pub amount_atoms: String,
    pub minimum_amount_atoms: String,
    pub includes_cold_balance: bool,
    pub provider_origin_sha256: String,
    pub payer: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterCanonicalOutputSetupFacts {
    pub ata: String,
    pub owner: String,
    pub mint: String,
    pub payer: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WriterSetupMode {
    WriterLiquidityCompute,
    ColdLoad,
    CanonicalOutputCreate,
    ClassicOutputCreate,
    ReleaseCompute,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterSetupInstructionManifest {
    pub program_id: String,
    pub instruction_name: String,
    pub data_base64: String,
    pub accounts: Vec<WriterInstructionAccountMeta>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterSetupSignerRole {
    pub pubkey: String,
    pub role: String,
    pub setup_batch_index: usize,
    pub instruction_indexes: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum WriterExecutionInstructionManifest {
    Setup(WriterSetupInstructionManifest),
    Writer(WriterInstructionManifest),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriterOperationPlan {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_lookup_table: Option<crate::CurrentCollectiveLookupTableWitnessV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collective_claim_series_book_base64: Option<String>,
    pub schema_version: u8,
    pub operation: WriterOperationKind,
    pub operation_id: String,
    pub current_observation: CurrentFinalizedObservation,
    pub current_observation_digest: String,
    pub lean_admission_digest: String,
    pub semantic: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_mode: Option<WriterSetupMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cold_account_proof_facts: Option<WriterColdAccountProofFacts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_output_setup_facts: Option<WriterCanonicalOutputSetupFacts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classic_output_setup_facts: Option<WriterCanonicalOutputSetupFacts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_instruction_batches: Option<Vec<Vec<WriterSetupInstructionManifest>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_signer_roles: Option<Vec<WriterSetupSignerRole>>,
    pub instructions: Vec<WriterInstructionManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_instruction_batches: Option<Vec<Vec<WriterExecutionInstructionManifest>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_batch_index: Option<usize>,
    pub write_set: Vec<String>,
    pub signer_roles: Vec<WriterSignerRole>,
    pub prepared_plan_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedWriterOperation {
    pub plan: WriterOperationPlan,
    pub setup_instruction_batches: Vec<Vec<Instruction>>,
    pub instructions: Vec<Instruction>,
    pub execution_instruction_batches: Vec<Vec<Instruction>>,
}

/// Parse and fully validate a portable user writer plan.
pub fn parse_writer_operation_json(
    encoded: &str,
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    let plan: WriterOperationPlan = serde_json::from_str(encoded)
        .map_err(|error| WriterOperationError::InvalidJson(error.to_string()))?;
    validate_writer_operation(plan)
}

/// Parse either one legacy hot plan or one schema-v2 cold plan. Cold plans are
/// admitted only when their native Light batches are rebuilt independently.
pub fn parse_writer_operation_json_with_setup(
    encoded: &str,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    let plan: WriterOperationPlan = serde_json::from_str(encoded)
        .map_err(|error| WriterOperationError::InvalidJson(error.to_string()))?;
    validate_writer_operation_with_setup(plan, independently_rebuilt_setup)
}

/// Validate one byte-compatible schema-v1 hot writer plan.
pub fn validate_writer_operation(
    plan: WriterOperationPlan,
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    crate::governed_operation::require_historical_operation_mode_v1()
        .map_err(|_| invalid("historical writer plans are offline-only"))?;
    validate_writer_operation_inner(plan, None)
}

fn validate_writer_operation_inner(
    plan: WriterOperationPlan,
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>,
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    if is_writer_liquidity_operation(plan.operation) || (context.is_some() && writer_requires_release_compute(plan.operation)) {
        return Err(invalid(
            "full-inventory Writer actions require committed schema-v2 release compute setup",
        ));
    }
    if plan.schema_version != WRITER_OPERATION_SCHEMA_VERSION || writer_plan_has_setup_fields(&plan)
    {
        return Err(invalid(
            "legacy writer validation admits only schema-v1 hot plans",
        ));
    }
    let (instructions, business) = validate_writer_common(&plan, context)?;
    if let Some(expected) = writer_light_account_expectation(plan.operation, &business)? {
        require_hot_light_account(&plan.current_observation, expected.target)?;
    }
    require_observed_accounts(&plan.current_observation, &business)?;
    require_exact_write_set(&plan.write_set, &instructions)?;
    validate_writer_commitments_v1(&plan)?;
    Ok(ValidatedWriterOperation {
        plan,
        setup_instruction_batches: Vec::new(),
        execution_instruction_batches: vec![instructions.clone()],
        instructions,
    })
}

/// Validate a hot schema-v1 plan or one exact schema-v2 cold Light setup.
pub fn validate_writer_operation_with_setup(
    plan: WriterOperationPlan,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    crate::governed_operation::require_historical_operation_mode_v1()
        .map_err(|_| invalid("historical writer plans are offline-only"))?;
    validate_writer_operation_with_setup_inner(plan, independently_rebuilt_setup, None)
}

fn validate_writer_operation_with_setup_inner(
    plan: WriterOperationPlan,
    independently_rebuilt_setup: &[Vec<Instruction>],
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>,
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    if plan.schema_version == WRITER_OPERATION_SCHEMA_VERSION {
        if !independently_rebuilt_setup.is_empty() {
            return Err(invalid("schema-v1 hot writer plan cannot carry cold setup"));
        }
        return validate_writer_operation_inner(plan, context);
    }
    if plan.schema_version != WRITER_OPERATION_SETUP_SCHEMA_VERSION {
        return Err(invalid("writer operation schema is not current"));
    }
    if plan.setup_mode == Some(WriterSetupMode::WriterLiquidityCompute) {
        return validate_writer_liquidity_compute(plan, independently_rebuilt_setup, context);
    }
    if is_writer_liquidity_operation(plan.operation) || plan.transaction_lookup_table.is_some() {
        return Err(invalid("writer liquidity requires its committed candidate compute transport"));
    }
    if plan.classic_output_setup_facts.is_some() || plan.setup_mode == Some(WriterSetupMode::ClassicOutputCreate) {
        return validate_writer_classic_output(plan, independently_rebuilt_setup, context);
    }
    if plan.setup_mode == Some(WriterSetupMode::ReleaseCompute) {
        return validate_writer_release_compute(plan, independently_rebuilt_setup, context);
    }
    if writer_requires_release_compute(plan.operation) {
        return Err(invalid(
            "full-inventory Writer actions cannot select Light setup",
        ));
    }
    let setup_mode = plan
        .setup_mode
        .ok_or_else(|| invalid("schema-v2 writer setup mode is missing"))?;
    let setup_manifests = plan
        .setup_instruction_batches
        .as_ref()
        .ok_or_else(|| invalid("schema-v2 writer setup batches are missing"))?;
    let setup_roles = plan
        .setup_signer_roles
        .as_ref()
        .ok_or_else(|| invalid("schema-v2 writer setup signer roles are missing"))?;
    let execution_manifests = plan
        .execution_instruction_batches
        .as_ref()
        .ok_or_else(|| invalid("schema-v2 writer execution batches are missing"))?;
    let action_batch_index = plan
        .action_batch_index
        .ok_or_else(|| invalid("schema-v2 writer action batch index is missing"))?;

    let (instructions, business) = validate_writer_common(&plan, context)?;
    let expected = writer_light_account_expectation(plan.operation, &business)?
        .ok_or_else(|| invalid("writer operation has no supported cold Light ATA"))?;
    match setup_mode {
        WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => {
            return Err(invalid("release compute is not a Light setup mode"));
        }
        WriterSetupMode::ColdLoad => {
            if !matches!(
                plan.operation,
                WriterOperationKind::WithdrawPrincipal | WriterOperationKind::CloseBegin | WriterOperationKind::CloseBasket
                    | WriterOperationKind::SettlementClaimCollective | WriterOperationKind::SettlementClaimFlat
            ) || plan.canonical_output_setup_facts.is_some()
            {
                return Err(invalid(
                    "cold-load mode requires principal withdrawal, close input or settlement claim",
                ));
            }
            let proof = plan
                .cold_account_proof_facts
                .as_ref()
                .ok_or_else(|| invalid("schema-v2 writer cold proof is missing"))?;
            require_cold_light_account(&plan.current_observation, expected.target)?;
            validate_writer_cold_proof(proof, &expected)?;
        }
        WriterSetupMode::CanonicalOutputCreate => {
            if plan.operation != WriterOperationKind::CloseCancel
                || plan.cold_account_proof_facts.is_some()
            {
                return Err(invalid(
                    "canonical-output mode is admitted only for close cancellation",
                ));
            }
            let facts = plan
                .canonical_output_setup_facts
                .as_ref()
                .ok_or_else(|| invalid("schema-v2 canonical-output facts are missing"))?;
            validate_writer_canonical_output_facts(facts, &expected)?;
            require_canonical_output_light_account(&plan.current_observation, expected.target)?;
        }
    }
    let setup_instruction_batches = validate_writer_setup(
        setup_manifests,
        setup_roles,
        &expected,
        setup_mode,
        plan.cold_account_proof_facts.as_ref(),
        plan.canonical_output_setup_facts.as_ref(),
        independently_rebuilt_setup,
    )?;
    let mut execution_instruction_batches = setup_instruction_batches.clone();
    execution_instruction_batches
        .last_mut()
        .expect("validated cold setup is nonempty")
        .extend(instructions.clone());
    validate_writer_execution_batches(
        execution_manifests,
        setup_manifests,
        &plan.instructions,
        &execution_instruction_batches,
        action_batch_index,
    )?;
    let all_instructions = setup_instruction_batches
        .iter()
        .flat_map(|batch| batch.iter().cloned())
        .chain(instructions.iter().cloned())
        .collect::<Vec<_>>();
    let business_and_setup = setup_instruction_batches
        .iter()
        .flatten()
        .cloned()
        .chain(business)
        .collect::<Vec<_>>();
    require_observed_accounts(&plan.current_observation, &business_and_setup)?;
    require_exact_write_set(&plan.write_set, &all_instructions)?;
    validate_writer_commitments_v2(&plan)?;
    Ok(ValidatedWriterOperation {
        plan,
        setup_instruction_batches,
        instructions,
        execution_instruction_batches,
    })
}

/// Bind classic output creation to the exact native refund/withdrawal destination.
fn validate_writer_classic_output(
    plan: WriterOperationPlan,
    independently_rebuilt_setup: &[Vec<Instruction>],
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>,
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    if !matches!(plan.operation, WriterOperationKind::WithdrawPrincipal | WriterOperationKind::AuctionRefund | WriterOperationKind::CloseFinalize)
        || plan.canonical_output_setup_facts.is_some() || plan.instructions.len() != 1
        || !matches!(plan.setup_mode, Some(WriterSetupMode::ColdLoad | WriterSetupMode::ClassicOutputCreate))
    { return Err(invalid("classic output setup requires one refund, principal withdrawal or close finalization")); }
    let facts = plan.classic_output_setup_facts.as_ref().ok_or_else(|| invalid("classic output facts missing"))?;
    let (instructions, business) = validate_writer_common(&plan, context)?;
    let native = &business[0];
    let (destination_index, mint_index) = if plan.operation == WriterOperationKind::WithdrawPrincipal { (4, 5) } else if plan.operation == WriterOperationKind::CloseFinalize { (8, 9) } else { (6, 7) };
    let owner = canonical_pubkey(&facts.owner)?;
    let payer = canonical_pubkey(&facts.payer)?;
    let mint = canonical_pubkey(&facts.mint)?;
    let ata = canonical_pubkey(&facts.ata)?;
    let associated_program = canonical_pubkey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")?;
    let canonical_ata = Pubkey::find_program_address(&[owner.as_ref(), CURRENT_SPL_TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()], &associated_program).0;
    if payer != native.accounts[0].pubkey || ata != native.accounts[destination_index].pubkey
        || mint != native.accounts[mint_index].pubkey || ata != canonical_ata
        || (plan.operation != WriterOperationKind::AuctionRefund && owner != payer)
    { return Err(invalid("classic output facts differ from native destination")); }
    let observed = plan.current_observation.ordered_accounts.iter().find(|account| account.address == facts.ata)
        .ok_or_else(|| invalid("classic output observation missing"))?;
    let absent = observed.owner.is_none() && observed.executable.is_none() && observed.data_length.is_none() && observed.data_sha256.is_none();
    let system_empty = observed.owner.as_deref() == Some("11111111111111111111111111111111")
        && observed.executable == Some(false) && observed.data_length.as_deref() == Some("0");
    if !absent && !system_empty { return Err(invalid("classic output is not absent or system-empty")); }
    let create = Instruction { program_id: associated_program, data: vec![1], accounts: vec![
        AccountMeta::new(payer, true), AccountMeta::new(ata, false), AccountMeta::new_readonly(owner, false),
        AccountMeta::new_readonly(mint, false), AccountMeta::new_readonly(CURRENT_SYSTEM_PROGRAM_ID, false),
        AccountMeta::new_readonly(CURRENT_SPL_TOKEN_PROGRAM_ID, false),
    ] };
    let manifests = plan.setup_instruction_batches.as_ref().ok_or_else(|| invalid("classic setup batches missing"))?;
    let roles = plan.setup_signer_roles.as_ref().ok_or_else(|| invalid("classic setup roles missing"))?;
    if manifests.is_empty() || manifests.len() != independently_rebuilt_setup.len() || manifests.len() > 8 {
        return Err(invalid("classic setup batch count invalid"));
    }
    let mut base = independently_rebuilt_setup.to_vec();
    let mut base_manifests = manifests.clone();
    let last_index = base.len() - 1;
    if base[last_index].pop() != Some(create.clone()) { return Err(invalid("classic ATA setup differs from native instruction")); }
    let create_manifest = base_manifests[last_index].pop().ok_or_else(|| invalid("classic ATA manifest missing"))?;
    require_writer_setup_manifest(&create_manifest, &create)?;
    let expected_roles = independently_rebuilt_setup.iter().enumerate().map(|(setup_batch_index, batch)| WriterSetupSignerRole {
        pubkey: payer.to_string(), role: "payer".to_string(), setup_batch_index,
        instruction_indexes: batch.iter().enumerate().filter_map(|(index, ix)| ix.accounts.iter().any(|meta| meta.is_signer && meta.pubkey == payer).then_some(index)).collect(),
    }).collect::<Vec<_>>();
    if *roles != expected_roles { return Err(invalid("classic setup signer coverage differs")); }
    let expected = writer_light_account_expectation(plan.operation, &business)?;
    if plan.setup_mode == Some(WriterSetupMode::ColdLoad) {
        let expected = expected.ok_or_else(|| invalid("refund has no cold Light input"))?;
        let proof = plan.cold_account_proof_facts.as_ref().ok_or_else(|| invalid("withdrawal cold proof missing"))?;
        require_cold_light_account(&plan.current_observation, expected.target)?;
        validate_writer_cold_proof(proof, &expected)?;
        let mut base_roles = expected_roles.clone();
        base_roles[last_index].instruction_indexes.pop();
        validate_writer_setup(&base_manifests, &base_roles, &expected, WriterSetupMode::ColdLoad, Some(proof), None, &base)?;
    } else {
        if plan.cold_account_proof_facts.is_some() || base.len() != 1 || base[0].len() != 1 || base_manifests[0].len() != 1 {
            return Err(invalid("classic-only setup has extra instructions or proof"));
        }
        require_writer_setup_manifest(&base_manifests[0][0], &base[0][0])?;
        require_writer_compute_budget(&base[0][0], WriterSetupMode::CanonicalOutputCreate)?;
        if let Some(expected) = expected { require_hot_light_account(&plan.current_observation, expected.target)?; }
    }
    let setup_instruction_batches = independently_rebuilt_setup.to_vec();
    let mut execution_instruction_batches = setup_instruction_batches.clone();
    execution_instruction_batches[last_index].extend(instructions.clone());
    validate_writer_execution_batches(
        plan.execution_instruction_batches.as_deref().ok_or_else(|| invalid("classic execution batches missing"))?,
        manifests, &plan.instructions, &execution_instruction_batches,
        plan.action_batch_index.ok_or_else(|| invalid("classic action batch index missing"))?,
    )?;
    let observed_instructions = setup_instruction_batches.iter().flatten().cloned().chain(business).collect::<Vec<_>>();
    require_observed_accounts(&plan.current_observation, &observed_instructions)?;
    let all = setup_instruction_batches.iter().flatten().cloned().chain(instructions.iter().cloned()).collect::<Vec<_>>();
    require_exact_write_set(&plan.write_set, &all)?;
    validate_writer_commitments_v2(&plan)?;
    Ok(ValidatedWriterOperation { plan, setup_instruction_batches, instructions, execution_instruction_batches })
}

fn validate_writer_common(
    plan: &WriterOperationPlan,
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>,
) -> Result<(Vec<Instruction>, Vec<Instruction>), WriterOperationError> {
    if plan.current_observation_digest != plan.current_observation.current_observation_digest
        || !lowercase_sha256(&plan.lean_admission_digest)
        || !lowercase_sha256(&plan.operation_id)
        || !lowercase_sha256(&plan.prepared_plan_digest)
        || !matches!(&plan.semantic, Value::Object(value) if !value.is_empty())
        || plan.instructions.is_empty()
        || plan.instructions.len() > WRITER_OPERATION_MAX_INSTRUCTIONS
    {
        return Err(invalid(
            "schema, semantics, observation, or digest is not canonical",
        ));
    }
    validate_current_finalized_observation(&plan.current_observation)
        .map_err(|_| invalid("current finalized observation is invalid"))?;

    let mut instructions = Vec::with_capacity(plan.instructions.len());
    let mut business = Vec::with_capacity(plan.instructions.len());
    for manifest in &plan.instructions {
        if let Some(context) = context {
            let raw = Instruction {
                program_id: canonical_pubkey(&manifest.program_id)?,
                accounts: manifest
                    .accounts
                    .iter()
                    .map(|meta| {
                        Ok(AccountMeta {
                            pubkey: canonical_pubkey(&meta.address)?,
                            is_signer: meta.is_signer,
                            is_writable: meta.is_writable,
                        })
                    })
                    .collect::<Result<Vec<_>, WriterOperationError>>()?,
                data: BASE64
                    .decode(&manifest.data_base64)
                    .map_err(|_| invalid("instruction data is not base64"))?,
            };
            if BASE64.encode(&raw.data) != manifest.data_base64 {
                return Err(invalid("instruction data is not canonical base64"));
            }
            let views =
                crate::governed_operation::inspect_current_governed_instruction_v1(context, &raw)
                    .map_err(|_| invalid("writer governance envelope is invalid"))?;
            let mut semantic_manifest = manifest.clone();
            semantic_manifest.data_base64 = BASE64.encode(&views.business_instruction.data);
            semantic_manifest.accounts.pop();
            let rebuilt = rebuild_instruction(plan.operation, &semantic_manifest)?;
            if rebuilt != views.business_instruction {
                return Err(invalid("writer business view differs from exact builder"));
            }
            business.push(rebuilt);
            instructions.push(raw);
        } else {
            let rebuilt = rebuild_instruction(plan.operation, manifest)?;
            business.push(rebuilt.clone());
            instructions.push(rebuilt);
        }
    }
    if plan.operation == WriterOperationKind::SettlementClaimCollective {
        require_collective_claim_series_binding(plan, &business)?;
    } else {
        if plan.collective_claim_series_book_base64.is_some() {
            return Err(invalid(
                "series-book witness is only valid for collective claims",
            ));
        }
        require_writer_semantic_binding(plan.operation, &plan.semantic, &business)?;
    }
    require_exact_signer_coverage(&plan.signer_roles, &instructions)?;
    Ok((instructions, business))
}

/// Candidate source prefix for CLI reconstruction; admission remains the typed plan validator.
pub fn current_writer_liquidity_compute_setup() -> Result<Vec<Vec<Instruction>>, WriterOperationError> {
    let preset: Value = serde_json::from_str(include_str!("../../src/protocol/writer-dlmm-transport.v1.json"))
        .map_err(|_| invalid("invalid writer liquidity candidate transport source"))?;
    let program_id = canonical_pubkey(preset["setupProgramId"].as_str().ok_or_else(|| invalid("missing candidate compute program"))?)?;
    let encoded = preset["setupInstructionDataBase64"].as_array().ok_or_else(|| invalid("missing candidate compute prefix"))?;
    if encoded.len() != 2 || preset["instructionTag"] != json!(159) || preset["setupMode"] != json!("writer_liquidity_compute") {
        return Err(invalid("writer liquidity candidate transport differs"));
    }
    let instructions = encoded.iter().map(|value| Ok(Instruction { program_id, accounts: vec![],
        data: BASE64.decode(value.as_str().ok_or_else(|| invalid("invalid candidate compute bytes"))?)
            .map_err(|_| invalid("invalid candidate compute base64"))? })).collect::<Result<Vec<_>, WriterOperationError>>()?;
    Ok(vec![instructions])
}

fn validate_writer_liquidity_compute(plan: WriterOperationPlan, independently_rebuilt_setup: &[Vec<Instruction>],
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>) -> Result<ValidatedWriterOperation, WriterOperationError> {
    if context.is_none() || !is_writer_liquidity_operation(plan.operation) || plan.schema_version != 2
        || plan.instructions.len() != 1 || plan.cold_account_proof_facts.is_some() || plan.canonical_output_setup_facts.is_some()
        || plan.classic_output_setup_facts.is_some() || plan.setup_signer_roles.as_deref() != Some(&[]) || plan.action_batch_index != Some(0) {
        return Err(invalid("writer liquidity compute requires one current typed action and unsigned prefix"));
    }
    if let Some(witness) = &plan.transaction_lookup_table {
        crate::decode_current_collective_lookup_table_v1(witness, &plan.current_observation)
            .map_err(|_| invalid("writer liquidity lookup witness differs from finalized frame"))?;
    }
    let setup_batches = current_writer_liquidity_compute_setup()?;
    let setup = &setup_batches[0];
    let setup_manifests = setup.iter().enumerate().map(|(index, instruction)| WriterSetupInstructionManifest {
        program_id: instruction.program_id.to_string(), instruction_name: if index == 0 { "RequestHeapFrame" } else { "SetComputeUnitLimit" }.to_owned(),
        data_base64: BASE64.encode(&instruction.data), accounts: vec![],
    }).collect::<Vec<_>>();
    if plan.setup_instruction_batches.as_deref() != Some(std::slice::from_ref(&setup_manifests))
        || (!independently_rebuilt_setup.is_empty() && independently_rebuilt_setup != setup_batches.as_slice()) {
        return Err(invalid("writer liquidity compute prefix is not the exact candidate source bytes"));
    }
    let (instructions, business) = validate_writer_common(&plan, context)?;
    require_observed_accounts(&plan.current_observation, &business)?;
    let execution = setup.iter().cloned().chain(instructions.iter().cloned()).collect::<Vec<_>>();
    validate_writer_execution_batches(plan.execution_instruction_batches.as_deref().ok_or_else(|| invalid("writer liquidity execution missing"))?,
        std::slice::from_ref(&setup_manifests), &plan.instructions, std::slice::from_ref(&execution), 0)?;
    require_exact_write_set(&plan.write_set, &execution)?;
    validate_writer_commitments_v2(&plan)?;
    Ok(ValidatedWriterOperation { plan, setup_instruction_batches: setup_batches, instructions,
        execution_instruction_batches: vec![execution] })
}

fn writer_requires_release_compute(_operation: WriterOperationKind) -> bool {
    // The deployed V3 target retains Writer auction V1. The V2-only setup variant is refused.
    false
}

fn writer_release_compute_instructions() -> Result<Vec<Instruction>, WriterOperationError> {
    let preset: Value = serde_json::from_str(crate::governed_operation::WRITER_TRANSPORT)
        .map_err(|_| invalid("invalid compiled transport preset"))?;
    let program_id = canonical_pubkey(
        preset["setupProgramId"]
            .as_str()
            .ok_or_else(|| invalid("invalid compiled transport program"))?,
    )?;
    preset["setupInstructionDataBase64"]
        .as_array()
        .ok_or_else(|| invalid("invalid compiled transport bytes"))?
        .iter()
        .map(|encoded| {
            Ok(Instruction {
                program_id,
                accounts: vec![],
                data: BASE64
                    .decode(
                        encoded
                            .as_str()
                            .ok_or_else(|| invalid("invalid compiled transport bytes"))?,
                    )
                    .map_err(|_| invalid("invalid compiled transport bytes"))?,
            })
        })
        .collect()
}

fn validate_writer_release_compute(
    plan: WriterOperationPlan,
    independently_rebuilt_setup: &[Vec<Instruction>],
    context: Option<&crate::governed_operation::CurrentGovernedWriteContextV1>,
) -> Result<ValidatedWriterOperation, WriterOperationError> {
    if context.is_none()
        || !writer_requires_release_compute(plan.operation)
        || plan.instructions.len() != 1
        || plan.cold_account_proof_facts.is_some()
        || plan.canonical_output_setup_facts.is_some()
        || plan.classic_output_setup_facts.is_some()
        || plan.setup_signer_roles.as_deref() != Some(&[])
        || plan.action_batch_index != Some(0)
    {
        return Err(invalid(
            "release compute is current-only and has one exact unsigned setup",
        ));
    }
    let setup = writer_release_compute_instructions()?;
    let setup_manifests = setup
        .iter()
        .enumerate()
        .map(|(index, ix)| WriterSetupInstructionManifest {
            program_id: ix.program_id.to_string(),
            instruction_name: if index == 0 {
                "RequestHeapFrame"
            } else {
                "SetComputeUnitLimit"
            }
            .to_owned(),
            data_base64: BASE64.encode(&ix.data),
            accounts: vec![],
        })
        .collect::<Vec<_>>();
    if plan.setup_instruction_batches.as_deref() != Some(std::slice::from_ref(&setup_manifests))
        || (!independently_rebuilt_setup.is_empty()
            && independently_rebuilt_setup != std::slice::from_ref(&setup))
    {
        return Err(invalid(
            "release compute program, order, bytes, or account set is not canonical",
        ));
    }
    let (instructions, business) = validate_writer_common(&plan, context)?;
    require_observed_accounts(&plan.current_observation, &business)?;
    let execution = setup
        .iter()
        .cloned()
        .chain(instructions.iter().cloned())
        .collect::<Vec<_>>();
    validate_writer_execution_batches(
        plan.execution_instruction_batches
            .as_deref()
            .ok_or_else(|| invalid("release compute execution batch missing"))?,
        std::slice::from_ref(&setup_manifests),
        &plan.instructions,
        std::slice::from_ref(&execution),
        0,
    )?;
    require_exact_write_set(&plan.write_set, &execution)?;
    validate_writer_commitments_v2(&plan)?;
    Ok(ValidatedWriterOperation {
        plan,
        setup_instruction_batches: vec![setup],
        instructions,
        execution_instruction_batches: vec![execution],
    })
}

/// Current writer admission preserves the exact governed plan commitments and
/// uses only the checked business views for native builder/semantic comparison.
pub fn parse_current_governed_writer_operation_json_v1(
    context: &crate::governed_operation::CurrentGovernedWriteContextV1,
    encoded: &str,
    independently_rebuilt_setup: &[Vec<Instruction>],
) -> Result<crate::governed_operation::CurrentGovernedOperationV1, WriterOperationError> {
    let plan: WriterOperationPlan = serde_json::from_str(encoded)
        .map_err(|error| WriterOperationError::InvalidJson(error.to_string()))?;
    let validated = validate_writer_operation_with_setup_inner(
        plan,
        independently_rebuilt_setup,
        Some(context),
    )?;
    crate::governed_operation::CurrentGovernedOperationV1::writer(context, validated).map_err(
        |_| invalid("writer finalized context or transaction privilege closure is invalid"),
    )
}

fn validate_writer_commitments_v1(plan: &WriterOperationPlan) -> Result<(), WriterOperationError> {
    let mut commitment = json!({
        "domain": "ameba:writer_operation_id:v1",
        "operation": plan.operation,
        "currentObservationDigest": plan.current_observation_digest,
        "leanAdmissionDigest": plan.lean_admission_digest,
        "semantic": plan.semantic,
        "instructions": plan.instructions,
        "writeSet": plan.write_set,
        "signerRoles": plan.signer_roles,
    });
    if let Some(witness) = &plan.collective_claim_series_book_base64 {
        commitment
            .as_object_mut()
            .expect("object")
            .insert("collectiveClaimSeriesBookBase64".into(), json!(witness));
    }
    let operation_id = digest_canonical(&commitment)?;
    let mut without_digest =
        serde_json::to_value(plan).map_err(|_| invalid("writer plan cannot be canonicalized"))?;
    without_digest
        .as_object_mut()
        .expect("plan is object")
        .remove("preparedPlanDigest");
    let prepared_plan_digest = digest_canonical(&json!({
        "domain": "ameba:writer_prepared_plan:v1",
        "plan": without_digest,
    }))?;
    if plan.operation_id != operation_id || plan.prepared_plan_digest != prepared_plan_digest {
        return Err(invalid(
            "operation or prepared-plan commitment does not match",
        ));
    }
    Ok(())
}

fn validate_writer_commitments_v2(plan: &WriterOperationPlan) -> Result<(), WriterOperationError> {
    let setup_mode = plan
        .setup_mode
        .ok_or_else(|| invalid("writer setup mode is missing"))?;
    let mut operation_commitment = json!({
        "domain": "ameba:writer_operation_id:v2",
        "operation": plan.operation,
        "currentObservationDigest": plan.current_observation_digest,
        "leanAdmissionDigest": plan.lean_admission_digest,
        "semantic": plan.semantic,
        "setupMode": setup_mode,
        "setupInstructionBatches": plan.setup_instruction_batches,
        "setupSignerRoles": plan.setup_signer_roles,
        "instructions": plan.instructions,
        "executionInstructionBatches": plan.execution_instruction_batches,
        "actionBatchIndex": plan.action_batch_index,
        "writeSet": plan.write_set,
        "signerRoles": plan.signer_roles,
    });
    let object = operation_commitment
        .as_object_mut()
        .expect("commitment is object");
    if let Some(witness) = &plan.transaction_lookup_table {
        object.insert("transactionLookupTable".to_string(), serde_json::to_value(witness).map_err(|_| invalid("lookup witness cannot be canonicalized"))?);
    }
    match setup_mode {
        WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => {}
        WriterSetupMode::ColdLoad => {
            let proof = plan
                .cold_account_proof_facts
                .as_ref()
                .ok_or_else(|| invalid("writer cold proof is missing"))?;
            object.insert(
                "coldAccountProofFacts".to_string(),
                serde_json::to_value(proof)
                    .map_err(|_| invalid("writer cold proof cannot be canonicalized"))?,
            );
        }
        WriterSetupMode::CanonicalOutputCreate => {
            let facts = plan
                .canonical_output_setup_facts
                .as_ref()
                .ok_or_else(|| invalid("writer output facts are missing"))?;
            object.insert(
                "canonicalOutputSetupFacts".to_string(),
                serde_json::to_value(facts)
                    .map_err(|_| invalid("writer output facts cannot be canonicalized"))?,
            );
        }
    }
    if let Some(facts) = &plan.classic_output_setup_facts {
        object.insert("classicOutputSetupFacts".to_string(), json!(facts));
    }
    let operation_id = digest_canonical(&operation_commitment)?;
    let mut without_digest =
        serde_json::to_value(plan).map_err(|_| invalid("writer plan cannot be canonicalized"))?;
    without_digest
        .as_object_mut()
        .expect("plan is object")
        .remove("preparedPlanDigest");
    let prepared_plan_digest = digest_canonical(&json!({
        "domain": "ameba:writer_prepared_plan:v2",
        "plan": without_digest,
    }))?;
    if plan.operation_id != operation_id || plan.prepared_plan_digest != prepared_plan_digest {
        return Err(invalid(
            "operation or prepared-plan commitment does not match",
        ));
    }
    Ok(())
}

fn writer_plan_has_setup_fields(plan: &WriterOperationPlan) -> bool {
    plan.setup_mode.is_some() || plan.transaction_lookup_table.is_some()
        || plan.cold_account_proof_facts.is_some()
        || plan.canonical_output_setup_facts.is_some()
        || plan.classic_output_setup_facts.is_some()
        || plan.setup_instruction_batches.is_some()
        || plan.setup_signer_roles.is_some()
        || plan.execution_instruction_batches.is_some()
        || plan.action_batch_index.is_some()
}

/// Bind every caller-controlled semantic field before local signing.
pub fn require_expected_writer_semantic(
    validated: &ValidatedWriterOperation,
    expected_operation: WriterOperationKind,
    expected_semantic: &Value,
) -> Result<(), WriterOperationError> {
    if validated.plan.operation != expected_operation
        || validated.plan.semantic != *expected_semantic
    {
        return Err(invalid(
            "writer plan differs from the explicit user request",
        ));
    }
    Ok(())
}

/// Select the sleeve from an already validated exact liquidity semantic.
/// This accessor does not infer identity from an instruction account offset.
pub fn validated_writer_liquidity_sleeve(
    validated: &ValidatedWriterOperation,
) -> Result<Pubkey, WriterOperationError> {
    if !is_writer_liquidity_operation(validated.plan.operation) {
        return Err(invalid("writer operation is not a liquidity operation"));
    }
    let sleeve = validated.plan.semantic.get("sleeve").and_then(Value::as_str)
        .ok_or_else(|| invalid("validated liquidity sleeve is missing"))?;
    canonical_pubkey(sleeve)
}

pub(crate) fn is_writer_liquidity_operation(operation: WriterOperationKind) -> bool {
    matches!(operation, WriterOperationKind::WriterLiquidityPolicyBegin | WriterOperationKind::WriterLiquidityPolicyAppend
        | WriterOperationKind::WriterLiquidityPolicySeal | WriterOperationKind::WriterLiquidityInitialize
        | WriterOperationKind::WriterLiquidityAdd | WriterOperationKind::WriterLiquidityRemove | WriterOperationKind::WriterLiquiditySweep)
}

fn require_collective_claim_series_binding(
    plan: &WriterOperationPlan,
    instructions: &[Instruction],
) -> Result<(), WriterOperationError> {
    if instructions.len() != 1 || plan.schema_version != 1 {
        return Err(invalid(
            "collective claim requires one hot native instruction",
        ));
    }
    let instruction = &instructions[0];
    let witness = plan
        .collective_claim_series_book_base64
        .as_ref()
        .ok_or_else(|| invalid("collective claim requires an observed series-book witness"))?;
    if witness.len() != 8312_usize.div_ceil(3) * 4 {
        return Err(invalid(
            "collective claim witness must have the fixed series-book size",
        ));
    }
    let bytes = BASE64
        .decode(witness)
        .map_err(|_| invalid("invalid series-book base64"))?;
    let address = key(&instruction.accounts, 4)?;
    let observed = plan
        .current_observation
        .ordered_accounts
        .iter()
        .find(|account| account.address == address.to_string())
        .ok_or_else(|| invalid("series book is not observed"))?;
    let digest = hash(&bytes)
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if BASE64.encode(&bytes) != *witness
        || observed.owner.as_deref() != Some(CURRENT_PROGRAM_ID.to_string().as_str())
        || observed.executable != Some(false)
        || observed.data_length.as_deref() != Some(bytes.len().to_string().as_str())
        || observed.data_sha256.as_deref() != Some(digest.as_str())
    {
        return Err(invalid(
            "series-book witness differs from finalized observation",
        ));
    }
    let book = crate::writer_sleeve::decode_writer_series_book(
        crate::protocol::CurrentAccountData {
            address,
            owner: CURRENT_PROGRAM_ID,
            executable: false,
            data: &bytes,
        },
        &CURRENT_PROGRAM_ID,
        &key(&instruction.accounts, 2)?,
        &key(&instruction.accounts, 3)?,
    )
    .map_err(|_| invalid("series-book witness is not canonical"))?;
    let market = key(&instruction.accounts, 5)?;
    let matches = book
        .records
        .iter()
        .take(usize::from(book.series_count))
        .enumerate()
        .filter(|(_, record)| record.market == market)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(invalid("collective claim must select one book record"));
    }
    let (index, record) = matches[0];
    let amount = instruction_u64(&instruction.data, 1)?;
    if !record.active
        || record.contract_mint != key(&instruction.accounts, 6)?
        || record.retirement_custody != key(&instruction.accounts, 8)?
        || amount == 0
    {
        return Err(invalid("collective claim record differs from instruction"));
    }
    let fields = plan
        .semantic
        .as_object()
        .ok_or_else(|| invalid("semantic is not an object"))?;
    require_semantic_keys(
        fields,
        &[
            "amountAtoms",
            "claimVariant",
            "owner",
            "seriesIndex",
            "sleeve",
        ],
    )?;
    require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
    require_semantic_pubkey(fields, "sleeve", key(&instruction.accounts, 2)?)?;
    require_semantic_literal(fields, "claimVariant", "collective_long")?;
    require_semantic_u8(fields, "seriesIndex", index as u8)?;
    require_semantic_u64(fields, "amountAtoms", amount)
}

fn require_writer_semantic_binding(
    operation: WriterOperationKind,
    semantic: &Value,
    instructions: &[Instruction],
) -> Result<(), WriterOperationError> {
    let [instruction] = instructions else {
        return Err(invalid(
            "one public writer semantic must bind exactly one native instruction",
        ));
    };
    let fields = semantic
        .as_object()
        .ok_or_else(|| invalid("writer semantic is not an object"))?;
    match operation {
        WriterOperationKind::WriterLiquidityPolicyBegin | WriterOperationKind::WriterLiquidityPolicyAppend
        | WriterOperationKind::WriterLiquidityPolicySeal | WriterOperationKind::WriterLiquidityInitialize
        | WriterOperationKind::WriterLiquidityAdd | WriterOperationKind::WriterLiquidityRemove | WriterOperationKind::WriterLiquiditySweep => {
            require_writer_liquidity_semantic(operation, fields, instruction)?;
        }
        WriterOperationKind::WithdrawPrincipal => {
            require_semantic_keys(fields, &["amountAtoms", "owner", "sleeve"])?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "sleeve", key(&instruction.accounts, 2)?)?;
            require_semantic_u64(fields, "amountAtoms", instruction_u64(&instruction.data, 1)?)?;
            if instruction.data.len() != 9 || instruction_u64(&instruction.data, 1)? == 0 { return Err(invalid("principal withdrawal requires positive exact u64")); }
        }
        WriterOperationKind::AuctionRefund => {
            require_semantic_keys(fields, &["auction", "bid", "owner"])?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "auction", key(&instruction.accounts, 2)?)?;
            require_semantic_pubkey(fields, "bid", key(&instruction.accounts, 4)?)?;
            if instruction.data.len() != 1 { return Err(invalid("auction refund has no user amount or destination")); }
        }
        WriterOperationKind::Deposit => {
            require_semantic_keys(fields, &["owner", "principalAtoms", "sleeve"])?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "sleeve", key(&instruction.accounts, 2)?)?;
            require_semantic_u64(
                fields,
                "principalAtoms",
                instruction_u64(&instruction.data, 1)?,
            )?;
        }
        WriterOperationKind::Bid => {
            require_semantic_keys(
                fields,
                &[
                    "auction",
                    "owner",
                    "pricePerContractAtoms",
                    "quantityAtoms",
                    "seriesIndex",
                ],
            )?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "auction", key(&instruction.accounts, 2)?)?;
            require_semantic_u8(fields, "seriesIndex", instruction_u8(&instruction.data, 9)?)?;
            require_semantic_u64(
                fields,
                "pricePerContractAtoms",
                instruction_u64(&instruction.data, 11)?,
            )?;
            require_semantic_u64(
                fields,
                "quantityAtoms",
                instruction_u64(&instruction.data, 19)?,
            )?;
        }
        WriterOperationKind::CloseBegin => {
            require_semantic_keys(
                fields,
                &["flatParAtoms", "minimumWithdrawalAtoms", "owner", "sleeve"],
            )?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "sleeve", key(&instruction.accounts, 2)?)?;
            require_semantic_u64(
                fields,
                "flatParAtoms",
                instruction_u64(&instruction.data, 1)?,
            )?;
            require_semantic_u64(
                fields,
                "minimumWithdrawalAtoms",
                instruction_u64(&instruction.data, 9)?,
            )?;
        }
        WriterOperationKind::CloseBasket => {
            require_semantic_keys(fields, &["closeRequest", "owner"])?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "closeRequest", key(&instruction.accounts, 3)?)?;
        }
        WriterOperationKind::CloseFinalize => {
            require_semantic_keys(fields, &["closeRequest", "owner"])?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "closeRequest", key(&instruction.accounts, 6)?)?;
        }
        WriterOperationKind::CloseCancel => {
            require_semantic_keys(fields, &["closeRequest", "owner"])?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            let close_request_index =
                if instruction.data.get(1) == Some(&WRITER_CLOSE_FLAT_SENTINEL) {
                    2
                } else {
                    3
                };
            require_semantic_pubkey(
                fields,
                "closeRequest",
                key(&instruction.accounts, close_request_index)?,
            )?;
        }
        WriterOperationKind::SettlementClaimFlat => {
            require_semantic_keys(
                fields,
                &[
                    "amountAtoms",
                    "claimVariant",
                    "owner",
                    "seriesIndex",
                    "sleeve",
                ],
            )?;
            require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
            require_semantic_pubkey(fields, "sleeve", key(&instruction.accounts, 2)?)?;
            require_semantic_literal(fields, "claimVariant", "flat_residual")?;
            require_semantic_u8(fields, "seriesIndex", u8::MAX)?;
            require_semantic_u64(
                fields,
                "amountAtoms",
                instruction_u64(&instruction.data, 1)?,
            )?;
        }
        WriterOperationKind::SettlementClaimCollective => {
            return Err(invalid(
                "collective claim series index is not bound by the RC44 native instruction",
            ));
        }
    }
    Ok(())
}

fn require_writer_liquidity_semantic(
    operation: WriterOperationKind, fields: &Map<String, Value>, instruction: &Instruction,
) -> Result<(), WriterOperationError> {
    use ameba_spread_historical::writer_dlmm_instruction::ManageWriterDlmmV1Params as Action;
    if instruction.data.first() != Some(&159) { return Err(invalid("writer liquidity outer tag differs")); }
    let action = Action::decode_exact(&instruction.data[1..]).map_err(|_| invalid("writer liquidity payload is invalid"))?;
    let policy_action = matches!(operation, WriterOperationKind::WriterLiquidityPolicyBegin
        | WriterOperationKind::WriterLiquidityPolicyAppend | WriterOperationKind::WriterLiquidityPolicySeal);
    require_semantic_pubkey(fields, "owner", key(&instruction.accounts, 0)?)?;
    require_semantic_pubkey(fields, "sleeve", key(&instruction.accounts, if policy_action { 3 } else { 2 })?)?;
    match (operation, action) {
        (WriterOperationKind::WriterLiquidityPolicyBegin, Action::BeginPolicy(params)) => {
            require_semantic_keys(fields, &["owner", "sleeve", "managementAuthority", "expectedPolicyHash",
                "monthlyBuybackCapAtoms", "transactionBuybackCapAtoms", "reserveReleaseSpendRatioPpm", "priceSeparationTicks"])?;
            require_semantic_pubkey(fields, "managementAuthority", params.management_authority)?;
            let policy_hash = params.expected_policy_hash.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            require_semantic_literal(fields, "expectedPolicyHash", &policy_hash)?;
            require_semantic_u64(fields, "monthlyBuybackCapAtoms", params.monthly_buyback_cap_atoms)?;
            require_semantic_u64(fields, "transactionBuybackCapAtoms", params.transaction_buyback_cap_atoms)?;
            require_semantic_u64(fields, "reserveReleaseSpendRatioPpm", params.reserve_release_spend_ratio_ppm)?;
            require_semantic_number(fields, "priceSeparationTicks", u64::from(params.price_separation_ticks))?;
            if params.management_authority == Pubkey::default() || params.expected_policy_hash == [0; 32]
                || params.reserve_release_spend_ratio_ppm > 1_000_000 || params.price_separation_ticks == 0 {
                return Err(invalid("writer liquidity policy values are outside native bounds"));
            }
        }
        (WriterOperationKind::WriterLiquidityPolicyAppend, Action::AppendPolicySeries { start_index, entries }) => {
            require_semantic_keys(fields, &["owner", "sleeve", "startIndex", "entries"])?;
            require_semantic_u8(fields, "startIndex", start_index)?;
            if usize::from(start_index) + entries.len() > 20 { return Err(invalid("policy append range exceeds series capacity")); }
            let values = liquidity_semantic_entries(fields, entries.len())?;
            for (value, entry) in values.iter().zip(&entries) {
                let row = value.as_object().ok_or_else(|| invalid("policy series entry must be an object"))?;
                require_semantic_keys(row, &["conservativeClaimValueAtoms", "sellerFloorQuoteAtoms", "monthlyBuybackCapAtoms", "transactionBuybackCapAtoms"])?;
                require_semantic_u64(row, "conservativeClaimValueAtoms", entry.conservative_claim_value_atoms)?;
                require_semantic_u64(row, "sellerFloorQuoteAtoms", entry.seller_floor_quote_atoms)?;
                require_semantic_u64(row, "monthlyBuybackCapAtoms", entry.monthly_buyback_cap_atoms)?;
                require_semantic_u64(row, "transactionBuybackCapAtoms", entry.transaction_buyback_cap_atoms)?;
            }
        }
        (WriterOperationKind::WriterLiquidityPolicySeal, Action::SealPolicy) => require_semantic_keys(fields, &["owner", "sleeve"] )?,
        (WriterOperationKind::WriterLiquidityInitialize, Action::InitializePosition { series_index })
        | (WriterOperationKind::WriterLiquiditySweep, Action::SweepCash { series_index }) => {
            require_semantic_keys(fields, &["owner", "sleeve", "seriesIndex"])?;
            require_semantic_u8(fields, "seriesIndex", series_index)?;
            if series_index >= 20 { return Err(invalid("liquidity series index exceeds native capacity")); }
        }
        (WriterOperationKind::WriterLiquidityAdd, Action::AddLiquidity { series_index, issue_amount_atoms, entries }) => {
            require_semantic_keys(fields, &["owner", "sleeve", "seriesIndex", "issueAmountAtoms", "entries"])?;
            require_semantic_u8(fields, "seriesIndex", series_index)?;
            require_semantic_u64(fields, "issueAmountAtoms", issue_amount_atoms)?;
            require_liquidity_bin_semantic(fields, &entries, true)?;
            let total = entries.iter().try_fold(0_u64, |sum, entry| sum.checked_add(entry.option_atoms))
                .ok_or_else(|| invalid("writer option placement overflows u64"))?;
            if series_index >= 20 || issue_amount_atoms % 1_000_000 != 0 || total != issue_amount_atoms {
                return Err(invalid("writer issuance and placement differ"));
            }
        }
        (WriterOperationKind::WriterLiquidityRemove, Action::RemoveLiquidity { series_index, entries }) => {
            require_semantic_keys(fields, &["owner", "sleeve", "seriesIndex", "entries"])?;
            require_semantic_u8(fields, "seriesIndex", series_index)?;
            require_liquidity_bin_semantic(fields, &entries, false)?;
            if series_index >= 20 { return Err(invalid("liquidity series index exceeds native capacity")); }
        }
        _ => return Err(invalid("writer liquidity selector differs from requested operation")),
    }
    Ok(())
}

fn liquidity_semantic_entries(fields: &Map<String, Value>, count: usize) -> Result<&Vec<Value>, WriterOperationError> {
    let values = fields.get("entries").and_then(Value::as_array).ok_or_else(|| invalid("liquidity entries must be an array"))?;
    if count == 0 || count > 8 || values.len() != count { return Err(invalid("liquidity entries differ from bounded native payload")); }
    Ok(values)
}

fn require_liquidity_bin_semantic(fields: &Map<String, Value>, entries: &[ameba_spread_historical::state::WriterDlmmBinV1], add: bool) -> Result<(), WriterOperationError> {
    let values = liquidity_semantic_entries(fields, entries.len())?;
    let option_field = if add { "maximumOptionAmountAtoms" } else { "optionAmountAtoms" };
    let quote_field = if add { "maximumQuoteAmountAtoms" } else { "quoteAmountAtoms" };
    let mut previous = 0;
    for (value, entry) in values.iter().zip(entries) {
        let row = value.as_object().ok_or_else(|| invalid("liquidity bin entry must be an object"))?;
        require_semantic_keys(row, &["binId", option_field, quote_field])?;
        require_semantic_number(row, "binId", u64::from(entry.bin_id))?;
        require_semantic_u64(row, option_field, entry.option_atoms)?;
        require_semantic_u64(row, quote_field, entry.quote_atoms)?;
        if entry.bin_id <= previous || entry.bin_id > 2048 || (entry.option_atoms == 0 && entry.quote_atoms == 0) {
            return Err(invalid("liquidity bins must be ascending positive native allocations"));
        }
        previous = entry.bin_id;
    }
    Ok(())
}

fn require_semantic_keys(
    fields: &Map<String, Value>,
    expected: &[&str],
) -> Result<(), WriterOperationError> {
    let actual = fields.keys().map(String::as_str).collect::<HashSet<_>>();
    let expected = expected.iter().copied().collect::<HashSet<_>>();
    if actual != expected {
        return Err(invalid(
            "writer semantic fields are not the exact public operation schema",
        ));
    }
    Ok(())
}

fn require_semantic_pubkey(
    fields: &Map<String, Value>,
    field: &str,
    expected: Pubkey,
) -> Result<(), WriterOperationError> {
    let value = fields
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("writer semantic public key is missing"))?;
    if canonical_pubkey(value)? != expected {
        return Err(invalid(
            "writer semantic public key does not match the native instruction",
        ));
    }
    Ok(())
}

fn require_semantic_u64(
    fields: &Map<String, Value>,
    field: &str,
    expected: u64,
) -> Result<(), WriterOperationError> {
    let value = fields
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("writer semantic amount is missing"))?;
    if canonical_u64(value)? != expected {
        return Err(invalid(
            "writer semantic amount does not match the native instruction",
        ));
    }
    Ok(())
}

fn require_semantic_u8(
    fields: &Map<String, Value>,
    field: &str,
    expected: u8,
) -> Result<(), WriterOperationError> {
    let value = fields
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
        .ok_or_else(|| invalid("writer semantic integer is missing"))?;
    if value != expected {
        return Err(invalid(
            "writer semantic integer does not match the native instruction",
        ));
    }
    Ok(())
}

fn require_semantic_literal(
    fields: &Map<String, Value>,
    field: &str,
    expected: &str,
) -> Result<(), WriterOperationError> {
    if fields.get(field).and_then(Value::as_str) != Some(expected) {
        return Err(invalid(
            "writer semantic operation does not match the native instruction",
        ));
    }
    Ok(())
}

fn require_semantic_number(
    fields: &Map<String, Value>,
    name: &str,
    expected: u64,
) -> Result<(), WriterOperationError> {
    if fields.get(name).and_then(Value::as_u64) != Some(expected) {
        return Err(invalid("writer numeric semantic mismatch"));
    }
    Ok(())
}

fn instruction_u8(data: &[u8], offset: usize) -> Result<u8, WriterOperationError> {
    data.get(offset)
        .copied()
        .ok_or_else(|| invalid("writer instruction integer is truncated"))
}

fn instruction_u64(data: &[u8], offset: usize) -> Result<u64, WriterOperationError> {
    data.get(offset..offset + 8)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or_else(|| invalid("writer instruction amount is truncated"))
}

fn rebuild_instruction(
    operation: WriterOperationKind,
    manifest: &WriterInstructionManifest,
) -> Result<Instruction, WriterOperationError> {
    if manifest.program_id != CURRENT_PROGRAM_ID.to_string() || manifest.data_base64.len() > 21_848
    {
        return Err(invalid("writer instruction program or size is invalid"));
    }
    let data = BASE64
        .decode(&manifest.data_base64)
        .map_err(|_| invalid("writer instruction data is not canonical base64"))?;
    if data.is_empty()
        || data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES
        || BASE64.encode(&data) != manifest.data_base64
        || data[0] != manifest.instruction_tag
    {
        return Err(invalid("writer instruction data is not canonical"));
    }
    let decoded = decode_current_writer_instruction(&data)
        .map_err(|_| invalid("writer instruction payload is not current"))?;
    let metas = manifest
        .accounts
        .iter()
        .map(|meta| {
            Ok(AccountMeta {
                pubkey: canonical_pubkey(&meta.address)?,
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
        })
        .collect::<Result<Vec<_>, WriterOperationError>>()?;

    let rebuilt = match (operation, decoded) {
        (kind, VaultInstruction::ManageWriterDlmmV1 { params }) if is_writer_liquidity_operation(kind) => {
            use crate::writer_dlmm::*;
            require_name(manifest, "ManageWriterDlmmV1")?;
            let selector = match kind {
                WriterOperationKind::WriterLiquidityPolicyBegin => 0,
                WriterOperationKind::WriterLiquidityPolicyAppend => 1,
                WriterOperationKind::WriterLiquidityPolicySeal => 2,
                WriterOperationKind::WriterLiquidityInitialize => 3,
                WriterOperationKind::WriterLiquidityAdd => 4,
                WriterOperationKind::WriterLiquidityRemove => 5,
                WriterOperationKind::WriterLiquiditySweep => 6,
                _ => return Err(invalid("writer DLMM action mismatch")),
            };
            require(params.selector() == selector)?;
            require_len(&metas, if selector < 3 { 9 } else if selector == 3 { 12 } else { 27 })?;
            let sleeve = key(&metas, if selector < 3 { 3 } else { 2 })?;
            let group = key(&metas, if selector < 3 { 4 } else { 3 })?;
            require(key(&metas, 1)? == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
                && sleeve == derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &group).0
                && key(&metas, if selector < 3 { 5 } else { 4 })? == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0)?;
            let accounts = if selector < 3 {
                require(key(&metas, 2)? == crate::writer_sleeve::derive_writer_policy_registry_pda(&CURRENT_PROGRAM_ID).0)?;
                WriterDlmmAccountsV1::Policy(WriterDlmmPolicyAccountsV1 { actor: key(&metas, 0)?, vault_config: key(&metas, 1)?,
                    policy_registry: key(&metas, 2)?, sleeve, settlement_group: group, series_book: key(&metas, 5)?, policy_snapshot: key(&metas, 6)? })
            } else {
                let pool = key(&metas, if selector == 3 { 7 } else { 9 })?;
                let market = key(&metas, if selector == 3 { 9 } else { 7 })?;
                require(pool == crate::ameba_dlmm_state::derive_ameba_dlmm_pool_pda(&CURRENT_PROGRAM_ID, &market).0)?;
                let position = WriterDlmmPositionAccountsV1 { actor: key(&metas, 0)?, vault_config: key(&metas, 1)?, sleeve,
                    settlement_group: group, series_book: key(&metas, 4)?, policy_snapshot: key(&metas, 5)?, pool, market,
                    oracle_month: key(&metas, if selector == 3 { 10 } else { 8 })? };
                if selector == 3 { WriterDlmmAccountsV1::Position(position) } else {
                    let option_mint = key(&metas, 12)?; let quote_mint = key(&metas, 13)?;
                    require(key(&metas, 14)? == crate::ameba_dlmm_state::derive_ameba_dlmm_vault_pda(&CURRENT_PROGRAM_ID, &pool, &option_mint).0
                        && key(&metas, 15)? == crate::ameba_dlmm_state::derive_ameba_dlmm_vault_pda(&CURRENT_PROGRAM_ID, &pool, &quote_mint).0
                        && key(&metas, 16)? == derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
                        && key(&metas, 17)? == crate::protocol::derive_contract_mint_staging_pda(&CURRENT_PROGRAM_ID, &market).0
                        && key(&metas, 18)? == crate::writer_sleeve::derive_writer_retirement_custody_pda(&CURRENT_PROGRAM_ID, &sleeve, &market).0
                        && key(&metas, 19)? == CURRENT_LIGHT_TOKEN_PROGRAM_ID && key(&metas, 20)? == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
                        && key(&metas, 21)? == derive_light_spl_interface_pda(&option_mint).0
                        && key(&metas, 22)? == derive_light_spl_interface_pda(&quote_mint).0
                        && key(&metas, 23)? == CURRENT_SPL_TOKEN_PROGRAM_ID && key(&metas, 25)? == LIGHT_TOKEN_COMPRESSIBLE_CONFIG
                        && key(&metas, 26)? == LIGHT_TOKEN_RENT_SPONSOR)?;
                    WriterDlmmAccountsV1::Liquidity(WriterDlmmLiquidityAccountsV1 { position, option_mint, quote_mint,
                        option_vault: key(&metas, 14)?, quote_vault: key(&metas, 15)?, sleeve_usdc_vault: key(&metas, 16)?,
                        market_staging: key(&metas, 17)?, retirement_custody: key(&metas, 18)?, light_token_program: key(&metas, 19)?,
                        compressed_token_authority: key(&metas, 20)?, option_spl_interface: key(&metas, 21)?, quote_spl_interface: key(&metas, 22)?,
                        spl_token_program: key(&metas, 23)?, compressible_config: key(&metas, 25)?, rent_sponsor: key(&metas, 26)? })
                }
            };
            build_manage_writer_dlmm_instruction_v1(CURRENT_PROGRAM_ID, accounts, params)
        }
        (WriterOperationKind::WithdrawPrincipal, VaultInstruction::WithdrawWriterPrincipalV1 { params }) => {
            require_name(manifest, "WithdrawWriterPrincipalV1")?;
            require_len(&metas, 14)?;
            let sleeve = key(&metas, 2)?; let mint = key(&metas, 6)?;
            require(key(&metas, 1)? == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
                && key(&metas, 3)? == derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
                && mint == derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0
                && key(&metas, 7)? == light_token::instruction::derive_associated_token_account(&key(&metas, 0)?, &mint)
                && key(&metas, 8)? == derive_writer_flat_burn_custody_pda(&CURRENT_PROGRAM_ID, &sleeve).0
                && key(&metas, 9)? == derive_light_spl_interface_pda(&mint).0
                && key(&metas, 10)? == CURRENT_LIGHT_TOKEN_PROGRAM_ID
                && key(&metas, 11)? == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
                && key(&metas, 12)? == CURRENT_SPL_TOKEN_PROGRAM_ID && key(&metas, 13)? == CURRENT_SYSTEM_PROGRAM_ID)?;
            build_withdraw_writer_principal_instruction(CURRENT_PROGRAM_ID, WithdrawWriterPrincipalAccounts {
                depositor: key(&metas, 0)?, vault_config: key(&metas, 1)?, sleeve,
                sleeve_usdc_vault: key(&metas, 3)?, depositor_usdc_destination: key(&metas, 4)?, settlement_mint: key(&metas, 5)?,
                flat_mint: mint, depositor_flat_source: key(&metas, 7)?, flat_burn_custody: key(&metas, 8)?, flat_spl_interface: key(&metas, 9)?,
                light_token_program: key(&metas, 10)?, compressed_token_authority: key(&metas, 11)?, spl_token_program: key(&metas, 12)?, system_program: key(&metas, 13)?,
            }, params.amount_atoms)
        }
        (WriterOperationKind::AuctionRefund, VaultInstruction::CancelOrRefundWriterBidV1) => {
            require_name(manifest, "CancelOrRefundWriterBidV1")?; require_len(&metas, 9)?;
            let auction = key(&metas, 2)?;
            require(key(&metas, 3)? == derive_writer_bid_index_pda(&CURRENT_PROGRAM_ID, &auction).0
                && key(&metas, 5)? == derive_writer_auction_escrow_pda(&CURRENT_PROGRAM_ID, &auction).0
                && key(&metas, 8)? == CURRENT_SPL_TOKEN_PROGRAM_ID)?;
            build_cancel_or_refund_writer_bid_instruction(CURRENT_PROGRAM_ID, CancelOrRefundWriterBidAccounts {
                actor: key(&metas, 0)?, sleeve: key(&metas, 1)?, auction, bid_index: key(&metas, 3)?, bid: key(&metas, 4)?,
                auction_escrow: key(&metas, 5)?, refund_token_account: key(&metas, 6)?, settlement_mint: key(&metas, 7)?, spl_token_program: key(&metas, 8)?,
            })
        }
        (WriterOperationKind::Deposit, VaultInstruction::DepositWriterPrincipalV1 { params }) => {
            require_name(manifest, "DepositWriterPrincipalV1")?;
            require_len(&metas, 18)?;
            require_deposit_identities(&metas)?;
            build_deposit_writer_principal_instruction(
                CURRENT_PROGRAM_ID,
                DepositWriterPrincipalAccounts {
                    depositor: key(&metas, 0)?,
                    vault_config: key(&metas, 1)?,
                    sleeve: key(&metas, 2)?,
                    policy_snapshot: key(&metas, 3)?,
                    sleeve_usdc_vault: key(&metas, 4)?,
                    depositor_usdc_source: key(&metas, 5)?,
                    settlement_mint: key(&metas, 6)?,
                    flat_mint: key(&metas, 7)?,
                    flat_staging: key(&metas, 8)?,
                    depositor_flat_destination: key(&metas, 9)?,
                    light_token_program: key(&metas, 10)?,
                    compressed_token_authority: key(&metas, 11)?,
                    spl_interface: key(&metas, 12)?,
                    spl_token_program: key(&metas, 13)?,
                    system_program: key(&metas, 14)?,
                    compressible_config: key(&metas, 15)?,
                    rent_sponsor: key(&metas, 16)?,
                },
                params.amount_atoms,
            )
        }
        (WriterOperationKind::Bid, VaultInstruction::PlaceWriterBidV1 { params }) => {
            require_name(manifest, "PlaceWriterBidV1")?;
            require_len(&metas, 13)?;
            require_bid_identities(&metas, params.order_id)?;
            build_place_writer_bid_instruction(
                CURRENT_PROGRAM_ID,
                PlaceWriterBidAccounts {
                    bidder: key(&metas, 0)?,
                    sleeve: key(&metas, 1)?,
                    auction: key(&metas, 2)?,
                    bid_index: key(&metas, 3)?,
                    bid: key(&metas, 4)?,
                    series_book: key(&metas, 5)?,
                    policy_snapshot: key(&metas, 6)?,
                    bidder_usdc_source: key(&metas, 7)?,
                    auction_escrow: key(&metas, 8)?,
                    settlement_mint: key(&metas, 9)?,
                    claim_destination: key(&metas, 10)?,
                    spl_token_program: key(&metas, 11)?,
                },
                params,
            )
        }
        (WriterOperationKind::CloseBegin, VaultInstruction::BeginWriterCloseV1 { params }) => {
            require_name(manifest, "BeginWriterCloseV1")?;
            require_len(&metas, 15)?;
            require_close_begin_identities(&metas)?;
            build_begin_writer_close_instruction(
                CURRENT_PROGRAM_ID,
                BeginWriterCloseAccounts {
                    owner: key(&metas, 0)?,
                    vault_config: key(&metas, 1)?,
                    sleeve: key(&metas, 2)?,
                    settlement_group: key(&metas, 3)?,
                    series_book: key(&metas, 4)?,
                    policy_snapshot: key(&metas, 5)?,
                    close_request: key(&metas, 6)?,
                    flat_mint: key(&metas, 7)?,
                    owner_flat_source: key(&metas, 8)?,
                    close_flat_escrow: key(&metas, 9)?,
                    flat_spl_interface: key(&metas, 10)?,
                    light_token_program: key(&metas, 11)?,
                    compressed_token_authority: key(&metas, 12)?,
                    spl_token_program: key(&metas, 13)?,
                },
                params,
            )
        }
        (
            WriterOperationKind::CloseBasket,
            VaultInstruction::DepositWriterCloseBasketV1 { params },
        ) => {
            require_name(manifest, "DepositWriterCloseBasketV1")?;
            require_len(&metas, 13)?;
            require_close_basket_identities(&metas)?;
            build_deposit_writer_close_basket_instruction(
                CURRENT_PROGRAM_ID,
                DepositWriterCloseBasketAccounts {
                    owner: key(&metas, 0)?,
                    sleeve: key(&metas, 1)?,
                    series_book: key(&metas, 2)?,
                    close_request: key(&metas, 3)?,
                    market: key(&metas, 4)?,
                    contract_mint: key(&metas, 5)?,
                    owner_claim_source: key(&metas, 6)?,
                    retirement_custody: key(&metas, 7)?,
                    contract_spl_interface: key(&metas, 8)?,
                    light_token_program: key(&metas, 9)?,
                    compressed_token_authority: key(&metas, 10)?,
                    spl_token_program: key(&metas, 11)?,
                },
                params.series_index,
            )
        }
        (WriterOperationKind::CloseFinalize, VaultInstruction::FinalizeWriterCloseV1) => {
            require_name(manifest, "FinalizeWriterCloseV1")?;
            if !(17..=74).contains(&metas.len()) || (metas.len() - 14) % 3 != 0 {
                return Err(invalid("close finalize account count is invalid"));
            }
            require_close_finalize_identities(&metas)?;
            build_finalize_writer_close_instruction(
                CURRENT_PROGRAM_ID,
                FinalizeWriterCloseAccounts {
                    owner: key(&metas, 0)?,
                    vault_config: key(&metas, 1)?,
                    sleeve: key(&metas, 2)?,
                    settlement_group: key(&metas, 3)?,
                    series_book: key(&metas, 4)?,
                    policy_snapshot: key(&metas, 5)?,
                    close_request: key(&metas, 6)?,
                    sleeve_usdc_vault: key(&metas, 7)?,
                    owner_usdc_destination: key(&metas, 8)?,
                    settlement_mint: key(&metas, 9)?,
                    flat_mint: key(&metas, 10)?,
                    close_flat_escrow: key(&metas, 11)?,
                    spl_token_program: key(&metas, 12)?,
                    series_burn_accounts_in_book_order: metas[14..]
                        .chunks_exact(3)
                        .map(|roles| [roles[0].pubkey, roles[1].pubkey, roles[2].pubkey])
                        .collect(),
                },
            )
        }
        (
            WriterOperationKind::CloseCancel,
            VaultInstruction::ProcessWriterCloseCancellationV1 { params },
        ) if params.selector == WRITER_CLOSE_FLAT_SENTINEL => {
            require_name(manifest, "ProcessWriterCloseCancellationV1")?;
            require_len(&metas, 11)?;
            require_close_flat_cancellation_identities(&metas)?;
            build_process_writer_close_flat_cancellation_instruction(
                CURRENT_PROGRAM_ID,
                ProcessWriterCloseFlatCancellationAccounts {
                    actor: key(&metas, 0)?,
                    sleeve: key(&metas, 1)?,
                    close_request: key(&metas, 2)?,
                    flat_mint: key(&metas, 3)?,
                    close_flat_escrow: key(&metas, 4)?,
                    owner_flat_destination: key(&metas, 5)?,
                    flat_spl_interface: key(&metas, 6)?,
                    light_token_program: key(&metas, 7)?,
                    compressed_token_authority: key(&metas, 8)?,
                    spl_token_program: key(&metas, 9)?,
                },
            )
        }
        (
            WriterOperationKind::CloseCancel,
            VaultInstruction::ProcessWriterCloseCancellationV1 { params },
        ) => {
            require_name(manifest, "ProcessWriterCloseCancellationV1")?;
            require_len(&metas, 13)?;
            require_close_series_cancellation_identities(&metas)?;
            build_process_writer_close_series_cancellation_instruction(
                CURRENT_PROGRAM_ID,
                ProcessWriterCloseSeriesCancellationAccounts {
                    actor: key(&metas, 0)?,
                    sleeve: key(&metas, 1)?,
                    series_book: key(&metas, 2)?,
                    close_request: key(&metas, 3)?,
                    market: key(&metas, 4)?,
                    contract_mint: key(&metas, 5)?,
                    retirement_custody: key(&metas, 6)?,
                    owner_claim_destination: key(&metas, 7)?,
                    contract_spl_interface: key(&metas, 8)?,
                    light_token_program: key(&metas, 9)?,
                    compressed_token_authority: key(&metas, 10)?,
                    spl_token_program: key(&metas, 11)?,
                },
                params.selector,
            )
        }
        (
            WriterOperationKind::SettlementClaimCollective,
            VaultInstruction::ClaimCollectiveLongV1 { params },
        ) => {
            require_name(manifest, "ClaimCollectiveLongV1")?;
            require_len(&metas, 20)?;
            require_collective_claim_identities(&metas)?;
            build_claim_collective_long_instruction(
                CURRENT_PROGRAM_ID,
                ClaimCollectiveLongAccounts {
                    holder: key(&metas, 0)?,
                    vault_config: key(&metas, 1)?,
                    sleeve: key(&metas, 2)?,
                    settlement_group: key(&metas, 3)?,
                    series_book: key(&metas, 4)?,
                    market: key(&metas, 5)?,
                    contract_mint: key(&metas, 6)?,
                    holder_claim_source: key(&metas, 7)?,
                    retirement_custody: key(&metas, 8)?,
                    contract_spl_interface: key(&metas, 9)?,
                    sleeve_usdc_vault: key(&metas, 10)?,
                    holder_usdc_destination: key(&metas, 11)?,
                    settlement_mint: key(&metas, 12)?,
                    usdc_spl_interface: key(&metas, 13)?,
                    light_token_program: key(&metas, 14)?,
                    compressed_token_authority: key(&metas, 15)?,
                    spl_token_program: key(&metas, 16)?,
                    compressible_config: key(&metas, 18)?,
                    rent_sponsor: key(&metas, 19)?,
                },
                params.claim_atoms,
            )
        }
        (
            WriterOperationKind::SettlementClaimFlat,
            VaultInstruction::ClaimWriterFlatResidualV1 { params },
        ) => {
            require_name(manifest, "ClaimWriterFlatResidualV1")?;
            require_len(&metas, 17)?;
            require_flat_claim_identities(&metas)?;
            build_claim_writer_flat_residual_instruction(
                CURRENT_PROGRAM_ID,
                ClaimWriterFlatResidualAccounts {
                    holder: key(&metas, 0)?,
                    vault_config: key(&metas, 1)?,
                    sleeve: key(&metas, 2)?,
                    flat_mint: key(&metas, 3)?,
                    holder_flat_source: key(&metas, 4)?,
                    flat_burn_custody: key(&metas, 5)?,
                    flat_spl_interface: key(&metas, 6)?,
                    sleeve_usdc_vault: key(&metas, 7)?,
                    holder_usdc_destination: key(&metas, 8)?,
                    settlement_mint: key(&metas, 9)?,
                    usdc_spl_interface: key(&metas, 10)?,
                    light_token_program: key(&metas, 11)?,
                    compressed_token_authority: key(&metas, 12)?,
                    spl_token_program: key(&metas, 13)?,
                    compressible_config: key(&metas, 15)?,
                    rent_sponsor: key(&metas, 16)?,
                },
                params.flat_atoms,
            )
        }
        _ => return Err(invalid("writer operation and instruction tag do not match")),
    }
    .map_err(|_| invalid("writer instruction does not satisfy its native builder"))?;
    if rebuilt.data != data || rebuilt.accounts != metas || rebuilt.program_id != CURRENT_PROGRAM_ID
    {
        return Err(invalid(
            "writer instruction differs from native reconstruction",
        ));
    }
    Ok(rebuilt)
}

fn require_deposit_identities(a: &[AccountMeta]) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 2)?;
    let flat_mint = key(a, 7)?;
    require(
        a[1].pubkey == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
            && a[4].pubkey == derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[7].pubkey == derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[8].pubkey == derive_writer_flat_staging_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[10].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[11].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[12].pubkey == derive_light_spl_interface_pda(&flat_mint).0
            && a[13].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[14].pubkey == CURRENT_SYSTEM_PROGRAM_ID
            && a[15].pubkey == LIGHT_TOKEN_COMPRESSIBLE_CONFIG
            && a[16].pubkey == LIGHT_TOKEN_RENT_SPONSOR
            && a[17].pubkey == crate::writer_dlmm::derive_writer_dlmm_policy_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
    )
}

fn require_bid_identities(a: &[AccountMeta], order_id: u64) -> Result<(), WriterOperationError> {
    let bidder = key(a, 0)?;
    let sleeve = key(a, 1)?;
    let auction = key(a, 2)?;
    require(
        a[3].pubkey == derive_writer_bid_index_pda(&CURRENT_PROGRAM_ID, &auction).0
            && a[4].pubkey
                == derive_writer_bid_pda(&CURRENT_PROGRAM_ID, &auction, &bidder, order_id).0
            && a[5].pubkey == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[8].pubkey == derive_writer_auction_escrow_pda(&CURRENT_PROGRAM_ID, &auction).0
            && a[11].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[12].pubkey == CURRENT_SYSTEM_PROGRAM_ID,
    )
}

fn require_close_begin_identities(a: &[AccountMeta]) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 2)?;
    let group = key(a, 3)?;
    let request = key(a, 6)?;
    let flat = key(a, 7)?;
    require(
        a[1].pubkey == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
            && sleeve == derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &group).0
            && a[4].pubkey == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && flat == derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[9].pubkey == derive_writer_close_flat_escrow_pda(&CURRENT_PROGRAM_ID, &request).0
            && a[10].pubkey == derive_light_spl_interface_pda(&flat).0
            && a[11].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[12].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[13].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[14].pubkey == CURRENT_SYSTEM_PROGRAM_ID,
    )
}

fn require_close_basket_identities(a: &[AccountMeta]) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 1)?;
    let market = key(a, 4)?;
    let mint = key(a, 5)?;
    require(
        a[2].pubkey == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[7].pubkey
                == derive_writer_retirement_custody_pda(&CURRENT_PROGRAM_ID, &sleeve, &market).0
            && a[8].pubkey == derive_light_spl_interface_pda(&mint).0
            && a[9].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[10].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[11].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[12].pubkey == CURRENT_SYSTEM_PROGRAM_ID,
    )
}

fn require_close_finalize_identities(a: &[AccountMeta]) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 2)?;
    let group = key(a, 3)?;
    let request = key(a, 6)?;
    for roles in a[14..].chunks_exact(3) {
        require(
            roles[2].pubkey
                == derive_writer_retirement_custody_pda(
                    &CURRENT_PROGRAM_ID,
                    &sleeve,
                    &roles[0].pubkey,
                )
                .0,
        )?;
    }
    require(
        a[1].pubkey == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
            && sleeve == derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &group).0
            && a[4].pubkey == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[7].pubkey == derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[10].pubkey == derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[11].pubkey == derive_writer_close_flat_escrow_pda(&CURRENT_PROGRAM_ID, &request).0
            && a[12].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[13].pubkey == crate::writer_dlmm::derive_writer_dlmm_policy_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
    )
}

fn require_close_series_cancellation_identities(
    a: &[AccountMeta],
) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 1)?;
    let market = key(a, 4)?;
    let mint = key(a, 5)?;
    require(
        a[2].pubkey == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[6].pubkey
                == derive_writer_retirement_custody_pda(&CURRENT_PROGRAM_ID, &sleeve, &market).0
            && a[8].pubkey == derive_light_spl_interface_pda(&mint).0
            && a[9].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[10].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[11].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[12].pubkey == CURRENT_SYSTEM_PROGRAM_ID,
    )
}

fn require_close_flat_cancellation_identities(
    a: &[AccountMeta],
) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 1)?;
    let request = key(a, 2)?;
    let flat = key(a, 3)?;
    require(
        flat == derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[4].pubkey == derive_writer_close_flat_escrow_pda(&CURRENT_PROGRAM_ID, &request).0
            && a[6].pubkey == derive_light_spl_interface_pda(&flat).0
            && a[7].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[8].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[9].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[10].pubkey == CURRENT_SYSTEM_PROGRAM_ID,
    )
}

fn require_collective_claim_identities(a: &[AccountMeta]) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 2)?;
    let group = key(a, 3)?;
    let market = key(a, 5)?;
    require(
        a[1].pubkey == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
            && sleeve == derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &group).0
            && a[4].pubkey == derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[8].pubkey
                == derive_writer_retirement_custody_pda(&CURRENT_PROGRAM_ID, &sleeve, &market).0
            && a[9].pubkey == derive_light_spl_interface_pda(&a[6].pubkey).0
            && a[10].pubkey == derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[13].pubkey == derive_light_spl_interface_pda(&a[12].pubkey).0
            && a[14].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[15].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[16].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[17].pubkey == CURRENT_SYSTEM_PROGRAM_ID
            && a[18].pubkey == LIGHT_TOKEN_COMPRESSIBLE_CONFIG
            && a[19].pubkey == LIGHT_TOKEN_RENT_SPONSOR,
    )
}

fn require_flat_claim_identities(a: &[AccountMeta]) -> Result<(), WriterOperationError> {
    let sleeve = key(a, 2)?;
    let flat = key(a, 3)?;
    require(
        a[1].pubkey == derive_vault_config_pda(&CURRENT_PROGRAM_ID).0
            && flat == derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[5].pubkey == derive_writer_flat_burn_custody_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[6].pubkey == derive_light_spl_interface_pda(&flat).0
            && a[7].pubkey == derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0
            && a[10].pubkey == derive_light_spl_interface_pda(&a[9].pubkey).0
            && a[11].pubkey == CURRENT_LIGHT_TOKEN_PROGRAM_ID
            && a[12].pubkey == CURRENT_LIGHT_TOKEN_CPI_AUTHORITY
            && a[13].pubkey == CURRENT_SPL_TOKEN_PROGRAM_ID
            && a[14].pubkey == CURRENT_SYSTEM_PROGRAM_ID
            && a[15].pubkey == LIGHT_TOKEN_COMPRESSIBLE_CONFIG
            && a[16].pubkey == LIGHT_TOKEN_RENT_SPONSOR,
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WriterLightAccountExpectation {
    target: Pubkey,
    mint: Pubkey,
    payer: Pubkey,
    required_owner: Option<Pubkey>,
    minimum_requirement: WriterMinimumAmountRequirement,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WriterMinimumAmountRequirement {
    InstructionExact(u64),
    Positive,
    Zero,
}

fn writer_light_account_expectation(
    operation: WriterOperationKind,
    instructions: &[Instruction],
) -> Result<Option<WriterLightAccountExpectation>, WriterOperationError> {
    if !matches!(
        operation,
        WriterOperationKind::WithdrawPrincipal | WriterOperationKind::CloseBegin
            | WriterOperationKind::CloseBasket
            | WriterOperationKind::CloseCancel
            | WriterOperationKind::SettlementClaimCollective | WriterOperationKind::SettlementClaimFlat
    ) {
        return Ok(None);
    }
    if instructions.len() != 1 {
        return Err(invalid(
            "cold-capable writer stage must contain exactly one instruction",
        ));
    }
    let instruction = &instructions[0];
    let decoded = decode_current_writer_instruction(&instruction.data)
        .map_err(|_| invalid("writer Light stage payload is not current"))?;
    let (target_index, mint_index, required_owner, minimum_requirement) = match (operation, decoded)
    {
        (WriterOperationKind::SettlementClaimCollective, VaultInstruction::ClaimCollectiveLongV1 { params })
            if instruction.accounts.len() == 20 => {
            (7, 6, Some(instruction.accounts[0].pubkey), WriterMinimumAmountRequirement::InstructionExact(params.claim_atoms))
        }
        (WriterOperationKind::SettlementClaimFlat, VaultInstruction::ClaimWriterFlatResidualV1 { params })
            if instruction.accounts.len() == 17 => {
            (4, 3, Some(instruction.accounts[0].pubkey), WriterMinimumAmountRequirement::InstructionExact(params.flat_atoms))
        }
        (WriterOperationKind::WithdrawPrincipal, VaultInstruction::WithdrawWriterPrincipalV1 { params })
            if instruction.accounts.len() == 14 => {
            (7, 6, Some(instruction.accounts[0].pubkey), WriterMinimumAmountRequirement::InstructionExact(params.amount_atoms))
        }
        (WriterOperationKind::CloseBegin, VaultInstruction::BeginWriterCloseV1 { params })
            if instruction.accounts.len() == 15 =>
        {
            (
                8,
                7,
                Some(instruction.accounts[0].pubkey),
                WriterMinimumAmountRequirement::InstructionExact(params.flat_amount_atoms),
            )
        }
        (WriterOperationKind::CloseBasket, VaultInstruction::DepositWriterCloseBasketV1 { .. })
            if instruction.accounts.len() == 13 =>
        {
            (
                6,
                5,
                Some(instruction.accounts[0].pubkey),
                WriterMinimumAmountRequirement::Positive,
            )
        }
        (
            WriterOperationKind::CloseCancel,
            VaultInstruction::ProcessWriterCloseCancellationV1 { params },
        ) if params.selector == WRITER_CLOSE_FLAT_SENTINEL && instruction.accounts.len() == 11 => {
            (5, 3, None, WriterMinimumAmountRequirement::Zero)
        }
        (
            WriterOperationKind::CloseCancel,
            VaultInstruction::ProcessWriterCloseCancellationV1 { params },
        ) if params.selector != WRITER_CLOSE_FLAT_SENTINEL && instruction.accounts.len() == 13 => {
            (7, 5, None, WriterMinimumAmountRequirement::Zero)
        }
        _ => return Err(invalid("writer Light stage account grammar is invalid")),
    };
    let payer = &instruction.accounts[0];
    let target = &instruction.accounts[target_index];
    let mint = &instruction.accounts[mint_index];
    if !payer.is_signer || target.is_signer || !target.is_writable || mint.is_signer {
        return Err(invalid("writer Light stage account flags are invalid"));
    }
    Ok(Some(WriterLightAccountExpectation {
        target: target.pubkey,
        mint: mint.pubkey,
        payer: payer.pubkey,
        required_owner,
        minimum_requirement,
    }))
}

fn require_hot_light_account(
    observation: &CurrentFinalizedObservation,
    target: Pubkey,
) -> Result<(), WriterOperationError> {
    let address = target.to_string();
    let light_owner = CURRENT_LIGHT_TOKEN_PROGRAM_ID.to_string();
    let account = observation
        .ordered_accounts
        .iter()
        .find(|account| account.address == address)
        .ok_or_else(|| invalid("finalized observation omits writer Light ATA"))?;
    if account.owner.as_deref() != Some(light_owner.as_str())
        || account.executable != Some(false)
        || account.data_length.as_deref() != Some("272")
        || account
            .data_sha256
            .as_deref()
            .is_none_or(|digest| !lowercase_sha256(digest))
    {
        return Err(invalid(
            "writer Light ATA is neither canonical hot state nor an authenticated cold load",
        ));
    }
    Ok(())
}

fn require_cold_light_account(
    observation: &CurrentFinalizedObservation,
    target: Pubkey,
) -> Result<(), WriterOperationError> {
    let address = target.to_string();
    let account = observation
        .ordered_accounts
        .iter()
        .find(|account| account.address == address)
        .ok_or_else(|| invalid("finalized observation omits cold writer Light ATA"))?;
    if account.owner.is_some()
        || account.executable.is_some()
        || account.data_length.is_some()
        || account.data_sha256.is_some()
    {
        return Err(invalid(
            "cold writer Light ATA is not explicitly absent from finalized hot state",
        ));
    }
    Ok(())
}

fn require_canonical_output_light_account(
    observation: &CurrentFinalizedObservation,
    target: Pubkey,
) -> Result<(), WriterOperationError> {
    let address = target.to_string();
    let account = observation
        .ordered_accounts
        .iter()
        .find(|account| account.address == address)
        .ok_or_else(|| invalid("finalized observation omits canonical cancellation output"))?;
    let absent = account.owner.is_none()
        && account.executable.is_none()
        && account.data_length.is_none()
        && account.data_sha256.is_none();
    let light_owner = CURRENT_LIGHT_TOKEN_PROGRAM_ID.to_string();
    let canonical_hot = account.owner.as_deref() == Some(light_owner.as_str())
        && account.executable == Some(false)
        && account.data_length.as_deref() == Some("272")
        && account.data_sha256.as_deref().is_some_and(lowercase_sha256);
    if !absent && !canonical_hot {
        return Err(invalid(
            "canonical cancellation output is neither absent nor exact hot Light state",
        ));
    }
    Ok(())
}

fn validate_writer_cold_proof(
    proof: &WriterColdAccountProofFacts,
    expected: &WriterLightAccountExpectation,
) -> Result<(), WriterOperationError> {
    let ata = canonical_pubkey(&proof.ata)?;
    let owner = canonical_pubkey(&proof.owner)?;
    let mint = canonical_pubkey(&proof.mint)?;
    let payer = canonical_pubkey(&proof.payer)?;
    let amount = canonical_u64(&proof.amount_atoms)?;
    let minimum_amount = canonical_u64(&proof.minimum_amount_atoms)?;
    let minimum_is_canonical = match expected.minimum_requirement {
        WriterMinimumAmountRequirement::InstructionExact(required) => minimum_amount == required,
        WriterMinimumAmountRequirement::Positive => minimum_amount > 0,
        WriterMinimumAmountRequirement::Zero => minimum_amount == 0,
    };
    if ata != expected.target
        || !is_canonical_ed25519_point(&owner)
        || ata != light_token::instruction::derive_associated_token_account(&owner, &mint)
        || mint != expected.mint
        || payer != expected.payer
        || expected
            .required_owner
            .is_some_and(|required| owner != required)
        || amount < minimum_amount
        || !minimum_is_canonical
        || !proof.includes_cold_balance
        || !lowercase_sha256(&proof.provider_origin_sha256)
    {
        return Err(invalid(
            "cold writer proof does not bind the exact payer, Light ATA, mint, owner, amount, or minimum",
        ));
    }
    Ok(())
}

fn validate_writer_canonical_output_facts(
    facts: &WriterCanonicalOutputSetupFacts,
    expected: &WriterLightAccountExpectation,
) -> Result<(), WriterOperationError> {
    let ata = canonical_pubkey(&facts.ata)?;
    let owner = canonical_pubkey(&facts.owner)?;
    let mint = canonical_pubkey(&facts.mint)?;
    let payer = canonical_pubkey(&facts.payer)?;
    if !is_canonical_ed25519_point(&owner)
        || ata != light_token::instruction::derive_associated_token_account(&owner, &mint)
        || ata != expected.target
        || mint != expected.mint
        || payer != expected.payer
    {
        return Err(invalid(
            "canonical cancellation output facts do not bind exact ATA, owner, mint, and payer",
        ));
    }
    Ok(())
}

fn validate_writer_setup(
    manifests: &[Vec<WriterSetupInstructionManifest>],
    roles: &[WriterSetupSignerRole],
    expected: &WriterLightAccountExpectation,
    mode: WriterSetupMode,
    cold_proof: Option<&WriterColdAccountProofFacts>,
    output_facts: Option<&WriterCanonicalOutputSetupFacts>,
    independently_rebuilt: &[Vec<Instruction>],
) -> Result<Vec<Vec<Instruction>>, WriterOperationError> {
    let count_is_valid = match mode {
        WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => false,
        WriterSetupMode::ColdLoad => (1..=8).contains(&independently_rebuilt.len()),
        WriterSetupMode::CanonicalOutputCreate => independently_rebuilt.len() == 1,
    };
    if !count_is_valid || manifests.len() != independently_rebuilt.len() {
        return Err(invalid("writer setup batch count is invalid"));
    }
    let setup_owner = match mode {
        WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => {
            return Err(invalid("release compute is not Light setup"));
        }
        WriterSetupMode::ColdLoad => canonical_pubkey(
            &cold_proof
                .ok_or_else(|| invalid("cold writer setup proof is missing"))?
                .owner,
        )?,
        WriterSetupMode::CanonicalOutputCreate => canonical_pubkey(
            &output_facts
                .ok_or_else(|| invalid("canonical writer output facts are missing"))?
                .owner,
        )?,
    };
    let official_create = light_token::instruction::CreateAssociatedTokenAccount::new(
        expected.payer,
        setup_owner,
        expected.mint,
    )
    .idempotent()
    .instruction()
    .map_err(|_| invalid("official Light ATA create cannot be built"))?;
    let mut expected_roles = Vec::with_capacity(independently_rebuilt.len());
    let mut loaded_amount = 0u64;
    let mut loaded_inputs = HashSet::new();
    for (setup_batch_index, (manifest_batch, instruction_batch)) in
        manifests.iter().zip(independently_rebuilt).enumerate()
    {
        let expected_len = match mode {
            WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => {
                return Err(invalid("release compute is not Light setup"));
            }
            WriterSetupMode::ColdLoad => 3,
            WriterSetupMode::CanonicalOutputCreate => 2,
        };
        if manifest_batch.len() != expected_len || instruction_batch.len() != expected_len {
            return Err(invalid("cold writer setup batch shape is invalid"));
        }
        for (instruction_index, (manifest, instruction)) in
            manifest_batch.iter().zip(instruction_batch).enumerate()
        {
            require_writer_setup_manifest(manifest, instruction)?;
            match instruction_index {
                0 => require_writer_compute_budget(instruction, mode)?,
                1 if *instruction == official_create => {}
                1 => return Err(invalid("writer setup ATA create is not exact")),
                2 if mode == WriterSetupMode::ColdLoad => {
                    let decoded = require_writer_transfer2(instruction, expected, setup_owner)?;
                    loaded_amount = loaded_amount
                        .checked_add(decoded.amount)
                        .ok_or_else(|| invalid("writer Transfer2 amount exceeds u64"))?;
                    for input in decoded.inputs {
                        if !loaded_inputs.insert(input) {
                            return Err(invalid(
                                "writer Transfer2 reuses one compressed input across sequential batches",
                            ));
                        }
                    }
                }
                _ => return Err(invalid("writer setup instruction order is invalid")),
            }
        }
        let signer_indexes = match mode {
            WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => {
                return Err(invalid("release compute is not Light setup"));
            }
            WriterSetupMode::ColdLoad => vec![1, 2],
            WriterSetupMode::CanonicalOutputCreate => vec![1],
        };
        expected_roles.push(WriterSetupSignerRole {
            pubkey: expected.payer.to_string(),
            role: "payer".to_string(),
            setup_batch_index,
            instruction_indexes: signer_indexes,
        });
    }
    if roles != expected_roles {
        return Err(invalid("writer setup signer coverage is not exact"));
    }
    if mode == WriterSetupMode::ColdLoad
        && loaded_amount
            != canonical_u64(
                &cold_proof
                    .ok_or_else(|| invalid("cold writer setup proof is missing"))?
                    .amount_atoms,
            )?
    {
        return Err(invalid(
            "writer Transfer2 amount does not equal the authenticated cold balance",
        ));
    }
    Ok(independently_rebuilt.to_vec())
}

fn require_writer_compute_budget(
    instruction: &Instruction,
    mode: WriterSetupMode,
) -> Result<(), WriterOperationError> {
    let units = instruction
        .data
        .get(1..5)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_le_bytes)
        .unwrap_or(0);
    let units_valid = match mode {
        WriterSetupMode::ReleaseCompute | WriterSetupMode::ClassicOutputCreate | WriterSetupMode::WriterLiquidityCompute => false,
        WriterSetupMode::ColdLoad => (50_000..=1_400_000).contains(&units),
        WriterSetupMode::CanonicalOutputCreate => units == 600_000,
    };
    if instruction.program_id != solana_sdk_ids::compute_budget::id()
        || !instruction.accounts.is_empty()
        || instruction.data.first() != Some(&2)
        || instruction.data.len() != 5
        || !units_valid
    {
        return Err(invalid("writer setup compute budget is not canonical"));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct WriterTransfer2InputIdentity {
    tree: Pubkey,
    queue: Pubkey,
    leaf_index: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ValidatedWriterTransfer2 {
    amount: u64,
    inputs: Vec<WriterTransfer2InputIdentity>,
}

fn require_writer_transfer2(
    instruction: &Instruction,
    expected: &WriterLightAccountExpectation,
    owner: Pubkey,
) -> Result<ValidatedWriterTransfer2, WriterOperationError> {
    if instruction.program_id != CURRENT_LIGHT_TOKEN_PROGRAM_ID
        || instruction.data.is_empty()
        || instruction.data.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES
        || instruction.accounts.len() < 12
        || instruction.accounts.len() > 26
    {
        return Err(invalid("writer cold load is not bounded Transfer2 grammar"));
    }
    let fixed = [
        (
            canonical_pubkey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7")?,
            false,
            false,
        ),
        (expected.payer, true, true),
        (CURRENT_LIGHT_TOKEN_CPI_AUTHORITY, false, false),
        (
            canonical_pubkey("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh")?,
            false,
            false,
        ),
        (
            canonical_pubkey("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA")?,
            false,
            false,
        ),
        (
            canonical_pubkey("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq")?,
            false,
            false,
        ),
        (Pubkey::default(), false, false),
    ];
    for (index, (pubkey, is_signer, is_writable)) in fixed.iter().enumerate() {
        let meta = &instruction.accounts[index];
        if meta.pubkey != *pubkey
            || meta.is_signer != *is_signer
            || meta.is_writable != *is_writable
        {
            return Err(invalid("writer Transfer2 fixed core is not exact"));
        }
    }
    let packed = &instruction.accounts[7..];
    let mint_index = packed.len() - 3;
    let owner_index = packed.len() - 2;
    let destination_index = packed.len() - 1;
    let suffix = instruction.accounts.len() - 3;
    if mint_index < 2
        || instruction.accounts[7..suffix]
            .iter()
            .map(|meta| meta.pubkey)
            .collect::<HashSet<_>>()
            .len()
            != mint_index
        || instruction.accounts[7..suffix]
            .iter()
            .any(|meta| meta.is_signer || !meta.is_writable)
        || instruction.accounts[suffix] != AccountMeta::new_readonly(expected.mint, false)
        || instruction.accounts[suffix + 1] != AccountMeta::new_readonly(owner, true)
        || instruction.accounts[suffix + 2] != AccountMeta::new(expected.target, false)
    {
        return Err(invalid(
            "writer Transfer2 proof or mint-owner-target suffix is not exact",
        ));
    }

    let mut cursor = WriterTransfer2Cursor::new(&instruction.data)?;
    if cursor.u8()? != 101
        || cursor.boolean()?
        || cursor.boolean()?
        || cursor.u8()? != 0
        || cursor.u8()? != 0
    {
        return Err(invalid(
            "writer Transfer2 transaction-hash or lamport-change mode is invalid",
        ));
    }
    let output_queue = cursor.u8()? as usize;
    if cursor.u16()? != u16::MAX || cursor.option()? {
        return Err(invalid("writer Transfer2 top-up or CPI context is invalid"));
    }
    if !cursor.option()? || cursor.vec_len(1)? != 1 {
        return Err(invalid("writer Transfer2 must contain one decompression"));
    }
    let compression_mode = cursor.u8()?;
    let compression_amount = cursor.u64()?;
    let compression_mint = cursor.u8()? as usize;
    let compression_destination = cursor.u8()? as usize;
    let compression_authority = cursor.u8()?;
    let pool_account_index = cursor.u8()?;
    let pool_index = cursor.u8()?;
    let pool_bump = cursor.u8()?;
    let decimals = cursor.u8()?;
    if compression_mode != 1
        || compression_amount == 0
        || compression_mint != mint_index
        || compression_destination != destination_index
        || compression_authority != 0
        || pool_account_index != 0
        || pool_index != 0
        || pool_bump != 0
        || decimals != 6
    {
        return Err(invalid(
            "writer Transfer2 decompression does not bind the exact mint, destination, amount, or pool-free path",
        ));
    }

    let has_proof = cursor.option()?;
    if has_proof && cursor.take(128)?.iter().all(|byte| *byte == 0) {
        return Err(invalid("writer Transfer2 full proof is all zero"));
    }
    let input_count = cursor.vec_len(8)?;
    if input_count == 0 {
        return Err(invalid("writer Transfer2 contains no token input"));
    }
    let mut amount = 0u64;
    let mut inputs = Vec::with_capacity(input_count);
    let mut unique_inputs = HashSet::with_capacity(input_count);
    let mut all_prove_by_index = true;
    let mut first_queue_index = None;
    let mut referenced_proof_accounts = HashSet::new();
    for _ in 0..input_count {
        let input_owner = cursor.u8()? as usize;
        let input_amount = cursor.u64()?;
        let has_delegate = cursor.boolean()?;
        let delegate = cursor.u8()?;
        let input_mint = cursor.u8()? as usize;
        let version = cursor.u8()?;
        let tree_index = cursor.u8()? as usize;
        let queue_index = cursor.u8()? as usize;
        let leaf_index = cursor.u32()?;
        let prove_by_index = cursor.boolean()?;
        let root_index = cursor.u16()?;
        if input_owner != owner_index
            || input_amount == 0
            || has_delegate
            || delegate != 0
            || input_mint != mint_index
            || version != 3
            || tree_index >= mint_index
            || queue_index >= mint_index
            || tree_index == queue_index
            || (prove_by_index && root_index != 0)
        {
            return Err(invalid(
                "writer Transfer2 input token identity, amount, delegate, version, or proof context is invalid",
            ));
        }
        amount = amount
            .checked_add(input_amount)
            .ok_or_else(|| invalid("writer Transfer2 input amount exceeds u64"))?;
        let identity = WriterTransfer2InputIdentity {
            tree: packed[tree_index].pubkey,
            queue: packed[queue_index].pubkey,
            leaf_index,
        };
        if !current_writer_state_tree_queue_pair(identity.tree, identity.queue) {
            return Err(invalid(
                "writer Transfer2 tree and queue are not a pinned current topology pair",
            ));
        }
        if !unique_inputs.insert(identity) {
            return Err(invalid(
                "writer Transfer2 repeats one compressed token input",
            ));
        }
        first_queue_index.get_or_insert(queue_index);
        referenced_proof_accounts.insert(tree_index);
        referenced_proof_accounts.insert(queue_index);
        all_prove_by_index &= prove_by_index;
        inputs.push(identity);
    }
    if referenced_proof_accounts.len() != mint_index
        || (0..mint_index).any(|index| !referenced_proof_accounts.contains(&index))
    {
        return Err(invalid(
            "writer Transfer2 proof-account prefix contains an unused account",
        ));
    }
    if compression_amount != amount
        || first_queue_index != Some(output_queue)
        || has_proof == all_prove_by_index
    {
        return Err(invalid(
            "writer Transfer2 proof mode, output queue, or amount does not match its inputs",
        ));
    }
    if cursor.vec_len(0)? != 0
        || cursor.option()?
        || cursor.option()?
        || cursor.option()?
        || cursor.option()?
    {
        return Err(invalid(
            "writer Transfer2 may not create token outputs, move lamports, or carry TLV extensions",
        ));
    }
    cursor.finish()?;
    Ok(ValidatedWriterTransfer2 { amount, inputs })
}

fn current_writer_state_tree_queue_pair(tree: Pubkey, queue: Pubkey) -> bool {
    matches!(
        (tree.to_string().as_str(), queue.to_string().as_str()),
        (
            "bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU",
            "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto"
        ) | (
            "bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi",
            "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg"
        ) | (
            "bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb",
            "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ"
        ) | (
            "bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8",
            "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq"
        ) | (
            "bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2",
            "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P"
        )
    )
}

struct WriterTransfer2Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> WriterTransfer2Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Result<Self, WriterOperationError> {
        if bytes.is_empty() || bytes.len() > crate::constants::MAX_INSTRUCTION_DATA_BYTES {
            return Err(invalid("writer Transfer2 data size is invalid"));
        }
        Ok(Self { bytes, offset: 0 })
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], WriterOperationError> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or_else(|| invalid("writer Transfer2 cursor overflow"))?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| invalid("writer Transfer2 data is truncated"))?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, WriterOperationError> {
        Ok(self.take(1)?[0])
    }

    fn boolean(&mut self) -> Result<bool, WriterOperationError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(invalid("writer Transfer2 bool is not canonical")),
        }
    }

    fn u16(&mut self) -> Result<u16, WriterOperationError> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("fixed u16 slice"),
        ))
    }

    fn u32(&mut self) -> Result<u32, WriterOperationError> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("fixed u32 slice"),
        ))
    }

    fn u64(&mut self) -> Result<u64, WriterOperationError> {
        Ok(u64::from_le_bytes(
            self.take(8)?.try_into().expect("fixed u64 slice"),
        ))
    }

    fn option(&mut self) -> Result<bool, WriterOperationError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(invalid("writer Transfer2 option is not canonical")),
        }
    }

    fn vec_len(&mut self, maximum: usize) -> Result<usize, WriterOperationError> {
        let value = self.u32()? as usize;
        if value > maximum {
            return Err(invalid("writer Transfer2 vector exceeds its current bound"));
        }
        Ok(value)
    }

    fn finish(self) -> Result<(), WriterOperationError> {
        if self.offset != self.bytes.len() {
            return Err(invalid("writer Transfer2 contains trailing bytes"));
        }
        Ok(())
    }
}

fn require_writer_setup_manifest(
    manifest: &WriterSetupInstructionManifest,
    expected: &Instruction,
) -> Result<(), WriterOperationError> {
    let data = BASE64
        .decode(&manifest.data_base64)
        .map_err(|_| invalid("writer setup data is not base64"))?;
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
        .collect::<Result<Vec<_>, WriterOperationError>>()?;
    let expected_name = if expected.program_id == canonical_pubkey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")? {
        "CreateAssociatedTokenAccountIdempotent"
    } else { "LightAccountLoad" };
    if manifest.instruction_name != expected_name
        || manifest.program_id != expected.program_id.to_string()
        || data.is_empty()
        || BASE64.encode(&data) != manifest.data_base64
        || data != expected.data
        || accounts != expected.accounts
    {
        return Err(invalid(
            "writer setup instruction differs from independent native reconstruction",
        ));
    }
    Ok(())
}

fn validate_writer_execution_batches(
    manifests: &[Vec<WriterExecutionInstructionManifest>],
    setup_manifests: &[Vec<WriterSetupInstructionManifest>],
    writer_manifests: &[WriterInstructionManifest],
    instructions: &[Vec<Instruction>],
    action_batch_index: usize,
) -> Result<(), WriterOperationError> {
    if manifests.len() != setup_manifests.len()
        || manifests.len() != instructions.len()
        || action_batch_index + 1 != manifests.len()
    {
        return Err(invalid("writer execution batch grouping is invalid"));
    }
    for (batch_index, ((manifest_batch, setup_batch), instruction_batch)) in manifests
        .iter()
        .zip(setup_manifests)
        .zip(instructions)
        .enumerate()
    {
        let writer_count = if batch_index == action_batch_index {
            writer_manifests.len()
        } else {
            0
        };
        if manifest_batch.len() != setup_batch.len() + writer_count
            || manifest_batch.len() != instruction_batch.len()
        {
            return Err(invalid("writer execution batch shape is invalid"));
        }
        for (manifest, expected) in manifest_batch
            .iter()
            .take(setup_batch.len())
            .zip(setup_batch)
        {
            if !matches!(manifest, WriterExecutionInstructionManifest::Setup(value) if value == expected)
            {
                return Err(invalid("writer execution setup manifest changed"));
            }
        }
        for (manifest, expected) in manifest_batch
            .iter()
            .skip(setup_batch.len())
            .zip(writer_manifests)
        {
            if !matches!(manifest, WriterExecutionInstructionManifest::Writer(value) if value == expected)
            {
                return Err(invalid("writer execution action manifest changed"));
            }
        }
    }
    Ok(())
}

fn canonical_u64(value: &str) -> Result<u64, WriterOperationError> {
    let amount = value
        .parse::<u64>()
        .map_err(|_| invalid("writer cold amount is not a u64"))?;
    if amount.to_string() != value {
        return Err(invalid("writer cold amount is not canonical"));
    }
    Ok(amount)
}

fn require_observed_accounts(
    observation: &CurrentFinalizedObservation,
    instructions: &[Instruction],
) -> Result<(), WriterOperationError> {
    for address in instructions
        .iter()
        .flat_map(|instruction| instruction.accounts.iter().map(|meta| meta.pubkey))
        .collect::<HashSet<_>>()
    {
        let account = observation
            .ordered_accounts
            .iter()
            .find(|account| account.address == address.to_string())
            .ok_or_else(|| invalid("finalized observation omits a writer instruction account"))?;
        let fields = [
            &account.owner,
            &account.executable.map(|value| value.to_string()),
            &account.data_length,
            &account.data_sha256,
        ];
        let complete = fields.iter().all(|field| field.is_some());
        let absent = fields.iter().all(|field| field.is_none());
        if !complete && !absent {
            return Err(invalid(
                "finalized observation has partial writer account state",
            ));
        }
    }
    Ok(())
}

fn require_exact_write_set(
    write_set: &[String],
    instructions: &[Instruction],
) -> Result<(), WriterOperationError> {
    let mut expected = instructions
        .iter()
        .flat_map(|instruction| instruction.accounts.iter())
        .filter(|meta| meta.is_writable)
        .map(|meta| meta.pubkey.to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    expected.sort();
    if write_set != expected {
        return Err(invalid("writer write set is not exact"));
    }
    Ok(())
}

fn require_exact_signer_coverage(
    roles: &[WriterSignerRole],
    instructions: &[Instruction],
) -> Result<(), WriterOperationError> {
    let mut required = Vec::<(String, Vec<usize>)>::new();
    for (index, instruction) in instructions.iter().enumerate() {
        for meta in instruction.accounts.iter().filter(|meta| meta.is_signer) {
            match required
                .iter_mut()
                .find(|(address, _)| *address == meta.pubkey.to_string())
            {
                Some((_, indexes)) if !indexes.contains(&index) => indexes.push(index),
                Some(_) => {}
                None => required.push((meta.pubkey.to_string(), vec![index])),
            }
        }
    }
    if roles.len() != required.len() {
        return Err(invalid("writer signer roles are not exact"));
    }
    let mut covered = HashSet::with_capacity(roles.len());
    for role in roles {
        canonical_pubkey(&role.pubkey)?;
        if !covered.insert(role.pubkey.as_str())
            || role.role.trim().is_empty()
            || required
                .iter()
                .find(|(address, _)| *address == role.pubkey)
                .is_none_or(|(_, indexes)| *indexes != role.instruction_indexes)
        {
            return Err(invalid("writer signer role coverage is invalid"));
        }
    }
    if required
        .iter()
        .any(|(address, _)| !covered.contains(address.as_str()))
    {
        return Err(invalid("writer signer role coverage is invalid"));
    }
    Ok(())
}

fn require_name(
    manifest: &WriterInstructionManifest,
    expected: &str,
) -> Result<(), WriterOperationError> {
    require(manifest.instruction_name == expected)
}
fn require_len(metas: &[AccountMeta], expected: usize) -> Result<(), WriterOperationError> {
    require(metas.len() == expected)
}
fn require(condition: bool) -> Result<(), WriterOperationError> {
    if condition {
        Ok(())
    } else {
        Err(invalid("writer account identity is not canonical"))
    }
}
fn key(metas: &[AccountMeta], index: usize) -> Result<Pubkey, WriterOperationError> {
    metas
        .get(index)
        .map(|meta| meta.pubkey)
        .ok_or_else(|| invalid("writer account count is invalid"))
}
fn canonical_pubkey(value: &str) -> Result<Pubkey, WriterOperationError> {
    let key = Pubkey::from_str(value).map_err(|_| invalid("writer public key is invalid"))?;
    if key.to_string() != value {
        return Err(invalid("writer public key is not canonical"));
    }
    Ok(key)
}

/// Matches the strict RFC8032 point decoding used by web3.js rather than
/// Solana's permissive Dalek decompressor, which reduces noncanonical field
/// encodings and accepts some nonsquare-y encodings.
fn is_canonical_ed25519_point(key: &Pubkey) -> bool {
    let compressed = key.to_bytes();
    let sign_bit_is_set = compressed[31] & 0x80 != 0;
    let mut y_bytes = compressed;
    y_bytes[31] &= 0x7f;

    let one = BigUint::from(1u8);
    let modulus = (&one << 255usize) - BigUint::from(19u8);
    let y = BigUint::from_bytes_le(&y_bytes);
    if y >= modulus {
        return false;
    }

    // x^2 = (y^2 - 1) / (d*y^2 + 1) in F_p. A strict decoding exists only
    // when x^2 is zero with a zero sign bit, or is a nonzero quadratic residue.
    let y_squared = (&y * &y) % &modulus;
    let numerator = (&y_squared + &modulus - &one) % &modulus;
    let edwards_d = BigUint::parse_bytes(
        b"37095705934669439343138083508754565189542113879843219016388785533085940283555",
        10,
    )
    .expect("Ed25519 d constant");
    let denominator = ((edwards_d * y_squared) + &one) % &modulus;
    if denominator == BigUint::from(0u8) {
        return false;
    }
    let inverse = denominator.modpow(&(&modulus - BigUint::from(2u8)), &modulus);
    let x_squared = (numerator * inverse) % &modulus;
    if x_squared == BigUint::from(0u8) {
        return !sign_bit_is_set && key.is_on_curve();
    }
    let legendre = x_squared.modpow(&((&modulus - &one) >> 1usize), &modulus);
    legendre == one && key.is_on_curve()
}
fn lowercase_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn digest_canonical(value: &Value) -> Result<String, WriterOperationError> {
    let bytes = serde_json::to_vec(&canonical_value(value))
        .map_err(|_| invalid("writer plan cannot be canonicalized"))?;
    Ok(hash(&bytes)
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical_value(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        other => other.clone(),
    }
}
fn invalid(message: &'static str) -> WriterOperationError {
    WriterOperationError::InvalidPlan(message)
}

#[cfg(test)]
mod tests {
    #[test]
    fn collective_claim_observed_selector_and_commitments_match_typescript() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let output = std::process::Command::new("node")
            .arg(root.join("scripts/emit-collective-claim-fixture.mjs"))
            .current_dir(root)
            .output()
            .expect("run claim fixture");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let plan: super::WriterOperationPlan =
            serde_json::from_slice(&output.stdout).expect("parse claim");
        let mut manifest = plan.instructions[0].clone();
        let data = BASE64.decode(&manifest.data_base64).unwrap();
        manifest.data_base64 = BASE64.encode(&data[..9]);
        manifest.accounts.pop();
        let business = vec![super::rebuild_instruction(plan.operation, &manifest).unwrap()];
        super::require_collective_claim_series_binding(&plan, &business).unwrap();
        super::validate_writer_commitments_v1(&plan).unwrap();
        for field in [
            "seriesIndex",
            "amountAtoms",
            "owner",
            "sleeve",
            "claimVariant",
        ] {
            let mut changed = plan.clone();
            changed.semantic[field] = if field == "seriesIndex" {
                json!(1)
            } else {
                json!("2")
            };
            assert!(super::require_collective_claim_series_binding(&changed, &business).is_err());
        }
        for witness in [None, Some("AA==".into()), Some("A".repeat(11088))] {
            let mut changed = plan.clone();
            changed.collective_claim_series_book_base64 = witness;
            assert!(super::require_collective_claim_series_binding(&changed, &business).is_err());
            assert!(super::validate_writer_commitments_v1(&changed).is_err());
        }
        for offset in [1, 6, 38, 120, 160, 192, 224] {
            let mut changed = plan.clone();
            let mut bytes = BASE64
                .decode(
                    changed
                        .collective_claim_series_book_base64
                        .as_ref()
                        .unwrap(),
                )
                .unwrap();
            bytes[offset] ^= 1;
            changed.collective_claim_series_book_base64 = Some(BASE64.encode(&bytes));
            let book_address = business[0].accounts[4].pubkey.to_string();
            let observed = changed
                .current_observation
                .ordered_accounts
                .iter_mut()
                .find(|account| account.address == book_address)
                .unwrap();
            observed.data_sha256 = Some(
                hash(&bytes)
                    .to_bytes()
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect(),
            );
            assert!(super::require_collective_claim_series_binding(&changed, &business).is_err());
        }
    }
    use super::*;
    use std::{collections::BTreeMap, path::Path, process::Command};

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct TsParityFixture {
        schema: String,
        transfer2_capture: TsTransfer2Capture,
        cases: Vec<TsParityCase>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct TsTransfer2Capture {
        schema: String,
        package: String,
        version: String,
        public_builder: String,
        package_json_sha256: String,
        entrypoint_sha256: String,
        builder_module_sha256: String,
        vector_data_sha256: BTreeMap<String, String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct TsParityCase {
        name: String,
        plan: WriterOperationPlan,
        independent_setup_instruction_batches: Vec<Vec<TsNativeInstruction>>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct TsNativeInstruction {
        program_id: String,
        data_base64: String,
        accounts: Vec<WriterInstructionAccountMeta>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Ed25519OwnerParityFixture {
        schema: String,
        cases: Vec<Ed25519OwnerParityCase>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Ed25519OwnerParityCase {
        name: String,
        address: String,
        compressed_point_hex: String,
        expected_on_curve: bool,
    }

    impl TsNativeInstruction {
        fn into_instruction(self) -> Instruction {
            Instruction {
                program_id: canonical_pubkey(&self.program_id).expect("fixture program id"),
                data: BASE64.decode(self.data_base64).expect("fixture base64"),
                accounts: self
                    .accounts
                    .into_iter()
                    .map(|meta| AccountMeta {
                        pubkey: canonical_pubkey(&meta.address).expect("fixture meta pubkey"),
                        is_signer: meta.is_signer,
                        is_writable: meta.is_writable,
                    })
                    .collect(),
            }
        }
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        solana_program::hash::hash(bytes)
            .to_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn on_curve_owner() -> Pubkey {
        Pubkey::from_str("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9").unwrap()
    }

    fn decode_hex_32(value: &str) -> [u8; 32] {
        assert_eq!(value.len(), 64);
        let mut bytes = [0u8; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
                .expect("fixture point hex");
        }
        bytes
    }

    #[test]
    fn strict_ed25519_owner_admission_matches_web3_shared_vectors() {
        let fixture: Ed25519OwnerParityFixture =
            serde_json::from_str(include_str!("../../fixtures/ed25519-owner-parity-v1.json"))
                .expect("owner parity fixture");
        assert_eq!(fixture.schema, "ameba-ed25519-owner-parity-v1");
        for case in fixture.cases {
            let key = canonical_pubkey(&case.address).expect("fixture address");
            assert_eq!(key.to_bytes(), decode_hex_32(&case.compressed_point_hex));
            assert_eq!(
                is_canonical_ed25519_point(&key),
                case.expected_on_curve,
                "{}",
                case.name,
            );
        }
    }

    fn writer_manifest(instruction: &Instruction) -> WriterInstructionManifest {
        let instruction_name = match instruction.data.first() {
            Some(&240) => "BeginWriterCloseV1",
            Some(&243) => "ProcessWriterCloseCancellationV1",
            _ => panic!("unsupported test writer instruction"),
        };
        WriterInstructionManifest {
            program_id: instruction.program_id.to_string(),
            instruction_name: instruction_name.to_string(),
            instruction_tag: instruction.data[0],
            data_base64: BASE64.encode(&instruction.data),
            accounts: instruction
                .accounts
                .iter()
                .map(|meta| WriterInstructionAccountMeta {
                    address: meta.pubkey.to_string(),
                    is_signer: meta.is_signer,
                    is_writable: meta.is_writable,
                })
                .collect(),
        }
    }

    fn setup_manifest(instruction: &Instruction) -> WriterSetupInstructionManifest {
        WriterSetupInstructionManifest {
            program_id: instruction.program_id.to_string(),
            instruction_name: "LightAccountLoad".to_string(),
            data_base64: BASE64.encode(&instruction.data),
            accounts: instruction
                .accounts
                .iter()
                .map(|meta| WriterInstructionAccountMeta {
                    address: meta.pubkey.to_string(),
                    is_signer: meta.is_signer,
                    is_writable: meta.is_writable,
                })
                .collect(),
        }
    }

    fn series_cancellation(actor: Pubkey, token_owner: Pubkey) -> (Instruction, Pubkey, Pubkey) {
        let sleeve = Pubkey::new_unique();
        let market = Pubkey::new_unique();
        let contract_mint = Pubkey::new_unique();
        let destination =
            light_token::instruction::derive_associated_token_account(&token_owner, &contract_mint);
        let accounts = ProcessWriterCloseSeriesCancellationAccounts {
            actor,
            sleeve,
            series_book: derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
            close_request: Pubkey::new_unique(),
            market,
            contract_mint,
            retirement_custody: derive_writer_retirement_custody_pda(
                &CURRENT_PROGRAM_ID,
                &sleeve,
                &market,
            )
            .0,
            owner_claim_destination: destination,
            contract_spl_interface: derive_light_spl_interface_pda(&contract_mint).0,
            light_token_program: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
            compressed_token_authority: CURRENT_LIGHT_TOKEN_CPI_AUTHORITY,
            spl_token_program: CURRENT_SPL_TOKEN_PROGRAM_ID,
        };
        (
            build_process_writer_close_series_cancellation_instruction(
                CURRENT_PROGRAM_ID,
                accounts,
                3,
            )
            .unwrap(),
            contract_mint,
            destination,
        )
    }

    fn flat_cancellation(actor: Pubkey, token_owner: Pubkey) -> (Instruction, Pubkey, Pubkey) {
        let sleeve = Pubkey::new_unique();
        let request = Pubkey::new_unique();
        let flat_mint = derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0;
        let destination =
            light_token::instruction::derive_associated_token_account(&token_owner, &flat_mint);
        let accounts = ProcessWriterCloseFlatCancellationAccounts {
            actor,
            sleeve,
            close_request: request,
            flat_mint,
            close_flat_escrow: derive_writer_close_flat_escrow_pda(&CURRENT_PROGRAM_ID, &request).0,
            owner_flat_destination: destination,
            flat_spl_interface: derive_light_spl_interface_pda(&flat_mint).0,
            light_token_program: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
            compressed_token_authority: CURRENT_LIGHT_TOKEN_CPI_AUTHORITY,
            spl_token_program: CURRENT_SPL_TOKEN_PROGRAM_ID,
        };
        (
            build_process_writer_close_flat_cancellation_instruction(CURRENT_PROGRAM_ID, accounts)
                .unwrap(),
            flat_mint,
            destination,
        )
    }

    fn begin_close(owner: Pubkey, seed: u8) -> (Instruction, Pubkey) {
        let settlement_group = Pubkey::new_from_array([seed; 32]);
        let sleeve = derive_writer_sleeve_pda(&CURRENT_PROGRAM_ID, &settlement_group).0;
        let close_request = Pubkey::new_from_array([seed.wrapping_add(1); 32]);
        let flat_mint = derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0;
        let instruction = build_begin_writer_close_instruction(
            CURRENT_PROGRAM_ID,
            BeginWriterCloseAccounts {
                owner,
                vault_config: derive_vault_config_pda(&CURRENT_PROGRAM_ID).0,
                sleeve,
                settlement_group,
                series_book: derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
                policy_snapshot: Pubkey::new_from_array([seed.wrapping_add(2); 32]),
                close_request,
                flat_mint,
                owner_flat_source: light_token::instruction::derive_associated_token_account(
                    &owner, &flat_mint,
                ),
                close_flat_escrow: derive_writer_close_flat_escrow_pda(
                    &CURRENT_PROGRAM_ID,
                    &close_request,
                )
                .0,
                flat_spl_interface: derive_light_spl_interface_pda(&flat_mint).0,
                light_token_program: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
                compressed_token_authority: CURRENT_LIGHT_TOKEN_CPI_AUTHORITY,
                spl_token_program: CURRENT_SPL_TOKEN_PROGRAM_ID,
            },
            crate::instruction::BeginWriterCloseV1Params {
                flat_amount_atoms: 17,
                minimum_withdrawal_atoms: 5,
                deadline_ts: 99,
            },
        )
        .unwrap();
        (instruction, sleeve)
    }

    fn cold_observation(
        instructions: &[Instruction],
        target: Pubkey,
    ) -> CurrentFinalizedObservation {
        let fixture: Value =
            serde_json::from_str(crate::CURRENT_FINALIZED_OBSERVATION_V1_FIXTURE_JSON).unwrap();
        let mut observation: CurrentFinalizedObservation =
            serde_json::from_value(fixture["observation"].clone()).unwrap();
        let mut addresses = instructions
            .iter()
            .flat_map(|instruction| instruction.accounts.iter().map(|meta| meta.pubkey))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        addresses.sort_by_key(ToString::to_string);
        observation.ordered_accounts = addresses
            .into_iter()
            .map(|address| {
                if address == target {
                    crate::current_finalized_observation::CurrentFinalizedObservedAccount {
                        address: address.to_string(),
                        owner: None,
                        executable: None,
                        data_length: None,
                        data_sha256: None,
                    }
                } else {
                    crate::current_finalized_observation::CurrentFinalizedObservedAccount {
                        address: address.to_string(),
                        owner: Some(CURRENT_PROGRAM_ID.to_string()),
                        executable: Some(false),
                        data_length: Some("1".to_string()),
                        data_sha256: Some("d".repeat(64)),
                    }
                }
            })
            .collect();
        observation.current_observation_digest =
            crate::compute_current_finalized_observation_digest(&observation).unwrap();
        observation
    }

    fn committed_output_series_plan(
        action: &Instruction,
        setup: &[Instruction],
        token_owner: Pubkey,
        mint: Pubkey,
        target: Pubkey,
    ) -> WriterOperationPlan {
        let writer_manifest = writer_manifest(action);
        let setup_manifest_batch = setup.iter().map(setup_manifest).collect::<Vec<_>>();
        let setup_manifests = vec![setup_manifest_batch.clone()];
        let setup_roles = vec![WriterSetupSignerRole {
            pubkey: action.accounts[0].pubkey.to_string(),
            role: "payer".to_string(),
            setup_batch_index: 0,
            instruction_indexes: vec![1],
        }];
        let mut execution_manifest_batch = setup_manifest_batch
            .into_iter()
            .map(WriterExecutionInstructionManifest::Setup)
            .collect::<Vec<_>>();
        execution_manifest_batch.push(WriterExecutionInstructionManifest::Writer(
            writer_manifest.clone(),
        ));
        let execution_manifests = vec![execution_manifest_batch];
        let all_instructions = setup
            .iter()
            .cloned()
            .chain([action.clone()])
            .collect::<Vec<_>>();
        let observation = cold_observation(&all_instructions, target);
        let mut write_set = all_instructions
            .iter()
            .flat_map(|instruction| instruction.accounts.iter())
            .filter(|meta| meta.is_writable)
            .map(|meta| meta.pubkey.to_string())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        write_set.sort();
        let output_facts = WriterCanonicalOutputSetupFacts {
            ata: target.to_string(),
            owner: token_owner.to_string(),
            mint: mint.to_string(),
            payer: action.accounts[0].pubkey.to_string(),
        };
        let mut plan = WriterOperationPlan {
            transaction_lookup_table: None,
            collective_claim_series_book_base64: None,
            schema_version: WRITER_OPERATION_SETUP_SCHEMA_VERSION,
            operation: WriterOperationKind::CloseCancel,
            operation_id: "0".repeat(64),
            current_observation_digest: observation.current_observation_digest.clone(),
            current_observation: observation,
            lean_admission_digest: "a".repeat(64),
            semantic: json!({
                "owner": action.accounts[0].pubkey.to_string(),
                "closeRequest": action.accounts[3].pubkey.to_string(),
            }),
            setup_mode: Some(WriterSetupMode::CanonicalOutputCreate),
            cold_account_proof_facts: None,
            canonical_output_setup_facts: Some(output_facts),
            classic_output_setup_facts: None,
            setup_instruction_batches: Some(setup_manifests),
            setup_signer_roles: Some(setup_roles),
            instructions: vec![writer_manifest],
            execution_instruction_batches: Some(execution_manifests),
            action_batch_index: Some(0),
            write_set,
            signer_roles: vec![WriterSignerRole {
                pubkey: action.accounts[0].pubkey.to_string(),
                role: "writer".to_string(),
                instruction_indexes: vec![0],
            }],
            prepared_plan_digest: "0".repeat(64),
        };
        plan.operation_id = digest_canonical(&json!({
            "domain": "ameba:writer_operation_id:v2",
            "operation": plan.operation,
            "currentObservationDigest": plan.current_observation_digest,
            "leanAdmissionDigest": plan.lean_admission_digest,
            "semantic": plan.semantic,
            "setupMode": plan.setup_mode,
            "canonicalOutputSetupFacts": plan.canonical_output_setup_facts,
            "setupInstructionBatches": plan.setup_instruction_batches,
            "setupSignerRoles": plan.setup_signer_roles,
            "instructions": plan.instructions,
            "executionInstructionBatches": plan.execution_instruction_batches,
            "actionBatchIndex": plan.action_batch_index,
            "writeSet": plan.write_set,
            "signerRoles": plan.signer_roles,
        }))
        .unwrap();
        let mut without_digest = serde_json::to_value(&plan).unwrap();
        without_digest
            .as_object_mut()
            .unwrap()
            .remove("preparedPlanDigest");
        plan.prepared_plan_digest = digest_canonical(&json!({
            "domain": "ameba:writer_prepared_plan:v2",
            "plan": without_digest,
        }))
        .unwrap();
        plan
    }

    #[test]
    fn deposit_native_rebuild_binds_interface_to_flat_mint() {
        let sleeve = Pubkey::new_unique();
        let settlement_mint = Pubkey::new_unique();
        let flat_mint = derive_writer_flat_mint_pda(&CURRENT_PROGRAM_ID, &sleeve).0;
        let accounts = DepositWriterPrincipalAccounts {
            depositor: Pubkey::new_unique(),
            vault_config: derive_vault_config_pda(&CURRENT_PROGRAM_ID).0,
            sleeve,
            policy_snapshot: Pubkey::new_unique(),
            sleeve_usdc_vault: derive_writer_sleeve_usdc_vault_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
            depositor_usdc_source: Pubkey::new_unique(),
            settlement_mint,
            flat_mint,
            flat_staging: derive_writer_flat_staging_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
            depositor_flat_destination: Pubkey::new_unique(),
            light_token_program: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
            compressed_token_authority: CURRENT_LIGHT_TOKEN_CPI_AUTHORITY,
            spl_interface: derive_light_spl_interface_pda(&flat_mint).0,
            spl_token_program: CURRENT_SPL_TOKEN_PROGRAM_ID,
            system_program: CURRENT_SYSTEM_PROGRAM_ID,
            compressible_config: LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
            rent_sponsor: LIGHT_TOKEN_RENT_SPONSOR,
        };
        let instruction =
            build_deposit_writer_principal_instruction(CURRENT_PROGRAM_ID, accounts, 7)
                .expect("native deposit");
        assert!(require_deposit_identities(&instruction.accounts).is_ok());

        let mut swapped = instruction.accounts;
        swapped[12].pubkey = derive_light_spl_interface_pda(&settlement_mint).0;
        assert!(require_deposit_identities(&swapped).is_err());
    }

    #[test]
    fn close_cancellation_native_rebuilds_bind_both_exact_grammars() {
        let actor = Pubkey::new_unique();
        let owner = on_curve_owner();
        let (series, _, _) = series_cancellation(actor, owner);
        let (flat, _, _) = flat_cancellation(actor, owner);
        for instruction in [&series, &flat] {
            assert_eq!(instruction.data[0], 243);
            let manifest = writer_manifest(instruction);
            assert_eq!(
                rebuild_instruction(WriterOperationKind::CloseCancel, &manifest).unwrap(),
                *instruction
            );
            assert!(rebuild_instruction(WriterOperationKind::CloseBasket, &manifest).is_err());
        }

        let mut forged_series = writer_manifest(&series);
        forged_series.accounts[8].address = Pubkey::new_unique().to_string();
        assert!(rebuild_instruction(WriterOperationKind::CloseCancel, &forged_series).is_err());
        let mut forged_flat = writer_manifest(&flat);
        forged_flat.accounts[6].address = Pubkey::new_unique().to_string();
        assert!(rebuild_instruction(WriterOperationKind::CloseCancel, &forged_flat).is_err());

        let sleeve = Pubkey::new_unique();
        let market = Pubkey::new_unique();
        assert!(
            build_process_writer_close_series_cancellation_instruction(
                CURRENT_PROGRAM_ID,
                ProcessWriterCloseSeriesCancellationAccounts {
                    actor,
                    sleeve,
                    series_book: derive_writer_series_book_pda(&CURRENT_PROGRAM_ID, &sleeve).0,
                    close_request: Pubkey::new_unique(),
                    market,
                    contract_mint: Pubkey::new_unique(),
                    retirement_custody: derive_writer_retirement_custody_pda(
                        &CURRENT_PROGRAM_ID,
                        &sleeve,
                        &market,
                    )
                    .0,
                    owner_claim_destination: Pubkey::new_unique(),
                    contract_spl_interface: Pubkey::new_unique(),
                    light_token_program: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
                    compressed_token_authority: CURRENT_LIGHT_TOKEN_CPI_AUTHORITY,
                    spl_token_program: CURRENT_SPL_TOKEN_PROGRAM_ID,
                },
                WRITER_CLOSE_FLAT_SENTINEL,
            )
            .is_err()
        );
    }

    #[test]
    fn writer_close_semantics_reject_swapping_two_valid_sleeves() {
        let owner = on_curve_owner();
        let (first, first_sleeve) = begin_close(owner, 71);
        let (second, second_sleeve) = begin_close(owner, 72);
        assert_ne!(first_sleeve, second_sleeve);
        let first = rebuild_instruction(WriterOperationKind::CloseBegin, &writer_manifest(&first))
            .expect("first native begin");
        let second =
            rebuild_instruction(WriterOperationKind::CloseBegin, &writer_manifest(&second))
                .expect("second native begin");
        let semantic = json!({
            "owner": owner.to_string(),
            "sleeve": first_sleeve.to_string(),
            "flatParAtoms": "17",
            "minimumWithdrawalAtoms": "5",
        });
        assert!(
            require_writer_semantic_binding(WriterOperationKind::CloseBegin, &semantic, &[first],)
                .is_ok()
        );
        assert!(
            require_writer_semantic_binding(WriterOperationKind::CloseBegin, &semantic, &[second],)
                .is_err()
        );
    }

    #[test]
    fn admitted_writer_semantics_bind_bid_and_flat_claim_and_reject_collective_claim() {
        let owner = on_curve_owner();
        let sleeve = Pubkey::new_unique();
        let auction = Pubkey::new_unique();
        let accounts = vec![
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(sleeve, false),
            AccountMeta::new(auction, false),
        ];
        let mut bid_data = vec![234];
        bid_data.extend_from_slice(&1u64.to_le_bytes());
        bid_data.push(3);
        bid_data.push(1);
        bid_data.extend_from_slice(&12u64.to_le_bytes());
        bid_data.extend_from_slice(&34u64.to_le_bytes());
        let bid = Instruction {
            program_id: CURRENT_PROGRAM_ID,
            accounts: accounts.clone(),
            data: bid_data,
        };
        let bid_semantic = json!({
            "owner": owner.to_string(),
            "auction": auction.to_string(),
            "seriesIndex": 3,
            "pricePerContractAtoms": "12",
            "quantityAtoms": "34",
        });
        assert!(
            require_writer_semantic_binding(WriterOperationKind::Bid, &bid_semantic, &[bid])
                .is_ok()
        );

        let flat = Instruction {
            program_id: CURRENT_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(owner, true),
                AccountMeta::new_readonly(Pubkey::new_unique(), false),
                AccountMeta::new(sleeve, false),
            ],
            data: [vec![247], 55u64.to_le_bytes().to_vec()].concat(),
        };
        let flat_semantic = json!({
            "owner": owner.to_string(),
            "sleeve": sleeve.to_string(),
            "claimVariant": "flat_residual",
            "seriesIndex": 255,
            "amountAtoms": "55",
        });
        assert!(
            require_writer_semantic_binding(
                WriterOperationKind::SettlementClaimFlat,
                &flat_semantic,
                std::slice::from_ref(&flat),
            )
            .is_ok()
        );
        let collective_semantic = json!({
            "owner": owner.to_string(),
            "sleeve": sleeve.to_string(),
            "claimVariant": "collective_long",
            "seriesIndex": 3,
            "amountAtoms": "55",
        });
        assert!(
            require_writer_semantic_binding(
                WriterOperationKind::SettlementClaimCollective,
                &collective_semantic,
                &[flat],
            )
            .is_err()
        );
    }

    #[test]
    fn schema_v2_requires_exact_canonical_output_create_and_legacy_rejects_it() {
        let actor = Pubkey::new_unique();
        let owner = on_curve_owner();
        let (action, mint, target) = series_cancellation(actor, owner);
        let mut compute_data = vec![2];
        compute_data.extend_from_slice(&600_000u32.to_le_bytes());
        let compute = Instruction {
            program_id: solana_sdk_ids::compute_budget::id(),
            accounts: vec![],
            data: compute_data,
        };
        let create =
            light_token::instruction::CreateAssociatedTokenAccount::new(actor, owner, mint)
                .idempotent()
                .instruction()
                .unwrap();
        assert_eq!(create.data, [102, 1, 3, 16, 1, 254, 2, 0, 0, 0]);
        assert_eq!(create.accounts[0], AccountMeta::new_readonly(owner, false));
        assert_eq!(create.accounts[2], AccountMeta::new(actor, true));
        let setup = vec![compute, create];
        let plan = committed_output_series_plan(&action, &setup, owner, mint, target);
        let encoded = serde_json::to_string(&plan).unwrap();

        assert!(matches!(
            parse_writer_operation_json(&encoded),
            Err(WriterOperationError::InvalidPlan(
                "historical writer plans are offline-only"
            ))
        ));
        let validated =
            validate_writer_operation_with_setup_inner(plan.clone(), &[setup.clone()], None)
                .expect("exact independent native setup");
        assert_eq!(validated.plan.schema_version, 2);
        assert_eq!(
            validated.execution_instruction_batches[0],
            [setup[0].clone(), setup[1].clone(), action]
        );

        let mut wrong_setup = setup.clone();
        wrong_setup[1].data[0] = 101;
        assert!(validate_writer_operation_with_setup_inner(plan, &[wrong_setup], None).is_err());
    }

    #[test]
    fn signer_roles_reject_duplicate_identity_and_missing_required_signer() {
        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();
        let instructions = vec![Instruction {
            program_id: CURRENT_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(first, true),
                AccountMeta::new_readonly(second, true),
            ],
            data: vec![227],
        }];
        let duplicate = vec![
            WriterSignerRole {
                pubkey: first.to_string(),
                role: "writer".to_string(),
                instruction_indexes: vec![0],
            },
            WriterSignerRole {
                pubkey: first.to_string(),
                role: "payer".to_string(),
                instruction_indexes: vec![0],
            },
        ];
        assert!(require_exact_signer_coverage(&duplicate, &instructions).is_err());
    }

    #[test]
    fn cold_minimum_is_explicit_and_stage_exact() {
        let owner = on_curve_owner();
        let mint = Pubkey::new_unique();
        let target = light_token::instruction::derive_associated_token_account(&owner, &mint);
        let payer = owner;
        let mut proof = WriterColdAccountProofFacts {
            ata: target.to_string(),
            owner: owner.to_string(),
            mint: mint.to_string(),
            amount_atoms: "7".to_string(),
            minimum_amount_atoms: "7".to_string(),
            includes_cold_balance: true,
            provider_origin_sha256: "b".repeat(64),
            payer: payer.to_string(),
        };
        let mut expected = WriterLightAccountExpectation {
            target,
            mint,
            payer,
            required_owner: Some(owner),
            minimum_requirement: WriterMinimumAmountRequirement::InstructionExact(7),
        };
        assert!(validate_writer_cold_proof(&proof, &expected).is_ok());
        proof.minimum_amount_atoms = "6".to_string();
        assert!(validate_writer_cold_proof(&proof, &expected).is_err());
        proof.minimum_amount_atoms = "7".to_string();
        proof.amount_atoms = "6".to_string();
        assert!(validate_writer_cold_proof(&proof, &expected).is_err());

        proof.amount_atoms = "1".to_string();
        proof.minimum_amount_atoms = "1".to_string();
        expected.minimum_requirement = WriterMinimumAmountRequirement::Positive;
        assert!(validate_writer_cold_proof(&proof, &expected).is_ok());
        proof.minimum_amount_atoms = "0".to_string();
        assert!(validate_writer_cold_proof(&proof, &expected).is_err());

        proof.amount_atoms = "0".to_string();
        expected.minimum_requirement = WriterMinimumAmountRequirement::Zero;
        assert!(validate_writer_cold_proof(&proof, &expected).is_ok());
        proof.minimum_amount_atoms = "1".to_string();
        assert!(validate_writer_cold_proof(&proof, &expected).is_err());
    }

    #[test]
    fn typescript_emitted_writer_plans_validate_in_rust_with_exact_parity() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let output = Command::new("node")
            .arg(root.join("scripts/emit-writer-operation-parity-fixture.mjs"))
            .current_dir(root)
            .output()
            .expect("run TypeScript writer parity emitter");
        assert!(
            output.status.success(),
            "TypeScript parity emitter failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let fixture: TsParityFixture =
            serde_json::from_slice(&output.stdout).expect("parse TS parity fixture");
        assert_eq!(fixture.schema, "ameba.writer-operation.ts-rust-parity.v1");
        assert_eq!(
            fixture.transfer2_capture.schema,
            "ameba.writer-transfer2.package-capture.v1"
        );
        assert_eq!(
            fixture.transfer2_capture.package,
            "@lightprotocol/compressed-token"
        );
        assert_eq!(fixture.transfer2_capture.version, "0.23.3");
        assert_eq!(
            fixture.transfer2_capture.public_builder,
            "createLoadAtaInstructions"
        );
        assert_eq!(
            fixture.transfer2_capture.package_json_sha256,
            "792e3fbf281894015263d0d62cd3c1cbe0d92ac1c14ba587c579e519ae539b74"
        );
        assert_eq!(
            fixture.transfer2_capture.entrypoint_sha256,
            "ecc4c45e3786309489acaa7f0aa249c4dfb507a7197a849ce6b5349a3c3d23f0"
        );
        assert_eq!(
            fixture.transfer2_capture.builder_module_sha256,
            "9a73c9d2651fd5af8ed820a1b91b594205018d055e667bc3089542f3894b8f7e"
        );
        assert_eq!(
            fixture
                .transfer2_capture
                .vector_data_sha256
                .get("cold_begin_flat_source_v2")
                .map(String::as_str),
            Some("fb2c3845fa1ac0fc7ae7d4a262bc0857cb2b7b91b3526fbeac9625204e1102c0")
        );
        assert_eq!(
            fixture
                .transfer2_capture
                .vector_data_sha256
                .get("cold_basket_claim_source_v2")
                .map(String::as_str),
            Some("7b70e706aae72a8f5d0f4e7762477cf741ad33feeae83ef87ecf9ac917fda0bb")
        );
        assert_eq!(fixture.cases.len(), 4);
        let expected_names = [
            "cold_begin_flat_source_v2",
            "cold_basket_claim_source_v2",
            "cold_cancel_series_destination_v2",
            "cold_cancel_flat_destination_v2",
        ];
        assert_eq!(
            fixture
                .cases
                .iter()
                .map(|case| case.name.as_str())
                .collect::<Vec<_>>(),
            expected_names
        );

        for case in fixture.cases {
            let schema_version = case.plan.schema_version;
            let operation_id = case.plan.operation_id.clone();
            let prepared_plan_digest = case.plan.prepared_plan_digest.clone();
            let write_set = case.plan.write_set.clone();
            let signer_roles = case.plan.signer_roles.clone();
            let setup = case
                .independent_setup_instruction_batches
                .into_iter()
                .map(|batch| {
                    batch
                        .into_iter()
                        .map(TsNativeInstruction::into_instruction)
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>();
            match case.name.as_str() {
                "cold_begin_flat_source_v2" => assert_eq!(
                    sha256_hex(&setup[0][2].data),
                    "fb2c3845fa1ac0fc7ae7d4a262bc0857cb2b7b91b3526fbeac9625204e1102c0"
                ),
                "cold_basket_claim_source_v2" => assert_eq!(
                    sha256_hex(&setup[0][2].data),
                    "7b70e706aae72a8f5d0f4e7762477cf741ad33feeae83ef87ecf9ac917fda0bb"
                ),
                _ => {}
            }
            let encoded =
                serde_json::to_string(&case.plan).expect("encode TS plan for Rust parser");
            assert!(parse_writer_operation_json_with_setup(&encoded, &setup).is_err());
            let runtime = crate::governed_operation::tests::Fixture::new();
            let context = runtime.context();
            let validated = validate_writer_operation_with_setup_inner(
                case.plan.clone(),
                &setup,
                Some(&context),
            )
            .unwrap_or_else(|error| panic!("{} failed Rust validation: {error}", case.name));
            assert_eq!(validated.plan.operation_id, operation_id);
            assert_eq!(validated.plan.prepared_plan_digest, prepared_plan_digest);
            let mut sorted_write_set = write_set.clone();
            sorted_write_set.sort();
            sorted_write_set.dedup();
            assert_eq!(write_set, sorted_write_set, "{} write set", case.name);
            assert_eq!(
                signer_roles
                    .iter()
                    .map(|role| role.pubkey.as_str())
                    .collect::<HashSet<_>>()
                    .len(),
                signer_roles.len(),
                "{} signer role uniqueness",
                case.name,
            );
            if matches!(
                case.name.as_str(),
                "cold_begin_flat_source_v2" | "cold_basket_claim_source_v2"
            ) {
                let business = validated
                    .instructions
                    .iter()
                    .map(|instruction| {
                        crate::governed_operation::inspect_current_governed_instruction_v1(
                            &context,
                            instruction,
                        )
                        .unwrap()
                        .business_instruction
                    })
                    .collect::<Vec<_>>();
                let expected = writer_light_account_expectation(case.plan.operation, &business)
                    .expect("cold expectation")
                    .expect("cold-capable operation");
                let setup_owner = canonical_pubkey(
                    &case
                        .plan
                        .cold_account_proof_facts
                        .as_ref()
                        .expect("cold facts")
                        .owner,
                )
                .expect("cold owner");
                let transfer = &setup[0][2];
                assert!(require_writer_transfer2(transfer, &expected, setup_owner).is_ok());

                let mut arbitrary = transfer.clone();
                arbitrary.data = vec![101, 1, 2, 3];
                assert!(require_writer_transfer2(&arbitrary, &expected, setup_owner).is_err());
                for (offset, value) in [(15, 18), (24, 3), (30, 1), (57, 1), (61, 1)] {
                    let mut malformed = transfer.clone();
                    malformed.data[offset] = value;
                    assert!(
                        require_writer_transfer2(&malformed, &expected, setup_owner).is_err(),
                        "{} Transfer2 byte {offset}",
                        case.name,
                    );
                }
                let mut wrong_topology = transfer.clone();
                wrong_topology.accounts[7].pubkey = Pubkey::new_unique();
                assert!(require_writer_transfer2(&wrong_topology, &expected, setup_owner).is_err());
            }
            if schema_version == WRITER_OPERATION_SCHEMA_VERSION {
                assert!(setup.is_empty());
                assert_eq!(case.name, "hot_finalize_v1");
                assert_eq!(
                    operation_id,
                    "686e1b8ea05411fcfc04d35406aaec1dd88cf34dd537f723c29ea50bbc31d147"
                );
                assert_eq!(
                    prepared_plan_digest,
                    "951d396f69017aa7cf3f963fe53aa2cc694ac9aa3a1ac87723cb0eac5d7177f6"
                );
            } else {
                assert_eq!(schema_version, WRITER_OPERATION_SETUP_SCHEMA_VERSION);
                assert_eq!(validated.setup_instruction_batches, setup);
                assert_eq!(validated.execution_instruction_batches.len(), setup.len());
                let action_batch = validated.plan.action_batch_index.unwrap();
                assert_eq!(action_batch + 1, setup.len());
                assert_eq!(
                    validated.execution_instruction_batches[action_batch].len(),
                    setup[action_batch].len() + validated.instructions.len(),
                    "{} execution grouping",
                    case.name,
                );
                match case.name.as_str() {
                    "cold_begin_flat_source_v2" | "cold_basket_claim_source_v2" => {
                        assert_eq!(validated.plan.setup_mode, Some(WriterSetupMode::ColdLoad));
                        assert!(validated.plan.cold_account_proof_facts.is_some());
                        assert!(validated.plan.canonical_output_setup_facts.is_none());
                    }
                    "cold_cancel_series_destination_v2" | "cold_cancel_flat_destination_v2" => {
                        assert_eq!(
                            validated.plan.setup_mode,
                            Some(WriterSetupMode::CanonicalOutputCreate)
                        );
                        assert!(validated.plan.cold_account_proof_facts.is_none());
                        assert!(validated.plan.canonical_output_setup_facts.is_some());
                    }
                    _ => panic!("unexpected schema-v2 fixture case {}", case.name),
                }
            }
        }
    }
}
