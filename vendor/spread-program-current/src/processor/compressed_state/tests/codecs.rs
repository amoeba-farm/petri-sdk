use super::*;

#[test]
fn compact_leaf_codecs_are_byte_identical_to_borsh() {
    assert_compact_codec_matches_borsh(CompactOracleUsdcSkuPool::from_full(
        &OracleUsdcSkuPool::default(),
    ));
    assert_compact_codec_matches_borsh(CompactOracleUsdcSourceReward::from_full(
        &OracleUsdcSourceReward::default(),
    ));
    assert_compact_codec_matches_borsh(CompactOracleSkuCoverageRecord::from_full(
        &OracleSkuCoverageRecord::default(),
    ));
    assert_compact_codec_matches_borsh(CompactOracleUsdcRewardRegistration::from_full(
        &OracleUsdcRewardRegistration::default(),
    ));
    assert_compact_codec_matches_borsh(CompactOracleUsdcRewardReceipt::from_full(
        &OracleUsdcRewardReceipt::default(),
    ));

    assert_compact_codec_matches_borsh(CompactOracleSupportPosition::from_full(
        &OracleSupportPosition::default(),
    ));
    assert_compact_codec_matches_borsh(CompactOracleSourceState::from_full(
        &OracleSourceState::default(),
    ));
    assert_compact_codec_matches_borsh(CompactOracleSourceDescriptor::from_full(
        &OracleSourceState::default(),
    ));
}

#[test]
fn every_supported_domain_binds_the_exact_current_typed_pda() {
    let program_id = Pubkey::new_unique();
    let month = Pubkey::new_unique();
    let schedule = Pubkey::new_unique();
    let source_key_seed = [0x31; 32];
    let sku_id = [0x41; 32];
    let bucket_id = [0x51; 32];

    let (coverage_key, coverage_bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_SKU_COVERAGE_RECORD_PDA_SEED,
            month.as_ref(),
            &sku_id,
        ],
        &program_id,
    );
    let coverage = OracleSkuCoverageRecord {
        is_initialized: true,
        bump: coverage_bump,
        account_discriminator: OracleSkuCoverageRecord::ACCOUNT_DISCRIMINATOR,
        account_version: OracleSkuCoverageRecord::ACCOUNT_VERSION,
        month,
        sku_id,
        sku_index: 3,
        active_supported_source_count: 1,
        last_updated_slot: 9,
    };
    assert_valid(
        &program_id,
        coverage_key,
        CompressedStateDomain::OracleSkuCoverageRecord,
        &coverage,
        OracleSkuCoverageRecord::LEN,
    );

    let (sku_pool_key, sku_pool_bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_USDC_SKU_POOL_PDA_SEED,
            schedule.as_ref(),
            &bucket_id,
        ],
        &program_id,
    );
    let sku_pool = OracleUsdcSkuPool {
        is_initialized: true,
        bump: sku_pool_bump,
        account_discriminator: OracleUsdcSkuPool::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcSkuPool::ACCOUNT_VERSION,
        schedule,
        month,
        bucket_id,
        ..OracleUsdcSkuPool::default()
    };
    assert_valid(
        &program_id,
        sku_pool_key,
        CompressedStateDomain::OracleUsdcSkuPool,
        &sku_pool,
        OracleUsdcSkuPool::LEN,
    );

    let proposer = Pubkey::new_unique();
    let (source_key, source_bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_SOURCE_PDA_SEED,
            month.as_ref(),
            &source_key_seed,
        ],
        &program_id,
    );
    let source = OracleSourceState {
        is_initialized: true,
        bump: source_bump,
        month,
        source_id: source_key_seed,
        bucket_id,
        source_type_hash: [1; 32],
        canonical_locator_hash: [2; 32],
        source_definition_hash: [3; 32],
        proposer,
        ..OracleSourceState::default()
    };
    assert_valid(
        &program_id,
        source_key,
        CompressedStateDomain::OracleSourceState,
        &source,
        OracleSourceState::LEN,
    );
    assert_valid(
        &program_id,
        source_key,
        CompressedStateDomain::OracleSourceDescriptor,
        &source,
        OracleSourceState::LEN,
    );
    let (reward_key, reward_bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_USDC_SOURCE_REWARD_PDA_SEED,
            schedule.as_ref(),
            source_key.as_ref(),
        ],
        &program_id,
    );
    let reward = OracleUsdcSourceReward {
        is_initialized: true,
        bump: reward_bump,
        account_discriminator: OracleUsdcSourceReward::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcSourceReward::ACCOUNT_VERSION,
        month,
        schedule,
        sku_pool: sku_pool_key,
        source: source_key,
        source_id: source_key_seed,
        proposer,
        ..OracleUsdcSourceReward::default()
    };
    assert_valid(
        &program_id,
        reward_key,
        CompressedStateDomain::OracleUsdcSourceReward,
        &reward,
        OracleUsdcSourceReward::LEN,
    );

    let supporter = Pubkey::new_unique();
    let (support_key, support_bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_SUPPORT_POSITION_PDA_SEED,
            month.as_ref(),
            source_key.as_ref(),
            supporter.as_ref(),
        ],
        &program_id,
    );
    let support = OracleSupportPosition {
        is_initialized: true,
        bump: support_bump,
        month,
        supporter,
        source: source_key,
        source_id: source_key_seed,
        support_stake: 19,
        released: false,
        escrow_disposition: OracleEscrowDisposition::Unsettled,
        failed_schedule_escrow_counted: false,
    };
    assert_valid(
        &program_id,
        support_key,
        CompressedStateDomain::OracleSupportPosition,
        &support,
        OracleSupportPosition::LEN,
    );

    let subject = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    let (registration_key, registration_bump) = derive_oracle_usdc_reward_registration_pda(
        &program_id,
        &schedule,
        OracleUsdcRewardKind::Update,
        &subject,
    );
    let registration = OracleUsdcRewardRegistration {
        is_initialized: true,
        bump: registration_bump,
        account_discriminator: OracleUsdcRewardRegistration::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcRewardRegistration::ACCOUNT_VERSION,
        month,
        schedule,
        sku_pool: sku_pool_key,
        kind: OracleUsdcRewardKind::Update,
        subject,
        recipient,
        reward_units: 1,
        last_updated_slot: 24,
    };
    assert_valid(
        &program_id,
        registration_key,
        CompressedStateDomain::OracleUsdcRewardRegistration,
        &registration,
        OracleUsdcRewardRegistration::LEN,
    );

    let (receipt_key, receipt_bump) = derive_oracle_usdc_reward_receipt_pda(
        &program_id,
        &schedule,
        OracleUsdcRewardKind::Update,
        &subject,
        &recipient,
    );
    let receipt = OracleUsdcRewardReceipt {
        is_initialized: true,
        bump: receipt_bump,
        account_discriminator: OracleUsdcRewardReceipt::ACCOUNT_DISCRIMINATOR,
        account_version: OracleUsdcRewardReceipt::ACCOUNT_VERSION,
        month,
        schedule,
        recipient,
        kind: OracleUsdcRewardKind::Update,
        subject,
        amount: 25,
        claimed_slot: 26,
    };
    assert_valid(
        &program_id,
        receipt_key,
        CompressedStateDomain::OracleUsdcRewardReceipt,
        &receipt,
        OracleUsdcRewardReceipt::LEN,
    );

    let pot = Pubkey::new_unique();
    let dispute = Pubkey::new_unique();
    let vote = Pubkey::new_unique();
    let voter = Pubkey::new_unique();
}
