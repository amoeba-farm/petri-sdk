import { isSdkPublicKey } from "./public-key-value.js";
import { observeCurrentV3RuntimeV1 } from "./current-v3-runtime.js";
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction, } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { assertFreshGovernanceGateObservationV1, inspectGovernedInstructionEnvelopeV1, observeGovernanceGateV1, } from "./governance.js";
import { validateBoundGovernedWriteReleaseV1, } from "./governed-transaction-internal.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
import { invokeReleaseBoundCurrentBuilderV1, } from "./current-builders.js";
import { isCurrentWriteReleaseAvailable } from "./release-train.js";
const SPREAD_GOVERNANCE_MODULE = "@amoeba/spread-release-tools/governance-gate";
const SPREAD_CLUSTER_DOMAIN = "solana-devnet";
const MAX_BUILDER_GRAPH_DEPTH = 32;
const MAX_BUILDER_GRAPH_NODES = 16_384;
const BOUND_PROGRAMS = new WeakMap();
export function isBoundCurrentGovernedProgramV1(programId) {
    return BOUND_PROGRAMS.has(programId);
}
const GOVERNED_INSTRUCTIONS = new WeakMap();
export class CurrentGovernedWriteMaterializationError extends AmebaProtocolError {
    constructor(code, message, options = {}) {
        super(message, { code, cause: options.cause });
    }
}
/** @internal Positive-path seam used by the release-owned public facade and fixtures. */
export async function prepareBoundCurrentGovernedWriteV1(input) {
    const release = validateBoundGovernedWriteReleaseV1(input.release);
    if (release.governanceIdentityGeneration === 3)
        await observeCurrentV3RuntimeV1({ rpc: input.rpc, minimumContextSlot: input.minimumContextSlot, requireWriteReady: true });
    const governance = await observeGovernanceGateV1({
        rpc: input.rpc,
        identity: release.identity,
        minimumContextSlot: input.minimumContextSlot,
        requireActive: true,
    });
    const runtime = await (input.loadRuntime ?? loadSpreadGovernanceRuntimeV1)();
    validateSpreadGovernanceRuntimeV1(runtime);
    const spreadGovernance = spreadContext(governance);
    let governedProgramId;
    try {
        governedProgramId = runtime.bindAmoebaGovernanceGateContextV1(spreadGovernance);
    }
    catch (cause) {
        fail("CURRENT_GOVERNED_RUNTIME_BINDING_INVALID", "pinned Spread package rejected the finalized governance context", cause);
    }
    if (!isSdkPublicKey(governedProgramId)
        || !governedProgramId.equals(governance.targetProgram)) {
        fail("CURRENT_GOVERNED_RUNTIME_BINDING_INVALID", "pinned Spread package returned a foreign governance-bound target");
    }
    const binding = Object.freeze({
        release,
        governance,
        spreadGovernance,
        governedProgramId,
        runtime,
    });
    BOUND_PROGRAMS.set(governedProgramId, binding);
    return binding;
}
/** @internal Builds only through the SDK-owned official-builder registry. */
export async function materializeBoundCurrentGovernedBuilderV1(input) {
    if (typeof input.builderName !== "string" || input.builderName.length === 0) {
        fail("CURRENT_GOVERNED_BUILDER_NAME_INVALID", "governed builder name is invalid");
    }
    let builderInput = snapshotBuilderValue(input.builderInput);
    const binding = await prepareBoundCurrentGovernedWriteV1(input);
    let built;
    try {
        built = (input.invokeBuilder ?? invokeReleaseBoundCurrentBuilderV1)({
            builderName: input.builderName,
            builderInput,
            governedProgramId: binding.governedProgramId,
        });
    }
    catch (cause) {
        fail("CURRENT_GOVERNED_BUILDER_FAILED", "pinned Spread builder failed to construct a governed instruction", cause);
    }
    if (built === null
        || typeof built !== "object"
        || (built.governanceMode !== "spread-governed" && built.governanceMode !== "sdk-business")) {
        fail("CURRENT_GOVERNED_BUILDER_OUTPUT_INVALID", "official builder returned no exact governance output classification");
    }
    const businessInstructions = normalizeBuilderOutput(built.value);
    const instructions = businessInstructions.map((instruction) => built.governanceMode === "sdk-business"
        ? canonicallyGovernSdkBusinessInstruction(instruction, binding)
        : instruction);
    for (let index = 0; index < instructions.length; index += 1) {
        const views = inspectAndRegister(instructions[index], binding);
        if (built.governanceMode === "sdk-business"
            && !sameInstruction(views.semanticInstruction, businessInstructions[index])) {
            fail("CURRENT_GOVERNED_VALIDATOR_DIVERGENCE", "Spread governance construction changed SDK-owned business bytes or account metas");
        }
    }
    const refreshed = await revalidateBoundCurrentGovernedInstructionsV1({
        rpc: input.rpc,
        binding,
        instructions,
    });
    return Object.freeze({
        instructions: Object.freeze([...instructions]),
        governance: refreshed.governance,
        release: refreshed.release,
    });
}
/**
 * Resolves the semantic view only after both the pinned Spread validator and
 * the independent SDK validator agree on the exact gate, epoch, keys, and
 * trailer. Arbitrary lookalike trailers are never stripped.
 */
