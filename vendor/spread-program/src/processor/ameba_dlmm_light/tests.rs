#[cfg(test)]
#[derive(Clone, Debug, BorshSerialize)]
pub struct PackedAmoebaDlmmPoolVariant {
    pub data: AmoebaDlmmPoolV1,
}

#[cfg(test)]
#[derive(Clone, Debug, BorshSerialize)]
pub struct PackedAmoebaDlmmBinPageVariant {
    pub data: AmoebaDlmmBinPageV1,
    pub page_index_seed: [u8; 2],
}

#[cfg(test)]
#[derive(Clone, Debug, BorshSerialize)]
pub struct PackedAmoebaDlmmSharePageVariant {
    pub data: AmoebaDlmmSharePageV1,
    pub page_index_seed: [u8; 2],
}

#[cfg(test)]
#[derive(Clone, Debug, BorshSerialize)]
pub struct PackedAmoebaDlmmPositionVariant {
    pub data: AmoebaDlmmPositionV1,
    pub position_nonce_seed: [u8; 8],
}

#[cfg(test)]
#[derive(Clone, Debug, BorshSerialize)]
pub enum PackedAmoebaDlmmAccountVariant {
    Pool(PackedAmoebaDlmmPoolVariant),
    BinPage(PackedAmoebaDlmmBinPageVariant),
    SharePage(PackedAmoebaDlmmSharePageVariant),
    Position(PackedAmoebaDlmmPositionVariant),
}

#[cfg(test)]
impl BorshDeserialize for PackedAmoebaDlmmAccountVariant {
    fn deserialize_reader<R: Read>(reader: &mut R) -> IoResult<Self> {
        match u8::deserialize_reader(reader)? {
            0 => read_fixed_state::<AmoebaDlmmPoolV1, { AmoebaDlmmPoolV1::BODY_LEN }, _>(reader)
                .map(|data| Self::Pool(PackedAmoebaDlmmPoolVariant { data })),
            1 => {
                let data =
                    read_fixed_state::<AmoebaDlmmBinPageV1, { AmoebaDlmmBinPageV1::BODY_LEN }, _>(
                        reader,
                    )?;
                let mut page_index_seed = [0; 2];
                reader.read_exact(&mut page_index_seed)?;
                Ok(Self::BinPage(PackedAmoebaDlmmBinPageVariant {
                    data,
                    page_index_seed,
                }))
            }
            2 => {
                let data = read_fixed_state::<
                    AmoebaDlmmSharePageV1,
                    { AmoebaDlmmSharePageV1::BODY_LEN },
                    _,
                >(reader)?;
                let mut page_index_seed = [0; 2];
                reader.read_exact(&mut page_index_seed)?;
                Ok(Self::SharePage(PackedAmoebaDlmmSharePageVariant {
                    data,
                    page_index_seed,
                }))
            }
            3 => {
                let data = read_fixed_state::<
                    AmoebaDlmmPositionV1,
                    { AmoebaDlmmPositionV1::BODY_LEN },
                    _,
                >(reader)?;
                let mut position_nonce_seed = [0; 8];
                reader.read_exact(&mut position_nonce_seed)?;
                Ok(Self::Position(PackedAmoebaDlmmPositionVariant {
                    data,
                    position_nonce_seed,
                }))
            }
            _ => Err(Error::new(
                ErrorKind::InvalidData,
                "invalid packed Amoeba DLMM account variant",
            )),
        }
    }
}

#[cfg(test)]
fn read_fixed_state<T: FixedStateDecode, const LENGTH: usize, R: Read>(
    reader: &mut R,
) -> IoResult<T> {
    if T::REQUIRED_DATA_LEN != LENGTH {
        return Err(ErrorKind::InvalidData.into());
    }
    let mut body = [0u8; LENGTH];
    reader.read_exact(&mut body)?;
    // SAFETY: `body` is exactly the rigid codec length asserted above.
    unsafe { T::decode_fixed(&body) }
}

