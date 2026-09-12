import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { CURRENT_LIVE_DEPLOYMENT, type GovernanceIdentityV1 } from "./release-train.js";
export declare const GOVERNANCE_GATE_V1_BYTES: 192;
export declare const GOVERNANCE_GATE_V1_DISCRIMINATOR: "AGVGAT01";
export declare const GOVERNANCE_GATE_V1_VERSION: 1;
export declare const GOVERNANCE_TAIL_V1_BYTES: 16;
export declare const GOVERNANCE_TAIL_V1_MAGIC: "AGV1";
export declare const GOVERNANCE_TAIL_V1_VERSION: 1;
export declare const GOVERNED_INSTRUCTION_DATA_MAX_BYTES: 16384;
export declare const GOVERNANCE_UPGRADE_SEED_DOMAIN_V1: "ameba-upgrade-v1";
export declare const BPF_UPGRADEABLE_LOADER_PROGRAM_ID: "BPFLoaderUpgradeab1e11111111111111111111111";
export declare const GOVERNANCE_GATE_V1_OFFSETS: Readonly<{
    readonly discriminator: 0;
    readonly version: 8;
    readonly bump: 9;
    readonly initialized: 10;
    readonly status: 11;
    readonly controllerConfig: 12;
    readonly targetProgram: 44;
    readonly targetProgramData: 76;
    readonly epoch: 108;
    readonly activeProposal: 116;
    readonly freezeSlot: 148;
    readonly freezeReasonCode: 156;
    readonly lastCompletedProposal: 158;
    readonly reserved: 190;
}>;
export declare const GOVERNANCE_GATE_STATUS_V1: Readonly<{
    readonly Active: 0;
    readonly FrozenForUpgrade: 1;
    readonly EmergencyFrozen: 2;
}>;
export type GovernanceGateStatusV1 = (typeof GOVERNANCE_GATE_STATUS_V1)[keyof typeof GOVERNANCE_GATE_STATUS_V1];
export type GovernanceGateStatusNameV1 = keyof typeof GOVERNANCE_GATE_STATUS_V1;
export interface GovernanceInstructionTailV1 {
    readonly magic: typeof GOVERNANCE_TAIL_V1_MAGIC;
    readonly version: typeof GOVERNANCE_TAIL_V1_VERSION;
    readonly expectedEpoch: bigint;
}
export interface ProtocolGovernanceGateV1 {
    readonly discriminator: typeof GOVERNANCE_GATE_V1_DISCRIMINATOR;
    readonly version: typeof GOVERNANCE_GATE_V1_VERSION;
    readonly bump: number;
    readonly initialized: true;
    readonly status: GovernanceGateStatusV1;
    readonly statusName: GovernanceGateStatusNameV1;
    readonly controllerConfig: PublicKey;
    readonly targetProgram: PublicKey;
    readonly targetProgramData: PublicKey;
    readonly epoch: bigint;
    readonly activeProposal: PublicKey;
    readonly freezeSlot: bigint;
    readonly freezeReasonCode: number;
    readonly lastCompletedProposal: PublicKey;
}
export interface GovernanceGateAccountInput {
    readonly address: PublicKey | string;
    readonly owner: PublicKey | string;
    readonly executable: boolean;
    readonly data: Uint8Array;
    readonly identity?: GovernanceIdentityV1;
    readonly requireActive?: boolean;
}
export interface GovernanceGateContextV1 {
    readonly identityGeneration: 1 | 2 | 3;
    readonly genesisHash: typeof CURRENT_LIVE_DEPLOYMENT.genesisHash;
    readonly controllerProgram: PublicKey;
    readonly controllerConfig: PublicKey;
    readonly gateAddress: PublicKey;
    readonly targetProgram: PublicKey;
    readonly targetProgramData: PublicKey;
    readonly status: GovernanceGateStatusV1;
    readonly statusName: GovernanceGateStatusNameV1;
    readonly epoch: bigint;
    readonly finalizedObservationSlot: number;
}
export interface GovernedInstructionMaterializationV1 {
    readonly instruction: TransactionInstruction;
    readonly governance: GovernanceGateContextV1;
}
export interface GovernanceGateRpcV1 {
    getMultipleAccountsInfoAndContext?(addresses: PublicKey[], config: {
        readonly commitment: "finalized";
        readonly minContextSlot: number;
    }): Promise<{
        readonly context: {
            readonly slot: number;
        };
        readonly value: readonly ({
            readonly data: Uint8Array;
            readonly executable: boolean;
            readonly owner: PublicKey;
        } | null)[];
    }>;
    getGenesisHash(): Promise<string>;
    getAccountInfoAndContext(address: PublicKey, config: {
        readonly commitment: "finalized";
        readonly minContextSlot: number;
    }): Promise<{
        readonly context: {
            readonly slot: number;
        };
        readonly value: {
            readonly data: Uint8Array;
            readonly executable: boolean;
            readonly owner: PublicKey;
        } | null;
    }>;
}
export declare class GovernanceGateValidationError extends AmebaProtocolError {
    constructor(code: string, message: string);
}
export declare function deriveGovernanceControllerConfigPdaV1(controllerProgram: PublicKey, targetProgram: PublicKey): readonly [PublicKey, number];
export declare function deriveProtocolGovernanceGatePdaV1(controllerProgram: PublicKey, targetProgram: PublicKey): readonly [PublicKey, number];
export declare function deriveUpgradeableProgramDataAddressV1(targetProgram: PublicKey): readonly [PublicKey, number];
export declare function encodeGovernanceInstructionTailV1(expectedEpoch: bigint): Uint8Array;
export declare function decodeGovernanceInstructionTailV1(data: Uint8Array): GovernanceInstructionTailV1;
export declare function decodeProtocolGovernanceGateV1(data: Uint8Array): ProtocolGovernanceGateV1;
export declare function validateProtocolGovernanceGateAccountV1(input: GovernanceGateAccountInput): ProtocolGovernanceGateV1;
/**
 * Observes one exact release-train governance identity at finalized commitment.
 * Accepting the reviewed Generation 2 identity here proves only its current
 * account state; it does not select it as the SDK write release.
 */
