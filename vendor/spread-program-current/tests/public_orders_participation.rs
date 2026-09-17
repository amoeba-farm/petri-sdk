use light_token_minter::{
    ameba_dlmm_math::{AmoebaDlmmBinLiquidity, AmoebaDlmmSwapDirection},
    dlmm_order_math::{OrderBalance, OrderSide},
    dlmm_order_state::DlmmOrder,
    writer_dlmm_quote::{quote_dlmm_with_orders, PublicOrderRouteLimits, WriterDlmmRouteConfig},
};
use solana_program::pubkey::Pubkey;
const UNIT: u64 = 1_000_000;

#[test]
fn new_instruction_tags_have_exact_wire_bytes_and_reject_trailing_data() {
    use borsh::{BorshDeserialize, BorshSerialize};
    use light_token_minter::{
        dlmm_order_state::DlmmOrderAction, instruction::VaultInstruction,
        writer_participation_state::WriterParticipationActionV2,
    };
    let orders = VaultInstruction::ManageDlmmOrdersV1 {
        params: DlmmOrderAction::Place {
            expected_sequence: 0x0102030405060708,
            side: 0,
            limit_bin: 20,
            quantity: UNIT,
            post_only: true,
        },
    };
    let bytes = orders.try_to_vec().unwrap();
    assert_eq!(
        bytes,
        [188, 1, 8, 7, 6, 5, 4, 3, 2, 1, 0, 20, 0, 64, 66, 15, 0, 0, 0, 0, 0, 1]
    );
    assert_eq!(VaultInstruction::try_from_slice(&bytes).unwrap(), orders);
    let mut invalid = bytes;
    invalid.push(0);
    assert!(VaultInstruction::try_from_slice(&invalid).is_err());
    let funding = VaultInstruction::ManageWriterParticipationV2 {
        params: WriterParticipationActionV2::Contribute {
            nonce: 7,
            amount_atoms: UNIT,
        },
    };
    assert_eq!(
        funding.try_to_vec().unwrap(),
        [160, 1, 7, 0, 0, 0, 0, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0]
    );
    let expire = VaultInstruction::ManageWriterParticipationV2 {
        params: WriterParticipationActionV2::ExpireUnactivatedV3,
    };
    assert_eq!(expire.try_to_vec().unwrap(), [160, 6]);
    assert_eq!(VaultInstruction::try_from_slice(&[160, 6]).unwrap(), expire);
    assert!(VaultInstruction::try_from_slice(&[160, 7]).is_err());
    assert!(VaultInstruction::try_from_slice(&[188, 8]).is_err());
}
fn order(sequence: u64, side: OrderSide, bin: u16, quantity: u64) -> DlmmOrder {
    let mut order = DlmmOrder {
        owner: Pubkey::new_unique(),
        sequence,
        side: if side == OrderSide::Bid { 0 } else { 1 },
        limit_bin: bin,
        original_quantity: quantity,
        ..DlmmOrder::default()
    };
    order.set_balance(OrderBalance::funded(side, quantity, u64::from(bin) * 50_000).unwrap());
    order
}
fn config(amount: u64, partial: bool) -> WriterDlmmRouteConfig {
    WriterDlmmRouteConfig {
        direction: AmoebaDlmmSwapDirection::QuoteForOption,
        amount_in: amount,
        minimum_amount_out: if partial { 0 } else { 1 },
        limit_bin_id: 240,
        tick_size_quote_atomic: 50_000,
        maximum_bin_id: 240,
        maximum_bins: 8,
        unloaded_ordinary_boundary: None,
    }
}
fn limits(partial: bool) -> PublicOrderRouteLimits {
    PublicOrderRouteLimits {
        allow_partial: partial,
        maximum_option_output: u64::MAX,
        maximum_order_fills: 8,
    }
}

