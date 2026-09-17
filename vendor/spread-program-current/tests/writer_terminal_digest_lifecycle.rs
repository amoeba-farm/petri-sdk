#![cfg(feature = "devnet-v3-governance-controller")]
// Boundary regression: Game/recipe/coverage/active/Funding/custody prerequisites
// are fixture-loaded. No terminal manifest is injected: tags 75/113 create it.
// The upstream verified settlement record is a fixture; this is not a test of
// source ingestion, temporal-median computation, or tag116 signature verification.
use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{constants::*, governance_gate::*, state::*};
use solana_program::{hash::hashv, program_option::COption, program_pack::Pack, rent::Rent};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use solana_system_interface::program as system_program;
use spl_token::state::{Account as TokenAccount, AccountState, Mint};
#[path = "writer_continuity/mod.rs"]
mod continuity;

const NOW: u64 = 1_800_000_000;
const EXPIRY: u64 = NOW + 1_000_000;
const PRINCIPAL: u64 = 24_000_000;

fn owned<T: BorshSerialize>(value: &T, size: usize) -> Account {
    let mut data = borsh::to_vec(value).unwrap();
    assert!(data.len() <= size);
    data.resize(size, 0);
    Account {
        lamports: Rent::default().minimum_balance(size),
        data,
        owner: light_token_minter::id(),
        executable: false,
        rent_epoch: 0,
    }
}
fn put<T: BorshSerialize>(ctx: &mut ProgramTestContext, key: Pubkey, value: &T, size: usize) {
    ctx.set_account(&key, &AccountSharedData::from(owned(value, size)));
}
async fn state<T: BorshDeserialize>(ctx: &mut ProgramTestContext, key: Pubkey) -> T {
    let a = ctx.banks_client.get_account(key).await.unwrap().unwrap();
    T::deserialize(&mut &a.data[..]).unwrap()
}
fn set_time(ctx: &mut ProgramTestContext, ts: u64) {
    let c = Clock {
        slot: 42_000_000,
        unix_timestamp: ts as i64,
        ..Clock::default()
    };
    ctx.set_sysvar(&c);
}
fn group_hash(key: &Pubkey, g: &WriterSettlementGroupV1) -> [u8; 32] {
    hashv(&[
        b"ameba-writer-settlement-group-g3",
        key.as_ref(),
        &g.underlying_id,
        &g.expiry_ts.to_le_bytes(),
        g.settlement_mint.as_ref(),
        g.anchor_market.as_ref(),
        g.anchor_oracle_month.as_ref(),
        &g.oracle_methodology_version.to_le_bytes(),
        &g.product_manifest_root,
        &g.coverage_manifest_hash,
        &g.recipe_hash,
        &g.settlement_source_digest,
        &g.active_weight_manifest_hash,
        &g.security_cap_atoms.to_le_bytes(),
        g.signer_registry.as_ref(),
        g.signer_set.as_ref(),
        &g.signer_set_version.to_le_bytes(),
        &g.signer_set_hash,
        &g.settlement_ts.to_le_bytes(),
    ])
    .to_bytes()
}