export declare function observeGovernanceGateV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly identity: GovernanceIdentityV1;
    readonly minimumContextSlot: number;
    readonly requireActive?: boolean;
}): Promise<GovernanceGateContextV1>;
/** Backward-compatible observation of the release train's still-selected Generation 1 gate. */
export declare function observeCurrentGovernanceGateV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly minimumContextSlot: number;
    readonly requireActive?: boolean;
}): Promise<GovernanceGateContextV1>;
/**
 * Re-observes the exact reviewed Generation 2 controller-owned gate and requires
 * it to be Active. This is live-state evidence, not a release-selection switch.
 */
export declare function observeReviewedGeneration2GovernanceGateV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly minimumContextSlot: number;
}): Promise<GovernanceGateContextV1>;
export declare function assertFreshGovernanceGateObservationV1(planned: GovernanceGateContextV1, observed: GovernanceGateContextV1): GovernanceGateContextV1;
/**
 * Constructs the canonical outer Spread governance envelope without changing
 * the supplied business instruction. The recognized-tag set is deliberately
 * caller supplied until a final write-release manifest is bound; construction
 * by itself is never a claim that current submission is available.
 */
export declare function buildGovernedInstructionEnvelopeV1(input: {
    readonly instruction: TransactionInstruction;
    readonly context: GovernanceGateContextV1;
    readonly recognizedInstructionTags: readonly number[];
}): TransactionInstruction;
/**
 * Re-observes the controller-owned gate at finalized commitment immediately
 * before unsigned materialization. The complete business instruction and tag
 * authority are snapshotted before the asynchronous RPC boundary.
 */
export declare function materializeFreshGovernedInstructionEnvelopeV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly plannedContext: GovernanceGateContextV1;
    readonly instruction: TransactionInstruction;
    readonly recognizedInstructionTags: readonly number[];
}): Promise<GovernedInstructionMaterializationV1>;
/**
 * Freshness-validates an instruction already produced by Spread's canonical
 * `governance-gate` export. This is the preferred integration seam once the
 * exact governed Spread package is release-pinned; the SDK must not append a
 * second parallel envelope to that output.
 */
export declare function revalidateFreshGovernedInstructionEnvelopeV1(input: {
    readonly rpc: GovernanceGateRpcV1;
    readonly plannedContext: GovernanceGateContextV1;
    readonly instruction: TransactionInstruction;
    readonly recognizedInstructionTags: readonly number[];
}): Promise<GovernedInstructionMaterializationV1>;
/**
 * Inspector only: verifies a governed envelope but never constructs one. The
 * recognized tag allowlist must come from the exact future write release.
 */
export declare function inspectGovernedInstructionEnvelopeV1(input: {
    readonly instruction: Pick<TransactionInstruction, "programId" | "keys" | "data">;
    readonly context: GovernanceGateContextV1;
    readonly recognizedInstructionTags: readonly number[];
}): {
    readonly legacyData: Uint8Array;
    readonly tail: GovernanceInstructionTailV1;
};
/** Validates every governed Spread instruction independently. */
export declare function inspectGovernedInstructionBatchV1(input: {
    readonly instructions: readonly Pick<TransactionInstruction, "programId" | "keys" | "data">[];
    readonly context: GovernanceGateContextV1;
    readonly recognizedInstructionTags: readonly number[];
}): readonly {
    readonly legacyData: Uint8Array;
    readonly tail: GovernanceInstructionTailV1;
}[];
//# sourceMappingURL=governance.d.ts.map