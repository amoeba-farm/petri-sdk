use super::*;
use proptest::prelude::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct FixtureSet {
    version: u8,
    cases: Vec<FixtureCase>,
}

#[derive(Deserialize)]
struct FixtureCase {
    name: String,
    pool: FixturePool,
    pages: Vec<FixturePage>,
    swap: FixtureSwap,
    expected: FixtureExpected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixturePool {
    tick_size_quote_atomic: String,
    maximum_bin_id: u16,
    maximum_bins_per_swap: u8,
    accounted_option_reserve: String,
    accounted_quote_reserve: String,
    protocol_fee_quote: String,
    bid_page_bitmap: Vec<String>,
    ask_page_bitmap: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixturePage {
    page_index: u16,
    first_bin_id: u16,
    bid_bitmap: u32,
    ask_bitmap: u32,
    bins: Vec<FixtureBin>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureBin {
    bin_id: u16,
    option_reserve: String,
    quote_reserve: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureSwap {
    direction: String,
    amount_in: String,
    minimum_amount_out: String,
    limit_bin_id: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureExpected {
    amount_out: String,
    total_fee: String,
    protocol_fee: String,
    lp_fee: String,
    first_bin_id: u16,
    last_bin_id: u16,
    fills: Vec<FixtureFill>,
    pool: FixtureExpectedPool,
    pages: Vec<FixtureExpectedPage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureFill {
    bin_id: u16,
    trade_input: String,
    amount_out: String,
    lp_fee: String,
    option_reserve_after: String,
    quote_reserve_after: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureExpectedPool {
    accounted_option_reserve: String,
    accounted_quote_reserve: String,
    protocol_fee_quote: String,
    bid_page_bitmap: Vec<String>,
    ask_page_bitmap: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureExpectedPage {
    page_index: u16,
    bid_bitmap: u32,
    ask_bitmap: u32,
}

fn fixture_u64(value: &str) -> u64 {
    value.parse().unwrap()
}

fn fixture_bitmap(values: &[String]) -> [u64; 16] {
    values
        .iter()
        .map(|value| fixture_u64(value))
        .collect::<Vec<_>>()
        .try_into()
        .unwrap()
}

#[test]
fn ceil_and_floor_mul_div_are_exact_at_boundaries() {
    assert_eq!(floor_mul_div(10, 3, 4), Ok(7));
    assert_eq!(ceil_mul_div(10, 3, 4), Ok(8));
    assert_eq!(ceil_mul_div(u64::MAX, u64::MAX, u64::MAX), Ok(u64::MAX));
    assert_eq!(
        floor_mul_div(1, 1, 0),
        Err(AmoebaDlmmMathError::DivisionByZero)
    );
    assert_eq!(
        ceil_mul_div_u128(u128::MAX, 1, 2),
        Err(AmoebaDlmmMathError::ArithmeticOverflow)
    );
    assert_eq!(
        ceil_mul_div_u128(u128::MAX, 2, 1),
        Err(AmoebaDlmmMathError::ArithmeticOverflow)
    );
}

#[test]
fn share_and_swap_overflows_fail_closed() {
    assert_eq!(
        calculate_share_deposit(0, 0, 0, 1, u64::MAX, AMOEBA_DLMM_PRICE_SCALE),
        Err(AmoebaDlmmMathError::ArithmeticOverflow)
    );

    let bins = [
        AmoebaDlmmBinLiquidity {
            bin_id: 2,
            option_reserve: 0,
            quote_reserve: u64::MAX,
        },
        AmoebaDlmmBinLiquidity {
            bin_id: 1,
            option_reserve: 0,
            quote_reserve: u64::MAX,
        },
    ];
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::OptionForQuote,
            u64::MAX,
            1,
            1,
            AMOEBA_DLMM_PRICE_SCALE,
            2,
            2,
            &bins,
        ),
        Err(AmoebaDlmmMathError::ArithmeticOverflow)
    );

    let reserve_add_overflow = [AmoebaDlmmBinLiquidity {
        bin_id: 1,
        option_reserve: 1,
        quote_reserve: u64::MAX,
    }];
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            1,
            1,
            1,
            AMOEBA_DLMM_PRICE_SCALE,
            1,
            1,
            &reserve_add_overflow,
        ),
        Err(AmoebaDlmmMathError::ArithmeticOverflow)
    );

    let historical_fee_reserve_overflow = [AmoebaDlmmBinLiquidity {
        bin_id: 1,
        option_reserve: 2,
        quote_reserve: u64::MAX - 1,
    }];
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            2,
            1,
            1,
            AMOEBA_DLMM_PRICE_SCALE,
            1,
            1,
            &historical_fee_reserve_overflow,
        ),
        Err(AmoebaDlmmMathError::ArithmeticOverflow)
    );
}

#[test]
fn exact_input_route_cap_is_one_through_eight_with_stable_boundary_math() {
    assert_eq!(
        AMOEBA_DLMM_MAXIMUM_BINS_PER_SWAP,
        crate::constants::MAX_AMOEBA_DLMM_BINS_PER_SWAP
    );

    let one_bin = [AmoebaDlmmBinLiquidity {
        bin_id: 1,
        option_reserve: 1,
        quote_reserve: 0,
    }];
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            1,
            1,
            1,
            AMOEBA_DLMM_PRICE_SCALE,
            8,
            0,
            &one_bin,
        ),
        Err(AmoebaDlmmMathError::InvalidAmount)
    );