use super::*;
use crate::{
    ameba_dlmm_math::page_first_bin,
    ameba_dlmm_state::{
        derive_ameba_dlmm_bin_page_pda, derive_ameba_dlmm_pool_pda, derive_ameba_dlmm_position_pda,
        derive_ameba_dlmm_share_page_pda,
    },
    fixed_codec::FixedStateEncode,
};
use std::io::{Error, ErrorKind, Read};

#[test]
fn direct_assigned_address_derivation_matches_light_reference() {
    let vectors = [
        ([0u8; 32], [0u8; 32], [0u8; 32]),
        ([0xff; 32], [0x55; 32], [0xaa; 32]),
        (
            Pubkey::new_unique().to_bytes(),
            Pubkey::new_unique().to_bytes(),
            Pubkey::new_unique().to_bytes(),
        ),
    ];

    for (seed, address_tree, program_id) in vectors {
        let expected =
            light_compressed_account::address::derive_address(&seed, &address_tree, &program_id);
        let actual = derive_assigned_address(&seed, &address_tree, &program_id);
        assert_eq!(actual, expected);
        assert_eq!(actual[0], 0);
    }
}

#[test]
fn upgrade_authority_uses_canonical_upgradeable_loader_programdata_pda() {
    let program_id = crate::id();
    let authority_key = Pubkey::new_unique();
    let loader_owner = bpf_loader_upgradeable::id();
    let (program_data_key, _) = Pubkey::find_program_address(&[program_id.as_ref()], &loader_owner);
    assert_eq!(
        loader_owner.to_string(),
        "BPFLoaderUpgradeab1e11111111111111111111111"
    );
    assert_eq!(
        program_data_key.to_string(),
        "8KR6hgcQehz32jm7CvrAriYNhvT2Bu9JuUWHce81J1oh"
    );

    let mut program_data_lamports = 1;
    let mut program_data = vec![0u8; 45];
    program_data[..4].copy_from_slice(&3u32.to_le_bytes());
    program_data[4..12].copy_from_slice(&1u64.to_le_bytes());
    program_data[12] = 1;
    program_data[13..45].copy_from_slice(authority_key.as_ref());
    let program_data_info = AccountInfo::new(
        &program_data_key,
        false,
        false,
        &mut program_data_lamports,
        &mut program_data,
        &loader_owner,
        false,
        0,
    );

    let authority_owner = system_program::id();
    let mut authority_lamports = 1;
    let mut authority_data = [];
    let authority_info = AccountInfo::new(
        &authority_key,
        true,
        false,
        &mut authority_lamports,
        &mut authority_data,
        &authority_owner,
        false,
        0,
    );

    assert_eq!(
        check_upgrade_authority(&program_id, &program_data_info, &authority_info),
        Ok(())
    );
}

#[test]
fn fixed_config_codec_preserves_light_023_borsh_bytes() {
    let program_id = Pubkey::new_unique();
    let config_bump_seed = 0u16.to_le_bytes();
    let (config_key, bump) =
        Pubkey::find_program_address(&[LIGHT_CONFIG_SEED, &config_bump_seed], &program_id);
    let expected = AmoebaLightConfig {
        version: 1,
        write_top_up: 0x0102_0304,
        update_authority: [2; 32],
        rent_sponsor: [3; 32],
        compression_authority: [4; 32],
        rent_config: RentConfig {
            base_rent: 5,
            compression_cost: 6,
            lamports_per_byte_per_epoch: 7,
            max_funded_epochs: 8,
            max_top_up: 9,
        },
        config_bump: 0,
        bump,
        rent_sponsor_bump: 10,
        address_tree: [11; 32],
    };
    let reference = light_sdk_types::interface::program::config::LightConfig {
        version: expected.version,
        write_top_up: expected.write_top_up,
        update_authority: expected.update_authority,
        rent_sponsor: expected.rent_sponsor,
        compression_authority: expected.compression_authority,
        rent_config: expected.rent_config,
        config_bump: expected.config_bump,
        bump: expected.bump,
        rent_sponsor_bump: expected.rent_sponsor_bump,
        address_space: vec![expected.address_tree],
    };
    let mut lamports = 1;
    let mut data = vec![0; LIGHT_CONFIG_LEN];
    let config_info = AccountInfo::new(
        &config_key,
        false,
        true,
        &mut lamports,
        &mut data,
        &program_id,
        false,
        0,
    );

    write_light_config(&config_info, &expected).unwrap();
    let expected_body = reference.try_to_vec().unwrap();
    assert_eq!(expected_body.len(), LIGHT_CONFIG_LEN - 8);
    assert_eq!(&config_info.try_borrow_data().unwrap()[8..], expected_body);
    assert_eq!(
        load_light_config(&program_id, &config_info).unwrap(),
        expected
    );
}

