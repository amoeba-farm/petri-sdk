import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  CURRENT_VAULT_INSTRUCTION_TAG,
  type VaultInstructionTag,
} from "./current.js";
import { AmebaProtocolLayoutError } from "../errors.js";
import {
  DEFAULT_AMEBA_SPREAD_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
  deriveSettlementSignerRegistryPda,
  deriveSettlementSignerSetPda,
  deriveVaultConfigPda,
} from "@amoeba/spread-release-tools/oracle-dlmm";

function writable(pubkey: PublicKey, signer = false): AccountMeta {
  return { pubkey, isSigner: signer, isWritable: true };
}

function readonly(pubkey: PublicKey, signer = false): AccountMeta {
  return { pubkey, isSigner: signer, isWritable: false };
}

function u64(value: bigint, field: string): Buffer {
  if (value <= 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`${field} must be a positive u64`);
  }
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}

export interface InitUserCollateralAccounts {
  readonly user: PublicKey;
  readonly userCollateral: PublicKey;
}

/** Build current VaultInstruction::InitUserCollateral (tag 9). */
export function buildInitUserCollateralInstruction(input: {
  readonly accounts: InitUserCollateralAccounts;
  readonly programId?: PublicKey;
}): TransactionInstruction {
  return instruction(
    CURRENT_VAULT_INSTRUCTION_TAG.InitUserCollateral,
    [writable(input.accounts.user, true), writable(input.accounts.userCollateral), readonly(SystemProgram.programId)],
    Buffer.alloc(0),
    input.programId ?? new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID),
  );
}

export interface ProposeEmergencySettlementSignerRecoveryParams {
  readonly targetVersion: bigint;
  readonly threshold: number;
  readonly signers: readonly PublicKey[];
  readonly rotationDelaySlots: bigint;
  readonly activateAfterSlot: bigint;
}

export interface ProposeEmergencySettlementSignerRecoveryAccounts {
  readonly admin: PublicKey;
  readonly oracleAuthority: PublicKey;
  readonly recoveryAuthority: PublicKey;
  readonly vaultConfig: PublicKey;
  readonly signerRegistry: PublicKey;
  readonly currentSignerSet: PublicKey;
  readonly pendingSignerSet: PublicKey;
}

/** Build the canonical governed emergency signer recovery instruction (tag 94). */
export function buildProposeEmergencySettlementSignerRecoveryInstruction(input: {
  readonly accounts: ProposeEmergencySettlementSignerRecoveryAccounts;
  readonly params: ProposeEmergencySettlementSignerRecoveryParams;
  readonly programId?: PublicKey;
}): TransactionInstruction {
  const { accounts: a, params } = input;
  if (a.admin.equals(a.oracleAuthority) || a.admin.equals(a.recoveryAuthority) || a.oracleAuthority.equals(a.recoveryAuthority)) {
    throw new Error("tag 94 requires three distinct governing authorities");
  }
  if (!Number.isInteger(params.threshold) || params.threshold < 1 || params.signers.length < 1 || params.signers.length > 8 || params.threshold > params.signers.length || params.threshold * 2 <= params.signers.length) {
    throw new RangeError("tag 94 requires a bounded strict-majority signer set");
  }
  if (params.rotationDelaySlots < BigInt(MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS)) {
    throw new RangeError("tag 94 pending signer policy uses at least the production signer delay");
  }
  const signers = [...params.signers];
  if (signers.some((signer, index) => signer.equals(PublicKey.default) || (index > 0 && Buffer.compare(signers[index - 1]!.toBuffer(), signer.toBuffer()) >= 0))) {
    throw new Error("tag 94 signer identities must be nonzero, unique, and sorted");
  }
  const programId = input.programId ?? new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID);
  if (!a.vaultConfig.equals(deriveVaultConfigPda(programId)) || !a.signerRegistry.equals(deriveSettlementSignerRegistryPda(programId)) || !a.pendingSignerSet.equals(deriveSettlementSignerSetPda(params.targetVersion, programId))) {
    throw new Error("tag 94 accounts are not canonical current PDAs");
  }
  const payload = Buffer.concat([
    u64(params.targetVersion, "targetVersion"),
    Buffer.from([params.threshold, signers.length]),
    ...signers.map((signer) => signer.toBuffer()),
    ...Array.from({ length: 8 - signers.length }, () => PublicKey.default.toBuffer()),
    u64(params.rotationDelaySlots, "rotationDelaySlots"),
    u64(params.activateAfterSlot, "activateAfterSlot"),
  ]);
  if (payload.length !== 282) throw new Error("tag 94 payload length is not canonical");
  return instruction(
    CURRENT_VAULT_INSTRUCTION_TAG.ProposeEmergencySettlementSignerRecovery,
    [
      readonly(a.admin, true),
      readonly(a.oracleAuthority, true),
      readonly(a.recoveryAuthority, true),
      readonly(a.vaultConfig),
      writable(a.signerRegistry),
      readonly(a.currentSignerSet),
      writable(a.pendingSignerSet),
      readonly(SystemProgram.programId),
    ],
    payload,
    programId,
  );
}

function instruction(
  tag: VaultInstructionTag,
  keys: readonly AccountMeta[],
  payload: Uint8Array,
  programId: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: [...keys],
    data: Buffer.concat([Buffer.from([tag]), Buffer.from(payload)]),
  });
}

export interface WithdrawCollateralAccounts {
  readonly owner: PublicKey;
  readonly vaultTokenAccount: PublicKey;
  readonly destinationTokenAccount: PublicKey;
  readonly vaultConfig: PublicKey;
  readonly userCollateral: PublicKey;
  readonly collateralMint: PublicKey;
}

