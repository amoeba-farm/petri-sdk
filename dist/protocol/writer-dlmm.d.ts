import { nativeWriterDlmmV1 } from "./writer-dlmm-native-internal.js";
/** Spread owns account decoding, canonical PDA derivation and policy commitments. */
type NativeWriterDlmm = ReturnType<typeof nativeWriterDlmmV1>;
export declare const deriveWriterDlmmPolicyPda: (...args: Parameters<NativeWriterDlmm["deriveWriterDlmmPolicyPda"]>) => [import("@solana/web3.js").PublicKey, number];
export declare const deriveWriterDlmmPositionPda: (...args: Parameters<NativeWriterDlmm["deriveWriterDlmmPositionPda"]>) => [import("@solana/web3.js").PublicKey, number];
export declare const decodeWriterDlmmPolicyV1: (...args: Parameters<NativeWriterDlmm["decodeWriterDlmmPolicyV1"]>) => import("./writer-dlmm-native-internal.js").WriterDlmmPolicyAccountV1;
export declare const decodeWriterDlmmPositionV1: (...args: Parameters<NativeWriterDlmm["decodeWriterDlmmPositionV1"]>) => import("./writer-dlmm-native-internal.js").WriterDlmmPositionAccountV1;
export declare const computeWriterDlmmPolicyCommitmentV1: (...args: Parameters<NativeWriterDlmm["computeWriterDlmmPolicyCommitmentV1"]>) => Uint8Array<ArrayBufferLike>;
export declare const assertWriterDlmmPolicyBindingV1: (...args: Parameters<NativeWriterDlmm["assertWriterDlmmPolicyBindingV1"]>) => void;
export {};
//# sourceMappingURL=writer-dlmm.d.ts.map