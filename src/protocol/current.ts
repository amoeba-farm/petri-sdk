import { Buffer } from "buffer";
import {
  PublicKey,
  type Commitment,
  type Connection,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  unpackAccount,
  unpackMint,
} from "./current-token-primitives.js";
import {
  CURRENT_STATE_NAMESPACE_SEED,
  DEFAULT_AMEBA_SPREAD_PROGRAM_ID,
  LIGHT_TOKEN_CPI_AUTHORITY,
  MARKET_PDA_SEED,
  MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS,
  ORACLE_MONTH_PDA_SEED,
  SETTLEMENT_SIGNER_REGISTRY_PDA_SEED,
  SETTLEMENT_SIGNER_SET_PDA_SEED,
  SETTLEMENT_V2_PDA_SEED,
  SPL_TOKEN_PROGRAM_ID,
  USER_COLLATERAL_PDA_SEED,
  VAULT_PDA_SEED,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  deriveMarketPda,
  deriveContractMintPda,
  deriveLightSplInterfacePda,
  deriveOracleMonthPda,
  deriveOracleSkuCoverageManifestPda,
  deriveSettlementRecordV2Pda,
  deriveSettlementSignerRegistryPda,
  deriveSettlementSignerSetPda,
  deriveUserCollateralPda,
  deriveVaultConfigPda,
  hashBuffers,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import { CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL } from "./identity.js";
import { deriveOracleActiveWeightManifestPda } from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  AmebaAccountNamespaceMismatchError,
  AmebaMintOwnerMismatchError,
  AmebaProgramIdMismatchError,
  AmebaProtocolDeploymentError,
  AmebaProtocolIdentityError,
  AmebaProtocolLayoutError,
} from "../errors.js";

/** Historical RC44 reader-semantic source. It is not the live byte source. */
export const CURRENT_PROTOCOL_SOURCE_COMMIT =
  "1b2230d96e51f6582155d8284900fbfc11ff1f18" as const;
export const CURRENT_PROTOCOL_RELEASE = "v0.1.0-rc.44" as const;
export const CURRENT_PROTOCOL_CLUSTER = "devnet" as const;
export const CURRENT_PROTOCOL_DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as const;
export const CURRENT_PROTOCOL_SCHEMA_VERSION = 2 as const;
export const CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS =
  "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3" as const;
export const CURRENT_PROTOCOL_PROGRAMDATA_BYTES = 1_241_821 as const;
export const CURRENT_PROTOCOL_UPGRADE_AUTHORITY =
  "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq" as const;
export const CURRENT_PROTOCOL_DEPLOYED_SLOT = 487_702_729 as const;
export const CURRENT_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT = 487_703_026 as const;
export const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES = 1_142_664 as const;
export const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256 =
  "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b" as const;
export const CURRENT_PROTOCOL_BUILD_RECEIPT_SHA256 =
  "3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322" as const;
export const CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE =
  "24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65" as const;
export const CURRENT_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256 =
  "c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31" as const;
export const CURRENT_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256 =
  "8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94" as const;

export const CURRENT_MARKET_ACCOUNT_SIZE = 285 as const;
export const CURRENT_ORACLE_MONTH_ACCOUNT_SIZE = 299 as const;
export const CURRENT_VAULT_CONFIG_ACCOUNT_SIZE = 135 as const;
export const CURRENT_USER_COLLATERAL_ACCOUNT_SIZE = 58 as const;
export const CURRENT_SETTLEMENT_RECORD_V2_ACCOUNT_SIZE = 160 as const;
export const CURRENT_SETTLEMENT_SIGNER_REGISTRY_ACCOUNT_SIZE = 128 as const;
export const CURRENT_SETTLEMENT_SIGNER_SET_ACCOUNT_SIZE = 416 as const;
export const CURRENT_ORACLE_SKU_COVERAGE_MANIFEST_ACCOUNT_SIZE = 128 as const;
export const CURRENT_ORACLE_ACTIVE_WEIGHT_MANIFEST_ACCOUNT_SIZE = 337 as const;
/** rc.44 production schedule: seven scramble days plus one opening day. */
export const CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS = 8n * 86_400n;

const CURRENT_PROGRAM_ID = new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID);

function assertCanonicalCurrentProgramId(programId: PublicKey): void {
  if (!programId.equals(CURRENT_PROGRAM_ID)) {
    throw new AmebaProgramIdMismatchError("program id is not the pinned rc.44 deployment", {
      details: { programId: programId.toBase58(), expected: DEFAULT_AMEBA_SPREAD_PROGRAM_ID },
    });
  }
}

export interface CurrentProgramAccountInput {
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly owner: PublicKey;
  readonly executable: boolean;
  readonly namespace: "ameba-spread-v2";
  readonly programId: PublicKey;
}

function assertCurrentProgramAccount(label: string, input: CurrentProgramAccountInput): void {
  assertCanonicalCurrentProgramId(input.programId);
  if (input.namespace !== CURRENT_STATE_NAMESPACE_SEED.toString("ascii")) {
    throw new AmebaAccountNamespaceMismatchError(`${label} namespace is not current`, {
      details: { namespace: input.namespace },
    });
  }
  if (!input.owner.equals(input.programId)) {
    throw new AmebaProgramIdMismatchError(`${label} owner is not the current program`, {
      details: {
        owner: input.owner.toBase58(),
        expected: input.programId.toBase58(),
      },
    });
  }
  if (input.executable) {
    throw new AmebaProtocolLayoutError(label, "an executable account is not state");
  }
}

/**
 * Historical RC44 identity retained for decoder and fixture compatibility.
 * Current live bytes are exposed separately as CURRENT_LIVE_DEPLOYMENT.
 * @deprecated Prefer HISTORICAL_RC44_PROTOCOL_DEPLOYMENT for explicit legacy
 * semantics or CURRENT_LIVE_DEPLOYMENT for finalized live byte identity.
 */
export const CURRENT_PROTOCOL_DEPLOYMENT = Object.freeze({
  schemaVersion: CURRENT_PROTOCOL_SCHEMA_VERSION,
  sourceCommit: CURRENT_PROTOCOL_SOURCE_COMMIT,
  release: CURRENT_PROTOCOL_RELEASE,
  cluster: CURRENT_PROTOCOL_CLUSTER,
  /** Historical receipt metadata only; runtime reads use Amoeba `/rpc`. */
  rpcUrl: CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL,
  genesisHash: CURRENT_PROTOCOL_DEVNET_GENESIS_HASH,
  programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH",
  programDataAddress: CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS,
  programDataBytes: CURRENT_PROTOCOL_PROGRAMDATA_BYTES,
  upgradeAuthority: CURRENT_PROTOCOL_UPGRADE_AUTHORITY,
  deployedSlot: CURRENT_PROTOCOL_DEPLOYED_SLOT,
  finalizedVerificationContextSlot: CURRENT_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT,
  programPayloadBytes: CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES,
  programPayloadSha256: CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256,
  buildReceiptSha256: CURRENT_PROTOCOL_BUILD_RECEIPT_SHA256,
  deploymentReceiptSignature: CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE,
  formalReceiptInternalSha256: CURRENT_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256,
  formalReceiptFileSha256: CURRENT_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256,
  namespace: CURRENT_STATE_NAMESPACE_SEED.toString("ascii"),
  liquidityEngine: "in_program_ameba_dlmm",
  contractMintModel: "classic_spl_with_light_interface",
  stateTransport: "light_hot_compressed_cold",
} as const);

export const HISTORICAL_RC44_PROTOCOL_SOURCE_COMMIT = CURRENT_PROTOCOL_SOURCE_COMMIT;
export const HISTORICAL_RC44_PROTOCOL_RELEASE = CURRENT_PROTOCOL_RELEASE;
export const HISTORICAL_RC44_PROTOCOL_CLUSTER = CURRENT_PROTOCOL_CLUSTER;
export const HISTORICAL_RC44_PROTOCOL_DEVNET_GENESIS_HASH = CURRENT_PROTOCOL_DEVNET_GENESIS_HASH;
export const HISTORICAL_RC44_PROTOCOL_SCHEMA_VERSION = CURRENT_PROTOCOL_SCHEMA_VERSION;
export const HISTORICAL_RC44_PROTOCOL_PROGRAMDATA_ADDRESS = CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS;
export const HISTORICAL_RC44_PROTOCOL_PROGRAMDATA_BYTES = CURRENT_PROTOCOL_PROGRAMDATA_BYTES;
export const HISTORICAL_RC44_PROTOCOL_UPGRADE_AUTHORITY = CURRENT_PROTOCOL_UPGRADE_AUTHORITY;
export const HISTORICAL_RC44_PROTOCOL_DEPLOYED_SLOT = CURRENT_PROTOCOL_DEPLOYED_SLOT;
export const HISTORICAL_RC44_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT =
  CURRENT_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT;
