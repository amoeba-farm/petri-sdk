#![cfg(feature = "devnet-v3-governance-controller")]

mod g3_sbf_support;
use borsh::{BorshDeserialize, BorshSerialize};
use g3_sbf_support::{account, actual_program, governed, submit};
use light_token_minter::{
    constants::*,
    instruction::VaultInstruction,
    state::{VaultConfig, WriterSleeveStatus, WriterSleeveV1},
    writer_participation_state::{
        derive_contribution, WriterContributionV2, WriterParticipationActionV2 as Action,
        PARTICIPATION_VERSION,
    },
};
use solana_program::{program_option::COption, program_pack::Pack, pubkey::Pubkey};
use solana_program_test::processor;
use solana_sdk::{
    instruction::AccountMeta,
    signature::{Keypair, Signer},
};
use solana_system_interface::program as system_program;

fn pda(seed: &[u8], parent: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, seed, parent.as_ref()],
        &light_token_minter::id(),
    )
}

#[tokio::test]
async fn actual_sbf_receipt_profit_transfer_split_claim_and_close() {
    receipt_lifecycle(13_000_001).await;
}

#[tokio::test]
async fn actual_sbf_receipt_loss_transfer_split_claim_and_close() {
    receipt_lifecycle(6_000_001).await;
}

