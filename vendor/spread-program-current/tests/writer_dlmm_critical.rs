//! Bounded native admission/quote tests. No RPC, VM, randomness or CPI mocks.
//! Retirement assertions concern the required burn amount, not execution of a token CPI.
use light_token_minter::{
    ameba_dlmm_math::{AmoebaDlmmBinLiquidity, AmoebaDlmmSwapDirection},
    state::{OptionKind, WriterDlmmBinV1},
    writer_dlmm_math::{
        admit_writer_dlmm_retirement, writer_dlmm_price_bounds, WriterDlmmAdmissionError,
        WriterDlmmBuybackLimits, WriterDlmmCash, WriterDlmmRetirement, WriterDlmmRiskLimits,
        WriterDlmmSeriesLimits,
    },
    writer_dlmm_quote::{
        quote_dlmm_with_orders, quote_writer_dlmm_exact_in, PublicOrderRouteLimits,
        WriterDlmmRouteConfig, WriterDlmmSwapPolicy,
    },
    writer_sleeve_math::{exact_reserve, WriterSecurityMode, WriterSeries},
};

const UNIT: u64 = 1_000_000;

#[test]
fn smaller_writer_fill_preserves_risk_and_exact_input_consent() {
    let book = [WriterSeries {
        external_oi_atoms: 0,
        ..call()
    }];
    let limits = [WriterDlmmSeriesLimits {
        seller_floor_quote_atoms: UNIT,
        ..terms()
    }];
    let mut p = policy(&book, &limits);
    p.cash = WriterDlmmCash {
        assets_atoms: 12 * UNIT,
        principal_atoms: 12 * UNIT,
        allocated_lp_quote_atoms: 0,
    };
    p.risk.operational_buffer_atoms = 0;
    p.risk.security_cap_atoms = 120 * UNIT;
    let mut cfg = config(AmoebaDlmmSwapDirection::QuoteForOption, 20 * UNIT, 240);
    cfg.minimum_amount_out = 0;
    let bins = [WriterDlmmBinV1 {
        bin_id: 40,
        option_atoms: 10 * UNIT,
        quote_atoms: 0,
    }];
    let route_limits = PublicOrderRouteLimits {
        allow_partial: true,
        maximum_option_output: 10 * UNIT,
        maximum_order_fills: 8,
    };
    let result = quote_dlmm_with_orders(cfg, &[], &bins, Some(&p), &[], route_limits).unwrap();
    // Same vector as publicOrdersParticipation.test.ts. Each probe is admitted exactly.
    assert_eq!(result.writer.sold_option_atoms, 625_000);
    assert_eq!(result.writer.net_premium_atoms, 1_250_000);
    assert!(
        result.writer.sold_option_atoms * 12
            <= p.cash.assets_atoms + result.writer.net_premium_atoms
    );
    assert!(quote_dlmm_with_orders(
        cfg,
        &[],
        &bins,
        Some(&p),
        &[],
        PublicOrderRouteLimits {
            allow_partial: false,
            ..route_limits
        }
    )
    .is_err());
    p.risk.security_cap_atoms = 0;
    assert_eq!(
        quote_dlmm_with_orders(cfg, &[], &bins, Some(&p), &[], route_limits)
            .unwrap()
            .quote
            .amount_out,
        0
    );
}

fn call() -> WriterSeries {
    WriterSeries {
        kind: OptionKind::CallSpread,
        strike_price_atomic: 100 * UNIT,
        cap_price_atomic: 112 * UNIT,
        contract_size_atoms: UNIT,
        max_payout_per_contract_atoms: 12 * UNIT,
        external_oi_atoms: 2 * UNIT,
    }
}

fn terms() -> WriterDlmmSeriesLimits {
    WriterDlmmSeriesLimits {
        conservative_claim_value_atoms: 3 * UNIT,
        seller_floor_quote_atoms: 3 * UNIT,
        monthly_buyback_cap_atoms: 20 * UNIT,
        transaction_buyback_cap_atoms: 10 * UNIT,
    }
}

