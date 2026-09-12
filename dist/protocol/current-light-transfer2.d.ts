import { PublicKey, TransactionInstruction } from "@solana/web3.js";
export interface CurrentLightTransfer2Expectation {
    readonly payer: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
    readonly destination: PublicKey;
    readonly amountAtoms: bigint;
}
/**
 * Validate the exact payer-bound Light v0.23.3 cold-load subset used by RC44.
 * Every batch must consume distinct authenticated token inputs and decompress
 * only into the one expected Light ATA. No token outputs, lamport movement,
 * CPI context, transaction hash, delegate, TLV, or SPL-pool path is admitted.
 */
export declare function validateCurrentLightTransfer2LoadSequence(transfers: readonly TransactionInstruction[], expected: CurrentLightTransfer2Expectation): void;
//# sourceMappingURL=current-light-transfer2.d.ts.map