#[test]
fn registration_rejects_nonconfigured_address_tree() {
    assert_eq!(
        configured_address_tree_key(&[1; 32], &Pubkey::new_from_array([2; 32])),
        Err(invalid_light())
    );
}

#[test]
fn packed_account_variant_manual_decoder_preserves_borsh_wire_bytes() {
    let variants = [
        PackedAmoebaDlmmAccountVariant::Pool(PackedAmoebaDlmmPoolVariant {
            data: AmoebaDlmmPoolV1::default(),
        }),
        PackedAmoebaDlmmAccountVariant::BinPage(PackedAmoebaDlmmBinPageVariant {
            data: AmoebaDlmmBinPageV1::default(),
            page_index_seed: [0; 2],
        }),
        PackedAmoebaDlmmAccountVariant::SharePage(PackedAmoebaDlmmSharePageVariant {
            data: AmoebaDlmmSharePageV1::default(),
            page_index_seed: [0; 2],
        }),
        PackedAmoebaDlmmAccountVariant::Position(PackedAmoebaDlmmPositionVariant {
            data: AmoebaDlmmPositionV1::default(),
            position_nonce_seed: [0; 8],
        }),
    ];
    for (expected_discriminant, variant) in variants.into_iter().enumerate() {
        let encoded = variant.try_to_vec().unwrap();
        assert_eq!(encoded[0], expected_discriminant as u8);
        let decoded = PackedAmoebaDlmmAccountVariant::try_from_slice(&encoded).unwrap();
        assert_eq!(decoded.try_to_vec().unwrap(), encoded);
    }
    assert!(PackedAmoebaDlmmAccountVariant::try_from_slice(&[4]).is_err());
}