export const HISTORICAL_RC44_PROTOCOL_PROGRAM_PAYLOAD_BYTES =
  CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES;
export const HISTORICAL_RC44_PROTOCOL_PROGRAM_PAYLOAD_SHA256 =
  CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256;
export const HISTORICAL_RC44_PROTOCOL_BUILD_RECEIPT_SHA256 =
  CURRENT_PROTOCOL_BUILD_RECEIPT_SHA256;
export const HISTORICAL_RC44_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE =
  CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE;
export const HISTORICAL_RC44_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256 =
  CURRENT_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256;
export const HISTORICAL_RC44_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256 =
  CURRENT_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256;
export const HISTORICAL_RC44_PROTOCOL_DEPLOYMENT = CURRENT_PROTOCOL_DEPLOYMENT;

/** Current Rust dispatch tags, including the governed tag-94 emergency signer recovery lane. */
export { CURRENT_VAULT_INSTRUCTION_TAG, CURRENT_AMOEBA_DLMM_INSTRUCTION_TAG,
  type VaultInstructionTag, type AmoebaDlmmInstructionTag } from "./current-instruction-tags.js";

export interface CurrentMarketMintAccounting {
  readonly discriminator: "MNT";
  readonly version: 1;
  readonly decimals: 6;
  readonly totalIssued: bigint;
  readonly totalConsumed: bigint;
  readonly totalBurned: bigint;
}

export interface CurrentContractMintAccount {
  readonly address: PublicKey;
  readonly market: PublicKey;
  readonly mintAuthority: PublicKey;
  readonly supply: bigint;
  readonly decimals: 6;
  readonly isInitialized: true;
  readonly freezeAuthority: null;
}

export interface CurrentLightSplInterfaceAccount {
  readonly address: PublicKey;
  readonly mint: PublicKey;
  readonly tokenAuthority: PublicKey;
  readonly amount: bigint;
  readonly isInitialized: true;
}

export interface CurrentOwnedAccountContext {
  readonly accountOwner: PublicKey;
  readonly executable?: boolean;
}

/** Parsed identity carried by the full padded on-chain Market.market_id. */
export interface CurrentMarketSeriesIdentity {
  readonly fullSeriesId: string;
  readonly product: "ramx" | "nandx";
  readonly maturity: string;
  readonly side: "CALL" | "PUT";
  readonly ordinal: 1;
}

export interface CurrentMarketAccount {
  readonly stateNamespace: "ameba-spread-v2";
  readonly bump: number;
  readonly createdBy: PublicKey;
  readonly marketId: Buffer;
  readonly seriesIdentity: CurrentMarketSeriesIdentity;
  readonly collateralMint: PublicKey;
  readonly longContractMint: PublicKey | null;
  readonly underlyingId: Buffer;
  readonly expiryTs: bigint;
  readonly strikePrice: bigint;
  readonly capPrice: bigint;
  readonly contractSize: bigint;
  readonly maxPayoutPerContract: bigint;
  readonly optionKind: "CallSpread" | "PutSpread";
  readonly settlementStyle: "CashSettledMonthly";
  readonly tickSize: bigint;
  /** Exact quote-grid display precision derived from the current atomic tick. */
  readonly priceDisplayDecimals: 2;
  /** Exact classic-SPL quote mint precision carried by current mint accounting. */
  readonly quoteDisplayDecimals: 6;
  readonly lotSize: bigint;
  readonly minOrderQty: bigint;
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly cancelFeeBps: number;
  readonly minCancelSlots: bigint;
  readonly maxFillsPerInstruction: number;
  readonly totalPositionCollateralLocked: bigint;
  readonly paused: boolean;
  readonly mintAccounting: CurrentMarketMintAccounting;
}

export interface CurrentOracleMonthAccount {
  readonly bump: number;
  readonly market: PublicKey;
  readonly authority: PublicKey;
  readonly scrambleStartTs: bigint;
  readonly listingTs: bigint;
  readonly phase: "Uninitialized" | "Scramble" | "Game" | "Settled" | "Closed" | "Opening" | "SourceSubmission";
  readonly sourceCount: number;
  readonly frozenSourceCount: number;
  readonly openedSourceCount: number;
  readonly recipeHash: Buffer;
  readonly indexDeltaBps: bigint;
  readonly cRawBps: number;
  readonly gCamoBps: number;
  readonly gThinBps: number;
  readonly cSettleBps: number;
  readonly settlementStatus: "Final" | "Provisional" | "FrozenPendingEvidence";
  readonly settlementRecord: PublicKey | null;
  readonly emergencySupermajorityBps: number;
  readonly emergencyCommitWindowSlots: bigint;
  readonly emergencyRevealWindowSlots: bigint;
  readonly lastUpdatedSlot: bigint;
  readonly settlementBaseOracleAtomic: bigint;
  readonly pendingResolutionCount: number;
  readonly finalizedAtTs: bigint;
  readonly openingResolvedSourceCount: number;
  readonly weightSchemeVersion: number;
  readonly effectiveWeightTotalBps: number;
  readonly weightManifestHash: Buffer;
  readonly candidateCountTrackingVersion: number;
  readonly activeWeightInitializationVersion: number;
  readonly activeWeightSchemeVersion: number;
  readonly activeWeightGroupCount: number;
  readonly activeWeightManifestHash: Buffer;
  readonly scheduleVersion: number;
  readonly workRewardCurrencyVersion: number;
  readonly acceptedCashUpdateCount: number;
}

export interface CurrentOracleSkuCoverageManifestAccount {
  readonly stateNamespace: "ameba-spread-v2";
  readonly bump: number;
  readonly month: PublicKey;
  readonly requiredSkuRoot: Buffer;
  readonly requiredSkuCount: number;
  readonly coveredSkuCount: number;
  readonly plannedScrambleStartTs: bigint;
  readonly plannedListingTs: bigint;
  readonly coverageFinalized: boolean;
  readonly coverageCompleteTs: bigint;
  readonly lastUpdatedSlot: bigint;
}

export interface CurrentOracleActiveWeightManifestAccount {
  readonly stateNamespace: "ameba-spread-v2";
  readonly bump: number;
  readonly month: PublicKey;
  readonly recipeHash: Buffer;
  readonly frozenManifestHash: Buffer;
  readonly phase: "Collecting" | "Applying" | "ReadyToFinalize" | "Finalized";
  readonly expectedSourceCount: number;
  readonly expectedGroupCount: number;
  readonly processedSourceCount: number;
  readonly processedGroupCount: number;
  readonly activeSourceCount: number;
  readonly appliedEffectiveWeightTotalBps: number;
  readonly rollingManifestHash: Buffer;
  readonly recomputedIndexDeltaBps: bigint;
}

export interface CurrentVaultConfigAccount {
  readonly bump: number;
  readonly admin: PublicKey;
  readonly oracleAuthority: PublicKey;
  readonly usdcMint: PublicKey;
  readonly vaultTokenAccount: PublicKey;
  readonly paused: boolean;
}

export interface CurrentUserCollateralAccount {
  readonly bump: number;
  readonly owner: PublicKey;
  readonly availableBalance: bigint;
  readonly lockedBalance: bigint;
  readonly lastActionSlot: bigint;
}

export interface CurrentSettlementRecordV2Account {
  readonly bump: number;
  readonly version: 4;
  readonly market: PublicKey;
  readonly oracleMonth: PublicKey;
  readonly settlementTs: bigint;
  readonly settlementPriceAtomic: bigint;
  readonly signedLeafCommitment: Buffer;
  readonly submittedBy: PublicKey;
  readonly signerSetVersion: bigint;
}

