/**
 * Current liquidity transport: canonical caller values and exact native account
 * derivation. Lifecycle, authorization, and amount admission belong to the
 * semantic authority; this module neither quotes nor executes liquidity changes.
 */
import { PublicKey } from "@solana/web3.js";
import {
  deriveAmoebaDlmmAuthorityPda,
  deriveAmoebaDlmmBinPagePda,
  deriveAmoebaDlmmPoolPda,
  deriveAmoebaDlmmPositionPda,
  deriveAmoebaDlmmSharePagePda,
  deriveAmoebaDlmmVaultPda,
} from "@amoeba/spread-release-tools/dlmm-accounts";
import {
  LIGHT_TOKEN_CPI_AUTHORITY,
  LIGHT_TOKEN_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  deriveLightSplInterfacePda,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveLightAssociatedTokenAddress } from "@amoeba/spread-release-tools/token-primitives";
import { AmebaProtocolError } from "../errors.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";

export interface CurrentLiquidityAddEntry {
  readonly binId: number;
  readonly maximumOptionAmount: string;
  readonly maximumQuoteAmount: string;
  readonly minimumShares: string;
}

export interface CurrentLiquidityRemoveEntry {
  readonly binId: number;
  readonly shares: string;
  readonly minimumOptionOut: string;
  readonly minimumQuoteOut: string;
}

interface CurrentLiquidityRequestIdentity {
  readonly marketId: string;
  readonly expiryId: string;
  readonly ownerPubkey: string;
  readonly positionNonce: string;
}

export type CurrentLiquidityRequest = CurrentLiquidityRequestIdentity & (
  | { readonly action: "add"; readonly entries: readonly CurrentLiquidityAddEntry[] }
  | { readonly action: "remove" | "close_position";
      readonly entries: readonly CurrentLiquidityRemoveEntry[] }
);

function invalid(message: string): never {
  throw new AmebaProtocolError(message, { code: "INVALID_CURRENT_LIQUIDITY" });
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("liquidity input must be an object");
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).sort().join(",") !== [...fields].sort().join(",")) {
    invalid("liquidity input fields are not exact");
  }
  return result;
}

function unsigned(value: unknown, bits: 64 | 128): string {
  const text = typeof value === "bigint" ? value.toString() : value;
  if (typeof text !== "string" || !/^(0|[1-9][0-9]*)$/u.test(text)
      || text.length > 39 || BigInt(text) >= (1n << BigInt(bits))) {
    invalid(`liquidity integer must be a canonical u${bits}`);
  }
  return text;
}

/** Normalize wire integers without rounding or accepting caller-selected accounts. */
export function canonicalCurrentLiquidityRequest(value: unknown): CurrentLiquidityRequest {
  const input = record(value, ["marketId", "expiryId", "ownerPubkey", "positionNonce", "action", "entries"]);
  if (typeof input.marketId !== "string" || typeof input.expiryId !== "string"
      || typeof input.ownerPubkey !== "string" || !input.marketId || !input.expiryId) {
    invalid("liquidity identity is incomplete");
  }
  const ownerPubkey = new PublicKey(input.ownerPubkey).toBase58();
  if (ownerPubkey !== input.ownerPubkey) invalid("liquidity owner is not canonical");
  const identity = { marketId: input.marketId, expiryId: input.expiryId, ownerPubkey,
    positionNonce: unsigned(input.positionNonce, 64) };
  if (!Array.isArray(input.entries) || (input.entries.length < 1 && input.action !== "close_position") || input.entries.length > 32) {
    invalid("liquidity request requires 1..32 entries, or empty close_position");
  }
  let previousBin = 0;
  const bin = (entry: Record<string, unknown>): number => {
    const value = entry.binId;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= previousBin || value > 2048) {
      invalid("liquidity bins must be strictly ascending within 1..2048");
    }
    previousBin = value;
    return value;
  };
  if (input.action === "add") {
    const entries = input.entries.map((value) => {
      const entry = record(value, ["binId", "maximumOptionAmount", "maximumQuoteAmount", "minimumShares"]);
      return Object.freeze({ binId: bin(entry), maximumOptionAmount: unsigned(entry.maximumOptionAmount, 64),
        maximumQuoteAmount: unsigned(entry.maximumQuoteAmount, 64), minimumShares: unsigned(entry.minimumShares, 128) });
    });
    return Object.freeze({ ...identity, action: "add", entries: Object.freeze(entries) });
  }
  if (input.action !== "remove" && input.action !== "close_position") invalid("unknown liquidity action");
  const entries = input.entries.map((value) => {
    const entry = record(value, ["binId", "shares", "minimumOptionOut", "minimumQuoteOut"]);
    return Object.freeze({ binId: bin(entry), shares: unsigned(entry.shares, 128),
      minimumOptionOut: unsigned(entry.minimumOptionOut, 64), minimumQuoteOut: unsigned(entry.minimumQuoteOut, 64) });
  });
  return Object.freeze({ ...identity, action: input.action, entries: Object.freeze(entries) });
}

