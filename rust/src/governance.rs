//! Governance V1 wire inspection for the byte-qualified live deployment.
//!
//! This module intentionally has no instruction constructor or submission
//! capability. The exact governed-write release is not yet available.

use solana_program::{pubkey, pubkey::Pubkey};
use thiserror::Error;

pub const GOVERNANCE_GATE_V1_BYTES: usize = 192;
pub const GOVERNANCE_GATE_V1_DISCRIMINATOR: [u8; 8] = *b"AGVGAT01";
pub const GOVERNANCE_GATE_V1_VERSION: u8 = 1;
pub const GOVERNANCE_TAIL_V1_BYTES: usize = 16;
pub const GOVERNANCE_TAIL_V1_MAGIC: [u8; 4] = *b"AGV1";
pub const GOVERNANCE_TAIL_V1_VERSION: u8 = 1;
pub const GOVERNANCE_UPGRADE_SEED_DOMAIN_V1: &[u8] = b"ameba-governance-v3";

pub const CURRENT_LIVE_PROGRAM_ID: Pubkey = pubkey!("2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw");
pub const CURRENT_LIVE_PROGRAMDATA: Pubkey =
    pubkey!("8KR6hgcQehz32jm7CvrAriYNhvT2Bu9JuUWHce81J1oh");
pub const CURRENT_GOVERNANCE_CONTROLLER_V1: Pubkey =
    pubkey!("8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx");
pub const CURRENT_GOVERNANCE_CONFIG_V1: Pubkey =
    pubkey!("Ec5H8jsGvaLU3T3gp6qTayPjY2qF3geBbVKWz4rsaEHB");
pub const CURRENT_GOVERNANCE_GATE_V1: Pubkey =
    pubkey!("Cdym9p7FvtxEAjF8XuCqSrishB7LmBDXaZGDMMgWczu");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum GovernanceGateStatusV1 {
    Active = 0,
    FrozenForUpgrade = 1,
    EmergencyFrozen = 2,
}

impl TryFrom<u8> for GovernanceGateStatusV1 {
    type Error = GovernanceGateError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Active),
            1 => Ok(Self::FrozenForUpgrade),
            2 => Ok(Self::EmergencyFrozen),
            _ => Err(GovernanceGateError::UnsupportedStatus),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolGovernanceGateV1 {
    pub bump: u8,
    pub status: GovernanceGateStatusV1,
    pub controller_config: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub epoch: u64,
    pub active_proposal: Pubkey,
    pub freeze_slot: u64,
    pub freeze_reason_code: u16,
    pub last_completed_proposal: Pubkey,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GovernanceInstructionTailV1 {
    pub expected_epoch: u64,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum GovernanceGateError {
    #[error("ProtocolGateV1 must be exactly 192 bytes")]
    GateLength,
    #[error("ProtocolGateV1 discriminator is invalid")]
    GateDiscriminator,
    #[error("ProtocolGateV1 version is unsupported")]
    GateVersion,
    #[error("ProtocolGateV1 initialized byte is not canonical true")]
    GateInitialized,
    #[error("ProtocolGateV1 status is unsupported")]
    UnsupportedStatus,
    #[error("ProtocolGateV1 reserved bytes are nonzero")]
    GateReserved,
    #[error("ProtocolGateV1 linkage is invalid")]
    GateLinkage,
    #[error("ProtocolGateV1 status fields are not canonical")]
    GateStatusFields,
    #[error("ProtocolGateV1 account identity is invalid")]
    GateAccountIdentity,
    #[error("ProtocolGateV1 is frozen")]
    GateFrozen,
    #[error("governance tail must be exactly 16 bytes")]
    TailLength,
    #[error("governance tail magic is invalid")]
    TailMagic,
    #[error("governance tail version is unsupported")]
    TailVersion,
    #[error("governance tail reserved bytes are nonzero")]
    TailReserved,
    #[error("current program write ABI is unavailable")]
    CurrentWriteAbiUnavailable,
}

pub fn derive_governance_controller_config_v1() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[GOVERNANCE_UPGRADE_SEED_DOMAIN_V1, b"council"],
        &CURRENT_GOVERNANCE_CONTROLLER_V1,
    )
}

