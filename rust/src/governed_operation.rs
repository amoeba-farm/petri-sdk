//! Release-qualified governed instruction admission. No constructor in this
//! module accepts a caller-selected release, controller, tag set, or epoch.
//! Historical wire helpers remain separate from this current-write boundary.

use std::str::FromStr;

use serde_json::Value;
use solana_program::{
    hash::{Hash, hash},
    instruction::Instruction,
    pubkey,
    pubkey::Pubkey,
};
use thiserror::Error;

use crate::governance::{
    CURRENT_LIVE_PROGRAM_ID, CURRENT_LIVE_PROGRAMDATA, GOVERNANCE_TAIL_V1_BYTES,
    GOVERNANCE_UPGRADE_SEED_DOMAIN_V1, GovernanceGateStatusV1,
    decode_governance_instruction_tail_v1, decode_protocol_governance_gate_v1,
};

const TRAIN: &str = include_str!("../../release/release-train.v1.json");
const RUNTIME: &str = include_str!("../../vendor/GOVERNED_RUNTIME_PROVENANCE.json");
const PACKAGE_BUILD: &str = include_str!("../../release/local-candidate-build.v1.json");

/// Package-owned source/artifact identity; runtime admission uses the separate release receipts.
pub fn current_sdk_package_build_identity_v1() -> Result<Value, GovernedOperationError> {
    serde_json::from_str(PACKAGE_BUILD).map_err(|_| GovernedOperationError::ReleaseInvalid)
}
pub(crate) const WRITER_TRANSPORT: &str =
    include_str!("../../src/protocol/writer-operation-transport.v1.json");
const GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const CONTROLLER: Pubkey = pubkey!("8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx");
const CONFIG: Pubkey = pubkey!("Ec5H8jsGvaLU3T3gp6qTayPjY2qF3geBbVKWz4rsaEHB");
const GATE: Pubkey = pubkey!("Cdym9p7FvtxEAjF8XuCqSrishB7LmBDXaZGDMMgWczu");

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum GovernedOperationError {
    #[error("current program write ABI is unavailable")]
    ReleaseUnavailable,
    #[error("current governed release evidence is incomplete or inconsistent")]
    ReleaseInvalid,
    #[error("governed observation is not the exact finalized Devnet deployment")]
    ObservationInvalid,
    #[error("governed gate is frozen, stale, or belongs to another release")]
    GateStale,
    #[error("governed instruction envelope is invalid")]
    EnvelopeInvalid,
    #[error("governed instruction tag is unassigned or retired")]
    InstructionUnknown,
    #[error("governance gate privileges are elevated by the transaction")]
    GatePrivileges,
    #[error("transaction differs from the exact approved instructions, payer, or blockhash")]
    TransactionInvalid,
}

/// Package-owned release identity. Private fields prevent callers from
/// manufacturing an available release out of an unavailable train.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentGovernedWriteReleaseV1 {
    source_commit: String,
    artifact_source_commit: String,
    artifact_sha256: String,
    artifact_bytes: usize,
    mandatory_zero_padding_bytes: usize,
    package_sha256: String,
    manifest_sha256: String,
    payload_sha256: String,
    program_sha256: String,
    programdata_sha256: String,
    payload_bytes: usize,
    programdata_bytes: usize,
    deployed_slot: u64,
    finalized_slot: u64,
    upgrade_authority: Pubkey,
    assigned_tags: Vec<u8>,
}

impl CurrentGovernedWriteReleaseV1 {
    pub fn program_id(&self) -> Pubkey {
        CURRENT_LIVE_PROGRAM_ID
    }
    pub fn programdata_address(&self) -> Pubkey {
        CURRENT_LIVE_PROGRAMDATA
    }
    pub fn controller_program(&self) -> Pubkey {
        CONTROLLER
    }
    pub fn gate_address(&self) -> Pubkey {
        GATE
    }
    pub fn source_commit(&self) -> &str {
        &self.source_commit
    }
    /// Deployed ELF source, distinct from the tools/package source_commit().
    pub fn artifact_source_commit(&self) -> &str {
        &self.artifact_source_commit
    }
    /// SHA-256 of the ELF prefix, excluding allocated zero padding.
    pub fn artifact_sha256(&self) -> &str {
        &self.artifact_sha256
    }
    pub fn artifact_bytes(&self) -> usize {
        self.artifact_bytes
    }
    pub fn mandatory_zero_padding_bytes(&self) -> usize {
        self.mandatory_zero_padding_bytes
    }
    pub fn package_sha256(&self) -> &str {
        &self.package_sha256
    }
    pub fn manifest_sha256(&self) -> &str {
        &self.manifest_sha256
    }
    pub fn payload_sha256(&self) -> &str {
        &self.payload_sha256
    }
    pub fn minimum_finalized_slot(&self) -> u64 {
        self.finalized_slot
    }
    pub fn program_account_sha256(&self) -> &str {
        &self.program_sha256
    }
    pub fn programdata_account_sha256(&self) -> &str {
        &self.programdata_sha256
    }
    pub fn payload_bytes(&self) -> usize {
        self.payload_bytes
    }
    pub fn programdata_bytes(&self) -> usize {
        self.programdata_bytes
    }
    pub fn deployed_slot(&self) -> u64 {
        self.deployed_slot
    }
    pub fn upgrade_authority(&self) -> Pubkey {
        self.upgrade_authority
    }
}