/** Address discovery for the caller's touched bins; additional pages require semantic admission. */
export function currentLiquidityTouchedPageIndices(request: CurrentLiquidityRequest): readonly number[] {
  return Object.freeze([...new Set(canonicalCurrentLiquidityRequest(request).entries
    .map((entry) => Math.floor((entry.binId - 1) / 32)))]);
}

/** Exact native builder inputs derived from independently decoded parent identities. */
export function currentLiquidityBuilderInput(input: {
  readonly request: CurrentLiquidityRequest;
  readonly market: PublicKey;
  readonly optionMint: PublicKey;
  readonly quoteMint: PublicKey;
  readonly programId: PublicKey;
  /** Exact route selected by semantic admission, never a caller request field. */
  readonly pageIndices: readonly number[];
}) {
  const request = canonicalCurrentLiquidityRequest(input.request);
  if (input.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID) invalid("foreign liquidity program");
  const owner = new PublicKey(request.ownerPubkey);
  const pool = deriveAmoebaDlmmPoolPda(input.market, input.programId)[0];
  const positionNonce = BigInt(request.positionNonce);
  const pageIndexes = [...input.pageIndices];
  const touched = currentLiquidityTouchedPageIndices(request);
  if (request.action === "close_position" && request.entries.length === 0 && pageIndexes.length !== 0) {
    invalid("empty position close requires an empty page route");
  }
  if (pageIndexes.length < touched.length || pageIndexes.length > touched.length + 2
      || pageIndexes.some((page, index) => !Number.isInteger(page) || page < 0 || page >= 64
        || (index > 0 && page <= pageIndexes[index - 1]!))
      || touched.some((page) => !pageIndexes.includes(page))) {
    invalid("admitted liquidity page route is not bounded and canonical");
  }
  const accounts = {
    owner, pool, position: deriveAmoebaDlmmPositionPda(pool, owner, positionNonce, input.programId)[0],
    authority: deriveAmoebaDlmmAuthorityPda(pool, input.programId)[0],
    optionMint: input.optionMint, quoteMint: input.quoteMint,
    optionVault: deriveAmoebaDlmmVaultPda(pool, input.optionMint, input.programId)[0],
    quoteVault: deriveAmoebaDlmmVaultPda(pool, input.quoteMint, input.programId)[0],
    ownerOptionAccount: deriveLightAssociatedTokenAddress(input.optionMint, owner),
    ownerQuoteAccount: deriveLightAssociatedTokenAddress(input.quoteMint, owner),
    lightTokenProgram: LIGHT_TOKEN_PROGRAM_ID, lightCpiAuthority: LIGHT_TOKEN_CPI_AUTHORITY,
    optionInterface: deriveLightSplInterfacePda(input.optionMint),
    quoteInterface: deriveLightSplInterfacePda(input.quoteMint), splTokenProgram: SPL_TOKEN_PROGRAM_ID,
    pagePairs: pageIndexes.map((pageIndex) => ({ pageIndex,
      reservePage: deriveAmoebaDlmmBinPagePda(pool, pageIndex, input.programId)[0],
      sharePage: deriveAmoebaDlmmSharePagePda(pool, pageIndex, input.programId)[0] })),
  };
  if (request.action === "add") return { builderName: "buildAddAmoebaDlmmLiquidityInstruction" as const,
    builderInput: { accounts, positionNonce,
    entries: request.entries.map((entry) => ({ binId: entry.binId,
      maximumOptionAmount: BigInt(entry.maximumOptionAmount), maximumQuoteAmount: BigInt(entry.maximumQuoteAmount),
      minimumShares: BigInt(entry.minimumShares) })),
  } };
  return { builderName: "buildRemoveAmoebaDlmmLiquidityInstruction" as const,
    builderInput: { accounts, positionNonce,
    closePositionWhenEmpty: request.action === "close_position",
    entries: request.entries.map((entry) => ({ binId: entry.binId, shares: BigInt(entry.shares),
      minimumOptionOut: BigInt(entry.minimumOptionOut), minimumQuoteOut: BigInt(entry.minimumQuoteOut) })),
  } };
}