    let one = quote_exact_in(
        AmoebaDlmmSwapDirection::QuoteForOption,
        1,
        1,
        1,
        AMOEBA_DLMM_PRICE_SCALE,
        8,
        1,
        &one_bin,
    )
    .unwrap();
    assert_eq!(one.amount_out, 1);
    assert_eq!(one.fills.len(), 1);

    let eight_bins = (1..=AMOEBA_DLMM_MAXIMUM_BINS_PER_SWAP)
        .map(|bin_id| AmoebaDlmmBinLiquidity {
            bin_id: u16::from(bin_id),
            option_reserve: 1,
            quote_reserve: 0,
        })
        .collect::<Vec<_>>();
    let eight = quote_exact_in(
        AmoebaDlmmSwapDirection::QuoteForOption,
        36,
        1,
        8,
        AMOEBA_DLMM_PRICE_SCALE,
        8,
        AMOEBA_DLMM_MAXIMUM_BINS_PER_SWAP,
        &eight_bins,
    )
    .unwrap();
    assert_eq!(eight.amount_in, 36);
    assert_eq!(eight.amount_out, 8);
    assert_eq!(eight.first_bin_id, 1);
    assert_eq!(eight.last_bin_id, 8);
    assert_eq!(eight.fills.len(), 8);
    assert!(eight
        .fills
        .iter()
        .enumerate()
        .all(|(index, fill)| fill.bin_id == index as u16 + 1
            && fill.trade_input == index as u64 + 1
            && fill.amount_out == 1
            && fill.option_reserve_after == 0
            && fill.quote_reserve_after == index as u64 + 1));

    for invalid_cap in [9, u8::MAX] {
        assert_eq!(
            quote_exact_in(
                AmoebaDlmmSwapDirection::QuoteForOption,
                1,
                1,
                1,
                AMOEBA_DLMM_PRICE_SCALE,
                8,
                invalid_cap,
                &one_bin,
            ),
            Err(AmoebaDlmmMathError::TooManyBins)
        );
    }
}

#[test]
fn bin_and_price_derivations_are_one_based() {
    assert_eq!(bin_to_page(1), Ok((0, 0)));
    assert_eq!(bin_to_page(32), Ok((0, 31)));
    assert_eq!(bin_to_page(33), Ok((1, 0)));
    assert_eq!(bin_to_page(240), Ok((7, 15)));
    assert_eq!(page_first_bin(7), Ok(225));
    assert_eq!(price_from_bin(50_000, 240, 240), Ok(12_000_000));
    assert_eq!(
        price_from_bin(50_000, 240, 241),
        Err(AmoebaDlmmMathError::InvalidBin)
    );
    assert_eq!(
        price_from_bin(50_000, 240, 0),
        Err(AmoebaDlmmMathError::InvalidBin)
    );
}

#[test]
fn historical_fee_settings_do_not_charge_new_fees() {
    assert_eq!(
        calculate_fees(101,),
        Ok(AmoebaDlmmFeeBreakdown {
            total_fee: 0,
            protocol_fee: 0,
            lp_fee: 0,
            trade_input: 101,
        })
    );
}

