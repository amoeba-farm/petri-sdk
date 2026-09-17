use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{
        CURRENT_STATE_NAMESPACE_SEED, MAX_INSTRUCTION_DATA_BYTES, MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS,
        ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES, USER_COLLATERAL_PDA_SEED,
    },
    error::VaultError,
    instruction::{
        ConfigureOracleProductSkuManifestParams, SubmitOracleOpeningClaimParams,
        VaultInstructionTag,
    },
    state::{
        CompressedMarketPageExpiry, CompressedMarketPageLeaf, CompressedSettlementLeaf,
        OracleOpeningClaim, SettlementComputation, SettlementObservation, UserCollateral,
    },
};
use solana_program::{
    account_info::AccountInfo, clock::Epoch, program_error::ProgramError, pubkey::Pubkey,
};

#[test]
fn processor_rejects_instruction_data_above_global_cap_before_dispatch() {
    let mut at_limit = vec![0u8; MAX_INSTRUCTION_DATA_BYTES];
    at_limit[0] = u8::MAX;
    assert_eq!(
        light_token_minter::processor::process_instruction(
            &light_token_minter::id(),
            &[],
            &at_limit,
        ),
        Err(ProgramError::Custom(
            VaultError::InvalidInstructionData as u32
        ))
    );

    let data = vec![0u8; MAX_INSTRUCTION_DATA_BYTES + 1];
    assert_eq!(
        light_token_minter::processor::process_instruction(&light_token_minter::id(), &[], &data,),
        Err(ProgramError::Custom(
            VaultError::InvalidInstructionData as u32
        ))
    );
}

#[test]
fn duplicate_user_collateral_init_preserves_every_live_balance_byte() {
    let program_id = light_token_minter::id();
    let user = Pubkey::new_unique();
    let (collateral, bump) = Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            USER_COLLATERAL_PDA_SEED,
            user.as_ref(),
        ],
        &program_id,
    );
    let live_state = UserCollateral {
        is_initialized: true,
        bump,
        owner: user,
        available_balance: 444_000,
        position_locked_balance: 222_000,
        last_action_slot: 987_654,
    };
    let mut collateral_data = vec![0u8; UserCollateral::LEN];
    let serialized = live_state.try_to_vec().unwrap();
    collateral_data[..serialized.len()].copy_from_slice(&serialized);
    let before = collateral_data.clone();

    let system_key = solana_sdk::system_program::ID;
    let mut user_lamports = 1;
    let mut user_data = Vec::new();
    let mut collateral_lamports = 1;
    let mut system_lamports = 1;
    let mut system_data = Vec::new();
    let result = {
        let user_info = AccountInfo::new(
            &user,
            true,
            true,
            &mut user_lamports,
            &mut user_data,
            &system_key,
            false,
            Epoch::default(),
        );
        let collateral_info = AccountInfo::new(
            &collateral,
            false,
            true,
            &mut collateral_lamports,
            &mut collateral_data,
            &program_id,
            false,
            Epoch::default(),
        );
        let system_info = AccountInfo::new(
            &system_key,
            false,
            false,
            &mut system_lamports,
            &mut system_data,
            &system_key,
            true,
            Epoch::default(),
        );
        light_token_minter::processor::process_instruction(
            &program_id,
            &[user_info, collateral_info, system_info],
            &[VaultInstructionTag::InitUserCollateral as u8],
        )
    };

    assert_eq!(
        result,
        Err(ProgramError::Custom(VaultError::AlreadyInitialized as u32))
    );
    assert_eq!(collateral_data, before);
    assert_eq!(
        UserCollateral::try_from_slice(&collateral_data).unwrap(),
        live_state
    );
}

#[test]
fn product_sku_draft_chunk_decoder_is_bounded_before_identifier_allocation() {
    let params = |len| ConfigureOracleProductSkuManifestParams {
        underlying_id: [7; 32],
        draft_nonce: 11,
        expected_start_index: 0,
        sku_id_chunk: vec![[9; 32]; len],
    };
    let at_limit = params(MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS)
        .try_to_vec()
        .unwrap();
    assert!(ConfigureOracleProductSkuManifestParams::try_from_slice(&at_limit).is_ok());

    let over_limit = params(MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS + 1)
        .try_to_vec()
        .unwrap();
    assert!(ConfigureOracleProductSkuManifestParams::try_from_slice(&over_limit).is_err());

    let mut extreme_prefix = Vec::new();
    extreme_prefix.extend_from_slice(&[7; 32]);
    extreme_prefix.extend_from_slice(&11u64.to_le_bytes());
    extreme_prefix.extend_from_slice(&0u16.to_le_bytes());
    extreme_prefix.extend_from_slice(&u32::MAX.to_le_bytes());
    assert!(ConfigureOracleProductSkuManifestParams::try_from_slice(&extreme_prefix).is_err());
}

