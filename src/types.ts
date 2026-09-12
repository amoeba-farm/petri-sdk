import type {
  CurrentOracleActionRequest,
  CurrentOracleRedactedRequest,
} from "./protocol/current-oracle-public.js";
import type { CurrentFinalizedObservation } from "./current-finalized-observation.js";
import type { CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL } from "./protocol/identity.js";

/**
 * Browser-safe projections for the current protocol DTOs.
 *
 * Keep these declarations independent of the Node/Light implementation
 * modules. The browser package condition can therefore typecheck the HTTP
 * client without resolving server-side protocol builders or proof transports.
 */
interface CurrentLinkedProgramIdentityDto {
  readonly programId: string;
  readonly programDataAddress: string;
  readonly programDataBytes: number;
  readonly upgradeAuthority: string;
  readonly executable: true;
  readonly deployedSlot: string;
  readonly payloadBytes: number;
  readonly payloadSha256: string;
}

interface CurrentLightStateTreeIdentityDto {
  readonly stateTree: string;
  readonly queue: string;
  readonly cpiContext: string;
}

interface CurrentChainIdentityDto {
  readonly stateNamespace: "ameba-spread-v2";
  readonly cluster: "devnet";
  readonly genesisHash: string;
  readonly releaseTag: "v0.1.0-rc.44";
  readonly releaseCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
  readonly observedSlot: string;
  readonly liveReleaseLabel?: "spread-devnet-v3-backfill-20260906";
  readonly liveSourceCommit?: "b1931fecff5229da232f06e9c5c43b1d6328806d";
  readonly liveReadProfileId?: "ameba-spread-v2-deployed-b1931fec";
  readonly reviewedBridgeSourceCommit?: "b1931fecff5229da232f06e9c5c43b1d6328806d";
  readonly deploymentProvenance?: "committed-checkpoint-and-hash-verified-artifact";
  readonly writeCompatibility?: "governance-gate-v1";
  readonly program: {
    readonly programId: string;
    readonly programDataAddress: string;
    readonly programDataBytes: 1231309;
    readonly upgradeAuthority: string;
    readonly executable: true;
    readonly deployedSlot: string;
    readonly payloadBytes: 1231264;
    readonly payloadSha256: string;
    readonly rawAccountSha256?: string;
  };
  readonly collateral?: {
    readonly vaultConfigAddress: string;
    readonly mintAddress: string;
    readonly custodyAddress: string;
    readonly tokenProgram: string;
    readonly decimals: 6;
    readonly custodyAuthority: string;
    readonly custodyAmountAtomic: string;
  };
  readonly light?: {
    readonly tokenProgram: CurrentLinkedProgramIdentityDto;
    readonly systemProgram: CurrentLinkedProgramIdentityDto;
    readonly accountCompressionProgram: CurrentLinkedProgramIdentityDto;
    readonly compressibleConfigProgram: CurrentLinkedProgramIdentityDto;
    readonly cpiAuthority: string;
    readonly compressibleConfig: string;
    readonly rentSponsor: string;
    readonly addressTree: string;
    readonly addressQueue: string;
    readonly stateTrees: readonly CurrentLightStateTreeIdentityDto[];
  };
}

type CurrentOracleLogicalInstructionTag =
  | 131 | 133 | 138 | 139 | 155 | 161 | 162 | 163 | 165 | 166 | 168 | 174
  | 176 | 177 | 181 | 182 | 183 | 198 | 199;

type CurrentOracleTransportInstructionTag = 131 | 133 | 138 | 139 | 155 | 176 | 177 | 181 | 205;

