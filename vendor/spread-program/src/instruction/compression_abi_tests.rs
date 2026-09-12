use super::{
    CompressedStateAccess, CompressionOutput, ExecuteCompressedStateParams, VaultInstruction,
};
use borsh::{BorshDeserialize, BorshSerialize};
use light_sdk::{
    instruction::{
        account_meta::{CompressedAccountMeta, CompressedAccountMetaReadOnly},
        PackedAddressTreeInfo, PackedStateTreeInfo,
    },
    proof::borsh_compat::{CompressedProof, ValidityProof},
};

fn reference_execute_compressed_state(
    mut input: &[u8],
) -> std::io::Result<ExecuteCompressedStateParams> {
    let decoded = ExecuteCompressedStateParams::deserialize_reader(&mut input)?;
    if input.is_empty() {
        Ok(decoded)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "trailing bytes",
        ))
    }
}

#[test]
fn compressed_state_initialize_abi_matches_the_cross_language_golden_vector() {
    let instruction = VaultInstruction::ExecuteCompressedStateV1 {
        params: ExecuteCompressedStateParams {
            core_account_count: 6,
            rent_payer_index: 0,
            proof: ValidityProof::from(CompressedProof {
                a: [1; 32],
                b: [2; 64],
                c: [3; 32],
            }),
            accesses: vec![CompressedStateAccess::Initialize {
                account_index: 5,
                domain: crate::state::CompressedStateDomain::OracleUsdcSkuPool,
                output: CompressionOutput {
                    address_tree_info: PackedAddressTreeInfo {
                        address_merkle_tree_pubkey_index: 0,
                        address_queue_pubkey_index: 1,
                        root_index: 0x0607,
                    },
                    output_state_tree_index: 2,
                },
            }],
            inner_instruction: vec![157, 0xaa, 0xbb],
        },
    };
    let encoded = instruction.try_to_vec().unwrap();
    let mut expected = vec![205, 6, 0, 1];
    expected.extend_from_slice(&[1; 32]);
    expected.extend_from_slice(&[2; 64]);
    expected.extend_from_slice(&[3; 32]);
    expected.push(1);
    expected.extend_from_slice(&[2, 5, 2, 0, 1, 7, 6, 2]);
    expected.extend_from_slice(&[3, 0, 157, 0xaa, 0xbb]);
    assert_eq!(encoded, expected);
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).unwrap(),
        instruction
    );
}

#[test]
fn compressed_state_slice_decoder_matches_the_reader_for_every_access_shape() {
    let tree_info = PackedStateTreeInfo {
        root_index: 11,
        prove_by_index: false,
        merkle_tree_pubkey_index: 1,
        queue_pubkey_index: 2,
        leaf_index: 13,
    };
    let leaf = |domain: crate::state::CompressedStateDomain, revision| {
        crate::state::CompressedAmebaStateLeaf {
            schema_version: crate::state::CompressedAmebaStateLeaf::CURRENT_SCHEMA_VERSION,
            domain,
            canonical_pda: solana_program::pubkey::Pubkey::new_unique(),
            revision,
            data: vec![0x5a; domain.compact_data_len()],
        }
    };
    let params = ExecuteCompressedStateParams {
        core_account_count: 9,
        rent_payer_index: 0,
        proof: ValidityProof::from(CompressedProof {
            a: [1; 32],
            b: [2; 64],
            c: [3; 32],
        }),
        accesses: vec![
            CompressedStateAccess::ReadOnly {
                account_index: 1,
                meta: CompressedAccountMetaReadOnly {
                    tree_info,
                    address: [0; 32],
                },
                leaf: leaf(
                    crate::state::CompressedStateDomain::OracleSkuCoverageRecord,
                    4,
                ),
            },
            CompressedStateAccess::Mutable {
                account_index: 2,
                meta: CompressedAccountMeta {
                    tree_info,
                    address: [0; 32],
                    output_state_tree_index: 3,
                },
                leaf: leaf(
                    crate::state::CompressedStateDomain::OracleUsdcSourceReward,
                    5,
                ),
            },
            CompressedStateAccess::Initialize {
                account_index: 3,
                domain: crate::state::CompressedStateDomain::OracleSourceDescriptor,
                output: CompressionOutput {
                    address_tree_info: PackedAddressTreeInfo {
                        address_merkle_tree_pubkey_index: 4,
                        address_queue_pubkey_index: 5,
                        root_index: 17,
                    },
                    output_state_tree_index: 6,
                },
            },
        ],
        inner_instruction: vec![157, 0xaa, 0xbb, 0xcc],
    };
    let encoded = params.try_to_vec().unwrap();

    for end in 0..=encoded.len() {
        let candidate = &encoded[..end];
        let direct = ExecuteCompressedStateParams::try_from_slice(candidate);
        let reference = reference_execute_compressed_state(candidate);
        assert_eq!(direct.is_ok(), reference.is_ok(), "truncation {end}");
        if let (Ok(direct), Ok(reference)) = (direct, reference) {
            assert_eq!(direct, reference);
        }
    }

    for index in 0..encoded.len() {
        for replacement in [0, 1, u8::MAX] {
            let mut candidate = encoded.clone();
            candidate[index] = replacement;
            let direct = ExecuteCompressedStateParams::try_from_slice(&candidate);
            let reference = reference_execute_compressed_state(&candidate);
            assert_eq!(direct.is_ok(), reference.is_ok(), "mutation {index}");
            if let (Ok(direct), Ok(reference)) = (direct, reference) {
                assert_eq!(direct, reference);
            }
        }
    }

    let mut trailing = encoded;
    trailing.push(0);
    assert!(ExecuteCompressedStateParams::try_from_slice(&trailing).is_err());
    assert!(reference_execute_compressed_state(&trailing).is_err());
}