#[test]
fn quote_for_option_handles_partial_exact_and_multi_bin_fills() {
    let partial = quote_exact_in(
        AmoebaDlmmSwapDirection::QuoteForOption,
        250_000,
        1,
        3,
        500_000,
        3,
        3,
        &[AmoebaDlmmBinLiquidity {
            bin_id: 2,
            option_reserve: 1_000_000,
            quote_reserve: 0,
        }],
    )
    .unwrap();
    assert_eq!(partial.amount_out, 250_000);
    assert_eq!(partial.fills[0].option_reserve_after, 750_000);

    let exact = quote_exact_in(
        AmoebaDlmmSwapDirection::QuoteForOption,
        1_000_000,
        1_000_000,
        2,
        500_000,
        3,
        2,
        &[AmoebaDlmmBinLiquidity {
            bin_id: 2,
            option_reserve: 1_000_000,
            quote_reserve: 0,
        }],
    )
    .unwrap();
    assert_eq!(exact.amount_out, 1_000_000);
    assert_eq!(exact.fills[0].option_reserve_after, 0);

    let multiple = quote_exact_in(
        AmoebaDlmmSwapDirection::QuoteForOption,
        1_500_000,
        1,
        3,
        500_000,
        3,
        3,
        &[
            AmoebaDlmmBinLiquidity {
                bin_id: 2,
                option_reserve: 1_000_000,
                quote_reserve: 0,
            },
            AmoebaDlmmBinLiquidity {
                bin_id: 3,
                option_reserve: 1_000_000,
                quote_reserve: 0,
            },
        ],
    )
    .unwrap();
    assert_eq!(multiple.amount_out, 1_333_333);
    assert_eq!(multiple.fills.len(), 2);
}

#[test]
fn option_for_quote_handles_partial_exact_and_multi_bin_fills() {
    let partial = quote_exact_in(
        AmoebaDlmmSwapDirection::OptionForQuote,
        250_000,
        1,
        1,
        500_000,
        3,
        3,
        &[AmoebaDlmmBinLiquidity {
            bin_id: 2,
            option_reserve: 0,
            quote_reserve: 1_000_000,
        }],
    )
    .unwrap();
    assert_eq!(partial.amount_out, 250_000);

    let exact = quote_exact_in(
        AmoebaDlmmSwapDirection::OptionForQuote,
        1_000_000,
        1_000_000,
        2,
        500_000,
        3,
        2,
        &[AmoebaDlmmBinLiquidity {
            bin_id: 2,
            option_reserve: 0,
            quote_reserve: 1_000_000,
        }],
    )
    .unwrap();
    assert_eq!(exact.amount_out, 1_000_000);
    assert_eq!(exact.fills[0].quote_reserve_after, 0);

    let multiple = quote_exact_in(
        AmoebaDlmmSwapDirection::OptionForQuote,
        1_500_000,
        1,
        1,
        500_000,
        3,
        3,
        &[
            AmoebaDlmmBinLiquidity {
                bin_id: 3,
                option_reserve: 0,
                quote_reserve: 1_500_000,
            },
            AmoebaDlmmBinLiquidity {
                bin_id: 2,
                option_reserve: 0,
                quote_reserve: 1_000_000,
            },
        ],
    )
    .unwrap();
    assert_eq!(multiple.amount_out, 2_000_000);
    assert_eq!(multiple.fills.len(), 2);
}

#[test]
fn historical_fee_settings_leave_full_input_available_across_bins() {
    let quote = quote_exact_in(
        AmoebaDlmmSwapDirection::QuoteForOption,
        1_003,
        1,
        3,
        1_000_000,
        3,
        3,
        &[
            AmoebaDlmmBinLiquidity {
                bin_id: 1,
                option_reserve: 500,
                quote_reserve: 1,
            },
            AmoebaDlmmBinLiquidity {
                bin_id: 2,
                option_reserve: 500,
                quote_reserve: 1,
            },
        ],
    )
    .unwrap();
    assert_eq!(quote.total_fee, 0);
    assert_eq!(quote.protocol_fee, 0);
    assert!(quote.fills.iter().all(|fill| fill.lp_fee == 0));
    assert_eq!(
        quote.fills.iter().map(|fill| fill.trade_input).sum::<u64>(),
        1_003
    );
    assert_eq!(quote.amount_out, 751);
}

