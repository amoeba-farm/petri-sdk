import type { Buffer } from "buffer";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as oracle from "@amoeba/spread-release-tools/oracle-dlmm";
import type { OracleRecipeWeightManifestPreviewBucket } from "@amoeba/spread-release-tools/oracle-dlmm";
import { AmebaProtocolError } from "../errors.js";

/** Source interface for the upcoming membership ABI; this does not qualify a release. */
export interface IndexOracleRecipeSourceV1Input {
  readonly programId?: PublicKey;
  readonly reverseSourceIndex?: number;
  readonly accounts: { readonly payer: PublicKey; readonly marketPda: PublicKey; readonly oracleMonthPda: PublicKey };
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
}

interface OracleMembershipRuntime {
  readonly INDEX_ORACLE_RECIPE_SOURCE_V1_TAG: 200;
  readonly ORACLE_RECIPE_SOURCE_INDEX_LEN: 209;
  readonly ORACLE_BUCKET_SOURCE_INDEX_HEADER_LEN: 110;
  readonly ORACLE_MEMBER_PAGE_LEN: 233;
  readonly ORACLE_MEMBERS_PER_PAGE: 6;
  readonly deriveOracleMemberPagePda: typeof oracle.deriveOracleMemberPagePda;
  readonly decodeOracleMemberPage: typeof oracle.decodeOracleMemberPage;
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
    expectedManifestHash: Uint8Array;
    accounts: IndexOracleRecipeSourceV1Input["accounts"];
    governance: import("@amoeba/spread-release-tools/governance-gate").GovernanceGateContextV1;
  }): { indexedSourceCount: number; complete: boolean; nextStep: OracleRecipeSourceIndexPlanStep | null };
  deriveOracleRecipeSourceIndexPda(input: { oracleMonthPda: PublicKey; programId: PublicKey }): PublicKey;
  deriveOracleBucketSourceIndexPda(input: { oracleMonthPda: PublicKey; bucketId: Uint8Array; programId: PublicKey }): PublicKey;
  decodeOracleRecipeSourceIndex(input: { data: Uint8Array; oracleMonthPda: PublicKey; programId: PublicKey }): OracleRecipeSourceIndexSnapshot;
  decodeOracleBucketSourceIndex(input: { data: Uint8Array; index: OracleRecipeSourceIndexSnapshot; bucketId: Uint8Array; programId: PublicKey }): OracleBucketSourceIndexSnapshot;
}

/** No fallback to caller encoders, historical packages, or fabricated native exports. */
export function oracleMembershipRuntime(): OracleMembershipRuntime {
  const runtime = oracle as unknown as Partial<OracleMembershipRuntime>;
  if (runtime.INDEX_ORACLE_RECIPE_SOURCE_V1_TAG !== 200
      || runtime.ORACLE_RECIPE_SOURCE_INDEX_LEN !== 209 || runtime.ORACLE_BUCKET_SOURCE_INDEX_HEADER_LEN !== 110
      || runtime.ORACLE_MEMBER_PAGE_LEN !== 233 || runtime.ORACLE_MEMBERS_PER_PAGE !== 6
      || [runtime.buildIndexOracleRecipeSourceV1Instruction, runtime.deriveOracleRecipeSourceIndexPda,
        runtime.deriveOracleBucketSourceIndexPda, runtime.decodeOracleRecipeSourceIndex,
        runtime.decodeOracleBucketSourceIndex, runtime.encodeIndexOracleRecipeSourceV1Params,
        runtime.buildOracleRecipeSourceIndexPlan, runtime.nextOracleRecipeSourceIndexStep,
        runtime.deriveOracleMemberPagePda, runtime.decodeOracleMemberPage].some(value => typeof value !== "function")) {
    throw new AmebaProtocolError("pinned Spread package does not provide the frozen recipe membership ABI; a qualified native package release is required", {
      code: "CURRENT_ORACLE_MEMBERSHIP_RUNTIME_UNAVAILABLE",
    });
  }
  return runtime as OracleMembershipRuntime;
}

/** Invoked only by the normal SDK governed builder registry. */
export function buildNativeIndexOracleRecipeSourceV1Instruction(input: IndexOracleRecipeSourceV1Input): TransactionInstruction {
  const runtime = oracleMembershipRuntime();
  if (runtime.encodeIndexOracleRecipeSourceV1Params(input.params).length !== 194) {
    throw new AmebaProtocolError("native recipe index payload must be exactly 194 bytes", { code: "CURRENT_ORACLE_MEMBERSHIP_INVALID" });
  }
  return runtime.buildIndexOracleRecipeSourceV1Instruction(input);
}
