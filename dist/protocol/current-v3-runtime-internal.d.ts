import { PublicKey } from "@solana/web3.js";
import { type GovernanceGateRpcV1 } from "./governance.js";
/** Package-private observation after the caller has verified the exact Devnet genesis. */
export declare function observeCurrentV3RuntimeAfterGenesisV1(input: {
    readonly rpc: Pick<GovernanceGateRpcV1, "getGenesisHash" | "getMultipleAccountsInfoAndContext">;
    readonly minimumContextSlot: number;
    readonly requireWriteReady?: boolean;
}): Promise<Readonly<{
    observedSlot: number;
    gate: import("./governance.js").ProtocolGovernanceGateV1;
    gateAccountSha256: string;
    businessState: "paused" | "uninitialized" | "ready";
    writeReady: boolean;
    vaultAddress: PublicKey;
}>>;
//# sourceMappingURL=current-v3-runtime-internal.d.ts.map