import { canonicalSdkPublicKey, isSdkPublicKey } from "../protocol/public-key-value.js";
import { CURRENT_LIVE_DEPLOYMENT as live, CURRENT_GOVERNANCE_GENERATION_3, assertCurrentWriteReleaseAvailable } from "../protocol/release-train.js";
import { observeCurrentV3RuntimeV1 } from "../protocol/current-v3-runtime.js";
/** Finalized browser RPC re-observation and exact RC44 deployment verification. */
import { PublicKey, } from "@solana/web3.js";
import { validateCurrentFinalizedObservation, } from "../current-finalized-observation.js";
import { readU32Le, readU64Le, sha256Hex, walletError } from "./codec.js";
export const CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS = 110n;
export const CURRENT_WALLET_MAX_TRANSACTION_BYTES = 1_232;
export const CURRENT_WALLET_PROTOCOL_IDENTITY = Object.freeze({
    identityKind: "v3-governed-wallet-materializer",
    currentWriteEligible: true,
    releaseLabel: live.releaseLabel,
    liveReadProfileId: live.liveReadProfileId,
    programAccountSha256: live.programAccountSha256,
    protocolPlanSdkCommit: "b2cd10739ecb9419115980425920d6b576caf78e",
    protocolRelease: "v0.1.0-rc.44",
    protocolSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    programId: live.programId,
    programDataAddress: live.programDataAddress,
    programDataBytes: live.programDataAccountBytes,
    upgradeAuthority: live.upgradeAuthority.address,
    deployedSlot: live.programDataSlot,
    programPayloadBytes: live.programDataPayloadBytes,
    programPayloadSha256: live.programDataPayloadSha256,
    programDataCapacitySha256: live.programDataPayloadSha256,
    programDataAccountSha256: live.programDataAccountSha256,
});
const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAM_ID = new PublicKey(CURRENT_WALLET_PROTOCOL_IDENTITY.programId);
const PROGRAM_DATA_ID = new PublicKey(CURRENT_WALLET_PROTOCOL_IDENTITY.programDataAddress);
export async function reobserveCurrentWalletPlan(rpc, admittedObservation) {
    assertCurrentWriteReleaseAvailable();
    const observation = validateCurrentFinalizedObservation(admittedObservation);
    const originalSlot = safeSlot(observation.observedAtSlot, "prepared observation slot");
    const runtime = await observeCurrentV3RuntimeV1({ rpc, minimumContextSlot: Math.max(originalSlot, live.minimumContextSlot), requireWriteReady: true });
    const governance = { identityGeneration: 3, genesisHash: live.genesisHash, controllerProgram: new PublicKey(CURRENT_GOVERNANCE_GENERATION_3.controllerProgramId), controllerConfig: runtime.gate.controllerConfig, gateAddress: new PublicKey(CURRENT_GOVERNANCE_GENERATION_3.protocolGatePda), targetProgram: PROGRAM_ID, targetProgramData: PROGRAM_DATA_ID, status: runtime.gate.status, statusName: runtime.gate.statusName, epoch: runtime.gate.epoch, finalizedObservationSlot: runtime.observedSlot };
    const addresses = observation.orderedAccounts.map((account) => new PublicKey(account.address));
    if (addresses[0]?.toBase58() !== PROGRAM_ID.toBase58()
        || addresses[1]?.toBase58() !== PROGRAM_DATA_ID.toBase58()) {
        walletError("CURRENT_WALLET_DEPLOYMENT_INVALID", "prepared observation does not begin with the pinned Program and ProgramData identities");
    }
    const rpcOrigin = canonicalRpcOrigin(rpc?.rpcEndpoint);
    if (typeof rpc?.getGenesisHash !== "function"
        || typeof rpc?.getMultipleAccountsInfoAndContext !== "function"
        || typeof rpc?.getBlockTime !== "function"
        || typeof rpc?.getLatestBlockhashAndContext !== "function"
        || typeof rpc?.isBlockhashValid !== "function") {
        walletError("CURRENT_WALLET_RPC_INVALID", "the injected finalized RPC capability is incomplete");
    }
    const [genesisHash, snapshot] = await Promise.all([
        rpc.getGenesisHash(),
        rpc.getMultipleAccountsInfoAndContext(addresses, {
            commitment: "finalized",
            minContextSlot: originalSlot,
        }),
    ]);
    if (genesisHash !== CURRENT_WALLET_PROTOCOL_IDENTITY.genesisHash) {
        walletError("CURRENT_WALLET_GENESIS_MISMATCH", "the injected RPC is not the pinned Devnet genesis");
    }
    // RPC response graphs remain caller-owned. Capture every field that survives
    // the next await once, then validate and consume only the owned locals.
    const snapshotSlot = snapshot?.context?.slot;
    const snapshotValues = snapshot?.value;
    if (!snapshot || typeof snapshotSlot !== "number" || !Number.isSafeInteger(snapshotSlot)
        || snapshotSlot < originalSlot || !Array.isArray(snapshotValues)
        || snapshotValues.length !== addresses.length) {
        walletError("CURRENT_WALLET_RPC_INVALID", "finalized account re-observation is malformed or regressed");
    }
    const observedSlot = snapshotSlot;
    const accountInfos = new Map();
    for (let index = 0; index < observation.orderedAccounts.length; index += 1) {
        const admitted = observation.orderedAccounts[index];
        const actual = snapshotAccountInfo(snapshotValues[index] ?? null, `ordered account ${index}`);
        requireSameObservedAccount(admitted, actual, index);
        accountInfos.set(admitted.address, actual);
    }
    verifyPinnedProgramDeployment(requireAccount(accountInfos.get(PROGRAM_ID.toBase58()), "Program"), requireAccount(accountInfos.get(PROGRAM_DATA_ID.toBase58()), "ProgramData"));
    const blockTime = await rpc.getBlockTime(observedSlot);
    if (!Number.isSafeInteger(blockTime) || blockTime <= 0) {
        walletError("CURRENT_WALLET_RPC_INVALID", "finalized re-observation has no admissible block time");
    }
    const preparedBlockTime = BigInt(observation.observedBlockTimeUnixSeconds);
    const currentBlockTime = BigInt(blockTime);
    if (currentBlockTime < preparedBlockTime) {
        walletError("CURRENT_WALLET_RPC_INVALID", "finalized block time regressed behind the prepared observation");
    }
    if (currentBlockTime >= preparedBlockTime + CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS) {
        walletError("CURRENT_WALLET_PLAN_STALE", "prepared operation observation expired; request a fresh plan");
    }
    return Object.freeze({
        observation,
        governance,
        accountInfos,
        rpcOrigin,
        observedSlot,
        observedBlockTimeUnixSeconds: currentBlockTime,
    });
}
function snapshotAccountInfo(value, label) {
    if (value === null)
        return null;
    if (typeof value !== "object" || !(isSdkPublicKey(value.owner))
        || typeof value.executable !== "boolean" || !Number.isSafeInteger(value.lamports)
        || value.lamports < 0 || (value.rentEpoch !== undefined
        && (!Number.isSafeInteger(value.rentEpoch) || value.rentEpoch < 0))) {
        walletError("CURRENT_WALLET_RPC_INVALID", `${label} metadata is malformed`);
    }
    return Object.freeze({
        owner: canonicalSdkPublicKey(value.owner),
        executable: value.executable,
        lamports: value.lamports,
        ...(value.rentEpoch === undefined ? {} : { rentEpoch: value.rentEpoch }),
        data: new Uint8Array(asBytes(value.data, label)),
    });
}
function requireSameObservedAccount(admitted, actual, index) {
    if (actual === null) {
        if (admitted.owner !== null || admitted.executable !== null
            || admitted.dataLength !== null || admitted.dataSha256 !== null) {
            walletError("CURRENT_WALLET_STATE_DRIFT", `ordered account ${index} became absent`);
        }
        return;
    }
    const bytes = asBytes(actual.data, `ordered account ${index}`);
    if (admitted.owner !== actual.owner.toBase58()
        || admitted.executable !== actual.executable
        || admitted.dataLength !== String(bytes.length)
        || admitted.dataSha256 !== sha256Hex(bytes)) {
        walletError("CURRENT_WALLET_STATE_DRIFT", `ordered account ${index} changed after preparation`);
    }
}
function verifyPinnedProgramDeployment(program, programData) {
    const programBytes = asBytes(program.data, "Program");
    if (!program.owner.equals(BPF_UPGRADEABLE_LOADER_ID) || !program.executable
        || programBytes.length !== 36 || readU32Le(programBytes, 0) !== 2
        || !new PublicKey(programBytes.subarray(4, 36)).equals(PROGRAM_DATA_ID)) {
        walletError("CURRENT_WALLET_DEPLOYMENT_INVALID", "Program linkage is not the pinned upgradeable deployment");
    }
    const data = asBytes(programData.data, "ProgramData");
    const identity = CURRENT_WALLET_PROTOCOL_IDENTITY;
    if (!programData.owner.equals(BPF_UPGRADEABLE_LOADER_ID) || programData.executable
        || data.length !== identity.programDataBytes || readU32Le(data, 0) !== 3
        || readU64Le(data, 4) !== BigInt(identity.deployedSlot) || data[12] !== 1
        || !new PublicKey(data.subarray(13, 45)).equals(new PublicKey(identity.upgradeAuthority))) {
        walletError("CURRENT_WALLET_DEPLOYMENT_INVALID", "ProgramData header is not the reviewed RC44 deployment");
    }
    const payloadEnd = 45 + identity.programPayloadBytes;
    const payload = data.subarray(45, payloadEnd);
    const trailing = data.subarray(payloadEnd);
    if (sha256Hex(data) !== identity.programDataAccountSha256
        || payload.length !== identity.programPayloadBytes
        || sha256Hex(payload) !== identity.programPayloadSha256
        || trailing.some((byte) => byte !== 0)) {
        walletError("CURRENT_WALLET_DEPLOYMENT_INVALID", "ProgramData payload is not the reviewed RC44 artifact");
    }
}
function safeSlot(value, label) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || BigInt(parsed) !== BigInt(value)) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is not a safe finalized slot`);
    }
    return parsed;
}
function canonicalRpcOrigin(endpoint) {
    if (typeof endpoint !== "string") {
        walletError("CURRENT_WALLET_RPC_INVALID", "RPC endpoint is unavailable");
    }
    try {
        const url = new URL(endpoint);
        if (url.protocol !== "https:")
            throw new Error("insecure");
        return url.origin;
    }
    catch {
        walletError("CURRENT_WALLET_RPC_INVALID", "wallet re-observation requires an HTTPS RPC endpoint");
    }
}
function requireAccount(value, label) {
    if (value === null || value === undefined) {
        walletError("CURRENT_WALLET_DEPLOYMENT_INVALID", `${label} is absent from finalized state`);
    }
    return value;
}
function asBytes(value, label) {
    if (!(value instanceof Uint8Array)) {
        walletError("CURRENT_WALLET_RPC_INVALID", `${label} data is not a byte array`);
    }
    return value;
}
//# sourceMappingURL=observation.js.map