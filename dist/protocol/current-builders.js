import * as participation from "@amoeba/spread-release-tools/writer-participation";
import * as orders from "@amoeba/spread-release-tools/dlmm-orders";
import * as evidence from "@amoeba/spread-release-tools/oracle-evidence";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AmebaProgramIdMismatchError, AmebaProtocolError } from "../errors.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { isCurrentWriteReleaseAvailable } from "./release-train.js";
import * as currentInstructions from "./current-instructions.js";
import * as oracleInstructions from "@amoeba/spread-release-tools/oracle-dlmm";
import * as dlmmInstructions from "@amoeba/spread-release-tools/dlmm-instructions";
import * as writerInstructions from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import { buildNativeIndexOracleRecipeSourceV1Instruction } from "./current-oracle-membership-internal.js";
import * as writerDlmm from "./writer-dlmm-native-internal.js";
const CURRENT_PROGRAM_ID = new PublicKey(AMOEBA_SPREAD_PROGRAM_ID);
const RAW_CURRENT_BUILDERS = new Map();
function pinInput(input, builderName) {
    if (isCurrentWriteReleaseAvailable()) {
        throw new AmebaProtocolError(`${builderName} is the historical synchronous builder surface; use the governed async current-write materializer`, { code: "CURRENT_GOVERNED_BUILDER_REQUIRED" });
    }
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return input;
    }
    const record = input;
    if (record.programId !== undefined) {
        let supplied;
        try {
            supplied = new PublicKey(record.programId);
        }
        catch (cause) {
            throw new AmebaProgramIdMismatchError(`${builderName} received an invalid programId; historical RC44 builders are pinned to ${AMOEBA_SPREAD_PROGRAM_ID}`, { cause, details: { builderName } });
        }
        if (!supplied.equals(CURRENT_PROGRAM_ID)) {
            throw new AmebaProgramIdMismatchError(`${builderName} accepts only the historical RC44 program address ${AMOEBA_SPREAD_PROGRAM_ID}`, {
                details: {
                    builderName,
                    received: supplied.toBase58(),
                    expected: AMOEBA_SPREAD_PROGRAM_ID,
                },
            });
        }
    }
    return { ...record, programId: CURRENT_PROGRAM_ID };
}
function assertCurrentOutput(value, builderName, expectedProgram = CURRENT_PROGRAM_ID) {
    const outputs = Array.isArray(value) ? value : [value];
    for (const output of outputs) {
        if (!(output instanceof TransactionInstruction)) {
            throw new AmebaProgramIdMismatchError(`${builderName} did not return a TransactionInstruction`);
        }
        if (!output.programId.equals(expectedProgram)) {
            throw new AmebaProgramIdMismatchError(`${builderName} emitted a non-current program instruction`, {
                details: {
                    builderName,
                    received: output.programId.toBase58(),
                    expected: AMOEBA_SPREAD_PROGRAM_ID,
                },
            });
        }
    }
    return value;
}
function pinBuilder(builderName, builder, governanceMode = "spread-governed") {
    if (RAW_CURRENT_BUILDERS.has(builderName)) {
        throw new Error(`duplicate current builder registration: ${builderName}`);
    }
    RAW_CURRENT_BUILDERS.set(builderName, Object.freeze({ builder, governanceMode }));
    return ((input) => {
        const pinnedInput = pinInput(input, builderName);
        return assertCurrentOutput(builder(pinnedInput), builderName);
    });
}
/**
 * Internal invocation seam for the governed async materializer. It preserves
 * the exact governance-branded PublicKey object returned by Spread instead of
 * replacing it with an ordinary equal-valued key. The function is deliberately
 * absent from package exports and accepts no caller-supplied programId.
 */
