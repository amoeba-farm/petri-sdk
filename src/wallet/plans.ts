import { ComputeBudgetProgram } from "@solana/web3.js";
import { decodeCurrentCollectiveLookupTableV1, type CurrentCollectiveLookupTableWitnessV1 } from "../protocol/current-collective-lookup-table.js";
import { CURRENT_WRITER_LIQUIDITY_OPERATIONS, CURRENT_WRITER_DLMM_POLICY_OPERATIONS, isCurrentWriterDlmmOperation,
  validateCurrentWriterDlmmRequest, type CurrentWriterDlmmOperation } from "../protocol/writer-dlmm-public.js";
/** Strict JSON decoding and digest validation for public RC44 prepare envelopes. */

import {
  validateCurrentFinalizedObservation,
  type CurrentFinalizedObservation,
} from "../current-finalized-observation.js";
import {
  encodeBase64,
  decodeBase64,
  sha256Hex,
  canonicalDigest,
  canonicalIndex,
  canonicalJson,
  canonicalU64,
  exactArray,
  exactObject,
  sha256Canonical,
  walletError,
} from "./codec.js";
import {
  decodeInstructionManifest,
  pubkey,
  requireWriteSet,
  type CurrentWalletInstructionManifest,
} from "./manifest.js";

export type CurrentCollectiveOperationKind =
  | CurrentWriterDlmmOperation
  | "withdraw_principal"
  | "auction_refund"
  | "deposit"
  | "bid"
  | "close_begin"
  | "close_basket"
  | "close_finalize"
  | "close_cancel"
  | "settlement_claim_collective"
  | "settlement_claim_flat"
  | "transfer_flat"
  | "collective_swap_exact_in";

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

export function decodeCollectiveOperationPrepareEnvelope(
  value: unknown,
): CurrentCollectiveOperationPrepareEnvelope {
  const root = exactObject(value, ["operationPlan", "leanAdmission"], [
    "leanAdmissionDigest", "closeRequest", "stage",
  ], "prepare response");
  if (root.operationPlan === null || typeof root.operationPlan !== "object"
    || Array.isArray(root.operationPlan) || !("operation" in root.operationPlan)) {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "operationPlan has no operation discriminator");
  }
  const operation = (root.operationPlan as Readonly<Record<string, unknown>>).operation;
  const plan = operation === "transfer_flat"
    ? decodeFlatPlan(root.operationPlan)
    : operation === "collective_swap_exact_in"
      ? decodeSwapPlan(root.operationPlan)
      : decodeWriterPlan(root.operationPlan);
  const expectedRootKeys = new Set(["operationPlan", "leanAdmission"]);
  if (plan.operation === "transfer_flat" || plan.operation !== "collective_swap_exact_in") {
    expectedRootKeys.add("leanAdmissionDigest");
  }
  if (plan.operation === "close_begin") expectedRootKeys.add("closeRequest");
  if (["close_basket", "close_finalize", "close_cancel"].includes(plan.operation)) expectedRootKeys.add("stage");
  for (const key of Object.keys(root)) {
    if (!expectedRootKeys.has(key)) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", `prepare response key ${key} is invalid for ${plan.operation}`);
    }
  }
  for (const key of expectedRootKeys) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", `prepare response is missing ${key} for ${plan.operation}`);
    }
  }
  const leanAdmission = exactObject(root.leanAdmission, [], Object.keys(
    root.leanAdmission as Readonly<Record<string, unknown>>,
  ), "leanAdmission");
  assertCanonicalJsonValue(leanAdmission, "leanAdmission");
  const computedAdmissionDigest = sha256Canonical(leanAdmission);
  const leanAdmissionDigest = root.leanAdmissionDigest === undefined
    ? plan.leanAdmissionDigest
    : canonicalDigest(root.leanAdmissionDigest, "leanAdmissionDigest");
  if (computedAdmissionDigest !== leanAdmissionDigest) {
    walletError("CURRENT_WALLET_ADMISSION_INVALID", "Lean admission digest does not match the exact response");
  }
  if (plan.operation !== "transfer_flat" && plan.leanAdmissionDigest !== leanAdmissionDigest) {
    walletError("CURRENT_WALLET_ADMISSION_INVALID", "operation plan does not bind the exact Lean admission digest");
  }
  validateLeanAdmission(plan, leanAdmission, root.stage);
  let closeRequest: string | null = null;
  if (root.closeRequest !== undefined) {
    closeRequest = pubkey(root.closeRequest, "closeRequest").toBase58();
    const semanticSleeve = plan.semantic.sleeve;
    if (typeof semanticSleeve !== "string" || plan.operation !== "close_begin") {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", "closeRequest is present outside close-begin preparation");
    }
  }
  const stage = root.stage === undefined ? null : exactObject(
    root.stage,
    ["operation"],
    root.stage !== null && typeof root.stage === "object" && "seriesIndex" in root.stage ? ["seriesIndex"] : [],
    "stage",
  );
  return Object.freeze({ operationPlan: plan, leanAdmission, leanAdmissionDigest, closeRequest, stage });
}

