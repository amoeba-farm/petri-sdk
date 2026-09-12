/** Canonical unsigned v0 transaction compilation for one reconstructed wallet batch. */
import { PublicKey, type TransactionInstruction, type AddressLookupTableAccount } from "@solana/web3.js";
export interface CompiledCurrentWalletUnsignedBatch {
    readonly messageSha256: string;
    readonly unsignedTransactionSha256: string;
    readonly unsignedTransactionBytes: Uint8Array;
}
export declare function compileCurrentWalletUnsignedBatch(owner: PublicKey, recentBlockhash: string, instructions: readonly TransactionInstruction[], lookupTables?: readonly AddressLookupTableAccount[]): CompiledCurrentWalletUnsignedBatch;
//# sourceMappingURL=transaction.d.ts.map