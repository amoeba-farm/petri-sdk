import { type CurrentCollectiveLookupTableWitnessV1 } from "./current-collective-lookup-table.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import type { WriterInstructionAccountMeta, WriterSignerRole } from "./writer-operation.js";
export declare const COLLECTIVE_SWAP_OPERATION_PLAN_SCHEMA_VERSION: 1;
export declare const COLLECTIVE_SWAP_EXACT_IN_TAG: 254;
export declare const COLLECTIVE_SWAP_MAX_RESERVE_PAGES: 8;
export declare const COLLECTIVE_SWAP_DEADLINE_TTL_SECONDS = 120n;
export declare const COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT: 1000000;
export type CollectiveSwapDirection = "QuoteForOption" | "OptionForQuote";
export interface CollectiveSwapSemanticInput {
    readonly trader: string;
    readonly market: string;
    readonly oracleMonth: string;
    readonly writerSettlementGroup: string;
    readonly writerSleeve: string;
    readonly writerSeriesBook: string;
    readonly pool: string;
    readonly optionMint: string;
    readonly quoteMint: string;
    readonly direction: CollectiveSwapDirection;
    readonly amountIn: string;
    readonly minimumAmountOut: string;
    readonly limitBinId: number;
    readonly deadlineTs: string;
    readonly reservePageIndices: readonly number[];
}
export interface CollectiveSwapInstructionManifest {
    readonly programId: typeof AMOEBA_SPREAD_PROGRAM_ID;
    readonly instructionName: "SwapCollectiveDlmmExactInV1";
    readonly instructionTag: typeof COLLECTIVE_SWAP_EXACT_IN_TAG;
    readonly dataBase64: string;
    readonly accounts: readonly WriterInstructionAccountMeta[];
}
export interface CollectiveSwapOperationPlan {
    readonly schemaVersion: typeof COLLECTIVE_SWAP_OPERATION_PLAN_SCHEMA_VERSION;
    readonly operation: "collective_swap_exact_in";
    readonly operationId: string;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly currentObservationDigest: string;
    readonly leanAdmissionDigest: string;
    readonly semantic: CollectiveSwapSemanticInput;
    readonly instruction: CollectiveSwapInstructionManifest;
    readonly writeSet: readonly string[];
    readonly signerRoles: readonly WriterSignerRole[];
    readonly preparedPlanDigest: string;
    readonly computeUnitLimit?: typeof COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT;
    readonly transactionLookupTable?: CurrentCollectiveLookupTableWitnessV1;
}
export interface PrepareCollectiveSwapOperationInput {
    readonly transactionLookupTable?: CurrentCollectiveLookupTableWitnessV1;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly computeUnitLimit?: typeof COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT;
    readonly leanAdmissionDigest: string;
    readonly semantic: CollectiveSwapSemanticInput;
    /** Exact native RC44 instruction rebuilt from independently observed accounts. */
    readonly instruction: TransactionInstruction;
    readonly writeSet: readonly (PublicKey | string)[];
    readonly signerRoles: readonly WriterSignerRole[];
}
/** Bind a Lean-admitted secondary swap to exact native tag-254 bytes and metas. */
export declare function prepareCollectiveSwapOperation(input: PrepareCollectiveSwapOperationInput): CollectiveSwapOperationPlan;
/** Exact execution sequence; the optional budget is fixed, never caller supplied instruction bytes. */
export declare function collectiveSwapExecutionInstructions(plan: CollectiveSwapOperationPlan): readonly {
    readonly programId: string;
    readonly instructionName: string;
    readonly instructionTag: number;
    readonly dataBase64: string;
    readonly accounts: readonly WriterInstructionAccountMeta[];
}[];
/** Validate a portable plan only by comparing it with an independently rebuilt native plan. */
export declare function validateCollectiveSwapOperationPlan(plan: CollectiveSwapOperationPlan, independentlyRebuilt: PrepareCollectiveSwapOperationInput): CollectiveSwapOperationPlan;
//# sourceMappingURL=collective-swap-operation.d.ts.map