function decodeWriterPlan(value: unknown): CurrentDecodedCollectivePlan {
  const probe = exactObject(value, ["schemaVersion", "operation"], [
    "operationId", "currentObservation", "currentObservationDigest", "leanAdmissionDigest",
    "semantic", "instructions", "writeSet", "signerRoles", "preparedPlanDigest", "setupMode",
    "coldAccountProofFacts", "canonicalOutputSetupFacts", "classicOutputSetupFacts", "setupInstructionBatches",
    "setupSignerRoles", "executionInstructionBatches", "actionBatchIndex", "collectiveClaimSeriesBookBase64", "transactionLookupTable",
  ], "writer operation plan");
  if (probe.schemaVersion !== 1 && probe.schemaVersion !== 2) {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "writer operation schemaVersion must be 1 or 2");
  }
  const schemaVersion = probe.schemaVersion;
  const baseKeys = [
    "schemaVersion", "operation", "operationId", "currentObservation", "currentObservationDigest",
    "leanAdmissionDigest", "semantic", "instructions", "writeSet", "signerRoles", "preparedPlanDigest",
  ];
  if (probe.operation === "settlement_claim_collective") {
    if (schemaVersion !== 1) walletError("CURRENT_WALLET_PLAN_INVALID", "collective claim requires a hot plan");
    baseKeys.push("collectiveClaimSeriesBookBase64");
  }
  const v2Keys = [
    "setupMode", "setupInstructionBatches", "setupSignerRoles",
    "executionInstructionBatches", "actionBatchIndex",
  ];
  const object = exactObject(value, schemaVersion === 1 ? baseKeys : [...baseKeys, ...v2Keys],
    schemaVersion === 2 ? ["coldAccountProofFacts", "canonicalOutputSetupFacts", "classicOutputSetupFacts", "transactionLookupTable"] : [],
    "writer operation plan");
  const operation = writerOperation(object.operation);
  if (isCurrentWriterDlmmOperation(operation) && (schemaVersion !== 2 || object.setupMode !== "writer_liquidity_compute")) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "writer liquidity requires its committed candidate compute transport");
  }
  const observation = validateCurrentFinalizedObservation(object.currentObservation);
  const currentObservationDigest = canonicalDigest(object.currentObservationDigest, "currentObservationDigest");
  if (currentObservationDigest !== observation.currentObservationDigest) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "writer plan observation digest is inconsistent");
  }
  const semantic = writerSemantic(operation, object.semantic);
  const instructions = Object.freeze(exactArray(object.instructions, "instructions", 1, 1)
    .map((entry, index) => decodeInstructionManifest(entry, `instructions[${index}]`, { instructionTag: "required" })));
  const collectiveWitness = operation === "settlement_claim_collective"
    ? { collectiveClaimSeriesBookBase64: object.collectiveClaimSeriesBookBase64 } : {};
  if (operation === "settlement_claim_collective") {
    if (typeof object.collectiveClaimSeriesBookBase64 !== "string" || object.collectiveClaimSeriesBookBase64.length !== 11_084) {
      walletError("CURRENT_WALLET_PLAN_INVALID", "collective claim witness must have the fixed series-book size");
    }
    const bytes = decodeBase64(object.collectiveClaimSeriesBookBase64, "series-book witness", 8_312);
    const address = instructions[0]!.accounts[4]!.address;
    const observed = observation.orderedAccounts.find((account) => account.address === address);
    if (observed?.owner !== instructions[0]!.programId || observed.executable !== false
      || observed.dataLength !== String(bytes.length) || observed.dataSha256 !== sha256Hex(bytes)) {
      walletError("CURRENT_WALLET_PLAN_INVALID", "series-book witness differs from observation");
    }
  }
  const signerRoles = decodeSignerRoles(object.signerRoles, instructions, "signerRoles");
  let setupMode: CurrentDecodedCollectivePlan["setupMode"] = "none";
  let coldProofFacts: Readonly<Record<string, unknown>> | null = null;
  let canonicalOutputFacts: Readonly<Record<string, unknown>> | null = null;
  let classicOutputFacts: Readonly<Record<string, unknown>> | null = null;
  let setupSignerRoles: readonly CurrentWalletSignerRole[] = Object.freeze([]);
  let executionBatches: readonly (readonly CurrentWalletInstructionManifest[])[] = Object.freeze([instructions]);
  let actionBatchIndex = 0;
  let allManifests = instructions;
  let transactionLookupTable: CurrentCollectiveLookupTableWitnessV1 | undefined;
  if (object.transactionLookupTable !== undefined) {
    if (!isCurrentWriterDlmmOperation(operation)) walletError("CURRENT_WALLET_PLAN_INVALID", "lookup table is outside writer liquidity transport");
    transactionLookupTable = decodeCurrentCollectiveLookupTableV1(object.transactionLookupTable, observation).witness;
  }
  if (schemaVersion === 2) {
    if (object.setupMode !== "cold_load" && object.setupMode !== "canonical_output_create" && object.setupMode !== "classic_output_create" && object.setupMode !== "writer_liquidity_compute") {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", "writer setupMode is invalid");
    }
    setupMode = object.setupMode;
    if (setupMode === "writer_liquidity_compute") {
      if (!isCurrentWriterDlmmOperation(operation) || object.coldAccountProofFacts !== undefined
        || object.canonicalOutputSetupFacts !== undefined || object.classicOutputSetupFacts !== undefined) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "writer liquidity candidate compute has unexpected setup facts");
      }
    } else if (setupMode === "cold_load") {
      coldProofFacts = writerColdFacts(object.coldAccountProofFacts);
      if (object.canonicalOutputSetupFacts !== undefined) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", "cold writer plan also contains canonical output facts");
      }
    } else if (setupMode === "canonical_output_create") {
      canonicalOutputFacts = writerOutputFacts(object.canonicalOutputSetupFacts);
      if (object.coldAccountProofFacts !== undefined) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", "canonical-output writer plan also contains cold facts");
      }
    } else if (object.coldAccountProofFacts !== undefined || object.canonicalOutputSetupFacts !== undefined || object.classicOutputSetupFacts === undefined) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", "classic output setup facts are not exact");
    }
    if (object.classicOutputSetupFacts !== undefined) {
      if (!["withdraw_principal", "auction_refund", "close_finalize"].includes(operation) || setupMode === "canonical_output_create") walletError("CURRENT_WALLET_PLAN_INVALID", "classic output setup operation is invalid");
      classicOutputFacts = writerOutputFacts(object.classicOutputSetupFacts);
    }
    const setupBatches = decodeManifestBatches(object.setupInstructionBatches, "setupInstructionBatches", 1, 8, "forbidden");
    executionBatches = decodeManifestBatches(object.executionInstructionBatches, "executionInstructionBatches", 1, 8, "optional");
    actionBatchIndex = canonicalIndex(object.actionBatchIndex, "actionBatchIndex", executionBatches.length - 1);
    if (actionBatchIndex !== executionBatches.length - 1 || setupBatches.length !== executionBatches.length) {
      walletError("CURRENT_WALLET_PLAN_INVALID", "writer action batch must be the final setup batch");
    }
    setupBatches.forEach((batch, index) => {
      const expected = index === actionBatchIndex ? [...batch, ...instructions] : [...batch];
      if (canonicalJson(executionBatches[index]) !== canonicalJson(expected)) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "writer execution grouping differs from setup plus action");
      }
    });
    if (setupMode === "writer_liquidity_compute") {
      if (!Array.isArray(object.setupSignerRoles) || object.setupSignerRoles.length !== 0 || setupBatches.length !== 1 || actionBatchIndex !== 0) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "writer liquidity compute must have one unsigned setup batch");
      }
    } else setupSignerRoles = decodeSetupSignerRoles(object.setupSignerRoles, setupBatches, "setupSignerRoles");
    allManifests = Object.freeze([...setupBatches.flatMap((batch) => [...batch]), ...instructions]);
  }
  const writeSet = requireWriteSet(object.writeSet, allManifests, "writeSet");
  const operationId = canonicalDigest(object.operationId, "operationId");
  const preparedPlanDigest = canonicalDigest(object.preparedPlanDigest, "preparedPlanDigest");
  const leanAdmissionDigest = canonicalDigest(object.leanAdmissionDigest, "leanAdmissionDigest");
  const withoutDigest = omitKey(object, "preparedPlanDigest");
  const expectedPrepared = sha256Canonical({
    domain: schemaVersion === 1 ? "ameba:writer_prepared_plan:v1" : "ameba:writer_prepared_plan:v2",
    plan: withoutDigest,
  });
  const operationFields = schemaVersion === 1
    ? {
        domain: "ameba:writer_operation_id:v1", ...collectiveWitness, operation, currentObservationDigest,
        leanAdmissionDigest, semantic, instructions, writeSet, signerRoles,
      }
    : {
        domain: "ameba:writer_operation_id:v2", operation, currentObservationDigest,
        leanAdmissionDigest, semantic, setupMode,
        ...(transactionLookupTable === undefined ? {} : { transactionLookupTable }),
        ...(coldProofFacts === null ? {} : { coldAccountProofFacts: coldProofFacts }),
        ...(canonicalOutputFacts === null ? {} : { canonicalOutputSetupFacts: canonicalOutputFacts }),
        ...(classicOutputFacts === null ? {} : { classicOutputSetupFacts: classicOutputFacts }),
        setupInstructionBatches: object.setupInstructionBatches,
        setupSignerRoles: object.setupSignerRoles,
        instructions,
        executionInstructionBatches: object.executionInstructionBatches,
        actionBatchIndex,
        writeSet,
        signerRoles,
      };
  if (preparedPlanDigest !== expectedPrepared || operationId !== sha256Canonical(operationFields)) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "writer operation or prepared-plan digest is invalid");
  }
  return Object.freeze({
    raw: object, operation, schemaVersion, operationId, preparedPlanDigest,
    currentObservation: observation, currentObservationDigest, leanAdmissionDigest, semantic,
    instructions, executionInstructionBatches: executionBatches, actionBatchIndex, writeSet,
    signerRoles, setupSignerRoles, setupMode, coldProofFacts, canonicalOutputFacts, classicOutputFacts,
    ...(transactionLookupTable === undefined ? {} : { transactionLookupTable }),
    observedBytes: null, sourceState: null, destinationState: null,
  });
}