fn policy<'a>(
    book: &'a [WriterSeries],
    terms: &'a [WriterDlmmSeriesLimits],
) -> WriterDlmmSwapPolicy<'a> {
    WriterDlmmSwapPolicy {
        eligible: true,
        participation: None,
        book,
        series_index: 0,
        cash: WriterDlmmCash {
            assets_atoms: 100 * UNIT,
            principal_atoms: 100 * UNIT,
            allocated_lp_quote_atoms: 4 * UNIT,
        },
        risk: WriterDlmmRiskLimits {
            operational_buffer_atoms: UNIT,
            worst_drawdown_ppm: UNIT,
            lower_drawdown_ppm: UNIT,
            upper_drawdown_ppm: UNIT,
            lower_tail_max_settlement_atomic: 88 * UNIT,
            upper_tail_min_settlement_atomic: 112 * UNIT,
            security_mode: WriterSecurityMode::ExactExternalEnvelope,
            security_cap_atoms: 1_000 * UNIT,
        },
        buyback: WriterDlmmBuybackLimits {
            monthly_buyback_cap_atoms: 20 * UNIT,
            transaction_buyback_cap_atoms: 10 * UNIT,
            reserve_release_spend_ratio_ppm: 500_000,
            tick_size_quote_atoms: 50_000,
            price_separation_ticks: 1,
            round_trip_fee_quote_atoms: 0,
        },
        series_limits: terms,
        month_spent_atoms: 0,
        series_month_spent_atoms: 0,
    }
}

fn config(
    direction: AmoebaDlmmSwapDirection,
    amount_in: u64,
    limit_bin_id: u16,
) -> WriterDlmmRouteConfig {
    WriterDlmmRouteConfig {
        direction,
        amount_in,
        minimum_amount_out: 1,
        limit_bin_id,
        tick_size_quote_atomic: 50_000,
        maximum_bin_id: 240,
        maximum_bins: 8,
        unloaded_ordinary_boundary: None,
    }
}

