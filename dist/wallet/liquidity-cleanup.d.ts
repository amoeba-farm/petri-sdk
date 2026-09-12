import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { CurrentWalletReobservation } from "./observation.js";
export interface CurrentWalletLpCleanupRequest {
    readonly action: "close_position";
    readonly ownerPubkey: string;
    readonly marketId: string;
    readonly expiryId: string;
    readonly positionNonce: string;
    readonly entries: readonly {
        readonly binId: number;
        readonly shares: string;
        readonly minimumOptionOut: string;
        readonly minimumQuoteOut: string;
    }[];
}
export declare function validateWalletLpCleanup(raw: unknown, request: CurrentWalletLpCleanupRequest, expectedMarket: string, expectedPosition: string, owner: PublicKey, fresh: CurrentWalletReobservation): {
    readonly instructions: readonly TransactionInstruction[];
    readonly expiryTs: bigint;
};
//# sourceMappingURL=liquidity-cleanup.d.ts.map