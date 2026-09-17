#![cfg(feature = "devnet-v3-governance-controller")]

mod g3_light_support;
#[path = "g3_light_support/unified_tests.rs"]
mod unified;
use g3_light_support::*;
use light_token_minter::dlmm_order_state::{derive_order_record, DlmmOrderAction, DlmmOrderRecord};

#[tokio::test]
async fn actual_light_one_hundred_orders_continue_after_cancel_claim_close() {
    let mut f = MarketFixture::new().await;
    let first = f.payer.insecure_clone();
    let second = f.other.insecure_clone();
    f.order(&first, DlmmOrderAction::Initialize, &[]).await;
    let book = f.order_book;
    let key = |n| derive_order_record(&program(), &book, n).0;
    for sequence in 1..=100 {
        let owner = if sequence % 2 == 1 { &first } else { &second };
        let mut witnesses = if sequence > 2 { vec![key(1)] } else { vec![] };
        if sequence > 1 {
            witnesses.push(key(sequence - 1));
        }
        witnesses.push(key(sequence));
        f.order(
            owner,
            DlmmOrderAction::Place {
                expected_sequence: sequence,
                side: 1,
                limit_bin: 20,
                quantity: 10_000,
                post_only: true,
            },
            &witnesses,
        )
        .await;
    }
    let head: DlmmOrderRecord = f.read(key(1)).await;
    let tail: DlmmOrderRecord = f.read(key(100)).await;
    assert_eq!(head.order.next, 2);
    assert_eq!(tail.order.previous, 99);
    f.order(
        &first,
        DlmmOrderAction::Cancel { sequence: 1 },
        &[key(1), key(2)],
    )
    .await;
    f.order(&first, DlmmOrderAction::Claim { sequence: 1 }, &[key(1)])
        .await;
    f.order(&first, DlmmOrderAction::Close { sequence: 1 }, &[key(1)])
        .await;
    f.order(
        &first,
        DlmmOrderAction::Place {
            expected_sequence: 101,
            side: 1,
            limit_bin: 20,
            quantity: 10_000,
            post_only: true,
        },
        &[key(2), key(100), key(101)],
    )
    .await;
    let next: DlmmOrderRecord = f.read(key(2)).await;
    let last: DlmmOrderRecord = f.read(key(101)).await;
    assert_eq!(next.order.previous, 0);
    assert_eq!(last.order.previous, 100);
}

