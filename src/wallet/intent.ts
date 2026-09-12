import { isCurrentWriterDlmmOperation, validateCurrentWriterDlmmRequest, type CurrentWriterDlmmRequest } from "../protocol/writer-dlmm-public.js";
/** Caller-owned intent decoding and exact RC44 review projection. */

import { canonicalIndex, canonicalJson, canonicalU64, exactObject, sha256Canonical, snapshotCanonicalJson, walletError } from "./codec.js";
import { pubkey } from "./manifest.js";
import type { CurrentCollectiveOperationPrepareEnvelope } from "./plans.js";

interface CurrentWalletIntentBase<Operation extends string> {
  readonly operation: Operation;
}

export interface CurrentWalletDepositIntent extends CurrentWalletIntentBase<"deposit"> {
  readonly owner: string;
  readonly sleeve: string;
  readonly principalAtoms: string;
}

export interface CurrentWalletBidIntent extends CurrentWalletIntentBase<"bid"> {
  readonly owner: string;
  readonly auction: string;
  readonly seriesIndex: number;
  readonly pricePerContractAtoms: string;
  readonly quantityAtoms: string;
}

export interface CurrentWalletCloseBeginIntent extends CurrentWalletIntentBase<"close_begin"> {
  readonly owner: string;
  readonly sleeve: string;
  readonly flatParAtoms: string;
  readonly minimumWithdrawalAtoms: string;
}

export interface CurrentWalletCloseBasketIntent extends CurrentWalletIntentBase<"close_basket"> {
  readonly owner: string;
  readonly closeRequest: string;
}

export interface CurrentWalletCloseFinalizeIntent extends CurrentWalletIntentBase<"close_finalize"> {
  readonly owner: string;
  readonly closeRequest: string;
}

export interface CurrentWalletCloseCancelIntent extends CurrentWalletIntentBase<"close_cancel"> {
  readonly owner: string;
  readonly closeRequest: string;
}

export interface CurrentWalletFlatResidualClaimIntent
  extends CurrentWalletIntentBase<"settlement_claim_flat"> {
  readonly owner: string;
  readonly sleeve: string;
  readonly claimVariant: "flat_residual";
  readonly seriesIndex: 255;
  readonly amountAtoms: string;
}

export interface CurrentWalletCollectiveLongClaimIntent
  extends CurrentWalletIntentBase<"settlement_claim_collective"> {
  readonly owner: string;
  readonly sleeve: string;
  readonly claimVariant: "collective_long";
  readonly seriesIndex: number;
  readonly amountAtoms: string;
}

export interface CurrentWalletFlatTransferIntent
  extends CurrentWalletIntentBase<"transfer_flat"> {
  readonly owner: string;
  readonly sleeve: string;
  readonly destinationOwner: string;
  readonly amountAtoms: string;
}

export interface CurrentWalletCollectiveSwapIntent
  extends CurrentWalletIntentBase<"collective_swap_exact_in"> {
  readonly trader: string;
  readonly market: string;
  readonly direction: "QuoteForOption" | "OptionForQuote";
  readonly amountIn: string;
  readonly minimumAmountOut: string;
  readonly limitBinId: number;
}

export type CurrentCollectiveWalletExpectedIntent =
  | CurrentWriterDlmmRequest
  | { readonly operation: "withdraw_principal"; readonly owner: string; readonly sleeve: string; readonly amountAtoms: string }
  | { readonly operation: "auction_refund"; readonly owner: string; readonly auction: string; readonly bid: string }
  | CurrentWalletDepositIntent
  | CurrentWalletBidIntent
  | CurrentWalletCloseBeginIntent
  | CurrentWalletCloseBasketIntent
  | CurrentWalletCloseFinalizeIntent
  | CurrentWalletCloseCancelIntent
  | CurrentWalletFlatResidualClaimIntent
  | CurrentWalletCollectiveLongClaimIntent
  | CurrentWalletFlatTransferIntent
  | CurrentWalletCollectiveSwapIntent;

export interface CurrentCollectiveWalletReviewedIntent {
  readonly schemaVersion: 1;
  readonly expectedIntent: CurrentCollectiveWalletExpectedIntent;
  readonly semantic: Readonly<Record<string, unknown>>;
  readonly stage: Readonly<Record<string, unknown>> | null;
  readonly setupMode: "none" | "cold_load" | "canonical_output_create" | "classic_output_create";
  readonly sourceState: "hot" | "cold" | null;
  readonly destinationState: "hot" | "cold" | "absent" | null;
  readonly actionBatchIndex: number;
  readonly executionBatchCount: number;
}

export interface DecodedCurrentCollectiveWalletReview {
  readonly reviewedIntent: CurrentCollectiveWalletReviewedIntent;
  readonly reviewDigest: string;
}