/** Build current VaultInstruction::WithdrawCollateral (tag 11). */
export function buildWithdrawCollateralInstruction(input: {
  readonly accounts: WithdrawCollateralAccounts;
  readonly amount: bigint;
  readonly programId?: PublicKey;
}): TransactionInstruction {
  const a = input.accounts;
  return instruction(
    CURRENT_VAULT_INSTRUCTION_TAG.WithdrawCollateral,
    [
      writable(a.owner, true),
      writable(a.vaultTokenAccount),
      writable(a.destinationTokenAccount),
      readonly(a.vaultConfig),
      writable(a.userCollateral),
      readonly(a.collateralMint),
      readonly(SPL_TOKEN_PROGRAM_ID),
    ],
    u64(input.amount, "amount"),
    input.programId ?? new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID),
  );
}

export interface CurrentDecodedInstruction {
  readonly tag: VaultInstructionTag;
  readonly payload: Buffer;
}

const CURRENT_MAX_INSTRUCTION_DATA_BYTES = 16_384;
const MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS = 16;
const MAX_ORACLE_SKU_MERKLE_PROOF_DEPTH = 8;
const ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES = 384;
const MAX_COMPRESSED_STATE_SESSION_RECORDS = 8;
const MAX_COMPRESSED_INNER_INSTRUCTION_BYTES = 12_288;

const MARKET_PAGE_STRING_LIMITS = Object.freeze([
  32, // item_id
  64, // name
  32, // symbol
  128, // title
  160, // subtitle
  160, // info_href
  160, // page_title
  280, // meta_description
] as const);
const MARKET_PAGE_MAX_EXPIRIES = 24;
const MARKET_PAGE_EXPIRY_ID_MAX_BYTES = 24;
const MARKET_PAGE_EXPIRY_LABEL_MAX_BYTES = 64;
const SETTLEMENT_ITEM_ID_MAX_BYTES = 32;
const SETTLEMENT_EXPIRY_ID_MAX_BYTES = 24;
const SETTLEMENT_SOURCE_URI_MAX_BYTES = 256;
const SETTLEMENT_MAX_OBSERVATIONS = 5;

const COMPRESSED_DOMAIN_DATA_LENGTH = Object.freeze({
  1: 44,
  2: 156,
  3: 112,
  4: 105,
  5: 81,
  6: 16,
  7: 17,
  8: 107,
  9: 205,
  10: 96,
} as const);

class CurrentPayloadCursor {
  private offset = 0;

  constructor(
    private readonly payload: Buffer,
    private readonly tag: number,
  ) {}

  fail(reason: string): never {
    throw new AmebaProtocolLayoutError(
      "VaultInstruction",
      `tag ${this.tag} payload ${reason}`,
    );
  }

