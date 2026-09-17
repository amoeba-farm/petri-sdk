use super::*;
use light_token_minter::{
    instruction::ProposeSettlementSignerRotationParams,
    writer_settlement_handoff::{
        derive_writer_settlement_handoff, WriterSettlementHandoffV3, HANDOFF_PAYLOAD,
    },
};

mod bucket;

fn ed25519(signer: &Keypair, message: &[u8]) -> Instruction {
    let mut data = vec![1, 0];
    for offset in [
        48u16,
        u16::MAX,
        16,
        u16::MAX,
        112,
        u16::try_from(message.len()).unwrap(),
        u16::MAX,
    ] {
        data.extend_from_slice(&offset.to_le_bytes());
    }
    data.extend_from_slice(signer.pubkey().as_ref());
    data.extend_from_slice(signer.sign_message(message).as_ref());
    data.extend_from_slice(message);
    Instruction {
        program_id: solana_program::ed25519_program::id(),
        accounts: vec![],
        data,
    }
}

impl Fixture {
    async fn terminal_ready(&mut self) {
        self.send(self.activate(), true).await;
        set_time(&mut self.ctx, EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS);
        let mut bucket: OracleBucketMedianState = state(&mut self.ctx, self.bucket).await;
        bucket.status = OracleBucketMedianStatus::SettlementReady;
        bucket.last_recomputed_ts = EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS;
        bucket.source_snapshot_hash = [0x34; 32];
        put(
            &mut self.ctx,
            self.bucket,
            &bucket,
            OracleBucketMedianState::LEN,
        );
        self.send(self.finalize_month(), true).await;
        self.send(self.collect(), true).await;
    }

    // Deliberately scoped boundary: already authenticated tag116 record. The
    // current-set Ed25519 attestation validator has separate negative coverage.
    async fn attested_record_fixture(&mut self, version: u64) {
        let program = light_token_minter::id();
        let (_, bump) = derive_settlement_v2_pda(&program, &self.market, &self.month);
        put(
            &mut self.ctx,
            self.record,
            &SettlementRecordV2 {
                is_initialized: true,
                bump,
                account_discriminator: SettlementRecordV2::ACCOUNT_DISCRIMINATOR,
                account_version: SettlementRecordV2::ACCOUNT_VERSION,
                market: self.market,
                oracle_month: self.month,
                settlement_ts: EXPIRY,
                settlement_price_atomic: 105_000_000,
                signed_leaf_commitment: [0x42; 32],
                submitted_by: self.admin.pubkey(),
                signer_set_version: version,
            },
            SettlementRecordV2::LEN,
        );
        let mut month: OracleMonthState = state(&mut self.ctx, self.month).await;
        month.phase = OraclePhase::Settled;
        month.settlement_record = Some(self.record);
        put(&mut self.ctx, self.month, &month, OracleMonthState::LEN);
    }

    fn publish_handoff(&self, set: Pubkey) -> Instruction {
        let mut ix = self.publish();
        ix.accounts[0].is_writable = true;
        ix.accounts[12].pubkey = set;
        let gate = ix.accounts.pop().unwrap();
        ix.accounts.push(AccountMeta::new(
            derive_writer_settlement_handoff(&light_token_minter::id(), &self.group).0,
            false,
        ));
        ix.accounts
            .push(AccountMeta::new_readonly(system_program::id(), false));
        ix.accounts.push(gate);
        ix.data.splice(1..1, HANDOFF_PAYLOAD);
        ix
    }

    async fn governance_send(&mut self, instructions: &[Instruction], recovery: bool, ok: bool) {
        let bh = self.ctx.get_new_latest_blockhash().await.unwrap();
        let mut signers = vec![&self.ctx.payer, &self.admin, &self.oracle];
        if recovery {
            signers.push(&self.recovery);
        }
        let tx = Transaction::new_signed_with_payer(
            instructions,
            Some(&self.ctx.payer.pubkey()),
            &signers,
            bh,
        );
        let packet = bincode::serialize(&tx).unwrap().len();
        assert!(packet <= 1232, "packet={packet}");
        let result = self
            .ctx
            .banks_client
            .process_transaction_with_metadata(tx)
            .await
            .unwrap();
        println!(
            "writer_rotation packet={packet} result={:?} compute={:?}",
            result.result,
            result.metadata.as_ref().map(|m| m.compute_units_consumed)
        );
        assert_eq!(result.result.is_ok(), ok, "{result:?}");
    }

