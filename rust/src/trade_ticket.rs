//! Typed current trade-ticket derivation over the canonical Spread math API.

use crate::{
    AMOEBA_DLMM_BPS_SCALE, AMOEBA_DLMM_PRICE_SCALE, AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC,
    AmoebaDlmmMathError, AmoebaDlmmSwapDirection, CANONICAL_CONTRACT_SIZE_ATOMIC,
    CURRENT_MARKET_TAKER_FEE_BPS, MAX_AMOEBA_DLMM_BIN_COUNT, MAX_AMOEBA_DLMM_BINS_PER_SWAP,
    MAX_AMOEBA_DLMM_SWAP_FEE_BPS, ceil_mul_div, floor_mul_div, price_from_bin, state::Market,
};

/// The same short expiry used by current TypeScript swap plans.
pub const CURRENT_SWAP_DEADLINE_TTL_SECONDS: u64 = 120;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentTradeTicketError {
    InvalidMarketGrid,
    InvalidQuantity,
    InvalidTargetBin,
    InvalidFinalizedBlockTime,
    CanonicalMath(AmoebaDlmmMathError),
}

impl core::fmt::Display for CurrentTradeTicketError {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::InvalidMarketGrid => {
                formatter.write_str("current market does not define the canonical RC44 DLMM grid")
            }
            Self::InvalidQuantity => formatter.write_str(
                "trade quantity is not a positive whole number of canonical contract atoms",
            ),
            Self::InvalidTargetBin => {
                formatter.write_str("target bin is outside the current market grid")
            }
            Self::InvalidFinalizedBlockTime => {
                formatter.write_str("finalized block time cannot produce a bounded swap deadline")
            }
            Self::CanonicalMath(error) => {
                write!(formatter, "canonical DLMM math failed: {error:?}")
            }
        }
    }
}

impl std::error::Error for CurrentTradeTicketError {}

