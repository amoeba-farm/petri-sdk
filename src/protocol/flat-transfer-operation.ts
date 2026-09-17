import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { PublicKey, TransactionInstruction, type AccountInfo } from "@solana/web3.js";

import {
  validateCurrentFinalizedObservation,
  type CurrentFinalizedObservation,
  type CurrentFinalizedObservedAccount,
} from "../current-finalized-observation.js";
import { AmebaProtocolError } from "../errors.js";
import {
  CURRENT_LIGHT_TOKEN_PROGRAM_ID,
  CLASSIC_SPL_MINT_SIZE,
  CURRENT_LIGHT_TOKEN_ACCOUNT_SIZE,
  decodeClassicMintAccount,
  decodeClassicTokenAccount,
  deriveLightAssociatedTokenAddress,
} from "@amoeba/spread-release-tools/token-primitives";
import { SPL_TOKEN_PROGRAM_ID } from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveWriterFlatMintPda } from "@amoeba/spread-historical-v2/writer-sleeve-instructions";
import { buildCurrentCreateLightAtaIdempotentInstruction } from "./current-light-token-instructions.js";

export const FLAT_TRANSFER_OPERATION_PLAN_SCHEMA_VERSION = 1 as const;
export const FLAT_TRANSFER_OPERATION = "transfer_flat" as const;

const SYSTEM_PLACEHOLDER = PublicKey.default;
const CREATE_LIGHT_ATA_IDEMPOTENT_DISCRIMINATOR = 102;
const LIGHT_TRANSFER_CHECKED_DISCRIMINATOR = 12;
const COMPUTE_BUDGET_PROGRAM = new PublicKey("ComputeBudget111111111111111111111111111111");

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
export function buildCanonicalFlatTransferAction(
  input: BuildCanonicalFlatTransferActionInput,
): readonly TransactionInstruction[] {
  const owner = canonicalPubkey(input.semantic.owner, "owner");
  const sleeve = canonicalPubkey(input.semantic.sleeve, "sleeve");
  const destinationOwner = canonicalPubkey(input.semantic.destinationOwner, "destinationOwner");
  const amount = positiveU64(input.semantic.amountAtoms, "amountAtoms");
  const [flatMint] = deriveWriterFlatMintPda(sleeve);
  const mint = decodeClassicMint(flatMint, canonicalBase64(input.mintDataBase64, "mintDataBase64"));
  const source = deriveLightAssociatedTokenAddress(flatMint, owner);
  const destination = deriveLightAssociatedTokenAddress(flatMint, destinationOwner);
  const instructions: TransactionInstruction[] = [];
  if (!input.destinationExistsHot) {
    instructions.push(buildCreateLightAtaIdempotent(owner, destinationOwner, flatMint, destination));
  }
  instructions.push(buildLightTransferChecked(source, flatMint, destination, amount, mint.decimals, owner));
  return Object.freeze(instructions);
}

/**
 * Build the exact current Light-token Flat transfer plan. Classic SPL is used
 * only for the sleeve mint itself; holder custody and movement are Light ATAs.
 */
export function prepareFlatTransferOperation(
  input: PrepareFlatTransferOperationInput,
): FlatTransferOperationPlan {
  return rebuildFlatTransferOperation(input).plan;
}

/** Rebuild all bytes and bind every explicit caller field before signing. */
export function validateFlatTransferOperationPlan(
  plan: FlatTransferOperationPlan,
  expected: PrepareFlatTransferOperationInput,
): ValidatedFlatTransferOperation {
  const rebuilt = rebuildFlatTransferOperation(expected);
  if (canonicalJson(plan) !== canonicalJson(rebuilt.plan)) {
    throw flatError("FLAT_TRANSFER_PLAN_MISMATCH", "Flat transfer plan differs from exact Light-token reconstruction");
  }
  return rebuilt;
}

