//! Ameba host SDK with current read identity and historical RC44 semantics.
//!
//! The governance module qualifies the current read-only boundary. Remaining
//! wire modules are selectively re-exported from the exact historical RC44
//! semantic baseline for replay, validation, and migration; they are not a
//! current governed-write release.

pub mod backend;
pub mod endpoints;
pub mod governance;
pub mod governed_operation;
pub mod g3_operation;

pub use ameba_spread_historical::ameba_dlmm_math::{
    AMOEBA_DLMM_BPS_SCALE, AMOEBA_DLMM_PRICE_SCALE, AmoebaDlmmBinFill, AmoebaDlmmBinLiquidity,
    AmoebaDlmmFeeBreakdown, AmoebaDlmmMathError, AmoebaDlmmSwapDirection, AmoebaDlmmSwapQuote,
    calculate_fees, ceil_mul_div, floor_mul_div, price_from_bin, quote_exact_in,
};
pub use ameba_spread_historical::constants::{
    AMOEBA_DLMM_TICK_SIZE_QUOTE_ATOMIC, CANONICAL_CONTRACT_SIZE_ATOMIC, MAX_AMOEBA_DLMM_BIN_COUNT,
    MAX_AMOEBA_DLMM_BINS_PER_SWAP, MAX_AMOEBA_DLMM_LIQUIDITY_ENTRIES, MAX_AMOEBA_DLMM_PAGE_COUNT,
    MAX_AMOEBA_DLMM_PAGE_HOPS_PER_SWAP, MAX_AMOEBA_DLMM_SWAP_FEE_BPS,
};
pub use ameba_spread_historical::{ID, check_id, id};
pub use ameba_spread_historical::{
    ameba_dlmm_instruction, ameba_dlmm_math, ameba_dlmm_state, constants, error, instruction, state,
};

const _: () = {
    assert!(ameba_spread_historical::constants::ORACLE_CALENDAR_DAY_SECONDS == 86_400);
    assert!(ameba_spread_historical::constants::ORACLE_OPENING_CHALLENGE_WINDOW_SLOTS == 300);
    assert!(ameba_spread_historical::constants::MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS == 216_000);
};

pub mod collective_swap_operation;
pub mod collective_lookup_table;
pub use collective_lookup_table::*;
pub mod current_finalized_observation;
pub mod flat_transfer_operation;
pub mod position_action;
pub mod protocol;
pub mod trade_ticket;
pub mod writer_operation;
pub mod writer_sleeve;
pub mod writer_dlmm;
pub use writer_dlmm::*;
pub use ameba_spread_historical::{writer_dlmm_math, writer_dlmm_quote};

pub use collective_swap_operation::*;
pub use current_finalized_observation::*;
pub use flat_transfer_operation::*;
pub use governance::*;
pub use governed_operation::*;
pub use position_action::*;
pub use protocol::*;
pub use trade_ticket::*;
pub use writer_operation::*;
pub use writer_sleeve::*;

/// Current G3 codecs/economics; root historical types must not be used as G3 layouts.
pub mod g3;
