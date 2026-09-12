import { CurrentGovernedWriteMaterializationError, materializeBoundCurrentGovernedBuilderV1, } from "./current-governed-write-internal.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
export { CurrentGovernedWriteMaterializationError };
/**
 * Builds through the one release-pinned official Spread builder registry.
 * The SDK independently selects and freshly observes the controller-owned
 * Active gate, binds its context into Spread, validates Spread's output twice,
 * and exposes no caller-controlled program, gate, epoch, or tag allowlist.
 */
export async function buildCurrentGovernedInstructionV1(input) {
    const release = currentGovernedWriteReleaseV1();
    const materialized = await materializeBoundCurrentGovernedBuilderV1({
        rpc: input.rpc,
        minimumContextSlot: input.minimumContextSlot,
        release,
        builderName: input.builderName,
        builderInput: input.builderInput,
    });
    const governance = materialized.governance;
    return Object.freeze({
        instructions: materialized.instructions,
        identityGeneration: governance.identityGeneration,
        controllerProgram: governance.controllerProgram.toBase58(),
        gateAddress: governance.gateAddress.toBase58(),
        targetProgram: governance.targetProgram.toBase58(),
        epoch: governance.epoch.toString(),
        finalizedObservationSlot: governance.finalizedObservationSlot,
        spreadReleaseCommit: materialized.release.spreadReleaseCommit,
        spreadPackageArtifactSha256: materialized.release.spreadPackageArtifactSha256,
        instructionManifestSha256: materialized.release.instructionManifestSha256,
        programDataPayloadSha256: materialized.release.programDataPayloadSha256,
    });
}
//# sourceMappingURL=current-governed-write.js.map