#[test]
fn raw_lifecycle_state_view_preserves_all_four_fixed_layouts() {
    fn assert_state<T: AmoebaDlmmLightState>(kind: AmoebaDlmmStateKind, mut state: T) {
        *state.compression_info_mut() = CompressionInfo::new_decompressed(77);
        let mut body = vec![0; T::ACCOUNT_LEN - 8];
        state.encode_fixed(&mut body);

        let raw = DecodedAmoebaDlmmState::from_body(kind, &body).unwrap();
        assert!(raw.has_layout_with_state(CompressionState::Decompressed));
        assert_eq!(raw.compression_info().unwrap(), *state.compression_info());

        let encoded = raw.try_to_vec().unwrap();
        let mut reader = CheckedCursor::new(&encoded);
        let roundtrip = read_packed_variant(&mut reader).unwrap();
        reader.finish_exact().unwrap();
        assert_eq!(roundtrip.kind, kind);
        assert_eq!(roundtrip.body, body);

        *state.compression_info_mut() = CompressionInfo::compressed();
        let mut expected_compressed = vec![0; T::ACCOUNT_LEN - 8];
        state.encode_fixed(&mut expected_compressed);
        assert_eq!(raw.compressed_body(), expected_compressed);
    }

    let pool = AmoebaDlmmPoolV1 {
        is_initialized: true,
        ..AmoebaDlmmPoolV1::default()
    };
    assert_state(AmoebaDlmmStateKind::Pool, pool);

    let bin_page = AmoebaDlmmBinPageV1 {
        is_initialized: true,
        ..AmoebaDlmmBinPageV1::default()
    };
    assert_state(AmoebaDlmmStateKind::BinPage, bin_page);

    let share_page = AmoebaDlmmSharePageV1 {
        is_initialized: true,
        ..AmoebaDlmmSharePageV1::default()
    };
    assert_state(AmoebaDlmmStateKind::SharePage, share_page);

    let position = AmoebaDlmmPositionV1 {
        is_initialized: true,
        ..AmoebaDlmmPositionV1::default()
    };
    assert_state(AmoebaDlmmStateKind::Position, position);

    let mut invalid = vec![0; AmoebaDlmmPoolV1::BODY_LEN];
    invalid[0] = 2;
    assert!(DecodedAmoebaDlmmState::from_body(AmoebaDlmmStateKind::Pool, &invalid).is_err());
    invalid[0] = 1;
    invalid[POOL_STATUS_OFFSET] = 5;
    assert!(DecodedAmoebaDlmmState::from_body(AmoebaDlmmStateKind::Pool, &invalid).is_err());
    invalid[POOL_STATUS_OFFSET] = 0;
    let state_offset = invalid.len() - 10;
    invalid[state_offset] = 3;
    assert!(DecodedAmoebaDlmmState::from_body(AmoebaDlmmStateKind::Pool, &invalid).is_err());
}

#[test]
fn idempotent_decompression_requires_the_exact_existing_hot_body() {
    let program_id = Pubkey::new_unique();
    let market = Pubkey::new_unique();
    let (key, bump) = derive_ameba_dlmm_pool_pda(&program_id, &market);
    let state = AmoebaDlmmPoolV1 {
        is_initialized: true,
        bump,
        market,
        compression_info: CompressionInfo::new_decompressed(77),
        ..AmoebaDlmmPoolV1::default()
    };
    let mut data = vec![0; AmoebaDlmmPoolV1::LEN];
    data[..8].copy_from_slice(&AMOEBA_DLMM_POOL_LIGHT_DISCRIMINATOR);
    state.encode_fixed(&mut data[8..]);
    let actual = DecodedAmoebaDlmmState::from_body(AmoebaDlmmStateKind::Pool, &data[8..]).unwrap();
    let expected = DecodedAmoebaDlmmState {
        kind: actual.kind,
        body: actual.compressed_body(),
    };
    let mut lamports = 1;
    let target = AccountInfo::new(
        &key,
        false,
        true,
        &mut lamports,
        &mut data,
        &program_id,
        false,
        0,
    );

    assert_eq!(
        validate_existing_hot(&program_id, &target, &expected),
        Ok(true)
    );

    let mut stale = expected;
    stale.body[50] ^= 1;
    assert_eq!(
        validate_existing_hot(&program_id, &target, &stale),
        Err(VaultError::InvalidAmoebaDlmmLightLifecycle.into())
    );
}

