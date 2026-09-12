import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import {
  AccountLayout,
  MintLayout,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "./current-token-primitives.js";
import {
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Commitment,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { TreeType, type TreeInfo } from "@lightprotocol/stateless.js";

import type {
  CurrentMarketAccount,
  CurrentOracleMonthAccount,
  CurrentOracleSkuCoverageManifestAccount,
  CurrentVaultConfigAccount,
} from "./current.js";
import {
  CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS,
  CURRENT_ORACLE_MONTH_ACCOUNT_SIZE,
  CURRENT_ORACLE_SKU_COVERAGE_MANIFEST_ACCOUNT_SIZE,
  decodeCurrentUserCollateralAccount,
  decodeCurrentMarketAccount, decodeCurrentOracleMonthAccount, decodeCurrentVaultConfigAccount,
  CURRENT_PROTOCOL_DEVNET_GENESIS_HASH,
  decodeCurrentOracleSkuCoverageManifestAccount,
  validateUninitializedCurrentOracleMonthData,
  validateUninitializedCurrentOracleSkuCoverageManifestData,
} from "./current.js";
import type {
  CurrentPhotonCompressedStateObservation,
  CurrentPhotonConnection,
} from "./current-photon.js";
import type {
  CurrentOracleActionRequest,
  CurrentOracleRedactedRequest,
} from "./current-oracle.js";
import {
  currentOracleEmergencyChoiceIndex,
  currentOracleSourceDefinitionHash,
  currentOracleSourceTypeHash,
  encodeCurrentOracleLabelBytes32,
  getCurrentGovernedSkuProof,
  loadCurrentGovernedSkuManifest,
  parseCurrentOracleHex32,
  redactCurrentOracleActionRequest,
  validateCurrentOracleActionRequest,
} from "./current-oracle.js";
import {
  CompressedStateDomain,
  requiredCompressedStateAccessesV1,
} from "@amoeba/spread-release-tools/compressed-state";
import * as currentOracleInstructionBuilders from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  CURRENT_STATE_NAMESPACE_SEED,
  ORACLE_EMERGENCY_DISPUTE_V3_PDA_SEED,
  ORACLE_EMERGENCY_VOTE_V3_PDA_SEED,
  ORACLE_ECONOMICS_CONFIG_PDA_SEED,
  ORACLE_MAX_V3_VOTERS,
  ORACLE_ACTIVE_WEIGHT_MANIFEST_PDA_SEED,
  ORACLE_OPENING_CLAIM_PDA_SEED,
  ORACLE_MATURITY_LADDER_PDA_SEED,
  ORACLE_PRODUCT_SKU_MANIFEST_PDA_SEED,
  ORACLE_SOURCE_CHALLENGE_GUARD_PDA_SEED,
  ORACLE_SOURCE_PDA_SEED,
  ORACLE_UPDATE_CLAIM_V2_PDA_SEED,
  ORACLE_UPDATE_CHALLENGE_GUARD_PDA_SEED,
  ORACLE_UPDATE_CHALLENGE_PDA_SEED,
  ORACLE_USDC_REWARD_SCHEDULE_PDA_SEED,
  ORACLE_USDC_REWARD_VAULT_PDA_SEED,
  ORACLE_USDC_SKU_POOL_PDA_SEED,
  ORACLE_USDC_SOURCE_REWARD_PDA_SEED,
  ORACLE_CANONICAL_ROLL_SECOND_OF_DAY,
  ORACLE_KILL_CHALLENGE_WINDOW_SECONDS,
  ORACLE_OPENING_WINDOW_SECONDS,
  ORACLE_PLACEMENT_WINDOW_SECONDS,
  ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS,
  ORACLE_ROLLING_MATURITY_MONTHS,
  ORACLE_SETTLEMENT_GRACE_SECONDS,
  ORACLE_STAKING_POOL_PDA_SEED,
  ORACLE_SAMBA_EMERGENCY_POT_PDA_SEED,
  SPL_TOKEN_PROGRAM_ID,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  deriveOracleMonthPda,
  deriveOracleEconomicsConfigPda,
  deriveOracleMaturityLadderRegistryPda,
  deriveOracleProductSkuManifestPda,
  deriveOracleSambaMintPda,
  deriveOracleSourcePda,
  deriveOracleStakingPoolPda,
  deriveOracleSambaVoteVaultPda,
  deriveOracleSkuCoverageManifestPda,
  deriveOracleSkuCoverageRecordPda,
  deriveUserCollateralPda,
  deriveVaultConfigPda,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveOracleMajorTokenConfigPda } from "@amoeba/spread-release-tools/oracle-dlmm";
import { oracleCanonicalLocatorHash } from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  deriveOracleActiveWeightManifestPda,
  deriveOracleEmergencyDisputeV3Pda,
  deriveOracleEmergencyVoteV3Pda,
  deriveOracleOpeningClaimChallengePda,
  deriveOracleOpeningClaimPda,
  deriveOracleSambaEmergencyPotPda,
  deriveOracleSambaEmergencyPotTokenAccount,
  deriveOracleSourceChallengeGuardPda,
  deriveOracleSourceChallengePda,
  deriveOracleSupportPositionPda,
  deriveOracleUpdateChallengeGuardPda,
  deriveOracleUpdateChallengePda,
  deriveOracleUpdateClaimV2Pda,
  deriveOracleUsdcRewardRegistrationPda,
  deriveOracleUsdcRewardSchedulePda,
  deriveOracleUsdcRewardVaultPda,
  deriveOracleUsdcRewardVaultTokenAccount,
  deriveOracleUsdcSkuPoolPda,
  deriveOracleUsdcSourceRewardPda,
  oracleEmergencyVoteV3CommitHash,
  oracleUpdateArchiveUrlHash,
  oracleUpdateClaimV2CommitHash,
  oracleUpdateEvidenceHash,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import { semanticCurrentSpreadInstructionV1 } from "./current-governed-write-internal.js";
import { isCurrentWriteReleaseAvailable } from "./release-train.js";
import { prepareCurrentOracleStakingAction } from "./current-oracle-staking.js";

const ZERO_32 = Buffer.alloc(32);
const U64_MAX = 18_446_744_073_709_551_615n;
const MAX_MERGE_DEPTH = 16;
const ORACLE_OPENING_ARCHIVE_URL_HASH_DOMAIN = Buffer.from("amoeba-oracle-opening-archive-url-v1", "utf8");

export class CurrentOraclePlannerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CurrentOraclePlannerError";
    this.code = code;
  }
}

class Reader {
  readonly data: Buffer;
  readonly label: string;
  offset = 0;

  constructor(data: Uint8Array, label: string, expectedLength: number) {
    this.data = Buffer.from(data);
    this.label = label;
    if (this.data.length !== expectedLength) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${label} must be exactly ${expectedLength} bytes`);
    }
  }

  take(length: number, field: string): Buffer {
    if (length < 0 || this.offset + length > this.data.length) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${this.label}.${field} is truncated`);
    }
    const value = Buffer.from(this.data.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  u8(field: string): number { return this.take(1, field)[0]!; }
  u16(field: string): number { return this.take(2, field).readUInt16LE(0); }
  u32(field: string): number { return this.take(4, field).readUInt32LE(0); }
  u64(field: string): bigint { return this.take(8, field).readBigUInt64LE(0); }
  bytes(length: number, field: string): Buffer { return this.take(length, field); }
  pubkey(field: string): PublicKey { return new PublicKey(this.take(32, field)); }
  bool(field: string): boolean {
    const value = this.u8(field);
    if (value !== 0 && value !== 1) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${this.label}.${field} is not a canonical bool`);
    }
    return value === 1;
  }
  currentHeader(discriminator?: string, version = 1): number {
    if (!this.bool("is_initialized")) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${this.label} is not initialized`);
    }
    const bump = this.u8("bump");
    if (discriminator !== undefined) {
      if (!this.bytes(3, "account_discriminator").equals(Buffer.from(discriminator, "ascii")) || this.u8("account_version") !== version) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${this.label} discriminator/version is not current`);
      }
    }
    return bump;
  }
  finish(): void {
    if (this.data.subarray(this.offset).some((byte) => byte !== 0)) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${this.label} reserved tail is not zero`);
    }
    this.offset = this.data.length;
  }
}

function enumValue<T extends string>(index: number, values: readonly T[], label: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${label} enum value is unknown`);
  }
  return value;
}

function assertCanonicalPda(
  address: PublicKey,
  expected: PublicKey,
  bump: number,
  programId: PublicKey,
  seeds: readonly Buffer[],
  label: string,
): void {
  const [derived, derivedBump] = PublicKey.findProgramAddressSync([...seeds], programId);
  if (!address.equals(expected) || !address.equals(derived) || bump !== derivedBump) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", `${label} is not its canonical current PDA/bump`);
  }
}

async function requiredProgramData(input: {
  readonly connection: Connection;
  readonly address: PublicKey;
  readonly programId: PublicKey;
  readonly commitment: Commitment;
  readonly label: string;
  readonly length: number;
}): Promise<Buffer> {
  const info = await input.connection.getAccountInfo(input.address, input.commitment);
  if (info === null) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_UNAVAILABLE", `${input.label} is absent`);
  }
  if (info.executable || !info.owner.equals(input.programId) || info.data.length !== input.length) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", `${input.label} owner/executable/size is invalid`);
  }
  return Buffer.from(info.data);
}

async function requireCreateTarget(input: {
  readonly connection: Connection;
  readonly address: PublicKey;
  readonly programId: PublicKey;
  readonly commitment: Commitment;
  readonly label: string;
}): Promise<void> {
  const info = await input.connection.getAccountInfo(input.address, input.commitment);
  if (info !== null && (info.data.length !== 0 || !info.owner.equals(SystemProgram.programId) || info.executable)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_ALREADY_EXISTS", `${input.label} is not a create-only system target`);
  }
}

async function requireAcquireableInitializationTarget(input: {
  readonly connection: Connection;
  readonly address: PublicKey;
  readonly programId: PublicKey;
  readonly commitment: Commitment;
  readonly label: string;
  readonly length: number;
  readonly validateUninitializedData: (data: Uint8Array) => void;
}): Promise<void> {
  const info = await input.connection.getAccountInfo(input.address, input.commitment);
  if (info === null) return;
  if (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0) return;
  if (!info.executable && info.owner.equals(input.programId) && info.data.length === input.length) {
    try {
      input.validateUninitializedData(info.data);
      return;
    } catch (cause) {
      throw new CurrentOraclePlannerError(
        "CURRENT_ORACLE_ACCOUNT_ALREADY_EXISTS",
        `${input.label} program-owned target is initialized or not an exact uninitialized current layout: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  throw new CurrentOraclePlannerError(
    "CURRENT_ORACLE_ACCOUNT_ALREADY_EXISTS",
    `${input.label} is not an absent, system-zero, or exact program-owned uninitialized target`,
  );
}

function u64(value: string, label: string, positive = false): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_REQUEST_INVALID", `${label} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX || (positive && parsed === 0n)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_REQUEST_INVALID", `${label} is outside the current u64 range`);
  }
  return parsed;
}

function safeU16(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_REQUEST_INVALID", `${label} is outside the current u16 range`);
  }
  return value;
}

function challengeBond(backing: bigint, bps: number, minimum: bigint, maximum: bigint): bigint {
  if (backing <= 0n || bps < 0 || bps > 10_000 || minimum <= 0n || maximum < minimum) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ECONOMICS_INVALID", "current challenge economics are invalid");
  }
  const proportional = (backing * BigInt(bps)) / 10_000n;
  return proportional < minimum ? minimum : proportional > maximum ? maximum : proportional;
}

function equalRewardShare(budget: bigint, count: number, label: string): bigint {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", `${label} recipient count is zero or invalid`);
  }
  return budget / BigInt(count);
}

function currentRewardEntitlement(input: {
  readonly kind: "proposer" | "support" | "opening" | "update";
  readonly pool: OracleSkuPoolState;
  readonly sourceReward?: OracleSourceRewardState;
  readonly rewardUnits?: number;
}): { readonly amount: bigint; readonly remainingSleeve: bigint } {
  let amount: bigint;
  let remainingSleeve: bigint;
  if (input.kind === "opening") {
    amount = equalRewardShare(input.pool.openingRewardBudget, input.pool.registeredOpeningCount, "opening reward");
    remainingSleeve = input.pool.remainingOpeningRewardBudget;
  } else if (input.kind === "update") {
    if (input.pool.registeredUpdateCount === 0 || input.pool.registeredUpdateRewardUnits === 0
      || input.rewardUnits === undefined || !Number.isInteger(input.rewardUnits) || ![1, 3].includes(input.rewardUnits)) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "update reward units are zero or invalid");
    }
    amount = input.pool.updateRewardBudget * BigInt(input.rewardUnits) / BigInt(input.pool.registeredUpdateRewardUnits);
    remainingSleeve = input.pool.remainingUpdateRewardBudget;
  } else {
    const reward = input.sourceReward;
    if (reward === undefined || input.pool.proposerRewardBps === 0 || input.pool.proposerRewardBps > 10_000) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "source reward allocation inputs are invalid");
    }
    const sourceShare = equalRewardShare(input.pool.sourceRewardBudget, input.pool.registeredSourceCount, "source reward");
    const proposer = reward.supporterCount === 0
      ? sourceShare
      : (sourceShare * BigInt(input.pool.proposerRewardBps)) / 10_000n;
    if (input.kind === "proposer") {
      amount = proposer;
    } else {
      amount = equalRewardShare(sourceShare - proposer, reward.supporterCount, "support reward");
    }
    remainingSleeve = input.pool.remainingSourceRewardBudget;
  }
  if (amount === 0n) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_NOT_ENTITLED", "resolved reward evidence yields zero claimable atoms");
  }
  if (amount > remainingSleeve) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "reward entitlement exceeds the remaining SKU sleeve");
  }
  return { amount, remainingSleeve };
}

interface OracleSkuPoolState {
  readonly address: PublicKey;
  readonly schedule: PublicKey;
  readonly month: PublicKey;
  readonly bucketId: Buffer;
  readonly sourceRewardBudget: bigint;
  readonly remainingSourceRewardBudget: bigint;
  readonly openingRewardBudget: bigint;
  readonly remainingOpeningRewardBudget: bigint;
  readonly updateRewardBudget: bigint;
  readonly remainingUpdateRewardBudget: bigint;
  readonly proposerRewardBps: number;
  readonly listingBond: bigint;
  readonly supportBond: bigint;
  readonly openingBond: bigint;
  readonly updateMinBond: bigint;
  readonly challengeMinBond: bigint;
  readonly challengeMaxBond: bigint;
  readonly challengeBondBps: number;
  readonly registeredSourceCount: number;
  readonly registeredOpeningCount: number;
  readonly registeredUpdateCount: number;
  readonly registeredUpdateRewardUnits: number;
}

interface OracleSourceState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly sourceId: Buffer;
  readonly bucketId: Buffer;
  readonly sourceTypeHash: Buffer;
  readonly canonicalLocatorHash: Buffer;
  readonly sourceDefinitionHash: Buffer;
  readonly proposer: PublicKey;
  readonly currentState: bigint;
  readonly listingBondLocked: bigint;
  readonly supportStakeTotal: bigint;
  readonly bucketWeightBps: number;
  readonly status: "Candidate" | "Frozen" | "Inactive" | "Rejected" | "OpeningPending" | "Active" | "Merged" | "TimedOut";
  readonly openingSubmitted: boolean;
  readonly lastFinalizedStep: bigint;
  readonly observationCount: number;
  readonly rollingObservationHash: Buffer;
}

interface OracleOpeningClaimState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly source: PublicKey;
  readonly sourceId: Buffer;
  readonly attempt: number;
  readonly claimant: PublicKey;
  readonly openingState: bigint;
  readonly sourceTime: bigint;
  readonly stake: bigint;
  readonly canonicalLocatorHash: Buffer;
  readonly sourceDefinitionHash: Buffer;
  readonly evidenceHash: Buffer;
  readonly archiveUrlHash: Buffer;
  readonly submittedSlot: bigint;
  readonly status: "Empty" | "Pending" | "Challenged" | "Accepted" | "Rejected" | "TimedOut";
  readonly escrowDisposition: "Unsettled" | "Refunded" | "Slashed" | "Transferred";
  readonly challengeDeadlineSlot: bigint;
}

interface OracleUpdateClaimState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly claimId: Buffer;
  readonly source: PublicKey;
  readonly sourceId: Buffer;
  readonly claimant: PublicKey;
  readonly priorState: bigint;
  readonly newState: bigint;
  readonly sourceTime: bigint;
  readonly stake: bigint;
  readonly status: "Open" | "Committed" | "Revealed" | "Finalized" | "Rejected" | "TimedOut";
  readonly evidenceHash: Buffer;
  readonly archiveUrlHash: Buffer;
  readonly escrowDisposition: "Unsettled" | "Refunded" | "Slashed" | "Transferred";
  readonly commitHash: Buffer;
  readonly earliestRevealSlot: bigint;
  readonly revealDeadlineSlot: bigint;
  readonly revealedSlot: bigint;
  readonly sambaCheckpointActive: boolean;
  readonly freshnessRewardMultiplier: number;
}

interface OracleUpdateChallengeState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly challengeId: Buffer;
  readonly claim: PublicKey;
  readonly claimId: Buffer;
  readonly challenger: PublicKey;
  readonly alternativeState: bigint;
  readonly alternativeSourceTime: bigint;
  readonly bond: bigint;
  readonly requiredBond: bigint;
  readonly status: "Open" | "RuleReview" | "RuleReviewUnresolved" | "Accepted" | "Rejected" | "Cancelled";
  readonly evidenceHash: Buffer;
  readonly archiveUrlHash: Buffer;
  readonly ruleReviewSlot: bigint;
  readonly escrowDisposition: "Unsettled" | "Refunded" | "Slashed" | "Transferred";
  readonly emergencySnapshotTotalMajorTokens: bigint;
}

interface OracleUpdateChallengeGuardState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly claim: PublicKey;
  readonly claimId: Buffer;
  readonly challenge: PublicKey;
  readonly challengeId: Buffer;
  readonly activeDispute: PublicKey;
  readonly resolutionStep: bigint;
  readonly createdSlot: bigint;
  readonly lastUpdatedSlot: bigint;
}

interface OracleEmergencyDisputeState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly disputeId: Buffer;
  readonly kind: "source" | "update" | "opening";
  readonly targetId: Buffer;
  readonly targetAccount: PublicKey;
  readonly status: "Open" | "RuleReview" | "RuleReviewUnresolved" | "Accepted" | "Rejected" | "Cancelled";
  readonly snapshotSlot: bigint;
  readonly snapshotTotalMajorTokens: bigint;
  readonly committedPower: bigint;
  readonly committedVoteCount: number;
  readonly revealedPower: bigint;
  readonly revealedVoteCount: number;
  readonly commitDeadlineSlot: bigint;
  readonly revealDeadlineSlot: bigint;
  readonly pot: PublicKey;
  readonly minimumVoteAmount: bigint;
  readonly choiceCount: number;
}

