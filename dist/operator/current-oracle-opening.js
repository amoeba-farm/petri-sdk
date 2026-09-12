import * as opening from "@amoeba/spread-release-tools/oracle-current-v3-opening";
import * as lifecycle from "@amoeba/spread-release-tools/oracle-current-v3-lifecycle";
import { AmebaProtocolError } from "../errors.js";
import { currentGovernedWriteReleaseV1 } from "../protocol/current-governed-release-internal.js";
import { oracleMembershipRuntime } from "../protocol/current-oracle-membership-internal.js";
import { inspectBoundCurrentGovernedInstructionV1, prepareBoundCurrentGovernedWriteV1, revalidateFreshCurrentGovernedInstructionsV1 } from "../protocol/current-governed-write-internal.js";
function requireOpeningMembershipRuntime() {
    oracleMembershipRuntime();
    const actionTags = lifecycle.CURRENT_V3_LIFECYCLE_ACTION_TAGS_V1;
    if (actionTags?.index_recipe_sources !== 200) {
        throw new AmebaProtocolError("native Opening lifecycle does not provide the exact recipe indexing action", { code: "CURRENT_ORACLE_MEMBERSHIP_RUNTIME_UNAVAILABLE" });
    }
}
/** Plan through the real native Opening subpath with SDK-owned release, gate and finalized time.
 * No executor, simulation, signer, resend, or lifecycle override is exposed by this facade.
 */
export async function planCurrentOracleOpeningMonth(input) {
    const release = currentGovernedWriteReleaseV1();
    if (!release.assignedInstructionTags.includes(200)) {
        throw new AmebaProtocolError("the pinned native release does not admit membership-aware Opening planning", { code: "CURRENT_ORACLE_MEMBERSHIP_RELEASE_UNAVAILABLE" });
    }
    requireOpeningMembershipRuntime();
    const binding = await prepareBoundCurrentGovernedWriteV1({ rpc: input.rpc,
        minimumContextSlot: input.minimumContextSlot, release });
    const slot = await input.rpc.getSlot("finalized");
    if (!Number.isSafeInteger(slot) || slot < binding.governance.finalizedObservationSlot) {
        throw new AmebaProtocolError("Opening time observation is below the finalized governance floor", { code: "CURRENT_ORACLE_SCHEDULE_INVALID" });
    }
    const blockTime = await input.rpc.getBlockTime(slot);
    if (blockTime === null || !Number.isSafeInteger(blockTime) || blockTime < 0) {
        throw new AmebaProtocolError("Opening finalized time is unavailable", { code: "CURRENT_ORACLE_SCHEDULE_INVALID" });
    }
    // Native planning uses ordinary read methods; bind each account read to this same floor.
    const accountAtFloor = async (address) => {
        const observed = await input.rpc.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: slot });
        if (!Number.isSafeInteger(observed.context.slot) || observed.context.slot < slot) {
            throw new AmebaProtocolError("Opening account observation is below its finalized floor", { code: "CURRENT_ORACLE_STATE_INVALID" });
        }
        return observed.value;
    };
    const rpc = {
        getAccountInfo: accountAtFloor,
        getMultipleAccountsInfo: (addresses) => Promise.all(addresses.map(accountAtFloor)),
        getGenesisHash: () => input.rpc.getGenesisHash(),
        getAccountInfoAndContext: input.rpc.getAccountInfoAndContext.bind(input.rpc),
        getProgramAccounts: input.rpc.getProgramAccounts.bind(input.rpc),
        getSlot: input.rpc.getSlot.bind(input.rpc), getBlockTime: input.rpc.getBlockTime.bind(input.rpc),
        getLatestBlockhash: input.rpc.getLatestBlockhash.bind(input.rpc),
        getAddressLookupTable: input.rpc.getAddressLookupTable.bind(input.rpc),
        getSignatureStatuses: input.rpc.getSignatureStatuses.bind(input.rpc),
        simulateTransaction: () => { throw new Error("Opening planning cannot simulate transactions"); },
        sendRawTransaction: () => { throw new Error("Opening planning cannot submit transactions"); },
    };
    const native = await opening.planCurrentV3OpeningMonth({ ...input, rpc,
        governance: binding.spreadGovernance, chainSlot: BigInt(slot), chainTimeTs: BigInt(blockTime) });
    const plan = native;
    if (!Number.isSafeInteger(plan.observation.recipeIndexedSourceCount) || plan.observation.recipeIndexedSourceCount < 0
        || typeof plan.observation.recipeSourceIndexComplete !== "boolean") {
        throw new AmebaProtocolError("native Opening plan omitted authenticated membership progress", { code: "CURRENT_ORACLE_MEMBERSHIP_RUNTIME_UNAVAILABLE" });
    }
    if (plan.action !== undefined) {
        for (const instruction of plan.action.instructions)
            inspectBoundCurrentGovernedInstructionV1({ instruction, binding });
        await revalidateFreshCurrentGovernedInstructionsV1({ rpc: input.rpc, instructions: plan.action.instructions });
    }
    return plan;
}
/** Use Opening's progress rules for indexing/Opening actions, never recipe-only lifecycle rules. */
export function assertCurrentOracleOpeningActionAdvanced(action, previous, next) {
    requireOpeningMembershipRuntime();
    // The loaded candidate extends the old packaged declarations with index_recipe_sources.
    const verify = opening.assertCurrentV3OpeningActionAdvanced;
    verify(action, previous, next);
}
export function redactedCurrentOracleOpeningPlan(plan) {
    requireOpeningMembershipRuntime();
    const redact = opening.redactedCurrentV3OpeningPlan;
    return redact(plan);
}
export { parseCurrentV3OpeningEvidenceManifest } from "@amoeba/spread-release-tools/oracle-current-v3-opening";
//# sourceMappingURL=current-oracle-opening.js.map