#[tokio::test]
async fn actual_light_orders_persist_partial_fill_cancel_and_claim() {
    for (resting_side, quantity) in [
        (0, UNIT),
        (1, UNIT),
        (0, 250_000),
        (1, 250_000),
        (0, 750_000),
        (1, 750_000),
    ] {
        let mut f = MarketFixture::new().await;
        let maker = f.payer.insecure_clone();
        let taker = f.other.insecure_clone();
        f.order(&maker, DlmmOrderAction::Initialize, &[]).await;
        let key = |seq| derive_order_record(&program(), &f.order_book, seq).0;
        let first = key(1);
        let second = key(2);
        f.order(
            &maker,
            DlmmOrderAction::Place {
                expected_sequence: 1,
                side: resting_side,
                limit_bin: 20,
                quantity: 3 * quantity,
                post_only: true,
            },
            &[first],
        )
        .await;
        let stored: DlmmOrderRecord = f.read(first).await;
        assert_eq!(stored.order.remaining_quantity, 3 * quantity);
        assert_eq!(stored.order.remaining_input, 3 * quantity);
        assert_eq!(
            stored.order.claimable_option + stored.order.claimable_quote,
            0
        );
        // This is a new transaction and a freshly decoded persistent owner record.
        f.order(
            &taker,
            DlmmOrderAction::Place {
                expected_sequence: 2,
                side: 1 - resting_side,
                limit_bin: 20,
                quantity,
                post_only: false,
            },
            &[first, second],
        )
        .await;
        let partial: DlmmOrderRecord = f.read(first).await;
        assert_eq!(partial.order.remaining_quantity, 2 * quantity);
        assert_eq!(partial.order.remaining_input, 2 * quantity);
        assert_eq!(
            partial.order.claimable_option + partial.order.claimable_quote,
            quantity
        );
        let protected = f.snapshot(&[first, second, f.order_book, f.order_option, f.order_quote]);
        let ix = f.order_instruction(
            &taker,
            DlmmOrderAction::Claim { sequence: 1 },
            &[first, second],
        );
        let wrong_owner_before = f.holder_balances(taker.pubkey()).await;
        f.reject(&taker, ix, "wrong-owner-claim", 6007).await;
        assert_eq!(wrong_owner_before, f.holder_balances(taker.pubkey()).await);
        assert_eq!(
            protected,
            f.snapshot(&[first, second, f.order_book, f.order_option, f.order_quote])
        );
        let ix = f.order_instruction(
            &taker,
            DlmmOrderAction::Cancel { sequence: 1 },
            &[first, second],
        );
        f.reject(&taker, ix, "wrong-owner-cancel", 6007).await;
        assert_eq!(
            protected,
            f.snapshot(&[first, second, f.order_book, f.order_option, f.order_quote])
        );
        f.order(
            &maker,
            DlmmOrderAction::Cancel { sequence: 1 },
            &[first, second],
        )
        .await;
        let before_maker = f.holder_balances(maker.pubkey()).await;
        f.order(
            &maker,
            DlmmOrderAction::Claim { sequence: 1 },
            &[first, second],
        )
        .await;
        let after_maker = f.holder_balances(maker.pubkey()).await;
        assert_eq!(
            after_maker.0 - before_maker.0,
            if resting_side == 0 {
                quantity
            } else {
                2 * quantity
            }
        );
        assert_eq!(
            after_maker.1 - before_maker.1,
            if resting_side == 0 {
                2 * quantity
            } else {
                quantity
            }
        );
        // Empty repeat claims may be idempotent, but can never pay twice.
        f.order(
            &maker,
            DlmmOrderAction::Claim { sequence: 1 },
            &[first, second],
        )
        .await;
        assert_eq!(after_maker, f.holder_balances(maker.pubkey()).await);
        f.order(
            &taker,
            DlmmOrderAction::Claim { sequence: 2 },
            &[first, second],
        )
        .await;
        assert_eq!(f.token_balance(f.order_option).await, 0);
        assert_eq!(f.token_balance(f.order_quote).await, 0);
        let maker_final = f.holder_balances(maker.pubkey()).await;
        let taker_final = f.holder_balances(taker.pubkey()).await;
        assert_eq!(maker_final.0 + taker_final.0, 20 * UNIT);
        assert_eq!(maker_final.1 + taker_final.1, 200 * UNIT);
    }
}