interface OracleEmergencyVoteState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly dispute: PublicKey;
  readonly pot: PublicKey;
  readonly voter: PublicKey;
  readonly sambaMint: PublicKey;
  readonly commitHash: Buffer;
  readonly lockedAmount: bigint;
  readonly snapshotPower: bigint;
  readonly votingPower: bigint;
  readonly choice: number;
  readonly status: "Empty" | "Committed" | "Revealed" | "Expired";
  readonly escrowDisposition: "Unsettled" | "Refunded" | "Slashed" | "Transferred";
  readonly committedSlot: bigint;
  readonly revealedSlot: bigint;
}

interface OracleSambaEmergencyPotState {
  readonly address: PublicKey;
  readonly dispute: PublicKey;
  readonly month: PublicKey;
  readonly sambaMint: PublicKey;
  readonly tokenAccount: PublicKey;
  readonly payoutMode: "Open" | "Redistribute" | "RefundAll";
  readonly totalCommitted: bigint;
  readonly committedVoteCount: number;
  readonly remainingLiability: bigint;
  readonly tokenAmount: bigint;
}

interface OracleSourceRewardState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly schedule: PublicKey;
  readonly skuPool: PublicKey;
  readonly source: PublicKey;
  readonly sourceId: Buffer;
  readonly proposer: PublicKey;
  readonly supporterCount: number;
  readonly registered: boolean;
  readonly terminalStatus: OracleSourceState["status"];
  readonly openingClaim: PublicKey;
  readonly mergedIntoSource: PublicKey;
  readonly maxMergeDepth: number;
}

interface OracleRewardScheduleState {
  readonly address: PublicKey;
  readonly month: PublicKey;
  readonly phase: "Building" | "Funded" | "EntitlementsFinalized" | "Aborted";
  readonly rewardVault: PublicKey;
  readonly totalRewardBudget: bigint;
  readonly remainingRewardBudget: bigint;
}

interface OracleRewardVaultState {
  readonly address: PublicKey;
  readonly mint: PublicKey;
  readonly tokenAccount: PublicKey;
  readonly totalReserved: bigint;
  readonly totalPaid: bigint;
  readonly tokenAmount: bigint;
}

interface OracleSupportPositionState {
  readonly address: PublicKey;
  readonly source: PublicKey;
  readonly supporter: PublicKey;
  readonly supportStake: bigint;
  readonly released: boolean;
}

interface OracleRewardRegistrationState {
  readonly address: PublicKey;
  readonly skuPool: PublicKey;
  readonly subject: PublicKey;
  readonly recipient: PublicKey;
  readonly rewardUnits: number;
}

interface OracleSkuCoverageRecordState {
  readonly address: PublicKey;
  readonly skuId: Buffer;
  readonly skuIndex: number;
  readonly activeSupportedSourceCount: number;
}

export interface CurrentOracleCompressedReadObservation {
  readonly canonicalPda: PublicKey; readonly compressedAddress: PublicKey;
  readonly leaf: CurrentPhotonCompressedStateObservation["leaf"];
  readonly witness: { readonly witnessDigest: string };
  readonly transportObservation?: CurrentPhotonCompressedStateObservation;
}
const compressedObservationCache = new WeakMap<CurrentOraclePlannerContext, Map<string, Promise<CurrentOracleCompressedReadObservation | null>>>();

