import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
/** G3 Market::LEN=279: the six retired fee bytes are absent, not zero-filled. */
export declare function decodeG3Market(address: PublicKey, data: Buffer, programId: PublicKey): {
    marketId: Buffer<ArrayBufferLike>;
    underlyingId: Buffer<ArrayBufferLike>;
    expiryTs: bigint;
    maxPayoutPerContract: bigint;
    tickSize: bigint;
    collateralMint: PublicKey;
    longContractMint: PublicKey;
};
//# sourceMappingURL=market.d.ts.map