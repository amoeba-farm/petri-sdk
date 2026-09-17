// Native classic-view fixture only. Governed production execution is exercised by the G3 SBF suites.
#![cfg(not(feature = "governance-gate-v1"))]
use borsh::{BorshDeserialize, BorshSerialize};
use light_token::instruction::LIGHT_TOKEN_PROGRAM_ID;
use light_token_minter::{
    constants::{
        CONTRACT_MINT_PDA_SEED, CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED,
        ORACLE_CALENDAR_DAY_SECONDS, ORACLE_KILL_WINDOW_SECONDS, ORACLE_MONTH_PDA_SEED,
        ORACLE_OPENING_ARCHIVE_URL_HASH_DOMAIN, ORACLE_OPENING_CLAIM_CHALLENGE_PDA_SEED,
        ORACLE_OPENING_CLAIM_PDA_SEED, ORACLE_OPENING_EVIDENCE_HASH_DOMAIN,
        ORACLE_PLACEMENT_WINDOW_SECONDS, ORACLE_PLAYER_LEDGER_PDA_SEED,
        ORACLE_PRE_LISTING_WINDOW_SECONDS, ORACLE_SCRAMBLE_WINDOW_SECONDS,
        ORACLE_SETTLEMENT_GRACE_SECONDS, ORACLE_SOURCE_CHALLENGE_PDA_SEED,
        ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, ORACLE_SOURCE_PDA_SEED, ORACLE_TREASURY_PDA_SEED,
        ORACLE_UPDATE_CHALLENGE_PDA_SEED, ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS,
        ORACLE_UPDATE_REVEAL_WINDOW_SLOTS, SETTLEMENT_V2_PDA_SEED, USER_COLLATERAL_PDA_SEED,
        VAULT_PDA_SEED,
    },
    error::VaultError,
    instruction::{
        ChallengeOracleUpdateClaimParams, InitMarketV2Params, ResolveOracleSourceChallengeParams,
        SetMarketPausedParams, SettleOracleEscrowParams, VaultInstruction, VaultInstructionTag,
    },
    processor::{
        process_instruction as process_production_instruction,
        process_instruction_with_classic_compression_views_for_tests,
        ClassicCompressionTestCapability,
    },
    state::{
        derive_oracle_active_weight_manifest_pda, derive_oracle_bucket_median_pda,
        derive_oracle_sku_coverage_manifest_pda, derive_oracle_update_claim_v2_pda,
        InstrumentDefinition, Market, MarketMintAccounting, MarketParameters, OptionKind,
        OracleActiveWeightManifest, OracleBucketMedianState, OracleBucketMedianStatus,
        OracleChallengeStatus, OracleClaimStatus, OracleEmergencyDisputeKind,
        OracleEscrowDisposition, OracleEscrowKind, OracleMonthState, OracleOpeningClaim,
        OracleOpeningClaimChallenge, OracleOpeningClaimStatus, OraclePhase,
        OracleRecipeWeightPhase, OracleSettlementStatus, OracleSkuCoverageManifest,
        OracleSourceChallenge, OracleSourceChallengeOutcome, OracleSourceObservations,
        OracleSourceState, OracleSourceStatus, OracleUpdateChallenge, OracleUpdateChallengeGuard,
        OracleUpdateClaimData, OracleUpdateClaimV2, SettlementRecordV2, SettlementStyle,
        UserCollateral, VaultConfig,
    },
};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, hash::hashv, program_error::ProgramError,
    program_option::COption, program_pack::Pack,
};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::AccountSharedData,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use solana_system_interface::instruction as system_instruction;
use spl_token::{
    instruction as token_instruction,
    state::{Account as TokenAccountState, AccountState, Mint},
};