function rebuildFlatTransferOperation(
  input: PrepareFlatTransferOperationInput,
): ValidatedFlatTransferOperation {
  const currentObservation = validateCurrentFinalizedObservation(input.currentObservation);
  const owner = canonicalPubkey(input.semantic.owner, "owner");
  const sleeve = canonicalPubkey(input.semantic.sleeve, "sleeve");
  const destinationOwner = canonicalPubkey(input.semantic.destinationOwner, "destinationOwner");
  const amount = positiveU64(input.semantic.amountAtoms, "amountAtoms");
  const semantic = Object.freeze({
    owner: owner.toBase58(),
    sleeve: sleeve.toBase58(),
    destinationOwner: destinationOwner.toBase58(),
    amountAtoms: amount.toString(),
  });

  const [flatMint] = deriveWriterFlatMintPda(sleeve);
  const source = deriveLightAssociatedTokenAddress(flatMint, owner);
  const destination = deriveLightAssociatedTokenAddress(flatMint, destinationOwner);
  const mintData = canonicalBase64(input.observedBytes.mintDataBase64, "mintDataBase64");
  requireObservedBytes(currentObservation, flatMint, SPL_TOKEN_PROGRAM_ID, mintData, "Flat mint");
  const mint = decodeClassicMint(flatMint, mintData);
  const sourceObservation = requireObserved(currentObservation, source);
  if (input.coldSource !== undefined && input.coldDestination !== undefined) {
    throw flatError(
      "FLAT_TRANSFER_SEQUENTIAL_LOAD_REQUIRED",
      "source and destination loads require sequential fresh preparation; one static plan may bind only the final cold ATA",
    );
  }
  const sourceState = input.coldSource === undefined ? "hot" as const : "cold" as const;
  let sourceDataBase64: string | null;
  let sourceProofFacts: FlatTransferColdAccountProofFacts | null;
  let destinationProofFacts: FlatTransferColdAccountProofFacts | null = null;
  let setupInstructions: readonly (readonly TransactionInstruction[])[] = Object.freeze([]);
  if (input.coldSource === undefined) {
    if (input.observedBytes.sourceLightDataBase64 === null) {
      throw flatError("FLAT_TRANSFER_SOURCE_INVALID", "hot source Light ATA bytes are missing");
    }
    const sourceData = canonicalBase64(input.observedBytes.sourceLightDataBase64, "sourceLightDataBase64");
    requireObservedBytes(currentObservation, source, CURRENT_LIGHT_TOKEN_PROGRAM_ID, sourceData, "source Light ATA");
    const decodedSource = decodeHotLightAccount(source, sourceData);
    if (!decodedSource.mint.equals(flatMint) || !decodedSource.owner.equals(owner)
      || !canonicalTransferableLightState(decodedSource) || decodedSource.amount < amount) {
      throw flatError("FLAT_TRANSFER_SOURCE_INVALID", "source Light ATA does not hold transferable Flat for the owner");
    }
    sourceDataBase64 = Buffer.from(sourceData).toString("base64");
    sourceProofFacts = null;
  } else {
    if (input.observedBytes.sourceLightDataBase64 !== null || !accountAbsent(sourceObservation)) {
      throw flatError("FLAT_TRANSFER_SOURCE_INVALID", "cold source must be explicitly absent from finalized hot state");
    }
    sourceProofFacts = canonicalColdProof(
      input.coldSource.proofFacts, source, owner, flatMint, amount, owner, "coldSource",
    );
    setupInstructions = canonicalSetupBatches(input.coldSource.setupInstructionBatches, owner, source);
    sourceDataBase64 = null;
  }

  const destinationObservation = requireObserved(currentObservation, destination);
  const destinationExists = destinationObservation.owner !== null;
  const destinationState = destinationExists
    ? "hot" as const
    : input.coldDestination === undefined ? "absent" as const : "cold" as const;
  let destinationDataBase64: string | null = null;
  if (destinationExists) {
    if (input.coldDestination !== undefined) {
      throw flatError("FLAT_TRANSFER_DESTINATION_INVALID", "hot destination cannot carry a cold load proof");
    }
    if (input.observedBytes.destinationLightDataBase64 === null) {
      throw flatError("FLAT_TRANSFER_DESTINATION_INVALID", "destination Light ATA bytes are missing");
    }
    const destinationData = canonicalBase64(
      input.observedBytes.destinationLightDataBase64,
      "destinationLightDataBase64",
    );
    requireObservedBytes(
      currentObservation,
      destination,
      CURRENT_LIGHT_TOKEN_PROGRAM_ID,
      destinationData,
      "destination Light ATA",
    );
    const destinationState = decodeHotLightAccount(destination, destinationData);
    if (!destinationState.mint.equals(flatMint) || !destinationState.owner.equals(destinationOwner)
      || !canonicalTransferableLightState(destinationState)) {
      throw flatError("FLAT_TRANSFER_DESTINATION_INVALID", "destination Light ATA identity or state is invalid");
    }
    destinationDataBase64 = Buffer.from(destinationData).toString("base64");
  } else {
    if (!accountAbsent(destinationObservation) || input.observedBytes.destinationLightDataBase64 !== null) {
      throw flatError("FLAT_TRANSFER_DESTINATION_INVALID", "absent destination Light ATA is not represented canonically");
    }
    if (input.coldDestination !== undefined) {
      destinationProofFacts = canonicalColdProof(
        input.coldDestination.proofFacts,
        destination,
        destinationOwner,
        flatMint,
        0n,
        owner,
        "coldDestination",
      );
      setupInstructions = canonicalSetupBatches(
        input.coldDestination.setupInstructionBatches, owner, destination,
      );
    }
  }

  const instructions = [...buildCanonicalFlatTransferAction({
    semantic,
    mintDataBase64: Buffer.from(mintData).toString("base64"),
    destinationExistsHot: destinationExists || destinationState === "cold",
  })];
  requireObservedInstructionAccounts(currentObservation, [
    ...setupInstructions.flatMap((batch) => [...batch]),
    ...instructions,
  ]);
  const setupInstructionBatches = Object.freeze(setupInstructions.map((batch) =>
    Object.freeze(batch.map((instruction) => setupInstructionManifest(instruction))),
  ));
  const setupSignerRoles = Object.freeze(setupInstructions.map((batch, setupBatchIndex) => Object.freeze({
    pubkey: owner.toBase58(),
    role: "owner" as const,
    setupBatchIndex,
    instructionIndexes: Object.freeze(batch.flatMap((instruction, instructionIndex) =>
      instruction.keys.some((meta) => meta.isSigner && meta.pubkey.equals(owner)) ? [instructionIndex] : [],
    )),
  })));
  const manifests = Object.freeze(instructions.map((instruction) => instructionManifest(instruction)));
  const executionInstructions = setupInstructions.length === 0
    ? [Object.freeze([...instructions])]
    : setupInstructions.map((batch, index) => Object.freeze(index === setupInstructions.length - 1
      ? [...batch, ...instructions]
      : [...batch]));
  const executionInstructionBatches = setupInstructionBatches.length === 0
    ? Object.freeze([manifests])
    : Object.freeze(setupInstructionBatches.map((batch, index) => Object.freeze(
      index === setupInstructionBatches.length - 1 ? [...batch, ...manifests] : [...batch],
    )));
  const actionBatchIndex = executionInstructionBatches.length - 1;
  const writeSet = Object.freeze([...new Set([
    ...setupInstructions.flatMap((batch) => [...batch]),
    ...instructions,
  ].flatMap((instruction) =>
    instruction.keys.filter((meta) => meta.isWritable).map((meta) => meta.pubkey.toBase58()),
  ))].sort());
  const signerRoles = Object.freeze([Object.freeze({
    pubkey: owner.toBase58(),
    role: "owner" as const,
    instructionIndexes: Object.freeze(instructions.map((_, index) => index)),
  })]);
  const observedBytes = Object.freeze({
    mintDataBase64: Buffer.from(mintData).toString("base64"),
    sourceLightDataBase64: sourceDataBase64,
    destinationLightDataBase64: destinationDataBase64,
  });
  const operationId = digestCanonical({
    domain: "ameba:flat_transfer_operation_id:v1",
    operation: FLAT_TRANSFER_OPERATION,
    currentObservationDigest: currentObservation.currentObservationDigest,
    semantic, sourceState, destinationState, sourceProofFacts, destinationProofFacts,
    observedBytes, setupInstructionBatches, setupSignerRoles,
    instructions: manifests, executionInstructionBatches, actionBatchIndex,
    writeSet,
    signerRoles,
  });
  const withoutDigest = Object.freeze({
    schemaVersion: FLAT_TRANSFER_OPERATION_PLAN_SCHEMA_VERSION,
    operation: FLAT_TRANSFER_OPERATION,
    operationId,
    currentObservation,
    currentObservationDigest: currentObservation.currentObservationDigest,
    semantic, sourceState, destinationState, sourceProofFacts, destinationProofFacts,
    observedBytes, setupInstructionBatches, setupSignerRoles,
    instructions: manifests, executionInstructionBatches, actionBatchIndex,
    writeSet,
    signerRoles,
  });
  const plan = Object.freeze({
    ...withoutDigest,
    preparedPlanDigest: digestCanonical({ domain: "ameba:flat_transfer_prepared_plan:v1", plan: withoutDigest }),
  });
  return Object.freeze({
    plan,
    instructions: Object.freeze(instructions),
    executionInstructionBatches: Object.freeze(executionInstructions),
  });
}

