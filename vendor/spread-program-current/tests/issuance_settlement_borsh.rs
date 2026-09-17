use borsh::BorshDeserialize;
use light_token_minter::{
    constants::{
        MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS, ORACLE_CALENDAR_DAY_SECONDS, ORACLE_KILL_WINDOW_SECONDS,
        ORACLE_OPENING_WINDOW_SECONDS, ORACLE_PLACEMENT_WINDOW_SECONDS,
        ORACLE_PRE_LISTING_WINDOW_SECONDS, ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS,
        ORACLE_SCRAMBLE_WINDOW_SECONDS,
    },
    error::VaultError,
    instruction::{
        AccumulateOracleSettlementSourceBucketParams, ActivateVaultV2Params,
        BootstrapVaultGovernanceV2Params, ChallengeOracleOpeningClaimParams,
        ConfigureOracleEconomicsTemplateV2Params, ConfigureOracleProductSkuManifestParams,
        FinalizeOracleUpdateClaimV2Params, InitMarketV2Params,
        InitializeSettlementSignerRegistryParams, ProposeSettlementSignerRotationParams,
        ResolveOracleOpeningClaimChallengeParams, RevealOracleUpdateClaimV3Params,
        RotateVaultAuthoritiesV2Params, SetMarketPausedParams, UpsertMarketPageParams,
        UpsertSettlementParams, VaultInstruction, VaultInstructionTag,
    },
    state::{
        CompressedMarketPageLeaf, CompressedSettlementLeaf, InstrumentDefinition, MarketParameters,
        OptionKind, OracleEconomicParams, OracleEmergencyDisputeKind,
        OracleOpeningChallengeOutcome, OracleUpdateClaimOutcome, SettlementComputation,
        SettlementStyle,
    },
};
use solana_program::pubkey::Pubkey;
use solana_sdk::{
    hash::Hash,
    instruction::{AccountMeta, Instruction},
    message::Message,
    packet::PACKET_DATA_SIZE,
    transaction::Transaction,
};
use solana_sdk_ids::system_program;

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use core::fmt::Write as _;
        let _ = write!(&mut output, "{:02x}", byte);
    }
    output
}

#[test]
fn rulebook_schedule_constants_encode_four_two_one_one_days() {
    assert_eq!(
        ORACLE_PLACEMENT_WINDOW_SECONDS,
        4 * ORACLE_CALENDAR_DAY_SECONDS
    );
    assert_eq!(ORACLE_KILL_WINDOW_SECONDS, 2 * ORACLE_CALENDAR_DAY_SECONDS);
    assert_eq!(
        ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS,
        ORACLE_CALENDAR_DAY_SECONDS
    );
    assert_eq!(ORACLE_OPENING_WINDOW_SECONDS, ORACLE_CALENDAR_DAY_SECONDS);
    assert_eq!(
        ORACLE_SCRAMBLE_WINDOW_SECONDS,
        ORACLE_PLACEMENT_WINDOW_SECONDS
            + ORACLE_KILL_WINDOW_SECONDS
            + ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS
    );
    assert_eq!(
        ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ORACLE_SCRAMBLE_WINDOW_SECONDS + ORACLE_OPENING_WINDOW_SECONDS
    );
}