/// Only the compiled package's mutually checked release and runtime receipts
/// can issue this capability. A mismatched native package remains unavailable.
pub fn current_governed_write_release_v1()
-> Result<CurrentGovernedWriteReleaseV1, GovernedOperationError> {
    let train: Value =
        serde_json::from_str(TRAIN).map_err(|_| GovernedOperationError::ReleaseInvalid)?;
    let runtime: Value =
        serde_json::from_str(RUNTIME).map_err(|_| GovernedOperationError::ReleaseInvalid)?;
    let build = current_sdk_package_build_identity_v1()?;
    let native = build["nativePackage"]["sha256"].as_str().ok_or(GovernedOperationError::ReleaseInvalid)?;
    if native != runtime["packageArtifact"]["sha256"].as_str().ok_or(GovernedOperationError::ReleaseInvalid)? {
        return Err(GovernedOperationError::ReleaseUnavailable);
    }
    qualified_release(&train, &runtime)
}

pub(crate) fn require_historical_operation_mode_v1() -> Result<(), GovernedOperationError> {
    let train: Value =
        serde_json::from_str(TRAIN).map_err(|_| GovernedOperationError::ReleaseInvalid)?;
    if train["writeRelease"]["status"] != "unavailable" {
        return Err(GovernedOperationError::ReleaseUnavailable);
    }
    Ok(())
}

fn qualified_release(
    train: &Value,
    runtime: &Value,
) -> Result<CurrentGovernedWriteReleaseV1, GovernedOperationError> {
    let invalid = || GovernedOperationError::ReleaseInvalid;
    let write = &train["writeRelease"];
    if write["status"] != "available" {
        return Err(GovernedOperationError::ReleaseUnavailable);
    }
    let live = &train["finalizedLiveDeployment"];
    let identity = &train["liveGovernanceIdentity"];
    let canonical: Value =
        serde_json::from_str(include_str!("../../release/current-deployment.v1.json"))
            .map_err(|_| invalid())?;
    let reviewed = &canonical["governance"];
    let transport: Value = serde_json::from_str(WRITER_TRANSPORT).map_err(|_| invalid())?;
    let transport_sha256 =
        sha256(&serde_json::to_vec(&canonical_json(&transport)).map_err(|_| invalid())?);
    if train["schema"] != "ameba.sdk.release-train.v1"
        || train["schemaVersion"] != 1
        || train["selectedGovernanceGeneration"] != 3
        || write["compatibility"] != "governance-gate-v1"
        || write["governanceIdentityGeneration"] != 3
        || live["cluster"] != "devnet"
        || live["genesisHash"] != GENESIS
        || live["stateNamespace"] != "ameba-spread-v2"
        || live["writeCompatibility"] != write["compatibility"]
        || identity["identityGeneration"] != 3
        || identity["live"] != true
        || identity["mainnetAllowed"] != false
        || train["authorization"]["mainnetEnabled"] != false
        || runtime["currentWriteEligible"] != true
        || runtime["deploymentCorrespondenceVerified"] != true
        || runtime["sourceWorktreeDirty"] != false
        || !runtime["deployment"].is_object()
        || runtime["deployment"] != *live
        || runtime["schemaVersion"] != 1
        || runtime["protocol"] != "ameba_spread"
        || runtime["assignedInstructionTags"] != write["assignedInstructionTags"]
        || write["writerOperationTransport"] != transport
        || runtime["writerOperationTransport"] != transport
        || write["writerOperationTransportSha256"] != transport_sha256
        || runtime["writerOperationTransportSha256"] != transport_sha256
        || identity["environment"] != "devnet"
        || identity["upgradeAuthority"]["mode"] != "governed-authority"
        || identity["upgradeAuthority"]["address"] != "Frc28QFQxqUxF9HPgzcmm5VkqorqUb2LeLPE5uKU6Ycp"
    {
        return Err(invalid());
    }
    for key in [
        "controllerProgramData",
        "controllerSourceCommit",
        "artifactSha256",
        "programDataSha256",
        "deploymentReceiptSha256",
        "upgradeAuthority",
    ] {
        if identity[key] != reviewed[key] {
            return Err(invalid());
        }
    }
    canonical_pubkey(&identity["controllerProgramData"])?;
    hex_value(&identity["controllerSourceCommit"], 40)?;
    for key in [
        "artifactSha256",
        "programDataSha256",
        "deploymentReceiptSha256",
    ] {
        hex_value(&identity[key], 64)?;
    }
    for (value, expected) in [
        (&identity["controllerProgramId"], CONTROLLER),
        (&identity["controllerConfigPda"], CONFIG),
        (&identity["protocolGatePda"], GATE),
        (&identity["targetProgramId"], CURRENT_LIVE_PROGRAM_ID),
        (&identity["targetProgramData"], CURRENT_LIVE_PROGRAMDATA),
        (&live["programId"], CURRENT_LIVE_PROGRAM_ID),
        (&live["programDataAddress"], CURRENT_LIVE_PROGRAMDATA),
    ] {
        if canonical_pubkey(value)? != expected {
            return Err(invalid());
        }
    }
    let source_commit = hex_value(&write["spreadReleaseCommit"], 40)?;
    if live["sourceCommit"] != source_commit
        || train["sourceHeads"]["spread"] != source_commit
        || runtime["sourceCommit"] != source_commit
    {
        return Err(invalid());
    }
    let package_sha256 = hex_value(&write["spreadPackageArtifactSha256"], 64)?;
    let manifest_sha256 = hex_value(&write["instructionManifestSha256"], 64)?;
    let payload_sha256 = hex_value(&write["programDataPayloadSha256"], 64)?;
    if runtime["packageArtifact"]["sha256"] != package_sha256
        || runtime["instructionManifestSourceSha256"] != manifest_sha256
        || live["programDataPayloadSha256"] != payload_sha256
    {
        return Err(invalid());
    }
    let tags = write["assignedInstructionTags"]
        .as_array()
        .ok_or_else(invalid)?;
    let assigned_tags = tags
        .iter()
        .map(|tag| {
            tag.as_u64()
                .and_then(|value| u8::try_from(value).ok())
                .ok_or_else(invalid)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if assigned_tags.is_empty() || assigned_tags.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid());
    }
    let compiled_tags = (0_u8..=u8::MAX)
        .filter(|tag| {
            crate::instruction::VaultInstructionTag::from_byte(*tag).is_some()
                || crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::from_byte(*tag)
                    .is_some()
        })
        .collect::<Vec<_>>();
    if assigned_tags != compiled_tags {
        return Err(invalid());
    }
    if assigned_tags.contains(&159) {
        let dlmm_transport: Value = serde_json::from_str(include_str!(
            "../../src/protocol/writer-dlmm-transport.v1.json"
        )).map_err(|_| invalid())?;
        let dlmm_transport_sha256 = sha256(
            &serde_json::to_vec(&canonical_json(&dlmm_transport)).map_err(|_| invalid())?
        );
        if write["writerDlmmTransport"] != dlmm_transport
            || runtime["writerDlmmTransport"] != dlmm_transport
            || write["writerDlmmTransportSha256"] != dlmm_transport_sha256
            || runtime["writerDlmmTransportSha256"] != dlmm_transport_sha256
        {
            return Err(invalid());
        }
    }
    let payload_bytes = usize_value(&live["programDataPayloadBytes"])?;
    let artifact_source_commit = hex_value(&live["artifactSourceCommit"], 40)?;
    let artifact_sha256 = hex_value(&live["artifactSha256"], 64)?;
    let artifact_bytes = usize_value(&live["artifactBytes"])?;
    let mandatory_zero_padding_bytes = usize_value(&live["mandatoryZeroPaddingBytes"])?;
    let programdata_bytes = usize_value(&live["programDataAccountBytes"])?;
    let deployed_slot = live["programDataSlot"]
        .as_u64()
        .filter(|value| *value > 0)
        .ok_or_else(invalid)?;
    let finalized_slot = live["minimumContextSlot"]
        .as_u64()
        .filter(|value| *value >= deployed_slot)
        .ok_or_else(invalid)?;
    if live["programAccountBytes"] != 36
        || payload_bytes == 0
        || artifact_bytes == 0
        || artifact_bytes.checked_add(mandatory_zero_padding_bytes) != Some(payload_bytes)
        || payload_bytes
            .checked_add(45)
            .is_none_or(|minimum| minimum != programdata_bytes)
        || live["upgradeAuthority"]["mode"] != "external-authority"
        || live["upgradeAuthority"]["address"] != "4hsEKyThDv85YA4HjUaGWn2nWnVbM5V23XcLrEX3UKzn"
    {
        return Err(invalid());
    }
    Ok(CurrentGovernedWriteReleaseV1 {
        source_commit,
        artifact_source_commit,
        artifact_sha256,
        artifact_bytes,
        mandatory_zero_padding_bytes,
        package_sha256,
        manifest_sha256,
        payload_sha256,
        program_sha256: hex_value(&live["programAccountSha256"], 64)?,
        programdata_sha256: hex_value(&live["programDataAccountSha256"], 64)?,
        payload_bytes,
        programdata_bytes,
        deployed_slot,
        finalized_slot,
        upgrade_authority: canonical_pubkey(&live["upgradeAuthority"]["address"])?,
        assigned_tags,
    })
}

