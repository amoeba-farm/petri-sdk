import { createHash } from "node:crypto";
import { decodeWriterSeriesBook } from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import { deriveWriterRetirementCustodyPda, WRITER_ACCOUNT_SIZES } from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";

import {
  validateCurrentFinalizedObservation,
  type CurrentFinalizedObservation,
} from "../current-finalized-observation.js";
import { AmebaProtocolError } from "../errors.js";
import {
  CURRENT_LIGHT_TOKEN_ACCOUNT_SIZE,
  CURRENT_LIGHT_TOKEN_PROGRAM_ID,
  deriveLightAssociatedTokenAddress,
  deriveClassicAssociatedTokenAddress,
  createClassicAssociatedTokenAccountIdempotentInstruction,
  CLASSIC_ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@amoeba/spread-release-tools/token-primitives";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import {
  CURRENT_PROTOCOL_RELEASE,
  CURRENT_PROTOCOL_SOURCE_COMMIT,
  CURRENT_VAULT_INSTRUCTION_TAG,
} from "./current.js";
import { decodeCurrentVaultInstruction } from "./current-instructions.js";
import { buildCurrentCreateLightAtaIdempotentInstruction } from "./current-light-token-instructions.js";
import { validateCurrentLightTransfer2LoadSequence } from "./current-light-transfer2.js";
import { semanticCurrentSpreadInstructionV1 } from "./current-governed-write-internal.js";
import { isCurrentWriterDlmmOperation, type CurrentWriterDlmmOperation } from "./writer-dlmm-public.js";
import { requireWriterDlmmWireBindingV1 } from "./writer-dlmm-wire.js";
import { currentWriterDlmmComputeInstructions, CURRENT_WRITER_DLMM_TRANSPORT_V1 } from "./writer-dlmm-transport.js";
import { decodeCurrentCollectiveLookupTableV1, type CurrentCollectiveLookupTableWitnessV1 } from "./current-collective-lookup-table.js";
import { compileCurrentWalletUnsignedBatch } from "../wallet/transaction.js";

export const WRITER_OPERATION_PLAN_SCHEMA_VERSION = 1 as const;
export const WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION = 2 as const;
export const WRITER_INSTRUCTION_OUTER_BYTE_CAP = 16_384 as const;

const COMPUTE_BUDGET_PROGRAM = new PublicKey("ComputeBudget111111111111111111111111111111");
const WRITER_CANONICAL_OUTPUT_COMPUTE_UNITS = 600_000;
export type WriterOperationKind =
  | CurrentWriterDlmmOperation
  | "deposit"
  | "withdraw_principal"
  | "auction_refund"
  | "bid"
  | "close_begin"
  | "close_basket"
  | "close_finalize"
  | "close_cancel"
  | "settlement_claim_collective"
  | "settlement_claim_flat"
  | "policy_activate"
  | "auction_commit"
  | "auction_reveal"
  | "auction_plan"
  | "auction_fill"
  | "auction_finalize"
  | "supply_reconcile"
  | "settlement_publish"
  | "settlement_finalize";

export type CurrentWriterPublicOperationRequest =
  | { readonly operation: "auction_refund"; readonly owner: string; readonly auction: string; readonly bid: string }
  | { readonly operation: "withdraw_principal"; readonly owner: string; readonly sleeve: string; readonly amountAtoms: string };

/** Canonical public intent; destinations and refundable amounts are read from protocol state. */
export function validateCurrentWriterPublicOperationRequest(value: unknown): CurrentWriterPublicOperationRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "writer request must be an object");
  }
  const request = value as Record<string, unknown>;
  const operation = request.operation;
  if (operation !== "auction_refund" && operation !== "withdraw_principal") {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "unknown writer request operation");
  }
  const fields = operation === "auction_refund" ? ["operation", "owner", "auction", "bid"]
    : ["operation", "owner", "sleeve", "amountAtoms"];
  requireExactSemanticKeys(request, fields);
  const addressField = (field: string): string => {
    if (typeof request[field] !== "string") throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", `${field} must be canonical base58`);
    return canonicalPublicKey(request[field] as string, field).toBase58();
  };
  const owner = addressField("owner");
  if (operation === "auction_refund") return Object.freeze({ operation, owner,
    auction: addressField("auction"),
    bid: addressField("bid") });
  if (typeof request.amountAtoms !== "string" || !/^[1-9][0-9]*$/.test(request.amountAtoms)
    || BigInt(request.amountAtoms) > 18_446_744_073_709_551_615n) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "amountAtoms must be a positive canonical u64");
  }
  return Object.freeze({ operation, owner, sleeve: addressField("sleeve"), amountAtoms: request.amountAtoms });
}

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
  readonly executionInstructionBatches: readonly (readonly (
    WriterSetupInstructionManifest | WriterInstructionManifest
  )[])[];
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
  readonly classicOutput?: { readonly setupFacts: WriterCanonicalOutputSetupFacts };
}

const WRITER_TAG_NAMES = new Map<number, string>(
  Object.entries(CURRENT_VAULT_INSTRUCTION_TAG)
    .filter(([, tag]) => tag >= 220 && tag <= 248)
    .map(([name, tag]) => [tag, name]),
);

const OPERATION_TAGS: Readonly<Record<WriterOperationKind, readonly number[]>> = Object.freeze({
  writer_liquidity_policy_begin: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  writer_liquidity_policy_append: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  writer_liquidity_policy_seal: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  writer_liquidity_initialize: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  writer_liquidity_add: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  writer_liquidity_remove: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  writer_liquidity_sweep: [CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1],
  deposit: [CURRENT_VAULT_INSTRUCTION_TAG.DepositWriterPrincipalV1],
  withdraw_principal: [CURRENT_VAULT_INSTRUCTION_TAG.WithdrawWriterPrincipalV1],
  auction_refund: [CURRENT_VAULT_INSTRUCTION_TAG.CancelOrRefundWriterBidV1],
  bid: [CURRENT_VAULT_INSTRUCTION_TAG.PlaceWriterBidV1],
  close_begin: [CURRENT_VAULT_INSTRUCTION_TAG.BeginWriterCloseV1],
  close_basket: [CURRENT_VAULT_INSTRUCTION_TAG.DepositWriterCloseBasketV1],
  close_finalize: [CURRENT_VAULT_INSTRUCTION_TAG.FinalizeWriterCloseV1],
  close_cancel: [CURRENT_VAULT_INSTRUCTION_TAG.ProcessWriterCloseCancellationV1],
  settlement_claim_collective: [CURRENT_VAULT_INSTRUCTION_TAG.ClaimCollectiveLongV1],
  settlement_claim_flat: [CURRENT_VAULT_INSTRUCTION_TAG.ClaimWriterFlatResidualV1],
  policy_activate: [
    CURRENT_VAULT_INSTRUCTION_TAG.SealWriterPolicyV1,
    CURRENT_VAULT_INSTRUCTION_TAG.ActivateWriterSleeveV1,
  ],
  auction_commit: [CURRENT_VAULT_INSTRUCTION_TAG.CommitWriterAuctionV1],
  auction_reveal: [CURRENT_VAULT_INSTRUCTION_TAG.RevealWriterAuctionV1],
  auction_plan: [CURRENT_VAULT_INSTRUCTION_TAG.PlanWriterAuctionChunkV1],
  auction_fill: [CURRENT_VAULT_INSTRUCTION_TAG.ExecuteWriterAuctionFillV1],
  auction_finalize: [CURRENT_VAULT_INSTRUCTION_TAG.FinalizeOrAbortWriterAuctionV1],
  supply_reconcile: [CURRENT_VAULT_INSTRUCTION_TAG.ReconcileWriterSupplyV1],
  settlement_publish: [CURRENT_VAULT_INSTRUCTION_TAG.PublishWriterGroupSettlementV1],
  settlement_finalize: [CURRENT_VAULT_INSTRUCTION_TAG.FinalizeWriterSleeveSettlementV1],
});

