#![cfg(feature = "writer-math-benchmark")]

use std::sync::atomic::{AtomicUsize, Ordering};

use borsh::{BorshDeserialize, BorshSerialize};
#[cfg(feature = "phase3-synthetic-governance-controller")]
use light_token_minter::governance_gate::{
    derive_controller_config_pda, derive_protocol_gate_pda, derive_target_programdata_pda,
    GateStatusV1, GovernanceInstructionTailV1, PINNED_CONTROLLER_PROGRAM_ID,
    PROTOCOL_GATE_DISCRIMINATOR, PROTOCOL_GATE_LEN, PROTOCOL_GATE_VERSION_V1,
};
use light_token_minter::{
    constants::{
        CONTRACT_MINT_PDA_SEED, CONTRACT_MINT_STAGING_PDA_SEED, CURRENT_STATE_NAMESPACE_SEED,
        LIGHT_TOKEN_COMPRESSIBLE_CONFIG, LIGHT_TOKEN_RENT_SPONSOR, MARKET_PDA_SEED, VAULT_PDA_SEED,
        WRITER_AUCTION_ESCROW_PDA_SEED, WRITER_AUCTION_PDA_SEED, WRITER_BID_INDEX_PDA_SEED,
        WRITER_BID_PDA_SEED, WRITER_CLOSE_FLAT_ESCROW_PDA_SEED, WRITER_CLOSE_REQUEST_PDA_SEED,
        WRITER_FLAT_BURN_CUSTODY_PDA_SEED, WRITER_FLAT_MINT_PDA_SEED, WRITER_FLAT_STAGING_PDA_SEED,
        WRITER_MAX_FUNDED_BIDS, WRITER_MAX_LIVE_SERIES, WRITER_POLICY_SNAPSHOT_PDA_SEED,
        WRITER_RATIO_SCALE_PPM, WRITER_RETIREMENT_CUSTODY_PDA_SEED, WRITER_SERIES_BOOK_PDA_SEED,
        WRITER_SETTLEMENT_GROUP_PDA_SEED, WRITER_SLEEVE_PDA_SEED,
        WRITER_SLEEVE_USDC_VAULT_PDA_SEED,
    },
    error::VaultError,
    instruction::{PlanWriterAuctionChunkV1Params, VaultInstruction},
    state::{
        derive_oracle_active_weight_manifest_pda, InstrumentDefinition, Market,
        MarketMintAccounting, MarketParameters, OptionKind, OracleActiveWeightManifest,
        OracleRecipeWeightPhase, SettlementStyle, VaultConfig, WriterAuctionPriorityRule,
        WriterAuctionStatus, WriterAuctionV1, WriterBidDeliveryMode, WriterBidIndexRecordV1,
        WriterBidIndexV1, WriterBidStatus, WriterBidV1, WriterCloseRequestStatus,
        WriterCloseRequestV1, WriterPolicySnapshotV1, WriterReserveRoundingMode,
        WriterSecurityMode, WriterSeriesBookV1, WriterSeriesCustodyStatus, WriterSeriesRecordV1,
        WriterSeriesSettlementStatus, WriterSettlementGroupStatus, WriterSettlementGroupV1,
        WriterSleeveStatus, WriterSleeveV1,
    },
    writer_sleeve_math::{
        exact_reserve, gross_external_maximum_payout, proportional_close_preview, WriterSeries,
        WRITER_CONTRACT_ATOMIC_SCALE,
    },
};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, hash::hashv, program_error::ProgramError,
    program_option::COption, program_pack::Pack,
};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    address_lookup_table::{
        program as address_lookup_table_program,
        state::{AddressLookupTable, LookupTableMeta, LOOKUP_TABLE_META_SIZE},
        AddressLookupTableAccount,
    },
    instruction::{AccountMeta, Instruction, InstructionError},
    message::{v0, VersionedMessage},
    pubkey::Pubkey,
    signature::{Keypair, SeedDerivable, Signer},
    transaction::{Transaction, TransactionError, VersionedTransaction},
};
use spl_token::state::{Account as TokenAccount, AccountState, Mint};

const TRANSACTION_COMPUTE_LIMIT: u64 = 1_400_000;
const PACKET_DATA_SIZE: usize = 1_232;
const SERIES_COUNT: usize = WRITER_MAX_LIVE_SERIES;
const WRITER_CLOSE_TOKEN_SENTINEL_ERROR: u32 = 0x5e17_1e1d;
const WRITER_AUCTION_TOKEN_SENTINEL_ERROR: u32 = 0x5e17_a007;
static WRITER_AUCTION_TOKEN_SENTINEL_CALLS: AtomicUsize = AtomicUsize::new(0);
const WRITER_CLOSE_FIRST_BURN_AMOUNT: u64 = WRITER_CONTRACT_ATOMIC_SCALE / 10;
const WRITER_CLOSE_OWNER_SEED: [u8; 32] = [0x91; 32];
const WRITER_CLOSE_FEE_PAYER_SEED: [u8; 32] = [0x92; 32];
const WRITER_CLOSE_FIXTURE_SLOT: u64 = 42_000_000;
const WRITER_CLOSE_FIXTURE_UNIX_TIMESTAMP: i64 = 1_800_000_000;
#[cfg(feature = "phase3-synthetic-governance-controller")]
const WRITER_CLOSE_GOVERNANCE_EPOCH: u64 = 41;
#[cfg(feature = "phase3-synthetic-governance-controller")]
const WRITER_CLOSE_GOVERNED_EXPECTED_COMPUTE_UNITS: u64 = 1_372_536;
const WRITER_BENCHMARK_PUBKEY_DOMAIN: &[u8] = b"ameba-writer-sbf-benchmark-pubkey-v1";
const WRITER_BOOK_HASH_DOMAIN: &[u8] = b"ameba-writer-book-v1";
const WRITER_SERIES_FAMILY_HASH_DOMAIN: &[u8] = b"ameba-writer-series-family-v1";
const LIGHT_TOKEN_PROGRAM: Pubkey =
    solana_program::pubkey!("cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m");
const LIGHT_CPI_AUTHORITY: Pubkey =
    solana_program::pubkey!("GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy");

fn pda(program_id: &Pubkey, seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, program_id)
}

fn current_pda(program_id: &Pubkey, seeds: &[&[u8]]) -> (Pubkey, u8) {
    let mut namespaced = Vec::with_capacity(seeds.len() + 1);
    namespaced.push(CURRENT_STATE_NAMESPACE_SEED);
    namespaced.extend_from_slice(seeds);
    pda(program_id, &namespaced)
}

fn benchmark_pubkey(label: &[u8]) -> Pubkey {
    Pubkey::new_from_array(hashv(&[WRITER_BENCHMARK_PUBKEY_DOMAIN, label]).to_bytes())
}

fn install_deterministic_close_context(context: &mut ProgramTestContext) {
    let owner = Keypair::from_seed(&WRITER_CLOSE_OWNER_SEED).expect("fixed close owner seed");
    let owner_account = AccountSharedData::new(1_000_000_000, 0, &solana_sdk::system_program::id());
    context.set_account(&owner.pubkey(), &owner_account);
    context.payer = owner;
    context.set_sysvar(&solana_sdk::clock::Clock {
        slot: WRITER_CLOSE_FIXTURE_SLOT,
        epoch_start_timestamp: WRITER_CLOSE_FIXTURE_UNIX_TIMESTAMP - 432_000,
        epoch: 100,
        leader_schedule_epoch: 101,
        unix_timestamp: WRITER_CLOSE_FIXTURE_UNIX_TIMESTAMP,
    });
}

async fn set_borsh_account<T: BorshSerialize>(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner: Pubkey,
    value: &T,
    len: usize,
) {
    let encoded = value.try_to_vec().expect("serialize benchmark state");
    assert!(
        encoded.len() <= len,
        "encoded state exceeds fixed account length"
    );
    let rent = context.banks_client.get_rent().await.unwrap();
    let mut data = vec![0; len];
    data[..encoded.len()].copy_from_slice(&encoded);
    let mut account = AccountSharedData::new(rent.minimum_balance(len), len, &owner);
    account.set_data_from_slice(&data);
    context.set_account(&address, &account);
}

#[cfg(feature = "phase3-synthetic-governance-controller")]
async fn install_active_writer_gate(context: &mut ProgramTestContext) -> Pubkey {
    let target = light_token_minter::id();
    let (gate, bump) = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target);
    let controller_config = derive_controller_config_pda(&PINNED_CONTROLLER_PROGRAM_ID, &target).0;
    let target_programdata = derive_target_programdata_pda(&target);
    let mut data = [0u8; PROTOCOL_GATE_LEN];
    data[0..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
    data[8] = PROTOCOL_GATE_VERSION_V1;
    data[9] = bump;
    data[10] = 1;
    data[11] = GateStatusV1::Active as u8;
    data[12..44].copy_from_slice(controller_config.as_ref());
    data[44..76].copy_from_slice(target.as_ref());
    data[76..108].copy_from_slice(target_programdata.as_ref());
    data[108..116].copy_from_slice(&WRITER_CLOSE_GOVERNANCE_EPOCH.to_le_bytes());

    let rent = context.banks_client.get_rent().await.unwrap();
    let mut account = AccountSharedData::new(
        rent.minimum_balance(PROTOCOL_GATE_LEN),
        PROTOCOL_GATE_LEN,
        &PINNED_CONTROLLER_PROGRAM_ID,
    );
    account.set_data_from_slice(&data);
    context.set_account(&gate, &account);
    gate
}

