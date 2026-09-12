import * as native from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import { AmebaProtocolError } from "../errors.js";
/** A source ABI declaration does not supply a missing or unqualified native runtime. */
export function nativeWriterDlmmV1() {
    const runtime = native;
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
    return runtime;
}
export const buildNativeBeginWriterDlmmPolicyV1Instruction = (input) => nativeWriterDlmmV1().buildBeginWriterDlmmPolicyV1Instruction(input);
export const buildNativeAppendWriterDlmmPolicySeriesV1Instruction = (input) => nativeWriterDlmmV1().buildAppendWriterDlmmPolicySeriesV1Instruction(input);
export const buildNativeSealWriterDlmmPolicyV1Instruction = (input) => nativeWriterDlmmV1().buildSealWriterDlmmPolicyV1Instruction(input);
export const buildNativeInitializeWriterDlmmPositionV1Instruction = (input) => nativeWriterDlmmV1().buildInitializeWriterDlmmPositionV1Instruction(input);
export const buildNativeAddWriterDlmmLiquidityV1Instruction = (input) => nativeWriterDlmmV1().buildAddWriterDlmmLiquidityV1Instruction(input);
export const buildNativeRemoveWriterDlmmLiquidityV1Instruction = (input) => nativeWriterDlmmV1().buildRemoveWriterDlmmLiquidityV1Instruction(input);
export const buildNativeSweepWriterDlmmCashV1Instruction = (input) => nativeWriterDlmmV1().buildSweepWriterDlmmCashV1Instruction(input);
//# sourceMappingURL=writer-dlmm-native-internal.js.map