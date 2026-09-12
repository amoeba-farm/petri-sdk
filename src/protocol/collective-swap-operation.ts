import { deriveCollectiveSettlementDelegatePda } from "./writer-sleeve.js";
import { deriveWriterDlmmPolicyPda, deriveWriterDlmmPositionPda, deriveWriterSleeveUsdcVaultPda,
  deriveWriterRetirementCustodyPda, deriveWriterPolicyRegistryPda, deriveWriterProtocolFeeVaultPda } from "./writer-sleeve.js";
import { deriveContractMintStagingPda } from "@amoeba/spread-release-tools/oracle-dlmm";
import { decodeCurrentCollectiveLookupTableV1, type CurrentCollectiveLookupTableWitnessV1 } from "./current-collective-lookup-table.js";
import { compileCurrentWalletUnsignedBatch } from "../wallet/transaction.js";
import { createHash } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  deriveAmoebaDlmmAuthorityPda,
  deriveAmoebaDlmmBinPagePda,
  deriveAmoebaDlmmPoolPda,
} from "@amoeba/spread-release-tools/dlmm-accounts";
import {
  deriveWriterSeriesBookPda,
  deriveWriterSleevePda,
} from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import {
  validateCurrentFinalizedObservation,
  type CurrentFinalizedObservation,
} from "../current-finalized-observation.js";
import { AmebaProtocolError } from "../errors.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import type { WriterInstructionAccountMeta, WriterSignerRole } from "./writer-operation.js";
import { semanticCurrentSpreadInstructionV1 } from "./current-governed-write-internal.js";

export const COLLECTIVE_SWAP_OPERATION_PLAN_SCHEMA_VERSION = 1 as const;
export const COLLECTIVE_SWAP_EXACT_IN_TAG = 254 as const;
export const COLLECTIVE_SWAP_MAX_RESERVE_PAGES = 8 as const;
export const COLLECTIVE_SWAP_DEADLINE_TTL_SECONDS = 120n;
export const COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT = 1_000_000 as const;

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
export function prepareCollectiveSwapOperation(
  input: PrepareCollectiveSwapOperationInput,
): CollectiveSwapOperationPlan {
  const observation = validateCurrentFinalizedObservation(input.currentObservation);
  requireDigest(input.leanAdmissionDigest, "leanAdmissionDigest");
  const semantic = validateSemantic(input.semantic, observation);
  const instruction = collectiveSwapInstructionManifest(input.instruction, semantic, observation);
  const lookup = input.transactionLookupTable === undefined ? undefined : decodeCurrentCollectiveLookupTableV1(input.transactionLookupTable, observation);
  const lookupBinding = lookup === undefined ? {} : { transactionLookupTable: lookup.witness };
  const writeSet = canonicalAddresses(input.writeSet);
  requireExactWriteSet(writeSet, instruction.accounts);
  if (input.computeUnitLimit !== undefined && input.computeUnitLimit !== COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT) {
    throw swapPlanError("COLLECTIVE_SWAP_COMPUTE_INVALID", "swap compute limit must be the canonical 1000000 units");
  }
  const compute = input.computeUnitLimit === undefined ? {} : { computeUnitLimit: input.computeUnitLimit };
  const signerRoles = canonicalSignerRoles(input.signerRoles, input.computeUnitLimit === undefined ? 0 : 1);
  requireExactSignerCoverage(signerRoles, instruction.accounts);
  const operationId = digestCanonical({
    domain: "ameba:collective_swap_operation_id:v1",
    operation: "collective_swap_exact_in",
    currentObservationDigest: observation.currentObservationDigest,
    leanAdmissionDigest: input.leanAdmissionDigest,
    semantic,
    instruction,
    writeSet,
    signerRoles,
    ...compute,
    ...lookupBinding,
  });
  const withoutDigest = Object.freeze({
    schemaVersion: COLLECTIVE_SWAP_OPERATION_PLAN_SCHEMA_VERSION,
    operation: "collective_swap_exact_in" as const,
    operationId,
    currentObservation: observation,
    currentObservationDigest: observation.currentObservationDigest,
    leanAdmissionDigest: input.leanAdmissionDigest,
    semantic,
    instruction,
    writeSet,
    signerRoles,
    ...compute,
    ...lookupBinding,
  });
  compileCurrentWalletUnsignedBatch(new PublicKey(semantic.trader), PublicKey.default.toBase58(),
    input.computeUnitLimit === undefined ? [input.instruction] : [ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnitLimit }), input.instruction],
    lookup === undefined ? [] : [lookup.account]);
  return Object.freeze({
    ...withoutDigest,
    preparedPlanDigest: digestCanonical({
      domain: "ameba:collective_swap_prepared_plan:v1",
      plan: withoutDigest,
    }),
  });
}

