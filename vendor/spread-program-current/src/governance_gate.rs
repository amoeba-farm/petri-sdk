//! Fixed Phase 3 bridge ABI for the controller-owned protocol gate.
//!
//! This module deliberately duplicates the small wire contract instead of linking the controller
//! crate. The Phase 3 identity remains explicitly synthetic and local-test-only. A future
//! production identity is accepted only through generated source bound to a reviewed manifest and
//! exact config/gate PDA derivations.
//!
//! The routing capability is intentionally outside the public crate API:
//! ```compile_fail
//! use light_token_minter::governance_gate::GateValidated;
//! ```

#[cfg(feature = "governance-gate-v1")]
use solana_program::account_info::AccountInfo;
use solana_program::{program_error::ProgramError, pubkey::Pubkey};
use solana_sdk_ids::bpf_loader_upgradeable;

use crate::error::VaultError;

pub const GOVERNANCE_TAIL_MAGIC: [u8; 4] = *b"AGV1";
pub const GOVERNANCE_TAIL_VERSION_V1: u8 = 1;
pub const GOVERNANCE_TAIL_LEN: usize = 16;
pub const PROTOCOL_GATE_DISCRIMINATOR: [u8; 8] = *b"AGVGAT01";
pub const PROTOCOL_GATE_VERSION_V1: u8 = 1;
pub const PROTOCOL_GATE_LEN: usize = 192;

#[cfg(not(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3")))]
const UPGRADE_SEED_DOMAIN_V1: &[u8] = b"ameba-upgrade-v1";
#[cfg(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3"))]
const UPGRADE_SEED_DOMAIN_V1: &[u8] = b"ameba-governance-v3";
#[cfg(not(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3")))]
const TARGET_SEED: &[u8] = b"target";
const GATE_SEED: &[u8] = b"gate";

#[cfg(feature = "devnet-v3-governance-controller")]
mod devnet_v3_identity;
#[cfg(feature = "devnet-v3-governance-controller")]
pub use devnet_v3_identity::{
    PINNED_CONTROLLER_CONFIG_PDA, PINNED_CONTROLLER_PROGRAM_ID, PINNED_PROTOCOL_GATE_PDA,
};
#[cfg(feature = "devnet-v3-governance-controller")]
#[inline(never)]
fn emit_selected_controller_release_marker() {
    solana_program::msg!("AMEBA_SPREAD_DEVNET_V3:2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw:8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx");
}

#[cfg(feature = "mainnet-v3")]
pub use crate::{
    MAINNET_CONTROLLER_CONFIG_PDA as PINNED_CONTROLLER_CONFIG_PDA,
    MAINNET_CONTROLLER_PROGRAM_ID as PINNED_CONTROLLER_PROGRAM_ID,
    MAINNET_PROTOCOL_GATE_PDA as PINNED_PROTOCOL_GATE_PDA,
};
#[cfg(feature = "mainnet-v3")]
#[inline(never)]
fn emit_selected_controller_release_marker() {
    solana_program::log::sol_log(crate::MAINNET_PROFILE_RELEASE_MARKER);
}

#[cfg(feature = "phase3-synthetic-governance-controller")]
pub const PINNED_CONTROLLER_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");

#[cfg(feature = "reviewed-governance-controller")]
mod reviewed_controller_identity {
    include!(env!("AMEBA_GOVERNANCE_BRIDGE_IDENTITY_RS"));
}

#[cfg(feature = "reviewed-governance-controller")]
pub use reviewed_controller_identity::{
    PINNED_CONTROLLER_CONFIG_PDA, PINNED_CONTROLLER_PROGRAM_ID, PINNED_PROTOCOL_GATE_PDA,
    REVIEWED_IDENTITY_GENERATION, REVIEWED_IDENTITY_LOCAL_TEST_ONLY,
    REVIEWED_IDENTITY_MANIFEST_SHA256, REVIEWED_IDENTITY_RELEASE_MARKER,
    REVIEWED_IDENTITY_REVIEW_SHA256,
};