function observeCompressedOnce(
  input: CurrentOraclePlannerContext,
  canonicalPda: PublicKey,
  domain: CompressedStateDomain,
): Promise<CurrentOracleCompressedReadObservation | null> {
  if (input.photonConnection === undefined) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_COMPRESSED_STATE_UNAVAILABLE",
      "current compact Oracle state requires the authenticated Photon capability",
    );
  }
  let cache = compressedObservationCache.get(input);
  if (cache === undefined) {
    cache = new Map();
    compressedObservationCache.set(input, cache);
  }
  const key = `${canonicalPda.toBase58()}:${domain}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = input.compressedEvidenceReader !== undefined
      ? input.compressedEvidenceReader({ canonicalPda, domain })
      : input.photonConnection.observeCurrentCompressedState({ canonicalPda, domain }).then(observation => observation === null ? null : ({ ...observation, transportObservation: observation }));
    cache.set(key, pending);
  }
  return pending;
}

function collectObservation(
  input: CurrentOraclePlannerContext,
  observation: CurrentOracleCompressedReadObservation,
  label: string,
): void {
  if (observation.transportObservation === undefined) return;
  const collector = input.compressedObservations;
  if (collector === undefined) return;
  const prior = collector.find((candidate) => candidate.compressedAddress.equals(observation.compressedAddress));
  if (prior === undefined) collector.push(observation.transportObservation);
  else if (prior.witness.witnessDigest !== observation.witness.witnessDigest) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_RACE", `${label} changed during one finalized plan`);
  }
}

async function requiredCompressedObservation(
  input: CurrentOraclePlannerContext,
  canonicalPda: PublicKey,
  domain: CompressedStateDomain,
  label: string,
): Promise<CurrentOracleCompressedReadObservation> {
  const observation = await observeCompressedOnce(input, canonicalPda, domain);
  if (observation === null) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_UNAVAILABLE", `${label} compact state is absent`);
  }
  collectObservation(input, observation, label);
  return observation;
}

async function optionalCompressedObservation(
  input: CurrentOraclePlannerContext,
  canonicalPda: PublicKey,
  domain: CompressedStateDomain,
  label: string,
): Promise<CurrentOracleCompressedReadObservation | null> {
  const observation = await observeCompressedOnce(input, canonicalPda, domain);
  if (observation === null) return null;
  collectObservation(input, observation, label);
  return observation;
}

async function readSkuPool(input: CurrentOraclePlannerContext, bucketId: Buffer): Promise<OracleSkuPoolState> {
  const schedule = deriveOracleUsdcRewardSchedulePda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
  const address = deriveOracleUsdcSkuPoolPda({ rewardSchedulePda: schedule, bucketId, programId: input.programId });
  return readSkuPoolByAddress(input, address, bucketId);
}

async function readSkuPoolByAddress(
  input: CurrentOraclePlannerContext,
  address: PublicKey,
  expectedBucketId?: Buffer,
): Promise<OracleSkuPoolState> {
  const schedule = deriveOracleUsdcRewardSchedulePda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
  const compact = await requiredCompressedObservation(input, address, CompressedStateDomain.OracleUsdcSkuPool, "OracleUsdcSkuPool");
  const reader = new Reader(compact.leaf.data, "CompactOracleUsdcSkuPool", 156);
  const storedBucket = reader.bytes(32, "bucket_id");
  const sourceRewardBudget = reader.u64("source_reward_budget");
  const remainingSourceRewardBudget = reader.u64("remaining_source_reward_budget");
  const openingRewardBudget = reader.u64("opening_reward_budget");
  const remainingOpeningRewardBudget = reader.u64("remaining_opening_reward_budget");
  const updateRewardBudget = reader.u64("update_reward_budget");
  const remainingUpdateRewardBudget = reader.u64("remaining_update_reward_budget");
  const proposerRewardBps = reader.u16("proposer_reward_bps");
  const listingBond = reader.u64("listing_bond");
  const supportBond = reader.u64("support_bond");
  const openingBond = reader.u64("opening_bond");
  const updateMinBond = reader.u64("update_min_bond");
  const challengeMinBond = reader.u64("challenge_min_bond");
  const challengeMaxBond = reader.u64("challenge_max_bond");
  const challengeBondBps = reader.u16("challenge_bond_bps");
  const registeredSourceCount = reader.u32("registered_source_count"); const registeredOpeningCount = reader.u32("registered_opening_count"); const registeredUpdateCount = reader.u32("registered_update_count"); const registeredUpdateRewardUnits = reader.u32("registered_update_reward_units"); reader.u64("last_updated_slot");
  reader.finish();
  const canonical = deriveOracleUsdcSkuPoolPda({ rewardSchedulePda: schedule, bucketId: storedBucket, programId: input.programId });
  if (!address.equals(canonical) || (expectedBucketId !== undefined && !storedBucket.equals(expectedBucketId)) || remainingSourceRewardBudget > sourceRewardBudget || remainingOpeningRewardBudget > openingRewardBudget || remainingUpdateRewardBudget > updateRewardBudget || proposerRewardBps === 0 || proposerRewardBps > 10_000 || listingBond === 0n || supportBond === 0n || openingBond === 0n || updateMinBond === 0n || challengeMinBond === 0n || challengeMaxBond < challengeMinBond || challengeBondBps > 10_000) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ECONOMICS_INVALID", "OracleUsdcSkuPool identities or economics are invalid");
  }
  return { address, schedule, month: input.oracleMonthAddress, bucketId: storedBucket, sourceRewardBudget, remainingSourceRewardBudget, openingRewardBudget, remainingOpeningRewardBudget, updateRewardBudget, remainingUpdateRewardBudget, proposerRewardBps, listingBond, supportBond, openingBond, updateMinBond, challengeMinBond, challengeMaxBond, challengeBondBps, registeredSourceCount, registeredOpeningCount, registeredUpdateCount, registeredUpdateRewardUnits };
}

async function readSource(
  input: CurrentOraclePlannerContext,
  sourceId: Buffer,
  descriptorRequired = false,
  collectDescriptor = descriptorRequired,
): Promise<OracleSourceState> {
  const address = deriveOracleSourcePda({ oracleMonthPda: input.oracleMonthAddress, sourceId, programId: input.programId });
  return readSourceByAddress(input, address, sourceId, descriptorRequired, collectDescriptor);
}

async function readSourceByAddress(
  input: CurrentOraclePlannerContext,
  address: PublicKey,
  expectedSourceId?: Buffer,
  descriptorRequired = false,
  collectDescriptor = descriptorRequired,
): Promise<OracleSourceState> {
  const stateObservation = await requiredCompressedObservation(input, address, CompressedStateDomain.OracleSourceState, "OracleSourceState");
  const reader = new Reader(stateObservation.leaf.data, "CompactOracleSourceState", 205);
  const storedSourceId = reader.bytes(32, "source_id");
  const bucketId = reader.bytes(32, "bucket_id");
  const proposer = reader.pubkey("proposer");
  reader.u64("baseline_state");
  const currentState = reader.u64("current_state");
  const listingBondLocked = reader.u64("listing_bond_locked");
  const supportStakeTotal = reader.u64("support_stake_total");
  const bucketWeightBps = reader.u16("bucket_weight_bps");
  const status = enumValue(reader.u8("status"), ["Candidate", "Frozen", "Inactive", "Rejected", "OpeningPending", "Active", "Merged", "TimedOut"] as const, "OracleSource.status");
  const openingSubmitted = reader.bool("opening_submitted");
  reader.bytes(32, "opening_evidence_hash");
  const lastFinalizedStep = reader.u64("last_finalized_step");
  const observationCount = reader.u8("observation_count");
  const rollingObservationHash = reader.bytes(32, "rolling_observation_hash");
  reader.finish();
  let sourceTypeHash: Buffer = Buffer.from(ZERO_32);
  let canonicalLocatorHash: Buffer = Buffer.from(ZERO_32);
  let sourceDefinitionHash: Buffer = Buffer.from(ZERO_32);
  if (descriptorRequired) {
    const descriptorObservation = collectDescriptor
      ? await requiredCompressedObservation(input, address, CompressedStateDomain.OracleSourceDescriptor, "OracleSourceDescriptor")
      : await observeCompressedOnce(input, address, CompressedStateDomain.OracleSourceDescriptor);
    if (descriptorObservation === null) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_UNAVAILABLE", "OracleSourceDescriptor compact state is absent");
    }
    const descriptor = new Reader(descriptorObservation.leaf.data, "CompactOracleSourceDescriptor", 96);
    sourceTypeHash = descriptor.bytes(32, "source_type_hash");
    canonicalLocatorHash = descriptor.bytes(32, "canonical_locator_hash");
    sourceDefinitionHash = descriptor.bytes(32, "source_definition_hash");
    descriptor.finish();
  }
  const canonical = deriveOracleSourcePda({ oracleMonthPda: input.oracleMonthAddress, sourceId: storedSourceId, programId: input.programId });
  if (
    !address.equals(canonical)
    || (expectedSourceId !== undefined && !storedSourceId.equals(expectedSourceId))
    || bucketId.equals(ZERO_32)
    || (descriptorRequired && (sourceTypeHash.equals(ZERO_32) || canonicalLocatorHash.equals(ZERO_32) || sourceDefinitionHash.equals(ZERO_32)))
    || proposer.equals(PublicKey.default)
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleSource embedded identities are invalid");
  }
  return { address, month: input.oracleMonthAddress, sourceId: storedSourceId, bucketId, sourceTypeHash, canonicalLocatorHash, sourceDefinitionHash, proposer, currentState, listingBondLocked, supportStakeTotal, bucketWeightBps, status, openingSubmitted, lastFinalizedStep, observationCount, rollingObservationHash };
}

async function requireAcquireableSourceChallengeGuard(
  input: CurrentOraclePlannerContext,
  source: OracleSourceState,
): Promise<PublicKey> {
  const address = deriveOracleSourceChallengeGuardPda({
    oracleMonthPda: input.oracleMonthAddress,
    oracleSourcePda: source.address,
    programId: input.programId,
  });
  const info = await input.connection.getAccountInfo(address, input.commitment);
  if (info === null || (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0)) {
    return address;
  }
  if (info.executable || !info.owner.equals(input.programId) || info.data.length !== 224) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_CHALLENGE_GUARD_INVALID", "source challenge guard is neither create-only nor current");
  }
  const reader = new Reader(info.data, "OracleSourceChallengeGuard", 224);
  const bump = reader.currentHeader("OCG");
  const month = reader.pubkey("month");
  const storedSource = reader.pubkey("source");
  const sourceId = reader.bytes(32, "source_id");
  const activeChallenge = reader.pubkey("active_challenge");
  const activeChallengeId = reader.bytes(32, "active_challenge_id");
  const activeDispute = reader.pubkey("active_dispute");
  reader.u64("last_updated_slot");
  reader.finish();
  assertCanonicalPda(
    address,
    address,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_SOURCE_CHALLENGE_GUARD_PDA_SEED, input.oracleMonthAddress.toBuffer(), source.address.toBuffer()],
    "OracleSourceChallengeGuard",
  );
  if (
    !month.equals(input.oracleMonthAddress)
    || !storedSource.equals(source.address)
    || !sourceId.equals(source.sourceId)
    || !activeChallenge.equals(PublicKey.default)
    || !activeChallengeId.equals(ZERO_32)
    || !activeDispute.equals(PublicKey.default)
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_CHALLENGE_GUARD_INVALID", "source challenge guard is occupied or misbound");
  }
  return address;
}

async function readOpeningClaim(input: CurrentOraclePlannerContext, source: OracleSourceState): Promise<OracleOpeningClaimState> {
  const address = deriveOracleOpeningClaimPda({ oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, programId: input.programId });
  const reader = new Reader(await requiredProgramData({ ...input, address, label: "OracleOpeningClaim", length: 320 }), "OracleOpeningClaim", 320);
  const bump = reader.currentHeader();
  const month = reader.pubkey("month"); const storedSource = reader.pubkey("source"); const sourceId = reader.bytes(32, "source_id");
  const attempt = reader.u32("attempt"); const claimant = reader.pubkey("claimant"); const openingState = reader.u64("opening_state"); const sourceTime = reader.u64("source_time"); const stake = reader.u64("stake");
  const canonicalLocatorHash = reader.bytes(32, "canonical_locator_hash");
  const sourceDefinitionHash = reader.bytes(32, "source_definition_hash");
  const evidenceHash = reader.bytes(32, "evidence_hash");
  const archiveUrlHash = reader.bytes(32, "archive_url_hash");
  const submittedSlot = reader.u64("submitted_slot");
  const challengeDeadlineSlot = reader.u64("challenge_deadline_slot");
  const status = enumValue(reader.u8("status"), ["Empty", "Pending", "Challenged", "Accepted", "Rejected", "TimedOut"] as const, "OracleOpeningClaim.status");
  const escrowDisposition = enumValue(
    reader.u8("escrow_disposition"),
    ["Unsettled", "Refunded", "Slashed", "Transferred"] as const,
    "OracleOpeningClaim.escrow_disposition",
  );
  reader.finish();
  assertCanonicalPda(address, address, bump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_OPENING_CLAIM_PDA_SEED, input.oracleMonthAddress.toBuffer(), source.address.toBuffer()], "OracleOpeningClaim");
  if (
    !month.equals(input.oracleMonthAddress)
    || !storedSource.equals(source.address)
    || !sourceId.equals(source.sourceId)
    || !canonicalLocatorHash.equals(source.canonicalLocatorHash)
    || !sourceDefinitionHash.equals(source.sourceDefinitionHash)
    || evidenceHash.equals(ZERO_32)
    || archiveUrlHash.equals(ZERO_32)
    || claimant.equals(PublicKey.default)
    || attempt === 0
    || openingState === 0n
    || sourceTime === 0n
    || stake === 0n
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleOpeningClaim embedded identities are invalid");
  }
  return {
    address,
    month,
    source: storedSource,
    sourceId,
    attempt,
    claimant,
    openingState,
    sourceTime,
    stake,
    canonicalLocatorHash,
    sourceDefinitionHash,
    evidenceHash,
    archiveUrlHash,
    submittedSlot,
    status,
    escrowDisposition,
    challengeDeadlineSlot,
  };
}

async function requireAcquireableOpeningClaim(
  input: CurrentOraclePlannerContext,
  source: OracleSourceState,
): Promise<{ readonly address: PublicKey; readonly nextAttempt: number }> {
  const address = deriveOracleOpeningClaimPda({
    oracleMonthPda: input.oracleMonthAddress,
    oracleSourcePda: source.address,
    programId: input.programId,
  });
  const info = await input.connection.getAccountInfo(address, input.commitment);
  if (info === null || (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0)) {
    await requireCreateTarget({ ...input, address, label: "OracleOpeningClaim" });
    return { address, nextAttempt: 1 };
  }
  if (info.executable || !info.owner.equals(input.programId) || info.data.length !== 320) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "opening claim target is neither create-only nor a current retry account");
  }
  const existing = await readOpeningClaim(input, source);
  if (existing.status !== "Rejected" || existing.escrowDisposition === "Unsettled" || existing.attempt >= 0xffff_ffff) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "existing opening claim is not a settled rejected retry target");
  }
  return { address, nextAttempt: existing.attempt + 1 };
}

async function readUpdateClaim(input: CurrentOraclePlannerContext, source: OracleSourceState, claimant: PublicKey, claimId: Buffer): Promise<OracleUpdateClaimState> {
  return readUpdateClaimByIdentity(input, source.address, source.sourceId, claimant, claimId);
}

export async function readUpdateClaimByIdentity(
  input: CurrentOraclePlannerContext,
  sourceAddress: PublicKey,
  expectedSourceId: Buffer,
  claimant: PublicKey,
  claimId: Buffer,
): Promise<OracleUpdateClaimState> {
  const address = deriveOracleUpdateClaimV2Pda({ oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: sourceAddress, claimant, claimId, programId: input.programId });
  const reader = new Reader(await requiredProgramData({ ...input, address, label: "OracleUpdateClaimV2", length: 384 }), "OracleUpdateClaimV2", 384);
  const bump = reader.currentHeader();
  const month = reader.pubkey("month"); const storedClaimId = reader.bytes(32, "claim_id"); const storedSource = reader.pubkey("source"); const storedSourceId = reader.bytes(32, "source_id"); const storedClaimant = reader.pubkey("claimant");
  const priorState = reader.u64("prior_state"); const newState = reader.u64("new_state"); const sourceTime = reader.u64("source_time"); const stake = reader.u64("stake");
  const status = enumValue(reader.u8("status"), ["Open", "Committed", "Revealed", "Finalized", "Rejected", "TimedOut"] as const, "OracleUpdateClaim.status");
  const evidenceHash = reader.bytes(32, "evidence_hash");
  const archiveUrlHash = reader.bytes(32, "archive_url_hash");
  const escrowDisposition = enumValue(
    reader.u8("escrow_disposition"),
    ["Unsettled", "Refunded", "Slashed", "Transferred"] as const,
    "OracleUpdateClaim.escrow_disposition",
  );
  if (!reader.bytes(3, "account_discriminator").equals(Buffer.from("UC2")) || reader.u8("account_version") !== 2) throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", "OracleUpdateClaimV2 marker is not UC2/v2");
  const commitHash = reader.bytes(32, "commit_hash");
  reader.u64("commit_slot");
  const earliestRevealSlot = reader.u64("earliest_reveal_slot");
  const revealDeadlineSlot = reader.u64("reveal_deadline_slot");
  const revealedSlot = reader.u64("revealed_slot");
  const sambaCheckpointActive = reader.bool("samba_checkpoint_active");
  const freshnessRewardMultiplier = reader.u8("freshness_reward_multiplier");
  reader.finish();
  if (status === "Finalized" && (priorState === 0n || newState === 0n || sourceTime === 0n
    || evidenceHash.equals(ZERO_32) || archiveUrlHash.equals(ZERO_32) || ![1, 3].includes(freshnessRewardMultiplier)
    || revealedSlot < earliestRevealSlot || revealedSlot > revealDeadlineSlot || revealedSlot === 0n)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", "Finalized OracleUpdateClaimV2 fields violate native reveal invariants");
  }
  assertCanonicalPda(address, address, bump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_UPDATE_CLAIM_V2_PDA_SEED, input.oracleMonthAddress.toBuffer(), sourceAddress.toBuffer(), claimant.toBuffer(), storedClaimId], "OracleUpdateClaimV2");
  if (!month.equals(input.oracleMonthAddress) || !storedClaimId.equals(claimId) || !storedSource.equals(sourceAddress) || !expectedSourceId.equals(storedSourceId) || !storedClaimant.equals(claimant) || stake === 0n || commitHash.equals(ZERO_32)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUpdateClaimV2 embedded identities are invalid");
  }
  return {
    address,
    month,
    claimId: storedClaimId,
    source: storedSource,
    sourceId: storedSourceId,
    claimant: storedClaimant,
    priorState,
    newState,
    sourceTime,
    stake,
    status,
    evidenceHash,
    archiveUrlHash,
    escrowDisposition,
    commitHash,
    earliestRevealSlot,
    revealDeadlineSlot,
    revealedSlot,
    sambaCheckpointActive,
    freshnessRewardMultiplier,
  };
}

async function readUpdateChallenge(
  input: CurrentOraclePlannerContext,
  claim: OracleUpdateClaimState,
  challengeId: Buffer,
): Promise<OracleUpdateChallengeState> {
  const address = deriveOracleUpdateChallengePda({
    oracleMonthPda: input.oracleMonthAddress,
    updateClaimPda: claim.address,
    challengeId,
    programId: input.programId,
  });
  const reader = new Reader(
    await requiredProgramData({ ...input, address, label: "OracleUpdateChallenge", length: 320 }),
    "OracleUpdateChallenge",
    320,
  );
  const bump = reader.currentHeader();
  const month = reader.pubkey("month");
  const storedChallengeId = reader.bytes(32, "challenge_id");
  const storedClaim = reader.pubkey("claim");
  const storedClaimId = reader.bytes(32, "claim_id");
  const challenger = reader.pubkey("challenger");
  const alternativeState = reader.u64("alternative_state");
  const alternativeSourceTime = reader.u64("alternative_source_time");
  const bond = reader.u64("bond");
  const requiredBond = reader.u64("required_bond");
  const status = enumValue(
    reader.u8("status"),
    ["Open", "RuleReview", "RuleReviewUnresolved", "Accepted", "Rejected", "Cancelled"] as const,
    "OracleUpdateChallenge.status",
  );
  const evidenceHash = reader.bytes(32, "evidence_hash");
  const archiveUrlHash = reader.bytes(32, "archive_url_hash");
  const ruleReviewSlot = reader.u64("rule_review_slot");
  const escrowDisposition = enumValue(
    reader.u8("escrow_disposition"),
    ["Unsettled", "Refunded", "Slashed", "Transferred"] as const,
    "OracleUpdateChallenge.escrow_disposition",
  );
  if (!reader.bytes(3, "account_discriminator").equals(Buffer.from("UCH")) || reader.u8("account_version") !== 4) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", "OracleUpdateChallenge marker is not UCH/v4");
  }
  const emergencySnapshotTotalMajorTokens = reader.u64("emergency_snapshot_total_major_tokens");
  reader.finish();
  assertCanonicalPda(
    address,
    address,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_UPDATE_CHALLENGE_PDA_SEED, input.oracleMonthAddress.toBuffer(), claim.address.toBuffer(), storedChallengeId],
    "OracleUpdateChallenge",
  );
  if (
    !month.equals(input.oracleMonthAddress)
    || !storedChallengeId.equals(challengeId)
    || !storedClaim.equals(claim.address)
    || !storedClaimId.equals(claim.claimId)
    || challenger.equals(PublicKey.default)
    || alternativeState === 0n
    || alternativeState === claim.newState
    || alternativeSourceTime === 0n
    || bond === 0n
    || bond !== requiredBond
    || evidenceHash.equals(ZERO_32)
    || archiveUrlHash.equals(ZERO_32)
    || ruleReviewSlot === 0n
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUpdateChallenge embedded identities/economics are invalid");
  }
  return {
    address,
    month,
    challengeId: storedChallengeId,
    claim: storedClaim,
    claimId: storedClaimId,
    challenger,
    alternativeState,
    alternativeSourceTime,
    bond,
    requiredBond,
    status,
    evidenceHash,
    archiveUrlHash,
    ruleReviewSlot,
    escrowDisposition,
    emergencySnapshotTotalMajorTokens,
  };
}

async function readUpdateChallengeGuard(
  input: CurrentOraclePlannerContext,
  claim: OracleUpdateClaimState,
  challenge: OracleUpdateChallengeState,
): Promise<OracleUpdateChallengeGuardState> {
  const address = deriveOracleUpdateChallengeGuardPda({
    oracleMonthPda: input.oracleMonthAddress,
    updateClaimPda: claim.address,
    programId: input.programId,
  });
  const reader = new Reader(
    await requiredProgramData({ ...input, address, label: "OracleUpdateChallengeGuard", length: 224 }),
    "OracleUpdateChallengeGuard",
    224,
  );
  const bump = reader.currentHeader("OUG");
  const month = reader.pubkey("month");
  const storedClaim = reader.pubkey("claim");
  const storedClaimId = reader.bytes(32, "claim_id");
  const storedChallenge = reader.pubkey("challenge");
  const storedChallengeId = reader.bytes(32, "challenge_id");
  const activeDispute = reader.pubkey("active_dispute");
  const resolutionStep = reader.u64("resolution_step");
  const createdSlot = reader.u64("created_slot");
  const lastUpdatedSlot = reader.u64("last_updated_slot");
  reader.finish();
  assertCanonicalPda(
    address,
    address,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_UPDATE_CHALLENGE_GUARD_PDA_SEED, input.oracleMonthAddress.toBuffer(), claim.address.toBuffer()],
    "OracleUpdateChallengeGuard",
  );
  if (
    !month.equals(input.oracleMonthAddress)
    || !storedClaim.equals(claim.address)
    || !storedClaimId.equals(claim.claimId)
    || !storedChallenge.equals(challenge.address)
    || !storedChallengeId.equals(challenge.challengeId)
    || createdSlot === 0n
    || lastUpdatedSlot < createdSlot
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUpdateChallengeGuard embedded identities are invalid");
  }
  return {
    address,
    month,
    claim: storedClaim,
    claimId: storedClaimId,
    challenge: storedChallenge,
    challengeId: storedChallengeId,
    activeDispute,
    resolutionStep,
    createdSlot,
    lastUpdatedSlot,
  };
}

async function readRewardSchedule(input: CurrentOraclePlannerContext): Promise<OracleRewardScheduleState> {
  const address = deriveOracleUsdcRewardSchedulePda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
  const reader = new Reader(await requiredProgramData({ ...input, address, label: "OracleUsdcRewardSchedule", length: 160 }), "OracleUsdcRewardSchedule", 160);
  const bump = reader.currentHeader("URS", 2); const month = reader.pubkey("month"); const authority = reader.pubkey("authority"); const rewardVault = reader.pubkey("reward_vault");
  const phase = enumValue(reader.u8("phase"), ["Building", "Funded", "EntitlementsFinalized", "Aborted"] as const, "OracleUsdcRewardSchedule.phase");
  reader.u16("sku_pool_count"); reader.u32("registered_source_count"); reader.u32("registered_opening_count"); reader.u32("registered_update_count"); reader.u32("registered_update_reward_units");
  const totalRewardBudget = reader.u64("total_reward_budget");
  const remainingRewardBudget = reader.u64("remaining_reward_budget");
  reader.u64("last_updated_slot"); reader.u32("outstanding_prelisting_escrow_count"); reader.u64("trading_fee_bounty_total"); reader.bool("bounty_fee_sweep_finalized"); reader.finish();
  assertCanonicalPda(address, address, bump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_USDC_REWARD_SCHEDULE_PDA_SEED, input.oracleMonthAddress.toBuffer()], "OracleUsdcRewardSchedule");
  if (!month.equals(input.oracleMonthAddress) || authority.equals(PublicKey.default) || !rewardVault.equals(deriveOracleUsdcRewardVaultPda(input.programId)) || remainingRewardBudget > totalRewardBudget) throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUsdcRewardSchedule identity is invalid");
  return { address, month, phase, rewardVault, totalRewardBudget, remainingRewardBudget };
}

async function readRewardVault(input: CurrentOraclePlannerContext): Promise<OracleRewardVaultState> {
  const address = deriveOracleUsdcRewardVaultPda(input.programId);
  const reader = new Reader(
    await requiredProgramData({ ...input, address, label: "OracleUsdcRewardVault", length: 192 }),
    "OracleUsdcRewardVault",
    192,
  );
  const bump = reader.currentHeader("URV");
  const mint = reader.pubkey("mint");
  const tokenAccount = reader.pubkey("token_account");
  const totalReserved = reader.u64("total_reserved");
  const totalPaid = reader.u64("total_paid");
  reader.u64("last_updated_slot");
  reader.finish();
  assertCanonicalPda(
    address,
    address,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_USDC_REWARD_VAULT_PDA_SEED],
    "OracleUsdcRewardVault",
  );
  const expectedTokenAccount = deriveOracleUsdcRewardVaultTokenAccount(input.vaultConfig.usdcMint, input.programId);
  if (!mint.equals(input.vaultConfig.usdcMint) || !tokenAccount.equals(expectedTokenAccount)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUsdcRewardVault mint/custody identity is invalid");
  }
  const mintInfo = await input.connection.getAccountInfo(mint, input.commitment);
  validateClassicMint(mint, mintInfo);
  const token = validateClassicToken({
    address: tokenAccount,
    info: await input.connection.getAccountInfo(tokenAccount, input.commitment),
    mint,
    owner: address,
    minimum: totalReserved,
  });
  return { address, mint, tokenAccount, totalReserved, totalPaid, tokenAmount: token.amount };
}

async function readOracleEconomicsConfig(input: CurrentOraclePlannerContext): Promise<{
  readonly address: PublicKey;
  readonly configVersion: bigint;
  readonly emergencySupermajorityBps: number;
  readonly emergencyCommitWindowSlots: bigint;
  readonly emergencyRevealWindowSlots: bigint;
}> {
  const address = deriveOracleEconomicsConfigPda(input.programId);
  const reader = new Reader(
    await requiredProgramData({ ...input, address, label: "OracleEconomicsConfig", length: 40 }),
    "OracleEconomicsConfig",
    40,
  );
  const bump = reader.currentHeader("OEC");
  const configVersion = reader.u64("config_version");
  const emergencySupermajorityBps = reader.u16("emergency_supermajority_bps");
  const emergencyCommitWindowSlots = reader.u64("emergency_commit_window_slots");
  const emergencyRevealWindowSlots = reader.u64("emergency_reveal_window_slots");
  reader.u64("last_updated_slot");
  reader.finish();
  assertCanonicalPda(
    address,
    address,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_ECONOMICS_CONFIG_PDA_SEED],
    "OracleEconomicsConfig",
  );
  if (
    configVersion === 0n
    || emergencySupermajorityBps === 0
    || emergencySupermajorityBps > 10_000
    || emergencyCommitWindowSlots === 0n
    || emergencyRevealWindowSlots === 0n
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ECONOMICS_INVALID", "OracleEconomicsConfig contains invalid current economics");
  }
  return {
    address,
    configVersion,
    emergencySupermajorityBps,
    emergencyCommitWindowSlots,
    emergencyRevealWindowSlots,
  };
}

async function validateUnresolvedVotingState(input: CurrentOraclePlannerContext): Promise<{
  readonly stakingPool: PublicKey;
  readonly sambaMint: PublicKey;
  readonly sambaSupply: bigint;
  readonly liveSambaSupply: bigint;
  readonly governanceLockCount: bigint;
}> {
  const stakingPool = deriveOracleStakingPoolPda(input.programId);
  const reader = new Reader(
    await requiredProgramData({ ...input, address: stakingPool, label: "OracleStakingPool", length: 160 }),
    "OracleStakingPool",
    160,
  );
  const bump = reader.currentHeader("OSP");
  const majorTokenConfig = reader.pubkey("major_token_config");
  const sambaMint = reader.pubkey("samba_mint");
  const sambaVoteVault = reader.pubkey("samba_vote_vault");
  const activeAmbaBacking = reader.u64("active_amba_backing");
  const sambaSupply = reader.u64("samba_supply");
  reader.u64("pending_unstake_amba");
  reader.u64("total_rewards_funded");
  const governanceLockCount = reader.u64("governance_lock_count");
  reader.u64("last_updated_slot");
  reader.u64("orphaned_amba_backing");
  reader.finish();
  assertCanonicalPda(
    stakingPool,
    stakingPool,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_STAKING_POOL_PDA_SEED],
    "OracleStakingPool",
  );
  if (
    !majorTokenConfig.equals(deriveOracleMajorTokenConfigPda(input.programId))
    || !sambaMint.equals(deriveOracleSambaMintPda(input.programId))
    || !sambaVoteVault.equals(deriveOracleSambaVoteVaultPda(input.programId))
    || (sambaSupply === 0n) !== (activeAmbaBacking === 0n)
    || sambaSupply === 0n
    || activeAmbaBacking === 0n
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STAKING_INVALID", "OracleStakingPool identity/accounting cannot support an emergency snapshot");
  }
  const mintInfo = await input.connection.getAccountInfo(sambaMint, input.commitment);
  if (mintInfo === null || mintInfo.executable || !mintInfo.owner.equals(SPL_TOKEN_PROGRAM_ID) || mintInfo.data.length !== MintLayout.span) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STAKING_INVALID", "sAMBA mint owner/layout is invalid");
  }
  let decodedMint: ReturnType<typeof unpackMint>;
  try {
    decodedMint = unpackMint(sambaMint, mintInfo, SPL_TOKEN_PROGRAM_ID);
  } catch {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STAKING_INVALID", "sAMBA mint cannot be decoded");
  }
  if (
    !decodedMint.isInitialized
    || decodedMint.mintAuthority === null
    || !decodedMint.mintAuthority.equals(input.vaultConfigAddress)
    || decodedMint.freezeAuthority !== null
    || decodedMint.supply === 0n
    || decodedMint.supply > sambaSupply
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STAKING_INVALID", "sAMBA mint authority/supply cannot support an emergency snapshot");
  }
  return { stakingPool, sambaMint, sambaSupply, liveSambaSupply: decodedMint.supply, governanceLockCount };
}

async function readSourceReward(input: CurrentOraclePlannerContext, source: OracleSourceState): Promise<OracleSourceRewardState> {
  const schedule = deriveOracleUsdcRewardSchedulePda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
  const address = deriveOracleUsdcSourceRewardPda({ rewardSchedulePda: schedule, oracleSourcePda: source.address, programId: input.programId });
  const compact = await requiredCompressedObservation(input, address, CompressedStateDomain.OracleUsdcSourceReward, "OracleUsdcSourceReward");
  const reader = new Reader(compact.leaf.data, "CompactOracleUsdcSourceReward", 112);
  const storedSource = reader.pubkey("source");
  const supporterCount = reader.u32("supporter_count");
  const registered = reader.bool("registered");
  const terminalStatus = enumValue(reader.u8("terminal_status"), ["Candidate", "Frozen", "Inactive", "Rejected", "OpeningPending", "Active", "Merged", "TimedOut"] as const, "OracleUsdcSourceReward.terminal_status");
  const openingClaim = reader.pubkey("opening_claim");
  reader.u64("last_updated_slot");
  const mergedIntoSource = reader.pubkey("merged_into_source");
  const maxMergeDepth = reader.u8("max_merge_depth");
  reader.bool("listing_escrow_counted");
  reader.finish();
  const skuPool = deriveOracleUsdcSkuPoolPda({ rewardSchedulePda: schedule, bucketId: source.bucketId, programId: input.programId });
  if (!storedSource.equals(source.address) || maxMergeDepth > MAX_MERGE_DEPTH) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUsdcSourceReward identity is invalid");
  }
  return { address, month: input.oracleMonthAddress, schedule, skuPool, source: storedSource, sourceId: source.sourceId, proposer: source.proposer, supporterCount, registered, terminalStatus, openingClaim, mergedIntoSource, maxMergeDepth };
}

export async function readClassicSourceReward(
  input: CurrentOraclePlannerContext,
  sourceAddress: PublicKey,
): Promise<OracleSourceRewardState> {
  const schedule = deriveOracleUsdcRewardSchedulePda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
  const address = deriveOracleUsdcSourceRewardPda({ rewardSchedulePda: schedule, oracleSourcePda: sourceAddress, programId: input.programId });
  const reader = new Reader(
    await requiredProgramData({ ...input, address, label: "retained OracleUsdcSourceReward", length: 288 }),
    "retained OracleUsdcSourceReward",
    288,
  );
  const bump = reader.currentHeader("URC");
  const month = reader.pubkey("month");
  const storedSchedule = reader.pubkey("schedule");
  const skuPool = reader.pubkey("sku_pool");
  const source = reader.pubkey("source");
  const sourceId = reader.bytes(32, "source_id");
  const proposer = reader.pubkey("proposer");
  const supporterCount = reader.u32("supporter_count");
  const registered = reader.bool("registered");
  const terminalStatus = enumValue(reader.u8("terminal_status"), ["Candidate", "Frozen", "Inactive", "Rejected", "OpeningPending", "Active", "Merged", "TimedOut"] as const, "retained OracleUsdcSourceReward.terminal_status");
  const openingClaim = reader.pubkey("opening_claim");
  reader.u64("last_updated_slot");
  const mergedIntoSource = reader.pubkey("merged_into_source");
  const maxMergeDepth = reader.u8("max_merge_depth");
  reader.bool("listing_escrow_counted");
  reader.finish();
  assertCanonicalPda(
    address,
    address,
    bump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_USDC_SOURCE_REWARD_PDA_SEED, schedule.toBuffer(), sourceAddress.toBuffer()],
    "retained OracleUsdcSourceReward",
  );
  if (
    !month.equals(input.oracleMonthAddress)
    || !storedSchedule.equals(schedule)
    || !source.equals(sourceAddress)
    || !deriveOracleSourcePda({
      oracleMonthPda: input.oracleMonthAddress,
      sourceId,
      programId: input.programId,
    }).equals(sourceAddress)
    || sourceId.equals(ZERO_32)
    || proposer.equals(PublicKey.default)
    || skuPool.equals(PublicKey.default)
    || maxMergeDepth > MAX_MERGE_DEPTH
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "retained OracleUsdcSourceReward identity/layout is invalid");
  }
  return { address, month, schedule, skuPool, source, sourceId, proposer, supporterCount, registered, terminalStatus, openingClaim, mergedIntoSource, maxMergeDepth };
}

async function readSupportPositionByIdentity(
  input: CurrentOraclePlannerContext,
  sourceAddress: PublicKey,
  expectedSourceId: Buffer,
  supporter: PublicKey,
): Promise<OracleSupportPositionState> {
  const address = deriveOracleSupportPositionPda({
    oracleMonthPda: input.oracleMonthAddress,
    oracleSourcePda: sourceAddress,
    supporter,
    programId: input.programId,
  });
  const compact = await requiredCompressedObservation(input, address, CompressedStateDomain.OracleSupportPosition, "OracleSupportPosition");
  const reader = new Reader(compact.leaf.data, "CompactOracleSupportPosition", 107);
  const storedSource = reader.pubkey("source");
  const storedSupporter = reader.pubkey("supporter");
  const supportStake = reader.u64("support_stake");
  const released = reader.bool("released");
  const disposition = reader.u8("escrow_disposition");
  const failedScheduleCounted = reader.bool("failed_schedule_escrow_counted");
  const storedSourceId = reader.bytes(32, "source_id");
  reader.finish();
  if (
    !storedSource.equals(sourceAddress)
    || !storedSupporter.equals(supporter)
    || !storedSourceId.equals(expectedSourceId)
    || supportStake === 0n
    || (released ? disposition !== 1 : disposition !== 0)
    || (failedScheduleCounted && !released)
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleSupportPosition is not a reachable current state");
  }
  return { address, source: storedSource, supporter: storedSupporter, supportStake, released };
}

async function readUpdateRewardRegistration(
  input: CurrentOraclePlannerContext,
  schedule: PublicKey,
  subject: PublicKey,
  expectedRecipient: PublicKey,
): Promise<OracleRewardRegistrationState> {
  const address = deriveOracleUsdcRewardRegistrationPda({
    rewardSchedulePda: schedule,
    rewardKind: "update",
    subjectPda: subject,
    programId: input.programId,
  });
  const compact = await requiredCompressedObservation(input, address, CompressedStateDomain.OracleUsdcRewardRegistration, "OracleUsdcRewardRegistration");
  const reader = new Reader(compact.leaf.data, "CompactOracleUsdcRewardRegistration", 105);
  const skuPool = reader.pubkey("sku_pool");
  const storedSubject = reader.pubkey("subject");
  const recipient = reader.pubkey("recipient");
  const rewardUnits = reader.u8("reward_units");
  reader.u64("last_updated_slot");
  reader.finish();
  if (!storedSubject.equals(subject) || !recipient.equals(expectedRecipient) || skuPool.equals(PublicKey.default) || ![1, 3].includes(rewardUnits)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleUsdcRewardRegistration identity is invalid");
  }
  return { address, skuPool, subject: storedSubject, recipient, rewardUnits };
}

async function readOptionalSkuCoverageRecord(
  input: CurrentOraclePlannerContext,
  skuId: Buffer,
  expectedSkuIndex: number,
): Promise<OracleSkuCoverageRecordState | null> {
  const address = deriveOracleSkuCoverageRecordPda({
    oracleMonthPda: input.oracleMonthAddress,
    skuId,
    programId: input.programId,
  });
  const compact = await optionalCompressedObservation(
    input,
    address,
    CompressedStateDomain.OracleSkuCoverageRecord,
    "OracleSkuCoverageRecord",
  );
  if (compact === null) return null;
  const reader = new Reader(compact.leaf.data, "CompactOracleSkuCoverageRecord", 44);
  const storedSkuId = reader.bytes(32, "sku_id");
  const skuIndex = reader.u16("sku_index");
  const activeSupportedSourceCount = reader.u16("active_supported_source_count");
  reader.u64("last_updated_slot");
  reader.finish();
  if (!storedSkuId.equals(skuId) || skuIndex !== expectedSkuIndex) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleSkuCoverageRecord SKU identity/index is invalid");
  }
  return { address, skuId: storedSkuId, skuIndex, activeSupportedSourceCount };
}

async function readEmergencyDispute(input: CurrentOraclePlannerContext, disputeId: Buffer): Promise<OracleEmergencyDisputeState> {
  const address = deriveOracleEmergencyDisputeV3Pda({ oracleMonthPda: input.oracleMonthAddress, disputeId, programId: input.programId });
  const reader = new Reader(await requiredProgramData({ ...input, address, label: "OracleEmergencyDisputeV3", length: 382 }), "OracleEmergencyDisputeV3", 382);
  const bump = reader.currentHeader("OED", 3);
  const month = reader.pubkey("month");
  const storedId = reader.bytes(32, "dispute_id");
  const kind = enumValue(reader.u8("kind"), ["source", "update", "opening"] as const, "OracleEmergencyDispute.kind");
  const targetId = reader.bytes(32, "target_id");
  const targetAccount = reader.pubkey("target_account");
  const openedBy = reader.pubkey("opened_by");
  const status = enumValue(reader.u8("status"), ["Open", "RuleReview", "RuleReviewUnresolved", "Accepted", "Rejected", "Cancelled"] as const, "OracleEmergencyDispute.status");
  const fallbackChoice = reader.u8("fallback_choice");
  const resolvedChoice = reader.u8("resolved_choice");
  const snapshotSlot = reader.u64("snapshot_slot");
  const snapshotTotalMajorTokens = reader.u64("snapshot_total_major_tokens");
  const committedPower = reader.u64("committed_power");
  const committedVoteCount = reader.u32("committed_vote_count");
  const revealedPower = reader.u64("revealed_power");
  const revealedVoteCount = reader.u32("revealed_vote_count");
  const winningPower = reader.u64("winning_power");
  const winningVoteCount = reader.u32("winning_vote_count");
  const winningChoice = reader.u8("winning_choice");
  for (let i = 0; i < 3; i += 1) reader.u64(`choice_power_${i}`);
  for (let i = 0; i < 3; i += 1) reader.u32(`choice_vote_count_${i}`);
  const supermajorityBps = reader.u16("supermajority_bps");
  const commitDeadlineSlot = reader.u64("commit_deadline_slot");
  const revealDeadlineSlot = reader.u64("reveal_deadline_slot");
  const pot = reader.pubkey("pot");
  reader.u64("resolved_slot");
  const minimumVoteAmount = reader.u64("minimum_vote_amount");
  const choiceCount = reader.u8("choice_count");
  reader.finish();
  assertCanonicalPda(address, address, bump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_EMERGENCY_DISPUTE_V3_PDA_SEED, input.oracleMonthAddress.toBuffer(), storedId], "OracleEmergencyDisputeV3");
  const expectedMinimum = snapshotTotalMajorTokens === 0n
    ? 0n
    : (snapshotTotalMajorTokens + BigInt(ORACLE_MAX_V3_VOTERS) - 1n) / BigInt(ORACLE_MAX_V3_VOTERS);
  const validChoiceCount = kind === "source" ? choiceCount === 2 || choiceCount === 3 : choiceCount === 3;
  if (
    !month.equals(input.oracleMonthAddress)
    || !storedId.equals(disputeId)
    || targetId.equals(ZERO_32)
    || targetAccount.equals(PublicKey.default)
    || openedBy.equals(PublicKey.default)
    || !pot.equals(deriveOracleSambaEmergencyPotPda({ emergencyDisputePda: address, programId: input.programId }))
    || snapshotSlot === 0n
    || snapshotTotalMajorTokens === 0n
    || minimumVoteAmount !== expectedMinimum
    || committedVoteCount > ORACLE_MAX_V3_VOTERS
    || committedPower > snapshotTotalMajorTokens
    || (committedPower === 0n) !== (committedVoteCount === 0)
    || BigInt(committedVoteCount) * minimumVoteAmount > committedPower
    || revealedPower > committedPower
    || revealedVoteCount > committedVoteCount
    || winningPower > committedPower
    || winningVoteCount > committedVoteCount
    || !validChoiceCount
    || fallbackChoice >= choiceCount
    || resolvedChoice >= choiceCount
    || winningChoice >= choiceCount
    || supermajorityBps === 0
    || supermajorityBps > 10_000
    || commitDeadlineSlot === 0n
    || revealDeadlineSlot <= commitDeadlineSlot
  ) throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleEmergencyDisputeV3 identity/policy is invalid");
  return {
    address,
    month,
    disputeId: storedId,
    kind,
    targetId,
    targetAccount,
    status,
    snapshotSlot,
    snapshotTotalMajorTokens,
    committedPower,
    committedVoteCount,
    revealedPower,
    revealedVoteCount,
    commitDeadlineSlot,
    revealDeadlineSlot,
    pot,
    minimumVoteAmount,
    choiceCount,
  };
}

async function readEmergencyVote(input: CurrentOraclePlannerContext, dispute: OracleEmergencyDisputeState, voter: PublicKey): Promise<OracleEmergencyVoteState> {
  const address = deriveOracleEmergencyVoteV3Pda({ emergencyDisputePda: dispute.address, voter, programId: input.programId });
  const reader = new Reader(await requiredProgramData({ ...input, address, label: "OracleEmergencyVoteV3", length: 288 }), "OracleEmergencyVoteV3", 288);
  const bump = reader.currentHeader("OEV", 3); const month = reader.pubkey("month"); const storedDispute = reader.pubkey("dispute"); const pot = reader.pubkey("pot"); const storedVoter = reader.pubkey("voter"); const sambaMint = reader.pubkey("samba_mint"); const commitHash = reader.bytes(32, "commit_hash"); const lockedAmount = reader.u64("locked_amount"); const snapshotPower = reader.u64("snapshot_power"); const votingPower = reader.u64("voting_power"); const choice = reader.u8("choice"); const status = enumValue(reader.u8("status"), ["Empty", "Committed", "Revealed", "Expired"] as const, "OracleEmergencyVote.status"); const escrowDisposition = enumValue(reader.u8("escrow_disposition"), ["Unsettled", "Refunded", "Slashed", "Transferred"] as const, "OracleEmergencyVote.escrow_disposition"); const committedSlot = reader.u64("committed_slot"); const revealedSlot = reader.u64("revealed_slot"); reader.finish();
  assertCanonicalPda(address, address, bump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_EMERGENCY_VOTE_V3_PDA_SEED, dispute.address.toBuffer(), voter.toBuffer()], "OracleEmergencyVoteV3");
  if (!month.equals(input.oracleMonthAddress) || !storedDispute.equals(dispute.address) || !pot.equals(dispute.pot) || !storedVoter.equals(voter) || !sambaMint.equals(deriveOracleSambaMintPda(input.programId)) || commitHash.equals(ZERO_32) || lockedAmount === 0n || lockedAmount < dispute.minimumVoteAmount || votingPower !== lockedAmount || snapshotPower < lockedAmount || committedSlot === 0n) throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleEmergencyVoteV3 identity is invalid");
  return { address, month, dispute: storedDispute, pot, voter: storedVoter, sambaMint, commitHash, lockedAmount, snapshotPower, votingPower, choice, status, escrowDisposition, committedSlot, revealedSlot };
}

async function readEmergencyPot(
  input: CurrentOraclePlannerContext,
  dispute: OracleEmergencyDisputeState,
): Promise<OracleSambaEmergencyPotState> {
  const address = deriveOracleSambaEmergencyPotPda({ emergencyDisputePda: dispute.address, programId: input.programId });
  const reader = new Reader(await requiredProgramData({ ...input, address, label: "OracleSambaEmergencyPot", length: 288 }), "OracleSambaEmergencyPot", 288);
  const bump = reader.currentHeader("OEP");
  const storedDispute = reader.pubkey("dispute");
  const month = reader.pubkey("month");
  const sambaMint = reader.pubkey("samba_mint");
  const tokenAccount = reader.pubkey("token_account");
  const payoutMode = enumValue(reader.u8("payout_mode"), ["Open", "Redistribute", "RefundAll"] as const, "OracleSambaEmergencyPot.payout_mode");
  const totalCommitted = reader.u64("total_committed");
  const committedVoteCount = reader.u32("committed_vote_count");
  const winningChoice = reader.u8("winning_choice");
  const winningPower = reader.u64("winning_power");
  const winningVoteCount = reader.u32("winning_vote_count");
  const registeredPower = reader.u64("registered_power");
  const registeredVoteCount = reader.u32("registered_vote_count");
  const registeredBaseTotal = reader.u64("registered_base_total");
  const dustRecipientVote = reader.pubkey("dust_recipient_vote");
  const dustAmount = reader.u64("dust_amount");
  const registrationFinalized = reader.bool("registration_finalized");
  const remainingLiability = reader.u64("remaining_liability");
  const settledVoteCount = reader.u32("settled_vote_count");
  const totalPaid = reader.u64("total_paid");
  const resolvedSlot = reader.u64("resolved_slot");
  reader.u64("last_updated_slot");
  reader.finish();
  assertCanonicalPda(address, address, bump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_SAMBA_EMERGENCY_POT_PDA_SEED, dispute.address.toBuffer()], "OracleSambaEmergencyPot");
  if (
    !storedDispute.equals(dispute.address)
    || !month.equals(input.oracleMonthAddress)
    || !sambaMint.equals(deriveOracleSambaMintPda(input.programId))
    || !tokenAccount.equals(deriveOracleSambaEmergencyPotTokenAccount({ emergencyDisputePda: dispute.address, programId: input.programId }))
    || !dispute.pot.equals(address)
    || totalCommitted !== dispute.committedPower
    || committedVoteCount !== dispute.committedVoteCount
    || committedVoteCount > ORACLE_MAX_V3_VOTERS
    || (totalCommitted === 0n) !== (committedVoteCount === 0)
    || settledVoteCount > committedVoteCount
    || winningPower > totalCommitted
    || winningVoteCount > committedVoteCount
    || registeredPower > winningPower
    || registeredVoteCount > winningVoteCount
    || registeredBaseTotal > totalCommitted
    || totalPaid + remainingLiability !== totalCommitted
    || payoutMode !== "Open"
    || dispute.status !== "Open"
    || remainingLiability !== totalCommitted
    || totalPaid !== 0n
    || settledVoteCount !== 0
    || winningPower !== 0n
    || winningVoteCount !== 0
    || registeredPower !== 0n
    || registeredVoteCount !== 0
    || registeredBaseTotal !== 0n
    || !dustRecipientVote.equals(PublicKey.default)
    || dustAmount !== 0n
    || registrationFinalized
    || resolvedSlot !== 0n
    || winningChoice >= dispute.choiceCount
  ) throw new CurrentOraclePlannerError("CURRENT_ORACLE_EMERGENCY_INVALID", "OracleSambaEmergencyPot identity/accounting is invalid");
  const token = validateClassicToken({
    address: tokenAccount,
    info: await input.connection.getAccountInfo(tokenAccount, input.commitment),
    mint: sambaMint,
    owner: address,
    minimum: remainingLiability,
  });
  return { address, dispute: storedDispute, month, sambaMint, tokenAccount, payoutMode, totalCommitted, committedVoteCount, remainingLiability, tokenAmount: token.amount };
}

async function requireProgramAccountLength(input: CurrentOraclePlannerContext, address: PublicKey, length: number, label: string): Promise<void> {
  await requiredProgramData({ ...input, address, label, length });
}

function validateClassicMint(address: PublicKey, info: AccountInfo<Buffer> | null): void {
  if (info === null || info.executable || !info.owner.equals(SPL_TOKEN_PROGRAM_ID) || info.data.length !== MintLayout.span) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_MINT_INVALID", "classic SPL collateral mint owner/layout is invalid");
  }
  try {
    const mint = unpackMint(address, info, SPL_TOKEN_PROGRAM_ID);
    if (!mint.isInitialized || mint.decimals !== 6) {
      throw new Error("mint policy mismatch");
    }
  } catch {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_MINT_INVALID", "classic SPL collateral mint cannot be decoded as current USDC");
  }
}

function validateClassicToken(input: { readonly address: PublicKey; readonly info: AccountInfo<Buffer> | null; readonly mint: PublicKey; readonly owner: PublicKey; readonly minimum?: bigint }): ReturnType<typeof unpackAccount> {
  if (input.info === null) throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_UNAVAILABLE", `classic SPL token account ${input.address.toBase58()} is absent; required mint ${input.mint.toBase58()}, owner ${input.owner.toBase58()}`);
  if (input.info.executable || !input.info.owner.equals(SPL_TOKEN_PROGRAM_ID) || input.info.data.length !== AccountLayout.span) throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_INVALID", "classic SPL token account owner/layout is invalid");
  let account: ReturnType<typeof unpackAccount>;
  try { account = unpackAccount(input.address, input.info, SPL_TOKEN_PROGRAM_ID); } catch { throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_INVALID", "classic SPL token account cannot be decoded"); }
  if (!account.mint.equals(input.mint) || !account.owner.equals(input.owner) || !account.isInitialized || account.isFrozen || account.delegate !== null || account.delegatedAmount !== 0n || account.isNative || account.closeAuthority !== null) throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_INVALID", "classic SPL token account identity/policy is invalid");
  if (input.minimum !== undefined && account.amount < input.minimum) throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_BALANCE_INSUFFICIENT", `classic SPL token account ${input.address.toBase58()} has ${account.amount} atoms of mint ${input.mint.toBase58()}; requires ${input.minimum}`);
  return account;
}

function validateVoterSambaToken(input: {
  readonly address: PublicKey;
  readonly info: AccountInfo<Buffer> | null;
  readonly mint: PublicKey;
  readonly owner: PublicKey;
  readonly minimum: bigint;
}): ReturnType<typeof unpackAccount> {
  if (input.info === null || input.info.executable || !input.info.owner.equals(SPL_TOKEN_PROGRAM_ID) || input.info.data.length !== AccountLayout.span) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_INVALID", "voter sAMBA token account owner/layout is invalid");
  }
  let account: ReturnType<typeof unpackAccount>;
  try {
    account = unpackAccount(input.address, input.info, SPL_TOKEN_PROGRAM_ID);
  } catch {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_INVALID", "voter sAMBA token account cannot be decoded");
  }
  if (
    !account.mint.equals(input.mint)
    || !account.owner.equals(input.owner)
    || !account.isInitialized
    || account.isFrozen
    || account.isNative
    || account.amount < input.minimum
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_TOKEN_ACCOUNT_INVALID", "voter sAMBA token account identity/state/balance is invalid");
  }
  return account;
}

async function requireUserCollateral(
  input: CurrentOraclePlannerContext,
  owner: PublicKey,
  minimumAvailable = 0n,
): Promise<ReturnType<typeof decodeCurrentUserCollateralAccount>> {
  const address = deriveUserCollateralPda(owner, input.programId);
  const info = await input.connection.getAccountInfo(address, input.commitment);
  if (info === null) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_COLLATERAL_UNAVAILABLE", `UserCollateral ${address.toBase58()} is absent for owner ${owner.toBase58()}; collateral initialization is required`);
  }
  let collateral;
  try {
    collateral = decodeCurrentUserCollateralAccount({
      address,
      data: Buffer.from(info.data),
      owner: info.owner,
      executable: info.executable,
      programId: input.programId,
      namespace: "ameba-spread-v2",
      expectedOwner: owner,
    });
  } catch (cause) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_COLLATERAL_INVALID",
      `current owner UserCollateral is not canonical: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (collateral.availableBalance < minimumAvailable) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_COLLATERAL_BALANCE_INSUFFICIENT", `UserCollateral ${address.toBase58()} has ${collateral.availableBalance} available atoms; requires ${minimumAvailable}`);
  }
  return collateral;
}

