#![cfg(all(feature = "devnet-solo-backfill-2026", feature = "test-sbf"))]

use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{
        CONTRACT_MINT_PDA_SEED, CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED,
        ORACLE_ECONOMICS_CONFIG_PDA_SEED, ORACLE_MONTH_PDA_SEED, ORACLE_OPENING_CLAIM_PDA_SEED,
        ORACLE_SKU_EMPTY_HASH_DOMAIN, ORACLE_SKU_LEAF_HASH_DOMAIN, ORACLE_SKU_NODE_HASH_DOMAIN,
        ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, ORACLE_SOURCE_PDA_SEED,
        ORACLE_SUPPORT_POSITION_PDA_SEED, USER_COLLATERAL_PDA_SEED, VAULT_PDA_SEED,
    },
    processor::process_instruction,
    state::{
        derive_devnet_solo_backfill_2026_v1_pda, derive_oracle_active_weight_manifest_pda,
        derive_oracle_bucket_median_pda, derive_oracle_product_sku_manifest_pda,
        derive_oracle_recipe_weight_manifest_pda, derive_oracle_sku_coverage_manifest_pda,
        derive_oracle_sku_coverage_record_pda, derive_oracle_usdc_reward_schedule_pda,
        derive_oracle_usdc_reward_vault_pda, derive_oracle_usdc_sku_pool_pda,
        derive_oracle_usdc_source_reward_pda, DevnetSoloBackfill2026V1, InstrumentDefinition,
        Market, MarketMintAccounting, MarketParameters, OptionKind, OracleActiveWeightManifest,
        OracleEconomicParams, OracleEconomicsConfig, OracleMonthState, OraclePhase,
        OracleProductSkuManifest, OracleRecipeWeightManifest, OracleRecipeWeightPhase,
        OracleSkuCoverageManifest, OracleSourceObservations, OracleSourceState, OracleSourceStatus,
        SettlementStyle, UserCollateral, VaultConfig,
    },
};
use serde_json::Value;
use solana_program::hash::hashv;
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::AccountSharedData,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, SeedDerivable, Signer},
    transaction::Transaction,
};

const INITIALIZE_SIDECAR_TAG: u8 = 29;
const INITIALIZE_COHORT_TAG: u8 = 31;
const CREATE_SUPPORTED_SOURCE_TAG: u8 = 34;
const FINALIZE_COVERAGE_TAG: u8 = 35;
const ACCUMULATE_RECIPE_TAG: u8 = 69;
const FINALIZE_RECIPE_TAG: u8 = 97;
const SUBMIT_OPENING_TAG: u8 = 189;
const FINALIZE_OPENING_TAG: u8 = 204;
const BEGIN_ACTIVE_WEIGHTS_TAG: u8 = 206;
const ACCUMULATE_ACTIVE_WEIGHT_TAG: u8 = 211;
const FINALIZE_ACTIVE_WEIGHTS_TAG: u8 = 212;
const FINALIZE_GAME_TAG: u8 = 214;

// V3 preparation starts after the former September 1 sunset.
const TEST_START_TS: u64 = 1_788_652_800;
const RAMX_EXPIRY_TS: u64 = 1_790_812_800;
const PLACEMENT_END_OFFSET: u64 = 60;
const CHALLENGE_END_OFFSET: u64 = 90;
const RESOLUTION_END_OFFSET: u64 = 105;
const OPENING_END_OFFSET: u64 = 120;

const TEST_ADMIN: Pubkey = solana_program::pubkey!("7v54NWdBtkjuAFJrLGsS2SXnuk8nKam81mZJeeYxVFi9");
const TEST_ORACLE: Pubkey = solana_program::pubkey!("mBKqcnGotbsSb5vNrdyhzZ5EhqZdids9QYiTRckvi7v");
const TEST_COLLATERAL_MINT: Pubkey =
    solana_program::pubkey!("AoVsGaj8MSJ6xwKxfFxo9iZWH3enC8RRTXKH2fx2F8os");

#[derive(Clone)]
struct SideTopology {
    market_id: [u8; 32],
    market: Pubkey,
    month: Pubkey,
    coverage: Pubkey,
    schedule: Pubkey,
}

struct Harness {
    context: ProgramTestContext,
    admin: Keypair,
    oracle: Keypair,
    config: Pubkey,
    economics: Pubkey,
    product_manifest: Pubkey,
    reward_vault: Pubkey,
    sidecar: Pubkey,
    call: SideTopology,
    put: SideTopology,
    collateral: Pubkey,
    sku_ids: Vec<[u8; 32]>,
    sku_proofs: Vec<[[u8; 32]; 6]>,
}