/** Exact execution sequence; the optional budget is fixed, never caller supplied instruction bytes. */
export function collectiveSwapExecutionInstructions(plan: CollectiveSwapOperationPlan): readonly {
  readonly programId: string;
  readonly instructionName: string;
  readonly instructionTag: number;
  readonly dataBase64: string;
  readonly accounts: readonly WriterInstructionAccountMeta[];
}[] {
  if (plan.computeUnitLimit === undefined) return Object.freeze([plan.instruction]);
  if (plan.computeUnitLimit !== COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT) {
    throw swapPlanError("COLLECTIVE_SWAP_COMPUTE_INVALID", "swap compute limit must be the canonical 1000000 units");
  }
  const compute = ComputeBudgetProgram.setComputeUnitLimit({ units: COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT });
  return Object.freeze([Object.freeze({ programId: compute.programId.toBase58(),
    instructionName: "SetComputeUnitLimit", instructionTag: 2,
    dataBase64: Buffer.from(compute.data).toString("base64"), accounts: Object.freeze([]),
  }), plan.instruction]);
}

/** Validate a portable plan only by comparing it with an independently rebuilt native plan. */
export function validateCollectiveSwapOperationPlan(
  plan: CollectiveSwapOperationPlan,
  independentlyRebuilt: PrepareCollectiveSwapOperationInput,
): CollectiveSwapOperationPlan {
  const rebuilt = prepareCollectiveSwapOperation(independentlyRebuilt);
  if (canonicalJson(plan) !== canonicalJson(rebuilt)) {
    throw swapPlanError(
      "COLLECTIVE_SWAP_PLAN_MISMATCH",
      "collective swap plan differs from its canonical RC44 reconstruction",
    );
  }
  return rebuilt;
}