#[test]
fn product_sku_chunk_has_stable_tag_190_layout_and_fits_a_two_signer_packet() {
    let params = ConfigureOracleProductSkuManifestParams {
        underlying_id: [0x11; 32],
        draft_nonce: 0x0102_0304_0506_0708,
        expected_start_index: 0x090a,
        sku_id_chunk: (0..MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS)
            .map(|index| [u8::try_from(index + 1).unwrap(); 32])
            .collect(),
    };
    let vault_instruction = VaultInstruction::ConfigureOracleProductSkuManifest {
        params: params.clone(),
    };
    let encoded = borsh::to_vec(&vault_instruction).expect("serialize packet-safe tag 190 chunk");

    assert_eq!(encoded[0], 190);
    assert_eq!(&encoded[1..33], &params.underlying_id);
    assert_eq!(&encoded[33..41], &params.draft_nonce.to_le_bytes());
    assert_eq!(&encoded[41..43], &params.expected_start_index.to_le_bytes());
    assert_eq!(
        &encoded[43..47],
        &u32::try_from(MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS)
            .unwrap()
            .to_le_bytes()
    );
    assert_eq!(encoded.len(), 1 + 32 + 8 + 2 + 4 + 16 * 32);
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).expect("decode packet-safe tag 190 chunk"),
        vault_instruction
    );

    let admin = Pubkey::new_unique();
    let oracle_authority = Pubkey::new_unique();
    let instruction = Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(admin, true),
            AccountMeta::new_readonly(oracle_authority, true),
            AccountMeta::new_readonly(Pubkey::new_unique(), false),
            AccountMeta::new(Pubkey::new_unique(), false),
            AccountMeta::new(Pubkey::new_unique(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: encoded,
    };
    let message = Message::new_with_blockhash(&[instruction], Some(&admin), &Hash::new_unique());
    let transaction = Transaction::new_unsigned(message);
    assert_eq!(transaction.message.header.num_required_signatures, 2);
    let transaction_bytes =
        bincode::serialize(&transaction).expect("serialize two-signature transaction");
    assert_eq!(transaction_bytes.len(), 959);
    assert!(
        transaction_bytes.len() <= PACKET_DATA_SIZE,
        "tag 190 chunk transaction is {} bytes, packet cap is {PACKET_DATA_SIZE}",
        transaction_bytes.len()
    );
}

#[test]
fn market_v2_and_pause_instructions_use_append_only_tags() {
    let init = VaultInstruction::InitMarketV2 {
        params: InitMarketV2Params {
            market_id: [0x11; 32],
            instrument: InstrumentDefinition {
                underlying_id: [0x22; 32],
                expiry_ts: 1_900_000_000,
                strike_price: 100_000_000,
                cap_price: 112_000_000,
                contract_size: 1_000_000,
                max_payout_per_contract: 12_000_000,
                kind: OptionKind::CallSpread,
                settlement: SettlementStyle::CashSettledMonthly,
            },
            params: MarketParameters {
                tick_size: 50_000,
                lot_size: 1,
                min_order_qty: 1,
                min_cancel_slots: 32,
                max_fills_per_instruction: 8,
            },
            collateral_mint: Pubkey::new_unique(),
        },
    };
    let create = VaultInstruction::CreateMarketContractMintV3;
    let pause = VaultInstruction::SetMarketPaused {
        params: SetMarketPausedParams { paused: true },
    };

    for (instruction, expected_tag) in [(init, 87_u8), (create, 203_u8), (pause, 89_u8)] {
        let encoded = borsh::to_vec(&instruction).expect("serialize V2 instruction");
        assert_eq!(encoded.first().copied(), Some(expected_tag));
        assert_eq!(
            VaultInstruction::try_from_slice(&encoded).expect("deserialize V2 instruction"),
            instruction
        );
    }
}

#[test]
fn unassigned_instruction_byte_uses_the_generic_invalid_instruction_path() {
    let unassigned_tag = u8::MAX;
    assert_eq!(VaultInstructionTag::from_byte(unassigned_tag), None);
    assert!(VaultInstruction::try_from_slice(&[unassigned_tag, 0xff]).is_err());
    assert_eq!(
        light_token_minter::process_instruction(
            &light_token_minter::id(),
            &[],
            &[unassigned_tag, 0xff],
        ),
        Err(VaultError::InvalidInstructionData.into()),
    );
}

fn assert_v2_instruction_round_trip(instruction: VaultInstruction, expected_tag: u8) {
    let encoded = borsh::to_vec(&instruction).expect("serialize V2 instruction");
    assert_eq!(encoded.first().copied(), Some(expected_tag));
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).expect("deserialize V2 instruction"),
        instruction
    );
}