fn fixed_text_32(value: &str) -> [u8; 32] {
    let bytes = value.as_bytes();
    assert!(!bytes.is_empty() && bytes.len() <= 32);
    let mut output = [0u8; 32];
    output[..bytes.len()].copy_from_slice(bytes);
    output
}

fn namespaced_pda(program_id: &Pubkey, seeds: &[&[u8]]) -> (Pubkey, u8) {
    let mut values = Vec::with_capacity(seeds.len() + 1);
    values.push(CURRENT_STATE_NAMESPACE_SEED);
    values.extend_from_slice(seeds);
    Pubkey::find_program_address(&values, program_id)
}

fn side_topology(side: &str) -> SideTopology {
    let program_id = light_token_minter::id();
    let market_id = fixed_text_32(&format!("RAMX-202609-{side}-01"));
    let market = namespaced_pda(&program_id, &[MARKET_PDA_SEED, &market_id]).0;
    let expiry = RAMX_EXPIRY_TS.to_le_bytes();
    let month = namespaced_pda(
        &program_id,
        &[ORACLE_MONTH_PDA_SEED, market.as_ref(), &expiry],
    )
    .0;
    SideTopology {
        market_id,
        market,
        month,
        coverage: derive_oracle_sku_coverage_manifest_pda(&program_id, &month).0,
        schedule: derive_oracle_usdc_reward_schedule_pda(&program_id, &month).0,
    }
}

fn canonical_ramx_sku_ids() -> Vec<[u8; 32]> {
    let value: Value = serde_json::from_str(include_str!(
        "../../../governance/ramx_product_sku_manifest.v1.json"
    ))
    .unwrap();
    let mut ids = Vec::new();
    for group in value["groups"].as_array().unwrap() {
        for subgroup in group["subgroups"].as_array().unwrap() {
            for label in subgroup["skuLabels"].as_array().unwrap() {
                ids.push(fixed_text_32(label.as_str().unwrap()));
            }
        }
    }
    ids.sort_unstable();
    assert_eq!(ids.len(), 52);
    ids
}

fn canonical_merkle_proofs(ids: &[[u8; 32]]) -> ([u8; 32], Vec<[[u8; 32]; 6]>) {
    assert_eq!(ids.len(), 52);
    let width = 64usize;
    let mut layers = Vec::new();
    let mut leaves = Vec::with_capacity(width);
    for index in 0..width {
        let index_u16 = u16::try_from(index).unwrap();
        leaves.push(if let Some(sku_id) = ids.get(index) {
            hashv(&[
                ORACLE_SKU_LEAF_HASH_DOMAIN,
                &index_u16.to_le_bytes(),
                sku_id,
            ])
            .to_bytes()
        } else {
            hashv(&[ORACLE_SKU_EMPTY_HASH_DOMAIN, &index_u16.to_le_bytes()]).to_bytes()
        });
    }
    layers.push(leaves);
    while layers.last().unwrap().len() > 1 {
        let next = layers
            .last()
            .unwrap()
            .chunks_exact(2)
            .map(|pair| hashv(&[ORACLE_SKU_NODE_HASH_DOMAIN, &pair[0], &pair[1]]).to_bytes())
            .collect::<Vec<_>>();
        layers.push(next);
    }
    let proofs = (0..ids.len())
        .map(|leaf_index| {
            let mut proof = [[0u8; 32]; 6];
            let mut index = leaf_index;
            for (depth, layer) in layers.iter().take(6).enumerate() {
                proof[depth] = layer[index ^ 1];
                index /= 2;
            }
            proof
        })
        .collect();
    (layers.last().unwrap()[0], proofs)
}

async fn set_program_state<T: BorshSerialize>(
    context: &mut ProgramTestContext,
    address: Pubkey,
    value: &T,
    len: usize,
) {
    let rent = context.banks_client.get_rent().await.unwrap();
    let encoded = value.try_to_vec().unwrap();
    assert!(encoded.len() <= len);
    let mut data = vec![0u8; len];
    data[..encoded.len()].copy_from_slice(&encoded);
    let mut account =
        AccountSharedData::new(rent.minimum_balance(len), len, &light_token_minter::id());
    account.set_data_from_slice(&data);
    context.set_account(&address, &account);
}