  private require(length: number, field: string): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.payload.length) {
      this.fail(`is truncated while reading ${field}`);
    }
  }

  skip(length: number, field: string): void {
    this.require(length, field);
    this.offset += length;
  }

  u8(field: string): number {
    this.require(1, field);
    return this.payload[this.offset++]!;
  }

  u16(field: string): number {
    this.require(2, field);
    const value = this.payload.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(field: string): number {
    this.require(4, field);
    const value = this.payload.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  boolean(field: string): void {
    const value = this.u8(field);
    if (value !== 0 && value !== 1) this.fail(`has a noncanonical bool for ${field}`);
  }

  enumByte(field: string, allowed: readonly number[]): void {
    const value = this.u8(field);
    if (!allowed.includes(value)) this.fail(`has invalid ${field} discriminant ${value}`);
  }

  option(field: string, parseSome: () => void): void {
    const discriminant = this.u8(`${field} option discriminant`);
    if (discriminant === 0) return;
    if (discriminant !== 1) this.fail(`has invalid ${field} option discriminant ${discriminant}`);
    parseSome();
  }

  boundedCount(field: string, maximum: number): number {
    const count = this.u32(`${field} length`);
    if (count > maximum) this.fail(`${field} length ${count} exceeds ${maximum}`);
    return count;
  }

  boundedString(field: string, maximum: number): void {
    const length = this.boundedCount(field, maximum);
    this.require(length, field);
    const value = this.payload.subarray(this.offset, this.offset + length);
    this.offset += length;
    const decoded = value.toString("utf8");
    if (!Buffer.from(decoded, "utf8").equals(value)) this.fail(`${field} is not valid UTF-8`);
  }

  finish(): void {
    if (this.offset !== this.payload.length) {
      this.fail(`has ${this.payload.length - this.offset} trailing byte(s)`);
    }
  }
}

type CurrentPayloadParser = (cursor: CurrentPayloadCursor) => void;

const emptyPayload: CurrentPayloadParser = () => {};

function exactBytes(length: number, field = "fixed fields"): CurrentPayloadParser {
  return (cursor) => cursor.skip(length, field);
}

function optionalPubkey(cursor: CurrentPayloadCursor, field: string): void {
  cursor.option(field, () => cursor.skip(32, field));
}

function optionalU64(cursor: CurrentPayloadCursor, field: string): void {
  cursor.option(field, () => cursor.skip(8, field));
}

function parseUpdateConfig(cursor: CurrentPayloadCursor): void {
  optionalPubkey(cursor, "new_admin");
  optionalPubkey(cursor, "new_oracle_authority");
  optionalPubkey(cursor, "new_usdc_mint");
  optionalPubkey(cursor, "new_vault_token_account");
  cursor.option("paused", () => cursor.boolean("paused"));
}

function parseInitMarketV2(cursor: CurrentPayloadCursor): void {
  // market_id + instrument fields through max_payout_per_contract.
  cursor.skip(104, "market and instrument numeric fields");
  cursor.enumByte("option kind", [0, 1]);
  cursor.enumByte("settlement style", [0]);
  // MarketParameters (39 bytes) + collateral mint (32 bytes).
  cursor.skip(71, "market parameters and collateral mint");
}

function parseFixedTrailingBool(prefixLength: number, field: string): CurrentPayloadParser {
  return (cursor) => {
    cursor.skip(prefixLength, `${field} prefix`);
    cursor.boolean(field);
  };
}

function parseBoundedBytes32Vector(
  cursor: CurrentPayloadCursor,
  field: string,
  maximum: number,
): void {
  const count = cursor.boundedCount(field, maximum);
  cursor.skip(count * 32, field);
}

function parseConfigureOracleProductSkuManifest(cursor: CurrentPayloadCursor): void {
  cursor.skip(32 + 8 + 2, "manifest identity and cursor");
  parseBoundedBytes32Vector(cursor, "sku_id_chunk", MAX_ORACLE_PRODUCT_SKU_CHUNK_IDS);
}

function parseProposeOracleSourceV3(cursor: CurrentPayloadCursor): void {
  cursor.skip(5 * 32 + 8 + 2, "source identity, hashes, bond, and sku index");
  parseBoundedBytes32Vector(cursor, "sku_proof", MAX_ORACLE_SKU_MERKLE_PROOF_DEPTH);
}

function parseSupportOracleSourceV3(cursor: CurrentPayloadCursor): void {
  cursor.skip(8 + 2, "stake and sku index");
  parseBoundedBytes32Vector(cursor, "sku_proof", MAX_ORACLE_SKU_MERKLE_PROOF_DEPTH);
}

function parseSubmitOracleOpeningClaim(cursor: CurrentPayloadCursor): void {
  cursor.skip(3 * 8 + 2 * 32, "opening claim fixed fields");
  cursor.boundedString("archive_url", ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES);
}

function parseChallengeOracleOpeningClaim(cursor: CurrentPayloadCursor): void {
  cursor.skip(32 + 3 * 8 + 2 * 32, "opening challenge fixed fields");
  cursor.boundedString("archive_url", ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES);
}

function parseChallengeOracleUpdateClaimV2(cursor: CurrentPayloadCursor): void {
  cursor.skip(32 + 3 * 8 + 32, "update challenge fixed fields");
  cursor.boundedString("archive_url", ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES);
}

function parseRevealOracleUpdateClaimV3(cursor: CurrentPayloadCursor): void {
  cursor.skip(32 + 3 * 8 + 32, "update reveal fixed prefix");
  cursor.boundedString("archive_url", ORACLE_OPENING_ARCHIVE_URL_MAX_BYTES);
  cursor.skip(32, "update reveal secret salt");
}

function parseTryOpenOracleEmergencyDispute(cursor: CurrentPayloadCursor): void {
  cursor.enumByte("emergency dispute kind", [0, 1, 2]);
  cursor.skip(32, "target id");
  cursor.option("expected_case_hash", () => cursor.skip(32, "expected_case_hash"));
}

function parsePackedStateTreeInfo(cursor: CurrentPayloadCursor): void {
  cursor.skip(2, "state tree root index");
  cursor.boolean("state tree prove_by_index");
  cursor.skip(1 + 1 + 4, "state tree account indexes and leaf index");
}

function parseCompressedAccountMeta(cursor: CurrentPayloadCursor): void {
  parsePackedStateTreeInfo(cursor);
  cursor.skip(32 + 1, "compressed account address and output tree index");
}

function parseValidityProof(cursor: CurrentPayloadCursor): void {
  cursor.option("validity proof", () => cursor.skip(32 + 64 + 32, "validity proof points"));
}

function parseCompressionOutput(cursor: CurrentPayloadCursor): void {
  cursor.skip(1 + 1 + 2 + 1, "compression output");
}

function parseMarketPageExpiry(cursor: CurrentPayloadCursor): void {
  cursor.boundedString("expiry.id", MARKET_PAGE_EXPIRY_ID_MAX_BYTES);
  cursor.boundedString("expiry.label", MARKET_PAGE_EXPIRY_LABEL_MAX_BYTES);
  cursor.skip(8 + 2 + 2 + 2 + 8 + 8 + 8, "market page expiry numeric fields");
}

function parseCompressedMarketPageLeaf(cursor: CurrentPayloadCursor): void {
  cursor.skip(32, "market page underlying id");
  const fields = [
    "item_id",
    "name",
    "symbol",
    "title",
    "subtitle",
    "info_href",
    "page_title",
    "meta_description",
  ] as const;
  fields.forEach((field, index) => cursor.boundedString(field, MARKET_PAGE_STRING_LIMITS[index]!));
  cursor.skip(3, "market page display decimals");
  const expiryCount = cursor.boundedCount("expiries", MARKET_PAGE_MAX_EXPIRIES);
  for (let index = 0; index < expiryCount; index += 1) parseMarketPageExpiry(cursor);
  cursor.boolean("market page active");
}

function parseCompressedSettlementLeaf(cursor: CurrentPayloadCursor): void {
  cursor.skip(1 + 32 + 32 + 32, "settlement schema and identities");
  cursor.boundedString("settlement item_id", SETTLEMENT_ITEM_ID_MAX_BYTES);
  cursor.boundedString("settlement expiry_id", SETTLEMENT_EXPIRY_ID_MAX_BYTES);
  cursor.skip(8 + 1, "settlement timestamp and display decimals");
  cursor.enumByte("settlement computation", [1]);
  cursor.skip(1, "settlement trailing window days");
  const observationCount = cursor.boundedCount(
    "settlement observations",
    SETTLEMENT_MAX_OBSERVATIONS,
  );
  cursor.skip(observationCount * 16, "settlement observations");
  cursor.skip(8, "settlement price");
  cursor.boundedString("settlement source_uri", SETTLEMENT_SOURCE_URI_MAX_BYTES);
  cursor.skip(
    32 + 8 + 8 + 32 + 8 + 8 + 32,
    "settlement digest, oracle values, submitter, slot, and signer set",
  );
}

function parseUpsertMarketPageV2(cursor: CurrentPayloadCursor): void {
  parseCompressedMarketPageLeaf(cursor);
  parseValidityProof(cursor);
  cursor.option("new_page_output", () => parseCompressionOutput(cursor));
  cursor.option("existing_page", () => {
    parseCompressedAccountMeta(cursor);
    cursor.skip(32, "existing page commitment");
    parseCompressedMarketPageLeaf(cursor);
  });
}

function parseUpsertSettlementV3(cursor: CurrentPayloadCursor): void {
  parseCompressedSettlementLeaf(cursor);
  parseValidityProof(cursor);
  cursor.option("new_settlement_output", () => parseCompressionOutput(cursor));
  cursor.option("existing_settlement", () => {
    parseCompressedAccountMeta(cursor);
    cursor.skip(32, "existing settlement commitment");
    parseCompressedSettlementLeaf(cursor);
  });
}

function parseCompressedDomain(cursor: CurrentPayloadCursor, field: string): number {
  const domain = cursor.u8(field);
  if (!(domain in COMPRESSED_DOMAIN_DATA_LENGTH)) {
    cursor.fail(`has invalid ${field} discriminant ${domain}`);
  }
  return domain;
}

function parseCompactAccessLeaf(cursor: CurrentPayloadCursor): void {
  const domain = parseCompressedDomain(cursor, "compressed state domain");
  cursor.skip(8, "compressed state revision");
  cursor.skip(
    COMPRESSED_DOMAIN_DATA_LENGTH[domain as keyof typeof COMPRESSED_DOMAIN_DATA_LENGTH],
    "compressed state compact data",
  );
}

function parseCompressedStateAccess(cursor: CurrentPayloadCursor): void {
  const kind = cursor.u8("compressed state access kind");
  cursor.skip(1, "compressed state core account index");
  if (kind === 0) {
    parsePackedStateTreeInfo(cursor);
    parseCompactAccessLeaf(cursor);
    return;
  }
  if (kind === 1) {
    parsePackedStateTreeInfo(cursor);
    cursor.skip(1, "mutable output state tree index");
    parseCompactAccessLeaf(cursor);
    return;
  }
  if (kind === 2) {
    parseCompressedDomain(cursor, "compressed state initialization domain");
    parseCompressionOutput(cursor);
    return;
  }
  cursor.fail(`has invalid compressed state access kind ${kind}`);
}

function parseExecuteCompressedStateV1(cursor: CurrentPayloadCursor): void {
  cursor.skip(2, "compressed state core account count and rent payer index");
  parseValidityProof(cursor);
  const accessCount = cursor.u8("compressed state access count");
  if (accessCount > MAX_COMPRESSED_STATE_SESSION_RECORDS) {
    cursor.fail(
      `compressed state access count ${accessCount} exceeds ${MAX_COMPRESSED_STATE_SESSION_RECORDS}`,
    );
  }
  for (let index = 0; index < accessCount; index += 1) parseCompressedStateAccess(cursor);
  const innerLength = cursor.u16("compressed inner instruction length");
  if (innerLength > MAX_COMPRESSED_INNER_INSTRUCTION_BYTES) {
    cursor.fail(
      `compressed inner instruction length ${innerLength} exceeds ${MAX_COMPRESSED_INNER_INSTRUCTION_BYTES}`,
    );
  }
  cursor.skip(innerLength, "compressed inner instruction");
}

export interface CurrentPackedStateTreeInfo {
  readonly rootIndex: number;
  readonly proveByIndex: boolean;
  readonly treeAccountIndex: number;
  readonly queueAccountIndex: number;
  readonly leafIndex: number;
}

export interface CurrentCompressedValidityProof {
  readonly aBase64: string;
  readonly bBase64: string;
  readonly cBase64: string;
}

export type CurrentExecuteCompressedStateAccess =
  | {
      readonly kind: "readOnly";
      readonly accountIndex: number;
      readonly treeInfo: CurrentPackedStateTreeInfo;
      readonly domain: number;
      readonly revision: bigint;
      readonly compactDataBase64: string;
    }
  | {
      readonly kind: "mutable";
      readonly accountIndex: number;
      readonly treeInfo: CurrentPackedStateTreeInfo;
      readonly outputStateTreeIndex: number;
      readonly domain: number;
      readonly revision: bigint;
      readonly compactDataBase64: string;
    }
  | {
      readonly kind: "initialize";
      readonly accountIndex: number;
      readonly domain: number;
      readonly addressTreeAccountIndex: number;
      readonly addressQueueAccountIndex: number;
      readonly addressRootIndex: number;
      readonly outputStateTreeIndex: number;
    };

/** Exact decoded rc.44 `ExecuteCompressedStateV1` (outer tag 205) payload. */
export interface CurrentExecuteCompressedStateV1Payload {
  readonly tag: typeof CURRENT_VAULT_INSTRUCTION_TAG.ExecuteCompressedStateV1;
  readonly coreAccountCount: number;
  readonly rentPayerIndex: number;
  readonly proof: CurrentCompressedValidityProof | null;
  readonly accesses: readonly CurrentExecuteCompressedStateAccess[];
  readonly innerInstructionDataBase64: string;
  readonly logicalTag: VaultInstructionTag;
}

class CurrentCompressedEnvelopeCursor {
  private offset = 0;

  constructor(private readonly payload: Buffer) {}

  private fail(reason: string): never {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      `tag 205 payload ${reason}`,
    );
  }

  private require(length: number, field: string): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.payload.length) {
      this.fail(`is truncated while reading ${field}`);
    }
  }

  u8(field: string): number {
    this.require(1, field);
    return this.payload[this.offset++]!;
  }

  u16(field: string): number {
    this.require(2, field);
    const value = this.payload.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(field: string): number {
    this.require(4, field);
    const value = this.payload.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u64(field: string): bigint {
    this.require(8, field);
    const value = this.payload.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number, field: string): Buffer {
    this.require(length, field);
    const value = Buffer.from(this.payload.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  bool(field: string): boolean {
    const value = this.u8(field);
    if (value !== 0 && value !== 1) this.fail(`has a noncanonical bool for ${field}`);
    return value === 1;
  }

  finish(): void {
    if (this.offset !== this.payload.length) {
      this.fail(`has ${this.payload.length - this.offset} trailing byte(s)`);
    }
  }
}

function decodePackedStateTreeInfo(cursor: CurrentCompressedEnvelopeCursor): CurrentPackedStateTreeInfo {
  return Object.freeze({
    rootIndex: cursor.u16("state tree root index"),
    proveByIndex: cursor.bool("state tree prove_by_index"),
    treeAccountIndex: cursor.u8("state tree account index"),
    queueAccountIndex: cursor.u8("queue account index"),
    leafIndex: cursor.u32("state tree leaf index"),
  });
}

function decodeCompactAccessLeaf(cursor: CurrentCompressedEnvelopeCursor): {
  readonly domain: number;
  readonly revision: bigint;
  readonly compactDataBase64: string;
} {
  const domain = cursor.u8("compressed state domain");
  const compactLength = COMPRESSED_DOMAIN_DATA_LENGTH[
    domain as keyof typeof COMPRESSED_DOMAIN_DATA_LENGTH
  ];
  if (compactLength === undefined) {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      `tag 205 payload has invalid compressed state domain ${domain}`,
    );
  }
  return Object.freeze({
    domain,
    revision: cursor.u64("compressed state revision"),
    compactDataBase64: cursor.bytes(compactLength, "compressed state compact data").toString("base64"),
  });
}

/**
 * Decode and bound the actual outer tag-205 bytes. This never trusts projected metadata: it
 * validates the complete Borsh grammar, validates the nested current instruction, preserves the
 * encoded access order (including duplicate account indexes across distinct domains), and rejects
 * nested tag 205 or trailing bytes.
 */
export function decodeCurrentExecuteCompressedStateV1(
  data: Uint8Array,
): CurrentExecuteCompressedStateV1Payload {
  const decoded = decodeCurrentVaultInstruction(data);
  if (decoded.tag !== CURRENT_VAULT_INSTRUCTION_TAG.ExecuteCompressedStateV1) {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      `expected outer tag 205, received ${decoded.tag}`,
    );
  }
  const cursor = new CurrentCompressedEnvelopeCursor(decoded.payload);
  const coreAccountCount = cursor.u8("core account count");
  const rentPayerIndex = cursor.u8("rent payer index");
  const proofDiscriminant = cursor.u8("validity proof option discriminant");
  let proof: CurrentCompressedValidityProof | null;
  if (proofDiscriminant === 0) {
    proof = null;
  } else if (proofDiscriminant === 1) {
    proof = Object.freeze({
      aBase64: cursor.bytes(32, "validity proof A").toString("base64"),
      bBase64: cursor.bytes(64, "validity proof B").toString("base64"),
      cBase64: cursor.bytes(32, "validity proof C").toString("base64"),
    });
  } else {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      `tag 205 payload has invalid validity proof option discriminant ${proofDiscriminant}`,
    );
  }
  const accessCount = cursor.u8("compressed state access count");
  if (accessCount < 1 || accessCount > MAX_COMPRESSED_STATE_SESSION_RECORDS) {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      `tag 205 payload access count ${accessCount} is outside 1..${MAX_COMPRESSED_STATE_SESSION_RECORDS}`,
    );
  }
  const accesses: CurrentExecuteCompressedStateAccess[] = [];
  for (let index = 0; index < accessCount; index += 1) {
    const kind = cursor.u8(`access ${index} kind`);
    const accountIndex = cursor.u8(`access ${index} account index`);
    if (kind === 0) {
      const treeInfo = decodePackedStateTreeInfo(cursor);
      const leaf = decodeCompactAccessLeaf(cursor);
      accesses.push(Object.freeze({ kind: "readOnly", accountIndex, treeInfo, ...leaf }));
    } else if (kind === 1) {
      const treeInfo = decodePackedStateTreeInfo(cursor);
      const outputStateTreeIndex = cursor.u8(`access ${index} output state tree index`);
      const leaf = decodeCompactAccessLeaf(cursor);
      accesses.push(Object.freeze({ kind: "mutable", accountIndex, treeInfo, outputStateTreeIndex, ...leaf }));
    } else if (kind === 2) {
      const domain = cursor.u8(`access ${index} initialization domain`);
      if (COMPRESSED_DOMAIN_DATA_LENGTH[domain as keyof typeof COMPRESSED_DOMAIN_DATA_LENGTH] === undefined) {
        throw new AmebaProtocolLayoutError(
          "ExecuteCompressedStateV1",
          `tag 205 payload has invalid initialization domain ${domain}`,
        );
      }
      accesses.push(Object.freeze({
        kind: "initialize",
        accountIndex,
        domain,
        addressTreeAccountIndex: cursor.u8(`access ${index} address tree account index`),
        addressQueueAccountIndex: cursor.u8(`access ${index} address queue account index`),
        addressRootIndex: cursor.u16(`access ${index} address root index`),
        outputStateTreeIndex: cursor.u8(`access ${index} output state tree index`),
      }));
    } else {
      throw new AmebaProtocolLayoutError(
        "ExecuteCompressedStateV1",
        `tag 205 payload has invalid access kind ${kind}`,
      );
    }
  }
  const innerLength = cursor.u16("compressed inner instruction length");
  if (innerLength === 0 || innerLength > MAX_COMPRESSED_INNER_INSTRUCTION_BYTES) {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      `tag 205 payload inner length ${innerLength} is outside 1..${MAX_COMPRESSED_INNER_INSTRUCTION_BYTES}`,
    );
  }
  const inner = cursor.bytes(innerLength, "compressed inner instruction");
  cursor.finish();
  const logical = decodeCurrentVaultInstruction(inner);
  if (logical.tag === CURRENT_VAULT_INSTRUCTION_TAG.ExecuteCompressedStateV1) {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      "nested ExecuteCompressedStateV1 is forbidden",
    );
  }
  if (rentPayerIndex >= coreAccountCount) {
    throw new AmebaProtocolLayoutError(
      "ExecuteCompressedStateV1",
      "rent payer index is outside the core account prefix",
    );
  }
  for (const access of accesses) {
    if (access.accountIndex >= coreAccountCount) {
      throw new AmebaProtocolLayoutError(
        "ExecuteCompressedStateV1",
        "compressed access account index is outside the core account prefix",
      );
    }
  }
  for (let index = 1; index < accesses.length; index += 1) {
    const previous = accesses[index - 1]!;
    const current = accesses[index]!;
    if (
      current.accountIndex < previous.accountIndex
      || (
        current.accountIndex === previous.accountIndex
        && !(previous.domain === 9 && current.domain === 10)
      )
    ) {
      throw new AmebaProtocolLayoutError(
        "ExecuteCompressedStateV1",
        "compressed accesses are not in canonical account-index/domain order",
      );
    }
  }
  return Object.freeze({
    tag: CURRENT_VAULT_INSTRUCTION_TAG.ExecuteCompressedStateV1,
    coreAccountCount,
    rentPayerIndex,
    proof,
    accesses: Object.freeze(accesses),
    innerInstructionDataBase64: inner.toString("base64"),
    logicalTag: logical.tag,
  });
}

