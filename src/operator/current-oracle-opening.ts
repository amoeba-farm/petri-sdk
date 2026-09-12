import * as opening from "@amoeba/spread-release-tools/oracle-current-v3-opening";
import * as lifecycle from "@amoeba/spread-release-tools/oracle-current-v3-lifecycle";
import { AmebaProtocolError } from "../errors.js";
import { currentGovernedWriteReleaseV1 } from "../protocol/current-governed-release-internal.js";
import { oracleMembershipRuntime } from "../protocol/current-oracle-membership-internal.js";
import { inspectBoundCurrentGovernedInstructionV1, prepareBoundCurrentGovernedWriteV1,
  revalidateFreshCurrentGovernedInstructionsV1 } from "../protocol/current-governed-write-internal.js";

type NativeOpeningInput = Parameters<typeof opening.planCurrentV3OpeningMonth>[0];
type NativeOpeningPlan = Awaited<ReturnType<typeof opening.planCurrentV3OpeningMonth>>;
type NativeOpeningAction = NonNullable<NativeOpeningPlan["action"]>;

/** Source typing includes the new action even while the immutable old package remains installed. */
export type CurrentOracleOpeningAction = Omit<NativeOpeningAction, "kind"> & {
  readonly kind: NativeOpeningAction["kind"] | "index_recipe_sources";
};
export type CurrentOracleOpeningPlan = Omit<NativeOpeningPlan, "action" | "observation"> & {
  readonly action?: CurrentOracleOpeningAction;
  readonly observation: NativeOpeningPlan["observation"] & {
    readonly recipeIndexedSourceCount: number;
    readonly recipeSourceIndexComplete: boolean;
  };
};
export type PlanCurrentOracleOpeningMonthInput = Omit<NativeOpeningInput, "governance" | "chainTimeTs" | "chainSlot"> & {
  readonly minimumContextSlot: number;
};

function requireOpeningMembershipRuntime(): void {
  oracleMembershipRuntime();
  const actionTags = (lifecycle as unknown as {
    CURRENT_V3_LIFECYCLE_ACTION_TAGS_V1?: Readonly<Record<string, number>>;
  }).CURRENT_V3_LIFECYCLE_ACTION_TAGS_V1;
  if (actionTags?.index_recipe_sources !== 200) {
    throw new AmebaProtocolError("native Opening lifecycle does not provide the exact recipe indexing action", { code: "CURRENT_ORACLE_MEMBERSHIP_RUNTIME_UNAVAILABLE" });
  }
}

/** Plan through the real native Opening subpath with SDK-owned release, gate and finalized time.
 * No executor, simulation, signer, resend, or lifecycle override is exposed by this facade.
 */
export async function planCurrentOracleOpeningMonth(input: PlanCurrentOracleOpeningMonthInput): Promise<CurrentOracleOpeningPlan> {
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
  const accountAtFloor = async (address: Parameters<NativeOpeningInput["rpc"]["getAccountInfo"]>[0]) => {
    const observed = await input.rpc.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: slot });
    if (!Number.isSafeInteger(observed.context.slot) || observed.context.slot < slot) {
      throw new AmebaProtocolError("Opening account observation is below its finalized floor", { code: "CURRENT_ORACLE_STATE_INVALID" });
    }
    return observed.value;
  };
  const rpc = {
    getAccountInfo: accountAtFloor,
    getMultipleAccountsInfo: (addresses: readonly Parameters<typeof accountAtFloor>[0][]) => Promise.all(addresses.map(accountAtFloor)),
    getGenesisHash: () => input.rpc.getGenesisHash(),
    getAccountInfoAndContext: input.rpc.getAccountInfoAndContext.bind(input.rpc),
    getProgramAccounts: input.rpc.getProgramAccounts.bind(input.rpc),
    getSlot: input.rpc.getSlot.bind(input.rpc), getBlockTime: input.rpc.getBlockTime.bind(input.rpc),
    getLatestBlockhash: input.rpc.getLatestBlockhash.bind(input.rpc),
    getAddressLookupTable: input.rpc.getAddressLookupTable.bind(input.rpc),
    getSignatureStatuses: input.rpc.getSignatureStatuses.bind(input.rpc),
    simulateTransaction: (): never => { throw new Error("Opening planning cannot simulate transactions"); },
    sendRawTransaction: (): never => { throw new Error("Opening planning cannot submit transactions"); },
  };
  const native = await opening.planCurrentV3OpeningMonth({ ...input, rpc,
    governance: binding.spreadGovernance, chainSlot: BigInt(slot), chainTimeTs: BigInt(blockTime) });
  const plan = native as CurrentOracleOpeningPlan;
  if (!Number.isSafeInteger(plan.observation.recipeIndexedSourceCount) || plan.observation.recipeIndexedSourceCount < 0
      || typeof plan.observation.recipeSourceIndexComplete !== "boolean") {
    throw new AmebaProtocolError("native Opening plan omitted authenticated membership progress", { code: "CURRENT_ORACLE_MEMBERSHIP_RUNTIME_UNAVAILABLE" });
  }
  if (plan.action !== undefined) {
    for (const instruction of plan.action.instructions) inspectBoundCurrentGovernedInstructionV1({ instruction, binding });
    await revalidateFreshCurrentGovernedInstructionsV1({ rpc: input.rpc, instructions: plan.action.instructions });
  }
  return plan;
}

/** Use Opening's progress rules for indexing/Opening actions, never recipe-only lifecycle rules. */
export function assertCurrentOracleOpeningActionAdvanced(action: CurrentOracleOpeningAction,
  previous: CurrentOracleOpeningPlan | NativeOpeningPlan, next: CurrentOracleOpeningPlan | NativeOpeningPlan): void {
  requireOpeningMembershipRuntime();
  // The loaded candidate extends the old packaged declarations with index_recipe_sources.
  const verify = opening.assertCurrentV3OpeningActionAdvanced as unknown as (
    action: CurrentOracleOpeningAction, previous: CurrentOracleOpeningPlan | NativeOpeningPlan,
    next: CurrentOracleOpeningPlan | NativeOpeningPlan,
  ) => void;
  verify(action, previous, next);
}

export function redactedCurrentOracleOpeningPlan(plan: CurrentOracleOpeningPlan): Record<string, unknown> {
  requireOpeningMembershipRuntime();
  const redact = opening.redactedCurrentV3OpeningPlan as unknown as (plan: CurrentOracleOpeningPlan) => Record<string, unknown>;
  return redact(plan);
}

export { parseCurrentV3OpeningEvidenceManifest } from "@amoeba/spread-release-tools/oracle-current-v3-opening";
export type { CurrentV3OpeningEvidenceManifest, CurrentV3OpeningEvidenceEntry } from "@amoeba/spread-release-tools/oracle-current-v3-opening";