export interface CurrentSettlementSignerRegistryAccount {
  readonly bump: number;
  readonly currentSet: PublicKey;
  readonly currentVersion: bigint;
  readonly pendingSet: PublicKey;
  readonly pendingVersion: bigint;
  readonly recoveryAuthority: PublicKey;
  readonly proposalNonce: bigint;
}

export interface CurrentSettlementSignerSetAccount {
  readonly bump: number;
  readonly registry: PublicKey;
  readonly version: bigint;
  readonly threshold: number;
  readonly signerCount: number;
  readonly signers: readonly PublicKey[];
  readonly setHash: Buffer;
  readonly rotationDelaySlots: bigint;
  readonly proposedSlot: bigint;
  readonly activateAfterSlot: bigint;
  readonly emergency: boolean;
  readonly proposer: PublicKey;
}

class Reader {
  readonly data: Buffer;
  offset = 0;

  constructor(data: Uint8Array, readonly label: string) {
    this.data = Buffer.from(data);
  }

  u8(field: string): number {
    this.require(1, field);
    return this.data[this.offset++]!;
  }

  bool(field: string): boolean {
    const value = this.u8(field);
    if (value !== 0 && value !== 1) throw new Error(`${field} is not a canonical bool`);
    return value === 1;
  }

  u16(field: string): number {
    this.require(2, field);
    const value = this.data.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32(field: string): number {
    this.require(4, field);
    const value = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u64(field: string): bigint {
    this.require(8, field);
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  i64(field: string): bigint {
    this.require(8, field);
    const value = this.data.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number, field: string): Buffer {
    this.require(length, field);
    const value = Buffer.from(this.data.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  pubkey(field: string): PublicKey {
    return new PublicKey(this.bytes(32, field));
  }

  exactLength(length: number): void {
    if (this.data.length !== length || this.offset !== length) {
      throw new Error(`expected exactly ${length} bytes`);
    }
  }

  /** Fixed codecs permit only zero-filled tail bytes after variable-width options. */
  exactLengthWithZeroPadding(length: number): void {
    if (
      this.data.length !== length ||
      this.offset > length ||
      this.data.subarray(this.offset).some((byte) => byte !== 0)
    ) {
      throw new Error(`expected exactly ${length} bytes with canonical zero padding`);
    }
    this.offset = length;
  }

  private require(length: number, field: string): void {
    if (this.offset + length > this.data.length) throw new Error(`account ended before ${field}`);
  }
}

function header(reader: Reader, discriminator?: string, expectedVersion = 1): number {
  if (!reader.bool("is_initialized")) throw new Error("account is not initialized");
  const bump = reader.u8("bump");
  if (discriminator !== undefined) {
    if (!reader.bytes(3, "discriminator").equals(Buffer.from(discriminator, "ascii"))) {
      throw new Error("account discriminator is not current");
    }
    if (reader.u8("account_version") !== expectedVersion) throw new Error("account version is not current");
  }
  return bump;
}

function uninitializedHeader(reader: Reader): void {
  if (reader.bool("is_initialized")) throw new Error("account is already initialized");
  reader.u8("bump");
  reader.bytes(3, "discriminator");
  reader.u8("account_version");
}

function enumValue<T extends string>(value: number, values: readonly T[], field: string): T {
  const result = values[value];
  if (result === undefined) throw new Error(`${field} has an unknown enum value`);
  return result;
}

function decodeLayout<T>(label: string, data: Uint8Array, decode: () => T): T {
  try {
    return decode();
  } catch (error) {
    if (error instanceof AmebaProtocolLayoutError) throw error;
    throw new AmebaProtocolLayoutError(label, error instanceof Error ? error.message : String(error), {
      details: { byteLength: data.byteLength },
      cause: error,
    });
  }
}

function assertPda(
  label: string,
  address: PublicKey,
  expected: PublicKey,
  bump: number,
  expectedBump: number,
): void {
  if (!address.equals(expected) || bump !== expectedBump) {
    throw new AmebaProtocolIdentityError(`${label} address is not the canonical current PDA`, {
      details: {
        address: address.toBase58(),
        expected: expected.toBase58(),
        bump,
        expectedBump,
      },
    });
  }
}

function expectedPda(programId: PublicKey, seeds: readonly Uint8Array[]): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.from(seed)), programId);
}

function u64Seed(value: number | bigint, field: string): Buffer {
  const integer = typeof value === "bigint" ? value : BigInt(value);
  if (integer < 0n || integer > 0xffff_ffff_ffff_ffffn) throw new RangeError(`${field} must fit u64`);
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(integer);
  return output;
}

const CURRENT_PRODUCT_POLICY = Object.freeze({
  RAMX: Object.freeze({ product: "ramx" as const, underlyingId: "ram-standardized-baskets" }),
  NANDX: Object.freeze({ product: "nandx" as const, underlyingId: "nand-standardized-baskets" }),
});

function decodeCurrentMarketSeriesIdentity(
  marketId: Buffer,
  underlyingId: Buffer,
  expiryTs: bigint,
  optionKind: CurrentMarketAccount["optionKind"],
  strikePrice: bigint,
  capPrice: bigint,
  contractSize: bigint,
  maxPayoutPerContract: bigint,
): CurrentMarketSeriesIdentity {
  const firstZero = marketId.indexOf(0);
  const end = firstZero < 0 ? marketId.length : firstZero;
  if (end === 0 || marketId.subarray(end).some((byte) => byte !== 0)) {
    throw new Error("market_id is not a nonempty right-zero-padded bytes32 label");
  }
  const fullSeriesId = marketId.subarray(0, end).toString("ascii");
  if (!Buffer.from(fullSeriesId, "ascii").equals(marketId.subarray(0, end))) {
    throw new Error("market_id is not canonical ASCII");
  }
  const match = /^(RAMX|NANDX)-([0-9]{4})(0[1-9]|1[0-2])-(CALL|PUT)-(0[1-9]|[1-9][0-9])$/.exec(fullSeriesId);
  if (match === null) throw new Error("market_id does not use the current PRODUCT-YYYYMM-SIDE-NN grammar");
  const [productLabel, yearText, monthText, side, ordinalText] = match.slice(1) as ["RAMX" | "NANDX", string, string, "CALL" | "PUT", string];
  const policy = CURRENT_PRODUCT_POLICY[productLabel];
  const expectedUnderlying = Buffer.alloc(32);
  Buffer.from(policy.underlyingId, "ascii").copy(expectedUnderlying);
  const ordinal = Number(ordinalText);
  const year = Number(yearText);
  const month = Number(monthText);
  // Maturity labels name the live month; settlement is the first UTC boundary after it.
  const expectedExpiry = BigInt(Date.UTC(year, month, 1, 0, 0, 0, 0) / 1_000);
  const expectedKind = side === "CALL" ? "CallSpread" : "PutSpread";
  const expectedCap = side === "CALL" ? 112_000_000n : 88_000_000n;
  if (
    ordinal !== 1
    || !underlyingId.equals(expectedUnderlying)
    || expiryTs !== expectedExpiry
    || optionKind !== expectedKind
    || strikePrice !== 100_000_000n
    || capPrice !== expectedCap
    || contractSize !== 1_000_000n
    || maxPayoutPerContract !== 12_000_000n
  ) {
    throw new Error("Market identity does not match current product, maturity, side, ordinal, or geometry");
  }
  return Object.freeze({
    fullSeriesId,
    product: policy.product,
    maturity: `${yearText}-${monthText}`,
    side,
    ordinal: 1 as const,
  });
}

export interface DecodeCurrentMarketAccountInput extends CurrentProgramAccountInput {
  readonly marketLayout?: "historical-v2" | "g3";
}

export function decodeCurrentMarketAccount(input: DecodeCurrentMarketAccountInput): CurrentMarketAccount {
  const { address, data, programId } = input;
  const generation3 = input.marketLayout === "g3";
  if (generation3 ? data.length !== 279 : data.length < CURRENT_MARKET_ACCOUNT_SIZE) throw new Error("Market layout does not match selected profile");
  assertCurrentProgramAccount("Market", input);
  return decodeLayout("Market", data, () => {
    const reader = new Reader(data, "Market");
    const bump = header(reader);
    const createdBy = reader.pubkey("created_by");
    const marketId = reader.bytes(32, "market_id");
    const collateralMint = reader.pubkey("collateral_mint");
    const longContractMint = reader.bool("long_contract_mint_present")
      ? reader.pubkey("long_contract_mint")
      : null;
    const underlyingId = reader.bytes(32, "underlying_id");
    const expiryTs = reader.u64("expiry_ts");
    const strikePrice = reader.u64("strike_price");
    const capPrice = reader.u64("cap_price");
    const contractSize = reader.u64("contract_size");
    const maxPayoutPerContract = reader.u64("max_payout_per_contract");
    const optionKind = enumValue(reader.u8("option_kind"), ["CallSpread", "PutSpread"] as const, "option_kind");
    const settlementStyle = enumValue(reader.u8("settlement_style"), ["CashSettledMonthly"] as const, "settlement_style");
    const tickSize = reader.u64("tick_size");
    const lotSize = reader.u64("lot_size");
    const minOrderQty = reader.u64("min_order_qty");
    const makerFeeBps = generation3 ? 0 : reader.u16("maker_fee_bps");
    const takerFeeBps = generation3 ? 0 : reader.u16("taker_fee_bps");
    const cancelFeeBps = generation3 ? 0 : reader.u16("cancel_fee_bps");
    const minCancelSlots = reader.u64("min_cancel_slots");
    const maxFillsPerInstruction = reader.u8("max_fills_per_instruction");
    const totalPositionCollateralLocked = reader.u64("total_position_collateral_locked");
    const paused = reader.bool("paused");
    if (!reader.bytes(3, "mint_accounting_discriminator").equals(Buffer.from("MNT", "ascii"))) {
      throw new Error("mint accounting discriminator is not current");
    }
    if (reader.u8("mint_accounting_version") !== 1 || reader.u8("mint_accounting_decimals") !== 6) {
      throw new Error("mint accounting version or decimals are not current");
    }
    if (!reader.bytes(3, "mint_accounting_reserved").equals(Buffer.alloc(3))) {
      throw new Error("mint accounting reserved bytes are not zero");
    }
    const mintAccounting = {
      discriminator: "MNT" as const,
      version: 1 as const,
      decimals: 6 as const,
      totalIssued: reader.u64("total_issued"),
      totalConsumed: reader.u64("total_consumed"),
      totalBurned: reader.u64("total_burned"),
    };
    reader.exactLengthWithZeroPadding(generation3 ? 279 : CURRENT_MARKET_ACCOUNT_SIZE);
    const seriesIdentity = decodeCurrentMarketSeriesIdentity(
      marketId,
      underlyingId,
      expiryTs,
      optionKind,
      strikePrice,
      capPrice,
      contractSize,
      maxPayoutPerContract,
    );
    if (createdBy.equals(PublicKey.default)) throw new Error("created_by is zero");
    if (
      mintAccounting.totalBurned > mintAccounting.totalConsumed ||
      mintAccounting.totalConsumed > mintAccounting.totalIssued
    ) {
      throw new Error("mint accounting totals are not canonical");
    }
    const spreadWidth = optionKind === "CallSpread"
      ? capPrice - strikePrice
      : strikePrice - capPrice;
    const expectedMaximumPayout = spreadWidth * contractSize / 1_000_000n;
    const maximumBinId = maxPayoutPerContract / 50_000n;
    if (
      expiryTs === 0n
      || contractSize === 0n
      || maxPayoutPerContract === 0n
      || (optionKind === "CallSpread" ? capPrice <= strikePrice : capPrice >= strikePrice)
      || expectedMaximumPayout === 0n
      || expectedMaximumPayout !== maxPayoutPerContract
      || tickSize !== 50_000n
      || maxPayoutPerContract % tickSize !== 0n
      || maximumBinId < 1n
      || maximumBinId > 2_048n
      || lotSize !== 1n
      || minOrderQty !== 1n
      || makerFeeBps > 10_000
      || takerFeeBps !== (generation3 ? 0 : 20)
      || cancelFeeBps > 10_000
      || maxFillsPerInstruction !== 8
    ) {
      throw new Error("Market instrument or economic parameters are not current");
    }
    let normalizedTick = tickSize;
    let trailingAtomicZeroes = 0;
    while (trailingAtomicZeroes < mintAccounting.decimals && normalizedTick % 10n === 0n) {
      normalizedTick /= 10n;
      trailingAtomicZeroes += 1;
    }
    const derivedPriceDisplayDecimals = mintAccounting.decimals - trailingAtomicZeroes;
    if (derivedPriceDisplayDecimals !== 2) {
      throw new Error("Market quote grid does not produce the current display precision");
    }
    const priceDisplayDecimals: 2 = derivedPriceDisplayDecimals;
    const quoteDisplayDecimals: 6 = mintAccounting.decimals;
    const [, expectedBump] = expectedPda(programId, [CURRENT_STATE_NAMESPACE_SEED, MARKET_PDA_SEED, marketId]);
    assertPda("Market", address, deriveMarketPda(marketId, programId), bump, expectedBump);
    return {
      stateNamespace: "ameba-spread-v2",
      bump,
      createdBy,
      marketId,
      seriesIdentity,
      collateralMint,
      longContractMint,
      underlyingId,
      expiryTs,
      strikePrice,
      capPrice,
      contractSize,
      maxPayoutPerContract,
      optionKind,
      settlementStyle,
      tickSize,
      priceDisplayDecimals,
      quoteDisplayDecimals,
      lotSize,
      minOrderQty,
      makerFeeBps,
      takerFeeBps,
      cancelFeeBps,
      minCancelSlots,
      maxFillsPerInstruction,
      totalPositionCollateralLocked,
      paused,
      mintAccounting,
    };
  });
}

export interface DecodeCurrentOracleMonthAccountInput extends CurrentProgramAccountInput {
  readonly expiryTs: number | bigint;
  /** Selects the exact deployed account generation; omission preserves the historical reader. */
  readonly marketLayout?: "historical-v2" | "g3";
}

/** Internal initialization preflight: exact fixed-codec shape with is_initialized=false. */
export function validateUninitializedCurrentOracleMonthData(data: Uint8Array): void {
  decodeLayout("UninitializedOracleMonth", data, () => {
    const reader = new Reader(data, "UninitializedOracleMonth");
    uninitializedHeader(reader);
    reader.pubkey("market");
    reader.pubkey("authority");
    reader.u64("scramble_start_ts");
    reader.u64("listing_ts");
    enumValue(reader.u8("phase"), ["Uninitialized", "Scramble", "Game", "Settled", "Closed", "Opening", "SourceSubmission"] as const, "phase");
    reader.u16("source_count");
    reader.u16("frozen_source_count");
    reader.u16("opened_source_count");
    reader.bytes(32, "recipe_hash");
    reader.i64("index_delta_bps");
    reader.u16("c_raw_bps");
    reader.u16("g_camo_bps");
    reader.u16("g_thin_bps");
    reader.u16("c_settle_bps");
    enumValue(reader.u8("settlement_status"), ["Final", "Provisional", "FrozenPendingEvidence"] as const, "settlement_status");
    if (reader.bool("settlement_record_present")) reader.pubkey("settlement_record");
    reader.u16("emergency_supermajority_bps");
    reader.u64("emergency_commit_window_slots");
    reader.u64("emergency_reveal_window_slots");
    reader.u64("last_updated_slot");
    reader.u64("settlement_base_oracle_atomic");
    reader.u16("pending_resolution_count");
    reader.u64("finalized_at_ts");
    reader.u16("opening_resolved_source_count");
    reader.u8("weight_scheme_version");
    reader.u16("effective_weight_total_bps");
    reader.bytes(32, "weight_manifest_hash");
    reader.u8("candidate_count_tracking_version");
    reader.u8("active_weight_initialization_version");
    reader.u8("active_weight_scheme_version");
    reader.u16("active_weight_group_count");
    reader.bytes(32, "active_weight_manifest_hash");
    reader.u8("schedule_version");
    reader.u8("work_reward_currency_version");
    reader.u32("accepted_cash_update_count");
    reader.exactLengthWithZeroPadding(CURRENT_ORACLE_MONTH_ACCOUNT_SIZE);
  });
}

export function decodeCurrentOracleMonthAccount(
  input: DecodeCurrentOracleMonthAccountInput,
): CurrentOracleMonthAccount {
  const { address, data, expiryTs, programId } = input;
  const generation3 = input.marketLayout === "g3";
  assertCurrentProgramAccount("OracleMonth", input);
  return decodeLayout("OracleMonth", data, () => {
    const reader = new Reader(data, "OracleMonth");
    const bump = header(reader, "OMS", generation3 ? 2 : 1);
    const market = reader.pubkey("market");
    const authority = reader.pubkey("authority");
    const scrambleStartTs = reader.u64("scramble_start_ts");
    const listingTs = reader.u64("listing_ts");
    const phase = enumValue(reader.u8("phase"), ["Uninitialized", "Scramble", "Game", "Settled", "Closed", "Opening", "SourceSubmission"] as const, "phase");
    const sourceCount = reader.u16("source_count");
    const frozenSourceCount = reader.u16("frozen_source_count");
    const openedSourceCount = reader.u16("opened_source_count");
    const recipeHash = reader.bytes(32, "recipe_hash");
    const indexDeltaBps = reader.i64("index_delta_bps");
    const cRawBps = reader.u16("c_raw_bps");
    const gCamoBps = reader.u16("g_camo_bps");
    const gThinBps = reader.u16("g_thin_bps");
    const cSettleBps = reader.u16("c_settle_bps");
    const settlementStatus = enumValue(reader.u8("settlement_status"), ["Final", "Provisional", "FrozenPendingEvidence"] as const, "settlement_status");
    const settlementRecord = reader.bool("settlement_record_present") ? reader.pubkey("settlement_record") : null;
    const emergencySupermajorityBps = reader.u16("emergency_supermajority_bps");
    const emergencyCommitWindowSlots = reader.u64("emergency_commit_window_slots");
    const emergencyRevealWindowSlots = reader.u64("emergency_reveal_window_slots");
    const lastUpdatedSlot = reader.u64("last_updated_slot");
    const settlementBaseOracleAtomic = reader.u64("settlement_base_oracle_atomic");
    const pendingResolutionCount = reader.u16("pending_resolution_count");
    const finalizedAtTs = reader.u64("finalized_at_ts");
    const openingResolvedSourceCount = reader.u16("opening_resolved_source_count");
    const weightSchemeVersion = reader.u8("weight_scheme_version");
    const effectiveWeightTotalBps = reader.u16("effective_weight_total_bps");
    const weightManifestHash = reader.bytes(32, "weight_manifest_hash");
    const candidateCountTrackingVersion = reader.u8("candidate_count_tracking_version");
    const activeWeightInitializationVersion = reader.u8("active_weight_initialization_version");
    const activeWeightSchemeVersion = reader.u8("active_weight_scheme_version");
    const activeWeightGroupCount = reader.u16("active_weight_group_count");
    const activeWeightManifestHash = reader.bytes(32, "active_weight_manifest_hash");
    const scheduleVersion = reader.u8("schedule_version");
    const workRewardCurrencyVersion = reader.u8("work_reward_currency_version");
    const acceptedCashUpdateCount = reader.u32("accepted_cash_update_count");
    reader.exactLengthWithZeroPadding(CURRENT_ORACLE_MONTH_ACCOUNT_SIZE);
    if (authority.equals(PublicKey.default)) throw new Error("authority is zero");
    const generationMarkersInvalid = generation3
      ? (
        ![0, 1, 255].includes(weightSchemeVersion)
        || effectiveWeightTotalBps > 10_000
        || ![0, 2, 255].includes(activeWeightSchemeVersion)
        || ![2, 3, 4].includes(scheduleVersion)
        || workRewardCurrencyVersion !== 1
        || candidateCountTrackingVersion !== 1
        || activeWeightInitializationVersion !== 1
        || (scheduleVersion === 4 && (
          BigInt(expiryTs) !== 1_790_812_800n
          || !["Game", "Settled", "Closed"].includes(phase)
          || scrambleStartTs === 0n
          || listingTs !== scrambleStartTs
        ))
      )
      : (
        scheduleVersion !== 2
        || workRewardCurrencyVersion !== 1
        || candidateCountTrackingVersion !== 1
        || activeWeightInitializationVersion !== 1
      );
    if (generationMarkersInvalid) {
      throw new Error("OracleMonth current generation markers are invalid");
    }
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      ORACLE_MONTH_PDA_SEED,
      market.toBuffer(),
      u64Seed(expiryTs, "expiryTs"),
    ]);
    assertPda(
      "OracleMonth",
      address,
      deriveOracleMonthPda({ marketPda: market, expiryTs, programId }),
      bump,
      expectedBump,
    );
    return {
      bump,
      market,
      authority,
      scrambleStartTs,
      listingTs,
      phase,
      sourceCount,
      frozenSourceCount,
      openedSourceCount,
      recipeHash,
      indexDeltaBps,
      cRawBps,
      gCamoBps,
      gThinBps,
      cSettleBps,
      settlementStatus,
      settlementRecord,
      emergencySupermajorityBps,
      emergencyCommitWindowSlots,
      emergencyRevealWindowSlots,
      lastUpdatedSlot,
      settlementBaseOracleAtomic,
      pendingResolutionCount,
      finalizedAtTs,
      openingResolvedSourceCount,
      weightSchemeVersion,
      effectiveWeightTotalBps,
      weightManifestHash,
      candidateCountTrackingVersion,
      activeWeightInitializationVersion,
      activeWeightSchemeVersion,
      activeWeightGroupCount,
      activeWeightManifestHash,
      scheduleVersion,
      workRewardCurrencyVersion,
      acceptedCashUpdateCount,
    };
  });
}

