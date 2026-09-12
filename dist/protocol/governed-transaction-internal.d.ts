import { AmebaProtocolError } from "../errors.js";
import { type GovernanceIdentityV1 } from "./release-train.js";
import { type GovernanceGateRpcV1 } from "./governance.js";
/**
 * Exact release input used only behind the package-owned current-release resolver.
 * This module is deliberately absent from package exports; applications cannot
 * supply a tag allowlist or governance identity to the public revalidator.
 */
export interface BoundGovernedWriteReleaseV1 {
    readonly identity: GovernanceIdentityV1;
    readonly governanceIdentityGeneration: 1 | 2 | 3;
    readonly spreadReleaseCommit: string;
    readonly spreadPackageArtifactSha256: string;
    readonly instructionManifestSha256: string;
    readonly programDataPayloadSha256: string;
    readonly assignedInstructionTags: readonly number[];
}
export interface GovernedTransactionRpcV1 extends GovernanceGateRpcV1 {
}
export interface RevalidateBoundGovernedTransactionV1Input {
    readonly rpc: GovernedTransactionRpcV1;
    readonly serializedTransactionBase64: string;
    readonly minimumContextSlot: number;
    readonly release: BoundGovernedWriteReleaseV1;
}
export interface GovernedTransactionValidationV1 {
    readonly validated: true;
    readonly transactionVersion: "legacy" | 0;
    readonly serializedByteLength: number;
    readonly requiredSignatureCount: number;
    readonly instructionCount: number;
    readonly targetInstructionCount: number;
    readonly lookupTableAddresses: readonly string[];
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
export declare class GovernedTransactionValidationError extends AmebaProtocolError {
    constructor(code: string, message: string);
}
/** @internal Positive-path seam for exact package-owned release bindings and tests. */
export declare function revalidateBoundGovernedTransactionV1(input: RevalidateBoundGovernedTransactionV1Input): Promise<GovernedTransactionValidationV1>;
/** @internal Exact validation shared by transaction and builder materialization. */
export declare function validateBoundGovernedWriteReleaseV1(value: BoundGovernedWriteReleaseV1): BoundGovernedWriteReleaseV1;
//# sourceMappingURL=governed-transaction-internal.d.ts.map