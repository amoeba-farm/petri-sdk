use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DlmmPrivilegeFixtureSet {
    schema_version: u8,
    cases: Vec<DlmmPrivilegeFixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DlmmPrivilegeFixture {
    name: String,
    tag: u8,
    account_count: usize,
    privileges: String,
}

fn dlmm_privilege_fixtures() -> DlmmPrivilegeFixtureSet {
    serde_json::from_str(include_str!(
        "../../../../../fixtures/ameba_dlmm_account_privileges_v1.json"
    ))
    .expect("DLMM privilege fixture must decode")
}

fn privilege_pattern(value: &str) -> Vec<(bool, bool)> {
    value
        .split_ascii_whitespace()
        .map(|symbol| match symbol {
            "R" => (false, false),
            "W" => (false, true),
            "S" => (true, false),
            "X" => (true, true),
            _ => panic!("unknown account privilege symbol {symbol}"),
        })
        .collect()
}

fn privilege_account_infos(flags: &[(bool, bool)]) -> Vec<AccountInfo<'static>> {
    flags
        .iter()
        .map(|(is_signer, is_writable)| {
            let key = Box::leak(Box::new(Pubkey::new_unique()));
            let owner = Box::leak(Box::new(Pubkey::new_unique()));
            let lamports = Box::leak(Box::new(0u64));
            let data = Box::leak(Vec::<u8>::new().into_boxed_slice());
            AccountInfo::new(
                key,
                *is_signer,
                *is_writable,
                lamports,
                data,
                owner,
                false,
                0,
            )
        })
        .collect()
}

#[test]
fn dlmm_p0_effective_privilege_matrix_allows_only_fee_payer_writable_promotion() {
    let fixtures = dlmm_privilege_fixtures();
    assert_eq!(fixtures.schema_version, 1);
    assert_eq!(fixtures.cases.len(), 3);
    for fixture in fixtures.cases {
        let tag = AmoebaDlmmInstructionTag::from_byte(fixture.tag)
            .unwrap_or_else(|| panic!("unknown DLMM tag {}", fixture.tag));
        let canonical = privilege_pattern(&fixture.privileges);
        assert_eq!(canonical.len(), fixture.account_count, "{}", fixture.name);
        assert_eq!(
            validate_pack_dlmm_account_privileges(tag, &privilege_account_infos(&canonical)),
            Ok(()),
            "canonical {} ({tag:?})",
            fixture.name,
        );
        for index in 0..canonical.len() {
            let mut signer_mutation = canonical.clone();
            signer_mutation[index].0 = !signer_mutation[index].0;
            assert_eq!(
                validate_pack_dlmm_account_privileges(
                    tag,
                    &privilege_account_infos(&signer_mutation),
                ),
                Err(VaultError::InvalidAccountList.into()),
                "{} ({tag:?}) signer mutation at {index}",
                fixture.name,
            );

            let mut writable_mutation = canonical.clone();
            writable_mutation[index].1 = !writable_mutation[index].1;
            let result = validate_pack_dlmm_account_privileges(
                tag,
                &privilege_account_infos(&writable_mutation),
            );
            if canonical[index] == (true, false) {
                assert_eq!(
                    result,
                    Ok(()),
                    "{} ({tag:?}) fee-payer writable promotion at {index}",
                    fixture.name,
                );
            } else {
                assert_eq!(
                    result,
                    Err(VaultError::InvalidAccountList.into()),
                    "{} ({tag:?}) writable mutation at {index}",
                    fixture.name,
                );
            }
        }
    }
}

#[test]
fn dlmm_p0_effective_privilege_matrix_accepts_dynamic_limits_only() {
    let liquidity = privilege_pattern("X W W R R R W W W W R R W W R R W W W");
    let mut four_page_pairs = liquidity[..17].to_vec();
    four_page_pairs.extend(core::iter::repeat_n((false, true), 8));
    assert_eq!(
        validate_pack_dlmm_account_privileges(
            AmoebaDlmmInstructionTag::AddLiquidityV1,
            &privilege_account_infos(&four_page_pairs),
        ),
        Ok(()),
    );
    let mut eight_swap_pages =
        privilege_pattern("X R W R W R W W R W R W W W W R R W W R R R W R W R W W W W R W");
    eight_swap_pages.extend(core::iter::repeat_n((false, true), 7));
    assert_eq!(eight_swap_pages.len(), 39);
    assert_eq!(
        validate_pack_dlmm_account_privileges(
            AmoebaDlmmInstructionTag::SwapCollectiveDlmmExactInV1,
            &privilege_account_infos(&eight_swap_pages),
        ),
        Ok(()),
    );
    eight_swap_pages.push((false, true));
    assert_eq!(
        validate_pack_dlmm_account_privileges(
            AmoebaDlmmInstructionTag::SwapCollectiveDlmmExactInV1,
            &privilege_account_infos(&eight_swap_pages),
        ),
        Err(VaultError::InvalidAccountList.into()),
    );
}

