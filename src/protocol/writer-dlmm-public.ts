/** Browser-safe exact public writer lane requests. Native/Lean own economic admission. */
import { PublicKey } from "@solana/web3.js";
import { AmebaInputError } from "../errors.js";

export const CURRENT_WRITER_LIQUIDITY_OPERATIONS = Object.freeze([
  "writer_liquidity_initialize", "writer_liquidity_add", "writer_liquidity_remove", "writer_liquidity_sweep",
] as const);
export type CurrentWriterLiquidityOperation = (typeof CURRENT_WRITER_LIQUIDITY_OPERATIONS)[number];
export interface CurrentWriterLiquidityIdentity {
  readonly owner: string; readonly sleeve: string; readonly seriesIndex: number;
}
export interface CurrentWriterLiquidityAddEntry {
  readonly binId: number; readonly maximumOptionAmountAtoms: string; readonly maximumQuoteAmountAtoms: string;
}
export interface CurrentWriterLiquidityRemoveEntry {
  readonly binId: number; readonly optionAmountAtoms: string; readonly quoteAmountAtoms: string;
}
export type CurrentWriterLiquidityRequest = CurrentWriterLiquidityIdentity & (
  | { readonly operation: "writer_liquidity_initialize" | "writer_liquidity_sweep" }
  | { readonly operation: "writer_liquidity_add"; readonly issueAmountAtoms: string; readonly entries: readonly CurrentWriterLiquidityAddEntry[] }
  | { readonly operation: "writer_liquidity_remove"; readonly entries: readonly CurrentWriterLiquidityRemoveEntry[] }
);
export type CurrentWriterLiquidityInitializeRequest = CurrentWriterLiquidityIdentity;
export type CurrentWriterLiquiditySweepRequest = CurrentWriterLiquidityIdentity;
export type CurrentWriterLiquidityAddRequest = Omit<Extract<CurrentWriterLiquidityRequest, { operation: "writer_liquidity_add" }>, "operation">;
export type CurrentWriterLiquidityRemoveRequest = Omit<Extract<CurrentWriterLiquidityRequest, { operation: "writer_liquidity_remove" }>, "operation">;

