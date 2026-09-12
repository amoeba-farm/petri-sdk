import { canonicalSdkPublicKey, isSdkPublicKey } from "./public-key-value.js";
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction, } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { CURRENT_GOVERNANCE_GENERATION_1, CURRENT_GOVERNANCE_GENERATION_3, CURRENT_LIVE_DEPLOYMENT, REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE, } from "./release-train.js";
export const GOVERNANCE_GATE_V1_BYTES = 192;
export const GOVERNANCE_GATE_V1_DISCRIMINATOR = "AGVGAT01";
export const GOVERNANCE_GATE_V1_VERSION = 1;
export const GOVERNANCE_TAIL_V1_BYTES = 16;
export const GOVERNANCE_TAIL_V1_MAGIC = "AGV1";
export const GOVERNANCE_TAIL_V1_VERSION = 1;
export const GOVERNED_INSTRUCTION_DATA_MAX_BYTES = 16_384;
export const GOVERNANCE_UPGRADE_SEED_DOMAIN_V1 = "ameba-upgrade-v1";
export const BPF_UPGRADEABLE_LOADER_PROGRAM_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
export const GOVERNANCE_GATE_V1_OFFSETS = Object.freeze({
    discriminator: 0,
    version: 8,
    bump: 9,
    initialized: 10,
    status: 11,
    controllerConfig: 12,
    targetProgram: 44,
    targetProgramData: 76,
    epoch: 108,
    activeProposal: 116,
    freezeSlot: 148,
    freezeReasonCode: 156,
    lastCompletedProposal: 158,
    reserved: 190,
});
export const GOVERNANCE_GATE_STATUS_V1 = Object.freeze({
    Active: 0,
    FrozenForUpgrade: 1,
    EmergencyFrozen: 2,
});
export class GovernanceGateValidationError extends AmebaProtocolError {
    constructor(code, message) {
        super(message, { code });
    }
}
export function deriveGovernanceControllerConfigPdaV1(controllerProgram, targetProgram) {
    if (controllerProgram.toBase58() === CURRENT_GOVERNANCE_GENERATION_3.controllerProgramId) {
        return PublicKey.findProgramAddressSync([asciiBytes("ameba-governance-v3"), asciiBytes("council")], controllerProgram);
    }
    return PublicKey.findProgramAddressSync([
        asciiBytes(GOVERNANCE_UPGRADE_SEED_DOMAIN_V1),
        asciiBytes("target"),
        targetProgram.toBytes(),
    ], controllerProgram);
}
export function deriveProtocolGovernanceGatePdaV1(controllerProgram, targetProgram) {
    return PublicKey.findProgramAddressSync([
        asciiBytes(controllerProgram.toBase58() === CURRENT_GOVERNANCE_GENERATION_3.controllerProgramId
            ? "ameba-governance-v3" : GOVERNANCE_UPGRADE_SEED_DOMAIN_V1),
        asciiBytes("gate"),
        targetProgram.toBytes(),
    ], controllerProgram);
}
export function deriveUpgradeableProgramDataAddressV1(targetProgram) {
    return PublicKey.findProgramAddressSync([targetProgram.toBytes()], new PublicKey(BPF_UPGRADEABLE_LOADER_PROGRAM_ID));
}
export function encodeGovernanceInstructionTailV1(expectedEpoch) {
    requireU64(expectedEpoch, "expectedEpoch");
    const bytes = new Uint8Array(GOVERNANCE_TAIL_V1_BYTES);
    bytes.set(asciiBytes(GOVERNANCE_TAIL_V1_MAGIC), 0);
    bytes[4] = GOVERNANCE_TAIL_V1_VERSION;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(8, expectedEpoch, true);
    return bytes;
}
export function decodeGovernanceInstructionTailV1(data) {
    const bytes = copyBytes(data, "governance tail");
    if (bytes.length !== GOVERNANCE_TAIL_V1_BYTES) {
        fail("GOVERNANCE_TAIL_LENGTH_INVALID", "governance tail must be exactly 16 bytes");
    }
    if (!bytesEqual(bytes.subarray(0, 4), asciiBytes(GOVERNANCE_TAIL_V1_MAGIC))) {
        fail("GOVERNANCE_TAIL_MAGIC_INVALID", "governance tail magic is not AGV1");
    }
    if (bytes[4] !== GOVERNANCE_TAIL_V1_VERSION) {
        fail("GOVERNANCE_TAIL_VERSION_UNSUPPORTED", "governance tail version is unsupported");
    }
    if (bytes.subarray(5, 8).some((byte) => byte !== 0)) {
        fail("GOVERNANCE_TAIL_RESERVED_INVALID", "governance tail reserved bytes must be zero");
    }
    return Object.freeze({
        magic: GOVERNANCE_TAIL_V1_MAGIC,
        version: GOVERNANCE_TAIL_V1_VERSION,
        expectedEpoch: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(8, true),
    });
}
export function decodeProtocolGovernanceGateV1(data) {
    const bytes = copyBytes(data, "ProtocolGateV1");
    if (bytes.length !== GOVERNANCE_GATE_V1_BYTES) {
        fail("GOVERNANCE_GATE_LENGTH_INVALID", "ProtocolGateV1 must be exactly 192 bytes");
    }
    if (!bytesEqual(bytes.subarray(0, 8), asciiBytes(GOVERNANCE_GATE_V1_DISCRIMINATOR))) {
        fail("GOVERNANCE_GATE_DISCRIMINATOR_INVALID", "ProtocolGateV1 discriminator is invalid");
    }
    if (bytes[GOVERNANCE_GATE_V1_OFFSETS.version] !== GOVERNANCE_GATE_V1_VERSION) {
        fail("GOVERNANCE_GATE_VERSION_UNSUPPORTED", "ProtocolGateV1 version is unsupported");
    }
    if (bytes[GOVERNANCE_GATE_V1_OFFSETS.initialized] !== 1) {
        fail("GOVERNANCE_GATE_INITIALIZED_INVALID", "ProtocolGateV1 initialized byte must be canonical true");
    }
    if (bytes.subarray(GOVERNANCE_GATE_V1_OFFSETS.reserved).some((byte) => byte !== 0)) {
        fail("GOVERNANCE_GATE_RESERVED_INVALID", "ProtocolGateV1 reserved bytes must be zero");
    }
    const status = bytes[GOVERNANCE_GATE_V1_OFFSETS.status];
    const statusName = statusNameFor(status);
    const gate = {
        discriminator: GOVERNANCE_GATE_V1_DISCRIMINATOR,
        version: GOVERNANCE_GATE_V1_VERSION,
        bump: bytes[GOVERNANCE_GATE_V1_OFFSETS.bump],
        initialized: true,
        status,
        statusName,
        controllerConfig: publicKeyAt(bytes, GOVERNANCE_GATE_V1_OFFSETS.controllerConfig),
        targetProgram: publicKeyAt(bytes, GOVERNANCE_GATE_V1_OFFSETS.targetProgram),
        targetProgramData: publicKeyAt(bytes, GOVERNANCE_GATE_V1_OFFSETS.targetProgramData),
        epoch: readBigUint64Le(bytes, GOVERNANCE_GATE_V1_OFFSETS.epoch),
        activeProposal: publicKeyAt(bytes, GOVERNANCE_GATE_V1_OFFSETS.activeProposal),
        freezeSlot: readBigUint64Le(bytes, GOVERNANCE_GATE_V1_OFFSETS.freezeSlot),
        freezeReasonCode: readUint16Le(bytes, GOVERNANCE_GATE_V1_OFFSETS.freezeReasonCode),
        lastCompletedProposal: publicKeyAt(bytes, GOVERNANCE_GATE_V1_OFFSETS.lastCompletedProposal),
    };
    requireNondefault(gate.controllerConfig, "controllerConfig");
    requireNondefault(gate.targetProgram, "targetProgram");
    requireNondefault(gate.targetProgramData, "targetProgramData");
    requireCanonicalStatus(gate);
    return Object.freeze(gate);
}
export function validateProtocolGovernanceGateAccountV1(input) {
    if (input === null || typeof input !== "object") {
        fail("GOVERNANCE_GATE_INPUT_INVALID", "governance gate account input is malformed");
    }
    const identity = validateGovernanceIdentityV1(input.identity ?? CURRENT_GOVERNANCE_GENERATION_3);
    const controllerProgram = canonicalPublicKey(identity.controllerProgramId, "controllerProgramId");
    const targetProgram = canonicalPublicKey(identity.targetProgramId, "targetProgramId");
    const targetProgramData = canonicalPublicKey(identity.targetProgramData, "targetProgramData");
    const [controllerConfig] = deriveGovernanceControllerConfigPdaV1(controllerProgram, targetProgram);
    const [gateAddress, gateBump] = deriveProtocolGovernanceGatePdaV1(controllerProgram, targetProgram);
    const [derivedProgramData] = deriveUpgradeableProgramDataAddressV1(targetProgram);
    if (controllerConfig.toBase58() !== identity.controllerConfigPda
        || gateAddress.toBase58() !== identity.protocolGatePda
        || !derivedProgramData.equals(targetProgramData)) {
        fail("GOVERNANCE_IDENTITY_INVALID", "selected governance identity does not derive canonical PDAs");
    }
    const address = canonicalPublicKey(input.address, "gate address");
    const owner = canonicalPublicKey(input.owner, "gate owner");
    if (!address.equals(gateAddress)) {
        fail("GOVERNANCE_GATE_ADDRESS_INVALID", "gate account is not the selected generation's canonical PDA");
    }
    if (!owner.equals(controllerProgram)) {
        fail("GOVERNANCE_GATE_OWNER_INVALID", "gate account owner is not the selected controller program");
    }
    if (input.executable !== false) {
        fail("GOVERNANCE_GATE_EXECUTABLE_INVALID", "gate account must be non-executable");
    }
    const gate = decodeProtocolGovernanceGateV1(input.data);
    if (gate.bump !== gateBump
        || !gate.controllerConfig.equals(controllerConfig)
        || !gate.targetProgram.equals(targetProgram)
        || !gate.targetProgramData.equals(targetProgramData)) {
        fail("GOVERNANCE_GATE_LINKAGE_INVALID", "gate embeds a noncanonical bump, config, target, or ProgramData address");
    }
    if (input.requireActive === true && gate.status !== GOVERNANCE_GATE_STATUS_V1.Active) {
        fail("GOVERNANCE_GATE_FROZEN", "selected governance gate is not Active");
    }
    return gate;
}
/**
 * Observes one exact release-train governance identity at finalized commitment.
 * Accepting the reviewed Generation 2 identity here proves only its current
 * account state; it does not select it as the SDK write release.
 */