/** Immutable SDK-local parity facts; runtime route availability remains an Edge concern. */
export const CURRENT_WRITER_OPERATION_CAPABILITIES = Object.freeze({
  sdkContract: "writer-operation-plan-v2" as const,
  schemaVersion: WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION,
  protocolRelease: CURRENT_PROTOCOL_RELEASE,
  protocolSourceCommit: CURRENT_PROTOCOL_SOURCE_COMMIT,
  hotPlanSchemaVersion: WRITER_OPERATION_PLAN_SCHEMA_VERSION,
  coldPlanSchemaVersion: WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION,
  operations: Object.freeze({
    closeBegin: Object.freeze({
      operation: "close_begin" as const,
      instructionName: "BeginWriterCloseV1" as const,
      instructionTag: CURRENT_VAULT_INSTRUCTION_TAG.BeginWriterCloseV1,
      typescriptBuilder: true,
      rustValidator: true,
      coldLightSetup: true,
      canonicalOutputSetup: false,
    }),
    closeBasket: Object.freeze({
      operation: "close_basket" as const,
      instructionName: "DepositWriterCloseBasketV1" as const,
      instructionTag: CURRENT_VAULT_INSTRUCTION_TAG.DepositWriterCloseBasketV1,
      typescriptBuilder: true,
      rustValidator: true,
      coldLightSetup: true,
      canonicalOutputSetup: false,
    }),
    closeFinalize: Object.freeze({
      operation: "close_finalize" as const,
      instructionName: "FinalizeWriterCloseV1" as const,
      instructionTag: CURRENT_VAULT_INSTRUCTION_TAG.FinalizeWriterCloseV1,
      typescriptBuilder: true,
      rustValidator: true,
      coldLightSetup: false,
      canonicalOutputSetup: false,
    }),
    closeCancelSeries: Object.freeze({
      operation: "close_cancel" as const,
      instructionName: "ProcessWriterCloseCancellationV1" as const,
      instructionTag: CURRENT_VAULT_INSTRUCTION_TAG.ProcessWriterCloseCancellationV1,
      typescriptBuilder: true,
      rustValidator: true,
      coldLightSetup: false,
      canonicalOutputSetup: true,
    }),
    closeCancelFlat: Object.freeze({
      operation: "close_cancel" as const,
      instructionName: "ProcessWriterCloseCancellationV1" as const,
      instructionTag: CURRENT_VAULT_INSTRUCTION_TAG.ProcessWriterCloseCancellationV1,
      typescriptBuilder: true,
      rustValidator: true,
      coldLightSetup: false,
      canonicalOutputSetup: true,
    }),
  }),
});

/** Convert a native writer instruction into its portable exact-byte manifest. */
export function writerInstructionManifest(
  instruction: TransactionInstruction,
): WriterInstructionManifest {
  if (!instruction.programId.equals(new PublicKey(AMOEBA_SPREAD_PROGRAM_ID))) {
    throw writerPlanError("WRITER_PLAN_PROGRAM_MISMATCH", "writer instruction is not owned by the pinned Spread program");
  }
  if (instruction.data.length === 0 || instruction.data.length > WRITER_INSTRUCTION_OUTER_BYTE_CAP) {
    throw writerPlanError("WRITER_PLAN_INSTRUCTION_SIZE", "writer instruction data must contain 1..16384 bytes");
  }
  const instructionTag = instruction.data[0]!;
  const instructionName = WRITER_TAG_NAMES.get(instructionTag);
  if (instructionName === undefined) {
    throw writerPlanError("WRITER_PLAN_TAG_INVALID", `instruction tag ${instructionTag} is not an RC44 collective-writer tag`);
  }
  const semanticInstruction = semanticCurrentSpreadInstructionV1(instruction);
  const decoded = decodeCurrentVaultInstruction(semanticInstruction.data);
  if (decoded.tag !== instructionTag) {
    throw writerPlanError("WRITER_PLAN_DATA_INVALID", "writer payload decoder returned a different instruction tag");
  }
  return Object.freeze({
    programId: AMOEBA_SPREAD_PROGRAM_ID,
    instructionName,
    instructionTag,
    dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({
      address: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    }))),
  });
}

/**
 * Bind finalized chain observation, private-Lean admission, and native instruction bytes.
 * This performs no financial calculation; Spread revalidates every liability and amount.
 */
