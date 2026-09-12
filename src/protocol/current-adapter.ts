import { currentOracleActivationSetup, currentOracleActivationSetupManifests } from "./current-oracle-staking-setup.js";
import { currentOracleStakingProofFacts, type CurrentOracleStakingProofFacts } from "./current-oracle-staking-proof.js";
import { deriveCollectiveSettlementDelegatePda } from "./writer-sleeve.js";
import { readCurrentPositionExpiryAutomation, syncCurrentPositionExpiryAutomation, type ReadCurrentPositionExpiryAutomationInput, type SyncCurrentPositionExpiryAutomationInput, type CurrentPositionExpiryProjection } from "./current-position-expiry.js";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  getAssociatedTokenAddressInterface,
  unpackAccount,
  unpackMint,
} from "./current-token-primitives.js";
import {
  batchCpiContext1,
  batchCpiContext2,
  batchCpiContext3,
  batchCpiContext4,
  batchCpiContext5,
  batchMerkleTree1,
  batchMerkleTree2,
  batchMerkleTree3,
  batchMerkleTree4,
  batchMerkleTree5,
  batchQueue1,
  batchQueue2,
  batchQueue3,
  batchQueue4,
  batchQueue5,
  createBN254,
  deriveAddress,
  TreeType,
  type BN254,
} from "@lightprotocol/stateless.js";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PACKET_DATA_SIZE,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  type AccountInfo,
  type AccountMeta,
  type Commitment,
  type Connection,
} from "@solana/web3.js";

import { AmebaProtocolError } from "../errors.js";
import {
  computeCurrentFinalizedObservationDigest,
  validateCurrentFinalizedObservation,
  type CurrentFinalizedObservation,
} from "../current-finalized-observation.js";
import {
  CURRENT_MARKET_ACCOUNT_SIZE,
  CURRENT_ORACLE_MONTH_ACCOUNT_SIZE,
  CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS,
  CURRENT_PROTOCOL_CLUSTER,
  CURRENT_PROTOCOL_DEPLOYMENT,
  CURRENT_PROTOCOL_DEVNET_GENESIS_HASH,
  CURRENT_PROTOCOL_RELEASE,
  CURRENT_PROTOCOL_SOURCE_COMMIT,
  CURRENT_SETTLEMENT_RECORD_V2_ACCOUNT_SIZE,
  CURRENT_USER_COLLATERAL_ACCOUNT_SIZE,
  CURRENT_VAULT_CONFIG_ACCOUNT_SIZE,
  decodeCurrentMarketAccount as decodeStrictMarket,
  decodeCurrentContractMintAccount,
  decodeCurrentLightSplInterfaceAccount,
  decodeCurrentOracleActiveWeightManifestAccount,
  decodeCurrentOracleMonthAccount,
  decodeCurrentOracleSkuCoverageManifestAccount,
  decodeCurrentSettlementRecordV2Account,
  decodeCurrentUserCollateralAccount,
  decodeCurrentVaultConfigAccount,
  discoverCurrentMarkets,
  validateUninitializedCurrentOracleMonthData,
  type CurrentMarketAccount,
  type CurrentOracleMonthAccount,
  type CurrentOracleActiveWeightManifestAccount,
  type CurrentOracleSkuCoverageManifestAccount,
  type CurrentSettlementRecordV2Account,
  type CurrentUserCollateralAccount,
  type CurrentVaultConfigAccount,
} from "./current.js";
import {
  buildInitUserCollateralInstruction,
  buildWithdrawCollateralInstruction,
  decodeCurrentExecuteCompressedStateV1,
} from "./current-instructions.js";
import {
  CURRENT_STATE_NAMESPACE_SEED,
  DEFAULT_AMEBA_SPREAD_PROGRAM_ID,
  LIGHT_TOKEN_CPI_AUTHORITY,
  LIGHT_TOKEN_PROGRAM_ID,
  LIGHT_TOKEN_RENT_SPONSOR,
  ORACLE_PLAYER_LEDGER_PDA_SEED,
  SPL_TOKEN_PROGRAM_ID,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  buildDepositCollateralInstruction,
  decodeOraclePlayerLedgerBalance,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  deriveContractMintPda,
  deriveContractMintStagingPda,
  deriveLightSplInterfacePda,
  deriveMarketPda,
  deriveOracleMonthPda,
  deriveOraclePlayerLedgerPda,
  deriveOracleSkuCoverageManifestPda,
  deriveSettlementRecordV2Pda,
  deriveUserCollateralPda,
  deriveVaultConfigPda,
  fixedBytes32,
  hashBuffers,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveOracleActiveWeightManifestPda } from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  AMOEBA_DLMM_BIN_PAGE_ACCOUNT_SIZE,
  AMOEBA_DLMM_POSITION_ACCOUNT_SIZE,
  AMOEBA_DLMM_POSITION_ACCOUNT_DISCRIMINATOR,
  AMOEBA_DLMM_POSITION_DISCRIMINATOR,
  AMOEBA_DLMM_SHARE_PAGE_ACCOUNT_SIZE,
  MAX_AMOEBA_DLMM_PAGES,
  bitmapPageIndexes,
  decodeAmoebaDlmmBinPage,
  decodeAmoebaDlmmPool,
  decodeAmoebaDlmmPosition,
  decodeAmoebaDlmmSharePage,
  deriveAmoebaDlmmAuthorityPda,
  deriveAmoebaDlmmBinPagePda,
  deriveAmoebaDlmmPoolPda,
  deriveAmoebaDlmmPositionPda,
  deriveAmoebaDlmmSharePagePda,
  deriveAmoebaDlmmVaultPda,
  type AmoebaDlmmBinPageAccount,
  type AmoebaDlmmPoolAccount,
  type AmoebaDlmmPositionAccount,
  type AmoebaDlmmSharePageAccount,
} from "@amoeba/spread-release-tools/dlmm-accounts";
import {
  buildCollectiveAmoebaDlmmSwapExactInInstruction,
  type AmoebaDlmmSwapDirection,
} from "@amoeba/spread-release-tools/dlmm-instructions";
import {
  getAmoebaDlmmBinPage,
  getAmoebaDlmmSharePage,
  type AmoebaDlmmColdAccountLoad,
  type AmoebaDlmmColdAccountResolver,
} from "@amoeba/spread-release-tools/dlmm-light-interface";
import {
  quoteAmoebaDlmmExactIn as quoteAmoebaDlmmPlannerExactIn,
  type AmoebaDlmmClientQuote,
} from "@amoeba/spread-release-tools/dlmm-planner";
import {
  AMOEBA_DLMM_PRICE_SCALE,
  ceilMulDiv,
  floorMulDiv,
  priceFromBin,
} from "@amoeba/spread-release-tools/dlmm-math";
import {
  decodeWriterSettlementGroup,
} from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import {
  WRITER_ACCOUNT_SIZES,
  deriveWriterSettlementGroupPda,
} from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import type { LightAtaReadyActionPlan } from "@amoeba/spread-release-tools/reference-client";
import { requiredCompressedStateAccessesV1 } from "@amoeba/spread-release-tools/compressed-state";
import type { CurrentChainIdentityDto } from "./current-chain.js";
import type {
  CurrentPhotonColdWitness,
  CurrentPhotonCompressedInstructionWitness,
  CurrentPhotonConnection,
  CurrentPhotonLightAtaBalance,
} from "./current-photon.js";
import type {
  CurrentOracleActionRequest,
  CurrentOracleRedactedRequest,
} from "./current-oracle.js";
import {
  CurrentOraclePlannerError,
  prepareCurrentOracleAction,
} from "./current-oracle-planner.js";
import {
  buildCurrentGovernedInstructionV1 as materializeCurrentGovernedInstructionV1,
  type CurrentGovernedBuilderInputV1,
  type CurrentGovernedBuilderNameV1,
  type CurrentGovernedInstructionMaterializationV1,
} from "./current-governed-write.js";
import {
  CURRENT_LIVE_DEPLOYMENT,
  isCurrentWriteReleaseAvailable,
} from "./release-train.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
import {
  prepareBoundCurrentGovernedWriteV1,
  materializeBoundCurrentGovernedBuilderV1,
  isBoundCurrentGovernedProgramV1,
  registerCurrentSpreadGovernedOutputV1,
  revalidateFreshCurrentGovernedInstructionsV1,
  semanticCurrentSpreadInstructionV1,
} from "./current-governed-write-internal.js";
import {
  GOVERNANCE_GATE_STATUS_V1,
  inspectGovernedInstructionEnvelopeV1,
  type GovernanceGateContextV1,
} from "./governance.js";
import type { BoundGovernedWriteReleaseV1 } from "./governed-transaction-internal.js";

export const CURRENT_STATE_NAMESPACE = "ameba-spread-v2" as const;
export type CurrentStateNamespace = typeof CURRENT_STATE_NAMESPACE;
export const CURRENT_STATE_COMMITMENT = "finalized" as const;

const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const CURRENT_LIGHT_COMPRESSION_AUTHORITY = new PublicKey(
  "4digEm3af65wVp8iA3UAQJrKXNnXZDKZv3m3vQWmMDR9",
);
export const CURRENT_LIGHT_DEFAULT_ADDRESS_TREE_V2 = new PublicKey("amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx");
const CURRENT_LIGHT_STATE_TREE_CONTEXTS: ReadonlyMap<string, {
  readonly queue: PublicKey;
  readonly cpiContext: PublicKey;
}> = new Map([
  [batchMerkleTree1, { queue: new PublicKey(batchQueue1), cpiContext: new PublicKey(batchCpiContext1) }],
  [batchMerkleTree2, { queue: new PublicKey(batchQueue2), cpiContext: new PublicKey(batchCpiContext2) }],
  [batchMerkleTree3, { queue: new PublicKey(batchQueue3), cpiContext: new PublicKey(batchCpiContext3) }],
  [batchMerkleTree4, { queue: new PublicKey(batchQueue4), cpiContext: new PublicKey(batchCpiContext4) }],
  [batchMerkleTree5, { queue: new PublicKey(batchQueue5), cpiContext: new PublicKey(batchCpiContext5) }],
] as const);

export type CurrentLightAccountLoadMode = "required" | "not_required";
export type CurrentColdResolutionMode = "hot" | "proof_only" | "load_ready";

export class CurrentSdkOperationError extends AmebaProtocolError {
  constructor(code: string, message: string, details?: Record<string, string | number | boolean | null>) {
    super(message, { code, details });
  }
}

export interface CurrentDeploymentIdentity<Deployment = typeof CURRENT_PROTOCOL_DEPLOYMENT> {
  readonly stateNamespace: CurrentStateNamespace;
  readonly deployment: Deployment;
}

export interface CurrentAdapterContextInput {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly namespace: CurrentStateNamespace;
  readonly commitment?: Commitment;
  readonly photonConnection?: CurrentPhotonConnection;
  readonly oracleCompressedStateLookupTable?: CurrentOracleCompressedStateLookupTableAuthorization;
}

export type CurrentColdAccountProofFacts = CurrentPhotonColdWitness;

export interface CurrentSubmissionReceipt {
  readonly status: "finalized";
  readonly operationId: string;
  readonly preparedPlanDigest: string;
  readonly idempotencyKey: string;
  readonly signature: string;
  readonly finalizedSlot: string;
  readonly finalizedBlockTime: string | null;
  readonly confirmationStatus: "finalized";
  readonly simulation: CurrentSubmissionSimulationFact;
  readonly postState: readonly CurrentSubmissionPostStateFact[];
}

export interface CurrentSubmissionSimulationFact {
  readonly status: "succeeded";
  readonly unitsConsumed: string | null;
  readonly logsSha256: string;
}

export interface CurrentSubmissionPostStateFact {
  readonly address: string;
  readonly owner: string;
  readonly lamports: string;
  readonly executable: boolean;
  readonly dataSha256: string;
}

/**
 * A managed submission boundary. Implementations may use a remote signer such
 * as Cloud KMS, but never receive or return a local Keypair.
 */
export interface CurrentSubmissionCapability {
  readonly supportsSerialFinalizedProofRegeneration?: true;
  submitOracleDraft(input: {
    readonly plan: CurrentOracleDraftPlan;
    readonly idempotencyKey: string;
  }): Promise<CurrentSubmissionReceipt>;
}

export interface CreateCurrentSdkAdapterInput {
  readonly connection: Connection;
  readonly programId: PublicKey | string;
  readonly namespace: CurrentStateNamespace;
  readonly cluster: "devnet";
  readonly releaseTag: typeof CURRENT_PROTOCOL_RELEASE;
  readonly releaseCommit: typeof CURRENT_PROTOCOL_SOURCE_COMMIT;
  readonly photonConnection?: CurrentPhotonConnection;
  readonly oracleCompressedStateLookupTable?: CurrentOracleCompressedStateLookupTableAuthorization;
  readonly submissionCapability?: CurrentSubmissionCapability;
}

/**
 * Deployment/run configuration for the rc.44 compressed Oracle transport.
 * This is deliberately factory-scoped rather than part of any semantic action
 * request. There is no canonical lookup-table address in rc.44 or on the empty
 * Devnet deployment.
 */
export interface CurrentOracleCompressedStateLookupTableAuthorization {
  readonly address: PublicKey | string;
  readonly authority: PublicKey | string | null;
  /** SHA-256 of the ordered address bytes under the current SDK domain. */
  readonly addressesSha256: string;
}

export interface ReadCurrentDeploymentFactsInput extends CurrentAdapterContextInput {}

export interface CurrentDeploymentFacts extends CurrentDeploymentIdentity {
  readonly genesisHash: string;
  readonly programId: string;
  readonly programExists: boolean;
  readonly programExecutable: boolean;
  readonly programDataAddress: string;
  readonly programDataExists: boolean;
  readonly programDataBytes: number | null;
  readonly upgradeAuthority: string | null;
  readonly programDataSlot: number | null;
  readonly programPayloadBytes: number | null;
  readonly programPayloadSha256: string | null;
  readonly verified: boolean;
}

export interface ReadCurrentMarketAccountInput extends CurrentAdapterContextInput {
  readonly marketId: string;
  readonly expiryId: string;
}

export interface CurrentMarketReadResult extends CurrentDeploymentIdentity {
  readonly marketId: string;
  readonly expiryId: string;
  readonly address: PublicKey;
  readonly found: boolean;
  readonly market: CurrentMarketAccount | null;
}

export interface DecodeCurrentAmoebaDlmmPoolAccountInput {
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly owner: PublicKey;
  readonly executable: boolean;
  readonly namespace: CurrentStateNamespace;
  readonly programId: PublicKey;
  readonly marketAddress: PublicKey;
  readonly market: CurrentMarketAccount;
  readonly oracleMonthAddress: PublicKey;
  readonly vaultConfig: CurrentVaultConfigAccount;
}

export type CurrentAmoebaDlmmPoolAccount = AmoebaDlmmPoolAccount & CurrentDeploymentIdentity;
export type CurrentAmoebaDlmmBinPageAccount = AmoebaDlmmBinPageAccount & CurrentDeploymentIdentity;
export type CurrentAmoebaDlmmSharePageAccount = AmoebaDlmmSharePageAccount & CurrentDeploymentIdentity;
export type CurrentAmoebaDlmmPositionAccount = AmoebaDlmmPositionAccount & CurrentDeploymentIdentity;

export interface DecodeCurrentAmoebaDlmmPageAccountInput {
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly owner: PublicKey;
  readonly executable: boolean;
  readonly namespace: CurrentStateNamespace;
  readonly programId: PublicKey;
  readonly poolAddress: PublicKey;
  readonly pageIndex: number;
}

export interface DecodeCurrentAmoebaDlmmPositionAccountInput {
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly owner: PublicKey;
  readonly executable: boolean;
  readonly namespace: CurrentStateNamespace;
  readonly programId: PublicKey;
  readonly poolAddress: PublicKey;
  readonly maximumBinId: number;
}

export interface DiscoverCurrentAmoebaDlmmPagesInput extends CurrentAdapterContextInput {
  readonly poolAddress: PublicKey;
  readonly pool: AmoebaDlmmPoolAccount;
  readonly payer?: PublicKey;
}

export interface CurrentAmoebaDlmmPagePair {
  readonly pageIndex: number;
  readonly reservePage: AmoebaDlmmBinPageAccount;
  readonly sharePage: AmoebaDlmmSharePageAccount;
  readonly reserveSourceState: "hot" | "cold";
  readonly reserveResolutionMode: CurrentColdResolutionMode;
  readonly reserveColdWitness: CurrentColdAccountProofFacts | null;
  readonly reserveLoadInstructions: readonly TransactionInstruction[];
  readonly shareSourceState: "hot" | "cold";
  readonly shareResolutionMode: CurrentColdResolutionMode;
  readonly shareColdWitness: CurrentColdAccountProofFacts | null;
  readonly shareLoadInstructions: readonly TransactionInstruction[];
}

export interface CurrentAmoebaDlmmPagesResult extends CurrentDeploymentIdentity {
  readonly poolAddress: PublicKey;
  readonly pages: readonly CurrentAmoebaDlmmPagePair[];
  readonly loadInstructions: readonly TransactionInstruction[];
}

export interface DiscoverCurrentAmoebaDlmmPositionsInput extends CurrentAdapterContextInput {
  readonly poolAddress: PublicKey;
  readonly owner?: PublicKey;
  readonly payer?: PublicKey;
  readonly maximumBinId: number;
  readonly expectedPositionCount?: number;
  readonly limit?: number;
}

export interface CurrentAmoebaDlmmPositionResolution {
  readonly position: CurrentAmoebaDlmmPositionAccount;
  readonly sourceState: "hot" | "cold";
  readonly resolutionMode: CurrentColdResolutionMode;
  readonly coldWitness: CurrentColdAccountProofFacts | null;
  readonly loadInstructions: readonly TransactionInstruction[];
}

export interface CurrentAmoebaDlmmPositionsResult extends CurrentDeploymentIdentity {
  readonly poolAddress: PublicKey;
  readonly positions: readonly CurrentAmoebaDlmmPositionResolution[];
  readonly loadInstructions: readonly TransactionInstruction[];
  readonly authoritativeForCurrentState: true;
}

export type CurrentAmoebaDlmmStateLocator =
  | {
    readonly kind: "pool";
    readonly marketAddress: PublicKey;
    readonly market: CurrentMarketAccount;
    readonly oracleMonthAddress: PublicKey;
    readonly vaultConfig: CurrentVaultConfigAccount;
  }
  | {
    readonly kind: "reserve_page";
    readonly poolAddress: PublicKey;
    readonly pageIndex: number;
  }
  | {
    readonly kind: "share_page";
    readonly poolAddress: PublicKey;
    readonly pageIndex: number;
  }
  | {
    readonly kind: "position";
    readonly poolAddress: PublicKey;
    readonly owner: PublicKey;
    readonly positionNonce: bigint;
    readonly maximumBinId: number;
  };

export interface ResolveCurrentAmoebaDlmmStateInput extends CurrentAdapterContextInput {
  readonly state: CurrentAmoebaDlmmStateLocator;
  readonly payer?: PublicKey;
}

export interface CurrentResolvedAmoebaDlmmState extends CurrentDeploymentIdentity {
  readonly kind: CurrentAmoebaDlmmStateLocator["kind"];
  readonly address: PublicKey;
  readonly sourceState: "hot" | "cold";
  readonly resolutionMode: CurrentColdResolutionMode;
  readonly account:
    | CurrentAmoebaDlmmPoolAccount
    | CurrentAmoebaDlmmBinPageAccount
    | CurrentAmoebaDlmmSharePageAccount
    | CurrentAmoebaDlmmPositionAccount;
  readonly coldWitness: CurrentColdAccountProofFacts | null;
  readonly loadInstructions: readonly TransactionInstruction[];
}

export interface ReadCurrentAmoebaDlmmPoolInput extends CurrentAdapterContextInput {
  readonly marketId: string;
  readonly expiryId: string;
}

export interface CurrentAmoebaDlmmPoolReadResult extends CurrentDeploymentIdentity {
  readonly marketId: string;
  readonly expiryId: string;
  readonly poolAddress: PublicKey;
  readonly pool: CurrentAmoebaDlmmPoolAccount;
  readonly sourceState: "hot" | "cold";
  readonly resolutionMode: CurrentColdResolutionMode;
  readonly coldWitness: CurrentColdAccountProofFacts | null;
  readonly loadInstructions: readonly TransactionInstruction[];
  readonly proofFacts: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CurrentLightAccountRequest {
  readonly role: "required_hot_input" | "canonical_output";
  readonly owner: PublicKey;
  readonly mint: PublicKey;
  readonly payer?: PublicKey;
}

export interface ResolveCurrentLightAccountsInput extends CurrentAdapterContextInput {
  readonly accounts: readonly CurrentLightAccountRequest[];
  /** Exact action appended after any official cold-account load instructions. */
  readonly actionInstructions?: readonly TransactionInstruction[];
}

export interface CurrentResolvedLightAccount {
  readonly address: PublicKey;
  readonly role: CurrentLightAccountRequest["role"];
  readonly existsHot: boolean;
  readonly wasCold: boolean;
  readonly owner: PublicKey | null;
  readonly mint: PublicKey | null;
  readonly tokenOwner: PublicKey | null;
  readonly amount: bigint | null;
  readonly proof: CurrentPhotonLightAtaBalance | null;
  readonly loadInstructions: readonly TransactionInstruction[];
}

export interface CurrentLightAccountResolution extends CurrentDeploymentIdentity {
  readonly accounts: readonly CurrentResolvedLightAccount[];
  readonly instructionBatches: readonly (readonly TransactionInstruction[])[];
  readonly loadBatchCount: number;
  readonly actionBatchIndex: number | null;
}

/** Exact finalized AccountInfo snapshot expected for one hot current Light ATA. */
export interface ValidateCurrentHotLightAccountInput {
  readonly address: PublicKey;
  readonly info: AccountInfo<Buffer>;
  readonly expectedTokenOwner: PublicKey;
  readonly expectedMint: PublicKey;
  readonly minimumAmountAtoms: bigint;
}

/** Canonical token facts decoded from the exact supplied AccountInfo bytes. */
export interface CurrentValidatedHotLightAccount {
  readonly address: PublicKey;
  readonly programOwner: PublicKey;
  readonly tokenOwner: PublicKey;
  readonly mint: PublicKey;
  readonly amountAtoms: bigint;
}

/**
 * Preserve transaction grouping while projecting only the setup prefix. The
 * exact action must be the trailing suffix of its final batch; callers must
 * never flatten the returned batches.
 */
export function currentLightSetupInstructionBatches(
  resolution: CurrentLightAccountResolution,
  actionInstructions: readonly TransactionInstruction[],
): readonly (readonly TransactionInstruction[])[] {
  if (resolution.actionBatchIndex === null) return Object.freeze([]);
  const actionBatch = resolution.instructionBatches[resolution.actionBatchIndex];
  const actionOffset = (actionBatch?.length ?? 0) - actionInstructions.length;
  if (actionInstructions.length === 0 || actionOffset < 0
    || actionInstructions.some((instruction, index) =>
      !sameInstruction(actionBatch?.[actionOffset + index], instruction))) {
    throw new CurrentSdkOperationError(
      "CURRENT_LIGHT_LOAD_PLAN_INVALID",
      "Light resolution does not end in the exact action suffix",
    );
  }
  return Object.freeze(resolution.instructionBatches.flatMap((batch, batchIndex) => {
    const setup = batchIndex === resolution.actionBatchIndex ? batch.slice(0, actionOffset) : [...batch];
    return setup.length === 0 ? [] : [Object.freeze(setup)];
  }));
}

export interface CurrentInstructionAccountMeta {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface CurrentDecodedInstructionParams {
  readonly instructionName: string;
  readonly tag: number;
  readonly direction?: AmoebaDlmmSwapDirection;
  readonly amountIn?: bigint;
  readonly minimumAmountOut?: bigint;
  readonly limitBinId?: number;
  readonly deadlineTs?: bigint;
  readonly oracleActionType?: CurrentOracleActionRequest["actionType"];
  readonly logicalInstructionName?: string;
  readonly logicalTag?: number;
}

export interface CurrentInstructionManifest {
  readonly programId: string;
  readonly dataBase64: string;
  readonly accounts: readonly CurrentInstructionAccountMeta[];
  readonly decodedParams: CurrentDecodedInstructionParams;
}

export interface CurrentOperationPlan extends CurrentDeploymentIdentity {
  readonly operation: "oracle_draft" | "position_action";
  readonly operationId: string;
  readonly instructions: readonly CurrentInstructionManifest[];
  readonly setupInstructionBatches: readonly (readonly CurrentInstructionManifest[])[];
  readonly proofFacts: Readonly<Record<string, string | number | boolean | null>>;
  /** Ordered unique writable accounts in setup-then-main execution order. */
  readonly writeSet: readonly string[];
  /** Exact managed-signer roles derived from signer metas in each transaction. */
  readonly signerRoles: readonly CurrentPlanSignerRole[];
}

export type CurrentPlanSignerRoleName =
  | "position_owner"
  | "oracle_actor"
  | "setup_payer";

export interface CurrentPlanSignerRole {
  readonly pubkey: string;
  readonly role: CurrentPlanSignerRoleName;
  readonly scope: "main" | "setup";
  readonly setupBatchIndex: number | null;
  readonly instructionIndexes: readonly number[];
}

export type CurrentPlanJsonPrimitive = string | number | boolean | null;
export type CurrentPlanJsonValue =
  | CurrentPlanJsonPrimitive
  | readonly CurrentPlanJsonValue[]
  | CurrentPlanJsonObject;
export interface CurrentPlanJsonObject {
  readonly [key: string]: CurrentPlanJsonValue;
}

/**
 * Canonical JSON-safe form of a complete current operation plan. Big integers,
 * public keys, bytes, and explicit undefined values use one-key tagged objects
 * (`bigint`, `publicKey`, `bytesBase64`, and `undefined`) so round trips retain
 * exact integer and byte identity.
 */
export type CurrentOperationPlanJson = CurrentPlanJsonObject & {
  readonly stateNamespace: CurrentStateNamespace;
  readonly operation: CurrentOperationPlan["operation"];
  readonly operationId: string;
  readonly preparedPlanDigest: string;
  readonly instructions: readonly CurrentPlanJsonObject[];
  readonly setupInstructionBatches: readonly (readonly CurrentPlanJsonObject[])[];
  readonly proofFacts: CurrentPlanJsonObject;
  readonly writeSet: readonly string[];
  readonly signerRoles: readonly CurrentPlanJsonObject[];
};

export interface CurrentSetupTransaction {
  readonly kind: "protocol_state_load" | "light_ata_load";
  readonly transactionBase64: string;
}

export interface CurrentApprovedInstructionAccountMeta {
  readonly address: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface CurrentApprovedInstruction {
  readonly programId: string;
  readonly accounts: readonly CurrentApprovedInstructionAccountMeta[];
  readonly dataBase64: string;
}

export interface CurrentApprovedInstructionTransaction {
  readonly serializedTransactionBase64: string;
  readonly recentBlockhash: string;
  readonly backendPartialSignatures: readonly string[];
  readonly approvedInstructions: readonly CurrentApprovedInstruction[];
}

function identity(): CurrentDeploymentIdentity {
  return { stateNamespace: CURRENT_STATE_NAMESPACE, deployment: CURRENT_PROTOCOL_DEPLOYMENT };
}

function assertContext(input: Pick<CurrentAdapterContextInput, "programId" | "namespace">): void {
  if (input.namespace !== CURRENT_STATE_NAMESPACE) {
    throw new CurrentSdkOperationError("CURRENT_NAMESPACE_MISMATCH", "state namespace is not current");
  }
  if (input.programId.toBase58() !== DEFAULT_AMEBA_SPREAD_PROGRAM_ID) {
    throw new CurrentSdkOperationError("CURRENT_PROGRAM_ID_MISMATCH", "program id is not the rc.44 deployment");
  }
  const commitment = (input as Pick<CurrentAdapterContextInput, "commitment">).commitment;
  if (commitment !== undefined && commitment !== CURRENT_STATE_COMMITMENT) {
    throw new CurrentSdkOperationError(
      "CURRENT_COMMITMENT_INVALID",
      "authoritative current protocol reads require finalized commitment",
    );
  }
}

function finalizedCommitment(commitment?: Commitment): typeof CURRENT_STATE_COMMITMENT {
  if (commitment !== undefined && commitment !== CURRENT_STATE_COMMITMENT) {
    throw new CurrentSdkOperationError(
      "CURRENT_COMMITMENT_INVALID",
      "authoritative current protocol reads require finalized commitment",
    );
  }
  return CURRENT_STATE_COMMITMENT;
}

function validateCurrentColdLoadInstruction(input: {
  readonly instruction: readonly TransactionInstruction[];
  readonly address: PublicKey;
  readonly data: Uint8Array;
  readonly expectedOwner: PublicKey;
  readonly stateTree: PublicKey;
  readonly queue: PublicKey;
  readonly rootIndex: number;
  readonly leafIndex: number;
  readonly proveByIndex: boolean;
  readonly compressedProof: { readonly a: readonly number[]; readonly b: readonly number[]; readonly c: readonly number[] } | null;
}): void {
  if (input.instruction.length !== 1) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "each cold account must have exactly one tag-219 load instruction");
  }
  const instruction = semanticCurrentSpreadInstructionV1(input.instruction[0]!);
  const bytes = Buffer.from(instruction.data);
  if (
    !instruction.programId.equals(input.expectedOwner)
    || bytes.length > 16_384
    || bytes[0] !== 219
    || input.compressedProof === null
  ) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "cold load program, tag, cap, or proof is invalid");
  }
  const proofBytes = Buffer.concat([
    Buffer.from(input.compressedProof.a),
    Buffer.from(input.compressedProof.b),
    Buffer.from(input.compressedProof.c),
  ]);
  if (proofBytes.length !== 128 || bytes[4] !== 1 || !bytes.subarray(5, 133).equals(proofBytes)) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "tag-219 proof bytes do not match the authenticated observation");
  }
  const systemAccountsOffset = bytes[1];
  const tokenAccountCount = bytes[2];
  const outputQueueIndex = bytes[3];
  if (systemAccountsOffset === undefined || tokenAccountCount !== 1 || outputQueueIndex === undefined || bytes.length < 151) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "tag-219 offsets or account count are invalid");
  }
  let cursor = 133;
  const packedCount = bytes.readUInt32LE(cursor);
  cursor += 4;
  const packedRootIndex = bytes.readUInt16LE(cursor);
  cursor += 2;
  const packedProveByIndex = bytes[cursor++];
  const treeIndex = bytes[cursor++];
  const queueIndex = bytes[cursor++];
  const packedLeafIndex = bytes.readUInt32LE(cursor);
  cursor += 4;
  const kind = bytes[cursor++];
  const shape = input.data.length === 384 ? { kind: 0, bodyLength: 376, identityOffset: -1, identityLength: 0 }
    : input.data.length === 602 ? { kind: 1, bodyLength: 594, identityOffset: 38, identityLength: 2 }
      : input.data.length === 594 ? { kind: 2, bodyLength: 586, identityOffset: 38, identityLength: 2 }
        : input.data.length === 637 ? { kind: 3, bodyLength: 629, identityOffset: 70, identityLength: 8 }
          : null;
  if (
    packedCount !== 1
    || packedProveByIndex !== Number(input.proveByIndex)
    || packedRootIndex !== (input.proveByIndex ? 0 : input.rootIndex)
    || packedLeafIndex !== input.leafIndex
    || treeIndex === undefined
    || queueIndex === undefined
    || kind === undefined
    || shape === null
    || kind !== shape.kind
    || cursor + shape.bodyLength + shape.identityLength !== bytes.length
  ) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "tag-219 packed proof or state shape is invalid");
  }
  const body = bytes.subarray(cursor, cursor + shape.bodyLength);
  if (!body.equals(Buffer.from(input.data).subarray(8))) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "tag-219 state bytes do not match the authenticated compressed account");
  }
  cursor += shape.bodyLength;
  if (
    shape.identityLength > 0
    && !bytes.subarray(cursor).equals(body.subarray(shape.identityOffset, shape.identityOffset + shape.identityLength))
  ) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "tag-219 duplicated state identity is invalid");
  }
  const keys = instruction.keys;
  const hotStart = keys.length - packedCount;
  const lightConfig = PublicKey.findProgramAddressSync([
    Buffer.from("compressible_config", "ascii"),
    Buffer.alloc(2),
  ], input.expectedOwner)[0];
  const rentSponsor = PublicKey.findProgramAddressSync([Buffer.from("rent_sponsor", "ascii")], input.expectedOwner)[0];
  const outputQueue = keys[systemAccountsOffset + outputQueueIndex];
  const treeMeta = keys[systemAccountsOffset + treeIndex];
  const queueMeta = keys[systemAccountsOffset + queueIndex];
  const cpiContextPresent = keys
    .slice(systemAccountsOffset, hotStart)
    .some((meta) => CURRENT_LIGHT_STATE_TREE_CONTEXTS.get(input.stateTree.toBase58())?.cpiContext.equals(meta.pubkey));
  if (
    systemAccountsOffset !== 3
    || hotStart - systemAccountsOffset < 6
    || keys[0]?.isSigner !== true
    || keys[0]?.isWritable !== true
    || !keys[1]?.pubkey.equals(lightConfig)
    || keys[1]?.isSigner !== false
    || keys[1]?.isWritable !== false
    || !keys[2]?.pubkey.equals(rentSponsor)
    || keys[2]?.isSigner !== false
    || keys[2]?.isWritable !== true
    || !keys[systemAccountsOffset + 5]?.pubkey.equals(SystemProgram.programId)
    || !treeMeta?.pubkey.equals(input.stateTree)
    || !queueMeta?.pubkey.equals(input.queue)
    || treeMeta.isSigner
    || queueMeta.isSigner
    || !treeMeta.isWritable
    || !queueMeta.isWritable
    || outputQueue === undefined
    || outputQueue.isSigner
    || !outputQueue.isWritable
    || ![...CURRENT_LIGHT_STATE_TREE_CONTEXTS.values()].some((context) => context.queue.equals(outputQueue.pubkey))
    || !cpiContextPresent
    || !keys[hotStart]?.pubkey.equals(input.address)
    || keys[hotStart]?.isSigner !== false
    || keys[hotStart]?.isWritable !== true
  ) {
    throw new CurrentSdkOperationError("CURRENT_COLD_LOAD_PLAN_INVALID", "tag-219 account metas are not the canonical one-account route");
  }
}

