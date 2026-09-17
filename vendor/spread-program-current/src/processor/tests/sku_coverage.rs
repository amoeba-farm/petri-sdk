use super::*;

#[test]
fn collective_activation_coverage_gate_accepts_only_complete_current_recipe() {
    let month = OracleMonthState {
        scramble_start_ts: 100,
        listing_ts: 100 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ..OracleMonthState::default()
    };
    let coverage = OracleSkuCoverageManifest {
        required_sku_count: 2,
        covered_sku_count: 2,
        coverage_finalized: true,
        coverage_complete_ts: 101,
        planned_scramble_start_ts: month.scramble_start_ts,
        planned_listing_ts: month.listing_ts,
        ..OracleSkuCoverageManifest::default()
    };
    let active_manifest = OracleActiveWeightManifest {
        expected_group_count: 2,
        ..OracleActiveWeightManifest::default()
    };
    ensure_finalized_oracle_issue_sku_coverage(&month, &coverage, &active_manifest)
        .expect("complete fresh V5 coverage must pass");

    for invalid_coverage in [
        OracleSkuCoverageManifest {
            coverage_finalized: false,
            ..coverage.clone()
        },
        OracleSkuCoverageManifest {
            coverage_complete_ts: 0,
            ..coverage.clone()
        },
        OracleSkuCoverageManifest {
            covered_sku_count: 1,
            ..coverage.clone()
        },
        OracleSkuCoverageManifest {
            planned_listing_ts: coverage.planned_listing_ts + 1,
            ..coverage.clone()
        },
        OracleSkuCoverageManifest {
            coverage_complete_ts: month.listing_ts,
            ..coverage.clone()
        },
    ] {
        assert!(ensure_finalized_oracle_issue_sku_coverage(
            &month,
            &invalid_coverage,
            &active_manifest
        )
        .is_err());
    }

    let invalid_active = OracleActiveWeightManifest {
        expected_group_count: 1,
        ..active_manifest
    };
    assert!(
        ensure_finalized_oracle_issue_sku_coverage(&month, &coverage, &invalid_active).is_err()
    );
}

#[test]
fn terminal_sku_membership_is_index_bound_and_exact_depth() {
    let sku_ids = [[1u8; 32], [2u8; 32], [3u8; 32]];
    let leaf = |index: u16, sku_id: &[u8; 32]| {
        hashv(&[ORACLE_SKU_LEAF_HASH_DOMAIN, &index.to_le_bytes(), sku_id]).to_bytes()
    };
    let leaves = [
        leaf(0, &sku_ids[0]),
        leaf(1, &sku_ids[1]),
        leaf(2, &sku_ids[2]),
        hashv(&[
            crate::constants::ORACLE_SKU_EMPTY_HASH_DOMAIN,
            &3u16.to_le_bytes(),
        ])
        .to_bytes(),
    ];
    let left = hashv(&[ORACLE_SKU_NODE_HASH_DOMAIN, &leaves[0], &leaves[1]]).to_bytes();
    let right = hashv(&[ORACLE_SKU_NODE_HASH_DOMAIN, &leaves[2], &leaves[3]]).to_bytes();
    let root = hashv(&[ORACLE_SKU_NODE_HASH_DOMAIN, &left, &right]).to_bytes();
    assert_eq!(oracle_sku_merkle_root(&sku_ids), Ok(root));
    let coverage = OracleSkuCoverageManifest {
        required_sku_root: root,
        required_sku_count: 3,
        ..OracleSkuCoverageManifest::default()
    };

    assert_eq!(
        verify_oracle_sku_membership(&coverage, &sku_ids[0], 0, &[leaves[1], right]),
        Ok(())
    );
    assert_eq!(
        verify_oracle_sku_membership(&coverage, &sku_ids[1], 1, &[leaves[0], right]),
        Ok(())
    );
    assert_eq!(
        verify_oracle_sku_membership(&coverage, &sku_ids[2], 2, &[leaves[3], left]),
        Ok(())
    );
    assert_eq!(
        verify_oracle_sku_membership(&coverage, &sku_ids[0], 1, &[leaves[1], right]),
        Err(ProgramError::Custom(
            VaultError::InvalidOracleSkuMembershipProof as u32
        ))
    );
    assert_eq!(
        verify_oracle_sku_membership(&coverage, &sku_ids[0], 0, &[leaves[1]]),
        Err(ProgramError::Custom(
            VaultError::InvalidOracleSkuMembershipProof as u32
        ))
    );
}

