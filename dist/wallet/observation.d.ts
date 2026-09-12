import type { GovernanceGateContextV1 } from "../protocol/governance.js";
/** Finalized browser RPC re-observation and exact RC44 deployment verification. */
import { PublicKey, type AccountInfo, type BlockhashWithExpiryBlockHeight, type Commitment, type Context } from "@solana/web3.js";
import { type CurrentFinalizedObservation } from "../current-finalized-observation.js";
export declare const CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS: 110n;
export declare const CURRENT_WALLET_MAX_TRANSACTION_BYTES: 1232;
export declare const CURRENT_WALLET_PROTOCOL_IDENTITY: Readonly<{
    identityKind: "v3-governed-wallet-materializer";
    currentWriteEligible: true;
    releaseLabel: string;
    liveReadProfileId: string;
    programAccountSha256: string;
    protocolPlanSdkCommit: "b2cd10739ecb9419115980425920d6b576caf78e";
    protocolRelease: "v0.1.0-rc.44";
    protocolSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    programId: string;
    programDataAddress: string;
    programDataBytes: number;
    upgradeAuthority: string;
    deployedSlot: number;
    programPayloadBytes: number;
    programPayloadSha256: string;
    programDataCapacitySha256: string;
    programDataAccountSha256: string;
}>;
export interface CurrentWalletRpc {
    readonly rpcEndpoint: string;
    getGenesisHash(): Promise<string>;
    getMultipleAccountsInfoAndContext(publicKeys: PublicKey[], config?: {
        readonly commitment?: Commitment;
        readonly minContextSlot?: number;
    }): Promise<Readonly<{
        readonly context: Context;
        readonly value: readonly (AccountInfo<Uint8Array> | null)[];
    }>>;
    getBlockTime(slot: number): Promise<number | null>;
    getLatestBlockhashAndContext(config?: {
        readonly commitment?: Commitment;
        readonly minContextSlot?: number;
    }): Promise<Readonly<{
        readonly context: Context;
        readonly value: BlockhashWithExpiryBlockHeight;
    }>>;
    isBlockhashValid(blockhash: string, config?: {
        readonly commitment?: Commitment;
        readonly minContextSlot?: number;
    }): Promise<Readonly<{
        readonly context: Context;
        readonly value: boolean;
    }>>;
}
export interface CurrentWalletReobservation {
    readonly governance: GovernanceGateContextV1;
    readonly observation: CurrentFinalizedObservation;
    readonly accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>;
    readonly rpcOrigin: string;
    readonly observedSlot: number;
    readonly observedBlockTimeUnixSeconds: bigint;
}
export declare function reobserveCurrentWalletPlan(rpc: CurrentWalletRpc, admittedObservation: unknown): Promise<CurrentWalletReobservation>;
//# sourceMappingURL=observation.d.ts.map