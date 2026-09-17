type CurrentOracleRequestProduct = "ramx" | "nandx";
interface CurrentOracleRequestCommon {
    readonly marketId: CurrentOracleRequestProduct;
    readonly expiryId: string;
    readonly ownerPubkey: string;
}
type CurrentOracleRequestSourceEmergencyChoice = "keep_source" | "reject_source" | "merge_source";
type CurrentOracleRequestUpdateEmergencyChoice = "accept_claim" | "accept_alternative_state" | "reject_update";
type CurrentOracleRequestOpeningEmergencyChoice = "keep_opening" | "accept_alternative_opening" | "source_inactive_for_month";
/** Exact browser-safe semantic request union for the fifteen current Oracle actions. */
export type CurrentOracleActionRequest = (CurrentOracleRequestCommon & {
    readonly actionType: "queue_stake_amba_for_samba";
    readonly ambaAmountAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "activate_queued_stake_amba_for_samba";
    readonly minSambaOutAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "request_unstake_samba";
    readonly sambaAmountAtomic: string;
    readonly minAmbaOutAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "complete_unstake_samba";
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "initialize_oracle_month_v5";
    readonly scrambleStartTs: string;
    readonly listingTs: string;
    readonly settlementBaseOracleAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "propose_oracle_source_v3";
    readonly skuId: string;
    readonly sourceId: string;
    readonly bucketId: string;
    readonly sourceType: string;
    readonly canonicalLocator: string;
    readonly sourceDefinition: string;
    readonly listingBondAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "support_oracle_source_v3";
    readonly skuId: string;
    readonly sourceId: string;
    readonly stakeAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "challenge_oracle_source_v2";
    readonly sourceId: string;
    readonly challengeId: string;
    readonly reasonCode: number;
    readonly bondAtomic: string;
    readonly evidenceHashHex: string;
    readonly comparisonSourceId?: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "submit_oracle_opening_claim_v2";
    readonly sourceId: string;
    readonly openingStateAtomic: string;
    readonly sourceTimeUnix: string;
    readonly stakeAtomic: string;
    readonly archiveUrl: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "challenge_oracle_opening_claim_v2";
    readonly sourceId: string;
    readonly challengeId: string;
    readonly alternativeOpeningStateAtomic: string;
    readonly alternativeSourceTimeUnix: string;
    readonly bondAtomic: string;
    readonly archiveUrl: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "finalize_oracle_opening_claim_v2";
    readonly sourceId: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "commit_oracle_update_claim_v3";
    readonly sourceId: string;
    readonly claimId: string;
    readonly priorStateAtomic: string;
    readonly newStateAtomic: string;
    readonly sourceTimeUnix: string;
    readonly evidenceHashHex: string;
    readonly archiveUrl: string;
    readonly secretSaltHex: string;
    readonly stakeAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "reveal_oracle_update_claim_v3";
    readonly sourceId: string;
    readonly claimId: string;
    readonly priorStateAtomic: string;
    readonly newStateAtomic: string;
    readonly sourceTimeUnix: string;
    readonly evidenceHashHex: string;
    readonly archiveUrl: string;
    readonly secretSaltHex: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "challenge_oracle_update_claim_v2";
    readonly sourceId: string;
    readonly claimantPubkey: string;
    readonly claimId: string;
    readonly challengeId: string;
    readonly alternativeStateAtomic: string;
    readonly alternativeSourceTimeUnix: string;
    readonly bondAtomic: string;
    readonly evidenceHashHex: string;
    readonly archiveUrl: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "finalize_oracle_update_claim_v2";
    readonly sourceId: string;
    readonly claimantPubkey: string;
    readonly claimId: string;
    readonly challengeId?: string;
    readonly outcome: "accept_claim" | "reject_claim" | "rule_review_unresolved";
    readonly currentStep: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "commit_oracle_emergency_vote_v3";
    readonly disputeId: string;
    readonly disputeKind: "source";
    readonly choice: CurrentOracleRequestSourceEmergencyChoice;
    readonly secretSaltHex: string;
    readonly sambaAmountAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "commit_oracle_emergency_vote_v3";
    readonly disputeId: string;
    readonly disputeKind: "update";
    readonly choice: CurrentOracleRequestUpdateEmergencyChoice;
    readonly secretSaltHex: string;
    readonly sambaAmountAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "commit_oracle_emergency_vote_v3";
    readonly disputeId: string;
    readonly disputeKind: "opening";
    readonly choice: CurrentOracleRequestOpeningEmergencyChoice;
    readonly secretSaltHex: string;
    readonly sambaAmountAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "reveal_oracle_emergency_vote_v2";
    readonly disputeId: string;
    readonly disputeKind: "source";
    readonly choice: CurrentOracleRequestSourceEmergencyChoice;
    readonly secretSaltHex: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "reveal_oracle_emergency_vote_v2";
    readonly disputeId: string;
    readonly disputeKind: "update";
    readonly choice: CurrentOracleRequestUpdateEmergencyChoice;
    readonly secretSaltHex: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "reveal_oracle_emergency_vote_v2";
    readonly disputeId: string;
    readonly disputeKind: "opening";
    readonly choice: CurrentOracleRequestOpeningEmergencyChoice;
    readonly secretSaltHex: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "deposit_oracle_usdc_rewards";
    readonly amountAtomic: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "claim_oracle_usdc_reward";
    readonly rewardKind: "proposer" | "support" | "opening";
    readonly sourceId: string;
}) | (CurrentOracleRequestCommon & {
    readonly actionType: "claim_oracle_usdc_reward";
    readonly rewardKind: "update";
    readonly sourceId: string;
    readonly claimId: string;
});
type RedactCurrentOracleRequestSecret<T> = T extends {
    readonly secretSaltHex: string;
} ? Omit<T, "secretSaltHex"> : T;
/** Canonical public plan echo with every secret salt removed. */
export type CurrentOracleRedactedRequest = RedactCurrentOracleRequestSecret<CurrentOracleActionRequest>;
/** Current semantic source hashing is NFC + trim + control rejection + bounded UTF-8. */
export declare const CURRENT_ORACLE_SOURCE_TYPE_HASH_DOMAIN: "ameba-oracle-source-type-v1";
export declare const CURRENT_ORACLE_SOURCE_DEFINITION_HASH_DOMAIN: "ameba-oracle-source-definition-v1";
export declare const CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES: 128;
export declare const CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES: 4096;
/** Reviewed known-answer vectors for the current semantic source hashing grammar. */
export declare const CURRENT_ORACLE_SEMANTIC_HASH_VECTORS: Readonly<{
    readonly sourceType: Readonly<{
        input: " retail-index ";
        normalized: "retail-index";
        sha256Hex: "1dd8023882a982d42fcebfabe7f2b1aaeb16f866565193dc41435d603ebc5c1e";
    }>;
    readonly sourceDefinition: Readonly<{
        input: " Café weighted basket ";
        normalized: "Café weighted basket";
        sha256Hex: "77a4930c70595499a95d14b056c034cb67e74d57a163d370fff90b19307a6881";
    }>;
}>;
export declare const CURRENT_ORACLE_LOCATOR_MAX_BYTES: 2048;
export declare const CURRENT_ORACLE_ACTION_TYPES: readonly ["initialize_oracle_month_v5", "propose_oracle_source_v3", "support_oracle_source_v3", "challenge_oracle_source_v2", "submit_oracle_opening_claim_v2", "challenge_oracle_opening_claim_v2", "finalize_oracle_opening_claim_v2", "commit_oracle_update_claim_v3", "reveal_oracle_update_claim_v3", "challenge_oracle_update_claim_v2", "finalize_oracle_update_claim_v2", "deposit_oracle_usdc_rewards", "claim_oracle_usdc_reward"];
export type CurrentOracleActionType = CurrentOracleActionRequest["actionType"];
export type CurrentOracleProduct = CurrentOracleActionRequest["marketId"];
export type CurrentOracleAction<T extends CurrentOracleActionType> = Extract<CurrentOracleActionRequest, {
    readonly actionType: T;
}>;
export type CurrentOracleEmergencyDisputeKind = CurrentOracleAction<"commit_oracle_emergency_vote_v3">["disputeKind"];
export type CurrentOracleSourceEmergencyChoice = Extract<CurrentOracleAction<"commit_oracle_emergency_vote_v3">, {
    readonly disputeKind: "source";
}>["choice"];
export type CurrentOracleUpdateEmergencyChoice = Extract<CurrentOracleAction<"commit_oracle_emergency_vote_v3">, {
    readonly disputeKind: "update";
}>["choice"];
export type CurrentOracleOpeningEmergencyChoice = Extract<CurrentOracleAction<"commit_oracle_emergency_vote_v3">, {
    readonly disputeKind: "opening";
}>["choice"];
export type CurrentOracleEmergencyChoice = CurrentOracleSourceEmergencyChoice | CurrentOracleUpdateEmergencyChoice | CurrentOracleOpeningEmergencyChoice;
export type CurrentOracleUpdateFinalizationOutcome = CurrentOracleAction<"finalize_oracle_update_claim_v2">["outcome"];
export type CurrentOracleRewardKind = CurrentOracleAction<"claim_oracle_usdc_reward">["rewardKind"];
export declare function normalizeCurrentOracleSemanticText(value: unknown, label: string, maxBytes: number): string;
/** Browser-safe exact normalizer for the 15 current public Oracle actions. */
export declare function validateCurrentOracleActionRequest(request: unknown): CurrentOracleActionRequest;
export declare function redactCurrentOracleActionRequest(request: unknown): CurrentOracleRedactedRequest;
export declare function currentOracleEmergencyChoiceIndex(kind: CurrentOracleEmergencyDisputeKind, choice: CurrentOracleEmergencyChoice): 0 | 1 | 2;
export {};
//# sourceMappingURL=current-oracle-public.d.ts.map