function invalid(message: string): never { throw new AmebaInputError(`Invalid writer liquidity request: ${message}`); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) invalid("fields are not exact");
  return value as Record<string, unknown>;
}
function address(value: unknown): string {
  if (typeof value !== "string") invalid("address must be canonical base58");
  const key = new PublicKey(value);
  if (key.toBase58() !== value || key.equals(PublicKey.default)) invalid("address must be canonical and nonzero");
  return value;
}
function u64(value: unknown): string {
  if (typeof value !== "string" || value.length > 20 || !/^(0|[1-9][0-9]*)$/.test(value)
    || BigInt(value) > 18_446_744_073_709_551_615n) invalid("amount must be a canonical u64 string");
  return value;
}
export function isCurrentWriterLiquidityOperation(value: unknown): value is CurrentWriterLiquidityOperation {
  return typeof value === "string" && (CURRENT_WRITER_LIQUIDITY_OPERATIONS as readonly string[]).includes(value);
}
export function validateCurrentWriterLiquidityRequest(value: unknown): CurrentWriterLiquidityRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("object required");
  const operation = (value as Record<string, unknown>).operation;
  if (!isCurrentWriterLiquidityOperation(operation)) invalid("operation is unknown");
  const request = record(value, ["operation", "owner", "sleeve", "seriesIndex",
    ...(operation === "writer_liquidity_add" ? ["issueAmountAtoms", "entries"] : operation === "writer_liquidity_remove" ? ["entries"] : [])]);
  const owner = address(request.owner); const sleeve = address(request.sleeve);
  const seriesIndex = request.seriesIndex;
  if (typeof seriesIndex !== "number" || !Number.isInteger(seriesIndex) || seriesIndex < 0 || seriesIndex >= 20) invalid("series index must be0..19");
  const identity = { owner, sleeve, seriesIndex };
  if (operation === "writer_liquidity_initialize" || operation === "writer_liquidity_sweep") return Object.freeze({ operation, ...identity });
  if (!Array.isArray(request.entries) || request.entries.length < 1 || request.entries.length > 8) invalid("operation requires1..8 entries");
  let previous = 0;
  const bin = (entry: Record<string, unknown>) => {
    const index = entry.binId;
    if (typeof index !== "number" || !Number.isInteger(index) || index <= previous || index > 2048) invalid("bins must be ascending within1..2048");
    previous = index; return index;
  };
  if (operation === "writer_liquidity_add") {
    const entries = request.entries.map(value => {
      const entry = record(value, ["binId", "maximumOptionAmountAtoms", "maximumQuoteAmountAtoms"]);
      const binId = bin(entry); const maximumOptionAmountAtoms = u64(entry.maximumOptionAmountAtoms); const maximumQuoteAmountAtoms = u64(entry.maximumQuoteAmountAtoms);
      if (maximumOptionAmountAtoms === "0" && maximumQuoteAmountAtoms === "0") invalid("entry must contain an asset amount");
      return Object.freeze({ binId, maximumOptionAmountAtoms, maximumQuoteAmountAtoms });
    });
    const issueAmountAtoms = u64(request.issueAmountAtoms);
    if (BigInt(issueAmountAtoms) % 1_000_000n !== 0n
      || entries.reduce((sum, entry) => sum + BigInt(entry.maximumOptionAmountAtoms), 0n) !== BigInt(issueAmountAtoms)) {
      invalid("explicit issuance must be whole contracts and equal the option placement total");
    }
    return Object.freeze({ operation, ...identity, issueAmountAtoms, entries: Object.freeze(entries) });
  }
  const entries = request.entries.map(value => {
    const entry = record(value, ["binId", "optionAmountAtoms", "quoteAmountAtoms"]);
    const binId = bin(entry); const optionAmountAtoms = u64(entry.optionAmountAtoms); const quoteAmountAtoms = u64(entry.quoteAmountAtoms);
    if (optionAmountAtoms === "0" && quoteAmountAtoms === "0") invalid("entry must contain an asset amount");
    return Object.freeze({ binId, optionAmountAtoms, quoteAmountAtoms });
  });
  return Object.freeze({ operation, ...identity, entries: Object.freeze(entries) });
}

export const CURRENT_WRITER_DLMM_POLICY_OPERATIONS = Object.freeze([
  "writer_liquidity_policy_begin", "writer_liquidity_policy_append", "writer_liquidity_policy_seal",
] as const);
export type CurrentWriterDlmmPolicyOperation = (typeof CURRENT_WRITER_DLMM_POLICY_OPERATIONS)[number];
export type CurrentWriterDlmmOperation = CurrentWriterLiquidityOperation | CurrentWriterDlmmPolicyOperation;
export interface CurrentWriterLiquidityPolicyIdentity { readonly owner: string; readonly sleeve: string; }
export interface CurrentWriterLiquidityPolicySeries {
  readonly conservativeClaimValueAtoms: string; readonly sellerFloorQuoteAtoms: string;
  readonly monthlyBuybackCapAtoms: string; readonly transactionBuybackCapAtoms: string;
}
export interface CurrentWriterLiquidityPolicyBeginRequest extends CurrentWriterLiquidityPolicyIdentity {
  readonly managementAuthority: string; readonly expectedPolicyHash: string;
  readonly monthlyBuybackCapAtoms: string; readonly transactionBuybackCapAtoms: string;
  readonly reserveReleaseSpendRatioPpm: string; readonly priceSeparationTicks: number;
}
export interface CurrentWriterLiquidityPolicyAppendRequest extends CurrentWriterLiquidityPolicyIdentity {
  readonly startIndex: number; readonly entries: readonly CurrentWriterLiquidityPolicySeries[];
}
export type CurrentWriterLiquidityPolicySealRequest = CurrentWriterLiquidityPolicyIdentity;
export type CurrentWriterDlmmPolicyRequest =
  | (CurrentWriterLiquidityPolicyBeginRequest & { readonly operation: "writer_liquidity_policy_begin" })
  | (CurrentWriterLiquidityPolicyAppendRequest & { readonly operation: "writer_liquidity_policy_append" })
  | (CurrentWriterLiquidityPolicySealRequest & { readonly operation: "writer_liquidity_policy_seal" });