#[path = "mint/collateral.rs"]
mod collateral;
#[path = "mint/contract_custody.rs"]
mod contract_custody;
#[path = "mint/market_creation.rs"]
mod market_creation;
#[path = "mint/market_reinitialization.rs"]
mod market_reinitialization;
#[path = "mint/opening_cleanup.rs"]
mod opening_cleanup;
#[path = "mint/oracle_instruction_helpers.rs"]
mod oracle_instruction_helpers;
#[path = "mint/program_test_helpers.rs"]
mod program_test_helpers;
#[path = "mint/recipe_instruction_helpers.rs"]
mod recipe_instruction_helpers;
#[path = "mint/settlement_identity.rs"]
mod settlement_identity;
#[path = "mint/source_coverage.rs"]
mod source_coverage;
#[path = "mint/stale_updates.rs"]
mod stale_updates;
#[path = "mint/update_challenges.rs"]
mod update_challenges;
#[path = "mint/vault_config.rs"]
mod vault_config;
#[path = "mint/vault_instruction_helpers.rs"]
mod vault_instruction_helpers;

use oracle_instruction_helpers::*;
use program_test_helpers::*;
use recipe_instruction_helpers::*;
use vault_instruction_helpers::*;

fn find_current_program_address(seeds: &[&[u8]], program_id: &Pubkey) -> (Pubkey, u8) {
    if seeds.first().copied() == Some(CURRENT_STATE_NAMESPACE_SEED) {
        return Pubkey::find_program_address(seeds, program_id);
    }

    let mut namespaced_seeds = Vec::with_capacity(seeds.len() + 1);
    namespaced_seeds.push(CURRENT_STATE_NAMESPACE_SEED);
    namespaced_seeds.extend_from_slice(seeds);
    Pubkey::find_program_address(&namespaced_seeds, program_id)
}

fn stamp_current_oracle_month(mut month: OracleMonthState) -> OracleMonthState {
    month.account_discriminator = OracleMonthState::ACCOUNT_DISCRIMINATOR;
    month.account_version = OracleMonthState::ACCOUNT_VERSION;
    month
}

struct Harness {
    context: ProgramTestContext,
    usdc_mint: Pubkey,
    usdc_mint_authority: Keypair,
    vault_pda: Pubkey,
    vault_token_account: Pubkey,
    user: Keypair,
    user_token_account: Pubkey,
    attacker: Keypair,
}

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.first().copied() {
        Some(tag)
            if (220..=255).contains(&tag)
                || light_token_minter::ameba_dlmm_instruction::AmoebaDlmmInstructionTag::from_byte(
                    tag,
                )
                .is_some() =>
        {
            process_production_instruction(program_id, accounts, instruction_data)
        }
        _ => process_instruction_with_classic_compression_views_for_tests(
            program_id,
            accounts,
            instruction_data,
            &ClassicCompressionTestCapability::for_native_program_test(),
        ),
    }
}