interface CurrentOracleLookupTableWitness {
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

interface CurrentOracleTransportMetrics {
  readonly outerInstructionDataBytes: number;
  readonly outerAccountMetaCount: number;
  readonly outerUniqueAccountKeys: number;
  readonly noLookupTableSerializedByteLength: number;
  readonly serializedByteLength: number;
  readonly theoreticalAltMinimizedByteLength: number;
  readonly packetDataSizeLimit: 1232;
}

interface CurrentPackedStateTreeInfo {
  readonly rootIndex: number;
  readonly proveByIndex: boolean;
  readonly treeAccountIndex: number;
  readonly queueAccountIndex: number;
  readonly leafIndex: number;
}

type CurrentPhotonCompressedStateAccessFact =
  | {
      readonly kind: "readOnly";
      readonly domain: number;
      readonly accountIndex: number;
      readonly proofIndex: number;
      readonly canonicalPda: string;
      readonly compressedAddress: string;
      readonly treeInfo: CurrentPackedStateTreeInfo;
      readonly revision: string;
      readonly compactDataBase64: string;
    }
  | {
      readonly kind: "mutable";
      readonly domain: number;
      readonly accountIndex: number;
      readonly proofIndex: number;
      readonly canonicalPda: string;
      readonly compressedAddress: string;
      readonly treeInfo: CurrentPackedStateTreeInfo;
      readonly outputStateTreeIndex: number;
      readonly revision: string;
      readonly compactDataBase64: string;
    }
  | {
      readonly kind: "initialize";
      readonly domain: number;
      readonly accountIndex: number;
      readonly proofIndex: number;
      readonly canonicalPda: string;
      readonly compressedAddress: string;
      readonly addressTreeAccountIndex: number;
      readonly addressQueueAccountIndex: number;
      readonly addressRootIndex: number;
      readonly outputStateTreeIndex: number;
    };

interface CurrentPhotonCompressedCoreAccountFact {
  readonly address: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

type CurrentPhotonCompressedProofTreeFact =
  | {
      readonly kind: "state_v2";
      readonly stateTree: string;
      readonly queue: string;
      readonly cpiContext: string;
    }
  | {
      readonly kind: "address_v2";
      readonly stateTree: string;
      readonly queue: string;
      readonly cpiContext: null;
    };

interface CurrentPhotonCompressedInstructionWitness {
  readonly providerOriginSha256: string;
  readonly marketSeriesId: string;
  readonly addressTree: string;
  readonly addressQueue: string;
  readonly outputStateTree: string;
  readonly outputQueue: string;
  readonly proofContextSlot: string;
  readonly stateFinalizedSlot: string;
  readonly roots: readonly string[];
  readonly rootIndices: readonly string[];
  readonly leafIndices: readonly string[];
  readonly treeInfos: readonly CurrentPhotonCompressedProofTreeFact[];
  readonly proofSha256: string;
  readonly logicalInstructionSha256: string;
  readonly outerInstructionSha256: string;
  readonly coreAccountCount: number;
  readonly rentPayerIndex: number;
  readonly coreAccounts: readonly CurrentPhotonCompressedCoreAccountFact[];
  readonly accesses: readonly CurrentPhotonCompressedStateAccessFact[];
  readonly observationWitnessDigests: readonly string[];
  readonly existingAccessCount: number;
  readonly initializeAccessCount: number;
  readonly witnessDigest: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

/**
 * JSON returned by Amoeba. Optional properties are represented with
 * `undefined` in TypeScript but are never serialized as JSON values.
 */
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type JsonRequestValue =
  | JsonPrimitive
  | bigint
  | JsonRequestObject
  | JsonRequestValue[];

export interface JsonRequestObject {
  [key: string]: JsonRequestValue | undefined;
}

export type ResponseValidationMode = "exact";
export type AmebaClientMode = "application" | "operator";

export interface AmebaResponseMetadata {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly status: number;
  readonly durationMs: number;
  readonly requestId?: string;
  readonly rateLimit?: {
    readonly limit?: number;
    readonly remaining?: number;
    readonly resetAt?: Date;
    readonly retryAfterMs?: number;
  };
}

export interface AmebaClientOptions {
  /** Hosted Amoeba API by default. */
  backendUrl?: string;
  /** Per-request timeout. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** Maximum backend response body size. Defaults to 4 MiB. */
  maxResponseBytes?: number;
  /** Injectable fetch implementation for tests and non-Node runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Additional non-secret headers sent with every backend request. */
  headers?: Readonly<Record<string, string>>;
  /** Exact current-protocol response validation is always enabled. */
  responseValidation?: ResponseValidationMode;
  /** Receives transport metadata without changing domain response shapes. */
  onResponse?: (metadata: AmebaResponseMetadata) => void;
  /**
   * Selects the backend capability lane. Operator mode changes routing
   * identity only; it does not bypass backend authentication or runtime policy.
   */
  clientMode?: AmebaClientMode;
}

export interface RequestControl {
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Optional idempotency key for a POST. The SDK never retries writes
   * automatically; callers can safely reuse this key after an ambiguous result.
   */
  idempotencyKey?: string;
}

export type ChartRange = "1h" | "24h" | "7d" | "30d" | "all";

export interface ChartRequest extends RequestControl {
  range?: ChartRange;
  /** Explicit server window. When present, this takes precedence over range. */
  windowMs?: number;
  includeSimulation?: boolean;
}

export type OptionSpreadKind = "call_spread" | "put_spread";

export type CurrentCollectiveOperationKind =
  | "withdraw_principal"
  | "auction_refund"
  | "deposit"
  | "bid"
  | "close_begin"
  | "close_basket"
  | "close_finalize"
  | "close_cancel"
  | "settlement_claim_flat"
  | "settlement_claim_collective"
  | "transfer_flat"
  | "collective_swap_exact_in";

/** Exact request accepted only by a prepared Amoeba product submit route. */
export interface CurrentCollectiveOperationSubmitRequest {
  readonly operationId: string;
  readonly preparedPlanDigest: string;
  readonly owner: string;
  readonly batchIndex: number;
  readonly serializedTransactionBase64: string;
  readonly signedTransactionBase64: string;
}

export interface HistoryRequest extends RequestControl {
  owner: string;
  limit?: number;
  marketId?: string;
  refresh?: boolean;
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly surface: "api" | "protocol" | "petri" | "operator" | "presentation";
  readonly native: boolean;
  readonly petriAdapter: boolean;
  readonly effect: "read" | "plan" | "prepare" | "local-write" | "remote-write" | "transaction";
  readonly method?: string;
  readonly reason?: string;
}

export interface CurrentProtocolIdentityDto {
  readonly programId: "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw";
  readonly namespace: "ameba-spread-v2";
  readonly cluster: "devnet";
  readonly releaseTag: "v0.1.0-rc.44";
  readonly releaseCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
}

export interface CurrentResponseData {
  readonly freshness?: {
    readonly source: "redis-last-known-good";
    readonly observedAt: string;
    readonly observedAtSlot: string;
    readonly ageMs: number;
    readonly maximumAgeMs: number;
    readonly stale: boolean;
    readonly refreshHealthy: boolean;
    readonly readReady: boolean;
    readonly tradeReady: boolean;
    readonly lastAttemptAt: string | null;
    readonly lastErrorCode: string | null;
  };

