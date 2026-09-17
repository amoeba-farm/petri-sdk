#![cfg(feature = "test-sbf")]

use borsh::{BorshDeserialize, BorshSerialize};
use light_client::rpc::RpcError;
use light_program_test::{LightProgramTest, ProgramTestConfig, Rpc};
use light_token::{
    cpi_authority,
    instruction::{derive_token_ata, CreateAssociatedTokenAccount, LIGHT_TOKEN_PROGRAM_ID},
    spl_interface::get_spl_interface_pda_and_bump,
};
use light_token_minter::{
    constants::{
        CONTRACT_MINT_PDA_SEED, CURRENT_STATE_NAMESPACE_SEED, LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
        LIGHT_TOKEN_RENT_SPONSOR, VAULT_PDA_SEED, WRITER_FLAT_BURN_CUSTODY_PDA_SEED,
        WRITER_FLAT_MINT_PDA_SEED, WRITER_FLAT_STAGING_PDA_SEED, WRITER_MAX_LIVE_SERIES,
        WRITER_POLICY_SNAPSHOT_PDA_SEED, WRITER_RATIO_SCALE_PPM, WRITER_SERIES_BOOK_PDA_SEED,
        WRITER_SLEEVE_PDA_SEED, WRITER_SLEEVE_USDC_VAULT_PDA_SEED,
    },
    error::VaultError,
    instruction::{VaultInstruction, VaultInstructionTag, WriterAmountV1Params},
    state::{
        VaultConfig, WriterAuctionPriorityRule, WriterPolicySnapshotV1, WriterReserveRoundingMode,
        WriterSecurityMode, WriterSleeveStatus, WriterSleeveV1,
    },
};
use solana_program::program_pack::Pack;
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    transaction::TransactionError,
};
use solana_system_interface::instruction as system_instruction;
use spl_token::{
    instruction as token_instruction,
    state::{Account as TokenAccountState, AccountState, Mint},
};

fn current_pda(seeds: &[&[u8]]) -> (Pubkey, u8) {
    let mut namespaced = Vec::with_capacity(seeds.len() + 1);
    namespaced.push(CURRENT_STATE_NAMESPACE_SEED);
    namespaced.extend_from_slice(seeds);
    Pubkey::find_program_address(&namespaced, &light_token_minter::id())
}

fn assert_custom_error(error: RpcError, expected: VaultError) {
    match error {
        RpcError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => assert_eq!(code, expected as u32),
        other => panic!("expected custom error {}, got {other:?}", expected as u32),
    }
}

fn install_account(rpc: &mut LightProgramTest, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
    rpc.context
        .set_account(
            key,
            Account {
                lamports: Rent::default().minimum_balance(data.len()),
                data,
                owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("install deterministic test account");
}

fn install_program_state<T: BorshSerialize>(
    rpc: &mut LightProgramTest,
    key: Pubkey,
    value: &T,
    len: usize,
) {
    let mut data = value.try_to_vec().expect("serialize program state");
    data.resize(len, 0);
    install_account(rpc, key, light_token_minter::id(), data);
}

fn install_mint(rpc: &mut LightProgramTest, key: Pubkey, authority: Pubkey, supply: u64) {
    let mut data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: solana_program::program_option::COption::Some(authority),
            supply,
            decimals: 6,
            is_initialized: true,
            freeze_authority: solana_program::program_option::COption::None,
        },
        &mut data,
    )
    .unwrap();
    install_account(rpc, key, spl_token::id(), data);
}

fn install_token_account(
    rpc: &mut LightProgramTest,
    key: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let mut data = vec![0; TokenAccountState::LEN];
    TokenAccountState::pack(
        TokenAccountState {
            mint,
            owner,
            amount,
            delegate: solana_program::program_option::COption::None,
            state: AccountState::Initialized,
            is_native: solana_program::program_option::COption::None,
            delegated_amount: 0,
            close_authority: solana_program::program_option::COption::None,
        },
        &mut data,
    )
    .unwrap();
    install_account(rpc, key, spl_token::id(), data);
}

async fn create_spl_mint(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    authority: &Pubkey,
) -> Pubkey {
    let mint = Keypair::new();
    let create = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        Rent::default().minimum_balance(Mint::LEN),
        Mint::LEN as u64,
        &spl_token::id(),
    );
    let initialize =
        token_instruction::initialize_mint2(&spl_token::id(), &mint.pubkey(), authority, None, 6)
            .unwrap();
    rpc.create_and_send_transaction(&[create, initialize], &payer.pubkey(), &[payer, &mint])
        .await
        .unwrap();
    mint.pubkey()
}

