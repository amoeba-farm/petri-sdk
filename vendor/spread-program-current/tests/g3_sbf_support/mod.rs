use borsh::BorshSerialize;
use light_token_minter::{business_generation, governance_gate::*, instruction::VaultInstruction};
use solana_program::pubkey::Pubkey;
use solana_program_test::{BanksTransactionResultWithMetadata, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    signature::{Keypair, Signer},
    transaction::Transaction,
};

pub fn account(owner: Pubkey, data: Vec<u8>) -> Account {
    Account {
        lamports: 100_000_000,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

/// This harness never registers a native Spread processor or contacts a network.
pub fn actual_program() -> ProgramTest {
    let directory = std::env::var("BPF_OUT_DIR").expect("BPF_OUT_DIR must select the attested SBF");
    let bytes =
        std::fs::read(std::path::Path::new(&directory).join("light_token_minter.so")).unwrap();
    assert!(bytes.starts_with(b"\x7fELF"));
    let hash = solana_program::hash::hash(&bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    assert_eq!(
        hash,
        std::env::var("AMEBA_TESTED_SBF_SHA256").expect("missing attested SHA-256")
    );
    assert!(bytes
        .windows(b"AMEBA_SPREAD_DEVNET_V3:".len())
        .any(|w| w == b"AMEBA_SPREAD_DEVNET_V3:"));
    assert!(!bytes
        .windows(b"AMEBA_PHASE3_SYNTHETIC".len())
        .any(|w| w == b"AMEBA_PHASE3_SYNTHETIC"));
    println!("g3_sbf artifact_sha256={hash}");
    let mut program = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program.set_compute_max_units(1_400_000);
    program.prefer_bpf(false);
    let (_, bump) =
        derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &light_token_minter::id());
    let mut gate = vec![0; PROTOCOL_GATE_LEN];
    gate[..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
    gate[8] = PROTOCOL_GATE_VERSION_V1;
    gate[9] = bump;
    gate[10] = 1;
    gate[11] = GateStatusV1::Active as u8;
    gate[12..44].copy_from_slice(PINNED_CONTROLLER_CONFIG_PDA.as_ref());
    gate[44..76].copy_from_slice(light_token_minter::id().as_ref());
    gate[76..108]
        .copy_from_slice(derive_target_programdata_pda(&light_token_minter::id()).as_ref());
    gate[108..116].copy_from_slice(&1u64.to_le_bytes());
    program.add_account(
        PINNED_PROTOCOL_GATE_PDA,
        account(PINNED_CONTROLLER_PROGRAM_ID, gate),
    );
    program
}

pub fn governed(mut accounts: Vec<AccountMeta>, instruction: VaultInstruction) -> Instruction {
    let mut data = instruction.try_to_vec().unwrap();
    if business_generation::requires_generation(data[0]) {
        data.extend_from_slice(business_generation::BUSINESS_MESSAGE_SUFFIX);
    }
    data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(1).encode());
    accounts.push(AccountMeta::new_readonly(PINNED_PROTOCOL_GATE_PDA, false));
    Instruction {
        program_id: light_token_minter::id(),
        accounts,
        data,
    }
}

pub async fn submit(
    context: &mut ProgramTestContext,
    signer: &Keypair,
    instruction: Instruction,
    label: &str,
) -> BanksTransactionResultWithMetadata {
    let blockhash = context.get_new_latest_blockhash().await.unwrap();
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, signer],
        blockhash,
    );
    let result = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await
        .unwrap();
    let metadata = result
        .metadata
        .as_ref()
        .expect("executed transaction metadata");
    assert!(
        metadata.compute_units_consumed <= 200_000,
        "{label}: default per-instruction CU budget exceeded"
    );
    assert!(
        metadata
            .log_messages
            .iter()
            .any(|line| line.contains("AMEBA_SPREAD_DEVNET_V3:")),
        "{label}: missing actual production admission marker"
    );
    println!(
        "g3_sbf label={label} compute_units={} result={:?}",
        metadata.compute_units_consumed, result.result
    );
    result
}