fn set_system_balance(context: &mut ProgramTestContext, address: Pubkey, lamports: u64) {
    let account = AccountSharedData::new(lamports, 0, &solana_sdk::system_program::id());
    context.set_account(&address, &account);
}

async fn set_clock(context: &mut ProgramTestContext, unix_timestamp: u64) {
    let mut clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    clock.slot = clock.slot.saturating_add(1);
    clock.unix_timestamp = i64::try_from(unix_timestamp).unwrap();
    context.set_sysvar(&clock);
}

async fn send(
    context: &mut ProgramTestContext,
    mut instruction: Instruction,
    signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    #[cfg(feature = "governance-gate-v1")]
    {
        use light_token_minter::governance_gate::{
            derive_protocol_gate_pda, PINNED_CONTROLLER_PROGRAM_ID,
        };
        let gate =
            derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &light_token_minter::id()).0;
        instruction
            .accounts
            .push(AccountMeta::new_readonly(gate, false));
        instruction.data.extend_from_slice(b"AGV1\x01\0\0\0");
        instruction.data.extend_from_slice(&1u64.to_le_bytes());
    }
    let recent_blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let mut all_signers = vec![&context.payer];
    all_signers.extend_from_slice(signers);
    let transaction = Transaction::new_signed_with_payer(
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
            instruction,
        ],
        Some(&context.payer.pubkey()),
        &all_signers,
        recent_blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

async fn read_state<T: BorshDeserialize>(context: &mut ProgramTestContext, address: Pubkey) -> T {
    let account = context
        .banks_client
        .get_account(address)
        .await
        .unwrap()
        .expect("account exists");
    T::deserialize(&mut &account.data[..]).unwrap()
}

fn market_state(topology: &SideTopology, kind: OptionKind) -> Market {
    let program_id = light_token_minter::id();
    let bump = namespaced_pda(&program_id, &[MARKET_PDA_SEED, &topology.market_id]).1;
    let contract_mint = namespaced_pda(
        &program_id,
        &[CONTRACT_MINT_PDA_SEED, topology.market.as_ref()],
    )
    .0;
    Market {
        is_initialized: true,
        bump,
        created_by: TEST_ADMIN,
        market_id: topology.market_id,
        collateral_mint: TEST_COLLATERAL_MINT,
        long_contract_mint: Some(contract_mint),
        instrument: InstrumentDefinition {
            underlying_id: fixed_text_32("ram-standardized-baskets"),
            expiry_ts: RAMX_EXPIRY_TS,
            strike_price: 100_000_000,
            cap_price: if kind == OptionKind::CallSpread {
                112_000_000
            } else {
                88_000_000
            },
            contract_size: 1_000_000,
            max_payout_per_contract: 12_000_000,
            kind,
            settlement: SettlementStyle::CashSettledMonthly,
        },
        params: MarketParameters {
            tick_size: 50_000,
            lot_size: 1,
            min_order_qty: 1,
            min_cancel_slots: 32,
            max_fills_per_instruction: 8,
        },
        total_position_collateral_locked: 0,
        paused: true,
        mint_accounting: MarketMintAccounting::canonical_empty(),
    }
}

