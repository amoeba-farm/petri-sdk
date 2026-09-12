import { Buffer } from "node:buffer";
import { currentOracleEmergencyChoiceIndex, normalizeCurrentOracleSemanticText, redactCurrentOracleActionRequest, validateCurrentOracleActionRequest } from "./current-oracle-public.js";
export { currentOracleEmergencyChoiceIndex, normalizeCurrentOracleSemanticText, redactCurrentOracleActionRequest, validateCurrentOracleActionRequest, };
type CurrentOracleProduct = "ramx" | "nandx";
interface CurrentOracleActionCommon {
    readonly marketId: CurrentOracleProduct;
    readonly expiryId: string;
    readonly ownerPubkey: string;
}
type CurrentOracleSourceEmergencyChoice = "keep_source" | "reject_source" | "merge_source";
type CurrentOracleUpdateEmergencyChoice = "accept_claim" | "accept_alternative_state" | "reject_update";
type CurrentOracleOpeningEmergencyChoice = "keep_opening" | "accept_alternative_opening" | "source_inactive_for_month";
export type CurrentOracleActionRequest = (CurrentOracleActionCommon & {
    readonly actionType: "queue_stake_amba_for_samba";
    readonly ambaAmountAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "activate_queued_stake_amba_for_samba";
    readonly minSambaOutAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "request_unstake_samba";
    readonly sambaAmountAtomic: string;
    readonly minAmbaOutAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "complete_unstake_samba";
}) | (CurrentOracleActionCommon & {
    readonly actionType: "initialize_oracle_month_v5";
    readonly scrambleStartTs: string;
    readonly listingTs: string;
    readonly settlementBaseOracleAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "propose_oracle_source_v3";
    readonly skuId: string;
    readonly sourceId: string;
    readonly bucketId: string;
    readonly sourceType: string;
    readonly canonicalLocator: string;
    readonly sourceDefinition: string;
    readonly listingBondAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "support_oracle_source_v3";
    readonly skuId: string;
    readonly sourceId: string;
    readonly stakeAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "challenge_oracle_source_v2";
    readonly sourceId: string;
    readonly challengeId: string;
    readonly reasonCode: number;
    readonly bondAtomic: string;
    readonly evidenceHashHex: string;
    readonly comparisonSourceId?: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "submit_oracle_opening_claim_v2";
    readonly sourceId: string;
    readonly openingStateAtomic: string;
    readonly sourceTimeUnix: string;
    readonly stakeAtomic: string;
    readonly archiveUrl: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "challenge_oracle_opening_claim_v2";
    readonly sourceId: string;
    readonly challengeId: string;
    readonly alternativeOpeningStateAtomic: string;
    readonly alternativeSourceTimeUnix: string;
    readonly bondAtomic: string;
    readonly archiveUrl: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "finalize_oracle_opening_claim_v2";
    readonly sourceId: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "commit_oracle_update_claim_v3";
    readonly sourceId: string;
    readonly claimId: string;
    readonly priorStateAtomic: string;
    readonly newStateAtomic: string;
    readonly evidenceHashHex: string;
    readonly secretSaltHex: string;
    readonly stakeAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "reveal_oracle_update_claim_v3";
    readonly sourceId: string;
    readonly claimId: string;
    readonly priorStateAtomic: string;
    readonly newStateAtomic: string;
    readonly evidenceHashHex: string;
    readonly secretSaltHex: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "challenge_oracle_update_claim_v2";
    readonly sourceId: string;
    readonly claimantPubkey: string;
    readonly claimId: string;
    readonly challengeId: string;
    readonly alternativeStateAtomic: string;
    readonly bondAtomic: string;
    readonly evidenceHashHex: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "finalize_oracle_update_claim_v2";
    readonly sourceId: string;
    readonly claimantPubkey: string;
    readonly claimId: string;
    readonly challengeId?: string;
    readonly outcome: "accept_claim" | "reject_claim" | "rule_review_unresolved";
    readonly currentStep: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "commit_oracle_emergency_vote_v3";
    readonly disputeId: string;
    readonly disputeKind: "source";
    readonly choice: CurrentOracleSourceEmergencyChoice;
    readonly secretSaltHex: string;
    readonly sambaAmountAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "commit_oracle_emergency_vote_v3";
    readonly disputeId: string;
    readonly disputeKind: "update";
    readonly choice: CurrentOracleUpdateEmergencyChoice;
    readonly secretSaltHex: string;
    readonly sambaAmountAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "commit_oracle_emergency_vote_v3";
    readonly disputeId: string;
    readonly disputeKind: "opening";
    readonly choice: CurrentOracleOpeningEmergencyChoice;
    readonly secretSaltHex: string;
    readonly sambaAmountAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "reveal_oracle_emergency_vote_v2";
    readonly disputeId: string;
    readonly disputeKind: "source";
    readonly choice: CurrentOracleSourceEmergencyChoice;
    readonly secretSaltHex: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "reveal_oracle_emergency_vote_v2";
    readonly disputeId: string;
    readonly disputeKind: "update";
    readonly choice: CurrentOracleUpdateEmergencyChoice;
    readonly secretSaltHex: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "reveal_oracle_emergency_vote_v2";
    readonly disputeId: string;
    readonly disputeKind: "opening";
    readonly choice: CurrentOracleOpeningEmergencyChoice;
    readonly secretSaltHex: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "deposit_oracle_usdc_rewards";
    readonly amountAtomic: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "claim_oracle_usdc_reward";
    readonly rewardKind: "proposer" | "support" | "opening";
    readonly sourceId: string;
}) | (CurrentOracleActionCommon & {
    readonly actionType: "claim_oracle_usdc_reward";
    readonly rewardKind: "update";
    readonly sourceId: string;
    readonly claimId: string;
});
type RedactCurrentOracleSecret<T> = T extends {
    readonly secretSaltHex: string;
} ? Omit<T, "secretSaltHex"> : T;
export type CurrentOracleRedactedRequest = RedactCurrentOracleSecret<CurrentOracleActionRequest>;
export declare function encodeCurrentOracleLabelBytes32(value: string, label: string): Buffer;
export declare function parseCurrentOracleHex32(value: unknown, label: string): Buffer;
export declare function currentOracleSourceTypeHash(value: unknown): Buffer;
export declare function currentOracleSourceDefinitionHash(value: unknown): Buffer;
export declare function loadCurrentGovernedSkuManifest(product: "ramx" | "nandx"): Promise<Readonly<{
    product: "ramx" | "nandx";
    requiredSkuRoot: Buffer;
    requiredSkuCount: number;
    layoutSha256: string;
    requiredSkuIds: readonly Buffer[];
    sortedSkuLabels: readonly string[];
}>>;
export declare function getCurrentGovernedSkuProof(product: "ramx" | "nandx", skuId: string): Promise<Readonly<{
    skuId: Buffer;
    skuIndex: number;
    skuProof: readonly Buffer[];
    requiredSkuRoot: Buffer;
    requiredSkuCount: number;
}>>;
//# sourceMappingURL=current-oracle.d.ts.map