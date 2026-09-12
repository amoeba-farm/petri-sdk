/** Browser-native identity decoding for the sleeve-owned writer liquidity lane. */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import type { WriterDlmmPolicyAccountV1, WriterDlmmPositionAccountV1 } from "../protocol/writer-dlmm-native-internal.js";
type Accounts = ReadonlyMap<string, AccountInfo<Uint8Array> | null>;
export declare const deriveWalletWriterDlmmPolicy: (sleeve: PublicKey) => PublicKey;
export declare const deriveWalletWriterDlmmPosition: (pool: PublicKey, sleeve: PublicKey) => PublicKey;
export declare function decodeWalletWriterDlmmPolicy(address: PublicKey, accounts: Accounts): WriterDlmmPolicyAccountV1;
export declare function decodeWalletWriterDlmmPosition(address: PublicKey, accounts: Accounts): WriterDlmmPositionAccountV1;
export declare function decodeWalletWriterPolicyRegistry(address: PublicKey, accounts: Accounts): Readonly<{
    address: PublicKey;
    vaultConfig: PublicKey;
    policyAuthority: PublicKey;
}>;
export declare function decodeWalletWriterPolicySnapshot(address: PublicKey, accounts: Accounts): Readonly<{
    address: PublicKey;
    sleeve: PublicKey;
    registry: PublicKey;
    policyVersion: bigint;
    policyHash: Uint8Array<ArrayBufferLike>;
    seriesFamilyHash: Uint8Array<ArrayBufferLike>;
    createdSlot: bigint;
    sealedSlot: bigint;
}>;
export {};
//# sourceMappingURL=writer-dlmm-accounts.d.ts.map