function requireCanonicalOpeningWeightScheme(month: CurrentOracleMonthAccount): void {
  if (
    month.weightSchemeVersion !== 1
    || month.effectiveWeightTotalBps !== 10_000
    || month.weightManifestHash.equals(ZERO_32)
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_WEIGHT_SCHEME_INVALID", "Oracle month does not carry the canonical opening weight scheme");
  }
}

function oracleOpeningArchiveUrlHash(archiveUrl: string): Buffer {
  return createHash("sha256")
    .update(ORACLE_OPENING_ARCHIVE_URL_HASH_DOMAIN)
    .update(Buffer.from(archiveUrl, "utf8"))
    .digest();
}

export interface CurrentOraclePlannerContext {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly commitment: Commitment;
  readonly marketAddress: PublicKey;
  readonly market: CurrentMarketAccount;
  readonly oracleMonthAddress: PublicKey;
  readonly oracleMonth: CurrentOracleMonthAccount | null;
  readonly vaultConfigAddress: PublicKey;
  readonly vaultConfig: CurrentVaultConfigAccount;
  readonly photonConnection?: CurrentPhotonConnection;
  /** Internal collector used to bind every compact record read into the outer tag-205 plan. */
  readonly compressedObservations?: CurrentPhotonCompressedStateObservation[];
  /** Read-only entitlement composition; cannot be used to prepare a transaction. */
  readonly compressedEvidenceReader?: (input: { readonly canonicalPda: PublicKey; readonly domain: CompressedStateDomain }) => Promise<CurrentOracleCompressedReadObservation | null>;
}

