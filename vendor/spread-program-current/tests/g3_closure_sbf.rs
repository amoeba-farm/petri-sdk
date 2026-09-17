#![cfg(feature = "devnet-v3-governance-controller")]
//! Bounded integration extension. These tests declare the existing prepared
//! market/gate fixture; they do not claim the full Q1 fresh bootstrap.
#[allow(dead_code)]
mod g3_light_support;
#[path = "g3_light_support/real_transport.rs"]
mod transport;
use g3_light_support::*;
use light_token_minter::dlmm_order_state::{derive_order_record, DlmmOrderAction, DlmmOrderRecord};
use light_token_minter::{
    error::VaultError,
    instruction::{ReconcileWriterSupplyV1Params, VaultInstruction},
    state::*,
    writer_participation_state::{
        derive_contribution, WriterContributionV2, WriterParticipationActionV2,
    },
};
use solana_sdk::{clock::Clock, instruction::AccountMeta, pubkey::Pubkey};
use solana_sdk::{instruction::InstructionError, transaction::TransactionError};
use solana_system_interface::program as system_program;
use transport::RealTransport;

fn metas(keys: &[Pubkey], writable: &[usize]) -> Vec<AccountMeta> {
    keys.iter()
        .enumerate()
        .map(|(i, k)| {
            if writable.contains(&i) {
                AccountMeta::new(*k, i == 0)
            } else {
                AccountMeta::new_readonly(*k, i == 0)
            }
        })
        .collect()
}

fn send(
    f: &mut MarketFixture,
    t: &RealTransport,
    signer: &Keypair,
    request: serde_json::Value,
    records: &[solana_sdk::pubkey::Pubkey],
) {
    let tx = t.package_transaction(f, signer, request, records);
    let packet = bincode::serialize(&tx).unwrap().len();
    let hash = solana_sdk::hash::hash(&tx.message.serialize());
    let result = f.rpc.context.send_transaction(tx).unwrap();
    assert!(result.compute_units_consumed <= 1_000_000);
    println!(
        "closure packaged-message={hash} packet={packet} compute={}",
        result.compute_units_consumed
    );
    f.rpc.context.expire_blockhash();
}

