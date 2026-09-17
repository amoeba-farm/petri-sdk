use borsh::{BorshDeserialize, BorshSerialize};
use light_token_minter::{
    constants::{CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED, ORACLE_MONTH_PDA_SEED},
    instruction::{AccumulateOracleSettlementSourceBucketParams, VaultInstruction},
    processor::{
        advance_oracle_settlement_source_digest, canonical_recipe_digest,
        initial_oracle_settlement_source_digest, process_instruction,
    },
    state::{
        derive_oracle_bucket_median_pda, derive_oracle_settlement_source_manifest_pda,
        InstrumentDefinition, Market, MarketMintAccounting, MarketParameters, OptionKind,
        OracleBucketMedianState, OracleBucketMedianStatus, OracleMonthState, OraclePhase,
        OracleRecipeWeightPhase, OracleSettlementSourceManifest, OracleSettlementStatus,
        SettlementStyle,
    },
};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Signer,
    transaction::Transaction,
};

const MARKET_ID: [u8; 32] = [0x71; 32];
const EXPIRY_TS: u64 = 4_100_000_000;
const BUCKET_A: [u8; 32] = [0x44; 32];
const BUCKET_B: [u8; 32] = [0x55; 32];

struct ManifestFixture {
    context: ProgramTestContext,
    market: Pubkey,
    month: Pubkey,
    source_manifest: Pubkey,
    buckets: [(Pubkey, OracleBucketMedianState); 2],
    canonical_source_digest: [u8; 32],
}

impl ManifestFixture {
    async fn start() -> Self {
        let program_id = light_token_minter::id();
        let (market, market_bump) = Pubkey::find_program_address(
            &[CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED, &MARKET_ID],
            &program_id,
        );
        let (month, month_bump) = Pubkey::find_program_address(
            &[
                CURRENT_STATE_NAMESPACE_SEED,
                ORACLE_MONTH_PDA_SEED,
                market.as_ref(),
                &EXPIRY_TS.to_le_bytes(),
            ],
            &program_id,
        );
        let (source_manifest, _) =
            derive_oracle_settlement_source_manifest_pda(&program_id, &month);

        let frozen_manifest_hash = [0x55; 32];
        let recipe_hash = canonical_recipe_digest(&month, &frozen_manifest_hash);
        let active_manifest_hash = [0x66; 32];
        let market_state = Market {
            is_initialized: true,
            bump: market_bump,
            created_by: Pubkey::new_unique(),
            market_id: MARKET_ID,
            collateral_mint: Pubkey::new_unique(),
            long_contract_mint: None,
            instrument: InstrumentDefinition {
                underlying_id: [0x51; 32],
                expiry_ts: EXPIRY_TS,
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
            paused: false,
            mint_accounting: MarketMintAccounting::canonical_empty(),
        };
        let month_state = OracleMonthState {
            is_initialized: true,
            bump: month_bump,
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            market,
            authority: Pubkey::new_unique(),
            scramble_start_ts: 1,
            listing_ts: 2,
            phase: OraclePhase::Game,
            source_count: 3,
            frozen_source_count: 3,
            opened_source_count: 2,
            recipe_hash,
            settlement_status: OracleSettlementStatus::Final,
            pending_resolution_count: 0,
            finalized_at_ts: 1,
            opening_resolved_source_count: 3,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: frozen_manifest_hash,
            active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
            active_weight_group_count: 2,
            active_weight_manifest_hash: active_manifest_hash,
            ..OracleMonthState::default()
        };
        let buckets = [
            bucket_state(&program_id, month, BUCKET_A, 0, 0, 4_000, 1),
            bucket_state(&program_id, month, BUCKET_B, 1, 4_000, 6_000, 2),
        ];
        let mut canonical_source_digest = initial_oracle_settlement_source_digest(
            &month,
            &recipe_hash,
            &active_manifest_hash,
            3,
            2,
        );
        for (_, bucket) in &buckets {
            canonical_source_digest =
                advance_oracle_settlement_source_digest(&canonical_source_digest, bucket);
        }

        let mut program_test = ProgramTest::new(
            "light_token_minter",
            program_id,
            processor!(process_instruction),
        );
        program_test.prefer_bpf(false);
        add_borsh_account(&mut program_test, market, &market_state, Market::LEN);
        add_borsh_account(
            &mut program_test,
            month,
            &month_state,
            OracleMonthState::LEN,
        );
        for (address, bucket) in &buckets {
            add_borsh_account(
                &mut program_test,
                *address,
                bucket,
                OracleBucketMedianState::LEN,
            );
        }

        Self {
            context: program_test.start_with_context().await,
            market,
            month,
            source_manifest,
            buckets,
            canonical_source_digest,
        }
    }

    fn accumulate_ix(&self, bucket_indexes: &[usize], finalize_collection: bool) -> Instruction {
        let first_bucket = self.buckets[bucket_indexes[0]].1.bucket_id;
        let mut accounts = vec![
            AccountMeta::new(self.context.payer.pubkey(), true),
            AccountMeta::new_readonly(self.market, false),
            AccountMeta::new_readonly(self.month, false),
            AccountMeta::new(self.source_manifest, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ];
        accounts.extend(
            bucket_indexes
                .iter()
                .map(|index| AccountMeta::new_readonly(self.buckets[*index].0, false)),
        );
        Instruction {
            program_id: light_token_minter::id(),
            accounts,
            data: borsh::to_vec(&VaultInstruction::AccumulateOracleSettlementSourceBucket {
                params: AccumulateOracleSettlementSourceBucketParams {
                    bucket_id: first_bucket,
                    finalize_collection,
                },
            })
            .unwrap()
            .into_iter()
            .chain(*light_token_minter::business_generation::BUSINESS_MESSAGE_SUFFIX)
            .collect(),
        }
    }

    async fn send(&mut self, instruction: Instruction) -> Result<(), BanksClientError> {
        let blockhash = self
            .context
            .banks_client
            .get_latest_blockhash()
            .await
            .unwrap();
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&self.context.payer.pubkey()),
            &[&self.context.payer],
            blockhash,
        );
        self.context
            .banks_client
            .process_transaction(transaction)
            .await
    }

