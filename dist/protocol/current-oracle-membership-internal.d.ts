import type { Buffer } from "buffer";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { OracleRecipeWeightManifestPreviewBucket } from "@amoeba/spread-release-tools/oracle-dlmm";
/** Source interface for the upcoming membership ABI; this does not qualify a release. */
export interface IndexOracleRecipeSourceV1Input {
    readonly programId?: PublicKey;
    readonly accounts: {
        readonly payer: PublicKey;
        readonly marketPda: PublicKey;
        readonly oracleMonthPda: PublicKey;
    };
    readonly params: {
        readonly previousHash: Uint8Array | string;
        readonly bucketId: Uint8Array | string;
        readonly sourceId: Uint8Array | string;
        readonly sourceTypeHash: Uint8Array | string;
        readonly canonicalLocatorHash: Uint8Array | string;
        readonly sourceDefinitionHash: Uint8Array | string;
        readonly bucketWeightBps: number;
    };
}
export interface OracleRecipeSourceIndexSnapshot {
    readonly month: PublicKey;
    readonly recipeHash: Buffer;
    readonly manifestHash: Buffer;
    readonly remainingHash: Buffer;
    readonly expectedSourceCount: number;
    readonly expectedBucketCount: number;
    readonly remainingSourceCount: number;
    readonly indexedBucketCount: number;
    readonly indexedBucketWeightBps: number;
    readonly lastBucketId: Buffer;
    readonly lastSourceId: Buffer;
    readonly complete: boolean;
}
export interface OracleRecipeSourceIndexPlanStep {
    readonly params: IndexOracleRecipeSourceV1Input["params"];
    readonly instruction: TransactionInstruction;
}
export interface OracleRecipeSourceIndexPlan {
    readonly oracleMonthPda: PublicKey;
    readonly manifestHash: Buffer;
    readonly expectedBucketCount: number;
    readonly steps: readonly OracleRecipeSourceIndexPlanStep[];
}
export interface OracleBucketSourceIndexSnapshot {
    readonly month: PublicKey;
    readonly recipeHash: Buffer;
    readonly bucketId: Buffer;
    readonly groupIndex: number;
    readonly firstSourceIndex: number;
    readonly bucketWeightBps: number;
    readonly sourceCount: number;
    readonly sourceIds: readonly Buffer[];
}
interface OracleMembershipRuntime {
    readonly INDEX_ORACLE_RECIPE_SOURCE_V1_TAG: 200;
    readonly ORACLE_RECIPE_SOURCE_INDEX_LEN: 209;
    readonly ORACLE_BUCKET_SOURCE_INDEX_LEN: 366;
    encodeIndexOracleRecipeSourceV1Params(params: IndexOracleRecipeSourceV1Input["params"]): Buffer;
    buildIndexOracleRecipeSourceV1Instruction(input: IndexOracleRecipeSourceV1Input): TransactionInstruction;
    buildOracleRecipeSourceIndexPlan(input: {
        programId: PublicKey;
        accounts: IndexOracleRecipeSourceV1Input["accounts"];
        buckets: OracleRecipeWeightManifestPreviewBucket[];
        frozenManifestHash: Uint8Array;
    }): OracleRecipeSourceIndexPlan;
    nextOracleRecipeSourceIndexStep(input: {
        plan: OracleRecipeSourceIndexPlan;
        index: OracleRecipeSourceIndexSnapshot | null;
        expectedRecipeHash: Uint8Array;
    }): {
        indexedSourceCount: number;
        complete: boolean;
        nextStep: OracleRecipeSourceIndexPlanStep | null;
    };
    deriveOracleRecipeSourceIndexPda(input: {
        oracleMonthPda: PublicKey;
        programId: PublicKey;
    }): PublicKey;
    deriveOracleBucketSourceIndexPda(input: {
        oracleMonthPda: PublicKey;
        bucketId: Uint8Array;
        programId: PublicKey;
    }): PublicKey;
    decodeOracleRecipeSourceIndex(input: {
        data: Uint8Array;
        oracleMonthPda: PublicKey;
        programId: PublicKey;
    }): OracleRecipeSourceIndexSnapshot;
    decodeOracleBucketSourceIndex(input: {
        data: Uint8Array;
        index: OracleRecipeSourceIndexSnapshot;
        bucketId: Uint8Array;
        programId: PublicKey;
    }): OracleBucketSourceIndexSnapshot;
}
/** No fallback to caller encoders, historical packages, or fabricated native exports. */
export declare function oracleMembershipRuntime(): OracleMembershipRuntime;
/** Invoked only by the normal SDK governed builder registry. */
export declare function buildNativeIndexOracleRecipeSourceV1Instruction(input: IndexOracleRecipeSourceV1Input): TransactionInstruction;
export {};
//# sourceMappingURL=current-oracle-membership-internal.d.ts.map