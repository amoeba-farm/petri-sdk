/** Minimal browser-native decoders for the RC44 collective DLMM swap state. */
import { PublicKey } from "@solana/web3.js";
import { equalBytes, readU16Le, readU32Le, readU64Le, walletError } from "./codec.js";
import { CURRENT_PROGRAM_ID, deriveDlmmBinPage, deriveDlmmPool, } from "./manifest.js";
const TEXT = new TextEncoder();
const POOL_DISCRIMINATOR = TEXT.encode("ADPOOLV1");
const POOL_ACCOUNT_DISCRIMINATOR = TEXT.encode("ADP");
const PAGE_DISCRIMINATOR = TEXT.encode("ADPAGEV1");
const PAGE_ACCOUNT_DISCRIMINATOR = TEXT.encode("ABP");
const POOL_ACCOUNT_SIZE = 364;
const BINS_PER_PAGE = 32;
const MAX_BINS = 2_048;
const MAX_PAGES = 64;
export function decodeCurrentWalletDlmmPool(address, accounts) {
    const { reader, bump } = start(requireProgramAccount(accounts, address, POOL_ACCOUNT_SIZE, "DLMM pool"), POOL_DISCRIMINATOR, POOL_ACCOUNT_DISCRIMINATOR, "DLMM pool");
    const market = reader.pubkey();
    const oracleMonth = reader.pubkey();
    const liquidityManager = reader.pubkey();
    const optionMint = reader.pubkey();
    const quoteMint = reader.pubkey();
    const optionVault = reader.pubkey();
    const quoteVault = reader.pubkey();
    const expiryTs = reader.u64();
    const tickSize = reader.u64();
    const maximumPrice = reader.u64();
    const maximumBinId = reader.u16();
    const bestBidBinId = reader.u16();
    const bestAskBinId = reader.u16();
    const lastTradeBinId = reader.u16();
    const initializedPages = bitmapPages(reader.u64());
    const bidPages = bitmapPages(reader.u64());
    const askPages = bitmapPages(reader.u64());
    const maximumBinsPerSwap = reader.u8();
    reader.u64();
    reader.u64();
    reader.u32();
    const status = reader.u8();
    reader.u64();
    reader.u64();
    reader.u64();
    const expectedPool = deriveDlmmPool(market);
    const expectedBump = PublicKey.findProgramAddressSync([TEXT.encode("ameba-spread-v2"), TEXT.encode("ameba-dlmm-pool-v1"), market.toBytes()], CURRENT_PROGRAM_ID)[1];
    const maximumPage = maximumBinId === 0 ? -1 : Math.floor((maximumBinId - 1) / BINS_PER_PAGE);
    const bestBidPage = bestBidBinId === 0 ? null : Math.floor((bestBidBinId - 1) / BINS_PER_PAGE);
    const bestAskPage = bestAskBinId === 0 ? null : Math.floor((bestAskBinId - 1) / BINS_PER_PAGE);
    if (!address.equals(expectedPool) || bump !== expectedBump || optionMint.equals(quoteMint)
        || optionVault.equals(quoteVault) || expiryTs === 0n || tickSize === 0n
        || maximumBinId < 1 || maximumBinId > MAX_BINS
        || maximumPrice !== tickSize * BigInt(maximumBinId)
        || maximumBinsPerSwap < 1 || maximumBinsPerSwap > 8 || status > 4
        || initializedPages.some((page) => page > maximumPage)
        || bidPages.some((page) => !initializedPages.includes(page))
        || askPages.some((page) => !initializedPages.includes(page))
        || (bidPages.length === 0) !== (bestBidBinId === 0)
        || (askPages.length === 0) !== (bestAskBinId === 0)
        || (bestBidBinId !== 0 && (bestBidBinId > maximumBinId || bestBidPage !== bidPages.at(-1)))
        || (bestAskBinId !== 0 && (bestAskBinId > maximumBinId || bestAskPage !== askPages[0]))
        || (lastTradeBinId !== 0 && lastTradeBinId > maximumBinId)) {
        invalid("DLMM pool identity or invariants are invalid");
    }
    return Object.freeze({
        address, market, oracleMonth, liquidityManager, expiryTs, optionMint, quoteMint, optionVault, quoteVault,
        maximumBinId, initializedPages: Object.freeze(initializedPages),
        bidPages: Object.freeze(bidPages), askPages: Object.freeze(askPages), status,
    });
}
export function decodeCurrentWalletDlmmPage(address, accounts) {
    const { reader, bump } = start(requireProgramAccount(accounts, address, 602, "DLMM page"), PAGE_DISCRIMINATOR, PAGE_ACCOUNT_DISCRIMINATOR, "DLMM page");
    const pool = reader.pubkey();
    const pageIndex = reader.u16();
    const firstBinId = reader.u16();
    const bidBitmap = reader.u32();
    const askBitmap = reader.u32();
    const optionReserve = Array.from({ length: BINS_PER_PAGE }, () => reader.u64());
    const quoteReserve = Array.from({ length: BINS_PER_PAGE }, () => reader.u64());
    reader.u64();
    const expectedBump = PublicKey.findProgramAddressSync([
        TEXT.encode("ameba-spread-v2"), TEXT.encode("ameba-dlmm-page-v1"), pool.toBytes(),
        Uint8Array.of(pageIndex & 0xff, pageIndex >>> 8),
    ], CURRENT_PROGRAM_ID)[1];
    let expectedBid = 0;
    let expectedAsk = 0;
    for (let index = 0; index < BINS_PER_PAGE; index += 1) {
        if (quoteReserve[index] > 0n)
            expectedBid = (expectedBid | (1 << index)) >>> 0;
        if (optionReserve[index] > 0n)
            expectedAsk = (expectedAsk | (1 << index)) >>> 0;
    }
    if (!address.equals(deriveDlmmBinPage(pool, pageIndex)) || bump !== expectedBump
        || pageIndex >= MAX_PAGES || firstBinId !== pageIndex * BINS_PER_PAGE + 1
        || bidBitmap !== expectedBid || askBitmap !== expectedAsk) {
        invalid("DLMM page identity or reserve bitmaps are invalid");
    }
    return Object.freeze({ address, pool, pageIndex, bidBitmap, askBitmap });
}
function requireProgramAccount(accounts, address, size, label) {
    const info = accounts.get(address.toBase58());
    if (info === null || info === undefined || info.executable
        || !info.owner.equals(CURRENT_PROGRAM_ID) || info.data.length !== size) {
        invalid(`${label} is absent or has a noncanonical owner/layout`);
    }
    return info.data;
}
function start(bytes, outer, inner, label) {
    if (!equalBytes(bytes.subarray(0, 8), outer))
        invalid(`${label} outer discriminator is invalid`);
    const reader = new Reader(bytes.subarray(8));
    if (reader.u8() !== 1)
        invalid(`${label} is uninitialized or terminal`);
    const bump = reader.u8();
    if (!equalBytes(reader.bytes(3), inner) || reader.u8() !== 1) {
        invalid(`${label} embedded discriminator/version is invalid`);
    }
    return Object.freeze({ reader, bump });
}
function bitmapPages(bitmap) {
    const result = [];
    for (let index = 0; index < 64; index += 1)
        if ((bitmap & (1n << BigInt(index))) !== 0n)
            result.push(index);
    return result;
}
class Reader {
    #bytes;
    #offset = 0;
    constructor(bytes) { this.#bytes = bytes; }
    bytes(length) {
        if (!Number.isSafeInteger(length) || length < 0 || this.#offset + length > this.#bytes.length) {
            invalid("DLMM account is truncated");
        }
        const value = this.#bytes.subarray(this.#offset, this.#offset + length);
        this.#offset += length;
        return value;
    }
    u8() { return this.bytes(1)[0]; }
    u16() { const value = readU16Le(this.#bytes, this.#offset); this.#offset += 2; return value; }
    u32() { const value = readU32Le(this.#bytes, this.#offset); this.#offset += 4; return value; }
    u64() { const value = readU64Le(this.#bytes, this.#offset); this.#offset += 8; return value; }
    pubkey() { return new PublicKey(this.bytes(32)); }
}
function invalid(message) {
    walletError("CURRENT_WALLET_ACCOUNT_INVALID", message);
}
//# sourceMappingURL=swap-accounts.js.map