function collectiveSwapInstructionManifest(
  instruction: TransactionInstruction,
  semantic: CollectiveSwapSemanticInput,
  observation: CurrentFinalizedObservation,
): CollectiveSwapInstructionManifest {
  const semanticInstruction = semanticCurrentSpreadInstructionV1(instruction);
  const programId = new PublicKey(AMOEBA_SPREAD_PROGRAM_ID);
  if (!instruction.programId.equals(programId)) {
    throw swapPlanError("COLLECTIVE_SWAP_PROGRAM_MISMATCH", "collective swap instruction has a foreign program id");
  }
  if (semanticInstruction.data.length !== 28 || semanticInstruction.data[0] !== COLLECTIVE_SWAP_EXACT_IN_TAG) {
    throw swapPlanError("COLLECTIVE_SWAP_DATA_INVALID", "collective swap must be the exact 28-byte tag-254 payload");
  }
  const payload = Buffer.from(semanticInstruction.data);
  const direction = payload[1] === 0 ? "QuoteForOption" : payload[1] === 1 ? "OptionForQuote" : null;
  if (direction === null
    || direction !== semantic.direction
    || payload.readBigUInt64LE(2).toString() !== semantic.amountIn
    || payload.readBigUInt64LE(10).toString() !== semantic.minimumAmountOut
    || payload.readUInt16LE(18) !== semantic.limitBinId
    || payload.readBigUInt64LE(20).toString() !== semantic.deadlineTs) {
    throw swapPlanError("COLLECTIVE_SWAP_DATA_INVALID", "collective swap payload differs from admitted semantics");
  }
  if (semanticInstruction.keys.length !== 32 + semantic.reservePageIndices.length) {
    throw swapPlanError("COLLECTIVE_SWAP_METAS_INVALID", "collective swap account count differs from its route");
  }
  const expectedFlags: readonly (readonly [boolean, boolean])[] = [
    [true, true], [false, false], [false, true], [false, false], [false, true],
    [false, false], [false, true], [false, true], [false, false], [false, true],
    [false, false], [false, true], [false, true], [false, true], [false, true],
    [false, false], [false, false], [false, true], [false, true], [false, false],
    [false, false], [false, false], [false, true], [false, false],
    [false, true], [false, false], [false, true], [false, true],
    [false, true], [false, true], [false, false], [false, true],
  ];
  semanticInstruction.keys.forEach((meta, index) => {
    const flags = index < expectedFlags.length ? expectedFlags[index]! : [false, true] as const;
    if (meta.isSigner !== flags[0] || meta.isWritable !== flags[1]) {
      throw swapPlanError("COLLECTIVE_SWAP_METAS_INVALID", `collective swap account ${index} has noncanonical flags`);
    }
  });
  const expectedAddresses = [
    semantic.trader,
    undefined,
    semantic.market,
    semantic.oracleMonth,
    semantic.writerSleeve,
    semantic.writerSettlementGroup,
    semantic.writerSeriesBook,
    semantic.pool,
    deriveAmoebaDlmmAuthorityPda(new PublicKey(semantic.pool), programId)[0].toBase58(),
    semantic.optionMint,
    semantic.quoteMint,
  ];
  expectedAddresses.forEach((expected, index) => {
    if (expected !== undefined && semanticInstruction.keys[index]!.pubkey.toBase58() !== expected) {
      throw swapPlanError("COLLECTIVE_SWAP_METAS_INVALID", `collective swap account ${index} differs from admitted identity`);
    }
  });
  if (!deriveWriterSleevePda(new PublicKey(semantic.writerSettlementGroup), programId)[0]
    .equals(new PublicKey(semantic.writerSleeve))
    || !deriveWriterSeriesBookPda(new PublicKey(semantic.writerSleeve), programId)[0]
      .equals(new PublicKey(semantic.writerSeriesBook))
    || !deriveAmoebaDlmmPoolPda(new PublicKey(semantic.market), programId)[0]
      .equals(new PublicKey(semantic.pool))) {
    throw swapPlanError("COLLECTIVE_SWAP_IDENTITY_INVALID", "collective swap parent/child PDAs are not canonical");
  }
  if (!semanticInstruction.keys[23]!.pubkey.equals(deriveCollectiveSettlementDelegatePda(new PublicKey(semantic.trader), new PublicKey(semantic.optionMint), programId)[0])) {
    throw swapPlanError("COLLECTIVE_SWAP_IDENTITY_INVALID", "settlement authority differs from the wallet and contract mint");
  }
  const sleeve = new PublicKey(semantic.writerSleeve), pool = new PublicKey(semantic.pool), market = new PublicKey(semantic.market);
  const registry = deriveWriterPolicyRegistryPda(programId)[0];
  const writerKeys = [deriveWriterDlmmPolicyPda(sleeve, programId)[0], undefined,
    deriveWriterDlmmPositionPda(pool, sleeve, programId)[0], deriveWriterSleeveUsdcVaultPda(sleeve, programId)[0],
    deriveContractMintStagingPda({ marketPda: market, programId }), deriveWriterRetirementCustodyPda(sleeve, market, programId)[0],
    registry, deriveWriterProtocolFeeVaultPda(registry, programId)[0]];
  writerKeys.forEach((expected, index) => {
    if (expected && !semanticInstruction.keys[24 + index]!.pubkey.equals(expected)) {
      throw swapPlanError("COLLECTIVE_SWAP_IDENTITY_INVALID", "writer swap custody is not canonical");
    }
  });
  semantic.reservePageIndices.forEach((pageIndex, routeIndex) => {
    const expected = deriveAmoebaDlmmBinPagePda(new PublicKey(semantic.pool), pageIndex, programId)[0];
    if (!semanticInstruction.keys[32 + routeIndex]!.pubkey.equals(expected)) {
      throw swapPlanError("COLLECTIVE_SWAP_IDENTITY_INVALID", "collective swap reserve page is not canonical");
    }
  });
  requireObservedStateBinding(observation, semanticInstruction);
  return Object.freeze({
    programId: AMOEBA_SPREAD_PROGRAM_ID,
    instructionName: "SwapCollectiveDlmmExactInV1",
    instructionTag: COLLECTIVE_SWAP_EXACT_IN_TAG,
    dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({
      address: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    }))),
  });
}