async fn set_mint(
    context: &mut ProgramTestContext,
    address: Pubkey,
    authority: Pubkey,
    supply: u64,
) {
    let mut data = vec![0; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: COption::Some(authority),
            supply,
            decimals: MarketMintAccounting::CANONICAL_DECIMALS,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    let rent = context.banks_client.get_rent().await.unwrap();
    let mut account =
        AccountSharedData::new(rent.minimum_balance(Mint::LEN), Mint::LEN, &spl_token::id());
    account.set_data_from_slice(&data);
    context.set_account(&address, &account);
}

async fn set_token_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let mut data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(
        TokenAccount {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    let rent = context.banks_client.get_rent().await.unwrap();
    let mut account = AccountSharedData::new(
        rent.minimum_balance(TokenAccount::LEN),
        TokenAccount::LEN,
        &spl_token::id(),
    );
    account.set_data_from_slice(&data);
    context.set_account(&address, &account);
}

async fn set_plain_account(
    context: &mut ProgramTestContext,
    address: Pubkey,
    owner: Pubkey,
    writable_lamports: u64,
) {
    let account = AccountSharedData::new(writable_lamports.max(1), 0, &owner);
    context.set_account(&address, &account);
}

fn writer_series_family_hash(book: &WriterSeriesBookV1) -> [u8; 32] {
    let count = usize::from(book.series_count);
    let mut bytes = Vec::with_capacity(WRITER_SERIES_FAMILY_HASH_DOMAIN.len() + 4 + count * 64);
    bytes.extend_from_slice(WRITER_SERIES_FAMILY_HASH_DOMAIN);
    bytes.extend_from_slice(&u32::from(book.series_count).to_le_bytes());
    for record in book.records.iter().take(count) {
        bytes.extend_from_slice(&record.series_id);
        bytes.extend_from_slice(&record.payoff_digest);
    }
    hashv(&[bytes.as_slice()]).to_bytes()
}

fn writer_book_digest(book: &WriterSeriesBookV1) -> [u8; 32] {
    let count = usize::from(book.series_count);
    let mut bytes = Vec::with_capacity(WRITER_BOOK_HASH_DOMAIN.len() + 68 + count * 160);
    bytes.extend_from_slice(WRITER_BOOK_HASH_DOMAIN);
    bytes.extend_from_slice(book.sleeve.as_ref());
    bytes.extend_from_slice(book.settlement_group.as_ref());
    bytes.extend_from_slice(&u32::from(book.series_count).to_le_bytes());
    for record in book.records.iter().take(count) {
        bytes.extend_from_slice(&record.series_id);
        bytes.extend_from_slice(&record.payoff_digest);
        bytes.extend_from_slice(&record.total_physical_supply_atoms.to_le_bytes());
        bytes.extend_from_slice(&record.issuer_controlled_atoms.to_le_bytes());
        bytes.extend_from_slice(&record.external_open_interest_atoms.to_le_bytes());
        bytes.extend_from_slice(&record.primary_premium_collected_atoms.to_le_bytes());
        bytes.extend_from_slice(&record.settlement_external_oi_snapshot_atoms.to_le_bytes());
        bytes.extend_from_slice(&record.settlement_liability_initial_atoms.to_le_bytes());
        bytes.extend_from_slice(&record.settlement_liability_remaining_atoms.to_le_bytes());
    }
    hashv(&[bytes.as_slice()]).to_bytes()
}

fn writer_group_commitment(group_key: &Pubkey, group: &WriterSettlementGroupV1) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(512);
    bytes.extend_from_slice(b"ameba-writer-settlement-group-v1");
    bytes.extend_from_slice(group_key.as_ref());
    bytes.extend_from_slice(&group.underlying_id);
    bytes.extend_from_slice(&group.expiry_ts.to_le_bytes());
    bytes.extend_from_slice(group.settlement_mint.as_ref());
    bytes.extend_from_slice(group.anchor_market.as_ref());
    bytes.extend_from_slice(group.anchor_oracle_month.as_ref());
    bytes.extend_from_slice(&group.oracle_methodology_version.to_le_bytes());
    bytes.extend_from_slice(&group.product_manifest_root);
    bytes.extend_from_slice(&group.coverage_manifest_hash);
    bytes.extend_from_slice(&group.recipe_hash);
    bytes.extend_from_slice(&group.settlement_source_digest);
    bytes.extend_from_slice(&group.active_weight_manifest_hash);
    bytes.extend_from_slice(&group.security_cap_atoms.to_le_bytes());
    bytes.extend_from_slice(group.signer_registry.as_ref());
    bytes.extend_from_slice(group.signer_set.as_ref());
    bytes.extend_from_slice(&group.signer_set_version.to_le_bytes());
    bytes.extend_from_slice(&group.signer_set_hash);
    bytes.extend_from_slice(&group.settlement_ts.to_le_bytes());
    hashv(&[bytes.as_slice()]).to_bytes()
}

fn benchmark_series(index: usize) -> WriterSeries {
    let index_u64 = u64::try_from(index).unwrap();
    let external_open_interest_atoms = (index_u64 + 1) * WRITER_CONTRACT_ATOMIC_SCALE;
    if index % 2 == 0 {
        let strike = 50_000_000 + (index_u64 / 2) * 5_000_000;
        WriterSeries {
            kind: OptionKind::CallSpread,
            strike_price_atomic: strike,
            cap_price_atomic: strike + 2_000_000,
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
            max_payout_per_contract_atoms: 2_000_000,
            external_oi_atoms: external_open_interest_atoms,
        }
    } else {
        let strike = 200_000_000 + (index_u64 / 2) * 5_000_000;
        WriterSeries {
            kind: OptionKind::PutSpread,
            strike_price_atomic: strike,
            cap_price_atomic: strike - 3_000_000,
            contract_size_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
            max_payout_per_contract_atoms: 3_000_000,
            external_oi_atoms: external_open_interest_atoms,
        }
    }
}

struct CoreFixture {
    program_id: Pubkey,
    vault_config: Pubkey,
    settlement_mint: Pubkey,
    group: Pubkey,
    sleeve: Pubkey,
    book: Pubkey,
    snapshot: Pubkey,
    sleeve_vault: Pubkey,
    flat_mint: Pubkey,
    policy_registry: Pubkey,
    anchor_month: Pubkey,
    group_state: WriterSettlementGroupV1,
    sleeve_state: WriterSleeveV1,
    book_state: WriterSeriesBookV1,
    snapshot_state: WriterPolicySnapshotV1,
}

async fn install_core_fixture(
    context: &mut ProgramTestContext,
    external_book: bool,
    status: WriterSleeveStatus,
) -> CoreFixture {
    let program_id = light_token_minter::id();
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let now = u64::try_from(clock.unix_timestamp.max(0)).unwrap();
    let expiry_ts = now + 1_000_000;
    let underlying_id = [0x51; 32];
    let settlement_mint = benchmark_pubkey(b"settlement-mint");
    let (vault_config, vault_bump) = current_pda(&program_id, &[VAULT_PDA_SEED]);
    let (group, group_bump) = current_pda(
        &program_id,
        &[
            WRITER_SETTLEMENT_GROUP_PDA_SEED,
            &underlying_id,
            &expiry_ts.to_le_bytes(),
            settlement_mint.as_ref(),
        ],
    );
    let (sleeve, sleeve_bump) = current_pda(&program_id, &[WRITER_SLEEVE_PDA_SEED, group.as_ref()]);
    let (book, book_bump) =
        current_pda(&program_id, &[WRITER_SERIES_BOOK_PDA_SEED, sleeve.as_ref()]);
    let policy_version = 1u64;
    let (snapshot, snapshot_bump) = current_pda(
        &program_id,
        &[
            WRITER_POLICY_SNAPSHOT_PDA_SEED,
            sleeve.as_ref(),
            &policy_version.to_le_bytes(),
        ],
    );
    let (sleeve_vault, _) = current_pda(
        &program_id,
        &[WRITER_SLEEVE_USDC_VAULT_PDA_SEED, sleeve.as_ref()],
    );
    let (flat_mint, _) = current_pda(&program_id, &[WRITER_FLAT_MINT_PDA_SEED, sleeve.as_ref()]);
    let (flat_staging, _) = current_pda(
        &program_id,
        &[WRITER_FLAT_STAGING_PDA_SEED, sleeve.as_ref()],
    );
    let (flat_burn, _) = current_pda(
        &program_id,
        &[WRITER_FLAT_BURN_CUSTODY_PDA_SEED, sleeve.as_ref()],
    );
    let policy_registry = benchmark_pubkey(b"policy-registry");
    let anchor_market = benchmark_pubkey(b"anchor-market");
    let anchor_month = benchmark_pubkey(b"anchor-month");
    let signer_registry = benchmark_pubkey(b"signer-registry");
    let signer_set = benchmark_pubkey(b"signer-set");

    let mut math_series = Vec::with_capacity(SERIES_COUNT);
    let mut book_state = WriterSeriesBookV1 {
        is_initialized: true,
        bump: book_bump,
        account_discriminator: WriterSeriesBookV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterSeriesBookV1::ACCOUNT_VERSION,
        sleeve,
        settlement_group: group,
        series_count: SERIES_COUNT as u8,
        max_series: WRITER_MAX_LIVE_SERIES as u8,
        frozen: true,
        ..WriterSeriesBookV1::default()
    };
    for index in 0..SERIES_COUNT {
        let mut series = benchmark_series(index);
        if !external_book {
            series.external_oi_atoms = 0;
        }
        math_series.push(series);
        let series_id = [u8::try_from(index + 1).unwrap(); 32];
        let (market, market_bump) = current_pda(&program_id, &[MARKET_PDA_SEED, &series_id]);
        let (contract_mint, _) =
            current_pda(&program_id, &[CONTRACT_MINT_PDA_SEED, market.as_ref()]);
        let (retirement_custody, _) = current_pda(
            &program_id,
            &[
                WRITER_RETIREMENT_CUSTODY_PDA_SEED,
                sleeve.as_ref(),
                market.as_ref(),
            ],
        );
        let payoff_digest = [u8::try_from(index + 40).unwrap(); 32];
        let primary_premium = if external_book { 200_000_000 } else { 0 };
        book_state.records[index] = WriterSeriesRecordV1 {
            active: true,
            option_kind: series.kind,
            custody_status: if external_book {
                WriterSeriesCustodyStatus::Open
            } else {
                WriterSeriesCustodyStatus::Absent
            },
            settlement_status: WriterSeriesSettlementStatus::Open,
            reserved: [0; 4],
            series_id,
            market,
            contract_mint,
            retirement_custody,
            strike_price_atomic: series.strike_price_atomic,
            cap_or_floor_price_atomic: series.cap_price_atomic,
            contract_size_atoms: series.contract_size_atoms,
            max_payout_per_contract_atoms: series.max_payout_per_contract_atoms,
            total_physical_supply_atoms: series.external_oi_atoms,
            issuer_controlled_atoms: 0,
            external_open_interest_atoms: series.external_oi_atoms,
            primary_premium_collected_atoms: primary_premium,
            settlement_external_oi_snapshot_atoms: 0,
            settlement_liability_initial_atoms: 0,
            settlement_liability_remaining_atoms: 0,
            payoff_digest,
        };
        let market_state = Market {
            is_initialized: true,
            bump: market_bump,
            created_by: context.payer.pubkey(),
            market_id: series_id,
            collateral_mint: settlement_mint,
            long_contract_mint: Some(contract_mint),
            instrument: InstrumentDefinition {
                underlying_id,
                expiry_ts,
                strike_price: series.strike_price_atomic,
                cap_price: series.cap_price_atomic,
                contract_size: series.contract_size_atoms,
                max_payout_per_contract: series.max_payout_per_contract_atoms,
                kind: series.kind,
                settlement: SettlementStyle::CashSettledMonthly,
            },
            params: MarketParameters {
                tick_size: 50_000,
                lot_size: WRITER_CONTRACT_ATOMIC_SCALE,
                min_order_qty: WRITER_CONTRACT_ATOMIC_SCALE,
                ..MarketParameters::default()
            },
            total_position_collateral_locked: 0,
            paused: false,
            mint_accounting: MarketMintAccounting {
                total_issued: series.external_oi_atoms,
                ..MarketMintAccounting::canonical_empty()
            },
        };
        set_borsh_account(context, market, program_id, &market_state, Market::LEN).await;
    }
    book_state.book_digest = writer_book_digest(&book_state);
    let series_family_hash = writer_series_family_hash(&book_state);
    let reserve = exact_reserve(&math_series, 25_000_000, 300_000_000).unwrap();
    let security_exposure = gross_external_maximum_payout(&math_series).unwrap();
    let writer_principal_atoms = 1_000_000_000;
    let locked_primary_premium_atoms = if external_book { 4_000_000_000 } else { 0 };
    let accounted_asset_atoms = writer_principal_atoms + locked_primary_premium_atoms;
    let policy_hash = [0x61; 32];
    let scenario_set_hash = [0x62; 32];
    let risk_limit_hash = [0x63; 32];
    let snapshot_state = WriterPolicySnapshotV1 {
        is_initialized: true,
        bump: snapshot_bump,
        account_discriminator: WriterPolicySnapshotV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterPolicySnapshotV1::ACCOUNT_VERSION,
        sleeve,
        registry: policy_registry,
        policy_version,
        regime_input_version: 1,
        policy_hash,
        scenario_set_hash,
        risk_limit_hash,
        series_family_hash,
        security_mode: WriterSecurityMode::GrossExternalMaxPayout,
        reserve_rounding_mode: WriterReserveRoundingMode::AggregateBookCeiling,
        auction_priority_rule: WriterAuctionPriorityRule::PayAsBidPriceThenSeriesProRata,
        max_series: WRITER_MAX_LIVE_SERIES as u8,
        drawdown_scale: WRITER_RATIO_SCALE_PPM,
        worst_drawdown_limit: WRITER_RATIO_SCALE_PPM,
        upper_drawdown_limit: WRITER_RATIO_SCALE_PPM,
        lower_drawdown_limit: WRITER_RATIO_SCALE_PPM,
        lower_tail_max_settlement_atomic: 25_000_000,
        upper_tail_min_settlement_atomic: 300_000_000,
        operational_buffer_atoms: 0,
        max_auction_issue_atoms: 128 * WRITER_CONTRACT_ATOMIC_SCALE,
        max_close_flat_atoms: 100_000_000,
        created_slot: clock.slot,
        sealed_slot: clock.slot,
        ..WriterPolicySnapshotV1::default()
    };
    let active_weight_hash = [0x71; 32];
    let group_state = WriterSettlementGroupV1 {
        is_initialized: true,
        bump: group_bump,
        account_discriminator: WriterSettlementGroupV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterSettlementGroupV1::ACCOUNT_VERSION,
        underlying_id,
        expiry_ts,
        settlement_mint,
        anchor_market,
        anchor_oracle_month: anchor_month,
        oracle_methodology_version: 1,
        product_manifest_root: [0x72; 32],
        coverage_manifest_hash: [0x73; 32],
        recipe_hash: [0x74; 32],
        settlement_source_digest: [0x75; 32],
        active_weight_manifest_hash: active_weight_hash,
        security_cap_atoms: u64::MAX,
        signer_registry,
        signer_set,
        signer_set_version: 1,
        signer_set_hash: [0x76; 32],
        settlement_ts: expiry_ts,
        sleeve,
        status: WriterSettlementGroupStatus::Active,
        series_count: SERIES_COUNT as u8,
        ..WriterSettlementGroupV1::default()
    };
    let sleeve_state = WriterSleeveV1 {
        is_initialized: true,
        bump: sleeve_bump,
        account_discriminator: WriterSleeveV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterSleeveV1::ACCOUNT_VERSION,
        vault_config,
        underlying_id,
        expiry_ts,
        settlement_mint,
        settlement_group: group,
        series_book: book,
        usdc_vault: sleeve_vault,
        flat_mint,
        flat_spl_interface: benchmark_pubkey(b"flat-spl-interface"),
        flat_staging,
        flat_burn_custody: flat_burn,
        policy_registry,
        policy_snapshot: snapshot,
        policy_version,
        policy_hash,
        scenario_set_hash,
        risk_limit_hash,
        writer_principal_atoms,
        locked_primary_premium_atoms,
        accounted_asset_atoms,
        exact_reserve_atoms: reserve.reserve_atoms,
        upper_tail_reserve_atoms: reserve.upper_tail_reserve_atoms,
        lower_tail_reserve_atoms: reserve.lower_tail_reserve_atoms,
        flat_par_supply_atoms: writer_principal_atoms,
        security_exposure_atoms: security_exposure,
        operational_buffer_atoms: 0,
        series_count: SERIES_COUNT as u8,
        status,
        security_mode: WriterSecurityMode::GrossExternalMaxPayout,
        ..WriterSleeveV1::default()
    };
    let vault_token_account = benchmark_pubkey(b"vault-token-account");
    let config = VaultConfig {
        is_initialized: true,
        bump: vault_bump,
        admin: context.payer.pubkey(),
        oracle_authority: context.payer.pubkey(),
        usdc_mint: settlement_mint,
        vault_token_account,
        paused: false,
        account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
        account_version: VaultConfig::ACCOUNT_VERSION,
    };
    set_borsh_account(context, vault_config, program_id, &config, VaultConfig::LEN).await;
    set_borsh_account(
        context,
        group,
        program_id,
        &group_state,
        WriterSettlementGroupV1::LEN,
    )
    .await;
    set_borsh_account(
        context,
        sleeve,
        program_id,
        &sleeve_state,
        WriterSleeveV1::LEN,
    )
    .await;
    set_borsh_account(
        context,
        book,
        program_id,
        &book_state,
        WriterSeriesBookV1::LEN,
    )
    .await;
    set_borsh_account(
        context,
        snapshot,
        program_id,
        &snapshot_state,
        WriterPolicySnapshotV1::LEN,
    )
    .await;
    set_mint(context, settlement_mint, context.payer.pubkey(), 0).await;
    set_token_account(
        context,
        sleeve_vault,
        settlement_mint,
        sleeve,
        accounted_asset_atoms,
    )
    .await;
    set_mint(context, flat_mint, sleeve, writer_principal_atoms).await;

    CoreFixture {
        program_id,
        vault_config,
        settlement_mint,
        group,
        sleeve,
        book,
        snapshot,
        sleeve_vault,
        flat_mint,
        policy_registry,
        anchor_month,
        group_state,
        sleeve_state,
        book_state,
        snapshot_state,
    }
}

async fn install_lookup_table(
    context: &mut ProgramTestContext,
    addresses: Vec<Pubkey>,
) -> AddressLookupTableAccount {
    let key = benchmark_pubkey(b"address-lookup-table");
    let mut data = vec![0; LOOKUP_TABLE_META_SIZE + addresses.len() * 32];
    AddressLookupTable::overwrite_meta_data(&mut data, LookupTableMeta::default()).unwrap();
    for (index, address) in addresses.iter().enumerate() {
        let start = LOOKUP_TABLE_META_SIZE + index * 32;
        data[start..start + 32].copy_from_slice(address.as_ref());
    }
    let rent = context.banks_client.get_rent().await.unwrap();
    let mut account = AccountSharedData::new(
        rent.minimum_balance(data.len()),
        data.len(),
        &address_lookup_table_program::id(),
    );
    account.set_data_from_slice(&data);
    context.set_account(&key, &account);
    AddressLookupTableAccount { key, addresses }
}

struct AuctionFixture {
    auction: Pubkey,
    bid_index: Pubkey,
    escrow: Pubkey,
    fee_vault: Pubkey,
    active_manifest: Pubkey,
    index_state: WriterBidIndexV1,
    bidders: Vec<Pubkey>,
    bids: Vec<Pubkey>,
}

async fn install_full_auction_fixture(
    context: &mut ProgramTestContext,
    fixture: &mut CoreFixture,
    status: WriterAuctionStatus,
) -> AuctionFixture {
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let now = u64::try_from(clock.unix_timestamp.max(0)).unwrap();
    assert!(
        now > 1,
        "program-test clock must permit a completed reveal deadline"
    );
    let nonce = 1u64;
    let (auction, auction_bump) = current_pda(
        &fixture.program_id,
        &[
            WRITER_AUCTION_PDA_SEED,
            fixture.sleeve.as_ref(),
            &nonce.to_le_bytes(),
        ],
    );
    let (bid_index, bid_index_bump) = current_pda(
        &fixture.program_id,
        &[WRITER_BID_INDEX_PDA_SEED, auction.as_ref()],
    );
    let (escrow, _) = current_pda(
        &fixture.program_id,
        &[WRITER_AUCTION_ESCROW_PDA_SEED, auction.as_ref()],
    );
    let fee_vault = Pubkey::new_unique();
    let bid_price = 1_000_000u64;
    let requested = WRITER_CONTRACT_ATOMIC_SCALE;
    let escrowed = 1_000_000u64;
    let mut index_state = WriterBidIndexV1 {
        is_initialized: true,
        bump: bid_index_bump,
        account_discriminator: WriterBidIndexV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterBidIndexV1::ACCOUNT_VERSION,
        auction,
        bid_count: WRITER_MAX_FUNDED_BIDS as u16,
        planned_bid_count: if status == WriterAuctionStatus::Executing {
            WRITER_MAX_FUNDED_BIDS as u16
        } else {
            0
        },
        planning_cursor: if status == WriterAuctionStatus::Executing {
            WRITER_MAX_FUNDED_BIDS as u16
        } else {
            0
        },
        rolling_digest: [0x81; 32],
        last_updated_slot: clock.slot,
        ..WriterBidIndexV1::default()
    };
    let mut bidders = Vec::with_capacity(WRITER_MAX_FUNDED_BIDS);
    let mut bids = Vec::with_capacity(WRITER_MAX_FUNDED_BIDS);
    for index in 0..WRITER_MAX_FUNDED_BIDS {
        let bidder = Pubkey::new_unique();
        let order_id = u64::try_from(index + 1).unwrap();
        let (bid, _) = current_pda(
            &fixture.program_id,
            &[
                WRITER_BID_PDA_SEED,
                auction.as_ref(),
                bidder.as_ref(),
                &order_id.to_le_bytes(),
            ],
        );
        let planned = status == WriterAuctionStatus::Executing;
        index_state.records[index] = WriterBidIndexRecordV1 {
            occupied: true,
            status: if planned {
                WriterBidStatus::Planned
            } else {
                WriterBidStatus::Funded
            },
            series_index: 0,
            reserved: 0,
            bid_price_per_contract_atoms: bid_price,
            requested_contract_atoms: requested,
            accepted_contract_atoms: if planned { requested } else { 0 },
            executed_contract_atoms: 0,
            escrowed_atoms: escrowed,
            bid,
            bidder,
            order_id,
        };
        bidders.push(bidder);
        bids.push(bid);
    }
    let mut auction_state = WriterAuctionV1 {
        is_initialized: true,
        bump: auction_bump,
        account_discriminator: WriterAuctionV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterAuctionV1::ACCOUNT_VERSION,
        sleeve: fixture.sleeve,
        series_book: fixture.book,
        policy_snapshot: fixture.snapshot,
        auction_nonce: nonce,
        escrow,
        bid_index,
        fee_vault,
        policy_version: fixture.sleeve_state.policy_version,
        scenario_set_hash: fixture.sleeve_state.scenario_set_hash,
        risk_limit_hash: fixture.sleeve_state.risk_limit_hash,
        reserve_vector_commitment: [0x82; 32],
        reveal_hash: [0x83; 32],
        revealed_nonce: [0x84; 32],
        commit_slot: clock.slot.saturating_sub(1),
        bid_deadline_ts: now.saturating_sub(2),
        reveal_deadline_ts: now.saturating_sub(1),
        execute_deadline_ts: now + 500_000,
        bid_count: WRITER_MAX_FUNDED_BIDS as u16,
        planned_bid_count: index_state.planned_bid_count,
        planning_cursor: index_state.planning_cursor,
        total_escrow_atoms: escrowed * WRITER_MAX_FUNDED_BIDS as u64,
        accepted_premium_atoms: if status == WriterAuctionStatus::Executing {
            escrowed * WRITER_MAX_FUNDED_BIDS as u64
        } else {
            0
        },
        accepted_contract_atoms: if status == WriterAuctionStatus::Executing {
            requested * WRITER_MAX_FUNDED_BIDS as u64
        } else {
            0
        },
        status,
        last_updated_slot: clock.slot,
        ..WriterAuctionV1::default()
    };
    auction_state.reserve_prices_atoms[0] = bid_price;
    auction_state.issue_caps_atoms[0] = requested * WRITER_MAX_FUNDED_BIDS as u64;
    if status == WriterAuctionStatus::Executing {
        auction_state.planned_issue_atoms[0] = requested * WRITER_MAX_FUNDED_BIDS as u64;
    }
    fixture.sleeve_state.status = WriterSleeveStatus::Active;
    fixture.sleeve_state.auction_nonce = nonce;
    fixture.sleeve_state.active_auction = Some(auction);
    set_borsh_account(
        context,
        fixture.sleeve,
        fixture.program_id,
        &fixture.sleeve_state,
        WriterSleeveV1::LEN,
    )
    .await;
    set_borsh_account(
        context,
        auction,
        fixture.program_id,
        &auction_state,
        WriterAuctionV1::LEN,
    )
    .await;
    set_borsh_account(
        context,
        bid_index,
        fixture.program_id,
        &index_state,
        WriterBidIndexV1::LEN,
    )
    .await;
    let (active_manifest, active_bump) =
        derive_oracle_active_weight_manifest_pda(&fixture.program_id, &fixture.anchor_month);
    let active = OracleActiveWeightManifest {
        is_initialized: true,
        bump: active_bump,
        account_discriminator: OracleActiveWeightManifest::ACCOUNT_DISCRIMINATOR,
        account_version: OracleActiveWeightManifest::ACCOUNT_VERSION,
        month: fixture.anchor_month,
        phase: OracleRecipeWeightPhase::Finalized,
        expected_source_count: 1,
        expected_group_count: 1,
        processed_source_count: 1,
        processed_group_count: 1,
        rolling_manifest_hash: fixture.group_state.active_weight_manifest_hash,
        max_open_interest_payout: fixture.group_state.security_cap_atoms,
        ..OracleActiveWeightManifest::default()
    };
    set_borsh_account(
        context,
        active_manifest,
        fixture.program_id,
        &active,
        OracleActiveWeightManifest::LEN,
    )
    .await;
    set_token_account(
        context,
        escrow,
        fixture.settlement_mint,
        auction,
        auction_state.total_escrow_atoms,
    )
    .await;
    set_token_account(
        context,
        fee_vault,
        fixture.settlement_mint,
        fixture.policy_registry,
        0,
    )
    .await;
    AuctionFixture {
        auction,
        bid_index,
        escrow,
        fee_vault,
        active_manifest,
        index_state,
        bidders,
        bids,
    }
}

fn writer_auction_no_cpi_token_processor(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    WRITER_AUCTION_TOKEN_SENTINEL_CALLS.fetch_add(1, Ordering::SeqCst);
    Err(ProgramError::Custom(WRITER_AUCTION_TOKEN_SENTINEL_ERROR))
}

async fn install_first_auction_fill_transaction(
    context: &mut ProgramTestContext,
    fixture: &CoreFixture,
    auction: &AuctionFixture,
) -> (VersionedTransaction, Vec<Pubkey>, u64) {
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let summary = auction.index_state.records[0];
    let bid = auction.bids[0];
    let bidder = auction.bidders[0];
    let (_, bid_bump) = current_pda(
        &fixture.program_id,
        &[
            WRITER_BID_PDA_SEED,
            auction.auction.as_ref(),
            bidder.as_ref(),
            &summary.order_id.to_le_bytes(),
        ],
    );
    let destination = Pubkey::new_unique();
    let refund_token_account = Pubkey::new_unique();
    let bid_state = WriterBidV1 {
        is_initialized: true,
        bump: bid_bump,
        account_discriminator: WriterBidV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterBidV1::ACCOUNT_VERSION,
        auction: auction.auction,
        bidder,
        refund_token_account,
        claim_destination: destination,
        order_id: summary.order_id,
        series_index: summary.series_index,
        status: WriterBidStatus::Funded,
        delivery_mode: WriterBidDeliveryMode::ClassicSpl,
        bid_price_per_contract_atoms: summary.bid_price_per_contract_atoms,
        requested_contract_atoms: summary.requested_contract_atoms,
        escrowed_atoms: summary.escrowed_atoms,
        placed_slot: clock.slot,
        last_updated_slot: clock.slot,
        ..WriterBidV1::default()
    };
    set_borsh_account(
        context,
        bid,
        fixture.program_id,
        &bid_state,
        WriterBidV1::LEN,
    )
    .await;

    let series = fixture.book_state.records[0];
    let market = series.market;
    let contract_mint = series.contract_mint;
    let staging = current_pda(
        &fixture.program_id,
        &[CONTRACT_MINT_STAGING_PDA_SEED, market.as_ref()],
    )
    .0;
    let retirement = series.retirement_custody;
    let interface =
        Pubkey::find_program_address(&[b"pool", contract_mint.as_ref()], &LIGHT_TOKEN_PROGRAM).0;
    set_mint(
        context,
        contract_mint,
        market,
        series.total_physical_supply_atoms,
    )
    .await;
    set_token_account(context, staging, contract_mint, market, 0).await;
    set_token_account(context, retirement, contract_mint, fixture.sleeve, 0).await;
    set_token_account(context, destination, contract_mint, bidder, 0).await;
    set_token_account(context, interface, contract_mint, LIGHT_CPI_AUTHORITY, 0).await;
    set_plain_account(
        context,
        LIGHT_TOKEN_PROGRAM,
        solana_sdk::bpf_loader::id(),
        1,
    )
    .await;
    set_plain_account(
        context,
        LIGHT_CPI_AUTHORITY,
        solana_sdk::system_program::id(),
        1,
    )
    .await;
    set_plain_account(
        context,
        LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
        solana_sdk::system_program::id(),
        1,
    )
    .await;
    set_plain_account(
        context,
        LIGHT_TOKEN_RENT_SPONSOR,
        solana_sdk::system_program::id(),
        1,
    )
    .await;

    let mut accounts = vec![
        AccountMeta::new(context.payer.pubkey(), true),
        AccountMeta::new_readonly(fixture.vault_config, false),
        AccountMeta::new(fixture.sleeve, false),
        AccountMeta::new_readonly(fixture.group, false),
        AccountMeta::new(fixture.book, false),
        AccountMeta::new_readonly(fixture.snapshot, false),
        AccountMeta::new(auction.auction, false),
        AccountMeta::new(auction.bid_index, false),
        AccountMeta::new(bid, false),
        AccountMeta::new(auction.escrow, false),
        AccountMeta::new(fixture.sleeve_vault, false),
        AccountMeta::new(auction.fee_vault, false),
        AccountMeta::new_readonly(fixture.settlement_mint, false),
        AccountMeta::new(market, false),
        AccountMeta::new(contract_mint, false),
        AccountMeta::new(staging, false),
        AccountMeta::new(retirement, false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(LIGHT_TOKEN_PROGRAM, false),
        AccountMeta::new_readonly(LIGHT_CPI_AUTHORITY, false),
        AccountMeta::new(interface, false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        AccountMeta::new_readonly(LIGHT_TOKEN_COMPRESSIBLE_CONFIG, false),
        AccountMeta::new(LIGHT_TOKEN_RENT_SPONSOR, false),
        AccountMeta::new_readonly(auction.active_manifest, false),
    ];
    let mut data = VaultInstruction::ExecuteWriterAuctionFillV1
        .try_to_vec()
        .unwrap();
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    {
        let gate = install_active_writer_gate(context).await;
        accounts.push(AccountMeta::new_readonly(gate, false));
        data.extend_from_slice(
            &GovernanceInstructionTailV1::for_epoch(WRITER_CLOSE_GOVERNANCE_EPOCH).encode(),
        );
    }
    let instruction = Instruction {
        program_id: fixture.program_id,
        accounts,
        data,
    };
    let lookup = install_lookup_table(
        context,
        instruction
            .accounts
            .iter()
            .skip(1)
            .map(|meta| meta.pubkey)
            .collect(),
    )
    .await;
    let message = v0::Message::try_compile(
        &context.payer.pubkey(),
        &[instruction],
        &[lookup],
        context.last_blockhash,
    )
    .unwrap();
    let transaction =
        VersionedTransaction::try_new(VersionedMessage::V0(message), &[&context.payer]).unwrap();
    let rollback_addresses = vec![
        fixture.sleeve,
        fixture.book,
        market,
        contract_mint,
        staging,
        retirement,
        destination,
        auction.auction,
        auction.bid_index,
        bid,
        auction.escrow,
        fixture.sleeve_vault,
        auction.fee_vault,
    ];
    (
        transaction,
        rollback_addresses,
        summary.accepted_contract_atoms,
    )
}

#[tokio::test]
async fn full_128_bid_index_planning_chunk_fits_sbf_compute_budget() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    let mut context = program_test.start_with_context().await;
    let mut fixture = install_core_fixture(&mut context, false, WriterSleeveStatus::Active).await;
    let auction =
        install_full_auction_fixture(&mut context, &mut fixture, WriterAuctionStatus::Planning)
            .await;
    let instruction = Instruction {
        program_id: fixture.program_id,
        accounts: vec![
            AccountMeta::new_readonly(context.payer.pubkey(), true),
            AccountMeta::new_readonly(fixture.vault_config, false),
            AccountMeta::new_readonly(fixture.sleeve, false),
            AccountMeta::new_readonly(fixture.group, false),
            AccountMeta::new_readonly(fixture.book, false),
            AccountMeta::new_readonly(fixture.snapshot, false),
            AccountMeta::new(auction.auction, false),
            AccountMeta::new(auction.bid_index, false),
            AccountMeta::new_readonly(auction.active_manifest, false),
        ],
        data: VaultInstruction::PlanWriterAuctionChunkV1 {
            params: PlanWriterAuctionChunkV1Params { max_records: 8 },
        }
        .try_to_vec()
        .unwrap(),
    };
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let wire_bytes = bincode::serialize(&transaction).unwrap().len();
    assert!(wire_bytes <= PACKET_DATA_SIZE);
    let simulation = context
        .banks_client
        .simulate_transaction(transaction)
        .await
        .expect("auction planning simulation transport");
    assert_eq!(
        simulation.result,
        Some(Ok::<(), TransactionError>(())),
        "{simulation:?}"
    );
    let details = simulation.simulation_details.unwrap();
    assert!(details.units_consumed <= TRANSACTION_COMPUTE_LIMIT);
    println!(
        "writer_auction_plan_sbf bids={} planned_in_chunk={} wire_bytes={} compute_units={}",
        WRITER_MAX_FUNDED_BIDS, 8, wire_bytes, details.units_consumed,
    );
}

#[tokio::test]
async fn twenty_series_one_auction_fill_fits_sbf_packet_and_compute_budget() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    let mut context = program_test.start_with_context().await;
    let mut fixture = install_core_fixture(&mut context, true, WriterSleeveStatus::Active).await;
    let auction =
        install_full_auction_fixture(&mut context, &mut fixture, WriterAuctionStatus::Executing)
            .await;
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let summary = auction.index_state.records[0];
    let bid = auction.bids[0];
    let bidder = auction.bidders[0];
    let (_, bid_bump) = current_pda(
        &fixture.program_id,
        &[
            WRITER_BID_PDA_SEED,
            auction.auction.as_ref(),
            bidder.as_ref(),
            &summary.order_id.to_le_bytes(),
        ],
    );
    let destination = Pubkey::new_unique();
    let refund_token_account = Pubkey::new_unique();
    let bid_state = WriterBidV1 {
        is_initialized: true,
        bump: bid_bump,
        account_discriminator: WriterBidV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterBidV1::ACCOUNT_VERSION,
        auction: auction.auction,
        bidder,
        refund_token_account,
        claim_destination: destination,
        order_id: summary.order_id,
        series_index: summary.series_index,
        status: WriterBidStatus::Funded,
        delivery_mode: WriterBidDeliveryMode::ClassicSpl,
        bid_price_per_contract_atoms: summary.bid_price_per_contract_atoms,
        requested_contract_atoms: summary.requested_contract_atoms,
        escrowed_atoms: summary.escrowed_atoms,
        placed_slot: clock.slot,
        last_updated_slot: clock.slot,
        ..WriterBidV1::default()
    };
    set_borsh_account(
        &mut context,
        bid,
        fixture.program_id,
        &bid_state,
        WriterBidV1::LEN,
    )
    .await;

    let series = fixture.book_state.records[0];
    let market = series.market;
    let contract_mint = series.contract_mint;
    let (staging, _) = current_pda(
        &fixture.program_id,
        &[CONTRACT_MINT_STAGING_PDA_SEED, market.as_ref()],
    );
    let retirement = series.retirement_custody;
    let interface =
        Pubkey::find_program_address(&[b"pool", contract_mint.as_ref()], &LIGHT_TOKEN_PROGRAM).0;
    set_mint(
        &mut context,
        contract_mint,
        market,
        series.total_physical_supply_atoms,
    )
    .await;
    set_token_account(&mut context, staging, contract_mint, market, 0).await;
    set_token_account(&mut context, retirement, contract_mint, fixture.sleeve, 0).await;
    set_token_account(&mut context, destination, contract_mint, bidder, 0).await;
    set_token_account(
        &mut context,
        interface,
        contract_mint,
        LIGHT_CPI_AUTHORITY,
        0,
    )
    .await;
    set_plain_account(
        &mut context,
        LIGHT_TOKEN_PROGRAM,
        solana_sdk::bpf_loader::id(),
        1,
    )
    .await;
    set_plain_account(
        &mut context,
        LIGHT_CPI_AUTHORITY,
        solana_sdk::system_program::id(),
        1,
    )
    .await;
    set_plain_account(
        &mut context,
        LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
        solana_sdk::system_program::id(),
        1,
    )
    .await;
    set_plain_account(
        &mut context,
        LIGHT_TOKEN_RENT_SPONSOR,
        solana_sdk::system_program::id(),
        1,
    )
    .await;

    let metas = vec![
        AccountMeta::new(context.payer.pubkey(), true),
        AccountMeta::new_readonly(fixture.vault_config, false),
        AccountMeta::new(fixture.sleeve, false),
        AccountMeta::new_readonly(fixture.group, false),
        AccountMeta::new(fixture.book, false),
        AccountMeta::new_readonly(fixture.snapshot, false),
        AccountMeta::new(auction.auction, false),
        AccountMeta::new(auction.bid_index, false),
        AccountMeta::new(bid, false),
        AccountMeta::new(auction.escrow, false),
        AccountMeta::new(fixture.sleeve_vault, false),
        AccountMeta::new(auction.fee_vault, false),
        AccountMeta::new_readonly(fixture.settlement_mint, false),
        AccountMeta::new(market, false),
        AccountMeta::new(contract_mint, false),
        AccountMeta::new(staging, false),
        AccountMeta::new(retirement, false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(LIGHT_TOKEN_PROGRAM, false),
        AccountMeta::new_readonly(LIGHT_CPI_AUTHORITY, false),
        AccountMeta::new(interface, false),
        AccountMeta::new_readonly(spl_token::id(), false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        AccountMeta::new_readonly(LIGHT_TOKEN_COMPRESSIBLE_CONFIG, false),
        AccountMeta::new(LIGHT_TOKEN_RENT_SPONSOR, false),
        AccountMeta::new_readonly(auction.active_manifest, false),
    ];
    let lookup_addresses = metas.iter().skip(1).map(|meta| meta.pubkey).collect();
    let instruction = Instruction {
        program_id: fixture.program_id,
        accounts: metas,
        data: VaultInstruction::ExecuteWriterAuctionFillV1
            .try_to_vec()
            .unwrap(),
    };
    let lookup = install_lookup_table(&mut context, lookup_addresses).await;
    let message = v0::Message::try_compile(
        &context.payer.pubkey(),
        &[instruction],
        &[lookup],
        context.last_blockhash,
    )
    .unwrap();
    let transaction =
        VersionedTransaction::try_new(VersionedMessage::V0(message), &[&context.payer]).unwrap();
    let wire_bytes = bincode::serialize(&transaction).unwrap().len();
    assert!(
        wire_bytes <= PACKET_DATA_SIZE,
        "auction fill transaction is {wire_bytes} bytes"
    );
    let simulation = context
        .banks_client
        .simulate_transaction(transaction)
        .await
        .expect("auction fill simulation transport");
    assert_eq!(
        simulation.result,
        Some(Ok::<(), TransactionError>(())),
        "{simulation:?}"
    );
    let details = simulation.simulation_details.unwrap();
    assert!(details.units_consumed <= TRANSACTION_COMPUTE_LIMIT);
    println!(
        "writer_auction_fill_sbf series={} bids={} accounts={} wire_bytes={} accepted={} compute_units={}",
        SERIES_COUNT,
        WRITER_MAX_FUNDED_BIDS,
        26,
        wire_bytes,
        summary.accepted_contract_atoms,
        details.units_consumed,
    );
}

#[tokio::test]
async fn writer_auction_security_cap_rejects_before_any_custody_cpi() {
    WRITER_AUCTION_TOKEN_SENTINEL_CALLS.store(0, Ordering::SeqCst);
    let mut program_test = ProgramTest::new(
        "light_token_minter",
        light_token_minter::id(),
        processor!(light_token_minter::process_instruction),
    );
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    // Spread was already registered from SBF_OUT_DIR. Switch only subsequent registrations back
    // to native processors so this test can replace Tokenkeg with its deterministic sentinel.
    program_test.prefer_bpf(false);
    // Replace Tokenkeg with a call-counting sentinel. Any create/initialize/transfer/mint CPI
    // would change the counter and error code before ProgramTest applies transaction rollback.
    program_test.add_program(
        "writer_auction_no_cpi_token",
        spl_token::id(),
        processor!(writer_auction_no_cpi_token_processor),
    );
    let mut context = program_test.start_with_context().await;
    let mut fixture = install_core_fixture(&mut context, false, WriterSleeveStatus::Active).await;
    fixture.group_state.security_cap_atoms = 1;
    set_borsh_account(
        &mut context,
        fixture.group,
        fixture.program_id,
        &fixture.group_state,
        WriterSettlementGroupV1::LEN,
    )
    .await;
    let auction =
        install_full_auction_fixture(&mut context, &mut fixture, WriterAuctionStatus::Executing)
            .await;
    let (transaction, rollback_addresses, accepted) =
        install_first_auction_fill_transaction(&mut context, &fixture, &auction).await;
    assert_eq!(accepted, WRITER_CONTRACT_ATOMIC_SCALE);
    let before = snapshot_accounts(&mut context, &rollback_addresses).await;
    let error = context
        .banks_client
        .process_transaction(transaction)
        .await
        .expect_err("security-cap breach must reject the fill");
    assert_eq!(
        error.unwrap(),
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(VaultError::WriterSecurityCapExceeded as u32),
        )
    );
    assert_eq!(
        WRITER_AUCTION_TOKEN_SENTINEL_CALLS.load(Ordering::SeqCst),
        0,
        "a rejected cap path must not invoke Tokenkeg for account creation or custody movement"
    );
    let after = snapshot_accounts(&mut context, &rollback_addresses).await;
    assert_eq!(
        after, before,
        "AUC-007 rejected cap path must leave all writer, market, bid, and token prestate unchanged"
    );
}

#[tokio::test]
async fn writer_auction_preflight_preserves_canonical_success_deltas() {
    let mut program_test = ProgramTest::new(
        "light_token_minter",
        light_token_minter::id(),
        processor!(light_token_minter::process_instruction),
    );
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    // Spread was already registered from SBF_OUT_DIR. Switch only subsequent registrations back
    // to native processors so canonical Tokenkeg remains native in this SBF-backed test.
    program_test.prefer_bpf(false);
    program_test.add_program(
        "spl_token",
        spl_token::id(),
        processor!(spl_token::processor::Processor::process),
    );
    let mut context = program_test.start_with_context().await;
    let mut fixture = install_core_fixture(&mut context, false, WriterSleeveStatus::Active).await;
    let initial_assets = fixture.sleeve_state.accounted_asset_atoms;
    let initial_premium = fixture.sleeve_state.locked_primary_premium_atoms;
    let auction =
        install_full_auction_fixture(&mut context, &mut fixture, WriterAuctionStatus::Executing)
            .await;
    let (transaction, addresses, accepted) =
        install_first_auction_fill_transaction(&mut context, &fixture, &auction).await;
    let market_key = fixture.book_state.records[0].market;
    let mint_key = fixture.book_state.records[0].contract_mint;
    let destination_key = addresses[6];
    context
        .banks_client
        .process_transaction(transaction)
        .await
        .expect("canonical admitted fill must still succeed");

    let book_account = context
        .banks_client
        .get_account(fixture.book)
        .await
        .unwrap()
        .unwrap();
    let book = WriterSeriesBookV1::deserialize(&mut &book_account.data[..]).unwrap();
    assert_eq!(book.records[0].external_open_interest_atoms, accepted);
    assert_eq!(book.records[0].total_physical_supply_atoms, accepted);
    assert_eq!(book.records[0].issuer_controlled_atoms, 0);
    assert_eq!(book.records[0].primary_premium_collected_atoms, accepted);

    let sleeve_account = context
        .banks_client
        .get_account(fixture.sleeve)
        .await
        .unwrap()
        .unwrap();
    let sleeve = WriterSleeveV1::deserialize(&mut &sleeve_account.data[..]).unwrap();
    assert_eq!(sleeve.accounted_asset_atoms, initial_assets + accepted);
    assert_eq!(
        sleeve.locked_primary_premium_atoms,
        initial_premium + accepted
    );

    let market_account = context
        .banks_client
        .get_account(market_key)
        .await
        .unwrap()
        .unwrap();
    let market = Market::deserialize(&mut &market_account.data[..]).unwrap();
    assert_eq!(market.mint_accounting.total_issued, accepted);
    assert_eq!(market.mint_accounting.total_consumed, 0);
    let mint_account = context
        .banks_client
        .get_account(mint_key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(Mint::unpack(&mint_account.data).unwrap().supply, accepted);
    let destination_account = context
        .banks_client
        .get_account(destination_key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        TokenAccount::unpack(&destination_account.data)
            .unwrap()
            .amount,
        accepted
    );
}

#[tokio::test]
async fn historical_writer_auction_refund_survives_next_auction_and_rejects_replay() {
    let program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    let mut context = program_test.start_with_context().await;
    let mut fixture = install_core_fixture(&mut context, false, WriterSleeveStatus::Active).await;
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let now = u64::try_from(clock.unix_timestamp.max(0)).unwrap();
    let historical_nonce = 1u64;
    let current_nonce = 2u64;
    let refund_amount = 1_000_000u64;
    let bidder = context.payer.pubkey();
    let order_id = 7u64;
    let (historical_auction, historical_auction_bump) = current_pda(
        &fixture.program_id,
        &[
            WRITER_AUCTION_PDA_SEED,
            fixture.sleeve.as_ref(),
            &historical_nonce.to_le_bytes(),
        ],
    );
    let (historical_index, historical_index_bump) = current_pda(
        &fixture.program_id,
        &[WRITER_BID_INDEX_PDA_SEED, historical_auction.as_ref()],
    );
    let (historical_escrow, _) = current_pda(
        &fixture.program_id,
        &[WRITER_AUCTION_ESCROW_PDA_SEED, historical_auction.as_ref()],
    );
    let (historical_bid, historical_bid_bump) = current_pda(
        &fixture.program_id,
        &[
            WRITER_BID_PDA_SEED,
            historical_auction.as_ref(),
            bidder.as_ref(),
            &order_id.to_le_bytes(),
        ],
    );
    let (current_auction, _) = current_pda(
        &fixture.program_id,
        &[
            WRITER_AUCTION_PDA_SEED,
            fixture.sleeve.as_ref(),
            &current_nonce.to_le_bytes(),
        ],
    );
    let refund_token_account = Pubkey::new_unique();
    let claim_destination = Pubkey::new_unique();
    let fee_vault = Pubkey::new_unique();

    let mut historical_auction_state = WriterAuctionV1 {
        is_initialized: true,
        bump: historical_auction_bump,
        account_discriminator: WriterAuctionV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterAuctionV1::ACCOUNT_VERSION,
        sleeve: fixture.sleeve,
        series_book: fixture.book,
        policy_snapshot: fixture.snapshot,
        auction_nonce: historical_nonce,
        escrow: historical_escrow,
        bid_index: historical_index,
        fee_vault,
        policy_version: fixture.sleeve_state.policy_version,
        scenario_set_hash: fixture.sleeve_state.scenario_set_hash,
        risk_limit_hash: fixture.sleeve_state.risk_limit_hash,
        reserve_vector_commitment: [0x91; 32],
        commit_slot: clock.slot,
        bid_deadline_ts: now.saturating_sub(3),
        reveal_deadline_ts: now.saturating_sub(2),
        execute_deadline_ts: now.saturating_sub(1),
        bid_count: 1,
        total_escrow_atoms: refund_amount,
        refundable_atoms: refund_amount,
        status: WriterAuctionStatus::Refundable,
        last_updated_slot: clock.slot,
        ..WriterAuctionV1::default()
    };
    historical_auction_state.reserve_prices_atoms[0] = 1_000_000;
    historical_auction_state.issue_caps_atoms[0] = WRITER_CONTRACT_ATOMIC_SCALE;
    let mut historical_index_state = WriterBidIndexV1 {
        is_initialized: true,
        bump: historical_index_bump,
        account_discriminator: WriterBidIndexV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterBidIndexV1::ACCOUNT_VERSION,
        auction: historical_auction,
        bid_count: 1,
        rolling_digest: [0x92; 32],
        last_updated_slot: clock.slot,
        ..WriterBidIndexV1::default()
    };
    historical_index_state.records[0] = WriterBidIndexRecordV1 {
        occupied: true,
        status: WriterBidStatus::Refundable,
        series_index: 0,
        bid_price_per_contract_atoms: 1_000_000,
        requested_contract_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
        escrowed_atoms: refund_amount,
        bid: historical_bid,
        bidder,
        order_id,
        ..WriterBidIndexRecordV1::default()
    };
    let historical_bid_state = WriterBidV1 {
        is_initialized: true,
        bump: historical_bid_bump,
        account_discriminator: WriterBidV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterBidV1::ACCOUNT_VERSION,
        auction: historical_auction,
        bidder,
        refund_token_account,
        claim_destination,
        order_id,
        series_index: 0,
        status: WriterBidStatus::Refundable,
        delivery_mode: WriterBidDeliveryMode::ClassicSpl,
        bid_price_per_contract_atoms: 1_000_000,
        requested_contract_atoms: WRITER_CONTRACT_ATOMIC_SCALE,
        escrowed_atoms: refund_amount,
        placed_slot: clock.slot,
        last_updated_slot: clock.slot,
        ..WriterBidV1::default()
    };

    fixture.sleeve_state.auction_nonce = current_nonce;
    fixture.sleeve_state.active_auction = Some(current_auction);
    fixture.sleeve_state.last_updated_slot = clock.slot;
    set_borsh_account(
        &mut context,
        fixture.sleeve,
        fixture.program_id,
        &fixture.sleeve_state,
        WriterSleeveV1::LEN,
    )
    .await;
    set_borsh_account(
        &mut context,
        historical_auction,
        fixture.program_id,
        &historical_auction_state,
        WriterAuctionV1::LEN,
    )
    .await;
    set_borsh_account(
        &mut context,
        historical_index,
        fixture.program_id,
        &historical_index_state,
        WriterBidIndexV1::LEN,
    )
    .await;
    set_borsh_account(
        &mut context,
        historical_bid,
        fixture.program_id,
        &historical_bid_state,
        WriterBidV1::LEN,
    )
    .await;
    set_token_account(
        &mut context,
        historical_escrow,
        fixture.settlement_mint,
        historical_auction,
        refund_amount,
    )
    .await;
    set_token_account(
        &mut context,
        refund_token_account,
        fixture.settlement_mint,
        bidder,
        0,
    )
    .await;

    let mut metas = vec![
        AccountMeta::new_readonly(bidder, true),
        AccountMeta::new_readonly(fixture.sleeve, false),
        AccountMeta::new(historical_auction, false),
        AccountMeta::new(historical_index, false),
        AccountMeta::new(historical_bid, false),
        AccountMeta::new(historical_escrow, false),
        AccountMeta::new(refund_token_account, false),
        AccountMeta::new_readonly(fixture.settlement_mint, false),
        AccountMeta::new_readonly(spl_token::id(), false),
    ];
    let mut instruction_data = VaultInstruction::CancelOrRefundWriterBidV1
        .try_to_vec()
        .unwrap();
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    {
        let gate = install_active_writer_gate(&mut context).await;
        metas.push(AccountMeta::new_readonly(gate, false));
        instruction_data.extend_from_slice(
            &GovernanceInstructionTailV1::for_epoch(WRITER_CLOSE_GOVERNANCE_EPOCH).encode(),
        );
    }
    let instruction = Instruction {
        program_id: fixture.program_id,
        accounts: metas,
        data: instruction_data,
    };
    let transaction = Transaction::new_signed_with_payer(
        &[instruction.clone()],
        Some(&bidder),
        &[&context.payer],
        context.last_blockhash,
    );
    let first_signature = transaction.signatures[0];
    context
        .banks_client
        .process_transaction(transaction)
        .await
        .expect("historical auction refund after the next auction starts");

    let refunded_account = context
        .banks_client
        .get_account(refund_token_account)
        .await
        .unwrap()
        .expect("refund destination exists");
    let refunded = TokenAccount::unpack(&refunded_account.data).expect("decode refund account");
    assert_eq!(refunded.amount, refund_amount);
    let escrow_account = context
        .banks_client
        .get_account(historical_escrow)
        .await
        .unwrap()
        .expect("historical escrow exists");
    let escrow = TokenAccount::unpack(&escrow_account.data).expect("decode historical escrow");
    assert_eq!(escrow.amount, 0);
    let bid_account = context
        .banks_client
        .get_account(historical_bid)
        .await
        .unwrap()
        .expect("historical bid exists");
    let refunded_bid = WriterBidV1::deserialize(&mut &bid_account.data[..]).expect("decode bid");
    assert_eq!(refunded_bid.status, WriterBidStatus::Refunded);
    assert_eq!(refunded_bid.refunded_atoms, refund_amount);
    let index_account = context
        .banks_client
        .get_account(historical_index)
        .await
        .unwrap()
        .expect("historical bid index exists");
    let refunded_index = WriterBidIndexV1::deserialize(&mut &index_account.data[..])
        .expect("decode historical bid index");
    assert_eq!(refunded_index.records[0].status, WriterBidStatus::Refunded);
    assert_eq!(refunded_index.refunded_bid_count, 1);
    let auction_account = context
        .banks_client
        .get_account(historical_auction)
        .await
        .unwrap()
        .expect("historical auction exists");
    let refunded_auction = WriterAuctionV1::deserialize(&mut &auction_account.data[..])
        .expect("decode historical auction");
    assert_eq!(refunded_auction.total_escrow_atoms, 0);
    assert_eq!(refunded_auction.refundable_atoms, 0);
    assert_eq!(refunded_auction.refunded_bid_count, 1);
    let sleeve_account = context
        .banks_client
        .get_account(fixture.sleeve)
        .await
        .unwrap()
        .expect("writer sleeve exists");
    let sleeve =
        WriterSleeveV1::deserialize(&mut &sleeve_account.data[..]).expect("decode writer sleeve");
    assert_eq!(sleeve.auction_nonce, current_nonce);
    assert_eq!(sleeve.active_auction, Some(current_auction));

    let replay_addresses = [
        fixture.sleeve,
        historical_auction,
        historical_index,
        historical_bid,
        historical_escrow,
        refund_token_account,
    ];
    let before_replay = snapshot_accounts(&mut context, &replay_addresses).await;
    let root_slot = context.banks_client.get_root_slot().await.unwrap();
    context
        .warp_to_slot(root_slot.checked_add(1).expect("test slot increment"))
        .expect("warp for a distinct replay blockhash");
    let replay = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&bidder),
        &[&context.payer],
        context.last_blockhash,
    );
    assert_ne!(replay.signatures[0], first_signature);
    let replay_error = context
        .banks_client
        .process_transaction(replay)
        .await
        .expect_err("a fresh-blockhash refund replay must execute and reject");
    assert_eq!(
        replay_error.unwrap(),
        TransactionError::InstructionError(
            0,
            InstructionError::Custom(VaultError::InvalidWriterBid as u32),
        )
    );
    let after_replay = snapshot_accounts(&mut context, &replay_addresses).await;
    assert_eq!(
        after_replay, before_replay,
        "refund replay must not mutate state"
    );
}

struct CloseFinalizationFixture {
    core: CoreFixture,
    request: Pubkey,
    flat_escrow: Pubkey,
    destination: Pubkey,
    request_state: WriterCloseRequestV1,
    instruction: Instruction,
    lookup: AddressLookupTableAccount,
    fee_payer: solana_sdk::signature::Keypair,
    transaction: VersionedTransaction,
    instruction_account_count: usize,
    loaded_account_count: usize,
    wire_bytes: usize,
    candidate_count: u16,
    withdrawal_atoms: u64,
}

async fn install_twenty_series_close_finalization_fixture(
    context: &mut ProgramTestContext,
) -> CloseFinalizationFixture {
    install_deterministic_close_context(context);
    let mut fixture = install_core_fixture(context, true, WriterSleeveStatus::CloseStaging).await;
    let clock = context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let now = u64::try_from(clock.unix_timestamp.max(0)).unwrap();
    let close_nonce = 1u64;
    let (request, request_bump) = current_pda(
        &fixture.program_id,
        &[
            WRITER_CLOSE_REQUEST_PDA_SEED,
            fixture.sleeve.as_ref(),
            &close_nonce.to_le_bytes(),
        ],
    );
    let (flat_escrow, _) = current_pda(
        &fixture.program_id,
        &[WRITER_CLOSE_FLAT_ESCROW_PDA_SEED, request.as_ref()],
    );
    let math_series: Vec<_> = fixture
        .book_state
        .records
        .iter()
        .take(SERIES_COUNT)
        .map(|record| WriterSeries {
            kind: record.option_kind,
            strike_price_atomic: record.strike_price_atomic,
            cap_price_atomic: record.cap_or_floor_price_atomic,
            contract_size_atoms: record.contract_size_atoms,
            max_payout_per_contract_atoms: record.max_payout_per_contract_atoms,
            external_oi_atoms: record.external_open_interest_atoms,
        })
        .collect();
    let flat_amount_atoms = 100_000_000;
    let preview = proportional_close_preview(
        fixture.sleeve_state.accounted_asset_atoms,
        fixture.sleeve_state.flat_par_supply_atoms,
        flat_amount_atoms,
        &math_series,
        fixture.snapshot_state.lower_tail_max_settlement_atomic,
        fixture.snapshot_state.upper_tail_min_settlement_atomic,
    )
    .unwrap();
    let mut request_state = WriterCloseRequestV1 {
        is_initialized: true,
        bump: request_bump,
        account_discriminator: WriterCloseRequestV1::ACCOUNT_DISCRIMINATOR,
        account_version: WriterCloseRequestV1::ACCOUNT_VERSION,
        sleeve: fixture.sleeve,
        owner: context.payer.pubkey(),
        flat_escrow,
        flat_mint: fixture.flat_mint,
        request_nonce: close_nonce,
        flat_amount_atoms,
        minimum_withdrawal_atoms: preview.withdrawal_atoms,
        snapshot_asset_atoms: fixture.sleeve_state.accounted_asset_atoms,
        snapshot_reserve_atoms: fixture.sleeve_state.exact_reserve_atoms,
        snapshot_writer_principal_atoms: fixture.sleeve_state.writer_principal_atoms,
        snapshot_locked_primary_premium_atoms: fixture.sleeve_state.locked_primary_premium_atoms,
        snapshot_flat_supply_atoms: fixture.sleeve_state.flat_par_supply_atoms,
        snapshot_security_exposure_atoms: fixture.sleeve_state.security_exposure_atoms,
        snapshot_policy_version: fixture.sleeve_state.policy_version,
        snapshot_group_commitment: writer_group_commitment(&fixture.group, &fixture.group_state),
        snapshot_book_digest: writer_book_digest(&fixture.book_state),
        deadline_ts: now + 500_000,
        status: WriterCloseRequestStatus::Complete,
        series_count: SERIES_COUNT as u8,
        next_deposit_index: SERIES_COUNT as u8,
        next_cancel_index: 0,
        final_withdrawal_atoms: preview.withdrawal_atoms,
        last_updated_slot: clock.slot,
        ..WriterCloseRequestV1::default()
    };
    for index in 0..SERIES_COUNT {
        request_state.required_claim_atoms[index] = preview.required_claim_atoms.values[index];
        request_state.deposited_claim_atoms[index] = preview.required_claim_atoms.values[index];
        request_state.snapshot_external_oi_atoms[index] =
            fixture.book_state.records[index].external_open_interest_atoms;
    }
    fixture.sleeve_state.close_nonce = close_nonce;
    fixture.sleeve_state.active_close_request = Some(request);
    set_borsh_account(
        context,
        fixture.sleeve,
        fixture.program_id,
        &fixture.sleeve_state,
        WriterSleeveV1::LEN,
    )
    .await;
    set_borsh_account(
        context,
        request,
        fixture.program_id,
        &request_state,
        WriterCloseRequestV1::LEN,
    )
    .await;
    set_token_account(
        context,
        flat_escrow,
        fixture.flat_mint,
        request,
        flat_amount_atoms,
    )
    .await;
    let destination = benchmark_pubkey(b"close-destination");
    let owner = context.payer.pubkey();
    set_token_account(context, destination, fixture.settlement_mint, owner, 0).await;

    let mut series_burn_accounts = Vec::with_capacity(SERIES_COUNT * 3);
    for index in 0..SERIES_COUNT {
        let record = fixture.book_state.records[index];
        let required = request_state.required_claim_atoms[index];
        set_mint(
            context,
            record.contract_mint,
            record.market,
            record.total_physical_supply_atoms,
        )
        .await;
        set_token_account(
            context,
            record.retirement_custody,
            record.contract_mint,
            fixture.sleeve,
            required,
        )
        .await;
        series_burn_accounts.extend([
            record.market,
            record.contract_mint,
            record.retirement_custody,
        ]);
    }

    let mut metas = vec![
        AccountMeta::new_readonly(context.payer.pubkey(), true),
        AccountMeta::new_readonly(fixture.vault_config, false),
        AccountMeta::new(fixture.sleeve, false),
        AccountMeta::new_readonly(fixture.group, false),
        AccountMeta::new(fixture.book, false),
        AccountMeta::new_readonly(fixture.snapshot, false),
        AccountMeta::new(request, false),
        AccountMeta::new(fixture.sleeve_vault, false),
        AccountMeta::new(destination, false),
        AccountMeta::new_readonly(fixture.settlement_mint, false),
        AccountMeta::new(fixture.flat_mint, false),
        AccountMeta::new(flat_escrow, false),
        AccountMeta::new_readonly(spl_token::id(), false),
    ];
    metas.extend(
        series_burn_accounts
            .iter()
            .copied()
            .map(|address| AccountMeta::new(address, false)),
    );
    let mut instruction_data = VaultInstruction::FinalizeWriterCloseV1
        .try_to_vec()
        .unwrap();
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    {
        let gate = install_active_writer_gate(context).await;
        metas.push(AccountMeta::new_readonly(gate, false));
        instruction_data.extend_from_slice(
            &GovernanceInstructionTailV1::for_epoch(WRITER_CLOSE_GOVERNANCE_EPOCH).encode(),
        );
    }
    let instruction_account_count = 13
        + SERIES_COUNT * 3
        + usize::from(cfg!(feature = "phase3-synthetic-governance-controller"));
    assert_eq!(metas.len(), instruction_account_count);
    let lookup_addresses = metas
        .iter()
        .filter(|meta| !meta.is_signer)
        .map(|meta| meta.pubkey)
        .collect();
    let instruction = Instruction {
        program_id: fixture.program_id,
        accounts: metas,
        data: instruction_data,
    };
    let lookup = install_lookup_table(context, lookup_addresses).await;
    // Keep the benchmark wire shape aligned with the governed TypeScript planner: its fee payer
    // is deliberately distinct from the sleeve owner, so both signatures are present.
    let fee_payer =
        Keypair::from_seed(&WRITER_CLOSE_FEE_PAYER_SEED).expect("fixed close fee-payer seed");
    assert_ne!(
        fee_payer.pubkey(),
        context.payer.pubkey(),
        "the benchmark must retain distinct fee-payer and sleeve-owner signers"
    );
    let fee_payer_account =
        AccountSharedData::new(1_000_000_000, 0, &solana_sdk::system_program::id());
    context.set_account(&fee_payer.pubkey(), &fee_payer_account);
    let compute_budget_instruction =
        solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(
            u32::try_from(TRANSACTION_COMPUTE_LIMIT).unwrap(),
        );
    let message = v0::Message::try_compile(
        &fee_payer.pubkey(),
        &[compute_budget_instruction, instruction.clone()],
        std::slice::from_ref(&lookup),
        context.last_blockhash,
    )
    .unwrap();
    let loaded_account_count = message.account_keys.len()
        + message
            .address_table_lookups
            .iter()
            .map(|table| table.writable_indexes.len() + table.readonly_indexes.len())
            .sum::<usize>();
    assert!(
        loaded_account_count <= 128,
        "close transaction locks {loaded_account_count} accounts"
    );
    let transaction =
        VersionedTransaction::try_new(VersionedMessage::V0(message), &[&fee_payer, &context.payer])
            .unwrap();
    let wire_bytes = bincode::serialize(&transaction).unwrap().len();
    assert!(
        wire_bytes <= PACKET_DATA_SIZE,
        "close transaction is {wire_bytes} bytes"
    );
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    {
        assert_eq!(instruction_account_count, 74);
        assert_eq!(loaded_account_count, 77);
        assert_eq!(wire_bytes, 505);
    }

    CloseFinalizationFixture {
        core: fixture,
        request,
        flat_escrow,
        destination,
        request_state,
        instruction,
        lookup,
        fee_payer,
        transaction,
        instruction_account_count,
        loaded_account_count,
        wire_bytes,
        candidate_count: preview.candidate_count,
        withdrawal_atoms: preview.withdrawal_atoms,
    }
}

fn build_close_finalization_transaction(
    close: &CloseFinalizationFixture,
    owner: &solana_sdk::signature::Keypair,
    recent_blockhash: solana_sdk::hash::Hash,
    instruction: Instruction,
) -> VersionedTransaction {
    let compute_budget_instruction =
        solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(
            u32::try_from(TRANSACTION_COMPUTE_LIMIT).unwrap(),
        );
    let message = v0::Message::try_compile(
        &close.fee_payer.pubkey(),
        &[compute_budget_instruction, instruction],
        std::slice::from_ref(&close.lookup),
        recent_blockhash,
    )
    .expect("compile mutated close transaction");
    VersionedTransaction::try_new(VersionedMessage::V0(message), &[&close.fee_payer, owner])
        .expect("sign mutated close transaction")
}

fn writer_close_sentinel_token_processor(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if *program_id != spl_token::id()
        || accounts.len() != 3
        || data.len() != 10
        || data[0] != 15
        || data[9] != MarketMintAccounting::CANONICAL_DECIMALS
        || accounts[0].is_signer
        || !accounts[0].is_writable
        || accounts[1].is_signer
        || !accounts[1].is_writable
        || !accounts[2].is_signer
        || accounts[2].is_writable
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut amount_bytes = [0; 8];
    amount_bytes.copy_from_slice(&data[1..9]);
    let amount = u64::from_le_bytes(amount_bytes);
    if amount != WRITER_CLOSE_FIRST_BURN_AMOUNT {
        return Err(ProgramError::Custom(WRITER_CLOSE_TOKEN_SENTINEL_ERROR));
    }

    // Commit one valid burn before rejecting the next series. The enclosing writer instruction
    // must roll this successful CPI back when the sentinel error propagates.
    {
        let mut source_data = accounts[0].try_borrow_mut_data()?;
        let mut source = TokenAccount::unpack(&source_data)?;
        if source.mint != *accounts[1].key
            || source.owner != *accounts[2].key
            || source.state != AccountState::Initialized
        {
            return Err(ProgramError::InvalidAccountData);
        }
        source.amount = source
            .amount
            .checked_sub(amount)
            .ok_or(ProgramError::InsufficientFunds)?;
        TokenAccount::pack(source, &mut source_data)?;
    }
    {
        let mut mint_data = accounts[1].try_borrow_mut_data()?;
        let mut mint = Mint::unpack(&mint_data)?;
        if mint.decimals != MarketMintAccounting::CANONICAL_DECIMALS || !mint.is_initialized {
            return Err(ProgramError::InvalidAccountData);
        }
        mint.supply = mint
            .supply
            .checked_sub(amount)
            .ok_or(ProgramError::InsufficientFunds)?;
        Mint::pack(mint, &mut mint_data)?;
    }
    Ok(())
}

async fn snapshot_accounts(context: &mut ProgramTestContext, addresses: &[Pubkey]) -> Vec<Account> {
    let mut snapshot = Vec::with_capacity(addresses.len());
    for address in addresses {
        snapshot.push(
            context
                .banks_client
                .get_account(*address)
                .await
                .unwrap()
                .unwrap_or_else(|| panic!("missing rollback account {address}")),
        );
    }
    snapshot
}

fn close_rollback_addresses(
    close: &CloseFinalizationFixture,
    extra_addresses: &[Pubkey],
) -> Vec<Pubkey> {
    let mut addresses = vec![
        close.request_state.owner,
        close.core.vault_config,
        close.core.group,
        close.core.sleeve,
        close.core.book,
        close.core.snapshot,
        close.request,
        close.core.sleeve_vault,
        close.destination,
        close.core.settlement_mint,
        close.core.flat_mint,
        close.flat_escrow,
    ];
    for record in close.core.book_state.records.iter().take(SERIES_COUNT) {
        addresses.extend([
            record.market,
            record.contract_mint,
            record.retirement_custody,
        ]);
    }
    addresses.extend_from_slice(extra_addresses);
    addresses.sort_unstable_by_key(|address| address.to_bytes());
    addresses.dedup();
    addresses
}

async fn assert_rejected_close_rolls_back(
    context: &mut ProgramTestContext,
    close: &CloseFinalizationFixture,
    case_id: &str,
    instruction: Instruction,
    extra_addresses: &[Pubkey],
    expected_error: VaultError,
) {
    let rollback_addresses = close_rollback_addresses(close, extra_addresses);
    let before = snapshot_accounts(context, &rollback_addresses).await;
    let recent_blockhash = context
        .banks_client
        .get_latest_blockhash()
        .await
        .expect("fetch fresh close-mutation blockhash");
    let transaction =
        build_close_finalization_transaction(close, &context.payer, recent_blockhash, instruction);
    let error = context
        .banks_client
        .process_transaction(transaction)
        .await
        .expect_err("rejected close mutation must return a transaction error");
    eprintln!("{case_id} rejected with {error:?}");
    assert_eq!(
        error.unwrap(),
        TransactionError::InstructionError(1, InstructionError::Custom(expected_error as u32),),
        "{case_id} rejection"
    );
    let after = snapshot_accounts(context, &rollback_addresses).await;
    assert_eq!(
        after, before,
        "{case_id} must leave every writer, token, and economic account byte-identical"
    );
}

#[tokio::test]
async fn twenty_series_integrated_close_finalization_fits_sbf_packet_and_compute_budget() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    let mut context = program_test.start_with_context().await;
    let close = install_twenty_series_close_finalization_fixture(&mut context).await;
    let simulation = context
        .banks_client
        .simulate_transaction(close.transaction.clone())
        .await
        .expect("integrated close simulation transport");
    assert_eq!(
        simulation.result,
        Some(Ok::<(), TransactionError>(())),
        "{simulation:?}"
    );
    let details = simulation.simulation_details.unwrap();
    assert!(details.units_consumed <= TRANSACTION_COMPUTE_LIMIT);
    #[cfg(feature = "phase3-synthetic-governance-controller")]
    assert_eq!(
        details.units_consumed, WRITER_CLOSE_GOVERNED_EXPECTED_COMPUTE_UNITS,
        "fixed clock, signer seeds, and direct account identities must keep the governed max-close CU receipt stable"
    );
    context
        .banks_client
        .process_transaction(close.transaction.clone())
        .await
        .expect("atomic close execution");
    let updated_book_account = context
        .banks_client
        .get_account(close.core.book)
        .await
        .unwrap()
        .expect("writer book exists");
    let updated_book = WriterSeriesBookV1::deserialize(&mut &updated_book_account.data[..])
        .expect("decode updated writer book");
    for index in 0..SERIES_COUNT {
        let before = close.core.book_state.records[index];
        let after = updated_book.records[index];
        let required = close.request_state.required_claim_atoms[index];
        let mint_account = context
            .banks_client
            .get_account(before.contract_mint)
            .await
            .unwrap()
            .expect("contract mint exists");
        let mint = Mint::unpack(&mint_account.data).expect("decode contract mint");
        let custody_account = context
            .banks_client
            .get_account(before.retirement_custody)
            .await
            .unwrap()
            .expect("retirement custody exists");
        let custody = TokenAccount::unpack(&custody_account.data).expect("decode custody");
        let market_account = context
            .banks_client
            .get_account(before.market)
            .await
            .unwrap()
            .expect("Market exists");
        let market = Market::deserialize(&mut &market_account.data[..]).expect("decode Market");
        assert_eq!(mint.supply, before.total_physical_supply_atoms - required);
        assert_eq!(custody.amount, 0);
        assert_eq!(after.total_physical_supply_atoms, mint.supply);
        assert_eq!(
            after.external_open_interest_atoms,
            before.external_open_interest_atoms - required
        );
        assert_eq!(after.issuer_controlled_atoms, 0);
        assert_eq!(after.custody_status, WriterSeriesCustodyStatus::Absent);
        assert_eq!(market.mint_accounting.total_consumed, required);
        assert_eq!(market.mint_accounting.total_burned, required);
        assert_eq!(
            market.mint_accounting.total_issued - market.mint_accounting.total_consumed,
            after.external_open_interest_atoms
        );
        assert_eq!(
            market.mint_accounting.total_issued - market.mint_accounting.total_burned,
            after.total_physical_supply_atoms
        );
    }
    println!(
        "writer_close_sbf series={} candidates={} instruction_accounts={} loaded_accounts={} wire_bytes={} withdrawal={} compute_units={}",
        SERIES_COUNT,
        close.candidate_count,
        close.instruction_account_count,
        close.loaded_account_count,
        close.wire_bytes,
        close.withdrawal_atoms,
        details.units_consumed,
    );
}

