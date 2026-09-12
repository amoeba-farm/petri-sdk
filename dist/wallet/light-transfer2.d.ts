/** Exact browser-native validation of the pinned Light v0.23.3 cold-load subset. */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
export interface CurrentWalletLightTransfer2Expectation {
    readonly payer: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
    readonly destination: PublicKey;
    readonly amountAtoms: bigint;
}
/**
 * Validate one complete cold balance load. Every instruction must consume
 * distinct authenticated token inputs and decompress only into the expected
 * Light ATA. No token outputs, lamports, delegate, TLV, CPI, SPL-pool, or
 * transaction-hash mode is admitted.
 */
export declare function validateCurrentWalletLightTransfer2LoadSequence(transfers: readonly TransactionInstruction[], expected: CurrentWalletLightTransfer2Expectation): void;
//# sourceMappingURL=light-transfer2.d.ts.map