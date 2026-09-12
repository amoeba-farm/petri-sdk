import { isSdkPublicKey } from "./public-key-value.js";
import { observeCurrentV3RuntimeAfterGenesisV1 } from "./current-v3-runtime-internal.js";
import { Buffer } from "buffer";
import { AddressLookupTableAccount, AddressLookupTableProgram, Message, MessageV0, PACKET_DATA_SIZE, PublicKey, TransactionMessage, VersionedTransaction, } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { CURRENT_LIVE_DEPLOYMENT, CURRENT_GOVERNANCE_GENERATION_1, CURRENT_GOVERNANCE_GENERATION_3, REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE, } from "./release-train.js";
import { inspectGovernedInstructionEnvelopeV1, observeGovernanceGateV1, } from "./governance.js";
const ADDRESS_LOOKUP_TABLE_META_BYTES = 56;
const ADDRESS_LOOKUP_TABLE_ACTIVE_DEACTIVATION_SLOT = 0xffffffffffffffffn;
const MAX_TRANSACTION_INSTRUCTIONS = 64;
const MAX_TRANSACTION_LOOKUP_TABLES = 32;
export class GovernedTransactionValidationError extends AmebaProtocolError {
    constructor(code, message) {
        super(message, { code });
    }
}
/** @internal Positive-path seam for exact package-owned release bindings and tests. */
export async function revalidateBoundGovernedTransactionV1(input) {
    if (input === null || typeof input !== "object") {
        fail("GOVERNED_TRANSACTION_INPUT_INVALID", "governed transaction input is malformed");
    }
    const release = validateBoundGovernedWriteReleaseV1(input.release);
    const minimumContextSlot = safeSlot(input.minimumContextSlot, "minimumContextSlot");
    const rpc = snapshotRpc(input.rpc);
    const serialized = canonicalTransactionBase64(input.serializedTransactionBase64);
    const transaction = deserializeCanonicalTransaction(serialized);
    // Preserve the cross-network-before-account-reads boundary. The later gate
    // observation repeats this check immediately before returning success.
    const genesisHash = await rpc.getGenesisHash();
    if (genesisHash !== CURRENT_LIVE_DEPLOYMENT.genesisHash) {
        fail("GOVERNED_TRANSACTION_CLUSTER_IDENTITY_MISMATCH", "governed transaction RPC genesis hash is not the selected Devnet identity");
    }
    const lookupResult = await resolveLookupTables(transaction, rpc, minimumContextSlot);
    const gateMinimumSlot = Math.max(minimumContextSlot, lookupResult.finalizedObservationSlot);
    let governance;
    if (release.governanceIdentityGeneration === 3) {
        // The initial genesis check precedes all account reads. Reuse only this
        // invocation's coherent, fully validated runtime observation for gate
        // authority; its slot also covers every lookup-table observation.
        const runtime = await observeCurrentV3RuntimeAfterGenesisV1({
            rpc, minimumContextSlot: gateMinimumSlot, requireWriteReady: true,
        });
        // Preserve the independent cross-network check immediately before success.
        if (await rpc.getGenesisHash() !== CURRENT_LIVE_DEPLOYMENT.genesisHash) {
            fail("GOVERNANCE_CLUSTER_IDENTITY_MISMATCH", "governance RPC genesis hash is not the selected Devnet identity");
        }
        const gate = runtime.gate;
        governance = Object.freeze({
            identityGeneration: release.identity.identityGeneration,
            genesisHash: CURRENT_LIVE_DEPLOYMENT.genesisHash,
            controllerProgram: new PublicKey(release.identity.controllerProgramId),
            controllerConfig: new PublicKey(gate.controllerConfig.toBytes()),
            gateAddress: new PublicKey(release.identity.protocolGatePda),
            targetProgram: new PublicKey(gate.targetProgram.toBytes()),
            targetProgramData: new PublicKey(gate.targetProgramData.toBytes()),
            status: gate.status,
            statusName: gate.statusName,
            epoch: gate.epoch,
            finalizedObservationSlot: runtime.observedSlot,
        });
    }
    else {
        governance = await observeGovernanceGateV1({
            rpc,
            identity: release.identity,
            minimumContextSlot: gateMinimumSlot,
            requireActive: true,
        });
    }
    const instructions = decompileInstructions(transaction, lookupResult.accounts);
    requireUniqueResolvedAccountKeys(transaction, lookupResult.accounts);
    let targetInstructionCount = 0;
    for (const instruction of instructions) {
        if (!instruction.programId.equals(governance.targetProgram))
            continue;
        inspectGovernedInstructionEnvelopeV1({
            instruction,
            context: governance,
            recognizedInstructionTags: release.assignedInstructionTags,
        });
        targetInstructionCount += 1;
    }
    return Object.freeze({
        validated: true,
        transactionVersion: transaction.version,
        serializedByteLength: serialized.length,
        requiredSignatureCount: transaction.message.header.numRequiredSignatures,
        instructionCount: instructions.length,
        targetInstructionCount,
        lookupTableAddresses: Object.freeze(lookupResult.accounts.map((table) => table.key.toBase58())),
        identityGeneration: governance.identityGeneration,
        controllerProgram: governance.controllerProgram.toBase58(),
        gateAddress: governance.gateAddress.toBase58(),
        targetProgram: governance.targetProgram.toBase58(),
        epoch: governance.epoch.toString(),
        finalizedObservationSlot: governance.finalizedObservationSlot,
        spreadReleaseCommit: release.spreadReleaseCommit,
        spreadPackageArtifactSha256: release.spreadPackageArtifactSha256,
        instructionManifestSha256: release.instructionManifestSha256,
        programDataPayloadSha256: release.programDataPayloadSha256,
    });
}
/** @internal Exact validation shared by transaction and builder materialization. */
export function validateBoundGovernedWriteReleaseV1(value) {
    if (value === null || typeof value !== "object") {
        fail("GOVERNED_TRANSACTION_RELEASE_INVALID", "governed write release binding is malformed");
    }
    const identity = value.identity;
    if (identity !== CURRENT_GOVERNANCE_GENERATION_3
        && identity !== CURRENT_GOVERNANCE_GENERATION_1
        && identity !== REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE) {
        fail("GOVERNED_TRANSACTION_RELEASE_INVALID", "governed write release identity is not exact");
    }
    if (value.governanceIdentityGeneration !== identity.identityGeneration) {
        fail("GOVERNED_TRANSACTION_RELEASE_INVALID", "governed write release generation is inconsistent");
    }
    if (!Array.isArray(value.assignedInstructionTags)) {
        fail("GOVERNED_TRANSACTION_RELEASE_INVALID", "governed write instruction manifest tags are invalid");
    }
    const assignedInstructionTags = [...value.assignedInstructionTags];
    if (assignedInstructionTags.length === 0
        || assignedInstructionTags.length > 256
        || assignedInstructionTags.some((tag) => !Number.isInteger(tag) || tag < 0 || tag > 255)
        || new Set(assignedInstructionTags).size !== assignedInstructionTags.length
        || assignedInstructionTags.some((tag, index) => index > 0 && tag <= assignedInstructionTags[index - 1])) {
        fail("GOVERNED_TRANSACTION_RELEASE_INVALID", "governed write instruction manifest tags are invalid");
    }
    if (!/^[0-9a-f]{40}$/.test(value.spreadReleaseCommit)
        || !isSha256(value.spreadPackageArtifactSha256)
        || !isSha256(value.instructionManifestSha256)
        || !isSha256(value.programDataPayloadSha256)
        || value.programDataPayloadSha256 !== CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256) {
        fail("GOVERNED_TRANSACTION_RELEASE_INVALID", "governed write source, package, manifest, or payload pin is invalid");
    }
    return Object.freeze({
        identity,
        governanceIdentityGeneration: value.governanceIdentityGeneration,
        spreadReleaseCommit: value.spreadReleaseCommit,
        spreadPackageArtifactSha256: value.spreadPackageArtifactSha256,
        instructionManifestSha256: value.instructionManifestSha256,
        programDataPayloadSha256: value.programDataPayloadSha256,
        assignedInstructionTags: Object.freeze(assignedInstructionTags),
    });
}
function snapshotRpc(value) {
    if (value === null || typeof value !== "object") {
        fail("GOVERNED_TRANSACTION_RPC_INVALID", "governed transaction RPC is malformed");
    }
    const getGenesisHash = rpcMethod(value, "getGenesisHash");
    const getAccountInfoAndContext = rpcMethod(value, "getAccountInfoAndContext");
    return Object.freeze({
        ...(typeof value.getMultipleAccountsInfoAndContext === "function" ? { getMultipleAccountsInfoAndContext: value.getMultipleAccountsInfoAndContext.bind(value) } : {}),
        getGenesisHash: getGenesisHash.bind(value),
        getAccountInfoAndContext: getAccountInfoAndContext.bind(value),
    });
}
function rpcMethod(value, name) {
    const method = value[name];
    if (typeof method !== "function") {
        fail("GOVERNED_TRANSACTION_RPC_INVALID", `governed transaction RPC method ${name} is unavailable`);
    }
    return method;
}
function canonicalTransactionBase64(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 1_648) {
        fail("GOVERNED_TRANSACTION_BYTES_INVALID", "transaction must be bounded canonical padded base64");
    }
    let decoded;
    try {
        decoded = Buffer.from(value, "base64");
    }
    catch {
        fail("GOVERNED_TRANSACTION_BYTES_INVALID", "transaction is not valid base64");
    }
    if (decoded.length === 0
        || decoded.length > PACKET_DATA_SIZE
        || decoded.toString("base64") !== value) {
        fail("GOVERNED_TRANSACTION_BYTES_INVALID", "transaction is not canonical or exceeds the packet bound");
    }
    return Uint8Array.from(decoded);
}
function deserializeCanonicalTransaction(serialized) {
    let transaction;
    try {
        transaction = VersionedTransaction.deserialize(serialized);
    }
    catch {
        fail("GOVERNED_TRANSACTION_SERIALIZATION_INVALID", "transaction is not a canonical Solana envelope");
    }
    if (transaction.version !== "legacy" && transaction.version !== 0) {
        fail("GOVERNED_TRANSACTION_VERSION_UNSUPPORTED", "only legacy and v0 transactions are supported");
    }
    let roundTrip;
    try {
        roundTrip = transaction.serialize();
    }
    catch {
        fail("GOVERNED_TRANSACTION_SERIALIZATION_INVALID", "transaction serialization failed closed");
    }
    if (!equalBytes(roundTrip, serialized)) {
        fail("GOVERNED_TRANSACTION_SERIALIZATION_INVALID", "transaction contains trailing or noncanonical bytes");
    }
    const required = transaction.message.header.numRequiredSignatures;
    if (!Number.isInteger(required)
        || required < 1
        || transaction.signatures.length !== required
        || transaction.signatures.some((signature) => signature.length !== 64 || signature.every((byte) => byte === 0))) {
        fail("GOVERNED_TRANSACTION_SIGNATURE_INVALID", "transaction is not completely signed");
    }
    const compiledCount = transaction.message.compiledInstructions.length;
    if (compiledCount < 1 || compiledCount > MAX_TRANSACTION_INSTRUCTIONS) {
        fail("GOVERNED_TRANSACTION_INSTRUCTION_COUNT_INVALID", "transaction instruction count is outside the admitted bound");
    }
    return transaction;
}
async function resolveLookupTables(transaction, rpc, minimumContextSlot) {
    if (!(transaction.message instanceof MessageV0)) {
        if (!(transaction.message instanceof Message)) {
            fail("GOVERNED_TRANSACTION_VERSION_UNSUPPORTED", "transaction message implementation is unsupported");
        }
        return Object.freeze({
            accounts: Object.freeze([]),
            finalizedObservationSlot: minimumContextSlot,
        });
    }
    const descriptors = transaction.message.addressTableLookups;
    if (descriptors.length > MAX_TRANSACTION_LOOKUP_TABLES) {
        fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "transaction uses too many address lookup tables");
    }
    const addresses = descriptors.map((descriptor) => descriptor.accountKey.toBase58());
    if (new Set(addresses).size !== addresses.length) {
        fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "transaction repeats an address lookup table");
    }
    const responses = await Promise.all(descriptors.map((descriptor) => rpc.getAccountInfoAndContext(descriptor.accountKey, {
        commitment: "finalized",
        minContextSlot: minimumContextSlot,
    })));
    let finalizedObservationSlot = minimumContextSlot;
    const accounts = responses.map((response, index) => {
        const descriptor = descriptors[index];
        const slot = safeSlot(response?.context?.slot, "lookup table context slot");
        if (slot < minimumContextSlot) {
            fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "lookup table observation regressed below minContextSlot");
        }
        finalizedObservationSlot = Math.max(finalizedObservationSlot, slot);
        const info = response.value;
        if (info === null
            || typeof info !== "object"
            || !(isSdkPublicKey(info.owner))
            || !(info.data instanceof Uint8Array)
            || info.executable !== false
            || !info.owner.equals(AddressLookupTableProgram.programId)) {
            fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "lookup table account is absent, executable, or foreign-owned");
        }
        return decodeCanonicalLookupTable(descriptor.accountKey, info.data, slot);
    });
    return Object.freeze({
        accounts: Object.freeze(accounts),
        finalizedObservationSlot,
    });
}
function decodeCanonicalLookupTable(key, rawData, finalizedObservationSlot) {
    const data = Buffer.from(rawData);
    if (data.length < ADDRESS_LOOKUP_TABLE_META_BYTES + 32
        || (data.length - ADDRESS_LOOKUP_TABLE_META_BYTES) % 32 !== 0
        || data.readUInt32LE(0) !== 1
        || (data[21] !== 0 && data[21] !== 1)
        || data[54] !== 0
        || data[55] !== 0
        || (data[21] === 0 && data.subarray(22, 54).some((byte) => byte !== 0))) {
        fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "lookup table account bytes are noncanonical");
    }
    let state;
    try {
        state = AddressLookupTableAccount.deserialize(data);
    }
    catch {
        fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "lookup table account layout is invalid");
    }
    const addresses = state.addresses.map((address) => new PublicKey(address.toBytes()));
    const addressStrings = addresses.map((address) => address.toBase58());
    if (state.deactivationSlot !== ADDRESS_LOOKUP_TABLE_ACTIVE_DEACTIVATION_SLOT
        || !Number.isSafeInteger(state.lastExtendedSlot)
        || state.lastExtendedSlot < 0
        || state.lastExtendedSlot >= finalizedObservationSlot
        || !Number.isSafeInteger(state.lastExtendedSlotStartIndex)
        || state.lastExtendedSlotStartIndex < 0
        || state.lastExtendedSlotStartIndex > addresses.length
        || addresses.length < 1
        || addresses.length > 256
        || new Set(addressStrings).size !== addresses.length) {
        fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "lookup table state, activation, or addresses are invalid");
    }
    const canonical = encodeLookupTable({
        deactivationSlot: state.deactivationSlot,
        lastExtendedSlot: state.lastExtendedSlot,
        lastExtendedSlotStartIndex: state.lastExtendedSlotStartIndex,
        authority: state.authority === undefined ? null : state.authority,
        addresses,
    });
    if (!canonical.equals(data)) {
        fail("GOVERNED_TRANSACTION_LOOKUP_TABLE_INVALID", "lookup table bytes differ from their canonical encoding");
    }
    return new AddressLookupTableAccount({
        key: new PublicKey(key.toBytes()),
        state: {
            deactivationSlot: state.deactivationSlot,
            lastExtendedSlot: state.lastExtendedSlot,
            lastExtendedSlotStartIndex: state.lastExtendedSlotStartIndex,
            authority: state.authority === undefined
                ? undefined
                : new PublicKey(state.authority.toBytes()),
            addresses,
        },
    });
}
function encodeLookupTable(input) {
    const data = Buffer.alloc(ADDRESS_LOOKUP_TABLE_META_BYTES + input.addresses.length * 32);
    data.writeUInt32LE(1, 0);
    data.writeBigUInt64LE(input.deactivationSlot, 4);
    data.writeBigUInt64LE(BigInt(input.lastExtendedSlot), 12);
    data[20] = input.lastExtendedSlotStartIndex;
    data[21] = input.authority === null ? 0 : 1;
    if (input.authority !== null)
        input.authority.toBuffer().copy(data, 22);
    input.addresses.forEach((address, index) => address.toBuffer().copy(data, ADDRESS_LOOKUP_TABLE_META_BYTES + index * 32));
    return data;
}
function decompileInstructions(transaction, lookupTables) {
    try {
        const decompiled = transaction.message instanceof MessageV0
            ? TransactionMessage.decompile(transaction.message, {
                addressLookupTableAccounts: [...lookupTables],
            })
            : TransactionMessage.decompile(transaction.message);
        if (decompiled.instructions.length !== transaction.message.compiledInstructions.length) {
            fail("GOVERNED_TRANSACTION_SERIALIZATION_INVALID", "decompiled instruction count is inconsistent");
        }
        return decompiled.instructions;
    }
    catch (cause) {
        if (cause instanceof GovernedTransactionValidationError)
            throw cause;
        fail("GOVERNED_TRANSACTION_SERIALIZATION_INVALID", "transaction account indexes cannot be resolved canonically");
    }
}
function requireUniqueResolvedAccountKeys(transaction, lookupTables) {
    let keys;
    try {
        keys = transaction.message instanceof MessageV0
            ? transaction.message.getAccountKeys({ addressLookupTableAccounts: [...lookupTables] })
            : transaction.message.getAccountKeys();
    }
    catch {
        fail("GOVERNED_TRANSACTION_ACCOUNT_KEYS_INVALID", "transaction account keys cannot be resolved");
    }
    const seen = new Set();
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys.get(index);
        if (key === undefined || seen.has(key.toBase58())) {
            fail("GOVERNED_TRANSACTION_ACCOUNT_KEYS_INVALID", "transaction contains missing or duplicate resolved account keys");
        }
        seen.add(key.toBase58());
    }
}
function safeSlot(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail("GOVERNED_TRANSACTION_SLOT_INVALID", `${field} must be a nonnegative safe integer`);
    }
    return value;
}
function isSha256(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function equalBytes(left, right) {
    if (left.length !== right.length)
        return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}
function fail(code, message) {
    throw new GovernedTransactionValidationError(code, message);
}
//# sourceMappingURL=governed-transaction-internal.js.map