/**
 * Current liquidity transport: canonical caller values and exact native account
 * derivation. Lifecycle, authorization, and amount admission belong to the
 * semantic authority; this module neither quotes nor executes liquidity changes.
 */
import { PublicKey } from "@solana/web3.js";
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
export type CurrentLiquidityRequest = CurrentLiquidityRequestIdentity & ({
    readonly action: "add";
    readonly entries: readonly CurrentLiquidityAddEntry[];
} | {
    readonly action: "remove" | "close_position";
    readonly entries: readonly CurrentLiquidityRemoveEntry[];
});
/** Normalize wire integers without rounding or accepting caller-selected accounts. */
export declare function canonicalCurrentLiquidityRequest(value: unknown): CurrentLiquidityRequest;
/** Address discovery for the caller's touched bins; additional pages require semantic admission. */
export declare function currentLiquidityTouchedPageIndices(request: CurrentLiquidityRequest): readonly number[];
/** Exact native builder inputs derived from independently decoded parent identities. */
export declare function currentLiquidityBuilderInput(input: {
    readonly request: CurrentLiquidityRequest;
    readonly market: PublicKey;
    readonly optionMint: PublicKey;
    readonly quoteMint: PublicKey;
    readonly programId: PublicKey;
    /** Exact route selected by semantic admission, never a caller request field. */
    readonly pageIndices: readonly number[];
}): {
    builderName: "buildAddAmoebaDlmmLiquidityInstruction";
    builderInput: {
        accounts: {
            owner: PublicKey;
            pool: PublicKey;
            position: PublicKey;
            authority: PublicKey;
            optionMint: PublicKey;
            quoteMint: PublicKey;
            optionVault: PublicKey;
            quoteVault: PublicKey;
            ownerOptionAccount: PublicKey;
            ownerQuoteAccount: PublicKey;
            lightTokenProgram: PublicKey;
            lightCpiAuthority: PublicKey;
            optionInterface: PublicKey;
            quoteInterface: PublicKey;
            splTokenProgram: PublicKey;
            pagePairs: {
                pageIndex: number;
                reservePage: PublicKey;
                sharePage: PublicKey;
            }[];
        };
        positionNonce: bigint;
        entries: {
            binId: number;
            maximumOptionAmount: bigint;
            maximumQuoteAmount: bigint;
            minimumShares: bigint;
        }[];
        closePositionWhenEmpty?: undefined;
    };
} | {
    builderName: "buildRemoveAmoebaDlmmLiquidityInstruction";
    builderInput: {
        accounts: {
            owner: PublicKey;
            pool: PublicKey;
            position: PublicKey;
            authority: PublicKey;
            optionMint: PublicKey;
            quoteMint: PublicKey;
            optionVault: PublicKey;
            quoteVault: PublicKey;
            ownerOptionAccount: PublicKey;
            ownerQuoteAccount: PublicKey;
            lightTokenProgram: PublicKey;
            lightCpiAuthority: PublicKey;
            optionInterface: PublicKey;
            quoteInterface: PublicKey;
            splTokenProgram: PublicKey;
            pagePairs: {
                pageIndex: number;
                reservePage: PublicKey;
                sharePage: PublicKey;
            }[];
        };
        positionNonce: bigint;
        closePositionWhenEmpty: boolean;
        entries: {
            binId: number;
            shares: bigint;
            minimumOptionOut: bigint;
            minimumQuoteOut: bigint;
        }[];
    };
};
export {};
//# sourceMappingURL=current-liquidity-instruction.d.ts.map