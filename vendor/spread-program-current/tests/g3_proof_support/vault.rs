use super::proof;
use crate::g3_light_support::*;
use borsh::BorshSerialize;
use light_client::indexer::{AddressWithTree, Indexer};
use light_program_test::Rpc;
use light_sdk::instruction::{PackedAccounts, SystemAccountMetaConfig};
use light_token::instruction::{derive_token_ata, Transfer};
use light_token_minter::{
    ameba_dlmm_instruction::InitializeAmoebaDlmmPoolV1Params, constants::*, governance_gate::*,
};
use solana_sdk::{
    clock::Clock,
    instruction::InstructionError,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    transaction::TransactionError,
};
use solana_system_interface::program as system_program;

fn governed_raw(accounts: Vec<AccountMeta>, mut data: Vec<u8>) -> Instruction {
    if light_token_minter::business_generation::requires_generation(data[0]) {
        data.extend_from_slice(b"AMG3");
    }
    data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(1).encode());
    let mut accounts = accounts;
    accounts.push(AccountMeta::new_readonly(PINNED_PROTOCOL_GATE_PDA, false));
    Instruction {
        program_id: program(),
        accounts,
        data,
    }
}

#[tokio::test]
async fn actual_sbf_pool_vault_compression_and_reload() {
    let mut f = MarketFixture::writer_fixture().await;
    // Preserve initialized market/group/mint prerequisites, then exercise the
    // production pool constructor so vault PDA-compression extensions are real.
    for key in [f.pool, f.option_vault, f.quote_vault] {
        f.rpc
            .context
            .set_account(key, solana_sdk::account::Account::default())
            .unwrap();
    }
    let (config, cb) =
        Pubkey::find_program_address(&[b"compressible_config", &0u16.to_le_bytes()], &program());
    let (sponsor, sb) =
        Pubkey::find_program_address(&[light_sdk_types::constants::RENT_SPONSOR_SEED], &program());
    let mut bytes = vec![0; 156];
    bytes[..8].copy_from_slice(b"LightCfg");
    let body = &mut bytes[8..];
    body[0] = 1;
    body[1..5].copy_from_slice(&766u32.to_le_bytes());
    body[5..37].copy_from_slice(f.payer.pubkey().as_ref());
    body[37..69].copy_from_slice(sponsor.as_ref());
    body[69..101].copy_from_slice(f.payer.pubkey().as_ref());
    let rent = light_compressible::rent::RentConfig::default();
    body[101..103].copy_from_slice(&rent.base_rent.to_le_bytes());
    body[103..105].copy_from_slice(&rent.compression_cost.to_le_bytes());
    body[105] = rent.lamports_per_byte_per_epoch;
    body[106] = rent.max_funded_epochs;
    body[107..109].copy_from_slice(&rent.max_top_up.to_le_bytes());
    body[110] = cb;
    body[111] = sb;
    body[112..116].copy_from_slice(&1u32.to_le_bytes());
    body[116..148].copy_from_slice(LIGHT_DEFAULT_ADDRESS_TREE_V2.as_ref());
    f.rpc
        .context
        .set_account(config, account(program(), bytes))
        .unwrap();
    f.rpc
        .context
        .set_account(sponsor, account(system_program::id(), vec![]))
        .unwrap();
    let pool_address = light_compressed_account::address::derive_address(
        &f.pool.to_bytes(),
        &LIGHT_DEFAULT_ADDRESS_TREE_V2.to_bytes(),
        &program().to_bytes(),
    );
    let p = f
        .rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: pool_address,
                tree: LIGHT_DEFAULT_ADDRESS_TREE_V2,
            }],
            None,
        )
        .await
        .unwrap()
        .value;
    assert!(p.proof.0.is_some());
    let mut packed = PackedAccounts::default();
    packed
        .add_system_accounts_v2(SystemAccountMetaConfig::new(program()))
        .unwrap();
    let output = f
        .rpc
        .get_random_state_tree_info()
        .unwrap()
        .pack_output_tree_index(&mut packed)
        .unwrap();
    let trees = p.pack_tree_infos(&mut packed);
    let params = InitializeAmoebaDlmmPoolV1Params {
        liquidity_manager: f.payer.pubkey(),
        create_accounts_proof:
            light_sdk_types::interface::create_accounts_proof::CreateAccountsProof {
                proof: p.proof,
                address_tree_info: trees.address_trees[0],
                output_state_tree_index: output,
                state_tree_index: None,
                system_accounts_offset: 0,
            },
    };
    let keys = [
        f.payer.pubkey(),
        f.config,
        f.market,
        f.month,
        f.sleeve,
        f.group,
        f.book,
        f.pool,
        f.authority,
        f.option,
        f.quote,
        f.option_vault,
        f.quote_vault,
        light_token::instruction::LIGHT_TOKEN_PROGRAM_ID,
        light_token::cpi_authority(),
        config,
        sponsor,
        LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
        LIGHT_TOKEN_RENT_SPONSOR,
        system_program::id(),
    ];
    let mut metas = keys
        .iter()
        .enumerate()
        .map(|(i, k)| {
            if matches!(i, 0 | 7 | 11 | 12 | 16 | 18) {
                AccountMeta::new(*k, i == 0)
            } else {
                AccountMeta::new_readonly(*k, false)
            }
        })
        .collect::<Vec<_>>();
    metas.extend(packed.to_account_metas().0);
    let mut data = vec![252];
    params.serialize(&mut data).unwrap();
    proof::send(
        &mut f.rpc,
        &f.payer,
        governed_raw(metas, data),
        "pool_create_real_vaults",
    )
    .unwrap();
    let before = f.rpc.context.get_account(&f.quote_vault).unwrap();
    assert_eq!(
        before.owner,
        light_token::instruction::LIGHT_TOKEN_PROGRAM_ID
    );
    let transfer = Transfer {
        source: derive_token_ata(&f.payer.pubkey(), &f.quote),
        destination: f.quote_vault,
        amount: 7 * UNIT,
        authority: f.payer.pubkey(),
        fee_payer: f.payer.pubkey(),
    }
    .instruction()
    .unwrap();
    proof::send(&mut f.rpc, &f.payer, transfer, "pool_vault_fund").unwrap();
    let funded = f
        .rpc
        .get_token_account_interface(&f.quote_vault, None)
        .await
        .unwrap()
        .value
        .unwrap();
    assert_eq!(funded.amount(), 7 * UNIT);
    let mut clock = f.rpc.context.get_sysvar::<Clock>();
    clock.slot += 1_000_000;
    f.rpc.context.set_sysvar(&clock);
    let forester = f.rpc.test_accounts.protocol.forester.insecure_clone();
    light_program_test::forester::compress_and_close_forester(
        &mut f.rpc,
        &[f.quote_vault, f.option_vault],
        &forester,
        &f.payer,
        None,
    )
    .await
    .unwrap();
    for (vault, mint, expected) in [
        (f.quote_vault, f.quote, 7 * UNIT),
        (f.option_vault, f.option, 0),
    ] {
        assert!(f
            .rpc
            .context
            .get_account(&vault)
            .is_none_or(|a| a.lamports == 0));
        let cold = f
            .rpc
            .get_token_account_interface(&vault, None)
            .await
            .unwrap()
            .value
            .unwrap();
        assert_eq!(cold.amount(), expected);
        assert!(cold.compressed().is_some());
        let compressed = cold.compressed().unwrap();
        println!(
            "cold vault owner={} key={} token={:?}",
            cold.owner(),
            cold.key,
            compressed.token
        );
        let p = f
            .rpc
            .get_validity_proof(vec![compressed.account.hash], vec![], None)
            .await
            .unwrap()
            .value;
        let load = light_token::instruction::Decompress {
            token_data: compressed.token.clone().into(),
            discriminator: compressed.account.data.as_ref().unwrap().discriminator,
            merkle_tree: compressed.account.tree_info.tree,
            queue: compressed.account.tree_info.queue,
            leaf_index: compressed.account.leaf_index,
            root_index: p.accounts[0].root_index.root_index().unwrap_or(0),
            destination: vault,
            payer: f.payer.pubkey(),
            signer: f.payer.pubkey(),
            validity_proof: p.proof,
        }
        .instruction()
        .unwrap();
        let restore = light_token_minter::ameba_dlmm_instruction::RestoreAmoebaDlmmVaultV3Params {
            amount: compressed.token.amount,
            leaf_index: compressed.account.leaf_index,
            root_index: p.accounts[0].root_index.root_index().unwrap_or(0),
            prove_by_index: p.accounts[0].root_index.proof_by_index(),
            proof: p.proof,
        };
        let keys = [
            f.payer.pubkey(),
            f.pool,
            mint,
            vault,
            LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
            LIGHT_TOKEN_RENT_SPONSOR,
            system_program::id(),
            light_token::instruction::LIGHT_TOKEN_PROGRAM_ID,
            load.accounts[0].pubkey,
            load.accounts[2].pubkey,
            load.accounts[3].pubkey,
            load.accounts[4].pubkey,
            load.accounts[5].pubkey,
            compressed.account.tree_info.tree,
            compressed.account.tree_info.queue,
        ];
        let metas = keys
            .iter()
            .enumerate()
            .map(|(i, k)| {
                if matches!(i, 0 | 1 | 3 | 5 | 13 | 14) {
                    AccountMeta::new(*k, i == 0)
                } else {
                    AccountMeta::new_readonly(*k, false)
                }
            })
            .collect();
        let ix = governed_raw(metas, restore.instruction_data());
        let guarded = keys
            .iter()
            .copied()
            .filter(|k| *k != f.payer.pubkey())
            .collect::<Vec<_>>();
        let before = proof::snapshot(&f.rpc, &guarded);
        let mut wrong_vault = ix.clone();
        wrong_vault.accounts[3].pubkey = Pubkey::new_unique();
        let error = proof::send(
            &mut f.rpc,
            &f.payer,
            wrong_vault,
            "pool_vault_wrong_address",
        )
        .unwrap_err();
        assert_eq!(
            error,
            TransactionError::InstructionError(1, InstructionError::Custom(6220))
        );
        assert_eq!(proof::snapshot(&f.rpc, &guarded), before);
        let mut wrong_amount = ix.clone();
        wrong_amount.data[5] ^= 1;
        let error = proof::send(
            &mut f.rpc,
            &f.payer,
            wrong_amount,
            "pool_vault_wrong_proven_amount",
        )
        .unwrap_err();
        assert_eq!(
            error,
            TransactionError::InstructionError(1, InstructionError::Custom(14307))
        );
        assert_eq!(proof::snapshot(&f.rpc, &guarded), before);
        proof::send(&mut f.rpc, &f.payer, ix.clone(), "pool_vault_reload").unwrap();
        let hot = f
            .rpc
            .get_token_account_interface(&vault, None)
            .await
            .unwrap()
            .value
            .unwrap();
        assert!(hot.compressed().is_none());
        assert_eq!(hot.amount(), expected);
        assert_eq!(hot.owner(), f.authority);
        assert_eq!(hot.mint(), mint);
        let after = proof::snapshot(&f.rpc, &guarded);
        let error =
            proof::send(&mut f.rpc, &f.payer, ix, "pool_vault_duplicate_reload").unwrap_err();
        assert_eq!(
            error,
            TransactionError::InstructionError(1, InstructionError::Custom(6005))
        );
        assert_eq!(proof::snapshot(&f.rpc, &guarded), after);
    }
    // Exercise real issuance/custody after both vaults have been restored. The
    // earlier seven-USDC transfer is a donation, not writer or LP ownership.
    let writer = f.payer.insecure_clone();
    let source = f.classic_funds(writer.pubkey(), 100 * UNIT).await;
    f.contribute(&writer, source, 1, 100 * UNIT).await;
    f.initialize_writer_position(&writer).await;
    let ix = f.add_writer_instruction(
        &writer,
        2 * UNIT,
        vec![
            light_token_minter::state::WriterDlmmBinV1 {
                bin_id: 19,
                option_atoms: 0,
                quote_atoms: 950_000,
            },
            light_token_minter::state::WriterDlmmBinV1 {
                bin_id: 20,
                option_atoms: 2 * UNIT,
                quote_atoms: 0,
            },
        ],
    );
    proof::send(
        &mut f.rpc,
        &writer,
        ix,
        "writer_issuance_after_vault_reload",
    )
    .unwrap();
    assert_eq!(f.token_balance(f.option_vault).await, 2 * UNIT);
    assert_eq!(f.token_balance(f.quote_vault).await, 7 * UNIT + 950_000);
    assert_eq!(f.option_supply(), 2 * UNIT);
    let sleeve: light_token_minter::state::WriterSleeveV1 = f.read(f.sleeve).await;
    assert_eq!(sleeve.writer_principal_atoms, 100 * UNIT);
    assert_eq!(sleeve.accounted_asset_atoms, 100 * UNIT);
}