function decodeFlatPlan(value: unknown): CurrentDecodedCollectivePlan {
  const keys = [
    "schemaVersion", "operation", "operationId", "currentObservation", "currentObservationDigest",
    "semantic", "sourceState", "destinationState", "sourceProofFacts", "destinationProofFacts",
    "observedBytes", "setupInstructionBatches", "setupSignerRoles", "instructions",
    "executionInstructionBatches", "actionBatchIndex", "writeSet", "signerRoles", "preparedPlanDigest",
  ];
  const object = exactObject(value, keys, [], "Flat transfer plan");
  if (object.schemaVersion !== 1 || object.operation !== "transfer_flat") {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "Flat transfer plan identity is invalid");
  }
  const observation = validateCurrentFinalizedObservation(object.currentObservation);
  const currentObservationDigest = canonicalDigest(object.currentObservationDigest, "currentObservationDigest");
  if (currentObservationDigest !== observation.currentObservationDigest) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Flat plan observation digest is inconsistent");
  }
  const semantic = flatSemantic(object.semantic);
  if (object.sourceState !== "hot" && object.sourceState !== "cold") {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "Flat sourceState is invalid");
  }
  if (object.destinationState !== "hot" && object.destinationState !== "cold" && object.destinationState !== "absent") {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "Flat destinationState is invalid");
  }
  const sourceState = object.sourceState;
  const destinationState = object.destinationState;
  const sourceProof = object.sourceProofFacts === null ? null : flatColdFacts(object.sourceProofFacts, "sourceProofFacts");
  const destinationProof = object.destinationProofFacts === null ? null : flatColdFacts(object.destinationProofFacts, "destinationProofFacts");
  if ((sourceState === "cold") !== (sourceProof !== null)
    || (destinationState === "cold") !== (destinationProof !== null)
    || (sourceProof !== null && destinationProof !== null)) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Flat cold-state facts are inconsistent");
  }
  const observedBytes = exactObject(object.observedBytes,
    ["mintDataBase64", "sourceLightDataBase64", "destinationLightDataBase64"], [], "observedBytes");
  for (const field of ["mintDataBase64", "sourceLightDataBase64", "destinationLightDataBase64"] as const) {
    if (observedBytes[field] !== null && typeof observedBytes[field] !== "string") {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", `observedBytes.${field} is invalid`);
    }
  }
  const setupBatches = decodeManifestBatches(object.setupInstructionBatches, "setupInstructionBatches", 0, 8, "forbidden");
  const instructions = Object.freeze(exactArray(object.instructions, "instructions", 1, 2)
    .map((entry, index) => decodeInstructionManifest(entry, `instructions[${index}]`, { instructionTag: "forbidden" })));
  const executionBatches = decodeManifestBatches(object.executionInstructionBatches, "executionInstructionBatches", 1, 8, "forbidden");
  const actionBatchIndex = canonicalIndex(object.actionBatchIndex, "actionBatchIndex", executionBatches.length - 1);
  if (actionBatchIndex !== executionBatches.length - 1
    || executionBatches.length !== Math.max(1, setupBatches.length)) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Flat execution grouping is invalid");
  }
  if (setupBatches.length === 0) {
    if (canonicalJson(executionBatches) !== canonicalJson([instructions])) {
      walletError("CURRENT_WALLET_PLAN_MISMATCH", "hot Flat execution batch differs from its action");
    }
  } else {
    setupBatches.forEach((batch, index) => {
      const expected = index === actionBatchIndex ? [...batch, ...instructions] : [...batch];
      if (canonicalJson(executionBatches[index]) !== canonicalJson(expected)) {
        walletError("CURRENT_WALLET_PLAN_MISMATCH", "Flat execution grouping differs from setup plus action");
      }
    });
  }
  const setupSignerRoles = decodeSetupSignerRoles(object.setupSignerRoles, setupBatches, "setupSignerRoles");
  const signerRoles = decodeSignerRoles(object.signerRoles, instructions, "signerRoles");
  const allManifests = [...setupBatches.flatMap((batch) => [...batch]), ...instructions];
  const writeSet = requireWriteSet(object.writeSet, allManifests, "writeSet");
  const operationId = canonicalDigest(object.operationId, "operationId");
  const preparedPlanDigest = canonicalDigest(object.preparedPlanDigest, "preparedPlanDigest");
  const withoutDigest = omitKey(object, "preparedPlanDigest");
  if (preparedPlanDigest !== sha256Canonical({ domain: "ameba:flat_transfer_prepared_plan:v1", plan: withoutDigest })) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Flat prepared-plan digest is invalid");
  }
  if (operationId !== sha256Canonical({
    domain: "ameba:flat_transfer_operation_id:v1",
    operation: "transfer_flat",
    currentObservationDigest,
    semantic,
    sourceState,
    destinationState,
    sourceProofFacts: sourceProof,
    destinationProofFacts: destinationProof,
    observedBytes,
    setupInstructionBatches: object.setupInstructionBatches,
    setupSignerRoles: object.setupSignerRoles,
    instructions,
    executionInstructionBatches: object.executionInstructionBatches,
    actionBatchIndex,
    writeSet,
    signerRoles,
  })) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Flat operation digest is invalid");
  }
  return Object.freeze({
    raw: object, operation: "transfer_flat", schemaVersion: 1, operationId, preparedPlanDigest,
    currentObservation: observation, currentObservationDigest, leanAdmissionDigest: "",
    semantic, instructions, executionInstructionBatches: executionBatches, actionBatchIndex,
    writeSet, signerRoles, setupSignerRoles, setupMode: setupBatches.length === 0 ? "none" : "cold_load",
    coldProofFacts: sourceProof ?? destinationProof, canonicalOutputFacts: null, observedBytes,
    sourceState, destinationState,
  });
}