export async function observeGovernanceGateV1(input) {
    if (input === null || typeof input !== "object") {
        fail("GOVERNANCE_RPC_INVALID", "governance observation input is malformed");
    }
    const identity = validateGovernanceIdentityV1(input.identity);
    const minimumContextSlot = requireSafeSlot(input.minimumContextSlot, "minimumContextSlot");
    const getGenesisHash = requireRpcMethod(input.rpc, "getGenesisHash");
    const getAccountInfoAndContext = requireRpcMethod(input.rpc, "getAccountInfoAndContext");
    const genesisHash = await getGenesisHash.call(input.rpc);
    if (genesisHash !== CURRENT_LIVE_DEPLOYMENT.genesisHash) {
        fail("GOVERNANCE_CLUSTER_IDENTITY_MISMATCH", "governance RPC genesis hash is not the selected Devnet identity");
    }
    const gateAddress = new PublicKey(identity.protocolGatePda);
    const response = await getAccountInfoAndContext.call(input.rpc, gateAddress, {
        commitment: "finalized",
        minContextSlot: minimumContextSlot,
    });
    const slot = requireSafeSlot(response?.context?.slot, "gate context slot");
    if (slot < minimumContextSlot) {
        fail("GOVERNANCE_GATE_CONTEXT_REGRESSED", "governance gate observation regressed below minContextSlot");
    }
    if (response.value === null
        || typeof response.value !== "object"
        || !(response.value.data instanceof Uint8Array)
        || !(isSdkPublicKey(response.value.owner))
        || typeof response.value.executable !== "boolean") {
        fail("GOVERNANCE_GATE_NOT_FOUND", "selected governance gate is absent at finalized commitment");
    }
    const gate = validateProtocolGovernanceGateAccountV1({
        address: gateAddress,
        owner: response.value.owner,
        executable: response.value.executable,
        data: response.value.data,
        identity,
        requireActive: input.requireActive,
    });
    return freezeContext({
        identityGeneration: identity.identityGeneration,
        genesisHash: CURRENT_LIVE_DEPLOYMENT.genesisHash,
        controllerProgram: new PublicKey(identity.controllerProgramId),
        controllerConfig: gate.controllerConfig,
        gateAddress,
        targetProgram: gate.targetProgram,
        targetProgramData: gate.targetProgramData,
        status: gate.status,
        statusName: gate.statusName,
        epoch: gate.epoch,
        finalizedObservationSlot: slot,
    });
}
/** Backward-compatible observation of the release train's still-selected Generation 1 gate. */
export async function observeCurrentGovernanceGateV1(input) {
    if (input === null || typeof input !== "object") {
        fail("GOVERNANCE_RPC_INVALID", "governance observation input is malformed");
    }
    return observeGovernanceGateV1({
        ...input,
        identity: CURRENT_GOVERNANCE_GENERATION_3,
    });
}
/**
 * Re-observes the exact reviewed Generation 2 controller-owned gate and requires
 * it to be Active. This is live-state evidence, not a release-selection switch.
 */
