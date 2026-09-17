use super::*;
use crate::governance::encode_governance_instruction_tail_v1;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use solana_program::instruction::AccountMeta;
mod flat;

#[test]
fn qualified_gate_reader_preserves_frozen_reads_without_write_admission() {
    let mut fixture = Fixture::new();
    fixture.gate[11] = 2;
    fixture.gate[148..156].copy_from_slice(&1_u64.to_le_bytes());
    fixture.gate[156..158].copy_from_slice(&1_u16.to_le_bytes());
    let observation = fixture.observation(102);
    let gate =
        validate_current_governed_gate_account_v1(&fixture.release, observation.gate).unwrap();
    assert_eq!(gate.status, GovernanceGateStatusV1::EmergencyFrozen);
    assert_eq!(
        observe_current_governed_write_context_v1(&fixture.release, observation, 101),
        Err(GovernedOperationError::GateStale)
    );
}

// Synthetic local byte fixtures. This constructor exists only in a unit-test
// compilation, never behind a shipping feature, environment flag or public API.
pub(crate) struct Fixture {
    pub(crate) release: CurrentGovernedWriteReleaseV1,
    program: Vec<u8>,
    programdata: Vec<u8>,
    gate: Vec<u8>,
}

impl Fixture {
    pub(crate) fn new() -> Self {
        let authority = pubkey!("4hsEKyThDv85YA4HjUaGWn2nWnVbM5V23XcLrEX3UKzn");
        let mut program = 2_u32.to_le_bytes().to_vec();
        program.extend_from_slice(CURRENT_LIVE_PROGRAMDATA.as_ref());
        let mut programdata = 3_u32.to_le_bytes().to_vec();
        programdata.extend_from_slice(&100_u64.to_le_bytes());
        programdata.push(1);
        programdata.extend_from_slice(authority.as_ref());
        programdata.extend_from_slice(b"explicit-unattested-local-unit-test-payload");
        let artifact_bytes = programdata.len() - 45;
        programdata.extend_from_slice(&[0; 8]);
        let payload_bytes = programdata.len() - 45;
        let mut gate = vec![0; 192];
        gate[..8].copy_from_slice(b"AGVGAT01");
        gate[8] = 1;
        gate[9] = Pubkey::find_program_address(
            &[
                GOVERNANCE_UPGRADE_SEED_DOMAIN_V1,
                b"gate",
                CURRENT_LIVE_PROGRAM_ID.as_ref(),
            ],
            &CONTROLLER,
        )
        .1;
        gate[10] = 1;
        gate[12..44].copy_from_slice(CONFIG.as_ref());
        gate[44..76].copy_from_slice(CURRENT_LIVE_PROGRAM_ID.as_ref());
        gate[76..108].copy_from_slice(CURRENT_LIVE_PROGRAMDATA.as_ref());
        gate[108..116].copy_from_slice(&2_u64.to_le_bytes());
        let release = CurrentGovernedWriteReleaseV1 {
            source_commit: "a".repeat(40),
            artifact_source_commit: "d".repeat(40),
            artifact_sha256: sha256(&programdata[45..45 + artifact_bytes]),
            artifact_bytes,
            mandatory_zero_padding_bytes: 8,
            package_sha256: "b".repeat(64),
            manifest_sha256: "c".repeat(64),
            payload_sha256: sha256(&programdata[45..45 + payload_bytes]),
            program_sha256: sha256(&program),
            programdata_sha256: sha256(&programdata),
            payload_bytes,
            programdata_bytes: programdata.len(),
            deployed_slot: 100,
            finalized_slot: 101,
            upgrade_authority: authority,
            assigned_tags: vec![
                12, 13, 14, 15, 200, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231,
                232, 234, 235, 236, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251,
                254,
            ],
        };
        Self {
            release,
            program,
            programdata,
            gate,
        }
    }

    pub(crate) fn observation(&self, slot: u64) -> CurrentGovernedObservationV1<'_> {
        CurrentGovernedObservationV1 {
            genesis_hash: GENESIS,
            commitment: "finalized",
            context_slot: slot,
            program: CurrentGovernedAccountObservationV1 {
                address: CURRENT_LIVE_PROGRAM_ID,
                owner: solana_sdk_ids::bpf_loader_upgradeable::ID,
                executable: true,
                data: &self.program,
            },
            programdata: CurrentGovernedAccountObservationV1 {
                address: CURRENT_LIVE_PROGRAMDATA,
                owner: solana_sdk_ids::bpf_loader_upgradeable::ID,
                executable: false,
                data: &self.programdata,
            },
            gate: CurrentGovernedAccountObservationV1 {
                address: GATE,
                owner: CONTROLLER,
                executable: false,
                data: &self.gate,
            },
        }
    }

    pub(crate) fn context(&self) -> CurrentGovernedWriteContextV1 {
        observe_current_governed_write_context_v1(&self.release, self.observation(102), 101)
            .unwrap()
    }
}

