use borsh::{BorshDeserialize, BorshSerialize};

use crate::fixed_codec::{FixedStateEncode, ReferenceBorsh};

use super::{
    CompressedMarketPageExpiry, CompressedMarketPageLeaf, CompressedSettlementLeaf,
    InstrumentDefinition, Market, MarketMintAccounting, MarketParameters,
    OracleActiveWeightManifest, OracleBucketMedianState, OracleChallengeStatus,
    OracleEconomicParams, OracleEconomicsConfig, OracleEmergencyDisputeV3,
    OracleEmergencyVoteRecordV3, OracleEscrowDisposition, OracleMajorTokenConfig,
    OracleMaturityLadderRegistry, OracleMonthState, OracleOpeningClaim,
    OracleOpeningClaimChallenge, OracleOpeningClaimStatus, OraclePlayerLedger,
    OracleProductSkuDraft, OracleProductSkuManifest, OracleRecipeWeightManifest,
    OracleRewardFunnel, OracleSambaEmergencyPot, OracleSambaVoteSettlementReceipt,
    OracleSambaWinningVote, OracleSettlementSourceManifest, OracleSkuCoverageManifest,
    OracleSkuCoverageRecord, OracleSourceChallenge, OracleSourceChallengeGuard,
    OracleSourceObservations, OracleSourceState, OracleStakeActivation, OracleStakingPool,
    OracleSupportPosition, OracleTreasuryState, OracleUnstakeRequest, OracleUpdateChallenge,
    OracleUpdateChallengeGuard, OracleUpdateClaimData, OracleUpdateClaimV2,
    OracleUsdcRewardReceipt, OracleUsdcRewardRegistration, OracleUsdcRewardSchedule,
    OracleUsdcRewardVault, OracleUsdcSkuPool, OracleUsdcSourceReward, PositionRecord,
    SettlementComputation, SettlementObservation, SettlementRecordV2, SettlementSignerRegistry,
    SettlementSignerSet, UserCollateral, VaultConfig,
};
use solana_program::{hash::hashv, pubkey::Pubkey};

#[test]
fn current_fixed_state_allocations_match_their_maximum_borsh_payloads() {
    let vault = VaultConfig {
        is_initialized: true,
        bump: 1,
        admin: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        usdc_mint: Pubkey::new_unique(),
        vault_token_account: Pubkey::new_unique(),
        paused: true,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    };
    let month = OracleMonthState {
        settlement_record: Some(Pubkey::new_unique()),
        ..OracleMonthState::default()
    };
    let market = Market {
        long_contract_mint: Some(Pubkey::new_unique()),
        ..Market::default()
    };

    assert_eq!(borsh::to_vec(&vault).unwrap().len(), VaultConfig::LEN);
    assert_eq!(Market::LEN, 285);
    assert_eq!(borsh::to_vec(&market).unwrap().len(), Market::LEN);
    assert_eq!(
        borsh::to_vec(&OracleEconomicsConfig::default())
            .unwrap()
            .len(),
        OracleEconomicsConfig::LEN
    );
    assert_eq!(borsh::to_vec(&month).unwrap().len(), OracleMonthState::LEN);
    assert!(
        borsh::to_vec(&OracleRecipeWeightManifest::default())
            .unwrap()
            .len()
            <= OracleRecipeWeightManifest::LEN
    );
    assert!(
        borsh::to_vec(&OracleActiveWeightManifest::default())
            .unwrap()
            .len()
            <= OracleActiveWeightManifest::LEN
    );
    assert!(
        borsh::to_vec(&OracleUpdateClaimV2::default())
            .unwrap()
            .len()
            <= OracleUpdateClaimV2::LEN
    );
}

fn assert_fixed_codec_matches_borsh<T>(value: T)
where
    T: BorshSerialize
        + BorshDeserialize
        + FixedStateEncode
        + ReferenceBorsh
        + std::fmt::Debug
        + PartialEq,
{
    let encoded = borsh::to_vec(&value).expect("serialize fixed account");
    assert_eq!(encoded, value.reference_borsh_bytes());
    let mut direct = vec![0; value.maximum_encoded_len()];
    value.encode_fixed(&mut direct);
    assert_eq!(&direct[..encoded.len()], encoded);
    assert!(direct[encoded.len()..].iter().all(|byte| *byte == 0));
    assert_eq!(
        T::try_from_slice(&encoded).unwrap_or_else(|error| {
            panic!(
                "decode fixed account {} from slice: {error}",
                std::any::type_name::<T>()
            )
        }),
        value
    );
    let mut reader = std::io::Cursor::new(encoded);
    assert_eq!(
        T::deserialize_reader(&mut reader).expect("decode fixed account from reader"),
        value
    );
}

