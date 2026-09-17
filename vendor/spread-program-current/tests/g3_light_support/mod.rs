use borsh::{BorshDeserialize, BorshSerialize};
use light_program_test::{LightProgramTest, ProgramTestConfig, Rpc};
use light_token::instruction::{
    derive_token_ata, CreateAssociatedTokenAccount, CreateTokenAccount, TransferFromSpl,
    LIGHT_TOKEN_PROGRAM_ID,
};
use light_token::spl_interface::{get_spl_interface_pda_and_bump, CreateSplInterfacePda};
use light_token_minter::{
    ameba_dlmm_state::*,
    constants::*,
    dlmm_order_state::{derive_order_book, DlmmOrderAction},
    governance_gate::*,
    instruction::VaultInstruction,
    state::*,
};
use solana_program::{program_pack::Pack, pubkey::Pubkey};
pub use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::{
    account::Account,
    address_lookup_table::{
        state::{AddressLookupTable, LookupTableMeta},
        AddressLookupTableAccount,
    },
    instruction::{AccountMeta, Instruction},
    message::{v0, VersionedMessage},
    transaction::{Transaction, VersionedTransaction},
};
use solana_system_interface::{instruction as system_instruction, program as system_program};
pub const UNIT: u64 = 1_000_000;
pub fn program() -> Pubkey {
    light_token_minter::id()
}
pub fn pda(seeds: &[&[u8]]) -> (Pubkey, u8) {
    let mut s = vec![CURRENT_STATE_NAMESPACE_SEED];
    s.extend_from_slice(seeds);
    Pubkey::find_program_address(&s, &program())
}
pub fn account(owner: Pubkey, data: Vec<u8>) -> Account {
    Account {
        lamports: 100_000_000,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}
pub fn install<T: BorshSerialize>(rpc: &mut LightProgramTest, key: Pubkey, v: &T, len: usize) {
    let mut bytes = v.try_to_vec().unwrap();
    assert!(bytes.len() <= len);
    bytes.resize(len, 0);
    rpc.context
        .set_account(key, account(program(), bytes))
        .unwrap();
}
pub fn govern(mut accounts: Vec<AccountMeta>, instruction: VaultInstruction) -> Instruction {
    let mut data = instruction.try_to_vec().unwrap();
    if light_token_minter::business_generation::requires_generation(data[0]) {
        data.extend_from_slice(b"AMG3");
    }
    data.extend_from_slice(&GovernanceInstructionTailV1::for_epoch(1).encode());
    accounts.push(AccountMeta::new_readonly(PINNED_PROTOCOL_GATE_PDA, false));
    Instruction {
        program_id: program(),
        accounts,
        data,
    }
}
pub async fn start() -> LightProgramTest {
    let path =
        std::path::Path::new(&std::env::var("SBF_OUT_DIR").unwrap()).join("light_token_minter.so");
    let bytes = std::fs::read(path).unwrap();
    let hash = solana_program::hash::hash(&bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    assert_eq!(hash, std::env::var("AMEBA_TESTED_SBF_SHA256").unwrap());
    #[cfg(not(feature = "mainnet-v3"))]
    let marker = "AMEBA_SPREAD_DEVNET_V3:";
    #[cfg(feature = "mainnet-v3")]
    let marker = light_token_minter::MAINNET_PROFILE_RELEASE_MARKER;
    assert!(bytes.windows(marker.len()).any(|s| s == marker.as_bytes()));
    println!("g3_focused artifact_sha256={hash}");
    let mut rpc = LightProgramTest::new(ProgramTestConfig::new_v2(
        false,
        Some(vec![("light_token_minter", program())]),
    ))
    .await
    .unwrap();
    let mut gate = vec![0; PROTOCOL_GATE_LEN];
    gate[..8].copy_from_slice(&PROTOCOL_GATE_DISCRIMINATOR);
    gate[8] = PROTOCOL_GATE_VERSION_V1;
    gate[9] = derive_protocol_gate_pda(&PINNED_CONTROLLER_PROGRAM_ID, &program()).1;
    gate[10] = 1;
    gate[11] = GateStatusV1::Active as u8;
    gate[12..44].copy_from_slice(PINNED_CONTROLLER_CONFIG_PDA.as_ref());
    gate[44..76].copy_from_slice(program().as_ref());
    gate[76..108].copy_from_slice(derive_target_programdata_pda(&program()).as_ref());
    gate[108..116].copy_from_slice(&1u64.to_le_bytes());
    rpc.context
        .set_account(
            PINNED_PROTOCOL_GATE_PDA,
            account(PINNED_CONTROLLER_PROGRAM_ID, gate),
        )
        .unwrap();
    rpc
}
pub async fn setup_tx(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    ixs: &[Instruction],
    extra: &[&Keypair],
) {
    let mut signers = vec![payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        &signers,
        rpc.context.latest_blockhash(),
    );
    let result = rpc.context.send_transaction(tx);
    assert!(result.is_ok(), "setup: {result:?}");
    rpc.context.expire_blockhash();
}
pub async fn mint(rpc: &mut LightProgramTest, payer: &Keypair) -> Pubkey {
    let mint = Keypair::new();
    setup_tx(
        rpc,
        payer,
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &mint.pubkey(),
                2_000_000,
                82,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_mint2(
                &spl_token::id(),
                &mint.pubkey(),
                &payer.pubkey(),
                None,
                6,
            )
            .unwrap(),
            CreateSplInterfacePda::new(payer.pubkey(), mint.pubkey(), spl_token::id(), false)
                .instruction(),
        ],
        &[&mint],
    )
    .await;
    mint.pubkey()
}
pub async fn light_ata(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    owner: Pubkey,
    mint: Pubkey,
) -> Pubkey {
    let key = derive_token_ata(&owner, &mint);
    setup_tx(
        rpc,
        payer,
        &[
            CreateAssociatedTokenAccount::new(payer.pubkey(), owner, mint)
                .instruction()
                .unwrap(),
        ],
        &[],
    )
    .await;
    key
}
// Unrelated pre-existing pool custody is a fixture. Its zero-balance canonical
// token layout is created by the real Light program; all later transfers execute.
pub async fn empty_pool_vault(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    owner: Pubkey,
    mint: Pubkey,
    key: Pubkey,
) {
    let temp = Keypair::new();
    setup_tx(
        rpc,
        payer,
        &[
            CreateTokenAccount::new(payer.pubkey(), temp.pubkey(), mint, owner)
                .instruction()
                .unwrap(),
        ],
        &[&temp],
    )
    .await;
    let bytes = rpc.context.get_account(&temp.pubkey()).unwrap();
    rpc.context.set_account(key, bytes).unwrap();
}
pub async fn fund(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    owner: Pubkey,
    mint: Pubkey,
    amount: u64,
) {
    let source = Keypair::new();
    let destination = light_ata(rpc, payer, owner, mint).await;
    setup_tx(
        rpc,
        payer,
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &source.pubkey(),
                3_000_000,
                165,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_account3(
                &spl_token::id(),
                &source.pubkey(),
                &mint,
                &payer.pubkey(),
            )
            .unwrap(),
            spl_token::instruction::mint_to(
                &spl_token::id(),
                &mint,
                &source.pubkey(),
                &payer.pubkey(),
                &[],
                amount,
            )
            .unwrap(),
        ],
        &[&source],
    )
    .await;
    let (interface, bump) = get_spl_interface_pda_and_bump(&mint);
    setup_tx(
        rpc,
        payer,
        &[TransferFromSpl {
            amount,
            spl_interface_pda_bump: bump,
            decimals: 6,
            source_spl_token_account: source.pubkey(),
            destination,
            authority: payer.pubkey(),
            mint,
            payer: payer.pubkey(),
            spl_interface_pda: interface,
            spl_token_program: spl_token::id(),
        }
        .instruction()
        .unwrap()],
        &[],
    )
    .await;
}
pub struct MarketFixture {
    pub rpc: LightProgramTest,
    pub payer: Keypair,
    pub other: Keypair,
    pub config: Pubkey,
    pub market: Pubkey,
    pub month: Pubkey,
    pub sleeve: Pubkey,
    pub group: Pubkey,
    pub book: Pubkey,
    pub pool: Pubkey,
    pub option: Pubkey,
    pub quote: Pubkey,
    pub authority: Pubkey,
    pub option_vault: Pubkey,
    pub quote_vault: Pubkey,
    pub order_book: Pubkey,
    pub order_option: Pubkey,
    pub order_quote: Pubkey,
    pub expiry: u64,
}
impl MarketFixture {
    pub async fn new() -> Self {
        Self::new_base(false).await
    }
    pub async fn new_base(writer: bool) -> Self {
        let mut rpc = start().await;
        let payer = rpc.get_payer().insecure_clone();
        let other = Keypair::new();
        rpc.context
            .set_account(other.pubkey(), account(system_program::id(), vec![]))
            .unwrap();
        let quote = mint(&mut rpc, &payer).await;
        let mut clock = rpc.context.get_sysvar::<solana_sdk::clock::Clock>();
        clock.unix_timestamp = 1_800_000_000;
        clock.slot = 100;
        rpc.context.set_sysvar(&clock);
        let now = clock.unix_timestamp as u64;
        let expiry = now + 86400;
        let id = [11; 32];
        let underlying = [12; 32];
        let (market, mb) = pda(&[MARKET_PDA_SEED, &id]);
        let (month, ob) = pda(&[
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry.to_le_bytes(),
        ]);
        let (group, gb) = pda(&[
            WRITER_SETTLEMENT_GROUP_PDA_SEED,
            &underlying,
            &expiry.to_le_bytes(),
            quote.as_ref(),
        ]);
        let (sleeve, sb) = pda(&[WRITER_SLEEVE_PDA_SEED, group.as_ref()]);
        let (book, bb) = pda(&[WRITER_SERIES_BOOK_PDA_SEED, sleeve.as_ref()]);
        let (config, cb) = pda(&[VAULT_PDA_SEED]);
        let (pool, pb) = derive_ameba_dlmm_pool_pda(&program(), &market);
        let authority = derive_ameba_dlmm_authority_pda(&program(), &pool).0;
        let option = if writer {
            let key = pda(&[CONTRACT_MINT_PDA_SEED, market.as_ref()]).0;
            let m = spl_token::state::Mint {
                mint_authority: solana_program::program_option::COption::Some(market),
                supply: 0,
                decimals: 6,
                is_initialized: true,
                freeze_authority: solana_program::program_option::COption::None,
            };
            let mut bytes = vec![0; 82];
            spl_token::state::Mint::pack(m, &mut bytes).unwrap();
            rpc.context
                .set_account(key, account(spl_token::id(), bytes))
                .unwrap();
            setup_tx(
                &mut rpc,
                &payer,
                &[
                    CreateSplInterfacePda::new(payer.pubkey(), key, spl_token::id(), false)
                        .instruction(),
                ],
                &[],
            )
            .await;
            key
        } else {
            mint(&mut rpc, &payer).await
        };
        let option_vault = derive_ameba_dlmm_vault_pda(&program(), &pool, &option).0;
        let quote_vault = derive_ameba_dlmm_vault_pda(&program(), &pool, &quote).0;
        for owner in [payer.pubkey(), other.pubkey()] {
            if writer {
                light_ata(&mut rpc, &payer, owner, option).await;
            } else {
                fund(&mut rpc, &payer, owner, option, 10 * UNIT).await;
            }
            fund(&mut rpc, &payer, owner, quote, 100 * UNIT).await;
        }
        empty_pool_vault(&mut rpc, &payer, authority, option, option_vault).await;
        empty_pool_vault(&mut rpc, &payer, authority, quote, quote_vault).await;
        install(
            &mut rpc,
            config,
            &VaultConfig {
                is_initialized: true,
                bump: cb,
                admin: payer.pubkey(),
                oracle_authority: other.pubkey(),
                usdc_mint: quote,
                vault_token_account: Pubkey::new_unique(),
                paused: false,
                account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
                account_version: VaultConfig::ACCOUNT_VERSION,
            },
            VaultConfig::LEN,
        );
        let instrument = InstrumentDefinition {
            underlying_id: underlying,
            expiry_ts: expiry,
            strike_price: 100 * UNIT,
            cap_price: 112 * UNIT,
            contract_size: UNIT,
            max_payout_per_contract: 12 * UNIT,
            kind: OptionKind::CallSpread,
            ..Default::default()
        };
        install(
            &mut rpc,
            market,
            &Market {
                is_initialized: true,
                bump: mb,
                created_by: payer.pubkey(),
                market_id: id,
                paused: false,
                collateral_mint: quote,
                long_contract_mint: Some(option),
                instrument,
                params: MarketParameters {
                    tick_size: 50_000,
                    lot_size: 1,
                    min_order_qty: 1,
                    max_fills_per_instruction: 8,
                    ..Default::default()
                },
                mint_accounting: MarketMintAccounting {
                    total_issued: if writer { 0 } else { 20 * UNIT },
                    ..MarketMintAccounting::canonical_empty()
                },
                ..Default::default()
            },
            Market::LEN,
        );
        install(
            &mut rpc,
            month,
            &OracleMonthState {
                is_initialized: true,
                bump: ob,
                market,
                phase: OraclePhase::Game,
                scramble_start_ts: now - ORACLE_PRE_LISTING_WINDOW_SECONDS - 100,
                listing_ts: now - 100,
                account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
                account_version: 1,
                candidate_count_tracking_version: 1,
                active_weight_initialization_version: 1,
                schedule_version: 2,
                work_reward_currency_version: 1,
                ..Default::default()
            },
            OracleMonthState::LEN,
        );
        install(
            &mut rpc,
            group,
            &WriterSettlementGroupV1 {
                is_initialized: true,
                bump: gb,
                account_discriminator: WriterSettlementGroupV1::ACCOUNT_DISCRIMINATOR,
                account_version: WriterSettlementGroupV1::ACCOUNT_VERSION,
                underlying_id: underlying,
                expiry_ts: expiry,
                settlement_mint: quote,
                anchor_market: market,
                anchor_oracle_month: month,
                signer_registry: Pubkey::new_unique(),
                sleeve,
                settlement_ts: expiry,
                security_cap_atoms: 1200 * UNIT,
                series_count: 1,
                status: WriterSettlementGroupStatus::Active,
                ..Default::default()
            },
            WriterSettlementGroupV1::LEN,
        );
        install(
            &mut rpc,
            sleeve,
            &WriterSleeveV1 {
                is_initialized: true,
                bump: sb,
                account_discriminator: WriterSleeveV1::ACCOUNT_DISCRIMINATOR,
                account_version: WriterSleeveV1::ACCOUNT_VERSION,
                underlying_id: underlying,
                expiry_ts: expiry,
                settlement_mint: quote,
                settlement_group: group,
                series_book: book,
                usdc_vault: pda(&[WRITER_SLEEVE_USDC_VAULT_PDA_SEED, sleeve.as_ref()]).0,
                vault_config: config,
                participation_start_ts: now,
                series_count: 1,
                status: WriterSleeveStatus::Active,
                ..Default::default()
            },
            WriterSleeveV1::LEN,
        );
        let mut b = WriterSeriesBookV1 {
            is_initialized: true,
            bump: bb,
            account_discriminator: WriterSeriesBookV1::ACCOUNT_DISCRIMINATOR,
            account_version: WriterSeriesBookV1::ACCOUNT_VERSION,
            sleeve,
            settlement_group: group,
            series_count: 1,
            max_series: WRITER_MAX_LIVE_SERIES as u8,
            ..Default::default()
        };
        b.records[0] = WriterSeriesRecordV1 {
            active: true,
            series_id: id,
            market,
            contract_mint: option,
            contract_size_atoms: UNIT,
            total_physical_supply_atoms: if writer { 0 } else { 20 * UNIT },
            external_open_interest_atoms: if writer { 0 } else { 20 * UNIT },
            ..WriterSeriesRecordV1::EMPTY
        };
        install(&mut rpc, book, &b, WriterSeriesBookV1::LEN);
        let mut p = AmoebaDlmmPoolV1 {
            is_initialized: true,
            bump: pb,
            market,
            oracle_month: month,
            liquidity_manager: payer.pubkey(),
            option_mint: option,
            quote_mint: quote,
            option_vault,
            quote_vault,
            expiry_ts: expiry,
            tick_size_quote_atomic: 50_000,
            maximum_price_quote_atomic: 12 * UNIT,
            maximum_bin_id: 240,
            maximum_bins_per_swap: 8,
            status: AmoebaDlmmPoolStatus::Active,
            ..Default::default()
        };
        p.compression_info.state =
            light_sdk_types::interface::account::compression_info::CompressionState::Decompressed;
        let mut bytes = AMOEBA_DLMM_POOL_LIGHT_DISCRIMINATOR.to_vec();
        bytes.extend(p.try_to_vec().unwrap());
        rpc.context
            .set_account(pool, account(program(), bytes))
            .unwrap();
        let order_book = derive_order_book(&program(), &pool).0;
        let order_option = derive_token_ata(&order_book, &option);
        let order_quote = derive_token_ata(&order_book, &quote);
        Self {
            rpc,
            payer,
            other,
            config,
            market,
            month,
            sleeve,
            group,
            book,
            pool,
            option,
            quote,
            authority,
            option_vault,
            quote_vault,
            order_book,
            order_option,
            order_quote,
            expiry,
        }
    }
    pub fn order_instruction(
        &self,
        owner: &Keypair,
        action: DlmmOrderAction,
        witness: &[Pubkey],
    ) -> Instruction {
        let keys = [
            owner.pubkey(),
            self.config,
            self.market,
            self.month,
            self.sleeve,
            self.group,
            self.book,
            self.pool,
            self.authority,
            self.option,
            self.quote,
            self.option_vault,
            self.quote_vault,
            derive_token_ata(&owner.pubkey(), &self.option),
            derive_token_ata(&owner.pubkey(), &self.quote),
            LIGHT_TOKEN_PROGRAM_ID,
            light_token::cpi_authority(),
            get_spl_interface_pda_and_bump(&self.option).0,
            get_spl_interface_pda_and_bump(&self.quote).0,
            spl_token::id(),
            system_program::id(),
            LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
            LIGHT_TOKEN_RENT_SPONSOR,
            light_token_minter::scoped_settlement::derive_collective_settlement_delegate(
                &program(),
                &owner.pubkey(),
                &self.option,
            )
            .0,
            derive_writer_dlmm_policy_pda(&program(), &self.sleeve).0,
            pda(&[
                WRITER_POLICY_SNAPSHOT_PDA_SEED,
                self.sleeve.as_ref(),
                &1u64.to_le_bytes(),
            ])
            .0,
            derive_writer_dlmm_position_pda(&program(), &self.pool, &self.sleeve).0,
            pda(&[WRITER_SLEEVE_USDC_VAULT_PDA_SEED, self.sleeve.as_ref()]).0,
            pda(&[CONTRACT_MINT_STAGING_PDA_SEED, self.market.as_ref()]).0,
            pda(&[
                WRITER_RETIREMENT_CUSTODY_PDA_SEED,
                self.sleeve.as_ref(),
                self.market.as_ref(),
            ])
            .0,
            pda(&[WRITER_POLICY_REGISTRY_PDA_SEED]).0,
            self.order_book,
            self.order_option,
            self.order_quote,
        ];
        let mut metas = keys
            .iter()
            .enumerate()
            .map(|(i, k)| {
                if matches!(
                    i,
                    0 | 2
                        | 4
                        | 6
                        | 7
                        | 9
                        | 11
                        | 12
                        | 13
                        | 14
                        | 17
                        | 18
                        | 22
                        | 24
                        | 26
                        | 27
                        | 28
                        | 29
                        | 31
                        | 32
                        | 33
                ) {
                    AccountMeta::new(*k, i == 0)
                } else {
                    AccountMeta::new_readonly(*k, false)
                }
            })
            .collect::<Vec<_>>();
        metas.extend(witness.iter().map(|k| AccountMeta::new(*k, false)));
        govern(
            metas,
            VaultInstruction::ManageDlmmOrdersV1 { params: action },
        )
    }
    pub async fn order(&mut self, owner: &Keypair, action: DlmmOrderAction, witness: &[Pubkey]) {
        let label = format!("order-{action:?}");
        let ix = self.order_instruction(owner, action, witness);
        self.execute(owner, ix, &label, None).await;
    }
    pub async fn reject(&mut self, owner: &Keypair, ix: Instruction, label: &str, error: u32) {
        self.execute(owner, ix, label, Some(error)).await;
    }
    pub async fn execute(
        &mut self,
        owner: &Keypair,
        ix: Instruction,
        label: &str,
        error: Option<u32>,
    ) {
        let addresses = ix
            .accounts
            .iter()
            .filter(|m| !m.is_signer)
            .map(|m| m.pubkey)
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let key = Pubkey::new_unique();
        let lookup = AddressLookupTable {
            meta: LookupTableMeta::default(),
            addresses: std::borrow::Cow::Borrowed(&addresses),
        };
        self.rpc
            .context
            .set_account(
                key,
                account(
                    solana_sdk::address_lookup_table::program::id(),
                    lookup.serialize_for_tests().unwrap(),
                ),
            )
            .unwrap();
        let budget =
            solana_sdk::compute_budget::ComputeBudgetInstruction::set_compute_unit_limit(1_000_000);
        let msg = v0::Message::try_compile(
            &owner.pubkey(),
            &[budget, ix],
            &[AddressLookupTableAccount { key, addresses }],
            self.rpc.context.latest_blockhash(),
        )
        .unwrap();
        let tx = VersionedTransaction::try_new(VersionedMessage::V0(msg), &[owner]).unwrap();
        let packet = bincode::serialize(&tx).unwrap().len();
        assert!(packet <= 1232);
        let result = self.rpc.context.send_transaction(tx);
        match error {
            None => {
                let meta = result.unwrap_or_else(|e| panic!("{label}: {e:?}"));
                assert!(meta.compute_units_consumed <= 1_000_000);
                println!(
                    "g3_focused label={label} packet={packet} compute={}",
                    meta.compute_units_consumed
                );
            }
            Some(code) => {
                let e = result.unwrap_err();
                assert_eq!(
                    e.err,
                    solana_sdk::transaction::TransactionError::InstructionError(
                        1,
                        solana_sdk::instruction::InstructionError::Custom(code)
                    ),
                    "{label}: {e:?}"
                );
            }
        }
        self.rpc.context.expire_blockhash();
    }
    pub async fn read<T: BorshDeserialize>(&mut self, key: Pubkey) -> T {
        let a = self.rpc.get_account(key).await.unwrap().unwrap();
        T::deserialize(&mut a.data.as_slice()).unwrap()
    }
    pub async fn token_balance(&mut self, key: Pubkey) -> u64 {
        let a = self.rpc.get_account(key).await.unwrap().unwrap();
        spl_token::state::Account::unpack(&a.data[..165])
            .unwrap()
            .amount
    }
    pub fn option_supply(&self) -> u64 {
        let account = self.rpc.context.get_account(&self.option).unwrap();
        spl_token::state::Mint::unpack(&account.data)
            .unwrap()
            .supply
    }
    pub async fn holder_balances(&mut self, owner: Pubkey) -> (u64, u64) {
        (
            self.token_balance(derive_token_ata(&owner, &self.option))
                .await,
            self.token_balance(derive_token_ata(&owner, &self.quote))
                .await,
        )
    }
    pub fn snapshot(&self, keys: &[Pubkey]) -> Vec<Option<Account>> {
        keys.iter()
            .map(|k| self.rpc.context.get_account(k))
            .collect()
    }
}
mod writer;