  readonly protocol: CurrentProtocolIdentityDto;
}

export interface ApiSuccess<TData extends CurrentResponseData = CurrentResponseData> {
  readonly ok: true;
  readonly data: TData;
}

export interface MarketSummary {
  readonly marketId: string;
  readonly name: string;
  readonly displayName: string;
  readonly symbol: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: "current" | "paused";
  readonly onChainAvailable: true;
  readonly expiries: readonly CurrentMarketExpiry[];
}

export interface CurrentMarketExpiry {
  /** Full trimmed on-chain series label: PRODUCT-MATURITY-SIDE-NN. */
  readonly expiryId: string;
  readonly label: string;
  readonly optionKind: OptionSpreadKind;
  readonly lowerStrike: string;
  readonly upperStrike: string;
  readonly priceDisplayDecimals: number;
  readonly quoteDisplayDecimals: number;
  readonly fairPrice: string | number | null;
  readonly settlementUtc: string | null;
  readonly poolStatus: string;
}

export interface MarketsData extends CurrentResponseData {
  readonly markets: readonly MarketSummary[];
}

export type MarketsResponse = ApiSuccess<MarketsData>;

export interface MarketSnapshot extends CurrentResponseData, MarketSummary {
  readonly observedAtSlot: string;
}

export type MarketSnapshotResponse = ApiSuccess<MarketSnapshot>;

export interface ChartData extends CurrentResponseData {
  readonly points: readonly CurrentChartPoint[];
}

export interface CurrentChartPoint {
  readonly schemaVersion: 1;
  readonly marketId: string;
  readonly expiryId: null;
  readonly expiryLabel: null;
  readonly settlementUtc: null;
  readonly timestampMs: string;
  readonly asOf: string;
  readonly fairPriceMicros: string;
  readonly oraclePriceMicros: string;
  readonly liquidityQuoteAtomic: string;
  readonly notionalQuoteAtomic: string;
}

export type ChartResponse = ApiSuccess<ChartData>;

export interface ChainIdentity extends CurrentResponseData {
  readonly identity: CurrentChainIdentityDto;
}

export type ChainIdentityResponse = ApiSuccess<ChainIdentity>;

export interface ProgramRegistryData extends CurrentResponseData {
  readonly programs: readonly CurrentProtocolIdentityDto[];
}

export type ProgramRegistryResponse = ApiSuccess<ProgramRegistryData>;

export interface CurrentHttpApprovedInstructionAccount {
  readonly address: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface CurrentHttpApprovedInstruction {
  readonly programId: CurrentProtocolIdentityDto["programId"];
  readonly accounts: readonly CurrentHttpApprovedInstructionAccount[];
  readonly dataBase64: string;
}

export interface CurrentPreparedTransaction {
  readonly serializedTransactionBase64: string;
  readonly recentBlockhash: string;
  readonly backendPartialSignatures: readonly string[];
  readonly approvedInstructions: readonly CurrentHttpApprovedInstruction[];
}

export interface CurrentTransactionSubmission {
  readonly signature: string;
}

export interface CurrentTransactionPendingConfirmation {
  readonly status: "pending" | "failed";
  readonly reason:
    | "signature_not_found"
    | "transaction_failed"
    | "not_confirmed"
    | "transaction_not_available";
}

export interface CurrentTransactionConfirmedConfirmation {
  readonly status: "confirmed";
  readonly confirmationStatus: "confirmed" | "finalized";
  readonly confirmedSlot: string;
  readonly confirmedTransactionSha256: string;
  readonly messageSha256: string;
  readonly blockTime: string | null;
}

export type CurrentTransactionConfirmation =
  | CurrentTransactionPendingConfirmation
  | CurrentTransactionConfirmedConfirmation;

export interface CurrentCollectiveOperationSubmitData extends CurrentResponseData {
  readonly operationId: string;
  readonly preparedPlanDigest: string;
  readonly batchIndex: number;
  readonly batchCount: number;
  readonly submission: CurrentTransactionSubmission;
  readonly confirmation: CurrentTransactionConfirmation;
}

export type CurrentCollectiveOperationSubmitResponse =
  ApiSuccess<CurrentCollectiveOperationSubmitData>;

export interface CurrentCollectiveOperationBatchStatus {
  readonly batchIndex: number;
  readonly signature: string;
  readonly transactionSha256: string;
  readonly messageSha256: string;
  readonly status: "submitted" | "pending" | "confirmed" | "failed";
  readonly confirmation: CurrentTransactionConfirmation | null;
}

export interface CurrentCollectiveOperationStatusData extends CurrentResponseData {
  readonly operationId: string;
  readonly preparedPlanDigest: string;
  readonly operation: CurrentCollectiveOperationKind;
  readonly status: "prepared" | "submitted" | "pending" | "confirmed" | "failed";
  readonly nextBatchIndex: number;
  readonly batchCount: number;
  readonly submissions: readonly CurrentCollectiveOperationBatchStatus[];
  readonly lastError: string | null;
}

export type CurrentCollectiveOperationStatusResponse =
  ApiSuccess<CurrentCollectiveOperationStatusData>;

export interface LedgerData extends CurrentResponseData {
  readonly ledger: CurrentUserLedger;
}

export interface CurrentUserLedger {
  readonly stateNamespace: "ameba-spread-v2";
  readonly ownerPubkey: string;
  readonly summaries: readonly CurrentUserLedgerSummary[];
  readonly events: readonly [];
}

export interface CurrentUserLedgerSummary {
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

export type LedgerResponse = ApiSuccess<LedgerData>;

export interface OracleCurrentState {
  readonly status: "empty" | "current";
  readonly markets: readonly OracleCurrentFact[];
  readonly months: readonly OracleCurrentFact[];
  readonly latest: OracleCurrentFact | null;
  readonly history: readonly OracleCurrentFact[];
}

export interface OracleCurrentFact {
  readonly marketId: string;
  readonly expiryId: string;
  readonly onChainAvailable: true;
  readonly oracleMonthAvailable: boolean;
  readonly lastUpdatedSlot: string | null;
  readonly settlementStatus: JsonPrimitive;
}

export interface OracleStateData extends CurrentResponseData {
  readonly state: OracleCurrentState;
  readonly markets: readonly OracleCurrentFact[];
}

export type OracleStateResponse = ApiSuccess<OracleStateData>;

export interface OracleMarketsData extends CurrentResponseData {
  readonly markets: readonly OracleCurrentFact[];
}

export type OracleMarketsResponse = ApiSuccess<OracleMarketsData>;

export interface OracleLatestData extends CurrentResponseData {
  readonly latest: OracleCurrentFact | null;
}

export type OracleLatestResponse = ApiSuccess<OracleLatestData>;

export interface OracleHistoryData extends CurrentResponseData {
  readonly history: readonly OracleCurrentFact[];
}

export type OracleHistoryResponse = ApiSuccess<OracleHistoryData>;

export interface OracleMarketData extends CurrentResponseData {
  readonly market: MarketSummary;
  readonly months: readonly OracleCurrentFact[];
  readonly latest: OracleCurrentFact | null;
  readonly history: readonly OracleCurrentFact[];
}

export type OracleMarketResponse = ApiSuccess<OracleMarketData>;

export type OracleDraftPrepareRequest = CurrentOracleActionRequest;

export interface OracleDraftDeploymentIdentity {
  readonly schemaVersion: 2;
  readonly sourceCommit: CurrentProtocolIdentityDto["releaseCommit"];
  readonly release: CurrentProtocolIdentityDto["releaseTag"];
  readonly cluster: CurrentProtocolIdentityDto["cluster"];
  /** Historical receipt metadata only; not a runtime RPC selector. */
  readonly rpcUrl: typeof CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL;
  readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  readonly programId: CurrentProtocolIdentityDto["programId"];
  readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
  readonly programDataBytes: 1241821;
  readonly upgradeAuthority: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
  readonly deployedSlot: 487702729;
  readonly programPayloadBytes: 1142664;
  readonly programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
  readonly namespace: CurrentProtocolIdentityDto["namespace"];
  readonly liquidityEngine: "in_program_ameba_dlmm";
  readonly contractMintModel: "classic_spl_with_light_interface";
  readonly stateTransport: "light_hot_compressed_cold";
}

export interface OracleDraftInstructionAccountMeta {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export type OracleDraftDecodedInstructionParams =
  | { readonly instructionName: "SetComputeUnitLimit"; readonly tag: 2; readonly oracleActionType?: never; readonly logicalInstructionName?: never; readonly logicalTag?: never }
  | { readonly instructionName: "CreateAssociatedTokenAccountIdempotent"; readonly tag: 1; readonly oracleActionType?: never; readonly logicalInstructionName?: never; readonly logicalTag?: never }
  | {
      readonly instructionName: string;
      readonly tag: CurrentOracleLogicalInstructionTag;
      readonly oracleActionType: CurrentOracleActionRequest["actionType"];
      readonly logicalInstructionName?: never;
      readonly logicalTag?: never;
    }
  | {
      readonly instructionName: "ExecuteCompressedStateV1";
      readonly tag: 205;
      readonly oracleActionType: CurrentOracleActionRequest["actionType"];
      readonly logicalInstructionName: string;
      readonly logicalTag: CurrentOracleLogicalInstructionTag;
    };

export interface OracleDraftInstructionManifest {
  readonly programId: CurrentProtocolIdentityDto["programId"];
  readonly dataBase64: string;
  readonly accounts: readonly OracleDraftInstructionAccountMeta[];
  readonly decodedParams: OracleDraftDecodedInstructionParams;
}

export interface OracleDraftProofFacts {
  /** Exact finalized raw account frame for staking actions, committed to the plan. */
  readonly stakingEvidenceJson?: string;
  /** Required together with stakingEvidenceJson for every staking action. */
  readonly expectedAmbaAmountAtomic?: string;
  readonly expectedSambaAmountAtomic?: string;
  readonly earliestExecutionTs?: string;
  readonly disputeEvidenceJson?: string;
  readonly actionType: CurrentOracleActionRequest["actionType"];
  readonly marketId: CurrentOracleActionRequest["marketId"];
  readonly expiryId: string;
  readonly ownerPubkey: string;
  readonly marketAddress: string;
  readonly oracleMonth: string | null;
  readonly logicalTag: CurrentOracleLogicalInstructionTag;
  readonly transportTag: CurrentOracleTransportInstructionTag;
  readonly logicalInstructionSha256: string;
  readonly outerInstructionSha256: string;
  readonly witnessDigest: string | null;
  readonly providerOriginSha256: string | null;
  readonly proofContextSlot: string | null;
  readonly stateFinalizedSlot: string | null;
  readonly lookupTableAddress: string | null;
  readonly lookupTableAddressesSha256: string | null;
  readonly lookupTableAccountDataSha256: string | null;
  readonly lookupTableObservedFinalizedSlot: string | null;
  readonly lookupTableWritableIndexes: string | null;
  readonly lookupTableReadonlyIndexes: string | null;
  readonly serializedByteLength: number;
  readonly noLookupTableSerializedByteLength: number;
  readonly theoreticalAltMinimizedByteLength: number;
  readonly plannerFactsSha256: string;
  readonly recentBlockhash: string;
}

export interface OracleDraftPlanIdentity {
  readonly marketId: CurrentOracleActionRequest["marketId"];
  readonly expiryId: string;
  readonly ownerPubkey: string;
  readonly market: string;
  readonly oracleMonth: string;
  readonly vaultConfig: string;
}

export interface OracleDraftPreparedPlan {
  readonly stateNamespace: CurrentProtocolIdentityDto["namespace"];
  readonly deployment: OracleDraftDeploymentIdentity;
  readonly operation: "oracle_draft";
  readonly operationId: string;
  readonly instructions: readonly [OracleDraftInstructionManifest];
  readonly setupInstructionBatches: readonly [];
  readonly proofFacts: OracleDraftProofFacts;
  readonly actionType: CurrentOracleActionRequest["actionType"];
  readonly request: CurrentOracleRedactedRequest;
  readonly oracle: OracleDraftPlanIdentity;
  readonly currentInstructionTags: readonly [CurrentOracleLogicalInstructionTag];
  readonly transportInstructionTags: readonly [CurrentOracleTransportInstructionTag];
  readonly transportInstructionName: string;
  readonly logicalInstruction: OracleDraftInstructionManifest;
  readonly outerInstruction: OracleDraftInstructionManifest;
  readonly compressedTransport: CurrentPhotonCompressedInstructionWitness | null;
  readonly transactionLookupTable: CurrentOracleLookupTableWitness | null;
  readonly transportMetrics: CurrentOracleTransportMetrics;
  readonly setupTransactions: readonly [];
  readonly transaction: CurrentPreparedTransaction;
  readonly preparedPlanDigest: string;
}

export interface OracleDraftPrepareData extends CurrentResponseData {
  readonly draft: OracleDraftPreparedPlan;
}

export type OracleDraftPrepareResponse = ApiSuccess<OracleDraftPrepareData>;

/** Exact public writer funds semantics; owner is the explicit transaction actor. */
export interface CurrentWriterRefundPrepareRequest {
  readonly owner: string;
  readonly auction: string;
  readonly bid: string;
}
export interface CurrentWriterWithdrawalPrepareRequest {
  readonly owner: string;
  readonly sleeve: string;
  readonly amountAtoms: string;
}
/** Retains the unmodified envelope required by the independent wallet validator. */
export interface CurrentWriterFundsPrepareResponse {
  readonly operationPlan: import("./protocol/writer-operation.js").WriterOperationPlan;
  readonly leanAdmission: Readonly<Record<string, unknown>>;
  readonly leanAdmissionDigest: string;
}

/** Historical classic bid candidates; independent finalized admission still governs preparation. */
export interface CurrentWriterRefundsRequest {
  readonly owner: string;
  readonly cursor?: string;
  readonly limit?: number;
}
export interface CurrentWriterRefundRow {
  readonly owner: string; readonly auction: string | null; readonly bid: string;
  readonly sleeve: string | null; readonly refundTokenAccount: string | null;
  readonly remainingRefundAtoms: string | null; readonly refundableNow: boolean;
  readonly status: "refundable" | "blocked" | "unavailable";
  readonly reasonCode: string | null; readonly observedSlot: string | null;
  readonly evidenceDigest: string | null;
}
export interface CurrentWriterRefundsData extends CurrentResponseData {
  readonly schema: "writer-auction-refunds-v1";
  readonly owner: string; readonly discoverySlot: string;
  readonly inventoryScope: "owner_classic_bid_accounts_at_discovery_slot";
  readonly rows: readonly CurrentWriterRefundRow[];
  readonly nextCursor: string | null;
}

export type CurrentWriterRefundsResponse = ApiSuccess<CurrentWriterRefundsData>;

export interface CurrentWriterLiquidityReadRequest {
  readonly owner: string; readonly sleeve: string; readonly seriesIndex: number;
}
/** One finalized frame. Cash permissions remain the responsibility of native admission. */
export interface CurrentWriterLiquidityData extends CurrentResponseData {
  readonly schema: "writer-liquidity-v1";
  readonly owner: string; readonly sleeve: string; readonly seriesIndex: number;
  readonly market: string; readonly pool: string; readonly policyAddress: string; readonly positionAddress: string;
  readonly policyAuthority: string; readonly managementAuthority: string | null;
  readonly actorCanManage: boolean; readonly policyLifecycle: "uncreated" | "building" | "sealed";
  readonly positionInitialized: boolean; readonly reasonCode: string | null;
  readonly accounting: {
    readonly assetsAtoms: string; readonly principalAtoms: string; readonly grossPrimaryPremiumAtoms: string;
    readonly reserveAtoms: string; readonly operationalBufferAtoms: string;
    readonly freeCashAtoms: string | null; readonly sleeveCashAtoms: string | null;
    readonly writerPoolQuoteAtoms: string | null; readonly writerUncommittedQuoteAtoms: string | null;
    readonly physicalSupplyAtoms: string; readonly issuerControlledAtoms: string; readonly externalOpenInterestAtoms: string;
    readonly positionOptionAtoms: string | null; readonly positionQuoteAtoms: string | null;
    readonly positionUncommittedQuoteAtoms: string | null;
  };
  readonly budget: null | {
    readonly monthStartUnixSeconds: string;
    readonly monthlyCapAtoms: string; readonly monthlySpentAtoms: string; readonly monthlyRemainingAtoms: string;
    readonly seriesMonthlyCapAtoms: string; readonly seriesMonthlySpentAtoms: string; readonly seriesMonthlyRemainingAtoms: string;
    readonly transactionCapAtoms: string; readonly seriesTransactionCapAtoms: string;
    readonly reserveReleaseSpendRatioPpm: string; readonly conservativeClaimValueAtoms: string;
    readonly sellerFloorQuoteAtoms: string; readonly priceSeparationTicks: number;
  };
  readonly bins: readonly { readonly binId: number; readonly optionAtoms: string; readonly quoteAtoms: string }[];
  readonly observedSlot: string; readonly evidenceDigest: string;
}
export type CurrentWriterLiquidityResponse = ApiSuccess<CurrentWriterLiquidityData>;

export type { CurrentWriterLiquidityIdentity, CurrentWriterLiquidityRequest, CurrentWriterLiquidityOperation, CurrentWriterLiquidityInitializeRequest, CurrentWriterLiquiditySweepRequest, CurrentWriterLiquidityAddRequest, CurrentWriterLiquidityRemoveRequest } from "./protocol/writer-dlmm-public.js";

export type { CurrentWriterDlmmOperation, CurrentWriterDlmmRequest, CurrentWriterDlmmPolicyOperation, CurrentWriterDlmmPolicyRequest, CurrentWriterLiquidityPolicyBeginRequest, CurrentWriterLiquidityPolicyAppendRequest, CurrentWriterLiquidityPolicySealRequest, CurrentWriterLiquidityPolicySeries } from "./protocol/writer-dlmm-public.js";