fn instruction(context: &CurrentGovernedWriteContextV1) -> Instruction {
    let mut data = vec![254, 0];
    data.extend_from_slice(&encode_governance_instruction_tail_v1(context.epoch()));
    Instruction {
        program_id: CURRENT_LIVE_PROGRAM_ID,
        data,
        accounts: vec![
            AccountMeta::new(Pubkey::new_from_array([7; 32]), true),
            AccountMeta::new_readonly(GATE, false),
        ],
    }
}

#[test]
fn shipping_release_is_qualified_and_generation_substitution_is_rejected() {
    assert!(current_governed_write_release_v1().is_ok());
    let mut train: Value = serde_json::from_str(TRAIN).unwrap();
    let runtime: Value = serde_json::from_str(RUNTIME).unwrap();
    train["selectedGovernanceGeneration"] = Value::from(2);
    assert_eq!(
        qualified_release(&train, &runtime),
        Err(GovernedOperationError::ReleaseInvalid)
    );
}

#[test]
fn release_qualification_requires_complete_mutually_bound_package_evidence() {
    let fixture = Fixture::new();
    let r = &fixture.release;
    let mut train: Value = serde_json::from_str(TRAIN).unwrap();
    let mut runtime: Value = serde_json::from_str(RUNTIME).unwrap();
    train["selectedGovernanceGeneration"] = Value::from(3);
    train["liveGovernanceIdentity"]["live"] = Value::from(true);
    train["liveGovernanceIdentity"]["activationEvidence"] =
        serde_json::json!({"scope":"cfg-test-only-unattested"});
    train["sourceHeads"]["spread"] = Value::from(r.source_commit.clone());
    let tags = (0_u8..=u8::MAX)
        .filter(|tag| {
            crate::instruction::VaultInstructionTag::from_byte(*tag).is_some()
                || crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::from_byte(*tag)
                    .is_some()
        })
        .collect::<Vec<_>>();
    train["writeRelease"] = serde_json::json!({"status":"available","compatibility":"governance-gate-v1","governanceIdentityGeneration":3,
        "spreadReleaseCommit":r.source_commit,"spreadPackageArtifactSha256":r.package_sha256,"instructionManifestSha256":r.manifest_sha256,
        "programDataPayloadSha256":r.payload_sha256,"assignedInstructionTags":tags});
    let live = &mut train["finalizedLiveDeployment"];
    live["sourceCommit"] = Value::from(r.source_commit.clone());
    live["artifactSourceCommit"] = Value::from(r.artifact_source_commit.clone());
    live["artifactSha256"] = Value::from(r.artifact_sha256.clone());
    live["artifactBytes"] = Value::from(r.artifact_bytes);
    live["mandatoryZeroPaddingBytes"] = Value::from(r.mandatory_zero_padding_bytes);
    live["programAccountSha256"] = Value::from(r.program_sha256.clone());
    live["programDataAccountBytes"] = Value::from(r.programdata_bytes);
    live["programDataAccountSha256"] = Value::from(r.programdata_sha256.clone());
    live["programDataPayloadBytes"] = Value::from(r.payload_bytes);
    live["programDataPayloadSha256"] = Value::from(r.payload_sha256.clone());
    live["programDataSlot"] = Value::from(r.deployed_slot);
    live["minimumContextSlot"] = Value::from(r.finalized_slot);
    live["upgradeAuthority"]["address"] = Value::from(r.upgrade_authority.to_string());
    live["writeCompatibility"] = Value::from("governance-gate-v1");
    runtime["deployment"] = live.clone();
    runtime["sourceCommit"] = Value::from(r.source_commit.clone());
    runtime["currentWriteEligible"] = Value::from(true);
    runtime["deploymentCorrespondenceVerified"] = Value::from(true);
    runtime["sourceWorktreeDirty"] = Value::from(false);
    runtime["assignedInstructionTags"] = serde_json::json!(tags);
    runtime["packageArtifact"]["sha256"] = Value::from(r.package_sha256.clone());
    runtime["instructionManifestSourceSha256"] = Value::from(r.manifest_sha256.clone());
    let transport: Value = serde_json::from_str(WRITER_TRANSPORT).unwrap();
    train["writeRelease"]["writerOperationTransport"] = transport.clone();
    runtime["writerOperationTransport"] = transport.clone();
    let transport_digest = sha256(&serde_json::to_vec(&canonical_json(&transport)).unwrap());
    train["writeRelease"]["writerOperationTransportSha256"] = Value::from(transport_digest.clone());
    runtime["writerOperationTransportSha256"] = Value::from(transport_digest);
    let dlmm_transport: Value = serde_json::from_str(include_str!(
        "../../../src/protocol/writer-dlmm-transport.v1.json"
    )).unwrap();
    let dlmm_digest = sha256(&serde_json::to_vec(&canonical_json(&dlmm_transport)).unwrap());
    train["writeRelease"]["writerDlmmTransport"] = dlmm_transport.clone();
    runtime["writerDlmmTransport"] = dlmm_transport.clone();
    train["writeRelease"]["writerDlmmTransportSha256"] = Value::from(dlmm_digest.clone());
    runtime["writerDlmmTransportSha256"] = Value::from(dlmm_digest);
    let qualified = qualified_release(&train, &runtime).unwrap();
    assert_eq!(qualified.payload_sha256, r.payload_sha256);
    assert_eq!(qualified.artifact_source_commit(), r.artifact_source_commit);
    assert_ne!(
        qualified.artifact_source_commit(),
        qualified.source_commit()
    );
    assert_eq!(qualified.artifact_sha256(), r.artifact_sha256);
    assert_ne!(qualified.artifact_sha256(), qualified.payload_sha256());
    assert_eq!(
        qualified.artifact_bytes() + qualified.mandatory_zero_padding_bytes(),
        qualified.payload_bytes()
    );
    for (key, value) in [
        ("artifactSourceCommit", Value::Null),
        ("artifactSha256", Value::from("0".repeat(64))),
        ("artifactBytes", Value::from(0)),
        ("mandatoryZeroPaddingBytes", Value::from(7)),
        ("mandatoryZeroPaddingBytes", Value::from(-1)),
    ] {
        let mut changed = train.clone();
        changed["finalizedLiveDeployment"][key] = value;
        let mut changed_runtime = runtime.clone();
        changed_runtime["deployment"] = changed["finalizedLiveDeployment"].clone();
        assert!(
            qualified_release(&changed, &changed_runtime).is_err(),
            "{key}"
        );
    }
    observe_current_governed_write_context_v1(&qualified, fixture.observation(102), 101).unwrap();
    for (field, preset) in [("writerOperationTransport", &transport), ("writerDlmmTransport", &dlmm_transport)] {
    for (key, original) in preset.as_object().unwrap() {
        let mut changed = preset.clone();
        changed[key] = match original {
            Value::String(_) => Value::from("changed"),
            Value::Number(_) => Value::from(99),
            Value::Array(_) => serde_json::json!([]),
            Value::Bool(value) => Value::from(!*value),
            _ => panic!("unexpected preset field"),
        };
        let mut changed_train = train.clone();
        let mut changed_runtime = runtime.clone();
        changed_train["writeRelease"][field] = changed.clone();
        changed_runtime[field] = changed;
        assert!(
            qualified_release(&changed_train, &runtime).is_err(),
            "train {key}"
        );
        assert!(
            qualified_release(&train, &changed_runtime).is_err(),
            "runtime {key}"
        );
        assert!(
            qualified_release(&changed_train, &changed_runtime).is_err(),
            "mutually wrong {key}"
        );
    }
    }
    for (path, value) in [
        ("/selectedGovernanceGeneration", Value::from(1)),
        ("/writeRelease/compatibility", Value::from("anything")),
        (
            "/writeRelease/writerOperationTransportSha256",
            Value::from("d".repeat(64)),
        ),
        ("/sourceHeads/spread", Value::from("0".repeat(40))),
        ("/writeRelease/writerDlmmTransportSha256", Value::from("d".repeat(64))),
        ("/liveGovernanceIdentity/live", Value::from(false)),
        ("/liveGovernanceIdentity/mainnetAllowed", Value::from(true)),
        (
            "/liveGovernanceIdentity/artifactSha256",
            Value::from("e".repeat(64)),
        ),
        (
            "/liveGovernanceIdentity/controllerProgramId",
            Value::from(CURRENT_LIVE_PROGRAM_ID.to_string()),
        ),
        (
            "/finalizedLiveDeployment/genesisHash",
            Value::from("mainnet"),
        ),
        (
            "/finalizedLiveDeployment/programDataPayloadBytes",
            Value::from(0),
        ),
        (
            "/finalizedLiveDeployment/upgradeAuthority/address",
            Value::from(GATE.to_string()),
        ),
        (
            "/writeRelease/assignedInstructionTags",
            serde_json::json!([234]),
        ),
    ] {
        let mut changed = train.clone();
        *changed.pointer_mut(path).unwrap() = value;
        assert!(qualified_release(&changed, &runtime).is_err(), "{path}");
    }
    for (path, value) in [
        ("/currentWriteEligible", Value::from(false)),
        ("/writerDlmmTransportSha256", Value::from("d".repeat(64))),
        (
            "/writerOperationTransportSha256",
            Value::from("d".repeat(64)),
        ),
        ("/deploymentCorrespondenceVerified", Value::from(false)),
        ("/sourceWorktreeDirty", Value::from(true)),
        ("/sourceCommit", Value::Null),
        ("/deployment", Value::Null),
        ("/assignedInstructionTags", serde_json::json!([233])),
        ("/packageArtifact/sha256", Value::from("d".repeat(64))),
        (
            "/instructionManifestSourceSha256",
            Value::from("d".repeat(64)),
        ),
    ] {
        let mut changed = runtime.clone();
        *changed.pointer_mut(path).unwrap() = value;
        assert!(qualified_release(&train, &changed).is_err(), "{path}");
    }
}

