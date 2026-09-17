import { Buffer } from "buffer";
export { materializeMainnetG3Plan } from "./mainnet-browser.js";
export { validateG3SignedMessage } from "./transaction.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
export const G3_ORDER_COMPUTE_UNITS = 1_000_000;
/** Exact zero-priority-fee compute prefix for the bounded order route. */
export function g3BusinessInstructions(operation, instructions) {
    if (operation !== "order") {
        if (instructions.length !== 1)
            throw new Error("G3 receipt requires one instruction");
        return instructions;
    }
    const expected = ComputeBudgetProgram.setComputeUnitLimit({ units: G3_ORDER_COMPUTE_UNITS });
    const budget = instructions[0];
    if (instructions.length !== 2 || !budget?.programId.equals(expected.programId) || budget.keys.length !== 0
        || !Buffer.from(budget.data).equals(expected.data))
        throw new Error("G3 order compute budget mismatch");
    return instructions.slice(1);
}
import { assertAmoebaGovernanceEnvelopeV1, RETIRED_AMOEBA_INSTRUCTION_TAGS } from "@amoeba/spread-release-tools/governance-gate";
import manifest from "../../release/g3-instruction-manifest.v1.json" with { type: "json" };
const currentTags = new Set(manifest.tags.filter(t => t.default_class === "RecognizedMutating").map(t => t.byte));
/** Inspect the authenticated business view, preserving the AMG3/AGV1 separation. */
export function inspectG3Instruction(instruction, context) {
    const { legacyData: data, legacyKeys: accounts } = assertAmoebaGovernanceEnvelopeV1(instruction, context);
    const tag = data[0];
    if (RETIRED_AMOEBA_INSTRUCTION_TAGS.includes(tag))
        throw new Error("G3_OPERATION_RETIRED");
    if (!currentTags.has(tag))
        throw new Error("G3_INSTRUCTION_UNASSIGNED_OR_DISABLED");
    const quantities = {};
    let family = "current-protocol";
    let action = `tag-${tag}`;
    if (tag === 160) {
        family = "writer-receipt";
        const names = ["retired", "contribute", "transfer", "split", "claim", "close", "expire-never-active"];
        const lengths = [0, 18, 2, 18, 2, 2, 2];
        const selector = data[1];
        if (selector < 1 || selector > 6 || data.length !== lengths[selector])
            throw new Error("invalid receipt selector/payload");
        action = names[selector];
        if (selector === 1 || selector === 3) {
            quantities.nonce = data.readBigUInt64LE(2).toString();
            quantities.principalAtoms = data.readBigUInt64LE(10).toString();
            if (quantities.principalAtoms === "0")
                throw new Error("zero receipt principal");
        }
    }
    else if (tag === 188) {
        family = "public-order";
        const names = ["initialize-book", "place", "cancel", "claim", "close", "match", "swap", "close-book"];
        const lengths = [2, 22, 10, 10, 10, 4, 29, 2];
        const selector = data[1];
        if (selector > 7 || data.length !== lengths[selector])
            throw new Error("invalid public-order selector/payload");
        if (selector === 1 && (data[10] > 1 || data[21] > 1))
            throw new Error("invalid order side/post-only flag");
        action = names[selector];
        if (selector === 1) {
            quantities.sequence = data.readBigUInt64LE(2).toString();
            quantities.limitBin = data.readUInt16LE(11).toString();
            quantities.quantityAtoms = data.readBigUInt64LE(13).toString();
            if (quantities.quantityAtoms === "0")
                throw new Error("zero order quantity");
        }
        if (selector === 5 && (data[2] > 1 || data[3] < 1 || data[3] > 8))
            throw new Error("invalid matching window");
        if (selector === 6) {
            if (data[2] > 1)
                throw new Error("invalid swap direction");
            quantities.amountIn = data.readBigUInt64LE(3).toString();
            quantities.minimumAmountOut = data.readBigUInt64LE(11).toString();
            quantities.deadlineTs = data.readBigUInt64LE(21).toString();
            if (quantities.amountIn === "0" || quantities.minimumAmountOut === "0")
                throw new Error("zero swap amount");
        }
    }
    else if (tag === 30 && data[1] === 18) {
        family = "oracle-council";
        if (data.length !== 113 || !Buffer.from(data.subarray(2, 6)).equals(Buffer.from("CV01")))
            throw new Error("invalid council payload");
        if (data[6] > 3 || data[7] > 3 || data[112] > 2)
            throw new Error("invalid council selector");
        action = ["open-case", "vote", "apply", "abort-stale-update"][data[6]];
        quantities.councilEpoch = data.readBigUInt64LE(72).toString();
    }
    else if (tag === 30 && data[1] >= 14 && data[1] <= 17) {
        family = "oracle-evidence";
        action = ["upload", "close-draft", "backfill-source", "backfill-claim"][data[1] - 14];
    }
    return Object.freeze({ generation: 3, family, action, tag,
        businessData: Buffer.from(data), accounts, quantities: Object.freeze(quantities), protocolFeeAtoms: "0" });
}
//# sourceMappingURL=browser.js.map