export interface DecodeCurrentOracleSkuCoverageManifestAccountInput extends CurrentProgramAccountInput {
  readonly month: PublicKey;
}

/** Internal initialization preflight: exact fixed-codec shape with is_initialized=false. */
export function validateUninitializedCurrentOracleSkuCoverageManifestData(data: Uint8Array): void {
  decodeLayout("UninitializedOracleSkuCoverageManifest", data, () => {
    const reader = new Reader(data, "UninitializedOracleSkuCoverageManifest");
    uninitializedHeader(reader);
    reader.pubkey("month");
    reader.bytes(32, "required_sku_root");
    reader.u16("required_sku_count");
    reader.u16("covered_sku_count");
    reader.u64("planned_scramble_start_ts");
    reader.u64("planned_listing_ts");
    reader.bool("coverage_finalized");
    reader.u64("coverage_complete_ts");
    reader.u64("last_updated_slot");
    reader.exactLengthWithZeroPadding(CURRENT_ORACLE_SKU_COVERAGE_MANIFEST_ACCOUNT_SIZE);
  });
}

export function decodeCurrentOracleSkuCoverageManifestAccount(
  input: DecodeCurrentOracleSkuCoverageManifestAccountInput,
): CurrentOracleSkuCoverageManifestAccount {
  const { address, data, month, programId } = input;
  assertCurrentProgramAccount("OracleSkuCoverageManifest", input);
  return decodeLayout("OracleSkuCoverageManifest", data, () => {
    const reader = new Reader(data, "OracleSkuCoverageManifest");
    const bump = header(reader, "OSC");
    const decodedMonth = reader.pubkey("month");
    const requiredSkuRoot = reader.bytes(32, "required_sku_root");
    const requiredSkuCount = reader.u16("required_sku_count");
    const coveredSkuCount = reader.u16("covered_sku_count");
    const plannedScrambleStartTs = reader.u64("planned_scramble_start_ts");
    const plannedListingTs = reader.u64("planned_listing_ts");
    const coverageFinalized = reader.bool("coverage_finalized");
    const coverageCompleteTs = reader.u64("coverage_complete_ts");
    const lastUpdatedSlot = reader.u64("last_updated_slot");
    reader.exactLengthWithZeroPadding(CURRENT_ORACLE_SKU_COVERAGE_MANIFEST_ACCOUNT_SIZE);
    const expected = deriveOracleSkuCoverageManifestPda({ oracleMonthPda: month, programId });
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      Buffer.from("oracle-sku-coverage-v1", "ascii"),
      month.toBuffer(),
    ]);
    assertPda("OracleSkuCoverageManifest", address, expected, bump, expectedBump);
    if (!decodedMonth.equals(month) || requiredSkuRoot.equals(Buffer.alloc(32)) || requiredSkuCount === 0 || coveredSkuCount > requiredSkuCount || plannedScrambleStartTs === 0n || plannedListingTs <= plannedScrambleStartTs || (coverageFinalized && (coveredSkuCount !== requiredSkuCount || coverageCompleteTs === 0n))) {
      throw new Error("coverage manifest invariants are not current");
    }
    return {
      stateNamespace: "ameba-spread-v2",
      bump,
      month,
      requiredSkuRoot,
      requiredSkuCount,
      coveredSkuCount,
      plannedScrambleStartTs,
      plannedListingTs,
      coverageFinalized,
      coverageCompleteTs,
      lastUpdatedSlot,
    };
  });
}