function validateSemantic(
  input: CollectiveSwapSemanticInput,
  observation: CurrentFinalizedObservation,
): CollectiveSwapSemanticInput {
  const addressFields = [
    "trader", "market", "oracleMonth", "writerSettlementGroup", "writerSleeve",
    "writerSeriesBook", "pool", "optionMint", "quoteMint",
  ] as const;
  const addresses = Object.fromEntries(addressFields.map((field) => [field, new PublicKey(input[field]).toBase58()]));
  const amountIn = canonicalPositiveU64(input.amountIn, "amountIn");
  const minimumAmountOut = canonicalPositiveU64(input.minimumAmountOut, "minimumAmountOut");
  const deadlineTs = canonicalPositiveU64(input.deadlineTs, "deadlineTs");
  const observedBlockTime = observation.observedBlockTimeUnixSeconds;
  if (observedBlockTime === null
    || BigInt(deadlineTs) !== BigInt(observedBlockTime) + COLLECTIVE_SWAP_DEADLINE_TTL_SECONDS) {
    throw swapPlanError(
      "COLLECTIVE_SWAP_DEADLINE_INVALID",
      "deadlineTs must equal finalized observed block time plus 120 seconds",
    );
  }
  if (input.direction !== "QuoteForOption" && input.direction !== "OptionForQuote") {
    throw swapPlanError("COLLECTIVE_SWAP_SEMANTIC_INVALID", "collective swap direction is invalid");
  }
  if (!Number.isInteger(input.limitBinId) || input.limitBinId < 0 || input.limitBinId > 0xffff) {
    throw swapPlanError("COLLECTIVE_SWAP_SEMANTIC_INVALID", "limitBinId must be a u16");
  }
  const reservePageIndices = [...input.reservePageIndices];
  if (reservePageIndices.length > COLLECTIVE_SWAP_MAX_RESERVE_PAGES
    || new Set(reservePageIndices).size !== reservePageIndices.length
    || reservePageIndices.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) {
    throw swapPlanError("COLLECTIVE_SWAP_SEMANTIC_INVALID", "reservePageIndices must contain 0..8 unique u16 values");
  }
  return Object.freeze({
    ...(addresses as unknown as Pick<CollectiveSwapSemanticInput, typeof addressFields[number]>),
    direction: input.direction,
    amountIn,
    minimumAmountOut,
    limitBinId: input.limitBinId,
    deadlineTs,
    reservePageIndices: Object.freeze(reservePageIndices),
  });
}