#[test]
fn exact_coverage_keeps_on_time_calendar_and_late_coverage_preserves_review() {
    let planned_scramble = 1_000_000u64;
    let planned_listing = planned_scramble + ORACLE_PRE_LISTING_WINDOW_SECONDS;
    let expiry = planned_listing + 90 * crate::constants::ORACLE_CALENDAR_DAY_SECONDS;
    let coverage = OracleSkuCoverageManifest {
        planned_scramble_start_ts: planned_scramble,
        planned_listing_ts: planned_listing,
        ..OracleSkuCoverageManifest::default()
    };
    let planned_placement_end = planned_scramble + ORACLE_PLACEMENT_WINDOW_SECONDS;

    assert_eq!(
        finalized_oracle_sku_coverage_schedule(&coverage, expiry, planned_placement_end),
        Ok((planned_scramble, planned_listing))
    );

    let late_completion = planned_placement_end + 123;
    let (shifted_scramble, shifted_listing) =
        finalized_oracle_sku_coverage_schedule(&coverage, expiry, late_completion).unwrap();
    assert_eq!(
        shifted_scramble + ORACLE_PLACEMENT_WINDOW_SECONDS,
        late_completion
    );
    assert_eq!(
        shifted_listing - late_completion,
        ORACLE_KILL_WINDOW_SECONDS
            + ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS
            + ORACLE_OPENING_WINDOW_SECONDS
    );
    let shifted_month = OracleMonthState {
        scramble_start_ts: shifted_scramble,
        listing_ts: shifted_listing,
        ..OracleMonthState::default()
    };
    assert!(rulebook_schedule_boundaries(&shifted_month).is_ok());

    let latest_unsafe_completion = expiry
        - ORACLE_KILL_WINDOW_SECONDS
        - ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS
        - ORACLE_OPENING_WINDOW_SECONDS;
    assert_eq!(
        finalized_oracle_sku_coverage_schedule(&coverage, expiry, latest_unsafe_completion),
        Err(ProgramError::Custom(
            VaultError::OracleSkuCoverageExtensionTooLate as u32
        ))
    );
}

#[test]
fn removing_the_last_supported_source_invalidates_finalized_coverage() {
    let mut coverage = OracleSkuCoverageManifest {
        required_sku_count: 3,
        covered_sku_count: 2,
        coverage_finalized: true,
        coverage_complete_ts: 1_234,
        ..OracleSkuCoverageManifest::default()
    };
    let mut record = OracleSkuCoverageRecord {
        active_supported_source_count: 2,
        ..OracleSkuCoverageRecord::default()
    };

    remove_supported_source_from_sku_coverage(&mut coverage, &mut record).unwrap();
    assert_eq!(record.active_supported_source_count, 1);
    assert_eq!(coverage.covered_sku_count, 2);
    assert!(coverage.coverage_finalized);

    remove_supported_source_from_sku_coverage(&mut coverage, &mut record).unwrap();
    assert_eq!(record.active_supported_source_count, 0);
    assert_eq!(coverage.covered_sku_count, 1);
    assert!(!coverage.coverage_finalized);
    assert_eq!(coverage.coverage_complete_ts, 0);
    assert_eq!(
        remove_supported_source_from_sku_coverage(&mut coverage, &mut record),
        Err(ProgramError::Custom(
            VaultError::InvalidOracleSkuCoverageRecord as u32
        ))
    );
}