function canonicalColdProof(
  proof: FlatTransferColdAccountProofFacts,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  minimumAmount: bigint,
  payer: PublicKey,
  path: string,
): FlatTransferColdAccountProofFacts {
  const amount = canonicalU64(proof.amountAtoms, `${path}.proofFacts.amountAtoms`);
  if (proof.ata !== ata.toBase58() || proof.owner !== owner.toBase58()
    || proof.mint !== mint.toBase58() || proof.payer !== payer.toBase58()
    || proof.includesColdBalance !== true || !/^[0-9a-f]{64}$/u.test(proof.providerOriginSha256)
    || amount < minimumAmount) {
    throw flatError("FLAT_TRANSFER_COLD_PROOF_INVALID", "cold source proof facts do not bind the payer, custody, or amount");
  }
  return Object.freeze({ ...proof, amountAtoms: amount.toString() });
}

function canonicalSetupBatches(
  batches: readonly (readonly TransactionInstruction[])[],
  payer: PublicKey,
  source: PublicKey,
): readonly (readonly TransactionInstruction[])[] {
  if (batches.length < 1 || batches.length > 8 || batches.some((batch) => batch.length < 1 || batch.length > 8)) {
    throw flatError("FLAT_TRANSFER_SETUP_INVALID", "cold Light setup must contain 1..8 nonempty bounded batches");
  }
  let sourceWritable = false;
  const result = batches.map((batch) => {
    let batchHasPayer = false;
    const canonical = Object.freeze(batch.map((instruction, instructionIndex) => {
      if (instruction.programId.equals(COMPUTE_BUDGET_PROGRAM)) {
        const bytes = Buffer.from(instruction.data);
        const units = bytes.length === 5 ? bytes.readUInt32LE(1) : 0;
        if (instructionIndex !== 0 || instruction.keys.length !== 0 || bytes[0] !== 2
          || units < 50_000 || units > 1_400_000) {
          throw flatError("FLAT_TRANSFER_SETUP_INVALID", "cold setup compute budget is not canonical");
        }
        return instruction;
      }
      if (instruction.data.length < 1 || instruction.data.length > 16_384
        || !instruction.programId.equals(CURRENT_LIGHT_TOKEN_PROGRAM_ID)) {
        throw flatError("FLAT_TRANSFER_SETUP_INVALID", "cold setup must contain only bounded native Light instructions");
      }
      if (instruction.keys.some((meta) => meta.isSigner && !meta.pubkey.equals(payer))) {
        throw flatError("FLAT_TRANSFER_SETUP_INVALID", "cold setup contains a signer other than the owner fee payer");
      }
      const payerMeta = instruction.keys.find((meta) =>
        meta.pubkey.equals(payer) && meta.isSigner && meta.isWritable);
      if (payerMeta === undefined) {
        throw flatError("FLAT_TRANSFER_SETUP_INVALID", "every cold setup instruction must bind the owner as writable fee payer");
      }
      batchHasPayer = true;
      sourceWritable ||= instruction.keys.some((meta) => meta.pubkey.equals(source) && meta.isWritable && !meta.isSigner);
      return instruction;
    }));
    if (!batchHasPayer) {
      throw flatError("FLAT_TRANSFER_SETUP_INVALID", "every cold setup batch must bind the owner as fee payer");
    }
    return canonical;
  });
  if (!sourceWritable) {
    throw flatError("FLAT_TRANSFER_SETUP_INVALID", "cold setup does not load the canonical source Light ATA");
  }
  return Object.freeze(result);
}

