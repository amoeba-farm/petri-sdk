#![cfg(all(
    feature = "governance-gate-v1",
    any(
        feature = "phase3-synthetic-governance-controller",
        feature = "devnet-v3-governance-controller"
    )
))]

use std::{
    path::PathBuf,
    result::Result as StdResult,
    sync::atomic::{AtomicU64, Ordering},
};

use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED},
    error::VaultError,
    governance_gate::{
        derive_controller_config_pda, derive_protocol_gate_pda, derive_target_programdata_pda,
        GateStatusV1, GovernanceInstructionTailV1, ProtocolGateV1, PINNED_CONTROLLER_PROGRAM_ID,
        PROTOCOL_GATE_DISCRIMINATOR, PROTOCOL_GATE_LEN, PROTOCOL_GATE_VERSION_V1,
    },
    instruction::VaultInstruction,
    state::VaultConfig,
};
use solana_nonce::{state::State as NonceState, versions::Versions as NonceVersions};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use solana_program_test::{
    processor, BanksClient, BanksTransactionResultWithMetadata, ProgramTest, ProgramTestContext,
};
use solana_sdk::{
    account::Account,
    hash::Hash,
    instruction::{AccountMeta, Instruction, InstructionError},
    signature::{Keypair, Signature, Signer},
    transaction::{Transaction, TransactionError},
};
use solana_system_interface::{
    instruction::{advance_nonce_account, create_nonce_account},
    program as system_program,
};

// The local controller fixture uses the identity selected by the tested artifact.
const TEST_CONTROLLER_PROGRAM_ID: Pubkey = PINNED_CONTROLLER_PROGRAM_ID;
const DYNAMIC_EPOCH_CPI_CALLER_PROGRAM_ID: Pubkey = Pubkey::new_from_array([43u8; 32]);
const CONTROLLER_COMMAND_LEN: usize = 9;
const EMERGENCY_FREEZE_REASON: u16 = 0x00a3;
const TEST_LAMPORTS: u64 = 10_000_000_000;
const TRANSACTION_COMPUTE_LIMIT: u64 = 1_400_000;
#[cfg(feature = "phase3-synthetic-governance-controller")]
const BUILD_RELEASE_MARKER: &str = "AMEBA_PHASE3_SYNTHETIC_CONTROLLER_DO_NOT_RELEASE";
#[cfg(feature = "devnet-v3-governance-controller")]
const BUILD_RELEASE_MARKER: &str = "AMEBA_SPREAD_DEVNET_V3:2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw:8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx";
static DYNAMIC_CALLER_OBSERVED_EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SyntheticGateCommand {
    Active,
    EmergencyFrozen,
}

impl SyntheticGateCommand {
    fn status(self) -> GateStatusV1 {
        match self {
            Self::Active => GateStatusV1::Active,
            Self::EmergencyFrozen => GateStatusV1::EmergencyFrozen,
        }
    }

    fn byte(self) -> u8 {
        self.status() as u8
    }
}

#[derive(Debug)]
struct TransactionEvidence {
    signature: Signature,
    result: StdResult<(), TransactionError>,
    logs: Vec<String>,
    slot: Option<u64>,
}

impl TransactionEvidence {
    fn print(&self, label: &str) {
        println!(
            "phase3_governance_sbf label={label} signature={} slot={:?} result={:?}",
            self.signature, self.slot, self.result
        );
        for log in &self.logs {
            println!("phase3_governance_sbf label={label} log={log}");
        }
    }
}

fn transaction_evidence_json(evidence: &TransactionEvidence) -> serde_json::Value {
    serde_json::json!({
        "signature": evidence.signature.to_string(),
        "slot": evidence.slot,
        "resultDebug": format!("{:?}", evidence.result),
        "logs": &evidence.logs,
    })
}

fn print_runtime_evidence(value: serde_json::Value) {
    println!("phase3_governance_sbf evidence_json={value}");
}

struct Harness {
    context: ProgramTestContext,
    admin: Keypair,
    controller_payer: Keypair,
    config_key: Pubkey,
    collateral_mint: Pubkey,
    collateral_vault: Pubkey,
    gate_key: Pubkey,
    initial_config: VaultConfig,
}

impl Harness {
    async fn start(gate_owner: Pubkey, gate_data: Vec<u8>) -> Self {
        assert_actual_spread_sbf_input();
        assert_eq!(PINNED_CONTROLLER_PROGRAM_ID, TEST_CONTROLLER_PROGRAM_ID);

        // BPF_OUT_DIR/SBF_OUT_DIR makes this first registration load the actual Spread ELF.
        let mut program_test =
            ProgramTest::new("light_token_minter", light_token_minter::id(), None);
        program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);

        // The controller is deliberately a native, test-only processor. Changing the preference
        // after Spread is registered cannot replace the already-loaded Spread ELF.
        program_test.prefer_bpf(false);
        program_test.add_program(
            "phase3_synthetic_governance_controller",
            TEST_CONTROLLER_PROGRAM_ID,
            processor!(synthetic_controller_process_instruction),
        );
        program_test.add_program(
            "phase3_dynamic_epoch_cpi_caller",
            DYNAMIC_EPOCH_CPI_CALLER_PROGRAM_ID,
            processor!(dynamic_epoch_cpi_caller_process_instruction),
        );

