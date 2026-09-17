import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, decodeProtocolGateV1, deriveProtocolGatePdaV1 } from "@amoeba/spread-release-tools/governance-gate";
import { MAINNET_PROFILE as p } from "./profile.js";
export { MAINNET_PROFILE } from "./profile.js";
export class MainnetSdkError extends Error {
    code;
    status;
    statusCode;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "MainnetSdkError";
        this.status = this.statusCode = code === "MAINNET_GATE_NOT_ACTIVE" ? 409 : 503;
    }
}
/** Validate privately; never include the supplied URL in errors or observations. */
export function assertMainnetHeliusEndpoint(endpoint) {
    let url;
    try {
        url = new URL(endpoint);
    }
    catch {
        throw new MainnetSdkError("MAINNET_HELIUS_ENDPOINT_REQUIRED");
    }
    if (url.protocol !== "https:" || url.hostname !== "mainnet.helius-rpc.com" || url.username || url.password
        || (url.port && url.port !== "443") || url.pathname !== "/" || url.hash
        || url.searchParams.getAll("api-key").length !== 1 || !url.searchParams.get("api-key")) {
        throw new MainnetSdkError("MAINNET_HELIUS_ENDPOINT_REQUIRED");
    }
}
/** Finalized read-only identity. Activation, market bootstrap and Photon are separate gates. */
export async function observeMainnetDeployment(connection, minimumContextSlot = p.deployedSlot) {
    assertMainnetHeliusEndpoint(connection.rpcEndpoint);
    if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 0)
        throw new MainnetSdkError("MAINNET_INVALID_SLOT");
    if (await connection.getGenesisHash().catch(() => { throw new MainnetSdkError("MAINNET_RPC_UNAVAILABLE"); }) !== p.genesisHash)
        throw new MainnetSdkError("MAINNET_GENESIS_MISMATCH");
    const floor = Math.max(minimumContextSlot, p.minimumContextSlot);
    const addresses = [p.programId, p.programData, p.gate].map(v => new PublicKey(v));
    const read = await connection.getMultipleAccountsInfoAndContext(addresses, { commitment: "finalized", minContextSlot: floor }).catch(() => { throw new MainnetSdkError("MAINNET_RPC_UNAVAILABLE"); });
    const [program, data, gateAccount] = read.value;
    if (!Number.isSafeInteger(read.context.slot) || read.context.slot < floor || !program || !data || !gateAccount)
        throw new MainnetSdkError("MAINNET_ACCOUNTS_UNAVAILABLE");
    if (!program.executable || data.executable || !program.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
        || !data.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || program.data.length !== 36
        || program.data.readUInt32LE(0) !== 2 || !program.data.subarray(4).equals(addresses[1].toBuffer())
        || data.data.length < 45 + p.artifactBytes || data.data.readUInt32LE(0) !== 3
        || data.data.readBigUInt64LE(4) !== BigInt(p.deployedSlot) || data.data[12] !== 1
        || !data.data.subarray(13, 45).equals(new PublicKey(p.upgradeAuthority).toBuffer())
        || createHash("sha256").update(data.data.subarray(45, 45 + p.artifactBytes)).digest("hex") !== p.artifactSha256
        || data.data.subarray(45 + p.artifactBytes).some(b => b !== 0))
        throw new MainnetSdkError("MAINNET_EXECUTABLE_MISMATCH");
    if (gateAccount.executable || !gateAccount.owner.equals(new PublicKey(p.controllerProgramId)))
        throw new MainnetSdkError("MAINNET_GATE_OWNER_MISMATCH");
    const gate = decodeProtocolGateV1(gateAccount.data);
    const [address, bump] = deriveProtocolGatePdaV1(new PublicKey(p.controllerProgramId), addresses[0], 3);
    if (address.toBase58() !== p.gate || gate.bump !== bump || gate.controllerConfig.toBase58() !== p.controllerConfig
        || gate.targetProgram.toBase58() !== p.programId || gate.targetProgramdata.toBase58() !== p.programData)
        throw new MainnetSdkError("MAINNET_GATE_IDENTITY_MISMATCH");
    return Object.freeze({ network: p.network, genesisHash: p.genesisHash, programId: p.programId,
        controllerProgramId: p.controllerProgramId, profileSha256: p.profileSha256, observedSlot: read.context.slot,
        artifactSha256: p.artifactSha256, gate: p.gate, gateStatus: gate.status, epoch: gate.epoch.toString(),
        gateActive: gate.status === 0, tradeReady: false,
        readinessReason: gate.status === 0 ? "MAINNET_MARKET_AND_PHOTON_QUALIFICATION_REQUIRED" : "MAINNET_GATE_NOT_ACTIVE" });
}
export { createMainnetSdkAdapter } from "./adapter.js";
//# sourceMappingURL=index.js.map