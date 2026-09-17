//! Retired auction preparation is not a current capability. Its former fixture
//! remains in Git history; stale bytes must reject before accounts are accessed.
use borsh::BorshDeserialize;
use light_token_minter::error::VaultError;
use light_token_minter::instruction::{VaultInstruction, VaultInstructionTag};
#[test]
fn retired_writer_bytes_cannot_initialize_or_reset_business_state() {
    for tag in [
        227, 228, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 247, 249,
    ] {
        assert!(VaultInstructionTag::from_byte(tag).is_none());
        for suffix in [vec![], vec![0; 32], b"AMG3AGV1".to_vec()] {
            let mut bytes = vec![tag];
            bytes.extend(suffix);
            assert!(VaultInstruction::try_from_slice(&bytes).is_err());
            assert_eq!(
                light_token_minter::process_instruction(&light_token_minter::id(), &[], &bytes),
                Err(VaultError::InvalidInstructionData.into())
            );
        }
    }
}