export function decodeAndValidateCurrentWalletExpectedIntent(
  value: unknown,
  envelope: CurrentCollectiveOperationPrepareEnvelope,
): DecodedCurrentCollectiveWalletReview {
  const probe = exactObject(value, ["operation"], [
    "owner", "sleeve", "principalAtoms", "auction", "bid",
    "seriesIndex", "pricePerContractAtoms", "quantityAtoms", "flatParAtoms",
    "minimumWithdrawalAtoms", "closeRequest", "claimVariant", "amountAtoms",
    "destinationOwner", "trader", "market", "direction",
    "amountIn", "minimumAmountOut", "limitBinId",
  ], "expectedIntent");
  if (probe.operation !== envelope.operationPlan.operation) {
    walletError("CURRENT_WALLET_INTENT_MISMATCH", "caller intent operation differs from the prepared operation");
  }
  const expectedIntent = decodeExpectedIntent(value);
  const expectedSemantic = semanticProjection(expectedIntent);
  const actualSemantic = planSemanticProjection(envelope);
  if (canonicalJson(expectedSemantic) !== canonicalJson(actualSemantic)) {
    walletError("CURRENT_WALLET_INTENT_MISMATCH", "caller intent semantics differ from the prepared plan");
  }
  const reviewedIntent = snapshotCanonicalJson<CurrentCollectiveWalletReviewedIntent>({
    schemaVersion: 1,
    expectedIntent,
    semantic: envelope.operationPlan.semantic,
    stage: envelope.stage,
    setupMode: envelope.operationPlan.setupMode,
    sourceState: envelope.operationPlan.sourceState,
    destinationState: envelope.operationPlan.destinationState,
    actionBatchIndex: envelope.operationPlan.actionBatchIndex,
    executionBatchCount: envelope.operationPlan.executionInstructionBatches.length,
  }, "reviewed intent", 64_000).value;
  return Object.freeze({
    reviewedIntent,
    reviewDigest: sha256Canonical({
      domain: "ameba:current_collective_wallet_review:v1",
      reviewedIntent,
    }),
  });
}

function decodeExpectedIntent(value: unknown): CurrentCollectiveWalletExpectedIntent {
  const operation = (value as Readonly<Record<string, unknown>>).operation;
  if (isCurrentWriterDlmmOperation(operation)) return validateCurrentWriterDlmmRequest(value);
  switch (operation) {
    case "withdraw_principal": {
      const object = intentObject(value, ["owner", "sleeve", "amountAtoms"]);
      return Object.freeze({ operation, owner: address(object.owner, "owner"), sleeve: address(object.sleeve, "sleeve"),
        amountAtoms: canonicalU64(object.amountAtoms, "expectedIntent.amountAtoms", true) });
    }
    case "auction_refund": {
      const object = intentObject(value, ["owner", "auction", "bid"]);
      return Object.freeze({ operation, owner: address(object.owner, "owner"), auction: address(object.auction, "auction"), bid: address(object.bid, "bid") });
    }
    case "deposit": {
      const object = intentObject(value, ["owner", "sleeve", "principalAtoms"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), sleeve: address(object.sleeve, "sleeve"),
        principalAtoms: canonicalU64(object.principalAtoms, "expectedIntent.principalAtoms", true) });
    }
    case "bid": {
      const object = intentObject(value, ["owner", "auction", "seriesIndex", "pricePerContractAtoms", "quantityAtoms"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), auction: address(object.auction, "auction"),
        seriesIndex: canonicalIndex(object.seriesIndex, "expectedIntent.seriesIndex", 19),
        pricePerContractAtoms: canonicalU64(object.pricePerContractAtoms, "expectedIntent.pricePerContractAtoms", true),
        quantityAtoms: canonicalU64(object.quantityAtoms, "expectedIntent.quantityAtoms", true) });
    }
    case "close_begin": {
      const object = intentObject(value, ["owner", "sleeve", "flatParAtoms", "minimumWithdrawalAtoms"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), sleeve: address(object.sleeve, "sleeve"),
        flatParAtoms: canonicalU64(object.flatParAtoms, "expectedIntent.flatParAtoms", true),
        minimumWithdrawalAtoms: canonicalU64(object.minimumWithdrawalAtoms, "expectedIntent.minimumWithdrawalAtoms") });
    }
    case "close_basket": {
      const object = intentObject(value, ["owner", "closeRequest"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), closeRequest: address(object.closeRequest, "closeRequest") });
    }
    case "close_finalize": {
      const object = intentObject(value, ["owner", "closeRequest"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), closeRequest: address(object.closeRequest, "closeRequest") });
    }
    case "close_cancel": {
      const object = intentObject(value, ["owner", "closeRequest"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), closeRequest: address(object.closeRequest, "closeRequest") });
    }
    case "settlement_claim_flat": {
      const object = intentObject(value, ["owner", "sleeve", "claimVariant", "seriesIndex", "amountAtoms"]);
      if (object.claimVariant !== "flat_residual" || object.seriesIndex !== 255) {
        walletError("CURRENT_WALLET_INPUT_INVALID", "expectedIntent Flat claim selector is not canonical");
      }
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), sleeve: address(object.sleeve, "sleeve"),
        claimVariant: "flat_residual", seriesIndex: 255,
        amountAtoms: canonicalU64(object.amountAtoms, "expectedIntent.amountAtoms", true) });
    }
    case "settlement_claim_collective": {
      const object = intentObject(value, ["owner", "sleeve", "claimVariant", "seriesIndex", "amountAtoms"]);
      if (object.claimVariant !== "collective_long") {
        walletError("CURRENT_WALLET_INPUT_INVALID", "expectedIntent collective claim selector is not canonical");
      }
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), sleeve: address(object.sleeve, "sleeve"),
        claimVariant: "collective_long", seriesIndex: canonicalIndex(object.seriesIndex, "expectedIntent.seriesIndex", 19),
        amountAtoms: canonicalU64(object.amountAtoms, "expectedIntent.amountAtoms", true) });
    }
    case "transfer_flat": {
      const object = intentObject(value, ["owner", "sleeve", "destinationOwner", "amountAtoms"]);
      return Object.freeze({ ...base(operation),
        owner: address(object.owner, "owner"), sleeve: address(object.sleeve, "sleeve"),
        destinationOwner: address(object.destinationOwner, "destinationOwner"),
        amountAtoms: canonicalU64(object.amountAtoms, "expectedIntent.amountAtoms", true) });
    }
    case "collective_swap_exact_in": {
      const object = intentObject(value, ["trader", "market", "direction", "amountIn", "minimumAmountOut", "limitBinId"]);
      if (object.direction !== "QuoteForOption" && object.direction !== "OptionForQuote") {
        walletError("CURRENT_WALLET_INPUT_INVALID", "expectedIntent swap direction is invalid");
      }
      return Object.freeze({ ...base(operation),
        trader: address(object.trader, "trader"), market: address(object.market, "market"),
        direction: object.direction,
        amountIn: canonicalU64(object.amountIn, "expectedIntent.amountIn", true),
        minimumAmountOut: canonicalU64(object.minimumAmountOut, "expectedIntent.minimumAmountOut", true),
        limitBinId: canonicalIndex(object.limitBinId, "expectedIntent.limitBinId", 0xffff) });
    }
    default:
      walletError("CURRENT_WALLET_OPERATION_UNSUPPORTED", "caller intent operation is not a public RC44 wallet operation");
  }
}