export interface DecodeCurrentOracleActiveWeightManifestAccountInput extends CurrentProgramAccountInput {
  readonly month: PublicKey;
}

export function decodeCurrentOracleActiveWeightManifestAccount(
  input: DecodeCurrentOracleActiveWeightManifestAccountInput,
): CurrentOracleActiveWeightManifestAccount {
  const { address, data, month, programId } = input;
  assertCurrentProgramAccount("OracleActiveWeightManifest", input);
  return decodeLayout("OracleActiveWeightManifest", data, () => {
    const reader = new Reader(data, "OracleActiveWeightManifest");
    const bump = header(reader, "OAW");
    const decodedMonth = reader.pubkey("month");
    const recipeHash = reader.bytes(32, "recipe_hash");
    const frozenManifestHash = reader.bytes(32, "frozen_manifest_hash");
    const phase = enumValue(reader.u8("phase"), ["Collecting", "Applying", "ReadyToFinalize", "Finalized"] as const, "phase");
    const expectedSourceCount = reader.u16("expected_source_count");
    const expectedGroupCount = reader.u16("expected_group_count");
    const processedSourceCount = reader.u16("processed_source_count");
    const processedGroupCount = reader.u16("processed_group_count");
    const activeSourceCount = reader.u16("active_source_count");
    reader.bytes(32, "current_group_id");
    reader.u16("current_group_source_count");
    reader.u16("current_group_applied_count");
    reader.u16("current_group_active_count");
    reader.u16("current_group_applied_active_count");
    reader.u16("current_group_bucket_weight_bps");
    reader.u16("current_group_applied_share_bps");
    reader.u16("current_group_applied_effective_bps");
    const appliedEffectiveWeightTotalBps = reader.u16("applied_effective_weight_total_bps");
    reader.bytes(32, "last_collected_source_id");
    reader.bytes(32, "last_applied_source_id");
    reader.u32("collected_active_frozen_total");
    reader.u32("applied_active_frozen_cumulative");
    reader.bytes(32, "collected_snapshot_hash");
    reader.bytes(32, "applied_snapshot_hash");
    const rollingManifestHash = reader.bytes(32, "rolling_manifest_hash");
    const recomputedIndexDeltaBps = reader.i64("recomputed_index_delta_bps");
    reader.exactLength(CURRENT_ORACLE_ACTIVE_WEIGHT_MANIFEST_ACCOUNT_SIZE);
    const expected = deriveOracleActiveWeightManifestPda({ oracleMonthPda: month, programId });
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      Buffer.from("oracle-active-weights-v1", "ascii"),
      month.toBuffer(),
    ]);
    assertPda("OracleActiveWeightManifest", address, expected, bump, expectedBump);
    if (!decodedMonth.equals(month) || recipeHash.equals(Buffer.alloc(32)) || expectedSourceCount === 0 || expectedGroupCount === 0 || processedSourceCount > expectedSourceCount || processedGroupCount > expectedGroupCount || appliedEffectiveWeightTotalBps > 10_000 || (phase === "Finalized" && (processedSourceCount !== expectedSourceCount || processedGroupCount !== expectedGroupCount || activeSourceCount === 0 || appliedEffectiveWeightTotalBps !== 10_000 || frozenManifestHash.equals(Buffer.alloc(32)) || rollingManifestHash.equals(Buffer.alloc(32))))) {
      throw new Error("active weight manifest invariants are not current");
    }
    return {
      stateNamespace: "ameba-spread-v2",
      bump,
      month,
      recipeHash,
      frozenManifestHash,
      phase,
      expectedSourceCount,
      expectedGroupCount,
      processedSourceCount,
      processedGroupCount,
      activeSourceCount,
      appliedEffectiveWeightTotalBps,
      rollingManifestHash,
      recomputedIndexDeltaBps,
    };
  });
}

