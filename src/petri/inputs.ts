import type {
  CliFlagValue,
  CliScalar,
  PetriCommandInput,
} from "./process.js";
import type { PetriOperationId } from "./operations.js";

export type PetriFlags = Readonly<Record<string, CliFlagValue>>;

export type TypedPetriInput<
  Flags extends object = PetriFlags,
  Positionals extends CliScalar | readonly CliScalar[] = CliScalar | readonly CliScalar[],
> =
  | (Omit<PetriCommandInput, "flags" | "positionals"> & {
      flags?: Flags;
      positionals?: Positionals;
    })
  | Positionals;

export interface MarketFlags {
  market?: string;
  expiry?: string;
  rows?: number;
  all?: boolean;
  refresh?: boolean;
}

export interface ChartFlags extends MarketFlags {
  range?: "1h" | "24h" | "7d" | "30d" | "all";
  static?: boolean;
  includeSimulation?: boolean;
}

export interface CollectiveLiquidityFlags {
  market?: string;
  expiry?: string;
  strategy?: "call-spread" | "put-spread" | "collar";
  side?: "bid" | "ask";
  qty?: number;
  lowerStrike?: number;
  upperStrike?: number;
  tick?: number;
  maxLoss?: number;
  owner?: string;
  ownerPubkey?: string;
  actionType?: string;
  execute?: boolean;
  postOnly?: boolean;
}

export interface WriterFlags {
  owner?: string;
  sleeve?: string;
  auction?: string;
  closeRequest?: string;
  amount?: string | number;
  price?: string | number;
  seriesIndex?: number;
  minimumWithdrawal?: string | number;
  destination?: string;
  variant?: "collective-long" | "flat-residual";
}

export interface CollectiveTradeFlags {
  market?: string;
  direction?: "quote-for-option" | "option-for-quote";
  amountIn?: string | number;
  minimumAmountOut?: string | number;
  limitBinId?: number;
}

export interface WalletBalanceFlags {
  usdcMint?: string;
  ambaMint?: string;
}

export interface StakingFlags {
  owner?: string;
  amount?: string | number;
  minReceived?: string | number;
}

export interface OracleReadFlags {
  market?: string;
  month?: string;
  expiry?: string;
  query?: string;
  limit?: number;
  owner?: string;
}

export interface OracleDraftFlags extends OracleReadFlags {
  path?: string;
  selector?: string;
  signerPubkey?: string;
  oracleMonth?: string;
  execute?: boolean;
}

export interface TuiFlags extends PetriFlags {
  noUpdateCheck?: boolean;
}

type GenericInput = TypedPetriInput;
type NoArgInput = Omit<PetriCommandInput, "flags" | "positionals"> & {
  readonly flags?: never;
  readonly positionals?: never;
};

/**
 * Operation-specific input selection. Less common governance commands retain
 * the safe generic flag carrier, while the day-to-day market, collective-writer,
 * wallet, staking, oracle-read, draft, config, and TUI paths expose named
 * flags and positional tuples.
 */
export type PetriOperationInput<Id extends PetriOperationId> =
  Id extends "meta.frontDoor" | "meta.help" | "meta.version"
    ? NoArgInput
    : Id extends "markets.list"
      ? TypedPetriInput<MarketFlags, never>
      : Id extends "markets.show" | "markets.status" | "markets.print"
        ? TypedPetriInput<MarketFlags, string | readonly [string]>
        : Id extends "markets.chart" | "markets.openChart" | "markets.staticChart"
          ? TypedPetriInput<ChartFlags, string | readonly [string]>
          : Id extends "contracts.chain"
            ? TypedPetriInput<MarketFlags>
            : Id extends `writers.${string}`
              ? TypedPetriInput<WriterFlags>
              : Id extends `trades.${string}`
                ? TypedPetriInput<CollectiveTradeFlags>
              : Id extends `liquidity.${string}`
                ? TypedPetriInput<CollectiveLiquidityFlags>
              : Id extends "history.list"
                ? TypedPetriInput<WriterFlags>
                : Id extends `settlements.${string}`
                  ? TypedPetriInput<PetriFlags, readonly [string, string]>
                : Id extends "wallet.overview" | "wallet.address"
                  ? NoArgInput
                  : Id extends "wallet.balance"
                    ? TypedPetriInput<WalletBalanceFlags, string | readonly [string]>
                    : Id extends "staking.statusDefault"
                      ? TypedPetriInput<StakingFlags, never>
                      : Id extends `staking.${string}`
                      ? TypedPetriInput<StakingFlags>
                      : Id extends "oracle.recipeDefault" | "oracle.sources.list"
                        ? TypedPetriInput<OracleReadFlags, never>
                        : Id extends
                                | "oracle.state"
                                | "oracle.markets"
                                | "oracle.latest"
                                | "oracle.history"
                                | "oracle.recipe"
                            ? TypedPetriInput<OracleReadFlags>
                            : Id extends "oracle.drafts.listDefault"
                              ? TypedPetriInput<OracleDraftFlags, never>
                            : Id extends `oracle.drafts.${string}`
                              ? TypedPetriInput<OracleDraftFlags, string | readonly CliScalar[]>
                              : Id extends "config.show"
                                ? NoArgInput
                                : Id extends "config.set"
                                  ? TypedPetriInput<PetriFlags, readonly [string, string]>
                                  : Id extends "config.reset"
                                    ? TypedPetriInput<PetriFlags, readonly [string]>
                                    : Id extends
                                          | "mcp.status"
                                          | "mcp.enable"
                                          | "mcp.repair"
                                          | "mcp.disable"
                                          | "mcp.manifest"
                                      ? NoArgInput
                                      : Id extends "tui.snapshot" | "tui.open"
                                        ? TypedPetriInput<TuiFlags, string | readonly [string]>
                                        : Id extends "demo.snapshot" | "demo.open"
                                          ? NoArgInput
                                          : GenericInput;
