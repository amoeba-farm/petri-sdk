import { PublicKey } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { validateCurrentWriterDlmmRequest } from "./writer-dlmm-public.js";
/** Independent semantic checks against Spread's bounded ManageWriterDlmmV1 wire. */
const SELECTOR = Object.freeze({
    writer_liquidity_policy_begin: 0, writer_liquidity_policy_append: 1, writer_liquidity_policy_seal: 2,
    writer_liquidity_initialize: 3, writer_liquidity_add: 4, writer_liquidity_remove: 5, writer_liquidity_sweep: 6,
});
function invalid(message) {
    throw new AmebaProtocolError(message, { code: "WRITER_PLAN_SEMANTIC_MISMATCH" });
}
export function requireWriterDlmmWireBindingV1(operation, semantic, instruction) {
    if (Object.hasOwn(semantic, "operation"))
        invalid("writer liquidity semantic cannot override its operation");
    const request = validateCurrentWriterDlmmRequest({ ...semantic, operation });
    const selector = SELECTOR[operation];
    const policy = selector <= 2;
    const count = policy ? 9 : selector === 3 ? 12 : 27;
    const writable = policy ? [0, 7] : selector === 3 ? [0, 7, 8]
        : [0, 2, 4, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18, 21, 22, 26];
    if (instruction.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID || instruction.keys.length !== count
        || new Set(instruction.keys.map(meta => meta.pubkey.toBase58())).size !== count
        || instruction.keys.some((meta, index) => meta.isSigner !== (index === 0) || meta.isWritable !== writable.includes(index))) {
        invalid("writer liquidity core account grammar differs from native source");
    }
    if (instruction.keys[0].pubkey.toBase58() !== request.owner
        || instruction.keys[policy ? 3 : 2].pubkey.toBase58() !== request.sleeve
        || !instruction.keys[policy ? 8 : selector === 3 ? 11 : 24].pubkey.equals(PublicKey.default)) {
        invalid("writer liquidity actor, sleeve or system program differs");
    }
    const bytes = instruction.data;
    let offset = 0;
    const take = (length) => {
        if (offset + length > bytes.length)
            invalid("writer liquidity payload is truncated");
        const result = bytes.subarray(offset, offset + length);
        offset += length;
        return result;
    };
    const integer = (size) => {
        const value = take(size);
        let result = 0;
        for (let index = 0; index < size; index += 1)
            result += value[index] * 2 ** (8 * index);
        return result;
    };
    const amount = (expected) => {
        const value = take(8);
        let result = 0n;
        for (let index = 7; index >= 0; index -= 1)
            result = result * 256n + BigInt(value[index]);
        if (result.toString() !== expected)
            invalid("writer liquidity amount differs from requested semantic");
    };
    const number = (size, expected) => {
        if (integer(size) !== expected)
            invalid("writer liquidity integer differs from requested semantic");
    };
    number(1, 159);
    number(1, selector);
    if (request.operation === "writer_liquidity_policy_begin") {
        if (new PublicKey(take(32)).toBase58() !== request.managementAuthority
            || [...take(32)].map(byte => byte.toString(16).padStart(2, "0")).join("") !== request.expectedPolicyHash) {
            invalid("writer liquidity policy commitment differs from requested semantic");
        }
        amount(request.monthlyBuybackCapAtoms);
        amount(request.transactionBuybackCapAtoms);
        amount(request.reserveReleaseSpendRatioPpm);
        number(2, request.priceSeparationTicks);
    }
    else if (request.operation === "writer_liquidity_policy_append") {
        number(1, request.startIndex);
        number(4, request.entries.length);
        for (const entry of request.entries) {
            amount(entry.conservativeClaimValueAtoms);
            amount(entry.sellerFloorQuoteAtoms);
            amount(entry.monthlyBuybackCapAtoms);
            amount(entry.transactionBuybackCapAtoms);
        }
    }
    else if (request.operation !== "writer_liquidity_policy_seal") {
        number(1, request.seriesIndex);
        if (request.operation === "writer_liquidity_add") {
            amount(request.issueAmountAtoms);
            number(4, request.entries.length);
            for (const entry of request.entries) {
                number(2, entry.binId);
                amount(entry.maximumOptionAmountAtoms);
                amount(entry.maximumQuoteAmountAtoms);
            }
        }
        else if (request.operation === "writer_liquidity_remove") {
            number(4, request.entries.length);
            for (const entry of request.entries) {
                number(2, entry.binId);
                amount(entry.optionAmountAtoms);
                amount(entry.quoteAmountAtoms);
            }
        }
    }
    if (offset !== bytes.length)
        invalid("writer liquidity payload has trailing bytes");
    return request;
}
//# sourceMappingURL=writer-dlmm-wire.js.map