export async function observeReviewedGeneration2GovernanceGateV1(input) {
    if (input === null || typeof input !== "object") {
        fail("GOVERNANCE_RPC_INVALID", "governance observation input is malformed");
    }
    return observeGovernanceGateV1({
        ...input,
        identity: REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE,
        requireActive: true,
    });
}
export function assertFreshGovernanceGateObservationV1(planned, observed) {
    const plan = validateContext(planned);
    const current = validateContext(observed);
    if (plan.genesisHash !== current.genesisHash
        || plan.identityGeneration !== current.identityGeneration
        || !plan.controllerProgram.equals(current.controllerProgram)
        || !plan.controllerConfig.equals(current.controllerConfig)
        || !plan.gateAddress.equals(current.gateAddress)
        || !plan.targetProgram.equals(current.targetProgram)
        || !plan.targetProgramData.equals(current.targetProgramData)
        || plan.status !== GOVERNANCE_GATE_STATUS_V1.Active
        || current.status !== GOVERNANCE_GATE_STATUS_V1.Active
        || plan.epoch !== current.epoch) {
        fail("GOVERNANCE_GATE_OBSERVATION_STALE", "planned governance gate identity, status, or epoch is stale");
    }
    if (current.finalizedObservationSlot < plan.finalizedObservationSlot) {
        fail("GOVERNANCE_GATE_CONTEXT_REGRESSED", "governance re-observation regressed below the planned finalized slot");
    }
    return current;
}
/**
 * Constructs the canonical outer Spread governance envelope without changing
 * the supplied business instruction. The recognized-tag set is deliberately
 * caller supplied until a final write-release manifest is bound; construction
 * by itself is never a claim that current submission is available.
 */
