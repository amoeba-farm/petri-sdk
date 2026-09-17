import { MAINNET_PROFILE } from "../mainnet/profile.js";
/** RPC mechanics and canonical codecs for G3. Business admission belongs to Lean/SBF. */
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { decodeWriterContribution } from "@amoeba/spread-release-tools/writer-participation";
import { decodeWriterSleeve } from "@amoeba/spread-release-tools/writer-sleeve-accounts";
import { decodeAmoebaDlmmPool } from "@amoeba/spread-release-tools/dlmm-accounts";
import G3_INTEGRATION_LOCK from "../../release/g3-integration-lock.v1.json" with { type: "json" };
import { resolveG3SemanticSwap } from "./semantic-swap.js";
function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("G3 object required");
    return value;
}
function exact(value, keys) {
    if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k)))
        throw new Error("G3 request fields mismatch");
}
function key(value) {
    if (typeof value !== "string")
        throw new Error("G3 address required");
    const result = new PublicKey(value);
    if (result.toBase58() !== value)
        throw new Error("G3 noncanonical address");
    return result;
}
function integer(value) {
    if (typeof value !== "string" || value.length > 20 || !/^(0|[1-9][0-9]*)$/u.test(value))
        throw new Error("G3 decimal required");
    const result = BigInt(value);
    if (result > 0xffffffffffffffffn)
        throw new Error("G3 integer overflow");
    return result;
}
/** Public intents contain addresses and canonical decimal scalars, never decoded pool/receipt facts. */
export async function resolveG3UserIntent(connection, ownerText, operation, request, minimumContextSlot = 0, network = "local-test") {
    const programId = new PublicKey(network === "mainnet-beta" ? MAINNET_PROFILE.programId : G3_INTEGRATION_LOCK.profile.programId);
    const owner = key(ownerText), r = object(request), rawAccounts = [];
    if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 0)
        throw new Error("Invalid G3 observation floor");
    let observedSlot = minimumContextSlot;
    async function read(address) {
        const result = await connection.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: observedSlot });
        if (!result.value || result.value.executable || !result.value.owner.equals(programId)
            || !Number.isSafeInteger(result.context.slot) || result.context.slot < observedSlot)
            throw new Error("G3 business account unavailable or foreign");
        observedSlot = result.context.slot;
        rawAccounts.push({ address: address.toBase58(), owner: result.value.owner.toBase58(), executable: false,
            dataBase64: result.value.data.toString("base64"), observedSlot });
        return result.value;
    }
    let builderInput;
    if (operation === "order" && r.kind === "swap") {
        builderInput = await resolveG3SemanticSwap(owner, r, programId, read);
        return { input: { operation, builderInput }, observedSlot, rawAccounts };
    }
    if (operation === "order") {
        exact(r, ["accounts", "request", "orderRecords"]);
        const supplied = object(r.accounts);
        const required = ["trader", "vaultConfig", "market", "oracleMonth", "writerSleeve", "writerSettlementGroup",
            "writerSeriesBook", "pool", "authority", "optionMint", "quoteMint", "optionVault", "quoteVault",
            "traderOptionAccount", "traderQuoteAccount", "writerPolicySnapshot", "writerSleeveUsdcVault",
            "writerMarketStaging", "writerRetirementCustody", "writerPolicyRegistry", "lightTokenProgram",
            "lightCpiAuthority", "optionInterface", "quoteInterface", "splTokenProgram", "reservePages"];
        const optional = ["lightCompressibleConfig", "lightRentSponsor"];
        if (required.some(k => !Object.hasOwn(supplied, k)) || Object.keys(supplied).some(k => ![...required, ...optional].includes(k)))
            throw new Error("G3 order account fields mismatch");
        const accounts = {};
        for (const [name, value] of Object.entries(supplied)) {
            if (name === "reservePages") {
                if (!Array.isArray(value) || value.length > 8)
                    throw new Error("G3 page window exceeded");
                accounts[name] = value.map(key);
            }
            else
                accounts[name] = key(value);
        }
        if (!accounts.trader.equals(owner))
            throw new Error("G3 trader mismatch");
        const poolKey = accounts.pool;
        const pool = decodeAmoebaDlmmPool(poolKey, (await read(poolKey)).data, programId);
        const action = object(r.request), kind = action.kind;
        const shapes = { initialize: [], closeBook: [],
            place: ["expectedSequence", "side", "limitPriceAtoms", "quantityAtoms", "postOnly"],
            cancel: ["sequence"], claim: ["sequence"], close: ["sequence"], match: ["side", "maximumFills"],
            swap: ["direction", "amountIn", "minimumAmountOut", "limitPriceAtoms", "deadlineTs"] };
        if (typeof kind !== "string" || !Object.hasOwn(shapes, kind))
            throw new Error("G3 order action invalid");
        exact(action, ["kind", ...shapes[kind]]);
        const parsed = { ...action };
        for (const name of ["expectedSequence", "sequence", "limitPriceAtoms", "quantityAtoms", "amountIn", "minimumAmountOut", "deadlineTs"])
            if (Object.hasOwn(parsed, name))
                parsed[name] = integer(parsed[name]);
        if (!Array.isArray(r.orderRecords) || r.orderRecords.length > 24)
            throw new Error("G3 order witness window exceeded");
        const orderRecords = r.orderRecords.map(key);
        // Existing records are included as raw evidence. A placement's fresh record may be absent.
        if (["cancel", "claim", "close", "match", "swap"].includes(kind))
            for (const address of orderRecords)
                await read(address);
        builderInput = { accounts, pool, request: parsed, orderRecords };
    }
    else {
        const fields = { receipt_contribute: ["sleeve", "nonce", "amountAtoms"],
            receipt_expire: ["sleeve"], receipt_transfer: ["receipt", "newOwner"],
            receipt_split: ["receipt", "newOwner", "nonce", "principalAtoms"], receipt_claim: ["receipt"], receipt_close: ["receipt"] };
        if (!Object.hasOwn(fields, operation))
            throw new Error("G3 receipt operation invalid");
        exact(r, fields[operation]);
        const lot = Object.hasOwn(r, "receipt") ? await (async () => {
            const address = key(r.receipt), info = await read(address);
            return decodeWriterContribution({ address, owner: info.owner, data: info.data, programId });
        })() : undefined;
        const sleeveKey = lot?.sleeve ?? key(r.sleeve);
        const sleeve = decodeWriterSleeve(sleeveKey, (await read(sleeveKey)).data, programId);
        const context = { vaultConfig: sleeve.vaultConfig, sleeve: sleeveKey, settlementGroup: sleeve.settlementGroup,
            seriesBook: sleeve.seriesBook, policySnapshot: sleeve.policySnapshot, usdcVault: sleeve.usdcVault, usdcMint: sleeve.settlementMint };
        switch (operation) {
            case "receipt_contribute":
                builderInput = { ...context, owner, nonce: integer(r.nonce), amountAtoms: integer(r.amountAtoms) };
                break;
            case "receipt_expire":
                builderInput = { ...context, cranker: owner };
                break;
            case "receipt_transfer":
                builderInput = { lot, newOwner: key(r.newOwner) };
                break;
            case "receipt_split":
                builderInput = { lot, newOwner: key(r.newOwner), nonce: integer(r.nonce), principalAtoms: integer(r.principalAtoms) };
                break;
            case "receipt_claim":
                builderInput = { ...context, lot };
                break;
            case "receipt_close":
                builderInput = { lot };
                break;
        }
    }
    return { input: { operation, builderInput }, observedSlot, rawAccounts };
}
//# sourceMappingURL=resolver.js.map