export function semanticCurrentSpreadInstructionV1(instruction) {
    if (!isCurrentWriteReleaseAvailable())
        return instruction;
    const binding = registeredBinding(instruction);
    assertSameRelease(binding.release, currentGovernedWriteReleaseV1());
    return inspectAndRegister(instruction, binding).semanticInstruction;
}
/** @internal Used by compressed transport before legacy access decoding. */
export function governedCurrentSpreadInstructionViewsV1(instruction) {
    if (!isCurrentWriteReleaseAvailable()) {
        fail("CURRENT_GOVERNED_WRITE_RELEASE_UNAVAILABLE", "governed instruction views require the certified current write release");
    }
    const binding = registeredBinding(instruction);
    assertSameRelease(binding.release, currentGovernedWriteReleaseV1());
    return inspectAndRegister(instruction, binding);
}
/** @internal Validates and registers a canonical compressed outer instruction. */
export function registerCurrentSpreadGovernedOutputV1(input) {
    if (!isCurrentWriteReleaseAvailable()) {
        fail("CURRENT_GOVERNED_WRITE_RELEASE_UNAVAILABLE", "governed output registration requires the certified current write release");
    }
    const binding = registeredBinding(input.sourceInstruction);
    assertSameRelease(binding.release, currentGovernedWriteReleaseV1());
    return inspectAndRegister(input.outputInstruction, binding);
}
/** @internal Defensive clone that retains SDK validation provenance. */
export function cloneCurrentSpreadInstructionPreservingRegistrationV1(instruction) {
    if (!isCurrentWriteReleaseAvailable()) {
        return new TransactionInstruction({
            programId: new PublicKey(instruction.programId.toBytes()),
            keys: instruction.keys.map(cloneAccountMeta),
            data: Buffer.from(instruction.data),
        });
    }
    const binding = registeredBinding(instruction);
    assertSameRelease(binding.release, currentGovernedWriteReleaseV1());
    const clone = new TransactionInstruction({
        programId: new PublicKey(instruction.programId.toBytes()),
        keys: instruction.keys.map(cloneAccountMeta),
        data: Buffer.from(instruction.data),
    });
    inspectAndRegister(clone, binding);
    return clone;
}
/** @internal Re-observes finalized gate state immediately before compilation. */
export async function revalidateFreshCurrentGovernedInstructionsV1(input) {
    if (!isCurrentWriteReleaseAvailable()) {
        fail("CURRENT_GOVERNED_WRITE_RELEASE_UNAVAILABLE", "governed instruction freshness requires the certified current write release");
    }
    if (!Array.isArray(input.instructions) || input.instructions.length === 0) {
        fail("CURRENT_GOVERNED_INSTRUCTION_BATCH_INVALID", "governed instruction batch is empty");
    }
    const first = registeredBinding(input.instructions[0]);
    assertSameRelease(first.release, currentGovernedWriteReleaseV1());
    for (const instruction of input.instructions) {
        if (registeredBinding(instruction) !== first) {
            fail("CURRENT_GOVERNED_INSTRUCTION_BATCH_INVALID", "governed instruction batch mixes independently observed contexts");
        }
    }
    return revalidateBoundCurrentGovernedInstructionsV1({
        rpc: input.rpc,
        binding: first,
        instructions: input.instructions,
    });
}
/** @internal Positive-path fixture seam. */
export function inspectBoundCurrentGovernedInstructionV1(input) {
    return inspectAndRegister(input.instruction, input.binding);
}
async function revalidateBoundCurrentGovernedInstructionsV1(input) {
    const observed = await observeGovernanceGateV1({
        rpc: input.rpc,
        identity: input.binding.release.identity,
        minimumContextSlot: input.binding.governance.finalizedObservationSlot,
        requireActive: true,
    });
    const governance = assertFreshGovernanceGateObservationV1(input.binding.governance, observed);
    const binding = Object.freeze({
        ...input.binding,
        governance,
        spreadGovernance: spreadContext(governance),
    });
    BOUND_PROGRAMS.set(binding.governedProgramId, binding);
    for (const instruction of input.instructions) {
        inspectAndRegister(instruction, binding);
    }
    return Object.freeze({
        instructions: Object.freeze([...input.instructions]),
        governance,
        release: binding.release,
    });
}
function inspectAndRegister(instruction, binding) {
    if (!(instruction instanceof TransactionInstruction)) {
        fail("CURRENT_GOVERNED_INSTRUCTION_INVALID", "Spread builder output is not a TransactionInstruction");
    }
    let spread;
    try {
        spread = binding.runtime.assertAmoebaGovernanceEnvelopeV1(instruction, binding.spreadGovernance);
    }
    catch (cause) {
        fail("CURRENT_GOVERNED_INSTRUCTION_INVALID", "pinned Spread package rejected its governed instruction output", cause);
    }
    const sdk = inspectGovernedInstructionEnvelopeV1({
        instruction,
        context: binding.governance,
        recognizedInstructionTags: binding.release.assignedInstructionTags,
    });
    if (spread.tail.expectedEpoch !== sdk.tail.expectedEpoch
        || !equalBytes(spread.legacyData, sdk.legacyData)
        || spread.legacyKeys.length + 1 !== instruction.keys.length
        || !sameAccountMetas(spread.legacyKeys, instruction.keys.slice(0, -1))) {
        fail("CURRENT_GOVERNED_VALIDATOR_DIVERGENCE", "Spread and SDK governance-envelope validators disagree");
    }
    const semanticInstruction = new TransactionInstruction({
        programId: new PublicKey(instruction.programId.toBytes()),
        keys: spread.legacyKeys.map(cloneAccountMeta),
        data: Buffer.from(spread.legacyData),
    });
    GOVERNED_INSTRUCTIONS.set(instruction, Object.freeze({ binding }));
    return Object.freeze({
        governedInstruction: instruction,
        semanticInstruction,
        governance: binding.governance,
        spreadGovernance: binding.spreadGovernance,
        release: binding.release,
    });
}
function registeredBinding(instruction) {
    if (!(instruction instanceof TransactionInstruction)) {
        fail("CURRENT_GOVERNED_INSTRUCTION_INVALID", "governed instruction is malformed");
    }
    const registered = GOVERNED_INSTRUCTIONS.get(instruction);
    if (registered !== undefined)
        return registered.binding;
    const bound = BOUND_PROGRAMS.get(instruction.programId);
    if (bound !== undefined)
        return bound;
    fail("CURRENT_GOVERNED_INSTRUCTION_NOT_ISSUED", "current instruction was not constructed under this SDK's release-bound governance context");
}
function spreadContext(context) {
    return Object.freeze({
        cluster: Object.freeze({
            clusterDomain: SPREAD_CLUSTER_DOMAIN,
            genesisHash: context.genesisHash,
        }),
        controllerProgram: new PublicKey(context.controllerProgram.toBytes()),
        controllerConfig: new PublicKey(context.controllerConfig.toBytes()),
        gate: new PublicKey(context.gateAddress.toBytes()),
        targetProgram: new PublicKey(context.targetProgram.toBytes()),
        targetProgramdata: new PublicKey(context.targetProgramData.toBytes()),
        epoch: context.epoch,
        finalizedObservationSlot: context.finalizedObservationSlot,
    });
}
async function loadSpreadGovernanceRuntimeV1() {
    let module;
    try {
        // Non-literal import keeps the historical bundled package loadable while
        // the certified governed package artifact remains intentionally unpinned.
        module = await import(SPREAD_GOVERNANCE_MODULE);
    }
    catch (cause) {
        fail("CURRENT_GOVERNED_RUNTIME_UNAVAILABLE", "certified Spread governance-gate export is unavailable", cause);
    }
    return validateSpreadGovernanceRuntimeV1(module);
}
function validateSpreadGovernanceRuntimeV1(value) {
    const runtime = value;
    if (runtime === null
        || typeof runtime !== "object"
        || runtime.GOVERNANCE_TAIL_LEN !== 16
        || runtime.MAX_AMOEBA_INSTRUCTION_DATA_BYTES !== 16_384
        || typeof runtime.bindAmoebaGovernanceGateContextV1 !== "function"
        || typeof runtime.createAmoebaGovernedInstructionV1 !== "function"
        || typeof runtime.assertAmoebaGovernanceEnvelopeV1 !== "function") {
        fail("CURRENT_GOVERNED_RUNTIME_INVALID", "pinned Spread governance-gate export lacks the exact AGV1 surface");
    }
    return runtime;
}
function canonicallyGovernSdkBusinessInstruction(instruction, binding) {
    if (instruction.programId !== binding.governedProgramId) {
        fail("CURRENT_GOVERNED_BUILDER_OUTPUT_INVALID", "SDK-owned business builder did not preserve the exact Spread governance-bound program capability");
    }
    let governed;
    try {
        governed = binding.runtime.createAmoebaGovernedInstructionV1({
            programId: binding.governedProgramId,
            keys: instruction.keys.map(cloneAccountMeta),
            data: Buffer.from(instruction.data),
        });
    }
    catch (cause) {
        fail("CURRENT_GOVERNED_BUILDER_FAILED", "pinned Spread package failed to govern an SDK-owned business instruction", cause);
    }
    return governed;
}
function sameInstruction(left, right) {
    return left.programId.equals(right.programId)
        && equalBytes(left.data, right.data)
        && sameAccountMetas(left.keys, right.keys);
}
function normalizeBuilderOutput(value) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0
        || values.length > 64
        || !values.every((instruction) => instruction instanceof TransactionInstruction)) {
        fail("CURRENT_GOVERNED_BUILDER_OUTPUT_INVALID", "official builder must return one to 64 TransactionInstructions");
    }
    return Object.freeze([...values]);
}
function snapshotBuilderValue(value) {
    const state = { nodes: 0 };
    return snapshotBuilderNode(value, 0, state, new Set());
}
function snapshotBuilderNode(value, depth, state, ancestors) {
    state.nodes += 1;
    if (depth > MAX_BUILDER_GRAPH_DEPTH || state.nodes > MAX_BUILDER_GRAPH_NODES) {
        fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "governed builder input exceeds structural bounds");
    }
    if (value === null
        || value === undefined
        || typeof value === "string"
        || typeof value === "boolean"
        || typeof value === "bigint")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "governed builder input contains a non-finite number");
        }
        return value;
    }
    if (value instanceof PublicKey)
        return new PublicKey(value.toBytes());
    // npm may install a second web3.js copy inside a bundled dependency. Admit
    // only its canonical 32-byte key value, then detach into this SDK's class.
    if (value !== null && typeof value === "object") {
        const candidate = value;
        const toBytes = candidate.toBytes;
        const toBase58 = candidate.toBase58;
        if (typeof toBytes === "function" && typeof toBase58 === "function") {
            const bytes = Reflect.apply(toBytes, value, []);
            const encoded = Reflect.apply(toBase58, value, []);
            if (!(bytes instanceof Uint8Array) || bytes.length !== 32 || typeof encoded !== "string") {
                fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "public key value is not canonical");
            }
            const key = new PublicKey(Uint8Array.from(bytes));
            if (key.toBase58() !== encoded)
                fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "public key bytes and encoding differ");
            return key;
        }
    }
    if (value instanceof Uint8Array)
        return Buffer.from(value);
    if (typeof value !== "object") {
        fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "governed builder input contains an unsupported value");
    }
    if (ancestors.has(value)) {
        fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "governed builder input contains a cycle");
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return Object.freeze(value.map((item) => snapshotBuilderNode(item, depth + 1, state, ancestors)));
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            fail("CURRENT_GOVERNED_BUILDER_INPUT_INVALID", "governed builder input contains an unsupported object");
        }
        const output = {};
        for (const key of Object.keys(value)) {
            if (key === "programId") {
                fail("CURRENT_GOVERNED_BUILDER_PROGRAM_FORBIDDEN", "governed builder input cannot supply programId");
            }
            output[key] = snapshotBuilderNode(value[key], depth + 1, state, ancestors);
        }
        return Object.freeze(output);
    }
    finally {
        ancestors.delete(value);
    }
}
function assertSameRelease(left, right) {
    if (left.identity !== right.identity
        || left.governanceIdentityGeneration !== right.governanceIdentityGeneration
        || left.spreadReleaseCommit !== right.spreadReleaseCommit
        || left.spreadPackageArtifactSha256 !== right.spreadPackageArtifactSha256
        || left.instructionManifestSha256 !== right.instructionManifestSha256
        || left.programDataPayloadSha256 !== right.programDataPayloadSha256
        || left.assignedInstructionTags.length !== right.assignedInstructionTags.length
        || left.assignedInstructionTags.some((tag, index) => tag !== right.assignedInstructionTags[index])) {
        fail("CURRENT_GOVERNED_WRITE_RELEASE_CHANGED", "governed instruction was built under a different release binding");
    }
}
function sameAccountMetas(left, right) {
    return left.length === right.length && left.every((meta, index) => {
        const expected = right[index];
        return expected !== undefined
            && meta.pubkey.equals(expected.pubkey)
            && meta.isSigner === expected.isSigner
            && meta.isWritable === expected.isWritable;
    });
}
function cloneAccountMeta(meta) {
    return {
        pubkey: new PublicKey(meta.pubkey.toBytes()),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
    };
}
function equalBytes(left, right) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
function fail(code, message, cause) {
    throw new CurrentGovernedWriteMaterializationError(code, message, { cause });
}
//# sourceMappingURL=current-governed-write-internal.js.map