#[test]
fn fixed_account_codecs_are_byte_identical_to_borsh() {
    assert_fixed_codec_matches_borsh(VaultConfig {
        is_initialized: true,
        bump: 7,
        admin: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        usdc_mint: Pubkey::new_unique(),
        vault_token_account: Pubkey::new_unique(),
        paused: true,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    });
    assert_fixed_codec_matches_borsh(OracleSourceState::default());
    assert_fixed_codec_matches_borsh(OracleSourceObservations::default());
    assert_fixed_codec_matches_borsh(OracleSourceChallenge::default());
    assert_fixed_codec_matches_borsh(OracleRecipeWeightManifest::default());
    assert_fixed_codec_matches_borsh(OracleSettlementSourceManifest::default());
    assert_fixed_codec_matches_borsh(OracleActiveWeightManifest::default());
    assert_fixed_codec_matches_borsh(OracleBucketMedianState::default());
    assert_fixed_codec_matches_borsh(OracleUsdcSkuPool::default());
    assert_fixed_codec_matches_borsh(OracleUsdcSourceReward::default());
    assert_fixed_codec_matches_borsh(OracleUsdcRewardSchedule::default());
    assert_fixed_codec_matches_borsh(OracleEmergencyDisputeV3::default());
    assert_fixed_codec_matches_borsh(OracleSambaEmergencyPot::default());
    assert_fixed_codec_matches_borsh(OracleEconomicParams::default());
    assert_fixed_codec_matches_borsh(OracleEmergencyVoteRecordV3::default());
    assert_fixed_codec_matches_borsh(OracleUpdateChallenge::default());
    assert_fixed_codec_matches_borsh(OracleUpdateClaimData::default());
    assert_fixed_codec_matches_borsh(OracleUpdateChallengeGuard::default());
    assert_fixed_codec_matches_borsh(OracleSourceChallengeGuard::default());
    assert_fixed_codec_matches_borsh(OracleSambaVoteSettlementReceipt::default());
    assert_fixed_codec_matches_borsh(OracleRewardFunnel::default());
    assert_fixed_codec_matches_borsh(OracleStakingPool::default());
    assert_fixed_codec_matches_borsh(OracleUsdcRewardRegistration::default());
    assert_fixed_codec_matches_borsh(OracleSambaWinningVote::default());
    assert_fixed_codec_matches_borsh(OracleUsdcRewardReceipt::default());
    assert_fixed_codec_matches_borsh(SettlementRecordV2::default());
    assert_fixed_codec_matches_borsh(OracleSupportPosition::default());
    assert_fixed_codec_matches_borsh(OracleSkuCoverageManifest::default());
    assert_fixed_codec_matches_borsh(SettlementSignerRegistry::default());
    assert_fixed_codec_matches_borsh(PositionRecord::default());
    assert_fixed_codec_matches_borsh(OracleProductSkuManifest::default());
    assert_fixed_codec_matches_borsh(OracleUsdcRewardVault::default());
    assert_fixed_codec_matches_borsh(OracleSkuCoverageRecord::default());
    assert_fixed_codec_matches_borsh(OracleMaturityLadderRegistry::default());
    assert_fixed_codec_matches_borsh(OracleUpdateClaimV2::default());
    assert_fixed_codec_matches_borsh(OracleUnstakeRequest::default());
    assert_fixed_codec_matches_borsh(OracleStakeActivation::default());
    assert_fixed_codec_matches_borsh(InstrumentDefinition::default());
    assert_fixed_codec_matches_borsh(OraclePlayerLedger::default());
    assert_fixed_codec_matches_borsh(MarketParameters::default());
    assert_fixed_codec_matches_borsh(UserCollateral::default());
    assert_fixed_codec_matches_borsh(OracleTreasuryState::default());
    assert_fixed_codec_matches_borsh(MarketMintAccounting::default());
    assert_fixed_codec_matches_borsh(OracleEconomicsConfig::default());
    assert_fixed_codec_matches_borsh(OracleMajorTokenConfig::default());
    assert_fixed_codec_matches_borsh(SettlementSignerSet::default());
    assert_fixed_codec_matches_borsh(OracleProductSkuDraft::default());
    assert_fixed_codec_matches_borsh(SettlementObservation::default());
    for long_contract_mint in [None, Some(Pubkey::new_unique())] {
        assert_fixed_codec_matches_borsh(Market {
            long_contract_mint,
            ..Market::default()
        });
    }
    for settlement_record in [None, Some(Pubkey::new_unique())] {
        assert_fixed_codec_matches_borsh(OracleMonthState {
            settlement_record,
            ..OracleMonthState::default()
        });
    }
    assert_fixed_codec_matches_borsh(OracleOpeningClaim {
        is_initialized: true,
        bump: 19,
        month: Pubkey::new_unique(),
        source: Pubkey::new_unique(),
        source_id: [1; 32],
        attempt: 23,
        claimant: Pubkey::new_unique(),
        opening_state: 29,
        source_time: 31,
        stake: 37,
        canonical_locator_hash: [2; 32],
        source_definition_hash: [3; 32],
        evidence_hash: [4; 32],
        archive_url_hash: [5; 32],
        submitted_slot: 41,
        challenge_deadline_slot: 43,
        status: OracleOpeningClaimStatus::Accepted,
        escrow_disposition: OracleEscrowDisposition::Transferred,
    });
    assert_fixed_codec_matches_borsh(OracleOpeningClaimChallenge {
        is_initialized: true,
        bump: 47,
        month: Pubkey::new_unique(),
        challenge_id: [6; 32],
        claim: Pubkey::new_unique(),
        claim_attempt: 53,
        source: Pubkey::new_unique(),
        source_id: [7; 32],
        challenger: Pubkey::new_unique(),
        alternative_opening_state: 59,
        alternative_source_time: 61,
        bond: 67,
        required_bond: 71,
        status: OracleChallengeStatus::Accepted,
        canonical_locator_hash: [8; 32],
        source_definition_hash: [9; 32],
        evidence_hash: [10; 32],
        archive_url_hash: [11; 32],
        rule_review_slot: 73,
        escrow_disposition: OracleEscrowDisposition::Slashed,
        account_discriminator: OracleOpeningClaimChallenge::ACCOUNT_DISCRIMINATOR,
        account_version: OracleOpeningClaimChallenge::ACCOUNT_VERSION,
        emergency_snapshot_total_major_tokens: 79,
    });
}

