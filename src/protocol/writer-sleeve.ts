/**
 * Frozen RC44 collective-writer ABI seam.
 *
 * Spread owns every layout, PDA, ordered account meta, and instruction byte.
 * This SDK re-exports those reviewed package declarations without reproducing
 * financial arithmetic or wire encoders.
 */
export * from "@amoeba/spread-release-tools/writer-sleeve-accounts";
export { projectWriterDlmmSwapPolicy, quoteWriterDlmmExactIn, planWriterDlmmSwapReservePages, writerDlmmExactReserve, writerDlmmPriceBounds, writerCloseBookDigest } from "./writer-dlmm-quote.js";
export type { WriterDlmmMathSeries, WriterDlmmRiskLimits, WriterDlmmQuoteSeriesLimits, WriterDlmmSwapPolicy,
  WriterDlmmQuoteBin, WriterDlmmRouteConfig, WriterDlmmFillTotals, WriterDlmmRouteQuote, QuoteWriterDlmmExactInInput,
  WriterDlmmOrdinaryPage, PlanWriterDlmmSwapReservePagesInput, ProjectWriterDlmmSwapPolicyInput } from "./writer-dlmm-quote.js";
export type * from "@amoeba/spread-historical-v2/writer-sleeve-instructions";
export type { WriterDlmmSeriesPolicyV1, WriterDlmmAddEntryV1, WriterDlmmRemoveEntryV1, WriterDlmmPolicyAccountsV1,
  WriterDlmmPositionAccountsV1, WriterDlmmLiquidityAccountsV1, WriterDlmmPolicyCommitmentV1, WriterDlmmPolicyAccountV1,
  WriterDlmmPositionAccountV1, WriterDlmmPolicyHashInputV1 } from "./writer-dlmm-native-internal.js";
export { deriveWriterDlmmPolicyPda, deriveWriterDlmmPositionPda, decodeWriterDlmmPolicyV1, decodeWriterDlmmPositionV1,
  computeWriterDlmmPolicyCommitmentV1, assertWriterDlmmPolicyBindingV1 } from "./writer-dlmm.js";
export {
  WRITER_BID_STORAGE_CAPACITY,
  WRITER_CLOSE_FLAT_SENTINEL,
  WRITER_INSTRUCTION_TAGS,
  WRITER_MAX_LIVE_SERIES,
  WRITER_SERIES_STORAGE_CAPACITY,
  deriveCollectiveSettlementDelegatePda,
  derivePositionSettlementAuthorityPda,
  deriveWriterAuctionEscrowPda,
  deriveWriterAuctionPda,
  deriveWriterBidIndexPda,
  deriveWriterBidPda,
  deriveWriterCloseFlatEscrowPda,
  deriveWriterCloseRequestPda,
  deriveWriterFlatBurnCustodyPda,
  deriveWriterFlatMintPda,
  deriveWriterFlatStagingPda,
  deriveWriterPolicyRegistryPda,
  deriveWriterPolicySnapshotPda,
  deriveWriterProtocolFeeVaultPda,
  deriveWriterRetirementCustodyPda,
  deriveWriterSeriesBookPda,
  deriveWriterSettlementGroupPda,
  deriveWriterSleevePda,
  deriveWriterSleeveUsdcVaultPda,
  encodeSealWriterPolicyV1Params,
} from "@amoeba/spread-historical-v2/writer-sleeve-instructions";
export {
  buildActivateWriterSleeveV1Instruction,
  buildBeginWriterDlmmPolicyV1Instruction,
  buildAppendWriterDlmmPolicySeriesV1Instruction,
  buildSealWriterDlmmPolicyV1Instruction,
  buildInitializeWriterDlmmPositionV1Instruction,
  buildAddWriterDlmmLiquidityV1Instruction,
  buildRemoveWriterDlmmLiquidityV1Instruction,
  buildSweepWriterDlmmCashV1Instruction,
  buildBeginWriterCloseV1Instruction,
  buildCancelOrRefundWriterBidV1Instruction,
  buildClaimCollectiveLongV1Instruction,
  buildExecuteScopedCollectiveSettlementV1Instruction,
  buildClaimWriterFlatResidualV1Instruction,
  buildCleanupWriterCustodyV1Instruction,
  buildCloseWriterSleeveV1Instruction,
  buildCommitWriterAuctionV1Instruction,
  buildPrepareWriterBidIndexV1Instruction,
  buildDepositWriterCloseBasketV1Instruction,
  buildDepositWriterPrincipalV1Instruction,
  buildExecuteWriterAuctionFillV1Instruction,
  buildFinalizeOrAbortWriterAuctionV1Instruction,
  buildFinalizeWriterCloseV1Instruction,
  buildFinalizeWriterSleeveSettlementV1Instruction,
  buildInitializeWriterPolicyRegistryV1Instruction,
  buildInitializeWriterSettlementGroupV1Instruction,
  buildInitializeWriterSleeveV1Instruction,
  buildManageWriterPolicyAuthorityV1Instruction,
  buildOpenWriterFundingV1Instruction,
  buildPlaceWriterBidV1Instruction,
  buildPlanWriterAuctionChunkV1Instruction,
  buildProcessWriterCloseFlatCancellationV1Instruction,
  buildProcessWriterCloseSeriesCancellationV1Instruction,
  buildPublishWriterGroupSettlementV1Instruction,
  buildReconcileWriterSupplyV1Instruction,
  buildRegisterWriterSeriesV1Instruction,
  buildRevealWriterAuctionV1Instruction,
  buildSealWriterPolicyV1Instruction,
  buildSetCollectiveMarketPausedV1Instruction,
  buildWithdrawWriterPrincipalV1Instruction,
} from "./current-builders.js";

export const WRITER_CANONICAL_CANDIDATE_MAX = 128 as const;
export const WRITER_FUNDED_BID_MAX = 128 as const;
export const WRITER_LAYOUT_SIZES = Object.freeze({
  policyRegistry: 198,
  policySnapshot: 344,
  settlementGroup: 558,
  sleeve: 764,
  seriesRecord: 256,
  seriesBook: 8_312,
  auction: 1_534,
  bidIndexRecord: 116,
  bidIndex: 14_936,
  bid: 230,
  closeRequest: 1_088,
} as const);
export const WRITER_SHARED_FIXTURE_BYTES = 5_393 as const;
export const WRITER_SHARED_FIXTURE_SHA256 =
  "2a6da8a7d76b85cfc73e6395ade978e944679a000d4f8e181b85118b725c2f58" as const;
export const CURRENT_LIGHT_FIXTURE_AGGREGATE_SHA256 =
  "75b702570e9ca7d56450c706758c57e8d0504e6245897252ba754fbb020c6804" as const;
