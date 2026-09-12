use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use super::decode_oracle_month as decode_month_inner;
use super::{FixedStateEncode, ReferenceBorsh};
use crate::error::VaultError;
use crate::state::{
    OracleMonthState, OraclePhase, OracleSettlementStatus, WriterAuctionV1, WriterBidIndexRecordV1,
    WriterBidIndexV1, WriterBidV1, WriterCloseRequestV1, WriterPolicyRegistryV1,
    WriterPolicySnapshotV1, WriterSeriesBookV1, WriterSeriesRecordV1, WriterSettlementGroupV1,
    WriterSleeveV1, WRITER_BID_STORAGE_CAPACITY, WRITER_LIVE_SERIES_LIMIT,
    WRITER_SERIES_STORAGE_CAPACITY,
};

fn encoded_month(mut month: OracleMonthState) -> Vec<u8> {
    let mut data = month.try_to_vec().unwrap();
    data.resize(OracleMonthState::LEN, 0);
    // Keep ownership local so callers cannot accidentally compare against a later mutation.
    month.accepted_cash_update_count = month.accepted_cash_update_count.wrapping_add(1);
    data
}

fn decode_oracle_month(data: &[u8]) -> Result<OracleMonthState, VaultError> {
    decode_month_inner(data, VaultError::InvalidOracleMonthAccount)
}

#[test]
fn current_month_wire_layout_preserves_the_live_299_byte_shape() {
    let month = OracleMonthState {
        is_initialized: true,
        account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
        account_version: OracleMonthState::ACCOUNT_VERSION,
        phase: OraclePhase::SourceSubmission,
        effective_weight_total_bps: 0x1234,
        weight_manifest_hash: [0x51; 32],
        candidate_count_tracking_version: OracleMonthState::CANDIDATE_COUNT_TRACKING_VERSION,
        active_weight_initialization_version:
            OracleMonthState::ACTIVE_WEIGHT_INITIALIZATION_VERSION,
        active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
        active_weight_group_count: 0x5678,
        active_weight_manifest_hash: [0x91; 32],
        schedule_version: OracleMonthState::SKU_COVERAGE_SCHEDULE_VERSION,
        work_reward_currency_version: OracleMonthState::WORK_REWARD_CURRENCY_USDC_V1,
        accepted_cash_update_count: 0xa1b2_c3d4,
        ..OracleMonthState::default()
    };
    let serialized = month.try_to_vec().unwrap();

    // A None settlement record serializes to 267 bytes and occupies the canonical 299-byte
    // account with 32 bytes of zero padding. These offsets are the already-live current ABI.
    assert_eq!(serialized.len(), 267);
    assert_eq!(&serialized[190..192], &0x1234u16.to_le_bytes());
    assert_eq!(&serialized[192..224], &[0x51; 32]);
    assert_eq!(serialized[224], 1);
    assert_eq!(serialized[225], 1);
    assert_eq!(serialized[226], 2);
    assert_eq!(&serialized[227..229], &0x5678u16.to_le_bytes());
    assert_eq!(&serialized[229..261], &[0x91; 32]);
    assert_eq!(serialized[261], 2);
    assert_eq!(serialized[262], 1);
    assert_eq!(&serialized[263..267], &0xa1b2_c3d4u32.to_le_bytes());

    let account_data = encoded_month(month.clone());
    assert_eq!(account_data.len(), OracleMonthState::LEN);
    assert!(account_data[267..].iter().all(|byte| *byte == 0));
    let decoded = decode_oracle_month(&account_data).unwrap();
    assert_eq!(decoded, month);
    assert!(decoded.has_current_layout());
}

#[test]
fn month_decoder_matches_borsh_for_maximum_and_padded_options() {
    for settlement_record in [None, Some(Pubkey::new_unique())] {
        let month = OracleMonthState {
            is_initialized: true,
            bump: 9,
            phase: OraclePhase::SourceSubmission,
            settlement_status: OracleSettlementStatus::Provisional,
            settlement_record,
            recipe_hash: [3; 32],
            weight_manifest_hash: [4; 32],
            active_weight_manifest_hash: [5; 32],
            accepted_cash_update_count: 77,
            ..OracleMonthState::default()
        };
        assert_eq!(
            decode_oracle_month(&encoded_month(month.clone())),
            Ok(month)
        );
    }
}