const TAG = CURRENT_VAULT_INSTRUCTION_TAG;

// This table mirrors instruction/tags.rs plus processor/instruction_dispatch.rs and
// processor/instruction_payloads.rs at 1b2230d96e51f6582155d8284900fbfc11ff1f18.
// `satisfies Record<...>` deliberately makes a newly added current tag a compile error until its
// exact payload grammar is added here.
const CURRENT_VAULT_PAYLOAD_PARSERS = Object.freeze({
  // Source grammar only; this does not add tag 159 to any admitted release inventory.
  [TAG.ManageWriterDlmmV1]: (cursor) => {
    const selector = cursor.u8("writer DLMM action");
    if (selector === 0) cursor.skip(90, "writer DLMM policy commitment");
    else if (selector === 1) {
      cursor.skip(1, "policy start index");
      const count = cursor.boundedCount("policy series", 8);
      if (count === 0) cursor.fail("policy append must contain entries");
      cursor.skip(count * 32, "policy series entries");
    } else if (selector === 3 || selector === 6) cursor.skip(1, "writer series index");
    else if (selector === 4 || selector === 5) {
      cursor.skip(selector === 4 ? 9 : 1, "writer series and issuance");
      const count = cursor.boundedCount("writer bins", 8);
      if (count === 0) cursor.fail("writer action must contain entries");
      cursor.skip(count * 18, "writer bin entries");
    } else if (selector !== 2) cursor.fail("writer DLMM selector is invalid");
  },
  [TAG.Initialize]: emptyPayload,
  [TAG.UpdateConfig]: parseUpdateConfig,
  [TAG.DepositUsdc]: exactBytes(8),
  [TAG.InitUserCollateral]: emptyPayload,
  [TAG.DepositCollateral]: exactBytes(8),
  [TAG.WithdrawCollateral]: exactBytes(8),
  [TAG.CloseOracleMonth]: emptyPayload,
  [TAG.ConfigureOracleMajorToken]: emptyPayload,
  [TAG.DepositOracleMajorTokens]: exactBytes(8),
  [TAG.WithdrawOracleMajorTokens]: exactBytes(8),
  [TAG.FinalizeOracleMonth]: emptyPayload,
  [TAG.FinalizeOracleOpeningPhase]: emptyPayload,
  [TAG.ExpireOracleOpeningSource]: emptyPayload,
  [TAG.AccumulateOracleRecipeBucketV2]: parseFixedTrailingBool(
    34,
    "finalize_collection",
  ),
  [TAG.FinalizeOracleRecipeWeightsV2]: emptyPayload,
  [TAG.InitMarketV2]: parseInitMarketV2,
  [TAG.CreateMarketContractMintV3]: emptyPayload,
  [TAG.SetMarketPaused]: (cursor) => cursor.boolean("paused"),
  [TAG.InitializeSettlementSignerRegistry]: exactBytes(306),
  [TAG.ProposeSettlementSignerRotation]: exactBytes(282),
  [TAG.ActivateSettlementSignerRotation]: emptyPayload,
  [TAG.CancelSettlementSignerRotation]: emptyPayload,
  [TAG.ProposeEmergencySettlementSignerRecovery]: exactBytes(282),
  [TAG.UpsertMarketPageV2]: parseUpsertMarketPageV2,
  [TAG.RotateVaultAuthoritiesV2]: exactBytes(64),
  [TAG.ConfigureOracleEconomicsTemplateV2]: exactBytes(26),
  [TAG.AccumulateOracleSettlementSourceBucket]: parseFixedTrailingBool(
    32,
    "finalize_collection",
  ),
  [TAG.UpsertSettlementV3]: parseUpsertSettlementV3,
  [TAG.BeginOracleActiveWeights]: exactBytes(4),
  [TAG.AccumulateOracleActiveWeightGroup]: parseFixedTrailingBool(
    32,
    "finalize_collection",
  ),
  [TAG.FinalizeOracleActiveWeights]: emptyPayload,
  [TAG.BootstrapVaultGovernanceV2]: exactBytes(32),
  [TAG.ActivateVaultV2]: (cursor) => optionalPubkey(cursor, "expected_collateral_freeze_authority"),
  [TAG.RequestUnstakeSamba]: exactBytes(16),
  [TAG.CompleteUnstakeSamba]: emptyPayload,
  [TAG.InitializeOracleSambaPool]: emptyPayload,
  [TAG.InitializeOracleRewardFunnel]: emptyPayload,
  [TAG.SweepOracleRewardFunnel]: emptyPayload,
  [TAG.QueueStakeAmbaForSamba]: exactBytes(8),
  [TAG.ActivateQueuedStakeAmbaForSamba]: exactBytes(8),
  [TAG.AdminAssistedWithdrawCollateral]: exactBytes(8),
  [TAG.CancelQueuedStakeAmba]: emptyPayload,
  [TAG.InitializeOracleUsdcRewardVault]: emptyPayload,
  [TAG.DepositOracleUsdcRewards]: exactBytes(8),
  [TAG.BeginOracleUsdcRewardSchedule]: emptyPayload,
  [TAG.AddOracleUsdcSkuBudget]: exactBytes(108),
  [TAG.FinalizeOracleUsdcRewardSchedule]: emptyPayload,
  [TAG.ChallengeOracleSourceV2]: exactBytes(105),
  [TAG.SubmitOracleOpeningClaimV2]: parseSubmitOracleOpeningClaim,
  [TAG.ChallengeOracleOpeningClaimV2]: parseChallengeOracleOpeningClaim,
  [TAG.ResolveOracleOpeningClaimChallengeV2]: (cursor) =>
    cursor.enumByte("opening challenge outcome", [0, 1, 2, 3, 4]),
  [TAG.FinalizeOracleOpeningClaimV2]: emptyPayload,
  [TAG.CommitOracleUpdateClaimV3]: exactBytes(72),
  [TAG.SettleExpiredOracleUpdateCommitmentV3]: emptyPayload,
  [TAG.ChallengeOracleUpdateClaimV2]: parseChallengeOracleUpdateClaimV2,
  [TAG.SettleOracleUsdcEscrow]: (cursor) =>
    cursor.enumByte("oracle escrow kind", [0, 1, 2, 3, 4, 5, 6]),
  [TAG.RegisterOracleUsdcRewardSource]: emptyPayload,
  [TAG.RegisterOracleUsdcRewardUpdate]: emptyPayload,
  [TAG.FinalizeOracleUsdcRewardEntitlements]: emptyPayload,
  [TAG.ClaimOracleUsdcReward]: (cursor) =>
    cursor.enumByte("oracle USDC reward kind", [0, 1, 2, 3]),
  [TAG.TryOpenOracleEmergencyDisputeV2]: parseTryOpenOracleEmergencyDispute,
  [TAG.CommitOracleEmergencyVoteV3]: exactBytes(40),
  [TAG.RevealOracleEmergencyVoteV2]: exactBytes(33),
  [TAG.ResolveOracleEmergencyDisputeV2]: emptyPayload,
  [TAG.RegisterOracleSambaWinningVote]: emptyPayload,
  [TAG.SettleOracleSambaEmergencyVoteV2]: emptyPayload,
  [TAG.InitializeOracleMonthV5]: exactBytes(58),
  [TAG.ProposeOracleSourceV3]: parseProposeOracleSourceV3,
  [TAG.SupportOracleSourceV3]: parseSupportOracleSourceV3,
  [TAG.FinalizeOracleSkuCoverage]: emptyPayload,
  [TAG.ResolveOracleSourceChallengeV2]: (cursor) =>
    cursor.enumByte("source challenge outcome", [0, 1, 2, 3]),
  [TAG.ReopenOracleSkuCoverage]: emptyPayload,
  [TAG.BeginOracleRecipeWeightsV3]: exactBytes(4),
  [TAG.ConfigureOracleProductSkuManifest]: parseConfigureOracleProductSkuManifest,
  [TAG.ExpireUnlistableOracleSourceV2]: emptyPayload,
  [TAG.CancelStaleOracleSourceChallengeV2]: emptyPayload,
  [TAG.ResolveOracleEmergencyDisputeV4]: emptyPayload,
  [TAG.SettleFailedOracleMonthEscrowV2]: (cursor) =>
    cursor.enumByte("oracle escrow kind", [0, 1, 2, 3, 4, 5, 6]),
  [TAG.AbortOracleUsdcRewardScheduleV2]: emptyPayload,
  [TAG.TimeoutUnsupportedOracleSourceV2]: emptyPayload,
  [TAG.RecomputeOracleBucketMedianV1]: exactBytes(33),
  [TAG.RevealOracleUpdateClaimV3]: parseRevealOracleUpdateClaimV3,
  [TAG.FinalizeOracleUpdateClaimV2]: (cursor) => {
    cursor.enumByte("update claim outcome", [0, 1, 2]);
    cursor.skip(8, "current step");
  },
  // Known grammar is not release admission; the governed path checks the pinned native inventory.
  // The six hashes are fixed 32-byte fields followed by one little-endian u16 weight.
  [TAG.IndexOracleRecipeSourceV1]: (cursor) => {
    for (const field of ["previous hash", "bucket id", "source id", "source type hash", "canonical locator hash", "source definition hash"]) {
      let nonzero = false;
      for (let index = 0; index < 32; index += 1) nonzero = cursor.u8(field) !== 0 || nonzero;
      if (!nonzero) cursor.fail(`${field} must be nonzero`);
    }
    const weight = cursor.u16("bucket weight bps");
    if (weight < 1 || weight > 10_000) cursor.fail("bucket weight must be within 1..10000 bps");
  },
  // Deployed tag 30 uses an explicitly bounded u8 proof count, not a Borsh Vec.
  [TAG.OracleCarryForwardV1]: (cursor) => {
    const action = cursor.u8("oracle carry action");
    if (action > 7) cursor.fail("invalid oracle carry action");
    if (action === 2) {
      cursor.enumByte("checkpoint kind", [0, 1, 2]);
      cursor.skip(32, "previous checkpoint hash");
    } else if (action === 3) {
      cursor.u16("SKU index");
      const count = cursor.u8("SKU proof count");
      if (count > 8) cursor.fail("SKU proof exceeds eight nodes");
      cursor.skip(count * 32, "SKU proof");
    }
  },
  [TAG.CancelStaleOracleUpdateClaimV2]: emptyPayload,
  [TAG.AbortStaleOracleUpdateEmergencyDisputeV2]: emptyPayload,
  [TAG.ExecuteCompressedStateV1]: parseExecuteCompressedStateV1,
  [TAG.InitializeWriterPolicyRegistryV1]: exactBytes(40),
  [TAG.ManageWriterPolicyAuthorityV1]: (cursor) => {
    cursor.enumByte("writer policy authority action", [0, 1, 2]);
    cursor.skip(32, "writer policy authority");
  },
  [TAG.InitializeWriterSettlementGroupV1]: emptyPayload,
  [TAG.InitializeWriterSleeveV1]: emptyPayload,
  [TAG.RegisterWriterSeriesV1]: emptyPayload,
  [TAG.SealWriterPolicyV1]: exactBytes(266),
  [TAG.OpenWriterFundingV1]: emptyPayload,
  [TAG.DepositWriterPrincipalV1]: exactBytes(8),
  [TAG.WithdrawWriterPrincipalV1]: exactBytes(8),
  [TAG.ActivateWriterSleeveV1]: emptyPayload,
  [TAG.SetCollectiveMarketPausedV1]: (cursor) => cursor.boolean("paused"),
  [TAG.ReconcileWriterSupplyV1]: exactBytes(2),
  [TAG.CleanupWriterCustodyV1]: exactBytes(1),
  [TAG.CommitWriterAuctionV1]: exactBytes(64),
  [TAG.PrepareWriterBidIndexV1]: (cursor) => {
    cursor.skip(8, "auction nonce");
    cursor.enumByte("writer bid-index phase", [0, 1]);
  },
  [TAG.PlaceWriterBidV1]: exactBytes(26),
  [TAG.CancelOrRefundWriterBidV1]: emptyPayload,
  [TAG.RevealWriterAuctionV1]: exactBytes(544),
  [TAG.PlanWriterAuctionChunkV1]: exactBytes(2),
  [TAG.ExecuteWriterAuctionFillV1]: emptyPayload,
  [TAG.FinalizeOrAbortWriterAuctionV1]: (cursor) => cursor.boolean("abort"),
  [TAG.BeginWriterCloseV1]: exactBytes(24),
  [TAG.DepositWriterCloseBasketV1]: exactBytes(1),
  [TAG.FinalizeWriterCloseV1]: emptyPayload,
  [TAG.ProcessWriterCloseCancellationV1]: exactBytes(1),
  [TAG.PublishWriterGroupSettlementV1]: emptyPayload,
  [TAG.FinalizeWriterSleeveSettlementV1]: emptyPayload,
  [TAG.ClaimCollectiveLongV1]: exactBytes(8),
  [TAG.ClaimWriterFlatResidualV1]: exactBytes(8),
  [TAG.CloseWriterSleeveV1]: emptyPayload,
  [TAG.ScopedCollectiveSettlementV1]: (cursor) => cursor.enumByte("scoped settlement action", [0, 1, 2]),
  [TAG.ScopedPositionSettlementV1]: (cursor) => cursor.enumByte("scoped settlement action", [0, 1, 2]),
} satisfies Record<VaultInstructionTag, CurrentPayloadParser>);