fn fake_light_token_process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.first().copied() {
        Some(12) => {
            if instruction_data.len() < 10 || accounts.len() < 3 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let amount = u64::from_le_bytes(
                instruction_data[1..9]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidInstructionData)?,
            );
            move_test_token_amount(&accounts[0], &accounts[2], amount)
        }
        Some(101) => {
            // The production Light Token CPI encodes two compression records. The first record
            // starts at byte 14 and identifies the direction: 0 compresses classic SPL into a
            // Light account, 1 decompresses Light into classic SPL. This fake mirrors the three
            // physical amount deltas needed by program-test without pretending to validate the
            // Light proof system itself.
            if instruction_data.len() < 30 || accounts.len() < 7 {
                return Err(ProgramError::InvalidInstructionData);
            }
            let mode = instruction_data[14];
            let amount = u64::from_le_bytes(
                instruction_data[15..23]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidInstructionData)?,
            );
            match mode {
                0 => {
                    // accounts[5] classic source -> accounts[3] Light destination, with the
                    // corresponding atoms entering accounts[6] SPL-interface custody.
                    let transfer = token_instruction::transfer_checked(
                        &spl_token::id(),
                        accounts[5].key,
                        accounts[2].key,
                        accounts[6].key,
                        accounts[4].key,
                        &[],
                        amount,
                        instruction_data[29],
                    )?;
                    solana_program::program::invoke(
                        &transfer,
                        &[
                            accounts[5].clone(),
                            accounts[2].clone(),
                            accounts[6].clone(),
                            accounts[4].clone(),
                            accounts[7].clone(),
                        ],
                    )?;
                    credit_test_token_amount(&accounts[3], amount)?;
                    Ok(())
                }
                1 => {
                    // accounts[3] Light source -> accounts[4] classic destination, with the
                    // corresponding atoms leaving accounts[6] SPL-interface custody.
                    debit_test_token_amount(&accounts[3], amount)?;
                    debit_test_token_amount(&accounts[6], amount)?;
                    credit_test_token_amount(&accounts[4], amount)
                }
                _ => Err(ProgramError::InvalidInstructionData),
            }
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn move_test_token_amount(
    source: &AccountInfo,
    destination: &AccountInfo,
    amount: u64,
) -> ProgramResult {
    debit_test_token_amount(source, amount)?;
    credit_test_token_amount(destination, amount)
}

fn debit_test_token_amount(account: &AccountInfo, amount: u64) -> ProgramResult {
    let current = light_token_account_amount(account)?;
    let next = current
        .checked_sub(amount)
        .ok_or(ProgramError::InsufficientFunds)?;
    write_light_token_account_amount(account, next)
}

fn credit_test_token_amount(account: &AccountInfo, amount: u64) -> ProgramResult {
    let current = light_token_account_amount(account)?;
    let next = current
        .checked_add(amount)
        .ok_or(ProgramError::InvalidAccountData)?;
    write_light_token_account_amount(account, next)
}

fn light_token_account_amount(account: &AccountInfo) -> Result<u64, ProgramError> {
    let data = account.try_borrow_data()?;
    if data.len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(u64::from_le_bytes(
        data[64..72]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    ))
}

fn write_light_token_account_amount(account: &AccountInfo, amount: u64) -> ProgramResult {
    let mut data = account.try_borrow_mut_data()?;
    if data.len() < 72 {
        return Err(ProgramError::InvalidAccountData);
    }
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    Ok(())
}

struct OracleUpdateSecurityFixture {
    admin: Pubkey,
    market: Pubkey,
    month: Pubkey,
    source: Pubkey,
    claim: Pubkey,
    claim_id: [u8; 32],
}