#[test]
fn critical_1_buyback_gates_and_ordinary_fallback() {
    // One admissible control prevents an always-reject implementation from passing.
    let book = [call()];
    let limits = [WriterDlmmSeriesLimits {
        transaction_buyback_cap_atoms: UNIT,
        monthly_buyback_cap_atoms: UNIT,
        ..terms()
    }];
    let mut p = policy(&book, &limits);
    p.buyback.transaction_buyback_cap_atoms = UNIT;
    p.buyback.monthly_buyback_cap_atoms = UNIT;
    let retirement = WriterDlmmRetirement {
        series_index: 0,
        retired_atoms: UNIT,
        cost_atoms: UNIT,
        series_month_spent_atoms: 0,
    };
    let admitted = admit_writer_dlmm_retirement(
        &book,
        p.cash,
        &p.risk,
        &p.buyback,
        &limits,
        &[retirement],
        0,
        3 * UNIT,
        false,
    )
    .unwrap();
    assert_eq!(admitted.released_reserve_atoms, 12 * UNIT);

    for case in [
        "zero reserve release",
        "sleeve transaction cap",
        "sleeve monthly cap",
        "series transaction cap",
        "series monthly cap",
        "fee-free protected floor",
    ] {
        let mut book = vec![call()];
        let mut limits = vec![terms()];
        if case == "zero reserve release" {
            book.push(WriterSeries {
                kind: OptionKind::PutSpread,
                cap_price_atomic: 88 * UNIT,
                ..call()
            });
            limits.push(terms());
        }
        if case == "series transaction cap" {
            limits[0].transaction_buyback_cap_atoms = UNIT - 1;
        }
        if case == "series monthly cap" {
            limits[0].monthly_buyback_cap_atoms = UNIT;
        }
        let mut p = policy(&book, &limits);
        let mut retirement = retirement;
        let mut writer_bin_id = 40; // $2 bid, below the protected floor.
        let expected = match case {
            "zero reserve release" => WriterDlmmAdmissionError::NoReserveReduction,
            "fee-free protected floor" => {
                // With no fees, the buyback ceiling is the seller floor minus one $0.05 tick.
                assert_eq!(
                    writer_dlmm_price_bounds(3 * UNIT, 50_000, 1).unwrap(),
                    (3_000_000, 2_950_000, 0)
                );
                p.buyback.round_trip_fee_quote_atoms = 0;
                retirement.cost_atoms = 2_950_001; // One atom above the inclusive bound.
                let at_bound = WriterDlmmRetirement {
                    cost_atoms: 2_950_000,
                    ..retirement
                };
                assert!(admit_writer_dlmm_retirement(
                    &book,
                    p.cash,
                    &p.risk,
                    &p.buyback,
                    &limits,
                    &[at_bound],
                    0,
                    0,
                    false
                )
                .is_ok());
                writer_bin_id = 60; // $3.00 exceeds the protected $2.95 buyback ceiling.
                WriterDlmmAdmissionError::PriceSeparation
            }
            _ => WriterDlmmAdmissionError::BudgetExceeded,
        };
        match case {
            "sleeve transaction cap" => p.buyback.transaction_buyback_cap_atoms = UNIT - 1,
            "sleeve monthly cap" => {
                p.buyback.monthly_buyback_cap_atoms = UNIT;
                p.month_spent_atoms = 1;
            }
            "series monthly cap" => retirement.series_month_spent_atoms = 1,
            _ => {}
        }
        assert_eq!(
            admit_writer_dlmm_retirement(
                &book,
                p.cash,
                &p.risk,
                &p.buyback,
                &limits,
                &[retirement],
                p.month_spent_atoms,
                0,
                false
            ),
            Err(expected),
            "{case}"
        );

        // Exhaust the selected cap for routing: a rejected/clipped writer bid must not
        // consume input, fees or the bin allowance before the ordinary $1.40 bid.
        let mut route_limits = limits.clone();
        if case == "series transaction cap" {
            route_limits[0].transaction_buyback_cap_atoms = 0;
        }
        p.series_limits = &route_limits;
        match case {
            "sleeve transaction cap" => p.buyback.transaction_buyback_cap_atoms = 0,
            "sleeve monthly cap" => p.month_spent_atoms = p.buyback.monthly_buyback_cap_atoms,
            "series monthly cap" => {
                p.series_month_spent_atoms = limits[0].monthly_buyback_cap_atoms
            }
            _ => {}
        }
        let ordinary = [AmoebaDlmmBinLiquidity {
            bin_id: 28,
            option_reserve: 0,
            quote_reserve: 10 * UNIT,
        }];
        let writer = [WriterDlmmBinV1 {
            bin_id: writer_bin_id,
            quote_atoms: 4 * UNIT,
            ..Default::default()
        }];
        let mut route_config = config(AmoebaDlmmSwapDirection::OptionForQuote, UNIT, 28);
        route_config.maximum_bins = 1;
        let result =
            quote_writer_dlmm_exact_in(route_config, &ordinary, &writer, Some(&p)).unwrap();
        assert!(result.writer_fills.is_empty(), "{case}");
        assert_eq!(result.writer, Default::default(), "{case}");
        let ordinary_only = quote_writer_dlmm_exact_in(route_config, &ordinary, &[], None).unwrap();
        assert_eq!(
            result, ordinary_only,
            "writer rejection contaminated ordinary route: {case}"
        );
        assert_eq!(result.quote.amount_out, 1_400_000, "{case}");
    }
}