export function invokeReleaseBoundCurrentBuilderV1(input) {
    if (input === null
        || typeof input !== "object"
        || typeof input.builderName !== "string"
        || input.builderInput === null
        || typeof input.builderInput !== "object"
        || Array.isArray(input.builderInput)
        || !(input.governedProgramId instanceof PublicKey)) {
        throw new AmebaProtocolError("governed current builder input is malformed", {
            code: "CURRENT_GOVERNED_BUILDER_INPUT_INVALID",
        });
    }
    const builderInput = input.builderInput;
    if (Object.prototype.hasOwnProperty.call(builderInput, "programId")) {
        throw new AmebaProtocolError("governed current builder input cannot supply programId", {
            code: "CURRENT_GOVERNED_BUILDER_PROGRAM_FORBIDDEN",
        });
    }
    if (!input.governedProgramId.equals(input.expectedProgramId ?? CURRENT_PROGRAM_ID)) {
        throw new AmebaProtocolError("governed current builder target is not the pinned Spread program", {
            code: "CURRENT_GOVERNED_BUILDER_PROGRAM_INVALID",
        });
    }
    const registration = RAW_CURRENT_BUILDERS.get(input.builderName);
    if (registration === undefined) {
        throw new AmebaProtocolError("governed current builder name is not an SDK-owned official builder", {
            code: "CURRENT_GOVERNED_BUILDER_NAME_INVALID",
        });
    }
    return Object.freeze({
        value: assertCurrentOutput(registration.builder({ ...builderInput, programId: input.governedProgramId }), input.builderName, input.expectedProgramId ?? CURRENT_PROGRAM_ID),
        governanceMode: registration.governanceMode,
    });
}
export const buildInitUserCollateralInstruction = pinBuilder("buildInitUserCollateralInstruction", currentInstructions.buildInitUserCollateralInstruction, "sdk-business");
export const buildProposeEmergencySettlementSignerRecoveryInstruction = pinBuilder("buildProposeEmergencySettlementSignerRecoveryInstruction", currentInstructions.buildProposeEmergencySettlementSignerRecoveryInstruction, "sdk-business");
export const buildWithdrawCollateralInstruction = pinBuilder("buildWithdrawCollateralInstruction", currentInstructions.buildWithdrawCollateralInstruction, "sdk-business");
export const buildDepositCollateralInstruction = pinBuilder("buildDepositCollateralInstruction", oracleInstructions.buildDepositCollateralInstruction);
export const buildActivateVaultV2Instruction = pinBuilder("buildActivateVaultV2Instruction", oracleInstructions.buildActivateVaultV2Instruction);
export const buildBootstrapVaultGovernanceV2Instruction = pinBuilder("buildBootstrapVaultGovernanceV2Instruction", oracleInstructions.buildBootstrapVaultGovernanceV2Instruction);
export const buildConfigureOracleProductSkuManifestInstruction = pinBuilder("buildConfigureOracleProductSkuManifestInstruction", oracleInstructions.buildConfigureOracleProductSkuManifestInstruction);
export const buildConfigureOracleProductSkuManifestInstructions = pinBuilder("buildConfigureOracleProductSkuManifestInstructions", oracleInstructions.buildConfigureOracleProductSkuManifestInstructions);
export const buildCreateMarketContractMintV3Instruction = pinBuilder("buildCreateMarketContractMintV3Instruction", oracleInstructions.buildCreateMarketContractMintV3Instruction);
export const buildInitMarketV2Instruction = pinBuilder("buildInitMarketV2Instruction", oracleInstructions.buildInitMarketV2Instruction);
export const buildInitialProductionSettlementSignerRegistryInstruction = pinBuilder("buildInitialProductionSettlementSignerRegistryInstruction", oracleInstructions.buildInitialProductionSettlementSignerRegistryInstruction);
export const buildInitializeOracleMonthV5Instruction = pinBuilder("buildInitializeOracleMonthV5Instruction", oracleInstructions.buildInitializeOracleMonthV5Instruction);
export const buildInitializeSettlementSignerRegistryInstruction = pinBuilder("buildInitializeSettlementSignerRegistryInstruction", oracleInstructions.buildInitializeSettlementSignerRegistryInstruction);
export const buildInitializeVaultInstruction = pinBuilder("buildInitializeVaultInstruction", oracleInstructions.buildInitializeVaultInstruction);
export const buildPauseVaultInstruction = pinBuilder("buildPauseVaultInstruction", oracleInstructions.buildPauseVaultInstruction);
export const buildSetMarketPausedInstruction = pinBuilder("buildSetMarketPausedInstruction", oracleInstructions.buildSetMarketPausedInstruction);
export const buildAddOracleUsdcSkuBudgetInstruction = pinBuilder("buildAddOracleUsdcSkuBudgetInstruction", oracleInstructions.buildAddOracleUsdcSkuBudgetInstruction);
export const buildBeginOracleUsdcRewardScheduleInstruction = pinBuilder("buildBeginOracleUsdcRewardScheduleInstruction", oracleInstructions.buildBeginOracleUsdcRewardScheduleInstruction);
export const buildConfigureOracleEconomicsTemplateV2Instruction = pinBuilder("buildConfigureOracleEconomicsTemplateV2Instruction", oracleInstructions.buildConfigureOracleEconomicsTemplateV2Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildConfigureOracleMajorTokenInstruction = retiredBuilder("buildConfigureOracleMajorTokenInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildDepositOracleMajorTokensInstruction = retiredBuilder("buildDepositOracleMajorTokensInstruction");
export const buildDepositOracleUsdcRewardsInstruction = pinBuilder("buildDepositOracleUsdcRewardsInstruction", oracleInstructions.buildDepositOracleUsdcRewardsInstruction);
export const buildFinalizeOracleUsdcRewardScheduleInstruction = pinBuilder("buildFinalizeOracleUsdcRewardScheduleInstruction", oracleInstructions.buildFinalizeOracleUsdcRewardScheduleInstruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildInitializeOracleSambaPoolInstruction = retiredBuilder("buildInitializeOracleSambaPoolInstruction");
export const buildInitializeOracleUsdcRewardVaultInstruction = pinBuilder("buildInitializeOracleUsdcRewardVaultInstruction", oracleInstructions.buildInitializeOracleUsdcRewardVaultInstruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildWithdrawOracleMajorTokensInstruction = retiredBuilder("buildWithdrawOracleMajorTokensInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildActivateQueuedStakeAmbaForSambaInstruction = retiredBuilder("buildActivateQueuedStakeAmbaForSambaInstruction");
export const buildAdminAssistedWithdrawCollateralInstruction = pinBuilder("buildAdminAssistedWithdrawCollateralInstruction", oracleInstructions.buildAdminAssistedWithdrawCollateralInstruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildCancelQueuedStakeAmbaInstruction = retiredBuilder("buildCancelQueuedStakeAmbaInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildCompleteUnstakeSambaInstruction = retiredBuilder("buildCompleteUnstakeSambaInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildInitializeOracleRewardFunnelInstruction = retiredBuilder("buildInitializeOracleRewardFunnelInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildQueueStakeAmbaForSambaInstruction = retiredBuilder("buildQueueStakeAmbaForSambaInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildRequestUnstakeSambaInstruction = retiredBuilder("buildRequestUnstakeSambaInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildSweepOracleRewardFunnelInstruction = retiredBuilder("buildSweepOracleRewardFunnelInstruction");
export const buildClaimOracleUsdcRewardInstruction = pinBuilder("buildClaimOracleUsdcRewardInstruction", oracleInstructions.buildClaimOracleUsdcRewardInstruction);
export const buildFinalizeOracleUsdcRewardEntitlementsInstruction = pinBuilder("buildFinalizeOracleUsdcRewardEntitlementsInstruction", oracleInstructions.buildFinalizeOracleUsdcRewardEntitlementsInstruction);
export const buildProposeOracleSourceV3Instruction = pinBuilder("buildProposeOracleSourceV3Instruction", oracleInstructions.buildProposeOracleSourceV3Instruction);
export const buildRegisterOracleUsdcRewardSourceInstruction = pinBuilder("buildRegisterOracleUsdcRewardSourceInstruction", oracleInstructions.buildRegisterOracleUsdcRewardSourceInstruction);
export const buildRegisterOracleUsdcRewardUpdateInstruction = pinBuilder("buildRegisterOracleUsdcRewardUpdateInstruction", oracleInstructions.buildRegisterOracleUsdcRewardUpdateInstruction);
export const buildSupportOracleSourceV3Instruction = pinBuilder("buildSupportOracleSourceV3Instruction", oracleInstructions.buildSupportOracleSourceV3Instruction);
export const buildCancelStaleOracleSourceChallengeV2Instruction = pinBuilder("buildCancelStaleOracleSourceChallengeV2Instruction", oracleInstructions.buildCancelStaleOracleSourceChallengeV2Instruction);
export const buildChallengeOracleSourceV2Instruction = pinBuilder("buildChallengeOracleSourceV2Instruction", oracleInstructions.buildChallengeOracleSourceV2Instruction);
export const buildExpireUnlistableOracleSourceV2Instruction = pinBuilder("buildExpireUnlistableOracleSourceV2Instruction", oracleInstructions.buildExpireUnlistableOracleSourceV2Instruction);
export const buildFinalizeOracleSkuCoverageInstruction = pinBuilder("buildFinalizeOracleSkuCoverageInstruction", oracleInstructions.buildFinalizeOracleSkuCoverageInstruction);
export const buildReopenOracleSkuCoverageInstruction = pinBuilder("buildReopenOracleSkuCoverageInstruction", oracleInstructions.buildReopenOracleSkuCoverageInstruction);
export const buildResolveOracleSourceChallengeV2Instruction = pinBuilder("buildResolveOracleSourceChallengeV2Instruction", oracleInstructions.buildResolveOracleSourceChallengeV2Instruction);
export const buildAccumulateOracleActiveWeightGroupInstruction = pinBuilder("buildAccumulateOracleActiveWeightGroupInstruction", oracleInstructions.buildAccumulateOracleActiveWeightGroupInstruction);
// Registration is not release eligibility. The current package/tag inventory stays authoritative.
export const buildIndexOracleRecipeSourceV1Instruction = pinBuilder("buildIndexOracleRecipeSourceV1Instruction", buildNativeIndexOracleRecipeSourceV1Instruction);
export const buildRecomputeOracleBucketMedianV1Instruction = pinBuilder("buildRecomputeOracleBucketMedianV1Instruction", oracleInstructions.buildRecomputeOracleBucketMedianV1Instruction);
export const buildAccumulateOracleRecipeBucketV2Instruction = pinBuilder("buildAccumulateOracleRecipeBucketV2Instruction", oracleInstructions.buildAccumulateOracleRecipeBucketV2Instruction);
export const buildBeginOracleActiveWeightsInstruction = pinBuilder("buildBeginOracleActiveWeightsInstruction", oracleInstructions.buildBeginOracleActiveWeightsInstruction);
export const buildBeginOracleRecipeWeightsV3Instruction = pinBuilder("buildBeginOracleRecipeWeightsV3Instruction", oracleInstructions.buildBeginOracleRecipeWeightsV3Instruction);
export const buildFinalizeOracleActiveWeightsInstruction = pinBuilder("buildFinalizeOracleActiveWeightsInstruction", oracleInstructions.buildFinalizeOracleActiveWeightsInstruction);
export const buildFinalizeOracleRecipeWeightsV2Instruction = pinBuilder("buildFinalizeOracleRecipeWeightsV2Instruction", oracleInstructions.buildFinalizeOracleRecipeWeightsV2Instruction);
export const buildChallengeOracleOpeningClaimV2Instruction = pinBuilder("buildChallengeOracleOpeningClaimV2Instruction", oracleInstructions.buildChallengeOracleOpeningClaimV2Instruction);
export const buildExpireOracleOpeningSourceInstruction = pinBuilder("buildExpireOracleOpeningSourceInstruction", oracleInstructions.buildExpireOracleOpeningSourceInstruction);
export const buildFinalizeOracleOpeningClaimV2Instruction = pinBuilder("buildFinalizeOracleOpeningClaimV2Instruction", oracleInstructions.buildFinalizeOracleOpeningClaimV2Instruction);
export const buildFinalizeOracleOpeningPhaseInstruction = pinBuilder("buildFinalizeOracleOpeningPhaseInstruction", oracleInstructions.buildFinalizeOracleOpeningPhaseInstruction);
export const buildResolveOracleOpeningClaimChallengeV2Instruction = pinBuilder("buildResolveOracleOpeningClaimChallengeV2Instruction", oracleInstructions.buildResolveOracleOpeningClaimChallengeV2Instruction);
export const buildSettleFailedOracleMonthEscrowV2Instruction = pinBuilder("buildSettleFailedOracleMonthEscrowV2Instruction", oracleInstructions.buildSettleFailedOracleMonthEscrowV2Instruction);
export const buildSettleOracleUsdcEscrowInstruction = pinBuilder("buildSettleOracleUsdcEscrowInstruction", oracleInstructions.buildSettleOracleUsdcEscrowInstruction);
export const buildSubmitOracleOpeningClaimV2Instruction = pinBuilder("buildSubmitOracleOpeningClaimV2Instruction", oracleInstructions.buildSubmitOracleOpeningClaimV2Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildAbortStaleOracleUpdateEmergencyDisputeV2Instruction = retiredBuilder("buildAbortStaleOracleUpdateEmergencyDisputeV2Instruction");
export const buildCancelStaleOracleUpdateClaimV2Instruction = pinBuilder("buildCancelStaleOracleUpdateClaimV2Instruction", oracleInstructions.buildCancelStaleOracleUpdateClaimV2Instruction);
export const buildChallengeOracleUpdateClaimV2Instruction = pinBuilder("buildChallengeOracleUpdateClaimV2Instruction", oracleInstructions.buildChallengeOracleUpdateClaimV2Instruction);
export const buildCommitOracleUpdateClaimV3Instruction = pinBuilder("buildCommitOracleUpdateClaimV3Instruction", oracleInstructions.buildCommitOracleUpdateClaimV3Instruction);
export const buildFinalizeOracleUpdateClaimV2Instruction = pinBuilder("buildFinalizeOracleUpdateClaimV2Instruction", oracleInstructions.buildFinalizeOracleUpdateClaimV2Instruction);
export const buildRevealOracleUpdateClaimV3Instruction = pinBuilder("buildRevealOracleUpdateClaimV3Instruction", oracleInstructions.buildRevealOracleUpdateClaimV3Instruction);
export const buildSettleExpiredOracleUpdateCommitmentV3Instruction = pinBuilder("buildSettleExpiredOracleUpdateCommitmentV3Instruction", oracleInstructions.buildSettleExpiredOracleUpdateCommitmentV3Instruction);
export const buildAbortOracleUsdcRewardScheduleV2Instruction = pinBuilder("buildAbortOracleUsdcRewardScheduleV2Instruction", oracleInstructions.buildAbortOracleUsdcRewardScheduleV2Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildCommitOracleEmergencyVoteV3Instruction = retiredBuilder("buildCommitOracleEmergencyVoteV3Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildRegisterOracleSambaWinningVoteInstruction = retiredBuilder("buildRegisterOracleSambaWinningVoteInstruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildResolveOracleEmergencyDisputeV2Instruction = retiredBuilder("buildResolveOracleEmergencyDisputeV2Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildResolveOracleEmergencyDisputeV4Instruction = retiredBuilder("buildResolveOracleEmergencyDisputeV4Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildRevealOracleEmergencyVoteV2Instruction = retiredBuilder("buildRevealOracleEmergencyVoteV2Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildSettleOracleSambaEmergencyVoteV2Instruction = retiredBuilder("buildSettleOracleSambaEmergencyVoteV2Instruction");
export const buildTimeoutUnsupportedOracleSourceV2Instruction = pinBuilder("buildTimeoutUnsupportedOracleSourceV2Instruction", oracleInstructions.buildTimeoutUnsupportedOracleSourceV2Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildTryOpenOracleEmergencyDisputeV2Instruction = retiredBuilder("buildTryOpenOracleEmergencyDisputeV2Instruction");
export const buildCloseOracleMonthInstruction = pinBuilder("buildCloseOracleMonthInstruction", oracleInstructions.buildCloseOracleMonthInstruction);
export const buildFinalizeOracleMonthInstruction = pinBuilder("buildFinalizeOracleMonthInstruction", oracleInstructions.buildFinalizeOracleMonthInstruction);
export const buildInitializeAmoebaDlmmLightConfigInstruction = pinBuilder("buildInitializeAmoebaDlmmLightConfigInstruction", dlmmInstructions.buildInitializeAmoebaDlmmLightConfigInstruction);
export const buildUpdateAmoebaDlmmLightConfigInstruction = pinBuilder("buildUpdateAmoebaDlmmLightConfigInstruction", dlmmInstructions.buildUpdateAmoebaDlmmLightConfigInstruction);
export const buildCompressAmoebaDlmmLightStateInstruction = pinBuilder("buildCompressAmoebaDlmmLightStateInstruction", dlmmInstructions.buildCompressAmoebaDlmmLightStateInstruction);
export const buildDecompressAmoebaDlmmLightStateInstruction = pinBuilder("buildDecompressAmoebaDlmmLightStateInstruction", dlmmInstructions.buildDecompressAmoebaDlmmLightStateInstruction);
export const buildInitializeAmoebaDlmmBinPageInstruction = pinBuilder("buildInitializeAmoebaDlmmBinPageInstruction", dlmmInstructions.buildInitializeAmoebaDlmmBinPageInstruction);
export const buildInitializeAmoebaDlmmPositionInstruction = pinBuilder("buildInitializeAmoebaDlmmPositionInstruction", dlmmInstructions.buildInitializeAmoebaDlmmPositionInstruction);
export const buildAddAmoebaDlmmLiquidityInstruction = pinBuilder("buildAddAmoebaDlmmLiquidityInstruction", dlmmInstructions.buildAddAmoebaDlmmLiquidityInstruction);
export const buildRemoveAmoebaDlmmLiquidityInstruction = pinBuilder("buildRemoveAmoebaDlmmLiquidityInstruction", dlmmInstructions.buildRemoveAmoebaDlmmLiquidityInstruction);
export const buildInitializeCollectiveAmoebaDlmmPoolInstruction = pinBuilder("buildInitializeCollectiveAmoebaDlmmPoolInstruction", dlmmInstructions.buildInitializeCollectiveAmoebaDlmmPoolInstruction);
export const buildCollectiveAmoebaDlmmSwapExactInInstruction = pinBuilder("buildCollectiveAmoebaDlmmSwapExactInInstruction", dlmmInstructions.buildCollectiveAmoebaDlmmSwapExactInInstruction);
export const buildSetCollectiveAmoebaDlmmPoolStatusInstruction = pinBuilder("buildSetCollectiveAmoebaDlmmPoolStatusInstruction", dlmmInstructions.buildSetCollectiveAmoebaDlmmPoolStatusInstruction);
export const buildSettleCollectiveAmoebaDlmmPoolInstruction = pinBuilder("buildSettleCollectiveAmoebaDlmmPoolInstruction", dlmmInstructions.buildSettleCollectiveAmoebaDlmmPoolInstruction);
export const buildInitializeWriterPolicyRegistryV1Instruction = pinBuilder("buildInitializeWriterPolicyRegistryV1Instruction", writerInstructions.buildInitializeWriterPolicyRegistryV1Instruction);
export const buildBeginWriterDlmmPolicyV1Instruction = pinBuilder("buildBeginWriterDlmmPolicyV1Instruction", writerDlmm.buildNativeBeginWriterDlmmPolicyV1Instruction);
export const buildAppendWriterDlmmPolicySeriesV1Instruction = pinBuilder("buildAppendWriterDlmmPolicySeriesV1Instruction", writerDlmm.buildNativeAppendWriterDlmmPolicySeriesV1Instruction);
export const buildSealWriterDlmmPolicyV1Instruction = pinBuilder("buildSealWriterDlmmPolicyV1Instruction", writerDlmm.buildNativeSealWriterDlmmPolicyV1Instruction);
export const buildInitializeWriterDlmmPositionV1Instruction = pinBuilder("buildInitializeWriterDlmmPositionV1Instruction", writerDlmm.buildNativeInitializeWriterDlmmPositionV1Instruction);
export const buildAddWriterDlmmLiquidityV1Instruction = pinBuilder("buildAddWriterDlmmLiquidityV1Instruction", writerDlmm.buildNativeAddWriterDlmmLiquidityV1Instruction);
export const buildRemoveWriterDlmmLiquidityV1Instruction = pinBuilder("buildRemoveWriterDlmmLiquidityV1Instruction", writerDlmm.buildNativeRemoveWriterDlmmLiquidityV1Instruction);
export const buildSweepWriterDlmmCashV1Instruction = pinBuilder("buildSweepWriterDlmmCashV1Instruction", writerDlmm.buildNativeSweepWriterDlmmCashV1Instruction);
export const buildManageWriterPolicyAuthorityV1Instruction = pinBuilder("buildManageWriterPolicyAuthorityV1Instruction", writerInstructions.buildManageWriterPolicyAuthorityV1Instruction);
export const buildInitializeWriterSettlementGroupV1Instruction = pinBuilder("buildInitializeWriterSettlementGroupV1Instruction", writerInstructions.buildInitializeWriterSettlementGroupV1Instruction);
export const buildInitializeWriterSleeveV1Instruction = pinBuilder("buildInitializeWriterSleeveV1Instruction", writerInstructions.buildInitializeWriterSleeveV1Instruction);
export const buildRegisterWriterSeriesV1Instruction = pinBuilder("buildRegisterWriterSeriesV1Instruction", writerInstructions.buildRegisterWriterSeriesV1Instruction);
export const buildSealWriterPolicyV1Instruction = pinBuilder("buildSealWriterPolicyV1Instruction", writerInstructions.buildSealWriterPolicyV1Instruction);
export const buildOpenWriterFundingV1Instruction = pinBuilder("buildOpenWriterFundingV1Instruction", writerInstructions.buildOpenWriterFundingV1Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildDepositWriterPrincipalV1Instruction = retiredBuilder("buildDepositWriterPrincipalV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildWithdrawWriterPrincipalV1Instruction = retiredBuilder("buildWithdrawWriterPrincipalV1Instruction");
export const buildActivateWriterSleeveV1Instruction = pinBuilder("buildActivateWriterSleeveV1Instruction", writerInstructions.buildActivateWriterSleeveV1Instruction);
export const buildSetCollectiveMarketPausedV1Instruction = pinBuilder("buildSetCollectiveMarketPausedV1Instruction", writerInstructions.buildSetCollectiveMarketPausedV1Instruction);
export const buildReconcileWriterSupplyV1Instruction = pinBuilder("buildReconcileWriterSupplyV1Instruction", writerInstructions.buildReconcileWriterSupplyV1Instruction);
export const buildCleanupWriterCustodyV1Instruction = pinBuilder("buildCleanupWriterCustodyV1Instruction", writerInstructions.buildCleanupWriterCustodyV1Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildCommitWriterAuctionV1Instruction = retiredBuilder("buildCommitWriterAuctionV1Instruction");
/** Build one phase only; confirm phase 0 and phase 1 in separate transactions before commit. */
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildPrepareWriterBidIndexV1Instruction = retiredBuilder("buildPrepareWriterBidIndexV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildPlaceWriterBidV1Instruction = retiredBuilder("buildPlaceWriterBidV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildCancelOrRefundWriterBidV1Instruction = retiredBuilder("buildCancelOrRefundWriterBidV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildRevealWriterAuctionV1Instruction = retiredBuilder("buildRevealWriterAuctionV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildPlanWriterAuctionChunkV1Instruction = retiredBuilder("buildPlanWriterAuctionChunkV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildExecuteWriterAuctionFillV1Instruction = retiredBuilder("buildExecuteWriterAuctionFillV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildFinalizeOrAbortWriterAuctionV1Instruction = retiredBuilder("buildFinalizeOrAbortWriterAuctionV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildBeginWriterCloseV1Instruction = retiredBuilder("buildBeginWriterCloseV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildDepositWriterCloseBasketV1Instruction = retiredBuilder("buildDepositWriterCloseBasketV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildFinalizeWriterCloseV1Instruction = retiredBuilder("buildFinalizeWriterCloseV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildProcessWriterCloseSeriesCancellationV1Instruction = retiredBuilder("buildProcessWriterCloseSeriesCancellationV1Instruction");
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildProcessWriterCloseFlatCancellationV1Instruction = retiredBuilder("buildProcessWriterCloseFlatCancellationV1Instruction");
export const buildPublishWriterGroupSettlementV1Instruction = pinBuilder("buildPublishWriterGroupSettlementV1Instruction", writerInstructions.buildPublishWriterGroupSettlementV1Instruction);
export const buildFinalizeWriterSleeveSettlementV1Instruction = pinBuilder("buildFinalizeWriterSleeveSettlementV1Instruction", writerInstructions.buildFinalizeWriterSleeveSettlementV1Instruction);
export const buildClaimCollectiveLongV1Instruction = pinBuilder("buildClaimCollectiveLongV1Instruction", writerInstructions.buildClaimCollectiveLongV1Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildClaimWriterFlatResidualV1Instruction = retiredBuilder("buildClaimWriterFlatResidualV1Instruction");
export const buildCloseWriterSleeveV1Instruction = pinBuilder("buildCloseWriterSleeveV1Instruction", writerInstructions.buildCloseWriterSleeveV1Instruction);
/** @deprecated Retired G3 operation; never registered for construction. */
export const buildCollectAmoebaDlmmProtocolFeesInstruction = retiredBuilder("buildCollectAmoebaDlmmProtocolFeesInstruction");
export const buildCloseAmoebaDlmmPoolInstruction = pinBuilder("buildCloseAmoebaDlmmPoolInstruction", dlmmInstructions.buildCloseAmoebaDlmmPoolInstruction);
export const buildExecuteScopedCollectiveSettlementV1Instruction = pinBuilder("buildExecuteScopedCollectiveSettlementV1Instruction", writerInstructions.buildExecuteScopedCollectiveSettlementV1Instruction);
export const buildExecuteScopedPositionSettlementV1Instruction = pinBuilder("buildExecuteScopedPositionSettlementV1Instruction", dlmmInstructions.buildExecuteScopedPositionSettlementV1Instruction);
function retiredBuilder(name) {
    return (() => { throw new AmebaProtocolError(`${name} was retired by G3; use contribution receipts, funded public orders, or the council interface`, { code: "G3_OPERATION_RETIRED" }); });
}
export const buildContributeWriterInstruction = pinBuilder("buildContributeWriterInstruction", participation.buildContributeWriterInstruction);
export const buildTransferWriterContributionInstruction = pinBuilder("buildTransferWriterContributionInstruction", participation.buildTransferWriterContributionInstruction);
export const buildSplitWriterContributionInstruction = pinBuilder("buildSplitWriterContributionInstruction", participation.buildSplitWriterContributionInstruction);
export const buildClaimWriterContributionInstruction = pinBuilder("buildClaimWriterContributionInstruction", participation.buildClaimWriterContributionInstruction);
export const buildCloseWriterContributionInstruction = pinBuilder("buildCloseWriterContributionInstruction", participation.buildCloseWriterContributionInstruction);
export const buildExpireUnactivatedWriterV3Instruction = pinBuilder("buildExpireUnactivatedWriterV3Instruction", participation.buildExpireUnactivatedWriterV3Instruction);
export const buildDlmmOrderInstruction = pinBuilder("buildDlmmOrderInstruction", orders.buildDlmmOrderInstruction);
export const buildOracleEvidenceUploadInstructions = pinBuilder("buildOracleEvidenceUploadInstructions", evidence.buildOracleEvidenceUpload);
export const buildCloseOracleEvidenceDraftInstruction = pinBuilder("buildCloseOracleEvidenceDraftInstruction", evidence.buildCloseOracleEvidenceDraft);
//# sourceMappingURL=current-builders.js.map