/// Raw RPC account facts, never an authorization capability by themselves.
#[derive(Clone, Copy, Debug)]
pub struct CurrentGovernedAccountObservationV1<'a> {
    pub address: Pubkey,
    pub owner: Pubkey,
    pub executable: bool,
    pub data: &'a [u8],
}

/// All three accounts must come from the same finalized getMultipleAccounts
/// response at or above the requested minimum context slot.
#[derive(Clone, Copy, Debug)]
pub struct CurrentGovernedObservationV1<'a> {
    pub genesis_hash: &'a str,
    pub commitment: &'a str,
    pub context_slot: u64,
    pub program: CurrentGovernedAccountObservationV1<'a>,
    pub programdata: CurrentGovernedAccountObservationV1<'a>,
    pub gate: CurrentGovernedAccountObservationV1<'a>,
}

/// One release-qualified Active gate observed at finalized commitment. It is
/// immutable and must be refreshed before signing and after interactive approval.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentGovernedWriteContextV1 {
    release: CurrentGovernedWriteReleaseV1,
    epoch: u64,
    finalized_slot: u64,
}

impl CurrentGovernedWriteContextV1 {
    pub fn release(&self) -> &CurrentGovernedWriteReleaseV1 {
        &self.release
    }
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
    pub fn finalized_slot(&self) -> u64 {
        self.finalized_slot
    }
}