#[test]
fn current_account_list_instruction_payload_is_stable() {
    assert_v2_instruction_round_trip(
        VaultInstruction::UpsertMarketPageV2 {
            params: UpsertMarketPageParams {
                page: CompressedMarketPageLeaf::default(),
            },
            proof: Box::default(),
            new_page_output: None,
            existing_page: None,
        },
        96,
    );
}
#[test]
fn governed_settlement_signer_tags_and_payloads_are_append_only() {
    let mut signers = [Pubkey::default(); 8];
    for (index, signer) in signers.iter_mut().take(5).enumerate() {
        *signer = Pubkey::new_from_array([(index + 1) as u8; 32]);
    }
    let init = InitializeSettlementSignerRegistryParams {
        signer_set_version: 1,
        threshold: 3,
        signer_count: 5,
        signers,
        rotation_delay_slots: 216_000,
        recovery_authority: Pubkey::new_from_array([9; 32]),
    };
    assert_v2_instruction_round_trip(
        VaultInstruction::InitializeSettlementSignerRegistry { params: init },
        90,
    );
    let rotation = ProposeSettlementSignerRotationParams {
        target_version: 2,
        threshold: 3,
        signer_count: 5,
        signers,
        rotation_delay_slots: 216_000,
        activate_after_slot: 1_000_000,
    };
    assert_v2_instruction_round_trip(
        VaultInstruction::ProposeSettlementSignerRotation {
            params: rotation.clone(),
        },
        91,
    );
    assert_v2_instruction_round_trip(VaultInstruction::ActivateSettlementSignerRotation, 92);
    assert_v2_instruction_round_trip(VaultInstruction::CancelSettlementSignerRotation, 93);
    assert_v2_instruction_round_trip(
        VaultInstruction::ProposeEmergencySettlementSignerRecovery { params: rotation },
        94,
    );
    assert!(VaultInstruction::try_from_slice(&[95, 0xff]).is_err());
    assert_v2_instruction_round_trip(
        VaultInstruction::RotateVaultAuthoritiesV2 {
            params: RotateVaultAuthoritiesV2Params {
                new_admin: Pubkey::new_from_array([41; 32]),
                new_oracle_authority: Pubkey::new_from_array([42; 32]),
            },
        },
        109,
    );
    assert_v2_instruction_round_trip(
        VaultInstruction::ConfigureOracleEconomicsTemplateV2 {
            params: ConfigureOracleEconomicsTemplateV2Params {
                expected_config_version: 7,
                economics: OracleEconomicParams::default(),
            },
        },
        110,
    );
    assert_eq!(VaultInstructionTag::from_byte(112), None);
    assert_v2_instruction_round_trip(
        VaultInstruction::AccumulateOracleSettlementSourceBucket {
            params: AccumulateOracleSettlementSourceBucketParams {
                bucket_id: [0x62; 32],
                finalize_collection: true,
            },
        },
        113,
    );
    assert_eq!(VaultInstructionTag::from_byte(114), None);
    assert_eq!(VaultInstructionTag::from_byte(115), None);
    assert_v2_instruction_round_trip(
        VaultInstruction::UpsertSettlementV3 {
            params: UpsertSettlementParams {
                settlement: sample_settlement(),
            },
            proof: Box::default(),
            new_settlement_output: None,
            existing_settlement: None,
        },
        116,
    );

    let bootstrap_oracle = Pubkey::new_from_array([0x80; 32]);
    let bootstrap = VaultInstruction::BootstrapVaultGovernanceV2 {
        params: BootstrapVaultGovernanceV2Params {
            new_oracle_authority: bootstrap_oracle,
        },
    };
    let bootstrap_bytes = borsh::to_vec(&bootstrap).expect("serialize governance bootstrap");
    let mut expected_bootstrap_bytes = vec![128];
    expected_bootstrap_bytes.extend_from_slice(bootstrap_oracle.as_ref());
    assert_eq!(bootstrap_bytes, expected_bootstrap_bytes);
    assert_eq!(
        VaultInstruction::try_from_slice(&bootstrap_bytes)
            .expect("deserialize governance bootstrap"),
        bootstrap
    );

    let activate_none = VaultInstruction::ActivateVaultV2 {
        params: ActivateVaultV2Params {
            expected_collateral_freeze_authority: None,
        },
    };
    assert_eq!(
        borsh::to_vec(&activate_none).expect("serialize governed vault activation"),
        vec![129, 0]
    );
    let freeze_authority = Pubkey::new_from_array([0x81; 32]);
    let activate_some = VaultInstruction::ActivateVaultV2 {
        params: ActivateVaultV2Params {
            expected_collateral_freeze_authority: Some(freeze_authority),
        },
    };
    let mut expected_activate_some = vec![129, 1];
    expected_activate_some.extend_from_slice(freeze_authority.as_ref());
    let activate_some_bytes =
        borsh::to_vec(&activate_some).expect("serialize governed vault activation policy");
    assert_eq!(activate_some_bytes, expected_activate_some);
    assert_eq!(
        VaultInstruction::try_from_slice(&activate_some_bytes)
            .expect("deserialize governed vault activation policy"),
        activate_some
    );
}

