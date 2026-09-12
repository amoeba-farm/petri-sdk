import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as native from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import type { WriterPolicySnapshotAccount, WriterSeriesBookAccount } from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import { AmebaProtocolError } from "../errors.js";

/** Structural declarations match Spread's writerDlmmInstructions.ts source ABI. */
export interface WriterDlmmSeriesPolicyV1 {
  readonly conservativeClaimValueAtoms: bigint; readonly sellerFloorQuoteAtoms: bigint;
  readonly monthlyBuybackCapAtoms: bigint; readonly transactionBuybackCapAtoms: bigint;
}
export interface WriterDlmmAddEntryV1 {
  readonly binId: number; readonly maximumOptionAmountAtoms: bigint; readonly maximumQuoteAmountAtoms: bigint;
}
export interface WriterDlmmRemoveEntryV1 {
  readonly binId: number; readonly optionAmountAtoms: bigint; readonly quoteAmountAtoms: bigint;
}
export interface WriterDlmmPolicyAccountsV1 {
  readonly actor: PublicKey; readonly vaultConfig: PublicKey; readonly policyRegistry: PublicKey;
  readonly sleeve: PublicKey; readonly settlementGroup: PublicKey; readonly seriesBook: PublicKey;
  readonly policySnapshot: PublicKey; readonly programId?: PublicKey;
}
export interface WriterDlmmPositionAccountsV1 {
  readonly actor: PublicKey; readonly vaultConfig: PublicKey; readonly sleeve: PublicKey;
  readonly settlementGroup: PublicKey; readonly seriesBook: PublicKey; readonly policySnapshot: PublicKey;
  readonly pool: PublicKey; readonly market: PublicKey; readonly oracleMonth: PublicKey;
  readonly seriesIndex: number; readonly programId?: PublicKey;
}
export interface WriterDlmmLiquidityAccountsV1 extends WriterDlmmPositionAccountsV1 {
  readonly optionMint: PublicKey; readonly quoteMint: PublicKey;
  readonly optionVault: PublicKey; readonly quoteVault: PublicKey; readonly sleeveUsdcVault: PublicKey;
  readonly marketStaging: PublicKey; readonly retirementCustody: PublicKey;
  readonly lightTokenProgram: PublicKey; readonly compressedTokenAuthority: PublicKey;
  readonly optionSplInterface: PublicKey; readonly quoteSplInterface: PublicKey;
  readonly splTokenProgram: PublicKey; readonly compressibleConfig: PublicKey; readonly rentSponsor: PublicKey;
}
export interface WriterDlmmPolicyCommitmentV1 {
  readonly managementAuthority: PublicKey; readonly expectedPolicyHash: Uint8Array;
  readonly monthlyBuybackCapAtoms: bigint; readonly transactionBuybackCapAtoms: bigint;
  readonly reserveReleaseSpendRatioPpm: bigint; readonly priceSeparationTicks: number;
}
export interface WriterDlmmPolicyAccountV1 extends WriterDlmmPolicyCommitmentV1 {
  readonly address: PublicKey; readonly bump: number; readonly sleeve: PublicKey; readonly policySnapshot: PublicKey;
  readonly committingPolicyAuthority: PublicKey; readonly rollingPolicyHash: Uint8Array;
  readonly seriesCount: number; readonly appendedSeriesCount: number; readonly sealed: boolean;
  readonly createdSlot: bigint; readonly sealedSlot: bigint; readonly spendingMonthStartTs: bigint;
  readonly monthlySpentAtoms: bigint; readonly totalPoolQuoteAtoms: bigint; readonly totalUncommittedQuoteAtoms: bigint;
  readonly series: readonly WriterDlmmSeriesPolicyV1[]; readonly seriesMonthlySpentAtoms: readonly bigint[];
  readonly seriesPoolInventoryAtoms: readonly bigint[];
}
export interface WriterDlmmPositionAccountV1 {
  readonly address: PublicKey; readonly bump: number; readonly pool: PublicKey; readonly sleeve: PublicKey;
  readonly policy: PublicKey; readonly market: PublicKey; readonly seriesIndex: number; readonly binCount: number;
  readonly uncommittedQuoteAtoms: bigint; readonly optionInventoryAtoms: bigint; readonly allocatedQuoteAtoms: bigint;
  readonly lastUpdatedSlot: bigint;
  readonly bins: readonly { readonly binId: number; readonly optionAtoms: bigint; readonly quoteAtoms: bigint }[];
}
export interface WriterDlmmPolicyHashInputV1 extends Omit<WriterDlmmPolicyCommitmentV1, "expectedPolicyHash"> {
  readonly sleeve: PublicKey; readonly snapshot: WriterPolicySnapshotAccount; readonly book: WriterSeriesBookAccount;
  readonly committingPolicyAuthority: PublicKey; readonly series: readonly WriterDlmmSeriesPolicyV1[];
}
interface NativeWriterDlmmRuntimeV1 {
  readonly MANAGE_WRITER_DLMM_V1_TAG: 159;
  readonly WRITER_DLMM_ACCOUNT_SIZES: { readonly policy: 1843; readonly position: 776 };
  readonly WRITER_DLMM_MAX_ACTION_ENTRIES: 8; readonly WRITER_DLMM_MAX_POSITION_BINS: 32;
  buildBeginWriterDlmmPolicyV1Instruction(input: WriterDlmmPolicyAccountsV1 & WriterDlmmPolicyCommitmentV1): TransactionInstruction;
  buildAppendWriterDlmmPolicySeriesV1Instruction(input: WriterDlmmPolicyAccountsV1 & { readonly startIndex: number; readonly entries: readonly WriterDlmmSeriesPolicyV1[] }): TransactionInstruction;
  buildSealWriterDlmmPolicyV1Instruction(input: WriterDlmmPolicyAccountsV1): TransactionInstruction;
  buildInitializeWriterDlmmPositionV1Instruction(input: WriterDlmmPositionAccountsV1): TransactionInstruction;
  buildAddWriterDlmmLiquidityV1Instruction(input: WriterDlmmLiquidityAccountsV1 & { readonly issueAmountAtoms: bigint; readonly entries: readonly WriterDlmmAddEntryV1[] }): TransactionInstruction;
  buildRemoveWriterDlmmLiquidityV1Instruction(input: WriterDlmmLiquidityAccountsV1 & { readonly entries: readonly WriterDlmmRemoveEntryV1[] }): TransactionInstruction;
  buildSweepWriterDlmmCashV1Instruction(input: WriterDlmmLiquidityAccountsV1): TransactionInstruction;
  deriveWriterDlmmPolicyPda(sleeve: PublicKey, programId?: PublicKey): [PublicKey, number];
  deriveWriterDlmmPositionPda(pool: PublicKey, sleeve: PublicKey, programId?: PublicKey): [PublicKey, number];
  decodeWriterDlmmPolicyV1(address: PublicKey, data: Uint8Array, programId?: PublicKey): WriterDlmmPolicyAccountV1;
  decodeWriterDlmmPositionV1(address: PublicKey, data: Uint8Array, programId?: PublicKey): WriterDlmmPositionAccountV1;
  computeWriterDlmmPolicyCommitmentV1(input: WriterDlmmPolicyHashInputV1): Uint8Array;
  assertWriterDlmmPolicyBindingV1(policy: WriterDlmmPolicyAccountV1, snapshot: WriterPolicySnapshotAccount, book: WriterSeriesBookAccount): void;
}