#[test]
fn product_sku_ids_are_complete_unique_nonzero_and_canonically_ordered() {
    let padded = |value: &[u8]| {
        let mut result = [0u8; 32];
        result[..value.len()].copy_from_slice(value);
        result
    };
    let ram = padded(b"ram-standardized-baskets");
    let nand = padded(b"nand-standardized-baskets");
    let synthetic_ids = |count: u16| {
        (1..=count)
            .map(|value| [u8::try_from(value).unwrap(); 32])
            .collect::<Vec<_>>()
    };
    let ram_ids = synthetic_ids(RAMX_ORACLE_PRODUCT_SKU_COUNT);
    let nand_ids = synthetic_ids(NANDX_ORACLE_PRODUCT_SKU_COUNT);
    assert_eq!(
        validate_oracle_product_sku_ids(&ram, &ram_ids),
        Ok(RAMX_ORACLE_PRODUCT_SKU_COUNT)
    );
    assert_eq!(
        validate_oracle_product_sku_ids(&nand, &nand_ids),
        Ok(NANDX_ORACLE_PRODUCT_SKU_COUNT)
    );

    let invalid = |ids: &[[u8; 32]]| {
        assert_eq!(
            validate_oracle_product_sku_ids(&ram, ids),
            Err(ProgramError::Custom(
                VaultError::InvalidOracleSkuCoverageManifest as u32
            ))
        );
    };
    invalid(&ram_ids[..usize::from(RAMX_ORACLE_PRODUCT_SKU_COUNT - 1)]);
    invalid(&synthetic_ids(60));
    let mut zero = ram_ids.clone();
    zero[0] = [0; 32];
    invalid(&zero);
    let mut duplicate = ram_ids.clone();
    duplicate[1] = duplicate[0];
    invalid(&duplicate);
    let mut descending = ram_ids.clone();
    descending.swap(0, 1);
    invalid(&descending);
    assert!(validate_oracle_product_sku_ids(&[9; 32], &ram_ids).is_err());
}

#[test]
fn packet_safe_product_sku_chunks_finalize_only_on_the_exact_last_identifier() {
    // Synthetic monotonic values exercise the protocol shape; they are not catalog identities.
    let ids = (1..=RAMX_ORACLE_PRODUCT_SKU_COUNT)
        .map(|value| [u8::try_from(value).unwrap(); 32])
        .collect::<Vec<_>>();
    let mut draft = synthetic_ram_product_sku_draft();
    let chunks = ids
        .chunks(MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS)
        .collect::<Vec<_>>();
    assert_eq!(
        chunks.iter().map(|chunk| chunk.len()).collect::<Vec<_>>(),
        [16, 16, 16, 4]
    );
    let mut starts = Vec::new();
    let mut finalized_root = None;
    for chunk in chunks {
        let start = draft.appended_sku_count;
        starts.push(start);
        finalized_root = append_oracle_product_sku_chunk(&mut draft, start, chunk).unwrap();
        assert_eq!(
            finalized_root.is_some(),
            usize::from(draft.appended_sku_count) == ids.len()
        );
    }
    assert_eq!(starts, [0, 16, 32, 48]);
    assert_eq!(draft.appended_sku_count, RAMX_ORACLE_PRODUCT_SKU_COUNT);
    assert_eq!(draft.last_sku_id, *ids.last().unwrap());
    assert_eq!(
        finalized_root,
        Some(oracle_sku_merkle_root(&ids).expect("vector Merkle root"))
    );
    assert_eq!(
        finalized_oracle_sku_frontier_root(&draft),
        oracle_sku_merkle_root(&ids)
    );
}

