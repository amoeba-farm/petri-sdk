//! The supplied profile is explicitly local-test-only. This is not a Mainnet deployment.
#![cfg(feature = "mainnet-v3")]
#[allow(dead_code)]
mod g3_light_support;
use g3_light_support::*;
use light_program_test::Rpc;
use light_token_minter::{
    governance_gate::*,
    instruction::{OracleCarryForwardActionV1, VaultInstruction},
};
use solana_sdk::{hash::hashv, instruction::AccountMeta, transaction::Transaction};
#[tokio::test]
async fn mainnet_profile_v3_gate_and_evidence_execute_and_wrong_epoch_rolls_back() {
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let bytes = b"explicit local-only mainnet profile fixture";
    let hash = hashv(&[bytes]).to_bytes();
    let key = pda(&[
        b"g3-evidence-bytes-v1",
        payer.pubkey().as_ref(),
        &[2],
        &hash,
    ])
    .0;
    let ix = govern(
        vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(key, false),
            AccountMeta::new_readonly(solana_system_interface::program::id(), false),
        ],
        VaultInstruction::OracleCarryForwardV1 {
            action: OracleCarryForwardActionV1::WriteEvidence {
                kind: 2,
                hash,
                total: bytes.len() as u16,
                offset: 0,
                bytes: bytes.to_vec(),
            },
        },
    );
    let mut wrong = ix.clone();
    let len = wrong.data.len();
    wrong.data[len - 8..].copy_from_slice(&2u64.to_le_bytes());
    let send = |rpc: &mut light_program_test::LightProgramTest, ix| {
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer],
            rpc.context.latest_blockhash(),
        );
        let out = rpc.context.send_transaction(tx);
        rpc.context.expire_blockhash();
        out
    };
    assert!(send(&mut rpc, wrong).is_err());
    assert!(rpc.context.get_account(&key).is_none());
    let gate = rpc.context.get_account(&PINNED_PROTOCOL_GATE_PDA).unwrap();
    let mut wrong_owner = gate.clone();
    wrong_owner.owner = program();
    rpc.context
        .set_account(PINNED_PROTOCOL_GATE_PDA, wrong_owner)
        .unwrap();
    assert!(send(&mut rpc, ix.clone()).is_err());
    assert!(rpc.context.get_account(&key).is_none());
    rpc.context
        .set_account(PINNED_PROTOCOL_GATE_PDA, gate)
        .unwrap();
    let metadata = send(&mut rpc, ix).unwrap();
    println!(
        "mainnet_profile_v3_evidence compute_units={}",
        metadata.compute_units_consumed
    );
    let stored = rpc.context.get_account(&key).unwrap();
    assert_eq!(stored.data[75], 1);
    assert_eq!(&stored.data[76..], bytes);
}