function setupInstructionManifest(instruction: TransactionInstruction): FlatTransferInstructionManifest {
  return Object.freeze({
    programId: instruction.programId.toBase58(),
    instructionName: "LightAccountLoad",
    dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({
      address: meta.pubkey.toBase58(), isSigner: meta.isSigner, isWritable: meta.isWritable,
    }))),
  });
}

function buildCreateLightAtaIdempotent(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  associatedToken: PublicKey,
): TransactionInstruction {
  const expected = deriveLightAssociatedTokenAddress(mint, owner);
  if (!associatedToken.equals(expected)) {
    throw flatError("FLAT_TRANSFER_DESTINATION_INVALID", "destination is not the canonical Light ATA");
  }
  return buildCurrentCreateLightAtaIdempotentInstruction({ payer, owner, mint });
}

function buildLightTransferChecked(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint,
  decimals: number,
  owner: PublicKey,
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = LIGHT_TRANSFER_CHECKED_DISCRIMINATOR;
  data.writeBigUInt64LE(amount, 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: SYSTEM_PLACEHOLDER, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
    ],
    data,
  });
}

function instructionManifest(instruction: TransactionInstruction): FlatTransferInstructionManifest {
  const discriminator = instruction.data[0];
  const instructionName = discriminator === CREATE_LIGHT_ATA_IDEMPOTENT_DISCRIMINATOR
    ? "CreateLightAssociatedTokenAccountIdempotent" as const
    : discriminator === LIGHT_TRANSFER_CHECKED_DISCRIMINATOR
      ? "LightTransferChecked" as const
      : (() => { throw flatError("FLAT_TRANSFER_INSTRUCTION_INVALID", "unexpected Light instruction discriminator"); })();
  return Object.freeze({
    programId: instruction.programId.toBase58(),
    instructionName,
    dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({
      address: meta.pubkey.toBase58(), isSigner: meta.isSigner, isWritable: meta.isWritable,
    }))),
  });
}