async fn create_spl_token_account(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Pubkey {
    let token = Keypair::new();
    let create = system_instruction::create_account(
        &payer.pubkey(),
        &token.pubkey(),
        Rent::default().minimum_balance(TokenAccountState::LEN),
        TokenAccountState::LEN as u64,
        &spl_token::id(),
    );
    let initialize =
        token_instruction::initialize_account3(&spl_token::id(), &token.pubkey(), mint, owner)
            .unwrap();
    rpc.create_and_send_transaction(&[create, initialize], &payer.pubkey(), &[payer, &token])
        .await
        .unwrap();
    token.pubkey()
}

#[tokio::test]
async fn test_contract_mint_pda_signer_seeds_use_one_namespace() {
    let source = include_str!("../src/processor/market_admin.rs");
    let function_start = source
        .find("fn process_create_market_contract_mint_v3(")
        .expect("current contract-mint creation handler");
    let function_tail = &source[function_start..];
    let function_end = function_tail
        .find("\npub(super) fn process_set_market_paused(")
        .expect("next top-level market handler");
    let function_source = &function_tail[..function_end];
    let create_call_start = function_source
        .find("create_program_account(")
        .expect("contract-mint account creation call");
    let create_call_tail = &function_source[create_call_start..];
    let create_call_end = create_call_tail
        .find("invoke_token_initialize_mint2(")
        .expect("mint initialization after account creation");
    let create_call = &create_call_tail[..create_call_end];

    assert!(!create_call.contains("CURRENT_STATE_NAMESPACE_SEED"));
    assert!(create_call.contains("CONTRACT_MINT_PDA_SEED"));

    let market = Pubkey::new_unique();
    let (expected, bump) = current_pda(&[CONTRACT_MINT_PDA_SEED, market.as_ref()]);
    let signed = Pubkey::create_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            CONTRACT_MINT_PDA_SEED,
            market.as_ref(),
            &[bump],
        ],
        &light_token_minter::id(),
    )
    .unwrap();
    assert_eq!(signed, expected);
}