export function prepareWriterOperation(input: PrepareWriterOperationInput): WriterOperationPlan {
  const observation = validateCurrentFinalizedObservation(input.currentObservation);
  requireDigest(input.leanAdmissionDigest, "leanAdmissionDigest");
  const semantic = canonicalSemantic(input.semantic);
  if (input.instructions.length === 0 || input.instructions.length > 32) {
    throw writerPlanError("WRITER_PLAN_INSTRUCTION_COUNT", "writer plan must contain 1..32 instructions");
  }
  const instructions = Object.freeze(input.instructions.map(writerInstructionManifest));
  const semanticInstructions = Object.freeze(
    input.instructions.map(semanticCurrentSpreadInstructionV1),
  );
  requireOperationTags(input.operation, instructions);
  requireWriterSemanticBinding(input.operation, semantic, semanticInstructions, observation, input.collectiveClaimSeriesBookBase64);
  const collectiveClaimWitness = input.collectiveClaimSeriesBookBase64 === undefined
    ? {} : { collectiveClaimSeriesBookBase64: input.collectiveClaimSeriesBookBase64 };
  const signerRoles = canonicalSignerRoles(input.signerRoles, instructions.length);
  requireExactSignerCoverage(signerRoles, instructions);

  if (isCurrentWriterDlmmOperation(input.operation)) {
    if (input.coldAccount !== undefined || input.canonicalOutput !== undefined || input.classicOutput !== undefined) {
      throw writerPlanError("WRITER_PLAN_SETUP_INVALID", "writer liquidity uses its exact compute prefix and native inline custody setup");
    }
    requireObservedInstructionAccounts(observation, semanticInstructions);
    const lookup = input.transactionLookupTable === undefined ? null : decodeCurrentCollectiveLookupTableV1(input.transactionLookupTable, observation);
    const lookupFields = lookup === null ? {} : { transactionLookupTable: lookup.witness };
    const setup = currentWriterDlmmComputeInstructions();
    const setupInstructionBatches = Object.freeze([Object.freeze(setup.map((instruction, index): WriterSetupInstructionManifest => Object.freeze({
      programId: instruction.programId.toBase58(),
      instructionName: index === 0 ? "RequestHeapFrame" : "SetComputeUnitLimit",
      dataBase64: CURRENT_WRITER_DLMM_TRANSPORT_V1.setupInstructionDataBase64[index]!, accounts: Object.freeze([]),
    })))]);
    const setupSignerRoles = Object.freeze([]) as readonly WriterSetupSignerRole[];
    const executionInstructionBatches = Object.freeze([Object.freeze([...setupInstructionBatches[0]!, ...instructions])]);
    const actionBatchIndex = 0;
    const writeSet = canonicalAddresses(input.writeSet);
    requireExactWriteSet(writeSet, instructions);
    compileCurrentWalletUnsignedBatch(new PublicKey(semantic.owner as string), PublicKey.default.toBase58(),
      [...setup, ...input.instructions], lookup === null ? [] : [lookup.account]);
    const fields = { operation: input.operation, currentObservationDigest: observation.currentObservationDigest,
      leanAdmissionDigest: input.leanAdmissionDigest, semantic, setupMode: "writer_liquidity_compute" as const,
      ...lookupFields, setupInstructionBatches, setupSignerRoles, instructions, executionInstructionBatches,
      actionBatchIndex, writeSet, signerRoles };
    const operationId = digestCanonical({ domain: "ameba:writer_operation_id:v2", ...fields });
    const withoutDigest = Object.freeze({ schemaVersion: WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION,
      ...fields, operationId, currentObservation: observation });
    return Object.freeze({ ...withoutDigest,
      preparedPlanDigest: digestCanonical({ domain: "ameba:writer_prepared_plan:v2", plan: withoutDigest }) });
  }
  if (input.transactionLookupTable !== undefined) throw writerPlanError("WRITER_PLAN_SETUP_INVALID", "lookup witness is only supported by writer liquidity transport");

  const lightAccount = writerLightAccountExpectation(input.operation, semanticInstructions);
  if (input.coldAccount !== undefined && input.canonicalOutput !== undefined) {
    throw writerPlanError(
      "WRITER_PLAN_SETUP_INVALID",
      "writer schema-v2 setup must select exactly one setup mode",
    );
  }
  if (input.coldAccount === undefined && input.canonicalOutput === undefined && input.classicOutput === undefined) {
    if (lightAccount !== null) requireHotLightAccount(observation, lightAccount.target);
    // Governance freshness is independently bound and revalidated. The
    // finalized business-state observation must not gain a synthetic
    // requirement to inventory the absolute-final read-only gate account.
    requireObservedInstructionAccounts(observation, semanticInstructions);
    const writeSet = canonicalAddresses(input.writeSet);
    requireExactWriteSet(writeSet, instructions);
    const operationId = digestCanonical({
      domain: "ameba:writer_operation_id:v1",
      ...collectiveClaimWitness,
      operation: input.operation,
      currentObservationDigest: observation.currentObservationDigest,
      leanAdmissionDigest: input.leanAdmissionDigest,
      semantic,
      instructions,
      writeSet,
      signerRoles,
    });
    const withoutDigest = Object.freeze({
      schemaVersion: WRITER_OPERATION_PLAN_SCHEMA_VERSION,
      ...collectiveClaimWitness,
      operation: input.operation,
      operationId,
      currentObservation: observation,
      currentObservationDigest: observation.currentObservationDigest,
      leanAdmissionDigest: input.leanAdmissionDigest,
      semantic,
      instructions,
      writeSet,
      signerRoles,
    });
    return Object.freeze({
      ...withoutDigest,
      preparedPlanDigest: digestCanonical({ domain: "ameba:writer_prepared_plan:v1", plan: withoutDigest }),
    });
  }

  if (lightAccount === null && input.classicOutput === undefined) {
    throw writerPlanError(
      "WRITER_PLAN_COLD_ACCOUNT_INVALID",
      `${input.operation} does not have one supported cold Light ATA`,
    );
  }
  let setupMode: WriterOperationPlanV2["setupMode"];
  let setupFacts: { readonly coldAccountProofFacts?: WriterColdAccountProofFacts;
    readonly canonicalOutputSetupFacts?: WriterCanonicalOutputSetupFacts;
    readonly classicOutputSetupFacts?: WriterCanonicalOutputSetupFacts };
  let setupInstructions: readonly (readonly TransactionInstruction[])[];
  if (input.coldAccount !== undefined) {
    if (lightAccount === null) throw writerPlanError("WRITER_PLAN_COLD_ACCOUNT_INVALID", "operation has no Light input");
    if (!["close_begin", "close_basket", "withdraw_principal", "settlement_claim_collective", "settlement_claim_flat"].includes(input.operation)) {
      throw writerPlanError(
        "WRITER_PLAN_COLD_ACCOUNT_INVALID",
        "cold-load setup requires an exact principal withdrawal, settlement claim or close input",
      );
    }
    requireColdLightAccount(observation, lightAccount.target);
    const coldAccountProofFacts = canonicalWriterColdProof(
      input.coldAccount.proofFacts,
      lightAccount,
    );
    setupMode = "cold_load";
    setupFacts = Object.freeze({ coldAccountProofFacts });
    setupInstructions = canonicalWriterColdSetupBatches(
      input.coldAccount.setupInstructionBatches,
      lightAccount,
      coldAccountProofFacts,
    );
  } else if (input.canonicalOutput !== undefined) {
    if (lightAccount === null) throw writerPlanError("WRITER_PLAN_CANONICAL_OUTPUT_INVALID", "operation has no Light output");
    if (input.operation !== "close_cancel" || input.canonicalOutput === undefined) {
      throw writerPlanError(
        "WRITER_PLAN_CANONICAL_OUTPUT_INVALID",
        "canonical-output setup is admitted only for close cancellation",
      );
    }
    const canonicalOutputSetupFacts = canonicalWriterOutputFacts(
      input.canonicalOutput.setupFacts,
      lightAccount,
    );
    requireCanonicalOutputLightAccount(observation, lightAccount.target);
    setupMode = "canonical_output_create";
    setupFacts = Object.freeze({ canonicalOutputSetupFacts });
    setupInstructions = canonicalWriterOutputSetupBatch(canonicalOutputSetupFacts);
  } else {
    if (lightAccount !== null) requireHotLightAccount(observation, lightAccount.target);
    setupMode = "classic_output_create";
    setupFacts = {};
    setupInstructions = [ [ComputeBudgetProgram.setComputeUnitLimit({ units: WRITER_CANONICAL_OUTPUT_COMPUTE_UNITS })] ];
  }
  if (input.classicOutput !== undefined) {
    if (input.canonicalOutput !== undefined) throw writerPlanError("WRITER_PLAN_SETUP_INVALID", "Light and classic output setup cannot be mixed");
    const facts = canonicalWriterClassicOutputFacts(input.classicOutput.setupFacts, input.operation, semanticInstructions[0]!, observation);
    setupFacts = { ...setupFacts, classicOutputSetupFacts: facts };
    const create = currentWriterClassicOutputSetupInstructionBatches({ payer: new PublicKey(facts.payer), owner: new PublicKey(facts.owner), mint: new PublicKey(facts.mint) })[0]![1]!;
    setupInstructions = setupInstructions.map((batch, index) => index === setupInstructions.length - 1 ? [...batch, create] : [...batch]);
  }
  const setupPayer = semanticInstructions[0]!.keys[0]!.pubkey;
  const setupInstructionBatches = Object.freeze(setupInstructions.map((batch) => Object.freeze(
    batch.map(writerSetupInstructionManifest),
  )));
  const setupSignerRoles = Object.freeze(setupInstructions.map((batch, setupBatchIndex) => Object.freeze({
    pubkey: setupPayer.toBase58(),
    role: "payer" as const,
    setupBatchIndex,
    instructionIndexes: Object.freeze(batch.flatMap((instruction, instructionIndex) =>
      instruction.keys.some((meta) => meta.isSigner && meta.pubkey.equals(setupPayer))
        ? [instructionIndex]
        : [],
    )),
  })));
  const executionInstructionBatches = Object.freeze(setupInstructionBatches.map((batch, index) => Object.freeze(
    index === setupInstructionBatches.length - 1 ? [...batch, ...instructions] : [...batch],
  )));
  const actionBatchIndex = executionInstructionBatches.length - 1;
  const allManifests = Object.freeze([
    ...setupInstructionBatches.flatMap((batch) => [...batch]),
    ...instructions,
  ]);
  const allObservationInstructions = Object.freeze([
    ...setupInstructions.flatMap((batch) => [...batch]),
    ...semanticInstructions,
  ]);
  requireObservedInstructionAccounts(observation, allObservationInstructions);
  const writeSet = canonicalAddresses(input.writeSet);
  requireExactWriteSet(writeSet, allManifests);
  const operationId = digestCanonical({
    domain: "ameba:writer_operation_id:v2",
    operation: input.operation,
    currentObservationDigest: observation.currentObservationDigest,
    leanAdmissionDigest: input.leanAdmissionDigest,
    semantic,
    setupMode, ...setupFacts, setupInstructionBatches, setupSignerRoles,
    instructions, executionInstructionBatches, actionBatchIndex, writeSet, signerRoles,
  });
  const withoutDigest = Object.freeze({
    schemaVersion: WRITER_OPERATION_PLAN_SETUP_SCHEMA_VERSION,
    operation: input.operation,
    operationId,
    currentObservation: observation,
    currentObservationDigest: observation.currentObservationDigest,
    leanAdmissionDigest: input.leanAdmissionDigest,
    semantic,
    setupMode, ...setupFacts, setupInstructionBatches, setupSignerRoles,
    instructions, executionInstructionBatches, actionBatchIndex, writeSet, signerRoles,
  });
  return Object.freeze({
    ...withoutDigest,
    preparedPlanDigest: digestCanonical({ domain: "ameba:writer_prepared_plan:v2", plan: withoutDigest }),
  });
}