pub fn observe_current_governed_write_context_v1(
    release: &CurrentGovernedWriteReleaseV1,
    observation: CurrentGovernedObservationV1<'_>,
    minimum_context_slot: u64,
) -> Result<CurrentGovernedWriteContextV1, GovernedOperationError> {
    let invalid = || GovernedOperationError::ObservationInvalid;
    if observation.genesis_hash != GENESIS
        || observation.commitment != "finalized"
        || observation.context_slot < minimum_context_slot.max(release.finalized_slot)
    {
        return Err(invalid());
    }
    let program = observation.program;
    let data = observation.programdata;
    let loader = solana_sdk_ids::bpf_loader_upgradeable::ID;
    if program.address != CURRENT_LIVE_PROGRAM_ID
        || program.owner != loader
        || !program.executable
        || program.data.len() != 36
        || program.data[..4] != 2_u32.to_le_bytes()
        || program.data[4..] != CURRENT_LIVE_PROGRAMDATA.to_bytes()
        || sha256(program.data) != release.program_sha256
        || data.address != CURRENT_LIVE_PROGRAMDATA
        || data.owner != loader
        || data.executable
        || data.data.len() != release.programdata_bytes
        || data.data.len() < 45
        || data.data[..4] != 3_u32.to_le_bytes()
        || data.data[4..12] != release.deployed_slot.to_le_bytes()
        || data.data[12] != 1
        || data.data[13..45] != release.upgrade_authority.to_bytes()
        || sha256(data.data) != release.programdata_sha256
        || release
            .artifact_bytes
            .checked_add(release.mandatory_zero_padding_bytes)
            != Some(release.payload_bytes)
        || release.payload_bytes.checked_add(45) != Some(data.data.len())
        || sha256(&data.data[45..45 + release.artifact_bytes]) != release.artifact_sha256
        || data.data[45 + release.artifact_bytes..]
            .iter()
            .any(|byte| *byte != 0)
        || sha256(&data.data[45..45 + release.payload_bytes]) != release.payload_sha256
        || data.data[45 + release.payload_bytes..]
            .iter()
            .any(|byte| *byte != 0)
    {
        return Err(invalid());
    }
    let gate = validate_current_governed_gate_account_v1(release, observation.gate)?;
    if gate.status != GovernanceGateStatusV1::Active || gate.epoch == 0 {
        return Err(GovernedOperationError::GateStale);
    }
    Ok(CurrentGovernedWriteContextV1 {
        release: release.clone(),
        epoch: gate.epoch,
        finalized_slot: observation.context_slot,
    })
}

/// Read-only gate validation for the exact package-qualified release. Frozen
/// gates remain readable; only observe_current_governed_write_context_v1 can
/// admit an Active gate for writes.
pub fn validate_current_governed_gate_account_v1(
    release: &CurrentGovernedWriteReleaseV1,
    gate_account: CurrentGovernedAccountObservationV1<'_>,
) -> Result<crate::governance::ProtocolGovernanceGateV1, GovernedOperationError> {
    let invalid = || GovernedOperationError::ObservationInvalid;
    let (config, _) = Pubkey::find_program_address(
        &[GOVERNANCE_UPGRADE_SEED_DOMAIN_V1, b"council"],
        &CONTROLLER,
    );
    let (gate_address, bump) = Pubkey::find_program_address(
        &[
            GOVERNANCE_UPGRADE_SEED_DOMAIN_V1,
            b"gate",
            CURRENT_LIVE_PROGRAM_ID.as_ref(),
        ],
        &CONTROLLER,
    );
    if release.gate_address() != GATE
        || config != CONFIG
        || gate_address != GATE
        || gate_account.address != GATE
        || gate_account.owner != CONTROLLER
        || gate_account.executable
    {
        return Err(invalid());
    }
    let gate = decode_protocol_governance_gate_v1(gate_account.data).map_err(|_| invalid())?;
    if gate.bump != bump
        || gate.controller_config != CONFIG
        || gate.target_program != CURRENT_LIVE_PROGRAM_ID
        || gate.target_programdata != CURRENT_LIVE_PROGRAMDATA
    {
        return Err(invalid());
    }
    Ok(gate)
}

/// A refresh never retails a prepared instruction with a new epoch. Any epoch
/// change requires a new plan and new caller approval, even if Active returns.
pub fn refresh_current_governed_write_context_v1(
    previous: &CurrentGovernedWriteContextV1,
    release: &CurrentGovernedWriteReleaseV1,
    observation: CurrentGovernedObservationV1<'_>,
) -> Result<CurrentGovernedWriteContextV1, GovernedOperationError> {
    if previous.release != *release {
        return Err(GovernedOperationError::GateStale);
    }
    let current =
        observe_current_governed_write_context_v1(release, observation, previous.finalized_slot)?;
    if current.epoch != previous.epoch {
        return Err(GovernedOperationError::GateStale);
    }
    Ok(current)
}

/// The original instruction is retained for signing; the business view is for
/// subsequent strict typed semantic validation, not independent write authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentGovernedInstructionViewsV1 {
    pub governed_instruction: Instruction,
    pub business_instruction: Instruction,
}