function decodeSwapPlan(value: unknown): CurrentDecodedCollectivePlan {
  const keys = [
    "schemaVersion", "operation", "operationId", "currentObservation", "currentObservationDigest",
    "leanAdmissionDigest", "semantic", "instruction", "writeSet", "signerRoles", "preparedPlanDigest",
  ];
  const object = exactObject(value, keys, ["computeUnitLimit", "transactionLookupTable"], "collective swap plan");
  if (object.schemaVersion !== 1 || object.operation !== "collective_swap_exact_in") {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "collective swap plan identity is invalid");
  }
  const observation = validateCurrentFinalizedObservation(object.currentObservation);
  const currentObservationDigest = canonicalDigest(object.currentObservationDigest, "currentObservationDigest");
  if (currentObservationDigest !== observation.currentObservationDigest) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "swap plan observation digest is inconsistent");
  }
  const semantic = swapSemantic(object.semantic, observation);
  const lookup = object.transactionLookupTable === undefined ? {} : {
    transactionLookupTable: decodeCurrentCollectiveLookupTableV1(object.transactionLookupTable, observation).witness,
  };
  const instruction = decodeInstructionManifest(object.instruction, "instruction", { instructionTag: "required" });
  if (object.computeUnitLimit !== undefined && object.computeUnitLimit !== 1_000_000) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "swap compute limit must be the canonical 1000000 units");
  }
  const compute = object.computeUnitLimit === undefined ? {} : { computeUnitLimit: 1_000_000 };
  const computeInstruction: CurrentWalletInstructionManifest = Object.freeze({
    programId: ComputeBudgetProgram.programId.toBase58(), instructionName: "SetComputeUnitLimit",
    instructionTag: 2, dataBase64: encodeBase64(ComputeBudgetProgram.setComputeUnitLimit({units: 1_000_000}).data), accounts: Object.freeze([]),
  });
  const instructions = Object.freeze(object.computeUnitLimit === undefined
    ? [instruction] : [computeInstruction, instruction]);
  const signerRoles = decodeSignerRoles(object.signerRoles, instructions, "signerRoles");
  const writeSet = requireWriteSet(object.writeSet, instructions, "writeSet");
  const operationId = canonicalDigest(object.operationId, "operationId");
  const preparedPlanDigest = canonicalDigest(object.preparedPlanDigest, "preparedPlanDigest");
  const leanAdmissionDigest = canonicalDigest(object.leanAdmissionDigest, "leanAdmissionDigest");
  const withoutDigest = omitKey(object, "preparedPlanDigest");
  if (preparedPlanDigest !== sha256Canonical({ domain: "ameba:collective_swap_prepared_plan:v1", plan: withoutDigest })) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "collective swap prepared-plan digest is invalid");
  }
  if (operationId !== sha256Canonical({
    domain: "ameba:collective_swap_operation_id:v1",
    operation: "collective_swap_exact_in", currentObservationDigest, leanAdmissionDigest,
    semantic, instruction, writeSet, signerRoles, ...compute, ...lookup,
  })) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "collective swap operation digest is invalid");
  }
  return Object.freeze({
    raw: object, operation: "collective_swap_exact_in", schemaVersion: 1, operationId, ...lookup,
    preparedPlanDigest, currentObservation: observation, currentObservationDigest,
    leanAdmissionDigest, semantic, instructions, executionInstructionBatches: Object.freeze([instructions]),
    actionBatchIndex: 0, writeSet, signerRoles, setupSignerRoles: Object.freeze([]), setupMode: "none",
    coldProofFacts: null, canonicalOutputFacts: null, observedBytes: null,
    sourceState: null, destinationState: null,
  });
}