interface WriterLightAccountExpectation {
  readonly target: PublicKey;
  readonly mint: PublicKey;
  readonly payer: PublicKey;
  readonly requiredOwner: PublicKey | null;
  readonly minimumRequirement:
    | { readonly kind: "instruction_exact"; readonly amount: bigint }
    | { readonly kind: "positive" }
    | { readonly kind: "zero" };
}

function writerLightAccountExpectation(
  operation: WriterOperationKind,
  instructions: readonly TransactionInstruction[],
): WriterLightAccountExpectation | null {
  if (!["withdraw_principal", "close_begin", "close_basket", "close_cancel", "settlement_claim_collective", "settlement_claim_flat"].includes(operation)) return null;
  if (instructions.length !== 1) {
    throw writerPlanError(
      "WRITER_PLAN_COLD_ACCOUNT_INVALID",
      "a cold-capable writer stage must contain exactly one native writer instruction",
    );
  }
  const instruction = instructions[0]!;
  let targetIndex: number;
  let mintIndex: number;
  let requiredOwner: PublicKey | null;
  let minimumRequirement: WriterLightAccountExpectation["minimumRequirement"];
  switch (operation) {
    case "settlement_claim_collective":
    case "settlement_claim_flat": {
      const collective = operation === "settlement_claim_collective";
      requireWriterInstructionShape(instruction, collective ? 20 : 17, collective
        ? CURRENT_VAULT_INSTRUCTION_TAG.ClaimCollectiveLongV1 : CURRENT_VAULT_INSTRUCTION_TAG.ClaimWriterFlatResidualV1);
      targetIndex = collective ? 7 : 4;
      mintIndex = collective ? 6 : 3;
      requiredOwner = instruction.keys[0]!.pubkey;
      minimumRequirement = Object.freeze({ kind: "instruction_exact" as const,
        amount: Buffer.from(instruction.data).readBigUInt64LE(1) });
      break;
    }
    case "withdraw_principal":
      requireWriterInstructionShape(instruction, 14, CURRENT_VAULT_INSTRUCTION_TAG.WithdrawWriterPrincipalV1);
      targetIndex = 7;
      mintIndex = 6;
      requiredOwner = instruction.keys[0]!.pubkey;
      minimumRequirement = Object.freeze({ kind: "instruction_exact" as const,
        amount: Buffer.from(instruction.data).readBigUInt64LE(1) });
      break;
    case "close_begin":
      requireWriterInstructionShape(instruction, 15, CURRENT_VAULT_INSTRUCTION_TAG.BeginWriterCloseV1);
      targetIndex = 8;
      mintIndex = 7;
      requiredOwner = instruction.keys[0]!.pubkey;
      minimumRequirement = Object.freeze({
        kind: "instruction_exact" as const,
        amount: Buffer.from(instruction.data).readBigUInt64LE(1),
      });
      break;
    case "close_basket":
      requireWriterInstructionShape(instruction, 13, CURRENT_VAULT_INSTRUCTION_TAG.DepositWriterCloseBasketV1);
      targetIndex = 6;
      mintIndex = 5;
      requiredOwner = instruction.keys[0]!.pubkey;
      minimumRequirement = Object.freeze({ kind: "positive" as const });
      break;
    case "close_cancel": {
      if (instruction.data[1] === 0xff) {
        requireWriterInstructionShape(
          instruction,
          11,
          CURRENT_VAULT_INSTRUCTION_TAG.ProcessWriterCloseCancellationV1,
        );
        targetIndex = 5;
        mintIndex = 3;
      } else {
        requireWriterInstructionShape(
          instruction,
          13,
          CURRENT_VAULT_INSTRUCTION_TAG.ProcessWriterCloseCancellationV1,
        );
        targetIndex = 7;
        mintIndex = 5;
      }
      // Cancellation becomes permissionless after its deadline. The proof owner
      // is therefore the close-request owner, not necessarily the fee payer.
      requiredOwner = null;
      minimumRequirement = Object.freeze({ kind: "zero" as const });
      break;
    }
    default:
      return null;
  }
  const payerMeta = instruction.keys[0]!;
  const targetMeta = instruction.keys[targetIndex]!;
  const mintMeta = instruction.keys[mintIndex]!;
  if (!payerMeta.isSigner
    || targetMeta.isSigner || !targetMeta.isWritable
    || mintMeta.isSigner) {
    throw writerPlanError(
      "WRITER_PLAN_COLD_ACCOUNT_INVALID",
      "writer Light ATA payer signer, target, or mint flags are not canonical",
    );
  }
  return Object.freeze({
    target: targetMeta.pubkey,
    mint: mintMeta.pubkey,
    payer: payerMeta.pubkey,
    requiredOwner,
    minimumRequirement,
  });
}

function requireWriterInstructionShape(
  instruction: TransactionInstruction,
  accountCount: number,
  tag: number,
): void {
  if (instruction.keys.length !== accountCount || instruction.data[0] !== tag) {
    throw writerPlanError(
      "WRITER_PLAN_COLD_ACCOUNT_INVALID",
      "writer Light ATA stage does not have the exact RC44 account grammar",
    );
  }
}