#[tokio::test]
async fn writer_close_account_mutations_acc_055_through_059_reject_and_roll_back() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    let mut context = program_test.start_with_context().await;
    let close = install_twenty_series_close_finalization_fixture(&mut context).await;

    // ACC-055: copy the canonical request byte-for-byte to a same-owner PDA derived from a
    // different nonce, then supply that noncanonical address in the request role.
    let wrong_request_nonce = close.request_state.request_nonce.checked_add(1).unwrap();
    let wrong_request = current_pda(
        &close.core.program_id,
        &[
            WRITER_CLOSE_REQUEST_PDA_SEED,
            close.core.sleeve.as_ref(),
            &wrong_request_nonce.to_le_bytes(),
        ],
    )
    .0;
    set_borsh_account(
        &mut context,
        wrong_request,
        close.core.program_id,
        &close.request_state,
        WriterCloseRequestV1::LEN,
    )
    .await;
    let canonical_request_account = context
        .banks_client
        .get_account(close.request)
        .await
        .unwrap()
        .expect("canonical close request exists");
    let wrong_request_account = context
        .banks_client
        .get_account(wrong_request)
        .await
        .unwrap()
        .expect("same-owner wrong-PDA request exists");
    assert_eq!(wrong_request_account, canonical_request_account);

    // ACC-056: construct a separately canonical Market account for another underlying, expiry,
    // and series, then place it in the first registered series' Market role.
    let first_record = close.core.book_state.records[0];
    let first_market_account = context
        .banks_client
        .get_account(first_record.market)
        .await
        .unwrap()
        .expect("first registered Market exists");
    let mut foreign_market_state =
        Market::deserialize(&mut &first_market_account.data[..]).expect("decode first Market");
    let foreign_series_id = [0xf5; 32];
    let (foreign_market, foreign_market_bump) = current_pda(
        &close.core.program_id,
        &[MARKET_PDA_SEED, &foreign_series_id],
    );
    let foreign_contract_mint = current_pda(
        &close.core.program_id,
        &[CONTRACT_MINT_PDA_SEED, foreign_market.as_ref()],
    )
    .0;
    foreign_market_state.bump = foreign_market_bump;
    foreign_market_state.market_id = foreign_series_id;
    foreign_market_state.instrument.underlying_id = [0xf6; 32];
    foreign_market_state.instrument.expiry_ts = foreign_market_state
        .instrument
        .expiry_ts
        .checked_add(1)
        .unwrap();
    foreign_market_state.long_contract_mint = Some(foreign_contract_mint);
    set_borsh_account(
        &mut context,
        foreign_market,
        close.core.program_id,
        &foreign_market_state,
        Market::LEN,
    )
    .await;
    set_mint(
        &mut context,
        foreign_contract_mint,
        foreign_market,
        foreign_market_state.mint_accounting.total_issued,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts[6].pubkey = wrong_request;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-055 same-owner wrong request PDA",
        instruction,
        &[wrong_request],
        VaultError::InvalidWriterCloseRequest,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts[13].pubkey = foreign_market;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-056 cross-domain valid Market",
        instruction,
        &[foreign_market, foreign_contract_mint],
        VaultError::InvalidAccountList,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts.swap(13, 16);
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-057 registered-series Market order",
        instruction,
        &[],
        VaultError::InvalidAccountList,
    )
    .await;

    // ACC-058 intentionally removes a required privilege. Harmless extra transaction-wide
    // privileges are not treated as an on-chain rejection invariant.
    let mut instruction = close.instruction.clone();
    instruction.accounts[13].is_writable = false;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-058 required Market writable privilege removed",
        instruction,
        &[],
        VaultError::InvalidAccountList,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts[4].is_writable = false;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-058 required fixed book writable privilege removed",
        instruction,
        &[],
        VaultError::InvalidAccountList,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts[8].pubkey = close.core.sleeve_vault;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-059 USDC source/destination semantic alias",
        instruction,
        &[],
        VaultError::InvalidAccountList,
    )
    .await;
}