#[tokio::test(flavor = "multi_thread")]
async fn test_unassigned_instruction_bytes_use_generic_invalid_instruction_path() {
    let config = ProgramTestConfig::new_v2(
        false,
        Some(vec![("light_token_minter", light_token_minter::id())]),
    );
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    for byte in [29u8, 31, 34, 35, 69, 97, 189, 204, 206, 211, 212, 214] {
        let error = rpc
            .create_and_send_transaction(
                &[Instruction {
                    program_id: light_token_minter::id(),
                    accounts: vec![],
                    data: vec![byte, 0xff, 0xff],
                }],
                &payer.pubkey(),
                &[&payer],
            )
            .await
            .unwrap_err();
        assert_custom_error(error, VaultError::InvalidInstructionData);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn test_sbf_rejects_extreme_dynamic_length_prefixes_before_account_validation() {
    let config = ProgramTestConfig::new_v2(
        false,
        Some(vec![("light_token_minter", light_token_minter::id())]),
    );
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    let mut opening_url_prefix = vec![VaultInstructionTag::SubmitOracleOpeningClaimV2 as u8];
    opening_url_prefix.extend_from_slice(&[0u8; 88]);
    let mut market_page_item_prefix = vec![VaultInstructionTag::UpsertMarketPageV2 as u8];
    market_page_item_prefix.extend_from_slice(&[0u8; 32]);
    let mut settlement_item_prefix = vec![VaultInstructionTag::UpsertSettlementV3 as u8, 0];
    settlement_item_prefix.extend_from_slice(&[0u8; 96]);

    for (family, fixed_prefix, maximum) in [
        ("opening-url-string", opening_url_prefix, 384_u32),
        ("market-page-item-string", market_page_item_prefix, 32_u32),
        ("settlement-item-string", settlement_item_prefix, 32_u32),
    ] {
        let one = 1_u32.to_le_bytes();
        for (case, malformed) in [
            ("max-plus-one", (maximum + 1).to_le_bytes().to_vec()),
            ("two-to-sixteen", 65_536_u32.to_le_bytes().to_vec()),
            ("two-to-thirty-one", (1_u32 << 31).to_le_bytes().to_vec()),
            ("u32-max", u32::MAX.to_le_bytes().to_vec()),
            ("truncated-zero-bytes", Vec::new()),
            ("truncated-one-byte", one[..1].to_vec()),
            ("truncated-two-bytes", one[..2].to_vec()),
            ("truncated-three-bytes", one[..3].to_vec()),
        ] {
            let mut data = fixed_prefix.clone();
            data.extend_from_slice(&malformed);
            let error = rpc
                .create_and_send_transaction(
                    &[Instruction {
                        program_id: light_token_minter::id(),
                        accounts: vec![],
                        data,
                    }],
                    &payer.pubkey(),
                    &[&payer],
                )
                .await
                .unwrap_err();
            match error {
                RpcError::TransactionError(TransactionError::InstructionError(
                    _,
                    InstructionError::Custom(code),
                )) => assert_eq!(
                    code,
                    VaultError::InvalidInstructionData as u32,
                    "{family}/{case} returned the wrong custom error",
                ),
                other => panic!("{family}/{case}: expected InvalidInstructionData, got {other:?}"),
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires the pinned external Light artifact set and local prover"]
async fn test_collective_funding_deposit_uses_real_light_custody() {
    let config = ProgramTestConfig::new_v2(
        false,
        Some(vec![("light_token_minter", light_token_minter::id())]),
    );
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();
    let program_id = light_token_minter::id();
    let quote_mint = create_spl_mint(&mut rpc, &payer, &payer.pubkey()).await;
    let source_quote =
        create_spl_token_account(&mut rpc, &payer, &quote_mint, &payer.pubkey()).await;
    rpc.create_and_send_transaction(
        &[token_instruction::mint_to(
            &spl_token::id(),
            &quote_mint,
            &source_quote,
            &payer.pubkey(),
            &[],
            2_000_000,
        )
        .unwrap()],
        &payer.pubkey(),
        &[&payer],
    )
    .await
    .unwrap();

    let (vault_config, vault_bump) = current_pda(&[VAULT_PDA_SEED]);
    install_program_state(
        &mut rpc,
        vault_config,
        &VaultConfig {
            is_initialized: true,
            bump: vault_bump,
            admin: payer.pubkey(),
            oracle_authority: Pubkey::new_unique(),
            usdc_mint: quote_mint,
            vault_token_account: Pubkey::new_unique(),
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        },
        VaultConfig::LEN,
    );

    let group = Pubkey::new_unique();
    let (sleeve, sleeve_bump) = current_pda(&[WRITER_SLEEVE_PDA_SEED, group.as_ref()]);
    let (series_book, _) = current_pda(&[WRITER_SERIES_BOOK_PDA_SEED, sleeve.as_ref()]);
    let (sleeve_vault, _) = current_pda(&[WRITER_SLEEVE_USDC_VAULT_PDA_SEED, sleeve.as_ref()]);
    let (flat_mint, _) = current_pda(&[WRITER_FLAT_MINT_PDA_SEED, sleeve.as_ref()]);
    let (flat_staging, _) = current_pda(&[WRITER_FLAT_STAGING_PDA_SEED, sleeve.as_ref()]);
    let (flat_burn, _) = current_pda(&[WRITER_FLAT_BURN_CUSTODY_PDA_SEED, sleeve.as_ref()]);
    let flat_interface = get_spl_interface_pda_and_bump(&flat_mint).0;
    let policy_registry = Pubkey::new_unique();
    let policy_version = 1_u64;
    let (policy_snapshot, policy_snapshot_bump) = current_pda(&[
        WRITER_POLICY_SNAPSHOT_PDA_SEED,
        sleeve.as_ref(),
        &policy_version.to_le_bytes(),
    ]);
    let policy_hash = [41; 32];
    let snapshot = WriterPolicySnapshotV1 {
        is_initialized: true,
        bump: policy_snapshot_bump,
        account_discriminator: WriterPolicySnapshotV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterPolicySnapshotV1::ACCOUNT_VERSION,
        sleeve,
        registry: policy_registry,
        policy_version,
        regime_input_version: 1,
        policy_hash,
        scenario_set_hash: [42; 32],
        risk_limit_hash: [43; 32],
        series_family_hash: [44; 32],
        security_mode: WriterSecurityMode::GrossExternalMaxPayout,
        reserve_rounding_mode: WriterReserveRoundingMode::AggregateBookCeiling,
        auction_priority_rule: WriterAuctionPriorityRule::PayAsBidPriceThenSeriesProRata,
        max_series: WRITER_MAX_LIVE_SERIES as u8,
        drawdown_scale: WRITER_RATIO_SCALE_PPM,
        lower_tail_max_settlement_atomic: 99_000_000,
        upper_tail_min_settlement_atomic: 101_000_000,
        max_auction_issue_atoms: 1_000_000,
        max_close_flat_atoms: 1_000_000,
        ..WriterPolicySnapshotV1::default()
    };
    install_program_state(
        &mut rpc,
        policy_snapshot,
        &snapshot,
        WriterPolicySnapshotV1::LEN,
    );
    install_program_state(
        &mut rpc,
        sleeve,
        &WriterSleeveV1 {
            is_initialized: true,
            bump: sleeve_bump,
            account_discriminator: WriterSleeveV1::ACCOUNT_DISCRIMINATOR,
            account_version: WriterSleeveV1::ACCOUNT_VERSION,
            vault_config,
            underlying_id: [45; 32],
            expiry_ts: 1,
            settlement_mint: quote_mint,
            settlement_group: group,
            series_book,
            usdc_vault: sleeve_vault,
            flat_mint,
            flat_spl_interface: flat_interface,
            flat_staging,
            flat_burn_custody: flat_burn,
            policy_registry,
            policy_snapshot,
            policy_version,
            policy_hash,
            scenario_set_hash: snapshot.scenario_set_hash,
            risk_limit_hash: snapshot.risk_limit_hash,
            status: WriterSleeveStatus::Funding,
            security_mode: WriterSecurityMode::GrossExternalMaxPayout,
            ..WriterSleeveV1::default()
        },
        WriterSleeveV1::LEN,
    );
    install_token_account(&mut rpc, sleeve_vault, quote_mint, sleeve, 0);
    install_mint(&mut rpc, flat_mint, sleeve, 0);
    install_token_account(&mut rpc, flat_staging, flat_mint, sleeve, 0);
    install_token_account(&mut rpc, flat_interface, flat_mint, cpi_authority(), 0);

    let destination = derive_token_ata(&payer.pubkey(), &flat_mint);
    rpc.create_and_send_transaction(
        &[
            CreateAssociatedTokenAccount::new(payer.pubkey(), payer.pubkey(), flat_mint)
                .instruction()
                .unwrap(),
        ],
        &payer.pubkey(),
        &[&payer],
    )
    .await
    .unwrap();

    let amount = 1_000_000_u64;
    let deposit = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(vault_config, false),
            AccountMeta::new(sleeve, false),
            AccountMeta::new_readonly(policy_snapshot, false),
            AccountMeta::new(sleeve_vault, false),
            AccountMeta::new(source_quote, false),
            AccountMeta::new_readonly(quote_mint, false),
            AccountMeta::new(flat_mint, false),
            AccountMeta::new(flat_staging, false),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(Pubkey::from(LIGHT_TOKEN_PROGRAM_ID), false),
            AccountMeta::new_readonly(cpi_authority(), false),
            AccountMeta::new(flat_interface, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            AccountMeta::new_readonly(LIGHT_TOKEN_COMPRESSIBLE_CONFIG, false),
            AccountMeta::new(LIGHT_TOKEN_RENT_SPONSOR, false),
        ],
        data: VaultInstruction::DepositWriterPrincipalV1 {
            params: WriterAmountV1Params {
                amount_atoms: amount,
            },
        }
        .try_to_vec()
        .unwrap(),
    };
    rpc.create_and_send_transaction(&[deposit], &payer.pubkey(), &[&payer])
        .await
        .unwrap();

    let sleeve_account = rpc.get_account(sleeve).await.unwrap().unwrap();
    let stored = WriterSleeveV1::deserialize(&mut sleeve_account.data.as_slice()).unwrap();
    assert_eq!(stored.writer_principal_atoms, amount);
    assert_eq!(stored.flat_par_supply_atoms, amount);
    assert_eq!(stored.accounted_asset_atoms, amount);

    let destination_account = rpc.get_account(destination).await.unwrap().unwrap();
    let token =
        light_token_interface::state::Token::deserialize(&mut destination_account.data.as_slice())
            .unwrap();
    assert_eq!(token.amount, amount);
    assert_eq!(Pubkey::new_from_array(token.mint.to_bytes()), flat_mint);

    let interface_account = rpc.get_account(flat_interface).await.unwrap().unwrap();
    assert_eq!(
        TokenAccountState::unpack(&interface_account.data)
            .unwrap()
            .amount,
        amount
    );
    let flat_mint_account = rpc.get_account(flat_mint).await.unwrap().unwrap();
    assert_eq!(
        Mint::unpack(&flat_mint_account.data).unwrap().supply,
        amount
    );
    assert!(rpc.get_account(flat_staging).await.unwrap().is_none());
}