function canonicalWriterColdProof(
  proof: WriterColdAccountProofFacts,
  expected: WriterLightAccountExpectation,
): WriterColdAccountProofFacts {
  const owner = canonicalPublicKey(proof.owner, "coldAccountProofFacts.owner");
  const mint = canonicalPublicKey(proof.mint, "coldAccountProofFacts.mint");
  const payer = canonicalPublicKey(proof.payer, "coldAccountProofFacts.payer");
  const ata = canonicalPublicKey(proof.ata, "coldAccountProofFacts.ata");
  const amount = canonicalU64(proof.amountAtoms, "coldAccountProofFacts.amountAtoms");
  const minimumAmount = canonicalU64(
    proof.minimumAmountAtoms,
    "coldAccountProofFacts.minimumAmountAtoms",
  );
  const minimumIsCanonical = expected.minimumRequirement.kind === "instruction_exact"
    ? minimumAmount === expected.minimumRequirement.amount
    : expected.minimumRequirement.kind === "positive"
      ? minimumAmount > 0n
      : minimumAmount === 0n;
  if (!PublicKey.isOnCurve(owner.toBytes())) {
    throw writerPlanError(
      "WRITER_PLAN_COLD_PROOF_INVALID",
      "cold writer proof owner must be an on-curve wallet",
    );
  }
  const derivedAta = deriveLightAssociatedTokenAddress(mint, owner);
  if (!ata.equals(expected.target) || !ata.equals(derivedAta)
    || !mint.equals(expected.mint) || !payer.equals(expected.payer)
    || (expected.requiredOwner !== null && !owner.equals(expected.requiredOwner))
    || amount < minimumAmount || !minimumIsCanonical || proof.includesColdBalance !== true
    || !/^[0-9a-f]{64}$/u.test(proof.providerOriginSha256)) {
    throw writerPlanError(
      "WRITER_PLAN_COLD_PROOF_INVALID",
      "cold writer proof facts do not bind the exact payer, Light ATA, mint, owner, amount, or minimum",
    );
  }
  return Object.freeze({
    ata: ata.toBase58(),
    owner: owner.toBase58(),
    mint: mint.toBase58(),
    amountAtoms: amount.toString(),
    minimumAmountAtoms: minimumAmount.toString(),
    includesColdBalance: true,
    providerOriginSha256: proof.providerOriginSha256,
    payer: payer.toBase58(),
  });
}

function canonicalWriterColdSetupBatches(
  batches: readonly (readonly TransactionInstruction[])[],
  expected: WriterLightAccountExpectation,
  proof: WriterColdAccountProofFacts,
): readonly (readonly TransactionInstruction[])[] {
  if (batches.length < 1 || batches.length > 8 || batches.some((batch) => batch.length !== 3)) {
    throw writerPlanError(
      "WRITER_PLAN_SETUP_INVALID",
      "cold writer setup must contain 1..8 exact compute/create/Transfer2 batches",
    );
  }
  const owner = canonicalPublicKey(proof.owner, "coldAccountProofFacts.owner");
  const officialCreate = buildCurrentCreateLightAtaIdempotentInstruction({
    payer: expected.payer,
    owner,
    mint: expected.mint,
  });
  const canonical = Object.freeze(batches.map((batch) => {
    const [compute, create, transfer] = batch;
    requireWriterComputeBudget(compute!);
    if (!sameNativeInstruction(create!, officialCreate)) {
      throw writerPlanError(
        "WRITER_PLAN_SETUP_INVALID",
        "cold writer setup idempotent ATA create is not the exact SDK-native v0.23.3 instruction",
      );
    }
    return Object.freeze([...batch]);
  }));
  try {
    validateCurrentLightTransfer2LoadSequence(
      canonical.map((batch) => batch[2]!),
      {
        payer: expected.payer,
        owner,
        mint: expected.mint,
        destination: expected.target,
        amountAtoms: BigInt(proof.amountAtoms),
      },
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown Transfer2 validation failure";
    throw writerPlanError(
      "WRITER_PLAN_SETUP_INVALID",
      `cold writer Transfer2 payload is not exact: ${detail}`,
    );
  }
  return canonical;
}

function canonicalWriterOutputFacts(
  facts: WriterCanonicalOutputSetupFacts,
  expected: WriterLightAccountExpectation,
): WriterCanonicalOutputSetupFacts {
  const ata = canonicalPublicKey(facts.ata, "canonicalOutput.setupFacts.ata");
  const owner = canonicalPublicKey(facts.owner, "canonicalOutput.setupFacts.owner");
  const mint = canonicalPublicKey(facts.mint, "canonicalOutput.setupFacts.mint");
  const payer = canonicalPublicKey(facts.payer, "canonicalOutput.setupFacts.payer");
  if (!PublicKey.isOnCurve(owner.toBytes())) {
    throw writerPlanError(
      "WRITER_PLAN_CANONICAL_OUTPUT_INVALID",
      "canonical cancellation output owner must be an on-curve wallet",
    );
  }
  const derived = deriveLightAssociatedTokenAddress(mint, owner);
  if (!ata.equals(derived) || !ata.equals(expected.target)
    || !mint.equals(expected.mint) || !payer.equals(expected.payer)) {
    throw writerPlanError(
      "WRITER_PLAN_CANONICAL_OUTPUT_INVALID",
      "cancellation output facts do not bind the exact payer, owner, mint, or canonical Light ATA",
    );
  }
  return Object.freeze({
    ata: ata.toBase58(),
    owner: owner.toBase58(),
    mint: mint.toBase58(),
    payer: payer.toBase58(),
  });
}

function canonicalWriterOutputSetupBatch(
  facts: WriterCanonicalOutputSetupFacts,
): readonly (readonly TransactionInstruction[])[] {
  return currentWriterCanonicalOutputSetupInstructionBatches({
    payer: new PublicKey(facts.payer),
    owner: new PublicKey(facts.owner),
    mint: new PublicKey(facts.mint),
  });
}

/** Exact pre-observation native setup used for a cancellation output ATA. */
export function currentWriterCanonicalOutputSetupInstructionBatches(input: {
  readonly payer: PublicKey;
  readonly owner: PublicKey;
  readonly mint: PublicKey;
}): readonly (readonly TransactionInstruction[])[] {
  return Object.freeze([Object.freeze([
    ComputeBudgetProgram.setComputeUnitLimit({ units: WRITER_CANONICAL_OUTPUT_COMPUTE_UNITS }),
    buildCurrentCreateLightAtaIdempotentInstruction(input),
  ])]);
}

function requireWriterComputeBudget(instruction: TransactionInstruction): void {
  const bytes = Buffer.from(instruction.data);
  const units = bytes.length === 5 ? bytes.readUInt32LE(1) : 0;
  if (!instruction.programId.equals(COMPUTE_BUDGET_PROGRAM)
    || instruction.keys.length !== 0 || bytes[0] !== 2
    || units < 50_000 || units > 1_400_000) {
    throw writerPlanError(
      "WRITER_PLAN_SETUP_INVALID",
      "writer setup ComputeBudget SetComputeUnitLimit is not canonical",
    );
  }
}

/** Source-owned exact output prerequisite, available before finalized observation capture. */
export function currentWriterClassicOutputSetupInstructionBatches(input: {
  readonly payer: PublicKey; readonly owner: PublicKey; readonly mint: PublicKey;
}): readonly (readonly TransactionInstruction[])[] {
  const ata = deriveClassicAssociatedTokenAddress(input.mint, input.owner, true);
  return Object.freeze([Object.freeze([
    ComputeBudgetProgram.setComputeUnitLimit({ units: WRITER_CANONICAL_OUTPUT_COMPUTE_UNITS }),
    createClassicAssociatedTokenAccountIdempotentInstruction(input.payer, ata, input.owner, input.mint),
  ])]);
}

function canonicalWriterClassicOutputFacts(value: WriterCanonicalOutputSetupFacts, operation: WriterOperationKind,
  instruction: TransactionInstruction, observation: CurrentFinalizedObservation): WriterCanonicalOutputSetupFacts {
  if (!["withdraw_principal", "auction_refund", "close_finalize"].includes(operation)) throw writerPlanError("WRITER_PLAN_SETUP_INVALID", "classic output creation requires withdrawal/refund/close finalization");
  const owner = canonicalPublicKey(value.owner, "classicOutput.owner"); const payer = canonicalPublicKey(value.payer, "classicOutput.payer");
  const mint = canonicalPublicKey(value.mint, "classicOutput.mint"); const ata = canonicalPublicKey(value.ata, "classicOutput.ata");
  const destinationIndex = operation === "withdraw_principal" ? 4 : operation === "close_finalize" ? 8 : 6;
  const mintIndex = operation === "withdraw_principal" ? 5 : operation === "close_finalize" ? 9 : 7;
  if (!payer.equals(instruction.keys[0]!.pubkey) || !ata.equals(instruction.keys[destinationIndex]!.pubkey)
    || !mint.equals(instruction.keys[mintIndex]!.pubkey) || !ata.equals(deriveClassicAssociatedTokenAddress(mint, owner, true))
    || (operation !== "auction_refund" && !owner.equals(payer))) throw writerPlanError("WRITER_PLAN_SETUP_INVALID", "classic output identity differs from exact native destination");
  const observed = observation.orderedAccounts.find(account => account.address === ata.toBase58());
  if (!observed || !([observed.owner, observed.executable, observed.dataLength, observed.dataSha256].every(field => field === null)
    || (observed.owner === "11111111111111111111111111111111" && observed.executable === false && observed.dataLength === "0"))) {
    throw writerPlanError("WRITER_PLAN_SETUP_INVALID", "classic output setup requires finalized absence or an empty system account");
  }
  return Object.freeze({ owner: owner.toBase58(), payer: payer.toBase58(), mint: mint.toBase58(), ata: ata.toBase58() });
}

function sameNativeInstruction(left: TransactionInstruction, right: TransactionInstruction): boolean {
  return left.programId.equals(right.programId)
    && Buffer.from(left.data).equals(Buffer.from(right.data))
    && left.keys.length === right.keys.length
    && left.keys.every((meta, index) => {
      const expected = right.keys[index];
      return expected !== undefined && meta.pubkey.equals(expected.pubkey)
        && meta.isSigner === expected.isSigner && meta.isWritable === expected.isWritable;
    });
}

function writerSetupInstructionManifest(
  instruction: TransactionInstruction,
): WriterSetupInstructionManifest {
  return Object.freeze({
    programId: instruction.programId.toBase58(),
    instructionName: instruction.programId.equals(CLASSIC_ASSOCIATED_TOKEN_PROGRAM_ID) ? "CreateAssociatedTokenAccountIdempotent" : "LightAccountLoad",
    dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({
      address: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    }))),
  });
}