#[tokio::test]
async fn writer_close_account_mutations_acc_060_reject_and_roll_back() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    let mut context = program_test.start_with_context().await;
    let close = install_twenty_series_close_finalization_fixture(&mut context).await;

    // ACC-060 owner/mint variants use otherwise valid classic-SPL destinations.
    let wrong_owner_destination = Pubkey::new_unique();
    set_token_account(
        &mut context,
        wrong_owner_destination,
        close.core.settlement_mint,
        Pubkey::new_unique(),
        0,
    )
    .await;
    let wrong_destination_mint = Pubkey::new_unique();
    set_mint(
        &mut context,
        wrong_destination_mint,
        close.request_state.owner,
        0,
    )
    .await;
    let wrong_mint_destination = Pubkey::new_unique();
    set_token_account(
        &mut context,
        wrong_mint_destination,
        wrong_destination_mint,
        close.request_state.owner,
        0,
    )
    .await;
    let wrong_token_program = Pubkey::new_unique();
    let wrong_token_program_account =
        AccountSharedData::new(1_000_000, 0, &solana_sdk::system_program::id());
    context.set_account(&wrong_token_program, &wrong_token_program_account);

    let mut instruction = close.instruction.clone();
    instruction.accounts[12].pubkey = wrong_token_program;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-060 token-program substitution",
        instruction,
        &[wrong_token_program],
        VaultError::InvalidTokenProgram,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts[8].pubkey = wrong_owner_destination;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-060 destination-owner substitution",
        instruction,
        &[wrong_owner_destination],
        VaultError::InvalidTokenAccount,
    )
    .await;

    let mut instruction = close.instruction.clone();
    instruction.accounts[8].pubkey = wrong_mint_destination;
    assert_rejected_close_rolls_back(
        &mut context,
        &close,
        "ACC-060 destination-mint substitution",
        instruction,
        &[wrong_destination_mint, wrong_mint_destination],
        VaultError::InvalidTokenAccount,
    )
    .await;
}