#[tokio::test]
async fn issued_writer_late_lots_external_burn_reconcile_and_no_principal_refund() {
    let mut f = MarketFixture::writer_fixture().await;
    f.rpc.context = f
        .rpc
        .context
        .clone()
        .with_sigverify(true)
        .with_transaction_history(1024);
    let writer = f.payer.insecure_clone();
    let buyer = f.other.insecure_clone();
    let source = f.classic_funds(writer.pubkey(), 100 * UNIT).await;
    let early_key = f.contribute(&writer, source, 1, 100 * UNIT).await;
    let early: WriterContributionV2 = f.read(early_key).await;
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
    f.execute(&writer, ix, "closure-actual-issuance", None)
        .await;
    let t = RealTransport::create(&mut f.rpc, &writer);
    let mut addresses = f
        .order_instruction(&buyer, DlmmOrderAction::Initialize, &[])
        .accounts
        .iter()
        .map(|m| m.pubkey)
        .collect::<Vec<_>>();
    addresses.extend(
        f.order_instruction(&writer, DlmmOrderAction::Initialize, &[])
            .accounts
            .iter()
            .map(|m| m.pubkey),
    );
    t.extend(&mut f.rpc, &writer, &addresses);
    t.freeze(&mut f.rpc, &writer);
    send(
        &mut f,
        &t,
        &writer,
        serde_json::json!({"kind":"initialize"}),
        &[],
    );
    let swap = |direction: &str, amount: u64, minimum: u64, price: u64, expiry: u64| {
        serde_json::json!({
        "kind":"swap","direction":direction,"amountIn":amount.to_string(),"minimumAmountOut":minimum.to_string(),
        "limitPriceAtoms":price.to_string(),"deadlineTs":expiry.to_string()})
    };
    let expiry = f.expiry;
    let protected = [
        f.sleeve,
        f.book,
        f.market,
        f.pool,
        f.option,
        f.option_vault,
        f.quote_vault,
        f.cash_key(),
        f.policy_key(),
        light_token::instruction::derive_token_ata(&buyer.pubkey(), &f.option),
        light_token::instruction::derive_token_ata(&buyer.pubkey(), &f.quote),
    ];
    let before = f.snapshot(&protected);
    let rejected = t.package_transaction(
        &f,
        &buyer,
        swap("QuoteForOption", 3 * UNIT, 3 * UNIT, UNIT, expiry),
        &[],
    );
    let result = f.rpc.context.send_transaction(rejected).unwrap_err();
    assert_eq!(
        result.err,
        TransactionError::InstructionError(
            2,
            InstructionError::Custom(VaultError::InsufficientAmoebaDlmmLiquidity as u32)
        )
    );
    assert_eq!(
        before,
        f.snapshot(&protected),
        "tentative writer sales must roll back"
    );
    f.rpc.context.expire_blockhash();
    send(
        &mut f,
        &t,
        &buyer,
        swap("QuoteForOption", 2 * UNIT, 2 * UNIT, UNIT, expiry),
        &[],
    );
    let mut clock = f.rpc.context.get_sysvar::<Clock>();
    clock.unix_timestamp += 1000;
    clock.slot += 1000;
    f.rpc.context.set_sysvar(&clock);
    let late_source = f.classic_funds(buyer.pubkey(), 30 * UNIT).await;
    let late_key = f.contribute(&buyer, late_source, 2, 30 * UNIT).await;
    let late: WriterContributionV2 = f.read(late_key).await;
    assert_eq!(f.read::<WriterContributionV2>(early_key).await, early);
    assert_eq!(late.entry_ts, early.entry_ts + 1000);
    let child = derive_contribution(&program(), &f.sleeve, &buyer.pubkey(), 3).0;
    let split = govern(
        metas(
            &[
                buyer.pubkey(),
                f.sleeve,
                late_key,
                child,
                writer.pubkey(),
                system_program::id(),
            ],
            &[0, 2, 3],
        ),
        VaultInstruction::ManageWriterParticipationV2 {
            params: WriterParticipationActionV2::Split {
                nonce: 3,
                principal_atoms: 10 * UNIT,
            },
        },
    );
    f.execute(&buyer, split, "closure-late-receipt-split-transfer", None)
        .await;
    let split_lot: WriterContributionV2 = f.read(child).await;
    let retained: WriterContributionV2 = f.read(late_key).await;
    assert_eq!(split_lot.entry_ts, late.entry_ts);
    assert_eq!(split_lot.owner, writer.pubkey());
    assert_eq!(
        split_lot.interval().weight().unwrap() + retained.interval().weight().unwrap(),
        late.interval().weight().unwrap()
    );
    send(
        &mut f,
        &t,
        &buyer,
        swap("OptionForQuote", UNIT, 950_000, 950_000, expiry),
        &[],
    );
    assert_eq!(f.option_supply(), UNIT);
    // The option is a classic-SPL mint: exit Light through its supported SPL
    // interface, then burn with the mint's actual owner program.
    let ata =
        spl_associated_token_account::get_associated_token_address(&buyer.pubkey(), &f.option);
    let (interface, bump) = light_token::spl_interface::get_spl_interface_pda_and_bump(&f.option);
    let exit = light_token::instruction::TransferToSpl {
        source: light_token::instruction::derive_token_ata(&buyer.pubkey(), &f.option),
        destination_spl_token_account: ata,
        amount: 250_000,
        authority: buyer.pubkey(),
        mint: f.option,
        payer: buyer.pubkey(),
        spl_interface_pda: interface,
        spl_interface_pda_bump: bump,
        decimals: 6,
        spl_token_program: spl_token::id(),
    }
    .instruction()
    .unwrap();
    setup_tx(
        &mut f.rpc,
        &buyer,
        &[
            spl_associated_token_account::instruction::create_associated_token_account_idempotent(
                &buyer.pubkey(),
                &buyer.pubkey(),
                &f.option,
                &spl_token::id(),
            ),
            exit,
            spl_token::instruction::burn(
                &spl_token::id(),
                &ata,
                &f.option,
                &buyer.pubkey(),
                &[],
                250_000,
            )
            .unwrap(),
        ],
        &[],
    )
    .await;
    assert_eq!(f.option_supply(), 750_000);
    let base = f.order_instruction(&buyer, DlmmOrderAction::Initialize, &[]);
    let keys = [
        buyer.pubkey(),
        f.config,
        f.sleeve,
        f.group,
        f.book,
        f.snapshot_key(),
        f.market,
        f.option,
        base.accounts[28].pubkey,
        base.accounts[29].pubkey,
        base.accounts[17].pubkey,
        base.accounts[15].pubkey,
        base.accounts[16].pubkey,
        spl_token::id(),
        system_program::id(),
        f.policy_key(),
    ];
    let reconcile = govern(
        metas(&keys, &[2, 4, 6, 7, 8, 9, 10]),
        VaultInstruction::ReconcileWriterSupplyV1 {
            params: ReconcileWriterSupplyV1Params {
                series_index: 0,
                target_kind: 0,
            },
        },
    );
    f.execute(
        &buyer,
        reconcile.clone(),
        "closure-external-burn-reconcile",
        None,
    )
    .await;
    let reconciled: WriterSeriesBookV1 = f.read(f.book).await;
    assert_eq!(reconciled.records[0].external_open_interest_atoms, 750_000);
    assert_eq!(reconciled.records[0].total_physical_supply_atoms, 750_000);
    let sleeve: WriterSleeveV1 = f.read(f.sleeve).await;
    f.execute(
        &buyer,
        reconcile.clone(),
        "closure-repeat-reconcile-no-release",
        None,
    )
    .await;
    assert_eq!(f.read::<WriterSleeveV1>(f.sleeve).await, sleeve);
    let exit = light_token::instruction::TransferToSpl {
        source: light_token::instruction::derive_token_ata(&buyer.pubkey(), &f.option),
        destination_spl_token_account: ata,
        amount: 750_000,
        authority: buyer.pubkey(),
        mint: f.option,
        payer: buyer.pubkey(),
        spl_interface_pda: interface,
        spl_interface_pda_bump: bump,
        decimals: 6,
        spl_token_program: spl_token::id(),
    }
    .instruction()
    .unwrap();
    setup_tx(
        &mut f.rpc,
        &buyer,
        &[
            exit,
            spl_token::instruction::burn(
                &spl_token::id(),
                &ata,
                &f.option,
                &buyer.pubkey(),
                &[],
                750_000,
            )
            .unwrap(),
        ],
        &[],
    )
    .await;
    f.execute(
        &buyer,
        reconcile,
        "closure-zero-supply-after-real-issuance",
        None,
    )
    .await;
    let zero: WriterSeriesBookV1 = f.read(f.book).await;
    assert_eq!(zero.records[0].external_open_interest_atoms, 0);
    assert_eq!(zero.records[0].total_physical_supply_atoms, 0);
    assert_eq!(f.option_supply(), 0);
    let sleeve: WriterSleeveV1 = f.read(f.sleeve).await;
    // An issued active sleeve cannot become principal-only failed funding at expiry.
    clock.unix_timestamp = expiry as i64;
    clock.slot += 1;
    f.rpc.context.set_sysvar(&clock);
    let expire = govern(
        metas(
            &[
                buyer.pubkey(),
                f.config,
                f.sleeve,
                f.group,
                f.book,
                f.snapshot_key(),
                f.cash_key(),
                f.policy_key(),
            ],
            &[0, 2, 3, 4],
        ),
        VaultInstruction::ManageWriterParticipationV2 {
            params: WriterParticipationActionV2::ExpireUnactivatedV3,
        },
    );
    let before = f.snapshot(&protected);
    f.reject(
        &buyer,
        expire,
        "closure-active-issued-principal-refund-rejected",
        VaultError::InvalidWriterLifecycle as u32,
    )
    .await;
    assert_eq!(before, f.snapshot(&protected));
    assert_eq!(f.read::<WriterContributionV2>(early_key).await, early);
    assert_eq!(sleeve.writer_principal_atoms, 130 * UNIT);
    assert_eq!(sleeve.accounted_asset_atoms, 132 * UNIT - 950_000);
    assert_eq!(
        f.token_balance(f.cash_key()).await,
        sleeve.accounted_asset_atoms
    );
    println!("closure assertions=issuance,sale,late-weight-preservation,split-transfer,buyback,external-burn,reconcile-once,active-refund-reject,exact-input-rollback,zero-fees");
}