#[test]
fn opening_url_decoder_accepts_exact_cap_and_rejects_over_cap_and_u32_max() {
    let params = |url: String| SubmitOracleOpeningClaimParams {
        opening_state: 1,
        source_time: 2,
        stake: 3,
        canonical_locator_hash: [4; 32],
        source_definition_hash: [5; 32],
        archive_url: url,
    };
    let at_limit = params("x".repeat(ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES))
        .try_to_vec()
        .unwrap();
    assert!(SubmitOracleOpeningClaimParams::try_from_slice(&at_limit).is_ok());
    let over_limit = params("x".repeat(ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES + 1))
        .try_to_vec()
        .unwrap();
    assert!(SubmitOracleOpeningClaimParams::try_from_slice(&over_limit).is_err());

    let mut forged = params(String::new()).try_to_vec().unwrap();
    let length_offset = forged.len() - 4;
    forged[length_offset..].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(SubmitOracleOpeningClaimParams::try_from_slice(&forged).is_err());
}

#[test]
fn compressed_leaf_decoders_enforce_every_semantic_collection_bound() {
    let expiry = CompressedMarketPageExpiry {
        id: "E".repeat(24),
        label: "L".repeat(64),
        settlement_ts: 1,
        oracle_fix_interval_hours: 1,
        fixes_remaining: 1,
        market_alpha_bps: 1,
        base_oracle_atomic: 1,
        absolute_risk_cap_usd: 1,
        position_cap_usd: 1,
    };
    let page = CompressedMarketPageLeaf {
        underlying_id: [1; 32],
        item_id: "i".repeat(32),
        name: "n".repeat(64),
        symbol: "s".repeat(32),
        title: "t".repeat(128),
        subtitle: "u".repeat(160),
        info_href: "h".repeat(160),
        page_title: "p".repeat(160),
        meta_description: "m".repeat(280),
        price_display_decimals: 6,
        qty_display_decimals: 6,
        quote_display_decimals: 6,
        expiries: vec![expiry; 24],
        active: true,
    };
    assert!(CompressedMarketPageLeaf::try_from_slice(&page.try_to_vec().unwrap()).is_ok());

    let mut too_many = page.clone();
    too_many
        .expiries
        .push(CompressedMarketPageExpiry::default());
    assert!(CompressedMarketPageLeaf::try_from_slice(&too_many.try_to_vec().unwrap()).is_err());
    let mut oversized_item = page;
    oversized_item.item_id.push('x');
    assert!(
        CompressedMarketPageLeaf::try_from_slice(&oversized_item.try_to_vec().unwrap()).is_err()
    );

    let settlement = CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month: Pubkey::new_unique(),
        recipe_hash: [2; 32],
        underlying_id: [3; 32],
        item_id: "i".repeat(32),
        expiry_id: "E".repeat(24),
        settlement_ts: 1,
        price_display_decimals: 6,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 0,
        observations: vec![SettlementObservation::default(); 5],
        settlement_price_atomic: 1,
        source_uri: "s".repeat(256),
        source_digest: [4; 32],
        base_oracle_atomic: 1,
        index_delta_bps: 0,
        submitted_by: Pubkey::default(),
        submitted_slot: 0,
        signer_set_version: 1,
        signer_set_hash: [5; 32],
    };
    assert!(CompressedSettlementLeaf::try_from_slice(&settlement.try_to_vec().unwrap()).is_ok());
    let mut too_many_observations = settlement;
    too_many_observations
        .observations
        .push(SettlementObservation::default());
    assert!(
        CompressedSettlementLeaf::try_from_slice(&too_many_observations.try_to_vec().unwrap(),)
            .is_err()
    );
}

#[test]
fn opening_claim_state_is_fixed_width_and_rejects_truncation() {
    // The validated archive URL is now represented by a fixed bytes32 commitment. The active
    // claim therefore has no attacker-controlled dynamic allocation or length prefix.
    let encoded = OracleOpeningClaim::default().try_to_vec().unwrap();
    assert_eq!(encoded.len(), 144);
    assert!(encoded.len() <= OracleOpeningClaim::LEN);

    let mut exact = encoded.as_slice();
    assert!(OracleOpeningClaim::deserialize(&mut exact).is_ok());
    assert!(exact.is_empty());

    let mut truncated = &encoded[..encoded.len() - 1];
    assert!(OracleOpeningClaim::deserialize(&mut truncated).is_err());
}