function requireObservedStateBinding(
  observation: CurrentFinalizedObservation,
  instruction: TransactionInstruction,
): void {
  const requiredIndexes = [
    1, 2, 3, 5, 4, 6, 7, 9, 10, 11, 12, 13, 14, 17, 18, 22,
    25, 27, 30, 31, ...instruction.keys.slice(32).map((_, routeIndex) => 32 + routeIndex),
  ];
  const observed = new Map(observation.orderedAccounts.map((account) => [account.address, account]));
  for (const index of requiredIndexes) {
    const address = instruction.keys[index]!.pubkey.toBase58();
    const account = observed.get(address);
    if (account === undefined || account.owner === null || account.executable === null
      || account.dataLength === null || account.dataSha256 === null) {
      throw swapPlanError(
        "COLLECTIVE_SWAP_OBSERVATION_INVALID",
        `finalized observation does not bind complete state for instruction account ${index}`,
      );
    }
  }
  for (const index of [23, 24, 26, 28, 29]) {
    const account = observed.get(instruction.keys[index]!.pubkey.toBase58());
    if (!account) throw swapPlanError("COLLECTIVE_SWAP_OBSERVATION_INVALID", "swap omits an optional custody observation");
  }
  const programOwnedIndexes = [1, 2, 3, 4, 5, 6, 7, 25, 30,
    ...instruction.keys.slice(32).map((_, routeIndex) => 32 + routeIndex)];
  for (const index of programOwnedIndexes) {
    const account = observed.get(instruction.keys[index]!.pubkey.toBase58())!;
    if (account.owner !== AMOEBA_SPREAD_PROGRAM_ID || account.executable !== false) {
      throw swapPlanError(
        "COLLECTIVE_SWAP_OBSERVATION_INVALID",
        `finalized observation has noncanonical owner state for instruction account ${index}`,
      );
    }
  }
}

function canonicalPositiveU64(value: string, label: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw swapPlanError("COLLECTIVE_SWAP_SEMANTIC_INVALID", `${label} must be a canonical positive u64 string`);
  }
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) {
    throw swapPlanError("COLLECTIVE_SWAP_SEMANTIC_INVALID", `${label} exceeds u64`);
  }
  return parsed.toString();
}

function canonicalAddresses(values: readonly (PublicKey | string)[]): readonly string[] {
  const addresses = values.map((value) => new PublicKey(value).toBase58());
  if (new Set(addresses).size !== addresses.length) {
    throw swapPlanError("COLLECTIVE_SWAP_WRITE_SET_INVALID", "collective swap write set contains a duplicate");
  }
  return Object.freeze(addresses.sort());
}

function canonicalSignerRoles(values: readonly WriterSignerRole[], instructionIndex: number): readonly WriterSignerRole[] {
  if (values.length !== 1 || values[0]!.instructionIndexes.length !== 1 || values[0]!.instructionIndexes[0] !== instructionIndex
    || values[0]!.role !== "trader") {
    throw swapPlanError("COLLECTIVE_SWAP_SIGNER_INVALID", "collective swap requires the trader signer role for the exact swap instruction index");
  }
  return Object.freeze([Object.freeze({
    pubkey: new PublicKey(values[0]!.pubkey).toBase58(),
    role: values[0]!.role,
    instructionIndexes: Object.freeze([instructionIndex]),
  })]);
}

function requireExactWriteSet(writeSet: readonly string[], accounts: readonly WriterInstructionAccountMeta[]): void {
  const exact = [...new Set(accounts.filter((meta) => meta.isWritable).map((meta) => meta.address))].sort();
  if (canonicalJson(writeSet) !== canonicalJson(exact)) {
    throw swapPlanError("COLLECTIVE_SWAP_WRITE_SET_INVALID", "collective swap write set must equal exact writable metas");
  }
}

function requireExactSignerCoverage(signers: readonly WriterSignerRole[], accounts: readonly WriterInstructionAccountMeta[]): void {
  const exact = accounts.filter((meta) => meta.isSigner).map((meta) => meta.address);
  if (exact.length !== 1 || signers[0]!.pubkey !== exact[0]) {
    throw swapPlanError("COLLECTIVE_SWAP_SIGNER_INVALID", "collective swap signer role must match the exact signer meta");
  }
}

function requireDigest(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw swapPlanError("COLLECTIVE_SWAP_DIGEST_INVALID", `${label} must be lowercase SHA-256`);
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

function swapPlanError(code: string, message: string): AmebaProtocolError {
  return new AmebaProtocolError(message, { code });
}