function canonicalPublicKey(value: string, path: string): PublicKey {
  let key: PublicKey;
  try {
    key = new PublicKey(value);
  } catch {
    throw writerPlanError("WRITER_PLAN_COLD_PROOF_INVALID", `${path} is not a public key`);
  }
  if (key.toBase58() !== value) {
    throw writerPlanError("WRITER_PLAN_COLD_PROOF_INVALID", `${path} is not canonical base58`);
  }
  return key;
}

function canonicalU64(value: string, path: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw writerPlanError("WRITER_PLAN_COLD_PROOF_INVALID", `${path} is not a canonical u64`);
  }
  const amount = BigInt(value);
  if (amount > 0xffff_ffff_ffff_ffffn) {
    throw writerPlanError("WRITER_PLAN_COLD_PROOF_INVALID", `${path} exceeds u64`);
  }
  return amount;
}

function canonicalSemantic(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object" || Object.keys(value).length === 0) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_INVALID", "writer semantic input must be a nonempty object");
  }
  const canonical = canonicalValue(value) as Readonly<Record<string, unknown>>;
  if (Object.values(canonical).some((field) => field === undefined)) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_INVALID", "writer semantic input cannot contain undefined fields");
  }
  return Object.freeze(canonical);
}

function requireWriterSemanticBinding(
  operation: WriterOperationKind,
  semantic: Readonly<Record<string, unknown>>,
  instructions: readonly TransactionInstruction[],
  observation: CurrentFinalizedObservation,
  seriesBookBase64: string | undefined,
): void {
  if (operation !== "settlement_claim_collective" && seriesBookBase64 !== undefined) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "series-book witness is only valid for collective claims");
  }
  if (instructions.length !== 1) {
    throw writerPlanError(
      "WRITER_PLAN_SEMANTIC_MISMATCH",
      "one public writer semantic must bind exactly one native instruction",
    );
  }
  const instruction = instructions[0]!;
  if (isCurrentWriterDlmmOperation(operation)) {
    requireWriterDlmmWireBindingV1(operation, semantic, instruction);
    return;
  }
  if (operation === "withdraw_principal") {
    requireWriterInstructionShape(instruction, 14, CURRENT_VAULT_INSTRUCTION_TAG.WithdrawWriterPrincipalV1);
    requireExactSemanticKeys(semantic, ["amountAtoms", "owner", "sleeve"]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "sleeve", instruction.keys[2]?.pubkey);
    requireSemanticU64(semantic, "amountAtoms", instructionU64(instruction, 1));
    if (instruction.data.length !== 9 || instructionU64(instruction, 1) === 0n) {
      throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "principal withdrawal requires one positive u64 amount");
    }
    return;
  }
  if (operation === "auction_refund") {
    requireWriterInstructionShape(instruction, 9, CURRENT_VAULT_INSTRUCTION_TAG.CancelOrRefundWriterBidV1);
    requireExactSemanticKeys(semantic, ["auction", "bid", "owner"]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "auction", instruction.keys[2]?.pubkey);
    requireSemanticPublicKey(semantic, "bid", instruction.keys[4]?.pubkey);
    if (instruction.data.length !== 1) throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "refund has no caller-selected amount or destination");
    return;
  }
  if (operation === "deposit") {
    requireExactSemanticKeys(semantic, ["owner", "principalAtoms", "sleeve"]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "sleeve", instruction.keys[2]?.pubkey);
    requireSemanticU64(semantic, "principalAtoms", instructionU64(instruction, 1));
    return;
  }
  if (operation === "bid") {
    requireExactSemanticKeys(semantic, [
      "auction",
      "owner",
      "pricePerContractAtoms",
      "quantityAtoms",
      "seriesIndex",
    ]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "auction", instruction.keys[2]?.pubkey);
    requireSemanticInteger(semantic, "seriesIndex", instruction.data[9]);
    requireSemanticU64(semantic, "pricePerContractAtoms", instructionU64(instruction, 11));
    requireSemanticU64(semantic, "quantityAtoms", instructionU64(instruction, 19));
    return;
  }
  if (operation === "close_begin") {
    requireExactSemanticKeys(semantic, ["flatParAtoms", "minimumWithdrawalAtoms", "owner", "sleeve"]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "sleeve", instruction.keys[2]?.pubkey);
    requireSemanticU64(semantic, "flatParAtoms", instructionU64(instruction, 1));
    requireSemanticU64(
      semantic,
      "minimumWithdrawalAtoms",
      instructionU64(instruction, 9),
    );
    return;
  }
  if (["close_basket", "close_finalize", "close_cancel"].includes(operation)) {
    requireExactSemanticKeys(semantic, ["closeRequest", "owner"]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    const closeRequestIndex = operation === "close_basket"
      ? 3
      : operation === "close_finalize"
        ? 6
        : instruction.data[1] === 0xff ? 2 : 3;
    requireSemanticPublicKey(semantic, "closeRequest", instruction.keys[closeRequestIndex]?.pubkey);
    return;
  }
  if (operation === "settlement_claim_flat") {
    requireExactSemanticKeys(
      semantic,
      ["amountAtoms", "claimVariant", "owner", "seriesIndex", "sleeve"],
    );
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "sleeve", instruction.keys[2]?.pubkey);
    requireSemanticLiteral(semantic, "claimVariant", "flat_residual");
    requireSemanticInteger(semantic, "seriesIndex", 0xff);
    requireSemanticU64(semantic, "amountAtoms", instructionU64(instruction, 1));
    return;
  }
  if (operation === "settlement_claim_collective") {
    if (seriesBookBase64 === undefined) {
      throw writerPlanError("WRITER_PLAN_SEMANTIC_UNBOUND", "collective claim requires an observed series-book witness");
    }
    if (instruction.keys.length !== 20 || instruction.data.length !== 9) {
      throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "collective claim requires the exact native account and payload shape");
    }
    requireExactSemanticKeys(semantic, ["amountAtoms", "claimVariant", "owner", "seriesIndex", "sleeve"]);
    requireSemanticPublicKey(semantic, "owner", instruction.keys[0]?.pubkey);
    requireSemanticPublicKey(semantic, "sleeve", instruction.keys[2]?.pubkey);
    requireSemanticLiteral(semantic, "claimVariant", "collective_long");
    requireSemanticU64(semantic, "amountAtoms", instructionU64(instruction, 1));
    if (typeof seriesBookBase64 !== "string" || seriesBookBase64.length !== Math.ceil(WRITER_ACCOUNT_SIZES.seriesBook / 3) * 4) {
      throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "collective claim witness must have the fixed series-book size");
    }
    const bytes = Buffer.from(seriesBookBase64, "base64");
    const address = instruction.keys[4]!.pubkey;
    const observed = observation.orderedAccounts.find((account) => account.address === address.toBase58());
    if (bytes.toString("base64") !== seriesBookBase64 || observed?.owner !== AMOEBA_SPREAD_PROGRAM_ID
      || observed.executable !== false || observed.dataLength !== String(bytes.length)
      || observed.dataSha256 !== createHash("sha256").update(bytes).digest("hex")) {
      throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "collective claim series-book witness differs from observation");
    }
    const book = decodeWriterSeriesBook(address, bytes, new PublicKey(AMOEBA_SPREAD_PROGRAM_ID));
    const matches = book.records.slice(0, book.seriesCount)
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.market.equals(instruction.keys[5]!.pubkey));
    const selected = matches[0];
    if (!book.sleeve.equals(instruction.keys[2]!.pubkey)
      || !book.settlementGroup.equals(instruction.keys[3]!.pubkey)
      || matches.length !== 1 || selected === undefined || !selected.record.active
      || !selected.record.contractMint.equals(instruction.keys[6]!.pubkey)
      || !selected.record.retirementCustody.equals(instruction.keys[8]!.pubkey)
      || book.records.some((record) => !record.retirementCustody.equals(
        deriveWriterRetirementCustodyPda(book.sleeve, record.market, new PublicKey(AMOEBA_SPREAD_PROGRAM_ID))[0],
      ))
      || instructionU64(instruction, 1) === 0n) {
      throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "collective claim does not select one canonical book record");
    }
    requireSemanticInteger(semantic, "seriesIndex", selected.index);
    return;
  }
  throw writerPlanError(
    "WRITER_PLAN_SEMANTIC_UNBOUND",
    `${operation} has no reviewed native semantic binding and is not admitted by the public plan surface`,
  );
}