#[test]
fn exact_input_is_all_or_nothing_and_honors_limits_and_minimums() {
    let bin = AmoebaDlmmBinLiquidity {
        bin_id: 2,
        option_reserve: 1,
        quote_reserve: 0,
    };
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            3,
            1,
            2,
            1_000_000,
            2,
            1,
            &[bin],
        ),
        Err(AmoebaDlmmMathError::InsufficientLiquidity)
    );
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            1,
            2,
            2,
            1_000_000,
            2,
            1,
            &[bin],
        ),
        Err(AmoebaDlmmMathError::MinimumOutputNotMet)
    );
    assert_eq!(
        quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            1,
            1,
            1,
            1_000_000,
            2,
            1,
            &[bin],
        ),
        Err(AmoebaDlmmMathError::PriceLimitExceeded)
    );
}

#[test]
fn initial_and_proportional_share_deposits_preserve_ratio() {
    let initial = calculate_share_deposit(0, 0, 0, 2_000_000, 3_000_000, 500_000).unwrap();
    assert_eq!(initial.minted_shares, 4_000_000);
    let proportional = calculate_share_deposit(
        2_000_000, 3_000_000, 4_000_000, 1_000_000, 3_000_000, 500_000,
    )
    .unwrap();
    assert_eq!(
        proportional,
        AmoebaDlmmShareDeposit {
            option_amount: 1_000_000,
            quote_amount: 1_500_000,
            minted_shares: 2_000_000,
        }
    );
}

#[test]
fn final_withdrawal_removes_all_rounding_dust() {
    let partial = calculate_share_withdrawal(10, 11, 3, 1).unwrap();
    assert_eq!(partial.option_amount, 3);
    assert_eq!(partial.quote_amount, 3);
    let final_withdrawal = calculate_share_withdrawal(7, 8, 2, 2).unwrap();
    assert_eq!(final_withdrawal.option_amount, 7);
    assert_eq!(final_withdrawal.quote_amount, 8);
}

#[test]
fn local_bitmaps_match_nonzero_reserves() {
    let mut option = [0u64; 32];
    let mut quote = [0u64; 32];
    option[0] = 1;
    option[31] = 1;
    quote[4] = 1;
    let (bid, ask) = refresh_local_liquidity_bits(&option, &quote);
    assert_eq!(lowest_set_bit(ask), Some(0));
    assert_eq!(highest_set_bit(ask), Some(31));
    assert_eq!(bid, 1 << 4);
}

