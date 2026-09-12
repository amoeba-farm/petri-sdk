import { type TransactionInstruction } from "@solana/web3.js";
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
import { type CurrentLiquidityRequest } from "./current-liquidity-instruction.js";
export interface PrepareCurrentLiquidityOperationInput {
    readonly request: CurrentLiquidityRequest;
    readonly market: string;
    readonly optionMint: string;
    readonly quoteMint: string;
    readonly pageIndices: readonly number[];
    readonly currentObservation: CurrentFinalizedObservation;
    readonly leanAdmissionDigest: string;
    readonly instruction: TransactionInstruction;
    readonly recentBlockhash: string;
}
interface LiquidityManifest {
    readonly programId: string;
    readonly dataBase64: string;
    readonly accounts: readonly {
        readonly pubkey: string;
        readonly isSigner: boolean;
        readonly isWritable: boolean;
    }[];
    readonly decodedParams: {
        readonly tag: number;
        readonly instructionName: string;
    };
}
export interface CurrentLiquidityOperationPlan {
    readonly schemaVersion: 1;
    readonly stateNamespace: "ameba-spread-v2";
    readonly operation: "amoeba_dlmm_liquidity";
    readonly operationId: string;
    readonly request: CurrentLiquidityRequest;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly currentObservationDigest: string;
    readonly leanAdmissionDigest: string;
    readonly liquidity: {
        readonly marketId: string;
        readonly expiryId: string;
        readonly ownerPubkey: string;
        readonly market: string;
        readonly pool: string;
        readonly position: string;
        readonly optionMint: string;
        readonly quoteMint: string;
        readonly pageIndices: readonly number[];
    };
    readonly instructions: readonly LiquidityManifest[];
    readonly setupInstructionBatches: readonly [];
    readonly setupTransactions: readonly [];
    readonly writeSet: readonly string[];
    readonly signerRoles: readonly {
        readonly pubkey: string;
        readonly role: "liquidity_manager";
        readonly scope: "main";
        readonly setupBatchIndex: null;
        readonly instructionIndexes: readonly number[];
    }[];
    readonly proofFacts: {
        readonly currentObservationDigest: string;
        readonly leanAdmissionDigest: string;
    };
    readonly transaction: {
        readonly serializedTransactionBase64: string;
        readonly recentBlockhash: string;
        readonly backendPartialSignatures: readonly [];
        readonly approvedInstructions: readonly {
            readonly programId: string;
            readonly dataBase64: string;
            readonly accounts: readonly {
                readonly address: string;
                readonly isSigner: boolean;
                readonly isWritable: boolean;
            }[];
        }[];
    };
    readonly preparedPlanDigest: string;
}
/** Bind exact native bytes, finalized evidence, semantic admission and unsigned transaction. */
export declare function prepareCurrentLiquidityOperation(input: PrepareCurrentLiquidityOperationInput): CurrentLiquidityOperationPlan;
/** Portable validation requires independently rebuilt evidence, never the plan's self-asserted facts. */
export declare function validateCurrentLiquidityOperationPlan(plan: CurrentLiquidityOperationPlan, independentlyRebuilt: PrepareCurrentLiquidityOperationInput): CurrentLiquidityOperationPlan;
export {};
//# sourceMappingURL=current-liquidity-operation.d.ts.map