#[test]
fn terminal_tombstones_are_compressible_only_when_empty_and_canonical() {
    fn raw<T: FixedStateDecode + FixedStateEncode>(
        kind: AmoebaDlmmStateKind,
        state: &T,
        body_len: usize,
    ) -> DecodedAmoebaDlmmState {
        let mut body = vec![0; body_len];
        state.encode_fixed(&mut body);
        DecodedAmoebaDlmmState::from_body(kind, &body).unwrap()
    }

    let program_id = Pubkey::new_unique();
    let pool = Pubkey::new_unique();
    let owner = Pubkey::new_unique();

    let (position_key, position_bump) =
        derive_ameba_dlmm_position_pda(&program_id, &pool, &owner, 9);
    let position = AmoebaDlmmPositionV1 {
        is_initialized: false,
        bump: position_bump,
        pool,
        owner,
        position_nonce: 9,
        lower_bin_id: 4,
        bin_count: 3,
        compression_info: CompressionInfo::new_decompressed(55),
        ..AmoebaDlmmPositionV1::default()
    };
    let position_raw = raw(
        AmoebaDlmmStateKind::Position,
        &position,
        AmoebaDlmmPositionV1::BODY_LEN,
    );
    assert!(position_raw.has_terminal_tombstone_layout());
    position_raw
        .validate_pda(&program_id, &position_key)
        .unwrap();
    assert!(position_raw
        .validate_pda(&program_id, &Pubkey::new_unique())
        .is_err());

    let mut nonempty_position = position.clone();
    nonempty_position.liquidity_shares[0] = 1;
    assert!(!raw(
        AmoebaDlmmStateKind::Position,
        &nonempty_position,
        AmoebaDlmmPositionV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());
    let mut malformed_position = position.clone();
    malformed_position.bin_count = 0;
    assert!(!raw(
        AmoebaDlmmStateKind::Position,
        &malformed_position,
        AmoebaDlmmPositionV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());
    let mut anonymous_position = position.clone();
    anonymous_position.owner = Pubkey::default();
    assert!(!raw(
        AmoebaDlmmStateKind::Position,
        &anonymous_position,
        AmoebaDlmmPositionV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());
    let mut compressed_position = position.clone();
    compressed_position.compression_info = CompressionInfo::compressed();
    assert!(!raw(
        AmoebaDlmmStateKind::Position,
        &compressed_position,
        AmoebaDlmmPositionV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());

    let page_index = 2;
    let first_bin_id = page_first_bin(page_index).unwrap();
    let (bin_key, bin_bump) = derive_ameba_dlmm_bin_page_pda(&program_id, &pool, page_index);
    let bin_page = AmoebaDlmmBinPageV1 {
        is_initialized: false,
        bump: bin_bump,
        pool,
        page_index,
        first_bin_id,
        compression_info: CompressionInfo::new_decompressed(56),
        ..AmoebaDlmmBinPageV1::default()
    };
    let bin_raw = raw(
        AmoebaDlmmStateKind::BinPage,
        &bin_page,
        AmoebaDlmmBinPageV1::BODY_LEN,
    );
    assert!(bin_raw.has_terminal_tombstone_layout());
    bin_raw.validate_pda(&program_id, &bin_key).unwrap();
    let mut nonempty_bin_page = bin_page.clone();
    nonempty_bin_page.quote_reserve[0] = 1;
    assert!(!raw(
        AmoebaDlmmStateKind::BinPage,
        &nonempty_bin_page,
        AmoebaDlmmBinPageV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());
    let mut malformed_bin_page = bin_page.clone();
    malformed_bin_page.bid_bitmap = 1;
    assert!(!raw(
        AmoebaDlmmStateKind::BinPage,
        &malformed_bin_page,
        AmoebaDlmmBinPageV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());
    let mut misaddressed_bin_page = bin_page.clone();
    misaddressed_bin_page.first_bin_id += 1;
    assert!(!raw(
        AmoebaDlmmStateKind::BinPage,
        &misaddressed_bin_page,
        AmoebaDlmmBinPageV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());

    let (share_key, share_bump) = derive_ameba_dlmm_share_page_pda(&program_id, &pool, page_index);
    let share_page = AmoebaDlmmSharePageV1 {
        is_initialized: false,
        bump: share_bump,
        pool,
        page_index,
        first_bin_id,
        compression_info: CompressionInfo::new_decompressed(57),
        ..AmoebaDlmmSharePageV1::default()
    };
    let share_raw = raw(
        AmoebaDlmmStateKind::SharePage,
        &share_page,
        AmoebaDlmmSharePageV1::BODY_LEN,
    );
    assert!(share_raw.has_terminal_tombstone_layout());
    share_raw.validate_pda(&program_id, &share_key).unwrap();
    let mut nonempty_share_page = share_page.clone();
    nonempty_share_page.total_liquidity_shares[0] = 1;
    assert!(!raw(
        AmoebaDlmmStateKind::SharePage,
        &nonempty_share_page,
        AmoebaDlmmSharePageV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());

    let pool_state = AmoebaDlmmPoolV1 {
        market: Pubkey::new_unique(),
        compression_info: CompressionInfo::new_decompressed(58),
        ..AmoebaDlmmPoolV1::default()
    };
    assert!(!raw(
        AmoebaDlmmStateKind::Pool,
        &pool_state,
        AmoebaDlmmPoolV1::BODY_LEN,
    )
    .has_terminal_tombstone_layout());
}

#[test]
fn lifecycle_param_layouts_match_light_023() {
    let meta = CompressedAccountMetaNoLamportsNoAddress::default();
    let compress = CompressAndCloseParams {
        proof: ValidityProof::default(),
        compressed_accounts: vec![meta],
        system_accounts_offset: 3,
    };
    let reference = light_account::CompressAndCloseParams {
        proof: compress.proof,
        compressed_accounts: compress.compressed_accounts.clone(),
        system_accounts_offset: compress.system_accounts_offset,
    };
    assert_eq!(
        compress.try_to_vec().unwrap(),
        reference.try_to_vec().unwrap()
    );
    let compress_bytes = compress.try_to_vec().unwrap();
    assert_eq!(
        decode_compress_params(&compress_bytes)
            .unwrap()
            .try_to_vec()
            .unwrap(),
        compress_bytes
    );

    let variant = PackedAmoebaDlmmAccountVariant::Pool(PackedAmoebaDlmmPoolVariant {
        data: AmoebaDlmmPoolV1::default(),
    });
    let variant_bytes = variant.try_to_vec().unwrap();
    let mut variant_reader = CheckedCursor::new(&variant_bytes);
    let runtime_variant = read_packed_variant(&mut variant_reader).unwrap();
    variant_reader.finish_exact().unwrap();
    let decompress = DecompressIdempotentParams {
        system_accounts_offset: 3,
        token_accounts_offset: 1,
        output_queue_index: 7,
        proof: ValidityProof::default(),
        accounts: vec![PackedCompressedAccountData {
            tree_info: PackedStateTreeInfo::default(),
            data: runtime_variant,
        }],
    };
    let reference = light_account::DecompressIdempotentParams {
        system_accounts_offset: decompress.system_accounts_offset,
        token_accounts_offset: decompress.token_accounts_offset,
        output_queue_index: decompress.output_queue_index,
        proof: decompress.proof,
        accounts: vec![light_account::compression_info::CompressedAccountData {
            tree_info: PackedStateTreeInfo::default(),
            data: variant,
        }],
    };
    assert_eq!(
        decompress.try_to_vec().unwrap(),
        reference.try_to_vec().unwrap()
    );
    let decompress_bytes = decompress.try_to_vec().unwrap();
    assert_eq!(
        decode_decompress_params(&decompress_bytes)
            .unwrap()
            .try_to_vec()
            .unwrap(),
        decompress_bytes
    );
}

#[test]
fn manual_compressibility_matches_light_rent_state() {
    let info = CompressionInfo::new_decompressed(SLOTS_PER_RENT_EPOCH);
    let state = AccountRentState {
        num_bytes: AmoebaDlmmPoolV1::LEN as u64,
        current_slot: SLOTS_PER_RENT_EPOCH * 2,
        current_lamports: 1,
        last_claimed_slot: info.last_claimed_slot,
    };
    assert!(state.is_compressible(&info.rent_config, 0).is_some());
}