#[test]
fn oracle_bounty_walk_assigns_rounding_dust_once_to_canonical_later_buckets() {
    let share_one = oracle_bucket_bounty_share(101, 0, 3_333).unwrap();
    let share_two = oracle_bucket_bounty_share(101, 3_333, 3_333).unwrap();
    let share_three = oracle_bucket_bounty_share(101, 6_666, 3_334).unwrap();
    assert_eq!((share_one, share_two, share_three), (33, 34, 34));
    assert_eq!(share_one + share_two + share_three, 101);
    assert!(oracle_bucket_bounty_share(101, 10_000, 1).is_err());
    assert!(oracle_bucket_bounty_share(101, 9_999, 2).is_err());
}

#[test]
fn fixed_event_codecs_preserve_borsh_bytes() {
    fn assert_event(event: AmoebaDlmmEvent) {
        let reference = match &event {
            AmoebaDlmmEvent::PoolInitialized(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::PageInitialized(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::PositionInitialized(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::Liquidity(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::Swap(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::Status(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::Settled(value) => borsh::to_vec(value).unwrap(),
            AmoebaDlmmEvent::Closed(value) => borsh::to_vec(value).unwrap(),
        };
        let encoded = encode_event(&event);
        assert_eq!(&encoded.bytes[..encoded.len], reference);
    }

    let pool = Pubkey::new_unique();
    let second = Pubkey::new_unique();
    let third = Pubkey::new_unique();
    assert_event(AmoebaDlmmEvent::PoolInitialized(PoolInitializedEvent {
        pool,
        market: second,
        liquidity_manager: third,
        maximum_bin_id: 1,
        slot: 2,
    }));
    assert_event(AmoebaDlmmEvent::PageInitialized(PageInitializedEvent {
        pool,
        page_index: 3,
        slot: 4,
    }));
    assert_event(AmoebaDlmmEvent::PositionInitialized(
        PositionInitializedEvent {
            pool,
            position: second,
            owner: third,
            position_nonce: 5,
            lower_bin_id: 6,
            bin_count: 7,
            slot: 8,
        },
    ));
    assert_event(AmoebaDlmmEvent::Liquidity(LiquidityEvent {
        pool,
        position: second,
        owner: third,
        option_amount: 9,
        quote_amount: 10,
        shares: 11,
        entry_count: 12,
        slot: 13,
    }));
    assert_event(AmoebaDlmmEvent::Swap(SwapEvent {
        pool,
        trader: second,
        direction: 1,
        amount_in: 14,
        amount_out: 15,
        total_fee: 16,
        protocol_fee: 17,
        first_bin: 18,
        last_bin: 19,
        bins_crossed: 20,
        slot: 21,
    }));
    assert_event(AmoebaDlmmEvent::Status(StatusEvent {
        pool,
        old_status: AmoebaDlmmPoolStatus::Pending,
        new_status: AmoebaDlmmPoolStatus::Paused,
        slot: 22,
    }));
    assert_event(AmoebaDlmmEvent::Settled(SettledEvent {
        pool,
        settlement: second,
        settlement_price_atomic: 26,
        slot: 27,
    }));
    for page_index in [None, Some(28)] {
        assert_event(AmoebaDlmmEvent::Closed(ClosedEvent {
            pool,
            page_index,
            fully_closed: page_index.is_none(),
            slot: 29,
        }));
    }
}

fn loaded_page(page_index: u16, bid_bitmap: u32, ask_bitmap: u32) -> LoadedPagePair {
    LoadedPagePair {
        page_account_index: 0,
        share_account_index: 1,
        page: AmoebaDlmmBinPageV1 {
            is_initialized: true,
            page_index,
            first_bin_id: page_first_bin(page_index).unwrap(),
            bid_bitmap,
            ask_bitmap,
            ..AmoebaDlmmBinPageV1::default()
        },
        shares: AmoebaDlmmSharePageV1 {
            is_initialized: true,
            page_index,
            first_bin_id: page_first_bin(page_index).unwrap(),
            ..AmoebaDlmmSharePageV1::default()
        },
    }
}

#[test]
fn liquidity_update_does_not_require_an_untouched_best_page() {
    let mut pool = AmoebaDlmmPoolV1 {
        best_ask_bin_id: 1,
        ask_page_bitmap: 1,
        ..AmoebaDlmmPoolV1::default()
    };
    let pages = vec![loaded_page(1, 0, 1)];
    refresh_pool_page_and_best_bits(&mut pool, &pages).unwrap();
    assert_eq!(pool.best_ask_bin_id, 1);
    validate_final_liquidity_page_route(&pages, &[1], 1, 0, &pool).unwrap();
}

#[test]
fn removal_of_a_best_page_requires_exactly_its_canonical_lookahead() {
    let mut pool = AmoebaDlmmPoolV1 {
        best_ask_bin_id: 1,
        ask_page_bitmap: 3,
        ..AmoebaDlmmPoolV1::default()
    };
    let mut missing_lookahead = pool.clone();
    assert!(
        refresh_pool_page_and_best_bits(&mut missing_lookahead, &[loaded_page(0, 0, 0)],).is_err()
    );

    let pages = vec![loaded_page(0, 0, 0), loaded_page(1, 0, 1)];
    refresh_pool_page_and_best_bits(&mut pool, &pages).unwrap();
    assert_eq!(pool.best_ask_bin_id, 33);
    validate_final_liquidity_page_route(&pages, &[0], 1, 0, &pool).unwrap();

    let pages_with_extra = vec![
        loaded_page(0, 0, 0),
        loaded_page(1, 0, 1),
        loaded_page(2, 0, 0),
    ];
    assert!(validate_final_liquidity_page_route(&pages_with_extra, &[0], 1, 0, &pool,).is_err());
}

#[test]
fn final_liquidity_route_inserts_best_pages_in_order_without_duplicates() {
    let pool = AmoebaDlmmPoolV1 {
        best_ask_bin_id: page_first_bin(3).unwrap(),
        best_bid_bin_id: page_first_bin(1).unwrap(),
        ..AmoebaDlmmPoolV1::default()
    };
    let pages = vec![
        loaded_page(1, 0, 0),
        loaded_page(2, 0, 0),
        loaded_page(3, 0, 0),
    ];
    validate_final_liquidity_page_route(
        &pages,
        &[2],
        page_first_bin(1).unwrap(),
        page_first_bin(3).unwrap(),
        &pool,
    )
    .unwrap();

    let shared_best_page = page_first_bin(1).unwrap();
    let pool = AmoebaDlmmPoolV1 {
        best_ask_bin_id: shared_best_page,
        best_bid_bin_id: shared_best_page,
        ..AmoebaDlmmPoolV1::default()
    };
    let pages = vec![loaded_page(1, 0, 0), loaded_page(2, 0, 0)];
    validate_final_liquidity_page_route(
        &pages,
        &[2],
        page_first_bin(3).unwrap(),
        page_first_bin(4).unwrap(),
        &pool,
    )
    .unwrap();
}

#[test]
fn liquidity_page_routes_reject_missing_and_surplus_accounts() {
    let pages = vec![loaded_page(0, 0, 0), loaded_page(2, 0, 0)];
    assert!(validate_liquidity_page_route_contains_touched(&pages, &[0, 1]).is_err());
    assert!(validate_exact_liquidity_page_route(&pages, &[0]).is_err());
}

fn swap_params() -> SwapAmoebaDlmmExactInV1Params {
    SwapAmoebaDlmmExactInV1Params {
        direction: WireSwapDirection::QuoteForOption,
        amount_in: 1,
        minimum_amount_out: 1,
        limit_bin_id: 0,
        deadline_ts: u64::MAX,
    }
}

fn swap_account_infos<'a>(
    keys: &'a [Pubkey],
    lamports: &'a mut [u64],
    data: &'a mut [Vec<u8>],
    owner: &'a Pubkey,
) -> Vec<AccountInfo<'a>> {
    keys.iter()
        .zip(lamports.iter_mut())
        .zip(data.iter_mut())
        .enumerate()
        .map(|(index, ((key, lamports), data))| {
            AccountInfo::new(
                key,
                false,
                index == 19,
                lamports,
                data.as_mut_slice(),
                owner,
                false,
                0,
            )
        })
        .collect()
}

#[test]
fn collective_swap_rejects_an_incomplete_account_list() {
    let keys = (0..19).map(|_| Pubkey::new_unique()).collect::<Vec<_>>();
    let mut lamports = vec![0; keys.len()];
    let mut data = vec![Vec::new(); keys.len()];
    let owner = solana_program::system_program::id();
    let accounts = swap_account_infos(&keys, &mut lamports, &mut data, &owner);

    assert_eq!(
        process_collective_swap_exact_in_core(&Pubkey::new_unique(), &accounts, swap_params()),
        Err(VaultError::InvalidAccountList.into())
    );
}

#[test]
fn swap_recognizes_the_current_twenty_account_prefix() {
    let mut keys = (0..21).map(|_| Pubkey::new_unique()).collect::<Vec<_>>();
    keys[18] = light_token_instruction::compressible_config();
    keys[19] = light_token_instruction::rent_sponsor();
    let mut lamports = vec![0; keys.len()];
    let mut data = vec![Vec::new(); keys.len()];
    let owner = solana_program::system_program::id();
    let accounts = swap_account_infos(&keys, &mut lamports, &mut data, &owner);

    assert_eq!(
        process_collective_swap_exact_in_core(&Pubkey::new_unique(), &accounts, swap_params()),
        Err(ProgramError::MissingRequiredSignature)
    );
}