impl Harness {
    async fn start() -> Self {
        let mut program_test = ProgramTest::new(
            "light_token_minter",
            light_token_minter::id(),
            processor!(process_instruction),
        );
        program_test.prefer_bpf(false);
        let mut context = program_test.start_with_context().await;
        #[cfg(feature = "governance-gate-v1")]
        {
            use light_token_minter::governance_gate::{
                derive_controller_config_pda, derive_protocol_gate_pda,
                derive_target_programdata_pda, PINNED_CONTROLLER_PROGRAM_ID, PROTOCOL_GATE_LEN,
            };
            let target = light_token_minter::id();
            let (gate, bump) = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target);
            let mut data = vec![0u8; PROTOCOL_GATE_LEN];
            data[..8].copy_from_slice(b"AGVGAT01");
            data[8] = 1;
            data[9] = bump;
            data[10] = 1;
            data[12..44].copy_from_slice(
                derive_controller_config_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target)
                    .0
                    .as_ref(),
            );
            data[44..76].copy_from_slice(target.as_ref());
            data[76..108].copy_from_slice(derive_target_programdata_pda(&target).as_ref());
            data[108..116].copy_from_slice(&1u64.to_le_bytes());
            let mut account = AccountSharedData::new(
                10_000_000,
                PROTOCOL_GATE_LEN,
                &PINNED_CONTROLLER_PROGRAM_ID,
            );
            account.set_data_from_slice(&data);
            context.set_account(&gate, &account);
        }
        let admin = Keypair::from_seed(&[11u8; 32]).unwrap();
        let oracle = Keypair::from_seed(&[12u8; 32]).unwrap();
        assert_eq!(admin.pubkey(), TEST_ADMIN);
        assert_eq!(oracle.pubkey(), TEST_ORACLE);
        set_system_balance(&mut context, TEST_ADMIN, 1_000_000_000_000);
        set_system_balance(&mut context, TEST_ORACLE, 1_000_000_000_000);
        set_clock(&mut context, TEST_START_TS).await;

        let program_id = light_token_minter::id();
        let config = namespaced_pda(&program_id, &[VAULT_PDA_SEED]).0;
        let economics = namespaced_pda(&program_id, &[ORACLE_ECONOMICS_CONFIG_PDA_SEED]).0;
        let product_underlying = fixed_text_32("ram-standardized-baskets");
        let product_manifest =
            derive_oracle_product_sku_manifest_pda(&program_id, &product_underlying).0;
        let reward_vault = derive_oracle_usdc_reward_vault_pda(&program_id).0;
        let sidecar = derive_devnet_solo_backfill_2026_v1_pda(&program_id).0;
        let call = side_topology("CALL");
        let put = side_topology("PUT");
        let collateral = namespaced_pda(
            &program_id,
            &[USER_COLLATERAL_PDA_SEED, TEST_ORACLE.as_ref()],
        )
        .0;
        let sku_ids = canonical_ramx_sku_ids();
        let (root, sku_proofs) = canonical_merkle_proofs(&sku_ids);
        assert_eq!(
            root,
            [
                0x52, 0xa5, 0x74, 0xe7, 0xfe, 0xe1, 0x2f, 0x99, 0x21, 0xb3, 0xb2, 0x20, 0xb7, 0x09,
                0xbe, 0x16, 0xc1, 0x3a, 0x6f, 0x29, 0x0a, 0xbb, 0xdc, 0x2c, 0xc2, 0x03, 0xed, 0x11,
                0x91, 0xec, 0xf5, 0x78,
            ]
        );

        set_program_state(
            &mut context,
            config,
            &VaultConfig {
                is_initialized: true,
                bump: namespaced_pda(&program_id, &[VAULT_PDA_SEED]).1,
                admin: TEST_ADMIN,
                oracle_authority: TEST_ORACLE,
                usdc_mint: TEST_COLLATERAL_MINT,
                vault_token_account: Pubkey::new_unique(),
                paused: false,
                account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
                account_version: VaultConfig::ACCOUNT_VERSION,
            },
            VaultConfig::LEN,
        )
        .await;
        set_program_state(
            &mut context,
            economics,
            &OracleEconomicsConfig {
                is_initialized: true,
                bump: namespaced_pda(&program_id, &[ORACLE_ECONOMICS_CONFIG_PDA_SEED]).1,
                account_discriminator: OracleEconomicsConfig::ACCOUNT_DISCRIMINATOR,
                account_version: OracleEconomicsConfig::ACCOUNT_VERSION,
                config_version: 1,
                economics: OracleEconomicParams::default(),
                last_updated_slot: 1,
            },
            OracleEconomicsConfig::LEN,
        )
        .await;
        set_program_state(
            &mut context,
            product_manifest,
            &OracleProductSkuManifest {
                is_initialized: true,
                bump: derive_oracle_product_sku_manifest_pda(&program_id, &product_underlying).1,
                account_discriminator: OracleProductSkuManifest::ACCOUNT_DISCRIMINATOR,
                account_version: OracleProductSkuManifest::ACCOUNT_VERSION,
                underlying_id: product_underlying,
                required_sku_root: root,
                required_sku_count: 52,
                reserved: [0; 6],
                last_updated_slot: 1,
            },
            OracleProductSkuManifest::LEN,
        )
        .await;
        set_program_state(
            &mut context,
            reward_vault,
            &light_token_minter::state::OracleUsdcRewardVault {
                is_initialized: true,
                bump: derive_oracle_usdc_reward_vault_pda(&program_id).1,
                account_discriminator:
                    light_token_minter::state::OracleUsdcRewardVault::ACCOUNT_DISCRIMINATOR,
                account_version: light_token_minter::state::OracleUsdcRewardVault::ACCOUNT_VERSION,
                mint: TEST_COLLATERAL_MINT,
                token_account: Pubkey::new_unique(),
                ..light_token_minter::state::OracleUsdcRewardVault::default()
            },
            light_token_minter::state::OracleUsdcRewardVault::LEN,
        )
        .await;
        set_program_state(
            &mut context,
            call.market,
            &market_state(&call, OptionKind::CallSpread),
            Market::LEN,
        )
        .await;
        set_program_state(
            &mut context,
            put.market,
            &market_state(&put, OptionKind::PutSpread),
            Market::LEN,
        )
        .await;
        set_program_state(
            &mut context,
            collateral,
            &UserCollateral {
                is_initialized: true,
                bump: namespaced_pda(
                    &program_id,
                    &[USER_COLLATERAL_PDA_SEED, TEST_ORACLE.as_ref()],
                )
                .1,
                owner: TEST_ORACLE,
                available_balance: 10_000_000_000,
                position_locked_balance: 0,
                last_action_slot: 1,
            },
            UserCollateral::LEN,
        )
        .await;

        Self {
            context,
            admin,
            oracle,
            config,
            economics,
            product_manifest,
            reward_vault,
            sidecar,
            call,
            put,
            collateral,
            sku_ids,
            sku_proofs,
        }
    }

    fn sidecar_ix(&self) -> Instruction {
        Instruction {
            program_id: light_token_minter::id(),
            accounts: vec![
                AccountMeta::new(TEST_ADMIN, true),
                AccountMeta::new_readonly(TEST_ORACLE, true),
                AccountMeta::new_readonly(self.config, false),
                AccountMeta::new(self.sidecar, false),
                AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            ],
            data: vec![INITIALIZE_SIDECAR_TAG],
        }
    }

    fn cohort_ix(&self, cohort_index: u8) -> Instruction {
        Instruction {
            program_id: light_token_minter::id(),
            accounts: vec![
                AccountMeta::new(TEST_ORACLE, true),
                AccountMeta::new(self.sidecar, false),
                AccountMeta::new_readonly(self.config, false),
                AccountMeta::new_readonly(self.economics, false),
                AccountMeta::new_readonly(self.product_manifest, false),
                AccountMeta::new_readonly(self.reward_vault, false),
                AccountMeta::new_readonly(self.call.market, false),
                AccountMeta::new(self.call.month, false),
                AccountMeta::new(self.call.coverage, false),
                AccountMeta::new(self.call.schedule, false),
                AccountMeta::new_readonly(self.put.market, false),
                AccountMeta::new(self.put.month, false),
                AccountMeta::new(self.put.coverage, false),
                AccountMeta::new(self.put.schedule, false),
                AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            ],
            data: vec![INITIALIZE_COHORT_TAG, cohort_index],
        }
    }

    fn item_topology(&self, sku_index: usize) -> ItemTopology {
        ItemTopology::new(&self.call, self.sku_ids[sku_index])
    }
}