#[tokio::test]
async fn writer_close_direct_burn_error_propagates_and_rolls_back_atomically() {
    let mut program_test = ProgramTest::new("light_token_minter", light_token_minter::id(), None);
    program_test.set_compute_max_units(TRANSACTION_COMPUTE_LIMIT);
    // Spread was already registered from SBF_OUT_DIR. Switch only subsequent registrations back
    // to native processors so this test can replace Tokenkeg with its deterministic sentinel.
    program_test.prefer_bpf(false);
    program_test.add_program(
        "writer_close_sentinel_token",
        spl_token::id(),
        processor!(writer_close_sentinel_token_processor),
    );
    let mut context = program_test.start_with_context().await;
    let close = install_twenty_series_close_finalization_fixture(&mut context).await;
    assert_eq!(
        close.request_state.required_claim_atoms[0],
        WRITER_CLOSE_FIRST_BURN_AMOUNT
    );
    assert_ne!(
        close.request_state.required_claim_atoms[1],
        WRITER_CLOSE_FIRST_BURN_AMOUNT
    );

    let first = close.core.book_state.records[0];
    let rollback_addresses = [
        close.core.sleeve,
        close.core.book,
        first.contract_mint,
        first.retirement_custody,
    ];
    let before = snapshot_accounts(&mut context, &rollback_addresses).await;
    let error = context
        .banks_client
        .process_transaction(close.transaction)
        .await
        .expect_err("second BurnChecked CPI must return the sentinel error");
    assert_eq!(
        error.unwrap(),
        TransactionError::InstructionError(
            1,
            InstructionError::Custom(WRITER_CLOSE_TOKEN_SENTINEL_ERROR),
        )
    );
    let after = snapshot_accounts(&mut context, &rollback_addresses).await;
    assert_eq!(
        after, before,
        "failed close must roll back every prior write"
    );
}

#[test]
fn benchmark_constants_bind_full_caps() {
    assert_eq!(SERIES_COUNT, 20);
    assert_eq!(WRITER_MAX_FUNDED_BIDS, 128);
    assert_eq!(WRITER_CONTRACT_ATOMIC_SCALE, 1_000_000);
}