#[test]
fn exact_finalized_observation_and_refresh_are_required() {
    let mut fixture = Fixture::new();
    let context = fixture.context();
    assert!(
        refresh_current_governed_write_context_v1(
            &context,
            &fixture.release,
            fixture.observation(103)
        )
        .is_ok()
    );
    for variant in 0..12 {
        let mut observation = fixture.observation(103);
        match variant {
            0 => observation.genesis_hash = "mainnet",
            1 => observation.commitment = "confirmed",
            2 => observation.context_slot = 101,
            3 => observation.program.executable = false,
            4 => observation.program.owner = GATE,
            5 => observation.program.address = GATE,
            6 => observation.programdata.executable = true,
            7 => observation.programdata.owner = GATE,
            8 => observation.programdata.address = GATE,
            9 => observation.gate.owner = CURRENT_LIVE_PROGRAM_ID,
            10 => observation.gate.address = CONFIG,
            _ => observation.gate.executable = true,
        }
        assert!(
            refresh_current_governed_write_context_v1(&context, &fixture.release, observation)
                .is_err(),
            "variant {variant}"
        );
    }
    fixture.gate[108..116].copy_from_slice(&3_u64.to_le_bytes());
    assert_eq!(
        refresh_current_governed_write_context_v1(
            &context,
            &fixture.release,
            fixture.observation(104)
        ),
        Err(GovernedOperationError::GateStale)
    );
    fixture.gate[108..116].copy_from_slice(&2_u64.to_le_bytes());
    fixture.gate[11] = 2;
    fixture.gate[148..156].copy_from_slice(&103_u64.to_le_bytes());
    fixture.gate[156..158].copy_from_slice(&1_u16.to_le_bytes());
    assert_eq!(
        refresh_current_governed_write_context_v1(
            &context,
            &fixture.release,
            fixture.observation(104)
        ),
        Err(GovernedOperationError::GateStale)
    );
}

