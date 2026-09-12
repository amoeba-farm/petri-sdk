/**
 * Internal web3.js-v1 token boundary for current-protocol server modules.
 *
 * Every classic and Light token primitive comes from the published Spread
 * facade. No Kit type or external token SDK leaks into the SDK surface.
 */
import { decodeClassicMintAccount, decodeClassicTokenAccount, deriveClassicAssociatedTokenAddress, deriveLightAssociatedTokenAddress, readAuthenticatedLightAta } from "@amoeba/spread-release-tools/token-primitives";
import { Buffer } from "buffer";
export declare const ACCOUNT_SIZE: 165;
export declare const MINT_SIZE: 82;
export declare const AccountLayout: Readonly<{
    span: 165;
}>;
export declare const MintLayout: Readonly<{
    span: 82;
}>;
export declare const unpackAccount: typeof decodeClassicTokenAccount;
export declare function unpackMint(...args: Parameters<typeof decodeClassicMintAccount>): Readonly<{
    tlvData: Buffer<ArrayBuffer>;
    address: import("@solana/web3.js").PublicKey;
    mintAuthority: import("@solana/web3.js").PublicKey | null;
    supply: bigint;
    decimals: number;
    isInitialized: boolean;
    freezeAuthority: import("@solana/web3.js").PublicKey | null;
}>;
export declare const getAssociatedTokenAddressSync: typeof deriveClassicAssociatedTokenAddress;
export declare const getAssociatedTokenAddressInterface: typeof deriveLightAssociatedTokenAddress;
export declare const getCurrentLightAtaInterface: typeof readAuthenticatedLightAta;
//# sourceMappingURL=current-token-primitives.d.ts.map