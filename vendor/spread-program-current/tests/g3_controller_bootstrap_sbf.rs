#![cfg(feature = "devnet-v3-governance-controller")]
//! Actual controller + Spread ELFs, initialized through supported instructions.
//! Only executable genesis accounts, local SOL and local signing identities are
//! installed. No config, gate, proposal, approval or evidence state is seeded.
use borsh::BorshSerialize;
use light_token_minter::{
    constants::CURRENT_STATE_NAMESPACE_SEED,
    error::VaultError,
    governance_gate::*,
    instruction::{OracleCarryForwardActionV1, VaultInstruction},
};
use solana_program::{hash::hash, pubkey::Pubkey, rent::Rent};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction, InstructionError},
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use solana_system_interface::program as system_program;
const DOMAIN: &[u8] = b"ameba-governance-v3";
fn ro(k: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(k, false)
}
fn rw(k: Pubkey) -> AccountMeta {
    AccountMeta::new(k, false)
}
fn sig(k: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(k, true)
}
fn gov_pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &PINNED_CONTROLLER_PROGRAM_ID).0
}
fn gov(accounts: Vec<AccountMeta>, data: Vec<u8>) -> Instruction {
    Instruction {
        program_id: PINNED_CONTROLLER_PROGRAM_ID,
        accounts,
        data,
    }
}
fn sha(bytes: &[u8]) -> String {
    hash(bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn genesis_program(test: &mut ProgramTest, key: Pubkey, authority: Pubkey, bytes: &[u8]) {
    let loader = solana_sdk::bpf_loader_upgradeable::id();
    let pd = Pubkey::find_program_address(&[key.as_ref()], &loader).0;
    let mut program = 2u32.to_le_bytes().to_vec();
    program.extend(pd.as_ref());
    let mut data = 3u32.to_le_bytes().to_vec();
    data.extend(0u64.to_le_bytes());
    data.push(1);
    data.extend(authority.as_ref());
    data.extend(bytes);
    for (k, data, executable) in [(key, program, true), (pd, data, false)] {
        test.add_genesis_account(
            k,
            Account {
                lamports: Rent::default().minimum_balance(data.len()),
                data,
                owner: loader,
                executable,
                rent_epoch: 0,
            },
        );
    }
}
async fn send(
    ctx: &mut ProgramTestContext,
    ix: Instruction,
    signers: &[&Keypair],
    label: &str,
) -> Result<(), TransactionError> {
    let bh = ctx.get_new_latest_blockhash().await.unwrap();
    let mut keys = vec![&ctx.payer];
    keys.extend_from_slice(signers);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&ctx.payer.pubkey()), &keys, bh);
    let bytes = bincode::serialize(&tx).unwrap();
    assert!(bytes.len() <= 1232);
    let result = ctx
        .banks_client
        .process_transaction_with_metadata(tx)
        .await
        .unwrap();
    println!(
        "controller-bootstrap label={label} packet={} tx_sha256={} result={:?} compute={}",
        bytes.len(),
        sha(&bytes),
        result.result,
        result
            .metadata
            .as_ref()
            .map_or(0, |m| m.compute_units_consumed)
    );
    if result.result.is_err() {
        println!("{:?}", result.metadata);
    }
    result.result
}
async fn gate_policy(
    ctx: &mut ProgramTestContext,
    seats: &[Keypair; 5],
    id: u64,
    epoch: u64,
    active: bool,
) {
    let payer = ctx.payer.pubkey();
    let proposal = gov_pda(&[DOMAIN, b"proposal", &id.to_le_bytes()]);
    // Controller V3 fixed ABI: tag 1, u64 id, action kind 4, 192-byte action.
    let mut data = vec![1];
    data.extend(id.to_le_bytes());
    data.push(4);
    let mut action = [0u8; 192];
    action[..32].copy_from_slice(light_token_minter::id().as_ref());
    action[32..40].copy_from_slice(&epoch.to_le_bytes());
    action[40] = u8::from(active);
    data.extend(action);
    send(
        ctx,
        gov(
            vec![
                AccountMeta::new(payer, true),
                sig(seats[0].pubkey()),
                rw(PINNED_CONTROLLER_CONFIG_PDA),
                rw(proposal),
                ro(system_program::id()),
            ],
            data,
        ),
        &[&seats[0]],
        "create-gate-proposal",
    )
    .await
    .unwrap();
    let account = ctx
        .banks_client
        .get_account(proposal)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(account.data.len(), 400);
    assert_eq!(&account.data[..8], b"AG3PRP01");
    let digest = &account.data[316..348];
    let mut approve = vec![4];
    approve.extend(digest);
    for seat in &seats[..3] {
        send(
            ctx,
            gov(
                vec![
                    ro(PINNED_CONTROLLER_CONFIG_PDA),
                    rw(proposal),
                    sig(seat.pubkey()),
                ],
                approve.clone(),
            ),
            &[seat],
            "actual-council-approval",
        )
        .await
        .unwrap();
    }
    let mut execute = vec![14];
    execute.extend(digest);
    let ix = gov(
        vec![
            ro(PINNED_CONTROLLER_CONFIG_PDA),
            rw(proposal),
            rw(PINNED_PROTOCOL_GATE_PDA),
        ],
        execute,
    );
    let gate_before = ctx
        .banks_client
        .get_account(PINNED_PROTOCOL_GATE_PDA)
        .await
        .unwrap();
    assert_eq!(
        send(ctx, ix.clone(), &[], "too-early-gate-execution").await,
        Err(TransactionError::InstructionError(
            0,
            InstructionError::Custom(3003)
        ))
    );
    assert_eq!(
        ctx.banks_client
            .get_account(PINNED_PROTOCOL_GATE_PDA)
            .await
            .unwrap(),
        gate_before
    );
    let mut clock = ctx.banks_client.get_sysvar::<Clock>().await.unwrap();
    clock.slot = u64::from_le_bytes(account.data[107..115].try_into().unwrap());
    ctx.set_sysvar(&clock);
    send(ctx, ix, &[], "approved-gate-execution").await.unwrap();
    let gate = ctx
        .banks_client
        .get_account(PINNED_PROTOCOL_GATE_PDA)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        u64::from_le_bytes(gate.data[108..116].try_into().unwrap()),
        epoch + 1
    );
    assert_eq!(
        gate.data[11],
        if active {
            GateStatusV1::Active as u8
        } else {
            GateStatusV1::EmergencyFrozen as u8
        }
    );
}
fn evidence(payer: Pubkey, epoch: u64, text: &[u8]) -> (Pubkey, Instruction) {
    let h = hash(text).to_bytes();
    let object = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-evidence-bytes-v1",
            payer.as_ref(),
            &[2],
            &h,
        ],
        &light_token_minter::id(),
    )
    .0;
    let instruction = VaultInstruction::OracleCarryForwardV1 {
        action: OracleCarryForwardActionV1::WriteEvidence {
            kind: 2,
            hash: h,
            total: u16::try_from(text.len()).unwrap(),
            offset: 0,
            bytes: text.to_vec(),
        },
    };
    let mut data = instruction.try_to_vec().unwrap();
    data.extend(b"AMG3");
    data.extend(GovernanceInstructionTailV1::for_epoch(epoch).encode());
    (
        object,
        Instruction {
            program_id: light_token_minter::id(),
            accounts: vec![
                AccountMeta::new(payer, true),
                rw(object),
                ro(system_program::id()),
                ro(PINNED_PROTOCOL_GATE_PDA),
            ],
            data,
        },
    )
}
#[tokio::test]
async fn real_council_bootstrap_adopt_activate_freeze_resume_and_epoch_replay() {
    let spread = std::fs::read(
        std::path::Path::new(&std::env::var("SBF_OUT_DIR").unwrap()).join("light_token_minter.so"),
    )
    .unwrap();
    assert_eq!(
        sha(&spread),
        std::env::var("AMEBA_TESTED_SBF_SHA256").unwrap()
    );
    let controller = std::fs::read(
        std::env::var("AMEBA_CONTROLLER_SBF").expect("actual controller ELF required"),
    )
    .unwrap();
    assert_eq!(
        sha(&controller),
        std::env::var("AMEBA_CONTROLLER_SHA256").unwrap()
    );
    println!(
        "actual-controller={} actual-spread={}",
        sha(&controller),
        sha(&spread)
    );
    let deployer = Keypair::new();
    let seats: [Keypair; 5] = std::array::from_fn(|_| Keypair::new());
    let treasury = Pubkey::new_unique();
    let loader = solana_sdk::bpf_loader_upgradeable::id();
    let controller_pd =
        Pubkey::find_program_address(&[PINNED_CONTROLLER_PROGRAM_ID.as_ref()], &loader).0;
    let target_pd = derive_target_programdata_pda(&light_token_minter::id());
    let authority = gov_pda(&[DOMAIN, b"authority"]);
    let target_authority = gov_pda(&[
        DOMAIN,
        b"target-authority",
        light_token_minter::id().as_ref(),
    ]);
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    genesis_program(
        &mut test,
        PINNED_CONTROLLER_PROGRAM_ID,
        deployer.pubkey(),
        &controller,
    );
    genesis_program(
        &mut test,
        light_token_minter::id(),
        deployer.pubkey(),
        &spread,
    );
    for key in [deployer.pubkey(), treasury, authority, target_authority]
        .into_iter()
        .chain(seats.iter().map(Signer::pubkey))
    {
        test.add_account(
            key,
            Account {
                lamports: 10_000_000_000,
                data: vec![],
                owner: system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
    }
    let mut ctx = test.start_with_context().await;
    ctx.warp_to_slot(100).unwrap();
    let payer = ctx.payer.pubkey();
    let mut data = vec![0];
    for seat in &seats {
        data.extend(seat.pubkey().as_ref());
    }
    data.extend(treasury.as_ref());
    send(
        &mut ctx,
        gov(
            vec![
                AccountMeta::new(payer, true),
                sig(deployer.pubkey()),
                ro(PINNED_CONTROLLER_PROGRAM_ID),
                rw(controller_pd),
                rw(PINNED_CONTROLLER_CONFIG_PDA),
                ro(authority),
                ro(loader),
                ro(system_program::id()),
                sig(seats[0].pubkey()),
                sig(seats[1].pubkey()),
                sig(seats[2].pubkey()),
            ],
            data,
        ),
        &[&deployer, &seats[0], &seats[1], &seats[2]],
        "initialize-real-council",
    )
    .await
    .unwrap();
    let register = gov(
        vec![
            AccountMeta::new(ctx.payer.pubkey(), true),
            sig(deployer.pubkey()),
            ro(PINNED_CONTROLLER_CONFIG_PDA),
            ro(light_token_minter::id()),
            rw(target_pd),
            rw(PINNED_PROTOCOL_GATE_PDA),
            ro(target_authority),
            ro(loader),
            ro(system_program::id()),
            sig(seats[0].pubkey()),
            sig(seats[1].pubkey()),
            sig(seats[2].pubkey()),
            ro(solana_sdk::sysvar::instructions::id()),
        ],
        vec![11],
    );
    send(
        &mut ctx,
        register,
        &[&deployer, &seats[0], &seats[1], &seats[2]],
        "register-actual-target",
    )
    .await
    .unwrap();
    let (object, blocked) = evidence(ctx.payer.pubkey(), 1, b"real council governed evidence");
    assert_eq!(
        send(&mut ctx, blocked, &[], "frozen-before-activation").await,
        Err(TransactionError::InstructionError(
            0,
            InstructionError::Custom(VaultError::GovernanceGateFrozen as u32)
        ))
    );
    assert!(ctx
        .banks_client
        .get_account(object)
        .await
        .unwrap()
        .is_none());
    gate_policy(&mut ctx, &seats, 1, 1, true).await;
    let (_, write) = evidence(ctx.payer.pubkey(), 2, b"real council governed evidence");
    send(&mut ctx, write, &[], "governed-write-after-real-bootstrap")
        .await
        .unwrap();
    let sealed = ctx.banks_client.get_account(object).await.unwrap().unwrap();
    assert_eq!(&sealed.data[76..], b"real council governed evidence");
    let (next, prepared) = evidence(ctx.payer.pubkey(), 2, b"next epoch evidence");
    gate_policy(&mut ctx, &seats, 2, 2, false).await;
    assert_eq!(
        send(&mut ctx, prepared.clone(), &[], "prepared-before-freeze").await,
        Err(TransactionError::InstructionError(
            0,
            InstructionError::Custom(VaultError::GovernanceGateFrozen as u32)
        ))
    );
    gate_policy(&mut ctx, &seats, 3, 3, true).await;
    assert_eq!(
        send(&mut ctx, prepared, &[], "old-prepared-epoch-after-resume").await,
        Err(TransactionError::InstructionError(
            0,
            InstructionError::Custom(VaultError::GovernanceGateEpochMismatch as u32)
        ))
    );
    assert!(ctx.banks_client.get_account(next).await.unwrap().is_none());
    let (_, fresh) = evidence(ctx.payer.pubkey(), 4, b"next epoch evidence");
    send(
        &mut ctx,
        fresh,
        &[],
        "fresh-prepare-after-authorized-resume",
    )
    .await
    .unwrap();
    assert_eq!(
        ctx.banks_client.get_account(object).await.unwrap().unwrap(),
        sealed
    );
}
