use super::*;
use light_token_minter::{
    writer_dlmm_instruction::ManageWriterDlmmV1Params,
    writer_participation_state::{derive_contribution, WriterParticipationActionV2},
};
use solana_program::hash::hashv;

fn metas(keys: &[Pubkey], writable: &[usize]) -> Vec<AccountMeta> {
    keys.iter()
        .enumerate()
        .map(|(i, k)| {
            if writable.contains(&i) {
                AccountMeta::new(*k, i == 0)
            } else {
                AccountMeta::new_readonly(*k, false)
            }
        })
        .collect()
}
impl MarketFixture {
    pub fn snapshot_key(&self) -> Pubkey {
        pda(&[
            WRITER_POLICY_SNAPSHOT_PDA_SEED,
            self.sleeve.as_ref(),
            &1u64.to_le_bytes(),
        ])
        .0
    }
    pub fn policy_key(&self) -> Pubkey {
        derive_writer_dlmm_policy_pda(&program(), &self.sleeve).0
    }
    pub fn cash_key(&self) -> Pubkey {
        pda(&[WRITER_SLEEVE_USDC_VAULT_PDA_SEED, self.sleeve.as_ref()]).0
    }
    pub async fn writer_fixture() -> Self {
        let mut f = Self::new_base(true).await;
        let (registry, rb) = pda(&[WRITER_POLICY_REGISTRY_PDA_SEED]);
        let (snapshot, sb) = pda(&[
            WRITER_POLICY_SNAPSHOT_PDA_SEED,
            f.sleeve.as_ref(),
            &1u64.to_le_bytes(),
        ]);
        let (policy, pb) = derive_writer_dlmm_policy_pda(&program(), &f.sleeve);
        let mut book: WriterSeriesBookV1 = f.read(f.book).await;
        book.frozen = true;
        let r = &mut book.records[0];
        r.strike_price_atomic = 100 * UNIT;
        r.cap_or_floor_price_atomic = 112 * UNIT;
        r.max_payout_per_contract_atoms = 12 * UNIT;
        r.payoff_digest = [19; 32];
        r.retirement_custody = pda(&[
            WRITER_RETIREMENT_CUSTODY_PDA_SEED,
            f.sleeve.as_ref(),
            f.market.as_ref(),
        ])
        .0;
        let family = hashv(&[
            b"ameba-writer-series-family-g3",
            &1u32.to_le_bytes(),
            &r.series_id,
            &r.payoff_digest,
        ])
        .to_bytes();
        let snap = WriterPolicySnapshotV1 {
            is_initialized: true,
            bump: sb,
            account_discriminator: WriterPolicySnapshotV1::ACCOUNT_DISCRIMINATOR,
            account_version: WriterPolicySnapshotV1::ACCOUNT_VERSION,
            sleeve: f.sleeve,
            registry,
            policy_version: 1,
            regime_input_version: 1,
            policy_hash: [21; 32],
            scenario_set_hash: [22; 32],
            risk_limit_hash: [23; 32],
            series_family_hash: family,
            drawdown_scale: UNIT,
            worst_drawdown_limit: UNIT,
            upper_drawdown_limit: UNIT,
            lower_drawdown_limit: UNIT,
            lower_tail_max_settlement_atomic: 88 * UNIT,
            upper_tail_min_settlement_atomic: 112 * UNIT,
            max_issue_atoms: 100 * UNIT,
            ..Default::default()
        };
        let mut policy_state = WriterDlmmPolicyV1 {
            is_initialized: true,
            bump: pb,
            account_discriminator: WriterDlmmPolicyV1::ACCOUNT_DISCRIMINATOR,
            account_version: WriterDlmmPolicyV1::ACCOUNT_VERSION,
            sleeve: f.sleeve,
            policy_snapshot: snapshot,
            management_authority: f.payer.pubkey(),
            committing_policy_authority: f.payer.pubkey(),
            monthly_buyback_cap_atoms: 10 * UNIT,
            transaction_buyback_cap_atoms: 10 * UNIT,
            reserve_release_spend_ratio_ppm: UNIT,
            price_separation_ticks: 1,
            series_count: 1,
            appended_series_count: 1,
            sealed: true,
            ..Default::default()
        };
        policy_state.series[0] = WriterDlmmSeriesPolicyV1 {
            conservative_claim_value_atoms: UNIT,
            seller_floor_quote_atoms: UNIT,
            monthly_buyback_cap_atoms: 10 * UNIT,
            transaction_buyback_cap_atoms: 10 * UNIT,
        };
        let p = &policy_state;
        let t = &p.series[0];
        let first = hashv(&[
            WRITER_DLMM_POLICY_HASH_DOMAIN,
            &[0],
            p.sleeve.as_ref(),
            p.policy_snapshot.as_ref(),
            &snap.policy_hash,
            &snap.series_family_hash,
            p.management_authority.as_ref(),
            p.committing_policy_authority.as_ref(),
            &p.monthly_buyback_cap_atoms.to_le_bytes(),
            &p.transaction_buyback_cap_atoms.to_le_bytes(),
            &p.reserve_release_spend_ratio_ppm.to_le_bytes(),
            &p.price_separation_ticks.to_le_bytes(),
            &[1],
        ])
        .to_bytes();
        let hash = hashv(&[
            WRITER_DLMM_POLICY_HASH_DOMAIN,
            &[1],
            &first,
            &[0],
            r.market.as_ref(),
            &r.payoff_digest,
            &t.conservative_claim_value_atoms.to_le_bytes(),
            &t.seller_floor_quote_atoms.to_le_bytes(),
            &t.monthly_buyback_cap_atoms.to_le_bytes(),
            &t.transaction_buyback_cap_atoms.to_le_bytes(),
        ])
        .to_bytes();
        policy_state.expected_policy_hash = hash;
        policy_state.rolling_policy_hash = hash;
        let mut sleeve: WriterSleeveV1 = f.read(f.sleeve).await;
        sleeve.policy_registry = registry;
        sleeve.policy_snapshot = snapshot;
        sleeve.policy_version = 1;
        sleeve.policy_hash = snap.policy_hash;
        sleeve.scenario_set_hash = snap.scenario_set_hash;
        sleeve.risk_limit_hash = snap.risk_limit_hash;
        install(&mut f.rpc, f.sleeve, &sleeve, WriterSleeveV1::LEN);
        install(&mut f.rpc, f.book, &book, WriterSeriesBookV1::LEN);
        install(&mut f.rpc, snapshot, &snap, WriterPolicySnapshotV1::LEN);
        install(&mut f.rpc, policy, &policy_state, WriterDlmmPolicyV1::LEN);
        install(
            &mut f.rpc,
            registry,
            &WriterPolicyRegistryV1 {
                is_initialized: true,
                bump: rb,
                account_discriminator: WriterPolicyRegistryV1::ACCOUNT_DISCRIMINATOR,
                account_version: WriterPolicyRegistryV1::ACCOUNT_VERSION,
                vault_config: f.config,
                policy_authority: f.payer.pubkey(),
                ..Default::default()
            },
            WriterPolicyRegistryV1::LEN,
        );
        let token = spl_token::state::Account {
            mint: f.quote,
            owner: f.sleeve,
            state: spl_token::state::AccountState::Initialized,
            ..Default::default()
        };
        let mut bytes = vec![0; 165];
        spl_token::state::Account::pack(token, &mut bytes).unwrap();
        let cash = f.cash_key();
        f.rpc
            .context
            .set_account(cash, account(spl_token::id(), bytes))
            .unwrap();
        f
    }
    pub async fn classic_funds(&mut self, owner: Pubkey, amount: u64) -> Pubkey {
        let token = Keypair::new();
        let payer = self.payer.insecure_clone();
        setup_tx(
            &mut self.rpc,
            &payer,
            &[
                system_instruction::create_account(
                    &payer.pubkey(),
                    &token.pubkey(),
                    3_000_000,
                    165,
                    &spl_token::id(),
                ),
                spl_token::instruction::initialize_account3(
                    &spl_token::id(),
                    &token.pubkey(),
                    &self.quote,
                    &owner,
                )
                .unwrap(),
                spl_token::instruction::mint_to(
                    &spl_token::id(),
                    &self.quote,
                    &token.pubkey(),
                    &payer.pubkey(),
                    &[],
                    amount,
                )
                .unwrap(),
            ],
            &[&token],
        )
        .await;
        token.pubkey()
    }
    pub async fn contribute(
        &mut self,
        owner: &Keypair,
        source: Pubkey,
        nonce: u64,
        amount: u64,
    ) -> Pubkey {
        let receipt = derive_contribution(&program(), &self.sleeve, &owner.pubkey(), nonce).0;
        let keys = [
            owner.pubkey(),
            self.config,
            self.sleeve,
            self.group,
            self.book,
            self.snapshot_key(),
            self.policy_key(),
            self.cash_key(),
            source,
            self.quote,
            receipt,
            system_program::id(),
            spl_token::id(),
        ];
        let ix = govern(
            metas(&keys, &[0, 2, 7, 8, 10]),
            VaultInstruction::ManageWriterParticipationV2 {
                params: WriterParticipationActionV2::Contribute {
                    nonce,
                    amount_atoms: amount,
                },
            },
        );
        self.execute(owner, ix, "writer-contribution", None).await;
        receipt
    }
    pub async fn initialize_writer_position(&mut self, owner: &Keypair) {
        let keys = [
            owner.pubkey(),
            self.config,
            self.sleeve,
            self.group,
            self.book,
            self.snapshot_key(),
            self.policy_key(),
            self.pool,
            derive_writer_dlmm_position_pda(&program(), &self.pool, &self.sleeve).0,
            self.market,
            self.month,
            system_program::id(),
        ];
        let ix = govern(
            metas(&keys, &[0, 7, 8]),
            VaultInstruction::ManageWriterDlmmV1 {
                params: ManageWriterDlmmV1Params::InitializePosition { series_index: 0 },
            },
        );
        self.execute(owner, ix, "writer-position", None).await;
    }
    pub fn add_writer_instruction(
        &self,
        owner: &Keypair,
        issue: u64,
        entries: Vec<WriterDlmmBinV1>,
    ) -> Instruction {
        let keys = [
            owner.pubkey(),
            self.config,
            self.sleeve,
            self.group,
            self.book,
            self.snapshot_key(),
            self.policy_key(),
            self.market,
            self.month,
            self.pool,
            self.authority,
            derive_writer_dlmm_position_pda(&program(), &self.pool, &self.sleeve).0,
            self.option,
            self.quote,
            self.option_vault,
            self.quote_vault,
            self.cash_key(),
            pda(&[CONTRACT_MINT_STAGING_PDA_SEED, self.market.as_ref()]).0,
            pda(&[
                WRITER_RETIREMENT_CUSTODY_PDA_SEED,
                self.sleeve.as_ref(),
                self.market.as_ref(),
            ])
            .0,
            LIGHT_TOKEN_PROGRAM_ID,
            light_token::cpi_authority(),
            get_spl_interface_pda_and_bump(&self.option).0,
            get_spl_interface_pda_and_bump(&self.quote).0,
            spl_token::id(),
            system_program::id(),
            LIGHT_TOKEN_COMPRESSIBLE_CONFIG,
            LIGHT_TOKEN_RENT_SPONSOR,
        ];
        govern(
            metas(
                &keys,
                &[0, 2, 4, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18, 21, 22, 26],
            ),
            VaultInstruction::ManageWriterDlmmV1 {
                params: ManageWriterDlmmV1Params::AddLiquidity {
                    series_index: 0,
                    issue_amount_atoms: issue,
                    entries,
                },
            },
        )
    }
}