export interface DecodeCurrentVaultConfigAccountInput extends CurrentProgramAccountInput {}

export function decodeCurrentVaultConfigAccount(
  input: DecodeCurrentVaultConfigAccountInput,
): CurrentVaultConfigAccount {
  const { address, data, programId } = input;
  assertCurrentProgramAccount("VaultConfig", input);
  return decodeLayout("VaultConfig", data, () => {
    const bytes = Buffer.from(data);
    if (bytes.length !== CURRENT_VAULT_CONFIG_ACCOUNT_SIZE || bytes[0] !== 1 || !bytes.subarray(131, 134).equals(Buffer.from("VCF", "ascii")) || bytes[134] !== 1) {
      throw new Error("expected exact VCF/v1 layout");
    }
    if (bytes[130] !== 0 && bytes[130] !== 1) throw new Error("paused is not a canonical bool");
    const value = {
      bump: bytes[1]!,
      admin: new PublicKey(bytes.subarray(2, 34)),
      oracleAuthority: new PublicKey(bytes.subarray(34, 66)),
      usdcMint: new PublicKey(bytes.subarray(66, 98)),
      vaultTokenAccount: new PublicKey(bytes.subarray(98, 130)),
      paused: bytes[130] === 1,
    };
    const [, expectedBump] = expectedPda(programId, [CURRENT_STATE_NAMESPACE_SEED, VAULT_PDA_SEED]);
    assertPda("VaultConfig", address, deriveVaultConfigPda(programId), value.bump, expectedBump);
    return value;
  });
}

export interface DecodeCurrentContractMintAccountInput extends CurrentOwnedAccountContext {
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly namespace: "ameba-spread-v2";
  readonly programId: PublicKey;
  readonly marketAddress: PublicKey;
  readonly market: CurrentMarketAccount;
}

/** Decode the exact classic-SPL contract mint policy enforced by rc.44. */
export function decodeCurrentContractMintAccount(
  input: DecodeCurrentContractMintAccountInput,
): CurrentContractMintAccount {
  const { address, data, marketAddress, market, programId } = input;
  return decodeLayout("ContractMint", data, () => {
    assertCanonicalCurrentProgramId(programId);
    if (input.namespace !== CURRENT_STATE_NAMESPACE_SEED.toString("ascii") || market.stateNamespace !== input.namespace) {
      throw new AmebaAccountNamespaceMismatchError("contract mint Market namespace is not current");
    }
    if (
      data.byteLength !== MINT_SIZE ||
      input.executable === true
    ) {
      throw new Error("expected an exact non-executable classic SPL mint account");
    }
    if (!input.accountOwner.equals(SPL_TOKEN_PROGRAM_ID)) {
      throw new AmebaMintOwnerMismatchError("contract mint owner is not the classic SPL Token program", {
        details: { owner: input.accountOwner.toBase58(), expected: SPL_TOKEN_PROGRAM_ID.toBase58() },
      });
    }
    if (!market.longContractMint?.equals(address)) {
      throw new Error("contract mint is not bound by Market.long_contract_mint");
    }
    const expectedAddress = deriveContractMintPda({ marketPda: marketAddress, programId });
    if (!address.equals(expectedAddress)) throw new Error("contract mint address is not canonical");
    const mint = unpackMint(
      address,
      {
        data: Buffer.from(data),
        executable: false,
        lamports: 0,
        owner: input.accountOwner,
        rentEpoch: 0,
      },
      SPL_TOKEN_PROGRAM_ID,
    );
    if (
      !mint.isInitialized ||
      mint.decimals !== 6 ||
      !mint.mintAuthority?.equals(marketAddress) ||
      mint.freezeAuthority !== null ||
      mint.tlvData.length !== 0
    ) {
      throw new Error("contract mint policy is not current");
    }
    const accounting = market.mintAccounting;
    if (
      accounting.discriminator !== "MNT" ||
      accounting.version !== 1 ||
      accounting.decimals !== 6 ||
      accounting.totalBurned > accounting.totalConsumed ||
      accounting.totalConsumed > accounting.totalIssued ||
      mint.supply !== accounting.totalIssued - accounting.totalBurned
    ) {
      throw new Error("contract mint supply does not match current Market accounting");
    }
    return {
      address,
      market: marketAddress,
      mintAuthority: mint.mintAuthority,
      supply: mint.supply,
      decimals: 6,
      isInitialized: true,
      freezeAuthority: null,
    };
  });
}

