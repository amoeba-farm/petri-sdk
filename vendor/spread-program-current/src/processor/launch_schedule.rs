//! Mainnet-only timing opt-in. No demo identities, source shortcuts or risk overrides.
use super::*;

pub(super) const LAUNCH_SCHEDULE_VERSION: u8 = 3;
pub(super) const LAUNCH_PHASE_SECONDS: u64 = 3_600;
const SEED: &[u8] = b"g3-launch-clock-v1";

pub(super) fn schedule_windows(month: &OracleMonthState) -> Result<[u64; 4], ProgramError> {
    match month.schedule_version {
        OracleMonthState::SKU_COVERAGE_SCHEDULE_VERSION => Ok([
            ORACLE_PLACEMENT_WINDOW_SECONDS,
            ORACLE_KILL_WINDOW_SECONDS,
            ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS,
            ORACLE_OPENING_WINDOW_SECONDS,
        ]),
        LAUNCH_SCHEDULE_VERSION if cfg!(feature = "mainnet-v3") => Ok([LAUNCH_PHASE_SECONDS; 4]),
        _ => Err(VaultError::InvalidOracleState.into()),
    }
}

pub(super) fn schedule_total(month: &OracleMonthState) -> Result<u64, ProgramError> {
    schedule_windows(month)?
        .into_iter()
        .try_fold(0u64, |sum, x| {
            sum.checked_add(x)
                .ok_or(VaultError::ArithmeticOverflow.into())
        })
}

pub(super) fn schedule_review_seconds(month: &OracleMonthState) -> Result<u64, ProgramError> {
    let w = schedule_windows(month)?;
    w[1].checked_add(w[2])
        .and_then(|x| x.checked_add(w[3]))
        .ok_or(VaultError::ArithmeticOverflow.into())
}

pub(super) fn validate_launch_market(market: &Market) -> ProgramResult {
    let product = if padded_ascii_underlying_matches(
        &market.instrument.underlying_id,
        b"ram-standardized-baskets",
    ) {
        "RAMX"
    } else if padded_ascii_underlying_matches(
        &market.instrument.underlying_id,
        b"nand-standardized-baskets",
    ) {
        "NANDX"
    } else {
        return Err(VaultError::InvalidOracleState.into());
    };
    let month = match market.instrument.expiry_ts {
        1_790_812_800 => "202609",
        1_793_491_200 => "202610",
        _ => return Err(VaultError::InvalidOracleState.into()),
    };
    let side = match market.instrument.kind {
        crate::state::OptionKind::CallSpread => "CALL",
        crate::state::OptionKind::PutSpread => "PUT",
    };
    let id = format!("{product}-{month}-{side}-01");
    if !cfg!(feature = "mainnet-v3")
        || !padded_ascii_underlying_matches(&market.market_id, id.as_bytes())
    {
        return Err(VaultError::InvalidOracleState.into());
    }
    Ok(())
}

/// Tag 181's explicit (0,0) schedule selector uses account 8 as a cohort clock,
/// not the ordinary ladder. This immutable 54-byte PDA is shared by call and put.
#[inline(never)]
pub(super) fn initialize_launch_clock<'a>(
    program_id: &Pubkey,
    market: &Market,
    payer: &AccountInfo<'a>,
    clock_info: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    now: u64,
) -> Result<(u64, u64), ProgramError> {
    validate_launch_market(market)?;
    if !market.paused
        || market.long_contract_mint.is_none()
        || market.mint_accounting != MarketMintAccounting::canonical_empty()
    {
        return Err(VaultError::InvalidOracleState.into());
    }
    let expiry = market.instrument.expiry_ts.to_le_bytes();
    let underlying = &market.instrument.underlying_id;
    let (key, bump) = Pubkey::find_program_address(
        &[CURRENT_STATE_NAMESPACE_SEED, SEED, underlying, &expiry],
        program_id,
    );
    if *clock_info.key != key || clock_info.executable {
        return Err(VaultError::InvalidPda.into());
    }
    let start = if clock_info.owner == program_id {
        let d = clock_info.try_borrow_data()?;
        if d.len() != 54
            || d[..6] != [b'L', b'C', b'K', 1, 1, bump]
            || d[6..38] != underlying[..]
            || d[38..46] != expiry
        {
            return Err(VaultError::InvalidOracleState.into());
        }
        u64::from_le_bytes(
            d[46..54]
                .try_into()
                .map_err(|_| VaultError::InvalidOracleState)?,
        )
    } else {
        now
    };
    let listing = start
        .checked_add(4 * LAUNCH_PHASE_SECONDS)
        .ok_or(VaultError::ArithmeticOverflow)?;
    if start == 0
        || start > now
        || listing >= market.instrument.expiry_ts
        || now
            >= start
                .checked_add(LAUNCH_PHASE_SECONDS)
                .ok_or(VaultError::ArithmeticOverflow)?
    {
        return Err(VaultError::OracleTimingWindowClosed.into());
    }
    if clock_info.owner != program_id {
        validate_create_only_program_account_target(program_id, clock_info)?;
        create_program_account(
            payer,
            clock_info,
            system,
            program_id,
            54,
            &[SEED, underlying, &expiry, &[bump]],
        )?;
        let mut d = clock_info.try_borrow_mut_data()?;
        d[..6].copy_from_slice(&[b'L', b'C', b'K', 1, 1, bump]);
        d[6..38].copy_from_slice(underlying);
        d[38..46].copy_from_slice(&expiry);
        d[46..54].copy_from_slice(&start.to_le_bytes());
    }
    Ok((start, listing))
}