pub fn inspect_current_governed_instruction_v1(
    context: &CurrentGovernedWriteContextV1,
    instruction: &Instruction,
) -> Result<CurrentGovernedInstructionViewsV1, GovernedOperationError> {
    if instruction.data.is_empty() || instruction.data.len() > 16_384 {
        return Err(GovernedOperationError::EnvelopeInvalid);
    }
    if context
        .release
        .assigned_tags
        .binary_search(&instruction.data[0])
        .is_err()
    {
        return Err(GovernedOperationError::InstructionUnknown);
    }
    if instruction.program_id != CURRENT_LIVE_PROGRAM_ID
        || instruction.data.len() <= GOVERNANCE_TAIL_V1_BYTES
    {
        return Err(GovernedOperationError::EnvelopeInvalid);
    }
    let length = instruction.data.len() - GOVERNANCE_TAIL_V1_BYTES;
    let tail = decode_governance_instruction_tail_v1(&instruction.data[length..])
        .map_err(|_| GovernedOperationError::EnvelopeInvalid)?;
    let gate = instruction
        .accounts
        .last()
        .ok_or(GovernedOperationError::EnvelopeInvalid)?;
    if tail.expected_epoch != context.epoch
        || gate.pubkey != GATE
        || gate.is_signer
        || gate.is_writable
        || instruction
            .accounts
            .iter()
            .filter(|account| account.pubkey == GATE)
            .count()
            != 1
    {
        return Err(GovernedOperationError::EnvelopeInvalid);
    }
    Ok(CurrentGovernedInstructionViewsV1 {
        governed_instruction: instruction.clone(),
        business_instruction: Instruction {
            program_id: instruction.program_id,
            accounts: instruction.accounts[..instruction.accounts.len() - 1].to_vec(),
            data: instruction.data[..length].to_vec(),
        },
    })
}

/// Check effective transaction privilege union, including payer and every setup
/// instruction, before a signing source is loaded and again before relay.
/// A Flat-only transaction may have zero Spread instructions, but still needs
/// this exact finalized release context and its independent typed Flat validator.
pub fn validate_current_governed_instruction_batch_v1(
    context: &CurrentGovernedWriteContextV1,
    payer: Pubkey,
    instructions: &[Instruction],
) -> Result<usize, GovernedOperationError> {
    if instructions.is_empty() || instructions.len() > 32 || payer == GATE {
        return Err(GovernedOperationError::GatePrivileges);
    }
    let mut targets = 0;
    for instruction in instructions {
        if instruction
            .accounts
            .iter()
            .any(|meta| meta.pubkey == GATE && (meta.is_signer || meta.is_writable))
        {
            return Err(GovernedOperationError::GatePrivileges);
        }
        if instruction.program_id == CURRENT_LIVE_PROGRAM_ID {
            inspect_current_governed_instruction_v1(context, instruction)?;
            targets += 1;
        }
    }
    Ok(targets)
}

/// Check the complete legacy message, not merely the privileges stated by each
/// individual instruction. This resolves the exact approved instructions and
/// rejects added keys, instruction reordering, widened privileges, a changed
/// payer/blockhash, or altered instruction bytes. Rust and web3.js may order
/// same-privilege keys differently; no key or effective privilege may differ.
/// The signing session additionally binds its exact compiled message.
/// Signature cryptography is the
/// signer's independent responsibility; this function issues no signing token.
/// Versioned messages need their own exact resolved-lookup contract and are not
/// accepted by the existing legacy-only current-operation workflow.
pub fn validate_current_governed_legacy_transaction_v1(
    context: &CurrentGovernedWriteContextV1,
    payer: Pubkey,
    approved_instructions: &[Instruction],
    approved_blockhash: Hash,
    transaction: &solana_transaction::Transaction,
) -> Result<(), GovernedOperationError> {
    validate_current_governed_instruction_batch_v1(context, payer, approved_instructions)?;
    let expected = solana_message::Message::new_with_blockhash(
        approved_instructions,
        Some(&payer),
        &approved_blockhash,
    );
    let actual = &transaction.message;
    if actual.header != expected.header
        || actual.recent_blockhash != approved_blockhash
        || actual.account_keys.first() != Some(&payer)
        || actual.account_keys.len() != expected.account_keys.len()
        || actual
            .account_keys
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != actual.account_keys.len()
        || actual.instructions.len() != approved_instructions.len()
        || transaction.signatures.len() != usize::from(expected.header.num_required_signatures)
        || bincode::serialized_size(transaction)
            .map_err(|_| GovernedOperationError::TransactionInvalid)?
            > 1_232
    {
        return Err(GovernedOperationError::TransactionInvalid);
    }
    for (index, key) in actual.account_keys.iter().enumerate() {
        let expected_index = expected
            .account_keys
            .iter()
            .position(|candidate| candidate == key)
            .ok_or(GovernedOperationError::TransactionInvalid)?;
        if compiled_privileges(actual, index) != compiled_privileges(&expected, expected_index) {
            return Err(GovernedOperationError::TransactionInvalid);
        }
    }
    for (compiled, approved) in actual.instructions.iter().zip(approved_instructions) {
        if actual
            .account_keys
            .get(usize::from(compiled.program_id_index))
            != Some(&approved.program_id)
            || compiled.data != approved.data
            || compiled.accounts.len() != approved.accounts.len()
            || compiled
                .accounts
                .iter()
                .zip(&approved.accounts)
                .any(|(index, meta)| {
                    actual.account_keys.get(usize::from(*index)) != Some(&meta.pubkey)
                })
        {
            return Err(GovernedOperationError::TransactionInvalid);
        }
    }
    Ok(())
}

fn compiled_privileges(message: &solana_message::Message, index: usize) -> (bool, bool) {
    let signed = usize::from(message.header.num_required_signatures);
    let signer = index < signed;
    let writable = if signer {
        index < signed - usize::from(message.header.num_readonly_signed_accounts)
    } else {
        index
            < message.account_keys.len()
                - usize::from(message.header.num_readonly_unsigned_accounts)
    };
    (signer, writable)
}