function writerOperation(value: unknown): Exclude<CurrentCollectiveOperationKind, "transfer_flat" | "collective_swap_exact_in"> {
  const operations = new Set([
    ...CURRENT_WRITER_LIQUIDITY_OPERATIONS, ...CURRENT_WRITER_DLMM_POLICY_OPERATIONS,
    "withdraw_principal", "auction_refund", "deposit", "bid", "close_begin", "close_basket", "close_finalize", "close_cancel",
    "settlement_claim_flat", "settlement_claim_collective",
  ]);
  if (typeof value !== "string" || !operations.has(value)) {
    walletError("CURRENT_WALLET_OPERATION_UNSUPPORTED", "writer plan operation is not a public RC44 wallet operation");
  }
  return value as Exclude<CurrentCollectiveOperationKind, "transfer_flat" | "collective_swap_exact_in">;
}

function writerSemantic(
  operation: Exclude<CurrentCollectiveOperationKind, "transfer_flat" | "collective_swap_exact_in">,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (isCurrentWriterDlmmOperation(operation)) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.hasOwn(value, "operation")) walletError("CURRENT_WALLET_RESPONSE_INVALID", "writer liquidity semantic is invalid");
    try {
      const { operation: _operation, ...semantic } = validateCurrentWriterDlmmRequest({ ...value, operation });
      return Object.freeze(semantic);
    } catch (cause) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", cause instanceof Error ? cause.message : "writer liquidity semantic is invalid");
    }
  }
  let fields: readonly string[];
  if (operation === "withdraw_principal") fields = ["owner", "sleeve", "amountAtoms"];
  else if (operation === "auction_refund") fields = ["owner", "auction", "bid"];
  else if (operation === "deposit") fields = ["owner", "sleeve", "principalAtoms"];
  else if (operation === "bid") fields = ["owner", "auction", "seriesIndex", "pricePerContractAtoms", "quantityAtoms"];
  else if (operation === "close_begin") fields = ["owner", "sleeve", "flatParAtoms", "minimumWithdrawalAtoms"];
  else if ((operation === "settlement_claim_flat" || operation === "settlement_claim_collective")) {
    fields = ["owner", "sleeve", "claimVariant", "seriesIndex", "amountAtoms"];
  } else fields = ["owner", "closeRequest"];
  const object = exactObject(value, fields, [], "semantic");
  const result: Record<string, unknown> = { owner: pubkey(object.owner, "semantic.owner").toBase58() };
  if ("sleeve" in object) result.sleeve = pubkey(object.sleeve, "semantic.sleeve").toBase58();
  if ("bid" in object) result.bid = pubkey(object.bid, "semantic.bid").toBase58();
  if (operation === "withdraw_principal") result.amountAtoms = canonicalU64(object.amountAtoms, "semantic.amountAtoms", true);
  if ("auction" in object) result.auction = pubkey(object.auction, "semantic.auction").toBase58();
  if ("closeRequest" in object) result.closeRequest = pubkey(object.closeRequest, "semantic.closeRequest").toBase58();
  if (operation === "deposit") result.principalAtoms = canonicalU64(object.principalAtoms, "semantic.principalAtoms", true);
  if (operation === "bid") {
    result.seriesIndex = canonicalIndex(object.seriesIndex, "semantic.seriesIndex", 19);
    result.pricePerContractAtoms = canonicalU64(object.pricePerContractAtoms, "semantic.pricePerContractAtoms", true);
    result.quantityAtoms = canonicalU64(object.quantityAtoms, "semantic.quantityAtoms", true);
  }
  if (operation === "close_begin") {
    result.flatParAtoms = canonicalU64(object.flatParAtoms, "semantic.flatParAtoms", true);
    result.minimumWithdrawalAtoms = canonicalU64(object.minimumWithdrawalAtoms, "semantic.minimumWithdrawalAtoms");
  }
  if ((operation === "settlement_claim_flat" || operation === "settlement_claim_collective")) {
    const expectedVariant = operation === "settlement_claim_flat" ? "flat_residual" : "collective_long";
    if (object.claimVariant !== expectedVariant) walletError("CURRENT_WALLET_RESPONSE_INVALID", "claimVariant differs from operation");
    result.claimVariant = expectedVariant;
    result.seriesIndex = canonicalIndex(object.seriesIndex, "semantic.seriesIndex", operation === "settlement_claim_flat" ? 255 : 19);
    if (operation === "settlement_claim_flat" && result.seriesIndex !== 255) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", "claim seriesIndex differs from claim variant");
    }
    result.amountAtoms = canonicalU64(object.amountAtoms, "semantic.amountAtoms", true);
  }
  return Object.freeze(result);
}