struct ItemTopology {
    sku_id: [u8; 32],
    sku_pool: Pubkey,
    source: Pubkey,
    observations: Pubkey,
    source_reward: Pubkey,
    support: Pubkey,
    coverage_record: Pubkey,
    opening_claim: Pubkey,
    bucket: Pubkey,
}

impl ItemTopology {
    fn new(side: &SideTopology, sku_id: [u8; 32]) -> Self {
        let program_id = light_token_minter::id();
        let source_id = hashv(&[
            b"amoeba-devnet-solo-backfill-2026-v1",
            b"source-id",
            side.month.as_ref(),
            &sku_id,
        ])
        .to_bytes();
        let source = namespaced_pda(
            &program_id,
            &[ORACLE_SOURCE_PDA_SEED, side.month.as_ref(), &source_id],
        )
        .0;
        Self {
            sku_id,
            sku_pool: derive_oracle_usdc_sku_pool_pda(&program_id, &side.schedule, &sku_id).0,
            source,
            observations: namespaced_pda(
                &program_id,
                &[ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, source.as_ref()],
            )
            .0,
            source_reward: derive_oracle_usdc_source_reward_pda(
                &program_id,
                &side.schedule,
                &source,
            )
            .0,
            support: namespaced_pda(
                &program_id,
                &[
                    ORACLE_SUPPORT_POSITION_PDA_SEED,
                    side.month.as_ref(),
                    source.as_ref(),
                    TEST_ORACLE.as_ref(),
                ],
            )
            .0,
            coverage_record: derive_oracle_sku_coverage_record_pda(
                &program_id,
                &side.month,
                &sku_id,
            )
            .0,
            opening_claim: namespaced_pda(
                &program_id,
                &[
                    ORACLE_OPENING_CLAIM_PDA_SEED,
                    side.month.as_ref(),
                    source.as_ref(),
                ],
            )
            .0,
            bucket: derive_oracle_bucket_median_pda(&program_id, &side.month, &sku_id).0,
        }
    }
}

