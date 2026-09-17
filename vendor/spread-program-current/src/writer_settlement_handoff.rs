//! Immutable evidence of a group adopting an already authenticated settlement.
//! Rotation authority and delays are enforced by the signer registry; this record
//! never authorizes an attestation or changes a group's frozen economic terms.
use crate::constants::CURRENT_STATE_NAMESPACE_SEED;
#[cfg(test)]
use crate::fixed_codec::ReferenceBorsh;
use crate::fixed_codec::{
    fixed_state_deserialize, invalid_fixed_borsh, FixedCursor, FixedField, FixedStateDecode,
    FixedStateEncode, FixedWriter,
};
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

pub const HANDOFF_SEED: &[u8] = b"writer-signer-handoff-g3";
pub const HANDOFF_PAYLOAD: [u8; 4] = [0xff, b'S', b'H', 3];

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct WriterSettlementHandoffV3 {
    pub initialized: bool,
    pub bump: u8,
    pub discriminator: [u8; 3],
    pub version: u8,
    pub group: Pubkey,
    pub group_commitment_before_settlement: [u8; 32],
    pub original_signer_set: Pubkey,
    pub original_version: u64,
    pub replacement_signer_set: Pubkey,
    pub replacement_version: u64,
    pub replacement_set_hash: [u8; 32],
    pub settlement_record: Pubkey,
    pub recorded_slot: u64,
}

impl WriterSettlementHandoffV3 {
    pub const LEN: usize = 222;
    pub const DISCRIMINATOR: [u8; 3] = *b"WSH";
    pub const VERSION: u8 = 3;
}

fixed_state_deserialize!(WriterSettlementHandoffV3, WriterSettlementHandoffV3::LEN, {
    initialized: bool, bump: u8, discriminator: [u8; 3], version: u8,
    group: Pubkey, group_commitment_before_settlement: [u8; 32],
    original_signer_set: Pubkey, original_version: u64,
    replacement_signer_set: Pubkey, replacement_version: u64,
    replacement_set_hash: [u8; 32], settlement_record: Pubkey, recorded_slot: u64,
});

pub fn derive_writer_settlement_handoff(program: &Pubkey, group: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, HANDOFF_SEED, group.as_ref()],
        program,
    )
}

/// Activated versions advance exactly one at a time and can never be rewritten.
/// A historical replacement is usable only with the immutable settlement record
/// that was authenticated while that version was current. New attestations still
/// require the current set in settlement_validation.
pub fn authorized_handoff_version(original: u64, replacement: u64, current: u64) -> bool {
    original != 0 && replacement > original && replacement <= current
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instruction::VaultInstruction;

    #[test]
    fn handoff_requires_an_activated_successor() {
        assert!(authorized_handoff_version(1, 2, 2));
        assert!(authorized_handoff_version(1, 2, 3));
        assert!(authorized_handoff_version(1, 4, 4));
        assert!(!authorized_handoff_version(1, 2, 1));
        assert!(!authorized_handoff_version(2, 1, 3));
        assert!(!authorized_handoff_version(2, 2, 3));
        assert!(!authorized_handoff_version(0, 1, 1));
    }

    #[test]
    fn handoff_codec_is_exact_and_preserves_the_original_instruction() {
        let value = WriterSettlementHandoffV3 {
            original_version: 7,
            replacement_version: 9,
            ..Default::default()
        };
        let bytes = value.try_to_vec().unwrap();
        assert_eq!(bytes.len(), WriterSettlementHandoffV3::LEN);
        assert_eq!(
            WriterSettlementHandoffV3::try_from_slice(&bytes).unwrap(),
            value
        );
        for instruction in [
            VaultInstruction::PublishWriterGroupSettlementV1,
            VaultInstruction::PublishWriterGroupSettlementWithHandoffV3,
        ] {
            let bytes = instruction.try_to_vec().unwrap();
            assert_eq!(bytes[0], 244);
            assert_eq!(
                VaultInstruction::try_from_slice(&bytes).unwrap(),
                instruction
            );
        }
        for bytes in [
            vec![244, 0],
            vec![244, 0xff, b'S', b'H'],
            vec![244, 0xff, b'S', b'H', 2],
            vec![244, 0xff, b'S', b'H', 3, 0],
        ] {
            assert!(VaultInstruction::try_from_slice(&bytes).is_err());
        }
    }
}
