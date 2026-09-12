import { Buffer } from "buffer";
import { TransactionInstruction } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
/** @internal Keeps the checked action and its registration intact across an asynchronous Light plan. */
export async function buildRegisteredLightActionPlanV1(input) {
    if (input.actions.length === 0)
        fail("a Light-ATA-ready action requires a governed instruction");
    const approved = input.actions.map(input.cloneRegistered);
    await input.revalidate(approved);
    const plan = await input.buildPlan(approved.map(input.cloneRegistered));
    await input.revalidate(approved);
    if (!Number.isSafeInteger(plan.loadBatchCount) || plan.loadBatchCount < 0
        || plan.instructionBatches.length !== Math.max(1, plan.loadBatchCount)
        || plan.actionBatchIndex !== plan.instructionBatches.length - 1
        || plan.instructionBatches.some((batch) => batch.length === 0))
        fail("Light planner changed the approved atomic grouping");
    const batches = plan.instructionBatches.map((batch) => [...batch]);
    const actionBatch = batches[plan.actionBatchIndex];
    const offset = actionBatch.length - approved.length;
    if (offset < 0 || approved.some((instruction, index) => !sameInstruction(instruction, actionBatch[offset + index]))) {
        fail("Light planner changed the approved governed action suffix");
    }
    actionBatch.splice(offset, approved.length, ...approved.map(input.cloneRegistered));
    return { ...plan, instructionBatches: batches };
}
function sameInstruction(expected, actual) {
    return actual !== undefined && expected.programId.equals(actual.programId)
        && Buffer.from(expected.data).equals(Buffer.from(actual.data)) && expected.keys.length === actual.keys.length
        && expected.keys.every((meta, index) => {
            const other = actual.keys[index];
            return meta.pubkey.equals(other.pubkey) && meta.isSigner === other.isSigner && meta.isWritable === other.isWritable;
        });
}
function fail(message) {
    throw new AmebaProtocolError(message, { code: "CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID" });
}
//# sourceMappingURL=current-light-action-plan-internal.js.map