pub fn derive_protocol_governance_gate_v1() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            GOVERNANCE_UPGRADE_SEED_DOMAIN_V1,
            b"gate",
            CURRENT_LIVE_PROGRAM_ID.as_ref(),
        ],
        &CURRENT_GOVERNANCE_CONTROLLER_V1,
    )
}

pub fn decode_protocol_governance_gate_v1(
    bytes: &[u8],
) -> Result<ProtocolGovernanceGateV1, GovernanceGateError> {
    if bytes.len() != GOVERNANCE_GATE_V1_BYTES {
        return Err(GovernanceGateError::GateLength);
    }
    if bytes[0..8] != GOVERNANCE_GATE_V1_DISCRIMINATOR {
        return Err(GovernanceGateError::GateDiscriminator);
    }
    if bytes[8] != GOVERNANCE_GATE_V1_VERSION {
        return Err(GovernanceGateError::GateVersion);
    }
    if bytes[10] != 1 {
        return Err(GovernanceGateError::GateInitialized);
    }
    if bytes[190..192] != [0, 0] {
        return Err(GovernanceGateError::GateReserved);
    }
    let gate = ProtocolGovernanceGateV1 {
        bump: bytes[9],
        status: GovernanceGateStatusV1::try_from(bytes[11])?,
        controller_config: pubkey_at(bytes, 12),
        target_program: pubkey_at(bytes, 44),
        target_programdata: pubkey_at(bytes, 76),
        epoch: u64::from_le_bytes(bytes[108..116].try_into().expect("exact slice")),
        active_proposal: pubkey_at(bytes, 116),
        freeze_slot: u64::from_le_bytes(bytes[148..156].try_into().expect("exact slice")),
        freeze_reason_code: u16::from_le_bytes(bytes[156..158].try_into().expect("exact slice")),
        last_completed_proposal: pubkey_at(bytes, 158),
    };
    if gate.controller_config == Pubkey::default()
        || gate.target_program == Pubkey::default()
        || gate.target_programdata == Pubkey::default()
    {
        return Err(GovernanceGateError::GateLinkage);
    }
    let proposal_default = gate.active_proposal == Pubkey::default();
    let clear = gate.freeze_slot == 0 && gate.freeze_reason_code == 0;
    let frozen = gate.freeze_slot != 0 && gate.freeze_reason_code != 0;
    let canonical = match gate.status {
        GovernanceGateStatusV1::Active => proposal_default && clear,
        GovernanceGateStatusV1::FrozenForUpgrade => !proposal_default && frozen,
        GovernanceGateStatusV1::EmergencyFrozen => proposal_default && frozen,
    };
    if !canonical {
        return Err(GovernanceGateError::GateStatusFields);
    }
    Ok(gate)
}

pub fn validate_current_governance_gate_account_v1(
    address: &Pubkey,
    owner: &Pubkey,
    executable: bool,
    bytes: &[u8],
    require_active: bool,
) -> Result<ProtocolGovernanceGateV1, GovernanceGateError> {
    let (config, _) = derive_governance_controller_config_v1();
    let (gate_address, bump) = derive_protocol_governance_gate_v1();
    if config != CURRENT_GOVERNANCE_CONFIG_V1
        || gate_address != CURRENT_GOVERNANCE_GATE_V1
        || *address != gate_address
        || *owner != CURRENT_GOVERNANCE_CONTROLLER_V1
        || executable
    {
        return Err(GovernanceGateError::GateAccountIdentity);
    }
    let gate = decode_protocol_governance_gate_v1(bytes)?;
    if gate.bump != bump
        || gate.controller_config != config
        || gate.target_program != CURRENT_LIVE_PROGRAM_ID
        || gate.target_programdata != CURRENT_LIVE_PROGRAMDATA
    {
        return Err(GovernanceGateError::GateLinkage);
    }
    if require_active && gate.status != GovernanceGateStatusV1::Active {
        return Err(GovernanceGateError::GateFrozen);
    }
    Ok(gate)
}

pub fn encode_governance_instruction_tail_v1(expected_epoch: u64) -> [u8; 16] {
    let mut bytes = [0_u8; GOVERNANCE_TAIL_V1_BYTES];
    bytes[0..4].copy_from_slice(&GOVERNANCE_TAIL_V1_MAGIC);
    bytes[4] = GOVERNANCE_TAIL_V1_VERSION;
    bytes[8..16].copy_from_slice(&expected_epoch.to_le_bytes());
    bytes
}