export interface DecodeCurrentLightSplInterfaceAccountInput extends CurrentOwnedAccountContext {
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly namespace: "ameba-spread-v2";
  readonly programId: PublicKey;
  readonly mint: PublicKey;
}

/** Decode the canonical Light SPL interface, which is an exact classic token account. */
export function decodeCurrentLightSplInterfaceAccount(
  input: DecodeCurrentLightSplInterfaceAccountInput,
): CurrentLightSplInterfaceAccount {
  const { address, data } = input;
  return decodeLayout("LightSplInterface", data, () => {
    assertCanonicalCurrentProgramId(input.programId);
    if (input.namespace !== CURRENT_STATE_NAMESPACE_SEED.toString("ascii")) {
      throw new AmebaAccountNamespaceMismatchError("Light SPL interface namespace is not current");
    }
    if (
      data.byteLength !== ACCOUNT_SIZE ||
      input.executable === true ||
      !address.equals(deriveLightSplInterfacePda(input.mint))
    ) {
      throw new Error("expected the canonical non-executable Light SPL interface account");
    }
    if (!input.accountOwner.equals(SPL_TOKEN_PROGRAM_ID)) {
      throw new AmebaMintOwnerMismatchError("Light SPL interface owner is not the classic SPL Token program", {
        details: { owner: input.accountOwner.toBase58(), expected: SPL_TOKEN_PROGRAM_ID.toBase58() },
      });
    }
    const account = unpackAccount(
      address,
      {
        data: Buffer.from(data),
        executable: false,
        lamports: 0,
        owner: input.accountOwner,
        rentEpoch: 0,
      },
      SPL_TOKEN_PROGRAM_ID,
    );
    if (
      !account.mint.equals(input.mint) ||
      !account.owner.equals(LIGHT_TOKEN_CPI_AUTHORITY) ||
      !account.isInitialized ||
      account.isFrozen ||
      account.delegate !== null ||
      account.delegatedAmount !== 0n ||
      account.isNative ||
      account.rentExemptReserve !== null ||
      account.closeAuthority !== null ||
      account.tlvData.length !== 0
    ) {
      throw new Error("Light SPL interface policy is not current");
    }
    return {
      address,
      mint: input.mint,
      tokenAuthority: account.owner,
      amount: account.amount,
      isInitialized: true,
    };
  });
}

export interface DecodeCurrentUserCollateralAccountInput extends CurrentProgramAccountInput {
  readonly expectedOwner: PublicKey;
}

export function decodeCurrentUserCollateralAccount(
  input: DecodeCurrentUserCollateralAccountInput,
): CurrentUserCollateralAccount {
  const { address, data, programId } = input;
  assertCurrentProgramAccount("UserCollateral", input);
  return decodeLayout("UserCollateral", data, () => {
    const reader = new Reader(data, "UserCollateral");
    const bump = header(reader);
    const owner = reader.pubkey("owner");
    const availableBalance = reader.u64("available_balance");
    const lockedBalance = reader.u64("position_locked_balance");
    const lastActionSlot = reader.u64("last_action_slot");
    reader.exactLength(CURRENT_USER_COLLATERAL_ACCOUNT_SIZE);
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      USER_COLLATERAL_PDA_SEED,
      owner.toBuffer(),
    ]);
    assertPda("UserCollateral", address, deriveUserCollateralPda(owner, programId), bump, expectedBump);
    if (!owner.equals(input.expectedOwner)) {
      throw new AmebaProtocolIdentityError("UserCollateral owner does not match the requested owner");
    }
    return { bump, owner, availableBalance, lockedBalance, lastActionSlot };
  });
}

export interface DecodeCurrentSettlementRecordV2AccountInput extends CurrentProgramAccountInput {
  readonly expectedMarket?: PublicKey;
  readonly expectedOracleMonth?: PublicKey;
  readonly expectedSettlementTs: bigint;
}

export function decodeCurrentSettlementRecordV2Account(
  input: DecodeCurrentSettlementRecordV2AccountInput,
): CurrentSettlementRecordV2Account {
  const { address, data, programId } = input;
  assertCurrentProgramAccount("SettlementRecordV2", input);
  return decodeLayout("SettlementRecordV2", data, () => {
    const reader = new Reader(data, "SettlementRecordV2");
    const bump = header(reader, "STL", 4);
    const version = 4 as const;
    const market = reader.pubkey("market");
    const oracleMonth = reader.pubkey("oracle_month");
    const settlementTs = reader.u64("settlement_ts");
    const settlementPriceAtomic = reader.u64("settlement_price_atomic");
    const signedLeafCommitment = reader.bytes(32, "signed_leaf_commitment");
    const submittedBy = reader.pubkey("submitted_by");
    const signerSetVersion = reader.u64("signer_set_version");
    reader.exactLengthWithZeroPadding(CURRENT_SETTLEMENT_RECORD_V2_ACCOUNT_SIZE);
    if (
      signedLeafCommitment.equals(Buffer.alloc(32)) ||
      submittedBy.equals(PublicKey.default) ||
      signerSetVersion === 0n
    ) {
      throw new Error("SettlementRecordV2 provenance is incomplete");
    }
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      SETTLEMENT_V2_PDA_SEED,
      market.toBuffer(),
      oracleMonth.toBuffer(),
    ]);
    assertPda(
      "SettlementRecordV2",
      address,
      deriveSettlementRecordV2Pda({ marketPda: market, oracleMonthPda: oracleMonth, programId }),
      bump,
      expectedBump,
    );
    if (input.expectedMarket !== undefined && !market.equals(input.expectedMarket)) {
      throw new AmebaProtocolIdentityError("SettlementRecordV2 market does not match the requested Market");
    }
    if (input.expectedOracleMonth !== undefined && !oracleMonth.equals(input.expectedOracleMonth)) {
      throw new AmebaProtocolIdentityError("SettlementRecordV2 month does not match the requested OracleMonth");
    }
    if (settlementTs !== input.expectedSettlementTs) {
      throw new AmebaProtocolIdentityError("SettlementRecordV2 timestamp does not match the current Market expiry");
    }
    return {
      bump,
      version,
      market,
      oracleMonth,
      settlementTs,
      settlementPriceAtomic,
      signedLeafCommitment,
      submittedBy,
      signerSetVersion,
    };
  });
}

export interface DecodeCurrentSettlementSignerRegistryAccountInput extends CurrentProgramAccountInput {}

