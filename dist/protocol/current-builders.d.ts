import * as participation from "@amoeba/spread-release-tools/writer-participation";
import * as orders from "@amoeba/spread-release-tools/dlmm-orders";
import * as evidence from "@amoeba/spread-release-tools/oracle-evidence";
import type * as historicalOracle from "@amoeba/spread-historical-v2/oracle-dlmm";
import type * as historicalWriter from "@amoeba/spread-historical-v2/writer-sleeve-instructions";
import type * as historicalDlmm from "@amoeba/spread-historical-v2/dlmm-instructions";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as currentInstructions from "./current-instructions.js";
import * as oracleInstructions from "@amoeba/spread-release-tools/oracle-dlmm";
import * as dlmmInstructions from "@amoeba/spread-release-tools/dlmm-instructions";
import * as writerInstructions from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import { buildNativeIndexOracleRecipeSourceV1Instruction } from "./current-oracle-membership-internal.js";
import * as writerDlmm from "./writer-dlmm-native-internal.js";
type AnyBuilder = (input: any) => any;
type CurrentBuilderGovernanceModeV1 = "spread-governed" | "sdk-business";
/** @internal Exact output classification consumed only by the governed materializer. */
export interface ReleaseBoundCurrentBuilderOutputV1 {
    readonly value: unknown;
    readonly governanceMode: CurrentBuilderGovernanceModeV1;
}
/**
 * These legacy `current-*` names preserve the historical RC44 builder surface.
 * They deliberately remove `programId` from their TypeScript input surface.
 * The runtime check remains because JavaScript callers and stale declaration
 * consumers can still provide the field. Current-program submission is blocked
 * by the release-train gate.
 */
type CurrentBuilderInput<F extends AnyBuilder> = F extends (input: infer I) => any ? I extends object ? Omit<I, "programId"> : I : never;
type CurrentBuilder<F extends AnyBuilder> = (input: CurrentBuilderInput<F>) => ReturnType<F>;
/**
 * Internal invocation seam for the governed async materializer. It preserves
 * the exact governance-branded PublicKey object returned by Spread instead of
 * replacing it with an ordinary equal-valued key. The function is deliberately
 * absent from package exports and accepts no caller-supplied programId.
 */