#[tokio::test]
async fn packaged_orders_real_frozen_alt_partial_fill_restart_repost_and_replay() {
    let mut f = MarketFixture::new().await;
    f.rpc.context = f
        .rpc
        .context
        .clone()
        .with_sigverify(true)
        .with_transaction_history(1024);
    let maker = f.payer.insecure_clone();
    let taker = f.other.insecure_clone();
    let t = RealTransport::create(&mut f.rpc, &maker);
    let keys = (1..=4)
        .map(|n| derive_order_record(&program(), &f.order_book, n).0)
        .collect::<Vec<_>>();
    let mut addresses = Vec::new();
    for owner in [&maker, &taker] {
        addresses.extend(
            f.order_instruction(owner, DlmmOrderAction::Initialize, &[])
                .accounts
                .iter()
                .map(|m| m.pubkey),
        );
    }
    addresses.extend(&keys);
    t.extend(&mut f.rpc, &maker, &addresses);
    t.freeze(&mut f.rpc, &maker);
    send(
        &mut f,
        &t,
        &maker,
        serde_json::json!({"kind":"initialize"}),
        &[],
    );
    send(
        &mut f,
        &t,
        &maker,
        serde_json::json!({"kind":"place","expectedSequence":"1","side":"Ask","limitPriceAtoms":"1000000","quantityAtoms":"750000","postOnly":true}),
        &keys[..1],
    );
    let reloaded: DlmmOrderRecord = f.read(keys[0]).await;
    assert_eq!(reloaded.order.remaining_quantity, 750_000);
    assert_eq!(reloaded.order.claimable_quote, 0);
    send(
        &mut f,
        &t,
        &taker,
        serde_json::json!({"kind":"place","expectedSequence":"2","side":"Bid","limitPriceAtoms":"1000000","quantityAtoms":"250000","postOnly":false}),
        &keys[..2],
    );
    assert_eq!(
        f.read::<DlmmOrderRecord>(keys[0])
            .await
            .order
            .remaining_quantity,
        500_000
    );
    let protected = [
        keys[0],
        keys[1],
        f.order_book,
        f.order_option,
        f.order_quote,
    ];
    let before = f.snapshot(&protected);
    let tx = t.package_transaction(
        &f,
        &taker,
        serde_json::json!({"kind":"claim","sequence":"1"}),
        &keys[..1],
    );
    let error = f.rpc.context.send_transaction(tx).unwrap_err();
    assert_eq!(
        error.err,
        TransactionError::InstructionError(2, InstructionError::Custom(6007))
    );
    assert_eq!(before, f.snapshot(&protected));
    f.rpc.context.expire_blockhash();
    send(
        &mut f,
        &t,
        &maker,
        serde_json::json!({"kind":"cancel","sequence":"1"}),
        &keys[..1],
    );
    let tx = t.package_transaction(
        &f,
        &maker,
        serde_json::json!({"kind":"claim","sequence":"1"}),
        &keys[..1],
    );
    let saved = tx.clone();
    f.rpc.context.send_transaction(tx).unwrap(); // model a lost successful response
    let paid = f.holder_balances(maker.pubkey()).await;
    assert_eq!(
        f.rpc.context.send_transaction(saved).unwrap_err().err,
        TransactionError::AlreadyProcessed
    );
    f.rpc.context.expire_blockhash();
    // New process and blockhash, same logical claim: no second economic effect.
    send(
        &mut f,
        &t,
        &maker,
        serde_json::json!({"kind":"claim","sequence":"1"}),
        &keys[..1],
    );
    assert_eq!(paid, f.holder_balances(maker.pubkey()).await);
    send(
        &mut f,
        &t,
        &taker,
        serde_json::json!({"kind":"claim","sequence":"2"}),
        &keys[1..2],
    );
    send(
        &mut f,
        &t,
        &taker,
        serde_json::json!({"kind":"place","expectedSequence":"3","side":"Ask","limitPriceAtoms":"1000000","quantityAtoms":"250000","postOnly":true}),
        &keys[2..3],
    );
    send(
        &mut f,
        &t,
        &maker,
        serde_json::json!({"kind":"place","expectedSequence":"4","side":"Bid","limitPriceAtoms":"1000000","quantityAtoms":"250000","postOnly":false}),
        &keys[2..4],
    );
    for (owner, i) in [(&taker, 2), (&maker, 3)] {
        send(
            &mut f,
            &t,
            owner,
            serde_json::json!({"kind":"claim","sequence":(i+1).to_string()}),
            &keys[i..i + 1],
        );
    }
    assert_eq!(f.token_balance(f.order_option).await, 0);
    assert_eq!(f.token_balance(f.order_quote).await, 0);
    let a = f.holder_balances(maker.pubkey()).await;
    let b = f.holder_balances(taker.pubkey()).await;
    assert_eq!(a, (10 * UNIT, 100 * UNIT));
    assert_eq!(b, a);
    println!("closure assertions=exact-packaged-bytes,real-alt-create-extend-freeze,signature-checks,partial-fill,repost,owner-rejection,duplicate-signature,logical-replay,zero-escrow,zero-fees");
}
