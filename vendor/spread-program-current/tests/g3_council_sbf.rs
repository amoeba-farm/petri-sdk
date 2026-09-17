#![cfg(feature = "mainnet-v3")]
//! Actual controller + Spread ELFs, initialized through supported instructions.
//! Only executable genesis accounts, local SOL and local signing identities are
//! installed. No config, gate, proposal, approval or evidence state is seeded.
use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::CURRENT_STATE_NAMESPACE_SEED,
    error::VaultError,
    governance_gate::*,
    instruction::{OracleCarryForwardActionV1, VaultInstruction},
};
use light_token_minter::{
    constants::*,
    instruction::OracleCouncilActionV1,
    processor::{council_decision, decode_council, CouncilCase, CouncilRound},
    state::*,
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
async fn setup() -> (ProgramTestContext, [Keypair; 5]) {
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
    gate_policy(&mut ctx, &seats, 1, 1, true).await;
    (ctx, seats)
}

fn put<T: BorshSerialize>(ctx: &mut ProgramTestContext, key: Pubkey, value: &T, len: usize) {
    let mut data = value.try_to_vec().unwrap();
    assert!(data.len() <= len);
    data.resize(len, 0);
    ctx.set_account(
        &key,
        &Account {
            lamports: 10_000_000,
            data,
            owner: light_token_minter::id(),
            executable: false,
            rent_epoch: 0,
        }
        .into(),
    );
}
fn business(ctx: &mut ProgramTestContext, id: u8) -> (Pubkey, Pubkey, Pubkey, [u8; 32]) {
    let program = light_token_minter::id();
    let market_id = [id; 32];
    let expiry = 2_000_000_000u64;
    let (market, bump) = Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED, &market_id],
        &program,
    );
    put(
        ctx,
        market,
        &Market {
            is_initialized: true,
            bump,
            market_id,
            long_contract_mint: Some(Pubkey::new_unique()),
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                underlying_id: [8; 32],
                expiry_ts: expiry,
                ..Default::default()
            },
            ..Default::default()
        },
        Market::LEN,
    );
    let (month, bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry.to_le_bytes(),
        ],
        &program,
    );
    put(
        ctx,
        month,
        &OracleMonthState {
            is_initialized: true,
            bump,
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            market,
            authority: ctx.payer.pubkey(),
            phase: OraclePhase::Game,
            economics: OracleEconomicParams {
                emergency_commit_window_slots: 2_000_000,
                emergency_reveal_window_slots: 2_000_000,
                ..Default::default()
            },
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    let id = [id + 1; 32];
    let (bucket, bump) = derive_oracle_bucket_median_pda(&program, &month, &id);
    put(
        ctx,
        bucket,
        &OracleBucketMedianState {
            is_initialized: true,
            bump,
            account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketMedianState::ACCOUNT_VERSION,
            month,
            bucket_id: id,
            frozen_source_count: 3,
            active_source_count: 3,
            eligible_source_count: 0,
            status: OracleBucketMedianStatus::EmergencyRequired,
            bucket_weight_bps: 10_000,
            emergency_snapshot_slot: 100,
            council_authority_version: 1,
            bucket_delta_bps: 125,
            last_recomputed_ts: 12345,
            ..Default::default()
        },
        OracleBucketMedianState::LEN,
    );
    (market, month, bucket, id)
}
fn case_key(b: (Pubkey, Pubkey, Pubkey, [u8; 32])) -> Pubkey {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-council-case-v1",
            b.1.as_ref(),
            b.2.as_ref(),
        ],
        &light_token_minter::id(),
    )
    .0
}
async fn read_case(
    ctx: &mut ProgramTestContext,
    b: (Pubkey, Pubkey, Pubkey, [u8; 32]),
) -> CouncilCase {
    CouncilCase::try_from_slice(
        &ctx.banks_client
            .get_account(case_key(b))
            .await
            .unwrap()
            .unwrap()
            .data,
    )
    .unwrap()
}
async fn action(
    ctx: &mut ProgramTestContext,
    b: (Pubkey, Pubkey, Pubkey, [u8; 32]),
    op: u8,
    choice: u8,
    voter: Option<Pubkey>,
) -> Instruction {
    let config = ctx
        .banks_client
        .get_account(PINNED_CONTROLLER_CONFIG_PDA)
        .await
        .unwrap()
        .unwrap();
    let view = decode_council(
        &PINNED_CONTROLLER_PROGRAM_ID,
        &PINNED_CONTROLLER_CONFIG_PDA,
        &config.owner,
        &config.data,
    )
    .unwrap();
    let case = case_key(b);
    let round = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-council-round-v1",
            case.as_ref(),
            &view.epoch.to_le_bytes(),
        ],
        &light_token_minter::id(),
    )
    .0;
    let digest = if op == 0 {
        [0; 32]
    } else {
        read_case(ctx, b).await.case_hash
    };
    let mut data = VaultInstruction::OracleCarryForwardV1 {
        action: OracleCarryForwardActionV1::Council(OracleCouncilActionV1 {
            operation: op,
            kind: OracleEmergencyDisputeKind::BucketMedian,
            target_id: b.3,
            expected_case_hash: digest,
            expected_epoch: view.epoch,
            expected_seats_hash: view.digest,
            choice,
        }),
    }
    .try_to_vec()
    .unwrap();
    data.extend(b"AMG3");
    data.extend(GovernanceInstructionTailV1::for_epoch(2).encode());
    let mut accounts = vec![
        AccountMeta::new(ctx.payer.pubkey(), true),
        ro(b.0),
        rw(b.1),
        rw(case),
        rw(b.2),
        ro(PINNED_CONTROLLER_CONFIG_PDA),
        rw(round),
        ro(system_program::id()),
    ];
    if let Some(v) = voter {
        accounts.push(sig(v));
    }
    accounts.push(ro(PINNED_PROTOCOL_GATE_PDA));
    Instruction {
        program_id: light_token_minter::id(),
        accounts,
        data,
    }
}