/// No new placement/reopening after a launch deadline. Existing dispute settlement remains required.
pub(super) fn source_submission_deadline(
    month: &OracleMonthState,
    expiry: u64,
) -> Result<u64, ProgramError> {
    if month.schedule_version == LAUNCH_SCHEDULE_VERSION {
        Ok(rulebook_schedule_boundaries(month)?.0)
    } else {
        expiry
            .checked_sub(schedule_review_seconds(month)?)
            .ok_or(VaultError::ArithmeticOverflow.into())
    }
}

#[cfg(all(test, feature = "mainnet-v3"))]
mod tests {
    use super::*;

    fn launch_month() -> OracleMonthState {
        OracleMonthState {
            schedule_version: LAUNCH_SCHEDULE_VERSION,
            scramble_start_ts: 1_790_000_000,
            listing_ts: 1_790_014_400,
            phase: OraclePhase::SourceSubmission,
            ..OracleMonthState::default()
        }
    }

    #[test]
    fn launch_schedule_coverage_deadline_never_restarts_clock_and_cleanup_remains_available() {
        let mut month = launch_month();
        let start = month.scramble_start_ts;
        let mut coverage = OracleSkuCoverageManifest {
            planned_scramble_start_ts: start,
            planned_listing_ts: month.listing_ts,
            ..OracleSkuCoverageManifest::default()
        };
        assert_eq!(
            rulebook_schedule_boundaries(&month).unwrap(),
            (start + 3_600, start + 7_200, start + 10_800)
        );
        for offset in [3_599, 3_600] {
            assert_eq!(
                finalized_oracle_sku_coverage_schedule_for_month(
                    &month,
                    &coverage,
                    1_793_491_200,
                    start + offset
                )
                .unwrap(),
                (start, month.listing_ts)
            );
        }
        assert!(finalized_oracle_sku_coverage_schedule_for_month(
            &month,
            &coverage,
            1_793_491_200,
            start + 3_601
        )
        .is_err());
        assert!(
            !oracle_unlistable_source_cleanup_ready(&month, 1_793_491_200, start + 3_599).unwrap()
        );
        assert!(
            oracle_unlistable_source_cleanup_ready(&month, 1_793_491_200, start + 3_600).unwrap()
        );
        assert!(
            super::super::oracle_usdc_rewards::ensure_failed_v5_reward_schedule_window_at(
                1_793_491_200,
                &month,
                start + 3_600
            )
            .is_ok()
        );
        month.pending_resolution_count = 1;
        assert!(
            super::super::oracle_usdc_rewards::ensure_failed_v5_reward_schedule_window_at(
                1_793_491_200,
                &month,
                start + 3_600
            )
            .is_err()
        );
        month.pending_resolution_count = 0;
        month.phase = OraclePhase::Scramble;
        assert!(
            reopen_oracle_sku_coverage_state(&mut month, &mut coverage, start + 10_801, 1).is_err()
        );
        month.listing_ts += 1;
        assert!(rulebook_schedule_boundaries(&month).is_err());
    }

    #[test]
    fn launch_schedule_admits_exact_product_month_side_and_preserves_normal_calendar() {
        for product in ["RAMX", "NANDX"] {
            for (name, expiry) in [("202609", 1_790_812_800), ("202610", 1_793_491_200)] {
                for kind in [
                    crate::state::OptionKind::CallSpread,
                    crate::state::OptionKind::PutSpread,
                ] {
                    let mut market = Market::default();
                    let underlying = if product == "RAMX" {
                        b"ram-standardized-baskets".as_slice()
                    } else {
                        b"nand-standardized-baskets".as_slice()
                    };
                    market.instrument.underlying_id[..underlying.len()].copy_from_slice(underlying);
                    market.instrument.kind = kind;
                    market.instrument.expiry_ts = expiry;
                    let side = if kind == crate::state::OptionKind::CallSpread {
                        "CALL"
                    } else {
                        "PUT"
                    };
                    let id = format!("{product}-{name}-{side}-01");
                    market.market_id[..id.len()].copy_from_slice(id.as_bytes());
                    assert!(validate_launch_market(&market).is_ok());
                    market.instrument.expiry_ts += 1;
                    assert!(validate_launch_market(&market).is_err());
                    market.instrument.expiry_ts = expiry;
                    market.market_id[0] = b'X';
                    assert!(validate_launch_market(&market).is_err());
                }
            }
        }
        let ordinary = OracleMonthState {
            scramble_start_ts: 100,
            listing_ts: 100 + ORACLE_PRE_LISTING_WINDOW_SECONDS,
            ..OracleMonthState::default()
        };
        assert_eq!(
            schedule_total(&ordinary).unwrap(),
            ORACLE_PRE_LISTING_WINDOW_SECONDS
        );
        assert!(rulebook_schedule_boundaries(&ordinary).is_ok());
        let unknown = OracleMonthState {
            schedule_version: 4,
            ..ordinary
        };
        assert!(schedule_windows(&unknown).is_err());
    }
}