function decodeClassicMint(address: PublicKey, data: Buffer) {
  if (data.length !== CLASSIC_SPL_MINT_SIZE) {
    throw flatError("FLAT_TRANSFER_MINT_INVALID", "Flat mint does not have the exact classic SPL mint layout");
  }
  const mint = decodeClassicMintAccount(address, accountInfo(data, SPL_TOKEN_PROGRAM_ID));
  if (!mint.isInitialized) throw flatError("FLAT_TRANSFER_MINT_INVALID", "Flat mint is not initialized");
  return mint;
}

function decodeHotLightAccount(address: PublicKey, data: Buffer) {
  if (data.length !== CURRENT_LIGHT_TOKEN_ACCOUNT_SIZE || data[165] !== 2 || data[166] !== 1
    || data.readUInt32LE(167) !== 1 || data[171] !== 32) {
    throw flatError("FLAT_TRANSFER_LIGHT_LAYOUT_INVALID", "Light ATA does not have the exact current 272-byte layout");
  }
  return decodeClassicTokenAccount(address, accountInfo(data, CURRENT_LIGHT_TOKEN_PROGRAM_ID), CURRENT_LIGHT_TOKEN_PROGRAM_ID);
}

function canonicalTransferableLightState(
  account: ReturnType<typeof decodeClassicTokenAccount>,
): boolean {
  return account.isInitialized && !account.isFrozen && account.delegate === null
    && account.delegatedAmount === 0n && !account.isNative
    && account.rentExemptReserve === null && account.closeAuthority === null;
}

