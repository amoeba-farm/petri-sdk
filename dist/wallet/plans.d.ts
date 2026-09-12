import { type CurrentCollectiveLookupTableWitnessV1 } from "../protocol/current-collective-lookup-table.js";
import { type CurrentWriterDlmmOperation } from "../protocol/writer-dlmm-public.js";
/** Strict JSON decoding and digest validation for public RC44 prepare envelopes. */
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
import { type CurrentWalletInstructionManifest } from "./manifest.js";
export type CurrentCollectiveOperationKind = CurrentWriterDlmmOperation | "withdraw_principal" | "auction_refund" | "deposit" | "bid" | "close_begin" | "close_basket" | "close_finalize" | "close_cancel" | "settlement_claim_collective" | "settlement_claim_flat" | "transfer_flat" | "collective_swap_exact_in";
export interface CurrentWalletSignerRole {
    readonly pubkey: string;
    readonly role: string;
    readonly instructionIndexes: readonly number[];
}
export interface CurrentDecodedCollectivePlan {
    readonly raw: Readonly<Record<string, unknown>>;
    readonly operation: CurrentCollectiveOperationKind;
    readonly schemaVersion: 1 | 2;
    readonly operationId: string;
    readonly preparedPlanDigest: string;
    readonly currentObservation: CurrentFinalizedObservation;
    readonly currentObservationDigest: string;
    readonly leanAdmissionDigest: string;
    readonly semantic: Readonly<Record<string, unknown>>;
    readonly instructions: readonly CurrentWalletInstructionManifest[];
    readonly executionInstructionBatches: readonly (readonly CurrentWalletInstructionManifest[])[];
    readonly actionBatchIndex: number;
    readonly writeSet: readonly string[];
    readonly signerRoles: readonly CurrentWalletSignerRole[];
    readonly setupSignerRoles: readonly CurrentWalletSignerRole[];
    readonly setupMode: "none" | "cold_load" | "canonical_output_create" | "classic_output_create" | "writer_liquidity_compute";
    readonly transactionLookupTable?: CurrentCollectiveLookupTableWitnessV1;
    readonly coldProofFacts: Readonly<Record<string, unknown>> | null;
    readonly canonicalOutputFacts: Readonly<Record<string, unknown>> | null;
    readonly classicOutputFacts?: Readonly<Record<string, unknown>> | null;
    readonly observedBytes: Readonly<Record<string, unknown>> | null;
    readonly sourceState: "hot" | "cold" | null;
    readonly destinationState: "hot" | "cold" | "absent" | null;
}
export interface CurrentCollectiveOperationPrepareEnvelope {
    readonly operationPlan: CurrentDecodedCollectivePlan;
    readonly leanAdmission: Readonly<Record<string, unknown>>;
    readonly leanAdmissionDigest: string;
    readonly closeRequest: string | null;
    readonly stage: Readonly<Record<string, unknown>> | null;
}
export declare function decodeCollectiveOperationPrepareEnvelope(value: unknown): CurrentCollectiveOperationPrepareEnvelope;
//# sourceMappingURL=plans.d.ts.map