#[test]
fn critical_2_mixed_fill_conservation_and_required_retirement() {
    let book = [call()];
    let limits = [WriterDlmmSeriesLimits {
        seller_floor_quote_atoms: 1_500_000,
        ..terms()
    }];
    let p = policy(&book, &limits);
    // Same-price ordinary inventory wins the tie; both sources execute without fees.
    let ordinary = [AmoebaDlmmBinLiquidity {
        bin_id: 40,
        option_reserve: 300_000,
        quote_reserve: 100_000,
    }];
    let writer = [WriterDlmmBinV1 {
        bin_id: 40,
        option_atoms: 2 * UNIT,
        quote_atoms: 4 * UNIT,
    }];
    let sale = quote_writer_dlmm_exact_in(
        config(AmoebaDlmmSwapDirection::QuoteForOption, 2 * UNIT, 40),
        &ordinary,
        &writer,
        Some(&p),
    )
    .unwrap();
    assert_eq!((sale.ordinary_fills.len(), sale.writer_fills.len()), (1, 1));
    let (o, w) = (&sale.ordinary_fills[0], &sale.writer_fills[0]);
    assert_eq!(
        (o.trade_input, o.amount_out, o.lp_fee, o.quote_reserve_after),
        (600_000, 300_000, 0, 700_000)
    );
    assert_eq!(
        (w.trade_input, w.amount_out, w.lp_fee),
        (1_400_000, 700_000, 0)
    );
    assert_eq!(
        (
            sale.quote.total_fee,
            sale.quote.protocol_fee,
            sale.quote.lp_fee
        ),
        (0, 0, 0)
    );
    assert_eq!(
        (
            sale.writer.gross_premium_atoms,
            sale.writer.net_premium_atoms
        ),
        (1_400_000, 1_400_000)
    );
    assert_eq!(sale.writer.sold_option_atoms, 700_000);
    assert_eq!(sale.writer.retired_option_atoms, 0);
    assert_eq!(
        2 * UNIT,
        (o.quote_reserve_after - ordinary[0].quote_reserve)
            + sale.writer.net_premium_atoms
            + sale.writer.lp_fee_atoms
            + sale.quote.protocol_fee
    );
    assert_eq!(
        sale.quote.amount_out,
        (ordinary[0].option_reserve - o.option_reserve_after)
            + (writer[0].option_atoms - w.option_reserve_after)
    );
    assert_eq!(
        w.quote_reserve_after, writer[0].quote_atoms,
        "swept premium must not also become bid reserve"
    );

    // Reverse direction retires the exact writer fill. No option tokens become fees.
    let ordinary = [AmoebaDlmmBinLiquidity {
        bin_id: 20,
        option_reserve: 100_000,
        quote_reserve: 300_000,
    }];
    let writer = [WriterDlmmBinV1 {
        bin_id: 20,
        option_atoms: 0,
        quote_atoms: 4 * UNIT,
    }];
    let buyback = quote_writer_dlmm_exact_in(
        config(AmoebaDlmmSwapDirection::OptionForQuote, 2 * UNIT, 20),
        &ordinary,
        &writer,
        Some(&p),
    )
    .unwrap();
    assert_eq!(
        (buyback.ordinary_fills.len(), buyback.writer_fills.len()),
        (1, 1)
    );
    let (o, w) = (&buyback.ordinary_fills[0], &buyback.writer_fills[0]);
    assert_eq!(
        (o.trade_input, o.lp_fee, o.option_reserve_after),
        (300_000, 0, 400_000)
    );
    assert_eq!(
        (w.trade_input, w.lp_fee, w.quote_reserve_after),
        (1_700_000, 0, 2_300_000)
    );
    assert_eq!(
        (
            buyback.writer.retired_option_atoms,
            buyback.writer.spent_quote_atoms
        ),
        (1_700_000, 1_700_000)
    );
    assert_eq!(
        (
            buyback.quote.total_fee,
            buyback.quote.protocol_fee,
            buyback.quote.lp_fee
        ),
        (0, 0, 0)
    );
    assert_eq!(
        (
            buyback.writer.gross_premium_atoms,
            buyback.writer.sold_option_atoms
        ),
        (0, 0)
    );
    assert_eq!(
        2 * UNIT,
        (o.option_reserve_after - ordinary[0].option_reserve)
            + buyback.writer.retired_option_atoms
            + buyback.quote.protocol_fee
    );
    assert_eq!(
        buyback.quote.amount_out,
        (ordinary[0].quote_reserve - o.quote_reserve_after)
            + (writer[0].quote_atoms - w.quote_reserve_after)
    );
    assert_eq!(
        w.option_reserve_after, 0,
        "required retirement must not also become writer inventory"
    );
    let admission = admit_writer_dlmm_retirement(
        &book,
        p.cash,
        &p.risk,
        &p.buyback,
        &limits,
        &[WriterDlmmRetirement {
            series_index: 0,
            retired_atoms: buyback.writer.retired_option_atoms,
            cost_atoms: buyback.writer.spent_quote_atoms,
            series_month_spent_atoms: 0,
        }],
        0,
        w.quote_reserve_after,
        false,
    )
    .unwrap();
    let after_book = [WriterSeries {
        external_oi_atoms: book[0].external_oi_atoms - buyback.writer.retired_option_atoms,
        ..book[0]
    }];
    assert_eq!(after_book[0].external_oi_atoms, 300_000);
    assert_eq!(admission.assets_after_atoms, 98_300_000);
    assert_eq!(
        admission.reserve_after,
        exact_reserve(&after_book, 88 * UNIT, 112 * UNIT).unwrap()
    );
    assert_eq!(
        (
            admission.reserve_before_atoms,
            admission.reserve_after.reserve_atoms,
            admission.released_reserve_atoms
        ),
        (24_000_000, 3_600_000, 20_400_000)
    );
}
