import { MAINNET_PROFILE, observeMainnetDeployment, MainnetSdkError } from "../mainnet/index.js";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { observeAmoebaGovernanceGateV1, bindAmoebaGovernanceGateContextV1,
  assertFreshAmoebaGovernanceGateObservationV1, assertGovernedAmoebaInstructionCapabilityV1,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID, type GovernanceGateContextV1,
} from "@amoeba/spread-release-tools/governance-gate";
import { buildOracleCouncilInstructionV1, type OracleCouncilInstructionInput } from "@amoeba/spread-release-tools/oracle-council";
import { invokeReleaseBoundCurrentBuilderV1 } from "../protocol/current-builders.js";
import type { CurrentGovernedBuilderInputV1, CurrentGovernedBuilderNameV1 } from "../protocol/current-governed-write.js";
import { inspectG3Instruction } from "./browser.js";
import importedLock from "../../release/g3-integration-lock.v1.json" with { type: "json" };
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeDeep(child); Object.freeze(value); }
  return value;
}
const lock = freezeDeep(structuredClone(importedLock));

export const G3_INTEGRATION_LOCK = Object.freeze(lock);
const contexts = new WeakMap<object, GovernanceGateContextV1>();
export interface G3CandidateContext { readonly kind: "g3-local-candidate" | "g3-mainnet"; readonly observedSlot: number; readonly epoch: string }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Only the installed local-test tuple is selectable until a production lock is reviewed. */
export async function observeG3Candidate(connection: Connection, minimumContextSlot: number): Promise<G3CandidateContext> {
  const url = new URL(connection.rpcEndpoint);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("G3 local candidate requires a loopback runtime; no production deployment is selected");
  }
  const p = lock.profile;
  const context = await observeAmoebaGovernanceGateV1({ connection, controllerAbi: 3,
    cluster: { clusterDomain: p.clusterDomain, genesisHash: p.genesisHash },
    controllerProgram: new PublicKey(p.controllerProgramId), targetProgram: new PublicKey(p.programId), minimumContextSlot });
  if (context.gate.toBase58() !== p.gate || context.controllerConfig.toBase58() !== p.controllerConfig) throw new Error("G3 profile gate mismatch");
  const read = await connection.getMultipleAccountsInfoAndContext([context.targetProgram, context.targetProgramdata],
    { commitment: "finalized", minContextSlot: context.finalizedObservationSlot });
  const [program, data] = read.value;
  if (read.context.slot < context.finalizedObservationSlot || !program || !data || !program.executable || data.executable
    || !program.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || !data.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
    || program.data.length !== 36 || program.data.readUInt32LE(0) !== 2
    || !program.data.subarray(4).equals(context.targetProgramdata.toBuffer())
    || data.data.length < 45 + lock.spread.elfBytes || data.data.readUInt32LE(0) !== 3
    || sha(data.data.subarray(45, 45 + lock.spread.elfBytes)) !== lock.spread.elfSha256
    || data.data.subarray(45 + lock.spread.elfBytes).some(b => b !== 0)) throw new Error("G3 executable does not match the integration lock");
  const value = Object.freeze({ kind: "g3-local-candidate" as const, observedSlot: read.context.slot, epoch: context.epoch.toString() });
  contexts.set(value, context);
  return value;
}

function checked(value: G3CandidateContext): GovernanceGateContextV1 {
  const context = contexts.get(value);
  if (!context) throw new Error("G3 context must come from exact runtime observation");
  return context;
}

export function inspectG3CandidateInstructions(candidate: G3CandidateContext, instructions: readonly TransactionInstruction[]) {
  const context = checked(candidate);
  return instructions.map(instruction => inspectG3Instruction(instruction, context));
}

/** Uses the same private official-builder registry; never caller-supplied encoder code. */
export function buildG3CandidateInstruction<Name extends CurrentGovernedBuilderNameV1>(input: {
  context: G3CandidateContext; builderName: Name; builderInput: CurrentGovernedBuilderInputV1<Name>;
}): readonly TransactionInstruction[] {
  const context = checked(input.context);
  const program = bindAmoebaGovernanceGateContextV1(context);
  const built = invokeReleaseBoundCurrentBuilderV1({ builderName: input.builderName, builderInput: input.builderInput,
    governedProgramId: program, expectedProgramId: context.targetProgram });
  if (built.governanceMode !== "spread-governed") throw new Error("G3 requires the canonical generation-aware builder");
  const instructions = (Array.isArray(built.value) ? built.value : [built.value]) as TransactionInstruction[];
  for (const instruction of instructions) {
    assertGovernedAmoebaInstructionCapabilityV1(instruction, context);
    inspectG3Instruction(instruction, context);
  }
  return Object.freeze(instructions);
}

export function buildG3CouncilInstruction(input: Omit<OracleCouncilInstructionInput, "context"> & { candidate: G3CandidateContext }) {
  const { candidate, ...fields } = input;
  return buildOracleCouncilInstructionV1({ ...fields, context: checked(candidate) });
}

/** Re-observe exact executable and gate before signing; an epoch change requires a new message. */
export async function revalidateG3Candidate(connection: Connection, candidate: G3CandidateContext) {
  const planned = checked(candidate);
  const fresh = await (candidate.kind === "g3-mainnet" ? observeG3Mainnet : observeG3Candidate)(connection, candidate.observedSlot);
  assertFreshAmoebaGovernanceGateObservationV1(planned, checked(fresh));
  return fresh;
}

/** Exact production observation; frozen gates never mint a builder context. */
export async function observeG3Mainnet(connection: Connection, minimumContextSlot: number = MAINNET_PROFILE.deployedSlot): Promise<G3CandidateContext> {
  const observed = await observeMainnetDeployment(connection, minimumContextSlot);
  if (!observed.gateActive) throw new MainnetSdkError("MAINNET_GATE_NOT_ACTIVE");
  const p = MAINNET_PROFILE;
  const context = await observeAmoebaGovernanceGateV1({ connection, controllerAbi: 3,
    cluster: { clusterDomain: p.network, genesisHash: p.genesisHash },
    controllerProgram: new PublicKey(p.controllerProgramId), targetProgram: new PublicKey(p.programId), minimumContextSlot: observed.observedSlot });
  if (context.epoch.toString() !== observed.epoch) throw new MainnetSdkError("MAINNET_GATE_CHANGED");
  const value = Object.freeze({ kind: "g3-mainnet" as const, observedSlot: context.finalizedObservationSlot, epoch: context.epoch.toString() });
  contexts.set(value, context);
  return value;
}