function flatSemantic(value: unknown): Readonly<Record<string, unknown>> {
  const object = exactObject(value, ["owner", "sleeve", "destinationOwner", "amountAtoms"], [], "semantic");
  return Object.freeze({
    owner: pubkey(object.owner, "semantic.owner").toBase58(),
    sleeve: pubkey(object.sleeve, "semantic.sleeve").toBase58(),
    destinationOwner: pubkey(object.destinationOwner, "semantic.destinationOwner").toBase58(),
    amountAtoms: canonicalU64(object.amountAtoms, "semantic.amountAtoms", true),
  });
}

function swapSemantic(value: unknown, observation: CurrentFinalizedObservation): Readonly<Record<string, unknown>> {
  const fields = [
    "trader", "market", "oracleMonth", "writerSettlementGroup", "writerSleeve",
    "writerSeriesBook", "pool", "optionMint", "quoteMint", "direction", "amountIn",
    "minimumAmountOut", "limitBinId", "deadlineTs", "reservePageIndices",
  ];
  const object = exactObject(value, fields, [], "semantic");
  if (object.direction !== "QuoteForOption" && object.direction !== "OptionForQuote") {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "swap direction is invalid");
  }
  const pageValues = exactArray(object.reservePageIndices, "semantic.reservePageIndices", 0, 8)
    .map((entry, index) => canonicalIndex(entry, `semantic.reservePageIndices[${index}]`, 0xffff));
  if (new Set(pageValues).size !== pageValues.length) {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "swap reserve page indices contain duplicates");
  }
  const deadlineTs = canonicalU64(object.deadlineTs, "semantic.deadlineTs", true);
  if (BigInt(deadlineTs) !== BigInt(observation.observedBlockTimeUnixSeconds!) + 120n) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "swap deadline is not prepared observation time plus 120 seconds");
  }
  return Object.freeze({
    trader: pubkey(object.trader, "semantic.trader").toBase58(),
    market: pubkey(object.market, "semantic.market").toBase58(),
    oracleMonth: pubkey(object.oracleMonth, "semantic.oracleMonth").toBase58(),
    writerSettlementGroup: pubkey(object.writerSettlementGroup, "semantic.writerSettlementGroup").toBase58(),
    writerSleeve: pubkey(object.writerSleeve, "semantic.writerSleeve").toBase58(),
    writerSeriesBook: pubkey(object.writerSeriesBook, "semantic.writerSeriesBook").toBase58(),
    pool: pubkey(object.pool, "semantic.pool").toBase58(),
    optionMint: pubkey(object.optionMint, "semantic.optionMint").toBase58(),
    quoteMint: pubkey(object.quoteMint, "semantic.quoteMint").toBase58(),
    direction: object.direction,
    amountIn: canonicalU64(object.amountIn, "semantic.amountIn", true),
    minimumAmountOut: canonicalU64(object.minimumAmountOut, "semantic.minimumAmountOut", true),
    limitBinId: canonicalIndex(object.limitBinId, "semantic.limitBinId", 0xffff),
    deadlineTs,
    reservePageIndices: Object.freeze(pageValues),
  });
}