        let admin = Keypair::new_from_array([31u8; 32]);
        let controller_payer = Keypair::new_from_array([32u8; 32]);
        let collateral_mint = Pubkey::new_from_array([33u8; 32]);
        let collateral_vault = Pubkey::new_from_array([34u8; 32]);
        let (config_key, config_bump) = Pubkey::find_program_address(
            &[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED],
            &light_token_minter::id(),
        );
        let (gate_key, _) =
            derive_protocol_gate_pda(&TEST_CONTROLLER_PROGRAM_ID, &light_token_minter::id());
        let initial_config = VaultConfig {
            is_initialized: true,
            bump: config_bump,
            admin: admin.pubkey(),
            oracle_authority: Pubkey::new_from_array([35u8; 32]),
            usdc_mint: collateral_mint,
            vault_token_account: collateral_vault,
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        };

        program_test.add_account(admin.pubkey(), funded_system_account());
        program_test.add_account(controller_payer.pubkey(), funded_system_account());
        program_test.add_account(
            config_key,
            Account {
                lamports: TEST_LAMPORTS,
                data: initial_config
                    .try_to_vec()
                    .expect("serialize canonical vault config"),
                owner: light_token_minter::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        for address in [collateral_mint, collateral_vault, spl_token::id()] {
            program_test.add_account(address, inert_readonly_account());
        }
        program_test.add_account(
            gate_key,
            Account {
                lamports: TEST_LAMPORTS,
                data: gate_data,
                owner: gate_owner,
                executable: false,
                rent_epoch: 0,
            },
        );

        Self {
            context: program_test.start_with_context().await,
            admin,
            controller_payer,
            config_key,
            collateral_mint,
            collateral_vault,
            gate_key,
            initial_config,
        }
    }

    async fn normal() -> Self {
        Self::start(TEST_CONTROLLER_PROGRAM_ID, vec![0; PROTOCOL_GATE_LEN]).await
    }

    async fn wrong_owner(epoch: u64) -> Self {
        Self::start(
            Pubkey::new_from_array([99u8; 32]),
            canonical_gate_bytes(GateStatusV1::Active, epoch).to_vec(),
        )
        .await
    }

    async fn fresh_blockhash(&mut self) -> Hash {
        let slot = self
            .context
            .banks_client
            .get_root_slot()
            .await
            .expect("read ProgramTest root slot");
        self.context
            .warp_to_slot(slot.checked_add(1).expect("test slot increment"))
            .expect("warp for a distinct recent blockhash");
        self.context.last_blockhash
    }

    async fn set_gate(&mut self, command: SyntheticGateCommand, epoch: u64) -> TransactionEvidence {
        let blockhash = self.fresh_blockhash().await;
        let transaction = Transaction::new_signed_with_payer(
            &[controller_instruction(self.gate_key, command, epoch)],
            Some(&self.controller_payer.pubkey()),
            &[&self.controller_payer],
            blockhash,
        );
        let evidence = submit_with_evidence(&self.context.banks_client, transaction).await;
        assert_eq!(evidence.result, Ok(()), "controller write failed");
        assert!(
            evidence.slot.is_some(),
            "executed controller tx needs a slot"
        );
        evidence
    }

    fn update_instruction(
        &self,
        expected_epoch: Option<u64>,
        gate: GateAccountMode,
    ) -> Instruction {
        let mut data = VaultInstruction::UpdateConfig {
            new_admin: None,
            new_oracle_authority: None,
            new_usdc_mint: None,
            new_vault_token_account: None,
            paused: Some(true),
        }
        .try_to_vec()
        .expect("serialize UpdateConfig");
        if let Some(epoch) = expected_epoch {
            data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(epoch).encode());
        }

        let mut accounts = vec![
            AccountMeta::new_readonly(self.admin.pubkey(), true),
            AccountMeta::new(self.config_key, false),
            AccountMeta::new_readonly(self.collateral_mint, false),
            AccountMeta::new_readonly(self.collateral_vault, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ];
        match gate {
            GateAccountMode::Present => {
                accounts.push(AccountMeta::new_readonly(self.gate_key, false));
            }
            GateAccountMode::OmittedFromLegacyGraph => {}
            GateAccountMode::NoInstructionAccounts => accounts.clear(),
        }
        Instruction {
            program_id: light_token_minter::id(),
            accounts,
            data,
        }
    }

    fn dynamic_epoch_cpi_update_instruction(&self) -> Instruction {
        Instruction {
            program_id: DYNAMIC_EPOCH_CPI_CALLER_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new_readonly(self.admin.pubkey(), true),
                AccountMeta::new(self.config_key, false),
                AccountMeta::new_readonly(self.collateral_mint, false),
                AccountMeta::new_readonly(self.collateral_vault, false),
                AccountMeta::new_readonly(spl_token::id(), false),
                AccountMeta::new_readonly(self.gate_key, false),
                AccountMeta::new_readonly(light_token_minter::id(), false),
            ],
            data: Vec::new(),
        }
    }

