/**
 * Browser-safe RC44 wallet boundary.
 *
 * This module never signs and never treats an Edge manifest as authorization.
 * It strictly decodes the portable prepare response, re-observes every bound
 * account at finalized, reconstructs the selected operation, and emits one
 * bounded unsigned v0 transaction for the selected wallet to review/sign.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { amoebaReadGatewayUrl } from "./endpoint-policy.js";
import { CurrentWalletError } from "./wallet/codec.js";
import { type CurrentCollectiveWalletExpectedIntent, type CurrentCollectiveWalletReviewedIntent } from "./wallet/intent.js";
import { CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS, CURRENT_WALLET_MAX_TRANSACTION_BYTES, CURRENT_WALLET_PROTOCOL_IDENTITY, type CurrentWalletRpc } from "./wallet/observation.js";
import { decodeCollectiveOperationPrepareEnvelope, type CurrentCollectiveOperationKind, type CurrentCollectiveOperationPrepareEnvelope } from "./wallet/plans.js";
import { type CurrentExpiryAuthorizationExpectedIntent } from "./wallet/expiry-authorization.js";
export { CurrentWalletError };
export { CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS, CURRENT_WALLET_MAX_TRANSACTION_BYTES, CURRENT_WALLET_PROTOCOL_IDENTITY, amoebaReadGatewayUrl, decodeCollectiveOperationPrepareEnvelope, };
export type { CurrentCollectiveOperationKind, CurrentCollectiveOperationPrepareEnvelope, CurrentCollectiveWalletExpectedIntent, CurrentCollectiveWalletReviewedIntent, CurrentWalletRpc, };
export type { CurrentExpiryAuthorizationExpectedIntent, CurrentExpiryAuthorizationArtifact } from "./wallet/expiry-authorization.js";
export type { CurrentWalletLpCleanupRequest } from "./wallet/liquidity-cleanup.js";
/** Validates a fixed owner-signed expiry capability; never signs, submits, or refreshes its nonce. */
export declare function materializeCurrentExpiryAuthorization(input: {
    readonly authorization: unknown;
    readonly expectedIntent: CurrentExpiryAuthorizationExpectedIntent;
    readonly owner: string | PublicKey;
    readonly nonceAccount: string | PublicKey;
    readonly rpc: CurrentWalletRpc;
}): Promise<{
    readonly serializedTransactionBase64: string;
    readonly messageSha256: string;
}>;
/** Leave the same ten-second relay margin enforced by the current Edge. */
export declare const CURRENT_WALLET_OPERATION_RELAY_MARGIN_SECONDS: 10n;
export interface MaterializeCurrentCollectiveWalletBatchInput {
    /** The exact unmodified JSON value returned by one current prepare route. */
    readonly prepareResponse: unknown;
    /** Canonical caller-local intent captured before the prepare request. */
    readonly expectedIntent: CurrentCollectiveWalletExpectedIntent;
    /** The wallet that will review and sign. It must be the plan's sole signer. */
    readonly owner: string | PublicKey;
    /** Exactly one canonical executionInstructionBatches index. */
    readonly batchIndex: number;
    /** An injected Connection-compatible capability for Amoeba's exact `/rpc` gateway. */
    readonly rpc: CurrentWalletRpc;
}
export interface CurrentCollectiveWalletBatchBinding {
    readonly schemaVersion: 1;
    readonly operation: CurrentCollectiveOperationKind;
    readonly operationId: string;
    readonly preparedPlanDigest: string;
    readonly currentObservationDigest: string;
    readonly leanAdmissionDigest: string;
    readonly prepareResponseSha256: string;
    readonly reviewedIntent: CurrentCollectiveWalletReviewedIntent;
    readonly reviewDigest: string;
    readonly owner: string;
    readonly batchIndex: number;
    readonly actionBatchIndex: number;
    readonly reobservedFinalizedSlot: number;
    readonly rpcOrigin: string;
    readonly recentBlockhash: string;
    readonly lastValidBlockHeight: number;
    readonly messageSha256: string;
    readonly unsignedTransactionSha256: string;
}
export interface MaterializedCurrentCollectiveWalletBatch {
    /** Independently reconstructed instructions for exactly one plan batch. */
    readonly instructions: readonly TransactionInstruction[];
    /** Canonical unsigned VersionedTransaction serialization. */
    readonly unsignedTransactionBytes: Uint8Array;
    readonly unsignedTransactionBase64: string;
    readonly binding: Readonly<CurrentCollectiveWalletBatchBinding>;
    readonly bindingDigest: string;
}
/**
 * Materialize one reviewed RC44 collective operation batch for wallet signing.
 *
 * No signing capability is accepted. Callers must preserve and display the
 * returned binding alongside the bytes, then submit only the wallet-signed
 * serialization through Edge's bound submit route.
 */
export declare function materializeCurrentCollectiveWalletBatch(input: MaterializeCurrentCollectiveWalletBatchInput): Promise<MaterializedCurrentCollectiveWalletBatch>;
//# sourceMappingURL=wallet.d.ts.map