fn hex_value(value: &Value, length: usize) -> Result<String, GovernedOperationError> {
    let text = value
        .as_str()
        .filter(|text| {
            text.len() == length
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                && text.bytes().any(|byte| byte != b'0')
        })
        .ok_or(GovernedOperationError::ReleaseInvalid)?;
    Ok(text.to_string())
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum TypedOperation {
    Writer(crate::writer_operation::ValidatedWriterOperation),
    Swap(crate::collective_swap_operation::ValidatedCollectiveSwapOperation),
    Flat(crate::flat_transfer_operation::ValidatedFlatTransferOperation),
}

/// Issued only by a successful current typed plan validator. Callers cannot
/// construct this from raw instructions or alter the retained approved plan.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentGovernedOperationV1 {
    context: CurrentGovernedWriteContextV1,
    payer: Pubkey,
    batches: Vec<Vec<Instruction>>,
    typed: TypedOperation,
}

impl CurrentGovernedOperationV1 {
    pub fn requires_versioned_signing(&self) -> bool {
        match &self.typed {
            TypedOperation::Writer(value) => crate::writer_operation::is_writer_liquidity_operation(value.plan.operation),
            TypedOperation::Swap(_) => true,
            TypedOperation::Flat(_) => false,
        }
    }

    fn lookup_table(&self) -> Option<&crate::collective_lookup_table::CurrentCollectiveLookupTableWitnessV1> {
        match &self.typed {
            TypedOperation::Writer(value) => value.plan.transaction_lookup_table.as_ref(),
            TypedOperation::Swap(value) => value.plan.transaction_lookup_table.as_ref(),
            TypedOperation::Flat(_) => None,
        }
    }
    pub fn context(&self) -> &CurrentGovernedWriteContextV1 {
        &self.context
    }
    pub fn payer(&self) -> Pubkey {
        self.payer
    }
    pub fn execution_instruction_batches(&self) -> &[Vec<Instruction>] {
        &self.batches
    }
    pub fn writer_operation(&self) -> Option<&crate::writer_operation::ValidatedWriterOperation> {
        match &self.typed {
            TypedOperation::Writer(value) => Some(value),
            _ => None,
        }
    }
    pub fn swap_operation(
        &self,
    ) -> Option<&crate::collective_swap_operation::ValidatedCollectiveSwapOperation> {
        match &self.typed {
            TypedOperation::Swap(value) => Some(value),
            _ => None,
        }
    }
    pub fn flat_operation(
        &self,
    ) -> Option<&crate::flat_transfer_operation::ValidatedFlatTransferOperation> {
        match &self.typed {
            TypedOperation::Flat(value) => Some(value),
            _ => None,
        }
    }
    pub fn observation(
        &self,
    ) -> &crate::current_finalized_observation::CurrentFinalizedObservation {
        match &self.typed {
            TypedOperation::Writer(value) => &value.plan.current_observation,
            TypedOperation::Swap(value) => &value.plan.current_observation,
            TypedOperation::Flat(value) => &value.plan.current_observation,
        }
    }
    pub fn operation_id(&self) -> &str {
        match &self.typed {
            TypedOperation::Writer(value) => &value.plan.operation_id,
            TypedOperation::Swap(value) => &value.plan.operation_id,
            TypedOperation::Flat(value) => &value.plan.operation_id,
        }
    }
    pub fn prepared_plan_digest(&self) -> &str {
        match &self.typed {
            TypedOperation::Writer(value) => &value.plan.prepared_plan_digest,
            TypedOperation::Swap(value) => &value.plan.prepared_plan_digest,
            TypedOperation::Flat(value) => &value.plan.prepared_plan_digest,
        }
    }
    pub(crate) fn writer(
        context: &CurrentGovernedWriteContextV1,
        value: crate::writer_operation::ValidatedWriterOperation,
    ) -> Result<Self, GovernedOperationError> {
        let payer = value
            .instructions
            .first()
            .and_then(|ix| ix.accounts.first())
            .filter(|meta| meta.is_signer)
            .ok_or(GovernedOperationError::EnvelopeInvalid)?
            .pubkey;
        Self::new(
            context,
            payer,
            value.execution_instruction_batches.clone(),
            TypedOperation::Writer(value),
        )
    }
    pub(crate) fn swap(
        context: &CurrentGovernedWriteContextV1,
        value: crate::collective_swap_operation::ValidatedCollectiveSwapOperation,
    ) -> Result<Self, GovernedOperationError> {
        let payer = value
            .instruction
            .accounts
            .first()
            .filter(|meta| meta.is_signer)
            .ok_or(GovernedOperationError::EnvelopeInvalid)?
            .pubkey;
        Self::new(
            context,
            payer,
            vec![value.execution_instructions.clone()],
            TypedOperation::Swap(value),
        )
    }
    pub(crate) fn flat(
        context: &CurrentGovernedWriteContextV1,
        value: crate::flat_transfer_operation::ValidatedFlatTransferOperation,
    ) -> Result<Self, GovernedOperationError> {
        let payer = Pubkey::from_str(&value.plan.semantic.owner)
            .map_err(|_| GovernedOperationError::EnvelopeInvalid)?;
        Self::new(
            context,
            payer,
            value.execution_instruction_batches.clone(),
            TypedOperation::Flat(value),
        )
    }
    fn new(
        context: &CurrentGovernedWriteContextV1,
        payer: Pubkey,
        batches: Vec<Vec<Instruction>>,
        typed: TypedOperation,
    ) -> Result<Self, GovernedOperationError> {
        if batches.is_empty() || batches.len() > 32 {
            return Err(GovernedOperationError::EnvelopeInvalid);
        }
        for batch in &batches {
            validate_current_governed_instruction_batch_v1(context, payer, batch)?;
        }
        let operation = Self {
            context: context.clone(),
            payer,
            batches,
            typed,
        };
        let observation = operation.observation();
        let observed_slot = observation
            .observed_at_slot
            .parse::<u64>()
            .map_err(|_| GovernedOperationError::ObservationInvalid)?;
        let finalized_slot = observation
            .current_finalized_slot
            .parse::<u64>()
            .map_err(|_| GovernedOperationError::ObservationInvalid)?;
        if observed_slot < context.release.finalized_slot || finalized_slot > context.finalized_slot
        {
            return Err(GovernedOperationError::ObservationInvalid);
        }
        Ok(operation)
    }
}