fn sample_settlement() -> CompressedSettlementLeaf {
    let mut underlying_id = [0u8; 32];
    underlying_id[..24].copy_from_slice(b"ram-standardized-baskets");

    CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month: Pubkey::new_from_array([0x42; 32]),
        recipe_hash: [0x24; 32],
        underlying_id,
        item_id: "ramx".to_string(),
        expiry_id: "APR26".to_string(),
        settlement_ts: 1_777_564_800,
        price_display_decimals: 2,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 0,
        observations: vec![],
        settlement_price_atomic: 10_625,
        source_uri: "https://oracle.example/spread/oracle/markets/ramx/APR26".to_string(),
        source_digest: [
            0x9a, 0xd7, 0xc6, 0x29, 0x25, 0x0e, 0x94, 0x6b, 0x52, 0xca, 0x74, 0x65, 0xe6, 0xa6,
            0x61, 0x44, 0xcf, 0x63, 0xe8, 0xb0, 0x63, 0xa9, 0x9a, 0xc6, 0x3f, 0xaa, 0x4a, 0x87,
            0xc5, 0x08, 0x31, 0xd3,
        ],
        base_oracle_atomic: 10_000,
        index_delta_bps: 625,
        submitted_by: Pubkey::new_unique(),
        submitted_slot: 42,
        signer_set_version: 1,
        signer_set_hash: [0x55; 32],
    }
}

#[test]
fn admin_assisted_withdraw_collateral_uses_append_only_tag_140() {
    let instruction = VaultInstruction::AdminAssistedWithdrawCollateral { amount: 42 };
    let encoded = borsh::to_vec(&instruction).expect("serialize admin-assisted withdrawal");

    assert_eq!(encoded, [vec![140], 42u64.to_le_bytes().to_vec()].concat());
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).expect("decode admin-assisted withdrawal"),
        instruction
    );
}

#[test]
fn update_config_tag_2_payload_order_remains_frozen() {
    let instruction = VaultInstruction::UpdateConfig {
        new_admin: Some(Pubkey::new_from_array([1; 32])),
        new_oracle_authority: None,
        new_usdc_mint: Some(Pubkey::new_from_array([3; 32])),
        new_vault_token_account: None,
        paused: Some(true),
    };
    let encoded = borsh::to_vec(&instruction).expect("serialize UpdateConfig");
    let mut expected = vec![2, 1];
    expected.extend_from_slice(&[1; 32]);
    expected.push(0);
    expected.push(1);
    expected.extend_from_slice(&[3; 32]);
    expected.push(0);
    expected.extend_from_slice(&[1, 1]);
    assert_eq!(encoded, expected, "tag 2 payload field order is frozen");
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded).expect("decode tag 2 fixture"),
        instruction
    );
}

#[test]
fn spread_oracle_economics_encode_current_emergency_controls() {
    let payload = borsh::to_vec(&OracleEconomicParams::default()).expect("serialize economics");

    assert_eq!(payload.len(), OracleEconomicParams::LEN);
    assert_eq!(payload.len(), 2 + 8 + 8);
    assert_eq!(
        OracleEconomicParams::default().emergency_supermajority_bps,
        6_000
    );
    assert_eq!(
        OracleEconomicParams::default().emergency_commit_window_slots,
        216_000
    );
    assert_eq!(
        OracleEconomicParams::default().emergency_reveal_window_slots,
        216_000
    );
}

