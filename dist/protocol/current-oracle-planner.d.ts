import { Buffer } from "buffer";
import { PublicKey, type Commitment, type Connection, type TransactionInstruction } from "@solana/web3.js";
import type { CurrentMarketAccount, CurrentOracleMonthAccount, CurrentVaultConfigAccount } from "./current.js";
import type { CurrentPhotonCompressedStateObservation, CurrentPhotonConnection } from "./current-photon.js";
import type { CurrentOracleActionRequest, CurrentOracleRedactedRequest } from "./current-oracle.js";
import { CompressedStateDomain } from "@amoeba/spread-release-tools/compressed-state";
import * as currentOracleInstructionBuilders from "@amoeba/spread-release-tools/oracle-dlmm";
export declare class CurrentOraclePlannerError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
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
    readonly latestObservationSourceTime: bigint;
    readonly rollingObservationHash: Buffer;
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
export interface CurrentOracleCompressedReadObservation {
    readonly canonicalPda: PublicKey;
    readonly compressedAddress: PublicKey;
    readonly leaf: CurrentPhotonCompressedStateObservation["leaf"];
    readonly witness: {
        readonly witnessDigest: string;
    };
    readonly transportObservation?: CurrentPhotonCompressedStateObservation;
}
export declare function readUpdateClaimByIdentity(input: CurrentOraclePlannerContext, sourceAddress: PublicKey, expectedSourceId: Buffer, claimant: PublicKey, claimId: Buffer): Promise<OracleUpdateClaimState>;
export declare function readClassicSourceReward(input: CurrentOraclePlannerContext, sourceAddress: PublicKey): Promise<OracleSourceRewardState>;
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
    readonly compressedEvidenceReader?: (input: {
        readonly canonicalPda: PublicKey;
        readonly domain: CompressedStateDomain;
    }) => Promise<CurrentOracleCompressedReadObservation | null>;
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
export declare function prepareCurrentOracleAction(input: CurrentOraclePlannerContext & {
    readonly request: CurrentOracleActionRequest;
}): Promise<PreparedCurrentOracleAction>;
export type CurrentOracleRewardRequest = Extract<CurrentOracleActionRequest, {
    readonly actionType: "claim_oracle_usdc_reward";
}>;
/** Shared entitlement read: no instruction construction, collateral initialization, signing or submission. */
export declare function readCurrentOracleRewardEntitlementInputs(input: CurrentOraclePlannerContext & {
    readonly request: CurrentOracleRewardRequest;
}): Promise<{
    instructionInput: {
        programId?: currentOracleInstructionBuilders.PublicKeyish;
        params: currentOracleInstructionBuilders.ClaimOracleUsdcRewardParams;
        accounts: currentOracleInstructionBuilders.ClaimOracleUsdcRewardAccounts;
    };
    entitlementAmount: bigint;
    schedule: OracleRewardScheduleState;
    actionFacts: Record<string, string | number | boolean | null>;
}>;
export {};
//# sourceMappingURL=current-oracle-planner.d.ts.map