/** Exact browser-native durable nonce wrapping of reviewed long claims and LP cleanup. */
import { PublicKey } from "@solana/web3.js";
import { type CurrentWalletCollectiveLongClaimIntent } from "./intent.js";
import { type CurrentWalletLpCleanupRequest } from "./liquidity-cleanup.js";
import { type CurrentWalletRpc } from "./observation.js";
export type CurrentExpiryAuthorizationExpectedIntent = {
    readonly kind: "long_claim";
    readonly request: CurrentWalletCollectiveLongClaimIntent;
} | {
    readonly kind: "lp_cleanup";
    readonly market: string;
    readonly position: string;
    readonly request: CurrentWalletLpCleanupRequest;
};
export interface CurrentExpiryAuthorizationArtifact {
    readonly kind: "long_claim" | "lp_cleanup";
    readonly owner: string;
    readonly nonceAccount: string;
    readonly durableNonce: string;
    readonly expiryUnixSeconds: string;
    readonly sourcePlan: unknown;
    readonly sourceEnvelope: unknown;
    readonly serializedTransactionBase64: string;
    readonly messageSha256: string;
}
export declare function materializeExpiryAuthorization(authorization: unknown, expected: CurrentExpiryAuthorizationExpectedIntent, owner: PublicKey, nonceAddress: PublicKey, rpc: CurrentWalletRpc): Promise<{
    readonly serializedTransactionBase64: string;
    readonly messageSha256: string;
}>;
//# sourceMappingURL=expiry-authorization.d.ts.map