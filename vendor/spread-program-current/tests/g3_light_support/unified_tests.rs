use crate::g3_light_support::*;
use light_token_minter::{
    error::VaultError,
    instruction::{SetCollectiveMarketPausedV1Params, VaultInstruction},
    state::*,
    writer_participation_state::{
        derive_contribution, WriterContributionV2, WriterParticipationActionV2,
    },
};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use solana_system_interface::program as system_program;

fn metas(keys: &[Pubkey], writable: &[usize]) -> Vec<AccountMeta> {
    keys.iter()
        .enumerate()
        .map(|(i, key)| {
            if writable.contains(&i) {
                AccountMeta::new(*key, i == 0)
            } else {
                AccountMeta::new_readonly(*key, i == 0)
            }
        })
        .collect()
}
fn participation(
    keys: &[Pubkey],
    writable: &[usize],
    params: WriterParticipationActionV2,
) -> Instruction {
    govern(
        metas(keys, writable),
        VaultInstruction::ManageWriterParticipationV2 { params },
    )
}

#[tokio::test]
async fn funding_donation_expiry_split_refund_and_close() {
    let mut f = MarketFixture::writer_fixture().await;
    let owner = f.payer.insecure_clone();
    let other = f.other.insecure_clone();
    // Fixture supplies the frozen setup, not evidence of bootstrap/activation.
    let mut sleeve: WriterSleeveV1 = f.read(f.sleeve).await;
    let mut group: WriterSettlementGroupV1 = f.read(f.group).await;
    sleeve.status = WriterSleeveStatus::PolicyFrozen;
    group.status = WriterSettlementGroupStatus::Anchored;
    install(&mut f.rpc, f.sleeve, &sleeve, WriterSleeveV1::LEN);
    install(&mut f.rpc, f.group, &group, WriterSettlementGroupV1::LEN);
    let donation_source = f.classic_funds(other.pubkey(), 1).await;
    let cash = f.cash_key();
    setup_tx(
        &mut f.rpc,
        &other,
        &[spl_token::instruction::transfer(
            &spl_token::id(),
            &donation_source,
            &cash,
            &other.pubkey(),
            &[],
            1,
        )
        .unwrap()],
        &[],
    )
    .await;
    let open = govern(
        metas(
            &[
                owner.pubkey(),
                f.config,
                f.sleeve,
                f.group,
                f.book,
                f.snapshot_key(),
                cash,
                f.policy_key(),
            ],
            &[0, 2],
        ),
        VaultInstruction::OpenWriterFundingV1,
    );
    f.execute(&owner, open, "donated-vault-open-funding", None)
        .await;
    let opened: WriterSleeveV1 = f.read(f.sleeve).await;
    assert_eq!(opened.accounted_asset_atoms, 0);
    assert_eq!(opened.writer_principal_atoms, 0);
    let funds = f.classic_funds(owner.pubkey(), UNIT).await;
    let receipt = f.contribute(&owner, funds, 1, UNIT).await;
    let expire = participation(
        &[
            other.pubkey(),
            f.config,
            f.sleeve,
            f.group,
            f.book,
            f.snapshot_key(),
            cash,
            f.policy_key(),
        ],
        &[0, 2, 3, 4],
        WriterParticipationActionV2::ExpireUnactivatedV3,
    );
    let mut clock = f.rpc.context.get_sysvar::<solana_sdk::clock::Clock>();
    clock.unix_timestamp = f.expiry as i64 - 1;
    f.rpc.context.set_sysvar(&clock);
    let protected = f.snapshot(&[f.sleeve, f.group, f.book, cash, receipt]);
    f.reject(
        &other,
        expire.clone(),
        "funding-expiry-minus-one",
        VaultError::InvalidWriterLifecycle as u32,
    )
    .await;
    assert_eq!(
        protected,
        f.snapshot(&[f.sleeve, f.group, f.book, cash, receipt])
    );
    clock.unix_timestamp += 1;
    f.rpc.context.set_sysvar(&clock);
    f.execute(&other, expire.clone(), "funding-expire-at-deadline", None)
        .await;
    f.reject(
        &other,
        expire,
        "funding-duplicate-expiry",
        VaultError::InvalidWriterLifecycle as u32,
    )
    .await;
    let terminal: WriterSleeveV1 = f.read(f.sleeve).await;
    assert_eq!(terminal.status, WriterSleeveStatus::FundingRefunds);
    assert_eq!(terminal.writer_residual_initial_atoms, UNIT);
    assert_eq!(f.token_balance(cash).await, UNIT + 1);
    let split = derive_contribution(&program(), &f.sleeve, &owner.pubkey(), 2).0;
    let ix = participation(
        &[
            owner.pubkey(),
            f.sleeve,
            receipt,
            split,
            other.pubkey(),
            system_program::id(),
        ],
        &[0, 2, 3],
        WriterParticipationActionV2::Split {
            nonce: 2,
            principal_atoms: UNIT / 4,
        },
    );
    f.execute(&owner, ix, "refund-split-and-transfer", None)
        .await;
    let mut claims = Vec::new();
    for (signer, lot, expected) in [(&owner, receipt, 3 * UNIT / 4), (&other, split, UNIT / 4)] {
        let ata =
            spl_associated_token_account::get_associated_token_address(&signer.pubkey(), &f.quote);
        setup_tx(&mut f.rpc, signer, &[spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            &signer.pubkey(), &signer.pubkey(), &f.quote, &spl_token::id(),
        )], &[]).await;
        let ix = participation(
            &[
                signer.pubkey(),
                f.sleeve,
                lot,
                cash,
                ata,
                f.quote,
                spl_token::id(),
                f.config,
            ],
            &[0, 1, 2, 3, 4],
            WriterParticipationActionV2::Claim,
        );
        f.execute(signer, ix.clone(), "principal-only-refund", None)
            .await;
        assert_eq!(f.token_balance(ata).await, expected);
        f.reject(
            signer,
            ix,
            "duplicate-refund",
            VaultError::InvalidWriterLifecycle as u32,
        )
        .await;
        let value: WriterContributionV2 = f.read(lot).await;
        assert!(value.claimed);
        claims.push((signer.insecure_clone(), lot));
    }
    assert_eq!(
        f.token_balance(cash).await,
        1,
        "donation never becomes principal"
    );
    for (signer, lot) in claims {
        let ix = participation(
            &[signer.pubkey(), f.sleeve, lot, owner.pubkey()],
            &[0, 2, 3],
            WriterParticipationActionV2::Close,
        );
        f.execute(&signer, ix, "close-refunded-receipt", None).await;
    }
    let ix = govern(
        metas(
            &[
                owner.pubkey(),
                f.config,
                f.sleeve,
                f.group,
                f.book,
                f.snapshot_key(),
                cash,
                spl_token::id(),
                system_program::id(),
            ],
            &[0, 2, 3, 4, 6],
        ),
        VaultInstruction::CloseWriterSleeveV1,
    );
    f.execute(&owner, ix, "close-refunded-sleeve", None).await;
    assert_eq!(
        f.read::<WriterSleeveV1>(f.sleeve).await.status,
        WriterSleeveStatus::Closed
    );
    assert_eq!(f.token_balance(cash).await, 1);
}