    async fn submit_update(
        &mut self,
        expected_epoch: Option<u64>,
        gate: GateAccountMode,
    ) -> TransactionEvidence {
        let blockhash = self.fresh_blockhash().await;
        let transaction = Transaction::new_signed_with_payer(
            &[self.update_instruction(expected_epoch, gate)],
            Some(&self.admin.pubkey()),
            &[&self.admin],
            blockhash,
        );
        submit_with_evidence(&self.context.banks_client, transaction).await
    }

    async fn config(&self) -> VaultConfig {
        let account = self
            .context
            .banks_client
            .get_account(self.config_key)
            .await
            .expect("read vault config")
            .expect("vault config exists");
        VaultConfig::try_from_slice(&account.data).expect("decode vault config")
    }

    async fn config_bytes(&self) -> Vec<u8> {
        self.context
            .banks_client
            .get_account(self.config_key)
            .await
            .expect("read vault config")
            .expect("vault config exists")
            .data
    }

    async fn gate(&self) -> ProtocolGateV1 {
        let account = self
            .context
            .banks_client
            .get_account(self.gate_key)
            .await
            .expect("read protocol gate")
            .expect("protocol gate exists");
        ProtocolGateV1::decode_exact(&account.data).expect("decode canonical protocol gate")
    }
}

#[derive(Clone, Copy)]
enum GateAccountMode {
    Present,
    OmittedFromLegacyGraph,
    NoInstructionAccounts,
}

