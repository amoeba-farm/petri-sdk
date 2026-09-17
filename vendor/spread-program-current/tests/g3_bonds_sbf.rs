//! Focused U07: start from a finalized opening fixture, enter Game, refund both
//! transient bond kinds once, and preserve the previously frozen issuance cap.
#![cfg(feature = "devnet-v3-governance-controller")]
#[allow(dead_code)]
mod g3_light_support;
#[path = "g3_proof_support/mod.rs"]
#[allow(dead_code)]
mod proof;
use borsh::{BorshDeserialize, BorshSerialize};
use g3_light_support::*;
use light_program_test::Rpc;
use light_token_minter::{
    constants::*,
    instruction::{SettleOracleEscrowParams, VaultInstruction},
    state::*,
};
use solana_sdk::{clock::Clock, instruction::AccountMeta};
#[tokio::test]
async fn game_transition_releases_transient_source_bonds_once_without_rewriting_caps() {
    let mut rpc = start().await;
    let payer = rpc.get_payer().insecure_clone();
    let supporter = Keypair::new();
    let now = 1_800_000_000u64;
    let expiry = now + 1_000_000;
    let mut clock = rpc.context.get_sysvar::<Clock>();
    clock.unix_timestamp = now as i64;
    clock.slot = 100000;
    rpc.context.set_sysvar(&clock);
    let mid = [121; 32];
    let sid = [122; 32];
    let bid = [123; 32];
    let (market, mb) = pda(&[MARKET_PDA_SEED, &mid]);
    let (month, ob) = pda(&[
        ORACLE_MONTH_PDA_SEED,
        market.as_ref(),
        &expiry.to_le_bytes(),
    ]);
    let (source, sb) = pda(&[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &sid]);
    let (manifest, ab) = derive_oracle_active_weight_manifest_pda(&program(), &month);
    let (schedule, rb) = derive_oracle_usdc_reward_schedule_pda(&program(), &month);
    let (reward, _) = derive_oracle_usdc_source_reward_pda(&program(), &schedule, &source);
    let support = pda(&[
        ORACLE_SUPPORT_POSITION_PDA_SEED,
        month.as_ref(),
        source.as_ref(),
        supporter.pubkey().as_ref(),
    ])
    .0;
    let (proposer_cash, pc) = pda(&[USER_COLLATERAL_PDA_SEED, payer.pubkey().as_ref()]);
    let (supporter_cash, sc) = pda(&[USER_COLLATERAL_PDA_SEED, supporter.pubkey().as_ref()]);
    install(
        &mut rpc,
        market,
        &Market {
            is_initialized: true,
            bump: mb,
            market_id: mid,
            paused: true,
            mint_accounting: MarketMintAccounting::canonical_empty(),
            instrument: InstrumentDefinition {
                expiry_ts: expiry,
                ..Default::default()
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
            account_discriminator: OracleMonthState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleMonthState::ACCOUNT_VERSION,
            phase: OraclePhase::Opening,
            scramble_start_ts: now - ORACLE_PRE_LISTING_WINDOW_SECONDS,
            listing_ts: now,
            recipe_hash: [7; 32],
            source_count: 1,
            frozen_source_count: 1,
            opened_source_count: 1,
            opening_resolved_source_count: 1,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10000,
            weight_manifest_hash: [8; 32],
            active_weight_manifest_hash: [9; 32],
            active_weight_group_count: 1,
            active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
            ..Default::default()
        },
        OracleMonthState::LEN,
    );
    install(
        &mut rpc,
        manifest,
        &OracleActiveWeightManifest {
            is_initialized: true,
            bump: ab,
            account_discriminator: OracleActiveWeightManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleActiveWeightManifest::ACCOUNT_VERSION,
            month,
            phase: OracleRecipeWeightPhase::Finalized,
            expected_source_count: 1,
            expected_group_count: 1,
            processed_source_count: 1,
            processed_group_count: 1,
            processed_bucket_weight_bps: 10000,
            rolling_manifest_hash: [9; 32],
            max_open_interest_payout: 1234,
            ..Default::default()
        },
        OracleActiveWeightManifest::LEN,
    );
    install(
        &mut rpc,
        schedule,
        &OracleUsdcRewardSchedule {
            is_initialized: true,
            bump: rb,
            account_discriminator: OracleUsdcRewardSchedule::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUsdcRewardSchedule::ACCOUNT_VERSION,
            month,
            authority: payer.pubkey(),
            reward_vault: derive_oracle_usdc_reward_vault_pda(&program()).0,
            phase: OracleUsdcRewardSchedulePhase::Funded,
            outstanding_prelisting_escrow_count: 2,
            ..Default::default()
        },
        OracleUsdcRewardSchedule::LEN,
    );
    for (key, bump, owner, balance) in [
        (proposer_cash, pc, payer.pubkey(), 90),
        (supporter_cash, sc, supporter.pubkey(), 80),
    ] {
        install(
            &mut rpc,
            key,
            &UserCollateral {
                is_initialized: true,
                bump,
                owner,
                available_balance: balance,
                ..Default::default()
            },
            UserCollateral::LEN,
        );
    }
    let state = OracleSourceState {
        is_initialized: true,
        bump: sb,
        month,
        source_id: sid,
        bucket_id: bid,
        source_type_hash: [1; 32],
        canonical_locator_hash: [2; 32],
        source_definition_hash: [3; 32],
        proposer: payer.pubkey(),
        baseline_state: 100,
        current_state: 100,
        listing_bond_locked: 10,
        support_stake_total: 20,
        bucket_weight_bps: 10000,
        status: OracleSourceStatus::Active,
        opening_submitted: true,
        opening_evidence_hash: [4; 32],
        observation_count: 1,
        latest_source_time: now - 1,
        rolling_observation_hash: [6; 32],
        ..Default::default()
    };
    let raw = state.try_to_vec().unwrap();
    let mut compact = raw[34..98].to_vec();
    compact.extend_from_slice(&raw[194..]);
    let mut source_leaf = proof::leaf(CompressedStateDomain::OracleSourceState, source, compact);
    let mut reward_data = vec![0; 112];
    reward_data[..32].copy_from_slice(source.as_ref());
    reward_data[32..36].copy_from_slice(&1u32.to_le_bytes());
    reward_data[36] = 1;
    reward_data[37] = OracleSourceStatus::Active as u8;
    let reward_leaf = proof::leaf(
        CompressedStateDomain::OracleUsdcSourceReward,
        reward,
        reward_data,
    );
    let mut support_data = vec![0; 107];
    support_data[..32].copy_from_slice(source.as_ref());
    support_data[32..64].copy_from_slice(supporter.pubkey().as_ref());
    support_data[64..72].copy_from_slice(&20u64.to_le_bytes());
    support_data[75..].copy_from_slice(&sid);
    let support_leaf = proof::leaf(
        CompressedStateDomain::OracleSupportPosition,
        support,
        support_data,
    );
    proof::seed(
        &mut rpc,
        &payer,
        &[
            source_leaf.clone(),
            reward_leaf.clone(),
            support_leaf.clone(),
        ],
    )
    .await;
    let cap_before = rpc.context.get_account(&manifest).unwrap();
    proof::send(
        &mut rpc,
        &payer,
        govern(
            vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new_readonly(market, false),
                AccountMeta::new(month, false),
                AccountMeta::new_readonly(manifest, false),
            ],
            VaultInstruction::FinalizeOracleOpeningPhase,
        ),
        "transient_bonds_enter_game",
    )
    .unwrap();
    assert_eq!(
        OracleMonthState::deserialize(
            &mut rpc.context.get_account(&month).unwrap().data.as_slice()
        )
        .unwrap()
        .phase,
        OraclePhase::Game
    );
    for kind in [
        OracleEscrowKind::ListingBond,
        OracleEscrowKind::SupportStake,
    ] {
        let listing = kind == OracleEscrowKind::ListingBond;
        let (target, cash, target_leaf) = if listing {
            (reward, proposer_cash, reward_leaf.clone())
        } else {
            (support, supporter_cash, support_leaf.clone())
        };
        let core = vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(market, false),
            AccountMeta::new_readonly(month, false),
            AccountMeta::new(schedule, false),
            AccountMeta::new(source, false),
            AccountMeta::new(target, false),
            AccountMeta::new(cash, false),
        ];
        let inner = VaultInstruction::SettleOracleUsdcEscrow {
            params: SettleOracleEscrowParams { kind },
        }
        .try_to_vec()
        .unwrap();
        let inputs = vec![
            (4, listing, source_leaf.clone()),
            (5, true, target_leaf.clone()),
        ];
        let mut wrong = core.clone();
        wrong[6].pubkey = if listing {
            supporter_cash
        } else {
            proposer_cash
        };
        let before = proof::snapshot(&rpc, &[schedule, proposer_cash, supporter_cash]);
        let ix = proof::mixed_instruction(&rpc, wrong, &inputs, &[], inner.clone()).await;
        assert!(proof::send(&mut rpc, &payer, ix, "transient_bond_wrong_owner").is_err());
        assert_eq!(
            before,
            proof::snapshot(&rpc, &[schedule, proposer_cash, supporter_cash])
        );
        let ix = proof::mixed_instruction(&rpc, core.clone(), &inputs, &[], inner.clone()).await;
        proof::send(
            &mut rpc,
            &payer,
            ix,
            if listing {
                "transient_listing_refund"
            } else {
                "transient_support_refund"
            },
        )
        .unwrap();
        source_leaf = proof::read(&rpc, &source_leaf).await;
        let updated = proof::read(&rpc, &target_leaf).await;
        let ix = proof::mixed_instruction(
            &rpc,
            core,
            &[
                (4, listing, source_leaf.clone()),
                (5, true, updated.clone()),
            ],
            &[],
            inner,
        )
        .await;
        let before = proof::snapshot(&rpc, &[schedule, proposer_cash, supporter_cash]);
        assert!(proof::send(&mut rpc, &payer, ix, "transient_duplicate_refund").is_err());
        assert_eq!(
            before,
            proof::snapshot(&rpc, &[schedule, proposer_cash, supporter_cash])
        );
    }
    for cash in [proposer_cash, supporter_cash] {
        assert_eq!(
            UserCollateral::deserialize(
                &mut rpc.context.get_account(&cash).unwrap().data.as_slice()
            )
            .unwrap()
            .available_balance,
            100
        );
    }
    assert_eq!(rpc.context.get_account(&manifest).unwrap(), cap_before);
    assert_eq!(
        OracleUsdcRewardSchedule::deserialize(
            &mut rpc.context.get_account(&schedule).unwrap().data.as_slice()
        )
        .unwrap()
        .outstanding_prelisting_escrow_count,
        0
    );
}