    async fn propose(&mut self, old: &Keypair, new: &Keypair, emergency: bool) -> (Pubkey, u64) {
        let registry: SettlementSignerRegistry = state(&mut self.ctx, self.registry).await;
        let current: SettlementSignerSet = state(&mut self.ctx, registry.current_set).await;
        let clock: Clock = self.ctx.banks_client.get_sysvar().await.unwrap();
        let activate_after = clock.slot
            + current.rotation_delay_slots
                * if emergency {
                    EMERGENCY_SETTLEMENT_SIGNER_DELAY_MULTIPLIER
                } else {
                    1
                };
        let version = current.version + 1;
        let (key, bump) = derive_settlement_signer_set_pda(&light_token_minter::id(), version);
        let mut signers = [Pubkey::default(); MAX_SETTLEMENT_SIGNER_COUNT];
        signers[0] = new.pubkey();
        let mut pending = SettlementSignerSet {
            is_initialized: true,
            bump,
            account_discriminator: SettlementSignerSet::ACCOUNT_DISCRIMINATOR,
            account_version: SettlementSignerSet::ACCOUNT_VERSION,
            registry: self.registry,
            version,
            threshold: 1,
            signer_count: 1,
            signers,
            rotation_delay_slots: current.rotation_delay_slots,
            activate_after_slot: activate_after,
            emergency,
            ..Default::default()
        };
        pending.set_hash = pending.compute_set_hash();
        let params = ProposeSettlementSignerRotationParams {
            target_version: version,
            threshold: 1,
            signer_count: 1,
            signers,
            rotation_delay_slots: current.rotation_delay_slots,
            activate_after_slot: activate_after,
        };
        let mut keys = vec![self.admin.pubkey(), self.oracle.pubkey()];
        if emergency {
            keys.push(self.recovery.pubkey());
        }
        keys.extend([self.config, self.registry, registry.current_set, key]);
        if !emergency {
            keys.push(solana_sdk::sysvar::instructions::id());
        }
        keys.push(system_program::id());
        let mut ix = self.ix(
            if emergency { 94 } else { 91 },
            &keys,
            if emergency { &[0, 4, 6] } else { &[0, 3, 5] },
            &params.try_to_vec().unwrap(),
        );
        ix.accounts[1].is_signer = true;
        if emergency {
            ix.accounts[2].is_signer = true;
        }
        let digest = hashv(&[
            b"ameba_settlement_signer_rotation_v1",
            light_token_minter::id().as_ref(),
            self.registry.as_ref(),
            registry.current_set.as_ref(),
            &current.version.to_le_bytes(),
            &current.set_hash,
            &(registry.proposal_nonce + 1).to_le_bytes(),
            key.as_ref(),
            &version.to_le_bytes(),
            &pending.set_hash,
            &activate_after.to_le_bytes(),
            &current.rotation_delay_slots.to_le_bytes(),
            &[u8::from(emergency)],
        ])
        .to_bytes();
        if emergency {
            // Recovery must remain possible without an old-set signature.
            let mut config: VaultConfig = state(&mut self.ctx, self.config).await;
            config.paused = true;
            put(&mut self.ctx, self.config, &config, VaultConfig::LEN);
            self.governance_send(&[ix], true, true).await;
        } else {
            self.governance_send(&[ix.clone()], false, false).await;
            self.governance_send(&[ed25519(old, &digest), ix], false, true)
                .await;
        }
        (key, activate_after)
    }

