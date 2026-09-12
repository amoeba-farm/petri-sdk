/** Minimal browser-native decoders for the RC44 collective DLMM swap state. */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
export interface CurrentWalletDlmmPool {
    readonly address: PublicKey;
    readonly market: PublicKey;
    readonly oracleMonth: PublicKey;
    readonly liquidityManager: PublicKey;
    readonly expiryTs: bigint;
    readonly optionMint: PublicKey;
    readonly quoteMint: PublicKey;
    readonly optionVault: PublicKey;
    readonly quoteVault: PublicKey;
    readonly maximumBinId: number;
    readonly initializedPages: readonly number[];
    readonly bidPages: readonly number[];
    readonly askPages: readonly number[];
    readonly status: number;
}
export interface CurrentWalletDlmmPage {
    readonly address: PublicKey;
    readonly pool: PublicKey;
    readonly pageIndex: number;
    readonly bidBitmap: number;
    readonly askBitmap: number;
}
export declare function decodeCurrentWalletDlmmPool(address: PublicKey, accounts: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): CurrentWalletDlmmPool;
export declare function decodeCurrentWalletDlmmPage(address: PublicKey, accounts: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): CurrentWalletDlmmPage;
//# sourceMappingURL=swap-accounts.d.ts.map