/// Deliberately reachable in every synthetic bridge admission so release tooling can prove that
/// an artifact was not built with the Phase 3-only controller hidden through Cargo rustflags or
/// configuration. The warning is intentionally absent from every production-feature build.
#[cfg(feature = "phase3-synthetic-governance-controller")]
#[inline(never)]
fn emit_selected_controller_release_marker() {
    solana_program::msg!("AMEBA_PHASE3_SYNTHETIC_CONTROLLER_DO_NOT_RELEASE");
}

/// Every reviewed bridge admission retains the exact manifest/review commitment in the artifact.
/// Local ceremony generation uses a distinct `DO_NOT_RELEASE` marker and is rejected by the
/// release wrapper even though it exercises this same production-shaped compile path.
#[cfg(feature = "reviewed-governance-controller")]
#[inline(never)]
fn emit_selected_controller_release_marker() {
    solana_program::log::sol_log(REVIEWED_IDENTITY_RELEASE_MARKER);
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GovernanceInstructionTailV1 {
    pub magic: [u8; 4],
    pub version: u8,
    pub reserved: [u8; 3],
    pub expected_epoch: u64,
}

impl GovernanceInstructionTailV1 {
    pub fn decode_exact(bytes: &[u8]) -> Result<Self, ProgramError> {
        if bytes.len() != GOVERNANCE_TAIL_LEN {
            return Err(VaultError::InvalidGovernanceTail.into());
        }
        let tail = Self {
            magic: bytes[0..4]
                .try_into()
                .map_err(|_| VaultError::InvalidGovernanceTail)?,
            version: bytes[4],
            reserved: bytes[5..8]
                .try_into()
                .map_err(|_| VaultError::InvalidGovernanceTail)?,
            expected_epoch: u64::from_le_bytes(
                bytes[8..16]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceTail)?,
            ),
        };
        if tail.magic != GOVERNANCE_TAIL_MAGIC
            || tail.version != GOVERNANCE_TAIL_VERSION_V1
            || tail.reserved != [0; 3]
        {
            return Err(VaultError::InvalidGovernanceTail.into());
        }
        Ok(tail)
    }

    pub fn encode(self) -> [u8; GOVERNANCE_TAIL_LEN] {
        let mut bytes = [0u8; GOVERNANCE_TAIL_LEN];
        bytes[0..4].copy_from_slice(&self.magic);
        bytes[4] = self.version;
        bytes[5..8].copy_from_slice(&self.reserved);
        bytes[8..16].copy_from_slice(&self.expected_epoch.to_le_bytes());
        bytes
    }

    pub fn for_epoch(expected_epoch: u64) -> Self {
        Self {
            magic: GOVERNANCE_TAIL_MAGIC,
            version: GOVERNANCE_TAIL_VERSION_V1,
            reserved: [0; 3],
            expected_epoch,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum GateStatusV1 {
    Active = 0,
    FrozenForUpgrade = 1,
    EmergencyFrozen = 2,
}

impl GateStatusV1 {
    fn decode(value: u8) -> Result<Self, ProgramError> {
        match value {
            0 => Ok(Self::Active),
            1 => Ok(Self::FrozenForUpgrade),
            2 => Ok(Self::EmergencyFrozen),
            _ => Err(VaultError::InvalidGovernanceGateData.into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolGateV1 {
    pub bump: u8,
    pub status: GateStatusV1,
    pub controller_config: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub epoch: u64,
    pub active_proposal: Pubkey,
    pub freeze_slot: u64,
    pub freeze_reason_code: u16,
    pub last_completed_proposal: Pubkey,
}

impl ProtocolGateV1 {
    pub fn decode_exact(bytes: &[u8]) -> Result<Self, ProgramError> {
        if bytes.len() != PROTOCOL_GATE_LEN
            || bytes[0..8] != PROTOCOL_GATE_DISCRIMINATOR
            || bytes[8] != PROTOCOL_GATE_VERSION_V1
            || bytes[10] != 1
            || bytes[190..192] != [0, 0]
        {
            return Err(VaultError::InvalidGovernanceGateData.into());
        }
        let status = GateStatusV1::decode(bytes[11])?;
        let gate = Self {
            bump: bytes[9],
            status,
            controller_config: Pubkey::new_from_array(
                bytes[12..44]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            target_program: Pubkey::new_from_array(
                bytes[44..76]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            target_programdata: Pubkey::new_from_array(
                bytes[76..108]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            epoch: u64::from_le_bytes(
                bytes[108..116]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            active_proposal: Pubkey::new_from_array(
                bytes[116..148]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            freeze_slot: u64::from_le_bytes(
                bytes[148..156]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            freeze_reason_code: u16::from_le_bytes(
                bytes[156..158]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
            last_completed_proposal: Pubkey::new_from_array(
                bytes[158..190]
                    .try_into()
                    .map_err(|_| VaultError::InvalidGovernanceGateData)?,
            ),
        };
        gate.validate_canonical_status()?;
        Ok(gate)
    }

    fn validate_canonical_status(&self) -> Result<(), ProgramError> {
        let proposal_is_default = self.active_proposal == Pubkey::default();
        let freeze_is_clear = self.freeze_slot == 0 && self.freeze_reason_code == 0;
        let freeze_is_set = self.freeze_slot != 0 && self.freeze_reason_code != 0;
        let canonical = match self.status {
            GateStatusV1::Active => proposal_is_default && freeze_is_clear,
            GateStatusV1::FrozenForUpgrade => !proposal_is_default && freeze_is_set,
            GateStatusV1::EmergencyFrozen => proposal_is_default && freeze_is_set,
        };
        if !canonical {
            return Err(VaultError::InvalidGovernanceGateData.into());
        }
        Ok(())
    }
}

/// Authorization capability carried from the top-level envelope into every business router.
/// Its fields and constructors stay private to this module.
pub(crate) struct GateValidated {
    expected_epoch: u64,
    _private: (),
}

impl GateValidated {
    pub(crate) fn expected_epoch(&self) -> u64 {
        self.expected_epoch
    }
}

fn validated_capability(expected_epoch: u64) -> GateValidated {
    GateValidated {
        expected_epoch,
        _private: (),
    }
}

#[cfg(all(test, not(feature = "governance-gate-v1")))]
pub(crate) fn test_capability(expected_epoch: u64) -> GateValidated {
    validated_capability(expected_epoch)
}

#[cfg(not(feature = "governance-gate-v1"))]
pub(crate) fn disabled_build_capability() -> GateValidated {
    validated_capability(0)
}

pub fn derive_controller_config_pda(
    controller_program: &Pubkey,
    target_program: &Pubkey,
) -> (Pubkey, u8) {
    #[cfg(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3"))]
    {
        let _ = target_program;
        Pubkey::find_program_address(&[UPGRADE_SEED_DOMAIN_V1, b"council"], controller_program)
    }
    #[cfg(not(any(feature = "devnet-v3-governance-controller", feature = "mainnet-v3")))]
    Pubkey::find_program_address(
        &[UPGRADE_SEED_DOMAIN_V1, TARGET_SEED, target_program.as_ref()],
        controller_program,
    )
}

pub fn derive_protocol_gate_pda(
    controller_program: &Pubkey,
    target_program: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[UPGRADE_SEED_DOMAIN_V1, GATE_SEED, target_program.as_ref()],
        controller_program,
    )
}

pub fn derive_target_programdata_pda(target_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[target_program.as_ref()], &bpf_loader_upgradeable::id()).0
}

#[cfg(feature = "governance-gate-v1")]
pub(crate) fn validate_top_level_envelope<'accounts, 'info, 'data>(
    program_id: &Pubkey,
    accounts: &'accounts [AccountInfo<'info>],
    instruction_data: &'data [u8],
) -> Result<(&'accounts [AccountInfo<'info>], &'data [u8], GateValidated), ProgramError> {
    emit_selected_controller_release_marker();
    if instruction_data.len() <= GOVERNANCE_TAIL_LEN {
        return Err(VaultError::MissingGovernanceTail.into());
    }
    let legacy_data_len = instruction_data.len() - GOVERNANCE_TAIL_LEN;
    let tail = GovernanceInstructionTailV1::decode_exact(&instruction_data[legacy_data_len..])?;

    let gate_info = accounts.last().ok_or(VaultError::MissingGovernanceGate)?;
    if program_id != &crate::id() {
        return Err(VaultError::InvalidGovernanceGateData.into());
    }
    let (expected_gate, expected_bump) =
        derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, program_id);
    #[cfg(any(
        feature = "reviewed-governance-controller",
        feature = "devnet-v3-governance-controller",
        feature = "mainnet-v3"
    ))]
    if expected_gate != PINNED_PROTOCOL_GATE_PDA {
        return Err(VaultError::InvalidGovernanceGatePda.into());
    }
    if gate_info.key != &expected_gate {
        return Err(VaultError::InvalidGovernanceGatePda.into());
    }
    if accounts[..accounts.len() - 1]
        .iter()
        .any(|account| account.key == &expected_gate)
    {
        return Err(VaultError::DuplicateGovernanceGate.into());
    }
    if gate_info.is_signer || gate_info.is_writable || gate_info.executable {
        return Err(VaultError::InvalidGovernanceGatePrivileges.into());
    }
    if gate_info.owner != &PINNED_CONTROLLER_PROGRAM_ID {
        return Err(VaultError::InvalidGovernanceGateOwner.into());
    }

    let gate = {
        let data = gate_info
            .try_borrow_data()
            .map_err(|_| VaultError::InvalidGovernanceGateData)?;
        ProtocolGateV1::decode_exact(&data)?
    };
    let expected_controller_config =
        derive_controller_config_pda(&PINNED_CONTROLLER_PROGRAM_ID, program_id).0;
    #[cfg(any(
        feature = "reviewed-governance-controller",
        feature = "devnet-v3-governance-controller",
        feature = "mainnet-v3"
    ))]
    if expected_controller_config != PINNED_CONTROLLER_CONFIG_PDA {
        return Err(VaultError::InvalidGovernanceGatePda.into());
    }
    if gate.bump != expected_bump {
        return Err(VaultError::InvalidGovernanceGatePda.into());
    }
    if gate.controller_config != expected_controller_config
        || gate.target_program != *program_id
        || gate.target_programdata != derive_target_programdata_pda(program_id)
    {
        return Err(VaultError::InvalidGovernanceGateData.into());
    }
    if gate.status != GateStatusV1::Active {
        return Err(VaultError::GovernanceGateFrozen.into());
    }
    if tail.expected_epoch != gate.epoch {
        return Err(VaultError::GovernanceGateEpochMismatch.into());
    }

    Ok((
        &accounts[..accounts.len() - 1],
        &instruction_data[..legacy_data_len],
        validated_capability(tail.expected_epoch),
    ))
}

pub(crate) fn ends_with_valid_governance_tail(instruction_data: &[u8]) -> bool {
    instruction_data.len() > GOVERNANCE_TAIL_LEN
        && GovernanceInstructionTailV1::decode_exact(
            &instruction_data[instruction_data.len() - GOVERNANCE_TAIL_LEN..],
        )
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate_test_controller() -> Pubkey {
        #[cfg(any(
            feature = "phase3-synthetic-governance-controller",
            feature = "reviewed-governance-controller",
            feature = "devnet-v3-governance-controller",
            feature = "mainnet-v3"
        ))]
        {
            PINNED_CONTROLLER_PROGRAM_ID
        }
        #[cfg(not(any(
            feature = "phase3-synthetic-governance-controller",
            feature = "reviewed-governance-controller",
            feature = "devnet-v3-governance-controller",
            feature = "mainnet-v3"
        )))]
        {
            solana_program::pubkey!("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi")
        }
    }

    fn gate_test_target() -> Pubkey {
        // The reviewed ceremony fixture retains its original target identity.
        // V3 uses its separately pinned devnet-v3-governance-controller profile.
        #[cfg(feature = "reviewed-governance-controller")]
        {
            solana_program::pubkey!("9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH")
        }
        #[cfg(not(feature = "reviewed-governance-controller"))]
        {
            crate::id()
        }
    }

    fn gate_bytes(status: GateStatusV1) -> [u8; PROTOCOL_GATE_LEN] {
        let controller = gate_test_controller();
        let target = gate_test_target();
        let (gate, bump) = derive_protocol_gate_pda(&controller, &target);
        let _ = gate;
        let config = derive_controller_config_pda(&controller, &target).0;
        let mut bytes = [0u8; PROTOCOL_GATE_LEN];
        bytes[0..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
        bytes[8] = PROTOCOL_GATE_VERSION_V1;
        bytes[9] = bump;
        bytes[10] = 1;
        bytes[11] = status as u8;
        bytes[12..44].copy_from_slice(config.as_ref());
        bytes[44..76].copy_from_slice(target.as_ref());
        bytes[76..108].copy_from_slice(derive_target_programdata_pda(&target).as_ref());
        bytes[108..116].copy_from_slice(&41u64.to_le_bytes());
        match status {
            GateStatusV1::Active => {}
            GateStatusV1::FrozenForUpgrade => {
                bytes[116..148].copy_from_slice(Pubkey::new_unique().as_ref());
                bytes[148..156].copy_from_slice(&10u64.to_le_bytes());
                bytes[156..158].copy_from_slice(&7u16.to_le_bytes());
            }
            GateStatusV1::EmergencyFrozen => {
                bytes[148..156].copy_from_slice(&10u64.to_le_bytes());
                bytes[156..158].copy_from_slice(&7u16.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn epoch_41_tail_is_the_exact_cross_repository_vector() {
        let encoded = GovernanceInstructionTailV1::for_epoch(41).encode();
        assert_eq!(encoded, *b"AGV1\x01\0\0\0)\0\0\0\0\0\0\0");
        assert_eq!(
            GovernanceInstructionTailV1::decode_exact(&encoded).unwrap(),
            GovernanceInstructionTailV1::for_epoch(41)
        );
    }

    #[test]
    fn tail_codec_rejects_every_noncanonical_shape() {
        for len in 0..GOVERNANCE_TAIL_LEN {
            assert!(
                GovernanceInstructionTailV1::decode_exact(&[0u8; GOVERNANCE_TAIL_LEN][..len])
                    .is_err()
            );
        }
        assert!(
            GovernanceInstructionTailV1::decode_exact(&[0u8; GOVERNANCE_TAIL_LEN + 1]).is_err()
        );
        for index in 0..8 {
            let mut bytes = GovernanceInstructionTailV1::for_epoch(u64::MAX).encode();
            bytes[index] ^= 0xff;
            assert!(GovernanceInstructionTailV1::decode_exact(&bytes).is_err());
        }
        for epoch in [0, u64::MAX] {
            let bytes = GovernanceInstructionTailV1::for_epoch(epoch).encode();
            assert_eq!(
                GovernanceInstructionTailV1::decode_exact(&bytes)
                    .unwrap()
                    .expected_epoch,
                epoch
            );
        }
    }

    #[test]
    fn gate_decoder_accepts_all_canonical_statuses_and_rejects_bad_shapes() {
        for status in [
            GateStatusV1::Active,
            GateStatusV1::FrozenForUpgrade,
            GateStatusV1::EmergencyFrozen,
        ] {
            assert_eq!(
                ProtocolGateV1::decode_exact(&gate_bytes(status))
                    .unwrap()
                    .status,
                status
            );
        }
        let active = gate_bytes(GateStatusV1::Active);
        assert!(ProtocolGateV1::decode_exact(&active[..PROTOCOL_GATE_LEN - 1]).is_err());
        let mut longer = active.to_vec();
        longer.push(0);
        assert!(ProtocolGateV1::decode_exact(&longer).is_err());
        for index in [0usize, 8, 10, 11, 190, 191] {
            let mut bytes = active;
            bytes[index] ^= 0xff;
            assert!(
                ProtocolGateV1::decode_exact(&bytes).is_err(),
                "index {index}"
            );
        }
    }

    #[test]
    fn gate_decoder_rejects_noncanonical_status_fields() {
        let mut active = gate_bytes(GateStatusV1::Active);
        active[148..156].copy_from_slice(&1u64.to_le_bytes());
        assert!(ProtocolGateV1::decode_exact(&active).is_err());

        let mut upgrade = gate_bytes(GateStatusV1::FrozenForUpgrade);
        upgrade[116..148].fill(0);
        assert!(ProtocolGateV1::decode_exact(&upgrade).is_err());

        let mut emergency = gate_bytes(GateStatusV1::EmergencyFrozen);
        emergency[116..148].copy_from_slice(Pubkey::new_unique().as_ref());
        assert!(ProtocolGateV1::decode_exact(&emergency).is_err());
    }

    #[cfg(any(
        feature = "phase3-synthetic-governance-controller",
        feature = "reviewed-governance-controller"
    ))]
    struct AdmissionFixture {
        key: Pubkey,
        owner: Pubkey,
        lamports: u64,
        data: [u8; PROTOCOL_GATE_LEN],
        is_signer: bool,
        is_writable: bool,
        executable: bool,
        instruction_data: Vec<u8>,
    }

    #[cfg(any(
        feature = "phase3-synthetic-governance-controller",
        feature = "reviewed-governance-controller"
    ))]
    impl AdmissionFixture {
        fn active(epoch: u64) -> Self {
            let target = gate_test_target();
            let key = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target).0;
            let mut data = gate_bytes(GateStatusV1::Active);
            data[108..116].copy_from_slice(&epoch.to_le_bytes());
            let mut instruction_data =
                vec![crate::instruction::VaultInstructionTag::UpdateConfig as u8];
            instruction_data.extend_from_slice(&[0xaa, 0xbb]);
            instruction_data
                .extend_from_slice(&GovernanceInstructionTailV1::for_epoch(epoch).encode());
            Self {
                key,
                owner: PINNED_CONTROLLER_PROGRAM_ID,
                lamports: 1,
                data,
                is_signer: false,
                is_writable: false,
                executable: false,
                instruction_data,
            }
        }

        fn validate(&mut self) -> Result<(Vec<u8>, u64), ProgramError> {
            self.validate_for_target(&gate_test_target())
        }

        fn validate_for_target(&mut self, target: &Pubkey) -> Result<(Vec<u8>, u64), ProgramError> {
            let account = AccountInfo::new(
                &self.key,
                self.is_signer,
                self.is_writable,
                &mut self.lamports,
                &mut self.data,
                &self.owner,
                self.executable,
                0,
            );
            let accounts = [account];
            let (legacy_accounts, legacy_data, capability) =
                validate_top_level_envelope(target, &accounts, &self.instruction_data)?;
            assert!(legacy_accounts.is_empty());
            Ok((legacy_data.to_vec(), capability.expected_epoch()))
        }
    }

    #[test]
    #[cfg(feature = "reviewed-governance-controller")]
    fn generated_identity_pins_exact_controller_config_and_gate() {
        let target = gate_test_target();
        assert_ne!(PINNED_CONTROLLER_PROGRAM_ID, Pubkey::default());
        assert_eq!(
            derive_controller_config_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target).0,
            PINNED_CONTROLLER_CONFIG_PDA
        );
        assert_eq!(
            derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target).0,
            PINNED_PROTOCOL_GATE_PDA
        );
        assert_eq!(REVIEWED_IDENTITY_MANIFEST_SHA256.len(), 64);
        assert_eq!(REVIEWED_IDENTITY_REVIEW_SHA256.len(), 64);
        assert!(REVIEWED_IDENTITY_GENERATION > 0);
        assert!(!REVIEWED_IDENTITY_RELEASE_MARKER.is_empty());

        let mut fixture = AdmissionFixture::active(41);
        assert_eq!(fixture.key, PINNED_PROTOCOL_GATE_PDA);
        assert_eq!(fixture.owner, PINNED_CONTROLLER_PROGRAM_ID);
        // This historical reviewed identity must not admit traffic in the V3 binary,
        // even when its own original target and gate are internally consistent.
        assert_eq!(
            fixture.validate(),
            Err(VaultError::InvalidGovernanceGateData.into())
        );
        assert_ne!(target, crate::id());
        assert_eq!(
            fixture.validate_for_target(&crate::id()),
            Err(VaultError::InvalidGovernanceGatePda.into())
        );
    }

    #[test]
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    fn admission_strips_only_the_absolute_tail_and_gate() {
        let mut fixture = AdmissionFixture::active(41);
        assert_eq!(fixture.validate().unwrap(), (vec![2, 0xaa, 0xbb], 41));
    }

    #[test]
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    fn admission_rejects_missing_or_malformed_tail_before_gate_access() {
        let mut fixture = AdmissionFixture::active(41);
        fixture.instruction_data.truncate(3);
        assert_eq!(
            fixture.validate(),
            Err(ProgramError::Custom(
                VaultError::MissingGovernanceTail as u32
            ))
        );

        let mut fixture = AdmissionFixture::active(41);
        let tail_start = fixture.instruction_data.len() - GOVERNANCE_TAIL_LEN;
        fixture.instruction_data[tail_start] ^= 1;
        assert_eq!(
            fixture.validate(),
            Err(ProgramError::Custom(
                VaultError::InvalidGovernanceTail as u32
            ))
        );
    }

    #[test]
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    fn admission_rejects_privilege_owner_pda_data_status_and_epoch_failures() {
        for mutate in [
            |fixture: &mut AdmissionFixture| fixture.is_signer = true,
            |fixture: &mut AdmissionFixture| fixture.is_writable = true,
            |fixture: &mut AdmissionFixture| fixture.executable = true,
        ] {
            let mut fixture = AdmissionFixture::active(41);
            mutate(&mut fixture);
            assert_eq!(
                fixture.validate(),
                Err(ProgramError::Custom(
                    VaultError::InvalidGovernanceGatePrivileges as u32
                ))
            );
        }

        let mut fixture = AdmissionFixture::active(41);
        fixture.owner = Pubkey::new_unique();
        assert_eq!(
            fixture.validate(),
            Err(ProgramError::Custom(
                VaultError::InvalidGovernanceGateOwner as u32
            ))
        );

        let mut fixture = AdmissionFixture::active(41);
        fixture.key = Pubkey::new_unique();
        assert_eq!(
            fixture.validate(),
            Err(ProgramError::Custom(
                VaultError::InvalidGovernanceGatePda as u32
            ))
        );

        for index in [0usize, 8, 10, 12, 44, 76, 190] {
            let mut fixture = AdmissionFixture::active(41);
            fixture.data[index] ^= 1;
            assert_eq!(
                fixture.validate(),
                Err(ProgramError::Custom(
                    VaultError::InvalidGovernanceGateData as u32
                )),
                "gate byte {index}"
            );
        }

        let mut fixture = AdmissionFixture::active(41);
        fixture.data[9] ^= 1;
        assert_eq!(
            fixture.validate(),
            Err(ProgramError::Custom(
                VaultError::InvalidGovernanceGatePda as u32
            ))
        );

        for status in [
            GateStatusV1::FrozenForUpgrade,
            GateStatusV1::EmergencyFrozen,
        ] {
            let mut fixture = AdmissionFixture::active(41);
            fixture.data = gate_bytes(status);
            assert_eq!(
                fixture.validate(),
                Err(ProgramError::Custom(
                    VaultError::GovernanceGateFrozen as u32
                ))
            );
        }

        for signed_epoch in [40u64, 42] {
            let mut fixture = AdmissionFixture::active(41);
            let tail_start = fixture.instruction_data.len() - GOVERNANCE_TAIL_LEN;
            fixture.instruction_data[tail_start..]
                .copy_from_slice(&GovernanceInstructionTailV1::for_epoch(signed_epoch).encode());
            assert_eq!(
                fixture.validate(),
                Err(ProgramError::Custom(
                    VaultError::GovernanceGateEpochMismatch as u32
                ))
            );
        }
    }

    #[test]
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    fn active_admission_ignores_nondefault_last_completed_proposal() {
        let mut fixture = AdmissionFixture::active(41);
        let last_completed_proposal = Pubkey::new_unique();
        fixture.data[158..190].copy_from_slice(last_completed_proposal.as_ref());

        let decoded = ProtocolGateV1::decode_exact(&fixture.data).unwrap();
        assert_eq!(decoded.status, GateStatusV1::Active);
        assert_eq!(decoded.last_completed_proposal, last_completed_proposal);
        assert_eq!(fixture.validate().unwrap(), (vec![2, 0xaa, 0xbb], 41));
    }

    #[test]
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    fn admission_requires_one_final_gate_and_rejects_duplicates() {
        let mut fixture = AdmissionFixture::active(41);
        let instruction_data = fixture.instruction_data.clone();
        assert_eq!(
            validate_top_level_envelope(&crate::id(), &[], &instruction_data).map(|_| ()),
            Err(ProgramError::Custom(
                VaultError::MissingGovernanceGate as u32
            ))
        );

        let mut duplicate_lamports = 1;
        let mut duplicate_data = fixture.data;
        let duplicate = AccountInfo::new(
            &fixture.key,
            false,
            false,
            &mut duplicate_lamports,
            &mut duplicate_data,
            &fixture.owner,
            false,
            0,
        );
        let final_gate = AccountInfo::new(
            &fixture.key,
            false,
            false,
            &mut fixture.lamports,
            &mut fixture.data,
            &fixture.owner,
            false,
            0,
        );
        let accounts = [duplicate, final_gate];
        assert_eq!(
            validate_top_level_envelope(&crate::id(), &accounts, &instruction_data).map(|_| ()),
            Err(ProgramError::Custom(
                VaultError::DuplicateGovernanceGate as u32
            ))
        );
    }

    #[test]
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    fn envelope_strip_preserves_representative_handler_inputs() {
        let representative_tags = [
            crate::instruction::VaultInstructionTag::UpdateConfig as u8,
            crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeBinPageV1 as u8,
            crate::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::InitializeLightConfig as u8,
            crate::instruction::VaultInstructionTag::InitializeWriterPolicyRegistryV1 as u8,
            97, // canonical Devnet backfill registry member when that feature is active
            crate::instruction::VaultInstructionTag::ExecuteCompressedStateV1 as u8,
        ];
        for tag in representative_tags {
            let mut fixture = AdmissionFixture::active(41);
            let legacy_data = vec![tag, 0x10, 0x20, 0x30];
            fixture.instruction_data = legacy_data.clone();
            fixture
                .instruction_data
                .extend_from_slice(&GovernanceInstructionTailV1::for_epoch(41).encode());

            let legacy_key = Pubkey::new_unique();
            let legacy_owner = Pubkey::new_unique();
            let mut legacy_lamports = 9;
            let mut legacy_account_data = [7u8; 3];
            let legacy_account = AccountInfo::new(
                &legacy_key,
                true,
                true,
                &mut legacy_lamports,
                &mut legacy_account_data,
                &legacy_owner,
                false,
                3,
            );
            let gate_account = AccountInfo::new(
                &fixture.key,
                false,
                false,
                &mut fixture.lamports,
                &mut fixture.data,
                &fixture.owner,
                false,
                0,
            );
            let accounts = [legacy_account, gate_account];
            let (stripped_accounts, stripped_data, capability) =
                validate_top_level_envelope(&crate::id(), &accounts, &fixture.instruction_data)
                    .expect("representative envelope validates");
            assert_eq!(stripped_data, legacy_data, "tag {tag}");
            assert_eq!(stripped_accounts.len(), 1, "tag {tag}");
            assert_eq!(stripped_accounts[0].key, &legacy_key, "tag {tag}");
            assert!(stripped_accounts[0].is_signer, "tag {tag}");
            assert!(stripped_accounts[0].is_writable, "tag {tag}");
            assert_eq!(stripped_accounts[0].rent_epoch, 3, "tag {tag}");
            assert_eq!(capability.expected_epoch(), 41, "tag {tag}");
        }
    }
}
