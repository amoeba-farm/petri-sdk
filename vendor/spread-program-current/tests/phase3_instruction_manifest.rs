use std::{fs, path::PathBuf};

use light_token_minter::{
    ameba_dlmm_instruction::AmoebaDlmmInstructionTag,
    governance_manifest::{
        classify_active_instruction_tag, classify_instruction_tag_for_build,
        is_devnet_solo_backfill_2026_instruction_tag, phase3_instruction_manifest_json,
        InstructionGovernanceClass, DEVNET_SOLO_BACKFILL_2026_TAGS,
        DEVNET_SOLO_BACKFILL_2026_TAG_BYTES, RESERVED_INSTRUCTION_TAGS,
    },
    instruction::VaultInstructionTag,
};

fn class_counts(devnet_solo_backfill_2026: bool) -> [usize; 5] {
    let mut counts = [0usize; 5];
    for tag in 0u8..=u8::MAX {
        let index = match classify_instruction_tag_for_build(tag, devnet_solo_backfill_2026) {
            InstructionGovernanceClass::Unknown => 0,
            InstructionGovernanceClass::Reserved => 1,
            InstructionGovernanceClass::RecognizedReadOnly => 2,
            InstructionGovernanceClass::RecognizedMutating => 3,
            InstructionGovernanceClass::FeatureGatedMutating => 4,
        };
        counts[index] += 1;
    }
    counts
}

#[test]
fn exhaustive_default_and_backfill_build_counts_are_frozen() {
    assert_eq!(class_counts(false), [119, 16, 0, 121, 0]);
    assert_eq!(class_counts(true), [107, 16, 0, 121, 12]);
}

#[test]
fn exhaustive_classification_is_derived_from_disjoint_compiled_registries() {
    for tag in 0u8..=u8::MAX {
        let vault = VaultInstructionTag::from_byte(tag).is_some();
        let dlmm = AmoebaDlmmInstructionTag::from_byte(tag).is_some();
        let backfill = is_devnet_solo_backfill_2026_instruction_tag(tag);
        let reserved = RESERVED_INSTRUCTION_TAGS.contains(&tag);

        assert!(
            !(vault && dlmm),
            "byte {tag} is assigned by both ordinary registries"
        );
        assert!(
            !((vault || dlmm) && backfill),
            "byte {tag} is assigned by an ordinary and feature registry"
        );
        assert!(
            !((vault || dlmm || backfill) && reserved),
            "reserved byte {tag} is assigned"
        );

        let expected_default = if vault || dlmm {
            InstructionGovernanceClass::RecognizedMutating
        } else if reserved {
            InstructionGovernanceClass::Reserved
        } else {
            InstructionGovernanceClass::Unknown
        };
        assert_eq!(
            classify_instruction_tag_for_build(tag, false),
            expected_default,
            "default byte {tag}"
        );

        let expected_feature = if vault || dlmm {
            InstructionGovernanceClass::RecognizedMutating
        } else if backfill {
            InstructionGovernanceClass::FeatureGatedMutating
        } else if reserved {
            InstructionGovernanceClass::Reserved
        } else {
            InstructionGovernanceClass::Unknown
        };
        assert_eq!(
            classify_instruction_tag_for_build(tag, true),
            expected_feature,
            "feature byte {tag}"
        );
    }
}

#[test]
fn active_classifier_matches_the_compiled_feature_shape_for_every_byte() {
    for tag in 0u8..=u8::MAX {
        assert_eq!(
            classify_active_instruction_tag(tag),
            classify_instruction_tag_for_build(tag, cfg!(feature = "devnet-solo-backfill-2026")),
            "active byte {tag}"
        );
    }
}

#[test]
fn devnet_backfill_metadata_is_exact_and_unique() {
    let expected = [29u8, 31, 34, 35, 69, 97, 189, 204, 206, 211, 212, 214];
    assert_eq!(DEVNET_SOLO_BACKFILL_2026_TAG_BYTES, expected);
    assert_eq!(
        DEVNET_SOLO_BACKFILL_2026_TAGS.map(|metadata| metadata.byte),
        DEVNET_SOLO_BACKFILL_2026_TAG_BYTES
    );
    for (index, metadata) in DEVNET_SOLO_BACKFILL_2026_TAGS.iter().enumerate() {
        assert!(!metadata.name.is_empty());
        assert!(
            DEVNET_SOLO_BACKFILL_2026_TAGS[..index]
                .iter()
                .all(|previous| previous.byte != metadata.byte),
            "duplicate feature byte {}",
            metadata.byte
        );
    }
}

#[test]
fn checked_manifest_is_byte_for_byte_current_and_has_256_entries() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/governance/generated/phase-3-instruction-manifest-v1.json");
    let checked = fs::read_to_string(&path).expect("checked Phase 3 manifest");
    let rendered = phase3_instruction_manifest_json();
    assert_eq!(checked, rendered, "run the manifest generator with --write");
    assert_eq!(checked.matches("    {\"byte\": ").count(), 256);
}
