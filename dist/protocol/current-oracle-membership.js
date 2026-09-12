import { Buffer } from "buffer";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { oracleMembershipRuntime } from "./current-oracle-membership-internal.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
import { inspectBoundCurrentGovernedInstructionV1, prepareBoundCurrentGovernedWriteV1, revalidateFreshCurrentGovernedInstructionsV1 } from "./current-governed-write-internal.js";
import { advanceOracleRecipeWeightManifestHash, fixedBytes32, previewOracleRecipeWeightManifest, } from "@amoeba/spread-release-tools/oracle-dlmm";
function membershipInvalid(message) {
    throw new AmebaProtocolError(message, { code: "CURRENT_ORACLE_MEMBERSHIP_INVALID" });
}
function exactHash(bytes, label) {
    if (bytes.length !== 32 || bytes.every(byte => byte === 0))
        membershipInvalid(`${label} must be a nonzero 32-byte value`);
    return Buffer.from(bytes);
}
function frozenRecipePreimage(input) {
    const manifestHash = exactHash(input.frozenManifestHash, "frozenManifestHash");
    const nonzeroHash = (value, label) => exactHash(fixedBytes32(value, label), label);
    const buckets = input.buckets.map(bucket => {
        if (bucket.sources.length === 0 || bucket.sources.length > 8)
            membershipInvalid("membership buckets require 1..8 frozen sources");
        return { bucketId: nonzeroHash(bucket.bucketId, "bucketId"), bucketWeightBps: bucket.bucketWeightBps,
            sources: bucket.sources.map(source => ({ sourceId: nonzeroHash(source.sourceId, "sourceId"),
                sourceTypeHash: nonzeroHash(source.sourceTypeHash, "sourceTypeHash"),
                canonicalLocatorHash: nonzeroHash(source.canonicalLocatorHash, "canonicalLocatorHash"),
                sourceDefinitionHash: nonzeroHash(source.sourceDefinitionHash, "sourceDefinitionHash") })) };
    });
    const preview = previewOracleRecipeWeightManifest({ oracleMonthPda: input.accounts.oracleMonthPda, buckets });
    if (!preview.manifestHash.equals(manifestHash))
        membershipInvalid("source index preimage differs from the frozen recipe manifest");
    return { buckets, preview };
}
/** Partial progress is valid for resuming indexing, never for active/median membership admission. */
export async function readCurrentOracleRecipeIndexProgress(input) {
    const recipeHash = exactHash(input.expectedRecipeHash, "expectedRecipeHash");
    const manifestHash = exactHash(input.expectedManifestHash, "expectedManifestHash");
    if (!Number.isSafeInteger(input.minimumContextSlot) || input.minimumContextSlot < 0)
        membershipInvalid("index progress requires a safe finalized slot floor");
    const runtime = oracleMembershipRuntime();
    const programId = new PublicKey(AMOEBA_SPREAD_PROGRAM_ID);
    const scope = { oracleMonthPda: new PublicKey(input.oracleMonth.toBytes()), programId };
    const recipeAddress = runtime.deriveOracleRecipeSourceIndexPda(scope);
    if (await input.connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
        membershipInvalid("index progress requires Devnet");
    const observed = await input.connection.getAccountInfoAndContext(recipeAddress, {
        commitment: "finalized", minContextSlot: input.minimumContextSlot,
    });
    if (!Number.isSafeInteger(observed.context.slot) || observed.context.slot < input.minimumContextSlot)
        membershipInvalid("index progress is below the finalized floor");
    const info = observed.value;
    // Canonical system-owned prefunding is an uninitialized target, not completed membership.
    const absent = info === null || (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0);
    const recipe = absent ? null : (() => {
        if (info.executable || !info.owner.equals(programId))
            membershipInvalid("recipe source index has invalid program ownership");
        const decoded = runtime.decodeOracleRecipeSourceIndex({ ...scope, data: Buffer.from(info.data) });
        if (!decoded.recipeHash.equals(recipeHash) || !decoded.manifestHash.equals(manifestHash))
            membershipInvalid("index progress differs from the independently observed frozen recipe");
        return decoded;
    })();
    return Object.freeze({ observedAtSlot: observed.context.slot, recipeAddress, recipe });
}
/** Prepare only the next authenticated reverse step. Never reset progress or replay completed steps. */
export async function prepareCurrentOracleRecipeIndexStep(input) {
    const expectedRecipeHash = exactHash(input.expectedRecipeHash, "expectedRecipeHash");
    const frozenManifestHash = exactHash(input.frozenManifestHash, "frozenManifestHash");
    const release = currentGovernedWriteReleaseV1();
    if (!release.assignedInstructionTags.includes(200)) {
        throw new AmebaProtocolError("the pinned native release does not admit oracle recipe indexing", { code: "CURRENT_ORACLE_MEMBERSHIP_RELEASE_UNAVAILABLE" });
    }
    const runtime = oracleMembershipRuntime();
    // Validate and detach preimages before asynchronous observations.
    const { buckets } = frozenRecipePreimage({ ...input, frozenManifestHash });
    const accounts = { payer: new PublicKey(input.accounts.payer.toBytes()),
        marketPda: new PublicKey(input.accounts.marketPda.toBytes()), oracleMonthPda: new PublicKey(input.accounts.oracleMonthPda.toBytes()) };
    const binding = await prepareBoundCurrentGovernedWriteV1({ rpc: input.connection,
        minimumContextSlot: input.minimumContextSlot, release });
    const plan = runtime.buildOracleRecipeSourceIndexPlan({ programId: binding.governedProgramId,
        accounts, buckets, frozenManifestHash });
    const progress = await readCurrentOracleRecipeIndexProgress({ connection: input.connection,
        oracleMonth: accounts.oracleMonthPda, expectedRecipeHash, expectedManifestHash: frozenManifestHash,
        minimumContextSlot: binding.governance.finalizedObservationSlot });
    const next = runtime.nextOracleRecipeSourceIndexStep({ plan, index: progress.recipe, expectedRecipeHash });
    const instruction = next.nextStep?.instruction ?? null;
    if (instruction !== null) {
        inspectBoundCurrentGovernedInstructionV1({ instruction, binding });
        await revalidateFreshCurrentGovernedInstructionsV1({ rpc: input.connection, instructions: [instruction] });
    }
    return Object.freeze({ ...progress, indexedSourceCount: next.indexedSourceCount,
        complete: next.complete, instruction });
}
/** Validate the full frozen preimage before returning reverse-ordered governed builder inputs.
 * These are preparation data, not instructions or permission to submit. Keep every frozen source.
 */
export function prepareOracleRecipeSourceIndexInputs(input) {
    // Canonical preview checks ordering, weights, counts, and the complete source preimage.
    const { buckets, preview } = frozenRecipePreimage(input);
    const steps = [];
    let previousHash = preview.initialManifestHash;
    for (const bucket of buckets) {
        for (const source of bucket.sources) {
            const params = { previousHash, bucketId: bucket.bucketId, sourceId: source.sourceId,
                sourceTypeHash: source.sourceTypeHash, canonicalLocatorHash: source.canonicalLocatorHash,
                sourceDefinitionHash: source.sourceDefinitionHash, bucketWeightBps: bucket.bucketWeightBps };
            steps.push({ accounts: { payer: input.accounts.payer, marketPda: input.accounts.marketPda,
                    oracleMonthPda: input.accounts.oracleMonthPda }, params });
            previousHash = advanceOracleRecipeWeightManifestHash(params);
        }
    }
    return Object.freeze(steps.reverse());
}
/** Read complete authenticated membership in one finalized batch, retaining inactive sources. */
export async function readCurrentOracleRecipeMembership(input) {
    const fail = (message) => { throw new AmebaProtocolError(message, { code: "CURRENT_ORACLE_MEMBERSHIP_INVALID" }); };
    if (!Number.isSafeInteger(input.minimumContextSlot) || input.minimumContextSlot < 0)
        fail("membership observation requires a safe finalized slot floor");
    const bucketId = exactHash(input.bucketId, "bucketId");
    const recipeHash = exactHash(input.expectedRecipeHash, "expectedRecipeHash");
    const manifestHash = exactHash(input.expectedManifestHash, "expectedManifestHash");
    // Resolve only the immutable package capability. Its absence is not empty membership.
    const runtime = oracleMembershipRuntime();
    const programId = new PublicKey(AMOEBA_SPREAD_PROGRAM_ID);
    const scope = { oracleMonthPda: new PublicKey(input.oracleMonth.toBytes()), programId };
    const recipeAddress = runtime.deriveOracleRecipeSourceIndexPda(scope);
    const bucketAddress = runtime.deriveOracleBucketSourceIndexPda({ ...scope, bucketId });
    if (await input.connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
        fail("membership observation requires Devnet");
    const observed = await input.connection.getMultipleAccountsInfoAndContext([recipeAddress, bucketAddress], {
        commitment: "finalized", minContextSlot: input.minimumContextSlot,
    });
    if (!Number.isSafeInteger(observed.context.slot) || observed.context.slot < input.minimumContextSlot || observed.value.length !== 2)
        fail("membership observation is incomplete or below the finalized floor");
    const data = observed.value.map((info, index) => {
        const address = index === 0 ? recipeAddress : bucketAddress;
        if (info === null)
            return fail(`membership index ${address.toBase58()} is absent; frozen recipe indexing is required`);
        if (info.executable || !info.owner.equals(programId))
            fail(`membership index ${address.toBase58()} has invalid program ownership`);
        return Buffer.from(info.data);
    });
    const recipe = runtime.decodeOracleRecipeSourceIndex({ ...scope, data: data[0] });
    if (!recipe.complete)
        fail(`frozen recipe index is incomplete: ${recipe.remainingSourceCount} source preimages remain`);
    if (!recipe.recipeHash.equals(recipeHash) || !recipe.manifestHash.equals(manifestHash))
        fail("membership index differs from the independently observed frozen recipe");
    const bucket = runtime.decodeOracleBucketSourceIndex({ programId, data: data[1], index: recipe, bucketId });
    return Object.freeze({ observedAtSlot: observed.context.slot, recipeAddress, bucketAddress, recipe, bucket });
}
//# sourceMappingURL=current-oracle-membership.js.map