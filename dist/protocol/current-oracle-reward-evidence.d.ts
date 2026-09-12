import { PublicKey, type Connection } from "@solana/web3.js";
import { type CurrentOraclePlannerContext, type CurrentOracleRewardRequest } from "./current-oracle-planner.js";
import type { CurrentPhotonConnection } from "./current-photon.js";
import type { CurrentPhotonNativeVerificationEvidence, CurrentPhotonVerifiedCompressedStateEvidence } from "./current-photon-verified.js";
export interface CurrentOracleClassicEvidenceAccount {
    readonly address: string;
    readonly owner: string | null;
    readonly executable: boolean | null;
    readonly dataBase64: string | null;
    readonly dataSha256: string | null;
    readonly observedSlot: number;
}
/** Omitted snapshots are provenance only: reconstruct fresh accounts before independent verification. */
export type CurrentOracleRewardCompressedStateEvidence = Omit<CurrentPhotonVerifiedCompressedStateEvidence, "verificationEvidence"> & {
    readonly verificationEvidence: CurrentPhotonNativeVerificationEvidence | (Omit<CurrentPhotonNativeVerificationEvidence, "request"> & {
        readonly request: Omit<CurrentPhotonNativeVerificationEvidence["request"], "accounts">;
        readonly nativeAccountSnapshotsIncluded: false;
    });
};
export interface CurrentOracleCompactEvidenceAccount {
    readonly canonicalPda: string;
    readonly domain: number;
    readonly dataBase64: string;
    readonly evidence: CurrentOracleRewardCompressedStateEvidence;
}
export interface CurrentOracleRewardReceiptEvidence {
    readonly address: string;
    readonly subject: string;
    readonly kind: CurrentOracleRewardRequest["rewardKind"];
    readonly exists: boolean;
    readonly amountAtomic: string | null;
    readonly claimedSlot: string | null;
    readonly membership: CurrentOracleCompactEvidenceAccount | null;
    readonly nonmembership: CurrentOracleRewardCompressedStateEvidence | null;
}
export interface CurrentOracleOwnerRewardEvidence {
    readonly evidenceTrust: "finalized_native_light_verifier";
    readonly finalizedStateVerified: boolean;
    readonly request: CurrentOracleRewardRequest;
    readonly status: "claimable" | "already_claimed" | "ineligible" | "unavailable";
    /** Cross-check only. Lean independently decodes the raw authenticated inputs. */
    readonly entitlementAmountAtomic: string | null;
    readonly readWindowStartSlot: number;
    readonly readWindowEndSlot: number;
    readonly classicAccounts: readonly CurrentOracleClassicEvidenceAccount[];
    readonly compressedAccounts: readonly CurrentOracleCompactEvidenceAccount[];
    readonly nonmembershipAccounts: readonly CurrentOracleRewardCompressedStateEvidence[];
    readonly receipt: CurrentOracleRewardReceiptEvidence | null;
    readonly proofFacts: Readonly<Record<string, string | number | boolean | null>>;
    readonly errorCode?: string;
}
/** Fetches entitlement inputs and a real receipt membership/nonmembership proof for one exact owner/subject. */
export declare function readCurrentOracleOwnerRewardEvidence(input: CurrentOraclePlannerContext & {
    readonly request: CurrentOracleRewardRequest;
    readonly minimumContextSlot?: number;
    readonly includeNativeAccountSnapshots?: boolean;
}): Promise<CurrentOracleOwnerRewardEvidence>;
/** Adds retained merge origins and owner update-claim identities to the caller's authenticated source inventory. */
export declare function readCurrentOracleOwnerRewardInventory(input: CurrentOraclePlannerContext & {
    readonly ownerPubkey: string;
    readonly marketId: "ramx" | "nandx";
    readonly expiryId: string;
    readonly sourceIds: readonly string[];
    readonly minimumContextSlot?: number;
    readonly cursor?: number;
    readonly limit?: number;
    readonly includeNativeAccountSnapshots?: boolean;
}): Promise<Readonly<{
    ownerPubkey: string;
    candidateCount: number;
    cursor: number;
    limit: number;
    nextCursor: number | null;
    candidates: readonly CurrentOracleRewardRequest[];
    evidence: readonly CurrentOracleOwnerRewardEvidence[];
    classicAccounts: readonly CurrentOracleClassicEvidenceAccount[];
    coverage: Readonly<{
        sourceInventory: "caller_supplied";
        suppliedSourceIds: readonly string[];
        expandedSourceIds: readonly string[];
        updateQuery: {
            programId: string;
            dataSize: number;
            monthOffset: number;
            ownerOffset: number;
            contextSlot: number;
            addresses: string[];
        };
        retainedMergeQuery: {
            programId: string;
            dataSize: number;
            monthOffset: number;
            contextSlot: number;
            addresses: string[];
        };
        globalInventoryComplete: false;
    }>;
}>>;
export interface ReadCurrentOracleOwnerBountyInventoryInput {
    readonly connection: Connection;
    readonly programId: PublicKey;
    readonly namespace: "ameba-spread-v2";
    readonly photonConnection: CurrentPhotonConnection;
    readonly marketId: "ramx" | "nandx";
    readonly expiryId: string;
    readonly ownerPubkey: string;
    readonly sourceIds: readonly string[];
    readonly minimumContextSlot?: number;
    readonly cursor?: number;
    readonly limit?: number;
    /** False drops native tree/queue snapshots immediately after verification; full leaf/proof and provenance remain. Default true. */
    readonly includeNativeAccountSnapshots?: boolean;
}
/** Server facade: derives canonical anchors from the exact requested market before owner discovery. */
export declare function readCurrentOracleOwnerBountyInventory(input: ReadCurrentOracleOwnerBountyInventoryInput): Promise<Readonly<{
    marketAddress: string;
    oracleMonthAddress: string;
    anchorAccounts: readonly CurrentOracleClassicEvidenceAccount[];
    ownerPubkey: string;
    candidateCount: number;
    cursor: number;
    limit: number;
    nextCursor: number | null;
    candidates: readonly CurrentOracleRewardRequest[];
    evidence: readonly CurrentOracleOwnerRewardEvidence[];
    classicAccounts: readonly CurrentOracleClassicEvidenceAccount[];
    coverage: Readonly<{
        sourceInventory: "caller_supplied";
        suppliedSourceIds: readonly string[];
        expandedSourceIds: readonly string[];
        updateQuery: {
            programId: string;
            dataSize: number;
            monthOffset: number;
            ownerOffset: number;
            contextSlot: number;
            addresses: string[];
        };
        retainedMergeQuery: {
            programId: string;
            dataSize: number;
            monthOffset: number;
            contextSlot: number;
            addresses: string[];
        };
        globalInventoryComplete: false;
    }>;
}>>;
//# sourceMappingURL=current-oracle-reward-evidence.d.ts.map