use super::*;

#[test]
fn compact_payloads_are_exact_and_bounded() {
    let sku = OracleUsdcSkuPool {
        bucket_id: [0x31; 32],
        source_reward_budget: 1,
        remaining_source_reward_budget: 2,
        opening_reward_budget: 3,
        remaining_opening_reward_budget: 4,
        update_reward_budget: 5,
        remaining_update_reward_budget: 6,
        proposer_reward_bps: 7,
        listing_bond: 8,
        support_bond: 9,
        opening_bond: 10,
        update_min_bond: 11,
        challenge_min_bond: 12,
        challenge_max_bond: 13,
        challenge_bond_bps: 14,
        registered_source_count: 15,
        registered_opening_count: 16,
        registered_update_count: 17,
        registered_update_reward_units: 18,
        last_updated_slot: 20,
        ..OracleUsdcSkuPool::default()
    };
    let reward = OracleUsdcSourceReward {
        source: Pubkey::new_unique(),
        supporter_count: 19,
        registered: true,
        terminal_status: OracleSourceStatus::Active,
        opening_claim: Pubkey::new_unique(),
        last_updated_slot: 20,
        merged_into_source: Pubkey::new_unique(),
        max_merge_depth: 2,
        listing_escrow_counted: true,
        ..OracleUsdcSourceReward::default()
    };
    let coverage = OracleSkuCoverageRecord {
        sku_id: [0x41; 32],
        sku_index: 21,
        active_supported_source_count: 22,
        last_updated_slot: 23,
        ..OracleSkuCoverageRecord::default()
    };
    let support = OracleSupportPosition {
        source: Pubkey::new_unique(),
        supporter: Pubkey::new_unique(),
        support_stake: 31,
        released: true,
        escrow_disposition: OracleEscrowDisposition::Refunded,
        failed_schedule_escrow_counted: true,
        ..OracleSupportPosition::default()
    };
    let registration = OracleUsdcRewardRegistration {
        sku_pool: Pubkey::new_unique(),
        subject: Pubkey::new_unique(),
        recipient: Pubkey::new_unique(),
        reward_units: 3,
        last_updated_slot: 24,
        ..OracleUsdcRewardRegistration::default()
    };
    let receipt = OracleUsdcRewardReceipt {
        kind: OracleUsdcRewardKind::Opening,
        subject: Pubkey::new_unique(),
        recipient: Pubkey::new_unique(),
        amount: 25,
        claimed_slot: 26,
        ..OracleUsdcRewardReceipt::default()
    };

    let source = OracleSourceState {
        source_id: [31; 32],
        bucket_id: [32; 32],
        source_type_hash: [33; 32],
        canonical_locator_hash: [34; 32],
        source_definition_hash: [35; 32],
        proposer: Pubkey::new_unique(),
        baseline_state: 36,
        current_state: 37,
        listing_bond_locked: 38,
        support_stake_total: 39,
        bucket_weight_bps: 43,
        status: OracleSourceStatus::Active,
        opening_submitted: true,
        opening_evidence_hash: [44; 32],
        last_finalized_step: 45,
        ..OracleSourceState::default()
    };

    let sku_compact = CompactOracleUsdcSkuPool::from_full(&sku);
    let reward_compact = CompactOracleUsdcSourceReward::from_full(&reward);
    let coverage_compact = CompactOracleSkuCoverageRecord::from_full(&coverage);
    let support_compact = CompactOracleSupportPosition::from_full(&support);
    let registration_compact = CompactOracleUsdcRewardRegistration::from_full(&registration);
    let receipt_compact = CompactOracleUsdcRewardReceipt::from_full(&receipt);

    let source_compact = CompactOracleSourceState::from_full(&source);
    let source_descriptor = CompactOracleSourceDescriptor::from_full(&source);
    let sku_data = encode_compact_state(&sku_compact).unwrap();
    let reward_data = encode_compact_state(&reward_compact).unwrap();
    let coverage_data = encode_compact_state(&coverage_compact).unwrap();
    let support_data = encode_compact_state(&support_compact).unwrap();
    let registration_data = encode_compact_state(&registration_compact).unwrap();
    let receipt_data = encode_compact_state(&receipt_compact).unwrap();

    let source_data = encode_compact_state(&source_compact).unwrap();
    let source_descriptor_data = encode_compact_state(&source_descriptor).unwrap();

    for (domain, data) in [
        (
            CompressedStateDomain::OracleUsdcSkuPool,
            sku_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleUsdcSourceReward,
            reward_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleSkuCoverageRecord,
            coverage_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleSupportPosition,
            support_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleUsdcRewardRegistration,
            registration_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleUsdcRewardReceipt,
            receipt_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleSourceState,
            source_data.as_slice(),
        ),
        (
            CompressedStateDomain::OracleSourceDescriptor,
            source_descriptor_data.as_slice(),
        ),
    ] {
        assert_compact_validator_parity(domain, data);
    }

    assert_fixed_projection(CompressedStateDomain::OracleUsdcSkuPool, &sku, &sku_data);
    assert_fixed_projection(
        CompressedStateDomain::OracleUsdcSourceReward,
        &reward,
        &reward_data,
    );
    assert_fixed_projection(
        CompressedStateDomain::OracleSkuCoverageRecord,
        &coverage,
        &coverage_data,
    );
    assert_fixed_projection(
        CompressedStateDomain::OracleSupportPosition,
        &support,
        &support_data,
    );
    assert_fixed_projection(
        CompressedStateDomain::OracleUsdcRewardRegistration,
        &registration,
        &registration_data,
    );
    assert_fixed_projection(
        CompressedStateDomain::OracleUsdcRewardReceipt,
        &receipt,
        &receipt_data,
    );

    assert_fixed_projection(
        CompressedStateDomain::OracleSourceState,
        &source,
        &source_data,
    );
    assert_fixed_projection(
        CompressedStateDomain::OracleSourceDescriptor,
        &source,
        &source_descriptor_data,
    );

    let bump = 71;
    let month = Pubkey::new_unique();
    let schedule = Pubkey::new_unique();
    let sku_pool = Pubkey::new_unique();
    let proposer = Pubkey::new_unique();
    let source_id = [0x72; 32];
    assert_eq!(
        materialized_coverage_bytes(bump, &month, &coverage_data),
        fixed_account_bytes(
            &coverage_compact.clone().into_full(bump, month),
            OracleSkuCoverageRecord::LEN,
        ),
    );
    assert_eq!(
        materialized_sku_pool_bytes(bump, &schedule, &month, &sku_data),
        fixed_account_bytes(
            &sku_compact.clone().into_full(bump, schedule, month),
            OracleUsdcSkuPool::LEN,
        ),
    );
    assert_eq!(
        materialized_source_reward_bytes(
            bump,
            &month,
            &schedule,
            &sku_pool,
            &source_id,
            &proposer,
            &reward_data,
        ),
        fixed_account_bytes(
            &reward_compact
                .clone()
                .into_full(bump, month, schedule, sku_pool, source_id, proposer),
            OracleUsdcSourceReward::LEN,
        ),
    );
    assert_eq!(
        materialized_support_bytes(bump, &month, &support_data),
        fixed_account_bytes(
            &support_compact.clone().into_full(bump, month),
            OracleSupportPosition::LEN,
        ),
    );
    let source_without_descriptor = source_compact.clone().into_full(bump, month);
    assert_eq!(
        materialized_source_bytes(bump, &month, &source_data),
        fixed_account_bytes(&source_without_descriptor, OracleSourceState::LEN),
    );
    let mut materialized_source =
        fixed_account_bytes(&source_without_descriptor, OracleSourceState::LEN);
    apply_materialized_source_descriptor(&mut materialized_source, &source_descriptor_data);
    let mut source_with_descriptor = source_without_descriptor;
    source_descriptor
        .clone()
        .apply_to(&mut source_with_descriptor);
    assert_eq!(
        materialized_source,
        fixed_account_bytes(&source_with_descriptor, OracleSourceState::LEN),
    );
    assert_eq!(
        materialized_reward_registration_bytes(bump, &month, &schedule, &registration_data),
        fixed_account_bytes(
            &registration_compact
                .clone()
                .into_full(bump, month, schedule),
            OracleUsdcRewardRegistration::LEN,
        ),
    );
    let pot = Pubkey::new_unique();
    let dispute = Pubkey::new_unique();
    let vote = Pubkey::new_unique();
    let voter = Pubkey::new_unique();
    let voting_power = 73;

    assert_eq!(sku_data.len(), 156);
    assert_eq!(reward_data.len(), 112);
    assert_eq!(coverage_data.len(), 44);
    assert_eq!(support_data.len(), 107);
    assert_eq!(registration_data.len(), 105);
    assert_eq!(receipt_data.len(), 81);

    assert_eq!(source_data.len(), 216);
    assert_eq!(source_descriptor_data.len(), 96);
    assert!(sku_data.len() <= MAX_COMPRESSED_STATE_LEAF_BYTES);
    assert!(support_data.len() <= MAX_COMPRESSED_STATE_LEAF_BYTES);
    assert!(decode_compact_state::<CompactOracleUsdcSkuPool>(
        &sku_data[..sku_data.len() - 1],
        crate::error::VaultError::InvalidOracleUsdcSkuPool,
    )
    .is_err());
    let mut zero_padded_sku_data = sku_data.clone();
    zero_padded_sku_data.push(0);
    assert_eq!(
        decode_compact_state::<CompactOracleUsdcSkuPool>(
            &zero_padded_sku_data,
            crate::error::VaultError::InvalidOracleUsdcSkuPool,
        )
        .unwrap(),
        sku_compact
    );
    *zero_padded_sku_data.last_mut().unwrap() = 1;
    assert!(decode_compact_state::<CompactOracleUsdcSkuPool>(
        &zero_padded_sku_data,
        crate::error::VaultError::InvalidOracleUsdcSkuPool,
    )
    .is_err());
    assert_eq!(
        decode_compact_state::<CompactOracleUsdcSkuPool>(
            &sku_data,
            crate::error::VaultError::InvalidOracleUsdcSkuPool,
        )
        .unwrap(),
        sku_compact
    );
    assert_eq!(
        decode_compact_state::<CompactOracleUsdcSourceReward>(
            &reward_data,
            crate::error::VaultError::InvalidOracleUsdcSourceReward,
        )
        .unwrap(),
        reward_compact
    );
    assert_eq!(
        decode_compact_state::<CompactOracleSkuCoverageRecord>(
            &coverage_data,
            crate::error::VaultError::InvalidOracleSkuCoverageRecord,
        )
        .unwrap(),
        coverage_compact
    );
    assert_eq!(
        decode_compact_state::<CompactOracleSupportPosition>(
            &support_data,
            crate::error::VaultError::InvalidOracleState,
        )
        .unwrap(),
        support_compact
    );
    assert_eq!(
        decode_compact_state::<CompactOracleUsdcRewardRegistration>(
            &registration_data,
            crate::error::VaultError::InvalidOracleUsdcRewardRegistration,
        )
        .unwrap(),
        registration_compact
    );
    assert_eq!(
        decode_compact_state::<CompactOracleUsdcRewardReceipt>(
            &receipt_data,
            crate::error::VaultError::InvalidOracleUsdcRewardReceipt,
        )
        .unwrap(),
        receipt_compact
    );

    assert_eq!(
        decode_compact_state::<CompactOracleSourceState>(
            &source_data,
            crate::error::VaultError::InvalidOracleSourceAccount,
        )
        .unwrap(),
        source_compact
    );
    assert_eq!(
        decode_compact_state::<CompactOracleSourceDescriptor>(
            &source_descriptor_data,
            crate::error::VaultError::InvalidOracleSourceAccount,
        )
        .unwrap(),
        source_descriptor
    );
}