function currentColdResolver(
  photon: CurrentPhotonConnection | undefined,
  expectedOwner: PublicKey,
  payer?: PublicKey,
  collector?: Map<string, CurrentColdAccountProofFacts>,
): AmoebaDlmmColdAccountResolver | undefined {
  if (photon === undefined) return undefined;
  return {
    resolveColdAccount: async (address) => {
      if (payer === undefined) {
        const observed = await photon.observeCurrentColdAccount(address);
        if (observed === null) return null;
        if (
          !observed.canonicalAddress.equals(address)
          || !observed.owner.equals(expectedOwner)
          || observed.witness.mode !== "proof_only"
          || observed.witness.canonicalAddress !== address.toBase58()
          || observed.witness.owner !== expectedOwner.toBase58()
          || observed.witness.providerOriginSha256 !== photon.providerOriginSha256
        ) {
          throw new CurrentSdkOperationError(
            "CURRENT_COLD_PROOF_INVALID",
            "proof-only cold observation does not bind the canonical account, owner, and authorized provider",
          );
        }
        collector?.set(address.toBase58(), observed.witness);
        return {
          data: Buffer.from(observed.data),
          owner: observed.owner,
          loadInstructions: Object.freeze([]),
        };
      }
      const resolved = await photon.forPayer(payer).resolveCurrentColdAccount(address);
      if (resolved === null) return null;
      if (
        !resolved.canonicalAddress.equals(address)
        || !resolved.owner.equals(expectedOwner)
        || resolved.witness.mode !== "load"
        || resolved.witness.canonicalAddress !== address.toBase58()
        || resolved.witness.owner !== expectedOwner.toBase58()
        || resolved.witness.payer !== payer.toBase58()
        || resolved.witness.providerOriginSha256 !== photon.providerOriginSha256
        || resolved.loadInstructions.length !== 1
        || !resolved.loadInstructions[0]?.keys[0]?.pubkey.equals(payer)
        || resolved.loadInstructions[0].keys[0]?.isSigner !== true
        || resolved.loadInstructions[0].keys[0]?.isWritable !== true
      ) {
        throw new CurrentSdkOperationError(
          "CURRENT_COLD_PROOF_INVALID",
          "payer-scoped cold observation does not bind the canonical account, owner, provider, and tag-219 fee payer",
        );
      }
      collector?.set(address.toBase58(), resolved.witness);
      return {
        data: Buffer.from(resolved.data),
        owner: resolved.owner,
        loadInstructions: Object.freeze([...resolved.loadInstructions]),
      };
    },
  };
}

function requireProgramAccount(
  kind: string,
  info: AccountInfo<Buffer>,
  programId: PublicKey,
  expectedSize: number,
): void {
  if (!info.owner.equals(programId) || info.executable || info.data.byteLength !== expectedSize) {
    throw new CurrentSdkOperationError("CURRENT_ACCOUNT_INVALID", `${kind} owner, executable flag, or size is not current`, {
      kind,
      owner: info.owner.toBase58(),
      executable: info.executable,
      bytes: info.data.byteLength,
    });
  }
}

function decodeOptionalCurrentOracleMonthTarget(input: {
  readonly info: AccountInfo<Buffer> | null;
  readonly address: PublicKey;
  readonly expiryTs: bigint;
  readonly namespace: "ameba-spread-v2";
  readonly programId: PublicKey;
}): CurrentOracleMonthAccount | null {
  const { info } = input;
  if (info === null) return null;
  if (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0) return null;
  if (!info.executable && info.owner.equals(input.programId) && info.data.length === CURRENT_ORACLE_MONTH_ACCOUNT_SIZE) {
    try {
      validateUninitializedCurrentOracleMonthData(info.data);
      return null;
    } catch {
      // Initialized current accounts continue through the strict identity decoder below.
    }
  }
  requireProgramAccount("OracleMonth", info, input.programId, CURRENT_ORACLE_MONTH_ACCOUNT_SIZE);
  return decodeCurrentOracleMonthAccount({
    address: input.address,
    data: info.data,
    owner: info.owner,
    executable: info.executable,
    namespace: input.namespace,
    programId: input.programId,
    expiryTs: input.expiryTs,
  });
}

function asSeriesId(value: string, marketId?: string): Buffer {
  if (!/^(RAMX|NANDX)-[0-9]{4}(0[1-9]|1[0-2])-(CALL|PUT)-01$/.test(value)) {
    throw new CurrentSdkOperationError("CURRENT_SERIES_ID_INVALID", "expiryId must be the full current PRODUCT-YYYYMM-SIDE-01 series label");
  }
  const product = value.slice(0, value.indexOf("-")).toLowerCase();
  if (marketId !== undefined && marketId !== product) {
    throw new CurrentSdkOperationError("CURRENT_MARKET_ID_MISMATCH", "marketId must be the normalized product segment of expiryId");
  }
  const encoded = Buffer.from(value, "ascii");
  if (encoded.length < 1 || encoded.length > 32 || encoded.toString("ascii") !== value) {
    throw new CurrentSdkOperationError("CURRENT_SERIES_ID_INVALID", "expiryId must be canonical printable ASCII that fits bytes32");
  }
  const seriesId = Buffer.alloc(32);
  encoded.copy(seriesId);
  return seriesId;
}

function parseOwner(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch (cause) {
    throw new CurrentSdkOperationError("CURRENT_OWNER_INVALID", "ownerPubkey is not a Solana public key", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function requirePositiveU64(value: bigint, code: string, field: string): void {
  if (value <= 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new CurrentSdkOperationError(code, `${field} must be a positive u64`);
  }
}

export async function readCurrentDeploymentFacts(
  input: ReadCurrentDeploymentFactsInput,
): Promise<CurrentDeploymentFacts> {
  assertContext(input);
  const commitment = finalizedCommitment(input.commitment);
  const genesisHash = await input.connection.getGenesisHash();
  if (genesisHash !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH) {
    throw new CurrentSdkOperationError("CURRENT_CLUSTER_IDENTITY_MISMATCH", "RPC genesis hash is not Devnet", {
      genesisHash,
    });
  }
  const expectedProgramData = new PublicKey(CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS);
  const [program, programData] = await Promise.all([
    input.connection.getAccountInfo(input.programId, commitment),
    input.connection.getAccountInfo(expectedProgramData, commitment),
  ]);
  if (program === null && programData !== null) {
    throw new CurrentSdkOperationError("CURRENT_DEPLOYMENT_LINK_INVALID", "ProgramData exists without the current program account");
  }
  if (program !== null) {
    const bytes = Buffer.from(program.data);
    if (
      !program.owner.equals(BPF_UPGRADEABLE_LOADER_ID)
      || !program.executable
      || bytes.length !== 36
      || bytes.readUInt32LE(0) !== 2
      || !new PublicKey(bytes.subarray(4, 36)).equals(expectedProgramData)
    ) {
      throw new CurrentSdkOperationError(
        "CURRENT_DEPLOYMENT_LINK_INVALID",
        "program account is not the exact upgradeable-loader Program linked to pinned ProgramData",
      );
    }
    if (programData === null) {
      throw new CurrentSdkOperationError("CURRENT_PROGRAMDATA_NOT_FOUND", "the linked current ProgramData account is absent");
    }
  }
  let programDataSlot: number | null = null;
  let programPayloadBytes: number | null = null;
  let programPayloadSha256: string | null = null;
  if (programData !== null) {
    const bytes = Buffer.from(programData.data);
    if (
      !programData.owner.equals(BPF_UPGRADEABLE_LOADER_ID)
      || programData.executable
      || bytes.length !== CURRENT_PROTOCOL_PROGRAMDATA_BYTES
    ) {
      throw new CurrentSdkOperationError("CURRENT_PROGRAMDATA_INVALID", "ProgramData loader owner or executable flag is invalid");
    }
    if (bytes.readUInt32LE(0) !== 3) {
      throw new CurrentSdkOperationError("CURRENT_PROGRAMDATA_INVALID", "account is not upgradeable-loader ProgramData");
    }
    const slot = bytes.readBigUInt64LE(4);
    const authorityOption = bytes[12];
    if (
      authorityOption !== 1
      || !new PublicKey(bytes.subarray(13, 45)).equals(new PublicKey(CURRENT_PROTOCOL_UPGRADE_AUTHORITY))
    ) {
      throw new CurrentSdkOperationError("CURRENT_PROGRAMDATA_INVALID", "ProgramData upgrade authority is not the pinned rc.44 authority");
    }
    const payloadOffset = 45;
    const payload = bytes.subarray(payloadOffset, payloadOffset + CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES);
    const trailingAllocation = bytes.subarray(payloadOffset + CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES);
    const payloadSha256 = createHash("sha256").update(payload).digest("hex");
    if (
      slot !== BigInt(CURRENT_PROTOCOL_DEPLOYED_SLOT)
      || payloadSha256 !== CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256
      || trailingAllocation.some((byte) => byte !== 0)
    ) {
      throw new CurrentSdkOperationError(
        "CURRENT_PROGRAM_PAYLOAD_INVALID",
        "ProgramData slot, payload hash, length, or trailing allocation is not the pinned rc.44 deployment",
      );
    }
    programDataSlot = Number(slot);
    programPayloadBytes = payload.length;
    programPayloadSha256 = payloadSha256;
  }
  return {
    ...identity(),
    genesisHash,
    programId: input.programId.toBase58(),
    programExists: program !== null,
    programExecutable: program?.executable ?? false,
    programDataAddress: CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS,
    programDataExists: programData !== null,
    programDataBytes: programData?.data.byteLength ?? null,
    upgradeAuthority: programData === null ? null : CURRENT_PROTOCOL_UPGRADE_AUTHORITY,
    programDataSlot,
    programPayloadBytes,
    programPayloadSha256,
    verified: program !== null && programData !== null,
  };
}

export async function readCurrentMarketAccount(
  input: ReadCurrentMarketAccountInput,
): Promise<CurrentMarketReadResult> {
  assertContext(input);
  const seriesId = asSeriesId(input.expiryId, input.marketId);
  const address = deriveMarketPda(seriesId, input.programId);
  const info = await input.connection.getAccountInfo(address, finalizedCommitment(input.commitment));
  if (info === null) {
    return { ...identity(), marketId: input.marketId, expiryId: input.expiryId, address, found: false, market: null };
  }
  requireProgramAccount("Market", info, input.programId, CURRENT_MARKET_ACCOUNT_SIZE);
  const market = decodeStrictMarket({
    address,
    data: info.data,
    owner: info.owner,
    executable: info.executable,
    namespace: input.namespace,
    programId: input.programId,
  });
  if (market.seriesIdentity.product !== input.marketId || market.seriesIdentity.fullSeriesId !== input.expiryId) {
    throw new CurrentSdkOperationError("CURRENT_MARKET_ID_MISMATCH", "decoded Market identity does not match requested product and series");
  }
  return { ...identity(), marketId: input.marketId, expiryId: input.expiryId, address, found: true, market };
}

export function decodeCurrentAmoebaDlmmPoolAccount(
  input: DecodeCurrentAmoebaDlmmPoolAccountInput,
): CurrentAmoebaDlmmPoolAccount {
  assertContext(input);
  if (!input.owner.equals(input.programId) || input.executable) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POOL_IDENTITY_INVALID", "DLMM pool owner is not current");
  }
  const pool = decodeAmoebaDlmmPool(input.address, input.data, input.programId);
  return validateCurrentAmoebaDlmmPoolValue(pool, input);
}

function validateCurrentAmoebaDlmmPoolValue(
  pool: AmoebaDlmmPoolAccount,
  input: Omit<DecodeCurrentAmoebaDlmmPoolAccountInput, "data" | "owner" | "executable">,
): CurrentAmoebaDlmmPoolAccount {
  const expectedPool = deriveAmoebaDlmmPoolPda(input.marketAddress, input.programId)[0];
  const expectedOptionMint = input.market.longContractMint;
  const expectedMaximumBinId = Number(input.market.maxPayoutPerContract / input.market.tickSize);
  if (
    !input.address.equals(expectedPool)
    || !pool.market.equals(input.marketAddress)
    || !pool.oracleMonth.equals(input.oracleMonthAddress)
    || expectedOptionMint === null
    || !pool.optionMint.equals(expectedOptionMint)
    || !pool.quoteMint.equals(input.market.collateralMint)
    || !pool.quoteMint.equals(input.vaultConfig.usdcMint)
    || !pool.optionVault.equals(deriveAmoebaDlmmVaultPda(input.address, pool.optionMint, input.programId)[0])
    || !pool.quoteVault.equals(deriveAmoebaDlmmVaultPda(input.address, pool.quoteMint, input.programId)[0])
    || pool.tickSizeQuoteAtomic !== input.market.tickSize
    || pool.maximumPriceQuoteAtomic !== input.market.maxPayoutPerContract
    || pool.maximumBinId !== expectedMaximumBinId
    || pool.maximumPriceQuoteAtomic !== pool.tickSizeQuoteAtomic * BigInt(pool.maximumBinId)
    || pool.swapFeeBps !== input.market.takerFeeBps
    || pool.maximumBinsPerSwap !== input.market.maxFillsPerInstruction
    || pool.maximumBinsPerSwap < 1
    || pool.maximumBinsPerSwap > 8
    || pool.protocolFeeShareBps > 10_000
  ) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POOL_INVARIANT_INVALID", "DLMM pool is not bound to current market economics");
  }
  return Object.freeze({ ...pool, ...identity() });
}

export function decodeCurrentAmoebaDlmmBinPageAccount(
  input: DecodeCurrentAmoebaDlmmPageAccountInput,
): CurrentAmoebaDlmmBinPageAccount {
  assertContext(input);
  if (!input.owner.equals(input.programId) || input.executable || input.data.byteLength !== AMOEBA_DLMM_BIN_PAGE_ACCOUNT_SIZE) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_IDENTITY_INVALID", "reserve page owner, executable flag, or size is invalid");
  }
  const page = decodeAmoebaDlmmBinPage(input.address, input.data, input.programId);
  if (
    !input.address.equals(deriveAmoebaDlmmBinPagePda(input.poolAddress, input.pageIndex, input.programId)[0])
    || !page.pool.equals(input.poolAddress)
    || page.pageIndex !== input.pageIndex
    || page.firstBinId !== input.pageIndex * 32 + 1
  ) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_IDENTITY_INVALID", "reserve page PDA, pool, index, or first bin is invalid");
  }
  return Object.freeze({ ...page, ...identity() });
}

export function decodeCurrentAmoebaDlmmSharePageAccount(
  input: DecodeCurrentAmoebaDlmmPageAccountInput,
): CurrentAmoebaDlmmSharePageAccount {
  assertContext(input);
  if (!input.owner.equals(input.programId) || input.executable || input.data.byteLength !== AMOEBA_DLMM_SHARE_PAGE_ACCOUNT_SIZE) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_IDENTITY_INVALID", "share page owner, executable flag, or size is invalid");
  }
  const page = decodeAmoebaDlmmSharePage(input.address, input.data, input.programId);
  if (
    !input.address.equals(deriveAmoebaDlmmSharePagePda(input.poolAddress, input.pageIndex, input.programId)[0])
    || !page.pool.equals(input.poolAddress)
    || page.pageIndex !== input.pageIndex
    || page.firstBinId !== input.pageIndex * 32 + 1
  ) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_IDENTITY_INVALID", "share page PDA, pool, index, or first bin is invalid");
  }
  return Object.freeze({ ...page, ...identity() });
}

export function decodeCurrentAmoebaDlmmPositionAccount(
  input: DecodeCurrentAmoebaDlmmPositionAccountInput,
): CurrentAmoebaDlmmPositionAccount {
  assertContext(input);
  if (!input.owner.equals(input.programId) || input.executable || input.data.byteLength !== AMOEBA_DLMM_POSITION_ACCOUNT_SIZE) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_IDENTITY_INVALID", "position owner, executable flag, or size is invalid");
  }
  const position = decodeAmoebaDlmmPosition(input.address, input.data, input.programId);
  const upper = position.lowerBinId + position.binCount - 1;
  const bitmap = position.liquidityShares.reduce(
    (value, shares, index) => value | (shares === 0n ? 0 : (1 << index)),
    0,
  ) >>> 0;
  if (
    !input.address.equals(deriveAmoebaDlmmPositionPda(
      input.poolAddress,
      position.owner,
      position.positionNonce,
      input.programId,
    )[0])
    || !position.pool.equals(input.poolAddress)
    || position.binCount < 1
    || position.binCount > 32
    || position.lowerBinId < 1
    || upper > input.maximumBinId
    || position.initializedBitmap !== bitmap
  ) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_INVALID", "position PDA, pool, range, or bitmap is invalid");
  }
  return Object.freeze({ ...position, ...identity() });
}

export async function discoverCurrentAmoebaDlmmPages(
  input: DiscoverCurrentAmoebaDlmmPagesInput,
): Promise<CurrentAmoebaDlmmPagesResult> {
  assertContext(input);
  const pageIndexes = bitmapPageIndexes(input.pool.initializedPageBitmap);
  if (pageIndexes.length > 64) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_BOUND_EXCEEDED", "pool page bitmap exceeds current bounds");
  }
  const coldWitnesses = new Map<string, CurrentColdAccountProofFacts>();
  const coldResolver = currentColdResolver(input.photonConnection, input.programId, input.payer, coldWitnesses);
  const pages = await Promise.all(pageIndexes.map(async (pageIndex): Promise<CurrentAmoebaDlmmPagePair> => {
    const reserveAddress = deriveAmoebaDlmmBinPagePda(input.poolAddress, pageIndex, input.programId)[0];
    const shareAddress = deriveAmoebaDlmmSharePagePda(input.poolAddress, pageIndex, input.programId)[0];
    const [reserve, shares] = await Promise.all([
      getAmoebaDlmmBinPage(input.connection, reserveAddress, {
        commitment: finalizedCommitment(input.commitment),
        coldResolver,
        programId: input.programId,
      }),
      getAmoebaDlmmSharePage(input.connection, shareAddress, {
        commitment: finalizedCommitment(input.commitment),
        coldResolver,
        programId: input.programId,
      }),
    ]);
    if (
      !reserve.account.pool.equals(input.poolAddress)
      || !shares.account.pool.equals(input.poolAddress)
      || reserve.account.pageIndex !== pageIndex
      || shares.account.pageIndex !== pageIndex
      || reserve.account.firstBinId !== pageIndex * 32 + 1
      || shares.account.firstBinId !== reserve.account.firstBinId
    ) {
      throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_IDENTITY_INVALID", "reserve/share page pair is not canonical");
    }
    for (let index = 0; index < 32; index += 1) {
      const optionPresent = (reserve.account.optionReserve[index] ?? 0n) !== 0n;
      const quotePresent = (reserve.account.quoteReserve[index] ?? 0n) !== 0n;
      const reservePresent = optionPresent || quotePresent;
      const sharesPresent = (shares.account.totalLiquidityShares[index] ?? 0n) !== 0n;
      const askBit = ((reserve.account.askBitmap >>> index) & 1) === 1;
      const bidBit = ((reserve.account.bidBitmap >>> index) & 1) === 1;
      if (reservePresent !== sharesPresent || askBit !== optionPresent || bidBit !== quotePresent) {
        throw new CurrentSdkOperationError("CURRENT_DLMM_PAGE_ACCOUNTING_INVALID", "reserve/share page liquidity bitmap is inconsistent");
      }
    }
    const reserveColdWitness = coldWitnesses.get(reserveAddress.toBase58()) ?? null;
    const shareColdWitness = coldWitnesses.get(shareAddress.toBase58()) ?? null;
    const expectedColdLoadCount = input.payer === undefined ? 0 : 1;
    const expectedColdWitnessMode = input.payer === undefined ? "proof_only" : "load";
    if (
      reserve.resolved.wasCold !== (reserveColdWitness !== null)
      || shares.resolved.wasCold !== (shareColdWitness !== null)
      || (reserveColdWitness !== null && reserveColdWitness.mode !== expectedColdWitnessMode)
      || (shareColdWitness !== null && shareColdWitness.mode !== expectedColdWitnessMode)
      || (reserve.resolved.wasCold ? reserve.resolved.loadInstructions.length !== expectedColdLoadCount : reserve.resolved.loadInstructions.length !== 0)
      || (shares.resolved.wasCold ? shares.resolved.loadInstructions.length !== expectedColdLoadCount : shares.resolved.loadInstructions.length !== 0)
    ) {
      throw new CurrentSdkOperationError(
        "CURRENT_COLD_PROOF_INVALID",
        "reserve and share page transport facts are not independently authenticated",
      );
    }
    return {
      pageIndex,
      reservePage: reserve.account,
      sharePage: shares.account,
      reserveSourceState: reserve.resolved.wasCold ? "cold" : "hot",
      reserveResolutionMode: reserve.resolved.wasCold
        ? input.payer === undefined ? "proof_only" : "load_ready"
        : "hot",
      reserveColdWitness,
      reserveLoadInstructions: Object.freeze([...reserve.resolved.loadInstructions]),
      shareSourceState: shares.resolved.wasCold ? "cold" : "hot",
      shareResolutionMode: shares.resolved.wasCold
        ? input.payer === undefined ? "proof_only" : "load_ready"
        : "hot",
      shareColdWitness,
      shareLoadInstructions: Object.freeze([...shares.resolved.loadInstructions]),
    };
  }));
  let optionReserve = 0n;
  let quoteReserve = 0n;
  for (const page of pages) {
    optionReserve += page.reservePage.optionReserve.reduce((sum, value) => sum + value, 0n);
    quoteReserve += page.reservePage.quoteReserve.reduce((sum, value) => sum + value, 0n);
  }
  if (optionReserve !== input.pool.accountedOptionReserve || quoteReserve !== input.pool.accountedQuoteReserve) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POOL_ACCOUNTING_INVALID", "page reserves do not equal pool accounting");
  }
  return {
    ...identity(),
    poolAddress: input.poolAddress,
    pages,
    loadInstructions: pages.flatMap((page) => [
      ...page.reserveLoadInstructions,
      ...page.shareLoadInstructions,
    ]),
  };
}

