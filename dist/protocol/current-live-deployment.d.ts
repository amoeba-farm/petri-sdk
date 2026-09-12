import { PublicKey } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { CURRENT_LIVE_DEPLOYMENT } from "./release-train.js";
interface CurrentLiveAccountInfo {
    readonly data: Uint8Array;
    readonly executable: boolean;
    readonly owner: PublicKey;
}
export interface CurrentLiveDeploymentRpc {
    getGenesisHash(): Promise<string>;
    getMultipleAccountsInfoAndContext(addresses: PublicKey[], config: {
        readonly commitment: "finalized";
        readonly minContextSlot: number;
    }): Promise<{
        readonly context: {
            readonly slot: number;
        };
        readonly value: readonly (CurrentLiveAccountInfo | null)[];
    }>;
}
export interface CurrentLiveDeploymentFacts {
    readonly qualification: typeof CURRENT_LIVE_DEPLOYMENT.kind;
    readonly provenance: typeof CURRENT_LIVE_DEPLOYMENT.provenance;
    readonly sourceCommit: string | null;
    readonly artifactSourceCommit: string;
    /** ELF prefix identity, excluding allocated ProgramData padding. */
    readonly artifactSha256: typeof CURRENT_LIVE_DEPLOYMENT.artifactSha256;
    readonly artifactBytes: typeof CURRENT_LIVE_DEPLOYMENT.artifactBytes;
    readonly mandatoryZeroPaddingBytes: typeof CURRENT_LIVE_DEPLOYMENT.mandatoryZeroPaddingBytes;
    readonly liveReadProfileId: string;
    readonly releaseLabel: string;
    readonly cluster: typeof CURRENT_LIVE_DEPLOYMENT.cluster;
    readonly genesisHash: typeof CURRENT_LIVE_DEPLOYMENT.genesisHash;
    readonly observedSlot: number;
    readonly programId: typeof CURRENT_LIVE_DEPLOYMENT.programId;
    readonly programDataAddress: typeof CURRENT_LIVE_DEPLOYMENT.programDataAddress;
    readonly programAccountSha256: typeof CURRENT_LIVE_DEPLOYMENT.programAccountSha256;
    readonly programDataAccountBytes: typeof CURRENT_LIVE_DEPLOYMENT.programDataAccountBytes;
    readonly programDataAccountSha256: typeof CURRENT_LIVE_DEPLOYMENT.programDataAccountSha256;
    readonly programDataPayloadBytes: typeof CURRENT_LIVE_DEPLOYMENT.programDataPayloadBytes;
    readonly programDataPayloadSha256: typeof CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256;
    readonly programDataSlot: typeof CURRENT_LIVE_DEPLOYMENT.programDataSlot;
    readonly upgradeAuthority: typeof CURRENT_LIVE_DEPLOYMENT.upgradeAuthority.address;
    readonly governance: {
        readonly identityGeneration: 1 | 2 | 3;
        readonly controllerProgramId: string;
        readonly protocolGatePda: string;
        readonly status: "Active" | "FrozenForUpgrade" | "EmergencyFrozen";
        readonly epoch: string;
        readonly accountSha256: string;
    };
    readonly writeCompatibility: typeof CURRENT_LIVE_DEPLOYMENT.writeCompatibility;
    readonly writeReady: boolean;
    readonly businessState: "uninitialized" | "paused" | "ready";
    readonly verified: true;
}
export declare class CurrentLiveDeploymentValidationError extends AmebaProtocolError {
    constructor(code: string, message: string);
}
/**
 * Qualifies the live Program, ProgramData, and selected governance gate in one
 * finalized multi-account observation. Historical unavailable releases prove
 * bytes only. Current readiness additionally requires the package-owned release
 * qualifier and an Active gate; these read facts are not a signing capability.
 */
export declare function readCurrentLiveDeploymentFacts(input: {
    readonly rpc: CurrentLiveDeploymentRpc;
    readonly minimumContextSlot?: number;
}): Promise<CurrentLiveDeploymentFacts>;
export {};
//# sourceMappingURL=current-live-deployment.d.ts.map