/** A source ABI declaration does not supply a missing or unqualified native runtime. */
export function nativeWriterDlmmV1(): NativeWriterDlmmRuntimeV1 {
  const runtime = native as unknown as Partial<NativeWriterDlmmRuntimeV1>;
  if (runtime.MANAGE_WRITER_DLMM_V1_TAG !== 159 || runtime.WRITER_DLMM_ACCOUNT_SIZES?.policy !== 1843
    || runtime.WRITER_DLMM_ACCOUNT_SIZES.position !== 776 || runtime.WRITER_DLMM_MAX_ACTION_ENTRIES !== 8
    || runtime.WRITER_DLMM_MAX_POSITION_BINS !== 32
    || [runtime.buildBeginWriterDlmmPolicyV1Instruction, runtime.buildAppendWriterDlmmPolicySeriesV1Instruction,
      runtime.buildSealWriterDlmmPolicyV1Instruction, runtime.buildInitializeWriterDlmmPositionV1Instruction,
      runtime.buildAddWriterDlmmLiquidityV1Instruction, runtime.buildRemoveWriterDlmmLiquidityV1Instruction,
      runtime.buildSweepWriterDlmmCashV1Instruction, runtime.deriveWriterDlmmPolicyPda, runtime.deriveWriterDlmmPositionPda,
      runtime.decodeWriterDlmmPolicyV1, runtime.decodeWriterDlmmPositionV1,
      runtime.computeWriterDlmmPolicyCommitmentV1, runtime.assertWriterDlmmPolicyBindingV1].some(value => typeof value !== "function")) {
    throw new AmebaProtocolError("pinned Spread package does not provide the writer DLMM ABI; a qualified native package release is required", {
      code: "CURRENT_WRITER_DLMM_RUNTIME_UNAVAILABLE",
    });
  }
  return runtime as NativeWriterDlmmRuntimeV1;
}

export const buildNativeBeginWriterDlmmPolicyV1Instruction = (input: Parameters<NativeWriterDlmmRuntimeV1["buildBeginWriterDlmmPolicyV1Instruction"]>[0]) => nativeWriterDlmmV1().buildBeginWriterDlmmPolicyV1Instruction(input);
export const buildNativeAppendWriterDlmmPolicySeriesV1Instruction = (input: Parameters<NativeWriterDlmmRuntimeV1["buildAppendWriterDlmmPolicySeriesV1Instruction"]>[0]) => nativeWriterDlmmV1().buildAppendWriterDlmmPolicySeriesV1Instruction(input);
export const buildNativeSealWriterDlmmPolicyV1Instruction = (input: WriterDlmmPolicyAccountsV1) => nativeWriterDlmmV1().buildSealWriterDlmmPolicyV1Instruction(input);
export const buildNativeInitializeWriterDlmmPositionV1Instruction = (input: WriterDlmmPositionAccountsV1) => nativeWriterDlmmV1().buildInitializeWriterDlmmPositionV1Instruction(input);
export const buildNativeAddWriterDlmmLiquidityV1Instruction = (input: Parameters<NativeWriterDlmmRuntimeV1["buildAddWriterDlmmLiquidityV1Instruction"]>[0]) => nativeWriterDlmmV1().buildAddWriterDlmmLiquidityV1Instruction(input);
export const buildNativeRemoveWriterDlmmLiquidityV1Instruction = (input: Parameters<NativeWriterDlmmRuntimeV1["buildRemoveWriterDlmmLiquidityV1Instruction"]>[0]) => nativeWriterDlmmV1().buildRemoveWriterDlmmLiquidityV1Instruction(input);
export const buildNativeSweepWriterDlmmCashV1Instruction = (input: WriterDlmmLiquidityAccountsV1) => nativeWriterDlmmV1().buildSweepWriterDlmmCashV1Instruction(input);
