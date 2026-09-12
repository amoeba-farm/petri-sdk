import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type * as CurrentBuilders from "./current-builders.js";
import type { GovernanceGateRpcV1 } from "./governance.js";
import { CurrentGovernedWriteMaterializationError } from "./current-governed-write-internal.js";
type CurrentBuilderExports = typeof CurrentBuilders;
export type CurrentGovernedBuilderNameV1 = {
    [Name in keyof CurrentBuilderExports]: Name extends `build${string}Instruction${string}` ? CurrentBuilderExports[Name] extends (...args: any[]) => any ? Name : never : never;
}[keyof CurrentBuilderExports];
export type CurrentGovernedBuilderInputV1<Name extends CurrentGovernedBuilderNameV1> = Name extends "buildFinalizeWriterCloseV1Instruction" ? {
    readonly owner: PublicKey;
    readonly sleeve: PublicKey;
    readonly ownerUsdcDestination: PublicKey;
} : CurrentBuilderExports[Name] extends (input: infer Input) => unknown ? Input : never;
export interface BuildCurrentGovernedInstructionV1Input<Name extends CurrentGovernedBuilderNameV1> {
    /** SDK-owned official Spread builder; its instruction tag is release-checked. */
    readonly builderName: Name;
    /** Exact official builder input without programId, gate, epoch, or tag authority. */
    readonly builderInput: CurrentGovernedBuilderInputV1<Name>;
    readonly rpc: GovernanceGateRpcV1;
    readonly minimumContextSlot: number;
}
export interface CurrentGovernedInstructionMaterializationV1 {
    readonly instructions: readonly TransactionInstruction[];
    readonly identityGeneration: 1 | 2 | 3;
    readonly controllerProgram: string;
    readonly gateAddress: string;
    readonly targetProgram: string;
    readonly epoch: string;
    readonly finalizedObservationSlot: number;
    readonly spreadReleaseCommit: string;
    readonly spreadPackageArtifactSha256: string;
    readonly instructionManifestSha256: string;
    readonly programDataPayloadSha256: string;
}
export { CurrentGovernedWriteMaterializationError };
/**
 * Builds through the one release-pinned official Spread builder registry.
 * The SDK independently selects and freshly observes the controller-owned
 * Active gate, binds its context into Spread, validates Spread's output twice,
 * and exposes no caller-controlled program, gate, epoch, or tag allowlist.
 */
export declare function buildCurrentGovernedInstructionV1<Name extends CurrentGovernedBuilderNameV1>(input: BuildCurrentGovernedInstructionV1Input<Name>): Promise<CurrentGovernedInstructionMaterializationV1>;
//# sourceMappingURL=current-governed-write.d.ts.map