async fn public_action(
    ctx: &mut ProgramTestContext,
    b: (Pubkey, Pubkey, Pubkey, [u8; 32]),
    op: u8,
    choice: u8,
    voter: Option<Pubkey>,
) -> Instruction {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let expected = action(ctx, b, op, choice, voter).await;
    let clock = ctx.banks_client.get_sysvar::<Clock>().await.unwrap();
    let cfg = ctx
        .banks_client
        .get_account(PINNED_CONTROLLER_CONFIG_PDA)
        .await
        .unwrap()
        .unwrap();
    let gate = ctx
        .banks_client
        .get_account(PINNED_PROTOCOL_GATE_PDA)
        .await
        .unwrap()
        .unwrap();
    let case = case_key(b);
    let case_data = ctx
        .banks_client
        .get_account(case)
        .await
        .unwrap()
        .map(|a| a.data);
    let round = expected.accounts[6].pubkey;
    let round_data = ctx
        .banks_client
        .get_account(round)
        .await
        .unwrap()
        .map(|a| a.data);
    let input = serde_json::json!({"program":light_token_minter::id().to_string(),"controller":PINNED_CONTROLLER_PROGRAM_ID.to_string(),"config":PINNED_CONTROLLER_CONFIG_PDA.to_string(),"configData":cfg.data,"gate":PINNED_PROTOCOL_GATE_PDA.to_string(),"gateData":gate.data,"slot":clock.slot,"payer":ctx.payer.pubkey().to_string(),"market":b.0.to_string(),"month":b.1.to_string(),"target":b.2.to_string(),"targetId":b.3,"case":case.to_string(),"caseData":case_data,"round":round.to_string(),"roundData":round_data,"operation":op,"choice":choice,"voter":voter.map(|v|v.to_string())});
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut child = Command::new("node")
        .arg("tools/council-oracle-test-driver.mjs")
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let actual = Instruction {
        program_id: result["programId"].as_str().unwrap().parse().unwrap(),
        data: serde_json::from_value(result["data"].clone()).unwrap(),
        accounts: result["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| AccountMeta {
                pubkey: k["pubkey"].as_str().unwrap().parse().unwrap(),
                is_signer: k["isSigner"].as_bool().unwrap(),
                is_writable: k["isWritable"].as_bool().unwrap(),
            })
            .collect(),
    };
    assert_eq!(
        actual, expected,
        "public package ABI differs from native encoding"
    );
    actual
}
async fn at(ctx: &mut ProgramTestContext, slot: u64) {
    let mut c = ctx.banks_client.get_sysvar::<Clock>().await.unwrap();
    c.slot = slot;
    ctx.set_sysvar(&c);
}
async fn rotate(ctx: &mut ProgramTestContext, seats: &[Keypair; 5], new: &[Keypair; 5]) {
    let proposal = gov_pda(&[DOMAIN, b"proposal", &2u64.to_le_bytes()]);
    let mut data = vec![1];
    data.extend(2u64.to_le_bytes());
    data.push(2);
    for s in new {
        data.extend(s.pubkey().as_ref());
    }
    data.extend([0; 32]);
    send(
        ctx,
        gov(
            vec![
                AccountMeta::new(ctx.payer.pubkey(), true),
                sig(seats[0].pubkey()),
                rw(PINNED_CONTROLLER_CONFIG_PDA),
                rw(proposal),
                ro(system_program::id()),
            ],
            data,
        ),
        &[&seats[0]],
        "rotate-propose",
    )
    .await
    .unwrap();
    let p = ctx
        .banks_client
        .get_account(proposal)
        .await
        .unwrap()
        .unwrap();
    let digest = &p.data[316..348];
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
            "rotate-approve",
        )
        .await
        .unwrap();
    }
    at(
        ctx,
        u64::from_le_bytes(p.data[107..115].try_into().unwrap()),
    )
    .await;
    let mut execute = vec![7];
    execute.extend(digest);
    send(
        ctx,
        gov(
            vec![rw(PINNED_CONTROLLER_CONFIG_PDA), rw(proposal)],
            execute,
        ),
        &[],
        "rotate-execute",
    )
    .await
    .unwrap();
}
#[tokio::test]
async fn actual_council_votes_deadline_duplicates_rotation_and_timeout() {
    let (mut ctx, seats) = setup().await;
    let b = business(&mut ctx, 21);
    let ix = public_action(&mut ctx, b, 0, 0, None).await;
    send(&mut ctx, ix, &[], "open-bucket").await.unwrap();
    let c = read_case(&mut ctx, b).await;
    assert_eq!(c.deadline - c.opened_slot, 4_000_000);
    assert_eq!(c.snapshot_slot, 100);
    let bad = Keypair::new();
    let ix = action(&mut ctx, b, 1, 1, Some(bad.pubkey())).await;
    assert!(send(&mut ctx, ix, &[&bad], "non-seat").await.is_err());
    for seat in &seats[..3] {
        let ix = public_action(&mut ctx, b, 1, 1, Some(seat.pubkey())).await;
        send(&mut ctx, ix, &[seat], "seat-vote").await.unwrap();
    }
    for choice in [0, 1] {
        let ix = action(&mut ctx, b, 1, choice, Some(seats[0].pubkey())).await;
        assert!(send(&mut ctx, ix, &[&seats[0]], "duplicate-or-changed")
            .await
            .is_err());
    }
    at(&mut ctx, c.deadline).await;
    let ix = action(&mut ctx, b, 2, 0, None).await;
    assert!(send(&mut ctx, ix, &[], "exact-deadline-reject")
        .await
        .is_err());
    at(&mut ctx, c.deadline + 1).await;
    let ix = public_action(&mut ctx, b, 2, 0, None).await;
    send(&mut ctx, ix.clone(), &[], "apply-three-reject")
        .await
        .unwrap();
    let receipt = read_case(&mut ctx, b).await;
    assert!(receipt.finalized);
    assert_eq!(
        (receipt.outcome, receipt.reason, receipt.seat_mask),
        (1, 0, 7)
    );
    assert!(send(&mut ctx, ix, &[], "repeat-apply").await.is_err());
    let a = ctx.banks_client.get_account(b.2).await.unwrap().unwrap();
    let bucket = OracleBucketMedianState::deserialize(&mut a.data.as_slice()).unwrap();
    assert_eq!(bucket.status, OracleBucketMedianStatus::EmergencyRejected);
    assert_eq!(bucket.last_recomputed_ts, 12345);
    assert_eq!(bucket.bucket_delta_bps, 125);
    // A second independent case carries an old majority across actual controller rotation.
    let b2 = business(&mut ctx, 31);
    let ix = action(&mut ctx, b2, 0, 0, None).await;
    send(&mut ctx, ix, &[], "open-rotation").await.unwrap();
    for seat in &seats[..3] {
        let ix = action(&mut ctx, b2, 1, 1, Some(seat.pubkey())).await;
        send(&mut ctx, ix, &[seat], "old-epoch-vote").await.unwrap();
    }
    let old = read_case(&mut ctx, b2).await;
    let prepared = action(&mut ctx, b2, 2, 0, None).await;
    let oldround = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            b"g3-council-round-v1",
            case_key(b2).as_ref(),
            &1u64.to_le_bytes(),
        ],
        &light_token_minter::id(),
    )
    .0;
    let oldbytes = ctx
        .banks_client
        .get_account(oldround)
        .await
        .unwrap()
        .unwrap();
    let next: [Keypair; 5] = std::array::from_fn(|_| Keypair::new());
    rotate(&mut ctx, &seats, &next).await;
    assert!(send(&mut ctx, prepared, &[], "reject-old-epoch-message")
        .await
        .is_err());
    let ix = action(&mut ctx, b2, 1, 1, Some(seats[0].pubkey())).await;
    assert!(send(&mut ctx, ix, &[&seats[0]], "removed-seat-reject")
        .await
        .is_err());
    at(&mut ctx, old.deadline + 1).await;
    let ix = action(&mut ctx, b2, 2, 0, None).await;
    send(&mut ctx, ix, &[], "rotation-empty-round-fallback")
        .await
        .unwrap();
    let receipt = read_case(&mut ctx, b2).await;
    assert_eq!(
        (
            receipt.outcome,
            receipt.reason,
            receipt.decision_epoch,
            receipt.seat_mask
        ),
        (0, 1, 2, 0)
    );
    assert_eq!(receipt.deadline, old.deadline);
    assert_eq!(
        ctx.banks_client
            .get_account(oldround)
            .await
            .unwrap()
            .unwrap(),
        oldbytes
    );
}
#[test]
fn exhaustive_absolute_threshold_and_retired_decode() {
    for n in 0..1024 {
        let mut x = n;
        let mut b = [255; 5];
        for v in &mut b {
            let t = x % 4;
            *v = if t == 3 { 255 } else { t as u8 };
            x /= 4;
        }
        for fallback in 0..3 {
            let (out, mask, majority) = council_decision(&b, 3, fallback).unwrap();
            let expected = (0..3).find(|v| b.iter().filter(|b| **b == *v).count() >= 3);
            assert_eq!(out, expected.unwrap_or(fallback));
            assert_eq!(majority, expected.is_some());
            assert_eq!(mask.count_ones() >= 3, majority);
        }
    }
    for tag in [
        63, 64, 65, 131, 133, 135, 136, 137, 138, 139, 141, 175, 176, 177, 178, 179, 180, 193, 202,
    ] {
        assert!(VaultInstruction::try_from_slice(&[tag]).is_err());
    }
    for domain in [6u8, 7] {
        assert!(CompressedStateDomain::try_from_slice(&[domain]).is_err());
    }
}
fn governed(instruction: VaultInstruction, mut accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = instruction.try_to_vec().unwrap();
    data.extend(b"AMG3");
    data.extend(GovernanceInstructionTailV1::for_epoch(2).encode());
    accounts.push(ro(PINNED_PROTOCOL_GATE_PDA));
    Instruction {
        program_id: light_token_minter::id(),
        accounts,
        data,
    }
}
async fn stored<T: BorshDeserialize>(ctx: &mut ProgramTestContext, key: Pubkey) -> T {
    let a = ctx.banks_client.get_account(key).await.unwrap().unwrap();
    T::deserialize(&mut a.data.as_slice()).unwrap()
}
fn token_fixture(
    ctx: &mut ProgramTestContext,
    key: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    use solana_program::{program_option::COption, program_pack::Pack};
    let mut data = vec![0; spl_token::state::Account::LEN];
    spl_token::state::Account::pack(
        spl_token::state::Account {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: spl_token::state::AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    ctx.set_account(
        &key,
        &Account {
            lamports: 10_000_000,
            data,
            owner: spl_token::id(),
            executable: false,
            rent_epoch: 0,
        }
        .into(),
    );
}
#[tokio::test]
async fn optional_zero_bounty_finalization_preserves_other_reservations_and_bonds() {
    use solana_program::{program_option::COption, program_pack::Pack};
    let (mut ctx, _) = setup().await;
    let program = light_token_minter::id();
    let payer = ctx.payer.pubkey();
    let mint = Pubkey::new_unique();
    let mut data = vec![0; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(
        spl_token::state::Mint {
            mint_authority: COption::None,
            supply: 1_000_000,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    ctx.set_account(
        &mint,
        &Account {
            lamports: 10_000_000,
            data,
            owner: spl_token::id(),
            executable: false,
            rent_epoch: 0,
        }
        .into(),
    );
    let (vault, vb) = derive_oracle_usdc_reward_vault_pda(&program);
    let ata = spl_associated_token_account::get_associated_token_address(&vault, &mint);
    let (config, cb) =
        Pubkey::find_program_address(&[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED], &program);
    put(
        &mut ctx,
        config,
        &VaultConfig {
            is_initialized: true,
            bump: cb,
            admin: payer,
            oracle_authority: Pubkey::new_unique(),
            usdc_mint: mint,
            vault_token_account: Pubkey::new_unique(),
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        },
        VaultConfig::LEN,
    );
    for (i, budget) in [0u64, 11].into_iter().enumerate() {
        let b = business(&mut ctx, 61 + i as u8 * 3);
        let mut month: OracleMonthState = stored(&mut ctx, b.1).await;
        month.phase = OraclePhase::Scramble;
        month.scramble_start_ts = 1_000_000;
        month.listing_ts = 1_000_000 + ORACLE_PRE_LISTING_WINDOW_SECONDS;
        put(&mut ctx, b.1, &month, OracleMonthState::LEN);
        let mut clock = ctx.banks_client.get_sysvar::<Clock>().await.unwrap();
        clock.unix_timestamp = 1_000_010;
        ctx.set_sysvar(&clock);
        put(
            &mut ctx,
            vault,
            &OracleUsdcRewardVault {
                is_initialized: true,
                bump: vb,
                account_discriminator: OracleUsdcRewardVault::ACCOUNT_DISCRIMINATOR,
                account_version: OracleUsdcRewardVault::ACCOUNT_VERSION,
                mint,
                token_account: ata,
                total_reserved: 7,
                ..Default::default()
            },
            OracleUsdcRewardVault::LEN,
        );
        let (schedule, sb) = derive_oracle_usdc_reward_schedule_pda(&program, &b.1);
        let schedule_state = OracleUsdcRewardSchedule {
            is_initialized: true,
            bump: sb,
            account_discriminator: OracleUsdcRewardSchedule::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUsdcRewardSchedule::ACCOUNT_VERSION,
            month: b.1,
            authority: payer,
            reward_vault: vault,
            phase: OracleUsdcRewardSchedulePhase::Building,
            sku_pool_count: 1,
            total_reward_budget: budget,
            bounty_fee_sweep_finalized: true,
            ..Default::default()
        };
        put(
            &mut ctx,
            schedule,
            &schedule_state,
            OracleUsdcRewardSchedule::LEN,
        );
        token_fixture(&mut ctx, ata, mint, vault, 7 + budget - 1);
        let ix = governed(
            VaultInstruction::FinalizeOracleUsdcRewardSchedule,
            vec![
                sig(payer),
                ro(config),
                ro(b.0),
                rw(b.1),
                ro(mint),
                rw(vault),
                ro(ata),
                rw(schedule),
                ro(spl_token::id()),
            ],
        );
        let before = ctx
            .banks_client
            .get_account(schedule)
            .await
            .unwrap()
            .unwrap();
        assert!(
            send(&mut ctx, ix.clone(), &[], "zero-or-positive-underfunded")
                .await
                .is_err()
        );
        assert_eq!(
            ctx.banks_client
                .get_account(schedule)
                .await
                .unwrap()
                .unwrap(),
            before
        );
        token_fixture(&mut ctx, ata, mint, vault, 7 + budget);
        send(&mut ctx, ix.clone(), &[], "zero-or-positive-funded")
            .await
            .unwrap();
        let v: OracleUsdcRewardVault = stored(&mut ctx, vault).await;
        assert_eq!(v.total_reserved, 7 + budget);
        let s: OracleUsdcRewardSchedule = stored(&mut ctx, schedule).await;
        assert_eq!(s.phase, OracleUsdcRewardSchedulePhase::Funded);
        assert_eq!(s.remaining_reward_budget, budget);
        assert!(send(&mut ctx, ix, &[], "schedule-duplicate").await.is_err());
        month.phase = OraclePhase::Settled;
        month.finalized_at_ts = 1_000_020;
        month.frozen_source_count = 2;
        month.opened_source_count = 2;
        month.accepted_cash_update_count = 1;
        month.pending_resolution_count = 1;
        put(&mut ctx, b.1, &month, OracleMonthState::LEN);
        let ix = governed(
            VaultInstruction::FinalizeOracleUsdcRewardEntitlements,
            vec![sig(payer), ro(b.0), ro(b.1), ro(vault), rw(schedule)],
        );
        assert!(
            send(&mut ctx, ix.clone(), &[], "pending-court-still-blocks")
                .await
                .is_err()
        );
        month.pending_resolution_count = 0;
        put(&mut ctx, b.1, &month, OracleMonthState::LEN);
        let mut s: OracleUsdcRewardSchedule = stored(&mut ctx, schedule).await;
        s.outstanding_prelisting_escrow_count = 1;
        put(&mut ctx, schedule, &s, OracleUsdcRewardSchedule::LEN);
        assert!(send(&mut ctx, ix.clone(), &[], "pending-bond-still-blocks")
            .await
            .is_err());
        s.outstanding_prelisting_escrow_count = 0;
        put(&mut ctx, schedule, &s, OracleUsdcRewardSchedule::LEN);
        if budget > 0 {
            assert!(
                send(&mut ctx, ix.clone(), &[], "positive-needs-registrations")
                    .await
                    .is_err()
            );
            s.registered_source_count = 2;
            s.registered_opening_count = 2;
            s.registered_update_count = 1;
            s.registered_update_reward_units = 1;
            put(&mut ctx, schedule, &s, OracleUsdcRewardSchedule::LEN);
        }
        send(&mut ctx, ix, &[], "entitlements-finalize")
            .await
            .unwrap();
        let s: OracleUsdcRewardSchedule = stored(&mut ctx, schedule).await;
        assert_eq!(
            s.phase,
            OracleUsdcRewardSchedulePhase::EntitlementsFinalized
        );
        assert_eq!(s.registered_source_count, if budget == 0 { 0 } else { 2 });
        let v: OracleUsdcRewardVault = stored(&mut ctx, vault).await;
        assert_eq!(v.total_reserved, 7 + budget);
    }
}
