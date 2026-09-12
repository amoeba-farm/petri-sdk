export declare const CURRENT_WRITER_LIQUIDITY_OPERATIONS: readonly ["writer_liquidity_initialize", "writer_liquidity_add", "writer_liquidity_remove", "writer_liquidity_sweep"];
export type CurrentWriterLiquidityOperation = (typeof CURRENT_WRITER_LIQUIDITY_OPERATIONS)[number];
export interface CurrentWriterLiquidityIdentity {
    readonly owner: string;
    readonly sleeve: string;
    readonly seriesIndex: number;
}
export interface CurrentWriterLiquidityAddEntry {
    readonly binId: number;
    readonly maximumOptionAmountAtoms: string;
    readonly maximumQuoteAmountAtoms: string;
}
export interface CurrentWriterLiquidityRemoveEntry {
    readonly binId: number;
    readonly optionAmountAtoms: string;
    readonly quoteAmountAtoms: string;
}
export type CurrentWriterLiquidityRequest = CurrentWriterLiquidityIdentity & ({
    readonly operation: "writer_liquidity_initialize" | "writer_liquidity_sweep";
} | {
    readonly operation: "writer_liquidity_add";
    readonly issueAmountAtoms: string;
    readonly entries: readonly CurrentWriterLiquidityAddEntry[];
} | {
    readonly operation: "writer_liquidity_remove";
    readonly entries: readonly CurrentWriterLiquidityRemoveEntry[];
});
export type CurrentWriterLiquidityInitializeRequest = CurrentWriterLiquidityIdentity;
export type CurrentWriterLiquiditySweepRequest = CurrentWriterLiquidityIdentity;
export type CurrentWriterLiquidityAddRequest = Omit<Extract<CurrentWriterLiquidityRequest, {
    operation: "writer_liquidity_add";
}>, "operation">;
export type CurrentWriterLiquidityRemoveRequest = Omit<Extract<CurrentWriterLiquidityRequest, {
    operation: "writer_liquidity_remove";
}>, "operation">;
export declare function isCurrentWriterLiquidityOperation(value: unknown): value is CurrentWriterLiquidityOperation;
export declare function validateCurrentWriterLiquidityRequest(value: unknown): CurrentWriterLiquidityRequest;
export declare const CURRENT_WRITER_DLMM_POLICY_OPERATIONS: readonly ["writer_liquidity_policy_begin", "writer_liquidity_policy_append", "writer_liquidity_policy_seal"];
export type CurrentWriterDlmmPolicyOperation = (typeof CURRENT_WRITER_DLMM_POLICY_OPERATIONS)[number];
export type CurrentWriterDlmmOperation = CurrentWriterLiquidityOperation | CurrentWriterDlmmPolicyOperation;
export interface CurrentWriterLiquidityPolicyIdentity {
    readonly owner: string;
    readonly sleeve: string;
}
export interface CurrentWriterLiquidityPolicySeries {
    readonly conservativeClaimValueAtoms: string;
    readonly sellerFloorQuoteAtoms: string;
    readonly monthlyBuybackCapAtoms: string;
    readonly transactionBuybackCapAtoms: string;
}
export interface CurrentWriterLiquidityPolicyBeginRequest extends CurrentWriterLiquidityPolicyIdentity {
    readonly managementAuthority: string;
    readonly expectedPolicyHash: string;
    readonly monthlyBuybackCapAtoms: string;
    readonly transactionBuybackCapAtoms: string;
    readonly reserveReleaseSpendRatioPpm: string;
    readonly priceSeparationTicks: number;
}
export interface CurrentWriterLiquidityPolicyAppendRequest extends CurrentWriterLiquidityPolicyIdentity {
    readonly startIndex: number;
    readonly entries: readonly CurrentWriterLiquidityPolicySeries[];
}
export type CurrentWriterLiquidityPolicySealRequest = CurrentWriterLiquidityPolicyIdentity;
export type CurrentWriterDlmmPolicyRequest = (CurrentWriterLiquidityPolicyBeginRequest & {
    readonly operation: "writer_liquidity_policy_begin";
}) | (CurrentWriterLiquidityPolicyAppendRequest & {
    readonly operation: "writer_liquidity_policy_append";
}) | (CurrentWriterLiquidityPolicySealRequest & {
    readonly operation: "writer_liquidity_policy_seal";
});
export type CurrentWriterDlmmRequest = CurrentWriterLiquidityRequest | CurrentWriterDlmmPolicyRequest;
export declare function isCurrentWriterDlmmOperation(value: unknown): value is CurrentWriterDlmmOperation;
export declare function validateCurrentWriterDlmmRequest(value: unknown): CurrentWriterDlmmRequest;
//# sourceMappingURL=writer-dlmm-public.d.ts.map