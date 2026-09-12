import * as native from "@amoeba/spread-release-tools/writer-sleeve-instructions";
import { AmebaProtocolError } from "../errors.js";
function runtime() {
    const value = native;
    if ([value.projectWriterDlmmSwapPolicy, value.quoteWriterDlmmExactIn, value.planWriterDlmmSwapReservePages, value.writerDlmmExactReserve,
        value.writerDlmmPriceBounds].some(fn => typeof fn !== "function")) {
        throw new AmebaProtocolError("pinned Spread package does not provide the native writer mixed-liquidity quote helpers", {
            code: "CURRENT_WRITER_DLMM_RUNTIME_UNAVAILABLE",
        });
    }
    return value;
}
export const quoteWriterDlmmExactIn = (input) => runtime().quoteWriterDlmmExactIn(input);
export const projectWriterDlmmSwapPolicy = (input) => runtime().projectWriterDlmmSwapPolicy(input);
export const planWriterDlmmSwapReservePages = (input) => runtime().planWriterDlmmSwapReservePages(input);
export const writerDlmmExactReserve = (...args) => runtime().writerDlmmExactReserve(...args);
export const writerDlmmPriceBounds = (...args) => runtime().writerDlmmPriceBounds(...args);
export function writerCloseBookDigest(book, economicOnly = false) {
    const helper = native.writerCloseBookDigest;
    if (typeof helper !== "function")
        throw new AmebaProtocolError("pinned Spread package does not provide native writer close book commitments", {
            code: "CURRENT_WRITER_DLMM_RUNTIME_UNAVAILABLE",
        });
    return helper(book, economicOnly);
}
//# sourceMappingURL=writer-dlmm-quote.js.map