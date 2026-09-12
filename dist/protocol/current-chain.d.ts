import { PublicKey, type Connection } from "@solana/web3.js";
import { CURRENT_PROTOCOL_CLUSTER, CURRENT_PROTOCOL_DEVNET_GENESIS_HASH, CURRENT_PROTOCOL_RELEASE, CURRENT_PROTOCOL_SOURCE_COMMIT } from "./current.js";
declare const CURRENT_NAMESPACE_VALUE: "ameba-spread-v2";
declare const CURRENT_COMMITMENT: "finalized";
export interface ReadCurrentChainIdentityInput {
    readonly connection: Connection;
    readonly programId: PublicKey;
    readonly namespace: typeof CURRENT_NAMESPACE_VALUE;
    readonly commitment: typeof CURRENT_COMMITMENT;
}
export interface CurrentLinkedProgramIdentityDto {
    readonly programId: string;
    readonly programDataAddress: string;
    readonly programDataBytes: number;
    readonly upgradeAuthority: string;
    readonly executable: true;
    readonly deployedSlot: string;
    readonly payloadBytes: number;
    readonly payloadSha256: string;
}
export interface CurrentLightStateTreeIdentityDto {
    readonly stateTree: string;
    readonly queue: string;
    readonly cpiContext: string;
}
export interface CurrentChainIdentityDto {
    readonly stateNamespace: typeof CURRENT_NAMESPACE_VALUE;
    readonly cluster: typeof CURRENT_PROTOCOL_CLUSTER;
    readonly genesisHash: typeof CURRENT_PROTOCOL_DEVNET_GENESIS_HASH;
    readonly releaseTag: typeof CURRENT_PROTOCOL_RELEASE;
    readonly releaseCommit: typeof CURRENT_PROTOCOL_SOURCE_COMMIT;
    readonly observedSlot: string;
    readonly program: {
        readonly programId: string;
        readonly programDataAddress: string;
        readonly programDataBytes: typeof CURRENT_PROTOCOL_PROGRAMDATA_BYTES;
        readonly upgradeAuthority: typeof CURRENT_PROTOCOL_UPGRADE_AUTHORITY;
        readonly executable: true;
        readonly deployedSlot: string;
        readonly payloadBytes: typeof CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES;
        readonly payloadSha256: typeof CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256;
    };
    readonly collateral: {
        readonly vaultConfigAddress: string;
        readonly mintAddress: string;
        readonly custodyAddress: string;
        readonly tokenProgram: string;
        readonly decimals: 6;
        readonly custodyAuthority: string;
        readonly custodyAmountAtomic: string;
    };
    readonly light: {
        readonly tokenProgram: CurrentLinkedProgramIdentityDto;
        readonly systemProgram: CurrentLinkedProgramIdentityDto;
        readonly accountCompressionProgram: CurrentLinkedProgramIdentityDto;
        readonly compressibleConfigProgram: CurrentLinkedProgramIdentityDto;
        readonly cpiAuthority: string;
        readonly compressibleConfig: string;
        readonly rentSponsor: string;
        readonly addressTree: string;
        readonly addressQueue: string;
        readonly stateTrees: readonly CurrentLightStateTreeIdentityDto[];
    };
}
export declare function readCurrentChainIdentity(input: ReadCurrentChainIdentityInput): Promise<CurrentChainIdentityDto>;
declare const CURRENT_PROTOCOL_PROGRAMDATA_BYTES: number;
declare const CURRENT_PROTOCOL_UPGRADE_AUTHORITY: string;
declare const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_BYTES: number;
declare const CURRENT_PROTOCOL_PROGRAM_PAYLOAD_SHA256: string;
export {};
//# sourceMappingURL=current-chain.d.ts.map