function parseCurrentAmoebaDlmmPositionCandidate(data: Uint8Array): {
  readonly pool: PublicKey;
  readonly owner: PublicKey;
  readonly positionNonce: bigint;
} {
  const bytes = Buffer.from(data);
  if (
    bytes.byteLength !== AMOEBA_DLMM_POSITION_ACCOUNT_SIZE
    || !bytes.subarray(0, 8).equals(Buffer.from(AMOEBA_DLMM_POSITION_DISCRIMINATOR))
    || bytes[8] !== 1
    || !bytes.subarray(10, 13).equals(Buffer.from(AMOEBA_DLMM_POSITION_ACCOUNT_DISCRIMINATOR))
    || bytes[13] !== 1
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_DLMM_POSITION_IDENTITY_INVALID",
      "compressed position candidate header or fixed size is not current",
    );
  }
  return Object.freeze({
    pool: new PublicKey(bytes.subarray(14, 46)),
    owner: new PublicKey(bytes.subarray(46, 78)),
    positionNonce: bytes.readBigUInt64LE(78),
  });
}

export async function discoverCurrentAmoebaDlmmPositions(
  input: DiscoverCurrentAmoebaDlmmPositionsInput,
): Promise<CurrentAmoebaDlmmPositionsResult> {
  assertContext(input);
  const limit = input.limit ?? 256;
  if (!Number.isInteger(limit) || limit < 1 || limit > 256) {
    throw new CurrentSdkOperationError("CURRENT_POSITION_LIMIT_INVALID", "position discovery limit must be 1..256");
  }
  if (
    input.expectedPositionCount !== undefined
    && (!Number.isInteger(input.expectedPositionCount)
      || input.expectedPositionCount < 0
      || input.expectedPositionCount > limit)
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_POSITION_LIMIT_INVALID",
      "expected position count must be a bounded current u16 count within the discovery limit",
    );
  }
  const filters: Array<{ readonly dataSize: number } | { readonly memcmp: { readonly offset: number; readonly bytes: string } }> = [
    { dataSize: AMOEBA_DLMM_POSITION_ACCOUNT_SIZE },
    { memcmp: { offset: 14, bytes: input.poolAddress.toBase58() } },
  ];
  if (input.owner !== undefined) filters.push({ memcmp: { offset: 46, bytes: input.owner.toBase58() } });
  const entries = await input.connection.getProgramAccounts(input.programId, {
    commitment: finalizedCommitment(input.commitment),
    filters,
  });
  if (entries.length > limit) {
    throw new CurrentSdkOperationError("CURRENT_POSITION_LIMIT_EXCEEDED", "position discovery exceeded its bound");
  }
  const positions: CurrentAmoebaDlmmPositionResolution[] = entries.map((entry) => {
    if (!entry.account.owner.equals(input.programId) || entry.account.executable) {
      throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_IDENTITY_INVALID", "DLMM position owner or executable flag is invalid");
    }
    const position = decodeCurrentAmoebaDlmmPositionAccount({
      address: entry.pubkey,
      data: entry.account.data,
      owner: entry.account.owner,
      executable: entry.account.executable,
      namespace: input.namespace,
      programId: input.programId,
      poolAddress: input.poolAddress,
      maximumBinId: input.maximumBinId,
    });
    if (input.owner !== undefined && !position.owner.equals(input.owner)) {
      throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_IDENTITY_INVALID", "scoped hot position owner does not match the requested owner");
    }
    return Object.freeze({
      position,
      sourceState: "hot" as const,
      resolutionMode: "hot" as const,
      coldWitness: null,
      loadInstructions: Object.freeze([]),
    });
  });
  if (input.expectedPositionCount !== undefined && positions.length > input.expectedPositionCount) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_ACCOUNTING_INVALID", "hot position count exceeds the pool position count");
  }
  const needsColdSearch = input.expectedPositionCount === undefined
    || positions.length < input.expectedPositionCount;
  if (needsColdSearch) {
    if (input.photonConnection === undefined) {
      throw new CurrentSdkOperationError(
        "CURRENT_LIGHT_PROOF_UNAVAILABLE",
        "authoritative position discovery requires the canonical Photon capability when hot state is incomplete",
      );
    }
    const compressedFilters = [
      {
        memcmp: {
          offset: 0,
          bytes: Buffer.from(AMOEBA_DLMM_POSITION_DISCRIMINATOR).toString("base64"),
          encoding: "base64" as const,
        },
      },
      { memcmp: { offset: 14, bytes: input.poolAddress.toBase58() } },
      ...(input.owner === undefined
        ? []
        : [{ memcmp: { offset: 46, bytes: input.owner.toBase58() } }]),
    ];
    const compressed = await input.photonConnection.getCompressedAccountsByOwner(input.programId, {
      limit: createBN254(limit),
      filters: compressedFilters,
    });
    if (compressed.cursor !== null || compressed.items.length > limit) {
      throw new CurrentSdkOperationError("CURRENT_POSITION_LIMIT_EXCEEDED", "compressed position discovery exceeded its bound");
    }
    const seen = new Set(positions.map((resolvedPosition) => resolvedPosition.position.address.toBase58()));
    const proofCollector = new Map<string, CurrentColdAccountProofFacts>();
    const coldResolver = currentColdResolver(input.photonConnection, input.programId, input.payer, proofCollector)!;
    for (const candidate of compressed.items) {
      if (!candidate.owner.equals(input.programId) || candidate.data === null) continue;
      const discriminator = Buffer.from(candidate.data.discriminator);
      const body = Buffer.from(candidate.data.data);
      if (
        !discriminator.equals(Buffer.from(AMOEBA_DLMM_POSITION_DISCRIMINATOR))
        || discriminator.byteLength + body.byteLength !== AMOEBA_DLMM_POSITION_ACCOUNT_SIZE
      ) continue;
      const candidateData = Buffer.concat([discriminator, body]);
      const candidatePosition = parseCurrentAmoebaDlmmPositionCandidate(candidateData);
      if (
        !candidatePosition.pool.equals(input.poolAddress)
        || (input.owner !== undefined && !candidatePosition.owner.equals(input.owner))
      ) continue;
      const address = deriveAmoebaDlmmPositionPda(
        input.poolAddress,
        candidatePosition.owner,
        candidatePosition.positionNonce,
        input.programId,
      )[0];
      if (seen.has(address.toBase58())) {
        throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_IDENTITY_INVALID", "position is duplicated across hot and cold state");
      }
      const cold = await coldResolver.resolveColdAccount(address);
      const coldWitness = proofCollector.get(address.toBase58()) ?? null;
      if (
        cold === null
        || coldWitness === null
        || cold.loadInstructions.length !== (input.payer === undefined ? 0 : 1)
      ) {
        throw new CurrentSdkOperationError("CURRENT_COLD_PROOF_INVALID", "compressed position candidate lacks its exact authenticated observation");
      }
      const position = decodeCurrentAmoebaDlmmPositionAccount({
        address,
        data: cold.data,
        owner: cold.owner,
        executable: false,
        namespace: input.namespace,
        programId: input.programId,
        poolAddress: input.poolAddress,
        maximumBinId: input.maximumBinId,
      });
      if (
        !position.owner.equals(candidatePosition.owner)
        || position.positionNonce !== candidatePosition.positionNonce
      ) {
        throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_IDENTITY_INVALID", "authenticated position does not bind the owner-query candidate");
      }
      seen.add(address.toBase58());
      positions.push(Object.freeze({
        position,
        sourceState: "cold",
        resolutionMode: input.payer === undefined ? "proof_only" : "load_ready",
        coldWitness,
        loadInstructions: Object.freeze([...cold.loadInstructions]),
      }));
      if (positions.length > limit) {
        throw new CurrentSdkOperationError("CURRENT_POSITION_LIMIT_EXCEEDED", "combined hot/cold position discovery exceeded its bound");
      }
    }
  }
  positions.sort((left, right) => left.position.positionNonce < right.position.positionNonce
    ? -1
    : left.position.positionNonce > right.position.positionNonce ? 1 : 0);
  return Object.freeze({
    ...identity(),
    poolAddress: input.poolAddress,
    positions: Object.freeze([...positions]),
    loadInstructions: Object.freeze(positions.flatMap((position) => [...position.loadInstructions])),
    authoritativeForCurrentState: true,
  });
}

export async function resolveCurrentAmoebaDlmmState(
  input: ResolveCurrentAmoebaDlmmStateInput,
): Promise<CurrentResolvedAmoebaDlmmState> {
  assertContext(input);
  const address = input.state.kind === "pool"
    ? deriveAmoebaDlmmPoolPda(input.state.marketAddress, input.programId)[0]
    : input.state.kind === "reserve_page"
      ? deriveAmoebaDlmmBinPagePda(input.state.poolAddress, input.state.pageIndex, input.programId)[0]
      : input.state.kind === "share_page"
        ? deriveAmoebaDlmmSharePagePda(input.state.poolAddress, input.state.pageIndex, input.programId)[0]
        : deriveAmoebaDlmmPositionPda(
          input.state.poolAddress,
          input.state.owner,
          input.state.positionNonce,
          input.programId,
        )[0];
  const hot = await input.connection.getAccountInfo(address, finalizedCommitment(input.commitment));
  const proofCollector = new Map<string, CurrentColdAccountProofFacts>();
  let data: Uint8Array;
  let owner: PublicKey;
  let executable: boolean;
  let sourceState: "hot" | "cold";
  let loadInstructions: readonly TransactionInstruction[];
  if (hot !== null) {
    data = hot.data;
    owner = hot.owner;
    executable = hot.executable;
    sourceState = "hot";
    loadInstructions = Object.freeze([]);
  } else {
    const resolver = currentColdResolver(input.photonConnection, input.programId, input.payer, proofCollector);
    if (resolver === undefined) {
      throw new CurrentSdkOperationError("CURRENT_LIGHT_PROOF_UNAVAILABLE", "typed cold DLMM state requires the canonical Photon capability");
    }
    const cold = await resolver.resolveColdAccount(address);
    if (cold === null) throw new CurrentSdkOperationError("CURRENT_DLMM_STATE_NOT_FOUND", "typed current DLMM state is absent hot and cold");
    data = cold.data;
    owner = cold.owner;
    executable = false;
    sourceState = "cold";
    loadInstructions = Object.freeze([...cold.loadInstructions]);
  }
  const account = input.state.kind === "pool"
    ? decodeCurrentAmoebaDlmmPoolAccount({
      ...input.state,
      address,
      data,
      owner,
      executable,
      namespace: input.namespace,
      programId: input.programId,
    })
    : input.state.kind === "reserve_page"
      ? decodeCurrentAmoebaDlmmBinPageAccount({
        ...input.state,
        address,
        data,
        owner,
        executable,
        namespace: input.namespace,
        programId: input.programId,
      })
      : input.state.kind === "share_page"
        ? decodeCurrentAmoebaDlmmSharePageAccount({
          ...input.state,
          address,
          data,
          owner,
          executable,
          namespace: input.namespace,
          programId: input.programId,
        })
        : decodeCurrentAmoebaDlmmPositionAccount({
          address,
          data,
          owner,
          executable,
          namespace: input.namespace,
          programId: input.programId,
          poolAddress: input.state.poolAddress,
          maximumBinId: input.state.maximumBinId,
        });
  if (
    input.state.kind === "position"
    && (!("positionNonce" in account)
      || !account.owner.equals(input.state.owner)
      || account.positionNonce !== input.state.positionNonce)
  ) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POSITION_INVALID", "typed position owner or nonce does not match the derived PDA");
  }
  const coldWitness = proofCollector.get(address.toBase58()) ?? null;
  const expectedWitnessMode = input.payer === undefined ? "proof_only" : "load";
  if (
    (sourceState === "cold" && (
      coldWitness === null
      || coldWitness.kind !== input.state.kind
      || coldWitness.mode !== expectedWitnessMode
      || loadInstructions.length !== (input.payer === undefined ? 0 : 1)
    ))
    || (sourceState === "hot" && (coldWitness !== null || loadInstructions.length !== 0))
  ) {
    throw new CurrentSdkOperationError("CURRENT_COLD_PROOF_INVALID", "typed DLMM state source and witness are inconsistent");
  }
  return Object.freeze({
    ...identity(),
    kind: input.state.kind,
    address,
    sourceState,
    resolutionMode: sourceState === "hot"
      ? "hot"
      : input.payer === undefined ? "proof_only" : "load_ready",
    account,
    coldWitness,
    loadInstructions,
  });
}

export async function readCurrentAmoebaDlmmPool(
  input: ReadCurrentAmoebaDlmmPoolInput,
): Promise<CurrentAmoebaDlmmPoolReadResult> {
  assertContext(input);
  const marketRead = await readCurrentMarketAccount(input);
  if (marketRead.market === null) {
    throw new CurrentSdkOperationError("CURRENT_MARKET_UNAVAILABLE", "the exact current Market is absent");
  }
  const market = marketRead.market;
  const vaultConfigAddress = deriveVaultConfigPda(input.programId);
  const [settlementGroupAddress, expectedSettlementGroupBump] = deriveWriterSettlementGroupPda(
    market.underlyingId,
    market.expiryTs,
    market.collateralMint,
    input.programId,
  );
  const [vaultInfo, settlementGroupInfo] = await Promise.all([
    input.connection.getAccountInfo(vaultConfigAddress, finalizedCommitment(input.commitment)),
    input.connection.getAccountInfo(settlementGroupAddress, finalizedCommitment(input.commitment)),
  ]);
  if (vaultInfo === null || settlementGroupInfo === null) {
    throw new CurrentSdkOperationError(
      "CURRENT_DLMM_POOL_CONTEXT_UNAVAILABLE",
      "current VaultConfig or collective settlement group is absent",
    );
  }
  const vaultConfig = decodeVaultConfigInfo(vaultConfigAddress, vaultInfo, input.programId);
  requireProgramAccount(
    "WriterSettlementGroup",
    settlementGroupInfo,
    input.programId,
    WRITER_ACCOUNT_SIZES.settlementGroup,
  );
  const settlementGroup = decodeWriterSettlementGroup(
    settlementGroupAddress,
    settlementGroupInfo.data,
    input.programId,
  );
  const oracleMonthAddress = settlementGroup.anchorOracleMonth;
  const expectedAnchorOracleMonth = deriveOracleMonthPda({
    marketPda: settlementGroup.anchorMarket,
    expiryTs: settlementGroup.expiryTs,
    programId: input.programId,
  });
  if (
    settlementGroup.bump !== expectedSettlementGroupBump
    || !Buffer.from(settlementGroup.underlyingId).equals(Buffer.from(market.underlyingId))
    || settlementGroup.expiryTs !== market.expiryTs
    || !settlementGroup.settlementMint.equals(market.collateralMint)
    || settlementGroup.seriesCount < 1
    || !oracleMonthAddress.equals(expectedAnchorOracleMonth)
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_DLMM_POOL_INVARIANT_INVALID",
      "collective settlement group is not bound to current market economics",
    );
  }
  const monthInfo = await input.connection.getAccountInfo(
    oracleMonthAddress,
    finalizedCommitment(input.commitment),
  );
  if (monthInfo === null) {
    throw new CurrentSdkOperationError(
      "CURRENT_DLMM_POOL_CONTEXT_UNAVAILABLE",
      "current collective anchor OracleMonth is absent",
    );
  }
  requireProgramAccount("OracleMonth", monthInfo, input.programId, CURRENT_ORACLE_MONTH_ACCOUNT_SIZE);
  const oracleMonth = decodeCurrentOracleMonthAccount({
    address: oracleMonthAddress,
    data: monthInfo.data,
    owner: monthInfo.owner,
    executable: monthInfo.executable,
    namespace: input.namespace,
    programId: input.programId,
    expiryTs: settlementGroup.expiryTs,
  });
  if (!oracleMonth.market.equals(settlementGroup.anchorMarket)) {
    throw new CurrentSdkOperationError(
      "CURRENT_DLMM_POOL_INVARIANT_INVALID",
      "collective anchor OracleMonth does not match its settlement group",
    );
  }
  const resolved = await resolveCurrentAmoebaDlmmState({
    ...input,
    state: {
      kind: "pool",
      marketAddress: marketRead.address,
      market,
      oracleMonthAddress,
      vaultConfig,
    },
  });
  if (!("maximumBinId" in resolved.account)) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POOL_INVARIANT_INVALID", "typed state resolver did not return a pool");
  }
  const proofFacts = resolved.coldWitness === null
    ? Object.freeze({ sourceState: "hot" as const, resolutionMode: "hot" as const })
    : Object.freeze({
      sourceState: "cold" as const,
      resolutionMode: resolved.resolutionMode,
      canonicalAddress: resolved.coldWitness.canonicalAddress,
      providerOriginSha256: resolved.coldWitness.providerOriginSha256,
      payer: resolved.coldWitness.mode === "load" ? resolved.coldWitness.payer : null,
      witnessDigest: resolved.coldWitness.witnessDigest,
      proofContextSlot: resolved.coldWitness.proofContextSlot,
      stateTree: resolved.coldWitness.stateTree,
      queue: resolved.coldWitness.queue,
      cpiContext: resolved.coldWitness.cpiContext,
    });
  return Object.freeze({
    ...identity(),
    marketId: input.marketId,
    expiryId: input.expiryId,
    poolAddress: resolved.address,
    pool: resolved.account as CurrentAmoebaDlmmPoolAccount,
    sourceState: resolved.sourceState,
    resolutionMode: resolved.resolutionMode,
    coldWitness: resolved.coldWitness,
    loadInstructions: resolved.loadInstructions,
    proofFacts,
  });
}

export async function resolveCurrentLightAccounts(
  input: ResolveCurrentLightAccountsInput,
): Promise<CurrentLightAccountResolution> {
  assertContext(input);
  if (input.accounts.length > 16) {
    throw new CurrentSdkOperationError("CURRENT_LIGHT_ACCOUNT_BOUND_EXCEEDED", "at most 16 Light accounts may be resolved");
  }
  const accounts: CurrentResolvedLightAccount[] = [];
  const coldRequests: Array<{
    readonly request: CurrentLightAccountRequest;
    readonly address: PublicKey;
    readonly resolver: ReturnType<CurrentPhotonConnection["forPayer"]>;
  }> = [];
  for (const request of input.accounts) {
    const address = getAssociatedTokenAddressInterface(request.mint, request.owner);
    const hot = await input.connection.getAccountInfo(address, finalizedCommitment(input.commitment));
    if (hot !== null) {
      const token = validateCurrentHotLightAccount({
        address,
        info: hot,
        expectedTokenOwner: request.owner,
        expectedMint: request.mint,
        minimumAmountAtoms: 0n,
      });
      accounts.push({
        address,
        role: request.role,
        existsHot: true,
        wasCold: false,
        owner: token.programOwner,
        mint: token.mint,
        tokenOwner: token.tokenOwner,
        amount: token.amountAtoms,
        proof: null,
        loadInstructions: [],
      });
      continue;
    }
    if (input.photonConnection === undefined || request.payer === undefined) {
      throw new CurrentSdkOperationError(
        "CURRENT_LIGHT_PROOF_UNAVAILABLE",
        "a hot-absent Light ATA requires the authorized payer-bound Light indexer",
      );
    }
    const resolver = input.photonConnection.forPayer(request.payer);
    const proof = await resolver.inspectLightAta({ ata: address, owner: request.owner, mint: request.mint });
    if (proof === null) {
      if (request.role === "required_hot_input") {
        throw new CurrentSdkOperationError(
          "CURRENT_LIGHT_INPUT_ABSENT",
          "required Light input has no authenticated hot or cold custody",
        );
      }
      accounts.push({
        address,
        role: request.role,
        existsHot: false,
        wasCold: false,
        owner: null,
        mint: request.mint,
        tokenOwner: request.owner,
        amount: null,
        proof: null,
        loadInstructions: [],
      });
      continue;
    }
    if (proof.ata !== address.toBase58() || proof.owner !== request.owner.toBase58()
      || proof.mint !== request.mint.toBase58() || proof.payer !== request.payer.toBase58()
      || proof.providerOriginSha256 !== input.photonConnection.providerOriginSha256
      || !proof.includesColdBalance || !/^(0|[1-9][0-9]*)$/u.test(proof.amountAtomic)) {
      throw new CurrentSdkOperationError("CURRENT_LIGHT_PROOF_INVALID", "cold Light account proof facts are not canonical");
    }
    accounts.push({
      address,
      role: request.role,
      existsHot: false,
      wasCold: true,
      owner: LIGHT_TOKEN_PROGRAM_ID,
      mint: request.mint,
      tokenOwner: request.owner,
      amount: BigInt(proof.amountAtomic),
      proof,
      loadInstructions: [],
    });
    coldRequests.push({ request, address, resolver });
  }
  if (coldRequests.length > 1) {
    throw new CurrentSdkOperationError(
      "CURRENT_LIGHT_COLD_BOUND_EXCEEDED",
      "one prepared action may load at most one cold Light ATA; additional loads require finalized sequential preparation",
    );
  }
  let readyPlan: LightAtaReadyActionPlan | null = null;
  if (coldRequests.length === 1) {
    if (input.actionInstructions === undefined || input.actionInstructions.length === 0) {
      throw new CurrentSdkOperationError(
        "CURRENT_LIGHT_ACTION_REQUIRED",
        "cold Light resolution requires the exact action for an atomic load-ready plan",
      );
    }
    const cold = coldRequests[0]!;
    readyPlan = await cold.resolver.buildLightAtaReadyActionPlan({
      tokenAccounts: [{
        ata: cold.address,
        owner: cold.request.owner,
        mint: cold.request.mint,
      }],
      actionInstructions: input.actionInstructions,
    });
    const finalBatch = readyPlan.instructionBatches[readyPlan.actionBatchIndex];
    const actionOffset = (finalBatch?.length ?? 0) - input.actionInstructions.length;
    if (actionOffset < 0 || input.actionInstructions.some((instruction, index) =>
      !sameInstruction(finalBatch?.[actionOffset + index], instruction))) {
      throw new CurrentSdkOperationError("CURRENT_LIGHT_LOAD_PLAN_INVALID", "Light load plan does not end in the exact requested action");
    }
  }
  const instructionBatches = readyPlan?.instructionBatches ?? Object.freeze([]);
  return {
    ...identity(),
    accounts,
    instructionBatches,
    loadBatchCount: readyPlan?.loadBatchCount ?? 0,
    actionBatchIndex: readyPlan?.actionBatchIndex ?? null,
  };
}

/**
 * Decode and validate one exact hot Light ATA snapshot. This is deliberately
 * synchronous so callers can bind the same AccountInfo bytes used for their
 * finalized observation without a second RPC read.
 */
export function validateCurrentHotLightAccount(
  input: ValidateCurrentHotLightAccountInput,
): CurrentValidatedHotLightAccount {
  if (input.minimumAmountAtoms < 0n || input.minimumAmountAtoms > 0xffff_ffff_ffff_ffffn) {
    throw new CurrentSdkOperationError(
      "CURRENT_LIGHT_TOKEN_ACCOUNT_INVALID",
      "hot Light ATA minimum amount is not a u64",
    );
  }
  const expectedAddress = getAssociatedTokenAddressInterface(
    input.expectedMint,
    input.expectedTokenOwner,
  );
  if (!input.address.equals(expectedAddress)) {
    throw new CurrentSdkOperationError(
      "CURRENT_LIGHT_TOKEN_ACCOUNT_INVALID",
      "hot Light ATA address is not canonical for the expected mint and token owner",
    );
  }
  const account = decodeRequiredCurrentTokenAccount({
    label: "hot Light ATA",
    address: input.address,
    info: input.info,
    programId: LIGHT_TOKEN_PROGRAM_ID,
    mint: input.expectedMint,
    tokenOwner: input.expectedTokenOwner,
    light: true, scopedSettlement: true,
  });
  if (account.amount < input.minimumAmountAtoms) {
    throw new CurrentSdkOperationError(
      "CURRENT_WRITER_LIGHT_BALANCE_INSUFFICIENT",
      "hot Light ATA amount is below the exact writer-close minimum",
    );
  }
  return Object.freeze({
    address: input.address,
    programOwner: input.info.owner,
    tokenOwner: account.owner,
    mint: account.mint,
    amountAtoms: account.amount,
  });
}

function sameInstruction(left: TransactionInstruction | undefined, right: TransactionInstruction): boolean {
  return left !== undefined && left.programId.equals(right.programId)
    && Buffer.from(left.data).equals(Buffer.from(right.data))
    && left.keys.length === right.keys.length
    && left.keys.every((meta, index) => {
      const expected = right.keys[index];
      return expected !== undefined && meta.pubkey.equals(expected.pubkey)
        && meta.isSigner === expected.isSigner && meta.isWritable === expected.isWritable;
    });
}

function decodeVaultConfigInfo(
  address: PublicKey,
  info: AccountInfo<Buffer>,
  programId: PublicKey,
): CurrentVaultConfigAccount {
  requireProgramAccount("VaultConfig", info, programId, CURRENT_VAULT_CONFIG_ACCOUNT_SIZE);
  return decodeCurrentVaultConfigAccount({
    address,
    data: info.data,
    owner: info.owner,
    executable: info.executable,
    namespace: "ameba-spread-v2",
    programId,
  });
}

function hasCanonicalLightCompressibleTokenLayout(data: Uint8Array): boolean {
  const bytes = Buffer.from(data);
  return bytes.length === 272
    && bytes[165] === 2
    && bytes[166] === 1
    && bytes.readUInt32LE(167) === 1
    && bytes[171] === 32
    // One exact CompressibleExtension: decimals present, compression-only ATA.
    && bytes[172] === 1
    && bytes[173] === 6
    && bytes[174] === 1
    && bytes[175] === 1
    // Current v1 CompressionInfo created by Light Token v0.23.3 defaults.
    && bytes.readUInt16LE(176) === 1
    && bytes[178] === 0
    && bytes[179] === 3
    && bytes.readUInt32LE(180) === 766
    && bytes.subarray(184, 216).equals(CURRENT_LIGHT_COMPRESSION_AUTHORITY.toBuffer())
    && bytes.subarray(216, 248).equals(LIGHT_TOKEN_RENT_SPONSOR.toBuffer())
    // Slot/rent-paid fields are live state; reserved and current rent policy are exact.
    && bytes.readUInt32LE(260) === 0
    && bytes.readUInt16LE(264) === 128
    && bytes.readUInt16LE(266) === 11_000
    && bytes[268] === 1
    && bytes[269] === 2
    && bytes.readUInt16LE(270) === 12_416;
}

function hasCanonicalInitializedTokenPolicy(account: ReturnType<typeof unpackAccount>): boolean {
  return account.isInitialized
    && !account.isFrozen
    && account.delegate === null
    && account.delegatedAmount === 0n
    && !account.isNative
    && account.rentExemptReserve === null
    && account.closeAuthority === null;
}