#[test]
fn program_payload_header_padding_gate_and_release_mutations_fail() {
    for index in [0, 4, 12, 13, 45, 86] {
        let mut fixture = Fixture::new();
        let context = fixture.context();
        fixture.programdata[index] ^= 1;
        assert!(
            refresh_current_governed_write_context_v1(
                &context,
                &fixture.release,
                fixture.observation(103)
            )
            .is_err()
        );
    }
    for index in [0, 8, 9, 10, 12, 44, 76, 190] {
        let mut fixture = Fixture::new();
        fixture.gate[index] ^= 1;
        assert!(
            observe_current_governed_write_context_v1(
                &fixture.release,
                fixture.observation(103),
                101
            )
            .is_err()
        );
    }
    let fixture = Fixture::new();
    let context = fixture.context();
    let mut changed = fixture.release.clone();
    changed.source_commit = "d".repeat(40);
    assert_eq!(
        refresh_current_governed_write_context_v1(&context, &changed, fixture.observation(103)),
        Err(GovernedOperationError::GateStale)
    );
}

#[test]
fn explicit_elf_identity_rejects_payload_hash_substitution_and_rehashed_padding() {
    let fixture = Fixture::new();
    let mut wrong = fixture.release.clone();
    wrong.artifact_sha256 = wrong.payload_sha256.clone();
    assert!(
        observe_current_governed_write_context_v1(&wrong, fixture.observation(103), 101).is_err()
    );
    let mut padded = Fixture::new();
    *padded.programdata.last_mut().unwrap() = 1;
    padded.release.programdata_sha256 = sha256(&padded.programdata);
    padded.release.payload_sha256 = sha256(&padded.programdata[45..]);
    assert!(
        observe_current_governed_write_context_v1(&padded.release, padded.observation(103), 101)
            .is_err()
    );
}