#[tokio::test]
async fn collective_pause_rejects_bad_counts_without_panicking() {
    let mut f = MarketFixture::writer_fixture().await;
    let admin = f.payer.insecure_clone();
    let keys = [
        admin.pubkey(),
        f.config,
        f.sleeve,
        f.group,
        f.book,
        f.market,
        f.month,
        derive_oracle_sku_coverage_manifest_pda(&program(), &f.month).0,
        derive_oracle_active_weight_manifest_pda(&program(), &f.month).0,
    ];
    let instruction = VaultInstruction::SetCollectiveMarketPausedV1 {
        params: SetCollectiveMarketPausedV1Params { paused: true },
    };
    let before = f.snapshot(&[f.market]);
    for count in [8, 10] {
        let mut a = metas(&keys, &[0, 5]);
        if count == 8 {
            a.pop();
        } else {
            a.push(AccountMeta::new_readonly(Pubkey::new_unique(), false));
        }
        f.reject(
            &admin,
            govern(a, instruction.clone()),
            "pause-wrong-count",
            VaultError::InvalidAccountList as u32,
        )
        .await;
        assert_eq!(before, f.snapshot(&[f.market]));
    }
    f.execute(
        &admin,
        govern(metas(&keys, &[0, 5]), instruction),
        "pause-nine-accounts",
        None,
    )
    .await;
    assert!(f.read::<Market>(f.market).await.paused);
}