struct Fixture {
    ctx: ProgramTestContext,
    admin: Keypair,
    oracle: Keypair,
    recovery: Keypair,
    attestor: Keypair,
    gate: Pubkey,
    config: Pubkey,
    market: Pubkey,
    month: Pubkey,
    coverage: Pubkey,
    recipe: Pubkey,
    active: Pubkey,
    terminal: Pubkey,
    bucket: Pubkey,
    group: Pubkey,
    sleeve: Pubkey,
    book: Pubkey,
    policy: Pubkey,
    vault: Pubkey,
    registry: Pubkey,
    signers: Pubkey,
    record: Pubkey,
}
impl Fixture {
    async fn start(prefund: bool) -> Self {
        let program = light_token_minter::id();
        let actual = std::env::var("WRITER_LIFECYCLE_REQUIRE_SBF").as_deref() == Ok("1");
        let mut test = if actual {
            let dir = std::env::var("SBF_OUT_DIR").expect("exact SBF directory required");
            assert!(std::path::Path::new(&dir)
                .join("light_token_minter.so")
                .is_file());
            let bytes =
                std::fs::read(std::path::Path::new(&dir).join("light_token_minter.so")).unwrap();
            let hash = solana_program::hash::hash(&bytes)
                .to_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            assert_eq!(
                hash,
                std::env::var("AMEBA_TESTED_SBF_SHA256").expect("exact artifact hash required")
            );
            println!("writer_terminal actual_sbf_sha256={hash}");
            ProgramTest::new("light_token_minter", program, None)
        } else {
            let mut t = ProgramTest::default();
            t.prefer_bpf(false);
            t.add_program(
                "light_token_minter",
                program,
                processor!(light_token_minter::process_instruction),
            );
            t
        };
        test.set_compute_max_units(1_400_000);
        test.prefer_bpf(false);
        test.add_program(
            "spl_token",
            spl_token::id(),
            processor!(spl_token::processor::Processor::process),
        );
        let admin = Keypair::new();
        let oracle = Keypair::new();
        let recovery = Keypair::new();
        let attestor = Keypair::new();
        test.add_account(
            admin.pubkey(),
            Account {
                lamports: 10_000_000_000,
                data: vec![],
                owner: system_program::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        let mint = Pubkey::new_unique();
        let id = [0x21; 32];
        let underlying = [0x22; 32];
        let (config, cb) = derive_vault_config_pda(&program);
        let (market, mb) = Pubkey::find_program_address(
            &[CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED, &id],
            &program,
        );
        let (month, ob) = derive_oracle_month_pda(&program, &market, EXPIRY);
        let contract = derive_contract_mint_pda(&program, &market).0;
        let (coverage, cvb) = derive_oracle_sku_coverage_manifest_pda(&program, &month);
        let (recipe, rb) = derive_oracle_recipe_weight_manifest_pda(&program, &month);
        let (active, ab) = derive_oracle_active_weight_manifest_pda(&program, &month);
        let terminal = derive_oracle_settlement_source_manifest_pda(&program, &month).0;
        let (group, gb) = derive_writer_settlement_group_pda(&program, &underlying, EXPIRY, &mint);
        let (sleeve, sb) = derive_writer_sleeve_pda(&program, &group);
        let (book, bb) = derive_writer_series_book_pda(&program, &sleeve);
        let (policy, pb) = derive_writer_policy_snapshot_pda(&program, &sleeve, 1);
        let vault = derive_writer_sleeve_usdc_vault_pda(&program, &sleeve).0;
        let (registry, sgb) = derive_settlement_signer_registry_pda(&program);
        let (signers, ssb) = derive_settlement_signer_set_pda(&program, 1);
        let (record, _) = derive_settlement_v2_pda(&program, &market, &month);
        let (bucket, kb) = derive_oracle_bucket_median_pda(&program, &month, &id);
        let listing = NOW - 100;
        let scramble = listing - ORACLE_PRE_LISTING_WINDOW_SECONDS;
        let rolling = [0x31; 32];
        let recipe_hash = light_token_minter::processor::canonical_recipe_digest(&month, &rolling);
        let active_hash = [0x32; 32];
        test.add_account(
            config,
            owned(
                &VaultConfig {
                    is_initialized: true,
                    bump: cb,
                    admin: admin.pubkey(),
                    oracle_authority: oracle.pubkey(),
                    usdc_mint: mint,
                    vault_token_account: Pubkey::new_unique(),
                    paused: false,
                    account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
                    account_version: VaultConfig::ACCOUNT_VERSION,
                },
                VaultConfig::LEN,
            ),
        );
        let market_state = Market {
            is_initialized: true,
            bump: mb,
            created_by: admin.pubkey(),
            market_id: id,
            collateral_mint: mint,
            long_contract_mint: Some(contract),
            instrument: InstrumentDefinition {
                underlying_id: underlying,
                expiry_ts: EXPIRY,
                strike_price: 100_000_000,
                cap_price: 112_000_000,
                contract_size: 1_000_000,
                max_payout_per_contract: 12_000_000,
                kind: OptionKind::CallSpread,
                settlement: SettlementStyle::CashSettledMonthly,
            },
            params: MarketParameters {
                tick_size: 1,
                lot_size: 1,
                min_order_qty: 1,
                min_cancel_slots: 1,
                max_fills_per_instruction: 1,
            },
            total_position_collateral_locked: 0,
            paused: true,
            mint_accounting: MarketMintAccounting::canonical_empty(),
        };
        test.add_account(market, owned(&market_state, Market::LEN));
        let month_state = OracleMonthState {
            is_initialized: true,
            bump: ob,
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            market,
            authority: Pubkey::new_unique(),
            scramble_start_ts: scramble,
            listing_ts: listing,
            phase: OraclePhase::Game,
            source_count: 3,
            frozen_source_count: 3,
            opened_source_count: 3,
            opening_resolved_source_count: 3,
            recipe_hash,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: rolling,
            active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
            active_weight_group_count: 1,
            active_weight_manifest_hash: active_hash,
            settlement_base_oracle_atomic: 100_000_000,
            settlement_status: OracleSettlementStatus::Provisional,
            ..OracleMonthState::default()
        };
        test.add_account(month, owned(&month_state, OracleMonthState::LEN));
        test.add_account(
            coverage,
            owned(
                &OracleSkuCoverageManifest {
                    is_initialized: true,
                    bump: cvb,
                    account_discriminator: OracleSkuCoverageManifest::ACCOUNT_DISCRIMINATOR,
                    account_version: OracleSkuCoverageManifest::ACCOUNT_VERSION,
                    month,
                    required_sku_root: [0x33; 32],
                    required_sku_count: 1,
                    covered_sku_count: 1,
                    planned_scramble_start_ts: scramble,
                    planned_listing_ts: listing,
                    coverage_finalized: true,
                    coverage_complete_ts: scramble + 1,
                    ..OracleSkuCoverageManifest::default()
                },
                OracleSkuCoverageManifest::LEN,
            ),
        );
        test.add_account(
            recipe,
            owned(
                &OracleRecipeWeightManifest {
                    is_initialized: true,
                    bump: rb,
                    account_discriminator: OracleRecipeWeightManifest::ACCOUNT_DISCRIMINATOR,
                    account_version: OracleRecipeWeightManifest::ACCOUNT_VERSION,
                    month,
                    phase: OracleRecipeWeightPhase::Finalized,
                    expected_source_count: 3,
                    expected_bucket_count: 1,
                    recipe_hash,
                    rolling_manifest_hash: rolling,
                    processed_source_count: 3,
                    processed_bucket_count: 1,
                    declared_weight_total_bps: 10_000,
                    ..OracleRecipeWeightManifest::default()
                },
                OracleRecipeWeightManifest::LEN,
            ),
        );
        test.add_account(
            active,
            owned(
                &OracleActiveWeightManifest {
                    is_initialized: true,
                    bump: ab,
                    account_discriminator: OracleActiveWeightManifest::ACCOUNT_DISCRIMINATOR,
                    account_version: OracleActiveWeightManifest::ACCOUNT_VERSION,
                    month,
                    phase: OracleRecipeWeightPhase::Finalized,
                    expected_source_count: 3,
                    expected_group_count: 1,
                    processed_source_count: 3,
                    processed_group_count: 1,
                    processed_bucket_weight_bps: 10_000,
                    rolling_manifest_hash: active_hash,
                    max_open_interest_payout: 24_000_000,
                    ..OracleActiveWeightManifest::default()
                },
                OracleActiveWeightManifest::LEN,
            ),
        );
        // Median-ready bucket is an explicit prerequisite fixture, not a terminal manifest.
        test.add_account(
            bucket,
            owned(
                &OracleBucketMedianState {
                    is_initialized: true,
                    bump: kb,
                    account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
                    account_version: OracleBucketMedianState::ACCOUNT_VERSION,
                    month,
                    bucket_id: id,
                    group_index: 0,
                    bucket_weight_bps: 10_000,
                    frozen_source_count: 3,
                    active_source_count: 3,
                    eligible_source_count: 3,
                    status: OracleBucketMedianStatus::Live,
                    last_recomputed_ts: 0,
                    source_snapshot_hash: [0; 32],
                    ..OracleBucketMedianState::default()
                },
                OracleBucketMedianState::LEN,
            ),
        );
        let writer_registry = derive_writer_policy_registry_pda(&program).0;
        let payoff = [0x35; 32];
        let family = hashv(&[
            b"ameba-writer-series-family-g3",
            &1u32.to_le_bytes(),
            &id,
            &payoff,
        ])
        .to_bytes();
        let mut book_state = WriterSeriesBookV1 {
            is_initialized: true,
            bump: bb,
            account_discriminator: WriterSeriesBookV1::ACCOUNT_DISCRIMINATOR,
            account_version: WriterSeriesBookV1::ACCOUNT_VERSION,
            sleeve,
            settlement_group: group,
            series_count: 1,
            max_series: WRITER_MAX_LIVE_SERIES as u8,
            frozen: true,
            ..WriterSeriesBookV1::default()
        };
        book_state.records[0] = WriterSeriesRecordV1 {
            active: true,
            series_id: id,
            market,
            contract_mint: contract,
            option_kind: OptionKind::CallSpread,
            strike_price_atomic: 100_000_000,
            cap_or_floor_price_atomic: 112_000_000,
            contract_size_atoms: 1_000_000,
            max_payout_per_contract_atoms: 12_000_000,
            payoff_digest: payoff,
            ..WriterSeriesRecordV1::EMPTY
        };
        test.add_account(book, owned(&book_state, WriterSeriesBookV1::LEN));
        test.add_account(
            group,
            owned(
                &WriterSettlementGroupV1 {
                    is_initialized: true,
                    bump: gb,
                    account_discriminator: WriterSettlementGroupV1::ACCOUNT_DISCRIMINATOR,
                    account_version: WriterSettlementGroupV1::ACCOUNT_VERSION,
                    underlying_id: underlying,
                    expiry_ts: EXPIRY,
                    settlement_ts: EXPIRY,
                    settlement_mint: mint,
                    anchor_market: market,
                    anchor_oracle_month: month,
                    oracle_methodology_version: 1,
                    signer_registry: registry,
                    sleeve,
                    status: WriterSettlementGroupStatus::Anchored,
                    series_count: 1,
                    ..WriterSettlementGroupV1::default()
                },
                WriterSettlementGroupV1::LEN,
            ),
        );
        test.add_account(
            sleeve,
            owned(
                &WriterSleeveV1 {
                    is_initialized: true,
                    bump: sb,
                    account_discriminator: WriterSleeveV1::ACCOUNT_DISCRIMINATOR,
                    account_version: WriterSleeveV1::ACCOUNT_VERSION,
                    vault_config: config,
                    underlying_id: underlying,
                    expiry_ts: EXPIRY,
                    settlement_mint: mint,
                    settlement_group: group,
                    series_book: book,
                    usdc_vault: vault,
                    policy_registry: writer_registry,
                    policy_snapshot: policy,
                    policy_version: 1,
                    policy_hash: [7; 32],
                    scenario_set_hash: [8; 32],
                    risk_limit_hash: [9; 32],
                    writer_principal_atoms: PRINCIPAL,
                    participation_start_ts: NOW,
                    capital_seconds: u128::from(PRINCIPAL) * u128::from(EXPIRY - NOW),
                    maximum_contribution_duration: EXPIRY - NOW,
                    accounted_asset_atoms: PRINCIPAL,
                    series_count: 1,
                    status: WriterSleeveStatus::Funding,
                    security_mode: WriterSecurityMode::GrossExternalMaxPayout,
                    ..WriterSleeveV1::default()
                },
                WriterSleeveV1::LEN,
            ),
        );
        test.add_account(
            policy,
            owned(
                &WriterPolicySnapshotV1 {
                    is_initialized: true,
                    bump: pb,
                    account_discriminator: WriterPolicySnapshotV1::ACCOUNT_DISCRIMINATOR,
                    account_version: WriterPolicySnapshotV1::ACCOUNT_VERSION,
                    registry: writer_registry,
                    sleeve,
                    policy_version: 1,
                    policy_hash: [7; 32],
                    scenario_set_hash: [8; 32],
                    risk_limit_hash: [9; 32],
                    series_family_hash: family,
                    max_series: WRITER_MAX_LIVE_SERIES as u8,
                    drawdown_scale: WRITER_RATIO_SCALE_PPM,
                    worst_drawdown_limit: WRITER_RATIO_SCALE_PPM,
                    upper_drawdown_limit: WRITER_RATIO_SCALE_PPM,
                    lower_drawdown_limit: WRITER_RATIO_SCALE_PPM,
                    lower_tail_max_settlement_atomic: 25_000_000,
                    upper_tail_min_settlement_atomic: 300_000_000,
                    security_mode: WriterSecurityMode::GrossExternalMaxPayout,
                    ..WriterPolicySnapshotV1::default()
                },
                WriterPolicySnapshotV1::LEN,
            ),
        );
        let mut signer_state = SettlementSignerSet {
            is_initialized: true,
            bump: ssb,
            account_discriminator: SettlementSignerSet::ACCOUNT_DISCRIMINATOR,
            account_version: SettlementSignerSet::ACCOUNT_VERSION,
            registry,
            version: 1,
            threshold: 1,
            signer_count: 1,
            rotation_delay_slots: MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
            proposer: Pubkey::new_unique(),
            ..SettlementSignerSet::default()
        };
        signer_state.signers[0] = attestor.pubkey();
        signer_state.set_hash = signer_state.compute_set_hash();
        test.add_account(signers, owned(&signer_state, SettlementSignerSet::LEN));
        test.add_account(
            registry,
            owned(
                &SettlementSignerRegistry {
                    is_initialized: true,
                    bump: sgb,
                    account_discriminator: SettlementSignerRegistry::ACCOUNT_DISCRIMINATOR,
                    account_version: SettlementSignerRegistry::ACCOUNT_VERSION,
                    current_set: signers,
                    current_version: 1,
                    recovery_authority: recovery.pubkey(),
                    ..SettlementSignerRegistry::default()
                },
                SettlementSignerRegistry::LEN,
            ),
        );
        let mut data = vec![0; Mint::LEN];
        Mint::pack(
            Mint {
                mint_authority: COption::Some(market),
                supply: 0,
                decimals: 6,
                is_initialized: true,
                freeze_authority: COption::None,
            },
            &mut data,
        )
        .unwrap();
        test.add_account(
            contract,
            Account {
                lamports: 10_000_000,
                data,
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        let mut data = vec![0; TokenAccount::LEN];
        TokenAccount::pack(
            TokenAccount {
                mint,
                owner: sleeve,
                amount: PRINCIPAL,
                state: AccountState::Initialized,
                ..TokenAccount::default()
            },
            &mut data,
        )
        .unwrap();
        test.add_account(
            vault,
            Account {
                lamports: 10_000_000,
                data,
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        let (gate, bump) = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &program);
        let mut data = vec![0; PROTOCOL_GATE_LEN];
        data[..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
        data[8] = 1;
        data[9] = bump;
        data[10] = 1;
        data[12..44].copy_from_slice(PINNED_CONTROLLER_CONFIG_PDA.as_ref());
        data[44..76].copy_from_slice(program.as_ref());
        data[76..108].copy_from_slice(derive_target_programdata_pda(&program).as_ref());
        data[108..116].copy_from_slice(&6u64.to_le_bytes());
        test.add_account(
            gate,
            Account {
                lamports: 10_000_000,
                data,
                owner: PINNED_CONTROLLER_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        );
        if prefund {
            test.add_account(
                terminal,
                Account {
                    lamports: 1_000_000,
                    data: vec![],
                    owner: system_program::id(),
                    executable: false,
                    rent_epoch: 0,
                },
            );
        }
        let mut ctx = test.start_with_context().await;
        set_time(&mut ctx, NOW);
        Self {
            ctx,
            admin,
            oracle,
            recovery,
            attestor,
            gate,
            config,
            market,
            month,
            coverage,
            recipe,
            active,
            terminal,
            bucket,
            group,
            sleeve,
            book,
            policy,
            vault,
            registry,
            signers,
            record,
        }
    }
    fn ix(&self, tag: u8, keys: &[Pubkey], writable: &[usize], payload: &[u8]) -> Instruction {
        let mut data = vec![tag];
        data.extend_from_slice(payload);
        if light_token_minter::business_generation::requires_generation(tag) {
            data.extend_from_slice(
                light_token_minter::business_generation::BUSINESS_MESSAGE_SUFFIX,
            );
        }
        data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(6).encode());
        let mut accounts: Vec<_> = keys
            .iter()
            .enumerate()
            .map(|(i, k)| {
                if writable.contains(&i) {
                    AccountMeta::new(*k, i == 0)
                } else {
                    AccountMeta::new_readonly(*k, i == 0)
                }
            })
            .collect();
        accounts.push(AccountMeta::new_readonly(self.gate, false));
        Instruction {
            program_id: light_token_minter::id(),
            accounts,
            data,
        }
    }
    fn activate(&self) -> Instruction {
        self.ix(
            229,
            &[
                self.admin.pubkey(),
                self.config,
                self.sleeve,
                self.group,
                self.book,
                self.policy,
                self.market,
                self.month,
                self.coverage,
                self.active,
                self.recipe,
                self.terminal,
                self.registry,
                self.signers,
                self.vault,
            ],
            &[2, 3],
            &[],
        )
    }
    fn publish(&self) -> Instruction {
        self.ix(
            244,
            &[
                self.admin.pubkey(),
                self.config,
                self.sleeve,
                self.group,
                self.market,
                self.month,
                self.record,
                self.coverage,
                self.recipe,
                self.terminal,
                self.active,
                self.registry,
                self.signers,
            ],
            &[2, 3],
            &[],
        )
    }
    fn collect(&self) -> Instruction {
        let mut payload = vec![0x21; 32];
        payload.push(1);
        self.ix(
            113,
            &[
                self.admin.pubkey(),
                self.market,
                self.month,
                self.terminal,
                system_program::id(),
                self.bucket,
            ],
            &[0, 3],
            &payload,
        )
    }
    fn finalize_month(&self) -> Instruction {
        self.ix(
            75,
            &[self.admin.pubkey(), self.market, self.month, self.bucket],
            &[2],
            &[],
        )
    }
    async fn send(&mut self, ix: Instruction, ok: bool) {
        let tag = ix.data[0];
        let account_count = ix.accounts.len();
        let bh = self.ctx.get_new_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.ctx.payer.pubkey()),
            &[&self.ctx.payer, &self.admin],
            bh,
        );
        let packet = bincode::serialize(&tx).unwrap().len();
        assert!(packet <= 1232);
        let r = self
            .ctx
            .banks_client
            .process_transaction_with_metadata(tx)
            .await
            .unwrap();
        if let Some(metadata) = &r.metadata {
            println!(
                "writer_terminal tag={tag} accounts={account_count} packet={packet} compute={} result={:?}",
                metadata.compute_units_consumed, r.result
            );
        }
        assert_eq!(r.result.is_ok(), ok, "{r:?}");
    }
}

#[tokio::test]
async fn fresh_activation_defers_real_terminal_digest_and_publication_binds_once() {
    for prefund in [false, true] {
        let mut f = Fixture::start(prefund).await;
        let untouched = f
            .ctx
            .banks_client
            .get_account(f.group)
            .await
            .unwrap()
            .unwrap();
        let mut wrong = f.activate();
        wrong.accounts[11].pubkey = Pubkey::new_unique();
        f.send(wrong, false).await;
        let clean = Account {
            lamports: 1_000_000,
            data: vec![],
            owner: system_program::id(),
            executable: false,
            rent_epoch: 0,
        };
        for (owner, data) in [
            (Pubkey::new_unique(), vec![]),
            (system_program::id(), vec![1]),
            (light_token_minter::id(), vec![0; 128]),
        ] {
            f.ctx.set_account(
                &f.terminal,
                &AccountSharedData::from(Account {
                    owner,
                    data,
                    ..clean.clone()
                }),
            );
            f.send(f.activate(), false).await;
            assert_eq!(
                f.ctx
                    .banks_client
                    .get_account(f.group)
                    .await
                    .unwrap()
                    .unwrap(),
                untouched
            );
        }
        // Restore an absent or prefunded zero-data account, never a terminal fixture.
        f.ctx.set_account(
            &f.terminal,
            &AccountSharedData::from(Account {
                lamports: if prefund { 1_000_000 } else { 0 },
                ..clean
            }),
        );
        f.send(f.collect(), false).await;
        f.send(f.finalize_month(), false).await;
        f.send(f.activate(), true).await;
        let active: WriterSettlementGroupV1 = state(&mut f.ctx, f.group).await;
        assert_eq!(active.status, WriterSettlementGroupStatus::Active);
        assert_eq!(active.settlement_source_digest, [0; 32]);
        assert_eq!(active.security_cap_atoms, 24_000_000);
        let active_hash = group_hash(&f.group, &active);
        let sleeve: WriterSleeveV1 = state(&mut f.ctx, f.sleeve).await;
        assert_eq!(sleeve.writer_principal_atoms, PRINCIPAL);
        assert_eq!(sleeve.accounted_asset_atoms, PRINCIPAL);
        assert_eq!(sleeve.exact_reserve_atoms, 0);
        f.send(f.activate(), false).await;
        f.send(f.publish(), false).await;
        assert_eq!(
            group_hash(&f.group, &state(&mut f.ctx, f.group).await),
            active_hash
        );
        set_time(&mut f.ctx, EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS - 1);
        f.send(f.finalize_month(), false).await;
        set_time(&mut f.ctx, EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS);
        // Explicit median-readiness fixture after the terminal time boundary.
        let mut bucket: OracleBucketMedianState = state(&mut f.ctx, f.bucket).await;
        bucket.status = OracleBucketMedianStatus::SettlementReady;
        bucket.last_recomputed_ts = EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS;
        bucket.source_snapshot_hash = [0x34; 32];
        f.ctx.set_account(
            &f.bucket,
            &AccountSharedData::from(owned(&bucket, OracleBucketMedianState::LEN)),
        );
        f.send(f.finalize_month(), true).await;
        f.send(f.collect(), true).await;
        let terminal: OracleSettlementSourceManifest = state(&mut f.ctx, f.terminal).await;
        assert_eq!(terminal.phase, OracleRecipeWeightPhase::Finalized);
        assert_ne!(terminal.rolling_source_digest, [0; 32]);
        f.send(f.collect(), false).await;
        // Explicit upstream boundary fixture: tag116's verified immutable record
        // and its month binding; signature verification is not claimed by this test.
        let program = light_token_minter::id();
        let (_, bump) = derive_settlement_v2_pda(&program, &f.market, &f.month);
        let record = SettlementRecordV2 {
            is_initialized: true,
            bump,
            account_discriminator: SettlementRecordV2::ACCOUNT_DISCRIMINATOR,
            account_version: SettlementRecordV2::ACCOUNT_VERSION,
            market: f.market,
            oracle_month: f.month,
            settlement_ts: EXPIRY,
            settlement_price_atomic: 105_000_000,
            signed_leaf_commitment: [0x42; 32],
            submitted_by: f.admin.pubkey(),
            signer_set_version: 1,
        };
        put(&mut f.ctx, f.record, &record, SettlementRecordV2::LEN);
        let mut month: OracleMonthState = state(&mut f.ctx, f.month).await;
        month.phase = OraclePhase::Settled;
        month.settlement_record = Some(f.record);
        put(&mut f.ctx, f.month, &month, OracleMonthState::LEN);
        let mut corrupted = terminal.clone();
        corrupted.processed_source_count = 0;
        put(
            &mut f.ctx,
            f.terminal,
            &corrupted,
            OracleSettlementSourceManifest::LEN,
        );
        f.send(f.publish(), false).await;
        put(
            &mut f.ctx,
            f.terminal,
            &terminal,
            OracleSettlementSourceManifest::LEN,
        );
        f.send(f.publish(), true).await;
        let settled: WriterSettlementGroupV1 = state(&mut f.ctx, f.group).await;
        assert_eq!(
            settled.settlement_source_digest,
            terminal.rolling_source_digest
        );
        assert_eq!(settled.status, WriterSettlementGroupStatus::Settled);
        let commitment = hashv(&[
            b"ameba-writer-final-settlement-g3",
            program.as_ref(),
            f.group.as_ref(),
            &group_hash(&f.group, &settled),
            f.record.as_ref(),
            &record.signed_leaf_commitment,
            &record.settlement_ts.to_le_bytes(),
            &record.settlement_price_atomic.to_le_bytes(),
            &record.signer_set_version.to_le_bytes(),
            record.submitted_by.as_ref(),
        ])
        .to_bytes();
        assert_eq!(settled.final_settlement_commitment, commitment);
        assert_ne!(group_hash(&f.group, &settled), active_hash);
        let final_bytes = f
            .ctx
            .banks_client
            .get_account(f.group)
            .await
            .unwrap()
            .unwrap();
        f.send(f.publish(), false).await;
        assert_eq!(
            f.ctx
                .banks_client
                .get_account(f.group)
                .await
                .unwrap()
                .unwrap(),
            final_bytes
        );
        let after: WriterSleeveV1 = state(&mut f.ctx, f.sleeve).await;
        assert_eq!(after.status, WriterSleeveStatus::Expired);
        assert_eq!(after.writer_principal_atoms, sleeve.writer_principal_atoms);
        assert_eq!(after.accounted_asset_atoms, sleeve.accounted_asset_atoms);
        assert_eq!(after.exact_reserve_atoms, sleeve.exact_reserve_atoms);
    }
}

fn derive_vault_config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED], program_id)
}

fn derive_contract_mint_pda(program_id: &Pubkey, market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            CONTRACT_MINT_PDA_SEED,
            market.as_ref(),
        ],
        program_id,
    )
}

