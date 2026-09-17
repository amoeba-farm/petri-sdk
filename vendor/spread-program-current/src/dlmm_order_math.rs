//! One-way escrow accounting. A fill creates owner proceeds, never reverse liquidity.

/// Deprecated fixture bound; live storage is separate records with bounded witnesses.
#[cfg(test)]
pub const MAX_OPEN_ORDERS: usize = 32;
pub const MAX_ORDER_FILLS: usize = 8;
pub const CONTRACT_SCALE: u64 = 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderError {
    InvalidOrder,
    InvalidPrice,
    InsufficientEscrow,
    Overflow,
    NoCross,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum OrderSide {
    #[default]
    Bid,
    Ask,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct OrderBalance {
    pub side: OrderSide,
    pub limit_price: u64,
    pub original_quantity: u64,
    pub remaining_quantity: u64,
    pub remaining_input: u64,
    pub claimable_option: u64,
    pub claimable_quote: u64,
}

pub fn quote_budget(quantity: u64, price: u64) -> Result<u64, OrderError> {
    if quantity == 0 || price == 0 {
        return Err(OrderError::InvalidOrder);
    }
    let numerator = u128::from(quantity) * u128::from(price);
    u64::try_from(numerator.div_ceil(u128::from(CONTRACT_SCALE))).map_err(|_| OrderError::Overflow)
}

impl OrderBalance {
    pub fn funded(side: OrderSide, quantity: u64, price: u64) -> Result<Self, OrderError> {
        let budget = quote_budget(quantity, price)?;
        Ok(Self {
            side,
            limit_price: price,
            original_quantity: quantity,
            remaining_quantity: quantity,
            remaining_input: if side == OrderSide::Bid {
                budget
            } else {
                quantity
            },
            claimable_option: 0,
            claimable_quote: 0,
        })
    }

    /// Returns the quote exchanged. All arithmetic is checked before mutation.
    pub fn fill(&mut self, quantity: u64, execution_price: u64) -> Result<u64, OrderError> {
        if quantity == 0 || quantity > self.remaining_quantity {
            return Err(OrderError::InvalidOrder);
        }
        if execution_price == 0
            || match self.side {
                OrderSide::Bid => execution_price > self.limit_price,
                OrderSide::Ask => execution_price < self.limit_price,
            }
        {
            return Err(OrderError::InvalidPrice);
        }
        let quote = quote_budget(quantity, execution_price)?;
        let mut next = *self;
        next.remaining_quantity -= quantity;
        match self.side {
            OrderSide::Bid => {
                next.remaining_input = next
                    .remaining_input
                    .checked_sub(quote)
                    .ok_or(OrderError::InsufficientEscrow)?;
                next.claimable_option = next
                    .claimable_option
                    .checked_add(quantity)
                    .ok_or(OrderError::Overflow)?;
                next.release_unspendable_bid_remainder()?;
            }
            OrderSide::Ask => {
                next.remaining_input = next
                    .remaining_input
                    .checked_sub(quantity)
                    .ok_or(OrderError::InsufficientEscrow)?;
                next.claimable_quote = next
                    .claimable_quote
                    .checked_add(quote)
                    .ok_or(OrderError::Overflow)?;
            }
        }
        *self = next;
        Ok(quote)
    }

    /// An exhausted rounded budget cannot remain a non-executable FIFO head.
    /// Release its remaining quote to the owner without changing custody.
    pub fn release_unspendable_bid_remainder(&mut self) -> Result<(), OrderError> {
        if self.side == OrderSide::Bid
            && (self.remaining_quantity == 0
                || self.remaining_input < quote_budget(1, self.limit_price)?)
        {
            let claimable = self
                .claimable_quote
                .checked_add(self.remaining_input)
                .ok_or(OrderError::Overflow)?;
            self.remaining_quantity = 0;
            self.remaining_input = 0;
            self.claimable_quote = claimable;
        }
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<(), OrderError> {
        let mut next = *self;
        match self.side {
            OrderSide::Bid => {
                next.claimable_quote = next
                    .claimable_quote
                    .checked_add(next.remaining_input)
                    .ok_or(OrderError::Overflow)?
            }
            OrderSide::Ask => {
                next.claimable_option = next
                    .claimable_option
                    .checked_add(next.remaining_input)
                    .ok_or(OrderError::Overflow)?
            }
        }
        next.remaining_input = 0;
        next.remaining_quantity = 0;
        *self = next;
        Ok(())
    }

    pub fn claim(&mut self) -> (u64, u64) {
        let result = (self.claimable_option, self.claimable_quote);
        self.claimable_option = 0;
        self.claimable_quote = 0;
        result
    }

    pub fn obligations(self) -> Result<(u64, u64), OrderError> {
        let option = self
            .claimable_option
            .checked_add(if self.side == OrderSide::Ask {
                self.remaining_input
            } else {
                0
            })
            .ok_or(OrderError::Overflow)?;
        let quote = self
            .claimable_quote
            .checked_add(if self.side == OrderSide::Bid {
                self.remaining_input
            } else {
                0
            })
            .ok_or(OrderError::Overflow)?;
        Ok((option, quote))
    }
}

/// The older resting order sets the execution price. Selection of the orders
/// must be authenticated by the canonical book before invoking this function.
pub fn match_pair(
    bid: &mut OrderBalance,
    ask: &mut OrderBalance,
    bid_is_older: bool,
    maximum_quantity: u64,
) -> Result<(u64, u64), OrderError> {
    if bid.side != OrderSide::Bid || ask.side != OrderSide::Ask || bid.limit_price < ask.limit_price
    {
        return Err(OrderError::NoCross);
    }
    let price = if bid_is_older {
        bid.limit_price
    } else {
        ask.limit_price
    };
    let affordable = u64::try_from(
        (u128::from(bid.remaining_input) * u128::from(CONTRACT_SCALE)) / u128::from(price),
    )
    .unwrap_or(u64::MAX);
    let quantity = bid
        .remaining_quantity
        .min(ask.remaining_quantity)
        .min(maximum_quantity)
        .min(affordable);
    let mut next_bid = *bid;
    let mut next_ask = *ask;
    let quote = next_bid.fill(quantity, price)?;
    if next_ask.fill(quantity, price)? != quote {
        return Err(OrderError::InvalidOrder);
    }
    *bid = next_bid;
    *ask = next_ask;
    Ok((quantity, quote))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_claim_fill_cancel_conserves_and_never_reverses() {
        let mut bid =
            OrderBalance::funded(OrderSide::Bid, 100 * CONTRACT_SCALE, CONTRACT_SCALE).unwrap();
        let mut ask =
            OrderBalance::funded(OrderSide::Ask, 100 * CONTRACT_SCALE, CONTRACT_SCALE).unwrap();
        match_pair(&mut bid, &mut ask, true, 40 * CONTRACT_SCALE).unwrap();
        assert_eq!(bid.remaining_input, 60 * CONTRACT_SCALE);
        assert_eq!(bid.remaining_quantity, 60 * CONTRACT_SCALE);
        assert_eq!(bid.claim(), (40 * CONTRACT_SCALE, 0));
        assert_eq!(bid.claim(), (0, 0));
        assert_eq!(ask.claim(), (0, 40 * CONTRACT_SCALE));
        match_pair(&mut bid, &mut ask, false, 20 * CONTRACT_SCALE).unwrap();
        bid.cancel().unwrap();
        ask.cancel().unwrap();
        assert_eq!(bid.claim(), (20 * CONTRACT_SCALE, 40 * CONTRACT_SCALE));
        assert_eq!(ask.claim(), (40 * CONTRACT_SCALE, 20 * CONTRACT_SCALE));
        assert_eq!(bid.obligations(), Ok((0, 0)));
        assert_eq!(ask.obligations(), Ok((0, 0)));
    }

    #[test]
    fn price_improvement_change_is_claimable_after_full_fill() {
        let mut bid =
            OrderBalance::funded(OrderSide::Bid, 10 * CONTRACT_SCALE, 2 * CONTRACT_SCALE).unwrap();
        let mut ask =
            OrderBalance::funded(OrderSide::Ask, 10 * CONTRACT_SCALE, CONTRACT_SCALE).unwrap();
        match_pair(&mut bid, &mut ask, false, u64::MAX).unwrap();
        assert_eq!(bid.claim(), (10 * CONTRACT_SCALE, 10 * CONTRACT_SCALE));
        assert_eq!(bid.remaining_input, 0);
    }

    #[test]
    fn rejected_fill_is_atomic_and_cancelled_input_cannot_fill() {
        let mut bid = OrderBalance::funded(OrderSide::Bid, 2, 1).unwrap();
        let before = bid;
        assert_eq!(bid.fill(2, 2), Err(OrderError::InvalidPrice));
        assert_eq!(bid, before);
        bid.cancel().unwrap();
        assert_eq!(bid.fill(1, 1), Err(OrderError::InvalidOrder));
        assert_eq!(quote_budget(u64::MAX, u64::MAX), Err(OrderError::Overflow));
    }

    #[test]
    fn rounded_bid_budget_cannot_strand_an_unexecutable_fifo_head() {
        let mut bid = OrderBalance::funded(OrderSide::Bid, CONTRACT_SCALE, 1_050_000).unwrap();
        assert_eq!(bid.fill(19, 1_050_000), Ok(20));
        assert_eq!(bid.fill(999_980, 1_050_000), Ok(1_049_979));
        assert_eq!(bid.remaining_quantity, 0);
        assert_eq!(bid.remaining_input, 0);
        assert_eq!(bid.claim(), (999_999, 1));
    }
}