function decodeSignerRoles(
  value: unknown,
  manifests: readonly CurrentWalletInstructionManifest[],
  label: string,
): readonly CurrentWalletSignerRole[] {
  const roles = exactArray(value, label, 1, 8).map((entry, index) => {
    const role = exactObject(entry, ["pubkey", "role", "instructionIndexes"], [], `${label}[${index}]`);
    if (typeof role.role !== "string" || !/^[a-z][a-z0-9_]{0,31}$/u.test(role.role)) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label}[${index}].role is invalid`);
    }
    const indexes = exactArray(role.instructionIndexes, `${label}[${index}].instructionIndexes`, 1, manifests.length)
      .map((entryValue, entryIndex) => canonicalIndex(
        entryValue, `${label}[${index}].instructionIndexes[${entryIndex}]`, manifests.length - 1));
    if (new Set(indexes).size !== indexes.length || indexes.some((entryValue, entryIndex) => entryIndex > 0 && indexes[entryIndex - 1]! >= entryValue)) {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label}[${index}] indexes are not unique and sorted`);
    }
    return Object.freeze({
      pubkey: pubkey(role.pubkey, `${label}[${index}].pubkey`).toBase58(),
      role: role.role,
      instructionIndexes: Object.freeze(indexes),
    });
  });
  const required = new Map<string, number[]>();
  manifests.forEach((manifest, instructionIndex) => manifest.accounts.filter((meta) => meta.isSigner).forEach((meta) => {
    const indexes = required.get(meta.address) ?? [];
    if (!indexes.includes(instructionIndex)) indexes.push(instructionIndex);
    required.set(meta.address, indexes);
  }));
  if (roles.length !== required.size || new Set(roles.map((role) => role.pubkey)).size !== roles.length
    || roles.some((role) => canonicalJson(role.instructionIndexes) !== canonicalJson(required.get(role.pubkey)))) {
    walletError("CURRENT_WALLET_PLAN_INVALID", `${label} does not exactly cover signer metas`);
  }
  return Object.freeze(roles);
}

function decodeSetupSignerRoles(
  value: unknown,
  batches: readonly (readonly CurrentWalletInstructionManifest[])[],
  label: string,
): readonly CurrentWalletSignerRole[] {
  if (batches.length === 0) {
    if (!Array.isArray(value) || value.length !== 0) walletError("CURRENT_WALLET_PLAN_INVALID", `${label} must be empty`);
    return Object.freeze([]);
  }
  const values = exactArray(value, label, batches.length, batches.length);
  return Object.freeze(values.map((entry, index) => {
    const role = exactObject(entry, ["pubkey", "role", "setupBatchIndex", "instructionIndexes"], [], `${label}[${index}]`);
    if ((role.role !== "payer" && role.role !== "owner") || role.setupBatchIndex !== index) {
      walletError("CURRENT_WALLET_PLAN_INVALID", `${label}[${index}] identity is invalid`);
    }
    const manifests = batches[index]!;
    const indexes = exactArray(role.instructionIndexes, `${label}[${index}].instructionIndexes`, 1, manifests.length)
      .map((entryValue, entryIndex) => canonicalIndex(
        entryValue, `${label}[${index}].instructionIndexes[${entryIndex}]`, manifests.length - 1));
    const signer = pubkey(role.pubkey, `${label}[${index}].pubkey`).toBase58();
    const expected = manifests.flatMap((manifest, instructionIndex) =>
      manifest.accounts.some((meta) => meta.address === signer && meta.isSigner) ? [instructionIndex] : []);
    if (canonicalJson(indexes) !== canonicalJson(expected)) {
      walletError("CURRENT_WALLET_PLAN_INVALID", `${label}[${index}] indexes differ from signer metas`);
    }
    return Object.freeze({ pubkey: signer, role: role.role, instructionIndexes: Object.freeze(indexes) });
  }));
}

function decodeManifestBatches(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  tags: "required" | "forbidden" | "optional",
): readonly (readonly CurrentWalletInstructionManifest[])[] {
  return Object.freeze(exactArray(value, label, minimum, maximum).map((batch, batchIndex) =>
    Object.freeze(exactArray(batch, `${label}[${batchIndex}]`, 1, 32).map((entry, instructionIndex) =>
      decodeInstructionManifest(
        entry,
        `${label}[${batchIndex}][${instructionIndex}]`,
        tags === "optional" ? {} : { instructionTag: tags },
      )))));
}