function decodeRequiredCurrentTokenAccount(input: {
  readonly label: string;
  readonly address: PublicKey;
  readonly info: AccountInfo<Buffer> | null;
  readonly programId: PublicKey;
  readonly mint: PublicKey;
  readonly tokenOwner: PublicKey;
  readonly minimumAmount?: bigint;
  readonly light: boolean;
  readonly scopedSettlement?: boolean;
}): ReturnType<typeof unpackAccount> {
  const code = input.light ? "CURRENT_LIGHT_TOKEN_ACCOUNT_INVALID" : "CURRENT_SPL_TOKEN_ACCOUNT_INVALID";
  if (input.info === null) {
    throw new CurrentSdkOperationError(code, `${input.label} is absent`);
  }
  const expectedLength = input.light ? 272 : AccountLayout.span;
  if (
    input.info.executable
    || !input.info.owner.equals(input.programId)
    || input.info.data.length !== expectedLength
    || (input.light && !hasCanonicalLightCompressibleTokenLayout(input.info.data))
  ) {
    throw new CurrentSdkOperationError(code, `${input.label} owner or exact token layout is invalid`);
  }
  let account: ReturnType<typeof unpackAccount>;
  try {
    account = unpackAccount(input.address, input.info, input.programId);
  } catch {
    throw new CurrentSdkOperationError(code, `${input.label} cannot be decoded as an exact current token account`);
  }
  const scoped = input.scopedSettlement === true && input.light && account.delegate !== null &&
    account.delegate.equals(deriveCollectiveSettlementDelegatePda(input.tokenOwner, input.mint, new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID))[0]);
  const policyAccount = scoped ? { ...account, delegate: null, delegatedAmount: 0n } : account;
  if (
    !account.mint.equals(input.mint)
    || !account.owner.equals(input.tokenOwner)
    || !hasCanonicalInitializedTokenPolicy(policyAccount)
    || (input.minimumAmount !== undefined && account.amount < input.minimumAmount)
  ) {
    throw new CurrentSdkOperationError(code, `${input.label} mint, owner, policy, or balance is invalid`);
  }
  return account;
}

async function requireCurrentLightInterface(input: {
  readonly connection: Connection;
  readonly commitment?: Commitment;
  readonly namespace: CurrentStateNamespace;
  readonly programId: PublicKey;
  readonly mint: PublicKey;
}): Promise<PublicKey> {
  const address = deriveLightSplInterfacePda(input.mint);
  const info = await input.connection.getAccountInfo(address, finalizedCommitment(input.commitment));
  if (info === null) {
    throw new CurrentSdkOperationError("CURRENT_LIGHT_INTERFACE_NOT_FOUND", "required current Light SPL interface is absent");
  }
  decodeCurrentLightSplInterfaceAccount({
    address,
    data: info.data,
    accountOwner: info.owner,
    executable: info.executable,
    namespace: input.namespace,
    programId: input.programId,
    mint: input.mint,
  });
  return address;
}

async function requiredMarket(input: ReadCurrentMarketAccountInput): Promise<CurrentMarketReadResult & { market: CurrentMarketAccount }> {
  const result = await readCurrentMarketAccount(input);
  if (result.market === null) {
    throw new CurrentSdkOperationError("CURRENT_MARKET_NOT_FOUND", "current market does not exist");
  }
  return { ...result, market: result.market };
}

function isNonzeroHash(value: Uint8Array): boolean {
  return value.some((byte) => byte !== 0);
}

function hasCurrentRulebookSchedule(month: CurrentOracleMonthAccount): boolean {
  return month.scheduleVersion === 2
    && month.scrambleStartTs !== 0n
    && month.listingTs === month.scrambleStartTs + CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS;
}

function hasCurrentCanonicalWeightScheme(month: CurrentOracleMonthAccount): boolean {
  return month.weightSchemeVersion === 1
    && month.effectiveWeightTotalBps === 10_000
    && isNonzeroHash(month.weightManifestHash);
}

function hasCurrentActiveWeightScheme(month: CurrentOracleMonthAccount): boolean {
  return month.activeWeightInitializationVersion === 1
    && month.activeWeightSchemeVersion === 1
    && month.activeWeightGroupCount > 0
    && isNonzeroHash(month.activeWeightManifestHash);
}

function isCurrentActiveWeightManifestFinal(
  month: CurrentOracleMonthAccount,
  manifest: CurrentOracleActiveWeightManifestAccount | null,
): boolean {
  return manifest !== null
    && hasCurrentCanonicalWeightScheme(month)
    && hasCurrentActiveWeightScheme(month)
    && isNonzeroHash(month.recipeHash)
    && month.frozenSourceCount > 0
    && month.openingResolvedSourceCount === month.frozenSourceCount
    && month.pendingResolutionCount === 0
    && manifest.phase === "Finalized"
    && manifest.recipeHash.equals(month.recipeHash)
    && manifest.frozenManifestHash.equals(month.weightManifestHash)
    && manifest.rollingManifestHash.equals(month.activeWeightManifestHash)
    && manifest.expectedSourceCount === month.frozenSourceCount
    && manifest.processedSourceCount === manifest.expectedSourceCount
    && manifest.expectedGroupCount === month.activeWeightGroupCount
    && manifest.processedGroupCount === manifest.expectedGroupCount
    && manifest.activeSourceCount > 0
    && manifest.activeSourceCount === month.openedSourceCount
    && manifest.appliedEffectiveWeightTotalBps === 10_000;
}

function isCurrentIssueSkuCoverageFinal(
  month: CurrentOracleMonthAccount,
  coverage: CurrentOracleSkuCoverageManifestAccount | null,
  activeManifest: CurrentOracleActiveWeightManifestAccount | null,
): boolean {
  if (coverage === null || activeManifest === null || !isCurrentActiveWeightManifestFinal(month, activeManifest)) return false;
  const expectedListing = coverage.plannedScrambleStartTs + CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS;
  return coverage.coverageFinalized
    && coverage.coverageCompleteTs !== 0n
    && coverage.coveredSkuCount === coverage.requiredSkuCount
    && coverage.plannedScrambleStartTs !== 0n
    && coverage.plannedListingTs === expectedListing
    && coverage.plannedListingTs <= month.listingTs
    && coverage.coverageCompleteTs >= coverage.plannedScrambleStartTs
    && coverage.coverageCompleteTs < month.listingTs
    && activeManifest.expectedGroupCount === coverage.requiredSkuCount;
}

async function resolvedPoolBytes(
  input: CurrentAdapterContextInput,
  poolAddress: PublicKey,
  payer?: PublicKey,
  collector?: Map<string, CurrentColdAccountProofFacts>,
  resolver = currentColdResolver(input.photonConnection, input.programId, payer, collector),
): Promise<Uint8Array> {
  const hot = await input.connection.getAccountInfo(poolAddress, finalizedCommitment(input.commitment));
  if (hot !== null) {
    requireProgramAccount("AmoebaDlmmPool", hot, input.programId, 384);
    return hot.data;
  }
  const cold = resolver === undefined ? null : await resolver.resolveColdAccount(poolAddress);
  if (cold === null || !cold.owner.equals(input.programId)) {
    throw new CurrentSdkOperationError("CURRENT_DLMM_POOL_NOT_FOUND", "current DLMM pool is unavailable");
  }
  return cold.data;
}

function manifest(
  instruction: TransactionInstruction,
  decodedParams: CurrentDecodedInstructionParams,
): CurrentInstructionManifest {
  return Object.freeze({
    programId: instruction.programId.toBase58(),
    dataBase64: Buffer.from(instruction.data).toString("base64"),
    accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({
      pubkey: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    }))),
    decodedParams: Object.freeze({ ...decodedParams }),
  });
}

function approvedInstruction(value: CurrentInstructionManifest): CurrentApprovedInstruction {
  return Object.freeze({
    programId: value.programId,
    accounts: Object.freeze(value.accounts.map((account) => Object.freeze({
      address: account.pubkey,
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    }))),
    dataBase64: value.dataBase64,
  });
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalDecodedParams(params: CurrentDecodedInstructionParams): string {
  return JSON.stringify(Object.fromEntries(Object.entries(params)
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])));
}

function manifestIdentityParts(instruction: CurrentInstructionManifest): Uint8Array[] {
  const parts: Uint8Array[] = [];
  parts.push(Buffer.from(instruction.programId, "utf8"));
  parts.push(Buffer.from(instruction.dataBase64, "base64"));
  for (const account of instruction.accounts) {
    parts.push(new PublicKey(account.pubkey).toBuffer());
    parts.push(Buffer.from([Number(account.isSigner), Number(account.isWritable)]));
  }
  parts.push(Buffer.from(canonicalDecodedParams(instruction.decodedParams), "utf8"));
  return parts;
}

function operationId(
  operation: CurrentOperationPlan["operation"],
  instructions: readonly CurrentInstructionManifest[],
  setupInstructionBatches: readonly (readonly CurrentInstructionManifest[])[],
  proofFacts: Readonly<Record<string, string | number | boolean | null>>,
): string {
  const parts: Uint8Array[] = [Buffer.from(operation, "utf8"), Buffer.from([instructions.length])];
  for (const instruction of instructions) {
    parts.push(...manifestIdentityParts(instruction));
  }
  parts.push(Buffer.from([setupInstructionBatches.length]));
  for (const batch of setupInstructionBatches) {
    parts.push(Buffer.from([batch.length]));
    for (const instruction of batch) parts.push(...manifestIdentityParts(instruction));
  }
  const canonicalProofFacts = Object.fromEntries(Object.entries(proofFacts).sort(([left], [right]) => compareCanonicalText(left, right)));
  parts.push(Buffer.from(JSON.stringify(canonicalProofFacts), "utf8"));
  return hashBuffers(parts).toString("hex");
}

function cloneAndFreezeIssuedValue<T>(value: T, seen = new Map<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof PublicKey) return Object.freeze(new PublicKey(value.toBytes())) as T;
  // Node cannot freeze non-empty typed-array views. They are nevertheless
  // detached here, and the factory binds their bytes into an integrity digest
  // that is rechecked before validation or submission.
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (value instanceof Uint8Array) return Uint8Array.from(value) as T;
  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneAndFreezeIssuedValue(item, seen));
    return Object.freeze(copy) as T;
  }
  const copy = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) continue;
    Object.defineProperty(copy, key, {
      ...descriptor,
      value: cloneAndFreezeIssuedValue(descriptor.value, seen),
      writable: true,
      configurable: true,
    });
  }
  return Object.freeze(copy) as T;
}

function canonicalIssuedValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", "issued plan graph contains a non-finite number");
    }
    return value;
  }
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (typeof value === "undefined") return { undefined: true };
  if (typeof value !== "object") return { unsupported: typeof value };
  if (value instanceof PublicKey) return { publicKey: value.toBase58() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { bytesBase64: Buffer.from(value).toString("base64") };
  }
  if (seen.has(value)) throw new CurrentSdkOperationError("CURRENT_PLAN_CYCLE_INVALID", "issued plan graph must be acyclic");
  seen.add(value);
  let canonical: unknown;
  if (Array.isArray(value)) {
    canonical = value.map((item) => canonicalIssuedValue(item, seen));
  } else {
    canonical = Object.fromEntries(Reflect.ownKeys(value)
      .filter((key): key is string => typeof key === "string")
      .sort(compareCanonicalText)
      .map((key) => [key, canonicalIssuedValue((value as Record<string, unknown>)[key], seen)]));
  }
  seen.delete(value);
  return canonical;
}

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalIssuedValue(left)) === JSON.stringify(canonicalIssuedValue(right));
}

/**
 * One canonical digest contract for every current submit-capable prepare lane.
 * The caller passes the complete issued plan graph before the digest field is
 * attached, so every request, identity, proof/setup fact, manifest, compiled
 * transaction, and backend signature is bound by the same domain-separated
 * rule.
 */
function currentPreparedPlanDigest(
  operation: CurrentOperationPlan["operation"],
  planWithoutDigest: object,
): string {
  const hash = createHash("sha256");
  hash.update("ameba-spread-v2/current-prepared-plan-v1\0", "utf8");
  hash.update(operation, "utf8");
  hash.update("\0", "utf8");
  hash.update(JSON.stringify(canonicalIssuedValue(planWithoutDigest)), "utf8");
  return hash.digest("hex");
}

function issuedPlanIntegrityDigest(planValue: CurrentOperationPlan): string {
  return createHash("sha256").update(JSON.stringify(canonicalIssuedValue(planValue))).digest("hex");
}

function orderedUniqueWritableAccounts(
  instructions: readonly CurrentInstructionManifest[],
  setupInstructionBatches: readonly (readonly CurrentInstructionManifest[])[],
): readonly string[] {
  const seen = new Set<string>();
  const writeSet: string[] = [];
  for (const instruction of [...setupInstructionBatches.flat(), ...instructions]) {
    for (const account of instruction.accounts) {
      if (account.isWritable && !seen.has(account.pubkey)) {
        seen.add(account.pubkey);
        writeSet.push(account.pubkey);
      }
    }
  }
  return Object.freeze(writeSet);
}

function mainSignerRole(operation: CurrentOperationPlan["operation"]): Exclude<CurrentPlanSignerRoleName, "setup_payer"> {
  if (operation === "position_action") return "position_owner";
  if (operation !== "oracle_draft") {
    throw new CurrentSdkOperationError("CURRENT_PLAN_OPERATION_INVALID", "only current Oracle plans use this adapter boundary");
  }
  return "oracle_actor";
}

function signerRolesForInstructions(
  operation: CurrentOperationPlan["operation"],
  instructions: readonly CurrentInstructionManifest[],
  setupInstructionBatches: readonly (readonly CurrentInstructionManifest[])[],
): readonly CurrentPlanSignerRole[] {
  const roles: CurrentPlanSignerRole[] = [];
  const append = (
    manifests: readonly CurrentInstructionManifest[],
    role: CurrentPlanSignerRoleName,
    scope: CurrentPlanSignerRole["scope"],
    setupBatchIndex: number | null,
  ): void => {
    const indexes = new Map<string, number[]>();
    manifests.forEach((instruction, instructionIndex) => {
      for (const account of instruction.accounts) {
        if (!account.isSigner) continue;
        const prior = indexes.get(account.pubkey) ?? [];
        if (!prior.includes(instructionIndex)) prior.push(instructionIndex);
        indexes.set(account.pubkey, prior);
      }
    });
    for (const [pubkey, instructionIndexes] of indexes) {
      roles.push(Object.freeze({
        pubkey,
        role,
        scope,
        setupBatchIndex,
        instructionIndexes: Object.freeze(instructionIndexes),
      }));
    }
  };
  setupInstructionBatches.forEach((batch, batchIndex) => append(batch, "setup_payer", "setup", batchIndex));
  append(instructions, mainSignerRole(operation), "main", null);
  return Object.freeze(roles);
}

function plan(
  operation: CurrentOperationPlan["operation"],
  instructions: readonly CurrentInstructionManifest[],
  setupInstructionBatches: readonly (readonly CurrentInstructionManifest[])[] = [],
  proofFacts: Readonly<Record<string, string | number | boolean | null>> = {},
): CurrentOperationPlan {
  return Object.freeze({
    ...identity(),
    operation,
    operationId: operationId(operation, instructions, setupInstructionBatches, proofFacts),
    instructions: Object.freeze([...instructions]),
    setupInstructionBatches: Object.freeze(setupInstructionBatches.map((batch) => Object.freeze([...batch]))),
    proofFacts: Object.freeze({ ...proofFacts }),
    writeSet: orderedUniqueWritableAccounts(instructions, setupInstructionBatches),
    signerRoles: signerRolesForInstructions(operation, instructions, setupInstructionBatches),
  });
}

function instructionFromManifest(value: CurrentInstructionManifest): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(value.programId),
    keys: value.accounts.map((account): AccountMeta => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(value.dataBase64, "base64"),
  });
}

function serializeUnsignedTransaction(
  instructions: readonly TransactionInstruction[],
  feePayer: PublicKey,
  recentBlockhash: string,
): string {
  const message = new TransactionMessage({ payerKey: feePayer, recentBlockhash,
    instructions: [...instructions] }).compileToLegacyMessage();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

const CURRENT_LOOKUP_TABLE_ACTIVE_DEACTIVATION_SLOT = 0xffff_ffff_ffff_ffffn;

function shortVectorByteLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "short-vector length is invalid");
  }
  let remaining = value;
  let bytes = 0;
  do {
    bytes += 1;
    remaining = Math.floor(remaining / 128);
  } while (remaining > 0);
  return bytes;
}

function versionedTransactionByteLength(
  message: ReturnType<TransactionMessage["compileToV0Message"]>,
): number {
  const signatureCount = message.header.numRequiredSignatures;
  let messageBytes = 1 // v0 prefix
    + 3 // message header
    + shortVectorByteLength(message.staticAccountKeys.length)
    + message.staticAccountKeys.length * 32
    + 32 // recent blockhash
    + shortVectorByteLength(message.compiledInstructions.length);
  for (const instruction of message.compiledInstructions) {
    messageBytes += 1
      + shortVectorByteLength(instruction.accountKeyIndexes.length)
      + instruction.accountKeyIndexes.length
      + shortVectorByteLength(instruction.data.length)
      + instruction.data.length;
  }
  messageBytes += shortVectorByteLength(message.addressTableLookups.length);
  for (const lookup of message.addressTableLookups) {
    messageBytes += 32
      + shortVectorByteLength(lookup.writableIndexes.length)
      + lookup.writableIndexes.length
      + shortVectorByteLength(lookup.readonlyIndexes.length)
      + lookup.readonlyIndexes.length;
  }
  return shortVectorByteLength(signatureCount) + signatureCount * 64 + messageBytes;
}

export function currentOracleLookupTableAddressesSha256(
  addresses: readonly (PublicKey | string)[],
): string {
  const hash = createHash("sha256");
  hash.update("ameba-spread-v2/current-oracle-lookup-table-addresses-v1\0", "utf8");
  const count = Buffer.alloc(4);
  count.writeUInt32LE(addresses.length, 0);
  hash.update(count);
  for (const address of addresses) {
    hash.update((address instanceof PublicKey ? address : new PublicKey(address)).toBuffer());
  }
  return hash.digest("hex");
}

function encodeCurrentLookupTableAccountData(input: {
  readonly deactivationSlot: bigint;
  readonly lastExtendedSlot: number;
  readonly lastExtendedSlotStartIndex: number;
  readonly authority: PublicKey | null;
  readonly addresses: readonly PublicKey[];
}): Buffer {
  const data = Buffer.alloc(56 + input.addresses.length * 32);
  data.writeUInt32LE(1, 0);
  data.writeBigUInt64LE(input.deactivationSlot, 4);
  data.writeBigUInt64LE(BigInt(input.lastExtendedSlot), 12);
  data[20] = input.lastExtendedSlotStartIndex;
  data[21] = input.authority === null ? 0 : 1;
  if (input.authority !== null) input.authority.toBuffer().copy(data, 22);
  input.addresses.forEach((address, index) => address.toBuffer().copy(data, 56 + index * 32));
  return data;
}

interface CurrentResolvedOracleLookupTable {
  readonly account: AddressLookupTableAccount;
  readonly address: string;
  readonly owner: string;
  readonly authority: string | null;
  readonly deactivationSlot: string;
  readonly lastExtendedSlot: string;
  readonly lastExtendedSlotStartIndex: number;
  readonly observedFinalizedSlot: string;
  readonly addresses: readonly string[];
  readonly addressesSha256: string;
  readonly accountDataSha256: string;
}