async fn setup_oracle_update_security_fixture(
    harness: &mut Harness,
    seed: u8,
) -> OracleUpdateSecurityFixture {
    let program_id = light_token_minter::id();
    let admin = harness.context.payer.pubkey();
    let attacker = harness.attacker.pubkey();
    let clock = harness
        .context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let expiry_ts = u64::try_from(clock.unix_timestamp).unwrap() + 10_000;
    let market_id = [seed; 32];
    let source_id = [seed.wrapping_add(1); 32];
    let claim_id = [seed.wrapping_add(2); 32];
    let bucket_id = [seed.wrapping_add(6); 32];
    let (market, market_bump) =
        find_current_program_address(&[MARKET_PDA_SEED, &market_id], &program_id);
    let (month, month_bump) = find_current_program_address(
        &[
            ORACLE_MONTH_PDA_SEED,
            market.as_ref(),
            &expiry_ts.to_le_bytes(),
        ],
        &program_id,
    );
    let (source, source_bump) = find_current_program_address(
        &[ORACLE_SOURCE_PDA_SEED, month.as_ref(), &source_id],
        &program_id,
    );
    let (observations, observations_bump) = find_current_program_address(
        &[ORACLE_SOURCE_OBSERVATIONS_PDA_SEED, source.as_ref()],
        &program_id,
    );
    let (active_manifest, active_manifest_bump) =
        derive_oracle_active_weight_manifest_pda(&program_id, &month);
    let (bucket, bucket_bump) = derive_oracle_bucket_median_pda(&program_id, &month, &bucket_id);
    let (claim, claim_bump) =
        derive_oracle_update_claim_v2_pda(&program_id, &month, &source, &admin, &claim_id);
    let (attacker_ledger, attacker_ledger_bump) = find_current_program_address(
        &[ORACLE_PLAYER_LEDGER_PDA_SEED, attacker.as_ref()],
        &program_id,
    );

    let recipe_hash = [seed.wrapping_add(4); 32];
    let frozen_manifest_hash = [seed.wrapping_add(5); 32];
    let active_manifest_hash = [seed.wrapping_add(8); 32];
    set_program_state(
        &mut harness.context,
        market,
        &Market {
            is_initialized: true,
            bump: market_bump,
            created_by: admin,
            market_id,
            collateral_mint: harness.usdc_mint,
            long_contract_mint: None,
            instrument: InstrumentDefinition {
                underlying_id: [seed.wrapping_add(3); 32],
                expiry_ts,
                strike_price: 100_000_000,
                cap_price: 125_000_000,
                contract_size: 10,
                max_payout_per_contract: 250,
                kind: OptionKind::CallSpread,
                settlement: SettlementStyle::CashSettledMonthly,
            },
            params: MarketParameters {
                tick_size: 1,
                lot_size: 10,
                min_order_qty: 10,
                min_cancel_slots: 0,
                max_fills_per_instruction: 1,
            },
            total_position_collateral_locked: 0,
            paused: false,
            mint_accounting: MarketMintAccounting::canonical_empty(),
        },
        Market::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        month,
        &stamp_current_oracle_month(OracleMonthState {
            is_initialized: true,
            bump: month_bump,
            market,
            authority: admin,
            scramble_start_ts: 1,
            listing_ts: 1 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            phase: OraclePhase::Game,
            source_count: 1,
            frozen_source_count: 1,
            opened_source_count: 1,
            opening_resolved_source_count: 1,
            recipe_hash,
            pending_resolution_count: 1,
            weight_scheme_version: 1,
            effective_weight_total_bps: 10_000,
            weight_manifest_hash: frozen_manifest_hash,
            active_weight_scheme_version: OracleMonthState::ACTIVE_MEDIAN_SCHEME_VERSION,
            active_weight_group_count: 1,
            active_weight_manifest_hash: active_manifest_hash,
            ..OracleMonthState::default()
        }),
        OracleMonthState::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        active_manifest,
        &OracleActiveWeightManifest {
            is_initialized: true,
            bump: active_manifest_bump,
            account_discriminator: OracleActiveWeightManifest::ACCOUNT_DISCRIMINATOR,
            account_version: OracleActiveWeightManifest::ACCOUNT_VERSION,
            month,
            phase: OracleRecipeWeightPhase::Finalized,
            expected_source_count: 1,
            expected_group_count: 1,
            processed_source_count: 1,
            processed_group_count: 1,
            processed_bucket_weight_bps: 10_000,
            rolling_manifest_hash: active_manifest_hash,
            max_open_interest_payout: 125,
            ..OracleActiveWeightManifest::default()
        },
        OracleActiveWeightManifest::LEN,
    )
    .await;
    let mut observation_states =
        [0u64; light_token_minter::constants::MAX_ORACLE_SOURCE_OBSERVATIONS];
    observation_states[0] = 100_000_000;
    let mut observation_times =
        [0u64; light_token_minter::constants::MAX_ORACLE_SOURCE_OBSERVATIONS];
    observation_times[0] = 900_000;
    set_program_state(
        &mut harness.context,
        source,
        &OracleSourceState {
            is_initialized: true,
            bump: source_bump,
            month,
            source_id,
            bucket_id,
            proposer: admin,
            canonical_locator_hash: hashv(&[b"locator", b"https://example.com/feed"]).to_bytes(),
            source_definition_hash: [seed.wrapping_add(9); 32],
            baseline_state: 100_000_000,
            current_state: 100_000_000,
            listing_bond_locked: 100,
            support_stake_total: 10_000,
            bucket_weight_bps: 10_000,
            status: OracleSourceStatus::Active,
            opening_submitted: true,
            observation_count: 1,
            rolling_observation_hash: [seed.wrapping_add(10); 32],
            ..OracleSourceState::default()
        },
        OracleSourceState::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        observations,
        &OracleSourceObservations {
            is_initialized: true,
            bump: observations_bump,
            account_discriminator: OracleSourceObservations::ACCOUNT_DISCRIMINATOR,
            account_version: OracleSourceObservations::ACCOUNT_VERSION,
            month,
            source,
            states: observation_states,
            source_times: observation_times,
        },
        OracleSourceObservations::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        bucket,
        &OracleBucketMedianState {
            is_initialized: true,
            bump: bucket_bump,
            account_discriminator: OracleBucketMedianState::ACCOUNT_DISCRIMINATOR,
            account_version: OracleBucketMedianState::ACCOUNT_VERSION,
            month,
            bucket_id,
            bucket_weight_bps: 10_000,
            frozen_source_count: 1,
            active_source_count: 1,
            eligible_source_count: 1,
            status: OracleBucketMedianStatus::Live,
            bucket_delta_bps: 0,
            last_recomputed_ts: u64::try_from(clock.unix_timestamp).unwrap(),
            source_snapshot_hash: [seed.wrapping_add(11); 32],
            ..OracleBucketMedianState::default()
        },
        OracleBucketMedianState::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        claim,
        &OracleUpdateClaimV2 {
            claim: OracleUpdateClaimData {
                is_initialized: true,
                bump: claim_bump,
                account_discriminator: OracleUpdateClaimV2::ACCOUNT_DISCRIMINATOR,
                account_version: OracleUpdateClaimV2::ACCOUNT_VERSION,
                month,
                claim_id,
                source,
                source_id,
                claimant: admin,
                prior_state: 100_000_000,
                new_state: 105_000_000,
                source_time: 1,
                stake: 100,
                status: OracleClaimStatus::Revealed,
                evidence_hash: [seed.wrapping_add(7); 32],
                archive_url_hash: [seed.wrapping_add(8); 32],
                escrow_disposition: OracleEscrowDisposition::Unsettled,
            },
            commit_hash: [201u8; 32],
            commit_slot: 1,
            earliest_reveal_slot: 1 + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS,
            reveal_deadline_slot: 1
                + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS
                + ORACLE_UPDATE_REVEAL_WINDOW_SLOTS,
            revealed_slot: 1 + ORACLE_UPDATE_MIN_REVEAL_DELAY_SLOTS,
            council_review_pending: false,
            freshness_reward_multiplier: 1,
            revealed_at_ts: 1,
            prior_finalized_step: 0,
        },
        OracleUpdateClaimV2::LEN,
    )
    .await;

    OracleUpdateSecurityFixture {
        admin,
        market,
        month,
        source,
        claim,
        claim_id,
    }
}

