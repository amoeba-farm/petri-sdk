import { observeCurrentV3RuntimeV1 } from "./current-v3-runtime.js";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { BPF_UPGRADEABLE_LOADER_PROGRAM_ID, validateProtocolGovernanceGateAccountV1, } from "./governance.js";
import { CURRENT_GOVERNANCE_GENERATION_3, CURRENT_LIVE_DEPLOYMENT, SDK_RELEASE_TRAIN, } from "./release-train.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
export class CurrentLiveDeploymentValidationError extends AmebaProtocolError {
    constructor(code, message) {
        super(message, { code });
    }
}
/**
 * Qualifies the live Program, ProgramData, and selected governance gate in one
 * finalized multi-account observation. Historical unavailable releases prove
 * bytes only. Current readiness additionally requires the package-owned release
 * qualifier and an Active gate; these read facts are not a signing capability.
 */
export async function readCurrentLiveDeploymentFacts(input) {
    if (input === null || typeof input !== "object" || input.rpc === null || typeof input.rpc !== "object") {
        fail("CURRENT_LIVE_RPC_INVALID", "live deployment input must contain an RPC capability");
    }
    const qualifiedRelease = currentGovernedWriteReleaseV1();
    const identity = qualifiedRelease.identity;
    const runtime = await observeCurrentV3RuntimeV1({ rpc: input.rpc, minimumContextSlot: input.minimumContextSlot ?? CURRENT_LIVE_DEPLOYMENT.minimumContextSlot });
    const gate = runtime.gate;
    return Object.freeze({
        qualification: CURRENT_LIVE_DEPLOYMENT.kind,
        provenance: CURRENT_LIVE_DEPLOYMENT.provenance,
        sourceCommit: qualifiedRelease.spreadReleaseCommit,
        artifactSourceCommit: CURRENT_LIVE_DEPLOYMENT.artifactSourceCommit,
        artifactSha256: CURRENT_LIVE_DEPLOYMENT.artifactSha256,
        artifactBytes: CURRENT_LIVE_DEPLOYMENT.artifactBytes,
        mandatoryZeroPaddingBytes: CURRENT_LIVE_DEPLOYMENT.mandatoryZeroPaddingBytes,
        liveReadProfileId: CURRENT_LIVE_DEPLOYMENT.liveReadProfileId,
        releaseLabel: CURRENT_LIVE_DEPLOYMENT.releaseLabel,
        cluster: CURRENT_LIVE_DEPLOYMENT.cluster,
        genesisHash: CURRENT_LIVE_DEPLOYMENT.genesisHash,
        observedSlot: runtime.observedSlot,
        programId: CURRENT_LIVE_DEPLOYMENT.programId,
        programDataAddress: CURRENT_LIVE_DEPLOYMENT.programDataAddress,
        programAccountSha256: CURRENT_LIVE_DEPLOYMENT.programAccountSha256,
        programDataAccountBytes: CURRENT_LIVE_DEPLOYMENT.programDataAccountBytes,
        programDataAccountSha256: CURRENT_LIVE_DEPLOYMENT.programDataAccountSha256,
        programDataPayloadBytes: CURRENT_LIVE_DEPLOYMENT.programDataPayloadBytes,
        programDataPayloadSha256: CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256,
        programDataSlot: CURRENT_LIVE_DEPLOYMENT.programDataSlot,
        upgradeAuthority: CURRENT_LIVE_DEPLOYMENT.upgradeAuthority.address,
        governance: Object.freeze({
            identityGeneration: identity.identityGeneration,
            controllerProgramId: identity.controllerProgramId,
            protocolGatePda: identity.protocolGatePda,
            status: gate.statusName,
            epoch: gate.epoch.toString(),
            accountSha256: runtime.gateAccountSha256,
        }),
        writeCompatibility: CURRENT_LIVE_DEPLOYMENT.writeCompatibility,
        writeReady: runtime.writeReady,
        businessState: runtime.businessState,
        verified: true,
    });
}
function method(value, name) {
    if (typeof value[name] !== "function") {
        fail("CURRENT_LIVE_RPC_INVALID", `live deployment RPC is missing ${String(name)}`);
    }
    return value[name];
}
function isCurrentLiveAccount(value) {
    if (value === null || typeof value !== "object")
        return false;
    const record = value;
    return record.data instanceof Uint8Array
        && record.owner instanceof PublicKey
        && typeof record.executable === "boolean";
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function fail(code, message) {
    throw new CurrentLiveDeploymentValidationError(code, message);
}
//# sourceMappingURL=current-live-deployment.js.map