async function resolveCurrentOracleLookupTable(input: {
  readonly connection: Connection;
  readonly authorization: CurrentOracleCompressedStateLookupTableAuthorization;
  readonly commitment?: Commitment;
}): Promise<CurrentResolvedOracleLookupTable> {
  const address = input.authorization.address instanceof PublicKey
    ? input.authorization.address
    : new PublicKey(input.authorization.address);
  const expectedAuthority = input.authorization.authority === null
    ? null
    : input.authorization.authority instanceof PublicKey
      ? input.authorization.authority
      : new PublicKey(input.authorization.authority);
  if (!/^[0-9a-f]{64}$/.test(input.authorization.addressesSha256)) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "authorized lookup-table content digest is not canonical SHA-256");
  }
  const [info, finalizedSlot] = await Promise.all([
    input.connection.getAccountInfo(address, finalizedCommitment(input.commitment)),
    input.connection.getSlot(CURRENT_STATE_COMMITMENT),
  ]);
  if (
    info === null
    || info.executable
    || !info.owner.equals(AddressLookupTableProgram.programId)
    || !Number.isSafeInteger(finalizedSlot)
    || finalizedSlot < 0
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_UNAVAILABLE", "authorized finalized Oracle lookup table is absent or invalid");
  }
  let state: ReturnType<typeof AddressLookupTableAccount.deserialize>;
  try {
    state = AddressLookupTableAccount.deserialize(info.data);
  } catch (cause) {
    throw new CurrentSdkOperationError(
      "CURRENT_ORACLE_LOOKUP_TABLE_INVALID",
      `authorized Oracle lookup-table account layout is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const account = new AddressLookupTableAccount({ key: address, state });
  const actualAuthority = state.authority ?? null;
  const addresses = Object.freeze(state.addresses.map((value) => value.toBase58()));
  const addressSet = new Set(addresses);
  const addressesSha256 = currentOracleLookupTableAddressesSha256(state.addresses);
  if (
    !account.isActive()
    || state.deactivationSlot !== CURRENT_LOOKUP_TABLE_ACTIVE_DEACTIVATION_SLOT
    || (actualAuthority === null) !== (expectedAuthority === null)
    || (actualAuthority !== null && expectedAuthority !== null && !actualAuthority.equals(expectedAuthority))
    || !Number.isSafeInteger(state.lastExtendedSlot)
    || state.lastExtendedSlot < 0
    || state.lastExtendedSlot >= finalizedSlot
    || !Number.isSafeInteger(state.lastExtendedSlotStartIndex)
    || state.lastExtendedSlotStartIndex < 0
    || state.lastExtendedSlotStartIndex > addresses.length
    || addresses.length < 1
    || addresses.length > 256
    || addressSet.size !== addresses.length
    || addressesSha256 !== input.authorization.addressesSha256
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "authorized Oracle lookup-table state, authority, activation, or contents differ");
  }
  const canonicalAccountData = encodeCurrentLookupTableAccountData({
    deactivationSlot: state.deactivationSlot,
    lastExtendedSlot: state.lastExtendedSlot,
    lastExtendedSlotStartIndex: state.lastExtendedSlotStartIndex,
    authority: actualAuthority,
    addresses: state.addresses,
  });
  if (!Buffer.from(info.data).equals(canonicalAccountData)) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "authorized Oracle lookup-table bytes are not canonical");
  }
  return Object.freeze({
    account,
    address: address.toBase58(),
    owner: AddressLookupTableProgram.programId.toBase58(),
    authority: actualAuthority?.toBase58() ?? null,
    deactivationSlot: state.deactivationSlot.toString(),
    lastExtendedSlot: String(state.lastExtendedSlot),
    lastExtendedSlotStartIndex: state.lastExtendedSlotStartIndex,
    observedFinalizedSlot: String(finalizedSlot),
    addresses,
    addressesSha256,
    accountDataSha256: createHash("sha256").update(canonicalAccountData).digest("hex"),
  });
}

function theoreticalOracleLookupTable(
  instructions: readonly TransactionInstruction[],
  feePayer: PublicKey,
): AddressLookupTableAccount {
  const addresses = new Map<string, PublicKey>();
  for (const instruction of instructions) {
    addresses.set(instruction.programId.toBase58(), instruction.programId);
    for (const meta of instruction.keys) {
      if (!meta.isSigner && !meta.pubkey.equals(feePayer)) addresses.set(meta.pubkey.toBase58(), meta.pubkey);
    }
  }
  const tableKey = new PublicKey(hashBuffers([
    Buffer.from("ameba-spread-v2/current-oracle-theoretical-alt-v1\0", "utf8"),
    ...[...addresses.values()].map((value) => value.toBuffer()),
  ]).subarray(0, 32));
  return new AddressLookupTableAccount({
    key: tableKey,
    state: {
      deactivationSlot: CURRENT_LOOKUP_TABLE_ACTIVE_DEACTIVATION_SLOT,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [...addresses.values()],
    },
  });
}

function compileUnsignedV0Transaction(input: {
  readonly instructions: readonly TransactionInstruction[];
  readonly feePayer: PublicKey;
  readonly recentBlockhash: string;
  readonly lookupTables?: readonly AddressLookupTableAccount[];
}): {
  readonly serializedTransactionBase64: string;
  readonly serializedByteLength: number;
  readonly message: ReturnType<TransactionMessage["compileToV0Message"]>;
} {
  const message = new TransactionMessage({
    payerKey: input.feePayer,
    recentBlockhash: input.recentBlockhash,
    instructions: [...input.instructions],
  }).compileToV0Message([...(input.lookupTables ?? [])]);
  const serializedByteLength = versionedTransactionByteLength(message);
  if (serializedByteLength > PACKET_DATA_SIZE) {
    throw new CurrentSdkOperationError(
      "CURRENT_ORACLE_TRANSACTION_TOO_LARGE",
      `current Oracle transaction is ${serializedByteLength} bytes; maximum is ${PACKET_DATA_SIZE}`,
      { serializedByteLength, packetDataSizeLimit: PACKET_DATA_SIZE },
    );
  }
  const serialized = Buffer.from(new VersionedTransaction(message).serialize());
  if (serialized.length !== serializedByteLength || serialized.length > PACKET_DATA_SIZE) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_TRANSACTION_INVALID", "compiled Oracle v0 transaction length is inconsistent");
  }
  return Object.freeze({
    serializedTransactionBase64: serialized.toString("base64"),
    serializedByteLength,
    message,
  });
}

function currentOracleLookupTableFromWitness(
  witness: CurrentOracleLookupTableWitness,
): AddressLookupTableAccount {
  exactKeys(witness, [
    "address", "owner", "authority", "deactivationSlot", "lastExtendedSlot",
    "lastExtendedSlotStartIndex", "observedFinalizedSlot", "addresses", "addressesSha256",
    "accountDataSha256", "writableIndexes", "readonlyIndexes", "serializedByteLength",
  ], "CURRENT_ORACLE_LOOKUP_TABLE_INVALID");
  if (
    typeof witness.address !== "string"
    || (witness.authority !== null && typeof witness.authority !== "string")
    || typeof witness.deactivationSlot !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(witness.deactivationSlot)
    || !Array.isArray(witness.addresses)
    || !witness.addresses.every((value) => typeof value === "string")
    || !Array.isArray(witness.writableIndexes)
    || !Array.isArray(witness.readonlyIndexes)
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "Oracle lookup-table witness encoding is invalid");
  }
  let address: PublicKey;
  let authority: PublicKey | null;
  let addresses: PublicKey[];
  try {
    address = new PublicKey(witness.address);
    authority = witness.authority === null ? null : new PublicKey(witness.authority);
    addresses = witness.addresses.map((value) => new PublicKey(value));
  } catch {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "Oracle lookup-table witness contains an invalid public key");
  }
  const deactivationSlot = BigInt(witness.deactivationSlot);
  const lastExtendedSlot = Number(witness.lastExtendedSlot);
  const observedFinalizedSlot = Number(witness.observedFinalizedSlot);
  const uniqueAddresses = new Set(witness.addresses);
  const allIndexes = [...witness.writableIndexes, ...witness.readonlyIndexes];
  if (
    witness.owner !== AddressLookupTableProgram.programId.toBase58()
    || deactivationSlot !== CURRENT_LOOKUP_TABLE_ACTIVE_DEACTIVATION_SLOT
    || !/^(0|[1-9][0-9]*)$/.test(witness.lastExtendedSlot)
    || !/^(0|[1-9][0-9]*)$/.test(witness.observedFinalizedSlot)
    || !Number.isSafeInteger(lastExtendedSlot)
    || !Number.isSafeInteger(observedFinalizedSlot)
    || observedFinalizedSlot <= lastExtendedSlot
    || !Number.isSafeInteger(witness.lastExtendedSlotStartIndex)
    || witness.lastExtendedSlotStartIndex < 0
    || witness.lastExtendedSlotStartIndex > addresses.length
    || addresses.length < 1
    || addresses.length > 256
    || uniqueAddresses.size !== addresses.length
    || currentOracleLookupTableAddressesSha256(addresses) !== witness.addressesSha256
    || !/^[0-9a-f]{64}$/.test(witness.accountDataSha256)
    || !Number.isSafeInteger(witness.serializedByteLength)
    || witness.serializedByteLength < 1
    || witness.serializedByteLength > PACKET_DATA_SIZE
    || allIndexes.length < 1
    || new Set(allIndexes).size !== allIndexes.length
    || allIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= addresses.length)
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "Oracle lookup-table witness state, contents, activation, or indexes are invalid");
  }
  const canonicalData = encodeCurrentLookupTableAccountData({
    deactivationSlot,
    lastExtendedSlot,
    lastExtendedSlotStartIndex: witness.lastExtendedSlotStartIndex,
    authority,
    addresses,
  });
  if (createHash("sha256").update(canonicalData).digest("hex") !== witness.accountDataSha256) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "Oracle lookup-table account-data digest changed");
  }
  return new AddressLookupTableAccount({
    key: address,
    state: {
      deactivationSlot,
      lastExtendedSlot,
      lastExtendedSlotStartIndex: witness.lastExtendedSlotStartIndex,
      authority: authority ?? undefined,
      addresses,
    },
  });
}

function validateOracleApprovedTransaction(plan: CurrentOracleDraftPlan, owner: PublicKey): void {
  exactKeys(plan.transaction, [
    "serializedTransactionBase64", "recentBlockhash", "backendPartialSignatures", "approvedInstructions",
  ], "CURRENT_ORACLE_DRAFT_INVALID");
  const expectedApproved = plan.instructions.map(approvedInstruction);
  const approved = plan.transaction.approvedInstructions;
  const serialized = Buffer.from(plan.transaction.serializedTransactionBase64, "base64");
  const instruction = instructionFromManifest(plan.outerInstruction);
  const instructions = plan.instructions.map(instructionFromManifest);
  const lookupTable = plan.transactionLookupTable === null
    ? null
    : currentOracleLookupTableFromWitness(plan.transactionLookupTable);
  const expectedCompiled = compileUnsignedV0Transaction({
    instructions,
    feePayer: owner,
    recentBlockhash: plan.transaction.recentBlockhash,
    lookupTables: lookupTable === null ? [] : [lookupTable],
  });
  const noLookupMessage = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: plan.transaction.recentBlockhash,
    instructions,
  }).compileToV0Message();
  const theoreticalMessage = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: plan.transaction.recentBlockhash,
    instructions,
  }).compileToV0Message([theoreticalOracleLookupTable(instructions, owner)]);
  exactKeys(plan.transportMetrics, [
    "outerInstructionDataBytes", "outerAccountMetaCount", "outerUniqueAccountKeys",
    "noLookupTableSerializedByteLength", "serializedByteLength",
    "theoreticalAltMinimizedByteLength", "packetDataSizeLimit",
  ], "CURRENT_ORACLE_DRAFT_INVALID");
  const expectedMetrics: CurrentOracleTransportMetrics = {
    outerInstructionDataBytes: instruction.data.length,
    outerAccountMetaCount: instruction.keys.length,
    outerUniqueAccountKeys: new Set([
      owner.toBase58(), instruction.programId.toBase58(), ...instruction.keys.map((meta) => meta.pubkey.toBase58()),
    ]).size,
    noLookupTableSerializedByteLength: versionedTransactionByteLength(noLookupMessage),
    serializedByteLength: expectedCompiled.serializedByteLength,
    theoreticalAltMinimizedByteLength: versionedTransactionByteLength(theoreticalMessage),
    packetDataSizeLimit: PACKET_DATA_SIZE,
  };
  if (
    serialized.toString("base64") !== plan.transaction.serializedTransactionBase64
    || plan.transaction.backendPartialSignatures.length !== 0
    || plan.transaction.approvedInstructions.length !== instructions.length
    || approved === undefined
    || !canonicalValuesEqual(approved, expectedApproved)
    || expectedCompiled.serializedTransactionBase64 !== plan.transaction.serializedTransactionBase64
    || !canonicalValuesEqual(plan.transportMetrics, expectedMetrics)
    || plan.transportMetrics.serializedByteLength !== serialized.length
    || (plan.transactionLookupTable !== null
      && plan.transactionLookupTable.serializedByteLength !== serialized.length)
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "Oracle v0 transaction does not bind the exact outer instruction, owner, or blockhash");
  }
  try {
    const parsed = VersionedTransaction.deserialize(serialized);
    const expectedLookup = plan.transactionLookupTable;
    const parsedLookup = parsed.message.addressTableLookups[0];
    if (
      parsed.version !== 0
      || parsed.message.recentBlockhash !== plan.transaction.recentBlockhash
      || (expectedLookup === null && parsed.message.addressTableLookups.length !== 0)
      || (expectedLookup !== null && (
        parsed.message.addressTableLookups.length !== 1
        || parsedLookup === undefined
        || parsedLookup.accountKey.toBase58() !== expectedLookup.address
        || JSON.stringify([...parsedLookup.writableIndexes]) !== JSON.stringify(expectedLookup.writableIndexes)
        || JSON.stringify([...parsedLookup.readonlyIndexes]) !== JSON.stringify(expectedLookup.readonlyIndexes)
      ))
    ) {
      throw new Error("wrong version or blockhash");
    }
  } catch (cause) {
    throw new CurrentSdkOperationError(
      "CURRENT_ORACLE_DRAFT_INVALID",
      `Oracle serialized transaction is not one exact v0 message: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function validateCurrentPlanExecutionFacts(planValue: CurrentOperationPlan): void {
  const expectedWriteSet = orderedUniqueWritableAccounts(
    planValue.instructions,
    planValue.setupInstructionBatches,
  );
  if (JSON.stringify(planValue.writeSet) !== JSON.stringify(expectedWriteSet)) {
    throw new CurrentSdkOperationError(
      "CURRENT_PLAN_WRITE_SET_INVALID",
      "operation plan write set is not the ordered unique setup-then-main writable account set",
    );
  }
  const expectedSignerRoles = signerRolesForInstructions(
    planValue.operation,
    planValue.instructions,
    planValue.setupInstructionBatches,
  );
  if (!canonicalValuesEqual(planValue.signerRoles, expectedSignerRoles)) {
    throw new CurrentSdkOperationError(
      "CURRENT_PLAN_SIGNER_ROLES_INVALID",
      "operation plan signer roles do not match exact signer metas and execution ordering",
    );
  }
  for (const role of planValue.signerRoles) {
    exactKeys(role, ["pubkey", "role", "scope", "setupBatchIndex", "instructionIndexes"], "CURRENT_PLAN_SIGNER_ROLES_INVALID");
    try {
      new PublicKey(role.pubkey);
    } catch {
      throw new CurrentSdkOperationError("CURRENT_PLAN_SIGNER_ROLES_INVALID", "operation plan signer role contains an invalid public key");
    }
  }
}

function validateCurrentOperationPlanStructure(input: {
  readonly plan: CurrentOperationPlan;
  readonly operation: CurrentOperationPlan["operation"];
  readonly namespace: CurrentStateNamespace;
}): void {
  if (input.namespace !== CURRENT_STATE_NAMESPACE || input.plan.stateNamespace !== CURRENT_STATE_NAMESPACE) {
    throw new CurrentSdkOperationError("CURRENT_PLAN_NAMESPACE_INVALID", "operation plan namespace is not current");
  }
  if (input.plan.operation !== input.operation) {
    throw new CurrentSdkOperationError("CURRENT_PLAN_OPERATION_INVALID", "operation identity does not match plan");
  }
  if (input.plan.instructions.length < 1 || input.plan.instructions.length > 3) {
    throw new CurrentSdkOperationError("CURRENT_PLAN_INSTRUCTION_BOUND", "operation plan must contain 1..3 instructions");
  }
  const tagSequence = input.plan.instructions.map((instruction) => instruction.decodedParams.tag).join(",");
  const allowedSequences: Readonly<Record<CurrentOperationPlan["operation"], readonly string[]>> = {
    oracle_draft: ["131", "133", "138", "2,1,139", "155", "176", "177", "181", "205"],
    position_action: ["9", "10", "11"],
  };
  if (!allowedSequences[input.plan.operation]?.includes(tagSequence)) {
    throw new CurrentSdkOperationError("CURRENT_PLAN_TAG_SEQUENCE_INVALID", "operation contains a tag sequence outside its current lane");
  }
  for (const [index, instruction] of input.plan.instructions.entries()) {
    if (input.plan.operation === "oracle_draft" && tagSequence === "2,1,139" && index < 2) continue; // exact prefix is checked by Oracle validation below
    if (instruction.programId !== DEFAULT_AMEBA_SPREAD_PROGRAM_ID) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_PROGRAM_INVALID", "plan instruction has a foreign program id");
    }
    const data = Buffer.from(instruction.dataBase64, "base64");
    if (data.toString("base64") !== instruction.dataBase64) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_DATA_INVALID", "instruction data is not canonical base64");
    }
    if (data.length < 1 || data.length > 16_384 || data[0] !== instruction.decodedParams.tag) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_DATA_INVALID", "plan instruction bytes do not match decoded tag");
    }
  }
  if (input.plan.setupInstructionBatches.length > 8) {
    throw new CurrentSdkOperationError("CURRENT_SETUP_BOUND_INVALID", "setup transaction batch count exceeds the current bound");
  }
  for (const batch of input.plan.setupInstructionBatches) {
    if (batch.length < 1 || batch.length > 8) {
      throw new CurrentSdkOperationError("CURRENT_SETUP_BOUND_INVALID", "setup batch instruction count is not 1..8");
    }
    const isColdBatch = batch.length === 1
      && batch[0]?.programId === DEFAULT_AMEBA_SPREAD_PROGRAM_ID
      && batch[0].decodedParams.tag === 219;
    if (!isColdBatch) {
      const compute = batch[0];
      const computeData = compute === undefined ? null : Buffer.from(compute.dataBase64, "base64");
      if (
        compute === undefined
        || compute.programId !== ComputeBudgetProgram.programId.toBase58()
        || compute.accounts.length !== 0
        || computeData === null
        || computeData.length !== 5
        || computeData[0] !== 2
        || computeData.readUInt32LE(1) < 50_000
        || computeData.readUInt32LE(1) > 1_400_000
        || batch.length < 2
      ) {
        throw new CurrentSdkOperationError("CURRENT_SETUP_INSTRUCTION_INVALID", "Light ATA setup must begin with one bounded compute-unit instruction");
      }
    }
    for (const [instructionIndex, instruction] of batch.entries()) {
      const data = Buffer.from(instruction.dataBase64, "base64");
      const isCurrentColdLoad = instruction.programId === DEFAULT_AMEBA_SPREAD_PROGRAM_ID
        && instruction.decodedParams.tag === 219
        && data[0] === 219;
      const isComputeBudget = !isColdBatch && instructionIndex === 0;
      const isLightTokenLoad = !isColdBatch
        && instructionIndex > 0
        && instruction.programId === LIGHT_TOKEN_PROGRAM_ID.toBase58();
      if (
        (!isComputeBudget && !isLightTokenLoad && !isCurrentColdLoad)
        || data.length < 1
        || data.length > 16_384
        || data.toString("base64") !== instruction.dataBase64
        || (!isComputeBudget && instruction.accounts.length < 1)
        || instruction.accounts.length > 64
      ) {
        throw new CurrentSdkOperationError("CURRENT_SETUP_INSTRUCTION_INVALID", "setup instruction is outside the current Light ATA or tag-219 lanes");
      }
    }
  }
  for (const [key, value] of Object.entries(input.plan.proofFacts)) {
    if (
      key.length < 1
      || key.length > 64
      || (value !== null && !["string", "number", "boolean"].includes(typeof value))
      || (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new CurrentSdkOperationError("CURRENT_PROOF_FACTS_INVALID", "proof facts are not bounded canonical scalars");
    }
  }
  validateCurrentPlanExecutionFacts(input.plan);
  if (input.plan.operation === "position_action") validateCurrentPositionActionPlan(input.plan as CurrentPositionActionPlan);
  else validateCurrentOracleDraftPlan(input.plan as CurrentOracleDraftPlan);
  const expectedId = operationId(
    input.plan.operation,
    input.plan.instructions,
    input.plan.setupInstructionBatches,
    input.plan.proofFacts,
  );
  if (input.plan.operationId !== expectedId) {
    throw new CurrentSdkOperationError("CURRENT_PLAN_ID_INVALID", "operation plan id does not bind exact bytes and metas");
  }
}

/**
 * Stateless validation for a portable rich plan. Adapter instances add a
 * separate issued-object check through their method of the same name.
 */
export function validateCurrentOperationPlan(planValue: CurrentOperationPlan): void {
  validateCurrentOperationPlanStructure({
    plan: planValue,
    operation: planValue.operation,
    namespace: planValue.stateNamespace,
  });
}

