import type { AmoebaDlmmBinLiquidity, AmoebaDlmmBinFill, AmoebaDlmmSwapQuote, AmoebaDlmmSwapDirection } from "@amoeba/spread-release-tools/dlmm-math";
import type { PublicKey } from "@solana/web3.js";
import type { AmoebaDlmmPoolAccount } from "@amoeba/spread-release-tools/dlmm-accounts";
import type { WriterSleeveAccount, WriterSettlementGroupAccount, WriterSeriesBookAccount, WriterPolicySnapshotAccount, WriterPolicyRegistryAccount } from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import type { WriterDlmmPolicyAccountV1, WriterDlmmPositionAccountV1 } from "./writer-dlmm-native-internal.js";
import type { WriterCloseObservedSeriesBookV1 } from "@amoeba/spread-release-tools/writer-sleeve-instructions";
export interface ProjectWriterDlmmSwapPolicyInput {
    readonly sleeve: WriterSleeveAccount;
    readonly group: WriterSettlementGroupAccount;
    readonly book: WriterSeriesBookAccount;
    readonly policySnapshot: WriterPolicySnapshotAccount;
    readonly liquidityPolicy: WriterDlmmPolicyAccountV1 | null;
    readonly position: WriterDlmmPositionAccountV1 | null;
    readonly pool: AmoebaDlmmPoolAccount;
    readonly vaultConfig: {
        readonly address: PublicKey;
        readonly usdcMint: PublicKey;
    };
    readonly policyRegistry: WriterPolicyRegistryAccount;
    readonly nowUnixSeconds: bigint;
    readonly seriesIndex: number;
    readonly observedMintSupplyAtoms: bigint;
    readonly marketIssuedAtoms: bigint;
    readonly marketConsumedAtoms: bigint;
    readonly marketBurnedAtoms: bigint;
    readonly observedStagingAtoms: bigint;
    readonly observedRetirementAtoms: bigint;
    readonly observedSleeveCashAtoms: bigint;
}
/** Structural source declarations from Spread writerDlmmQuote.ts; no local arithmetic. */
export interface WriterDlmmMathSeries {
    readonly kind: "CallSpread" | "PutSpread";
    readonly strikePriceAtomic: bigint;
    readonly capPriceAtomic: bigint;
    readonly contractSizeAtoms: bigint;
    readonly maxPayoutPerContractAtoms: bigint;
    readonly externalOiAtoms: bigint;
}
export interface WriterDlmmRiskLimits {
    readonly operationalBufferAtoms: bigint;
    readonly worstDrawdownPpm: bigint;
    readonly lowerDrawdownPpm: bigint;
    readonly upperDrawdownPpm: bigint;
    readonly lowerTailMaxSettlementAtomic: bigint;
    readonly upperTailMinSettlementAtomic: bigint;
    readonly securityMode: "GrossExternalMaximumPayout" | "ExactExternalEnvelope";
    readonly securityCapAtoms: bigint;
}
export interface WriterDlmmQuoteSeriesLimits {
    readonly conservativeClaimValueAtoms: bigint;
    readonly sellerFloorQuoteAtoms: bigint;
    readonly monthlyBuybackCapAtoms: bigint;
    readonly transactionBuybackCapAtoms: bigint;
}
export interface WriterDlmmSwapPolicy {
    /** Native eligibility from authenticated current state; never a public permission switch. */
    readonly eligible: boolean;
    readonly book: readonly WriterDlmmMathSeries[];
    readonly seriesIndex: number;
    readonly cash: {
        readonly assetsAtoms: bigint;
        readonly principalAtoms: bigint;
        readonly allocatedLpQuoteAtoms: bigint;
    };
    readonly risk: WriterDlmmRiskLimits;
    readonly buyback: {
        readonly monthlyBuybackCapAtoms: bigint;
        readonly transactionBuybackCapAtoms: bigint;
        readonly reserveReleaseSpendRatioPpm: bigint;
        readonly tickSizeQuoteAtoms: bigint;
        readonly priceSeparationTicks: number;
        readonly roundTripFeeQuoteAtoms: bigint;
    };
    readonly seriesLimits: readonly WriterDlmmQuoteSeriesLimits[];
    readonly monthSpentAtoms: bigint;
    readonly seriesMonthSpentAtoms: bigint;
    readonly primaryFeeBps: number;
}
export interface WriterDlmmQuoteBin {
    readonly binId: number;
    readonly optionAtoms: bigint;
    readonly quoteAtoms: bigint;
}
export interface WriterDlmmRouteConfig {
    readonly direction: AmoebaDlmmSwapDirection;
    readonly amountIn: bigint;
    readonly minimumAmountOut: bigint;
    readonly limitBinId: number;
    readonly tickSizeQuoteAtomic: bigint;
    readonly maximumBinId: number;
    readonly swapFeeBps: number;
    readonly protocolFeeShareBps: number;
    readonly maximumBins: number;
    readonly unloadedOrdinaryBoundary?: number;
}
export interface WriterDlmmFillTotals {
    grossPremiumAtoms: bigint;
    primaryFeeAtoms: bigint;
    netPremiumAtoms: bigint;
    lpFeeAtoms: bigint;
    soldOptionAtoms: bigint;
    retiredOptionAtoms: bigint;
    spentQuoteAtoms: bigint;
}
export interface WriterDlmmRouteQuote {
    readonly quote: AmoebaDlmmSwapQuote;
    readonly ordinaryFills: readonly AmoebaDlmmBinFill[];
    readonly writerFills: readonly AmoebaDlmmBinFill[];
    readonly writer: Readonly<WriterDlmmFillTotals>;
}
export interface QuoteWriterDlmmExactInInput extends WriterDlmmRouteConfig {
    readonly ordinaryBins: readonly AmoebaDlmmBinLiquidity[];
    readonly writerBins: readonly WriterDlmmQuoteBin[];
    readonly policy?: WriterDlmmSwapPolicy;
}
export interface WriterDlmmOrdinaryPage {
    readonly pageIndex: number;
    readonly bins: readonly AmoebaDlmmBinLiquidity[];
}
export interface PlanWriterDlmmSwapReservePagesInput extends Omit<QuoteWriterDlmmExactInInput, "ordinaryBins" | "unloadedOrdinaryBoundary"> {
    readonly ordinaryPageIndices: readonly number[];
    readonly observedPages: readonly WriterDlmmOrdinaryPage[];
    readonly ordinaryBestBinId?: number;
}
interface NativeWriterDlmmQuote {
    projectWriterDlmmSwapPolicy(input: ProjectWriterDlmmSwapPolicyInput): WriterDlmmSwapPolicy | undefined;
    quoteWriterDlmmExactIn(input: QuoteWriterDlmmExactInInput): WriterDlmmRouteQuote;
    planWriterDlmmSwapReservePages(input: PlanWriterDlmmSwapReservePagesInput): {
        pageIndices: number[];
        route: WriterDlmmRouteQuote;
    };
    writerDlmmExactReserve(book: readonly WriterDlmmMathSeries[], risk: WriterDlmmRiskLimits): {
        reserveAtoms: bigint;
        lowerTailReserveAtoms: bigint;
        upperTailReserveAtoms: bigint;
    };
    writerDlmmPriceBounds(sellerFloor: bigint, tick: bigint, separationTicks: number, swapFeeBps: number, primaryFeeBps: number): {
        minimumAsk: bigint;
        maximumBid: bigint;
        roundTripFee: bigint;
    };
}
export declare const quoteWriterDlmmExactIn: (input: QuoteWriterDlmmExactInInput) => WriterDlmmRouteQuote;
export declare const projectWriterDlmmSwapPolicy: (input: ProjectWriterDlmmSwapPolicyInput) => WriterDlmmSwapPolicy | undefined;
export declare const planWriterDlmmSwapReservePages: (input: PlanWriterDlmmSwapReservePagesInput) => {
    pageIndices: number[];
    route: WriterDlmmRouteQuote;
};
export declare const writerDlmmExactReserve: (...args: Parameters<NativeWriterDlmmQuote["writerDlmmExactReserve"]>) => {
    reserveAtoms: bigint;
    lowerTailReserveAtoms: bigint;
    upperTailReserveAtoms: bigint;
};
export declare const writerDlmmPriceBounds: (...args: Parameters<NativeWriterDlmmQuote["writerDlmmPriceBounds"]>) => {
    minimumAsk: bigint;
    maximumBid: bigint;
    roundTripFee: bigint;
};
export declare function writerCloseBookDigest(book: WriterCloseObservedSeriesBookV1, economicOnly?: boolean): Uint8Array;
export {};
//# sourceMappingURL=writer-dlmm-quote.d.ts.map