/**
 * Fail-closed decoder for the exact current rc.44 VaultInstruction ABI.
 *
 * This validates the complete payload grammar (including canonical Borsh option/bool/enum bytes,
 * bounded vectors/strings, compression envelopes, exact fixed lengths, and no trailing bytes).
 */
export function decodeCurrentVaultInstruction(data: Uint8Array): CurrentDecodedInstruction {
  if (data.byteLength === 0) {
    throw new AmebaProtocolLayoutError("VaultInstruction", "instruction data is empty");
  }
  if (data.byteLength > CURRENT_MAX_INSTRUCTION_DATA_BYTES) {
    throw new AmebaProtocolLayoutError(
      "VaultInstruction",
      `instruction data length ${data.byteLength} exceeds ${CURRENT_MAX_INSTRUCTION_DATA_BYTES}`,
    );
  }
  const bytes = Buffer.from(data);
  const tag = bytes[0]!;
  const parser = CURRENT_VAULT_PAYLOAD_PARSERS[tag as VaultInstructionTag];
  if (
    parser === undefined ||
    !(Object.values(CURRENT_VAULT_INSTRUCTION_TAG) as readonly number[]).includes(tag)
  ) {
    throw new AmebaProtocolLayoutError("VaultInstruction", `tag ${String(tag)} is not current`);
  }
  const payload = Buffer.from(bytes.subarray(1));
  const cursor = new CurrentPayloadCursor(payload, tag);
  parser(cursor);
  cursor.finish();
  return { tag: tag as VaultInstructionTag, payload };
}
