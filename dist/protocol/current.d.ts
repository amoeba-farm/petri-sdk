import { Buffer } from "buffer";
import { PublicKey, type Commitment, type Connection } from "@solana/web3.js";
/** Historical RC44 reader-semantic source. It is not the live byte source. */
export declare const CURRENT_PROTOCOL_SOURCE_COMMIT: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
export declare const CURRENT_PROTOCOL_RELEASE: "v0.1.0-rc.44";
export declare const CURRENT_PROTOCOL_CLUSTER: "devnet";
export declare const CURRENT_PROTOCOL_DEVNET_GENESIS_HASH: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export declare const CURRENT_PROTOCOL_SCHEMA_VERSION: 2;
export declare const CURRENT_PROTOCOL_PROGRAMDATA_ADDRESS: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
export declare const CURRENT_PROTOCOL_PROGRAMDATA_BYTES: 1241821;
export declare const CURRENT_PROTOCOL_UPGRADE_AUTHORITY: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
export declare const CURRENT_PROTOCOL_DEPLOYED_SLOT: 487702729;
export declare const CURRENT_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT: 487703026;
export declare const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES: 1142664;
export declare const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
export declare const CURRENT_PROTOCOL_BUILD_RECEIPT_SHA256: "3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322";
export declare const CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE: "24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65";
export declare const CURRENT_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256: "c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31";
export declare const CURRENT_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256: "8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94";
export declare const CURRENT_MARKET_ACCOUNT_SIZE: 285;
export declare const CURRENT_ORACLE_MONTH_ACCOUNT_SIZE: 299;
export declare const CURRENT_VAULT_CONFIG_ACCOUNT_SIZE: 135;
export declare const CURRENT_USER_COLLATERAL_ACCOUNT_SIZE: 58;
export declare const CURRENT_SETTLEMENT_RECORD_V2_ACCOUNT_SIZE: 160;
export declare const CURRENT_SETTLEMENT_SIGNER_REGISTRY_ACCOUNT_SIZE: 128;
export declare const CURRENT_SETTLEMENT_SIGNER_SET_ACCOUNT_SIZE: 416;
export declare const CURRENT_ORACLE_SKU_COVERAGE_MANIFEST_ACCOUNT_SIZE: 128;
export declare const CURRENT_ORACLE_ACTIVE_WEIGHT_MANIFEST_ACCOUNT_SIZE: 337;
/** rc.44 production schedule: seven scramble days plus one opening day. */
export declare const CURRENT_ORACLE_PRE_LISTING_WINDOW_SECONDS: bigint;
export interface CurrentProgramAccountInput {
    readonly address: PublicKey;
    readonly data: Uint8Array;
    readonly owner: PublicKey;
    readonly executable: boolean;
    readonly namespace: "ameba-spread-v2";
    readonly programId: PublicKey;
}
/**
 * Historical RC44 identity retained for decoder and fixture compatibility.
 * Current live bytes are exposed separately as CURRENT_LIVE_DEPLOYMENT.
 * @deprecated Prefer HISTORICAL_RC44_PROTOCOL_DEPLOYMENT for explicit legacy
 * semantics or CURRENT_LIVE_DEPLOYMENT for finalized live byte identity.
 */
