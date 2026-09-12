use super::*;

#[test]
fn zero_samba_supply_has_no_voting_power() {
    let mut pool = OracleStakingPool::default();
    assert_eq!(
        prepare_oracle_samba_voting_snapshot(&mut pool, 0, 10),
        Err(ProgramError::Custom(
            VaultError::InsufficientSambaTokens as u32
        ))
    );
}

#[test]
fn samba_exchange_rate_embeds_funded_rewards_and_redeems_final_dust() {
    let mut pool = OracleStakingPool {
        active_amba_backing: 1_000,
        samba_supply: 1_000,
        ..OracleStakingPool::default()
    };
    assert_eq!(calculate_samba_shares_for_amba(&pool, 100), Ok(100));

    pool.active_amba_backing += 100;
    pool.total_rewards_funded += 100;
    assert_eq!(calculate_samba_shares_for_amba(&pool, 100), Ok(90));
    assert_eq!(calculate_amba_for_samba_shares(&pool, 500), Ok(550));
    assert_eq!(
        calculate_amba_for_samba_shares(&pool, pool.samba_supply),
        Ok(pool.active_amba_backing)
    );
}

#[test]
fn staking_lifetime_reward_metric_saturates_without_blocking_backing() {
    let mut pool = OracleStakingPool {
        active_amba_backing: 1_000,
        samba_supply: 1_000,
        total_rewards_funded: u64::MAX - 5,
        ..OracleStakingPool::default()
    };

    credit_oracle_staking_backing(&mut pool, 10, 77).unwrap();

    assert_eq!(pool.active_amba_backing, 1_010);
    assert_eq!(pool.total_rewards_funded, u64::MAX);
    assert_eq!(pool.last_updated_slot, 77);
}

#[test]
fn external_samba_burns_donate_or_quarantine_backing() {
    let mut pool = OracleStakingPool {
        active_amba_backing: 1_100,
        samba_supply: 1_000,
        ..OracleStakingPool::default()
    };
    synchronize_oracle_samba_supply(&mut pool, 900).unwrap();
    assert_eq!(pool.active_amba_backing, 1_100);
    assert_eq!(pool.samba_supply, 900);
    assert_eq!(calculate_amba_for_samba_shares(&pool, 90), Ok(110));

    synchronize_oracle_samba_supply(&mut pool, 0).unwrap();
    assert_eq!(pool.active_amba_backing, 0);
    assert_eq!(pool.samba_supply, 0);
    assert_eq!(pool.orphaned_amba_backing, 1_100);
    assert_eq!(calculate_samba_shares_for_amba(&pool, 25), Ok(25));
}

#[test]
fn reward_funnel_allocation_is_fixed_and_reserve_absorbs_dust_or_inactive_staking() {
    assert_eq!(
        calculate_oracle_reward_allocation(1_000_000, true).unwrap(),
        OracleRewardAllocation {
            game: 450_000,
            scramble: 200_000,
            challenge: 150_000,
            staking: 150_000,
            reserve: 50_000,
        }
    );
    assert_eq!(
        calculate_oracle_reward_allocation(7, true).unwrap(),
        OracleRewardAllocation {
            game: 3,
            scramble: 1,
            challenge: 1,
            staking: 1,
            reserve: 1,
        }
    );
    assert_eq!(
        calculate_oracle_reward_allocation(1_001, false).unwrap(),
        OracleRewardAllocation {
            game: 450,
            scramble: 200,
            challenge: 150,
            staking: 0,
            reserve: 201,
        }
    );
    let maximum = calculate_oracle_reward_allocation(u64::MAX, true).unwrap();
    assert_eq!(maximum.total().unwrap(), u64::MAX);
}