function intentObject(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  return exactObject(value, ["operation", ...fields], [], "expectedIntent");
}

function base<Operation extends CurrentCollectiveWalletExpectedIntent["operation"]>(
  operation: Operation,
): Readonly<{ operation: Operation }> {
  return Object.freeze({ operation });
}

function address(value: unknown, field: string): string {
  return pubkey(value, `expectedIntent.${field}`).toBase58();
}

function semanticProjection(intent: CurrentCollectiveWalletExpectedIntent): Readonly<Record<string, unknown>> {
  const { operation } = intent;
  if (isCurrentWriterDlmmOperation(operation)) {
    const { operation: _operation, ...semantic } = validateCurrentWriterDlmmRequest(intent);
    return Object.freeze(semantic);
  }
  if (operation === "withdraw_principal") return pick(intent, ["owner", "sleeve", "amountAtoms"]);
  if (operation === "auction_refund") return pick(intent, ["owner", "auction", "bid"]);
  if (operation === "deposit") return pick(intent, ["owner", "sleeve", "principalAtoms"]);
  if (operation === "bid") return pick(intent, ["owner", "auction", "seriesIndex", "pricePerContractAtoms", "quantityAtoms"]);
  if (operation === "close_begin") return pick(intent, ["owner", "sleeve", "flatParAtoms", "minimumWithdrawalAtoms"]);
  if (operation === "settlement_claim_flat" || operation === "settlement_claim_collective") return pick(intent, ["owner", "sleeve", "claimVariant", "seriesIndex", "amountAtoms"]);
  if (operation === "transfer_flat") return pick(intent, ["owner", "sleeve", "destinationOwner", "amountAtoms"]);
  if (operation === "collective_swap_exact_in") return pick(intent, ["trader", "market", "direction", "amountIn", "minimumAmountOut", "limitBinId"]);
  return pick(intent, ["owner", "closeRequest"]);
}

function planSemanticProjection(envelope: CurrentCollectiveOperationPrepareEnvelope): Readonly<Record<string, unknown>> {
  const semantic = envelope.operationPlan.semantic;
  if (envelope.operationPlan.operation === "collective_swap_exact_in") {
    return pick(semantic, ["trader", "market", "direction", "amountIn", "minimumAmountOut", "limitBinId"]);
  }
  return semantic;
}

function pick(value: object, fields: readonly string[]): Readonly<Record<string, unknown>> {
  const record = value as Readonly<Record<string, unknown>>;
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, record[field]])));
}