#[test]
fn shared_json_fixtures_match_quote_and_post_swap_state() {
    let fixtures: FixtureSet =
        serde_json::from_str(include_str!("../../../../fixtures/ameba_dlmm_math_v1.json")).unwrap();
    assert_eq!(fixtures.version, 1);
    for fixture in fixtures.cases {
        let direction = match fixture.swap.direction.as_str() {
            "QuoteForOption" => AmoebaDlmmSwapDirection::QuoteForOption,
            "OptionForQuote" => AmoebaDlmmSwapDirection::OptionForQuote,
            other => panic!("unknown fixture direction {other}"),
        };
        let mut page_reserves = fixture
            .pages
            .iter()
            .map(|page| {
                assert_eq!(page.first_bin_id, page_first_bin(page.page_index).unwrap());
                let mut option = [0u64; 32];
                let mut quote = [0u64; 32];
                for bin in &page.bins {
                    let (page_index, local_index) = bin_to_page(bin.bin_id).unwrap();
                    assert_eq!(page_index, page.page_index);
                    option[local_index as usize] = fixture_u64(&bin.option_reserve);
                    quote[local_index as usize] = fixture_u64(&bin.quote_reserve);
                }
                assert_eq!(
                    refresh_local_liquidity_bits(&option, &quote),
                    (page.bid_bitmap, page.ask_bitmap),
                    "{} pre-swap page {}",
                    fixture.name,
                    page.page_index
                );
                (page.page_index, option, quote)
            })
            .collect::<Vec<_>>();
        let mut initial_bid_pages = [0u64; 16];
        let mut initial_ask_pages = [0u64; 16];
        for (page_index, option, quote_reserve) in &page_reserves {
            let (bid, ask) = refresh_local_liquidity_bits(option, quote_reserve);
            if bid != 0 {
                initial_bid_pages[(*page_index / 64) as usize] |= 1u64 << (*page_index % 64);
            }
            if ask != 0 {
                initial_ask_pages[(*page_index / 64) as usize] |= 1u64 << (*page_index % 64);
            }
        }
        assert_eq!(
            initial_bid_pages,
            fixture_bitmap(&fixture.pool.bid_page_bitmap)
        );
        assert_eq!(
            initial_ask_pages,
            fixture_bitmap(&fixture.pool.ask_page_bitmap)
        );
        let bins = fixture
            .pages
            .iter()
            .flat_map(|page| page.bins.iter())
            .map(|bin| AmoebaDlmmBinLiquidity {
                bin_id: bin.bin_id,
                option_reserve: fixture_u64(&bin.option_reserve),
                quote_reserve: fixture_u64(&bin.quote_reserve),
            })
            .collect::<Vec<_>>();
        let quote = quote_exact_in(
            direction,
            fixture_u64(&fixture.swap.amount_in),
            fixture_u64(&fixture.swap.minimum_amount_out),
            fixture.swap.limit_bin_id,
            fixture_u64(&fixture.pool.tick_size_quote_atomic),
            fixture.pool.maximum_bin_id,
            fixture.pool.maximum_bins_per_swap,
            &bins,
        )
        .unwrap();
        assert_eq!(quote.amount_out, fixture_u64(&fixture.expected.amount_out));
        assert_eq!(quote.total_fee, fixture_u64(&fixture.expected.total_fee));
        assert_eq!(
            quote.protocol_fee,
            fixture_u64(&fixture.expected.protocol_fee)
        );
        assert_eq!(quote.lp_fee, fixture_u64(&fixture.expected.lp_fee));
        assert_eq!(quote.first_bin_id, fixture.expected.first_bin_id);
        assert_eq!(quote.last_bin_id, fixture.expected.last_bin_id);
        assert_eq!(quote.fills.len(), fixture.expected.fills.len());
        for (actual, expected) in quote.fills.iter().zip(&fixture.expected.fills) {
            assert_eq!(actual.bin_id, expected.bin_id);
            assert_eq!(actual.trade_input, fixture_u64(&expected.trade_input));
            assert_eq!(actual.amount_out, fixture_u64(&expected.amount_out));
            assert_eq!(actual.lp_fee, fixture_u64(&expected.lp_fee));
            assert_eq!(
                actual.option_reserve_after,
                fixture_u64(&expected.option_reserve_after)
            );
            assert_eq!(
                actual.quote_reserve_after,
                fixture_u64(&expected.quote_reserve_after)
            );
            let (page_index, local_index) = bin_to_page(actual.bin_id).unwrap();
            let page = page_reserves
                .iter_mut()
                .find(|page| page.0 == page_index)
                .unwrap();
            page.1[local_index as usize] = actual.option_reserve_after;
            page.2[local_index as usize] = actual.quote_reserve_after;
        }
        let mut bid_pages = [0u64; 16];
        let mut ask_pages = [0u64; 16];
        for (page_index, option, quote_reserve) in &page_reserves {
            let (bid, ask) = refresh_local_liquidity_bits(option, quote_reserve);
            let expected = fixture
                .expected
                .pages
                .iter()
                .find(|page| page.page_index == *page_index)
                .unwrap();
            assert_eq!((bid, ask), (expected.bid_bitmap, expected.ask_bitmap));
            if bid != 0 {
                bid_pages[(*page_index / 64) as usize] |= 1u64 << (*page_index % 64);
            }
            if ask != 0 {
                ask_pages[(*page_index / 64) as usize] |= 1u64 << (*page_index % 64);
            }
        }
        assert_eq!(
            bid_pages,
            fixture_bitmap(&fixture.expected.pool.bid_page_bitmap)
        );
        assert_eq!(
            ask_pages,
            fixture_bitmap(&fixture.expected.pool.ask_page_bitmap)
        );
        let pre_option = fixture_u64(&fixture.pool.accounted_option_reserve);
        let pre_quote = fixture_u64(&fixture.pool.accounted_quote_reserve);
        let pre_protocol_quote = fixture_u64(&fixture.pool.protocol_fee_quote);
        assert_eq!(
            pre_option - quote.amount_out,
            fixture_u64(&fixture.expected.pool.accounted_option_reserve)
        );
        assert_eq!(
            pre_quote + quote.amount_in - quote.protocol_fee,
            fixture_u64(&fixture.expected.pool.accounted_quote_reserve)
        );
        assert_eq!(
            pre_protocol_quote + quote.protocol_fee,
            fixture_u64(&fixture.expected.pool.protocol_fee_quote)
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn randomized_buy_and_sell_conserve_reserves(
        bin_id in 1u16..=1_000,
        option_reserve in 1u64..=1_000_000,
        quote_units in 1u64..=1_000_000,
        desired_seed in any::<u64>(),
    ) {
        let desired_option = desired_seed % option_reserve + 1;
        let price_multiplier = bin_id as u64;
        let quote_in = desired_option.checked_mul(price_multiplier).unwrap();
        let buy = quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            quote_in,
            1,
            bin_id,
            AMOEBA_DLMM_PRICE_SCALE,
            bin_id,
            1,
            &[AmoebaDlmmBinLiquidity {
                bin_id,
                option_reserve,
                quote_reserve: 0,
            }],).unwrap();
        prop_assert_eq!(buy.amount_out, desired_option);
        prop_assert_eq!(buy.fills[0].option_reserve_after + buy.amount_out, option_reserve);
        prop_assert_eq!(buy.fills[0].quote_reserve_after, quote_in);

        let sell_input = desired_seed % quote_units + 1;
        let quote_reserve = quote_units.checked_mul(price_multiplier).unwrap();
        let sell = quote_exact_in(
            AmoebaDlmmSwapDirection::OptionForQuote,
            sell_input,
            1,
            bin_id,
            AMOEBA_DLMM_PRICE_SCALE,
            bin_id,
            1,
            &[AmoebaDlmmBinLiquidity {
                bin_id,
                option_reserve: 0,
                quote_reserve,
            }],).unwrap();
        prop_assert_eq!(sell.amount_out, sell_input * price_multiplier);
        prop_assert_eq!(sell.fills[0].quote_reserve_after + sell.amount_out, quote_reserve);
        prop_assert_eq!(sell.fills[0].option_reserve_after, sell_input);
    }

    #[test]
    fn randomized_fees_and_share_withdrawals_are_bounded(
        amount in 2u64..=1_000_000_000_000,
        option_reserve in 0u64..=1_000_000_000,
        quote_reserve in 0u64..=1_000_000_000,
        total_shares in 1u128..=1_000_000_000_000u128,
        burn_seed in any::<u64>(),
    ) {
        let fees = calculate_fees(amount,).unwrap();
        prop_assert_eq!(fees.trade_input + fees.total_fee, amount);
        prop_assert_eq!(fees.lp_fee + fees.protocol_fee, fees.total_fee);
        prop_assert!(fees.protocol_fee <= fees.total_fee);

        let burn = u128::from(burn_seed) % total_shares + 1;
        let withdrawal = calculate_share_withdrawal(
            option_reserve,
            quote_reserve,
            total_shares,
            burn,
        ).unwrap();
        prop_assert!(withdrawal.option_amount <= option_reserve);
        prop_assert!(withdrawal.quote_amount <= quote_reserve);
        if burn == total_shares {
            prop_assert_eq!(withdrawal.option_amount, option_reserve);
            prop_assert_eq!(withdrawal.quote_amount, quote_reserve);
        }
    }

    #[test]
    fn zero_fee_same_bin_round_trip_never_creates_quote_value(
        bin_id in 1u16..=1_000,
        option_reserve in 1u64..=1_000_000,
        desired_seed in any::<u64>(),
    ) {
        let option_amount = desired_seed % option_reserve + 1;
        let quote_in = option_amount.checked_mul(bin_id as u64).unwrap();
        let buy = quote_exact_in(
            AmoebaDlmmSwapDirection::QuoteForOption,
            quote_in,
            1,
            bin_id,
            AMOEBA_DLMM_PRICE_SCALE,
            bin_id,
            1,
            &[AmoebaDlmmBinLiquidity { bin_id, option_reserve, quote_reserve: 0 }],).unwrap();
        let sell = quote_exact_in(
            AmoebaDlmmSwapDirection::OptionForQuote,
            buy.amount_out,
            1,
            bin_id,
            AMOEBA_DLMM_PRICE_SCALE,
            bin_id,
            1,
            &[AmoebaDlmmBinLiquidity {
                bin_id,
                option_reserve: buy.fills[0].option_reserve_after,
                quote_reserve: buy.fills[0].quote_reserve_after,
            }],).unwrap();
        prop_assert!(sell.amount_out <= quote_in);
    }
}