#[test]
fn streaming_product_sku_frontier_matches_vector_root_for_every_supported_count() {
    for expected_sku_count in 1..=MAX_ORACLE_REQUIRED_SKUS {
        let ids = (1..=expected_sku_count)
            .map(|value| {
                let mut sku_id = [0u8; 32];
                sku_id[..2].copy_from_slice(&value.to_be_bytes());
                sku_id
            })
            .collect::<Vec<_>>();
        let mut draft = OracleProductSkuDraft {
            is_initialized: true,
            account_discriminator: OracleProductSkuDraft::ACCOUNT_DISCRIMINATOR,
            account_version: OracleProductSkuDraft::ACCOUNT_VERSION,
            expected_sku_count,
            ..OracleProductSkuDraft::default()
        };
        for (index, sku_id) in ids.iter().enumerate() {
            let index = u16::try_from(index).unwrap();
            append_oracle_sku_frontier_leaf(
                &mut draft.merkle_frontier,
                &mut draft.frontier_mask,
                index,
                sku_id,
            )
            .unwrap();
            draft.appended_sku_count += 1;
            draft.last_sku_id = *sku_id;
            assert!(draft.has_canonical_layout());
        }
        assert_eq!(
            finalized_oracle_sku_frontier_root(&draft),
            oracle_sku_merkle_root(&ids),
            "frontier mismatch at count {expected_sku_count}"
        );
    }
}

#[test]
fn product_sku_draft_rejects_replay_gaps_overflow_and_noncanonical_chunks() {
    let invalid_error = Err(ProgramError::Custom(
        VaultError::InvalidOracleProductSkuDraft as u32,
    ));
    let mut draft = synthetic_ram_product_sku_draft();
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 1, &[[1; 32]]),
        invalid_error
    );
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 0, &[]),
        invalid_error
    );
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 0, &vec![[1; 32]; 17]),
        invalid_error
    );
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 0, &[[0; 32]]),
        invalid_error
    );
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 0, &[[1; 32], [1; 32]]),
        invalid_error
    );
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 0, &[[2; 32], [1; 32]]),
        invalid_error
    );

    append_oracle_product_sku_chunk(&mut draft, 0, &[[1; 32]]).unwrap();
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 0, &[[2; 32]]),
        invalid_error
    );
    assert_eq!(
        append_oracle_product_sku_chunk(&mut draft, 1, &[[1; 32]]),
        invalid_error
    );

    let ids = (1..=RAMX_ORACLE_PRODUCT_SKU_COUNT)
        .map(|value| [u8::try_from(value).unwrap(); 32])
        .collect::<Vec<_>>();
    let mut nearly_full = synthetic_ram_product_sku_draft();
    for chunk in ids[..48].chunks(MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS) {
        let start = nearly_full.appended_sku_count;
        append_oracle_product_sku_chunk(&mut nearly_full, start, chunk).unwrap();
    }
    let overflow = (49u8..=53).map(|value| [value; 32]).collect::<Vec<_>>();
    assert_eq!(
        append_oracle_product_sku_chunk(&mut nearly_full, 48, &overflow),
        invalid_error
    );

    let reverted_sixty = (1u8..=60).map(|value| [value; 32]).collect::<Vec<_>>();
    let mut reverted_draft = synthetic_ram_product_sku_draft();
    for chunk in reverted_sixty[..48].chunks(MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS) {
        let start = reverted_draft.appended_sku_count;
        append_oracle_product_sku_chunk(&mut reverted_draft, start, chunk).unwrap();
    }
    assert_eq!(
        append_oracle_product_sku_chunk(&mut reverted_draft, 48, &reverted_sixty[48..]),
        invalid_error
    );

    assert!(
        append_oracle_product_sku_chunk(&mut nearly_full, 48, &ids[48..])
            .unwrap()
            .is_some()
    );
    assert_eq!(
        append_oracle_product_sku_chunk(
            &mut nearly_full,
            RAMX_ORACLE_PRODUCT_SKU_COUNT,
            &[[53; 32]],
        ),
        invalid_error
    );
}