#[test]
fn month_decoder_rejects_invalid_borsh_tags_and_nonzero_padding() {
    let mut invalid_bool = encoded_month(OracleMonthState::default());
    invalid_bool[0] = 2;
    assert!(decode_oracle_month(&invalid_bool).is_err());

    let mut invalid_enum = encoded_month(OracleMonthState::default());
    invalid_enum[86] = 7;
    assert!(decode_oracle_month(&invalid_enum).is_err());

    let mut nonzero_padding = encoded_month(OracleMonthState::default());
    *nonzero_padding.last_mut().unwrap() = 1;
    assert!(decode_oracle_month(&nonzero_padding).is_err());
}

macro_rules! assert_writer_account_codec {
    ($type:ty, $value:expr, $length:expr) => {{
        let value: $type = $value;
        let encoded = value.try_to_vec().expect("writer state serialization");
        assert_eq!(encoded.len(), $length);
        assert_eq!(encoded, value.reference_borsh_bytes());

        let mut direct = vec![0u8; $length];
        value.encode_fixed(&mut direct);
        assert_eq!(direct, encoded);
        let decoded = <$type>::try_from_slice(&direct).expect("writer state deserialization");
        assert_eq!(decoded, value);
    }};
}

#[test]
fn writer_account_codecs_freeze_every_v1_byte_length() {
    assert_writer_account_codec!(
        WriterPolicyRegistryV1,
        WriterPolicyRegistryV1::default(),
        WriterPolicyRegistryV1::LEN
    );
    assert_writer_account_codec!(
        WriterPolicySnapshotV1,
        WriterPolicySnapshotV1::default(),
        WriterPolicySnapshotV1::LEN
    );
    assert_writer_account_codec!(
        WriterSettlementGroupV1,
        WriterSettlementGroupV1::default(),
        WriterSettlementGroupV1::LEN
    );
    assert_writer_account_codec!(
        WriterSleeveV1,
        WriterSleeveV1 {
            active_auction: Some(Pubkey::new_unique()),
            active_close_request: Some(Pubkey::new_unique()),
            ..WriterSleeveV1::default()
        },
        WriterSleeveV1::LEN
    );
    assert_writer_account_codec!(
        WriterSeriesBookV1,
        WriterSeriesBookV1::default(),
        WriterSeriesBookV1::LEN
    );
    assert_writer_account_codec!(
        WriterAuctionV1,
        WriterAuctionV1::default(),
        WriterAuctionV1::LEN
    );
    assert_writer_account_codec!(
        WriterBidIndexV1,
        WriterBidIndexV1::default(),
        WriterBidIndexV1::LEN
    );
    assert_writer_account_codec!(WriterBidV1, WriterBidV1::default(), WriterBidV1::LEN);
    assert_writer_account_codec!(
        WriterCloseRequestV1,
        WriterCloseRequestV1::default(),
        WriterCloseRequestV1::LEN
    );

    assert_eq!(
        WriterSeriesRecordV1::default().try_to_vec().unwrap().len(),
        256
    );
    assert_eq!(
        WriterBidIndexRecordV1::default()
            .try_to_vec()
            .unwrap()
            .len(),
        116
    );
    assert_eq!(WRITER_SERIES_STORAGE_CAPACITY, 32);
    assert_eq!(WRITER_LIVE_SERIES_LIMIT, 20);
    assert_eq!(WRITER_BID_STORAGE_CAPACITY, 128);
}

#[test]
fn writer_codecs_reject_unknown_enums_and_layouts_reject_reserved_bytes() {
    let mut snapshot = WriterPolicySnapshotV1::default().try_to_vec().unwrap();
    snapshot[214] = 0xff;
    assert!(WriterPolicySnapshotV1::try_from_slice(&snapshot).is_err());

    let mut registry = WriterPolicyRegistryV1 {
        is_initialized: true,
        account_discriminator: WriterPolicyRegistryV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterPolicyRegistryV1::ACCOUNT_VERSION,
        ..WriterPolicyRegistryV1::default()
    };
    assert!(registry.has_current_layout());
    registry.reserved[31] = 1;
    assert!(!registry.has_current_layout());

    let mut book = WriterSeriesBookV1 {
        is_initialized: true,
        account_discriminator: WriterSeriesBookV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterSeriesBookV1::ACCOUNT_VERSION,
        ..WriterSeriesBookV1::default()
    };
    assert!(book.has_current_layout());
    book.records[WRITER_LIVE_SERIES_LIMIT] = WriterSeriesRecordV1 {
        active: true,
        ..WriterSeriesRecordV1::default()
    };
    assert!(!book.has_current_layout());
}