export interface PreparedCurrentOracleAction {
  readonly actionType: CurrentOracleActionRequest["actionType"];
  readonly request: CurrentOracleRedactedRequest;
  readonly instructionName: string;
  readonly tag: number;
  readonly instruction: TransactionInstruction;
  readonly signer: PublicKey;
  readonly proofFacts: Readonly<Record<string, string | number | boolean | null>>;
  readonly compressedObservations: readonly CurrentPhotonCompressedStateObservation[];
}

function requireMonth(input: CurrentOraclePlannerContext): CurrentOracleMonthAccount {
  if (input.oracleMonth === null || !input.oracleMonth.market.equals(input.marketAddress) || !input.oracleMonth.authority.equals(input.vaultConfig.oracleAuthority)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_MONTH_UNAVAILABLE", "the exact current OracleMonth is absent or misbound");
  }
  return input.oracleMonth;
}

function requirePhase(month: CurrentOracleMonthAccount, allowed: readonly CurrentOracleMonthAccount["phase"][], action: string): void {
  if (!allowed.includes(month.phase)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_PHASE_INVALID", `${action} requires Oracle phase ${allowed.join(" or ")}; observed ${month.phase}`);
}

function rulebookScheduleBoundaries(month: CurrentOracleMonthAccount): {
  readonly placementEnd: bigint;
  readonly killEnd: bigint;
  readonly openingStart: bigint;
} {
  if (month.scrambleStartTs === 0n || month.listingTs === 0n) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "Oracle month rulebook schedule is absent");
  }
  const placementEnd = month.scrambleStartTs + BigInt(ORACLE_PLACEMENT_WINDOW_SECONDS);
  const killEnd = placementEnd + BigInt(ORACLE_KILL_CHALLENGE_WINDOW_SECONDS);
  const openingStart = killEnd + BigInt(ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS);
  const expectedListing = openingStart + BigInt(ORACLE_OPENING_WINDOW_SECONDS);
  if (
    expectedListing !== month.listingTs
    || month.listingTs !== month.scrambleStartTs + BigInt(CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS)
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "Oracle month rulebook boundaries are not canonical");
  }
  return { placementEnd, killEnd, openingStart };
}

function requireOpeningResolutionComplete(month: CurrentOracleMonthAccount): void {
  if (
    month.recipeHash.equals(ZERO_32)
    || month.frozenSourceCount === 0
    || month.openingResolvedSourceCount !== month.frozenSourceCount
    || month.weightSchemeVersion !== 1
    || month.effectiveWeightTotalBps !== 10_000
    || month.weightManifestHash.equals(ZERO_32)
    || month.activeWeightInitializationVersion !== 1
    || month.activeWeightSchemeVersion !== 1
    || month.activeWeightGroupCount === 0
    || month.activeWeightManifestHash.equals(ZERO_32)
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INCOMPLETE", "Oracle opening resolution or active-weight scheme is incomplete");
  }
}

async function requireGameWindow(
  input: CurrentOraclePlannerContext,
  month: CurrentOracleMonthAccount,
  action: string,
): Promise<bigint> {
  requirePhase(month, ["Game"], action);
  rulebookScheduleBoundaries(month);
  requireOpeningResolutionComplete(month);
  const now = await finalizedUnixTime(input);
  if (month.listingTs >= input.market.expiryTs || now < month.listingTs || now >= input.market.expiryTs) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_TIMING_WINDOW_CLOSED", `${action} is outside the current Oracle Game window`);
  }
  return now;
}

async function requireCashUpdateResolutionWindow(
  input: CurrentOraclePlannerContext,
  month: CurrentOracleMonthAccount,
  action: string,
): Promise<bigint> {
  requirePhase(month, ["Game"], action);
  rulebookScheduleBoundaries(month);
  requireOpeningResolutionComplete(month);
  const now = await finalizedUnixTime(input);
  const resolutionEnd = input.market.expiryTs + BigInt(ORACLE_SETTLEMENT_GRACE_SECONDS);
  if (month.listingTs >= input.market.expiryTs || now < month.listingTs || now >= resolutionEnd) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_TIMING_WINDOW_CLOSED", `${action} is outside the current cash-update resolution window`);
  }
  return now;
}

async function finalizedUnixTime(input: CurrentOraclePlannerContext): Promise<bigint> {
  const slot = await input.connection.getSlot(input.commitment);
  const blockTime = await input.connection.getBlockTime(slot);
  if (!Number.isSafeInteger(slot) || slot < 0 || blockTime === null || !Number.isSafeInteger(blockTime) || blockTime < 0) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "finalized cluster time is unavailable");
  }
  return BigInt(blockTime);
}

async function readCoverageManifest(input: CurrentOraclePlannerContext): Promise<CurrentOracleSkuCoverageManifestAccount> {
  const address = deriveOracleSkuCoverageManifestPda({
    oracleMonthPda: input.oracleMonthAddress,
    programId: input.programId,
  });
  const info = await input.connection.getAccountInfo(address, input.commitment);
  if (info === null) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_UNAVAILABLE", "OracleSkuCoverageManifest is unavailable");
  }
  try {
    return decodeCurrentOracleSkuCoverageManifestAccount({
      address,
      data: Buffer.from(info.data),
      owner: info.owner,
      executable: info.executable,
      programId: input.programId,
      namespace: "ameba-spread-v2",
      month: input.oracleMonthAddress,
    });
  } catch (error) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH",
      `OracleSkuCoverageManifest is not an exact current account: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function requireSourceSubmissionOrPlacementWindow(
  input: CurrentOraclePlannerContext,
  month: CurrentOracleMonthAccount,
  action: string,
): Promise<CurrentOracleSkuCoverageManifestAccount> {
  const coverage = await readCoverageManifest(input);
  if (
    coverage.plannedListingTs !== coverage.plannedScrambleStartTs + BigInt(CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS)
    || coverage.plannedScrambleStartTs === 0n
    || coverage.plannedListingTs === 0n
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", `${action} coverage schedule is not canonical`);
  }
  const now = await finalizedUnixTime(input);
  if (month.phase === "SourceSubmission") {
    const reviewWindow = BigInt(
      ORACLE_KILL_CHALLENGE_WINDOW_SECONDS
        + ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS
        + ORACLE_OPENING_WINDOW_SECONDS,
    );
    if (
      coverage.coverageFinalized
      || now < coverage.plannedScrambleStartTs
      || now + reviewWindow >= input.market.expiryTs
    ) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_PHASE_INVALID", `${action} is outside the current late-coverage SourceSubmission window`);
    }
    return coverage;
  }
  if (month.phase === "Scramble") {
    const { placementEnd } = rulebookScheduleBoundaries(month);
    if (!coverage.coverageFinalized || now < month.scrambleStartTs || now >= placementEnd) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_PHASE_INVALID", `${action} is outside the current Scramble placement window`);
    }
    return coverage;
  }
  throw new CurrentOraclePlannerError("CURRENT_ORACLE_PHASE_INVALID", `${action} is not valid in the current Oracle phase`);
}

async function requireKillWindow(input: CurrentOraclePlannerContext, month: CurrentOracleMonthAccount, action: string): Promise<void> {
  requirePhase(month, ["Scramble"], action);
  const now = await finalizedUnixTime(input);
  const { placementEnd, killEnd } = rulebookScheduleBoundaries(month);
  if (now < placementEnd || now >= killEnd) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_PHASE_INVALID", `${action} is outside the current Scramble kill window`);
  }
}

async function requireOpeningWindow(input: CurrentOraclePlannerContext, month: CurrentOracleMonthAccount, action: string): Promise<{
  readonly now: bigint;
  readonly openingStart: bigint;
}> {
  requirePhase(month, ["Opening"], action);
  const now = await finalizedUnixTime(input);
  const { openingStart } = rulebookScheduleBoundaries(month);
  if (now < openingStart || now >= month.listingTs) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_PHASE_INVALID", `${action} is outside the current Opening window`);
  }
  return { now, openingStart };
}

async function exactCompressedObservationsForInstruction(
  input: CurrentOraclePlannerContext,
  instruction: TransactionInstruction,
): Promise<readonly CurrentPhotonCompressedStateObservation[]> {
  const semanticInstruction = semanticCurrentSpreadInstructionV1(instruction);
  const tag = semanticInstruction.data[0];
  if (tag !== undefined && [131, 133, 138, 139, 155, 176, 177, 181].includes(tag)) return Object.freeze([]);
  if (input.photonConnection === undefined) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_COMPRESSED_STATE_UNAVAILABLE",
      "wrapped current Oracle action requires the authenticated Photon capability",
    );
  }
  const topology = input.photonConnection.topology;
  const output = topology.stateTrees[0];
  if (output === undefined) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_COMPRESSED_STATE_UNAVAILABLE", "authorized Photon StateV2 topology is empty");
  }
  const addressTreeInfo: TreeInfo = {
    tree: new PublicKey(topology.addressTree),
    queue: new PublicKey(topology.addressQueue),
    treeType: TreeType.AddressV2,
    nextTreeInfo: null,
  };
  const outputStateTreeInfo: TreeInfo = {
    tree: new PublicKey(output.stateTree),
    queue: new PublicKey(output.queue),
    cpiContext: new PublicKey(output.cpiContext),
    treeType: TreeType.StateV2,
    nextTreeInfo: null,
  };
  let requests;
  try {
    requests = requiredCompressedStateAccessesV1({
      innerInstruction: semanticInstruction,
      trees: { addressTreeInfo, outputStateTreeInfo },
    });
  } catch (cause) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_COMPRESSED_STATE_UNAVAILABLE",
      `logical Oracle action has no exact pinned-package compressed access contract: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const exact: CurrentPhotonCompressedStateObservation[] = [];
  for (const request of requests) {
    const canonicalPda = semanticInstruction.keys[request.accountIndex]?.pubkey;
    if (canonicalPda === undefined) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "compressed access references a missing logical core account");
    }
    const observation = await observeCompressedOnce(input, canonicalPda, request.domain);
    if ((request.kind === "readOnly" || request.kind === "mutable") && observation === null) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_UNAVAILABLE", `required compact Oracle domain ${request.domain} at ${canonicalPda.toBase58()} is absent for instruction ${tag}`);
    }
    if (request.kind === "initialize" && observation !== null) {
      if (tag === 174 && request.domain === CompressedStateDomain.OracleUsdcRewardReceipt) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_ALREADY_CLAIMED", `reward receipt ${canonicalPda.toBase58()} already exists; this entitlement cannot be claimed again`);
      }
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", `create-only compact Oracle domain ${request.domain} at ${canonicalPda.toBase58()} already exists`);
    }
    if (observation !== null) {
      if (observation.transportObservation === undefined) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "read evidence cannot stand in for execution proof transport");
      exact.push(observation.transportObservation);
    }
  }
  const expected = new Map(exact.map((observation) => [observation.compressedAddress.toBase58(), observation.witness.witnessDigest]));
  for (const observed of input.compressedObservations ?? []) {
    if (expected.get(observed.compressedAddress.toBase58()) !== observed.witness.witnessDigest) {
      throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "planner read an extra or changed compact Oracle record outside the logical access contract");
    }
  }
  if (input.compressedObservations !== undefined) {
    input.compressedObservations.splice(0, input.compressedObservations.length, ...exact);
  }
  return Object.freeze([...exact]);
}

function exactUtcMonthIndex(timestamp: bigint, label: string): number {
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", `${label} exceeds the exact JavaScript timestamp range`);
  }
  const date = new Date(Number(timestamp) * 1_000);
  const secondOfDay = date.getUTCHours() * 3_600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  if (
    Number.isNaN(date.valueOf())
    || date.getUTCDate() !== 1
    || secondOfDay !== ORACLE_CANONICAL_ROLL_SECOND_OF_DAY
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", `${label} is not the canonical first-of-month UTC roll`);
  }
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

async function validateOracleMonthInitializationPolicy(input: CurrentOraclePlannerContext, params: {
  readonly scrambleStartTs: bigint;
  readonly listingTs: bigint;
  readonly requiredSkuRoot: Buffer;
  readonly requiredSkuCount: number;
}): Promise<void> {
  if (
    !input.market.paused
    || input.market.longContractMint === null
    || input.market.mintAccounting.totalIssued !== 0n
    || input.market.mintAccounting.totalConsumed !== 0n
    || input.market.mintAccounting.totalBurned !== 0n
    || params.scrambleStartTs === 0n
    || params.listingTs !== params.scrambleStartTs + BigInt(CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS)
    || params.listingTs >= input.market.expiryTs
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "tag 181 Market state or exact 4+2+1+1-day schedule is invalid");
  }
  const listingMonth = exactUtcMonthIndex(params.listingTs, "listingTs");
  const expiryMonth = exactUtcMonthIndex(input.market.expiryTs, "Market.expiryTs");
  if (expiryMonth !== listingMonth + ORACLE_ROLLING_MATURITY_MONTHS) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "tag 181 maturity is not the exact rolling three-month rung");
  }
  const finalizedSlot = await input.connection.getSlot(input.commitment);
  const finalizedBlockTime = await input.connection.getBlockTime(finalizedSlot);
  if (!Number.isSafeInteger(finalizedSlot) || finalizedSlot < 0 || finalizedBlockTime === null || !Number.isSafeInteger(finalizedBlockTime) || finalizedBlockTime < 0) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "finalized cluster time is unavailable");
  }
  const preservedPostSubmission = BigInt(
    ORACLE_KILL_CHALLENGE_WINDOW_SECONDS
      + ORACLE_RESOLUTION_FREEZE_WINDOW_SECONDS
      + ORACLE_OPENING_WINDOW_SECONDS,
  );
  if (BigInt(finalizedBlockTime) + preservedPostSubmission >= input.market.expiryTs) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "tag 181 is too late to preserve the current review windows");
  }

  const productManifest = deriveOracleProductSkuManifestPda({
    underlyingId: input.market.underlyingId,
    programId: input.programId,
  });
  const productReader = new Reader(
    await requiredProgramData({ ...input, address: productManifest, label: "OracleProductSkuManifest", length: 96 }),
    "OracleProductSkuManifest",
    96,
  );
  const productBump = productReader.currentHeader("OPM");
  const underlyingId = productReader.bytes(32, "underlying_id");
  const requiredSkuRoot = productReader.bytes(32, "required_sku_root");
  const requiredSkuCount = productReader.u16("required_sku_count");
  if (productReader.bytes(6, "reserved").some((byte) => byte !== 0)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", "OracleProductSkuManifest reserved bytes are nonzero");
  }
  productReader.u64("last_updated_slot");
  productReader.finish();
  assertCanonicalPda(
    productManifest,
    productManifest,
    productBump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_PRODUCT_SKU_MANIFEST_PDA_SEED, input.market.underlyingId],
    "OracleProductSkuManifest",
  );
  if (
    !underlyingId.equals(input.market.underlyingId)
    || !requiredSkuRoot.equals(params.requiredSkuRoot)
    || requiredSkuCount !== params.requiredSkuCount
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "governed SKU manifest differs from the exact on-chain product manifest");
  }

  const ladder = deriveOracleMaturityLadderRegistryPda({
    underlyingId: input.market.underlyingId,
    programId: input.programId,
  });
  const ladderInfo = await input.connection.getAccountInfo(ladder, input.commitment);
  if (ladderInfo === null || ladderInfo.owner.equals(SystemProgram.programId)) {
    await requireCreateTarget({ ...input, address: ladder, label: "OracleMaturityLadderRegistry" });
    return;
  }
  if (ladderInfo.executable || !ladderInfo.owner.equals(input.programId) || ladderInfo.data.length !== 96) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_LAYOUT_MISMATCH", "OracleMaturityLadderRegistry owner/executable/size is invalid");
  }
  const ladderReader = new Reader(ladderInfo.data, "OracleMaturityLadderRegistry", 96);
  const ladderBump = ladderReader.currentHeader("OML");
  const ladderUnderlying = ladderReader.bytes(32, "underlying_id");
  const priorListing = ladderReader.u64("planned_listing_ts");
  const priorExpiry = ladderReader.u64("planned_expiry_ts");
  ladderReader.u64("last_updated_slot");
  ladderReader.finish();
  assertCanonicalPda(
    ladder,
    ladder,
    ladderBump,
    input.programId,
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_MATURITY_LADDER_PDA_SEED, input.market.underlyingId],
    "OracleMaturityLadderRegistry",
  );
  if (!ladderUnderlying.equals(input.market.underlyingId)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleMaturityLadderRegistry underlying identity is invalid");
  }
  exactUtcMonthIndex(priorListing, "prior ladder listing");
  exactUtcMonthIndex(priorExpiry, "prior ladder expiry");
  const sameRung = priorListing === params.listingTs && priorExpiry === input.market.expiryTs;
  const advancesOneMonth = listingMonth === exactUtcMonthIndex(priorListing, "prior ladder listing") + 1
    && expiryMonth === exactUtcMonthIndex(priorExpiry, "prior ladder expiry") + 1
    && BigInt(finalizedBlockTime) >= priorListing;
  if (!sameRung && !advancesOneMonth) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_SCHEDULE_INVALID", "tag 181 does not match or advance the canonical maturity ladder");
  }
}