fn funded_system_account() -> Account {
    Account {
        lamports: TEST_LAMPORTS,
        data: Vec::new(),
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn inert_readonly_account() -> Account {
    Account {
        lamports: TEST_LAMPORTS,
        data: Vec::new(),
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn assert_actual_spread_sbf_input() {
    let output_dir = std::env::var_os("BPF_OUT_DIR")
        .or_else(|| std::env::var_os("SBF_OUT_DIR"))
        .map(PathBuf::from)
        .expect("actual-SBF test requires BPF_OUT_DIR or SBF_OUT_DIR");
    let artifact = output_dir.join("light_token_minter.so");
    let bytes = std::fs::read(&artifact)
        .unwrap_or_else(|error| panic!("read actual Spread SBF {}: {error}", artifact.display()));
    assert!(bytes.len() > 4, "Spread SBF artifact is empty");
    assert_eq!(&bytes[..4], b"\x7fELF", "Spread test input must be an ELF");
    assert!(
        bytes
            .windows(BUILD_RELEASE_MARKER.len())
            .any(|w| w == BUILD_RELEASE_MARKER.as_bytes()),
        "artifact build identity differs from the host feature profile"
    );
    let artifact_sha256 = solana_program::hash::hash(&bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    #[cfg(feature = "devnet-v3-governance-controller")]
    assert_eq!(
        artifact_sha256,
        std::env::var("AMEBA_TESTED_SBF_SHA256")
            .expect("production tests require the attested artifact SHA-256")
    );
    println!("phase3_governance_sbf artifact_sha256={artifact_sha256}");
    println!(
        "phase3_governance_sbf actual_spread_elf={} bytes={}",
        artifact.display(),
        bytes.len()
    );
}

fn controller_instruction(gate: Pubkey, command: SyntheticGateCommand, epoch: u64) -> Instruction {
    let mut data = Vec::with_capacity(CONTROLLER_COMMAND_LEN);
    data.push(command.byte());
    data.extend_from_slice(&epoch.to_le_bytes());
    Instruction {
        program_id: TEST_CONTROLLER_PROGRAM_ID,
        accounts: vec![AccountMeta::new(gate, false)],
        data,
    }
}

fn synthetic_controller_process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &TEST_CONTROLLER_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if accounts.len() != 1 || instruction_data.len() != CONTROLLER_COMMAND_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let gate_info = next_account_info(&mut accounts.iter())?;
    let expected_gate = derive_protocol_gate_pda(program_id, &light_token_minter::id()).0;
    if gate_info.key != &expected_gate || gate_info.is_signer || !gate_info.is_writable {
        return Err(ProgramError::InvalidArgument);
    }
    if gate_info.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    if gate_info.data_len() != PROTOCOL_GATE_LEN {
        return Err(ProgramError::InvalidAccountData);
    }

    let command = match instruction_data[0] {
        0 => SyntheticGateCommand::Active,
        2 => SyntheticGateCommand::EmergencyFrozen,
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    let epoch = u64::from_le_bytes(
        instruction_data[1..9]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let mut data = gate_info.try_borrow_mut_data()?;
    if data.iter().any(|byte| *byte != 0) {
        let old =
            ProtocolGateV1::decode_exact(&data).map_err(|_| ProgramError::InvalidAccountData)?;
        if epoch
            != old
                .epoch
                .checked_add(1)
                .ok_or(ProgramError::InvalidArgument)?
        {
            return Err(ProgramError::InvalidArgument);
        }
    } else if command != SyntheticGateCommand::Active || epoch == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    data.copy_from_slice(&canonical_gate_bytes(command.status(), epoch));
    Ok(())
}

fn dynamic_epoch_cpi_caller_process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &DYNAMIC_EPOCH_CPI_CALLER_PROGRAM_ID
        || !instruction_data.is_empty()
        || accounts.len() != 7
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let account_iter = &mut accounts.iter();
    let admin_info = next_account_info(account_iter)?;
    let config_info = next_account_info(account_iter)?;
    let collateral_mint_info = next_account_info(account_iter)?;
    let collateral_vault_info = next_account_info(account_iter)?;
    let token_program_info = next_account_info(account_iter)?;
    let gate_info = next_account_info(account_iter)?;
    let spread_program_info = next_account_info(account_iter)?;

    if !admin_info.is_signer
        || !config_info.is_writable
        || collateral_mint_info.key == &Pubkey::default()
        || collateral_vault_info.key == &Pubkey::default()
        || token_program_info.key != &spl_token::id()
        || gate_info.key
            != &derive_protocol_gate_pda(&TEST_CONTROLLER_PROGRAM_ID, &light_token_minter::id()).0
        || gate_info.owner != &TEST_CONTROLLER_PROGRAM_ID
        || spread_program_info.key != &light_token_minter::id()
        || !spread_program_info.executable
    {
        return Err(ProgramError::InvalidArgument);
    }

    let gate = {
        let data = gate_info.try_borrow_data()?;
        ProtocolGateV1::decode_exact(&data).map_err(|_| ProgramError::InvalidAccountData)?
    };
    if gate.status != GateStatusV1::Active {
        return Err(ProgramError::InvalidAccountData);
    }

    let mut data = VaultInstruction::UpdateConfig {
        new_admin: None,
        new_oracle_authority: None,
        new_usdc_mint: None,
        new_vault_token_account: None,
        paused: Some(true),
    }
    .try_to_vec()
    .map_err(|_| ProgramError::InvalidInstructionData)?;
    data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(gate.epoch).encode());
    DYNAMIC_CALLER_OBSERVED_EPOCH.store(gate.epoch, Ordering::SeqCst);
    solana_program::msg!(
        "phase3_dynamic_epoch_cpi_caller observed_epoch={} tail_epoch={}",
        gate.epoch,
        gate.epoch
    );
    let cpi = Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin_info.key, true),
            AccountMeta::new(*config_info.key, false),
            AccountMeta::new_readonly(*collateral_mint_info.key, false),
            AccountMeta::new_readonly(*collateral_vault_info.key, false),
            AccountMeta::new_readonly(*token_program_info.key, false),
            AccountMeta::new_readonly(*gate_info.key, false),
        ],
        data,
    };
    invoke(&cpi, accounts)
}

fn canonical_gate_bytes(status: GateStatusV1, epoch: u64) -> [u8; PROTOCOL_GATE_LEN] {
    let target = light_token_minter::id();
    let (_, bump) = derive_protocol_gate_pda(&TEST_CONTROLLER_PROGRAM_ID, &target);
    let controller_config = derive_controller_config_pda(&TEST_CONTROLLER_PROGRAM_ID, &target).0;
    let target_programdata = derive_target_programdata_pda(&target);
    let mut bytes = [0u8; PROTOCOL_GATE_LEN];
    bytes[0..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
    bytes[8] = PROTOCOL_GATE_VERSION_V1;
    bytes[9] = bump;
    bytes[10] = 1;
    bytes[11] = status as u8;
    bytes[12..44].copy_from_slice(controller_config.as_ref());
    bytes[44..76].copy_from_slice(target.as_ref());
    bytes[76..108].copy_from_slice(target_programdata.as_ref());
    bytes[108..116].copy_from_slice(&epoch.to_le_bytes());
    match status {
        GateStatusV1::Active => {}
        GateStatusV1::EmergencyFrozen => {
            bytes[148..156].copy_from_slice(&epoch.max(1).to_le_bytes());
            bytes[156..158].copy_from_slice(&EMERGENCY_FREEZE_REASON.to_le_bytes());
        }
        GateStatusV1::FrozenForUpgrade => panic!("test controller cannot stage upgrade proposals"),
    }
    bytes
}

async fn submit_with_evidence(
    client: &BanksClient,
    transaction: Transaction,
) -> TransactionEvidence {
    let signature = transaction.signatures[0];
    let processed = client
        .process_transaction_with_metadata(transaction)
        .await
        .expect("ProgramTest transport");
    transaction_evidence(client, signature, processed).await
}

async fn transaction_evidence(
    client: &BanksClient,
    signature: Signature,
    processed: BanksTransactionResultWithMetadata,
) -> TransactionEvidence {
    let slot = client
        .get_transaction_status(signature)
        .await
        .expect("read ProgramTest transaction status")
        .map(|status| status.slot);
    TransactionEvidence {
        signature,
        result: processed.result,
        logs: processed
            .metadata
            .map(|metadata| metadata.log_messages)
            .unwrap_or_default(),
        slot,
    }
}

fn assert_custom_error(evidence: &TransactionEvidence, index: u8, expected: VaultError) {
    assert_eq!(
        evidence.result,
        Err(TransactionError::InstructionError(
            index,
            InstructionError::Custom(expected as u32),
        ))
    );
    assert!(
        evidence.slot.is_some(),
        "executed custom-error transaction needs a recorded slot"
    );
    assert_spread_synthetic_marker(evidence);
}

fn assert_spread_synthetic_marker(evidence: &TransactionEvidence) {
    assert!(
        evidence
            .logs
            .iter()
            .any(|line| line.contains(BUILD_RELEASE_MARKER)),
        "every synthetic-feature Spread admission must emit the do-not-release marker: {:?}",
        evidence.logs
    );
}

async fn assert_config_unchanged(harness: &Harness, expected_bytes: &[u8]) {
    assert_eq!(harness.config_bytes().await, expected_bytes);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_sbf_update_config_enforces_gate_and_preserves_handler_atomicity() {
    let mut harness = Harness::normal().await;
    let initial_bytes = harness.config_bytes().await;
    assert_eq!(initial_bytes.len(), VaultConfig::LEN);

    harness
        .set_gate(SyntheticGateCommand::Active, 10)
        .await
        .print("matrix_active_10");

    let missing_tail = harness.submit_update(None, GateAccountMode::Present).await;
    missing_tail.print("matrix_missing_tail");
    assert_custom_error(&missing_tail, 0, VaultError::MissingGovernanceTail);
    assert_config_unchanged(&harness, &initial_bytes).await;

    let missing_gate = harness
        .submit_update(Some(10), GateAccountMode::NoInstructionAccounts)
        .await;
    missing_gate.print("matrix_missing_gate");
    assert_custom_error(&missing_gate, 0, VaultError::MissingGovernanceGate);
    assert_config_unchanged(&harness, &initial_bytes).await;

    let omitted_gate = harness
        .submit_update(Some(10), GateAccountMode::OmittedFromLegacyGraph)
        .await;
    omitted_gate.print("matrix_omitted_gate_from_legacy_graph");
    assert_custom_error(&omitted_gate, 0, VaultError::InvalidGovernanceGatePda);
    assert_config_unchanged(&harness, &initial_bytes).await;

    for (label, expected_epoch) in [("matrix_stale_epoch", 9), ("matrix_future_epoch", 11)] {
        let evidence = harness
            .submit_update(Some(expected_epoch), GateAccountMode::Present)
            .await;
        evidence.print(label);
        assert_custom_error(&evidence, 0, VaultError::GovernanceGateEpochMismatch);
        assert_config_unchanged(&harness, &initial_bytes).await;
    }

    harness
        .set_gate(SyntheticGateCommand::EmergencyFrozen, 11)
        .await
        .print("matrix_frozen_11");
    let frozen = harness
        .submit_update(Some(11), GateAccountMode::Present)
        .await;
    frozen.print("matrix_frozen_rejection");
    assert_custom_error(&frozen, 0, VaultError::GovernanceGateFrozen);
    assert_config_unchanged(&harness, &initial_bytes).await;

    harness
        .set_gate(SyntheticGateCommand::Active, 12)
        .await
        .print("matrix_active_12");
    let accepted = harness
        .submit_update(Some(12), GateAccountMode::Present)
        .await;
    accepted.print("matrix_valid_update_config");
    assert_eq!(accepted.result, Ok(()));
    assert!(accepted.slot.is_some());
    assert_spread_synthetic_marker(&accepted);
    let mut expected = harness.initial_config.clone();
    expected.paused = true;
    assert_eq!(harness.config().await, expected);

    let mut wrong_owner = Harness::wrong_owner(10).await;
    let wrong_owner_initial = wrong_owner.config_bytes().await;
    let rejected = wrong_owner
        .submit_update(Some(10), GateAccountMode::Present)
        .await;
    rejected.print("matrix_wrong_owner");
    assert_custom_error(&rejected, 0, VaultError::InvalidGovernanceGateOwner);
    assert_config_unchanged(&wrong_owner, &wrong_owner_initial).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn actual_sbf_gate_account_lock_race_serializes_mutation_and_freeze() {
    let mut harness = Harness::normal().await;
    let initial_bytes = harness.config_bytes().await;
    harness
        .set_gate(SyntheticGateCommand::Active, 41)
        .await
        .print("race_active_41");

    let shared_blockhash = harness.fresh_blockhash().await;
    let mutation_instruction = harness.update_instruction(Some(41), GateAccountMode::Present);
    let freeze_instruction =
        controller_instruction(harness.gate_key, SyntheticGateCommand::EmergencyFrozen, 42);
    assert_ne!(harness.admin.pubkey(), harness.controller_payer.pubkey());
    assert_eq!(
        mutation_instruction.accounts.last().unwrap().pubkey,
        harness.gate_key
    );
    assert!(!mutation_instruction.accounts.last().unwrap().is_writable);
    assert_eq!(freeze_instruction.accounts.len(), 1);
    assert_eq!(freeze_instruction.accounts[0].pubkey, harness.gate_key);
    assert!(freeze_instruction.accounts[0].is_writable);
    let mutation = Transaction::new_signed_with_payer(
        &[mutation_instruction],
        Some(&harness.admin.pubkey()),
        &[&harness.admin],
        shared_blockhash,
    );
    let freeze = Transaction::new_signed_with_payer(
        &[freeze_instruction],
        Some(&harness.controller_payer.pubkey()),
        &[&harness.controller_payer],
        shared_blockhash,
    );
    let mutation_signature = mutation.signatures[0];
    let freeze_signature = freeze.signatures[0];

    let mutation_client = harness.context.banks_client.clone();
    let freeze_client = harness.context.banks_client.clone();
    let (mutation_processed, freeze_processed) = tokio::join!(
        mutation_client.process_transaction_with_metadata(mutation),
        freeze_client.process_transaction_with_metadata(freeze),
    );
    let mut mutation_evidence = transaction_evidence(
        &harness.context.banks_client,
        mutation_signature,
        mutation_processed.expect("race mutation transport"),
    )
    .await;
    let mut freeze_evidence = transaction_evidence(
        &harness.context.banks_client,
        freeze_signature,
        freeze_processed.expect("race freeze transport"),
    )
    .await;
    mutation_evidence.print("race_mutation_initial");
    freeze_evidence.print("race_freeze_initial");
    let mutation_initial_json = transaction_evidence_json(&mutation_evidence);
    let freeze_initial_json = transaction_evidence_json(&freeze_evidence);
    let mut mutation_retry_json = None;
    let mut freeze_retry_json = None;

    let mutation_conflicted = mutation_evidence.result == Err(TransactionError::AccountInUse);
    let freeze_conflicted = freeze_evidence.result == Err(TransactionError::AccountInUse);
    assert!(!(mutation_conflicted && freeze_conflicted));

    if mutation_conflicted {
        let blockhash = harness.fresh_blockhash().await;
        let retry = Transaction::new_signed_with_payer(
            &[harness.update_instruction(Some(41), GateAccountMode::Present)],
            Some(&harness.admin.pubkey()),
            &[&harness.admin],
            blockhash,
        );
        mutation_evidence = submit_with_evidence(&harness.context.banks_client, retry).await;
        mutation_evidence.print("race_mutation_retry");
        mutation_retry_json = Some(transaction_evidence_json(&mutation_evidence));
    }
    if freeze_conflicted {
        let blockhash = harness.fresh_blockhash().await;
        let retry = Transaction::new_signed_with_payer(
            &[controller_instruction(
                harness.gate_key,
                SyntheticGateCommand::EmergencyFrozen,
                42,
            )],
            Some(&harness.controller_payer.pubkey()),
            &[&harness.controller_payer],
            blockhash,
        );
        freeze_evidence = submit_with_evidence(&harness.context.banks_client, retry).await;
        freeze_evidence.print("race_freeze_retry");
        freeze_retry_json = Some(transaction_evidence_json(&freeze_evidence));
    }

    assert_eq!(freeze_evidence.result, Ok(()));
    assert!(freeze_evidence.slot.is_some());
    let mutation_succeeded = mutation_evidence.result == Ok(());
    if !mutation_succeeded {
        assert_custom_error(&mutation_evidence, 0, VaultError::GovernanceGateFrozen);
    } else {
        assert_spread_synthetic_marker(&mutation_evidence);
    }

    let final_gate = harness.gate().await;
    assert_eq!(final_gate.status, GateStatusV1::EmergencyFrozen);
    assert_eq!(final_gate.epoch, 42);
    let final_config = harness.config().await;
    if mutation_succeeded {
        let mut expected = harness.initial_config.clone();
        expected.paused = true;
        assert_eq!(final_config, expected);
        println!("phase3_governance_sbf race_outcome=mutation_then_freeze final_epoch=42");
    } else {
        assert_eq!(harness.config_bytes().await, initial_bytes);
        println!("phase3_governance_sbf race_outcome=freeze_then_mutation_rejected final_epoch=42");
    }
    let outcome = if mutation_succeeded {
        "mutation_then_freeze"
    } else {
        "freeze_then_mutation_rejected"
    };
    print_runtime_evidence(serde_json::json!({
        "kind": "gate_lock_race",
        "raceWinner": if mutation_succeeded { "mutation" } else { "freeze" },
        "serializationOrder": outcome,
        "mutationSucceeded": mutation_succeeded,
        "freezeSucceeded": true,
        "mutationInitial": mutation_initial_json,
        "freezeInitial": freeze_initial_json,
        "mutationRetry": mutation_retry_json,
        "freezeRetry": freeze_retry_json,
        "finalGateStatus": "EmergencyFrozen",
        "finalGateEpoch": 42,
    }));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_sbf_stale_epoch_rejected_for_durable_nonce_and_refreshed_blockhash() {
    let mut harness = Harness::normal().await;
    let initial_bytes = harness.config_bytes().await;
    let active_70 = harness.set_gate(SyntheticGateCommand::Active, 70).await;
    active_70.print("nonce_active_70");

    let nonce = Keypair::new_from_array([71u8; 32]);
    let rent = harness
        .context
        .banks_client
        .get_rent()
        .await
        .expect("read rent");
    let create_blockhash = harness.fresh_blockhash().await;
    let create_nonce = Transaction::new_signed_with_payer(
        &create_nonce_account(
            &harness.admin.pubkey(),
            &nonce.pubkey(),
            &harness.admin.pubkey(),
            rent.minimum_balance(NonceState::size()),
        ),
        Some(&harness.admin.pubkey()),
        &[&harness.admin, &nonce],
        create_blockhash,
    );
    let created = submit_with_evidence(&harness.context.banks_client, create_nonce).await;
    created.print("nonce_created");
    assert_eq!(created.result, Ok(()));

    let signed_nonce_hash = nonce_blockhash(&harness.context.banks_client, nonce.pubkey()).await;
    let old_nonce_transaction = Transaction::new_signed_with_payer(
        &[
            advance_nonce_account(&nonce.pubkey(), &harness.admin.pubkey()),
            harness.update_instruction(Some(70), GateAccountMode::Present),
        ],
        Some(&harness.admin.pubkey()),
        &[&harness.admin],
        signed_nonce_hash,
    );

    let frozen_71 = harness
        .set_gate(SyntheticGateCommand::EmergencyFrozen, 71)
        .await;
    frozen_71.print("nonce_frozen_71");
    let active_72 = harness.set_gate(SyntheticGateCommand::Active, 72).await;
    active_72.print("nonce_active_72");
    let nonce_unchanged_before_submit =
        nonce_blockhash(&harness.context.banks_client, nonce.pubkey()).await == signed_nonce_hash;
    assert!(
        nonce_unchanged_before_submit,
        "governance transitions must not consume the otherwise-valid durable nonce"
    );

    let rejected_nonce =
        submit_with_evidence(&harness.context.banks_client, old_nonce_transaction).await;
    rejected_nonce.print("nonce_old_epoch_rejected");
    assert_custom_error(&rejected_nonce, 1, VaultError::GovernanceGateEpochMismatch);
    assert_config_unchanged(&harness, &initial_bytes).await;
    let gate_after_nonce = harness.gate().await;
    assert_eq!(gate_after_nonce.status, GateStatusV1::Active);
    assert_eq!(gate_after_nonce.epoch, 72);
    print_runtime_evidence(serde_json::json!({
        "kind": "durable_nonce_stale_epoch",
        "signedEpoch": 70,
        "frozenEpoch": 71,
        "reactivatedEpoch": 72,
        "nonceUnchangedBeforeSubmit": nonce_unchanged_before_submit,
        "nonceHash": signed_nonce_hash.to_string(),
        "activeAtSigning": transaction_evidence_json(&active_70),
        "frozenTransition": transaction_evidence_json(&frozen_71),
        "reactivatedTransition": transaction_evidence_json(&active_72),
        "rejection": transaction_evidence_json(&rejected_nonce),
        "expectedInstructionIndex": 1,
        "expectedCustomError": VaultError::GovernanceGateEpochMismatch as u32,
        "finalGateStatus": "Active",
        "finalGateEpoch": gate_after_nonce.epoch,
    }));

    // A new recent blockhash does not refresh the authority plan itself. The instruction remains
    // bound to epoch 72 while the controller advances through 73 and 74.
    let stale_recent_instruction = harness.update_instruction(Some(72), GateAccountMode::Present);
    let frozen_73 = harness
        .set_gate(SyntheticGateCommand::EmergencyFrozen, 73)
        .await;
    frozen_73.print("recent_frozen_73");
    let active_74 = harness.set_gate(SyntheticGateCommand::Active, 74).await;
    active_74.print("recent_active_74");
    let refreshed_blockhash = harness.fresh_blockhash().await;
    let stale_recent_transaction = Transaction::new_signed_with_payer(
        &[stale_recent_instruction],
        Some(&harness.admin.pubkey()),
        &[&harness.admin],
        refreshed_blockhash,
    );
    let rejected_recent =
        submit_with_evidence(&harness.context.banks_client, stale_recent_transaction).await;
    rejected_recent.print("recent_refreshed_blockhash_stale_epoch_rejected");
    assert_custom_error(&rejected_recent, 0, VaultError::GovernanceGateEpochMismatch);
    assert_config_unchanged(&harness, &initial_bytes).await;
    let final_gate = harness.gate().await;
    assert_eq!(final_gate.status, GateStatusV1::Active);
    assert_eq!(final_gate.epoch, 74);
    print_runtime_evidence(serde_json::json!({
        "kind": "refreshed_blockhash_stale_epoch",
        "signedEpoch": 72,
        "frozenEpoch": 73,
        "reactivatedEpoch": 74,
        "refreshedBlockhash": refreshed_blockhash.to_string(),
        "frozenTransition": transaction_evidence_json(&frozen_73),
        "reactivatedTransition": transaction_evidence_json(&active_74),
        "rejection": transaction_evidence_json(&rejected_recent),
        "expectedInstructionIndex": 0,
        "expectedCustomError": VaultError::GovernanceGateEpochMismatch as u32,
        "finalGateStatus": "Active",
        "finalGateEpoch": final_gate.epoch,
    }));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actual_sbf_stale_durable_nonce_dynamic_epoch_cpi_is_rejected() {
    let mut harness = Harness::normal().await;
    let initial_bytes = harness.config_bytes().await;
    let active_80 = harness.set_gate(SyntheticGateCommand::Active, 80).await;
    active_80.print("dynamic_cpi_active_80");

    let nonce = Keypair::new_from_array([81u8; 32]);
    let rent = harness
        .context
        .banks_client
        .get_rent()
        .await
        .expect("read rent");
    let create_blockhash = harness.fresh_blockhash().await;
    let create_nonce = Transaction::new_signed_with_payer(
        &create_nonce_account(
            &harness.admin.pubkey(),
            &nonce.pubkey(),
            &harness.admin.pubkey(),
            rent.minimum_balance(NonceState::size()),
        ),
        Some(&harness.admin.pubkey()),
        &[&harness.admin, &nonce],
        create_blockhash,
    );
    let created = submit_with_evidence(&harness.context.banks_client, create_nonce).await;
    created.print("dynamic_cpi_nonce_created");
    assert_eq!(created.result, Ok(()));

    let signed_nonce_hash = nonce_blockhash(&harness.context.banks_client, nonce.pubkey()).await;
    let stale_outer_transaction = Transaction::new_signed_with_payer(
        &[
            advance_nonce_account(&nonce.pubkey(), &harness.admin.pubkey()),
            harness.dynamic_epoch_cpi_update_instruction(),
        ],
        Some(&harness.admin.pubkey()),
        &[&harness.admin],
        signed_nonce_hash,
    );

    let frozen_81 = harness
        .set_gate(SyntheticGateCommand::EmergencyFrozen, 81)
        .await;
    frozen_81.print("dynamic_cpi_frozen_81");
    let active_82 = harness.set_gate(SyntheticGateCommand::Active, 82).await;
    active_82.print("dynamic_cpi_active_82");
    let nonce_unchanged_before_submit =
        nonce_blockhash(&harness.context.banks_client, nonce.pubkey()).await == signed_nonce_hash;
    assert!(
        nonce_unchanged_before_submit,
        "governance transitions must not consume the signed outer caller's durable nonce"
    );

    DYNAMIC_CALLER_OBSERVED_EPOCH.store(0, Ordering::SeqCst);
    let rejected =
        submit_with_evidence(&harness.context.banks_client, stale_outer_transaction).await;
    rejected.print("dynamic_cpi_fresh_tail_rejected");
    assert_eq!(
        rejected.result,
        Err(TransactionError::InstructionError(
            1,
            InstructionError::Custom(VaultError::InvalidInstructionData as u32),
        ))
    );
    assert!(rejected.slot.is_some());
    let caller_observed_epoch = DYNAMIC_CALLER_OBSERVED_EPOCH.load(Ordering::SeqCst);
    assert_eq!(caller_observed_epoch, 82);
    let spread_cpi_invoke_depth_log_present = rejected
        .logs
        .iter()
        .any(|line| line.contains(&format!("Program {} invoke [2]", light_token_minter::id())));
    assert!(
        spread_cpi_invoke_depth_log_present,
        "the actual Spread SBF must be invoked at CPI stack height two"
    );
    let synthetic_marker_present = rejected
        .logs
        .iter()
        .any(|line| line.contains(BUILD_RELEASE_MARKER));
    assert!(
        !synthetic_marker_present,
        "CPI rejection must happen before governance-envelope validation"
    );
    assert_config_unchanged(&harness, &initial_bytes).await;
    let post_reject_nonce_hash =
        nonce_blockhash(&harness.context.banks_client, nonce.pubkey()).await;
    let nonce_advanced_after_reject = post_reject_nonce_hash != signed_nonce_hash;
    assert!(
        nonce_advanced_after_reject,
        "a landed durable-nonce transaction must consume its nonce even when a later instruction fails"
    );
    let final_gate = harness.gate().await;
    assert_eq!(final_gate.status, GateStatusV1::Active);
    assert_eq!(final_gate.epoch, 82);

    print_runtime_evidence(serde_json::json!({
        "kind": "durable_nonce_dynamic_epoch_cpi_rejected",
        "outerSignedAtEpoch": 80,
        "frozenEpoch": 81,
        "reactivatedEpoch": 82,
        "dynamicTailEpoch": 82,
        "expectedSpreadStackHeight": 2,
        "nonceUnchangedBeforeSubmit": nonce_unchanged_before_submit,
        "nonceAdvancedAfterReject": nonce_advanced_after_reject,
        "nonceHash": signed_nonce_hash.to_string(),
        "postRejectNonceHash": post_reject_nonce_hash.to_string(),
        "callerProgramId": DYNAMIC_EPOCH_CPI_CALLER_PROGRAM_ID.to_string(),
        "spreadProgramId": light_token_minter::id().to_string(),
        "callerObservedEpoch": caller_observed_epoch,
        "spreadCpiInvokeDepthLogPresent": spread_cpi_invoke_depth_log_present,
        "syntheticMarkerAbsentBeforeEnvelope": !synthetic_marker_present,
        "activeAtSigning": transaction_evidence_json(&active_80),
        "frozenTransition": transaction_evidence_json(&frozen_81),
        "reactivatedTransition": transaction_evidence_json(&active_82),
        "rejection": transaction_evidence_json(&rejected),
        "expectedInstructionIndex": 1,
        "expectedCustomError": VaultError::InvalidInstructionData as u32,
        "finalGateStatus": "Active",
        "finalGateEpoch": final_gate.epoch,
    }));
}

async fn nonce_blockhash(client: &BanksClient, nonce: Pubkey) -> Hash {
    let account = client
        .get_account(nonce)
        .await
        .expect("read nonce account")
        .expect("nonce account exists");
    let versions: NonceVersions =
        bincode::deserialize(&account.data).expect("decode nonce account versions");
    match versions.state() {
        NonceState::Initialized(data) => data.blockhash(),
        NonceState::Uninitialized => panic!("nonce account is not initialized"),
    }
}
