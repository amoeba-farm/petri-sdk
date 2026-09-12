import { TransactionInstruction } from "@solana/web3.js";
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
export declare const FLAT_TRANSFER_OPERATION_PLAN_SCHEMA_VERSION: 1;
export declare const FLAT_TRANSFER_OPERATION: "transfer_flat";
export interface FlatTransferSemantic {
    readonly owner: string;
    readonly sleeve: string;
    readonly destinationOwner: string;
    readonly amountAtoms: string;
}
export interface FlatTransferObservedBytes {
    readonly mintDataBase64: string;
    readonly sourceLightDataBase64: string | null;
    readonly destinationLightDataBase64: string | null;
}
export interface FlatTransferColdAccountProofFacts {
    readonly ata: string;
    readonly owner: string;
    readonly mint: string;
    readonly amountAtoms: string;
    readonly includesColdBalance: true;
    readonly providerOriginSha256: string;
    readonly payer: string;
}
export interface FlatTransferAccountMeta {
    readonly address: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
}
export interface FlatTransferInstructionManifest {
    readonly programId: string;
    readonly instructionName: "CreateLightAssociatedTokenAccountIdempotent" | "LightTransferChecked" | "LightAccountLoad";
    readonly dataBase64: string;
    readonly accounts: readonly FlatTransferAccountMeta[];
}
export interface FlatTransferSignerRole {
    readonly pubkey: string;
    readonly role: "owner";
    readonly instructionIndexes: readonly number[];
}
export interface FlatTransferSetupSignerRole {
    readonly pubkey: string;
    readonly role: "owner";
    readonly setupBatchIndex: number;
    readonly instructionIndexes: readonly number[];
}
export interface FlatTransferOperationPlan {
    readonly schemaVersion: typeof FLAT_TRANSFER_OPERATION_PLAN_SCHEMA_VERSION;
    readonly operation: typeof FLAT_TRANSFER_OPERATION;
    readonly operationId: string;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly currentObservationDigest: string;
    readonly semantic: FlatTransferSemantic;
    readonly sourceState: "hot" | "cold";
    readonly destinationState: "hot" | "cold" | "absent";
    readonly sourceProofFacts: FlatTransferColdAccountProofFacts | null;
    readonly destinationProofFacts: FlatTransferColdAccountProofFacts | null;
    readonly observedBytes: FlatTransferObservedBytes;
    /** Payer-bound native Light load batches, excluding the final transfer action. */
    readonly setupInstructionBatches: readonly (readonly FlatTransferInstructionManifest[])[];
    readonly setupSignerRoles: readonly FlatTransferSetupSignerRole[];
    readonly instructions: readonly FlatTransferInstructionManifest[];
    /** Exact transaction grouping; the final load and main instructions are inseparable. */
    readonly executionInstructionBatches: readonly (readonly FlatTransferInstructionManifest[])[];
    readonly actionBatchIndex: number;
    readonly writeSet: readonly string[];
    readonly signerRoles: readonly FlatTransferSignerRole[];
    readonly preparedPlanDigest: string;
}
export interface PrepareFlatTransferOperationInput {
    readonly semantic: FlatTransferSemantic;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly observedBytes: FlatTransferObservedBytes;
    /** Required only when the source has compressed/cold custody. */
    readonly coldSource?: {
        readonly proofFacts: FlatTransferColdAccountProofFacts;
        /** Independently produced by the current Light resolver for this payer/source. */
        readonly setupInstructionBatches: readonly (readonly TransactionInstruction[])[];
    };
    /** Mutually exclusive with coldSource; the final destination load and transfer stay atomic. */
    readonly coldDestination?: {
        readonly proofFacts: FlatTransferColdAccountProofFacts;
        readonly setupInstructionBatches: readonly (readonly TransactionInstruction[])[];
    };
}
export interface ValidatedFlatTransferOperation {
    readonly plan: FlatTransferOperationPlan;
    readonly instructions: readonly TransactionInstruction[];
    readonly executionInstructionBatches: readonly (readonly TransactionInstruction[])[];
}
export interface BuildCanonicalFlatTransferActionInput {
    readonly semantic: FlatTransferSemantic;
    readonly mintDataBase64: string;
    readonly destinationExistsHot: boolean;
}
/** Build only the exact Light action; a caller still must bind observed state and any cold load plan. */
export declare function buildCanonicalFlatTransferAction(input: BuildCanonicalFlatTransferActionInput): readonly TransactionInstruction[];
/**
 * Build the exact current Light-token Flat transfer plan. Classic SPL is used
 * only for the sleeve mint itself; holder custody and movement are Light ATAs.
 */
export declare function prepareFlatTransferOperation(input: PrepareFlatTransferOperationInput): FlatTransferOperationPlan;
/** Rebuild all bytes and bind every explicit caller field before signing. */
export declare function validateFlatTransferOperationPlan(plan: FlatTransferOperationPlan, expected: PrepareFlatTransferOperationInput): ValidatedFlatTransferOperation;
//# sourceMappingURL=flat-transfer-operation.d.ts.map