async fn set_oracle_update_security_checkpoint(
    harness: &mut Harness,
    fixture: OracleUpdateSecurityFixture,
    council_review_pending: bool,
) -> OracleUpdateSecurityFixture {
    let mut claim: OracleUpdateClaimV2 =
        read_program_state(&mut harness.context, fixture.claim).await;
    claim.council_review_pending = council_review_pending;
    set_program_state(
        &mut harness.context,
        fixture.claim,
        &claim,
        OracleUpdateClaimV2::LEN,
    )
    .await;
    fixture
}

async fn install_current_update_challenge_for_test(
    harness: &mut Harness,
    fixture: &OracleUpdateSecurityFixture,
    challenge_id: [u8; 32],
    status: OracleChallengeStatus,
    snapshot_samba_supply: u64,
    resolution_step: u64,
    active_dispute: Pubkey,
) -> (Pubkey, Pubkey) {
    let program_id = light_token_minter::id();
    let clock = harness
        .context
        .banks_client
        .get_sysvar::<solana_sdk::clock::Clock>()
        .await
        .unwrap();
    let (challenge, challenge_bump) = find_current_program_address(
        &[
            CURRENT_STATE_NAMESPACE_SEED,
            ORACLE_UPDATE_CHALLENGE_PDA_SEED,
            fixture.month.as_ref(),
            fixture.claim.as_ref(),
            &challenge_id,
        ],
        &program_id,
    );
    let (guard, guard_bump) = light_token_minter::state::derive_oracle_update_challenge_guard_pda(
        &program_id,
        &fixture.month,
        &fixture.claim,
    );
    set_program_state(
        &mut harness.context,
        challenge,
        &OracleUpdateChallenge {
            is_initialized: true,
            bump: challenge_bump,
            month: fixture.month,
            challenge_id,
            claim: fixture.claim,
            claim_id: fixture.claim_id,
            challenger: harness.attacker.pubkey(),
            alternative_state: 99_000_000,
            alternative_source_time: 1,
            bond: 250,
            required_bond: 250,
            status,
            evidence_hash: [challenge_id[0].wrapping_add(1); 32],
            archive_url_hash: [challenge_id[0].wrapping_add(2); 32],
            rule_review_slot: clock.slot,
            escrow_disposition: OracleEscrowDisposition::Unsettled,
            account_discriminator: OracleUpdateChallenge::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUpdateChallenge::ACCOUNT_VERSION,
            council_authority_version: if snapshot_samba_supply > 0 { 1 } else { 0 },
        },
        OracleUpdateChallenge::LEN,
    )
    .await;
    set_program_state(
        &mut harness.context,
        guard,
        &OracleUpdateChallengeGuard {
            is_initialized: true,
            bump: guard_bump,
            account_discriminator: OracleUpdateChallengeGuard::ACCOUNT_DISCRIMINATOR,
            account_version: OracleUpdateChallengeGuard::ACCOUNT_VERSION,
            month: fixture.month,
            claim: fixture.claim,
            claim_id: fixture.claim_id,
            challenge,
            challenge_id,
            active_dispute,
            resolution_step,
            created_slot: clock.slot,
            last_updated_slot: clock.slot,
        },
        OracleUpdateChallengeGuard::LEN,
    )
    .await;
    (challenge, guard)
}