fn item_payload(tag: u8, sku_index: usize, sku_id: &[u8; 32]) -> Vec<u8> {
    let mut data = vec![tag, 0, 0];
    data.extend_from_slice(&u16::try_from(sku_index).unwrap().to_le_bytes());
    data.extend_from_slice(sku_id);
    data
}

fn source_ix(harness: &Harness, sku_index: usize) -> Instruction {
    let item = harness.item_topology(sku_index);
    let mut data = item_payload(CREATE_SUPPORTED_SOURCE_TAG, sku_index, &item.sku_id);
    for node in &harness.sku_proofs[sku_index] {
        data.extend_from_slice(node);
    }
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(TEST_ORACLE, true),
            AccountMeta::new_readonly(harness.sidecar, false),
            AccountMeta::new_readonly(harness.config, false),
            AccountMeta::new_readonly(harness.call.market, false),
            AccountMeta::new(harness.call.month, false),
            AccountMeta::new(harness.call.coverage, false),
            AccountMeta::new(harness.call.schedule, false),
            AccountMeta::new(item.sku_pool, false),
            AccountMeta::new(item.source, false),
            AccountMeta::new(item.observations, false),
            AccountMeta::new(item.source_reward, false),
            AccountMeta::new(harness.collateral, false),
            AccountMeta::new(item.support, false),
            AccountMeta::new(item.coverage_record, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data,
    }
}

fn cohort_side_ix(tag: u8, harness: &Harness, extra: Vec<AccountMeta>) -> Instruction {
    let operator = if tag == BEGIN_ACTIVE_WEIGHTS_TAG {
        AccountMeta::new(TEST_ORACLE, true)
    } else {
        AccountMeta::new_readonly(TEST_ORACLE, true)
    };
    let mut accounts = vec![
        operator,
        AccountMeta::new_readonly(harness.sidecar, false),
        AccountMeta::new_readonly(harness.config, false),
        AccountMeta::new_readonly(harness.call.market, false),
        AccountMeta::new(harness.call.month, false),
    ];
    accounts.extend(extra);
    Instruction {
        program_id: light_token_minter::id(),
        accounts,
        data: vec![tag, 0, 0],
    }
}

fn recipe_item_ix(harness: &Harness, sku_index: usize) -> Instruction {
    let item = harness.item_topology(sku_index);
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(TEST_ORACLE, true),
            AccountMeta::new_readonly(harness.sidecar, false),
            AccountMeta::new_readonly(harness.config, false),
            AccountMeta::new_readonly(harness.call.market, false),
            AccountMeta::new(harness.call.month, false),
            AccountMeta::new_readonly(harness.call.coverage, false),
            AccountMeta::new_readonly(item.coverage_record, false),
            AccountMeta::new(item.source, false),
            AccountMeta::new(
                derive_oracle_recipe_weight_manifest_pda(
                    &light_token_minter::id(),
                    &harness.call.month,
                )
                .0,
                false,
            ),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: item_payload(ACCUMULATE_RECIPE_TAG, sku_index, &item.sku_id),
    }
}

fn submit_opening_ix(harness: &Harness, sku_index: usize) -> Instruction {
    let item = harness.item_topology(sku_index);
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(TEST_ORACLE, true),
            AccountMeta::new_readonly(harness.sidecar, false),
            AccountMeta::new_readonly(harness.config, false),
            AccountMeta::new_readonly(harness.call.market, false),
            AccountMeta::new(harness.call.month, false),
            AccountMeta::new_readonly(item.coverage_record, false),
            AccountMeta::new_readonly(item.sku_pool, false),
            AccountMeta::new(item.source, false),
            AccountMeta::new(harness.collateral, false),
            AccountMeta::new(item.opening_claim, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: item_payload(SUBMIT_OPENING_TAG, sku_index, &item.sku_id),
    }
}