function reviveCurrentPlanJson(value: CurrentPlanJsonValue, path = "plan"): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path} contains a non-finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => reviveCurrentPlanJson(item, `${path}[${index}]`));
  }
  if (typeof value !== "object") {
    throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path} is not JSON-safe`);
  }
  const objectValue = value as CurrentPlanJsonObject;
  const keys = Object.keys(objectValue);
  if (keys.length === 1 && keys[0] === "bigint") {
    const encoded = objectValue.bigint;
    if (typeof encoded !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(encoded) || BigInt(encoded).toString() !== encoded) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path}.bigint is not canonical`);
    }
    return BigInt(encoded);
  }
  if (keys.length === 1 && keys[0] === "publicKey") {
    const encoded = objectValue.publicKey;
    if (typeof encoded !== "string") {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path}.publicKey is not a string`);
    }
    try {
      return new PublicKey(encoded);
    } catch {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path}.publicKey is invalid`);
    }
  }
  if (keys.length === 1 && keys[0] === "bytesBase64") {
    const encoded = objectValue.bytesBase64;
    if (typeof encoded !== "string" || Buffer.from(encoded, "base64").toString("base64") !== encoded) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path}.bytesBase64 is not canonical`);
    }
    return Buffer.from(encoded, "base64");
  }
  if (keys.length === 1 && keys[0] === "undefined") {
    if (objectValue.undefined !== true) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", `${path}.undefined is not canonical`);
    }
    return undefined;
  }
  const revived: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) revived[key] = reviveCurrentPlanJson(objectValue[key]!, `${path}.${key}`);
  return revived;
}

/** Return the complete immutable plan as a canonical JSON-safe value. */
export function currentOperationPlanToJson(planValue: CurrentOperationPlan): CurrentOperationPlanJson {
  validateCurrentOperationPlanStructure({
    plan: planValue,
    operation: planValue.operation,
    namespace: planValue.stateNamespace,
  });
  return cloneAndFreezeIssuedValue(canonicalIssuedValue(planValue)) as CurrentOperationPlanJson;
}

/** Validate a persisted/remote JSON plan and all of its RC44 bytes, metas, PDAs, digests, and proof facts. */
export function validateCurrentOperationPlanJson(planJson: CurrentOperationPlanJson): void {
  const revived = reviveCurrentPlanJson(planJson);
  if (revived === null || typeof revived !== "object") {
    throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", "operation plan JSON must be an object");
  }
  const planValue = revived as CurrentOperationPlan;
  if (planValue.operation !== "oracle_draft" && planValue.operation !== "position_action") {
    throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", "operation plan JSON has an unsupported operation");
  }
  validateCurrentOperationPlanStructure({
    plan: planValue,
    operation: planValue.operation,
    namespace: planValue.stateNamespace,
  });
  if (JSON.stringify(canonicalIssuedValue(planValue)) !== JSON.stringify(planJson)) {
    throw new CurrentSdkOperationError("CURRENT_PLAN_JSON_INVALID", "operation plan JSON is not the canonical exact-value projection");
  }
}

function exactKeys(value: object, expected: readonly string[], code: string): void {
  const actualKeys = Object.keys(value).sort(compareCanonicalText);
  const expectedKeys = [...expected].sort(compareCanonicalText);
  if (actualKeys.join("\u0000") !== expectedKeys.join("\u0000")) {
    throw new CurrentSdkOperationError(code, "public operation manifest keys are not exact");
  }
}

function manifestsEqual(left: CurrentInstructionManifest, right: CurrentInstructionManifest): boolean {
  return left.programId === right.programId
    && left.dataBase64 === right.dataBase64
    && canonicalDecodedParams(left.decodedParams) === canonicalDecodedParams(right.decodedParams)
    && left.accounts.length === right.accounts.length
    && left.accounts.every((account, index) => {
      const expected = right.accounts[index];
      return expected !== undefined
        && account.pubkey === expected.pubkey
        && account.isSigner === expected.isSigner
        && account.isWritable === expected.isWritable;
    });
}

function validateApprovedInstructions(
  plan: CurrentOperationPlan & { readonly transaction: CurrentApprovedInstructionTransaction },
  expectedFeePayer?: PublicKey,
): void {
  const transaction = plan.transaction;
  if (transaction === null || typeof transaction !== "object") {
    throw new CurrentSdkOperationError("CURRENT_APPROVED_INSTRUCTIONS_INVALID", "approved instruction transaction is absent");
  }
  exactKeys(transaction, [
    "serializedTransactionBase64", "recentBlockhash", "backendPartialSignatures", "approvedInstructions",
  ], "CURRENT_APPROVED_INSTRUCTIONS_INVALID");
  const serialized = Buffer.from(transaction.serializedTransactionBase64, "base64");
  if (
    serialized.toString("base64") !== transaction.serializedTransactionBase64
    || transaction.backendPartialSignatures.length !== 0
    || plan.instructions[0]?.accounts[0] === undefined
    || serializeUnsignedTransaction(
      plan.instructions.map(instructionFromManifest),
      expectedFeePayer ?? new PublicKey(plan.instructions[0].accounts[0].pubkey),
      transaction.recentBlockhash,
    ) !== transaction.serializedTransactionBase64
  ) {
    throw new CurrentSdkOperationError("CURRENT_APPROVED_INSTRUCTIONS_INVALID", "compiled unsigned transaction is not the exact approved instruction sequence");
  }
  if (transaction.approvedInstructions.length !== plan.instructions.length) {
    throw new CurrentSdkOperationError("CURRENT_APPROVED_INSTRUCTIONS_INVALID", "approved instructions do not match the internal plan");
  }
  transaction.approvedInstructions.forEach((approved, index) => {
    exactKeys(approved, ["programId", "accounts", "dataBase64"], "CURRENT_APPROVED_INSTRUCTIONS_INVALID");
    const internal = plan.instructions[index];
    if (
      internal === undefined
      || approved.programId !== internal.programId
      || approved.dataBase64 !== internal.dataBase64
      || approved.accounts.length !== internal.accounts.length
    ) {
      throw new CurrentSdkOperationError("CURRENT_APPROVED_INSTRUCTIONS_INVALID", "approved instruction bytes or program differ");
    }
    approved.accounts.forEach((account, accountIndex) => {
      exactKeys(account, ["address", "isSigner", "isWritable"], "CURRENT_APPROVED_INSTRUCTIONS_INVALID");
      const expected = internal.accounts[accountIndex];
      if (
        expected === undefined
        || account.address !== expected.pubkey
        || account.isSigner !== expected.isSigner
        || account.isWritable !== expected.isWritable
      ) {
        throw new CurrentSdkOperationError("CURRENT_APPROVED_INSTRUCTIONS_INVALID", "approved account meta differs from the exact plan");
      }
    });
  });
}

function validatePortableCurrentMarket(market: CurrentMarketAccount, programId: PublicKey): void {
  exactKeys(market, [
    "stateNamespace", "bump", "createdBy", "marketId", "seriesIdentity", "collateralMint",
    "longContractMint", "underlyingId", "expiryTs", "strikePrice", "capPrice", "contractSize",
    "maxPayoutPerContract", "optionKind", "settlementStyle", "tickSize", "priceDisplayDecimals",
    "quoteDisplayDecimals", "lotSize", "minOrderQty", "makerFeeBps", "takerFeeBps", "cancelFeeBps",
    "minCancelSlots", "maxFillsPerInstruction", "totalPositionCollateralLocked", "paused", "mintAccounting",
  ], "CURRENT_MARKET_IDENTITY_INVALID");
  exactKeys(market.seriesIdentity, [
    "fullSeriesId", "product", "maturity", "side", "ordinal",
  ], "CURRENT_MARKET_IDENTITY_INVALID");
  exactKeys(market.mintAccounting, [
    "discriminator", "version", "decimals", "totalIssued", "totalConsumed", "totalBurned",
  ], "CURRENT_MARKET_IDENTITY_INVALID");
  const marketId = Buffer.from(market.marketId);
  const firstZero = marketId.indexOf(0);
  const end = firstZero < 0 ? marketId.length : firstZero;
  const fullSeriesId = marketId.subarray(0, end).toString("ascii");
  const match = /^(RAMX|NANDX)-([0-9]{4})(0[1-9]|1[0-2])-(CALL|PUT)-(0[1-9]|[1-9][0-9])$/.exec(fullSeriesId);
  if (
    marketId.length !== 32
    || end === 0
    || marketId.subarray(end).some((byte) => byte !== 0)
    || !Buffer.from(fullSeriesId, "ascii").equals(marketId.subarray(0, end))
    || match === null
  ) {
    throw new CurrentSdkOperationError("CURRENT_MARKET_IDENTITY_INVALID", "portable Market id is not the exact padded current series label");
  }
  const [, productLabel, yearText, monthText, side, ordinalText] = match;
  const product = productLabel === "RAMX" ? "ramx" : "nandx";
  const underlyingLabel = product === "ramx" ? "ram-standardized-baskets" : "nand-standardized-baskets";
  const expectedUnderlying = Buffer.alloc(32);
  Buffer.from(underlyingLabel, "ascii").copy(expectedUnderlying);
  const expectedOptionKind = side === "CALL" ? "CallSpread" : "PutSpread";
  const expectedCapPrice = side === "CALL" ? 112_000_000n : 88_000_000n;
  const expectedExpiryTs = BigInt(Date.UTC(Number(yearText), Number(monthText), 1) / 1_000);
  const [, expectedBump] = PublicKey.findProgramAddressSync(
    [CURRENT_STATE_NAMESPACE_SEED, Buffer.from("market", "ascii"), marketId],
    programId,
  );
  if (
    market.stateNamespace !== CURRENT_STATE_NAMESPACE
    || market.bump !== expectedBump
    || market.createdBy.equals(PublicKey.default)
    || !Buffer.from(market.underlyingId).equals(expectedUnderlying)
    || market.seriesIdentity.fullSeriesId !== fullSeriesId
    || market.seriesIdentity.product !== product
    || market.seriesIdentity.maturity !== `${yearText}-${monthText}`
    || market.seriesIdentity.side !== side
    || market.seriesIdentity.ordinal !== 1
    || ordinalText !== "01"
    || market.expiryTs !== expectedExpiryTs
    || market.optionKind !== expectedOptionKind
    || market.strikePrice !== 100_000_000n
    || market.capPrice !== expectedCapPrice
    || market.contractSize !== 1_000_000n
    || market.maxPayoutPerContract !== 12_000_000n
    || market.settlementStyle !== "CashSettledMonthly"
    || market.tickSize !== 50_000n
    || market.priceDisplayDecimals !== 2
    || market.quoteDisplayDecimals !== 6
    || market.lotSize !== 1n
    || market.minOrderQty !== 1n
    || !Number.isInteger(market.makerFeeBps)
    || market.makerFeeBps < 0
    || market.makerFeeBps > 10_000
    || market.takerFeeBps !== 20
    || !Number.isInteger(market.cancelFeeBps)
    || market.cancelFeeBps < 0
    || market.cancelFeeBps > 10_000
    || market.minCancelSlots < 0n
    || market.maxFillsPerInstruction !== 8
    || market.totalPositionCollateralLocked < 0n
    || market.paused
    || market.mintAccounting.discriminator !== "MNT"
    || market.mintAccounting.version !== 1
    || market.mintAccounting.decimals !== 6
    || market.mintAccounting.totalBurned > market.mintAccounting.totalConsumed
    || market.mintAccounting.totalConsumed > market.mintAccounting.totalIssued
  ) {
    throw new CurrentSdkOperationError("CURRENT_MARKET_IDENTITY_INVALID", "portable Market identity or current economics changed");
  }
}

const CURRENT_ORACLE_ACTION_TAG: Readonly<
  Record<CurrentOracleActionRequest["actionType"], CurrentOracleLogicalInstructionTag>
> = Object.freeze({
  queue_stake_amba_for_samba: 138,
  activate_queued_stake_amba_for_samba: 139,
  request_unstake_samba: 131,
  complete_unstake_samba: 133,
  deposit_oracle_usdc_rewards: 155,
  challenge_oracle_source_v2: 161,
  submit_oracle_opening_claim_v2: 162,
  challenge_oracle_opening_claim_v2: 163,
  finalize_oracle_opening_claim_v2: 165,
  commit_oracle_update_claim_v3: 166,
  challenge_oracle_update_claim_v2: 168,
  claim_oracle_usdc_reward: 174,
  commit_oracle_emergency_vote_v3: 176,
  reveal_oracle_emergency_vote_v2: 177,
  initialize_oracle_month_v5: 181,
  propose_oracle_source_v3: 182,
  support_oracle_source_v3: 183,
  reveal_oracle_update_claim_v3: 198,
  finalize_oracle_update_claim_v2: 199,
});

const CURRENT_ORACLE_DIRECT_TAGS = new Set<CurrentOracleLogicalInstructionTag>([
  131, 133, 138, 139, 155, 176, 177, 181,
]);

function oracleInstructionSha256(value: CurrentInstructionManifest): string {
  const hash = createHash("sha256");
  hash.update(new PublicKey(value.programId).toBuffer());
  hash.update(Buffer.from(value.dataBase64, "base64"));
  for (const account of value.accounts) {
    hash.update(new PublicKey(account.pubkey).toBuffer());
    hash.update(Buffer.from([Number(account.isSigner), Number(account.isWritable)]));
  }
  return hash.digest("hex");
}

function oracleTransportWitnessDigest(value: CurrentPhotonCompressedInstructionWitness): string {
  const {
    witnessDigest: _witnessDigest,
    ...facts
  } = value;
  const hash = createHash("sha256");
  hash.update("ameba-spread-v2/current-compressed-instruction-witness-v1\0", "utf8");
  hash.update(JSON.stringify(facts), "utf8");
  return hash.digest("hex");
}

function governedPlanBinding(
  governance: GovernanceGateContextV1,
  release: BoundGovernedWriteReleaseV1,
): CurrentGovernedPlanBindingV1 {
  return Object.freeze({
    schema: "ameba.sdk.governed-plan-binding.v1" as const,
    identityGeneration: governance.identityGeneration,
    genesisHash: governance.genesisHash,
    controllerProgram: governance.controllerProgram.toBase58(),
    controllerConfig: governance.controllerConfig.toBase58(),
    gateAddress: governance.gateAddress.toBase58(),
    targetProgram: governance.targetProgram.toBase58(),
    targetProgramData: governance.targetProgramData.toBase58(),
    epoch: governance.epoch.toString(),
    finalizedObservationSlot: governance.finalizedObservationSlot,
    spreadReleaseCommit: release.spreadReleaseCommit,
    spreadPackageArtifactSha256: release.spreadPackageArtifactSha256,
    instructionManifestSha256: release.instructionManifestSha256,
    programDataPayloadSha256: release.programDataPayloadSha256,
  });
}

function validateGovernedPlanBindingV1(
  value: CurrentGovernedPlanBindingV1,
): { readonly context: GovernanceGateContextV1; readonly release: BoundGovernedWriteReleaseV1 } {
  exactKeys(value, [
    "schema", "identityGeneration", "genesisHash", "controllerProgram",
    "controllerConfig", "gateAddress", "targetProgram", "targetProgramData",
    "epoch", "finalizedObservationSlot", "spreadReleaseCommit",
    "spreadPackageArtifactSha256", "instructionManifestSha256",
    "programDataPayloadSha256",
  ], "CURRENT_GOVERNED_PLAN_INVALID");
  const release = currentGovernedWriteReleaseV1();
  const identity = release.identity;
  if (
    value.schema !== "ameba.sdk.governed-plan-binding.v1"
    || value.identityGeneration !== release.governanceIdentityGeneration
    || value.genesisHash !== CURRENT_LIVE_DEPLOYMENT.genesisHash
    || value.controllerProgram !== identity.controllerProgramId
    || value.controllerConfig !== identity.controllerConfigPda
    || value.gateAddress !== identity.protocolGatePda
    || value.targetProgram !== identity.targetProgramId
    || value.targetProgramData !== identity.targetProgramData
    || value.spreadReleaseCommit !== release.spreadReleaseCommit
    || value.spreadPackageArtifactSha256 !== release.spreadPackageArtifactSha256
    || value.instructionManifestSha256 !== release.instructionManifestSha256
    || value.programDataPayloadSha256 !== release.programDataPayloadSha256
    || !/^(0|[1-9][0-9]*)$/u.test(value.epoch)
    || BigInt(value.epoch) > 0xffff_ffff_ffff_ffffn
    || !Number.isSafeInteger(value.finalizedObservationSlot)
    || value.finalizedObservationSlot < 0
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_GOVERNED_PLAN_INVALID",
      "Oracle plan governance identity, epoch, or release pins are not exact",
    );
  }
  return Object.freeze({
    release,
    context: Object.freeze({
      identityGeneration: release.governanceIdentityGeneration,
      genesisHash: CURRENT_LIVE_DEPLOYMENT.genesisHash,
      controllerProgram: new PublicKey(value.controllerProgram),
      controllerConfig: new PublicKey(value.controllerConfig),
      gateAddress: new PublicKey(value.gateAddress),
      targetProgram: new PublicKey(value.targetProgram),
      targetProgramData: new PublicKey(value.targetProgramData),
      status: GOVERNANCE_GATE_STATUS_V1.Active,
      statusName: "Active" as const,
      epoch: BigInt(value.epoch),
      finalizedObservationSlot: value.finalizedObservationSlot,
    }),
  });
}

function validateGovernedTransportSemanticBindingV1(
  governed: CurrentInstructionManifest,
  semantic: CurrentInstructionManifest,
  binding: CurrentGovernedPlanBindingV1,
): void {
  const { context, release } = validateGovernedPlanBindingV1(binding);
  const instruction = instructionFromManifest(governed);
  const inspected = inspectGovernedInstructionEnvelopeV1({
    instruction,
    context,
    recognizedInstructionTags: release.assignedInstructionTags,
  });
  const semanticInstruction = instructionFromManifest(semantic);
  if (
    !semanticInstruction.programId.equals(instruction.programId)
    || !Buffer.from(semanticInstruction.data).equals(Buffer.from(inspected.legacyData))
    || semanticInstruction.keys.length + 1 !== instruction.keys.length
    || semanticInstruction.keys.some((meta, index) => {
      const expected = instruction.keys[index];
      return expected === undefined
        || !meta.pubkey.equals(expected.pubkey)
        || meta.isSigner !== expected.isSigner
        || meta.isWritable !== expected.isWritable;
    })
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_GOVERNED_PLAN_INVALID",
      "Oracle transport semantic view does not match the exact governed envelope",
    );
  }
}

function validateCurrentOracleDraftPlan(plan: CurrentOracleDraftPlan): void {
  const expectedLogicalTag = CURRENT_ORACLE_ACTION_TAG[plan.actionType];
  const isDirect = CURRENT_ORACLE_DIRECT_TAGS.has(expectedLogicalTag);
  const expectedTransportTag: CurrentOracleTransportInstructionTag = isDirect ? expectedLogicalTag as CurrentOracleTransportInstructionTag : 205;
  const governed = plan.governance !== undefined || plan.transportSemanticInstruction !== undefined;
  if (
    (plan.governance === undefined) !== (plan.transportSemanticInstruction === undefined)
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_GOVERNED_PLAN_INVALID",
      "Oracle plan must bind both governance and its Spread-validated transport semantic view",
    );
  }
  const transportSemanticInstruction = plan.transportSemanticInstruction ?? plan.outerInstruction;
  if (plan.governance !== undefined) {
    validateGovernedTransportSemanticBindingV1(
      plan.outerInstruction,
      transportSemanticInstruction,
      plan.governance,
    );
  }
  const owner = new PublicKey(plan.oracle.ownerPubkey);
  exactKeys(plan.oracle, [
    "marketId", "expiryId", "ownerPubkey", "market", "oracleMonth", "vaultConfig",
  ], "CURRENT_ORACLE_DRAFT_INVALID");
  if (
    plan.request.actionType !== plan.actionType
    || plan.request.marketId !== plan.oracle.marketId
    || plan.request.expiryId !== plan.oracle.expiryId
    || plan.request.ownerPubkey !== plan.oracle.ownerPubkey
    || Object.prototype.hasOwnProperty.call(plan.request, "secretSaltHex")
    || plan.currentInstructionTags.length !== 1
    || plan.currentInstructionTags[0] !== expectedLogicalTag
    || plan.transportInstructionTags.length !== 1
    || plan.transportInstructionTags[0] !== expectedTransportTag
    || plan.logicalInstruction.decodedParams.tag !== expectedLogicalTag
    || plan.logicalInstruction.decodedParams.oracleActionType !== plan.actionType
    || plan.outerInstruction.decodedParams.tag !== expectedTransportTag
    || plan.outerInstruction.decodedParams.oracleActionType !== plan.actionType
    || transportSemanticInstruction.decodedParams.tag !== expectedTransportTag
    || transportSemanticInstruction.decodedParams.oracleActionType !== plan.actionType
    || plan.instructions.length !== (expectedLogicalTag === 139 ? 3 : 1)
    || !manifestsEqual(plan.outerInstruction, plan.instructions[plan.instructions.length - 1]!)
    || plan.setupInstructionBatches.length !== 0
    || plan.setupTransactions.length !== 0
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "oracle logical/transport identity or empty setup contract changed");
  }
  const programId = new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID);
  if (expectedLogicalTag === 139 && !canonicalValuesEqual(plan.instructions.slice(0, 2), currentOracleActivationSetupManifests(programId, owner))) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "activation prefix is not exact canonical sAMBA ATA creation");
  }
  const market = deriveMarketPda(asSeriesId(plan.oracle.expiryId, plan.oracle.marketId), programId);
  if (
    plan.oracle.market !== market.toBase58()
    || plan.oracle.vaultConfig !== deriveVaultConfigPda(programId).toBase58()
    || plan.logicalInstruction.programId !== DEFAULT_AMEBA_SPREAD_PROGRAM_ID
    || plan.outerInstruction.programId !== DEFAULT_AMEBA_SPREAD_PROGRAM_ID
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "oracle plan contains a foreign or noncanonical identity");
  }

  const logicalSha256 = oracleInstructionSha256(plan.logicalInstruction);
  const outerSha256 = oracleInstructionSha256(plan.outerInstruction);
  let witnessDigest: string | null = null;
  if (isDirect) {
    if (
      plan.compressedTransport !== null
      || plan.transactionLookupTable !== null
      || !manifestsEqual(plan.logicalInstruction, transportSemanticInstruction)
      || (!governed && !manifestsEqual(plan.logicalInstruction, plan.outerInstruction))
      || plan.transportInstructionName !== plan.logicalInstruction.decodedParams.instructionName
    ) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "direct Oracle action does not expose one exact logical/transport instruction");
    }
  } else {
    const witness = plan.compressedTransport;
    if (
      witness === null
      || plan.transactionLookupTable === null
      || plan.transportInstructionName !== "ExecuteCompressedStateV1"
    ) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "compressed Oracle action is missing its exact transport witness");
    }
    const decoded = decodeCurrentExecuteCompressedStateV1(
      Buffer.from(transportSemanticInstruction.dataBase64, "base64"),
    );
    if (
      decoded.logicalTag !== expectedLogicalTag
      || decoded.innerInstructionDataBase64 !== plan.logicalInstruction.dataBase64
      || decoded.coreAccountCount !== plan.logicalInstruction.accounts.length
      || decoded.accesses.length !== witness.accesses.length
      || witness.logicalInstructionSha256 !== logicalSha256
      || witness.outerInstructionSha256 !== outerSha256
      || witness.marketSeriesId !== plan.oracle.expiryId
      || witness.coreAccountCount !== decoded.coreAccountCount
      || witness.rentPayerIndex !== decoded.rentPayerIndex
      || witness.coreAccounts.length !== decoded.coreAccountCount
    ) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "tag-205 bytes do not bind the projected logical instruction or witness");
    }
    for (let index = 0; index < decoded.accesses.length; index += 1) {
      const encoded = decoded.accesses[index]!;
      const fact = witness.accesses[index]!;
      if (
        encoded.kind !== fact.kind
        || encoded.domain !== fact.domain
        || encoded.accountIndex !== fact.accountIndex
        || fact.proofIndex < 0
        || fact.proofIndex >= witness.roots.length
      ) {
        throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "tag-205 access kind/domain/index/proof order changed");
      }
      if (encoded.kind === "initialize") {
        if (
          fact.kind !== "initialize"
          || encoded.addressTreeAccountIndex !== fact.addressTreeAccountIndex
          || encoded.addressQueueAccountIndex !== fact.addressQueueAccountIndex
          || encoded.addressRootIndex !== fact.addressRootIndex
          || encoded.outputStateTreeIndex !== fact.outputStateTreeIndex
        ) throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "tag-205 initialize access changed");
      } else if (
        fact.kind === "initialize"
        || encoded.revision.toString() !== fact.revision
        || encoded.compactDataBase64 !== fact.compactDataBase64
        || !canonicalValuesEqual(encoded.treeInfo, fact.treeInfo)
        || (encoded.kind === "mutable" && (fact.kind !== "mutable" || encoded.outputStateTreeIndex !== fact.outputStateTreeIndex))
      ) {
        throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "tag-205 existing access tree/revision/body changed");
      }
    }
    witnessDigest = oracleTransportWitnessDigest(witness);
    if (witnessDigest !== witness.witnessDigest) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "compressed transport witness digest changed");
    }
  }

  const expectedProofFacts = {
    actionType: plan.actionType,
    marketId: plan.oracle.marketId,
    expiryId: plan.oracle.expiryId,
    ownerPubkey: plan.oracle.ownerPubkey,
    marketAddress: plan.oracle.market,
    oracleMonth: expectedLogicalTag === 155 ? null : plan.oracle.oracleMonth,
    logicalTag: expectedLogicalTag,
    transportTag: expectedTransportTag,
    logicalInstructionSha256: logicalSha256,
    outerInstructionSha256: outerSha256,
    witnessDigest,
    providerOriginSha256: plan.compressedTransport?.providerOriginSha256 ?? null,
    proofContextSlot: plan.compressedTransport?.proofContextSlot ?? null,
    stateFinalizedSlot: plan.compressedTransport?.stateFinalizedSlot ?? null,
    lookupTableAddress: plan.transactionLookupTable?.address ?? null,
    lookupTableAddressesSha256: plan.transactionLookupTable?.addressesSha256 ?? null,
    lookupTableAccountDataSha256: plan.transactionLookupTable?.accountDataSha256 ?? null,
    lookupTableObservedFinalizedSlot: plan.transactionLookupTable?.observedFinalizedSlot ?? null,
    lookupTableWritableIndexes: plan.transactionLookupTable?.writableIndexes.join(",") ?? null,
    lookupTableReadonlyIndexes: plan.transactionLookupTable?.readonlyIndexes.join(",") ?? null,
    serializedByteLength: plan.transportMetrics.serializedByteLength,
    noLookupTableSerializedByteLength: plan.transportMetrics.noLookupTableSerializedByteLength,
    theoreticalAltMinimizedByteLength: plan.transportMetrics.theoreticalAltMinimizedByteLength,
    plannerFactsSha256: plan.proofFacts.plannerFactsSha256,
    ...([131, 133, 138, 139].includes(expectedLogicalTag) ? currentOracleStakingProofFacts(plan.proofFacts) : {}),
    ...([176, 177].includes(expectedLogicalTag) ? { disputeEvidenceJson: plan.proofFacts.disputeEvidenceJson } : {}),
    recentBlockhash: plan.transaction.recentBlockhash,
  };
  if (!canonicalValuesEqual(plan.proofFacts, expectedProofFacts)) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "Oracle proof facts do not bind both instruction layers and finalized proof context");
  }
  validateOracleApprovedTransaction(plan, owner);
  const { preparedPlanDigest, ...planWithoutDigest } = plan;
  if (preparedPlanDigest !== currentPreparedPlanDigest("oracle_draft", planWithoutDigest)) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "prepared Oracle plan digest changed");
  }
}

export interface ReadCurrentOracleStateInput extends CurrentAdapterContextInput {
  readonly marketId?: string;
  readonly expiryId?: string;
}

export interface CurrentOracleMarketFact {
  readonly marketAddress: PublicKey;
  readonly market: CurrentMarketAccount;
  readonly oracleMonthAddress: PublicKey;
  readonly oracleMonth: CurrentOracleMonthAccount | null;
}

export interface CurrentOracleState extends CurrentDeploymentIdentity {
  readonly markets: readonly CurrentOracleMarketFact[];
  readonly latest: CurrentOracleMarketFact | null;
  readonly history: readonly CurrentOracleMarketFact[];
}

export interface BuildCurrentOracleDraftInput extends CurrentAdapterContextInput {
  /** The caller supplies semantic current intent only; all accounts and PDAs are SDK-derived. */
  readonly request: CurrentOracleActionRequest;
}

export type CurrentOracleLogicalInstructionTag =
  | 131 | 133 | 138 | 139 | 155 | 161 | 162 | 163 | 165 | 166 | 168 | 174
  | 176 | 177 | 181 | 182 | 183 | 198 | 199;

export type CurrentOracleTransportInstructionTag = 131 | 133 | 138 | 139 | 155 | 176 | 177 | 181 | 205;

export interface CurrentOraclePlanIdentity {
  readonly marketId: string;
  readonly expiryId: string;
  readonly ownerPubkey: string;
  readonly market: string;
  readonly oracleMonth: string;
  readonly vaultConfig: string;
}

export interface CurrentOracleTransportMetrics {
  readonly outerInstructionDataBytes: number;
  readonly outerAccountMetaCount: number;
  readonly outerUniqueAccountKeys: number;
  readonly noLookupTableSerializedByteLength: number;
  readonly serializedByteLength: number;
  readonly theoreticalAltMinimizedByteLength: number;
  readonly packetDataSizeLimit: typeof PACKET_DATA_SIZE;
}

export interface CurrentOracleLookupTableWitness {
  readonly address: string;
  readonly owner: string;
  readonly authority: string | null;
  readonly deactivationSlot: string;
  readonly lastExtendedSlot: string;
  readonly lastExtendedSlotStartIndex: number;
  readonly observedFinalizedSlot: string;
  readonly addresses: readonly string[];
  readonly addressesSha256: string;
  readonly accountDataSha256: string;
  readonly writableIndexes: readonly number[];
  readonly readonlyIndexes: readonly number[];
  readonly serializedByteLength: number;
}

export interface CurrentOracleDraftPlan extends CurrentOperationPlan {
  readonly proofFacts: CurrentOperationPlan["proofFacts"] & Partial<CurrentOracleStakingProofFacts>;
  readonly operation: "oracle_draft";
  readonly actionType: CurrentOracleActionRequest["actionType"];
  readonly request: CurrentOracleRedactedRequest;
  readonly oracle: CurrentOraclePlanIdentity;
  readonly currentInstructionTags: readonly [CurrentOracleLogicalInstructionTag];
  readonly transportInstructionTags: readonly [CurrentOracleTransportInstructionTag];
  readonly transportInstructionName: string;
  readonly logicalInstruction: CurrentInstructionManifest;
  readonly outerInstruction: CurrentInstructionManifest;
  /** Present only for an exact certified governance-gate-v1 write release. */
  readonly governance?: CurrentGovernedPlanBindingV1;
  /** Canonically stripped by Spread at construction; the submitted outer remains unchanged. */
  readonly transportSemanticInstruction?: CurrentInstructionManifest;
  readonly compressedTransport: CurrentPhotonCompressedInstructionWitness | null;
  readonly transactionLookupTable: CurrentOracleLookupTableWitness | null;
  readonly transportMetrics: CurrentOracleTransportMetrics;
  readonly setupTransactions: readonly CurrentSetupTransaction[];
  readonly transaction: CurrentApprovedInstructionTransaction;
  readonly preparedPlanDigest: string;
}

export interface CurrentGovernedPlanBindingV1 {
  readonly schema: "ameba.sdk.governed-plan-binding.v1";
  readonly identityGeneration: 1 | 2 | 3;
  readonly genesisHash: string;
  readonly controllerProgram: string;
  readonly controllerConfig: string;
  readonly gateAddress: string;
  readonly targetProgram: string;
  readonly targetProgramData: string;
  readonly epoch: string;
  readonly finalizedObservationSlot: number;
  readonly spreadReleaseCommit: string;
  readonly spreadPackageArtifactSha256: string;
  readonly instructionManifestSha256: string;
  readonly programDataPayloadSha256: string;
}

export async function readCurrentOracleState(
  input: ReadCurrentOracleStateInput,
): Promise<CurrentOracleState> {
  assertContext(input);
  const marketFacts: { address: PublicKey; market: CurrentMarketAccount }[] = [];
  if (input.expiryId !== undefined) {
    if (input.marketId === undefined) {
      throw new CurrentSdkOperationError("CURRENT_MARKET_ID_REQUIRED", "marketId is required when selecting an exact expiryId");
    }
    const read = await readCurrentMarketAccount({ ...input, marketId: input.marketId, expiryId: input.expiryId });
    if (read.market !== null) marketFacts.push({ address: read.address, market: read.market });
  } else {
    const discovered = await discoverCurrentMarkets(input.connection, {
      commitment: finalizedCommitment(input.commitment),
      limit: 256,
    });
    for (let index = 0; index < discovered.markets.length; index += 1) {
      const market = discovered.markets[index];
      const address = discovered.addresses[index];
      if (market !== undefined && address !== undefined && (input.marketId === undefined || market.seriesIdentity.product === input.marketId)) {
        marketFacts.push({ address, market });
      }
    }
  }
  const markets = await Promise.all(marketFacts.map(async ({ address, market }): Promise<CurrentOracleMarketFact> => {
    const oracleMonthAddress = deriveOracleMonthPda({
      marketPda: address,
      expiryTs: market.expiryTs,
      programId: input.programId,
    });
    const info = await input.connection.getAccountInfo(oracleMonthAddress, finalizedCommitment(input.commitment));
    if (info === null) return { marketAddress: address, market, oracleMonthAddress, oracleMonth: null };
    requireProgramAccount("OracleMonth", info, input.programId, CURRENT_ORACLE_MONTH_ACCOUNT_SIZE);
    return {
      marketAddress: address,
      market,
      oracleMonthAddress,
      oracleMonth: decodeCurrentOracleMonthAccount({
        address: oracleMonthAddress,
        data: info.data,
        owner: info.owner,
        executable: info.executable,
        namespace: input.namespace,
        programId: input.programId,
        expiryTs: market.expiryTs,
      }),
    };
  }));
  const ordered = [...markets].sort((left, right) => Buffer.compare(left.marketAddress.toBuffer(), right.marketAddress.toBuffer()));
  const history = ordered.filter((fact) => fact.oracleMonth !== null).sort((left, right) => {
    const leftSlot = left.oracleMonth!.lastUpdatedSlot;
    const rightSlot = right.oracleMonth!.lastUpdatedSlot;
    return leftSlot === rightSlot ? Buffer.compare(left.marketAddress.toBuffer(), right.marketAddress.toBuffer()) : leftSlot < rightSlot ? 1 : -1;
  });
  return {
    ...identity(),
    markets: ordered,
    latest: history[0] ?? null,
    history,
  };
}

export async function buildCurrentOracleDraft(
  input: BuildCurrentOracleDraftInput,
): Promise<CurrentOracleDraftPlan> {
  assertContext(input);
  if (!isBoundCurrentGovernedProgramV1(input.programId)) {
    const minimumContextSlot = await input.connection.getSlot(CURRENT_STATE_COMMITMENT);
    const governed = await prepareBoundCurrentGovernedWriteV1({
      rpc: input.connection, minimumContextSlot, release: currentGovernedWriteReleaseV1(),
    });
    input = { ...input, programId: governed.governedProgramId };
  }
  const refreshed = await requiredMarket({
    ...input,
    marketId: input.request.marketId,
    expiryId: input.request.expiryId,
  });
  const marketAddress = refreshed.address;
  const expectedOracleMonth = deriveOracleMonthPda({ marketPda: marketAddress, expiryTs: refreshed.market.expiryTs, programId: input.programId });
  const oracleMonthInfo = await input.connection.getAccountInfo(expectedOracleMonth, finalizedCommitment(input.commitment));
  const oracleMonth = decodeOptionalCurrentOracleMonthTarget({
    info: oracleMonthInfo,
    address: expectedOracleMonth,
    expiryTs: refreshed.market.expiryTs,
    namespace: input.namespace,
    programId: input.programId,
  });
  const vaultConfigAddress = deriveVaultConfigPda(input.programId);
  const vaultInfo = await input.connection.getAccountInfo(vaultConfigAddress, finalizedCommitment(input.commitment));
  if (vaultInfo === null) throw new CurrentSdkOperationError("CURRENT_VAULT_CONFIG_NOT_FOUND", "oracle draft requires current VaultConfig");
  const vault = decodeVaultConfigInfo(vaultConfigAddress, vaultInfo, input.programId);
  const observations: import("./current-photon.js").CurrentPhotonCompressedStateObservation[] = [];
  let prepared: Awaited<ReturnType<typeof prepareCurrentOracleAction>>;
  try {
    prepared = await prepareCurrentOracleAction({
      connection: input.connection,
      programId: input.programId,
      commitment: finalizedCommitment(input.commitment),
      marketAddress,
      market: refreshed.market,
      oracleMonthAddress: expectedOracleMonth,
      oracleMonth,
      vaultConfigAddress,
      vaultConfig: vault,
      photonConnection: input.photonConnection,
      compressedObservations: observations,
      request: input.request,
    });
  } catch (cause) {
    if (cause instanceof CurrentOraclePlannerError) {
      throw new CurrentSdkOperationError(cause.code, cause.message);
    }
    throw cause;
  }
  const logicalTag = CURRENT_ORACLE_ACTION_TAG[prepared.actionType];
  if (prepared.tag !== logicalTag || prepared.actionType !== input.request.actionType) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "semantic Oracle action resolved to an unexpected current instruction tag");
  }
  const semanticLogicalInstruction = semanticCurrentSpreadInstructionV1(prepared.instruction);
  const logicalInstruction = manifest(semanticLogicalInstruction, {
    instructionName: prepared.instructionName,
    tag: logicalTag,
    oracleActionType: prepared.actionType,
  });
  const direct = CURRENT_ORACLE_DIRECT_TAGS.has(logicalTag);
  let semanticTransportInstruction = semanticLogicalInstruction;
  let outerInstruction = manifest(prepared.instruction, {
    instructionName: prepared.instructionName,
    tag: logicalTag,
    oracleActionType: prepared.actionType,
  });
  let outerTransactionInstruction = prepared.instruction;
  let compressedTransport: CurrentPhotonCompressedInstructionWitness | null = null;
  let transportTag: CurrentOracleTransportInstructionTag = logicalTag as CurrentOracleTransportInstructionTag;
  let transportInstructionName = prepared.instructionName;
  if (!direct) {
    if (input.photonConnection === undefined) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_COMPRESSED_PLAN_UNAVAILABLE", "this current Oracle action requires the authenticated Photon tag-205 transport");
    }
    if (prepared.compressedObservations.length === 0) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_COMPRESSED_PLAN_UNAVAILABLE", "the logical Oracle action did not authenticate its required compact state set");
    }
    const wrapped = await input.photonConnection.prepareCurrentCompressedStateInstruction({
      innerInstruction: prepared.instruction,
      marketSeriesId: refreshed.market.seriesIdentity.fullSeriesId,
      expectedObservations: prepared.compressedObservations,
    });
    const semanticOuterInstruction = isCurrentWriteReleaseAvailable()
      ? registerCurrentSpreadGovernedOutputV1({
        sourceInstruction: prepared.instruction,
        outputInstruction: wrapped.instruction,
      }).semanticInstruction
      : wrapped.instruction;
    semanticTransportInstruction = semanticOuterInstruction;
    const decodedOuter = decodeCurrentExecuteCompressedStateV1(semanticOuterInstruction.data);
    if (
      decodedOuter.logicalTag !== logicalTag
      || decodedOuter.innerInstructionDataBase64 !== logicalInstruction.dataBase64
    ) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "actual tag-205 bytes do not contain the selected logical Oracle action");
    }
    compressedTransport = wrapped.witness;
    outerTransactionInstruction = wrapped.instruction;
    transportTag = 205;
    transportInstructionName = "ExecuteCompressedStateV1";
    outerInstruction = manifest(wrapped.instruction, {
      instructionName: transportInstructionName,
      tag: transportTag,
      oracleActionType: prepared.actionType,
      logicalInstructionName: prepared.instructionName,
      logicalTag,
    });
  } else if (prepared.compressedObservations.length !== 0) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_DRAFT_INVALID", "direct Oracle action unexpectedly collected compact-state observations");
  }
  const owner = new PublicKey(input.request.ownerPubkey);
  const latestBlockhash = await input.connection.getLatestBlockhash(finalizedCommitment(input.commitment));
  const activationSetup = logicalTag === 139 ? currentOracleActivationSetup(input.programId, owner) : [];
  const activationManifests = logicalTag === 139 ? currentOracleActivationSetupManifests(input.programId, owner) : [];
  const actionManifests = Object.freeze([...activationManifests, outerInstruction]);
  const outerInstructions = Object.freeze([...activationSetup, outerTransactionInstruction]);
  const noLookupMessage = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [...outerInstructions],
  }).compileToV0Message();
  const noLookupTableSerializedByteLength = versionedTransactionByteLength(noLookupMessage);
  const theoreticalMessage = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [...outerInstructions],
  }).compileToV0Message([theoreticalOracleLookupTable(outerInstructions, owner)]);
  const theoreticalAltMinimizedByteLength = versionedTransactionByteLength(theoreticalMessage);
  let resolvedLookupTable: CurrentResolvedOracleLookupTable | null = null;
  if (!direct) {
    if (input.oracleCompressedStateLookupTable === undefined) {
      throw new CurrentSdkOperationError(
        "CURRENT_ORACLE_COMPRESSED_PLAN_UNAVAILABLE",
        "compressed Oracle prepare requires one independently authorized finalized address lookup table",
        {
          outerInstructionDataBytes: outerTransactionInstruction.data.length,
          outerAccountMetaCount: outerTransactionInstruction.keys.length,
          outerUniqueAccountKeys: new Set([
            owner.toBase58(),
            outerTransactionInstruction.programId.toBase58(),
            ...outerTransactionInstruction.keys.map((meta) => meta.pubkey.toBase58()),
          ]).size,
          noLookupTableSerializedByteLength,
          theoreticalAltMinimizedByteLength,
          packetDataSizeLimit: PACKET_DATA_SIZE,
        },
      );
    }
    resolvedLookupTable = await resolveCurrentOracleLookupTable({
      connection: input.connection,
      authorization: input.oracleCompressedStateLookupTable,
      commitment: input.commitment,
    });
  }
  let governedWrite:
    | { readonly governance: GovernanceGateContextV1; readonly release: BoundGovernedWriteReleaseV1 }
    | null = null;
  if (isCurrentWriteReleaseAvailable()) {
    // Keep the last asynchronous state read before exact unsigned compilation
    // as a finalized check of the epoch carried by the instruction itself.
    governedWrite = await revalidateFreshCurrentGovernedInstructionsV1({
      rpc: input.connection,
      instructions: [outerTransactionInstruction],
    });
  }
  const compiled = compileUnsignedV0Transaction({
    instructions: outerInstructions,
    feePayer: owner,
    recentBlockhash: latestBlockhash.blockhash,
    lookupTables: resolvedLookupTable === null ? [] : [resolvedLookupTable.account],
  });
  let transactionLookupTable: CurrentOracleLookupTableWitness | null = null;
  if (resolvedLookupTable !== null) {
    const lookup = compiled.message.addressTableLookups[0];
    if (
      compiled.message.addressTableLookups.length !== 1
      || lookup === undefined
      || !lookup.accountKey.equals(resolvedLookupTable.account.key)
      || lookup.writableIndexes.length + lookup.readonlyIndexes.length < 1
      || [...lookup.writableIndexes, ...lookup.readonlyIndexes].some((index) =>
        !Number.isInteger(index) || index < 0 || index >= resolvedLookupTable!.addresses.length)
    ) {
      throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "compiled Oracle message does not use the exact authorized lookup table");
    }
    transactionLookupTable = Object.freeze({
      address: resolvedLookupTable.address,
      owner: resolvedLookupTable.owner,
      authority: resolvedLookupTable.authority,
      deactivationSlot: resolvedLookupTable.deactivationSlot,
      lastExtendedSlot: resolvedLookupTable.lastExtendedSlot,
      lastExtendedSlotStartIndex: resolvedLookupTable.lastExtendedSlotStartIndex,
      observedFinalizedSlot: resolvedLookupTable.observedFinalizedSlot,
      addresses: resolvedLookupTable.addresses,
      addressesSha256: resolvedLookupTable.addressesSha256,
      accountDataSha256: resolvedLookupTable.accountDataSha256,
      writableIndexes: Object.freeze([...lookup.writableIndexes]),
      readonlyIndexes: Object.freeze([...lookup.readonlyIndexes]),
      serializedByteLength: compiled.serializedByteLength,
    });
  }
  const transportMetrics: CurrentOracleTransportMetrics = Object.freeze({
    outerInstructionDataBytes: outerTransactionInstruction.data.length,
    outerAccountMetaCount: outerTransactionInstruction.keys.length,
    outerUniqueAccountKeys: new Set([
      owner.toBase58(),
      outerTransactionInstruction.programId.toBase58(),
      ...outerTransactionInstruction.keys.map((meta) => meta.pubkey.toBase58()),
    ]).size,
    noLookupTableSerializedByteLength,
    serializedByteLength: compiled.serializedByteLength,
    theoreticalAltMinimizedByteLength,
    packetDataSizeLimit: PACKET_DATA_SIZE,
  });
  const oracle = Object.freeze({
    marketId: refreshed.market.seriesIdentity.product,
    expiryId: refreshed.market.seriesIdentity.fullSeriesId,
    ownerPubkey: owner.toBase58(),
    market: marketAddress.toBase58(),
    oracleMonth: expectedOracleMonth.toBase58(),
    vaultConfig: vaultConfigAddress.toBase58(),
  });
  const transaction: CurrentApprovedInstructionTransaction = Object.freeze({
    serializedTransactionBase64: compiled.serializedTransactionBase64,
    recentBlockhash: latestBlockhash.blockhash,
    backendPartialSignatures: Object.freeze([]),
    approvedInstructions: Object.freeze(actionManifests.map(approvedInstruction)),
  });
  const logicalInstructionSha256 = oracleInstructionSha256(logicalInstruction);
  const outerInstructionSha256 = oracleInstructionSha256(outerInstruction);
  const witnessDigest = compressedTransport?.witnessDigest ?? null;
  const plannerFactsSha256 = createHash("sha256").update(JSON.stringify(prepared.proofFacts)).digest("hex");
  const proofFacts = Object.freeze({
    actionType: prepared.actionType,
    marketId: oracle.marketId,
    expiryId: oracle.expiryId,
    ownerPubkey: oracle.ownerPubkey,
    marketAddress: oracle.market,
    oracleMonth: logicalTag === 155 ? null : oracle.oracleMonth,
    logicalTag,
    transportTag,
    logicalInstructionSha256,
    outerInstructionSha256,
    witnessDigest,
    providerOriginSha256: compressedTransport?.providerOriginSha256 ?? null,
    proofContextSlot: compressedTransport?.proofContextSlot ?? null,
    stateFinalizedSlot: compressedTransport?.stateFinalizedSlot ?? null,
    lookupTableAddress: transactionLookupTable?.address ?? null,
    lookupTableAddressesSha256: transactionLookupTable?.addressesSha256 ?? null,
    lookupTableAccountDataSha256: transactionLookupTable?.accountDataSha256 ?? null,
    lookupTableObservedFinalizedSlot: transactionLookupTable?.observedFinalizedSlot ?? null,
    lookupTableWritableIndexes: transactionLookupTable?.writableIndexes.join(",") ?? null,
    lookupTableReadonlyIndexes: transactionLookupTable?.readonlyIndexes.join(",") ?? null,
    serializedByteLength: transportMetrics.serializedByteLength,
    noLookupTableSerializedByteLength: transportMetrics.noLookupTableSerializedByteLength,
    theoreticalAltMinimizedByteLength: transportMetrics.theoreticalAltMinimizedByteLength,
    plannerFactsSha256,
    ...([131, 133, 138, 139].includes(logicalTag) ? currentOracleStakingProofFacts(prepared.proofFacts) : {}),
    ...([176, 177].includes(logicalTag) ? { disputeEvidenceJson: prepared.proofFacts.disputeEvidenceJson as string } : {}),
    recentBlockhash: latestBlockhash.blockhash,
  });
  const base = plan("oracle_draft", actionManifests, [], proofFacts);
  const preparedPlanWithoutDigest: Omit<CurrentOracleDraftPlan, "preparedPlanDigest"> = {
    ...base,
    operation: "oracle_draft",
    actionType: prepared.actionType,
    request: prepared.request,
    oracle,
    currentInstructionTags: Object.freeze([logicalTag] as const),
    transportInstructionTags: Object.freeze([transportTag] as const),
    transportInstructionName,
    logicalInstruction,
    outerInstruction,
    ...(governedWrite === null ? {} : {
      governance: governedPlanBinding(governedWrite.governance, governedWrite.release),
      transportSemanticInstruction: manifest(semanticTransportInstruction, {
        instructionName: transportInstructionName,
        tag: transportTag,
        oracleActionType: prepared.actionType,
        ...(direct ? {} : {
          logicalInstructionName: prepared.instructionName,
          logicalTag,
        }),
      }),
    }),
    compressedTransport,
    transactionLookupTable,
    transportMetrics,
    setupTransactions: Object.freeze([]),
    transaction,
  };
  const issuedPlanWithoutDigest = cloneAndFreezeIssuedValue(preparedPlanWithoutDigest);
  const preparedPlanDigest = currentPreparedPlanDigest("oracle_draft", issuedPlanWithoutDigest);
  return cloneAndFreezeIssuedValue({
    ...issuedPlanWithoutDigest,
    preparedPlanDigest,
  }) as CurrentOracleDraftPlan;
}


export type CurrentPositionActionRequest =
  | { readonly action: "init_collateral"; readonly ownerPubkey: string }
  | { readonly action: "deposit_collateral" | "withdraw_collateral"; readonly ownerPubkey: string; readonly amount: bigint };
export interface PrepareCurrentPositionActionContextInput extends CurrentAdapterContextInput {
  readonly request: CurrentPositionActionRequest;
  readonly minimumContextSlot?: number;
}
export interface CurrentPositionActionContext extends CurrentDeploymentIdentity {
  readonly request: CurrentPositionActionRequest;
  readonly observation: CurrentFinalizedObservation;
}
export interface BuildCurrentPositionActionInput extends PrepareCurrentPositionActionContextInput {
  readonly context?: CurrentPositionActionContext;
}
export interface CurrentPositionActionPlan extends CurrentOperationPlan {
  readonly operation: "position_action";
  readonly actionType: CurrentPositionActionRequest["action"];
  readonly instructionName: string;
  readonly instructionTags: readonly number[];
  readonly request: CurrentPositionActionRequest;
  readonly observation: CurrentFinalizedObservation;
  readonly governance: CurrentGovernedPlanBindingV1;
  readonly semanticInstruction: CurrentInstructionManifest;
  readonly accountState: readonly CurrentPositionAccountState[];
  readonly setupTransactions: readonly [];
  readonly transaction: CurrentApprovedInstructionTransaction;
  readonly preparedPlanDigest: string;
}
interface CurrentPositionAccountState {
  readonly address: string;
  readonly owner: string | null;
  readonly executable: boolean | null;
  readonly dataBase64: string | null;
}
const positionContexts = new WeakMap<CurrentPositionActionContext, {
  readonly connection: Connection;
  readonly instruction: TransactionInstruction;
  readonly governance: CurrentGovernedPlanBindingV1;
  readonly accountState: readonly CurrentPositionAccountState[];
}>();
const POSITION_ACTIONS = Object.freeze({
  init_collateral: { tag: 9, name: "InitUserCollateral" },
  deposit_collateral: { tag: 10, name: "DepositCollateral" },
  withdraw_collateral: { tag: 11, name: "WithdrawCollateral" },
});
function positionRequest(value: CurrentPositionActionRequest): CurrentPositionActionRequest {
  if (!value || !Object.hasOwn(POSITION_ACTIONS, value.action)) positionRejected("unsupported collateral action");
  exactKeys(value, value.action === "init_collateral" ? ["action", "ownerPubkey"] : ["action", "ownerPubkey", "amount"], "CURRENT_POSITION_ACTION_INVALID");
  const owner = new PublicKey(value.ownerPubkey).toBase58();
  if (owner !== value.ownerPubkey || owner === PublicKey.default.toBase58()) positionRejected("owner must be canonical and nonzero");
  if (value.action !== "init_collateral" && (typeof value.amount !== "bigint" || value.amount <= 0n || value.amount > 0xffffffffffffffffn)) {
    positionRejected("amount must be a positive u64");
  }
  return cloneAndFreezeIssuedValue(value);
}
function positionRejected(message: string, code = "CURRENT_POSITION_ACTION_INVALID"): never {
  throw new CurrentSdkOperationError(code, message);
}
/** Observe canonical collateral accounts before the caller obtains its separate Lean admission. */
export async function prepareCurrentPositionActionContext(input: PrepareCurrentPositionActionContextInput): Promise<CurrentPositionActionContext> {
  assertContext(input);
  const request = positionRequest(input.request);
  input = { ...input, request };
  const owner = new PublicKey(request.ownerPubkey);
  const floor = input.minimumContextSlot ?? await input.connection.getSlot(CURRENT_STATE_COMMITMENT);
  if (!Number.isSafeInteger(floor) || floor < 0) positionRejected("finalized observation floor is invalid");
  const userCollateral = deriveUserCollateralPda(owner, input.programId);
  let builderName: string = "buildInitUserCollateralInstruction";
  let builderInput: unknown = { accounts: { user: owner, userCollateral } };
  let preliminaryVault: Buffer | null = null;
  const vaultAddress = deriveVaultConfigPda(input.programId);
  if (request.action !== "init_collateral") {
    const vaultInfo = await input.connection.getAccountInfo(vaultAddress, {commitment: CURRENT_STATE_COMMITMENT, minContextSlot: floor});
    if (!vaultInfo) positionRejected("current VaultConfig is absent");
    const vault = decodeVaultConfigInfo(vaultAddress, vaultInfo, input.programId);
    preliminaryVault = Buffer.from(vaultInfo.data);

    const ata = getAssociatedTokenAddressSync(vault.usdcMint, owner, false, SPL_TOKEN_PROGRAM_ID);
    builderName = request.action === "deposit_collateral" ? "buildDepositCollateralInstruction" : "buildWithdrawCollateralInstruction";
    builderInput = request.action === "deposit_collateral"
      ? { params: { amount: request.amount }, accounts: { user: owner, userTokenAccount: ata,
          vaultTokenAccount: vault.vaultTokenAccount, vaultConfigPda: vaultAddress, userCollateralPda: userCollateral, collateralMint: vault.usdcMint } }
      : { amount: request.amount, accounts: { owner, destinationTokenAccount: ata,
          vaultTokenAccount: vault.vaultTokenAccount, vaultConfig: vaultAddress, userCollateral, collateralMint: vault.usdcMint } };
  }
  const materialized = await materializeBoundCurrentGovernedBuilderV1({ rpc: input.connection,
    minimumContextSlot: floor, release: currentGovernedWriteReleaseV1(), builderName, builderInput });
  if (materialized.instructions.length !== 1) positionRejected("collateral action must have exactly one governed instruction");
  const instruction = materialized.instructions[0]!;
  const addresses = [...new Map(instruction.keys.map(meta => [meta.pubkey.toBase58(), meta.pubkey])).values()];
  const observed = await input.connection.getMultipleAccountsInfoAndContext(addresses,
    { commitment: CURRENT_STATE_COMMITMENT, minContextSlot: Math.max(floor, materialized.governance.finalizedObservationSlot) });
  const slot = observed.context.slot;
  if (!Number.isSafeInteger(slot) || slot < floor || observed.value.length !== addresses.length) positionRejected("invalid finalized account observation");
  const accountState = addresses.map((address, i) => {
    const info = observed.value[i];
    return { address: address.toBase58(), owner: info?.owner.toBase58() ?? null,
      executable: info?.executable ?? null, dataBase64: info ? Buffer.from(info.data).toString("base64") : null };
  });
  if (preliminaryVault !== null && accountState.find(a => a.address === vaultAddress.toBase58())?.dataBase64 !== preliminaryVault.toString("base64")) {
    positionRejected("VaultConfig changed during preparation; reobserve before admission");
  }
  const [blockTime, genesisHash] = await Promise.all([input.connection.getBlockTime(slot), input.connection.getGenesisHash()]);
  if (genesisHash !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH || blockTime === null || !Number.isSafeInteger(blockTime)) positionRejected("finalized time or Devnet identity is unavailable");
  const origin = new URL(input.connection.rpcEndpoint).origin;
  const observationInput = {
    schemaVersion: 1 as const, observationSource: "current_finalized_rpc" as const, commitment: "finalized" as const,
    observedAtSlot: String(slot), currentFinalizedSlot: String(slot), observedBlockTimeUnixSeconds: String(blockTime),
    stateProvider: { kind: "solana_json_rpc" as const, origin,
      originSha256: createHash("sha256").update(origin).digest("hex"), genesisHash: CURRENT_PROTOCOL_DEVNET_GENESIS_HASH },
    orderedAccounts: accountState.map(a => ({ address: a.address, owner: a.owner, executable: a.executable,
      dataLength: a.dataBase64 === null ? null : String(Buffer.from(a.dataBase64, "base64").length),
      dataSha256: a.dataBase64 === null ? null : createHash("sha256").update(Buffer.from(a.dataBase64, "base64")).digest("hex") })),
  };
  const observation = validateCurrentFinalizedObservation({ ...observationInput,
    currentObservationDigest: computeCurrentFinalizedObservationDigest(observationInput) });
  const context = cloneAndFreezeIssuedValue({ ...identity(), request, observation });
  const governance = governedPlanBinding(materialized.governance, materialized.release);
  validatePositionAccountState(request, accountState, observation, manifest(semanticCurrentSpreadInstructionV1(instruction),
    { instructionName: POSITION_ACTIONS[request.action].name, tag: POSITION_ACTIONS[request.action].tag }));
  positionContexts.set(context, { connection: input.connection, instruction, governance, accountState: cloneAndFreezeIssuedValue(accountState) });
  return context;
}
/** Build unsigned bytes from the exact observed context; signing/submission remain outside the SDK. */
export async function buildCurrentPositionAction(input: BuildCurrentPositionActionInput): Promise<CurrentPositionActionPlan> {
  assertContext(input);
  const request = positionRequest(input.request);
  input = { ...input, request };
  const context = input.context ?? await prepareCurrentPositionActionContext(input);
  const issued = positionContexts.get(context);
  if (!issued || issued.connection !== input.connection || !canonicalValuesEqual(request, context.request)) positionRejected("position context was not issued for this connection and exact request");
  if (input.minimumContextSlot !== undefined && BigInt(context.observation.observedAtSlot) < BigInt(input.minimumContextSlot)) positionRejected("position context predates requested floor");
  await revalidateFreshCurrentGovernedInstructionsV1({ rpc: input.connection, instructions: [issued.instruction] });
  const action = POSITION_ACTIONS[request.action];
  const instruction = manifest(issued.instruction, { instructionName: action.name, tag: action.tag });
  const semanticInstruction = manifest(semanticCurrentSpreadInstructionV1(issued.instruction), { instructionName: action.name, tag: action.tag });
  const recent = await input.connection.getLatestBlockhash(CURRENT_STATE_COMMITMENT);
  const transaction = { serializedTransactionBase64: serializeUnsignedTransaction([issued.instruction], new PublicKey(request.ownerPubkey), recent.blockhash),
    recentBlockhash: recent.blockhash, backendPartialSignatures: [], approvedInstructions: [approvedInstruction(instruction)] };
  const base = plan("position_action", [instruction], [], { actionType: request.action, instructionName: action.name,
    instructionTag: action.tag, currentObservationDigest: context.observation.currentObservationDigest,
    observedAtSlot: context.observation.observedAtSlot });
  const withoutDigest = cloneAndFreezeIssuedValue({ ...base, operation: "position_action" as const, actionType: request.action,
    instructionName: action.name, instructionTags: [action.tag], request, observation: context.observation,
    governance: issued.governance, semanticInstruction, accountState: issued.accountState, setupTransactions: [] as const, transaction });
  const result = cloneAndFreezeIssuedValue({ ...withoutDigest, preparedPlanDigest: currentPreparedPlanDigest("position_action", withoutDigest) });
  validateCurrentOperationPlan(result);
  return result;
}
function validatePositionAccountState(request: CurrentPositionActionRequest, accounts: readonly CurrentPositionAccountState[],
  observation: CurrentFinalizedObservation, semantic: CurrentInstructionManifest): void {
  const programId = new PublicKey(DEFAULT_AMEBA_SPREAD_PROGRAM_ID);
  const owner = new PublicKey(request.ownerPubkey);
  const collateralAddress = deriveUserCollateralPda(owner, programId);
  const account = (address: PublicKey): AccountInfo<Buffer> | null => {
    const values = accounts.filter(a => a.address === address.toBase58());
    const facts = observation.orderedAccounts.filter(a => a.address === address.toBase58());
    if (values.length !== 1 || facts.length !== 1) positionRejected("canonical account is absent or repeated in observation");
    const value = values[0]!, fact = facts[0]!;
    if (value.owner !== fact.owner || value.executable !== fact.executable) positionRejected("account identity differs from observation");
    if (value.dataBase64 === null) { if (fact.dataSha256 !== null || value.owner !== null) positionRejected("absent account evidence is inconsistent"); return null; }
    const data = Buffer.from(value.dataBase64, "base64");
    if (data.toString("base64") !== value.dataBase64 || String(data.length) !== fact.dataLength || createHash("sha256").update(data).digest("hex") !== fact.dataSha256) positionRejected("account bytes differ from observation");
    return { data, owner: new PublicKey(value.owner!), executable: value.executable!, lamports: 0 };
  };
  const collateralInfo = account(collateralAddress);
  let expected: TransactionInstruction;
  if (request.action === "init_collateral") {
    if (collateralInfo !== null) positionRejected("collateral account is already initialized");
    expected = buildInitUserCollateralInstruction({ accounts: { user: owner, userCollateral: collateralAddress }, programId });
  } else {
    if (!collateralInfo) positionRejected(`UserCollateral ${collateralAddress.toBase58()} is absent for ${owner.toBase58()}; ${request.action} requires initialized collateral`, "CURRENT_POSITION_COLLATERAL_UNAVAILABLE");
    const collateral = decodeCurrentUserCollateralAccount({ address: collateralAddress, data: collateralInfo.data, owner: collateralInfo.owner,
      executable: collateralInfo.executable, namespace: CURRENT_STATE_NAMESPACE, programId, expectedOwner: owner });
    const vaultAddress = deriveVaultConfigPda(programId);
    const vaultInfo = account(vaultAddress);
    if (!vaultInfo) positionRejected("vault is absent");
    const vault = decodeVaultConfigInfo(vaultAddress, vaultInfo, programId);

    const ata = getAssociatedTokenAddressSync(vault.usdcMint, owner, false, SPL_TOKEN_PROGRAM_ID);
    const userInfo = account(ata), custodyInfo = account(vault.vaultTokenAccount), mintInfo = account(vault.usdcMint);
    if (!userInfo) positionRejected(`classic SPL USDC account ${ata.toBase58()} is absent for owner ${owner.toBase58()} and mint ${vault.usdcMint.toBase58()}`, "CURRENT_POSITION_TOKEN_ACCOUNT_UNAVAILABLE");
    if (!custodyInfo) positionRejected(`classic SPL vault custody ${vault.vaultTokenAccount.toBase58()} is absent`);
    if (!mintInfo) positionRejected(`classic SPL collateral mint ${vault.usdcMint.toBase58()} is absent`);
    if (userInfo.executable || custodyInfo.executable || mintInfo.executable) positionRejected("canonical SPL custody or mint account is executable");
    let mint: ReturnType<typeof unpackMint>;
    let user: ReturnType<typeof unpackAccount>;
    let custody: ReturnType<typeof unpackAccount>;
    try {
      mint = unpackMint(vault.usdcMint, mintInfo, SPL_TOKEN_PROGRAM_ID);
      user = unpackAccount(ata, userInfo, SPL_TOKEN_PROGRAM_ID);
      custody = unpackAccount(vault.vaultTokenAccount, custodyInfo, SPL_TOKEN_PROGRAM_ID);
    } catch {
      positionRejected("classic SPL collateral mint or token account has invalid program ownership/layout", "CURRENT_POSITION_TOKEN_IDENTITY_INVALID");
    }
    if (!mint.isInitialized || !user.isInitialized || user.isFrozen || !custody.isInitialized || custody.isFrozen
      || !user.owner.equals(owner) || !user.mint.equals(vault.usdcMint) || !custody.mint.equals(vault.usdcMint)
      || !custody.owner.equals(vaultAddress)) positionRejected("canonical SPL custody identity/state is invalid", "CURRENT_POSITION_TOKEN_IDENTITY_INVALID");
    if (request.action === "deposit_collateral" && user.amount < request.amount) positionRejected(`classic SPL USDC balance at ${ata.toBase58()} is ${user.amount} atoms; deposit requires ${request.amount}`, "CURRENT_POSITION_TOKEN_BALANCE_INSUFFICIENT");
    if (request.action === "withdraw_collateral" && collateral.availableBalance < request.amount) positionRejected(`UserCollateral available balance is ${collateral.availableBalance} atoms; withdrawal requires ${request.amount}`, "CURRENT_POSITION_COLLATERAL_BALANCE_INSUFFICIENT");
    if (request.action === "withdraw_collateral" && custody.amount < request.amount) positionRejected(`classic SPL vault custody balance is ${custody.amount} atoms; withdrawal requires ${request.amount}`, "CURRENT_POSITION_CUSTODY_BALANCE_INSUFFICIENT");
    // Both native custody lanes use the same exact account order. Only the action tag differs.
    expected = buildWithdrawCollateralInstruction({ accounts: { owner, vaultTokenAccount: vault.vaultTokenAccount,
      destinationTokenAccount: ata, vaultConfig: vaultAddress, userCollateral: collateralAddress, collateralMint: vault.usdcMint }, amount: request.amount, programId });
    if (request.action === "deposit_collateral") {
      expected = new TransactionInstruction({ programId, keys: [expected.keys[0]!, expected.keys[2]!, expected.keys[1]!, ...expected.keys.slice(3)],
        data: Buffer.concat([Buffer.from([10]), expected.data.subarray(1)]) });
    }
  }
  const params = { instructionName: POSITION_ACTIONS[request.action].name, tag: POSITION_ACTIONS[request.action].tag };
  if (!canonicalValuesEqual(semantic, manifest(expected, params))) positionRejected("instruction differs from canonical collateral request and custody");
}
function validateCurrentPositionActionPlan(value: CurrentPositionActionPlan): void {
  if (!canonicalValuesEqual(value.deployment, CURRENT_PROTOCOL_DEPLOYMENT)) positionRejected("position plan deployment differs");
  const request = positionRequest(value.request), action = POSITION_ACTIONS[request.action];
  const observation = validateCurrentFinalizedObservation(value.observation);
  if (value.actionType !== request.action || value.instructionName !== action.name || !canonicalValuesEqual(value.instructionTags, [action.tag])
    || value.instructions.length !== 1 || value.setupInstructionBatches.length !== 0 || value.setupTransactions.length !== 0
    || !canonicalValuesEqual(value.proofFacts, { actionType: request.action, instructionName: action.name, instructionTag: action.tag,
      currentObservationDigest: observation.currentObservationDigest, observedAtSlot: observation.observedAtSlot })) positionRejected("position plan identity or observation differs");
  validateGovernedTransportSemanticBindingV1(value.instructions[0]!, value.semanticInstruction, value.governance);
  validatePositionAccountState(request, value.accountState, observation, value.semanticInstruction);
  validateApprovedInstructions(value, new PublicKey(request.ownerPubkey));
  const { preparedPlanDigest, ...withoutDigest } = value;
  if (preparedPlanDigest !== currentPreparedPlanDigest("position_action", withoutDigest)) positionRejected("position prepared digest differs");
}

export interface ReadCurrentUserLedgerInput extends CurrentAdapterContextInput {
  readonly ownerPubkey: string;
}

export interface CurrentUserLedgerResult extends CurrentDeploymentIdentity<typeof CURRENT_LIVE_DEPLOYMENT> {
  readonly address: PublicKey;
  readonly found: boolean;
  readonly ledger: ReturnType<typeof decodeOraclePlayerLedgerBalance> | null;
}

export async function readCurrentUserLedger(
  input: ReadCurrentUserLedgerInput,
): Promise<CurrentUserLedgerResult> {
  assertContext(input);
  const owner = parseOwner(input.ownerPubkey);
  const address = deriveOraclePlayerLedgerPda(owner, input.programId);
  const info = await input.connection.getAccountInfo(address, finalizedCommitment(input.commitment));
  if (info === null) return { ...identity(), deployment: CURRENT_LIVE_DEPLOYMENT, address, found: false, ledger: null };
  if (!info.owner.equals(input.programId) || info.executable) {
    throw new CurrentSdkOperationError("CURRENT_USER_LEDGER_INVALID", "user ledger owner is not current");
  }
  const ledger = decodeOraclePlayerLedgerBalance(info.data);
  const [, expectedBump] = PublicKey.findProgramAddressSync(
    [CURRENT_STATE_NAMESPACE_SEED, ORACLE_PLAYER_LEDGER_PDA_SEED, owner.toBuffer()],
    input.programId,
  );
  if (!ledger.owner.equals(owner) || ledger.bump !== expectedBump) {
    throw new CurrentSdkOperationError("CURRENT_USER_LEDGER_INVALID", "user ledger owner or canonical bump does not match the requested owner");
  }
  return { ...identity(), deployment: CURRENT_LIVE_DEPLOYMENT, address, found: true, ledger };
}

export interface ReadCurrentUserCollateralInput extends CurrentAdapterContextInput {
  readonly ownerPubkey: string;
  readonly minimumContextSlot?: number;
}

export interface CurrentUserCollateralResult extends CurrentDeploymentIdentity<typeof CURRENT_LIVE_DEPLOYMENT> {
  readonly observedAtSlot: string;
  readonly address: PublicKey;
  readonly found: boolean;
  readonly collateral: CurrentUserCollateralAccount | null;
}

export async function readCurrentUserCollateral(
  input: ReadCurrentUserCollateralInput,
): Promise<CurrentUserCollateralResult> {
  assertContext(input);
  const owner = parseOwner(input.ownerPubkey);
  const address = deriveUserCollateralPda(owner, input.programId);
  const floor = input.minimumContextSlot;
  if (floor !== undefined && (!Number.isSafeInteger(floor) || floor < 0)) {
    throw new CurrentSdkOperationError("CURRENT_COLLATERAL_CONTEXT_INVALID", "minimumContextSlot must be a nonnegative safe integer");
  }
  const response = await input.connection.getAccountInfoAndContext(address, {
    commitment: finalizedCommitment(input.commitment), ...(floor === undefined ? {} : { minContextSlot: floor }),
  });
  if (!Number.isSafeInteger(response.context.slot) || response.context.slot < (floor ?? 0)) {
    throw new CurrentSdkOperationError("CURRENT_COLLATERAL_CONTEXT_STALE", "collateral evidence precedes the required finalized slot");
  }
  const info = response.value;
  const observedAtSlot = String(response.context.slot);
  if (info === null) return { ...identity(), deployment: CURRENT_LIVE_DEPLOYMENT, address, observedAtSlot, found: false, collateral: null };
  requireProgramAccount("UserCollateral", info, input.programId, CURRENT_USER_COLLATERAL_ACCOUNT_SIZE);
  return {
    ...identity(),
    deployment: CURRENT_LIVE_DEPLOYMENT,
    address,
    observedAtSlot,
    found: true,
    collateral: decodeCurrentUserCollateralAccount({
      address,
      data: info.data,
      owner: info.owner,
      executable: info.executable,
      namespace: input.namespace,
      programId: input.programId,
      expectedOwner: owner,
    }),
  };
}

function validatedCurrentIdempotencyKey(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new CurrentSdkOperationError(
      "CURRENT_IDEMPOTENCY_KEY_INVALID",
      "idempotencyKey must be 1..128 ASCII letters, digits, dot, underscore, colon, or hyphen",
    );
  }
  return value;
}

function validatedCurrentSubmissionReceipt(
  receipt: CurrentSubmissionReceipt,
  planValue: CurrentOperationPlan,
  idempotencyKey: string,
): CurrentSubmissionReceipt {
  exactKeys(receipt, [
    "status", "operationId", "preparedPlanDigest", "idempotencyKey", "signature",
    "finalizedSlot", "finalizedBlockTime", "confirmationStatus", "simulation", "postState",
  ], "CURRENT_SUBMISSION_RECEIPT_INVALID");
  if (
    receipt.status !== "finalized"
    || receipt.confirmationStatus !== "finalized"
    || receipt.operationId !== planValue.operationId
    || receipt.preparedPlanDigest !== (planValue as CurrentOperationPlan & { readonly preparedPlanDigest: string }).preparedPlanDigest
    || receipt.idempotencyKey !== idempotencyKey
    || typeof receipt.signature !== "string"
    || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(receipt.signature)
    || !/^(0|[1-9][0-9]*)$/.test(receipt.finalizedSlot)
    || (receipt.finalizedBlockTime !== null && !/^(0|[1-9][0-9]*)$/.test(receipt.finalizedBlockTime))
    || receipt.postState.length !== planValue.writeSet.length
  ) {
    throw new CurrentSdkOperationError(
      "CURRENT_SUBMISSION_RECEIPT_INVALID",
      "managed submission receipt is not finalized or is not bound to the exact plan and idempotency key",
    );
  }
  exactKeys(receipt.simulation, ["status", "unitsConsumed", "logsSha256"], "CURRENT_SUBMISSION_RECEIPT_INVALID");
  if (
    receipt.simulation.status !== "succeeded"
    || (receipt.simulation.unitsConsumed !== null && !/^(0|[1-9][0-9]*)$/.test(receipt.simulation.unitsConsumed))
    || !/^[0-9a-f]{64}$/.test(receipt.simulation.logsSha256)
  ) {
    throw new CurrentSdkOperationError("CURRENT_SUBMISSION_RECEIPT_INVALID", "managed submission receipt lacks exact successful simulation facts");
  }
  receipt.postState.forEach((fact, index) => {
    exactKeys(fact, ["address", "owner", "lamports", "executable", "dataSha256"], "CURRENT_SUBMISSION_RECEIPT_INVALID");
    try {
      new PublicKey(fact.address);
      new PublicKey(fact.owner);
    } catch {
      throw new CurrentSdkOperationError("CURRENT_SUBMISSION_RECEIPT_INVALID", "post-state contains an invalid account public key");
    }
    if (
      fact.address !== planValue.writeSet[index]
      || !/^(0|[1-9][0-9]*)$/.test(fact.lamports)
      || typeof fact.executable !== "boolean"
      || !/^[0-9a-f]{64}$/.test(fact.dataSha256)
    ) {
      throw new CurrentSdkOperationError(
        "CURRENT_SUBMISSION_RECEIPT_INVALID",
        "post-state must attest every writable account in exact plan order",
      );
    }
  });
  return cloneAndFreezeIssuedValue(receipt);
}

export interface ValidateCurrentSubmissionReceiptInput {
  readonly receipt: CurrentSubmissionReceipt;
  readonly plan: CurrentOperationPlan;
  readonly idempotencyKey: string;
}

/** Stateless validation for a managed-signer finalized receipt and its exact plan. */
export function validateCurrentSubmissionReceipt(
  input: ValidateCurrentSubmissionReceiptInput,
): CurrentSubmissionReceipt {
  const idempotencyKey = validatedCurrentIdempotencyKey(input.idempotencyKey);
  validateCurrentOperationPlanStructure({
    plan: input.plan,
    operation: input.plan.operation,
    namespace: input.plan.stateNamespace,
  });
  return validatedCurrentSubmissionReceipt(input.receipt, input.plan, idempotencyKey);
}

async function submitCurrentOracleDraft(input: {
  readonly plan: CurrentOracleDraftPlan;
  readonly idempotencyKey: string;
  readonly submissionCapability?: CurrentSubmissionCapability;
}): Promise<CurrentSubmissionReceipt> {
  validateCurrentOperationPlanStructure({ plan: input.plan, operation: "oracle_draft", namespace: CURRENT_STATE_NAMESPACE });
  if (input.plan.setupInstructionBatches.length !== 0) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_SUBMISSION_UNAVAILABLE", "oracle drafts cannot carry setup transactions");
  }
  if (input.submissionCapability === undefined) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_SUBMISSION_UNAVAILABLE", "no public Oracle submission capability is configured");
  }
  const idempotencyKey = validatedCurrentIdempotencyKey(input.idempotencyKey);
  const receipt = await input.submissionCapability.submitOracleDraft({
    plan: input.plan,
    idempotencyKey,
  });
  return validatedCurrentSubmissionReceipt(receipt, input.plan, idempotencyKey);
}

export interface CurrentUserLedgerDto {
  readonly stateNamespace: CurrentStateNamespace;
  readonly ownerPubkey: string;
  readonly summaries: readonly CurrentUserLedgerSummaryDto[];
  readonly events: readonly [];
}

export interface CurrentUserLedgerSummaryDto {
  readonly kind: "oracle_player_ledger_balance";
  readonly address: string;
  readonly found: true;
  readonly balance: {
    readonly bump: number;
    readonly ownerPubkey: string;
    readonly availableBalance: string;
    readonly lockedBalance: string;
    readonly lastUpdatedSlot: string;
    readonly lastBalanceChangeSlot: string;
  };
}

export interface CurrentUserCollateralDto extends CurrentDeploymentIdentity<typeof CURRENT_LIVE_DEPLOYMENT> {
  readonly observedAtSlot: string;
  readonly ownerPubkey: string;
  readonly userCollateralPda: string;
  readonly userCollateralExists: boolean;
  readonly availableBalance: string;
  readonly lockedBalance: string;
  readonly requiredBalance: "0";
  readonly canSubmitTrade: boolean;
  readonly lastActionSlot: string | null;
  readonly statusMessage: string;
}

function currentUserLedgerDto(value: CurrentUserLedgerResult, ownerPubkey: string): CurrentUserLedgerDto {
  return Object.freeze({
    stateNamespace: CURRENT_STATE_NAMESPACE,
    ownerPubkey,
    summaries: Object.freeze(value.ledger === null ? [] : [Object.freeze({
      kind: "oracle_player_ledger_balance" as const,
      address: value.address.toBase58(),
      found: true as const,
      balance: Object.freeze({
        bump: value.ledger.bump,
        ownerPubkey: value.ledger.owner.toBase58(),
        availableBalance: value.ledger.availableBalance.toString(),
        lockedBalance: value.ledger.lockedBalance.toString(),
        lastUpdatedSlot: value.ledger.lastUpdatedSlot.toString(),
        lastBalanceChangeSlot: value.ledger.lastBalanceChangeSlot.toString(),
      }),
    })]),
    events: Object.freeze([]) as readonly [],
  });
}

function currentUserCollateralDto(value: CurrentUserCollateralResult, ownerPubkey: string): CurrentUserCollateralDto {
  return Object.freeze({
    stateNamespace: value.stateNamespace,
    deployment: value.deployment,
    ownerPubkey,
    userCollateralPda: value.address.toBase58(),
    userCollateralExists: value.found,
    observedAtSlot: value.observedAtSlot,
    availableBalance: value.collateral?.availableBalance.toString() ?? "0",
    lockedBalance: value.collateral?.lockedBalance.toString() ?? "0",
    requiredBalance: "0",
    canSubmitTrade: value.found,
    lastActionSlot: value.collateral?.lastActionSlot.toString() ?? null,
    statusMessage: value.found
      ? "Current collateral account is available."
      : "Current collateral account is not initialized.",
  });
}

export type CurrentFactoryDecodeMarketAccountInput = Omit<
  Parameters<typeof decodeStrictMarket>[0],
  "programId" | "namespace"
>;

type CurrentAdapterBoundInput<T extends CurrentAdapterContextInput> = Omit<
  T,
  "connection" | "programId" | "namespace" | "photonConnection" | "oracleCompressedStateLookupTable"
>;

export interface CurrentSdkAdapter {
  readCurrentDeploymentFacts(input?: { readonly commitment?: Commitment }): Promise<CurrentDeploymentFacts>;
  readCurrentChainIdentity(input?: { readonly commitment?: Commitment }): Promise<CurrentChainIdentityDto>;
  readCurrentMarketAccount(input: { readonly marketId: string; readonly expiryId: string; readonly commitment?: Commitment }): Promise<CurrentMarketReadResult>;
  readCurrentAmoebaDlmmPool(input: { readonly marketId: string; readonly expiryId: string; readonly commitment?: Commitment }): Promise<CurrentAmoebaDlmmPoolReadResult>;
  decodeCurrentMarketAccount(input: CurrentFactoryDecodeMarketAccountInput): CurrentMarketAccount;
  decodeCurrentAmoebaDlmmPoolAccount(input: Omit<DecodeCurrentAmoebaDlmmPoolAccountInput, "programId" | "namespace">): CurrentAmoebaDlmmPoolAccount;
  decodeCurrentAmoebaDlmmBinPageAccount(input: Omit<DecodeCurrentAmoebaDlmmPageAccountInput, "programId" | "namespace">): CurrentAmoebaDlmmBinPageAccount;
  decodeCurrentAmoebaDlmmSharePageAccount(input: Omit<DecodeCurrentAmoebaDlmmPageAccountInput, "programId" | "namespace">): CurrentAmoebaDlmmSharePageAccount;
  decodeCurrentAmoebaDlmmPositionAccount(input: Omit<DecodeCurrentAmoebaDlmmPositionAccountInput, "programId" | "namespace">): CurrentAmoebaDlmmPositionAccount;
  discoverCurrentAmoebaDlmmPages(input: CurrentAdapterBoundInput<DiscoverCurrentAmoebaDlmmPagesInput>): Promise<CurrentAmoebaDlmmPagesResult>;
  discoverCurrentAmoebaDlmmPositions(input: CurrentAdapterBoundInput<DiscoverCurrentAmoebaDlmmPositionsInput>): Promise<CurrentAmoebaDlmmPositionsResult>;
  resolveCurrentAmoebaDlmmState(input: CurrentAdapterBoundInput<ResolveCurrentAmoebaDlmmStateInput>): Promise<CurrentResolvedAmoebaDlmmState>;
  resolveCurrentLightAccounts(input: CurrentAdapterBoundInput<ResolveCurrentLightAccountsInput>): Promise<CurrentLightAccountResolution>;
  validateCurrentHotLightAccount(input: ValidateCurrentHotLightAccountInput): CurrentValidatedHotLightAccount;
  validateCurrentOperationPlan(plan: CurrentOperationPlan): void;
  buildCurrentGovernedInstruction<Name extends CurrentGovernedBuilderNameV1>(input: {
    readonly builderName: Name;
    readonly builderInput: CurrentGovernedBuilderInputV1<Name>;
  }): Promise<CurrentGovernedInstructionMaterializationV1>;
  readCurrentOracleState(input?: { readonly marketId?: string; readonly expiryId?: string; readonly commitment?: Commitment }): Promise<CurrentOracleState>;
  buildCurrentOracleDraft(input: {
    readonly request: BuildCurrentOracleDraftInput["request"];
    readonly commitment?: Commitment;
  }): Promise<CurrentOracleDraftPlan>;
  readCurrentPositionExpiryAutomation(input: CurrentAdapterBoundInput<ReadCurrentPositionExpiryAutomationInput>): Promise<CurrentPositionExpiryProjection>;
  syncCurrentPositionExpiryAutomation(input: CurrentAdapterBoundInput<SyncCurrentPositionExpiryAutomationInput>): ReturnType<typeof syncCurrentPositionExpiryAutomation>;
  prepareCurrentPositionActionContext(input: CurrentAdapterBoundInput<PrepareCurrentPositionActionContextInput>): Promise<CurrentPositionActionContext>;
  buildCurrentPositionAction(input: CurrentAdapterBoundInput<BuildCurrentPositionActionInput>): Promise<CurrentPositionActionPlan>;
  readCurrentUserLedger(input: { readonly owner: string; readonly commitment?: Commitment }): Promise<CurrentUserLedgerDto>;
  readCurrentUserCollateral(input: { readonly owner: string; readonly commitment?: Commitment; readonly minimumContextSlot?: number }): Promise<CurrentUserCollateralDto>;
  submitCurrentOracleDraft(input: { readonly plan: CurrentOracleDraftPlan; readonly idempotencyKey: string }): Promise<CurrentSubmissionReceipt>;
}

function snapshotCurrentOracleLookupTableAuthorization(
  value: CurrentOracleCompressedStateLookupTableAuthorization | undefined,
): CurrentOracleCompressedStateLookupTableAuthorization | undefined {
  if (value === undefined) return undefined;
  let address: PublicKey;
  let authority: PublicKey | null;
  try {
    address = value.address instanceof PublicKey ? new PublicKey(value.address.toBytes()) : new PublicKey(value.address);
    authority = value.authority === null
      ? null
      : value.authority instanceof PublicKey
        ? new PublicKey(value.authority.toBytes())
        : new PublicKey(value.authority);
  } catch {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "Oracle lookup-table authorization contains an invalid public key");
  }
  if (
    address.equals(PublicKey.default)
    || typeof value.addressesSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.addressesSha256)
  ) {
    throw new CurrentSdkOperationError("CURRENT_ORACLE_LOOKUP_TABLE_INVALID", "Oracle lookup-table authorization is not canonical");
  }
  return Object.freeze({
    address: address.toBase58(),
    authority: authority?.toBase58() ?? null,
    addressesSha256: value.addressesSha256,
  });
}

export function createCurrentSdkAdapter(input: CreateCurrentSdkAdapterInput): CurrentSdkAdapter {
  const programId = input.programId instanceof PublicKey ? input.programId : new PublicKey(input.programId);
  const oracleCompressedStateLookupTable = snapshotCurrentOracleLookupTableAuthorization(
    input.oracleCompressedStateLookupTable,
  );
  if (
    programId.toBase58() !== DEFAULT_AMEBA_SPREAD_PROGRAM_ID
    || input.namespace !== CURRENT_STATE_NAMESPACE
    || input.cluster !== CURRENT_PROTOCOL_CLUSTER
    || input.releaseTag !== CURRENT_PROTOCOL_RELEASE
    || input.releaseCommit !== CURRENT_PROTOCOL_SOURCE_COMMIT
  ) {
    throw new CurrentSdkOperationError("CURRENT_ADAPTER_IDENTITY_INVALID", "adapter identity is not exact rc.44 Devnet");
  }
  const context = (commitment?: Commitment): CurrentAdapterContextInput => ({
    connection: input.connection,
    programId,
    namespace: CURRENT_STATE_NAMESPACE,
    commitment: finalizedCommitment(commitment),
    photonConnection: input.photonConnection,
    oracleCompressedStateLookupTable,
  });
  let attestationCache: { readonly observedSlot: number; readonly facts: CurrentDeploymentFacts } | undefined;
  let attestationInFlight: { readonly observedSlot: number; readonly promise: Promise<CurrentDeploymentFacts> } | undefined;
  const issuedOraclePlans = new WeakSet<CurrentOracleDraftPlan>();
  const submittedOracleIdempotencyKeys = new WeakMap<CurrentOracleDraftPlan, string>();
  const issuedOperationPlans = new WeakMap<CurrentOperationPlan, string>();
  const issuePlan = <T extends CurrentOperationPlan>(value: T): T => {
    issuedOperationPlans.set(value, issuedPlanIntegrityDigest(value));
    return value;
  };
  const validateIssuedPlan = (planValue: CurrentOperationPlan): void => {
    const issuedDigest = issuedOperationPlans.get(planValue);
    if (issuedDigest === undefined) {
      throw new CurrentSdkOperationError(
        "CURRENT_PLAN_NOT_ISSUED",
        "operation validation accepts only the exact plan object issued by this adapter instance",
      );
    }
    if (issuedDigest !== issuedPlanIntegrityDigest(planValue)) {
      throw new CurrentSdkOperationError("CURRENT_PLAN_MUTATED", "the issued operation plan graph changed after construction");
    }
    validateCurrentOperationPlanStructure({
      plan: planValue,
      operation: planValue.operation,
      namespace: planValue.stateNamespace,
    });
  };
  const attest = async (): Promise<CurrentDeploymentFacts> => {
    const observedSlot = await input.connection.getSlot(CURRENT_STATE_COMMITMENT);
    if (!Number.isSafeInteger(observedSlot) || observedSlot < 0) {
      throw new CurrentSdkOperationError("CURRENT_DEPLOYMENT_UNAVAILABLE", "finalized deployment attestation slot is invalid");
    }
    if (attestationCache?.observedSlot === observedSlot) return attestationCache.facts;
    if (attestationInFlight?.observedSlot === observedSlot) return attestationInFlight.promise;
    const pending = readCurrentDeploymentFacts(context()).then((facts) => {
      attestationCache = { observedSlot, facts };
      return facts;
    });
    attestationInFlight = { observedSlot, promise: pending };
    try {
      return await pending;
    } catch (cause) {
      if (attestationInFlight?.promise === pending) attestationInFlight = undefined;
      throw cause;
    } finally {
      if (attestationInFlight?.promise === pending) attestationInFlight = undefined;
    }
  };
  const bound = <T extends object>(value: T, commitment?: Commitment): T & CurrentAdapterContextInput => Object.assign(
    {},
    value,
    context(commitment),
  );
  const afterAttestation = async <T>(operation: () => Promise<T> | T): Promise<T> => {
    const facts = await attest();
    if (!facts.verified) {
      throw new CurrentSdkOperationError("CURRENT_DEPLOYMENT_UNAVAILABLE", "the pinned rc.44 deployment is not present");
    }
    return operation();
  };
  const adapter: CurrentSdkAdapter = {
    readCurrentDeploymentFacts: (value = {}) => {
      finalizedCommitment(value.commitment);
      return attest();
    },
    readCurrentChainIdentity: (value = {}) => afterAttestation(async () => {
      const { readCurrentChainIdentity } = await import("./current-chain.js");
      return readCurrentChainIdentity({
        connection: input.connection,
        programId,
        namespace: CURRENT_STATE_NAMESPACE,
        commitment: finalizedCommitment(value.commitment),
      });
    }),
    readCurrentMarketAccount: (value) => afterAttestation(() => readCurrentMarketAccount(bound(
      { marketId: value.marketId, expiryId: value.expiryId }, value.commitment,
    ))),
    readCurrentAmoebaDlmmPool: (value) => afterAttestation(() => readCurrentAmoebaDlmmPool(bound(
      { marketId: value.marketId, expiryId: value.expiryId }, value.commitment,
    ))),
    decodeCurrentMarketAccount: (value) => decodeStrictMarket({
      ...value,
      namespace: CURRENT_STATE_NAMESPACE,
      programId,
    }),
    decodeCurrentAmoebaDlmmPoolAccount: (value) => decodeCurrentAmoebaDlmmPoolAccount(bound(value)),
    decodeCurrentAmoebaDlmmBinPageAccount: (value) => decodeCurrentAmoebaDlmmBinPageAccount(bound(value)),
    decodeCurrentAmoebaDlmmSharePageAccount: (value) => decodeCurrentAmoebaDlmmSharePageAccount(bound(value)),
    decodeCurrentAmoebaDlmmPositionAccount: (value) => decodeCurrentAmoebaDlmmPositionAccount(bound(value)),
    discoverCurrentAmoebaDlmmPages: (value) => afterAttestation(() => discoverCurrentAmoebaDlmmPages(bound(value, value.commitment))),
    discoverCurrentAmoebaDlmmPositions: (value) => afterAttestation(() => discoverCurrentAmoebaDlmmPositions(bound(value, value.commitment))),
    resolveCurrentAmoebaDlmmState: (value) => afterAttestation(() => resolveCurrentAmoebaDlmmState(bound(value, value.commitment))),
    resolveCurrentLightAccounts: (value) => afterAttestation(() => resolveCurrentLightAccounts(bound(value, value.commitment))),
    validateCurrentHotLightAccount,
    validateCurrentOperationPlan: validateIssuedPlan,
    buildCurrentGovernedInstruction: (value) => afterAttestation(async () => {
      const minimumContextSlot = await input.connection.getSlot(CURRENT_STATE_COMMITMENT);
      if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 0) {
        throw new CurrentSdkOperationError(
          "CURRENT_GOVERNANCE_CONTEXT_INVALID",
          "finalized governance observation floor is unavailable",
        );
      }
      return materializeCurrentGovernedInstructionV1({
        rpc: input.connection,
        minimumContextSlot,
        builderName: value.builderName,
        builderInput: value.builderInput,
      });
    }),
    readCurrentOracleState: (value = {}) => afterAttestation(() => readCurrentOracleState(bound(
      { marketId: value.marketId, expiryId: value.expiryId }, value.commitment,
    ))),
    buildCurrentOracleDraft: (value) => afterAttestation(async () => {
      let operationInput = bound({ request: value.request }, value.commitment);
      if (isCurrentWriteReleaseAvailable()) {
        const minimumContextSlot = await input.connection.getSlot(CURRENT_STATE_COMMITMENT);
        if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 0) {
          throw new CurrentSdkOperationError(
            "CURRENT_GOVERNANCE_CONTEXT_INVALID",
            "finalized governance observation floor is unavailable",
          );
        }
        const governed = await prepareBoundCurrentGovernedWriteV1({
          rpc: input.connection,
          minimumContextSlot,
          release: currentGovernedWriteReleaseV1(),
        });
        operationInput = { ...operationInput, programId: governed.governedProgramId };
      }
      const built = issuePlan(await buildCurrentOracleDraft(operationInput));
      issuedOraclePlans.add(built);
      return built;
    }),
    readCurrentPositionExpiryAutomation: (value) => afterAttestation(() => readCurrentPositionExpiryAutomation(bound(value, value.commitment))),
    syncCurrentPositionExpiryAutomation: (value) => afterAttestation(() => syncCurrentPositionExpiryAutomation(bound(value, value.commitment))),
    prepareCurrentPositionActionContext: (value) => afterAttestation(() => prepareCurrentPositionActionContext(bound(value, value.commitment))),
    buildCurrentPositionAction: (value) => afterAttestation(async () => issuePlan(await buildCurrentPositionAction(bound(value, value.commitment)))),
    readCurrentUserLedger: (value) => afterAttestation(async () => currentUserLedgerDto(
      await readCurrentUserLedger(bound({ ownerPubkey: value.owner }, value.commitment)),
      value.owner,
    )),
    readCurrentUserCollateral: (value) => afterAttestation(async () => currentUserCollateralDto(
      await readCurrentUserCollateral(bound({ ownerPubkey: value.owner, ...(value.minimumContextSlot === undefined ? {} : { minimumContextSlot: value.minimumContextSlot }) }, value.commitment)),
      value.owner,
    )),
    submitCurrentOracleDraft: (value) => afterAttestation(() => {
      if (!issuedOraclePlans.has(value.plan)) {
        throw new CurrentSdkOperationError("CURRENT_ORACLE_PLAN_NOT_ISSUED", "submission accepts only the exact plan object issued by this adapter instance");
      }
      validateIssuedPlan(value.plan);
      const idempotencyKey = validatedCurrentIdempotencyKey(value.idempotencyKey);
      const priorIdempotencyKey = submittedOracleIdempotencyKeys.get(value.plan);
      if (priorIdempotencyKey !== undefined && priorIdempotencyKey !== idempotencyKey) {
        throw new CurrentSdkOperationError("CURRENT_IDEMPOTENCY_KEY_MISMATCH", "the issued Oracle plan is already bound to a different idempotency key");
      }
      submittedOracleIdempotencyKeys.set(value.plan, idempotencyKey);
      return submitCurrentOracleDraft({
        plan: value.plan,
        idempotencyKey,
        submissionCapability: input.submissionCapability,
      });
    }),
  };
  return Object.freeze(adapter);
}

// Exact current bytes are independent of historical portable-plan reader metadata.
const CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS = CURRENT_LIVE_DEPLOYMENT.programDataAddress;
const CURRENT_PROTOCOL_PROGRAMDATA_BYTES = CURRENT_LIVE_DEPLOYMENT.programDataAccountBytes;
const CURRENT_PROTOCOL_UPGRADE_AUTHORITY = CURRENT_LIVE_DEPLOYMENT.upgradeAuthority.address;
const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES = CURRENT_LIVE_DEPLOYMENT.programDataPayloadBytes;
const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256 = CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256;
const CURRENT_PROTOCOL_DEPLOYED_SLOT = CURRENT_LIVE_DEPLOYMENT.programDataSlot;