    async fn activate_rotation(&mut self, key: Pubkey, slot: u64, early: bool) {
        let mut ix = self.ix(92, &[self.registry, key, self.config], &[0], &[]);
        ix.accounts[0].is_signer = false;
        // Use only the transaction payer; activation itself is permissionless.
        let mut clock: Clock = self.ctx.banks_client.get_sysvar().await.unwrap();
        clock.slot = if early { slot - 1 } else { slot };
        self.ctx.set_sysvar(&clock);
        let bh = self.ctx.get_new_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&self.ctx.payer.pubkey()),
            &[&self.ctx.payer],
            bh,
        );
        let result = self
            .ctx
            .banks_client
            .process_transaction_with_metadata(tx)
            .await
            .unwrap();
        println!(
            "writer_rotation_activation early={early} result={:?}",
            result.result
        );
        assert_eq!(result.result.is_ok(), !early, "{result:?}");
        if !early {
            let mut config: VaultConfig = state(&mut self.ctx, self.config).await;
            config.paused = false;
            put(&mut self.ctx, self.config, &config, VaultConfig::LEN);
        }
    }

    async fn finalize_and_claim_receipt(&mut self) {
        use light_token_minter::writer_participation_state::{
            derive_contribution, WriterContributionV2,
        };
        let program = light_token_minter::id();
        let sleeve: WriterSleeveV1 = state(&mut self.ctx, self.sleeve).await;
        let option = derive_contract_mint_pda(&program, &self.market).0;
        let policy =
            light_token_minter::state::derive_writer_dlmm_policy_pda(&program, &self.sleeve).0;
        let ix = self.ix(
            245,
            &[
                self.admin.pubkey(),
                self.config,
                self.sleeve,
                self.group,
                self.book,
                self.policy,
                self.vault,
                policy,
                option,
            ],
            &[2, 4],
            &[],
        );
        self.send(ix.clone(), true).await;
        self.send(ix, false).await;
        let settled: WriterSleeveV1 = state(&mut self.ctx, self.sleeve).await;
        assert_eq!(
            (
                settled.writer_residual_remaining_atoms,
                settled.unclaimed_principal_atoms
            ),
            (PRINCIPAL, PRINCIPAL)
        );
        let (receipt, bump) = derive_contribution(&program, &self.sleeve, &self.admin.pubkey(), 1);
        put(
            &mut self.ctx,
            receipt,
            &WriterContributionV2 {
                initialized: true,
                bump,
                discriminator: *b"WCP",
                version: 3,
                sleeve: self.sleeve,
                creator: self.admin.pubkey(),
                owner: self.admin.pubkey(),
                rent_payer: self.admin.pubkey(),
                nonce: 1,
                policy_version: sleeve.policy_version,
                policy_hash: sleeve.policy_hash,
                principal: PRINCIPAL,
                actual_deposit_ts: NOW,
                entry_ts: NOW,
                expiry_ts: EXPIRY,
                weight_offset: 0,
                claimed: false,
            },
            WriterContributionV2::LEN,
        );
        let destination =
            spl_associated_token_account::get_associated_token_address_with_program_id(
                &self.admin.pubkey(),
                &sleeve.settlement_mint,
                &spl_token::id(),
            );
        let mut bytes = vec![0; TokenAccount::LEN];
        TokenAccount::pack(
            TokenAccount {
                mint: sleeve.settlement_mint,
                owner: self.admin.pubkey(),
                amount: 0,
                state: AccountState::Initialized,
                ..Default::default()
            },
            &mut bytes,
        )
        .unwrap();
        self.ctx.set_account(
            &destination,
            &AccountSharedData::from(Account {
                lamports: 10_000_000,
                data: bytes,
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            }),
        );
        let mut mint = vec![0; Mint::LEN];
        Mint::pack(
            Mint {
                is_initialized: true,
                decimals: 6,
                supply: PRINCIPAL,
                ..Default::default()
            },
            &mut mint,
        )
        .unwrap();
        self.ctx.set_account(
            &sleeve.settlement_mint,
            &AccountSharedData::from(Account {
                lamports: 10_000_000,
                data: mint,
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            }),
        );
        let ix = self.ix(
            160,
            &[
                self.admin.pubkey(),
                self.sleeve,
                receipt,
                self.vault,
                destination,
                sleeve.settlement_mint,
                spl_token::id(),
                self.config,
            ],
            &[0, 1, 2, 3, 4],
            &[4],
        );
        self.send(ix.clone(), true).await;
        self.send(ix, false).await;
        let paid = self
            .ctx
            .banks_client
            .get_account(destination)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(TokenAccount::unpack(&paid.data).unwrap().amount, PRINCIPAL);
        let claimed: WriterSleeveV1 = state(&mut self.ctx, self.sleeve).await;
        assert_eq!(
            (
                claimed.writer_residual_remaining_atoms,
                claimed.unclaimed_principal_atoms,
                claimed.accounted_asset_atoms
            ),
            (0, 0, 0)
        );
    }
}

