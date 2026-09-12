import type { GovernanceGateRpcV1 } from "./governance.js";
/** Finalized deployment and business readiness, distinct from package capability. */
export declare function observeCurrentV3RuntimeV1(input: {
    readonly rpc: Pick<GovernanceGateRpcV1, "getGenesisHash" | "getMultipleAccountsInfoAndContext">;
    readonly minimumContextSlot: number;
    readonly requireWriteReady?: boolean;
}): Promise<Readonly<{
    observedSlot: number;
    gate: import("./governance.js").ProtocolGovernanceGateV1;
    gateAccountSha256: string;
    businessState: "paused" | "uninitialized" | "ready";
    writeReady: boolean;
    vaultAddress: import("@solana/web3.js").PublicKey;
}>>;
//# sourceMappingURL=current-v3-runtime.d.ts.map