async function validateActiveWeightManifest(input: CurrentOraclePlannerContext): Promise<PublicKey> {
  const month = requireMonth(input);
  requireOpeningResolutionComplete(month);
  const manifest = deriveOracleActiveWeightManifestPda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
  const manifestData = await requiredProgramData({ ...input, address: manifest, label: "OracleActiveWeightManifest", length: 337 });
  const manifestReader = new Reader(manifestData, "OracleActiveWeightManifest", 337);
  const manifestBump = manifestReader.currentHeader("OAW");
  const manifestMonth = manifestReader.pubkey("month");
  const recipeHash = manifestReader.bytes(32, "recipe_hash");
  const frozenManifestHash = manifestReader.bytes(32, "frozen_manifest_hash");
  const manifestPhase = enumValue(manifestReader.u8("phase"), ["Collecting", "Applying", "ReadyToFinalize", "Finalized"] as const, "OracleActiveWeightManifest.phase");
  const expectedSourceCount = manifestReader.u16("expected_source_count");
  const expectedGroupCount = manifestReader.u16("expected_group_count");
  const processedSourceCount = manifestReader.u16("processed_source_count");
  const processedGroupCount = manifestReader.u16("processed_group_count");
  const activeSourceCount = manifestReader.u16("active_source_count");
  manifestReader.bytes(32, "current_group_id");
  manifestReader.u16("current_group_source_count");
  manifestReader.u16("current_group_applied_count");
  manifestReader.u16("current_group_active_count");
  manifestReader.u16("current_group_applied_active_count");
  manifestReader.u16("current_group_bucket_weight_bps");
  manifestReader.u16("current_group_applied_share_bps");
  manifestReader.u16("current_group_applied_effective_bps");
  const effectiveWeightTotalBps = manifestReader.u16("applied_effective_weight_total_bps");
  manifestReader.bytes(32, "last_collected_source_id");
  manifestReader.bytes(32, "last_applied_source_id");
  manifestReader.u32("collected_active_frozen_total");
  manifestReader.u32("applied_active_frozen_cumulative");
  manifestReader.bytes(32, "collected_snapshot_hash");
  manifestReader.bytes(32, "applied_snapshot_hash");
  const rollingManifestHash = manifestReader.bytes(32, "rolling_manifest_hash");
  manifestReader.take(8, "recomputed_index_delta_bps");
  manifestReader.finish();
  assertCanonicalPda(manifest, manifest, manifestBump, input.programId, [CURRENT_STATE_NAMESPACE_SEED, ORACLE_ACTIVE_WEIGHT_MANIFEST_PDA_SEED, input.oracleMonthAddress.toBuffer()], "OracleActiveWeightManifest");

  if (
    !manifestMonth.equals(input.oracleMonthAddress)
    || manifestPhase !== "Finalized"
    || recipeHash.equals(ZERO_32)
    || !recipeHash.equals(month.recipeHash)
    || frozenManifestHash.equals(ZERO_32)
    || !frozenManifestHash.equals(month.weightManifestHash)
    || rollingManifestHash.equals(ZERO_32)
    || !rollingManifestHash.equals(month.activeWeightManifestHash)
    || expectedSourceCount === 0
    || expectedSourceCount !== month.frozenSourceCount
    || expectedGroupCount === 0
    || expectedGroupCount !== month.activeWeightGroupCount
    || processedSourceCount !== expectedSourceCount
    || processedGroupCount !== expectedGroupCount
    || activeSourceCount === 0
    || activeSourceCount !== month.openedSourceCount
    || effectiveWeightTotalBps !== 10_000
  ) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACTIVE_WEIGHTS_INVALID", "active weight manifest identity or finalized economics is invalid");
  }
  return manifest;
}

function validateCurrentUpdateEvidence(input: {
  readonly planner: CurrentOraclePlannerContext;
  readonly month: CurrentOracleMonthAccount;
  readonly source: OracleSourceState;
  readonly state: bigint;
  readonly sourceTime: bigint;
  readonly evidenceHash: Buffer;
  readonly archiveUrl: string;
  readonly now: bigint;
}): Buffer {
  if (
    input.state === 0n
    || input.sourceTime < input.month.listingTs
    || input.sourceTime > input.now
    || input.sourceTime > input.planner.market.expiryTs
  ) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_UPDATE_INVALID",
      "update evidence time is outside the finalized current evidence interval",
    );
  }
  const waybackPrefix = "https://web.archive.org/web/";
  const originalUrl = input.archiveUrl.slice(waybackPrefix.length + 15);
  if (!oracleCanonicalLocatorHash(originalUrl).equals(input.source.canonicalLocatorHash)) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_UPDATE_INVALID",
      "update archive target does not match the governed source locator",
    );
  }
  const expectedEvidenceHash = oracleUpdateEvidenceHash({
    oracleMonthPda: input.planner.oracleMonthAddress,
    oracleSourcePda: input.source.address,
    sourceId: input.source.sourceId,
    state: input.state,
    sourceTime: input.sourceTime,
    canonicalLocatorHash: input.source.canonicalLocatorHash,
    sourceDefinitionHash: input.source.sourceDefinitionHash,
    archiveUrl: input.archiveUrl,
  });
  if (!input.evidenceHash.equals(expectedEvidenceHash)) {
    throw new CurrentOraclePlannerError(
      "CURRENT_ORACLE_UPDATE_INVALID",
      "update evidence hash does not bind the governed source, state, time, and archive",
    );
  }
  return oracleUpdateArchiveUrlHash(input.archiveUrl);
}

/** Capture exactly the finalized classic bytes used by the dispute economic planner. */
async function captureDisputeReadFrame(input: CurrentOraclePlannerContext) {
  if (input.commitment !== "finalized" || await input.connection.getGenesisHash() !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "dispute evidence requires finalized Devnet reads");
  }
  const original = input.connection;
  const start = await original.getSlot("finalized");
  if (!Number.isSafeInteger(start) || start < 0) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "invalid dispute read slot");
  let currentSlot = start;
  const facts: import("./current-oracle-staking.js").CurrentOracleStakingAccountFact[] = [];
  const connection = new Proxy(original, { get(target, key) {
    if (key === "getAccountInfo") return async (address: PublicKey) => {
      const response = await target.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: start });
      if (!Number.isSafeInteger(response.context.slot) || response.context.slot < start) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "dispute read precedes finalized floor");
      const info = response.value;
      const fact = { address: address.toBase58(), owner: info?.owner.toBase58() ?? null, executable: info?.executable ?? null,
        dataBase64: info ? Buffer.from(info.data).toString("base64") : null, dataSha256: info ? createHash("sha256").update(info.data).digest("hex") : null, observedSlot: response.context.slot };
      const previous = facts.find(value => value.address === fact.address);
      if (previous && (previous.dataSha256 !== fact.dataSha256 || previous.owner !== fact.owner || previous.executable !== fact.executable)) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "dispute account changed within read frame");
      }
      if (!previous) facts.push(Object.freeze(fact));
      return info;
    };
    if (key === "getSlot") return async () => {
      const observed = await target.getSlot("finalized");
      if (!Number.isSafeInteger(observed) || observed < currentSlot) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "dispute clock moved backwards");
      currentSlot = observed; return observed;
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const account = async (address: PublicKey) => {
    const info = await connection.getAccountInfo(address, "finalized");
    if (!info) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "dispute anchor is absent");
    return { address, owner: info.owner, data: info.data, executable: info.executable, namespace: "ameba-spread-v2" as const, programId: input.programId };
  };
  const market = decodeCurrentMarketAccount(await account(input.marketAddress));
  const oracleMonth = decodeCurrentOracleMonthAccount({ ...await account(input.oracleMonthAddress), expiryTs: market.expiryTs });
  const vaultConfig = decodeCurrentVaultConfigAccount(await account(input.vaultConfigAddress));
  return { context: { ...input, connection, market, oracleMonth, vaultConfig }, finish: async () => {
    const end = await original.getSlot("finalized");
    if (!Number.isSafeInteger(end) || end < currentSlot || facts.some(fact => fact.observedSlot > end)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "dispute finalized frame is inconsistent");
    return JSON.stringify({ readWindowStartSlot: start, readWindowEndSlot: end, currentSlot: String(currentSlot), accountFacts: facts });
  } };
}