pub fn decode_governance_instruction_tail_v1(
    bytes: &[u8],
) -> Result<GovernanceInstructionTailV1, GovernanceGateError> {
    if bytes.len() != GOVERNANCE_TAIL_V1_BYTES {
        return Err(GovernanceGateError::TailLength);
    }
    if bytes[0..4] != GOVERNANCE_TAIL_V1_MAGIC {
        return Err(GovernanceGateError::TailMagic);
    }
    if bytes[4] != GOVERNANCE_TAIL_V1_VERSION {
        return Err(GovernanceGateError::TailVersion);
    }
    if bytes[5..8] != [0, 0, 0] {
        return Err(GovernanceGateError::TailReserved);
    }
    Ok(GovernanceInstructionTailV1 {
        expected_epoch: u64::from_le_bytes(bytes[8..16].try_into().expect("exact slice")),
    })
}

pub fn assert_current_write_release_available() -> Result<(), GovernanceGateError> {
    crate::governed_operation::current_governed_write_release_v1()
        .map(|_| ())
        .map_err(|_| GovernanceGateError::CurrentWriteAbiUnavailable)
}

fn pubkey_at(bytes: &[u8], offset: usize) -> Pubkey {
    Pubkey::new_from_array(bytes[offset..offset + 32].try_into().expect("exact slice"))
}

#[cfg(test)]
mod tests {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    use super::*;

    const FIXTURE: &str = include_str!("../../fixtures/governance-gates-v1.json");

    fn gate_fixture(generation: u64) -> Vec<u8> {
        let value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let encoded = value["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["identityGeneration"].as_u64() == Some(generation))
            .unwrap()["dataBase64"]
            .as_str()
            .unwrap();
        STANDARD.decode(encoded).unwrap()
    }

    #[test]
    fn typescript_fixture_and_rust_decoder_agree() {
        let bytes = gate_fixture(3);
        let gate = validate_current_governance_gate_account_v1(
            &CURRENT_GOVERNANCE_GATE_V1,
            &CURRENT_GOVERNANCE_CONTROLLER_V1,
            false,
            &bytes,
            false,
        )
        .unwrap();
        assert_eq!(gate.status, GovernanceGateStatusV1::EmergencyFrozen);
        assert_eq!(gate.epoch, 1);
        assert_eq!(
            validate_current_governance_gate_account_v1(
                &CURRENT_GOVERNANCE_GATE_V1,
                &CURRENT_GOVERNANCE_CONTROLLER_V1,
                false,
                &bytes,
                true,
            ),
            Err(GovernanceGateError::GateFrozen)
        );
    }

    #[test]
    fn generation_two_decodes_but_is_not_selected() {
        let gate = decode_protocol_governance_gate_v1(&gate_fixture(2)).unwrap();
        assert_eq!(gate.status, GovernanceGateStatusV1::Active);
        assert_eq!(gate.epoch, 2);
        assert_ne!(gate.controller_config, CURRENT_GOVERNANCE_CONFIG_V1);
    }

    #[test]
    fn gate_mutations_and_noncanonical_status_fail_closed() {
        let source = gate_fixture(3);
        for index in [0, 8, 10, 11, 190] {
            let mut changed = source.clone();
            changed[index] ^= 0xff;
            assert!(decode_protocol_governance_gate_v1(&changed).is_err());
        }
        let mut changed = source;
        changed[148..156].fill(0);
        assert_eq!(
            decode_protocol_governance_gate_v1(&changed),
            Err(GovernanceGateError::GateStatusFields)
        );
    }

    #[test]
    fn pda_and_tail_vectors_match_typescript() {
        assert_eq!(
            derive_governance_controller_config_v1().0,
            CURRENT_GOVERNANCE_CONFIG_V1
        );
        assert_eq!(
            derive_protocol_governance_gate_v1().0,
            CURRENT_GOVERNANCE_GATE_V1
        );
        let tail = encode_governance_instruction_tail_v1(u64::MAX);
        assert_eq!(hex(&tail), "4147563101000000ffffffffffffffff");
        assert_eq!(
            decode_governance_instruction_tail_v1(&tail).unwrap(),
            GovernanceInstructionTailV1 {
                expected_epoch: u64::MAX
            }
        );
        assert_eq!(assert_current_write_release_available(), Ok(()));
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