fn derive_writer_policy_registry_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_POLICY_REGISTRY_PDA_SEED,
        ],
        program_id,
    )
}

fn derive_writer_settlement_group_pda(
    program_id: &Pubkey,
    underlying_id: &[u8; 32],
    expiry_ts: u64,
    settlement_mint: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_SETTLEMENT_GROUP_PDA_SEED,
            underlying_id,
            &expiry_ts.to_le_bytes(),
            settlement_mint.as_ref(),
        ],
        program_id,
    )
}

fn derive_writer_sleeve_pda(program_id: &Pubkey, group: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_SLEEVE_PDA_SEED,
            group.as_ref(),
        ],
        program_id,
    )
}

fn derive_writer_series_book_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_SERIES_BOOK_PDA_SEED,
            sleeve.as_ref(),
        ],
        program_id,
    )
}

fn derive_writer_policy_snapshot_pda(
    program_id: &Pubkey,
    sleeve: &Pubkey,
    policy_version: u64,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_POLICY_SNAPSHOT_PDA_SEED,
            sleeve.as_ref(),
            &policy_version.to_le_bytes(),
        ],
        program_id,
    )
}

fn derive_writer_sleeve_usdc_vault_pda(program_id: &Pubkey, sleeve: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            WRITER_SLEEVE_USDC_VAULT_PDA_SEED,
            sleeve.as_ref(),
        ],
        program_id,
    )
}

fn derive_oracle_month_pda(program_id: &Pubkey, market: &Pubkey, expiry_ts: u64) -> (Pubkey, u8) {
    let expiry_seed = expiry_ts.to_le_bytes();
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry_seed,
        ],
        program_id,
    )
}

fn derive_settlement_v2_pda(
    program_id: &Pubkey,
    market: &Pubkey,
    oracle_month: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            SETTLEMENT_V2_PDA_SEED,
            market.as_ref(),
            oracle_month.as_ref(),
        ],
        program_id,
    )
}