#[test]
fn product_sku_draft_loader_binds_nonce_identity_layout_and_exact_allocation() {
    let program_id = Pubkey::new_unique();
    let nonce = 41u64;
    let mut draft = synthetic_ram_product_sku_draft();
    draft.draft_nonce = nonce;
    append_oracle_product_sku_chunk(&mut draft, 0, &[[1; 32], [2; 32]]).unwrap();
    let (key, bump) = derive_oracle_product_sku_draft_pda(&program_id, &draft.underlying_id, nonce);
    draft.bump = bump;
    let len = OracleProductSkuDraft::LEN;
    with_test_account_info(
        &key,
        &program_id,
        exact_test_state_data(&draft, len),
        |info| {
            assert_eq!(
                load_valid_oracle_product_sku_draft(&program_id, &draft.underlying_id, nonce, info),
                Ok(draft.clone())
            );
            assert!(load_valid_oracle_product_sku_draft(
                &program_id,
                &draft.underlying_id,
                nonce + 1,
                info
            )
            .is_err());
        },
    );

    let malformed = OracleProductSkuDraft {
        frontier_mask: 0,
        ..draft.clone()
    };
    with_test_account_info(
        &key,
        &program_id,
        exact_test_state_data(&malformed, len),
        |info| {
            assert!(load_valid_oracle_product_sku_draft(
                &program_id,
                &draft.underlying_id,
                nonce,
                info
            )
            .is_err());
        },
    );
    let mut undersized_data = exact_test_state_data(&draft, len);
    undersized_data.truncate(len - 1);
    with_test_account_info(&key, &program_id, undersized_data, |info| {
        assert!(load_valid_oracle_product_sku_draft(
            &program_id,
            &draft.underlying_id,
            nonce,
            info
        )
        .is_err());
    });
}

#[test]
fn product_manifest_loader_is_create_only_authority_for_v5_root_and_count() {
    let program_id = Pubkey::new_unique();
    let mut underlying_id = [0u8; 32];
    underlying_id[..24].copy_from_slice(b"ram-standardized-baskets");
    let (key, bump) = derive_oracle_product_sku_manifest_pda(&program_id, &underlying_id);
    let manifest = OracleProductSkuManifest {
        is_initialized: true,
        bump,
        account_discriminator: OracleProductSkuManifest::ACCOUNT_DISCRIMINATOR,
        account_version: OracleProductSkuManifest::ACCOUNT_VERSION,
        underlying_id,
        required_sku_root: [7; 32],
        required_sku_count: RAMX_ORACLE_PRODUCT_SKU_COUNT,
        reserved: [0; 6],
        last_updated_slot: 1,
    };
    with_test_account_info(
        &key,
        &program_id,
        exact_test_state_data(&manifest, OracleProductSkuManifest::LEN),
        |info| {
            assert_eq!(
                load_valid_oracle_product_sku_manifest(&program_id, &underlying_id, info),
                Ok(manifest.clone())
            );
        },
    );

    let wrong_count = OracleProductSkuManifest {
        required_sku_count: 60,
        ..manifest.clone()
    };
    with_test_account_info(
        &key,
        &program_id,
        exact_test_state_data(&wrong_count, OracleProductSkuManifest::LEN),
        |info| {
            assert!(
                load_valid_oracle_product_sku_manifest(&program_id, &underlying_id, info).is_err()
            );
        },
    );
    with_test_account_info(&key, &system_program::id(), Vec::new(), |info| {
        assert!(load_valid_oracle_product_sku_manifest(&program_id, &underlying_id, info).is_err());
    });
}

#[test]
fn v5_months_are_cash_only() {
    let source_lifecycle = include_str!("../oracle_usdc/sources.rs");
    assert!(source_lifecycle.contains("load_canonical_user_collateral"));
    assert!(source_lifecycle.contains("debit_oracle_usdc_available"));
    assert!(!source_lifecycle.contains("load_oracle_major_token"));
}