async fn install_user_collateral_for_test(
    context: &mut ProgramTestContext,
    owner: Pubkey,
    available_balance: u64,
) -> Pubkey {
    let program_id = light_token_minter::id();
    let (collateral, bump) =
        find_current_program_address(&[USER_COLLATERAL_PDA_SEED, owner.as_ref()], &program_id);
    set_program_state(
        context,
        collateral,
        &UserCollateral {
            is_initialized: true,
            bump,
            owner,
            available_balance,
            ..UserCollateral::default()
        },
        UserCollateral::LEN,
    )
    .await;
    collateral
}

fn cancel_stale_update_instruction(
    program_id: Pubkey,
    cranker: Pubkey,
    fixture: &OracleUpdateSecurityFixture,
    guard: Pubkey,
    challenge: Option<Pubkey>,
    staking_pool: Option<Pubkey>,
) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(cranker, true),
        AccountMeta::new_readonly(fixture.market, false),
        AccountMeta::new(fixture.month, false),
        AccountMeta::new_readonly(fixture.source, false),
        AccountMeta::new(fixture.claim, false),
        if challenge.is_some() {
            AccountMeta::new(guard, false)
        } else {
            AccountMeta::new_readonly(guard, false)
        },
    ];
    if let Some(challenge) = challenge {
        accounts.push(AccountMeta::new(challenge, false));
    }
    if let Some(staking_pool) = staking_pool {
        accounts.push(AccountMeta::new(staking_pool, false));
    }
    Instruction {
        program_id,
        accounts,
        data: VaultInstruction::CancelStaleOracleUpdateClaimV2
            .try_to_vec()
            .unwrap(),
    }
}