export async function prepareCurrentOracleAction(input: CurrentOraclePlannerContext & { readonly request: CurrentOracleActionRequest }): Promise<PreparedCurrentOracleAction> {
  if (input.compressedEvidenceReader !== undefined) throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "entitlement read evidence is not a transaction proof transport");
  const oracleInstructionBuilders = isCurrentWriteReleaseAvailable()
    ? currentOracleInstructionBuilders
    : await import("@amoeba/spread-historical-rc44/oracle-dlmm");
  const request = validateCurrentOracleActionRequest(input.request);
  const disputeFrame = request.actionType === "commit_oracle_emergency_vote_v3" || request.actionType === "reveal_oracle_emergency_vote_v2"
    ? await captureDisputeReadFrame(input) : null;
  if (disputeFrame !== null) input = { ...disputeFrame.context, request };
  const owner = new PublicKey(request.ownerPubkey);
  const redacted = redactCurrentOracleActionRequest(request);
  if (!deriveVaultConfigPda(input.programId).equals(input.vaultConfigAddress)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_STATE_INVALID", "VaultConfig PDA is noncanonical");
  }
  if (!deriveOracleMonthPda({ marketPda: input.marketAddress, expiryTs: input.market.expiryTs, programId: input.programId }).equals(input.oracleMonthAddress)) {
    throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "OracleMonth PDA is not canonical for the selected series");
  }
  const commonProof = {
    actionType: request.actionType,
    marketId: request.marketId,
    expiryId: request.expiryId,
    ownerPubkey: owner.toBase58(),
    marketAddress: input.marketAddress.toBase58(),
    oracleMonth: input.oracleMonthAddress.toBase58(),
  };
  let instruction: TransactionInstruction;
  let instructionName: string;
  let tag: number;
  const actionFacts: Record<string, string | number | boolean | null> = {};

  switch (request.actionType) {
    case "queue_stake_amba_for_samba":
    case "activate_queued_stake_amba_for_samba":
    case "request_unstake_samba":
    case "complete_unstake_samba": {
      const prepared = await prepareCurrentOracleStakingAction({ connection: input.connection, programId: input.programId, request });
      instruction = prepared.instruction;
      tag = prepared.nativePlan.instructionTag;
      instructionName = request.actionType === "queue_stake_amba_for_samba" ? "QueueStakeAmbaForSamba"
        : request.actionType === "activate_queued_stake_amba_for_samba" ? "ActivateQueuedStakeAmbaForSamba"
        : request.actionType === "request_unstake_samba" ? "RequestUnstakeSamba" : "CompleteUnstakeSamba";
      Object.assign(actionFacts, { expectedAmbaAmountAtomic: prepared.nativePlan.expectedAmbaAmount.toString(),
        expectedSambaAmountAtomic: prepared.nativePlan.expectedSambaAmount.toString(), earliestExecutionTs: prepared.nativePlan.earliestExecutionTs.toString(),
        stakingReadStartSlot: prepared.state.readWindowStartSlot, stakingReadEndSlot: prepared.state.readWindowEndSlot,
        stakingAccountsSha256: createHash("sha256").update(JSON.stringify(prepared.state.accountFacts)).digest("hex"),
        stakingEvidenceJson: JSON.stringify({ readWindowStartSlot: prepared.state.readWindowStartSlot, readWindowEndSlot: prepared.state.readWindowEndSlot, currentUnixTimestamp: prepared.state.currentUnixTimestamp, accountFacts: prepared.state.accountFacts }) });
      break;
    }
    case "initialize_oracle_month_v5": {
      if (!owner.equals(input.vaultConfig.oracleAuthority)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_AUTHORITY_REQUIRED", `month initialization requires oracle authority ${input.vaultConfig.oracleAuthority.toBase58()} as signer; supplied ${owner.toBase58()}`);
      if (input.oracleMonth !== null) throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_ALREADY_EXISTS", "month initialization requires an absent month");
      const governed = await loadCurrentGovernedSkuManifest(input.market.seriesIdentity.product);
      const coverageAddress = deriveOracleSkuCoverageManifestPda({
        oracleMonthPda: input.oracleMonthAddress,
        programId: input.programId,
      });
      const [economics] = await Promise.all([
        readOracleEconomicsConfig(input),
        requireAcquireableInitializationTarget({
          ...input,
          address: input.oracleMonthAddress,
          label: "OracleMonth",
          length: CURRENT_ORACLE_MONTH_ACCOUNT_SIZE,
          validateUninitializedData: validateUninitializedCurrentOracleMonthData,
        }),
        requireAcquireableInitializationTarget({
          ...input,
          address: coverageAddress,
          label: "OracleSkuCoverageManifest",
          length: CURRENT_ORACLE_SKU_COVERAGE_MANIFEST_ACCOUNT_SIZE,
          validateUninitializedData: validateUninitializedCurrentOracleSkuCoverageManifestData,
        }),
      ]);
      await validateOracleMonthInitializationPolicy(input, {
        scrambleStartTs: u64(request.scrambleStartTs, "scrambleStartTs", true),
        listingTs: u64(request.listingTs, "listingTs", true),
        requiredSkuRoot: governed.requiredSkuRoot,
        requiredSkuCount: governed.requiredSkuCount,
      });
      instruction = oracleInstructionBuilders.buildInitializeOracleMonthV5Instruction({
        programId: input.programId,
        params: {
          scrambleStartTs: u64(request.scrambleStartTs, "scrambleStartTs", true),
          listingTs: u64(request.listingTs, "listingTs", true),
          settlementBaseOracleAtomic: u64(request.settlementBaseOracleAtomic, "settlementBaseOracleAtomic", true),
          requiredSkuRoot: governed.requiredSkuRoot,
          requiredSkuCount: governed.requiredSkuCount,
        },
        accounts: {
          authority: owner,
          payer: owner,
          marketPda: input.marketAddress,
          expiryTs: input.market.expiryTs,
          underlyingId: input.market.underlyingId,
        },
      });
      instructionName = "InitializeOracleMonthV5"; tag = 181;
      Object.assign(actionFacts, {
        requiredSkuRootHex: governed.requiredSkuRoot.toString("hex"),
        requiredSkuCount: governed.requiredSkuCount,
        economicsConfig: economics.address.toBase58(),
        economicsConfigVersion: economics.configVersion.toString(),
        coverageTarget: coverageAddress.toBase58(),
      });
      break;
    }
    case "propose_oracle_source_v3": {
      const month = requireMonth(input); await requireSourceSubmissionOrPlacementWindow(input, month, request.actionType);
      if (month.weightSchemeVersion === 255) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_WEIGHT_SCHEME_INVALID", "source proposal cannot use the unresolved weight-scheme marker");
      }
      const skuId = encodeCurrentOracleLabelBytes32(request.skuId, "skuId"); const bucketId = encodeCurrentOracleLabelBytes32(request.bucketId, "bucketId");
      if (!skuId.equals(bucketId)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_REQUEST_INVALID", "propose skuId must exactly equal bucketId");
      const proof = await getCurrentGovernedSkuProof(input.market.seriesIdentity.product, request.skuId);
      const schedule = await readRewardSchedule(input);
      const pool = await readSkuPool(input, bucketId);
      if (schedule.phase !== "Funded") throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "source proposal requires the funded current reward schedule");
      const listingBond = u64(request.listingBondAtomic, "listingBondAtomic", true);
      if (listingBond !== pool.listingBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_BOND_MISMATCH", "listingBondAtomic differs from the frozen SKU pool");
      await requireUserCollateral(input, owner, listingBond);
      const sourceId = parseCurrentOracleHex32(request.sourceId, "sourceId");
      const sourceAddress = deriveOracleSourcePda({ oracleMonthPda: input.oracleMonthAddress, sourceId, programId: input.programId });
      await requireCreateTarget({ ...input, address: sourceAddress, label: "OracleSource" });
      instruction = oracleInstructionBuilders.buildProposeOracleSourceV3Instruction({ programId: input.programId, params: {
        sourceId, bucketId, sourceTypeHash: currentOracleSourceTypeHash(request.sourceType), canonicalLocatorHash: oracleCanonicalLocatorHash(request.canonicalLocator), sourceDefinitionHash: currentOracleSourceDefinitionHash(request.sourceDefinition), listingBond, skuIndex: proof.skuIndex, skuProof: proof.skuProof,
      }, accounts: { proposer: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, skuPoolPda: pool.address } });
      instructionName = "ProposeOracleSourceV3"; tag = 182;
      Object.assign(actionFacts, { source: sourceAddress.toBase58(), skuIndex: proof.skuIndex, skuRootHex: proof.requiredSkuRoot.toString("hex"), listingBondAtomic: listingBond.toString() });
      break;
    }
    case "support_oracle_source_v3": {
      const month = requireMonth(input); await requireSourceSubmissionOrPlacementWindow(input, month, request.actionType);
      if (month.weightSchemeVersion === 255) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_WEIGHT_SCHEME_INVALID", "source support cannot use the unresolved weight-scheme marker");
      }
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"));
      if (source.proposer.equals(owner) || source.status !== "Candidate") throw new CurrentOraclePlannerError("CURRENT_ORACLE_SOURCE_INVALID", "support requires a different owner and a Candidate source");
      const skuId = encodeCurrentOracleLabelBytes32(request.skuId, "skuId");
      if (!source.bucketId.equals(skuId)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_SOURCE_INVALID", "support skuId differs from the source bucketId");
      const proof = await getCurrentGovernedSkuProof(input.market.seriesIdentity.product, request.skuId); const schedule = await readRewardSchedule(input); const pool = await readSkuPool(input, source.bucketId); const sourceReward = await readSourceReward(input, source); const coverageRecord = await readOptionalSkuCoverageRecord(input, source.bucketId, proof.skuIndex); const stake = u64(request.stakeAtomic, "stakeAtomic", true);
      if (schedule.phase !== "Funded" || sourceReward.registered || (coverageRecord === null && source.supportStakeTotal !== 0n)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "source support schedule/reward/coverage state is invalid");
      if (stake !== pool.supportBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_BOND_MISMATCH", "stakeAtomic differs from the frozen SKU support bond");
      await requireUserCollateral(input, owner, stake);
      instruction = oracleInstructionBuilders.buildSupportOracleSourceV3Instruction({ programId: input.programId, params: { stake, skuId, skuIndex: proof.skuIndex, skuProof: proof.skuProof }, accounts: { supporter: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, skuPoolPda: pool.address, oracleSourcePda: source.address } });
      instructionName = "SupportOracleSourceV3"; tag = 183; Object.assign(actionFacts, { source: source.address.toBase58(), skuIndex: proof.skuIndex, stakeAtomic: stake.toString() });
      break;
    }
    case "challenge_oracle_source_v2": {
      const month = requireMonth(input);
      await requireKillWindow(input, month, request.actionType);
      if (month.weightSchemeVersion === 255) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_WEIGHT_SCHEME_INVALID", "source challenge cannot use the unresolved weight-scheme marker");
      }
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"));
      const pool = await readSkuPool(input, source.bucketId);
      const schedule = await readRewardSchedule(input);
      const comparison = request.comparisonSourceId === undefined ? null : await readSource(input, parseCurrentOracleHex32(request.comparisonSourceId, "comparisonSourceId"));
      if (
        source.status !== "Candidate"
        || source.proposer.equals(owner)
        || schedule.phase !== "Funded"
        || !pool.schedule.equals(schedule.address)
        || (request.reasonCode === 8) !== (comparison !== null)
        || comparison?.address.equals(source.address)
        || (comparison !== null && (comparison.status !== "Candidate" || !comparison.bucketId.equals(source.bucketId)))
      ) throw new CurrentOraclePlannerError("CURRENT_ORACLE_SOURCE_INVALID", "source challenge source/SKU/schedule/comparison state is invalid");
      const requiredBond = challengeBond(comparison === null ? source.supportStakeTotal : source.supportStakeTotal > comparison.supportStakeTotal ? source.supportStakeTotal : comparison.supportStakeTotal, pool.challengeBondBps, pool.challengeMinBond, pool.challengeMaxBond);
      if (u64(request.bondAtomic, "bondAtomic", true) !== requiredBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_BOND_MISMATCH", "source challenge bond differs from frozen economics");
      const challengeId = parseCurrentOracleHex32(request.challengeId, "challengeId");
      const challengeAddress = deriveOracleSourceChallengePda({
        oracleMonthPda: input.oracleMonthAddress,
        oracleSourcePda: source.address,
        challengeId,
        programId: input.programId,
      });
      await Promise.all([
        requireCreateTarget({ ...input, address: challengeAddress, label: "OracleSourceChallenge" }),
        requireAcquireableSourceChallengeGuard(input, source),
        ...(comparison === null ? [] : [requireAcquireableSourceChallengeGuard(input, comparison)]),
        requireUserCollateral(input, owner, requiredBond),
      ]);
      instruction = oracleInstructionBuilders.buildChallengeOracleSourceV2Instruction({ programId: input.programId, params: { challengeId, reason: safeU16(request.reasonCode, "reasonCode"), bond: requiredBond, evidenceHash: parseCurrentOracleHex32(request.evidenceHashHex, "evidenceHashHex"), comparisonSourceId: comparison?.sourceId }, accounts: { challenger: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, rewardSchedulePda: pool.schedule, skuPoolPda: pool.address, oracleSourcePda: source.address, comparisonOracleSourcePda: comparison?.address } });
      instructionName = "ChallengeOracleSourceV2"; tag = 161; Object.assign(actionFacts, { source: source.address.toBase58(), comparisonSource: comparison?.address.toBase58() ?? null, requiredBondAtomic: requiredBond.toString() });
      break;
    }
    case "submit_oracle_opening_claim_v2": {
      const month = requireMonth(input);
      const openingWindow = await requireOpeningWindow(input, month, request.actionType);
      requireCanonicalOpeningWeightScheme(month);
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"), true);
      const pool = await readSkuPool(input, source.bucketId);
      const stake = u64(request.stakeAtomic, "stakeAtomic", true);
      if (source.status !== "Frozen" || source.openingSubmitted || stake !== pool.openingBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "opening submission source state or frozen bond is invalid");
      const sourceTime = u64(request.sourceTimeUnix, "sourceTimeUnix", true);
      if (sourceTime < openingWindow.openingStart || sourceTime > openingWindow.now || sourceTime > input.market.expiryTs) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "opening source time is outside the finalized current evidence interval");
      }
      const claimTarget = await requireAcquireableOpeningClaim(input, source);
      await requireUserCollateral(input, owner, stake);
      instruction = oracleInstructionBuilders.buildSubmitOracleOpeningClaimV2Instruction({ programId: input.programId, params: { openingState: u64(request.openingStateAtomic, "openingStateAtomic", true), sourceTime, stake, canonicalLocatorHash: source.canonicalLocatorHash, sourceDefinitionHash: source.sourceDefinitionHash, archiveUrl: request.archiveUrl }, accounts: { claimant: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, skuPoolPda: pool.address, oracleSourcePda: source.address } });
      instructionName = "SubmitOracleOpeningClaimV2"; tag = 162; Object.assign(actionFacts, { source: source.address.toBase58(), openingClaim: claimTarget.address.toBase58(), openingAttempt: claimTarget.nextAttempt, stakeAtomic: stake.toString() });
      break;
    }
    case "challenge_oracle_opening_claim_v2": {
      const month = requireMonth(input);
      const openingWindow = await requireOpeningWindow(input, month, request.actionType);
      requireCanonicalOpeningWeightScheme(month);
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"), true);
      const pool = await readSkuPool(input, source.bucketId);
      const claim = await readOpeningClaim(input, source);
      const slot = BigInt(await input.connection.getSlot(input.commitment));
      if (source.status !== "OpeningPending" || claim.status !== "Pending" || claim.escrowDisposition !== "Unsettled" || claim.claimant.equals(owner) || claim.challengeDeadlineSlot === 0n || slot >= claim.challengeDeadlineSlot) throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "opening claim is not challengeable by this owner at the finalized slot");
      const alternativeState = u64(request.alternativeOpeningStateAtomic, "alternativeOpeningStateAtomic", true); const alternativeTime = u64(request.alternativeSourceTimeUnix, "alternativeSourceTimeUnix", true);
      if (alternativeTime < openingWindow.openingStart || alternativeTime > openingWindow.now || alternativeTime > input.market.expiryTs) throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "alternative opening source time is outside the finalized current evidence interval");
      if (alternativeState === claim.openingState && alternativeTime === claim.sourceTime && oracleOpeningArchiveUrlHash(request.archiveUrl).equals(claim.archiveUrlHash)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "opening challenge alternative is a no-op");
      const requiredBond = challengeBond(claim.stake, pool.challengeBondBps, pool.challengeMinBond, pool.challengeMaxBond); if (u64(request.bondAtomic, "bondAtomic", true) !== requiredBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_BOND_MISMATCH", "opening challenge bond differs from frozen economics");
      const challengeId = parseCurrentOracleHex32(request.challengeId, "challengeId");
      await Promise.all([
        requireCreateTarget({ ...input, address: deriveOracleOpeningClaimChallengePda({ oracleMonthPda: input.oracleMonthAddress, openingClaimPda: claim.address, challengeId, programId: input.programId }), label: "OracleOpeningClaimChallenge" }),
        requireUserCollateral(input, owner, requiredBond),
      ]);
      instruction = oracleInstructionBuilders.buildChallengeOracleOpeningClaimV2Instruction({ programId: input.programId, params: { challengeId, alternativeOpeningState: alternativeState, alternativeSourceTime: alternativeTime, bond: requiredBond, canonicalLocatorHash: source.canonicalLocatorHash, sourceDefinitionHash: source.sourceDefinitionHash, archiveUrl: request.archiveUrl }, accounts: { challenger: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, skuPoolPda: pool.address, oracleSourcePda: source.address } });
      instructionName = "ChallengeOracleOpeningClaimV2"; tag = 163; Object.assign(actionFacts, { source: source.address.toBase58(), openingClaim: claim.address.toBase58(), requiredBondAtomic: requiredBond.toString() });
      break;
    }
    case "finalize_oracle_opening_claim_v2": {
      const month = requireMonth(input); await requireOpeningWindow(input, month, request.actionType); const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"), true); const claim = await readOpeningClaim(input, source); const slot = BigInt(await input.connection.getSlot(input.commitment));
      if (source.status !== "OpeningPending" || source.openingSubmitted || claim.status !== "Pending" || claim.escrowDisposition !== "Unsettled" || claim.challengeDeadlineSlot === 0n || slot < claim.challengeDeadlineSlot || claim.openingState === 0n || claim.evidenceHash.equals(ZERO_32)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_OPENING_INVALID", "opening claim is not permissionlessly finalizable at the finalized slot");
      await requireUserCollateral(input, claim.claimant);
      instruction = oracleInstructionBuilders.buildFinalizeOracleOpeningClaimV2Instruction({ programId: input.programId, accounts: { cranker: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, claimantCollateralPda: deriveUserCollateralPda(claim.claimant, input.programId) } });
      instructionName = "FinalizeOracleOpeningClaimV2"; tag = 165; Object.assign(actionFacts, { source: source.address.toBase58(), openingClaim: claim.address.toBase58(), claimant: claim.claimant.toBase58() });
      break;
    }
    case "commit_oracle_update_claim_v3": {
      const month = requireMonth(input);
      const now = await requireGameWindow(input, month, request.actionType);
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"), true, false);
      const pool = await readSkuPool(input, source.bucketId);
      const activeWeightManifestPda = await validateActiveWeightManifest(input);
      const claimId = parseCurrentOracleHex32(request.claimId, "claimId");
      const priorState = u64(request.priorStateAtomic, "priorStateAtomic", true);
      const nextState = u64(request.newStateAtomic, "newStateAtomic", true);
      const sourceTime = u64(request.sourceTimeUnix, "sourceTimeUnix", true);
      const evidenceHash = parseCurrentOracleHex32(request.evidenceHashHex, "evidenceHashHex");
      const secretSalt = parseCurrentOracleHex32(request.secretSaltHex, "secretSaltHex");
      const stake = u64(request.stakeAtomic, "stakeAtomic", true);
      if (source.status !== "Active" || !source.openingSubmitted || source.currentState === 0n || priorState !== source.currentState || nextState === priorState || stake !== pool.updateMinBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_UPDATE_INVALID", "update commit state or frozen bond is invalid");
      validateCurrentUpdateEvidence({ planner: input, month, source, state: nextState, sourceTime, evidenceHash, archiveUrl: request.archiveUrl, now });
      const claimAddress = deriveOracleUpdateClaimV2Pda({ oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, claimant: owner, claimId, programId: input.programId }); await requireCreateTarget({ ...input, address: claimAddress, label: "OracleUpdateClaimV2" });
      await requireUserCollateral(input, owner, stake);
      const commitHash = oracleUpdateClaimV2CommitHash({ programId: input.programId, oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, sourceId: source.sourceId, claimant: owner, claimId, priorState, newState: nextState, sourceTime, evidenceHash, archiveUrl: request.archiveUrl, secretSalt });
      instruction = oracleInstructionBuilders.buildCommitOracleUpdateClaimV3Instruction({ programId: input.programId, params: { claimId, commitHash, stake }, accounts: { claimant: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, skuPoolPda: pool.address, activeWeightManifestPda } });
      instructionName = "CommitOracleUpdateClaimV3"; tag = 166; Object.assign(actionFacts, { source: source.address.toBase58(), updateClaim: claimAddress.toBase58(), commitHashHex: commitHash.toString("hex"), stakeAtomic: stake.toString() });
      break;
    }
    case "reveal_oracle_update_claim_v3": {
      const month = requireMonth(input);
      const now = await requireGameWindow(input, month, request.actionType);
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"), true, false);
      const activeWeightManifestPda = await validateActiveWeightManifest(input);
      const claimId = parseCurrentOracleHex32(request.claimId, "claimId");
      const claim = await readUpdateClaim(input, source, owner, claimId);
      const priorState = u64(request.priorStateAtomic, "priorStateAtomic", true);
      const nextState = u64(request.newStateAtomic, "newStateAtomic", true);
      const sourceTime = u64(request.sourceTimeUnix, "sourceTimeUnix", true);
      const evidenceHash = parseCurrentOracleHex32(request.evidenceHashHex, "evidenceHashHex");
      const secretSalt = parseCurrentOracleHex32(request.secretSaltHex, "secretSaltHex");
      validateCurrentUpdateEvidence({ planner: input, month, source, state: nextState, sourceTime, evidenceHash, archiveUrl: request.archiveUrl, now });
      const slot = BigInt(await input.connection.getSlot(input.commitment));
      const expectedCommit = oracleUpdateClaimV2CommitHash({ programId: input.programId, oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, sourceId: source.sourceId, claimant: owner, claimId, priorState, newState: nextState, sourceTime, evidenceHash, archiveUrl: request.archiveUrl, secretSalt });
      if (
        source.status !== "Active"
        || !source.openingSubmitted
        || claim.status !== "Committed"
        || claim.escrowDisposition !== "Unsettled"
        || claim.priorState !== 0n
        || claim.newState !== 0n
        || claim.sourceTime !== 0n
        || !claim.evidenceHash.equals(ZERO_32)
        || !claim.archiveUrlHash.equals(ZERO_32)
        || claim.freshnessRewardMultiplier !== 1
        || claim.revealedSlot !== 0n
        || slot < claim.earliestRevealSlot
        || slot > claim.revealDeadlineSlot
        || !claim.commitHash.equals(expectedCommit)
        || priorState !== source.currentState
        || nextState === priorState
      ) throw new CurrentOraclePlannerError("CURRENT_ORACLE_UPDATE_INVALID", "update reveal does not match the current commitment/window/source state");
      instruction = oracleInstructionBuilders.buildRevealOracleUpdateClaimV3Instruction({ programId: input.programId, params: { claimId, priorState, newState: nextState, sourceTime, evidenceHash, archiveUrl: request.archiveUrl, secretSalt }, accounts: { claimant: owner, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source.address, activeWeightManifestPda } });
      instructionName = "RevealOracleUpdateClaimV3"; tag = 198; Object.assign(actionFacts, { source: source.address.toBase58(), updateClaim: claim.address.toBase58(), commitmentVerified: true });
      break;
    }
    case "challenge_oracle_update_claim_v2": {
      const month = requireMonth(input);
      const now = await requireGameWindow(input, month, request.actionType);
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"), true, false);
      const claimant = new PublicKey(request.claimantPubkey);
      const claimId = parseCurrentOracleHex32(request.claimId, "claimId");
      const claim = await readUpdateClaim(input, source, claimant, claimId);
      const pool = await readSkuPool(input, source.bucketId);
      const alternativeState = u64(request.alternativeStateAtomic, "alternativeStateAtomic", true);
      const alternativeSourceTime = u64(request.alternativeSourceTimeUnix, "alternativeSourceTimeUnix", true);
      const evidenceHash = parseCurrentOracleHex32(request.evidenceHashHex, "evidenceHashHex");
      const archiveUrlHash = validateCurrentUpdateEvidence({ planner: input, month, source, state: alternativeState, sourceTime: alternativeSourceTime, evidenceHash, archiveUrl: request.archiveUrl, now });
      const requiredBond = challengeBond(claim.stake, pool.challengeBondBps, pool.challengeMinBond, pool.challengeMaxBond);
      const challengeId = parseCurrentOracleHex32(request.challengeId, "challengeId");
      if (source.status !== "Active" || claim.status !== "Revealed" || claim.escrowDisposition !== "Unsettled" || !source.openingSubmitted || claim.priorState !== source.currentState || claim.sourceTime === 0n || claim.evidenceHash.equals(ZERO_32) || claim.archiveUrlHash.equals(ZERO_32) || (claim.freshnessRewardMultiplier !== 1 && claim.freshnessRewardMultiplier !== 3) || claimant.equals(owner) || alternativeState === claim.newState || alternativeState === source.currentState || (alternativeState === claim.newState && alternativeSourceTime === claim.sourceTime && archiveUrlHash.equals(claim.archiveUrlHash)) || u64(request.bondAtomic, "bondAtomic", true) !== requiredBond) throw new CurrentOraclePlannerError("CURRENT_ORACLE_UPDATE_INVALID", "update challenge state, alternative, owner, or bond is invalid");
      await Promise.all([
        requireCreateTarget({ ...input, address: deriveOracleUpdateChallengePda({ oracleMonthPda: input.oracleMonthAddress, updateClaimPda: claim.address, challengeId, programId: input.programId }), label: "OracleUpdateChallenge" }),
        requireCreateTarget({ ...input, address: deriveOracleUpdateChallengeGuardPda({ oracleMonthPda: input.oracleMonthAddress, updateClaimPda: claim.address, programId: input.programId }), label: "OracleUpdateChallengeGuard" }),
        requireUserCollateral(input, owner, requiredBond),
      ]);
      instruction = oracleInstructionBuilders.buildChallengeOracleUpdateClaimV2Instruction({ programId: input.programId, params: { claimId, challengeId, alternativeState, alternativeSourceTime, bond: requiredBond, evidenceHash, archiveUrl: request.archiveUrl }, accounts: { challenger: owner, claimant, marketPda: input.marketAddress, oracleMonthPda: input.oracleMonthAddress, skuPoolPda: pool.address, updateClaimPda: claim.address, oracleSourcePda: source.address } });
      instructionName = "ChallengeOracleUpdateClaimV2"; tag = 168; Object.assign(actionFacts, { source: source.address.toBase58(), updateClaim: claim.address.toBase58(), requiredBondAtomic: requiredBond.toString() });
      break;
    }
    case "finalize_oracle_update_claim_v2": {
      const month = requireMonth(input);
      if (!owner.equals(input.vaultConfig.oracleAuthority)) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_AUTHORITY_REQUIRED", `update finalization requires oracle authority ${input.vaultConfig.oracleAuthority.toBase58()} as signer; supplied ${owner.toBase58()}`);
      }
      await requireCashUpdateResolutionWindow(input, month, request.actionType);
      const source = await readSource(input, parseCurrentOracleHex32(request.sourceId, "sourceId"));
      const claimant = new PublicKey(request.claimantPubkey);
      const claimId = parseCurrentOracleHex32(request.claimId, "claimId");
      const claim = await readUpdateClaim(input, source, claimant, claimId);
      const challengeId = request.challengeId === undefined ? undefined : parseCurrentOracleHex32(request.challengeId, "challengeId");
      const currentStep = u64(request.currentStep, "currentStep", true);
      if (
        (request.outcome !== "accept_claim" && challengeId === undefined)
        || currentStep <= source.lastFinalizedStep
        || source.status !== "Active"
        || !source.openingSubmitted
        || claim.status !== "Revealed"
        || claim.escrowDisposition !== "Unsettled"
        || claim.sambaCheckpointActive
        || claim.priorState !== source.currentState
        || claim.priorState === 0n
        || claim.newState === 0n
        || claim.priorState === claim.newState
        || claim.sourceTime === 0n
        || claim.evidenceHash.equals(ZERO_32)
        || claim.archiveUrlHash.equals(ZERO_32)
        || (claim.freshnessRewardMultiplier !== 1 && claim.freshnessRewardMultiplier !== 3)
        || claim.revealedSlot === 0n
      ) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_UPDATE_INVALID", "update finalization claim/currentStep/source state is invalid");
      }

      const guardAddress = deriveOracleUpdateChallengeGuardPda({
        oracleMonthPda: input.oracleMonthAddress,
        updateClaimPda: claim.address,
        programId: input.programId,
      });
      let challenge: OracleUpdateChallengeState | undefined;
      if (challengeId === undefined) {
        await requireCreateTarget({ ...input, address: guardAddress, label: "absent OracleUpdateChallengeGuard" });
      } else {
        challenge = await readUpdateChallenge(input, claim, challengeId);
        const guard = await readUpdateChallengeGuard(input, claim, challenge);
        if (
          challenge.status !== "RuleReview"
          || challenge.escrowDisposition !== "Unsettled"
          || challenge.alternativeState === source.currentState
          || challenge.emergencySnapshotTotalMajorTokens !== 0n
          || !guard.activeDispute.equals(PublicKey.default)
          || guard.resolutionStep !== 0n
        ) {
          throw new CurrentOraclePlannerError("CURRENT_ORACLE_UPDATE_INVALID", "update challenge/guard is not the live RuleReview state");
        }
      }
      const activeWeightManifestPda = await validateActiveWeightManifest(input);
      const unresolved = request.outcome === "rule_review_unresolved";
      if (unresolved && month.workRewardCurrencyVersion !== 1) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_UPDATE_INVALID", "unresolved review requires current USDC work-reward policy");
      }
      const unresolvedVoting = unresolved ? await validateUnresolvedVotingState(input) : undefined;
      instruction = oracleInstructionBuilders.buildFinalizeOracleUpdateClaimV2Instruction({
        programId: input.programId,
        params: { claimId, challengeId, outcome: request.outcome, currentStep },
        accounts: {
          authority: owner,
          claimant,
          marketPda: input.marketAddress,
          oracleMonthPda: input.oracleMonthAddress,
          oracleSourcePda: source.address,
          activeWeightManifestPda,
          bucketId: source.bucketId,
          updateClaimPda: claim.address,
          updateChallengePda: challenge?.address,
          updateChallengeGuardPda: guardAddress,
          stakingPoolPda: unresolvedVoting?.stakingPool,
          sambaMintPda: unresolvedVoting?.sambaMint,
        },
      });
      instructionName = "FinalizeOracleUpdateClaimV2";
      tag = 199;
      Object.assign(actionFacts, {
        source: source.address.toBase58(),
        updateClaim: claim.address.toBase58(),
        currentStep: currentStep.toString(),
        challengeId: request.challengeId ?? null,
        challenge: challenge?.address.toBase58() ?? null,
        outcome: request.outcome,
        sambaSnapshotSupplyAtomic: unresolvedVoting?.liveSambaSupply.toString() ?? null,
      });
      break;
    }
    case "commit_oracle_emergency_vote_v3": {
      const disputeId = parseCurrentOracleHex32(request.disputeId, "disputeId");
      const dispute = await readEmergencyDispute(input, disputeId);
      const staking = await validateUnresolvedVotingState(input);
      const pot = await readEmergencyPot(input, dispute);
      const choice = currentOracleEmergencyChoiceIndex(request.disputeKind, request.choice);
      const amount = u64(request.sambaAmountAtomic, "sambaAmountAtomic", true);
      const slot = BigInt(await input.connection.getSlot(input.commitment));
      if (
        dispute.kind !== request.disputeKind
        || dispute.status !== "Open"
        || staking.governanceLockCount === 0n
        || dispute.snapshotTotalMajorTokens !== staking.sambaSupply
        || slot > dispute.commitDeadlineSlot
        || amount < dispute.minimumVoteAmount
        || choice >= dispute.choiceCount
        || dispute.committedVoteCount >= ORACLE_MAX_V3_VOTERS
        || dispute.committedPower + amount > U64_MAX
        || dispute.committedPower + amount > dispute.snapshotTotalMajorTokens
        || pot.tokenAmount + amount > U64_MAX
      ) throw new CurrentOraclePlannerError("CURRENT_ORACLE_EMERGENCY_INVALID", "emergency vote admission, staking snapshot, totals, or commit window is invalid");
      const voteAddress = deriveOracleEmergencyVoteV3Pda({ emergencyDisputePda: dispute.address, voter: owner, programId: input.programId });
      await requireCreateTarget({ ...input, address: voteAddress, label: "OracleEmergencyVoteV3" });
      const sambaMint = staking.sambaMint;
      const voterToken = getAssociatedTokenAddressSync(sambaMint, owner, false, SPL_TOKEN_PROGRAM_ID);
      validateVoterSambaToken({ address: voterToken, info: await input.connection.getAccountInfo(voterToken, input.commitment), mint: sambaMint, owner, minimum: amount });
      const commitHash = oracleEmergencyVoteV3CommitHash({ programId: input.programId, emergencyDisputePda: dispute.address, disputeId, voter: owner, sambaAmount: amount, sambaMintPda: sambaMint, choice, salt: parseCurrentOracleHex32(request.secretSaltHex, "secretSaltHex") });
      instruction = oracleInstructionBuilders.buildCommitOracleEmergencyVoteV3Instruction({ programId: input.programId, params: { commitHash, sambaAmount: amount }, accounts: { voter: owner, voterSambaTokenAccount: voterToken, emergencyDisputePda: dispute.address } });
      instructionName = "CommitOracleEmergencyVoteV3"; tag = 176; Object.assign(actionFacts, { dispute: dispute.address.toBase58(), pot: pot.address.toBase58(), vote: voteAddress.toBase58(), commitHashHex: commitHash.toString("hex"), sambaAmountAtomic: amount.toString(), snapshotSambaSupplyAtomic: staking.sambaSupply.toString() });
      break;
    }
    case "reveal_oracle_emergency_vote_v2": {
      const disputeId = parseCurrentOracleHex32(request.disputeId, "disputeId");
      const dispute = await readEmergencyDispute(input, disputeId);
      const pot = await readEmergencyPot(input, dispute);
      const vote = await readEmergencyVote(input, dispute, owner);
      const choice = currentOracleEmergencyChoiceIndex(request.disputeKind, request.choice);
      const slot = BigInt(await input.connection.getSlot(input.commitment));
      const salt = parseCurrentOracleHex32(request.secretSaltHex, "secretSaltHex");
      const expected = oracleEmergencyVoteV3CommitHash({ programId: input.programId, emergencyDisputePda: dispute.address, disputeId, voter: owner, sambaAmount: vote.lockedAmount, sambaMintPda: vote.sambaMint, choice, salt });
      if (
        dispute.kind !== request.disputeKind
        || dispute.status !== "Open"
        || vote.status !== "Committed"
        || vote.escrowDisposition !== "Unsettled"
        || vote.choice !== 0
        || vote.revealedSlot !== 0n
        || slot <= dispute.commitDeadlineSlot
        || slot > dispute.revealDeadlineSlot
        || choice >= dispute.choiceCount
        || dispute.revealedPower + vote.votingPower > U64_MAX
        || dispute.revealedPower + vote.votingPower > dispute.committedPower
        || dispute.revealedVoteCount + 1 > dispute.committedVoteCount
        || !vote.pot.equals(pot.address)
        || !vote.commitHash.equals(expected)
      ) throw new CurrentOraclePlannerError("CURRENT_ORACLE_EMERGENCY_INVALID", "emergency reveal does not match the current vote commitment/window/accounting");
      instruction = oracleInstructionBuilders.buildRevealOracleEmergencyVoteV2Instruction({ programId: input.programId, params: { choice, salt }, accounts: { voter: owner, emergencyDisputePda: dispute.address } });
      instructionName = "RevealOracleEmergencyVoteV2"; tag = 177; Object.assign(actionFacts, { dispute: dispute.address.toBase58(), vote: vote.address.toBase58(), commitmentVerified: true });
      break;
    }
    case "deposit_oracle_usdc_rewards": {
      const amount = u64(request.amountAtomic, "amountAtomic", true); const rewardVault = await readRewardVault(input); if (rewardVault.tokenAmount + amount > U64_MAX) throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "reward-vault deposit would overflow the classic SPL amount"); const funderToken = getAssociatedTokenAddressSync(input.vaultConfig.usdcMint, owner, false, SPL_TOKEN_PROGRAM_ID); validateClassicToken({ address: funderToken, info: await input.connection.getAccountInfo(funderToken, input.commitment), mint: input.vaultConfig.usdcMint, owner, minimum: amount });
      instruction = oracleInstructionBuilders.buildDepositOracleUsdcRewardsInstruction({ programId: input.programId, params: { amount }, accounts: { funder: owner, collateralMint: input.vaultConfig.usdcMint, funderTokenAccount: funderToken } });
      instructionName = "DepositOracleUsdcRewards"; tag = 155; Object.assign(actionFacts, { amountAtomic: amount.toString(), rewardVault: rewardVault.address.toBase58(), rewardVaultTokenAccount: rewardVault.tokenAccount.toBase58() });
      break;
    }
    case "claim_oracle_usdc_reward": {
      const recipientCollateral = await requireUserCollateral(input, owner);
      const { instructionInput, entitlementAmount, schedule, actionFacts: rewardFacts } = await readCurrentOracleRewardEntitlementInputs({ ...input, request });
      const rewardVault = await readRewardVault(input);
      if (!schedule.rewardVault.equals(rewardVault.address)) throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "reward schedule is not bound to canonical custody");
      validateClassicToken({ address: input.vaultConfig.vaultTokenAccount,
        info: await input.connection.getAccountInfo(input.vaultConfig.vaultTokenAccount, input.commitment),
        mint: input.vaultConfig.usdcMint, owner: input.vaultConfigAddress });
      instruction = oracleInstructionBuilders.buildClaimOracleUsdcRewardInstruction(instructionInput);
      Object.assign(actionFacts, rewardFacts);
      if (
        entitlementAmount > schedule.remainingRewardBudget
        || entitlementAmount > rewardVault.totalReserved
        || entitlementAmount > rewardVault.tokenAmount
        || recipientCollateral.availableBalance + entitlementAmount > U64_MAX
        || rewardVault.totalPaid + entitlementAmount > U64_MAX
      ) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "reward entitlement exceeds current schedule, custody reserves, or recipient collateral capacity");
      }
      const rewardReceipt = semanticCurrentSpreadInstructionV1(instruction).keys[10]?.pubkey;
      if (rewardReceipt === undefined) {
        throw new CurrentOraclePlannerError("CURRENT_ORACLE_ACCOUNT_IDENTITY_MISMATCH", "reward builder omitted the canonical receipt account");
      }
      Object.assign(actionFacts, { entitlementAmountAtomic: entitlementAmount.toString(),
        rewardSchedule: schedule.address.toBase58(), rewardReceipt: rewardReceipt.toBase58(),
        recipientCollateral: deriveUserCollateralPda(owner, input.programId).toBase58() });
      instructionName = "ClaimOracleUsdcReward";
      tag = 174;
      break;
    }
  }

  if (disputeFrame !== null) actionFacts.disputeEvidenceJson = await disputeFrame.finish();
  const exactCompressedObservations = await exactCompressedObservationsForInstruction(input, instruction);
  return Object.freeze({
    actionType: request.actionType,
    request: redacted,
    instructionName,
    tag,
    instruction,
    signer: owner,
    proofFacts: Object.freeze({ ...commonProof, ...actionFacts }),
    compressedObservations: exactCompressedObservations,
  });
}