#[test]
fn samba_unstake_is_ready_at_the_exact_seven_day_boundary() {
    let requested_at = 1_000_000u64;
    let request = OracleUnstakeRequest {
        pending_amba: 500,
        claimable_at_ts: requested_at + ORACLE_SAMBA_UNBONDING_SECONDS,
        ..OracleUnstakeRequest::default()
    };
    assert_eq!(
        ensure_oracle_unstake_ready_at(&request, request.claimable_at_ts - 1),
        Err(ProgramError::Custom(
            VaultError::UnstakeCooldownActive as u32
        ))
    );
    assert_eq!(
        ensure_oracle_unstake_ready_at(&request, request.claimable_at_ts),
        Ok(())
    );
    assert_eq!(
        ensure_oracle_unstake_ready_at(&request, request.claimable_at_ts + 1),
        Ok(())
    );
}

#[test]
fn queued_samba_stake_activates_only_at_the_exact_seven_day_boundary() {
    let queued_at = 1_000_000u64;
    let activation = OracleStakeActivation {
        queued_amba: 500,
        activate_after_ts: queued_at + ORACLE_SAMBA_STAKE_ACTIVATION_SECONDS,
        ..OracleStakeActivation::default()
    };
    assert_eq!(
        ensure_oracle_stake_activation_ready_at(&activation, activation.activate_after_ts - 1,),
        Err(ProgramError::Custom(
            VaultError::StakeActivationCooldownActive as u32
        ))
    );
    assert_eq!(
        ensure_oracle_stake_activation_ready_at(&activation, activation.activate_after_ts),
        Ok(())
    );
    assert_eq!(
        ensure_oracle_stake_activation_ready_at(&activation, activation.activate_after_ts + 1),
        Ok(())
    );
}

#[test]
fn settlement_grace_uses_exact_checked_expiry_boundary() {
    let expiry = 1_000_000u64;
    let ready_at = expiry + ORACLE_SETTLEMENT_GRACE_SECONDS;
    for now in [expiry - 1, expiry, ready_at - 1] {
        assert_eq!(
            ensure_settlement_finalization_ready_at(expiry, now),
            Err(ProgramError::Custom(
                VaultError::SettlementGracePeriodActive as u32,
            ))
        );
    }
    assert_eq!(
        ensure_settlement_finalization_ready_at(expiry, ready_at),
        Ok(())
    );
    assert_eq!(
        ensure_settlement_finalization_ready_at(expiry, ready_at + 1),
        Ok(())
    );
    assert_eq!(
        settlement_finalization_timestamp(u64::MAX),
        Err(ProgramError::Custom(VaultError::ArithmeticOverflow as u32))
    );
    assert_eq!(
        ensure_settlement_timestamp_matches_expiry(expiry, expiry),
        Ok(())
    );
    for forged in [expiry - 1, expiry + 1] {
        assert_eq!(
            ensure_settlement_timestamp_matches_expiry(expiry, forged),
            Err(ProgramError::Custom(
                VaultError::InvalidSettlementRecord as u32,
            ))
        );
    }
}

#[test]
fn rulebook_schedule_is_exactly_four_two_one_then_opening() {
    let scramble_start_ts = 1_000_000u64;
    let month = OracleMonthState {
        scramble_start_ts,
        listing_ts: scramble_start_ts + ORACLE_PRE_LISTING_WINDOW_SECONDS,
        ..OracleMonthState::default()
    };
    let (placement_end, kill_end, scramble_end) = rulebook_schedule_boundaries(&month).unwrap();

    assert_eq!(
        placement_end,
        scramble_start_ts + 4 * crate::constants::ORACLE_CALENDAR_DAY_SECONDS
    );
    assert_eq!(
        kill_end,
        scramble_start_ts + 6 * crate::constants::ORACLE_CALENDAR_DAY_SECONDS
    );
    assert_eq!(
        scramble_end,
        scramble_start_ts + 7 * crate::constants::ORACLE_CALENDAR_DAY_SECONDS
    );
    assert_eq!(
        month.listing_ts,
        scramble_end + ORACLE_OPENING_WINDOW_SECONDS
    );
}