function writerColdFacts(value: unknown): Readonly<Record<string, unknown>> {
  const object = exactObject(value, [
    "ata", "owner", "mint", "amountAtoms", "minimumAmountAtoms", "includesColdBalance",
    "providerOriginSha256", "payer",
  ], [], "coldAccountProofFacts");
  if (object.includesColdBalance !== true) walletError("CURRENT_WALLET_RESPONSE_INVALID", "cold proof does not include balance");
  return Object.freeze({
    ata: pubkey(object.ata, "coldAccountProofFacts.ata").toBase58(),
    owner: pubkey(object.owner, "coldAccountProofFacts.owner").toBase58(),
    mint: pubkey(object.mint, "coldAccountProofFacts.mint").toBase58(),
    amountAtoms: canonicalU64(object.amountAtoms, "coldAccountProofFacts.amountAtoms"),
    minimumAmountAtoms: canonicalU64(object.minimumAmountAtoms, "coldAccountProofFacts.minimumAmountAtoms"),
    includesColdBalance: true,
    providerOriginSha256: canonicalDigest(object.providerOriginSha256, "coldAccountProofFacts.providerOriginSha256"),
    payer: pubkey(object.payer, "coldAccountProofFacts.payer").toBase58(),
  });
}

function writerOutputFacts(value: unknown): Readonly<Record<string, unknown>> {
  const object = exactObject(value, ["ata", "owner", "mint", "payer"], [], "canonicalOutputSetupFacts");
  return Object.freeze(Object.fromEntries(Object.entries(object).map(([key, entry]) =>
    [key, pubkey(entry, `canonicalOutputSetupFacts.${key}`).toBase58()])));
}

function flatColdFacts(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const object = exactObject(value, [
    "ata", "owner", "mint", "amountAtoms", "includesColdBalance", "providerOriginSha256", "payer",
  ], [], label);
  if (object.includesColdBalance !== true) walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} does not include balance`);
  return Object.freeze({
    ata: pubkey(object.ata, `${label}.ata`).toBase58(),
    owner: pubkey(object.owner, `${label}.owner`).toBase58(),
    mint: pubkey(object.mint, `${label}.mint`).toBase58(),
    amountAtoms: canonicalU64(object.amountAtoms, `${label}.amountAtoms`),
    includesColdBalance: true,
    providerOriginSha256: canonicalDigest(object.providerOriginSha256, `${label}.providerOriginSha256`),
    payer: pubkey(object.payer, `${label}.payer`).toBase58(),
  });
}

function validateLeanAdmission(
  plan: CurrentDecodedCollectivePlan,
  admission: Readonly<Record<string, unknown>>,
  stageValue: unknown,
): void {
  if (admission.ok !== true) {
    walletError("CURRENT_WALLET_ADMISSION_INVALID", "Lean admission is not successful");
  }
  if (plan.operation !== "close_begin"
    && admission.currentObservationDigest !== plan.currentObservationDigest) {
    walletError("CURRENT_WALLET_ADMISSION_INVALID", "Lean admission does not bind the prepared observation");
  }
  if (["close_basket", "close_finalize", "close_cancel"].includes(plan.operation)) {
    const stage = exactObject(stageValue, ["operation"],
      stageValue !== null && typeof stageValue === "object" && "seriesIndex" in stageValue ? ["seriesIndex"] : [], "stage");
    if (canonicalJson(admission.stage) !== canonicalJson(stage)) {
      walletError("CURRENT_WALLET_ADMISSION_INVALID", "close stage differs from the exact Lean admission");
    }
    if (admission.facts === null || typeof admission.facts !== "object" || Array.isArray(admission.facts)) {
      walletError("CURRENT_WALLET_ADMISSION_INVALID", "close admission facts are missing");
    }
    const facts = exactObject(
      admission.facts,
      [],
      Object.keys(admission.facts as Readonly<Record<string, unknown>>),
      "leanAdmission.facts",
    );
    if (facts.owner !== plan.semantic.owner || facts.closeRequest !== plan.semantic.closeRequest
      || (plan.operation === "close_cancel" ? facts.intent !== "cancel" : facts.intent !== "forward")) {
      walletError("CURRENT_WALLET_ADMISSION_INVALID", "close admission facts do not bind owner, request, and intent");
    }
    return;
  }
  if (plan.operation !== "close_begin") {
    const expectedOperation = ["settlement_claim_flat", "settlement_claim_collective"].includes(plan.operation)
        ? "claim"
        : plan.operation;
    const expectedSemantic = plan.operation === "collective_swap_exact_in"
      ? {
          owner: plan.semantic.trader,
          market: plan.semantic.market,
          direction: plan.semantic.direction,
          amountIn: plan.semantic.amountIn,
          minimumAmountOut: plan.semantic.minimumAmountOut,
          limitBinId: plan.semantic.limitBinId,
        }
      : plan.semantic;
    if (admission.operation !== expectedOperation
      || canonicalJson(admission.semantic) !== canonicalJson(expectedSemantic)) {
      walletError("CURRENT_WALLET_ADMISSION_INVALID", "Lean admission does not echo exact operation semantics");
    }
  }
}

function omitKey(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key)));
}

function assertCanonicalJsonValue(value: unknown, label: string): void {
  try {
    canonicalJson(value);
  } catch {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is not canonical JSON data`);
  }
}