/// An explicitly absent account remains absent; present accounts require all
/// exact owner/executable/length/hash facts from the approved business snapshot.
#[derive(Clone, Copy, Debug)]
pub struct CurrentGovernedOptionalAccountObservationV1<'a> {
    pub address: Pubkey,
    pub account: Option<CurrentGovernedAccountObservationV1<'a>>,
}

/// Finalized deployment and business accounts observed together at one context
/// slot. These facts are independently fetched both before and after approval.
#[derive(Clone, Copy, Debug)]
pub struct CurrentGovernedSigningObservationV1<'a> {
    pub deployment: CurrentGovernedObservationV1<'a>,
    pub business_accounts: &'a [CurrentGovernedOptionalAccountObservationV1<'a>],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentGovernedSigningV1 {
    operation: CurrentGovernedOperationV1,
    context: CurrentGovernedWriteContextV1,
    batch_index: usize,
    blockhash: Hash,
    message: solana_message::Message,
}

impl CurrentGovernedSigningV1 {
    /// Return the already compiled exact message for local/hardware signing.
    pub fn message(&self) -> &solana_message::Message {
        &self.message
    }
    pub fn context(&self) -> &CurrentGovernedWriteContextV1 {
        &self.context
    }
}

fn require_unchanged_business_accounts(
    operation: &CurrentGovernedOperationV1,
    accounts: &[CurrentGovernedOptionalAccountObservationV1<'_>],
) -> Result<(), GovernedOperationError> {
    let expected = &operation.observation().ordered_accounts;
    if accounts.len() != expected.len() {
        return Err(GovernedOperationError::ObservationInvalid);
    }
    for (actual, expected) in accounts.iter().zip(expected) {
        if actual.address.to_string() != expected.address {
            return Err(GovernedOperationError::ObservationInvalid);
        }
        let agrees = match actual.account {
            None => {
                expected.owner.is_none()
                    && expected.executable.is_none()
                    && expected.data_length.is_none()
                    && expected.data_sha256.is_none()
            }
            Some(account) => {
                account.address == actual.address
                    && expected.owner.as_deref() == Some(account.owner.to_string().as_str())
                    && expected.executable == Some(account.executable)
                    && expected.data_length.as_deref()
                        == Some(account.data.len().to_string().as_str())
                    && expected.data_sha256.as_deref() == Some(sha256(account.data).as_str())
            }
        };
        if !agrees {
            return Err(GovernedOperationError::ObservationInvalid);
        }
    }
    Ok(())
}

/// The first fresh finalized observation is required before a signing source is
/// loaded. No raw-instruction constructor can issue this signing session.
pub fn prepare_current_governed_signing_v1(
    operation: &CurrentGovernedOperationV1,
    release: &CurrentGovernedWriteReleaseV1,
    observation: CurrentGovernedSigningObservationV1<'_>,
    batch_index: usize,
    blockhash: Hash,
) -> Result<CurrentGovernedSigningV1, GovernedOperationError> {
    if operation.requires_versioned_signing() {
        return Err(GovernedOperationError::TransactionInvalid);
    }
    let context = refresh_current_governed_write_context_v1(
        &operation.context,
        release,
        observation.deployment,
    )?;
    require_unchanged_business_accounts(operation, observation.business_accounts)?;
    let instructions = operation
        .batches
        .get(batch_index)
        .ok_or(GovernedOperationError::TransactionInvalid)?;
    let message = solana_message::Message::new_with_blockhash(
        instructions,
        Some(&operation.payer),
        &blockhash,
    );
    let transaction = solana_transaction::Transaction::new_unsigned(message.clone());
    validate_current_governed_legacy_transaction_v1(
        &context,
        operation.payer,
        instructions,
        blockhash,
        &transaction,
    )?;
    Ok(CurrentGovernedSigningV1 {
        operation: operation.clone(),
        context,
        batch_index,
        blockhash,
        message,
    })
}

/// Require the last finalized observation after local/hardware approval and
/// before the typed relay. Reject state/epoch/release rollback or any changed
/// signed message. The relay still independently verifies signatures, blockhash
/// expiry, and product deadlines; no RPC submission happens inside this SDK.
pub fn revalidate_current_governed_signed_transaction_v1(
    signing: &CurrentGovernedSigningV1,
    release: &CurrentGovernedWriteReleaseV1,
    observation: CurrentGovernedSigningObservationV1<'_>,
    transaction: &solana_transaction::Transaction,
) -> Result<(), GovernedOperationError> {
    if transaction.message != signing.message {
        return Err(GovernedOperationError::TransactionInvalid);
    }
    let context = refresh_current_governed_write_context_v1(
        &signing.context,
        release,
        observation.deployment,
    )?;
    require_unchanged_business_accounts(&signing.operation, observation.business_accounts)?;
    validate_current_governed_legacy_transaction_v1(
        &context,
        signing.operation.payer,
        &signing.operation.batches[signing.batch_index],
        signing.blockhash,
        transaction,
    )
}

/// A v0 signing session issued only by exact typed operation validation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentGovernedVersionedSigningV1 {
    operation: CurrentGovernedOperationV1,
    context: CurrentGovernedWriteContextV1,
    batch_index: usize,
    blockhash: Hash,
    message: solana_message::VersionedMessage,
}

