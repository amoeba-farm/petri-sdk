use super::*;

#[tokio::test]
async fn bucket_verdicts_retain_last_accepted_price_and_complete_settlement() {
    // Prepared council checkpoint and ballots. Council apply, month finalization,
    // source-manifest collection and writer payout execute; controller setup is separately tested.
    for choice in [0usize, 1, 2, 3] {
        // accept, reject, split, no votes
        let mut f = Fixture::start(false).await;
        f.send(f.activate(), true).await;
        set_time(&mut f.ctx, EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS);
        let program = light_token_minter::id();
        use light_token_minter::instruction::{
            OracleCarryForwardActionV1, OracleCouncilActionV1, VaultInstruction,
        };
        use light_token_minter::processor::{CouncilCase, CouncilRound};
        let (dispute_key, db) = Pubkey::find_program_address(
            &[
                CURRENT_STATE_NAMESPACE_SEED,
                b"g3-council-case-v1",
                f.month.as_ref(),
                f.bucket.as_ref(),
            ],
            &program,
        );
        let mut bucket: OracleBucketMedianState = state(&mut f.ctx, f.bucket).await;
        bucket.status = OracleBucketMedianStatus::EmergencyRequired;
        bucket.bucket_delta_bps = 500;
        let mut month: OracleMonthState = state(&mut f.ctx, f.month).await;
        month.index_delta_bps = 500;
        put(&mut f.ctx, f.month, &month, OracleMonthState::LEN);
        bucket.eligible_source_count = 0;
        bucket.last_recomputed_ts = EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS;
        bucket.source_snapshot_hash = [0x72; 32];
        bucket.emergency_snapshot_slot = 10;
        bucket.council_authority_version = 1;
        put(&mut f.ctx, f.bucket, &bucket, OracleBucketMedianState::LEN);
        let mut config = vec![0u8; 384];
        config[..8].copy_from_slice(b"AG3CFG01");
        config[8] = 1;
        config[9] = Pubkey::find_program_address(
            &[b"ameba-governance-v3", b"council"],
            &PINNED_CONTROLLER_PROGRAM_ID,
        )
        .1;
        config[10] = 1;
        config[11..43].copy_from_slice(PINNED_CONTROLLER_PROGRAM_ID.as_ref());
        config[43..75].copy_from_slice(
            Pubkey::find_program_address(
                &[PINNED_CONTROLLER_PROGRAM_ID.as_ref()],
                &solana_sdk::bpf_loader_upgradeable::id(),
            )
            .0
            .as_ref(),
        );
        config[75..107].copy_from_slice(
            Pubkey::find_program_address(
                &[b"ameba-governance-v3", b"authority"],
                &PINNED_CONTROLLER_PROGRAM_ID,
            )
            .0
            .as_ref(),
        );
        config[107..139].copy_from_slice(Pubkey::new_unique().as_ref());
        for i in 0..5 {
            config[139 + i * 32..171 + i * 32].copy_from_slice(Pubkey::new_unique().as_ref());
        }
        for (offset, value) in [
            (299, 1u64),
            (307, 1),
            (315, 1_512_000),
            (323, 4_500),
            (331, 2_000_000),
            (339, 1),
        ] {
            config[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
        let seats_hash = hashv(&[b"amoeba-council-seats-v1", &config[139..299]]).to_bytes();

        f.ctx.set_account(
            &PINNED_CONTROLLER_CONFIG_PDA,
            &AccountSharedData::from(Account {
                lamports: Rent::default().minimum_balance(config.len()),
                data: config,
                owner: PINNED_CONTROLLER_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            }),
        );
        let mut raw = borsh::to_vec(&bucket).unwrap();
        raw.resize(OracleBucketMedianState::LEN, 0);
        let evidence = hashv(&[b"amoeba-council-evidence-v1", f.bucket.as_ref(), &raw]).to_bytes();
        let case_hash = hashv(&[
            b"amoeba-council-case-v1",
            b"solana-devnet:council-oracle-v1",
            program.as_ref(),
            PINNED_CONTROLLER_CONFIG_PDA.as_ref(),
            f.month.as_ref(),
            f.bucket.as_ref(),
            &bucket.bucket_id,
            &[3, 2, 0],
            &evidence,
            &10u64.to_le_bytes(),
            &10u64.to_le_bytes(),
            &30u64.to_le_bytes(),
        ])
        .to_bytes();
        put(
            &mut f.ctx,
            dispute_key,
            &CouncilCase {
                discriminator: *b"OCC",
                version: 1,
                initialized: true,
                bump: db,
                month: f.month,
                target: f.bucket,
                target_id: bucket.bucket_id,
                case_hash,
                evidence_hash: evidence,
                kind: OracleEmergencyDisputeKind::BucketMedian,
                choices: 2,
                fallback: 0,
                snapshot_slot: 10,
                opened_slot: 10,
                deadline: 30,
                finalized: false,
                outcome: 0,
                reason: 0,
                decision_epoch: 0,
                seat_mask: 0,
                resolved_slot: 0,
            },
            CouncilCase::LEN,
        );
        let (round_key, rb) = Pubkey::find_program_address(
            &[
                CURRENT_STATE_NAMESPACE_SEED,
                b"g3-council-round-v1",
                dispute_key.as_ref(),
                &1u64.to_le_bytes(),
            ],
            &program,
        );
        let ballots = match choice {
            0 => [0, 0, 0, 255, 255],
            1 => [1, 1, 1, 255, 255],
            2 => [0, 0, 1, 1, 255],
            _ => [255; 5],
        };
        put(
            &mut f.ctx,
            round_key,
            &CouncilRound {
                discriminator: *b"OCR",
                version: 1,
                initialized: true,
                bump: rb,
                case: dispute_key,
                epoch: 1,
                seats_hash,
                ballots,
            },
            CouncilRound::LEN,
        );
        let wire = borsh::to_vec(&VaultInstruction::OracleCarryForwardV1 {
            action: OracleCarryForwardActionV1::Council(OracleCouncilActionV1 {
                operation: 2,
                kind: OracleEmergencyDisputeKind::BucketMedian,
                target_id: bucket.bucket_id,
                expected_case_hash: case_hash,
                expected_epoch: 1,
                expected_seats_hash: seats_hash,
                choice: 0,
            }),
        })
        .unwrap();
        let ix = f.ix(
            30,
            &[
                f.admin.pubkey(),
                f.market,
                f.month,
                dispute_key,
                f.bucket,
                PINNED_CONTROLLER_CONFIG_PDA,
                round_key,
                system_program::id(),
            ],
            &[0, 2, 3, 4, 6],
            &wire[1..],
        );
        // The terminal exception is available only after resolution, never for
        // an unresolved court or an insufficient normal/grace population.
        f.send(f.finalize_month(), false).await;
        f.send(ix.clone(), true).await;
        let resolved: CouncilCase = state(&mut f.ctx, dispute_key).await;
        assert!(resolved.finalized);
        assert_eq!(resolved.outcome, if choice == 1 { 1 } else { 0 });
        let snapshot = f
            .ctx
            .banks_client
            .get_account(f.bucket)
            .await
            .unwrap()
            .unwrap();
        f.send(ix, false).await;
        f.send(f.finalize_month(), true).await;
        f.send(f.collect(), true).await;
        if choice == 1 {
            let rejected: OracleBucketMedianState = state(&mut f.ctx, f.bucket).await;
            assert_eq!(rejected.status, OracleBucketMedianStatus::EmergencyRejected);
            assert_eq!(
                snapshot,
                f.ctx
                    .banks_client
                    .get_account(f.bucket)
                    .await
                    .unwrap()
                    .unwrap()
            );
            let month: OracleMonthState = state(&mut f.ctx, f.month).await;
            assert_eq!(
                month.finalized_at_ts,
                EXPIRY + ORACLE_SETTLEMENT_GRACE_SECONDS
            );
        }
        {
            let manifest: OracleSettlementSourceManifest = state(&mut f.ctx, f.terminal).await;
            assert_eq!(manifest.phase, OracleRecipeWeightPhase::Finalized);
            let retained: OracleBucketMedianState = state(&mut f.ctx, f.bucket).await;
            assert_eq!(retained.bucket_delta_bps, 500);
            assert_eq!(retained.last_recomputed_ts, bucket.last_recomputed_ts);
            let month: OracleMonthState = state(&mut f.ctx, f.month).await;
            assert_eq!(month.index_delta_bps, 500);
            f.attested_record_fixture(1).await;
            f.send(f.publish(), true).await;
            f.finalize_and_claim_receipt().await;
        }
    }
}