export function buildGovernedInstructionEnvelopeV1(input) {
    const snapshot = snapshotUngovernedInstructionV1(input);
    return appendGovernanceEnvelopeV1(snapshot.instruction, snapshot.context, snapshot.recognizedInstructionTags);
}
/**
 * Re-observes the controller-owned gate at finalized commitment immediately
 * before unsigned materialization. The complete business instruction and tag
 * authority are snapshotted before the asynchronous RPC boundary.
 */
export async function materializeFreshGovernedInstructionEnvelopeV1(input) {
    if (input === null || typeof input !== "object") {
        fail("GOVERNED_INSTRUCTION_INPUT_INVALID", "governed instruction materialization input is malformed");
    }
    const snapshot = snapshotUngovernedInstructionV1({
        instruction: input.instruction,
        context: input.plannedContext,
        recognizedInstructionTags: input.recognizedInstructionTags,
    });
    const identity = governanceIdentityForGenerationV1(snapshot.context.identityGeneration);
    const observed = await observeGovernanceGateV1({
        rpc: input.rpc,
        identity,
        minimumContextSlot: snapshot.context.finalizedObservationSlot,
        requireActive: true,
    });
    const current = assertFreshGovernanceGateObservationV1(snapshot.context, observed);
    return Object.freeze({
        instruction: appendGovernanceEnvelopeV1(snapshot.instruction, current, snapshot.recognizedInstructionTags),
        governance: current,
    });
}
/**
 * Freshness-validates an instruction already produced by Spread's canonical
 * `governance-gate` export. This is the preferred integration seam once the
 * exact governed Spread package is release-pinned; the SDK must not append a
 * second parallel envelope to that output.
 */