impl CurrentGovernedVersionedSigningV1 {
    pub fn message(&self) -> &solana_message::VersionedMessage { &self.message }
    pub fn context(&self) -> &CurrentGovernedWriteContextV1 { &self.context }
}

fn compile_governed_versioned_message(
    operation: &CurrentGovernedOperationV1,
    context: &CurrentGovernedWriteContextV1,
    batch_index: usize,
    blockhash: Hash,
) -> Result<solana_message::VersionedMessage, GovernedOperationError> {
    if !operation.requires_versioned_signing() { return Err(GovernedOperationError::TransactionInvalid); }
    let instructions = operation.batches.get(batch_index).ok_or(GovernedOperationError::TransactionInvalid)?;
    validate_current_governed_instruction_batch_v1(context, operation.payer, instructions)?;
    let tables = operation.lookup_table().map(|witness|
        crate::collective_lookup_table::decode_current_collective_lookup_table_v1(witness, operation.observation())
            .map_err(|_| GovernedOperationError::ObservationInvalid)
    ).transpose()?.into_iter().collect::<Vec<_>>();
    let message = solana_message::v0::Message::try_compile(&operation.payer, instructions, &tables, blockhash)
        .map_err(|_| GovernedOperationError::TransactionInvalid)?;
    if message.header.num_required_signatures != 1 || message.account_keys.first() != Some(&operation.payer)
        || message.address_table_lookups.len() != tables.len()
        || message.address_table_lookups.iter().zip(&tables).any(|(actual, table)| actual.account_key != table.key)
    { return Err(GovernedOperationError::TransactionInvalid); }
    Ok(solana_message::VersionedMessage::V0(message))
}

/// Reobserves the deployment and all business accounts, including the complete
/// lookup table bytes, before exposing the exact v0 message to a signer.
pub fn prepare_current_governed_versioned_signing_v1(
    operation: &CurrentGovernedOperationV1,
    release: &CurrentGovernedWriteReleaseV1,
    observation: CurrentGovernedSigningObservationV1<'_>,
    batch_index: usize,
    blockhash: Hash,
) -> Result<CurrentGovernedVersionedSigningV1, GovernedOperationError> {
    let context = refresh_current_governed_write_context_v1(&operation.context, release, observation.deployment)?;
    require_unchanged_business_accounts(operation, observation.business_accounts)?;
    let message = compile_governed_versioned_message(operation, &context, batch_index, blockhash)?;
    let transaction = solana_transaction::versioned::VersionedTransaction {
        signatures: vec![solana_signature::Signature::default()], message: message.clone(),
    };
    if bincode::serialized_size(&transaction).map_err(|_| GovernedOperationError::TransactionInvalid)? > 1_232 {
        return Err(GovernedOperationError::TransactionInvalid);
    }
    Ok(CurrentGovernedVersionedSigningV1 { operation: operation.clone(), context, batch_index, blockhash, message })
}

/// Reobserves every bound account after approval and rejects any mutation of
/// the compiled message, lookup table, payer, signer count, or packet size.
pub fn revalidate_current_governed_signed_versioned_transaction_v1(
    signing: &CurrentGovernedVersionedSigningV1,
    release: &CurrentGovernedWriteReleaseV1,
    observation: CurrentGovernedSigningObservationV1<'_>,
    transaction: &solana_transaction::versioned::VersionedTransaction,
) -> Result<(), GovernedOperationError> {
    let context = refresh_current_governed_write_context_v1(&signing.context, release, observation.deployment)?;
    require_unchanged_business_accounts(&signing.operation, observation.business_accounts)?;
    let expected = compile_governed_versioned_message(&signing.operation, &context, signing.batch_index, signing.blockhash)?;
    if expected != signing.message || transaction.message != expected || transaction.signatures.len() != 1
        || bincode::serialized_size(transaction).map_err(|_| GovernedOperationError::TransactionInvalid)? > 1_232 {
        return Err(GovernedOperationError::TransactionInvalid);
    }
    Ok(())
}

fn canonical_pubkey(value: &Value) -> Result<Pubkey, GovernedOperationError> {
    let text = value
        .as_str()
        .ok_or(GovernedOperationError::ReleaseInvalid)?;
    let key = Pubkey::from_str(text).map_err(|_| GovernedOperationError::ReleaseInvalid)?;
    if key == Pubkey::default() || key.to_string() != text {
        return Err(GovernedOperationError::ReleaseInvalid);
    }
    Ok(key)
}

fn usize_value(value: &Value) -> Result<usize, GovernedOperationError> {
    value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(GovernedOperationError::ReleaseInvalid)
}

fn sha256(data: &[u8]) -> String {
    hash(data)
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut sorted = serde_json::Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical_json(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical_json).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
pub(crate) mod tests;
