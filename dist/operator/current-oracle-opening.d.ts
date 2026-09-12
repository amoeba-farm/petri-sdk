import * as opening from "@amoeba/spread-release-tools/oracle-current-v3-opening";
type NativeOpeningInput = Parameters<typeof opening.planCurrentV3OpeningMonth>[0];
type NativeOpeningPlan = Awaited<ReturnType<typeof opening.planCurrentV3OpeningMonth>>;
type NativeOpeningAction = NonNullable<NativeOpeningPlan["action"]>;
/** Source typing includes the new action even while the immutable old package remains installed. */
export type CurrentOracleOpeningAction = Omit<NativeOpeningAction, "kind"> & {
    readonly kind: NativeOpeningAction["kind"] | "index_recipe_sources";
};
export type CurrentOracleOpeningPlan = Omit<NativeOpeningPlan, "action" | "observation"> & {
    readonly action?: CurrentOracleOpeningAction;
    readonly observation: NativeOpeningPlan["observation"] & {
        readonly recipeIndexedSourceCount: number;
        readonly recipeSourceIndexComplete: boolean;
    };
};
export type PlanCurrentOracleOpeningMonthInput = Omit<NativeOpeningInput, "governance" | "chainTimeTs" | "chainSlot"> & {
    readonly minimumContextSlot: number;
};
/** Plan through the real native Opening subpath with SDK-owned release, gate and finalized time.
 * No executor, simulation, signer, resend, or lifecycle override is exposed by this facade.
 */
export declare function planCurrentOracleOpeningMonth(input: PlanCurrentOracleOpeningMonthInput): Promise<CurrentOracleOpeningPlan>;
/** Use Opening's progress rules for indexing/Opening actions, never recipe-only lifecycle rules. */
export declare function assertCurrentOracleOpeningActionAdvanced(action: CurrentOracleOpeningAction, previous: CurrentOracleOpeningPlan | NativeOpeningPlan, next: CurrentOracleOpeningPlan | NativeOpeningPlan): void;
export declare function redactedCurrentOracleOpeningPlan(plan: CurrentOracleOpeningPlan): Record<string, unknown>;
export { parseCurrentV3OpeningEvidenceManifest } from "@amoeba/spread-release-tools/oracle-current-v3-opening";
export type { CurrentV3OpeningEvidenceManifest, CurrentV3OpeningEvidenceEntry } from "@amoeba/spread-release-tools/oracle-current-v3-opening";
//# sourceMappingURL=current-oracle-opening.d.ts.map