export async function revalidateFreshGovernedInstructionEnvelopeV1(input) {
    if (input === null
        || typeof input !== "object"
        || !(input.instruction instanceof TransactionInstruction)
        || !(isSdkPublicKey(input.instruction.programId))
        || !Array.isArray(input.instruction.keys)
        || !input.instruction.keys.every(isCanonicalAccountMetaV1)
        || !(input.instruction.data instanceof Uint8Array)) {
        fail("GOVERNED_INSTRUCTION_INPUT_INVALID", "governed instruction revalidation input is malformed");
    }
    const context = freezeContext(validateContext(input.plannedContext));
    const instruction = cloneTransactionInstructionV1(input.instruction);
    if (instruction.data.length <= GOVERNANCE_TAIL_V1_BYTES) {
        fail("GOVERNED_INSTRUCTION_DATA_INVALID", "governed instruction data is outside the exact outer bounds");
    }
    const recognizedInstructionTags = validateRecognizedInstructionTagsV1(input.recognizedInstructionTags, instruction.data[0]);
    inspectGovernedInstructionEnvelopeV1({
        instruction,
        context,
        recognizedInstructionTags,
    });
    const identity = governanceIdentityForGenerationV1(context.identityGeneration);
    const observed = await observeGovernanceGateV1({
        rpc: input.rpc,
        identity,
        minimumContextSlot: context.finalizedObservationSlot,
        requireActive: true,
    });
    const current = assertFreshGovernanceGateObservationV1(context, observed);
    inspectGovernedInstructionEnvelopeV1({
        instruction,
        context: current,
        recognizedInstructionTags,
    });
    return Object.freeze({ instruction, governance: current });
}
/**
 * Inspector only: verifies a governed envelope but never constructs one. The
 * recognized tag allowlist must come from the exact future write release.
 */