function instructionU64(instruction: TransactionInstruction, offset: number): bigint {
  const bytes = Buffer.from(instruction.data);
  if (offset < 0 || offset + 8 > bytes.length) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", "writer semantic amount payload is truncated");
  }
  return bytes.readBigUInt64LE(offset);
}

function requireExactSemanticKeys(
  semantic: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const actual = Object.keys(semantic).sort();
  const required = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(required)) {
    throw writerPlanError(
      "WRITER_PLAN_SEMANTIC_MISMATCH",
      "writer semantic fields are not the exact public operation schema",
    );
  }
}

function requireSemanticPublicKey(
  semantic: Readonly<Record<string, unknown>>,
  field: string,
  expected: PublicKey | undefined,
): void {
  const value = semantic[field];
  if (typeof value !== "string" || expected === undefined) {
    throw writerPlanError("WRITER_PLAN_SEMANTIC_MISMATCH", `${field} is not a public-key string`);
  }
  const key = canonicalPublicKey(value, `semantic.${field}`);
  if (!key.equals(expected)) {
    throw writerPlanError(
      "WRITER_PLAN_SEMANTIC_MISMATCH",
      `${field} does not match the exact native instruction account`,
    );
  }
}

function requireSemanticU64(
  semantic: Readonly<Record<string, unknown>>,
  field: string,
  expected: bigint,
): void {
  const value = semantic[field];
  if (typeof value !== "string"
    || canonicalU64(value, `semantic.${field}`) !== expected) {
    throw writerPlanError(
      "WRITER_PLAN_SEMANTIC_MISMATCH",
      `${field} does not match the exact native instruction payload`,
    );
  }
}

function requireSemanticInteger(
  semantic: Readonly<Record<string, unknown>>,
  field: string,
  expected: number | undefined,
): void {
  const value = semantic[field];
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw writerPlanError(
      "WRITER_PLAN_SEMANTIC_MISMATCH",
      `${field} does not match the exact native instruction payload`,
    );
  }
}

function requireSemanticLiteral(
  semantic: Readonly<Record<string, unknown>>,
  field: string,
  expected: string,
): void {
  if (semantic[field] !== expected) {
    throw writerPlanError(
      "WRITER_PLAN_SEMANTIC_MISMATCH",
      `${field} does not match the exact native instruction operation`,
    );
  }
}

function requireObservedInstructionAccounts(
  observation: CurrentFinalizedObservation,
  instructions: readonly { readonly keys: readonly AccountMeta[] }[],
): void {
  const observed = new Map(observation.orderedAccounts.map((account) => [account.address, account]));
  const required = new Set(instructions.flatMap((instruction) =>
    instruction.keys.map((account) => account.pubkey.toBase58()),
  ));
  for (const address of required) {
    const account = observed.get(address);
    if (account === undefined) {
      throw writerPlanError(
        "WRITER_PLAN_OBSERVATION_INVALID",
        `finalized observation does not bind instruction account ${address}`,
      );
    }
    const fields = [account.owner, account.executable, account.dataLength, account.dataSha256];
    const complete = fields.every((value) => value !== null);
    const absent = fields.every((value) => value === null);
    if (!complete && !absent) {
      throw writerPlanError(
        "WRITER_PLAN_OBSERVATION_INVALID",
        `finalized observation contains partial state for instruction account ${address}`,
      );
    }
  }
}