export declare function invokeReleaseBoundCurrentBuilderV1(input: {
    readonly builderName: string;
    readonly builderInput: unknown;
    readonly governedProgramId: PublicKey;
    readonly expectedProgramId?: PublicKey;
}): ReleaseBoundCurrentBuilderOutputV1;
export declare const buildInitUserCollateralInstruction: CurrentBuilder<typeof currentInstructions.buildInitUserCollateralInstruction>;
export declare const buildProposeEmergencySettlementSignerRecoveryInstruction: CurrentBuilder<typeof currentInstructions.buildProposeEmergencySettlementSignerRecoveryInstruction>;
export declare const buildWithdrawCollateralInstruction: CurrentBuilder<typeof currentInstructions.buildWithdrawCollateralInstruction>;
export declare const buildDepositCollateralInstruction: CurrentBuilder<typeof oracleInstructions.buildDepositCollateralInstruction>;
export declare const buildActivateVaultV2Instruction: CurrentBuilder<typeof oracleInstructions.buildActivateVaultV2Instruction>;
export declare const buildBootstrapVaultGovernanceV2Instruction: CurrentBuilder<typeof oracleInstructions.buildBootstrapVaultGovernanceV2Instruction>;
export declare const buildConfigureOracleProductSkuManifestInstruction: CurrentBuilder<typeof oracleInstructions.buildConfigureOracleProductSkuManifestInstruction>;
export declare const buildConfigureOracleProductSkuManifestInstructions: CurrentBuilder<typeof oracleInstructions.buildConfigureOracleProductSkuManifestInstructions>;
export declare const buildCreateMarketContractMintV3Instruction: CurrentBuilder<typeof oracleInstructions.buildCreateMarketContractMintV3Instruction>;
export declare const buildInitMarketV2Instruction: CurrentBuilder<typeof oracleInstructions.buildInitMarketV2Instruction>;
export declare const buildInitialProductionSettlementSignerRegistryInstruction: CurrentBuilder<typeof oracleInstructions.buildInitialProductionSettlementSignerRegistryInstruction>;
export declare const buildInitializeOracleMonthV5Instruction: CurrentBuilder<typeof oracleInstructions.buildInitializeOracleMonthV5Instruction>;
export declare const buildInitializeSettlementSignerRegistryInstruction: CurrentBuilder<typeof oracleInstructions.buildInitializeSettlementSignerRegistryInstruction>;
export declare const buildInitializeVaultInstruction: CurrentBuilder<typeof oracleInstructions.buildInitializeVaultInstruction>;
export declare const buildPauseVaultInstruction: CurrentBuilder<typeof oracleInstructions.buildPauseVaultInstruction>;
export declare const buildSetMarketPausedInstruction: CurrentBuilder<typeof oracleInstructions.buildSetMarketPausedInstruction>;
export declare const buildAddOracleUsdcSkuBudgetInstruction: CurrentBuilder<typeof oracleInstructions.buildAddOracleUsdcSkuBudgetInstruction>;
export declare const buildBeginOracleUsdcRewardScheduleInstruction: CurrentBuilder<typeof oracleInstructions.buildBeginOracleUsdcRewardScheduleInstruction>;
export declare const buildConfigureOracleEconomicsTemplateV2Instruction: CurrentBuilder<typeof oracleInstructions.buildConfigureOracleEconomicsTemplateV2Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildConfigureOracleMajorTokenInstruction: CurrentBuilder<typeof historicalOracle.buildConfigureOracleMajorTokenInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildDepositOracleMajorTokensInstruction: CurrentBuilder<typeof historicalOracle.buildDepositOracleMajorTokensInstruction>;
export declare const buildDepositOracleUsdcRewardsInstruction: CurrentBuilder<typeof oracleInstructions.buildDepositOracleUsdcRewardsInstruction>;
export declare const buildFinalizeOracleUsdcRewardScheduleInstruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleUsdcRewardScheduleInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildInitializeOracleSambaPoolInstruction: CurrentBuilder<typeof historicalOracle.buildInitializeOracleSambaPoolInstruction>;
export declare const buildInitializeOracleUsdcRewardVaultInstruction: CurrentBuilder<typeof oracleInstructions.buildInitializeOracleUsdcRewardVaultInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildWithdrawOracleMajorTokensInstruction: CurrentBuilder<typeof historicalOracle.buildWithdrawOracleMajorTokensInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildActivateQueuedStakeAmbaForSambaInstruction: CurrentBuilder<typeof historicalOracle.buildActivateQueuedStakeAmbaForSambaInstruction>;
export declare const buildAdminAssistedWithdrawCollateralInstruction: CurrentBuilder<typeof oracleInstructions.buildAdminAssistedWithdrawCollateralInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildCancelQueuedStakeAmbaInstruction: CurrentBuilder<typeof historicalOracle.buildCancelQueuedStakeAmbaInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildCompleteUnstakeSambaInstruction: CurrentBuilder<typeof historicalOracle.buildCompleteUnstakeSambaInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildInitializeOracleRewardFunnelInstruction: CurrentBuilder<typeof historicalOracle.buildInitializeOracleRewardFunnelInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildQueueStakeAmbaForSambaInstruction: CurrentBuilder<typeof historicalOracle.buildQueueStakeAmbaForSambaInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildRequestUnstakeSambaInstruction: CurrentBuilder<typeof historicalOracle.buildRequestUnstakeSambaInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildSweepOracleRewardFunnelInstruction: CurrentBuilder<typeof historicalOracle.buildSweepOracleRewardFunnelInstruction>;
export declare const buildClaimOracleUsdcRewardInstruction: CurrentBuilder<typeof oracleInstructions.buildClaimOracleUsdcRewardInstruction>;
export declare const buildFinalizeOracleUsdcRewardEntitlementsInstruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleUsdcRewardEntitlementsInstruction>;
export declare const buildProposeOracleSourceV3Instruction: CurrentBuilder<typeof oracleInstructions.buildProposeOracleSourceV3Instruction>;
export declare const buildRegisterOracleUsdcRewardSourceInstruction: CurrentBuilder<typeof oracleInstructions.buildRegisterOracleUsdcRewardSourceInstruction>;
export declare const buildRegisterOracleUsdcRewardUpdateInstruction: CurrentBuilder<typeof oracleInstructions.buildRegisterOracleUsdcRewardUpdateInstruction>;
export declare const buildSupportOracleSourceV3Instruction: CurrentBuilder<typeof oracleInstructions.buildSupportOracleSourceV3Instruction>;
export declare const buildCancelStaleOracleSourceChallengeV2Instruction: CurrentBuilder<typeof oracleInstructions.buildCancelStaleOracleSourceChallengeV2Instruction>;
export declare const buildChallengeOracleSourceV2Instruction: CurrentBuilder<typeof oracleInstructions.buildChallengeOracleSourceV2Instruction>;
export declare const buildExpireUnlistableOracleSourceV2Instruction: CurrentBuilder<typeof oracleInstructions.buildExpireUnlistableOracleSourceV2Instruction>;
export declare const buildFinalizeOracleSkuCoverageInstruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleSkuCoverageInstruction>;
export declare const buildReopenOracleSkuCoverageInstruction: CurrentBuilder<typeof oracleInstructions.buildReopenOracleSkuCoverageInstruction>;
export declare const buildResolveOracleSourceChallengeV2Instruction: CurrentBuilder<typeof oracleInstructions.buildResolveOracleSourceChallengeV2Instruction>;
export declare const buildAccumulateOracleActiveWeightGroupInstruction: CurrentBuilder<typeof oracleInstructions.buildAccumulateOracleActiveWeightGroupInstruction>;
export declare const buildIndexOracleRecipeSourceV1Instruction: CurrentBuilder<typeof buildNativeIndexOracleRecipeSourceV1Instruction>;
export declare const buildRecomputeOracleBucketMedianV1Instruction: CurrentBuilder<typeof oracleInstructions.buildRecomputeOracleBucketMedianV1Instruction>;
export declare const buildAccumulateOracleRecipeBucketV2Instruction: CurrentBuilder<typeof oracleInstructions.buildAccumulateOracleRecipeBucketV2Instruction>;
export declare const buildBeginOracleActiveWeightsInstruction: CurrentBuilder<typeof oracleInstructions.buildBeginOracleActiveWeightsInstruction>;
export declare const buildBeginOracleRecipeWeightsV3Instruction: CurrentBuilder<typeof oracleInstructions.buildBeginOracleRecipeWeightsV3Instruction>;
export declare const buildFinalizeOracleActiveWeightsInstruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleActiveWeightsInstruction>;
export declare const buildFinalizeOracleRecipeWeightsV2Instruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleRecipeWeightsV2Instruction>;
export declare const buildChallengeOracleOpeningClaimV2Instruction: CurrentBuilder<typeof oracleInstructions.buildChallengeOracleOpeningClaimV2Instruction>;
export declare const buildExpireOracleOpeningSourceInstruction: CurrentBuilder<typeof oracleInstructions.buildExpireOracleOpeningSourceInstruction>;
export declare const buildFinalizeOracleOpeningClaimV2Instruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleOpeningClaimV2Instruction>;
export declare const buildFinalizeOracleOpeningPhaseInstruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleOpeningPhaseInstruction>;
export declare const buildResolveOracleOpeningClaimChallengeV2Instruction: CurrentBuilder<typeof oracleInstructions.buildResolveOracleOpeningClaimChallengeV2Instruction>;
export declare const buildSettleFailedOracleMonthEscrowV2Instruction: CurrentBuilder<typeof oracleInstructions.buildSettleFailedOracleMonthEscrowV2Instruction>;
export declare const buildSettleOracleUsdcEscrowInstruction: CurrentBuilder<typeof oracleInstructions.buildSettleOracleUsdcEscrowInstruction>;
export declare const buildSubmitOracleOpeningClaimV2Instruction: CurrentBuilder<typeof oracleInstructions.buildSubmitOracleOpeningClaimV2Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildAbortStaleOracleUpdateEmergencyDisputeV2Instruction: CurrentBuilder<typeof historicalOracle.buildAbortStaleOracleUpdateEmergencyDisputeV2Instruction>;
export declare const buildCancelStaleOracleUpdateClaimV2Instruction: CurrentBuilder<typeof oracleInstructions.buildCancelStaleOracleUpdateClaimV2Instruction>;
export declare const buildChallengeOracleUpdateClaimV2Instruction: CurrentBuilder<typeof oracleInstructions.buildChallengeOracleUpdateClaimV2Instruction>;
export declare const buildCommitOracleUpdateClaimV3Instruction: CurrentBuilder<typeof oracleInstructions.buildCommitOracleUpdateClaimV3Instruction>;
export declare const buildFinalizeOracleUpdateClaimV2Instruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleUpdateClaimV2Instruction>;
export declare const buildRevealOracleUpdateClaimV3Instruction: CurrentBuilder<typeof oracleInstructions.buildRevealOracleUpdateClaimV3Instruction>;
export declare const buildSettleExpiredOracleUpdateCommitmentV3Instruction: CurrentBuilder<typeof oracleInstructions.buildSettleExpiredOracleUpdateCommitmentV3Instruction>;
export declare const buildAbortOracleUsdcRewardScheduleV2Instruction: CurrentBuilder<typeof oracleInstructions.buildAbortOracleUsdcRewardScheduleV2Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildCommitOracleEmergencyVoteV3Instruction: CurrentBuilder<typeof historicalOracle.buildCommitOracleEmergencyVoteV3Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildRegisterOracleSambaWinningVoteInstruction: CurrentBuilder<typeof historicalOracle.buildRegisterOracleSambaWinningVoteInstruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildResolveOracleEmergencyDisputeV2Instruction: CurrentBuilder<typeof historicalOracle.buildResolveOracleEmergencyDisputeV2Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildResolveOracleEmergencyDisputeV4Instruction: CurrentBuilder<typeof historicalOracle.buildResolveOracleEmergencyDisputeV4Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildRevealOracleEmergencyVoteV2Instruction: CurrentBuilder<typeof historicalOracle.buildRevealOracleEmergencyVoteV2Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildSettleOracleSambaEmergencyVoteV2Instruction: CurrentBuilder<typeof historicalOracle.buildSettleOracleSambaEmergencyVoteV2Instruction>;
export declare const buildTimeoutUnsupportedOracleSourceV2Instruction: CurrentBuilder<typeof oracleInstructions.buildTimeoutUnsupportedOracleSourceV2Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildTryOpenOracleEmergencyDisputeV2Instruction: CurrentBuilder<typeof historicalOracle.buildTryOpenOracleEmergencyDisputeV2Instruction>;
export declare const buildCloseOracleMonthInstruction: CurrentBuilder<typeof oracleInstructions.buildCloseOracleMonthInstruction>;
export declare const buildFinalizeOracleMonthInstruction: CurrentBuilder<typeof oracleInstructions.buildFinalizeOracleMonthInstruction>;
export declare const buildInitializeAmoebaDlmmLightConfigInstruction: CurrentBuilder<typeof dlmmInstructions.buildInitializeAmoebaDlmmLightConfigInstruction>;
export declare const buildUpdateAmoebaDlmmLightConfigInstruction: CurrentBuilder<typeof dlmmInstructions.buildUpdateAmoebaDlmmLightConfigInstruction>;
export declare const buildCompressAmoebaDlmmLightStateInstruction: CurrentBuilder<typeof dlmmInstructions.buildCompressAmoebaDlmmLightStateInstruction>;
export declare const buildDecompressAmoebaDlmmLightStateInstruction: CurrentBuilder<typeof dlmmInstructions.buildDecompressAmoebaDlmmLightStateInstruction>;
export declare const buildInitializeAmoebaDlmmBinPageInstruction: CurrentBuilder<typeof dlmmInstructions.buildInitializeAmoebaDlmmBinPageInstruction>;
export declare const buildInitializeAmoebaDlmmPositionInstruction: CurrentBuilder<typeof dlmmInstructions.buildInitializeAmoebaDlmmPositionInstruction>;
export declare const buildAddAmoebaDlmmLiquidityInstruction: CurrentBuilder<typeof dlmmInstructions.buildAddAmoebaDlmmLiquidityInstruction>;
export declare const buildRemoveAmoebaDlmmLiquidityInstruction: CurrentBuilder<typeof dlmmInstructions.buildRemoveAmoebaDlmmLiquidityInstruction>;
export declare const buildInitializeCollectiveAmoebaDlmmPoolInstruction: CurrentBuilder<typeof dlmmInstructions.buildInitializeCollectiveAmoebaDlmmPoolInstruction>;
export declare const buildCollectiveAmoebaDlmmSwapExactInInstruction: CurrentBuilder<typeof dlmmInstructions.buildCollectiveAmoebaDlmmSwapExactInInstruction>;
export declare const buildSetCollectiveAmoebaDlmmPoolStatusInstruction: CurrentBuilder<typeof dlmmInstructions.buildSetCollectiveAmoebaDlmmPoolStatusInstruction>;
export declare const buildSettleCollectiveAmoebaDlmmPoolInstruction: CurrentBuilder<typeof dlmmInstructions.buildSettleCollectiveAmoebaDlmmPoolInstruction>;
export declare const buildInitializeWriterPolicyRegistryV1Instruction: CurrentBuilder<typeof writerInstructions.buildInitializeWriterPolicyRegistryV1Instruction>;
export declare const buildBeginWriterDlmmPolicyV1Instruction: CurrentBuilder<(input: Parameters<(input: writerDlmm.WriterDlmmPolicyAccountsV1 & writerDlmm.WriterDlmmPolicyCommitmentV1) => TransactionInstruction>[0]) => TransactionInstruction>;
export declare const buildAppendWriterDlmmPolicySeriesV1Instruction: CurrentBuilder<(input: Parameters<(input: writerDlmm.WriterDlmmPolicyAccountsV1 & {
    readonly startIndex: number;
    readonly entries: readonly writerDlmm.WriterDlmmSeriesPolicyV1[];
}) => TransactionInstruction>[0]) => TransactionInstruction>;
export declare const buildSealWriterDlmmPolicyV1Instruction: CurrentBuilder<(input: writerDlmm.WriterDlmmPolicyAccountsV1) => TransactionInstruction>;
export declare const buildInitializeWriterDlmmPositionV1Instruction: CurrentBuilder<(input: writerDlmm.WriterDlmmPositionAccountsV1) => TransactionInstruction>;
export declare const buildAddWriterDlmmLiquidityV1Instruction: CurrentBuilder<(input: Parameters<(input: writerDlmm.WriterDlmmLiquidityAccountsV1 & {
    readonly issueAmountAtoms: bigint;
    readonly entries: readonly writerDlmm.WriterDlmmAddEntryV1[];
}) => TransactionInstruction>[0]) => TransactionInstruction>;
export declare const buildRemoveWriterDlmmLiquidityV1Instruction: CurrentBuilder<(input: Parameters<(input: writerDlmm.WriterDlmmLiquidityAccountsV1 & {
    readonly entries: readonly writerDlmm.WriterDlmmRemoveEntryV1[];
}) => TransactionInstruction>[0]) => TransactionInstruction>;
export declare const buildSweepWriterDlmmCashV1Instruction: CurrentBuilder<(input: writerDlmm.WriterDlmmLiquidityAccountsV1) => TransactionInstruction>;
export declare const buildManageWriterPolicyAuthorityV1Instruction: CurrentBuilder<typeof writerInstructions.buildManageWriterPolicyAuthorityV1Instruction>;
export declare const buildInitializeWriterSettlementGroupV1Instruction: CurrentBuilder<typeof writerInstructions.buildInitializeWriterSettlementGroupV1Instruction>;
export declare const buildInitializeWriterSleeveV1Instruction: CurrentBuilder<typeof writerInstructions.buildInitializeWriterSleeveV1Instruction>;
export declare const buildRegisterWriterSeriesV1Instruction: CurrentBuilder<typeof writerInstructions.buildRegisterWriterSeriesV1Instruction>;
export declare const buildSealWriterPolicyV1Instruction: CurrentBuilder<typeof writerInstructions.buildSealWriterPolicyV1Instruction>;
export declare const buildOpenWriterFundingV1Instruction: CurrentBuilder<typeof writerInstructions.buildOpenWriterFundingV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildDepositWriterPrincipalV1Instruction: CurrentBuilder<typeof historicalWriter.buildDepositWriterPrincipalV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildWithdrawWriterPrincipalV1Instruction: CurrentBuilder<typeof historicalWriter.buildWithdrawWriterPrincipalV1Instruction>;
export declare const buildActivateWriterSleeveV1Instruction: CurrentBuilder<typeof writerInstructions.buildActivateWriterSleeveV1Instruction>;
export declare const buildSetCollectiveMarketPausedV1Instruction: CurrentBuilder<typeof writerInstructions.buildSetCollectiveMarketPausedV1Instruction>;
export declare const buildReconcileWriterSupplyV1Instruction: CurrentBuilder<typeof writerInstructions.buildReconcileWriterSupplyV1Instruction>;
export declare const buildCleanupWriterCustodyV1Instruction: CurrentBuilder<typeof writerInstructions.buildCleanupWriterCustodyV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildCommitWriterAuctionV1Instruction: CurrentBuilder<typeof historicalWriter.buildCommitWriterAuctionV1Instruction>;
/** Build one phase only; confirm phase 0 and phase 1 in separate transactions before commit. */
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildPrepareWriterBidIndexV1Instruction: CurrentBuilder<typeof historicalWriter.buildPrepareWriterBidIndexV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildPlaceWriterBidV1Instruction: CurrentBuilder<typeof historicalWriter.buildPlaceWriterBidV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildCancelOrRefundWriterBidV1Instruction: CurrentBuilder<typeof historicalWriter.buildCancelOrRefundWriterBidV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildRevealWriterAuctionV1Instruction: CurrentBuilder<typeof historicalWriter.buildRevealWriterAuctionV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildPlanWriterAuctionChunkV1Instruction: CurrentBuilder<typeof historicalWriter.buildPlanWriterAuctionChunkV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildExecuteWriterAuctionFillV1Instruction: CurrentBuilder<typeof historicalWriter.buildExecuteWriterAuctionFillV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildFinalizeOrAbortWriterAuctionV1Instruction: CurrentBuilder<typeof historicalWriter.buildFinalizeOrAbortWriterAuctionV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildBeginWriterCloseV1Instruction: CurrentBuilder<typeof historicalWriter.buildBeginWriterCloseV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildDepositWriterCloseBasketV1Instruction: CurrentBuilder<typeof historicalWriter.buildDepositWriterCloseBasketV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildFinalizeWriterCloseV1Instruction: CurrentBuilder<typeof historicalWriter.buildFinalizeWriterCloseV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildProcessWriterCloseSeriesCancellationV1Instruction: CurrentBuilder<typeof historicalWriter.buildProcessWriterCloseSeriesCancellationV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildProcessWriterCloseFlatCancellationV1Instruction: CurrentBuilder<typeof historicalWriter.buildProcessWriterCloseFlatCancellationV1Instruction>;
export declare const buildPublishWriterGroupSettlementV1Instruction: CurrentBuilder<typeof writerInstructions.buildPublishWriterGroupSettlementV1Instruction>;
export declare const buildFinalizeWriterSleeveSettlementV1Instruction: CurrentBuilder<typeof writerInstructions.buildFinalizeWriterSleeveSettlementV1Instruction>;
export declare const buildClaimCollectiveLongV1Instruction: CurrentBuilder<typeof writerInstructions.buildClaimCollectiveLongV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildClaimWriterFlatResidualV1Instruction: CurrentBuilder<typeof historicalWriter.buildClaimWriterFlatResidualV1Instruction>;
export declare const buildCloseWriterSleeveV1Instruction: CurrentBuilder<typeof writerInstructions.buildCloseWriterSleeveV1Instruction>;
/** @deprecated Retired G3 operation; never registered for construction. */
export declare const buildCollectAmoebaDlmmProtocolFeesInstruction: CurrentBuilder<typeof historicalDlmm.buildCollectAmoebaDlmmProtocolFeesInstruction>;
export declare const buildCloseAmoebaDlmmPoolInstruction: CurrentBuilder<typeof dlmmInstructions.buildCloseAmoebaDlmmPoolInstruction>;
export declare const buildExecuteScopedCollectiveSettlementV1Instruction: CurrentBuilder<typeof writerInstructions.buildExecuteScopedCollectiveSettlementV1Instruction>;
export declare const buildExecuteScopedPositionSettlementV1Instruction: CurrentBuilder<typeof dlmmInstructions.buildExecuteScopedPositionSettlementV1Instruction>;
export declare const buildContributeWriterInstruction: CurrentBuilder<typeof participation.buildContributeWriterInstruction>;
export declare const buildTransferWriterContributionInstruction: CurrentBuilder<typeof participation.buildTransferWriterContributionInstruction>;
export declare const buildSplitWriterContributionInstruction: CurrentBuilder<typeof participation.buildSplitWriterContributionInstruction>;
export declare const buildClaimWriterContributionInstruction: CurrentBuilder<typeof participation.buildClaimWriterContributionInstruction>;
export declare const buildCloseWriterContributionInstruction: CurrentBuilder<typeof participation.buildCloseWriterContributionInstruction>;
export declare const buildExpireUnactivatedWriterV3Instruction: CurrentBuilder<typeof participation.buildExpireUnactivatedWriterV3Instruction>;
export declare const buildDlmmOrderInstruction: CurrentBuilder<typeof orders.buildDlmmOrderInstruction>;
export declare const buildOracleEvidenceUploadInstructions: CurrentBuilder<typeof evidence.buildOracleEvidenceUpload>;
export declare const buildCloseOracleEvidenceDraftInstruction: CurrentBuilder<typeof evidence.buildCloseOracleEvidenceDraft>;
export {};
//# sourceMappingURL=current-builders.d.ts.map