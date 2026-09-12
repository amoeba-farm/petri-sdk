import { type CurrentWriterDlmmRequest } from "../protocol/writer-dlmm-public.js";
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
export interface CurrentWalletFlatResidualClaimIntent extends CurrentWalletIntentBase<"settlement_claim_flat"> {
    readonly owner: string;
    readonly sleeve: string;
    readonly claimVariant: "flat_residual";
    readonly seriesIndex: 255;
    readonly amountAtoms: string;
}
export interface CurrentWalletCollectiveLongClaimIntent extends CurrentWalletIntentBase<"settlement_claim_collective"> {
    readonly owner: string;
    readonly sleeve: string;
    readonly claimVariant: "collective_long";
    readonly seriesIndex: number;
    readonly amountAtoms: string;
}
export interface CurrentWalletFlatTransferIntent extends CurrentWalletIntentBase<"transfer_flat"> {
    readonly owner: string;
    readonly sleeve: string;
    readonly destinationOwner: string;
    readonly amountAtoms: string;
}
export interface CurrentWalletCollectiveSwapIntent extends CurrentWalletIntentBase<"collective_swap_exact_in"> {
    readonly trader: string;
    readonly market: string;
    readonly direction: "QuoteForOption" | "OptionForQuote";
    readonly amountIn: string;
    readonly minimumAmountOut: string;
    readonly limitBinId: number;
}
export type CurrentCollectiveWalletExpectedIntent = CurrentWriterDlmmRequest | {
    readonly operation: "withdraw_principal";
    readonly owner: string;
    readonly sleeve: string;
    readonly amountAtoms: string;
} | {
    readonly operation: "auction_refund";
    readonly owner: string;
    readonly auction: string;
    readonly bid: string;
} | CurrentWalletDepositIntent | CurrentWalletBidIntent | CurrentWalletCloseBeginIntent | CurrentWalletCloseBasketIntent | CurrentWalletCloseFinalizeIntent | CurrentWalletCloseCancelIntent | CurrentWalletFlatResidualClaimIntent | CurrentWalletCollectiveLongClaimIntent | CurrentWalletFlatTransferIntent | CurrentWalletCollectiveSwapIntent;
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
export declare function decodeAndValidateCurrentWalletExpectedIntent(value: unknown, envelope: CurrentCollectiveOperationPrepareEnvelope): DecodedCurrentCollectiveWalletReview;
export {};
//# sourceMappingURL=intent.d.ts.map