export declare const CURRENT_PROTOCOL_DEPLOYMENT: Readonly<{
    readonly schemaVersion: 2;
    readonly sourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
    readonly release: "v0.1.0-rc.44";
    readonly cluster: "devnet";
    /** Historical receipt metadata only; runtime reads use Amoeba `/rpc`. */
    readonly rpcUrl: "https://api.devnet.solana.com";
    readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
    readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
    readonly programDataBytes: 1241821;
    readonly upgradeAuthority: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
    readonly deployedSlot: 487702729;
    readonly finalizedVerificationContextSlot: 487703026;
    readonly programPayloadBytes: 1142664;
    readonly programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
    readonly buildReceiptSha256: "3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322";
    readonly deploymentReceiptSignature: "24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65";
    readonly formalReceiptInternalSha256: "c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31";
    readonly formalReceiptFileSha256: "8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94";
    readonly namespace: string;
    readonly liquidityEngine: "in_program_ameba_dlmm";
    readonly contractMintModel: "classic_spl_with_light_interface";
    readonly stateTransport: "light_hot_compressed_cold";
}>;
export declare const HISTORICAL_RC44_PROTOCOL_SOURCE_COMMIT: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
export declare const HISTORICAL_RC44_PROTOCOL_RELEASE: "v0.1.0-rc.44";
export declare const HISTORICAL_RC44_PROTOCOL_CLUSTER: "devnet";
export declare const HISTORICAL_RC44_PROTOCOL_DEVNET_GENESIS_HASH: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export declare const HISTORICAL_RC44_PROTOCOL_SCHEMA_VERSION: 2;
export declare const HISTORICAL_RC44_PROTOCOL_PROGRAMDATA_ADDRESS: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
export declare const HISTORICAL_RC44_PROTOCOL_PROGRAMDATA_BYTES: 1241821;
export declare const HISTORICAL_RC44_PROTOCOL_UPGRADE_AUTHORITY: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
export declare const HISTORICAL_RC44_PROTOCOL_DEPLOYED_SLOT: 487702729;
export declare const HISTORICAL_RC44_PROTOCOL_FINALIZED_VERIFICATION_CONTEXT_SLOT: 487703026;
export declare const HISTORICAL_RC44_PROTOCOL_PROGRAM_PAYLOAD_BYTES: 1142664;
export declare const HISTORICAL_RC44_PROTOCOL_PROGRAM_PAYLOAD_SHA256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
export declare const HISTORICAL_RC44_PROTOCOL_BUILD_RECEIPT_SHA256: "3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322";
export declare const HISTORICAL_RC44_PROTOCOL_DEPLOYMENT_RECEIPT_SIGNATURE: "24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65";
export declare const HISTORICAL_RC44_PROTOCOL_FORMAL_RECEIPT_INTERNAL_SHA256: "c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31";
export declare const HISTORICAL_RC44_PROTOCOL_FORMAL_RECEIPT_FILE_SHA256: "8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94";
export declare const HISTORICAL_RC44_PROTOCOL_DEPLOYMENT: Readonly<{
    readonly schemaVersion: 2;
    readonly sourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
    readonly release: "v0.1.0-rc.44";
    readonly cluster: "devnet";
    /** Historical receipt metadata only; runtime reads use Amoeba `/rpc`. */
    readonly rpcUrl: "https://api.devnet.solana.com";
    readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
    readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
    readonly programDataBytes: 1241821;
    readonly upgradeAuthority: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
    readonly deployedSlot: 487702729;
    readonly finalizedVerificationContextSlot: 487703026;
    readonly programPayloadBytes: 1142664;
    readonly programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
    readonly buildReceiptSha256: "3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322";
    readonly deploymentReceiptSignature: "24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65";
    readonly formalReceiptInternalSha256: "c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31";
    readonly formalReceiptFileSha256: "8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94";
    readonly namespace: string;
    readonly liquidityEngine: "in_program_ameba_dlmm";
    readonly contractMintModel: "classic_spl_with_light_interface";
    readonly stateTransport: "light_hot_compressed_cold";
}>;
/** Current Rust dispatch tags, including the governed tag-94 emergency signer recovery lane. */
export { CURRENT_VAULT_INSTRUCTION_TAG, CURRENT_AMOEBA_DLMM_INSTRUCTION_TAG, type VaultInstructionTag, type AmoebaDlmmInstructionTag } from "./current-instruction-tags.js";
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
export interface DecodeCurrentMarketAccountInput extends CurrentProgramAccountInput {
    readonly marketLayout?: "historical-v2" | "g3";
}
export declare function decodeCurrentMarketAccount(input: DecodeCurrentMarketAccountInput): CurrentMarketAccount;
export interface DecodeCurrentOracleMonthAccountInput extends CurrentProgramAccountInput {
    readonly expiryTs: number | bigint;
    /** Selects the exact deployed account generation; omission preserves the historical reader. */
    readonly marketLayout?: "historical-v2" | "g3";
}
/** Internal initialization preflight: exact fixed-codec shape with is_initialized=false. */
export declare function validateUninitializedCurrentOracleMonthData(data: Uint8Array): void;
export declare function decodeCurrentOracleMonthAccount(input: DecodeCurrentOracleMonthAccountInput): CurrentOracleMonthAccount;
export interface DecodeCurrentOracleSkuCoverageManifestAccountInput extends CurrentProgramAccountInput {
    readonly month: PublicKey;
}
/** Internal initialization preflight: exact fixed-codec shape with is_initialized=false. */
export declare function validateUninitializedCurrentOracleSkuCoverageManifestData(data: Uint8Array): void;
export declare function decodeCurrentOracleSkuCoverageManifestAccount(input: DecodeCurrentOracleSkuCoverageManifestAccountInput): CurrentOracleSkuCoverageManifestAccount;
export interface DecodeCurrentOracleActiveWeightManifestAccountInput extends CurrentProgramAccountInput {
    readonly month: PublicKey;
}
export declare function decodeCurrentOracleActiveWeightManifestAccount(input: DecodeCurrentOracleActiveWeightManifestAccountInput): CurrentOracleActiveWeightManifestAccount;
export interface DecodeCurrentVaultConfigAccountInput extends CurrentProgramAccountInput {
}
export declare function decodeCurrentVaultConfigAccount(input: DecodeCurrentVaultConfigAccountInput): CurrentVaultConfigAccount;
export interface DecodeCurrentContractMintAccountInput extends CurrentOwnedAccountContext {
    readonly address: PublicKey;
    readonly data: Uint8Array;
    readonly namespace: "ameba-spread-v2";
    readonly programId: PublicKey;
    readonly marketAddress: PublicKey;
    readonly market: CurrentMarketAccount;
}
/** Decode the exact classic-SPL contract mint policy enforced by rc.44. */
export declare function decodeCurrentContractMintAccount(input: DecodeCurrentContractMintAccountInput): CurrentContractMintAccount;
export interface DecodeCurrentLightSplInterfaceAccountInput extends CurrentOwnedAccountContext {
    readonly address: PublicKey;
    readonly data: Uint8Array;
    readonly namespace: "ameba-spread-v2";
    readonly programId: PublicKey;
    readonly mint: PublicKey;
}
/** Decode the canonical Light SPL interface, which is an exact classic token account. */
export declare function decodeCurrentLightSplInterfaceAccount(input: DecodeCurrentLightSplInterfaceAccountInput): CurrentLightSplInterfaceAccount;
export interface DecodeCurrentUserCollateralAccountInput extends CurrentProgramAccountInput {
    readonly expectedOwner: PublicKey;
}
export declare function decodeCurrentUserCollateralAccount(input: DecodeCurrentUserCollateralAccountInput): CurrentUserCollateralAccount;
export interface DecodeCurrentSettlementRecordV2AccountInput extends CurrentProgramAccountInput {
    readonly expectedMarket?: PublicKey;
    readonly expectedOracleMonth?: PublicKey;
    readonly expectedSettlementTs: bigint;
}
export declare function decodeCurrentSettlementRecordV2Account(input: DecodeCurrentSettlementRecordV2AccountInput): CurrentSettlementRecordV2Account;
export interface DecodeCurrentSettlementSignerRegistryAccountInput extends CurrentProgramAccountInput {
}
export declare function decodeCurrentSettlementSignerRegistryAccount(input: DecodeCurrentSettlementSignerRegistryAccountInput): CurrentSettlementSignerRegistryAccount;
export interface DecodeCurrentSettlementSignerSetAccountInput extends CurrentProgramAccountInput {
}
export declare function decodeCurrentSettlementSignerSetAccount(input: DecodeCurrentSettlementSignerSetAccountInput): CurrentSettlementSignerSetAccount;
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
export declare function discoverCurrentMarkets(connection: Pick<Connection, "getProgramAccounts">, options?: CurrentMarketDiscoveryOptions): Promise<CurrentMarketDiscoveryResult>;
export declare function validateCurrentDeploymentIdentity(input: {
    readonly cluster: string;
    readonly genesisHash: string;
    readonly programId: string;
    readonly namespace: string;
}): void;
export declare function assertCurrentProgramOwner(owner: PublicKey, programId?: PublicKey): void;
//# sourceMappingURL=current.d.ts.map