#[test]
fn envelopes_preserve_signed_bytes_and_reject_all_gate_variants() {
    let context = Fixture::new().context();
    let original = instruction(&context);
    let views = inspect_current_governed_instruction_v1(&context, &original).unwrap();
    assert_eq!(views.governed_instruction, original);
    assert_eq!(views.business_instruction.data, [254, 0]);
    assert_eq!(views.business_instruction.accounts, original.accounts[..1]);
    for variant in 0..8 {
        let mut changed = original.clone();
        match variant {
            0 => changed.accounts.last_mut().unwrap().is_signer = true,
            1 => changed.accounts.last_mut().unwrap().is_writable = true,
            2 => {
                changed.accounts.pop();
            }
            3 => changed
                .accounts
                .insert(0, AccountMeta::new_readonly(GATE, false)),
            4 => changed.data[10] ^= 1,
            5 => changed.data[2] ^= 1,
            6 => changed.data.resize(16_385, 0),
            _ => changed.program_id = GATE,
        }
        assert!(
            inspect_current_governed_instruction_v1(&context, &changed).is_err(),
            "variant {variant}"
        );
    }
    for tag in [0, 233, 237, 238, 239] {
        let mut changed = original.clone();
        changed.data = vec![tag];
        changed.accounts.clear();
        assert_eq!(
            inspect_current_governed_instruction_v1(&context, &changed),
            Err(GovernedOperationError::InstructionUnknown)
        );
    }
}

#[test]
fn full_transaction_privilege_union_and_exact_compiled_message_are_checked() {
    let context = Fixture::new().context();
    let original = instruction(&context);
    let payer = original.accounts[0].pubkey;
    let instructions = vec![original.clone()];
    let blockhash = Hash::new_from_array([4; 32]);
    let transaction = solana_transaction::Transaction::new_unsigned(
        solana_message::Message::new_with_blockhash(&instructions, Some(&payer), &blockhash),
    );
    assert!(
        validate_current_governed_legacy_transaction_v1(
            &context,
            payer,
            &instructions,
            blockhash,
            &transaction
        )
        .is_ok()
    );
    for variant in 0..6 {
        let mut changed = transaction.clone();
        match variant {
            0 => changed.message.header.num_readonly_unsigned_accounts = 0,
            1 => changed.message.account_keys.push(Pubkey::new_unique()),
            2 => changed.message.instructions[0].data[0] = 220,
            3 => changed.message.recent_blockhash = Hash::new_unique(),
            4 => changed
                .message
                .instructions
                .push(changed.message.instructions[0].clone()),
            _ => changed.signatures.clear(),
        }
        assert!(
            validate_current_governed_legacy_transaction_v1(
                &context,
                payer,
                &instructions,
                blockhash,
                &changed
            )
            .is_err(),
            "variant {variant}"
        );
    }
    for signer in [false, true] {
        let setup = Instruction {
            program_id: Pubkey::new_unique(),
            data: vec![],
            accounts: vec![AccountMeta {
                pubkey: GATE,
                is_signer: signer,
                is_writable: !signer,
            }],
        };
        assert_eq!(
            validate_current_governed_instruction_batch_v1(
                &context,
                payer,
                &[setup, original.clone()]
            ),
            Err(GovernedOperationError::GatePrivileges)
        );
    }
    assert_eq!(
        validate_current_governed_instruction_batch_v1(&context, GATE, &instructions),
        Err(GovernedOperationError::GatePrivileges)
    );
}

