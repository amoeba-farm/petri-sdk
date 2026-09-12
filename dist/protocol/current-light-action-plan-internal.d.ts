import { TransactionInstruction } from "@solana/web3.js";
import type { LightAtaReadyActionPlan } from "@amoeba/spread-release-tools/reference-client";
/** @internal Keeps the checked action and its registration intact across an asynchronous Light plan. */
export declare function buildRegisteredLightActionPlanV1(input: {
    readonly actions: readonly TransactionInstruction[];
    readonly cloneRegistered: (instruction: TransactionInstruction) => TransactionInstruction;
    readonly revalidate: (instructions: readonly TransactionInstruction[]) => Promise<unknown>;
    readonly buildPlan: (instructions: readonly TransactionInstruction[]) => Promise<LightAtaReadyActionPlan>;
}): Promise<LightAtaReadyActionPlan>;
//# sourceMappingURL=current-light-action-plan-internal.d.ts.map