export type CurrentWriterDlmmRequest = CurrentWriterLiquidityRequest | CurrentWriterDlmmPolicyRequest;
export function isCurrentWriterDlmmOperation(value: unknown): value is CurrentWriterDlmmOperation {
  return isCurrentWriterLiquidityOperation(value) || (typeof value === "string" && (CURRENT_WRITER_DLMM_POLICY_OPERATIONS as readonly string[]).includes(value));
}
export function validateCurrentWriterDlmmRequest(value: unknown): CurrentWriterDlmmRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("object required");
  const operation = (value as Record<string, unknown>).operation;
  if (isCurrentWriterLiquidityOperation(operation)) return validateCurrentWriterLiquidityRequest(value);
  if (!isCurrentWriterDlmmOperation(operation)) invalid("operation is unknown");
  const fields = operation === "writer_liquidity_policy_begin"
    ? ["managementAuthority", "expectedPolicyHash", "monthlyBuybackCapAtoms", "transactionBuybackCapAtoms", "reserveReleaseSpendRatioPpm", "priceSeparationTicks"]
    : operation === "writer_liquidity_policy_append" ? ["startIndex", "entries"] : [];
  const request = record(value, ["operation", "owner", "sleeve", ...fields]);
  const identity = { owner: address(request.owner), sleeve: address(request.sleeve) };
  if (operation === "writer_liquidity_policy_seal") return Object.freeze({ operation, ...identity });
  if (operation === "writer_liquidity_policy_begin") {
    const expectedPolicyHash = request.expectedPolicyHash; const priceSeparationTicks = request.priceSeparationTicks;
    const reserveReleaseSpendRatioPpm = u64(request.reserveReleaseSpendRatioPpm);
    if (typeof expectedPolicyHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedPolicyHash) || /^0+$/.test(expectedPolicyHash)
      || typeof priceSeparationTicks !== "number" || !Number.isInteger(priceSeparationTicks) || priceSeparationTicks < 1 || priceSeparationTicks > 65535
      || BigInt(reserveReleaseSpendRatioPpm) > 1_000_000n) invalid("policy hash, ratio or tick separation is invalid");
    return Object.freeze({ operation, ...identity, managementAuthority: address(request.managementAuthority), expectedPolicyHash,
      monthlyBuybackCapAtoms: u64(request.monthlyBuybackCapAtoms), transactionBuybackCapAtoms: u64(request.transactionBuybackCapAtoms),
      reserveReleaseSpendRatioPpm, priceSeparationTicks });
  }
  if (operation !== "writer_liquidity_policy_append") invalid("policy operation is unknown");
  const startIndex = request.startIndex;
  if (typeof startIndex !== "number" || !Number.isInteger(startIndex) || startIndex < 0 || startIndex >= 20
    || !Array.isArray(request.entries) || request.entries.length < 1 || request.entries.length > 8 || startIndex + request.entries.length > 20) invalid("policy append range is invalid");
  const entries = request.entries.map(value => {
    const entry = record(value, ["conservativeClaimValueAtoms", "sellerFloorQuoteAtoms", "monthlyBuybackCapAtoms", "transactionBuybackCapAtoms"]);
    return Object.freeze({ conservativeClaimValueAtoms: u64(entry.conservativeClaimValueAtoms), sellerFloorQuoteAtoms: u64(entry.sellerFloorQuoteAtoms),
      monthlyBuybackCapAtoms: u64(entry.monthlyBuybackCapAtoms), transactionBuybackCapAtoms: u64(entry.transactionBuybackCapAtoms) });
  });
  return Object.freeze({ operation, ...identity, startIndex, entries: Object.freeze(entries) });
}