#[tokio::test]
async fn ordinary_and_emergency_rotations_preserve_group_provenance_and_publish_once() {
    for emergency in [false, true] {
        let mut f = Fixture::start(false).await;
        f.terminal_ready().await;
        let original: WriterSettlementGroupV1 = state(&mut f.ctx, f.group).await;
        let original_hash = group_hash(&f.group, &original);
        let old = f.attestor.insecure_clone();
        let replacement = Keypair::new();
        let (set, slot) = f.propose(&old, &replacement, emergency).await;
        // Artificial attestation fixture isolates pending/cancelled handoff admission.
        f.attested_record_fixture(2).await;
        let before = f
            .ctx
            .banks_client
            .get_account(f.group)
            .await
            .unwrap()
            .unwrap();
        f.send(f.publish_handoff(set), false).await;
        if !emergency {
            let mut cancel = f.ix(
                93,
                &[f.admin.pubkey(), f.oracle.pubkey(), f.config, f.registry],
                &[0, 3],
                &[],
            );
            cancel.accounts[1].is_signer = true;
            f.governance_send(&[cancel], false, true).await;
            f.send(f.publish_handoff(set), false).await;
            let again = f.propose(&old, &replacement, false).await;
            assert_eq!(again, (set, slot));
        }
        f.activate_rotation(set, slot, true).await;
        f.activate_rotation(set, slot, false).await;
        f.send(f.publish(), false).await; // Reproduces the original pinned-set conflict.
        assert_eq!(
            before,
            f.ctx
                .banks_client
                .get_account(f.group)
                .await
                .unwrap()
                .unwrap()
        );
        let record = f.record;
        let mut bad: SettlementRecordV2 = state(&mut f.ctx, record).await;
        let valid = bad.clone();
        bad.signer_set_version = 1;
        put(&mut f.ctx, record, &bad, SettlementRecordV2::LEN);
        f.send(f.publish_handoff(set), false).await;
        put(&mut f.ctx, record, &valid, SettlementRecordV2::LEN);
        // Another authorized rotation after attestation must not erase that record.
        let newest = Keypair::new();
        let (set3, slot3) = f.propose(&replacement, &newest, emergency).await;
        f.activate_rotation(set3, slot3, false).await;
        let mut wrong = f.publish_handoff(set);
        wrong.accounts[13].pubkey = Pubkey::new_unique();
        f.send(wrong, false).await;
        f.send(f.publish_handoff(set), true).await;
        let settled: WriterSettlementGroupV1 = state(&mut f.ctx, f.group).await;
        assert_eq!(settled.status, WriterSettlementGroupStatus::Settled);
        assert_eq!(
            (
                settled.signer_set,
                settled.signer_set_version,
                settled.signer_set_hash
            ),
            (
                original.signer_set,
                original.signer_set_version,
                original.signer_set_hash
            )
        );
        let key = derive_writer_settlement_handoff(&light_token_minter::id(), &f.group).0;
        let handoff: WriterSettlementHandoffV3 = state(&mut f.ctx, key).await;
        let handoff_account = f.ctx.banks_client.get_account(key).await.unwrap().unwrap();
        assert_eq!(handoff_account.data.len(), WriterSettlementHandoffV3::LEN);
        println!(
            "writer_handoff bytes={} storage_lamports={}",
            handoff_account.data.len(),
            handoff_account.lamports
        );
        assert_eq!(handoff.group_commitment_before_settlement, original_hash);
        assert_eq!(
            (
                handoff.group,
                handoff.original_version,
                handoff.replacement_version,
                handoff.replacement_signer_set,
                handoff.settlement_record
            ),
            (f.group, 1, 2, set, f.record)
        );
        let unchanged = f.ctx.banks_client.get_account(key).await.unwrap().unwrap();
        f.send(f.publish_handoff(set), false).await;
        f.send(f.publish_handoff(set3), false).await;
        assert_eq!(
            unchanged,
            f.ctx.banks_client.get_account(key).await.unwrap().unwrap()
        );
        assert_eq!(settled, state(&mut f.ctx, f.group).await);
        f.finalize_and_claim_receipt().await;
    }
}