#[test]
fn ordinary_then_fifo_orders_at_same_price_and_better_order_before_worse_lp() {
    let ordinary = [
        AmoebaDlmmBinLiquidity {
            bin_id: 20,
            option_reserve: 2 * UNIT,
            quote_reserve: 0,
        },
        AmoebaDlmmBinLiquidity {
            bin_id: 40,
            option_reserve: 100 * UNIT,
            quote_reserve: 0,
        },
    ];
    let orders = [
        order(1, OrderSide::Ask, 20, 3 * UNIT),
        order(2, OrderSide::Ask, 20, 4 * UNIT),
    ];
    let result = quote_dlmm_with_orders(
        config(7 * UNIT, false),
        &ordinary,
        &[],
        None,
        &orders,
        limits(false),
    )
    .unwrap();
    assert_eq!(result.quote.amount_out, 7 * UNIT);
    assert_eq!(result.ordinary_fills.len(), 1);
    assert_eq!(result.ordinary_fills[0].amount_out, 2 * UNIT);
    assert_eq!(
        result
            .order_fills
            .iter()
            .map(|fill| (fill.sequence, fill.quantity))
            .collect::<Vec<_>>(),
        vec![(1, 3 * UNIT), (2, 2 * UNIT)]
    );
    assert_eq!(
        result.order_fills[1].balance_after.remaining_quantity,
        2 * UNIT
    );
    assert_eq!(
        result.order_fills[1].balance_after.claimable_quote,
        2 * UNIT
    );
    assert!(result.writer_fills.is_empty());
}

#[test]
fn many_orders_one_bin_is_bounded_and_atomic_swap_does_not_become_partial() {
    let orders: Vec<_> = (1..=32)
        .map(|id| order(id, OrderSide::Ask, 20, UNIT))
        .collect();
    let partial = quote_dlmm_with_orders(
        config(32 * UNIT, true),
        &[],
        &[],
        None,
        &orders[..16],
        limits(true),
    )
    .unwrap();
    assert_eq!(partial.order_fills.len(), 8);
    assert_eq!(partial.quote.amount_in, 8 * UNIT);
    assert_eq!(partial.quote.amount_out, 8 * UNIT);
    assert_eq!(partial.quote.fills.len(), 1);
    assert!(quote_dlmm_with_orders(
        config(32 * UNIT, false),
        &[],
        &[],
        None,
        &orders,
        limits(false)
    )
    .is_err());
    let remaining = quote_dlmm_with_orders(
        config(24 * UNIT, true),
        &[],
        &[],
        None,
        &orders[8..24],
        limits(true),
    )
    .unwrap();
    assert_eq!(remaining.order_fills[0].sequence, 9);
}

#[test]
fn omitted_better_ordinary_liquidity_and_fifo_substitution_are_rejected() {
    let mut empty = config(UNIT, true);
    empty.unloaded_ordinary_boundary = Some(20);
    assert!(quote_dlmm_with_orders(empty, &[], &[], None, &[], limits(true)).is_err());
    let mut input = config(UNIT, false);
    input.unloaded_ordinary_boundary = Some(10);
    let orders = [order(1, OrderSide::Ask, 20, UNIT)];
    assert!(quote_dlmm_with_orders(input, &[], &[], None, &orders, limits(false)).is_err());
    let reversed = [
        order(2, OrderSide::Ask, 20, UNIT),
        order(1, OrderSide::Ask, 20, UNIT),
    ];
    assert!(quote_dlmm_with_orders(
        config(UNIT, false),
        &[],
        &[],
        None,
        &reversed,
        limits(false)
    )
    .is_err());
}

#[test]
fn price_improvement_never_buys_more_than_signed_size() {
    let orders = [order(1, OrderSide::Ask, 10, 100 * UNIT)];
    let result = quote_dlmm_with_orders(
        config(10 * UNIT, true),
        &[],
        &[],
        None,
        &orders,
        PublicOrderRouteLimits {
            maximum_option_output: 10 * UNIT,
            ..limits(true)
        },
    )
    .unwrap();
    assert_eq!(result.quote.amount_in, 5 * UNIT);
    assert_eq!(result.quote.amount_out, 10 * UNIT);
}

#[test]
fn mirror_sell_consumes_bid_cash_and_does_not_create_asks() {
    let mut input = config(3 * UNIT, false);
    input.direction = AmoebaDlmmSwapDirection::OptionForQuote;
    input.limit_bin_id = 1;
    let orders = [
        order(1, OrderSide::Bid, 20, 2 * UNIT),
        order(2, OrderSide::Bid, 20, 3 * UNIT),
    ];
    let result = quote_dlmm_with_orders(input, &[], &[], None, &orders, limits(false)).unwrap();
    assert_eq!(result.quote.amount_out, 3 * UNIT);
    assert_eq!(
        result.order_fills[0].balance_after.claimable_option,
        2 * UNIT
    );
    assert_eq!(result.order_fills[0].balance_after.remaining_quantity, 0);
    assert_eq!(
        result.order_fills[1].balance_after.remaining_input,
        2 * UNIT
    );
}