async fn setup_harness() -> Harness {
    let mut program_test = ProgramTest::new(
        "light_token_minter",
        light_token_minter::id(),
        processor!(process_instruction),
    );
    program_test.add_program(
        "fake_light_token",
        LIGHT_TOKEN_PROGRAM_ID,
        processor!(fake_light_token_process_instruction),
    );
    program_test.add_program(
        "spl_associated_token_account",
        spl_associated_token_account::id(),
        processor!(spl_associated_token_account::processor::process_instruction),
    );
    program_test.prefer_bpf(false);

    let mut context = program_test.start_with_context().await;

    let mint_authority = Keypair::new();
    let usdc_mint = create_mint(&mut context, &mint_authority.pubkey(), 6).await;

    let (vault_pda, _) = find_current_program_address(&[VAULT_PDA_SEED], &light_token_minter::id());
    let vault_token_account = create_token_account(&mut context, &usdc_mint, &vault_pda).await;
    let admin = context.payer.pubkey();

    set_program_state(
        &mut context,
        vault_pda,
        &VaultConfig {
            is_initialized: true,
            bump: find_current_program_address(&[VAULT_PDA_SEED], &light_token_minter::id()).1,
            admin,
            oracle_authority: admin,
            usdc_mint,
            vault_token_account,
            paused: false,
            account_discriminator: VaultConfig::ACCOUNT_DISCRIMINATOR,
            account_version: VaultConfig::ACCOUNT_VERSION,
        },
        VaultConfig::LEN,
    )
    .await;

    let config_account = context
        .banks_client
        .get_account(vault_pda)
        .await
        .unwrap()
        .expect("vault config must exist");
    let config = VaultConfig::try_from_slice(&config_account.data).expect("valid config state");
    assert_eq!(config.usdc_mint, usdc_mint);
    assert_eq!(config.vault_token_account, vault_token_account);
    assert_eq!(config.admin, admin);

    let user = Keypair::new();
    let user_token_account = create_token_account(&mut context, &usdc_mint, &user.pubkey()).await;
    mint_to(
        &mut context,
        &usdc_mint,
        &user_token_account,
        &mint_authority,
        2_000_000,
    )
    .await;

    let attacker = Keypair::new();

    Harness {
        context,
        usdc_mint,
        usdc_mint_authority: mint_authority,
        vault_pda,
        vault_token_account,
        user,
        user_token_account,
        attacker,
    }
}

fn assert_custom_error(error: BanksClientError, expected: VaultError) {
    match error {
        BanksClientError::TransactionError(tx_error) => match tx_error {
            solana_sdk::transaction::TransactionError::InstructionError(_, instruction_error) => {
                match instruction_error {
                    solana_sdk::instruction::InstructionError::Custom(code) => {
                        assert_eq!(code, expected as u32);
                    }
                    other => panic!("expected custom error {}, got {other:?}", expected as u32),
                }
            }
            other => panic!("expected instruction error, got {other:?}"),
        },
        other => panic!("expected transaction error, got {other:?}"),
    }
}

fn assert_instruction_error(
    error: BanksClientError,
    expected: solana_sdk::instruction::InstructionError,
) {
    match error {
        BanksClientError::TransactionError(
            solana_sdk::transaction::TransactionError::InstructionError(_, actual),
        ) => assert_eq!(actual, expected),
        other => panic!("expected instruction error {expected:?}, got {other:?}"),
    }
}
