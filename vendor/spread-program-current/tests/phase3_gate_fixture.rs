use light_token_minter::governance_gate::{
    derive_controller_config_pda, derive_protocol_gate_pda, derive_target_programdata_pda,
    GovernanceInstructionTailV1, ProtocolGateV1, GOVERNANCE_TAIL_LEN, PROTOCOL_GATE_LEN,
};
use serde_json::Value;
use solana_program::pubkey::Pubkey;
use std::str::FromStr;

const FIXTURE: &str = include_str!("../../../fixtures/spread_gate_bridge_v1.json");

fn decode_hex(value: &str) -> Vec<u8> {
    assert_eq!(value.len() % 2, 0, "hex fixture must have whole bytes");
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).expect("hex fixture is ASCII");
            u8::from_str_radix(pair, 16).expect("fixture contains valid lowercase hex")
        })
        .collect()
}

fn text<'a>(value: &'a Value, path: &[&str]) -> &'a str {
    let mut cursor = value;
    for component in path {
        cursor = &cursor[*component];
    }
    cursor.as_str().expect("fixture field is a string")
}

#[test]
fn target_decoder_consumes_the_shared_governance_fixture() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("checked-in fixture is valid JSON");
    let controller = Pubkey::from_str(text(&fixture, &["controllerProgram"]))
        .expect("controller public key is valid");
    let target =
        Pubkey::from_str(text(&fixture, &["targetProgram"])).expect("target public key is valid");

    let gate_bytes = decode_hex(text(&fixture, &["gateAccount", "hex"]));
    let tail_bytes = decode_hex(text(&fixture, &["governanceTail", "hex"]));
    assert_eq!(gate_bytes.len(), PROTOCOL_GATE_LEN);
    assert_eq!(tail_bytes.len(), GOVERNANCE_TAIL_LEN);

    let gate = ProtocolGateV1::decode_exact(&gate_bytes).expect("target accepts golden gate");
    let tail =
        GovernanceInstructionTailV1::decode_exact(&tail_bytes).expect("target accepts golden tail");
    assert_eq!(tail.expected_epoch, 41);
    assert_eq!(gate.epoch, tail.expected_epoch);
    assert_eq!(gate.target_program, target);
    assert_eq!(
        gate.target_programdata,
        derive_target_programdata_pda(&target)
    );

    let (expected_config, config_bump) = derive_controller_config_pda(&controller, &target);
    let (expected_gate, gate_bump) = derive_protocol_gate_pda(&controller, &target);
    assert_eq!(gate.controller_config, expected_config);
    assert_eq!(gate.bump, gate_bump);
    assert_eq!(
        config_bump,
        fixture["pdas"]["controllerConfig"]["bump"]
            .as_u64()
            .unwrap() as u8
    );
    assert_eq!(
        gate_bump,
        fixture["pdas"]["protocolGate"]["bump"].as_u64().unwrap() as u8
    );
    assert_eq!(
        expected_config.to_string(),
        text(&fixture, &["pdas", "controllerConfig", "address"])
    );
    assert_eq!(
        expected_gate.to_string(),
        text(&fixture, &["pdas", "protocolGate", "address"])
    );

    let legacy = decode_hex(text(
        &fixture,
        &["instructionBridge", "legacyInstruction", "hex"],
    ));
    let enveloped = decode_hex(text(
        &fixture,
        &["instructionBridge", "envelopedInstruction", "hex"],
    ));
    assert_eq!(&enveloped[..legacy.len()], legacy);
    assert_eq!(&enveloped[legacy.len()..], tail_bytes);
}