#[test]
fn fixed_account_codecs_reject_invalid_booleans_and_truncation() {
    let mut invalid_bool = borsh::to_vec(&OracleUsdcSkuPool::default()).unwrap();
    invalid_bool[0] = 2;
    assert!(OracleUsdcSkuPool::try_from_slice(&invalid_bool).is_err());
}

#[test]
fn current_economic_defaults_contain_only_emergency_governance_windows() {
    assert_eq!(
        OracleEconomicParams::default(),
        OracleEconomicParams {
            emergency_supermajority_bps: 6_000,
            emergency_commit_window_slots: 216_000,
            emergency_reveal_window_slots: 216_000,
        }
    );
    assert_eq!(
        borsh::to_vec(&OracleEconomicParams::default())
            .unwrap()
            .len(),
        OracleEconomicParams::LEN
    );
}

#[test]
fn oracle_usdc_state_allocations_cover_their_borsh_payloads() {
    let cases = [
        (
            "reward vault",
            borsh::to_vec(&OracleUsdcRewardVault::default()).expect("serialize reward vault"),
            OracleUsdcRewardVault::LEN,
        ),
        (
            "reward schedule",
            borsh::to_vec(&OracleUsdcRewardSchedule::default()).expect("serialize reward schedule"),
            OracleUsdcRewardSchedule::LEN,
        ),
        (
            "SKU pool",
            borsh::to_vec(&OracleUsdcSkuPool::default()).expect("serialize SKU pool"),
            OracleUsdcSkuPool::LEN,
        ),
        (
            "source reward",
            borsh::to_vec(&OracleUsdcSourceReward::default()).expect("serialize source reward"),
            OracleUsdcSourceReward::LEN,
        ),
        (
            "canonical source",
            borsh::to_vec(&OracleSourceState::default()).expect("serialize canonical source"),
            OracleSourceState::LEN,
        ),
        (
            "oracle month",
            borsh::to_vec(&OracleMonthState::default()).expect("serialize oracle month"),
            OracleMonthState::LEN,
        ),
        (
            "product SKU draft",
            borsh::to_vec(&OracleProductSkuDraft::default()).expect("serialize product SKU draft"),
            OracleProductSkuDraft::LEN,
        ),
        (
            "product SKU manifest",
            borsh::to_vec(&OracleProductSkuManifest::default())
                .expect("serialize product SKU manifest"),
            OracleProductSkuManifest::LEN,
        ),
        (
            "maturity ladder registry",
            borsh::to_vec(&OracleMaturityLadderRegistry::default())
                .expect("serialize maturity ladder registry"),
            OracleMaturityLadderRegistry::LEN,
        ),
        (
            "support position",
            borsh::to_vec(&OracleSupportPosition::default()).expect("serialize support position"),
            OracleSupportPosition::LEN,
        ),
        (
            "source challenge",
            borsh::to_vec(&OracleSourceChallenge::default()).expect("serialize source challenge"),
            OracleSourceChallenge::LEN,
        ),
        (
            "source challenge guard",
            borsh::to_vec(&OracleSourceChallengeGuard::default())
                .expect("serialize source challenge guard"),
            OracleSourceChallengeGuard::LEN,
        ),
        (
            "opening claim",
            borsh::to_vec(&OracleOpeningClaim::default()).expect("serialize opening claim"),
            OracleOpeningClaim::LEN,
        ),
        (
            "opening challenge",
            borsh::to_vec(&OracleOpeningClaimChallenge::default())
                .expect("serialize opening challenge"),
            OracleOpeningClaimChallenge::LEN,
        ),
        (
            "current update claim",
            borsh::to_vec(&OracleUpdateClaimV2::default()).expect("serialize current update claim"),
            OracleUpdateClaimV2::LEN,
        ),
        (
            "update challenge",
            borsh::to_vec(&OracleUpdateChallenge::default()).expect("serialize update challenge"),
            OracleUpdateChallenge::LEN,
        ),
        (
            "update challenge guard",
            borsh::to_vec(&OracleUpdateChallengeGuard::default())
                .expect("serialize update challenge guard"),
            OracleUpdateChallengeGuard::LEN,
        ),
        (
            "current emergency dispute",
            borsh::to_vec(&OracleEmergencyDisputeV3::default())
                .expect("serialize current emergency dispute"),
            OracleEmergencyDisputeV3::LEN,
        ),
        (
            "current emergency vote",
            borsh::to_vec(&OracleEmergencyVoteRecordV3::default())
                .expect("serialize current emergency vote"),
            OracleEmergencyVoteRecordV3::LEN,
        ),
        (
            "isolated sAMBA emergency pot",
            borsh::to_vec(&OracleSambaEmergencyPot::default())
                .expect("serialize isolated sAMBA emergency pot"),
            OracleSambaEmergencyPot::LEN,
        ),
        (
            "winning sAMBA vote registration",
            borsh::to_vec(&OracleSambaWinningVote::default())
                .expect("serialize winning sAMBA vote registration"),
            OracleSambaWinningVote::LEN,
        ),
        (
            "sAMBA vote settlement receipt",
            borsh::to_vec(&OracleSambaVoteSettlementReceipt::default())
                .expect("serialize sAMBA vote settlement receipt"),
            OracleSambaVoteSettlementReceipt::LEN,
        ),
        (
            "reward registration",
            borsh::to_vec(&OracleUsdcRewardRegistration::default())
                .expect("serialize reward registration"),
            OracleUsdcRewardRegistration::LEN,
        ),
        (
            "reward receipt",
            borsh::to_vec(&OracleUsdcRewardReceipt::default()).expect("serialize reward receipt"),
            OracleUsdcRewardReceipt::LEN,
        ),
    ];

    for (label, payload, allocation) in cases {
        assert!(
            payload.len() <= allocation,
            "{label} serializes to {} bytes but allocates only {allocation}",
            payload.len()
        );
    }
}