#[test]
fn spread_oracle_opening_challenge_params_round_trip() {
    let canonical_locator_hash = [
        0x03, 0x4e, 0xd8, 0x0a, 0xf5, 0x6b, 0x51, 0x9d, 0xa3, 0x5d, 0xd7, 0x89, 0xef, 0x20, 0xca,
        0x25, 0xa0, 0x52, 0x96, 0xb7, 0x6d, 0xb9, 0xa6, 0xfd, 0xcc, 0xfc, 0xbb, 0xc0, 0x2e, 0x03,
        0x72, 0x06,
    ];
    let archive_url =
        "https://web.archive.org/web/20260831234640/https://example.com/source/3".to_string();
    let challenge = ChallengeOracleOpeningClaimParams {
        challenge_id: [11; 32],
        alternative_opening_state: 99_000_000,
        alternative_source_time: 1_788_220_000,
        bond: 10,
        canonical_locator_hash,
        source_definition_hash: [14; 32],
        archive_url: archive_url.clone(),
    };
    let resolve = ResolveOracleOpeningClaimChallengeParams {
        outcome: OracleOpeningChallengeOutcome::RuleReviewUnresolved,
    };
    let challenge_ix = VaultInstruction::ChallengeOracleOpeningClaimV2 {
        params: challenge.clone(),
    };
    let resolve_ix = VaultInstruction::ResolveOracleOpeningClaimChallengeV2 {
        params: resolve.clone(),
    };
    let encoded_challenge = borsh::to_vec(&challenge_ix).expect("serialize opening challenge ix");
    let encoded_resolve = borsh::to_vec(&resolve_ix).expect("serialize opening resolve ix");

    assert_eq!(
        borsh::to_vec(&challenge)
            .expect("serialize challenge params")
            .len(),
        32 + 8 + 8 + 8 + 32 + 32 + 4 + archive_url.len()
    );
    assert_eq!(
        borsh::to_vec(&resolve)
            .expect("serialize resolve params")
            .len(),
        1
    );
    assert_eq!(encoded_challenge.first().copied(), Some(163));
    assert_eq!(encoded_resolve.first().copied(), Some(164));
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded_challenge).expect("decode challenge ix"),
        challenge_ix
    );
    assert_eq!(
        VaultInstruction::try_from_slice(&encoded_resolve).expect("decode resolve ix"),
        resolve_ix
    );
}

#[test]
fn current_cash_update_completion_and_cleanup_use_tags_198_199_201_and_reject_202() {
    let archive_url =
        "https://web.archive.org/web/19700101000013/https://example.com/feed".to_string();
    let reveal = VaultInstruction::RevealOracleUpdateClaimV3 {
        params: RevealOracleUpdateClaimV3Params {
            claim_id: [1; 32],
            prior_state: 11,
            new_state: 12,
            source_time: 13,
            evidence_hash: [2; 32],
            archive_url: archive_url.clone(),
            secret_salt: [3; 32],
        },
    };
    let finalize = VaultInstruction::FinalizeOracleUpdateClaimV2 {
        params: FinalizeOracleUpdateClaimV2Params {
            outcome: OracleUpdateClaimOutcome::AcceptClaim,
            current_step: 13,
        },
    };
    let cancel_stale_update = VaultInstruction::CancelStaleOracleUpdateClaimV2;
    let reveal_bytes = borsh::to_vec(&reveal).expect("serialize tag 198 reveal");
    let finalize_bytes = borsh::to_vec(&finalize).expect("serialize tag 199 finalizer");
    let cancel_stale_update_bytes =
        borsh::to_vec(&cancel_stale_update).expect("serialize tag 201 stale update cleanup");

    assert_eq!(reveal_bytes[0], 198);
    assert_eq!(
        reveal_bytes.len(),
        1 + 32 + 8 + 8 + 8 + 32 + 4 + archive_url.len() + 32
    );
    assert_eq!(finalize_bytes[0], 199);
    assert_eq!(finalize_bytes.len(), 1 + 1 + 8);
    assert_eq!(cancel_stale_update_bytes, vec![201]);
    assert_eq!(
        VaultInstruction::try_from_slice(&reveal_bytes).expect("decode tag 198 reveal"),
        reveal
    );
    assert_eq!(
        VaultInstruction::try_from_slice(&finalize_bytes).expect("decode tag 199 finalizer"),
        finalize
    );
    assert_eq!(
        VaultInstruction::try_from_slice(&cancel_stale_update_bytes)
            .expect("decode tag 201 stale update cleanup"),
        cancel_stale_update
    );
    assert_eq!(
        VaultInstructionTag::from_byte(201),
        Some(VaultInstructionTag::CancelStaleOracleUpdateClaimV2)
    );
    assert_eq!(VaultInstructionTag::from_byte(202), None);
}

#[test]
fn unassigned_instruction_bytes_are_generically_invalid() {
    assert_eq!(VaultInstructionTag::from_byte(u8::MAX), None);
    assert!(VaultInstruction::try_from_slice(&[u8::MAX]).is_err());
}

#[test]
fn print_upsert_settlement_params_borsh_layout() {
    let params = UpsertSettlementParams {
        settlement: sample_settlement(),
    };
    let payload = borsh::to_vec(&params).expect("serialize params");

    println!("settlement_payload_len={}", payload.len());
    println!("settlement_payload_hex={}", bytes_to_hex(&payload));
}
