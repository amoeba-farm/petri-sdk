import { nativeWriterDlmmV1 } from "./writer-dlmm-native-internal.js";

/** Spread owns account decoding, canonical PDA derivation and policy commitments. */
type NativeWriterDlmm = ReturnType<typeof nativeWriterDlmmV1>;
export const deriveWriterDlmmPolicyPda = (...args: Parameters<NativeWriterDlmm["deriveWriterDlmmPolicyPda"]>) => nativeWriterDlmmV1().deriveWriterDlmmPolicyPda(...args);
export const deriveWriterDlmmPositionPda = (...args: Parameters<NativeWriterDlmm["deriveWriterDlmmPositionPda"]>) => nativeWriterDlmmV1().deriveWriterDlmmPositionPda(...args);
export const decodeWriterDlmmPolicyV1 = (...args: Parameters<NativeWriterDlmm["decodeWriterDlmmPolicyV1"]>) => nativeWriterDlmmV1().decodeWriterDlmmPolicyV1(...args);
export const decodeWriterDlmmPositionV1 = (...args: Parameters<NativeWriterDlmm["decodeWriterDlmmPositionV1"]>) => nativeWriterDlmmV1().decodeWriterDlmmPositionV1(...args);
export const computeWriterDlmmPolicyCommitmentV1 = (...args: Parameters<NativeWriterDlmm["computeWriterDlmmPolicyCommitmentV1"]>) => nativeWriterDlmmV1().computeWriterDlmmPolicyCommitmentV1(...args);
export const assertWriterDlmmPolicyBindingV1 = (...args: Parameters<NativeWriterDlmm["assertWriterDlmmPolicyBindingV1"]>) => nativeWriterDlmmV1().assertWriterDlmmPolicyBindingV1(...args);
