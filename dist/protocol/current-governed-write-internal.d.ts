import { PublicKey, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { type GovernanceGateContextV1, type GovernanceGateRpcV1 } from "./governance.js";
import { type BoundGovernedWriteReleaseV1 } from "./governed-transaction-internal.js";
import { type ReleaseBoundCurrentBuilderOutputV1 } from "./current-builders.js";
declare const SPREAD_CLUSTER_DOMAIN = "solana-devnet";
export interface SpreadGovernanceContextV1 {
    readonly cluster: {
        readonly clusterDomain: typeof SPREAD_CLUSTER_DOMAIN;
        readonly genesisHash: string;
    };
    readonly controllerProgram: PublicKey;
    readonly controllerConfig: PublicKey;
    readonly gate: PublicKey;
    readonly targetProgram: PublicKey;
    readonly targetProgramdata: PublicKey;
    readonly epoch: bigint;
    readonly finalizedObservationSlot: number;
}
export interface SpreadValidatedGovernanceEnvelopeV1 {
    readonly legacyData: Uint8Array;
    readonly legacyKeys: readonly AccountMeta[];
    readonly tail: {
        readonly expectedEpoch: bigint;
    };
}
export interface SpreadGovernanceRuntimeV1 {
    readonly GOVERNANCE_TAIL_LEN: number;
    readonly MAX_AMOEBA_INSTRUCTION_DATA_BYTES: number;
    bindAmoebaGovernanceGateContextV1(context: SpreadGovernanceContextV1): PublicKey;
    createAmoebaGovernedInstructionV1(fields: {
        readonly programId: PublicKey;
        readonly keys: readonly AccountMeta[];
        readonly data: Uint8Array;
    }): TransactionInstruction;
    assertAmoebaGovernanceEnvelopeV1(instruction: TransactionInstruction, context: SpreadGovernanceContextV1): SpreadValidatedGovernanceEnvelopeV1;
}
export interface BoundCurrentGovernedWriteV1 {
    readonly release: BoundGovernedWriteReleaseV1;
    readonly governance: GovernanceGateContextV1;
    readonly spreadGovernance: SpreadGovernanceContextV1;
    readonly governedProgramId: PublicKey;
    readonly runtime: SpreadGovernanceRuntimeV1;
}
export interface CurrentGovernedInstructionViewsV1 {
    readonly governedInstruction: TransactionInstruction;
    readonly semanticInstruction: TransactionInstruction;
    readonly governance: GovernanceGateContextV1;
    readonly spreadGovernance: SpreadGovernanceContextV1;
    readonly release: BoundGovernedWriteReleaseV1;
}
export interface CurrentGovernedBuilderMaterializationV1 {
    readonly instructions: readonly TransactionInstruction[];
    readonly governance: GovernanceGateContextV1;
    readonly release: BoundGovernedWriteReleaseV1;
}
type RuntimeLoaderV1 = () => Promise<SpreadGovernanceRuntimeV1>;
type BuilderInvokerV1 = (input: {
    readonly builderName: string;
    readonly builderInput: unknown;
    readonly governedProgramId: PublicKey;
}) => ReleaseBoundCurrentBuilderOutputV1;
export declare function isBoundCurrentGovernedProgramV1(programId: PublicKey): boolean;
export declare class CurrentGovernedWriteMaterializationError extends AmebaProtocolError {
    constructor(code: string, message: string, options?: {
        readonly cause?: unknown;
    });
}
/** @internal Positive-path seam used by the release-owned public facade and fixtures. */
export declare function prepareBoundCurrentGovernedWriteV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly minimumContextSlot: number;
    readonly release: BoundGovernedWriteReleaseV1;
    readonly loadRuntime?: RuntimeLoaderV1;
}): Promise<BoundCurrentGovernedWriteV1>;
/** @internal Builds only through the SDK-owned official-builder registry. */
export declare function materializeBoundCurrentGovernedBuilderV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly minimumContextSlot: number;
    readonly release: BoundGovernedWriteReleaseV1;
    readonly builderName: string;
    readonly builderInput: unknown;
    readonly loadRuntime?: RuntimeLoaderV1;
    readonly invokeBuilder?: BuilderInvokerV1;
}): Promise<CurrentGovernedBuilderMaterializationV1>;
/**
 * Resolves the semantic view only after both the pinned Spread validator and
 * the independent SDK validator agree on the exact gate, epoch, keys, and
 * trailer. Arbitrary lookalike trailers are never stripped.
 */
export declare function semanticCurrentSpreadInstructionV1(instruction: TransactionInstruction): TransactionInstruction;
/** @internal Used by compressed transport before legacy access decoding. */
export declare function governedCurrentSpreadInstructionViewsV1(instruction: TransactionInstruction): CurrentGovernedInstructionViewsV1;
/** @internal Validates and registers a canonical compressed outer instruction. */
export declare function registerCurrentSpreadGovernedOutputV1(input: {
    readonly sourceInstruction: TransactionInstruction;
    readonly outputInstruction: TransactionInstruction;
}): CurrentGovernedInstructionViewsV1;
/** @internal Defensive clone that retains SDK validation provenance. */
export declare function cloneCurrentSpreadInstructionPreservingRegistrationV1(instruction: TransactionInstruction): TransactionInstruction;
/** @internal Re-observes finalized gate state immediately before compilation. */
export declare function revalidateFreshCurrentGovernedInstructionsV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly instructions: readonly TransactionInstruction[];
}): Promise<CurrentGovernedBuilderMaterializationV1>;
/** @internal Positive-path fixture seam. */
export declare function inspectBoundCurrentGovernedInstructionV1(input: {
    readonly instruction: TransactionInstruction;
    readonly binding: BoundCurrentGovernedWriteV1;
}): CurrentGovernedInstructionViewsV1;
export {};
//# sourceMappingURL=current-governed-write-internal.d.ts.map