export function inspectGovernedInstructionEnvelopeV1(input) {
    if (input === null
        || typeof input !== "object"
        || input.instruction === null
        || typeof input.instruction !== "object"
        || !(isSdkPublicKey(input.instruction.programId))
        || !Array.isArray(input.instruction.keys)
        || !input.instruction.keys.every((meta) => meta !== null
            && typeof meta === "object"
            && isSdkPublicKey(meta.pubkey)
            && typeof meta.isSigner === "boolean"
            && typeof meta.isWritable === "boolean")
        || !(input.instruction.data instanceof Uint8Array)
        || !Array.isArray(input.recognizedInstructionTags)) {
        fail("GOVERNED_INSTRUCTION_INPUT_INVALID", "governed instruction input is malformed");
    }
    const context = validateContext(input.context);
    if (context.status !== GOVERNANCE_GATE_STATUS_V1.Active) {
        fail("GOVERNANCE_GATE_FROZEN", "a governed envelope cannot be accepted while the gate is frozen");
    }
    if (!input.instruction.programId.equals(context.targetProgram)) {
        fail("GOVERNED_INSTRUCTION_PROGRAM_INVALID", "governed instruction targets a different program");
    }
    const data = Uint8Array.from(input.instruction.data);
    if (data.length <= GOVERNANCE_TAIL_V1_BYTES || data.length > GOVERNED_INSTRUCTION_DATA_MAX_BYTES) {
        fail("GOVERNED_INSTRUCTION_DATA_INVALID", "governed instruction data is outside the exact outer bounds");
    }
    const tag = data[0];
    validateRecognizedInstructionTagsV1(input.recognizedInstructionTags, tag);
    const matchingGateMetas = input.instruction.keys.filter((meta) => meta.pubkey.equals(context.gateAddress));
    const finalMeta = input.instruction.keys.at(-1);
    if (matchingGateMetas.length !== 1
        || finalMeta === undefined
        || !finalMeta.pubkey.equals(context.gateAddress)
        || finalMeta.isSigner
        || finalMeta.isWritable) {
        fail("GOVERNED_INSTRUCTION_GATE_META_INVALID", "canonical gate must appear exactly once as the final read-only nonsigner meta");
    }
    const tail = decodeGovernanceInstructionTailV1(data.subarray(-GOVERNANCE_TAIL_V1_BYTES));
    if (tail.expectedEpoch !== context.epoch) {
        fail("GOVERNED_INSTRUCTION_EPOCH_STALE", "governance tail epoch differs from the finalized gate observation");
    }
    const legacyData = Uint8Array.from(data.subarray(0, -GOVERNANCE_TAIL_V1_BYTES));
    if (endsWithGovernanceInstructionTailV1(legacyData)) {
        fail("GOVERNED_INSTRUCTION_ALREADY_ENVELOPED", "governed instruction contains a nested canonical governance tail");
    }
    return Object.freeze({
        legacyData,
        tail,
    });
}
/** Validates every governed Spread instruction independently. */
export function inspectGovernedInstructionBatchV1(input) {
    if (input === null
        || typeof input !== "object"
        || !Array.isArray(input.instructions)
        || input.instructions.length === 0) {
        fail("GOVERNED_INSTRUCTION_BATCH_INVALID", "governed instruction batch must be a nonempty array");
    }
    return Object.freeze(input.instructions.map((instruction) => inspectGovernedInstructionEnvelopeV1({
        instruction,
        context: input.context,
        recognizedInstructionTags: input.recognizedInstructionTags,
    })));
}
function snapshotUngovernedInstructionV1(input) {
    if (input === null
        || typeof input !== "object"
        || !(input.instruction instanceof TransactionInstruction)
        || !(isSdkPublicKey(input.instruction.programId))
        || !Array.isArray(input.instruction.keys)
        || !input.instruction.keys.every(isCanonicalAccountMetaV1)
        || !(input.instruction.data instanceof Uint8Array)) {
        fail("GOVERNED_INSTRUCTION_INPUT_INVALID", "governed instruction input is malformed");
    }
    const context = validateContext(input.context);
    if (context.status !== GOVERNANCE_GATE_STATUS_V1.Active) {
        fail("GOVERNANCE_GATE_FROZEN", "a governed envelope cannot be constructed while the gate is frozen");
    }
    if (!input.instruction.programId.equals(context.targetProgram)) {
        fail("GOVERNED_INSTRUCTION_PROGRAM_INVALID", "governed instruction targets a different program");
    }
    const data = copyBytes(input.instruction.data, "business instruction data");
    if (data.length === 0
        || data.length + GOVERNANCE_TAIL_V1_BYTES > GOVERNED_INSTRUCTION_DATA_MAX_BYTES) {
        fail("GOVERNED_INSTRUCTION_DATA_INVALID", "business instruction data plus the governance tail is outside the exact outer bounds");
    }
    const recognizedInstructionTags = validateRecognizedInstructionTagsV1(input.recognizedInstructionTags, data[0]);
    if (endsWithGovernanceInstructionTailV1(data)) {
        fail("GOVERNED_INSTRUCTION_ALREADY_ENVELOPED", "business instruction already carries a canonical governance tail");
    }
    if (input.instruction.keys.some((meta) => meta.pubkey.equals(context.gateAddress))) {
        fail("GOVERNED_INSTRUCTION_GATE_META_INVALID", "business instruction already contains the canonical governance gate");
    }
    return Object.freeze({
        instruction: cloneTransactionInstructionV1(input.instruction),
        context: freezeContext(context),
        recognizedInstructionTags,
    });
}
function appendGovernanceEnvelopeV1(instruction, context, recognizedInstructionTags) {
    const governed = new TransactionInstruction({
        programId: new PublicKey(instruction.programId.toBytes()),
        keys: [
            ...instruction.keys.map(cloneAccountMetaV1),
            {
                pubkey: new PublicKey(context.gateAddress.toBytes()),
                isSigner: false,
                isWritable: false,
            },
        ],
        data: Buffer.concat([
            Buffer.from(instruction.data),
            Buffer.from(encodeGovernanceInstructionTailV1(context.epoch)),
        ]),
    });
    const inspected = inspectGovernedInstructionEnvelopeV1({
        instruction: governed,
        context,
        recognizedInstructionTags,
    });
    if (!bytesEqual(inspected.legacyData, instruction.data)) {
        fail("GOVERNED_INSTRUCTION_DATA_INVALID", "governance wrapping changed business instruction bytes");
    }
    return governed;
}
function cloneTransactionInstructionV1(instruction) {
    return new TransactionInstruction({
        programId: new PublicKey(instruction.programId.toBytes()),
        keys: instruction.keys.map(cloneAccountMetaV1),
        data: Buffer.from(instruction.data),
    });
}
function cloneAccountMetaV1(meta) {
    return {
        pubkey: new PublicKey(meta.pubkey.toBytes()),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
    };
}
function isCanonicalAccountMetaV1(meta) {
    return meta !== null
        && typeof meta === "object"
        && isSdkPublicKey(meta.pubkey)
        && typeof meta.isSigner === "boolean"
        && typeof meta.isWritable === "boolean";
}
function validateRecognizedInstructionTagsV1(value, tag) {
    if (!Array.isArray(value)) {
        fail("GOVERNED_INSTRUCTION_TAG_UNRECOGNIZED", "recognized instruction tags must be an exact array");
    }
    const snapshot = [...value];
    const recognized = new Set(snapshot);
    if (recognized.size !== snapshot.length
        || !snapshot.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
        || !recognized.has(tag)) {
        fail("GOVERNED_INSTRUCTION_TAG_UNRECOGNIZED", "instruction tag is not assigned by the exact write release");
    }
    return Object.freeze(snapshot);
}
function endsWithGovernanceInstructionTailV1(data) {
    if (data.length < GOVERNANCE_TAIL_V1_BYTES)
        return false;
    try {
        decodeGovernanceInstructionTailV1(data.subarray(-GOVERNANCE_TAIL_V1_BYTES));
        return true;
    }
    catch (cause) {
        if (cause instanceof GovernanceGateValidationError)
            return false;
        throw cause;
    }
}
function validateContext(value) {
    try {
        const identity = governanceIdentityForGenerationV1(value?.identityGeneration);
        if (value === null
            || typeof value !== "object"
            || !(isSdkPublicKey(value.controllerProgram))
            || !(isSdkPublicKey(value.controllerConfig))
            || !(isSdkPublicKey(value.gateAddress))
            || !(isSdkPublicKey(value.targetProgram))
            || !(isSdkPublicKey(value.targetProgramData))
            || value.genesisHash !== CURRENT_LIVE_DEPLOYMENT.genesisHash
            || !value.controllerProgram.equals(new PublicKey(identity.controllerProgramId))
            || !value.controllerConfig.equals(new PublicKey(identity.controllerConfigPda))
            || !value.gateAddress.equals(new PublicKey(identity.protocolGatePda))
            || !value.targetProgram.equals(new PublicKey(identity.targetProgramId))
            || !value.targetProgramData.equals(new PublicKey(identity.targetProgramData))
            || statusNameFor(value.status) !== value.statusName) {
            fail("GOVERNANCE_CONTEXT_INVALID", "governance context mixes identities or contains noncanonical fields");
        }
    }
    catch (cause) {
        if (cause instanceof GovernanceGateValidationError)
            throw cause;
        fail("GOVERNANCE_CONTEXT_INVALID", "governance context mixes identities or contains noncanonical fields");
    }
    requireU64(value.epoch, "epoch");
    requireSafeSlot(value.finalizedObservationSlot, "finalizedObservationSlot");
    return value;
}
function freezeContext(value) {
    return Object.freeze({
        ...value,
        controllerProgram: new PublicKey(value.controllerProgram.toBytes()),
        controllerConfig: new PublicKey(value.controllerConfig.toBytes()),
        gateAddress: new PublicKey(value.gateAddress.toBytes()),
        targetProgram: new PublicKey(value.targetProgram.toBytes()),
        targetProgramData: new PublicKey(value.targetProgramData.toBytes()),
    });
}
function requireRpcMethod(value, name) {
    if (value === null || typeof value !== "object" || typeof value[name] !== "function") {
        fail("GOVERNANCE_RPC_INVALID", `governance RPC is missing ${String(name)}`);
    }
    return value[name];
}
function statusNameFor(status) {
    if (status === GOVERNANCE_GATE_STATUS_V1.Active)
        return "Active";
    if (status === GOVERNANCE_GATE_STATUS_V1.FrozenForUpgrade)
        return "FrozenForUpgrade";
    if (status === GOVERNANCE_GATE_STATUS_V1.EmergencyFrozen)
        return "EmergencyFrozen";
    fail("GOVERNANCE_GATE_STATUS_UNSUPPORTED", "ProtocolGateV1 status is unsupported");
}
function requireCanonicalStatus(gate) {
    const proposalDefault = gate.activeProposal.equals(PublicKey.default);
    const clear = gate.freezeSlot === 0n && gate.freezeReasonCode === 0;
    const frozen = gate.freezeSlot !== 0n && gate.freezeReasonCode !== 0;
    if ((gate.status === GOVERNANCE_GATE_STATUS_V1.Active && !(proposalDefault && clear))
        || (gate.status === GOVERNANCE_GATE_STATUS_V1.FrozenForUpgrade && !(!proposalDefault && frozen))
        || (gate.status === GOVERNANCE_GATE_STATUS_V1.EmergencyFrozen && !(proposalDefault && frozen))) {
        fail("GOVERNANCE_GATE_STATUS_FIELDS_INVALID", "ProtocolGateV1 status fields are not canonical");
    }
}
function validateGovernanceIdentityV1(value) {
    if (value === CURRENT_GOVERNANCE_GENERATION_3
        || value === CURRENT_GOVERNANCE_GENERATION_1
        || value === REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE) {
        return value;
    }
    fail("GOVERNANCE_GENERATION_MISMATCH", "governance identity is not an exact release-train Generation 1 or reviewed Generation 2 identity");
}
function governanceIdentityForGenerationV1(value) {
    if (value === 3)
        return CURRENT_GOVERNANCE_GENERATION_3;
    if (value === 1)
        return CURRENT_GOVERNANCE_GENERATION_1;
    if (value === 2)
        return REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE;
    fail("GOVERNANCE_GENERATION_MISMATCH", "governance context identity generation is unsupported");
}
function canonicalPublicKey(value, field) {
    try {
        const key = canonicalSdkPublicKey(value);
        if (typeof value === "string" && key.toBase58() !== value)
            throw new Error("noncanonical");
        return key;
    }
    catch {
        fail("GOVERNANCE_PUBLIC_KEY_INVALID", `${field} is not a canonical Solana public key`);
    }
}
function publicKeyAt(bytes, offset) {
    return new PublicKey(bytes.subarray(offset, offset + 32));
}
function asciiBytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code > 0x7f)
            throw new TypeError("ASCII constants must contain only ASCII bytes");
        bytes[index] = code;
    }
    return bytes;
}
function bytesEqual(left, right) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
function readBigUint64Le(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}
function readUint16Le(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}
function copyBytes(value, field) {
    if (!(value instanceof Uint8Array)) {
        fail("GOVERNANCE_BYTES_INVALID", `${field} must be a Uint8Array`);
    }
    return Uint8Array.from(value);
}
function requireNondefault(value, field) {
    if (value.equals(PublicKey.default)) {
        fail("GOVERNANCE_GATE_LINKAGE_INVALID", `${field} must be nondefault`);
    }
}
function requireU64(value, field) {
    if (typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) {
        fail("GOVERNANCE_U64_INVALID", `${field} must be a u64 bigint`);
    }
}
function requireSafeSlot(value, field) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        fail("GOVERNANCE_SLOT_INVALID", `${field} must be a nonnegative safe integer`);
    }
    return value;
}
function fail(code, message) {
    throw new GovernanceGateValidationError(code, message);
}
//# sourceMappingURL=governance.js.map