impl From<AmoebaDlmmMathError> for CurrentTradeTicketError {
    fn from(value: AmoebaDlmmMathError) -> Self {
        Self::CanonicalMath(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentTradeTicketSide {
    Bid,
    Ask,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentAmoebaDlmmPoolBounds {
    pub contract_size_atomic: u64,
    pub tick_size_quote_atomic: u64,
    pub minimum_bin_id: u16,
    pub maximum_bin_id: u16,
    pub maximum_bins_per_swap: u8,
    /// Read from the exact decoded Market; consumers must not hard-code it.
    pub taker_fee_bps: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentAmoebaDlmmTradeTicket {
    pub side: CurrentTradeTicketSide,
    pub direction: AmoebaDlmmSwapDirection,
    pub quantity_contract_atoms: u64,
    pub target_bin_id: u16,
    pub limit_price_quote_atomic: u64,
    pub gross_amount_in: u64,
    pub minimum_amount_out: u64,
    pub deadline_ts: u64,
    pub pool_bounds: CurrentAmoebaDlmmPoolBounds,
}

/// Derive the exact pool grid and fee inputs that RC44 initialization takes
/// from a decoded current Market.
pub fn current_amoeba_dlmm_pool_bounds(
    market: &Market,
) -> Result<CurrentAmoebaDlmmPoolBounds, CurrentTradeTicketError> {
    let tick = market.params.tick_size;
    let maximum_price = market.instrument.max_payout_per_contract;
    if !market.is_initialized
        || market.instrument.contract_size != CANONICAL_CONTRACT_SIZE_ATOMIC
        || tick != AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC
        || maximum_price == 0
        || maximum_price % tick != 0
        || maximum_price / tick > u64::from(MAX_AMOEBA_DLMM_BIN_COUNT)
        || market.params.taker_fee_bps != CURRENT_MARKET_TAKER_FEE_BPS
        || market.params.taker_fee_bps > MAX_AMOEBA_DLMM_SWAP_FEE_BPS
        || market.params.max_fills_per_instruction != MAX_AMOEBA_DLMM_BINS_PER_SWAP
    {
        return Err(CurrentTradeTicketError::InvalidMarketGrid);
    }
    let maximum_bin_id = u16::try_from(maximum_price / tick)
        .map_err(|_| CurrentTradeTicketError::InvalidMarketGrid)?;
    let maximum_bins_per_swap = MAX_AMOEBA_DLMM_BINS_PER_SWAP;
    if maximum_bin_id == 0 || maximum_bins_per_swap == 0 {
        return Err(CurrentTradeTicketError::InvalidMarketGrid);
    }
    Ok(CurrentAmoebaDlmmPoolBounds {
        contract_size_atomic: CANONICAL_CONTRACT_SIZE_ATOMIC,
        tick_size_quote_atomic: tick,
        minimum_bin_id: 1,
        maximum_bin_id,
        maximum_bins_per_swap,
        taker_fee_bps: market.params.taker_fee_bps,
    })
}

/// Build the gross-input/minimum-output/deadline ticket used by the current
/// prepare API. Every arithmetic operation delegates to canonical Spread math.
pub fn build_current_amoeba_dlmm_trade_ticket(
    market: &Market,
    side: CurrentTradeTicketSide,
    quantity_contract_atoms: u64,
    target_bin_id: u16,
    observed_finalized_block_time: u64,
) -> Result<CurrentAmoebaDlmmTradeTicket, CurrentTradeTicketError> {
    let pool_bounds = current_amoeba_dlmm_pool_bounds(market)?;
    if quantity_contract_atoms == 0 || quantity_contract_atoms % CANONICAL_CONTRACT_SIZE_ATOMIC != 0
    {
        return Err(CurrentTradeTicketError::InvalidQuantity);
    }
    if target_bin_id < pool_bounds.minimum_bin_id || target_bin_id > pool_bounds.maximum_bin_id {
        return Err(CurrentTradeTicketError::InvalidTargetBin);
    }
    let limit_price_quote_atomic = price_from_bin(
        pool_bounds.tick_size_quote_atomic,
        pool_bounds.maximum_bin_id,
        target_bin_id,
    )?;
    let (direction, gross_amount_in, minimum_amount_out) = match side {
        CurrentTradeTicketSide::Ask => {
            let fee = ceil_mul_div(
                quantity_contract_atoms,
                u64::from(pool_bounds.taker_fee_bps),
                AMOEBA_DLMM_BPS_SCALE,
            )?;
            let fee_adjusted = quantity_contract_atoms
                .checked_sub(fee)
                .ok_or(CurrentTradeTicketError::InvalidQuantity)?;
            let minimum_amount_out = floor_mul_div(
                fee_adjusted,
                limit_price_quote_atomic,
                AMOEBA_DLMM_PRICE_SCALE,
            )?;
            if minimum_amount_out == 0 {
                return Err(CurrentTradeTicketError::InvalidQuantity);
            }
            (
                AmoebaDlmmSwapDirection::OptionForQuote,
                quantity_contract_atoms,
                minimum_amount_out,
            )
        }
        CurrentTradeTicketSide::Bid => {
            let trade_input = ceil_mul_div(
                quantity_contract_atoms,
                limit_price_quote_atomic,
                AMOEBA_DLMM_PRICE_SCALE,
            )?;
            let fee_denominator = AMOEBA_DLMM_BPS_SCALE
                .checked_sub(u64::from(pool_bounds.taker_fee_bps))
                .ok_or(CurrentTradeTicketError::InvalidMarketGrid)?;
            let gross_amount_in =
                ceil_mul_div(trade_input, AMOEBA_DLMM_BPS_SCALE, fee_denominator)?;
            (
                AmoebaDlmmSwapDirection::QuoteForOption,
                gross_amount_in,
                quantity_contract_atoms,
            )
        }
    };
    let deadline_ts = observed_finalized_block_time
        .checked_add(CURRENT_SWAP_DEADLINE_TTL_SECONDS)
        .ok_or(CurrentTradeTicketError::InvalidFinalizedBlockTime)?;
    Ok(CurrentAmoebaDlmmTradeTicket {
        side,
        direction,
        quantity_contract_atoms,
        target_bin_id,
        limit_price_quote_atomic,
        gross_amount_in,
        minimum_amount_out,
        deadline_ts,
        pool_bounds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{InstrumentDefinition, MarketParameters};

    fn current_market() -> Market {
        Market {
            is_initialized: true,
            instrument: InstrumentDefinition {
                contract_size: CANONICAL_CONTRACT_SIZE_ATOMIC,
                max_payout_per_contract: 10_000_000,
                ..InstrumentDefinition::default()
            },
            params: MarketParameters {
                tick_size: AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC,
                taker_fee_bps: CURRENT_MARKET_TAKER_FEE_BPS,
                max_fills_per_instruction: MAX_AMOEBA_DLMM_BINS_PER_SWAP,
                ..MarketParameters::default()
            },
            ..Market::default()
        }
    }

    #[test]
    fn derives_current_bounds_and_exact_bid_ask_tickets() {
        let market = current_market();
        let bounds = current_amoeba_dlmm_pool_bounds(&market).unwrap();
        assert_eq!(bounds.maximum_bin_id, 200);
        assert_eq!(bounds.taker_fee_bps, 20);

        let bid = build_current_amoeba_dlmm_trade_ticket(
            &market,
            CurrentTradeTicketSide::Bid,
            CANONICAL_CONTRACT_SIZE_ATOMIC,
            20,
            1_000,
        )
        .unwrap();
        assert_eq!(bid.direction, AmoebaDlmmSwapDirection::QuoteForOption);
        assert_eq!(bid.limit_price_quote_atomic, 1_000_000);
        assert_eq!(bid.gross_amount_in, 1_002_005);
        assert_eq!(bid.minimum_amount_out, CANONICAL_CONTRACT_SIZE_ATOMIC);
        assert_eq!(bid.deadline_ts, 1_120);

        let ask = build_current_amoeba_dlmm_trade_ticket(
            &market,
            CurrentTradeTicketSide::Ask,
            CANONICAL_CONTRACT_SIZE_ATOMIC,
            20,
            1_000,
        )
        .unwrap();
        assert_eq!(ask.direction, AmoebaDlmmSwapDirection::OptionForQuote);
        assert_eq!(ask.gross_amount_in, CANONICAL_CONTRACT_SIZE_ATOMIC);
        assert_eq!(ask.minimum_amount_out, 998_000);
    }

    #[test]
    fn rejects_noncanonical_market_quantity_bin_and_deadline() {
        let mut market = current_market();
        market.params.tick_size = 1;
        assert_eq!(
            current_amoeba_dlmm_pool_bounds(&market),
            Err(CurrentTradeTicketError::InvalidMarketGrid)
        );

        let market = current_market();
        assert_eq!(
            build_current_amoeba_dlmm_trade_ticket(
                &market,
                CurrentTradeTicketSide::Bid,
                1,
                20,
                1_000,
            ),
            Err(CurrentTradeTicketError::InvalidQuantity)
        );
        assert_eq!(
            build_current_amoeba_dlmm_trade_ticket(
                &market,
                CurrentTradeTicketSide::Bid,
                CANONICAL_CONTRACT_SIZE_ATOMIC,
                0,
                1_000,
            ),
            Err(CurrentTradeTicketError::InvalidTargetBin)
        );
        assert_eq!(
            build_current_amoeba_dlmm_trade_ticket(
                &market,
                CurrentTradeTicketSide::Bid,
                CANONICAL_CONTRACT_SIZE_ATOMIC,
                20,
                u64::MAX,
            ),
            Err(CurrentTradeTicketError::InvalidFinalizedBlockTime)
        );
    }
}