#[test]
fn retired_writer_bid_builder_is_not_admitted_by_the_g3_registry() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let builders = std::fs::read_to_string(root.join("src/protocol/current-builders.ts")).unwrap();

    assert!(builders.contains(
        "buildPlaceWriterBidV1Instruction = retiredBuilder<typeof historicalWriter.buildPlaceWriterBidV1Instruction>"
    ));
    assert!(builders.contains("G3_OPERATION_RETIRED"));
    assert!(!builders.contains("pinBuilder(\"buildPlaceWriterBidV1Instruction\""));
}

#[cfg(any())]
fn actual_bundled_typescript_bid_build_sign_and_rust_revalidation() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let output = std::process::Command::new("node")
        .arg("--experimental-vm-modules")
        .arg(root.join("scripts/emit-governed-writer-rust-fixture.mjs"))
        .current_dir(root)
        .output()
        .expect("offline fixture generator launches");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let generated: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(generated["status"], "offline-unattested");
    assert_eq!(generated["cases"].as_array().unwrap().len(), 1);
    assert!(generated["negativeChecks"].as_u64().unwrap() >= 1);
    assert_eq!(
        generated["compiledModuleSha256"],
        sha256(&std::fs::read(root.join("dist/protocol/writer-operation.js")).unwrap())
    );
    let runtime: Value = serde_json::from_str(RUNTIME).unwrap();
    assert_eq!(
        generated["candidatePackageSha256"],
        runtime["packageArtifact"]["sha256"]
    );
    assert_eq!(
        generated["candidateManifestSha256"],
        runtime["instructionManifestSourceSha256"]
    );
    assert_eq!(
        generated["candidatePackageSha256"],
        sha256(
            &std::fs::read(root.join(runtime["packageArtifact"]["path"].as_str().unwrap()))
                .unwrap()
        )
    );
    let mut fixture = Fixture::new();
    fixture.release.source_commit = runtime["sourceCommit"].as_str().unwrap().to_owned();
    fixture.release.package_sha256 = runtime["packageArtifact"]["sha256"]
        .as_str()
        .unwrap()
        .to_owned();
    fixture.release.manifest_sha256 = runtime["instructionManifestSourceSha256"]
        .as_str()
        .unwrap()
        .to_owned();
    let context = observe_current_governed_write_context_v1(
        &fixture.release,
        fixture.observation(1_000_000_000),
        101,
    )
    .unwrap();
    for case in generated["cases"].as_array().unwrap() {
        let encoded = serde_json::to_string(&case["plan"]).unwrap();
        let operation =
            crate::parse_current_governed_writer_operation_json_v1(&context, &encoded, &[])
                .unwrap_or_else(|error| panic!("{}: {error}", case["name"]));
        let transaction: solana_transaction::Transaction = bincode::deserialize(
            &BASE64
                .decode(case["serializedTransactionBase64"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        validate_current_governed_legacy_transaction_v1(
            &context,
            operation.payer(),
            &operation.batches[0],
            transaction.message.recent_blockhash,
            &transaction,
        )
        .unwrap();
        if matches!(
            case["plan"]["operation"].as_str().unwrap(),
            "auction_search" | "auction_materialize" | "auction_activate"
        ) {
            assert_eq!(case["plan"]["schemaVersion"], 2);
            assert_eq!(case["plan"]["setupMode"], "release_compute");
            assert_eq!(operation.batches[0].len(), 3);
            assert_eq!(operation.batches[0][0].data, vec![1, 0, 0, 1, 0]);
            assert_eq!(operation.batches[0][1].data, vec![2, 192, 92, 21, 0]);
            let mut changed = case["plan"].clone();
            changed["setupInstructionBatches"][0][0]["dataBase64"] = Value::from("AQAAAAA=");
            assert!(
                crate::parse_current_governed_writer_operation_json_v1(
                    &context,
                    &serde_json::to_string(&changed).unwrap(),
                    &[]
                )
                .is_err()
            );
            for mutation in 0..9 {
                let mut changed = case["plan"].clone();
                match mutation {
                    0 => changed["setupInstructionBatches"][0]
                        .as_array_mut()
                        .unwrap()
                        .swap(0, 1),
                    1 => {
                        changed["setupInstructionBatches"][0][0]["programId"] =
                            Value::from(GATE.to_string())
                    }
                    2 => {
                        changed["setupInstructionBatches"][0][0]["accounts"] = serde_json::json!([{ "address":GATE.to_string(),"isSigner":false,"isWritable":true }])
                    }
                    3 => {
                        changed["setupSignerRoles"] = serde_json::json!([{ "pubkey":operation.payer().to_string(),"role":"payer","setupBatchIndex":0,"instructionIndexes":[0] }])
                    }
                    4 => changed["setupInstructionBatches"][0]
                        .as_array_mut()
                        .unwrap()
                        .push(case["plan"]["setupInstructionBatches"][0][0].clone()),
                    5 => {
                        changed["setupInstructionBatches"][0][1]["dataBase64"] =
                            Value::from("AgEAAAA=")
                    }
                    6 => changed["setupMode"] = Value::from("cold_load"),
                    7 => changed["actionBatchIndex"] = Value::from(1),
                    _ => changed["executionInstructionBatches"][0]
                        .as_array_mut()
                        .unwrap()
                        .swap(0, 2),
                }
                if mutation <= 5 {
                    let mut execution = changed["setupInstructionBatches"][0]
                        .as_array()
                        .unwrap()
                        .clone();
                    execution.push(changed["instructions"][0].clone());
                    changed["executionInstructionBatches"] = serde_json::json!([execution]);
                }
                recommit(&mut changed);
                assert!(
                    crate::parse_current_governed_writer_operation_json_v1(
                        &context,
                        &changed.to_string(),
                        &[]
                    )
                    .is_err(),
                    "{} transport mutation{mutation}",
                    case["name"]
                );
            }
            let mut downgraded = case["plan"].clone();
            for field in [
                "setupMode",
                "setupInstructionBatches",
                "setupSignerRoles",
                "executionInstructionBatches",
                "actionBatchIndex",
            ] {
                downgraded.as_object_mut().unwrap().remove(field);
            }
            downgraded["schemaVersion"] = Value::from(1);
            recommit(&mut downgraded);
            assert!(
                crate::parse_current_governed_writer_operation_json_v1(
                    &context,
                    &downgraded.to_string(),
                    &[]
                )
                .is_err()
            );
        }
        for (field, value) in case["plan"]["semantic"].as_object().unwrap() {
            let mut changed = case["plan"].clone();
            changed["semantic"][field] = if let Some(flag) = value.as_bool() {
                Value::from(!flag)
            } else if let Some(number) = value.as_u64() {
                Value::from(number + 1)
            } else if let Some(text) = value.as_str() {
                if text.len() < 20 && text.bytes().all(|byte| byte.is_ascii_digit()) {
                    Value::from((text.parse::<u64>().unwrap() + 1).to_string())
                } else if text.len() == 64 {
                    Value::from("f".repeat(64))
                } else {
                    Value::from(Pubkey::new_from_array([99; 32]).to_string())
                }
            } else {
                panic!("unexpected fixture semantic")
            };
            recommit(&mut changed);
            assert!(
                crate::parse_current_governed_writer_operation_json_v1(
                    &context,
                    &changed.to_string(),
                    &[]
                )
                .is_err(),
                "{} semantic {field}",
                case["name"]
            );
        }
    }
    let case = &generated["cases"][0];
    assert_eq!(case["name"], "PlaceWriterBidV1");
    let encoded = serde_json::to_string(&case["plan"]).unwrap();
    let operation =
        crate::parse_current_governed_writer_operation_json_v1(&context, &encoded, &[]).unwrap();
    assert!(
        crate::parse_writer_operation_json(&encoded).is_err(),
        "historical parser cannot admit a governed envelope"
    );
    assert_eq!(
        operation
            .writer_operation()
            .unwrap()
            .plan
            .prepared_plan_digest,
        case["plan"]["preparedPlanDigest"]
    );
    let raw_data: Vec<Vec<u8>> = case["rawAccounts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| BASE64.decode(item["dataBase64"].as_str().unwrap()).unwrap())
        .collect();
    let raw_accounts = case["rawAccounts"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&raw_data)
        .map(|(item, data)| {
            let address = Pubkey::from_str(item["address"].as_str().unwrap()).unwrap();
            CurrentGovernedOptionalAccountObservationV1 {
                address,
                account: Some(CurrentGovernedAccountObservationV1 {
                    address,
                    owner: CURRENT_LIVE_PROGRAM_ID,
                    executable: false,
                    data,
                }),
            }
        })
        .collect::<Vec<_>>();
    let transaction: solana_transaction::Transaction = bincode::deserialize(
        &BASE64
            .decode(case["serializedTransactionBase64"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    let before = CurrentGovernedSigningObservationV1 {
        deployment: fixture.observation(1_000_000_001),
        business_accounts: &raw_accounts,
    };
    let signing = prepare_current_governed_signing_v1(
        &operation,
        &fixture.release,
        before,
        0,
        transaction.message.recent_blockhash,
    )
    .unwrap();
    validate_current_governed_legacy_transaction_v1(
        &context,
        operation.payer(),
        &operation.batches[0],
        transaction.message.recent_blockhash,
        &transaction,
    )
    .unwrap();
    // Sign the exact Rust-compiled message using the actual JS signer and only
    // deterministic fixture seed17. No wallet discovery, RPC or relay exists.
    let signed = std::process::Command::new("node").arg("--input-type=module").arg("-e").arg(
        "import {Keypair,Message,VersionedTransaction} from '@solana/web3.js'; const k=Keypair.fromSeed(new Uint8Array(32).fill(17)); const m=Message.from(Buffer.from(process.argv[1],'base64')); if(m.accountKeys[0].toBase58()!==k.publicKey.toBase58()) throw Error('fixture payer'); const t=new VersionedTransaction(m); t.sign([k]); process.stdout.write(Buffer.from(t.serialize()).toString('base64'));"
    ).arg(BASE64.encode(bincode::serialize(signing.message()).unwrap())).current_dir(root).output().unwrap();
    assert!(
        signed.status.success(),
        "{}",
        String::from_utf8_lossy(&signed.stderr)
    );
    let transaction: solana_transaction::Transaction =
        bincode::deserialize(&BASE64.decode(signed.stdout).unwrap()).unwrap();
    assert_eq!(signing.message(), &transaction.message);
    let after = CurrentGovernedSigningObservationV1 {
        deployment: fixture.observation(1_000_000_002),
        business_accounts: &raw_accounts,
    };
    revalidate_current_governed_signed_transaction_v1(
        &signing,
        &fixture.release,
        after,
        &transaction,
    )
    .unwrap();
    let mut changed_accounts = raw_accounts.clone();
    changed_accounts[0].account.as_mut().unwrap().executable = true;
    assert!(
        prepare_current_governed_signing_v1(
            &operation,
            &fixture.release,
            CurrentGovernedSigningObservationV1 {
                deployment: fixture.observation(1_000_000_001),
                business_accounts: &changed_accounts,
            },
            0,
            transaction.message.recent_blockhash
        )
        .is_err()
    );
    assert!(
        revalidate_current_governed_signed_transaction_v1(
            &signing,
            &fixture.release,
            CurrentGovernedSigningObservationV1 {
                deployment: fixture.observation(1_000_000_002),
                business_accounts: &changed_accounts,
            },
            &transaction
        )
        .is_err()
    );
    let mut changed_transaction = transaction.clone();
    changed_transaction.message.instructions[0].data[1] ^= 1;
    assert!(
        revalidate_current_governed_signed_transaction_v1(
            &signing,
            &fixture.release,
            after,
            &changed_transaction
        )
        .is_err()
    );
    fixture.gate[108..116].copy_from_slice(&3_u64.to_le_bytes());
    assert!(
        revalidate_current_governed_signed_transaction_v1(
            &signing,
            &fixture.release,
            CurrentGovernedSigningObservationV1 {
                deployment: fixture.observation(1_000_000_003),
                business_accounts: &raw_accounts,
            },
            &transaction
        )
        .is_err()
    );
}

#[cfg(any())]
fn canonical_test_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut sorted = serde_json::Map::new();
            for key in keys {
                sorted.insert(key.clone(), canonical_test_json(&object[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical_test_json).collect()),
        other => other.clone(),
    }
}
#[cfg(any())]
fn recommit(plan: &mut Value) {
    let version = plan["schemaVersion"].as_u64().unwrap();
    let mut operation = plan.clone();
    for key in [
        "schemaVersion",
        "operationId",
        "currentObservation",
        "preparedPlanDigest",
    ] {
        operation.as_object_mut().unwrap().remove(key);
    }
    operation["domain"] = Value::from(format!("ameba:writer_operation_id:v{version}"));
    plan["operationId"] = Value::from(sha256(
        &serde_json::to_vec(&canonical_test_json(&operation)).unwrap(),
    ));
    let mut without = plan.clone();
    without
        .as_object_mut()
        .unwrap()
        .remove("preparedPlanDigest");
    plan["preparedPlanDigest"] = Value::from(sha256(
        &serde_json::to_vec(&canonical_test_json(&serde_json::json!({
            "domain":format!("ameba:writer_prepared_plan:v{version}"),"plan":without,
        })))
        .unwrap(),
    ));
}