    async fn manifest(&mut self) -> Option<OracleSettlementSourceManifest> {
        self.context
            .banks_client
            .get_account(self.source_manifest)
            .await
            .unwrap()
            .map(|account| {
                OracleSettlementSourceManifest::deserialize(&mut &account.data[..]).unwrap()
            })
    }
}

fn bucket_state(
    program_id: &Pubkey,
    month: Pubkey,
    bucket_id: [u8; 32],
    group_index: u16,
    bucket_weight_start_bps: u16,
    bucket_weight_bps: u16,
    source_count: u16,
) -> (Pubkey, OracleBucketMedianState) {
    let (address, bump) = derive_oracle_bucket_median_pda(program_id, &month, &bucket_id);
    (
        address,
        OracleBucketMedianState {
            is_initialized: true,
            bump,
            account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketMedianState::ACCOUNT_VERSION,
            month,
            bucket_id,
            group_index,
            bucket_weight_start_bps,
            bucket_weight_bps,
            frozen_source_count: source_count,
            active_source_count: source_count,
            eligible_source_count: source_count,
            status: OracleBucketMedianStatus::SettlementReady,
            bucket_delta_bps: i64::from(group_index) + 7,
            last_recomputed_ts: 3,
            source_snapshot_hash: [bucket_id[0].wrapping_add(1); 32],
            ..OracleBucketMedianState::default()
        },
    )
}

fn add_borsh_account<T: BorshSerialize>(
    program_test: &mut ProgramTest,
    address: Pubkey,
    value: &T,
    len: usize,
) {
    let mut data = borsh::to_vec(value).unwrap();
    data.resize(len, 0);
    program_test.add_account(
        address,
        Account {
            lamports: 10_000_000,
            data,
            owner: light_token_minter::id(),
            executable: false,
            rent_epoch: 0,
        },
    );
}

#[tokio::test]
async fn canonical_bucket_walk_creates_and_finalizes_the_source_manifest() {
    let mut fixture = ManifestFixture::start().await;
    fixture
        .send(fixture.accumulate_ix(&[0, 1], true))
        .await
        .unwrap();
    let finalized = fixture.manifest().await.unwrap();
    assert_eq!(finalized.phase, OracleRecipeWeightPhase::Finalized);
    assert_eq!(finalized.processed_source_count, 3);
    assert_eq!(finalized.processed_bucket_count, 2);
    assert_eq!(finalized.declared_weight_total_bps, 10_000);
    assert_eq!(
        finalized.rolling_source_digest,
        fixture.canonical_source_digest
    );
}

#[tokio::test]
async fn source_manifest_rejects_reordered_or_incomplete_bucket_walks_atomically() {
    let mut reordered = ManifestFixture::start().await;
    assert!(reordered
        .send(reordered.accumulate_ix(&[1, 0], true))
        .await
        .is_err());
    assert!(reordered.manifest().await.is_none());

    let mut incomplete = ManifestFixture::start().await;
    assert!(incomplete
        .send(incomplete.accumulate_ix(&[0], true))
        .await
        .is_err());
    assert!(incomplete.manifest().await.is_none());
}
