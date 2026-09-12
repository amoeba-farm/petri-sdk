import { type CurrentOracleStakingProofFacts } from "./current-oracle-staking-proof.js";
import { syncCurrentPositionExpiryAutomation, type ReadCurrentPositionExpiryAutomationInput, type SyncCurrentPositionExpiryAutomationInput, type CurrentPositionExpiryProjection } from "./current-position-expiry.js";
import { Buffer } from "buffer";
import { PACKET_DATA_SIZE, PublicKey, TransactionInstruction, type AccountInfo, type Commitment, type Connection } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
import { CURRENT_PROTOCOL_DEPLOYMENT, CURRENT_PROTOCOL_RELEASE, CURRENT_PROTOCOL_SOURCE_COMMIT, decodeCurrentMarketAccount as decodeStrictMarket, type CurrentMarketAccount, type CurrentOracleMonthAccount, type CurrentUserCollateralAccount, type CurrentVaultConfigAccount } from "./current.js";
import { decodeOraclePlayerLedgerBalance } from "@amoeba/spread-release-tools/oracle-dlmm";
import { type AmoebaDlmmBinPageAccount, type AmoebaDlmmPoolAccount, type AmoebaDlmmPositionAccount, type AmoebaDlmmSharePageAccount } from "@amoeba/spread-release-tools/dlmm-accounts";
import { type AmoebaDlmmSwapDirection } from "@amoeba/spread-release-tools/dlmm-instructions";
import type { CurrentChainIdentityDto } from "./current-chain.js";
import type { CurrentPhotonColdWitness, CurrentPhotonCompressedInstructionWitness, CurrentPhotonConnection, CurrentPhotonLightAtaBalance } from "./current-photon.js";
import type { CurrentOracleActionRequest, CurrentOracleRedactedRequest } from "./current-oracle.js";
import { type CurrentGovernedBuilderInputV1, type CurrentGovernedBuilderNameV1, type CurrentGovernedInstructionMaterializationV1 } from "./current-governed-write.js";
import { CURRENT_LIVE_DEPLOYMENT } from "./release-train.js";
export declare const CURRENT_STATE_NAMESPACE: "ameba-spread-v2";
export type CurrentStateNamespace = typeof CURRENT_STATE_NAMESPACE;
export declare const CURRENT_STATE_COMMITMENT: "finalized";
export declare const CURRENT_LIGHT_DEFAULT_ADDRESS_TREE_V2: PublicKey;
export type CurrentLightAccountLoadMode = "required" | "not_required";
export type CurrentColdResolutionMode = "hot" | "proof_only" | "load_ready";
export declare class CurrentSdkOperationError extends AmebaProtocolError {
    constructor(code: string, message: string, details?: Record<string, string | number | boolean | null>);
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
export interface ReadCurrentDeploymentFactsInput extends CurrentAdapterContextInput {
}
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
export type CurrentAmoebaDlmmStateLocator = {
    readonly kind: "pool";
    readonly marketAddress: PublicKey;
    readonly market: CurrentMarketAccount;
    readonly oracleMonthAddress: PublicKey;
    readonly vaultConfig: CurrentVaultConfigAccount;
} | {
    readonly kind: "reserve_page";
    readonly poolAddress: PublicKey;
    readonly pageIndex: number;
} | {
    readonly kind: "share_page";
    readonly poolAddress: PublicKey;
    readonly pageIndex: number;
} | {
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
    readonly account: CurrentAmoebaDlmmPoolAccount | CurrentAmoebaDlmmBinPageAccount | CurrentAmoebaDlmmSharePageAccount | CurrentAmoebaDlmmPositionAccount;
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
export declare function currentLightSetupInstructionBatches(resolution: CurrentLightAccountResolution, actionInstructions: readonly TransactionInstruction[]): readonly (readonly TransactionInstruction[])[];
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
export type CurrentPlanSignerRoleName = "position_owner" | "oracle_actor" | "setup_payer";
export interface CurrentPlanSignerRole {
    readonly pubkey: string;
    readonly role: CurrentPlanSignerRoleName;
    readonly scope: "main" | "setup";
    readonly setupBatchIndex: number | null;
    readonly instructionIndexes: readonly number[];
}
export type CurrentPlanJsonPrimitive = string | number | boolean | null;
export type CurrentPlanJsonValue = CurrentPlanJsonPrimitive | readonly CurrentPlanJsonValue[] | CurrentPlanJsonObject;
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
export declare function readCurrentDeploymentFacts(input: ReadCurrentDeploymentFactsInput): Promise<CurrentDeploymentFacts>;
export declare function readCurrentMarketAccount(input: ReadCurrentMarketAccountInput): Promise<CurrentMarketReadResult>;
export declare function decodeCurrentAmoebaDlmmPoolAccount(input: DecodeCurrentAmoebaDlmmPoolAccountInput): CurrentAmoebaDlmmPoolAccount;
export declare function decodeCurrentAmoebaDlmmBinPageAccount(input: DecodeCurrentAmoebaDlmmPageAccountInput): CurrentAmoebaDlmmBinPageAccount;
export declare function decodeCurrentAmoebaDlmmSharePageAccount(input: DecodeCurrentAmoebaDlmmPageAccountInput): CurrentAmoebaDlmmSharePageAccount;
export declare function decodeCurrentAmoebaDlmmPositionAccount(input: DecodeCurrentAmoebaDlmmPositionAccountInput): CurrentAmoebaDlmmPositionAccount;
export declare function discoverCurrentAmoebaDlmmPages(input: DiscoverCurrentAmoebaDlmmPagesInput): Promise<CurrentAmoebaDlmmPagesResult>;
export declare function discoverCurrentAmoebaDlmmPositions(input: DiscoverCurrentAmoebaDlmmPositionsInput): Promise<CurrentAmoebaDlmmPositionsResult>;
export declare function resolveCurrentAmoebaDlmmState(input: ResolveCurrentAmoebaDlmmStateInput): Promise<CurrentResolvedAmoebaDlmmState>;
export declare function readCurrentAmoebaDlmmPool(input: ReadCurrentAmoebaDlmmPoolInput): Promise<CurrentAmoebaDlmmPoolReadResult>;
export declare function resolveCurrentLightAccounts(input: ResolveCurrentLightAccountsInput): Promise<CurrentLightAccountResolution>;
/**
 * Decode and validate one exact hot Light ATA snapshot. This is deliberately
 * synchronous so callers can bind the same AccountInfo bytes used for their
 * finalized observation without a second RPC read.
 */
export declare function validateCurrentHotLightAccount(input: ValidateCurrentHotLightAccountInput): CurrentValidatedHotLightAccount;
export declare function currentOracleLookupTableAddressesSha256(addresses: readonly (PublicKey | string)[]): string;
/**
 * Stateless validation for a portable rich plan. Adapter instances add a
 * separate issued-object check through their method of the same name.
 */
export declare function validateCurrentOperationPlan(planValue: CurrentOperationPlan): void;
/** Return the complete immutable plan as a canonical JSON-safe value. */
export declare function currentOperationPlanToJson(planValue: CurrentOperationPlan): CurrentOperationPlanJson;
/** Validate a persisted/remote JSON plan and all of its RC44 bytes, metas, PDAs, digests, and proof facts. */
export declare function validateCurrentOperationPlanJson(planJson: CurrentOperationPlanJson): void;
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
export type CurrentOracleLogicalInstructionTag = 131 | 133 | 138 | 139 | 155 | 161 | 162 | 163 | 165 | 166 | 168 | 174 | 176 | 177 | 181 | 182 | 183 | 198 | 199;
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
export declare function readCurrentOracleState(input: ReadCurrentOracleStateInput): Promise<CurrentOracleState>;
export declare function buildCurrentOracleDraft(input: BuildCurrentOracleDraftInput): Promise<CurrentOracleDraftPlan>;
export type CurrentPositionActionRequest = {
    readonly action: "init_collateral";
    readonly ownerPubkey: string;
} | {
    readonly action: "deposit_collateral" | "withdraw_collateral";
    readonly ownerPubkey: string;
    readonly amount: bigint;
};
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
/** Observe canonical collateral accounts before the caller obtains its separate Lean admission. */
export declare function prepareCurrentPositionActionContext(input: PrepareCurrentPositionActionContextInput): Promise<CurrentPositionActionContext>;
/** Build unsigned bytes from the exact observed context; signing/submission remain outside the SDK. */
export declare function buildCurrentPositionAction(input: BuildCurrentPositionActionInput): Promise<CurrentPositionActionPlan>;
export interface ReadCurrentUserLedgerInput extends CurrentAdapterContextInput {
    readonly ownerPubkey: string;
}
export interface CurrentUserLedgerResult extends CurrentDeploymentIdentity<typeof CURRENT_LIVE_DEPLOYMENT> {
    readonly address: PublicKey;
    readonly found: boolean;
    readonly ledger: ReturnType<typeof decodeOraclePlayerLedgerBalance> | null;
}
export declare function readCurrentUserLedger(input: ReadCurrentUserLedgerInput): Promise<CurrentUserLedgerResult>;
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
export declare function readCurrentUserCollateral(input: ReadCurrentUserCollateralInput): Promise<CurrentUserCollateralResult>;
export interface ValidateCurrentSubmissionReceiptInput {
    readonly receipt: CurrentSubmissionReceipt;
    readonly plan: CurrentOperationPlan;
    readonly idempotencyKey: string;
}
/** Stateless validation for a managed-signer finalized receipt and its exact plan. */
export declare function validateCurrentSubmissionReceipt(input: ValidateCurrentSubmissionReceiptInput): CurrentSubmissionReceipt;
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
export type CurrentFactoryDecodeMarketAccountInput = Omit<Parameters<typeof decodeStrictMarket>[0], "programId" | "namespace">;
type CurrentAdapterBoundInput<T extends CurrentAdapterContextInput> = Omit<T, "connection" | "programId" | "namespace" | "photonConnection" | "oracleCompressedStateLookupTable">;
export interface CurrentSdkAdapter {
    readCurrentDeploymentFacts(input?: {
        readonly commitment?: Commitment;
    }): Promise<CurrentDeploymentFacts>;
    readCurrentChainIdentity(input?: {
        readonly commitment?: Commitment;
    }): Promise<CurrentChainIdentityDto>;
    readCurrentMarketAccount(input: {
        readonly marketId: string;
        readonly expiryId: string;
        readonly commitment?: Commitment;
    }): Promise<CurrentMarketReadResult>;
    readCurrentAmoebaDlmmPool(input: {
        readonly marketId: string;
        readonly expiryId: string;
        readonly commitment?: Commitment;
    }): Promise<CurrentAmoebaDlmmPoolReadResult>;
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
    readCurrentOracleState(input?: {
        readonly marketId?: string;
        readonly expiryId?: string;
        readonly commitment?: Commitment;
    }): Promise<CurrentOracleState>;
    buildCurrentOracleDraft(input: {
        readonly request: BuildCurrentOracleDraftInput["request"];
        readonly commitment?: Commitment;
    }): Promise<CurrentOracleDraftPlan>;
    readCurrentPositionExpiryAutomation(input: CurrentAdapterBoundInput<ReadCurrentPositionExpiryAutomationInput>): Promise<CurrentPositionExpiryProjection>;
    syncCurrentPositionExpiryAutomation(input: CurrentAdapterBoundInput<SyncCurrentPositionExpiryAutomationInput>): ReturnType<typeof syncCurrentPositionExpiryAutomation>;
    prepareCurrentPositionActionContext(input: CurrentAdapterBoundInput<PrepareCurrentPositionActionContextInput>): Promise<CurrentPositionActionContext>;
    buildCurrentPositionAction(input: CurrentAdapterBoundInput<BuildCurrentPositionActionInput>): Promise<CurrentPositionActionPlan>;
    readCurrentUserLedger(input: {
        readonly owner: string;
        readonly commitment?: Commitment;
    }): Promise<CurrentUserLedgerDto>;
    readCurrentUserCollateral(input: {
        readonly owner: string;
        readonly commitment?: Commitment;
        readonly minimumContextSlot?: number;
    }): Promise<CurrentUserCollateralDto>;
    submitCurrentOracleDraft(input: {
        readonly plan: CurrentOracleDraftPlan;
        readonly idempotencyKey: string;
    }): Promise<CurrentSubmissionReceipt>;
}
export declare function createCurrentSdkAdapter(input: CreateCurrentSdkAdapterInput): CurrentSdkAdapter;
export {};
//# sourceMappingURL=current-adapter.d.ts.map