function requireHotLightAccount(
  observation: CurrentFinalizedObservation,
  target: PublicKey,
): void {
  const address = target.toBase58();
  const account = observation.orderedAccounts.find((candidate) => candidate.address === address);
  if (account === undefined
    || account.owner !== CURRENT_LIGHT_TOKEN_PROGRAM_ID.toBase58()
    || account.executable !== false
    || account.dataLength !== CURRENT_LIGHT_TOKEN_ACCOUNT_SIZE.toString()
    || account.dataSha256 === null) {
    throw writerPlanError(
      "WRITER_PLAN_OBSERVATION_INVALID",
      `writer Light ATA ${address} is neither canonical hot state nor an authenticated cold load`,
    );
  }
}

function requireColdLightAccount(
  observation: CurrentFinalizedObservation,
  target: PublicKey,
): void {
  const address = target.toBase58();
  const account = observation.orderedAccounts.find((candidate) => candidate.address === address);
  if (account === undefined || [
    account.owner,
    account.executable,
    account.dataLength,
    account.dataSha256,
  ].some((value) => value !== null)) {
    throw writerPlanError(
      "WRITER_PLAN_OBSERVATION_INVALID",
      `cold writer Light ATA ${address} must be explicitly absent from finalized hot state`,
    );
  }
}

function requireCanonicalOutputLightAccount(
  observation: CurrentFinalizedObservation,
  target: PublicKey,
): void {
  const address = target.toBase58();
  const account = observation.orderedAccounts.find((candidate) => candidate.address === address);
  if (account === undefined) {
    throw writerPlanError(
      "WRITER_PLAN_OBSERVATION_INVALID",
      `canonical cancellation output ${address} is missing from the finalized observation`,
    );
  }
  const fields = [account.owner, account.executable, account.dataLength, account.dataSha256];
  const absent = fields.every((value) => value === null);
  const canonicalHot = account.owner === CURRENT_LIGHT_TOKEN_PROGRAM_ID.toBase58()
    && account.executable === false
    && account.dataLength === CURRENT_LIGHT_TOKEN_ACCOUNT_SIZE.toString()
    && account.dataSha256 !== null;
  if (!absent && !canonicalHot) {
    throw writerPlanError(
      "WRITER_PLAN_OBSERVATION_INVALID",
      `canonical cancellation output ${address} is neither absent nor exact hot Light state`,
    );
  }
}

/** Exact portable-plan validation used before bounded submission. */
export function validateWriterOperationPlan(
  plan: WriterOperationPlan,
  independentlyRebuilt: PrepareWriterOperationInput,
): WriterOperationPlan {
  const rebuilt = prepareWriterOperation(independentlyRebuilt);
  if (plan.schemaVersion !== rebuilt.schemaVersion
    || plan.operation !== independentlyRebuilt.operation
    || plan.leanAdmissionDigest !== independentlyRebuilt.leanAdmissionDigest
    || plan.currentObservationDigest !== rebuilt.currentObservationDigest
    || plan.operationId !== rebuilt.operationId
    || plan.preparedPlanDigest !== rebuilt.preparedPlanDigest
    || canonicalJson(plan) !== canonicalJson(rebuilt)) {
    throw writerPlanError("WRITER_PLAN_DIGEST_MISMATCH", "writer plan differs from its canonical RC44 reconstruction");
  }
  return rebuilt;
}

function canonicalAddresses(values: readonly (PublicKey | string)[]): readonly string[] {
  const addresses = values.map((value) => new PublicKey(value).toBase58());
  if (new Set(addresses).size !== addresses.length) {
    throw writerPlanError("WRITER_PLAN_WRITE_SET_INVALID", "writer write set contains a duplicate address");
  }
  return Object.freeze([...addresses].sort());
}

function canonicalSignerRoles(values: readonly WriterSignerRole[], instructionCount: number): readonly WriterSignerRole[] {
  const roles = values.map((value) => {
    const pubkey = new PublicKey(value.pubkey).toBase58();
    if (!value.role.trim() || value.instructionIndexes.length === 0) {
      throw writerPlanError("WRITER_PLAN_SIGNER_ROLE_INVALID", "writer signer roles require a role and instruction indexes");
    }
    const indexes = [...value.instructionIndexes];
    if (new Set(indexes).size !== indexes.length
      || indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= instructionCount)) {
      throw writerPlanError("WRITER_PLAN_SIGNER_ROLE_INVALID", "writer signer role index is duplicate or out of range");
    }
    return Object.freeze({ pubkey, role: value.role, instructionIndexes: Object.freeze(indexes.sort((a, b) => a - b)) });
  });
  if (new Set(roles.map((value) => value.pubkey)).size !== roles.length) {
    throw writerPlanError("WRITER_PLAN_SIGNER_ROLE_INVALID", "writer signer roles contain a duplicate signer identity");
  }
  return Object.freeze(roles.sort((a, b) => `${a.pubkey}:${a.role}`.localeCompare(`${b.pubkey}:${b.role}`)));
}

function requireOperationTags(
  operation: WriterOperationKind,
  instructions: readonly WriterInstructionManifest[],
): void {
  const admitted = OPERATION_TAGS[operation];
  if (instructions.some((instruction) => !admitted.includes(instruction.instructionTag))) {
    throw writerPlanError("WRITER_PLAN_OPERATION_TAG_MISMATCH", `${operation} contains an instruction outside its admitted tag set`);
  }
}

function requireExactWriteSet(
  writeSet: readonly string[],
  instructions: readonly { readonly accounts: readonly WriterInstructionAccountMeta[] }[],
): void {
  const exact = [...new Set(instructions.flatMap((instruction) =>
    instruction.accounts.filter((meta) => meta.isWritable).map((meta) => meta.address),
  ))].sort();
  if (canonicalJson(writeSet) !== canonicalJson(exact)) {
    throw writerPlanError("WRITER_PLAN_WRITE_SET_INVALID", "writer write set must equal the exact writable-meta set");
  }
}

function requireExactSignerCoverage(
  signerRoles: readonly WriterSignerRole[],
  instructions: readonly WriterInstructionManifest[],
): void {
  const required = new Map<string, number[]>();
  instructions.forEach((instruction, instructionIndex) => {
    instruction.accounts.filter((meta) => meta.isSigner).forEach((meta) => {
      const indexes = required.get(meta.address) ?? [];
      indexes.push(instructionIndex);
      required.set(meta.address, indexes);
    });
  });
  if (signerRoles.length !== required.size) {
    throw writerPlanError("WRITER_PLAN_SIGNER_ROLE_INVALID", "writer signer roles must cover exactly the signer-meta identities");
  }
  for (const role of signerRoles) {
    const expected = required.get(role.pubkey);
    if (expected === undefined || canonicalJson(role.instructionIndexes) !== canonicalJson([...new Set(expected)].sort((a, b) => a - b))) {
      throw writerPlanError("WRITER_PLAN_SIGNER_ROLE_INVALID", "writer signer role indexes must match exact signer-meta occurrences");
    }
  }
}

function requireDigest(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw writerPlanError("WRITER_PLAN_DIGEST_INVALID", `${label} must be a lowercase SHA-256 digest`);
  }
}

function digestCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
  }
  return value;
}

function writerPlanError(code: string, message: string): AmebaProtocolError {
  return new AmebaProtocolError(message, { code });
}