#[test]
fn product_sku_draft_has_one_exact_fixed_frontier_allocation() {
    for expected_sku_count in [
        1u16,
        crate::constants::NANDX_ORACLE_PRODUCT_SKU_COUNT,
        crate::constants::RAMX_ORACLE_PRODUCT_SKU_COUNT,
        crate::constants::MAX_ORACLE_REQUIRED_SKUS,
    ] {
        let mut draft = OracleProductSkuDraft {
            is_initialized: true,
            account_discriminator: OracleProductSkuDraft::ACCOUNT_DISCRIMINATOR,
            account_version: OracleProductSkuDraft::ACCOUNT_VERSION,
            expected_sku_count,
            appended_sku_count: expected_sku_count,
            frontier_mask: expected_sku_count,
            last_sku_id: [7; 32],
            ..OracleProductSkuDraft::default()
        };
        for (level, node) in draft.merkle_frontier.iter_mut().enumerate() {
            if draft.frontier_mask & (1u16 << level) != 0 {
                *node = [7; 32];
            }
        }
        assert!(draft.has_canonical_layout());
        assert_eq!(
            borsh::to_vec(&draft)
                .expect("serialize fixed-frontier product SKU draft")
                .len(),
            OracleProductSkuDraft::LEN
        );
    }
}