export type CurrentOracleRewardRequest = Extract<CurrentOracleActionRequest, { readonly actionType: "claim_oracle_usdc_reward" }>;

/** Shared entitlement read: no instruction construction, collateral initialization, signing or submission. */
export async function readCurrentOracleRewardEntitlementInputs(input: CurrentOraclePlannerContext & { readonly request: CurrentOracleRewardRequest }) {
  const request = validateCurrentOracleActionRequest(input.request);
  if (request.actionType !== "claim_oracle_usdc_reward") throw new CurrentOraclePlannerError("CURRENT_ORACLE_REQUEST_INVALID", "reward request required");
  requireMonth(input);
  const owner = new PublicKey(request.ownerPubkey);
  const schedule = await readRewardSchedule(input);
  if (schedule.phase !== "EntitlementsFinalized") throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_PHASE_INVALID", "reward entitlements are not finalized");
  const actionFacts: Record<string, string | number | boolean | null> = {};
  let instructionInput: Parameters<typeof currentOracleInstructionBuilders.buildClaimOracleUsdcRewardInstruction>[0];
      const sourceId = parseCurrentOracleHex32(request.sourceId, "sourceId");
      const originalSourceAddress = deriveOracleSourcePda({
        oracleMonthPda: input.oracleMonthAddress,
        sourceId,
        programId: input.programId,
      });
      let entitlementAmount: bigint;

      if (request.rewardKind === "update") {
        if (request.claimId === undefined) {
          throw new CurrentOraclePlannerError("CURRENT_ORACLE_REQUEST_INVALID", "update reward requires claimId");
        }
        const claim = await readUpdateClaimByIdentity(
          input,
          originalSourceAddress,
          sourceId,
          owner,
          parseCurrentOracleHex32(request.claimId, "claimId"),
        );
        if (claim.status !== "Finalized") {
          throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "update reward claim is not finalized");
        }
        const registration = await readUpdateRewardRegistration(input, schedule.address, claim.address, owner);
        const pool = await readSkuPoolByAddress(input, registration.skuPool);
        if (pool.registeredUpdateCount === 0) {
          throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "update reward SKU has no registered updates");
        }
        entitlementAmount = currentRewardEntitlement({ kind: "update", pool, rewardUnits: registration.rewardUnits }).amount;
        instructionInput = ({
          programId: input.programId,
          params: { rewardKind: "update" },
          accounts: {
            recipient: owner,
            marketPda: input.marketAddress,
            oracleMonthPda: input.oracleMonthAddress,
            collateralMint: input.vaultConfig.usdcMint,
            vaultTokenAccount: input.vaultConfig.vaultTokenAccount,
            skuPoolPda: pool.address,
            rewardRegistrationPda: registration.address,
            updateClaimPda: claim.address,
          },
        });
        Object.assign(actionFacts, {
          rewardKind: request.rewardKind,
          originalSource: originalSourceAddress.toBase58(),
          canonicalSource: null,
          mergeDepth: 0,
          rewardRegistration: registration.address.toBase58(),
          updateClaim: claim.address.toBase58(),
        });
      } else {
        let canonicalSourceAddress = originalSourceAddress;
        let retainedSkuPool: PublicKey | undefined;
        const lineage: { oracleSourcePda: PublicKey; sourceRewardPda: PublicKey; mergedIntoSourcePda: PublicKey }[] = [];
        if (request.rewardKind === "support") {
          const seen = new Set<string>();
          for (let depth = 0; depth <= MAX_MERGE_DEPTH; depth += 1) {
            const sourceKey = canonicalSourceAddress.toBase58();
            if (seen.has(sourceKey)) {
              throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "source merge lineage contains a cycle");
            }
            seen.add(sourceKey);
            const retainedRewardAddress = deriveOracleUsdcSourceRewardPda({
              rewardSchedulePda: schedule.address,
              oracleSourcePda: canonicalSourceAddress,
              programId: input.programId,
            });
            const retainedInfo = await input.connection.getAccountInfo(retainedRewardAddress, input.commitment);
            if (
              retainedInfo === null
              || (
                retainedInfo.data.length === 0
                && retainedInfo.owner.equals(SystemProgram.programId)
                && !retainedInfo.executable
              )
            ) {
              break;
            }
            if (depth === MAX_MERGE_DEPTH) {
              throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "source merge lineage exceeds the current bound");
            }
            const retainedReward = await readClassicSourceReward(input, canonicalSourceAddress);
            if (
              (depth === 0 && !retainedReward.sourceId.equals(sourceId))
              || retainedReward.registered
              || retainedReward.terminalStatus !== "Candidate"
              || retainedReward.mergedIntoSource.equals(PublicKey.default)
              || (retainedSkuPool !== undefined && !retainedReward.skuPool.equals(retainedSkuPool))
            ) {
              throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "retained source merge reward is not a valid current lineage hop");
            }
            retainedSkuPool ??= retainedReward.skuPool;
            lineage.push({
              oracleSourcePda: canonicalSourceAddress,
              sourceRewardPda: retainedReward.address,
              mergedIntoSourcePda: retainedReward.mergedIntoSource,
            });
            canonicalSourceAddress = retainedReward.mergedIntoSource;
          }
        }

        const source = await readSourceByAddress(
          input,
          canonicalSourceAddress,
          lineage.length === 0 ? sourceId : undefined,
          request.rewardKind === "opening",
        );
        const sourceReward = await readSourceReward(input, source);
        const pool = await readSkuPool(input, source.bucketId);
        if (
          !sourceReward.registered
          || !sourceReward.sourceId.equals(source.sourceId)
          || !sourceReward.proposer.equals(source.proposer)
          || sourceReward.terminalStatus !== source.status
          || !sourceReward.mergedIntoSource.equals(PublicKey.default)
          || !sourceReward.skuPool.equals(pool.address)
          || (retainedSkuPool !== undefined && !retainedSkuPool.equals(pool.address))
          || sourceReward.maxMergeDepth < lineage.length
          || !["Active", "Inactive"].includes(source.status)
          || pool.registeredSourceCount === 0
        ) {
          throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "terminal source reward family is invalid");
        }
        const common = {
          recipient: owner,
          marketPda: input.marketAddress,
          oracleMonthPda: input.oracleMonthAddress,
          collateralMint: input.vaultConfig.usdcMint,
          vaultTokenAccount: input.vaultConfig.vaultTokenAccount,
          skuPoolPda: pool.address,
          oracleSourcePda: source.address,
          sourceRewardPda: sourceReward.address,
        };
        if (request.rewardKind === "proposer") {
          if (!source.proposer.equals(owner)) {
            throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_NOT_ENTITLED", "proposer reward owner is not the source proposer");
          }
          instructionInput = ({
            programId: input.programId,
            params: { rewardKind: "proposer" },
            accounts: common,
          });
          entitlementAmount = currentRewardEntitlement({ kind: "proposer", pool, sourceReward }).amount;
        } else if (request.rewardKind === "opening") {
          const opening = await readOpeningClaim(input, source);
          if (
            source.status !== "Active"
            || opening.status !== "Accepted"
            || !sourceReward.openingClaim.equals(opening.address)
            || !opening.claimant.equals(owner)
            || pool.registeredOpeningCount === 0
          ) {
            throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "opening reward identity or entitlement is invalid");
          }
          instructionInput = ({
            programId: input.programId,
            params: { rewardKind: "opening" },
            accounts: { ...common, openingClaimPda: opening.address },
          });
          entitlementAmount = currentRewardEntitlement({ kind: "opening", pool, sourceReward }).amount;
        } else {
          const support = await readSupportPositionByIdentity(input, originalSourceAddress, sourceId, owner);
          if (sourceReward.supporterCount === 0) {
            throw new CurrentOraclePlannerError("CURRENT_ORACLE_REWARD_INVALID", "support reward has no registered supporters");
          }
          instructionInput = ({
            programId: input.programId,
            params: { rewardKind: "support" },
            accounts: {
              ...common,
              supportPositionPda: support.address,
              mergeLineage: lineage,
            },
          });
          entitlementAmount = currentRewardEntitlement({ kind: "support", pool, sourceReward }).amount;
        }
        Object.assign(actionFacts, {
          rewardKind: request.rewardKind,
          originalSource: originalSourceAddress.toBase58(),
          canonicalSource: source.address.toBase58(),
          mergeDepth: lineage.length,
        });
      }

  return { instructionInput, entitlementAmount, schedule, actionFacts };
}