function accountInfo(data: Buffer, owner: PublicKey): AccountInfo<Buffer> {
  return { data, executable: false, lamports: 0, owner, rentEpoch: 0 };
}

function requireObservedInstructionAccounts(
  observation: CurrentFinalizedObservation,
  instructions: readonly TransactionInstruction[],
): void {
  for (const address of new Set(instructions.flatMap((instruction) => instruction.keys.map((meta) => meta.pubkey.toBase58())))) {
    requireObserved(observation, new PublicKey(address));
  }
}

function requireObserved(
  observation: CurrentFinalizedObservation,
  address: PublicKey,
): CurrentFinalizedObservedAccount {
  const account = observation.orderedAccounts.find((candidate) => candidate.address === address.toBase58());
  if (account === undefined) {
    throw flatError("FLAT_TRANSFER_OBSERVATION_INVALID", `finalized observation omits ${address.toBase58()}`);
  }
  return account;
}

function requireObservedBytes(
  observation: CurrentFinalizedObservation,
  address: PublicKey,
  owner: PublicKey,
  data: Buffer,
  label: string,
): void {
  const account = requireObserved(observation, address);
  if (account.owner !== owner.toBase58() || account.executable !== false
    || account.dataLength !== data.length.toString() || account.dataSha256 !== sha256(data)) {
    throw flatError("FLAT_TRANSFER_OBSERVATION_INVALID", `${label} bytes do not match the finalized observation`);
  }
}

function accountAbsent(account: CurrentFinalizedObservedAccount): boolean {
  return account.owner === null && account.executable === null
    && account.dataLength === null && account.dataSha256 === null;
}

function canonicalPubkey(value: string, label: string): PublicKey {
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) throw new Error("noncanonical");
    return key;
  } catch {
    throw flatError("FLAT_TRANSFER_SEMANTIC_INVALID", `${label} is not a canonical Solana public key`);
  }
}

function positiveU64(value: string, label: string): bigint {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw flatError("FLAT_TRANSFER_SEMANTIC_INVALID", `${label} is not a canonical positive u64`);
  }
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) {
    throw flatError("FLAT_TRANSFER_SEMANTIC_INVALID", `${label} exceeds u64`);
  }
  return parsed;
}

function canonicalU64(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw flatError("FLAT_TRANSFER_SEMANTIC_INVALID", `${label} is not a canonical u64`);
  }
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) {
    throw flatError("FLAT_TRANSFER_SEMANTIC_INVALID", `${label} exceeds u64`);
  }
  return parsed;
}

function canonicalBase64(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw flatError("FLAT_TRANSFER_BYTES_INVALID", `${label} is not canonical nonempty base64`);
  }
  return decoded;
}

function digestCanonical(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const object = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalValue(object[key])]));
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function flatError(code: string, message: string): AmebaProtocolError {
  return new AmebaProtocolError(message, { code });
}
