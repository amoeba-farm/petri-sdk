//! Locked contribution lots: exact capital-time profit AND loss participation.
//!
//! Each lot owns an immutable interval in the pool's capital-seconds ledger.
//! Differences of cumulative floors allocate every atom independently of claim
//! order. Splitting an interval cannot create dust or change its total payout.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ParticipationError {
    InvalidTime,
    InvalidPrincipal,
    InvalidInterval,
    Overflow,
    Insolvent,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ParticipationTotals {
    pub principal: u64,
    pub capital_seconds: u128,
    pub maximum_duration: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ContributionInterval {
    pub principal: u64,
    pub entry_ts: u64,
    pub expiry_ts: u64,
    pub weight_offset: u128,
}

impl ContributionInterval {
    pub fn weight(self) -> Result<u128, ParticipationError> {
        if self.principal == 0 {
            return Err(ParticipationError::InvalidPrincipal);
        }
        let duration = self
            .expiry_ts
            .checked_sub(self.entry_ts)
            .filter(|value| *value > 0)
            .ok_or(ParticipationError::InvalidTime)?;
        Ok(u128::from(self.principal) * u128::from(duration))
    }

    /// The returned prefix and suffix partition both principal and entitlement.
    pub fn split(self, prefix_principal: u64) -> Result<(Self, Self), ParticipationError> {
        if prefix_principal == 0 || prefix_principal >= self.principal {
            return Err(ParticipationError::InvalidPrincipal);
        }
        let prefix = Self {
            principal: prefix_principal,
            ..self
        };
        let suffix = Self {
            principal: self.principal - prefix_principal,
            weight_offset: self
                .weight_offset
                .checked_add(prefix.weight()?)
                .ok_or(ParticipationError::Overflow)?,
            ..self
        };
        Ok((prefix, suffix))
    }
}

impl ParticipationTotals {
    pub fn contribute(
        self,
        amount: u64,
        now: u64,
        start: u64,
        expiry: u64,
    ) -> Result<(Self, ContributionInterval), ParticipationError> {
        if start == 0 || start >= expiry || now >= expiry {
            return Err(ParticipationError::InvalidTime);
        }
        let lot = ContributionInterval {
            principal: amount,
            entry_ts: now.max(start),
            expiry_ts: expiry,
            weight_offset: self.capital_seconds,
        };
        let weight = lot.weight()?;
        Ok((
            Self {
                principal: self
                    .principal
                    .checked_add(amount)
                    .ok_or(ParticipationError::Overflow)?,
                capital_seconds: self
                    .capital_seconds
                    .checked_add(weight)
                    .ok_or(ParticipationError::Overflow)?,
                maximum_duration: self.maximum_duration.max(expiry - lot.entry_ts),
            },
            lot,
        ))
    }

    /// Global buyer solvency does not imply payable time-weighted writer losses.
    /// This division-free guard is equivalent to checking every constant lot.
    pub fn admit(self, assets: u64, exact_reserve: u64) -> Result<(), ParticipationError> {
        if self.principal == 0 || self.maximum_duration == 0 || self.capital_seconds == 0 {
            return Err(ParticipationError::InvalidPrincipal);
        }
        if assets < exact_reserve {
            return Err(ParticipationError::Insolvent);
        }
        // A >= R makes P + R - A <= P; subtract first to avoid u64 overflow.
        let worst_loss = self.principal.saturating_sub(assets - exact_reserve);
        if u128::from(worst_loss) * u128::from(self.maximum_duration) > self.capital_seconds {
            return Err(ParticipationError::Insolvent);
        }
        Ok(())
    }
}

/// floor(amount * numerator / denominator), with a 192-bit mathematical
/// product. Long multiplication/division avoids narrowing capital-seconds and
/// does not require an SBF-unfriendly arbitrary precision dependency.
pub fn proportional_floor(
    amount: u64,
    numerator: u128,
    denominator: u128,
) -> Result<u64, ParticipationError> {
    if denominator == 0 || numerator > denominator {
        return Err(ParticipationError::InvalidInterval);
    }
    let mut quotient = 0u64;
    let mut remainder = 0u128;
    for bit in (0..64).rev() {
        // Double the remainder modulo denominator without overflowing u128.
        let carry = remainder >= denominator - remainder;
        remainder = if carry {
            remainder - (denominator - remainder)
        } else {
            remainder * 2
        };
        quotient = quotient
            .checked_mul(2)
            .ok_or(ParticipationError::Overflow)?;
        if carry {
            quotient = quotient
                .checked_add(1)
                .ok_or(ParticipationError::Overflow)?;
        }
        if (amount >> bit) & 1 != 0 {
            let carry = remainder >= denominator - numerator;
            remainder = if carry {
                remainder - (denominator - numerator)
            } else {
                remainder + numerator
            };
            if carry {
                quotient = quotient
                    .checked_add(1)
                    .ok_or(ParticipationError::Overflow)?;
            }
        }
    }
    Ok(quotient)
}

pub fn final_payout(
    lot: ContributionInterval,
    total_principal: u64,
    total_weight: u128,
    residual: u64,
) -> Result<u64, ParticipationError> {
    let end = lot
        .weight_offset
        .checked_add(lot.weight()?)
        .ok_or(ParticipationError::Overflow)?;
    if end > total_weight || lot.principal > total_principal {
        return Err(ParticipationError::InvalidInterval);
    }
    let magnitude = residual.abs_diff(total_principal);
    let allocation = proportional_floor(magnitude, end, total_weight)?
        .checked_sub(proportional_floor(
            magnitude,
            lot.weight_offset,
            total_weight,
        )?)
        .ok_or(ParticipationError::InvalidInterval)?;
    if residual >= total_principal {
        lot.principal
            .checked_add(allocation)
            .ok_or(ParticipationError::Overflow)
    } else {
        lot.principal
            .checked_sub(allocation)
            .ok_or(ParticipationError::Insolvent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        // Replaces the retired proportional-close properties: receipt principal stays locked,
        // and every admissible profit/loss partition must conserve assets through arbitrary splits.
        #[test]
        fn admitted_losses_and_profits_conserve_all_receipts_after_splits(
            early in 2u64..1_000_000, late in 1u64..1_000_000,
            entry in 2u64..99, residual in 0u64..4_000_000,
        ) {
            let (totals, a) = ParticipationTotals::default().contribute(early, 1, 1, 100).unwrap();
            let (totals, b) = totals.contribute(late, entry, 1, 100).unwrap();
            prop_assume!(totals.admit(residual, 0).is_ok());
            let payout = |lot| final_payout(lot, totals.principal, totals.capital_seconds, residual).unwrap();
            let (prefix, suffix) = a.split(early / 2).unwrap();
            prop_assert_eq!(prefix.entry_ts, a.entry_ts);
            prop_assert_eq!(suffix.expiry_ts, a.expiry_ts);
            prop_assert_eq!(prefix.weight().unwrap() + suffix.weight().unwrap(), a.weight().unwrap());
            prop_assert_eq!(payout(prefix) + payout(suffix), payout(a));
            prop_assert_eq!(payout(a) + payout(b), residual);
            prop_assert_eq!(totals.principal, early + late);
        }

        #[test]
        fn admission_is_exact_against_independent_loss_duration_bound(
            a in 1u64..100_000, b in 1u64..100_000, duration in 1u64..99,
            assets in 0u64..300_000, reserve in 0u64..200_000,
        ) {
            let (totals, _) = ParticipationTotals::default().contribute(a, 1, 1, 100).unwrap();
            let (totals, _) = totals.contribute(b, 100 - duration, 1, 100).unwrap();
            let loss = (i128::from(a) + i128::from(b) + i128::from(reserve) - i128::from(assets)).max(0);
            let payable = assets >= reserve && loss * 99 <= i128::from(a) * 99 + i128::from(b) * i128::from(duration);
            prop_assert_eq!(totals.admit(assets, reserve).is_ok(), payable);
        }
    }

    #[test]
    fn topups_have_separate_dated_weights_and_never_reprice_principal() {
        let (totals, first) = ParticipationTotals::default()
            .contribute(10, 1, 1, 11)
            .unwrap();
        let (totals, topup) = totals.contribute(10, 6, 1, 11).unwrap();
        assert_eq!(
            (totals.principal, first.weight(), topup.weight()),
            (20, Ok(100), Ok(50))
        );
        assert_eq!(final_payout(first, 20, 150, 35), Ok(20));
        assert_eq!(final_payout(topup, 20, 150, 35), Ok(15));
        assert_eq!(
            totals.contribute(1, 11, 1, 11),
            Err(ParticipationError::InvalidTime)
        );
        assert_eq!(topup.split(0), Err(ParticipationError::InvalidPrincipal));
        assert_eq!(topup.split(10), Err(ParticipationError::InvalidPrincipal));
    }

    #[test]
    fn unequal_duration_loss_guard_and_exact_boundary() {
        let (totals, alice) = ParticipationTotals::default()
            .contribute(12_000_000, 1, 1, 2_592_001)
            .unwrap();
        let (totals, bob) = totals
            .contribute(12_000_000, 2_505_601, 1, 2_592_001)
            .unwrap();
        assert_eq!(
            totals.admit(24_000_000, 18_000_000),
            Err(ParticipationError::Insolvent)
        );
        assert_eq!(totals.admit(24_000_000, 12_400_000), Ok(()));
        assert_eq!(
            final_payout(alice, totals.principal, totals.capital_seconds, 11_600_000),
            Ok(0)
        );
        assert_eq!(
            final_payout(bob, totals.principal, totals.capital_seconds, 11_600_000),
            Ok(11_600_000)
        );
    }

    #[test]
    fn cumulative_rounding_conserves_both_signs_and_splits() {
        for a in 1..10 {
            for b in 1..10 {
                for duration in 1..8 {
                    let (totals, first) = ParticipationTotals::default()
                        .contribute(a, 1, 1, 10)
                        .unwrap();
                    let (totals, second) = totals.contribute(b, 10 - duration, 1, 10).unwrap();
                    for residual in 0..40 {
                        if totals.admit(residual, 0).is_err() {
                            continue;
                        }
                        let first_payout =
                            final_payout(first, totals.principal, totals.capital_seconds, residual)
                                .unwrap();
                        let second_payout = final_payout(
                            second,
                            totals.principal,
                            totals.capital_seconds,
                            residual,
                        )
                        .unwrap();
                        assert_eq!(first_payout + second_payout, residual);
                        for prefix in 1..a {
                            let (left, right) = first.split(prefix).unwrap();
                            assert_eq!(
                                final_payout(
                                    left,
                                    totals.principal,
                                    totals.capital_seconds,
                                    residual
                                )
                                .unwrap()
                                    + final_payout(
                                        right,
                                        totals.principal,
                                        totals.capital_seconds,
                                        residual
                                    )
                                    .unwrap(),
                                first_payout
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn wide_products_and_clock_boundaries() {
        assert_eq!(
            proportional_floor(u64::MAX, u128::MAX, u128::MAX),
            Ok(u64::MAX)
        );
        assert_eq!(
            proportional_floor(u64::MAX, u128::MAX / 2, u128::MAX),
            Ok(u64::MAX / 2)
        );
        let (totals, prestart) = ParticipationTotals::default()
            .contribute(5, 1, 10, 100)
            .unwrap();
        assert_eq!(prestart.entry_ts, 10);
        let (_, late) = totals.contribute(5, 99, 10, 100).unwrap();
        assert_eq!(late.weight(), Ok(5));
        assert_eq!(
            totals.contribute(5, 100, 10, 100),
            Err(ParticipationError::InvalidTime)
        );
        assert_eq!(
            totals.contribute(0, 99, 10, 100),
            Err(ParticipationError::InvalidPrincipal)
        );
    }
}
