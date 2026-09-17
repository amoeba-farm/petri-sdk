import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { decodeG3Market } from "./market.js";
import { decodeAmoebaDlmmPool, deriveAmoebaDlmmPoolPda, deriveAmoebaDlmmAuthorityPda, deriveAmoebaDlmmBinPagePda } from "@amoeba/spread-release-tools/dlmm-accounts";
import { decodeWriterSleeve } from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import { deriveWriterSettlementGroupPda, deriveWriterSleevePda, deriveWriterRetirementCustodyPda } from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import { deriveContractMintStagingPda, deriveLightSplInterfacePda } from "@amoeba/spread-release-tools/oracle-dlmm";
import { deriveLightAssociatedTokenAddress, CURRENT_LIGHT_TOKEN_PROGRAM_ID, CLASSIC_SPL_TOKEN_PROGRAM_ID } from "@amoeba/spread-release-tools/token-primitives";
import { decodeDlmmOrderBook, decodeDlmmOrderRecord, deriveDlmmOrderBookPda, deriveDlmmOrderRecordPda } from "@amoeba/spread-release-tools/dlmm-orders";
/** Resolve the original wallet intent. No client-supplied account metas or decoded state. */
export async function resolveG3SemanticSwap(owner, request, programId, read) {
    const fields = ["kind", "market", "direction", "amountIn", "minimumAmountOut", "limitPriceAtoms", "deadlineTs"];
    if (Object.keys(request).length !== fields.length || fields.some(k => !Object.hasOwn(request, k))
        || request.kind !== "swap" || !["QuoteForOption", "OptionForQuote"].includes(String(request.direction)))
        throw new Error("G3 semantic swap fields invalid");
    const integer = (field) => {
        const value = request[field];
        if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 0xffffffffffffffffn)
            throw new Error("G3 semantic swap amount invalid");
        return BigInt(value);
    };
    if (typeof request.market !== "string")
        throw new Error("G3 market required");
    const marketAddress = new PublicKey(request.market);
    if (marketAddress.toBase58() !== request.market)
        throw new Error("G3 market noncanonical");
    const marketInfo = await read(marketAddress);
    const market = decodeG3Market(marketAddress, marketInfo.data, programId);
    const poolAddress = deriveAmoebaDlmmPoolPda(marketAddress, programId)[0];
    const pool = decodeAmoebaDlmmPool(poolAddress, (await read(poolAddress)).data, programId);
    if (!pool.ordersEnabled || pool.expiryTs !== market.expiryTs || !pool.quoteMint.equals(market.collateralMint)
        || pool.maximumPriceQuoteAtomic !== market.maxPayoutPerContract || pool.tickSizeQuoteAtomic !== market.tickSize
        || !market.longContractMint || !pool.optionMint.equals(market.longContractMint))
        throw new Error("G3 order market binding invalid");
    const group = deriveWriterSettlementGroupPda(market.underlyingId, market.expiryTs, market.collateralMint, programId)[0];
    const sleeveAddress = deriveWriterSleevePda(group, programId)[0];
    const sleeve = decodeWriterSleeve(sleeveAddress, (await read(sleeveAddress)).data, programId);
    if (!sleeve.settlementGroup.equals(group) || !sleeve.settlementMint.equals(pool.quoteMint))
        throw new Error("G3 sleeve binding invalid");
    const reservePages = [];
    // Match native swap routing: asks ascend for buys; bids descend for sells.
    const routeBitmap = request.direction === "QuoteForOption" ? pool.askPageBitmap : pool.bidPageBitmap;
    for (let i = 0; i < 64; i++)
        if ((routeBitmap[0] & (1n << BigInt(i))) !== 0n)
            reservePages.push(deriveAmoebaDlmmBinPagePda(poolAddress, i, programId)[0]);
    if (reservePages.length > 8)
        throw new Error("G3 semantic swap page window exceeded");
    if (request.direction === "OptionForQuote")
        reservePages.reverse();
    for (const page of reservePages)
        await read(page);
    const bookAddress = deriveDlmmOrderBookPda(poolAddress, programId)[0];
    const bookInfo = await read(bookAddress);
    const book = decodeDlmmOrderBook({ address: bookAddress, ...bookInfo, pool, programId });
    const orderRecords = [];
    const seen = new Set();
    for (const [side, head] of [["Bid", book.bidHead], ["Ask", book.askHead]]) {
        let sequence = head;
        let previous = 0n;
        while (sequence !== 0n) {
            if (orderRecords.length >= 24 || seen.has(sequence.toString()))
                throw new Error("G3 semantic swap record window exceeded");
            seen.add(sequence.toString());
            const address = deriveDlmmOrderRecordPda(bookAddress, sequence, programId)[0];
            const record = decodeDlmmOrderRecord({ address, ...await read(address), book, pool, programId });
            if (record.side !== side || record.previous !== previous)
                throw new Error("G3 order linked list invalid");
            orderRecords.push(address);
            previous = sequence;
            sequence = record.next;
        }
    }
    return { pool, orderRecords, request: { kind: "swap", direction: request.direction,
            amountIn: integer("amountIn"), minimumAmountOut: integer("minimumAmountOut"), limitPriceAtoms: integer("limitPriceAtoms"), deadlineTs: integer("deadlineTs") },
        accounts: { trader: owner, vaultConfig: sleeve.vaultConfig, market: marketAddress, oracleMonth: pool.oracleMonth,
            writerSleeve: sleeveAddress, writerSettlementGroup: group, writerSeriesBook: sleeve.seriesBook, pool: poolAddress,
            authority: deriveAmoebaDlmmAuthorityPda(poolAddress, programId)[0], optionMint: pool.optionMint, quoteMint: pool.quoteMint,
            optionVault: pool.optionVault, quoteVault: pool.quoteVault,
            traderOptionAccount: deriveLightAssociatedTokenAddress(pool.optionMint, owner), traderQuoteAccount: deriveLightAssociatedTokenAddress(pool.quoteMint, owner),
            writerPolicySnapshot: sleeve.policySnapshot, writerSleeveUsdcVault: sleeve.usdcVault,
            writerMarketStaging: deriveContractMintStagingPda({ marketPda: marketAddress, programId }), writerRetirementCustody: deriveWriterRetirementCustodyPda(sleeveAddress, marketAddress, programId)[0],
            writerPolicyRegistry: sleeve.policyRegistry, lightTokenProgram: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
            lightCpiAuthority: PublicKey.findProgramAddressSync([Buffer.from("cpi_authority")], programId)[0],
            optionInterface: deriveLightSplInterfacePda(pool.optionMint), quoteInterface: deriveLightSplInterfacePda(pool.quoteMint),
            splTokenProgram: CLASSIC_SPL_TOKEN_PROGRAM_ID, reservePages } };
}
//# sourceMappingURL=semantic-swap.js.map