async fn receipt_lifecycle(residual: u64) {
    let program = light_token_minter::id();
    let owner = Keypair::new();
    let buyer = Keypair::new();
    let group = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let (sleeve_key, bump) = pda(WRITER_SLEEVE_PDA_SEED, &group);
    let (vault, _) = pda(WRITER_SLEEVE_USDC_VAULT_PDA_SEED, &sleeve_key);
    let (config_key, config_bump) =
        Pubkey::find_program_address(&[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED], &program);
    let (receipt_key, receipt_bump) =
        derive_contribution(&program, &sleeve_key, &owner.pubkey(), 7);
    let (child_key, _) = derive_contribution(&program, &sleeve_key, &buyer.pubkey(), 9);
    let sleeve = WriterSleeveV1 {
        is_initialized: true,
        bump,
        account_discriminator: WriterSleeveV1::ACCOUNT_DISCRIMINATOR,
        account_version: PARTICIPATION_VERSION,
        settlement_group: group,
        series_book: pda(WRITER_SERIES_BOOK_PDA_SEED, &sleeve_key).0,
        usdc_vault: vault,
        vault_config: config_key,
        settlement_mint: mint,
        policy_version: 1,
        policy_hash: [7; 32],
        expiry_ts: 100,
        participation_start_ts: 1,
        maximum_contribution_duration: 80,
        capital_seconds: 960_000_000,
        writer_principal_atoms: 12_000_000,
        settlement_principal_atoms: 12_000_000,
        unclaimed_principal_atoms: 12_000_000,
        writer_residual_initial_atoms: residual,
        writer_residual_remaining_atoms: residual,
        long_liability_initial_atoms: 2_000_000,
        long_liability_remaining_atoms: 2_000_000,
        accounted_asset_atoms: residual + 2_000_000,
        status: WriterSleeveStatus::SettlementFinalized,
        ..WriterSleeveV1::default()
    };
    let receipt = WriterContributionV2 {
        initialized: true,
        bump: receipt_bump,
        discriminator: *b"WCP",
        version: PARTICIPATION_VERSION,
        sleeve: sleeve_key,
        creator: owner.pubkey(),
        owner: owner.pubkey(),
        rent_payer: owner.pubkey(),
        nonce: 7,
        policy_version: 1,
        policy_hash: [7; 32],
        principal: 12_000_000,
        actual_deposit_ts: 20,
        entry_ts: 20,
        expiry_ts: 100,
        weight_offset: 0,
        claimed: false,
    };
    let config = VaultConfig {
        is_initialized: true,
        bump: config_bump,
        admin: Pubkey::new_unique(),
        oracle_authority: Pubkey::new_unique(),
        usdc_mint: mint,
        vault_token_account: Pubkey::new_unique(),
        paused: true,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    };
    let mut test = actual_program();
    test.add_program(
        "spl_token",
        spl_token::id(),
        processor!(spl_token::processor::Processor::process),
    );
    for signer in [&owner, &buyer] {
        test.add_account(signer.pubkey(), account(system_program::id(), vec![]));
    }
    for (key, data) in [
        (sleeve_key, sleeve.try_to_vec().unwrap()),
        (receipt_key, receipt.try_to_vec().unwrap()),
        (config_key, config.try_to_vec().unwrap()),
    ] {
        test.add_account(key, account(program, data));
    }
    let mut mint_bytes = vec![0; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(
        spl_token::state::Mint {
            mint_authority: COption::None,
            supply: residual + 2_000_100,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut mint_bytes,
    )
    .unwrap();
    test.add_account(mint, account(spl_token::id(), mint_bytes));
    let ata = |wallet| {
        light_token_minter::associated_token::get_associated_token_address_with_program_id(
            &wallet,
            &mint,
            &spl_token::id(),
        )
    };
    for (key, token_owner, amount) in [
        (vault, sleeve_key, residual + 2_000_100),
        (ata(owner.pubkey()), owner.pubkey(), 0),
        (ata(buyer.pubkey()), buyer.pubkey(), 0),
    ] {
        let mut data = vec![0; spl_token::state::Account::LEN];
        spl_token::state::Account::pack(
            spl_token::state::Account {
                mint,
                owner: token_owner,
                amount,
                delegate: COption::None,
                state: spl_token::state::AccountState::Initialized,
                is_native: COption::None,
                delegated_amount: 0,
                close_authority: COption::None,
            },
            &mut data,
        )
        .unwrap();
        test.add_account(key, account(spl_token::id(), data));
    }
    let mut context = test.start_with_context().await;
    let transfer = governed(
        vec![
            AccountMeta::new(owner.pubkey(), true),
            AccountMeta::new_readonly(sleeve_key, false),
            AccountMeta::new(receipt_key, false),
            AccountMeta::new_readonly(buyer.pubkey(), false),
        ],
        VaultInstruction::ManageWriterParticipationV2 {
            params: Action::Transfer,
        },
    );
    submit(&mut context, &owner, transfer.clone(), "transfer")
        .await
        .result
        .unwrap();
    assert!(submit(&mut context, &owner, transfer, "old-owner-replay")
        .await
        .result
        .is_err());
    let split = governed(
        vec![
            AccountMeta::new(buyer.pubkey(), true),
            AccountMeta::new_readonly(sleeve_key, false),
            AccountMeta::new(receipt_key, false),
            AccountMeta::new(child_key, false),
            AccountMeta::new_readonly(owner.pubkey(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        VaultInstruction::ManageWriterParticipationV2 {
            params: Action::Split {
                nonce: 9,
                principal_atoms: 4_000_000,
            },
        },
    );
    submit(&mut context, &buyer, split.clone(), "split")
        .await
        .result
        .unwrap();
    assert!(submit(&mut context, &buyer, split, "duplicate-split")
        .await
        .result
        .is_err());
    for (key, principal, offset) in [
        (receipt_key, 8_000_000, 320_000_000),
        (child_key, 4_000_000, 0),
    ] {
        let data = context
            .banks_client
            .get_account(key)
            .await
            .unwrap()
            .unwrap()
            .data;
        let lot = WriterContributionV2::try_from_slice(&data).unwrap();
        assert_eq!(
            (
                lot.principal,
                lot.weight_offset,
                lot.entry_ts,
                lot.actual_deposit_ts,
                lot.expiry_ts
            ),
            (principal, offset, 20, 20, 100)
        );
        assert_eq!((lot.policy_version, lot.policy_hash), (1, [7; 32]));
    }
    for (key, signer, principal, prefix) in [
        (receipt_key, &buyer, 8_000_000, false),
        (child_key, &owner, 4_000_000, true),
    ] {
        let instruction = governed(
            vec![
                AccountMeta::new(signer.pubkey(), true),
                AccountMeta::new(sleeve_key, false),
                AccountMeta::new(key, false),
                AccountMeta::new(vault, false),
                AccountMeta::new(ata(signer.pubkey()), false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(spl_token::id(), false),
                AccountMeta::new_readonly(config_key, false),
            ],
            VaultInstruction::ManageWriterParticipationV2 {
                params: Action::Claim,
            },
        );
        submit(
            &mut context,
            signer,
            instruction.clone(),
            "claim-while-paused",
        )
        .await
        .result
        .unwrap();
        assert!(submit(&mut context, signer, instruction, "duplicate-claim")
            .await
            .result
            .is_err());
        let data = context
            .banks_client
            .get_account(ata(signer.pubkey()))
            .await
            .unwrap()
            .unwrap()
            .data;
        let amount = spl_token::state::Account::unpack(&data).unwrap().amount;
        let delta = residual.abs_diff(12_000_000);
        let allocation = if prefix { delta / 3 } else { delta - delta / 3 };
        assert_eq!(
            amount,
            if residual >= 12_000_000 {
                principal + allocation
            } else {
                principal - allocation
            }
        );
        let rent_payer = if prefix {
            buyer.pubkey()
        } else {
            owner.pubkey()
        };
        let close = governed(
            vec![
                AccountMeta::new(signer.pubkey(), true),
                AccountMeta::new_readonly(sleeve_key, false),
                AccountMeta::new(key, false),
                AccountMeta::new(rent_payer, false),
            ],
            VaultInstruction::ManageWriterParticipationV2 {
                params: Action::Close,
            },
        );
        submit(&mut context, signer, close, "close")
            .await
            .result
            .unwrap();
        assert!(context
            .banks_client
            .get_account(key)
            .await
            .unwrap()
            .is_none());
    }
    let data = context
        .banks_client
        .get_account(vault)
        .await
        .unwrap()
        .unwrap()
        .data;
    assert_eq!(
        spl_token::state::Account::unpack(&data).unwrap().amount,
        2_000_100
    );
    let data = context
        .banks_client
        .get_account(sleeve_key)
        .await
        .unwrap()
        .unwrap()
        .data;
    let settled = WriterSleeveV1::try_from_slice(&data).unwrap();
    assert_eq!(
        (
            settled.unclaimed_principal_atoms,
            settled.writer_residual_remaining_atoms,
            settled.accounted_asset_atoms
        ),
        (0, 0, 2_000_000)
    );
}