export function decodeCurrentSettlementSignerRegistryAccount(
  input: DecodeCurrentSettlementSignerRegistryAccountInput,
): CurrentSettlementSignerRegistryAccount {
  const { address, data, programId } = input;
  assertCurrentProgramAccount("SettlementSignerRegistry", input);
  return decodeLayout("SettlementSignerRegistry", data, () => {
    const bytes = Buffer.from(data);
    if (bytes.length !== CURRENT_SETTLEMENT_SIGNER_REGISTRY_ACCOUNT_SIZE || bytes[0] !== 1 || !bytes.subarray(2, 5).equals(Buffer.from("SRG", "ascii")) || bytes[5] !== 1 || bytes.subarray(126).some((byte) => byte !== 0)) {
      throw new Error("expected exact SRG/v1 layout");
    }
    const value = {
      bump: bytes[1]!,
      currentSet: new PublicKey(bytes.subarray(6, 38)),
      currentVersion: bytes.readBigUInt64LE(38),
      pendingSet: new PublicKey(bytes.subarray(46, 78)),
      pendingVersion: bytes.readBigUInt64LE(78),
      recoveryAuthority: new PublicKey(bytes.subarray(86, 118)),
      proposalNonce: bytes.readBigUInt64LE(118),
    };
    if (
      value.currentSet.equals(PublicKey.default) ||
      value.currentVersion === 0n ||
      value.recoveryAuthority.equals(PublicKey.default) ||
      value.pendingSet.equals(PublicKey.default) !== (value.pendingVersion === 0n) ||
      !value.currentSet.equals(deriveSettlementSignerSetPda(value.currentVersion, programId)) ||
      (value.pendingVersion !== 0n && !value.pendingSet.equals(deriveSettlementSignerSetPda(value.pendingVersion, programId)))
    ) {
      throw new Error("settlement signer registry state is not canonical");
    }
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      SETTLEMENT_SIGNER_REGISTRY_PDA_SEED,
    ]);
    assertPda(
      "SettlementSignerRegistry",
      address,
      deriveSettlementSignerRegistryPda(programId),
      value.bump,
      expectedBump,
    );
    return value;
  });
}

export interface DecodeCurrentSettlementSignerSetAccountInput extends CurrentProgramAccountInput {}

export function decodeCurrentSettlementSignerSetAccount(
  input: DecodeCurrentSettlementSignerSetAccountInput,
): CurrentSettlementSignerSetAccount {
  const { address, data, programId } = input;
  assertCurrentProgramAccount("SettlementSignerSet", input);
  return decodeLayout("SettlementSignerSet", data, () => {
    const bytes = Buffer.from(data);
    if (bytes.length !== CURRENT_SETTLEMENT_SIGNER_SET_ACCOUNT_SIZE || bytes[0] !== 1 || !bytes.subarray(2, 5).equals(Buffer.from("SSS", "ascii")) || bytes[5] !== 1 || bytes[360] !== 0 && bytes[360] !== 1 || bytes.subarray(393).some((byte) => byte !== 0)) {
      throw new Error("expected exact SSS/v1 layout");
    }
    const threshold = bytes[46]!;
    const signerCount = bytes[47]!;
    if (signerCount < 1 || signerCount > 8 || threshold < 1 || threshold > signerCount || threshold * 2 <= signerCount) {
      throw new Error("signer threshold/count is not canonical");
    }
    const allSigners = Array.from({ length: 8 }, (_, index) => new PublicKey(bytes.subarray(48 + index * 32, 80 + index * 32)));
    const signers = allSigners.slice(0, signerCount);
    const signerBytes = signers.map((signer) => signer.toBuffer());
    if (
      signers.some((signer) => signer.equals(PublicKey.default)) ||
      allSigners.slice(signerCount).some((signer) => !signer.equals(PublicKey.default)) ||
      signerBytes.some((signer, index) => index > 0 && Buffer.compare(signerBytes[index - 1]!, signer) >= 0)
    ) {
      throw new Error("signer set is not strictly sorted or has nonzero unused entries");
    }
    const value = {
      bump: bytes[1]!,
      registry: new PublicKey(bytes.subarray(6, 38)),
      version: bytes.readBigUInt64LE(38),
      threshold,
      signerCount,
      signers,
      setHash: Buffer.from(bytes.subarray(304, 336)),
      rotationDelaySlots: bytes.readBigUInt64LE(336),
      proposedSlot: bytes.readBigUInt64LE(344),
      activateAfterSlot: bytes.readBigUInt64LE(352),
      emergency: bytes[360] === 1,
      proposer: new PublicKey(bytes.subarray(361, 393)),
    };
    if (
      value.version === 0n
      || value.rotationDelaySlots < BigInt(MIN_SETTLEMENT_SIGNER_ROTATION_DELAY_SLOTS)
      || !value.registry.equals(deriveSettlementSignerRegistryPda(programId))
      || value.proposer.equals(PublicKey.default)
      || value.activateAfterSlot < value.proposedSlot
    ) {
      throw new Error("signer set version or rotation delay is not current");
    }
    const expectedHash = hashBuffers([
      Buffer.from("ameba_settlement_signer_set_v1", "ascii"),
      value.registry.toBuffer(),
      u64Seed(value.version, "signer set version"),
      Buffer.from([value.threshold, value.signerCount]),
      ...signerBytes,
    ]);
    if (!value.setHash.equals(expectedHash)) throw new Error("signer set hash is invalid");
    const [, expectedBump] = expectedPda(programId, [
      CURRENT_STATE_NAMESPACE_SEED,
      SETTLEMENT_SIGNER_SET_PDA_SEED,
      u64Seed(value.version, "signer set version"),
    ]);
    assertPda(
      "SettlementSignerSet",
      address,
      deriveSettlementSignerSetPda(value.version, programId),
      value.bump,
      expectedBump,
    );
    return value;
  });
}

export interface CurrentMarketDiscoveryOptions {
  readonly commitment?: Commitment;
  readonly limit?: number;
}

export interface CurrentMarketDiscoveryResult {
  readonly deployment: typeof CURRENT_PROTOCOL_DEPLOYMENT;
  readonly markets: readonly CurrentMarketAccount[];
  readonly addresses: readonly PublicKey[];
}

/**
 * Reads only exact-size, current-program Market accounts. An empty result is
 * authoritative; this function never inserts a catalog or historical market.
 */
export async function discoverCurrentMarkets(
  connection: Pick<Connection, "getProgramAccounts">,
  options: CurrentMarketDiscoveryOptions = {},
): Promise<CurrentMarketDiscoveryResult> {
  const limit = options.limit ?? 256;
  if (!Number.isInteger(limit) || limit < 1 || limit > 256) {
    throw new AmebaProtocolDeploymentError("current market discovery limit must be between 1 and 256", {
      details: { limit },
    });
  }
  if (options.commitment !== undefined && options.commitment !== "finalized") {
    throw new AmebaProtocolDeploymentError("current market discovery requires finalized commitment", {
      details: { commitment: options.commitment },
    });
  }
  const programId = new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID);
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: "finalized",
    filters: [{ dataSize: CURRENT_MARKET_ACCOUNT_SIZE }],
  });
  if (accounts.length > limit) {
    throw new AmebaProtocolDeploymentError("current market discovery exceeded its bounded result limit", {
      details: { limit, observed: accounts.length },
    });
  }
  const decoded = accounts
    .filter((entry) => entry.account.owner.equals(programId) && !entry.account.executable)
    .map((entry) => decodeCurrentMarketAccount({
      address: entry.pubkey,
      data: entry.account.data,
      owner: entry.account.owner,
      executable: entry.account.executable,
      namespace: "ameba-spread-v2",
      programId,
    }))
    .sort((left, right) => Buffer.compare(left.marketId, right.marketId));
  return {
    deployment: CURRENT_PROTOCOL_DEPLOYMENT,
    markets: decoded,
    addresses: decoded.map((market) => deriveMarketPda(market.marketId, programId)),
  };
}

export function validateCurrentDeploymentIdentity(input: {
  readonly cluster: string;
  readonly genesisHash: string;
  readonly programId: string;
  readonly namespace: string;
}): void {
  if (
    input.cluster !== CURRENT_PROTOCOL_CLUSTER ||
    input.genesisHash !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH ||
    input.programId !== DEFAULT_AMEBA_SPREAD_PROGRAM_ID ||
    input.namespace !== CURRENT_STATE_NAMESPACE_SEED.toString("ascii")
  ) {
    throw new AmebaProtocolDeploymentError("deployment identity is not the current Ameba Spread Devnet", {
      details: { expected: CURRENT_PROTOCOL_DEPLOYMENT, received: input },
    });
  }
}

export function assertCurrentProgramOwner(owner: PublicKey, programId = new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID)): void {
  assertCanonicalCurrentProgramId(programId);
  if (!owner.equals(programId)) {
    throw new AmebaProtocolIdentityError("account is not owned by the current Ameba Spread program", {
      details: { owner: owner.toBase58(), expected: programId.toBase58() },
    });
  }
}