fn finalize_opening_ix(harness: &Harness, sku_index: usize) -> Instruction {
    let item = harness.item_topology(sku_index);
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new_readonly(TEST_ORACLE, true),
            AccountMeta::new_readonly(harness.sidecar, false),
            AccountMeta::new_readonly(harness.config, false),
            AccountMeta::new_readonly(harness.call.market, false),
            AccountMeta::new(harness.call.month, false),
            AccountMeta::new_readonly(item.coverage_record, false),
            AccountMeta::new(item.source, false),
            AccountMeta::new(item.observations, false),
            AccountMeta::new(item.opening_claim, false),
            AccountMeta::new_readonly(harness.collateral, false),
        ],
        data: item_payload(FINALIZE_OPENING_TAG, sku_index, &item.sku_id),
    }
}

fn active_item_ix(harness: &Harness, sku_index: usize) -> Instruction {
    let item = harness.item_topology(sku_index);
    Instruction {
        program_id: light_token_minter::id(),
        accounts: vec![
            AccountMeta::new(TEST_ORACLE, true),
            AccountMeta::new_readonly(harness.sidecar, false),
            AccountMeta::new_readonly(harness.config, false),
            AccountMeta::new_readonly(harness.call.market, false),
            AccountMeta::new(harness.call.month, false),
            AccountMeta::new(
                derive_oracle_active_weight_manifest_pda(
                    &light_token_minter::id(),
                    &harness.call.month,
                )
                .0,
                false,
            ),
            AccountMeta::new_readonly(item.coverage_record, false),
            AccountMeta::new_readonly(item.source, false),
            AccountMeta::new_readonly(item.observations, false),
            AccountMeta::new_readonly(item.sku_pool, false),
            AccountMeta::new(item.bucket, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: item_payload(ACCUMULATE_ACTIVE_WEIGHT_TAG, sku_index, &item.sku_id),
    }
}

#[tokio::test]
async fn exact_ramx_202609_call_executes_the_complete_accelerated_program_path() {
    let mut harness = Harness::start().await;

    let sidecar_ix = harness.sidecar_ix();
    send(
        &mut harness.context,
        sidecar_ix,
        &[&harness.admin, &harness.oracle],
    )
    .await
    .unwrap();
    let repeated_sidecar_ix = harness.sidecar_ix();
    assert!(send(
        &mut harness.context,
        repeated_sidecar_ix,
        &[&harness.admin, &harness.oracle],
    )
    .await
    .is_err());
    let invalid_cohort_ix = harness.cohort_ix(4);
    assert!(
        send(&mut harness.context, invalid_cohort_ix, &[&harness.oracle],)
            .await
            .is_err()
    );
    let cohort_ix = harness.cohort_ix(0);
    send(&mut harness.context, cohort_ix, &[&harness.oracle])
        .await
        .unwrap();

    for sku_index in 0..harness.sku_ids.len() {
        let ix = source_ix(&harness, sku_index);
        send(&mut harness.context, ix, &[&harness.oracle])
            .await
            .unwrap();
    }
    let finalize_coverage_ix = cohort_side_ix(
        FINALIZE_COVERAGE_TAG,
        &harness,
        vec![AccountMeta::new(harness.call.coverage, false)],
    );
    send(
        &mut harness.context,
        finalize_coverage_ix,
        &[&harness.oracle],
    )
    .await
    .unwrap();
    let source_submission: OracleMonthState =
        read_state(&mut harness.context, harness.call.month).await;
    assert_eq!(source_submission.phase, OraclePhase::Scramble);
    assert_eq!(source_submission.source_count, 52);

    set_clock(&mut harness.context, TEST_START_TS + CHALLENGE_END_OFFSET).await;
    for sku_index in 0..harness.sku_ids.len() {
        let ix = recipe_item_ix(&harness, sku_index);
        send(&mut harness.context, ix, &[&harness.oracle])
            .await
            .unwrap();
    }
    let recipe =
        derive_oracle_recipe_weight_manifest_pda(&light_token_minter::id(), &harness.call.month).0;
    let finalize_recipe_ix = cohort_side_ix(
        FINALIZE_RECIPE_TAG,
        &harness,
        vec![
            AccountMeta::new_readonly(harness.call.coverage, false),
            AccountMeta::new(recipe, false),
        ],
    );
    send(&mut harness.context, finalize_recipe_ix, &[&harness.oracle])
        .await
        .unwrap();
    let recipe_state: OracleRecipeWeightManifest = read_state(&mut harness.context, recipe).await;
    assert_eq!(recipe_state.phase, OracleRecipeWeightPhase::Finalized);
    assert_eq!(recipe_state.declared_weight_total_bps, 10_000);

    set_clock(&mut harness.context, TEST_START_TS + RESOLUTION_END_OFFSET).await;
    for sku_index in 0..harness.sku_ids.len() {
        let ix = submit_opening_ix(&harness, sku_index);
        send(&mut harness.context, ix, &[&harness.oracle])
            .await
            .unwrap();
    }
    let submitted_clock = harness
        .context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let mut challenge_complete_clock = submitted_clock;
    challenge_complete_clock.slot = challenge_complete_clock.slot.saturating_add(4);
    harness.context.set_sysvar(&challenge_complete_clock);
    for sku_index in 0..harness.sku_ids.len() {
        let ix = finalize_opening_ix(&harness, sku_index);
        send(&mut harness.context, ix, &[&harness.oracle])
            .await
            .unwrap();
    }

    let active =
        derive_oracle_active_weight_manifest_pda(&light_token_minter::id(), &harness.call.month).0;
    let begin_active_ix = cohort_side_ix(
        BEGIN_ACTIVE_WEIGHTS_TAG,
        &harness,
        vec![
            AccountMeta::new_readonly(recipe, false),
            AccountMeta::new(active, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
    );
    send(&mut harness.context, begin_active_ix, &[&harness.oracle])
        .await
        .unwrap();
    for sku_index in 0..harness.sku_ids.len() {
        let ix = active_item_ix(&harness, sku_index);
        send(&mut harness.context, ix, &[&harness.oracle])
            .await
            .unwrap();
    }
    let finalize_active_ix = cohort_side_ix(
        FINALIZE_ACTIVE_WEIGHTS_TAG,
        &harness,
        vec![
            AccountMeta::new_readonly(recipe, false),
            AccountMeta::new(active, false),
        ],
    );
    send(&mut harness.context, finalize_active_ix, &[&harness.oracle])
        .await
        .unwrap();

    set_clock(&mut harness.context, TEST_START_TS + OPENING_END_OFFSET).await;
    send(
        &mut harness.context,
        Instruction {
            program_id: light_token_minter::id(),
            accounts: vec![
                AccountMeta::new_readonly(TEST_ORACLE, true),
                AccountMeta::new(harness.sidecar, false),
                AccountMeta::new_readonly(harness.config, false),
                AccountMeta::new(harness.call.market, false),
                AccountMeta::new(harness.call.month, false),
                AccountMeta::new(harness.call.coverage, false),
                AccountMeta::new_readonly(active, false),
            ],
            data: vec![FINALIZE_GAME_TAG, 0, 0],
        },
        &[&harness.oracle],
    )
    .await
    .unwrap();

    let game: OracleMonthState = read_state(&mut harness.context, harness.call.month).await;
    let coverage: OracleSkuCoverageManifest =
        read_state(&mut harness.context, harness.call.coverage).await;
    let active_state: OracleActiveWeightManifest = read_state(&mut harness.context, active).await;
    let market: Market = read_state(&mut harness.context, harness.call.market).await;
    let sidecar: DevnetSoloBackfill2026V1 = read_state(&mut harness.context, harness.sidecar).await;
    assert_eq!(game.phase, OraclePhase::Game);
    assert_eq!(game.opened_source_count, 52);
    assert_eq!(game.active_weight_group_count, 52);
    assert_eq!(active_state.processed_bucket_weight_bps, 10_000);
    // The historical demo's call anchor admits both $12 gross-exposure legs.
    assert_eq!(active_state.max_open_interest_payout, 24_000_000);
    assert!(coverage.coverage_finalized);
    assert!(!market.paused);
    assert_eq!(sidecar.consumed_cohort_mask & 1, 1);
    assert_eq!(sidecar.game_market_mask & 1, 1);
    assert_eq!(sidecar.completed_cohort_mask & 1, 0);

    let first = harness.item_topology(0);
    let source: OracleSourceState = read_state(&mut harness.context, first.source).await;
    let observations: OracleSourceObservations =
        read_state(&mut harness.context, first.observations).await;
    assert_eq!(source.status, OracleSourceStatus::Active);
    assert_eq!(source.observation_count, 1);
    assert_ne!(observations.states[0], 0);
    assert!(TEST_START_TS + PLACEMENT_END_OFFSET < TEST_START_TS + CHALLENGE_END_OFFSET);
}