#[tokio::test]
async fn actual_light_continuous_writer_issuance_late_deposit_and_buyback() {
    use light_token_minter::{
        ameba_dlmm_instruction::{AmoebaDlmmSwapDirection, SwapAmoebaDlmmExactInV1Params},
        state::{WriterDlmmBinV1, WriterSeriesBookV1, WriterSleeveV1},
        writer_participation_state::WriterContributionV2,
    };
    let mut f = MarketFixture::writer_fixture().await;
    let writer = f.payer.insecure_clone();
    let buyer = f.other.insecure_clone();
    let early_source = f.classic_funds(writer.pubkey(), 100 * UNIT).await;
    let late_source = f.classic_funds(buyer.pubkey(), 30 * UNIT).await;
    let early_key = f.contribute(&writer, early_source, 1, 100 * UNIT).await;
    let early: WriterContributionV2 = f.read(early_key).await;
    assert_eq!(early.principal, 100 * UNIT);
    assert_eq!(f.token_balance(f.cash_key()).await, 100 * UNIT);
    f.initialize_writer_position(&writer).await;
    let ix = f.add_writer_instruction(
        &writer,
        2 * UNIT,
        vec![
            WriterDlmmBinV1 {
                bin_id: 19,
                option_atoms: 0,
                quote_atoms: 950_000,
            },
            WriterDlmmBinV1 {
                bin_id: 20,
                option_atoms: 2 * UNIT,
                quote_atoms: 0,
            },
        ],
    );
    f.execute(&writer, ix, "writer-issue-and-place", None).await;
    let issued: WriterSeriesBookV1 = f.read(f.book).await;
    assert_eq!(issued.records[0].total_physical_supply_atoms, 2 * UNIT);
    assert_eq!(issued.records[0].issuer_controlled_atoms, 2 * UNIT);
    assert_eq!(issued.records[0].external_open_interest_atoms, 0);
    assert_eq!(f.option_supply(), 2 * UNIT);
    f.order(&writer, DlmmOrderAction::Initialize, &[]).await;
    f.order(
        &buyer,
        DlmmOrderAction::Swap {
            params: SwapAmoebaDlmmExactInV1Params {
                direction: AmoebaDlmmSwapDirection::QuoteForOption,
                amount_in: 2 * UNIT,
                minimum_amount_out: 2 * UNIT,
                limit_bin_id: 20,
                deadline_ts: f.expiry,
            },
        },
        &[],
    )
    .await;
    let sold: WriterSleeveV1 = f.read(f.sleeve).await;
    assert_eq!(sold.accounted_asset_atoms, 102 * UNIT);
    let mut clock = f.rpc.context.get_sysvar::<solana_sdk::clock::Clock>();
    clock.unix_timestamp += 1000;
    clock.slot += 1000;
    f.rpc.context.set_sysvar(&clock);
    let late_key = f.contribute(&buyer, late_source, 2, 30 * UNIT).await;
    let late: WriterContributionV2 = f.read(late_key).await;
    let early_after: WriterContributionV2 = f.read(early_key).await;
    assert_eq!(early, early_after);
    assert_eq!(late.entry_ts, early.entry_ts + 1000);
    assert_eq!(late.principal, 30 * UNIT);
    let combined: WriterSleeveV1 = f.read(f.sleeve).await;
    assert_eq!(combined.writer_principal_atoms, 130 * UNIT);
    assert_eq!(combined.accounted_asset_atoms, 132 * UNIT);
    assert_eq!(
        combined.capital_seconds,
        early.interval().weight().unwrap() + late.interval().weight().unwrap()
    );
    let before = f.holder_balances(buyer.pubkey()).await;
    f.order(
        &buyer,
        DlmmOrderAction::Swap {
            params: SwapAmoebaDlmmExactInV1Params {
                direction: AmoebaDlmmSwapDirection::OptionForQuote,
                amount_in: UNIT,
                minimum_amount_out: 950_000,
                limit_bin_id: 19,
                deadline_ts: f.expiry,
            },
        },
        &[],
    )
    .await;
    let after = f.holder_balances(buyer.pubkey()).await;
    assert_eq!(before.0 - after.0, UNIT);
    assert_eq!(after.1 - before.1, 950_000);
    let bought: WriterSeriesBookV1 = f.read(f.book).await;
    assert_eq!(bought.records[0].total_physical_supply_atoms, UNIT);
    assert_eq!(bought.records[0].external_open_interest_atoms, UNIT);
    assert_eq!(bought.records[0].issuer_controlled_atoms, 0);
    assert_eq!(f.option_supply(), UNIT);
    let final_sleeve: WriterSleeveV1 = f.read(f.sleeve).await;
    assert_eq!(final_sleeve.writer_principal_atoms, 130 * UNIT);
    assert_eq!(final_sleeve.accounted_asset_atoms, 132 * UNIT - 950_000);
    assert_eq!(
        f.token_balance(f.cash_key()).await,
        final_sleeve.accounted_asset_atoms
    );
    assert_eq!(f.token_balance(f.quote_vault).await, 0);
    assert_eq!(f.token_balance(f.option_vault).await, 0);
    let writer_wallet = f.holder_balances(writer.pubkey()).await;
    let buyer_wallet = f.holder_balances(buyer.pubkey()).await;
    assert_eq!(writer_wallet.0 + buyer_wallet.0, f.option_supply());
    assert_eq!(
        writer_wallet.1 + buyer_wallet.1 + final_sleeve.accounted_asset_atoms,
        330 * UNIT
    );
    assert_eq!(f.token_balance(early_source).await, 0);
    assert_eq!(f.token_balance(late_source).await, 0);
}