#[test]
fn product_sku_draft_rejects_noncanonical_frontier_occupancy() {
    let mut draft = OracleProductSkuDraft {
        is_initialized: true,
        account_discriminator: OracleProductSkuDraft::ACCOUNT_DISCRIMINATOR,
        account_version: OracleProductSkuDraft::ACCOUNT_VERSION,
        expected_sku_count: crate::constants::RAMX_ORACLE_PRODUCT_SKU_COUNT,
        appended_sku_count: 2,
        frontier_mask: 2,
        last_sku_id: [2; 32],
        ..OracleProductSkuDraft::default()
    };
    draft.merkle_frontier[1] = [9; 32];
    assert!(draft.has_canonical_layout());

    let mut wrong_mask = draft.clone();
    wrong_mask.frontier_mask = 1;
    assert!(!wrong_mask.has_canonical_layout());
    let mut stray_node = draft.clone();
    stray_node.merkle_frontier[0] = [9; 32];
    assert!(!stray_node.has_canonical_layout());
    let mut missing_last = draft.clone();
    missing_last.last_sku_id = [0; 32];
    assert!(!missing_last.has_canonical_layout());

    let encoded = borsh::to_vec(&draft).expect("serialize fixed-frontier product SKU draft");
    assert_eq!(encoded.len(), OracleProductSkuDraft::LEN);
    assert!(OracleProductSkuDraft::try_from_slice(&encoded[..encoded.len() - 1]).is_err());
}

#[test]
fn compressed_display_slice_codecs_match_borsh_for_all_single_byte_changes() {
    fn decode_market(mut data: &[u8]) -> Result<CompressedMarketPageLeaf, ()> {
        let decoded = CompressedMarketPageLeaf::deserialize_slice(&mut data).map_err(|_| ())?;
        if data.is_empty() {
            Ok(decoded)
        } else {
            Err(())
        }
    }

    fn decode_settlement(mut data: &[u8]) -> Result<CompressedSettlementLeaf, ()> {
        let decoded = CompressedSettlementLeaf::deserialize_slice(&mut data).map_err(|_| ())?;
        if data.is_empty() {
            Ok(decoded)
        } else {
            Err(())
        }
    }

    let market = CompressedMarketPageLeaf {
        underlying_id: [1; 32],
        item_id: "ramx".into(),
        name: "RAMx".into(),
        symbol: "RAMX".into(),
        title: "Oracle-Settled Monthly Options".into(),
        subtitle: "On-chain".into(),
        info_href: "/info/ramx".into(),
        page_title: "RAMx Options Desk".into(),
        meta_description: "RAMx markets".into(),
        price_display_decimals: 2,
        qty_display_decimals: 3,
        quote_display_decimals: 6,
        expiries: vec![CompressedMarketPageExpiry {
            id: "APR26".into(),
            label: "Apr 2026".into(),
            settlement_ts: 1_777_564_800,
            oracle_fix_interval_hours: 24,
            fixes_remaining: 4,
            market_alpha_bps: 625,
            base_oracle_atomic: 10_000,
            absolute_risk_cap_usd: 1_000_000,
            position_cap_usd: 10_000,
        }],
        active: true,
    };
    let settlement = CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month: Pubkey::new_from_array([2; 32]),
        recipe_hash: [3; 32],
        underlying_id: [4; 32],
        item_id: "ramx".into(),
        expiry_id: "APR26".into(),
        settlement_ts: 1_777_564_800,
        price_display_decimals: 2,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 5,
        observations: vec![
            SettlementObservation {
                observed_at_ts: 1_777_478_400,
                price_atomic: 10_500,
            },
            SettlementObservation {
                observed_at_ts: 1_777_564_800,
                price_atomic: 10_625,
            },
        ],
        settlement_price_atomic: 10_563,
        source_uri: "https://oracle.example/spread/oracle/markets/ramx/APR26".into(),
        source_digest: [5; 32],
        base_oracle_atomic: 10_000,
        index_delta_bps: 625,
        submitted_by: Pubkey::new_from_array([6; 32]),
        submitted_slot: 77,
        signer_set_version: 2,
        signer_set_hash: [7; 32],
    };

    let market_bytes = market.try_to_vec().unwrap();
    let settlement_bytes = settlement.try_to_vec().unwrap();
    assert_eq!(decode_market(&market_bytes), Ok(market));
    assert_eq!(decode_settlement(&settlement_bytes), Ok(settlement));

    for end in 0..market_bytes.len() {
        assert_eq!(
            decode_market(&market_bytes[..end]),
            CompressedMarketPageLeaf::try_from_slice(&market_bytes[..end]).map_err(|_| ())
        );
    }
    for end in 0..settlement_bytes.len() {
        assert_eq!(
            decode_settlement(&settlement_bytes[..end]),
            CompressedSettlementLeaf::try_from_slice(&settlement_bytes[..end]).map_err(|_| ())
        );
    }

    for (bytes, is_market) in [(&market_bytes, true), (&settlement_bytes, false)] {
        for offset in 0..bytes.len() {
            for replacement in [0, 1, 0x7f, 0xff] {
                let mut changed = bytes.clone();
                changed[offset] = replacement;
                if is_market {
                    assert_eq!(
                        decode_market(&changed),
                        CompressedMarketPageLeaf::try_from_slice(&changed).map_err(|_| ())
                    );
                } else {
                    assert_eq!(
                        decode_settlement(&changed),
                        CompressedSettlementLeaf::try_from_slice(&changed).map_err(|_| ())
                    );
                }
            }
        }
    }
}

