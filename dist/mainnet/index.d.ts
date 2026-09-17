import { type Connection } from "@solana/web3.js";
export { MAINNET_PROFILE } from "./profile.js";
export declare class MainnetSdkError extends Error {
    readonly code: string;
    readonly status: number;
    readonly statusCode: number;
    constructor(code: string);
}
/** Validate privately; never include the supplied URL in errors or observations. */
export declare function assertMainnetHeliusEndpoint(endpoint: string): void;
/** Finalized read-only identity. Activation, market bootstrap and Photon are separate gates. */
export declare function observeMainnetDeployment(connection: Connection, minimumContextSlot?: number): Promise<Readonly<{
    network: "mainnet-beta";
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    programId: "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw";
    controllerProgramId: "8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx";
    profileSha256: "e51c6850d1dd262f152a4d2171ded32c7c2ca874da511009b1ac8cbec14977d0";
    observedSlot: number;
    artifactSha256: "47966df3fb8f1ff997723ccf8868a031b729fc945ae5110d78ea0104dacfea69";
    gate: "Cdym9p7FvtxEAjF8XuCqSrishB7LmBDXaZGDMMgWczu";
    gateStatus: import("@amoeba/spread-release-tools/governance-gate").ProtocolGateStatusV1;
    epoch: string;
    gateActive: boolean;
    tradeReady: false;
    readinessReason: "MAINNET_MARKET_AND_PHOTON_QUALIFICATION_REQUIRED" | "MAINNET_GATE_NOT_ACTIVE";
}>>;
export { createMainnetSdkAdapter } from "./adapter.js";
//# sourceMappingURL=index.d.ts.map