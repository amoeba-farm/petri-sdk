import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { type CurrentWriterDlmmOperation } from "./writer-dlmm-public.js";
import { type CurrentCollectiveLookupTableWitnessV1 } from "./current-collective-lookup-table.js";
export declare const WRITER_OPERATION_PLAN_SCHEMA_VERSION: 1;
export declare const WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION: 2;
export declare const WRITER_INSTRUCTION_OUTER_BYTE_CAP: 16384;
export type WriterOperationKind = CurrentWriterDlmmOperation | "deposit" | "withdraw_principal" | "auction_refund" | "bid" | "close_begin" | "close_basket" | "close_finalize" | "close_cancel" | "settlement_claim_collective" | "settlement_claim_flat" | "policy_activate" | "auction_commit" | "auction_reveal" | "auction_plan" | "auction_fill" | "auction_finalize" | "supply_reconcile" | "settlement_publish" | "settlement_finalize";
export type CurrentWriterPublicOperationRequest = {
    readonly operation: "auction_refund";
    readonly owner: string;
    readonly auction: string;
    readonly bid: string;
} | {
    readonly operation: "withdraw_principal";
    readonly owner: string;
    readonly sleeve: string;
    readonly amountAtoms: string;
};
/** Canonical public intent; destinations and refundable amounts are read from protocol state. */
export declare function validateCurrentWriterPublicOperationRequest(value: unknown): CurrentWriterPublicOperationRequest;
export interface WriterInstructionAccountMeta {
    readonly address: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
}
export interface WriterInstructionManifest {
    readonly programId: typeof AMOEBA_SPREAD_PROGRAM_ID;
    readonly instructionName: string;
    readonly instructionTag: number;
    readonly dataBase64: string;
    readonly accounts: readonly WriterInstructionAccountMeta[];
}
export interface WriterSignerRole {
    readonly pubkey: string;
    readonly role: string;
    readonly instructionIndexes: readonly number[];
}
export interface WriterColdAccountProofFacts {
    readonly ata: string;
    readonly owner: string;
    readonly mint: string;
    readonly amountAtoms: string;
    /** Lean-admitted exact balance requirement for this close stage. */
    readonly minimumAmountAtoms: string;
    readonly includesColdBalance: true;
    readonly providerOriginSha256: string;
    readonly payer: string;
}
export interface WriterCanonicalOutputSetupFacts {
    readonly ata: string;
    readonly owner: string;
    readonly mint: string;
    readonly payer: string;
}
export interface WriterSetupInstructionManifest {
    readonly programId: string;
    readonly instructionName: "LightAccountLoad" | "CreateAssociatedTokenAccountIdempotent" | "RequestHeapFrame" | "SetComputeUnitLimit";
    readonly dataBase64: string;
    readonly accounts: readonly WriterInstructionAccountMeta[];
}
export interface WriterSetupSignerRole {
    readonly pubkey: string;
    readonly role: "payer";
    readonly setupBatchIndex: number;
    readonly instructionIndexes: readonly number[];
}
interface WriterOperationPlanBase {
    readonly collectiveClaimSeriesBookBase64?: string;
    readonly operation: WriterOperationKind;
    readonly operationId: string;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly currentObservationDigest: string;
    readonly leanAdmissionDigest: string;
    /** Exact caller-controlled semantics; PDA/meta fields are deliberately excluded. */
    readonly semantic: Readonly<Record<string, unknown>>;
    readonly instructions: readonly WriterInstructionManifest[];
    readonly writeSet: readonly string[];
    readonly signerRoles: readonly WriterSignerRole[];
    readonly preparedPlanDigest: string;
}
/** Byte-for-byte compatible hot-only writer plan. */
export interface WriterOperationPlanV1 extends WriterOperationPlanBase {
    readonly schemaVersion: typeof WRITER_OPERATION_PLAN_SCHEMA_VERSION;
}
/** Cold-capable writer plan with one independently authenticated Light ATA load. */
export interface WriterOperationPlanV2 extends WriterOperationPlanBase {
    readonly schemaVersion: typeof WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION;
    readonly setupMode: "cold_load" | "canonical_output_create" | "classic_output_create" | "writer_liquidity_compute";
    readonly transactionLookupTable?: CurrentCollectiveLookupTableWitnessV1;
    readonly coldAccountProofFacts?: WriterColdAccountProofFacts;
    readonly canonicalOutputSetupFacts?: WriterCanonicalOutputSetupFacts;
    readonly classicOutputSetupFacts?: WriterCanonicalOutputSetupFacts;
    readonly setupInstructionBatches: readonly (readonly WriterSetupInstructionManifest[])[];
    readonly setupSignerRoles: readonly WriterSetupSignerRole[];
    /** Exact grouping; the final Light load batch and writer action are inseparable. */
    readonly executionInstructionBatches: readonly (readonly (WriterSetupInstructionManifest | WriterInstructionManifest)[])[];
    readonly actionBatchIndex: number;
}
export type WriterOperationPlan = WriterOperationPlanV1 | WriterOperationPlanV2;
export interface PrepareWriterOperationInput {
    /** Optional exact finalized ALT account for the writer liquidity candidate transport. */
    readonly transactionLookupTable?: CurrentCollectiveLookupTableWitnessV1;
    /** Exact finalized series-book bytes bound by currentObservation. Collective claims only. */
    readonly collectiveClaimSeriesBookBase64?: string;
    readonly operation: WriterOperationKind;
    /** Exact caller-controlled semantics independently decoded from the public request. */
    readonly semantic: Readonly<Record<string, unknown>>;
    readonly currentObservation: CurrentFinalizedObservation;
    /** Digest returned by the private Lean admission route. */
    readonly leanAdmissionDigest: string;
    /** Instructions built by the native, RC44-pinned SDK builder. */
    readonly instructions: readonly TransactionInstruction[];
    readonly writeSet: readonly (PublicKey | string)[];
    readonly signerRoles: readonly WriterSignerRole[];
    /** At most one final cold Light ATA may be loaded by an independently built native plan. */
    readonly coldAccount?: {
        readonly proofFacts: WriterColdAccountProofFacts;
        readonly setupInstructionBatches: readonly (readonly TransactionInstruction[])[];
    };
    /** Cancellation output ATA facts; the SDK constructs the exact native create batch. */
    readonly canonicalOutput?: {
        readonly setupFacts: WriterCanonicalOutputSetupFacts;
    };
    /** Exact canonical classic SPL output creation; can coexist with a cold Flat input. */
    readonly classicOutput?: {
        readonly setupFacts: WriterCanonicalOutputSetupFacts;
    };
}
/** Immutable SDK-local parity facts; runtime route availability remains an Edge concern. */
export declare const CURRENT_WRITER_OPERATION_CAPABILITIES: Readonly<{
    sdkContract: "writer-operation-plan-v2";
    schemaVersion: 2;
    protocolRelease: "v0.1.0-rc.44";
    protocolSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
    hotPlanSchemaVersion: 1;
    coldPlanSchemaVersion: 2;
    operations: Readonly<{
        closeBegin: Readonly<{
            operation: "close_begin";
            instructionName: "BeginWriterCloseV1";
            instructionTag: 240;
            typescriptBuilder: true;
            rustValidator: true;
            coldLightSetup: true;
            canonicalOutputSetup: false;
        }>;
        closeBasket: Readonly<{
            operation: "close_basket";
            instructionName: "DepositWriterCloseBasketV1";
            instructionTag: 241;
            typescriptBuilder: true;
            rustValidator: true;
            coldLightSetup: true;
            canonicalOutputSetup: false;
        }>;
        closeFinalize: Readonly<{
            operation: "close_finalize";
            instructionName: "FinalizeWriterCloseV1";
            instructionTag: 242;
            typescriptBuilder: true;
            rustValidator: true;
            coldLightSetup: false;
            canonicalOutputSetup: false;
        }>;
        closeCancelSeries: Readonly<{
            operation: "close_cancel";
            instructionName: "ProcessWriterCloseCancellationV1";
            instructionTag: 243;
            typescriptBuilder: true;
            rustValidator: true;
            coldLightSetup: false;
            canonicalOutputSetup: true;
        }>;
        closeCancelFlat: Readonly<{
            operation: "close_cancel";
            instructionName: "ProcessWriterCloseCancellationV1";
            instructionTag: 243;
            typescriptBuilder: true;
            rustValidator: true;
            coldLightSetup: false;
            canonicalOutputSetup: true;
        }>;
    }>;
}>;
/** Convert a native writer instruction into its portable exact-byte manifest. */
export declare function writerInstructionManifest(instruction: TransactionInstruction): WriterInstructionManifest;
/**
 * Bind finalized chain observation, private-Lean admission, and native instruction bytes.
 * This performs no financial calculation; Spread revalidates every liability and amount.
 */
export declare function prepareWriterOperation(input: PrepareWriterOperationInput): WriterOperationPlan;
/** Exact pre-observation native setup used for a cancellation output ATA. */
export declare function currentWriterCanonicalOutputSetupInstructionBatches(input: {
    readonly payer: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
}): readonly (readonly TransactionInstruction[])[];
/** Source-owned exact output prerequisite, available before finalized observation capture. */
export declare function currentWriterClassicOutputSetupInstructionBatches(input: {
    readonly payer: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
}): readonly (readonly TransactionInstruction[])[];
/** Exact portable-plan validation used before bounded submission. */
export declare function validateWriterOperationPlan(plan: WriterOperationPlan, independentlyRebuilt: PrepareWriterOperationInput): WriterOperationPlan;
export {};
//# sourceMappingURL=writer-operation.d.ts.map