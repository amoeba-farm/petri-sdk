import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { deriveMarketPda } from "@amoeba/spread-release-tools/oracle-dlmm";
/** G3 Market::LEN=279: the six retired fee bytes are absent, not zero-filled. */
export function decodeG3Market(address, data, programId) {
    if (data.length !== 279 || data[0] !== 1 || data[98] !== 1 || data[203] > 1 || data[204] !== 0
        || data[246] > 1 || data.subarray(247, 250).toString() !== "MNT" || data[250] !== 1 || data[251] !== 6
        || data.subarray(252, 255).some(b => b !== 0))
        throw new Error("G3 market layout invalid");
    const marketId = data.subarray(34, 66), underlyingId = data.subarray(131, 163), expiryTs = data.readBigUInt64LE(163);
    if (!deriveMarketPda(marketId, programId).equals(address))
        throw new Error("G3 market PDA invalid");
    if (PublicKey.findProgramAddressSync([Buffer.from("ameba-spread-v2"), Buffer.from("g3-market"), marketId], programId)[1] !== data[1])
        throw new Error("G3 market bump invalid");
    const strike = data.readBigUInt64LE(171), cap = data.readBigUInt64LE(179), size = data.readBigUInt64LE(187), max = data.readBigUInt64LE(195);
    const width = data[203] === 0 ? cap - strike : strike - cap;
    if (new PublicKey(data.subarray(2, 34)).equals(PublicKey.default) || expiryTs === 0n || size === 0n || width <= 0n
        || width * size / 1000000n !== max || max === 0n || max % 50000n !== 0n || max / 50000n > 2048n
        || data.readBigUInt64LE(205) !== 50000n || data.readBigUInt64LE(213) !== 1n || data.readBigUInt64LE(221) !== 1n || data[237] !== 8
        || data.readBigUInt64LE(271) > data.readBigUInt64LE(263) || data.readBigUInt64LE(263) > data.readBigUInt64LE(255))
        throw new Error("G3 market invariants invalid");
    return { marketId, underlyingId, expiryTs, maxPayoutPerContract: max, tickSize: 50000n, collateralMint: new PublicKey(data.subarray(66, 98)), longContractMint: new PublicKey(data.subarray(99, 131)) };
}
//# sourceMappingURL=market.js.map