#[test]
fn settlement_signing_message_matches_oracle_serializer_fixture() {
    let mut underlying_id = [0u8; 32];
    underlying_id[..24].copy_from_slice(b"ram-standardized-baskets");
    let settlement = CompressedSettlementLeaf {
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
        submitted_by: Pubkey::default(),
        submitted_slot: 0,
        signer_set_version: 1,
        signer_set_hash: [0x55; 32],
    };

    let message = settlement.signing_message().expect("message");
    assert_eq!(
        message,
        settlement
            .to_signed_payload()
            .try_to_vec()
            .expect("reference signed payload")
    );
    assert_eq!(message.len(), 314);
    assert_eq!(
        hashv(&[message.as_slice()]).to_bytes(),
        [
            0x6e, 0xad, 0xdd, 0x8c, 0x5c, 0x00, 0x51, 0x45, 0x92, 0x0e, 0x1b, 0x2b, 0xf1, 0xe0,
            0xf6, 0xe1, 0xd1, 0xd9, 0x71, 0x6c, 0xdc, 0xe6, 0x1b, 0x44, 0x0c, 0xb8, 0xe5, 0x99,
            0xa1, 0xa8, 0x94, 0xe4,
        ],
    );
}

#[test]
fn spread_oracle_index_delta_price_uses_base_and_signed_delta() {
    let settlement = CompressedSettlementLeaf {
        schema_version: CompressedSettlementLeaf::CURRENT_SCHEMA_VERSION,
        oracle_month: Pubkey::new_from_array([0x42; 32]),
        recipe_hash: [0x24; 32],
        underlying_id: [9; 32],
        item_id: "ramx".to_string(),
        expiry_id: "APR26".to_string(),
        settlement_ts: 1_777_564_800,
        price_display_decimals: 2,
        computation: SettlementComputation::SpreadOracleIndexDelta,
        trailing_window_days: 0,
        observations: vec![],
        settlement_price_atomic: 10_625,
        source_uri: "https://oracle.example/spread/oracle/markets/ramx/APR26".to_string(),
        source_digest: [0x9a; 32],
        base_oracle_atomic: 10_000,
        index_delta_bps: 625,
        submitted_by: Pubkey::default(),
        submitted_slot: 0,
        signer_set_version: 1,
        signer_set_hash: [0x55; 32],
    };

    assert_eq!(
        settlement
            .computed_spread_oracle_index_delta_price_atomic()
            .expect("computed spread oracle price"),
        10_625
    );
}
