import { PublicKey, type Connection } from "@solana/web3.js";
import type { IndexOracleRecipeSourceV1Input } from "./current-oracle-membership-internal.js";
import { type OracleRecipeWeightManifestPreviewBucket } from "@amoeba/spread-release-tools/oracle-dlmm";
export type { IndexOracleRecipeSourceV1Input, OracleRecipeSourceIndexSnapshot, OracleBucketSourceIndexSnapshot } from "./current-oracle-membership-internal.js";
/** Partial progress is valid for resuming indexing, never for active/median membership admission. */
export declare function readCurrentOracleRecipeIndexProgress(input: {
    readonly connection: Connection;
    readonly oracleMonth: PublicKey;
    readonly expectedRecipeHash: Uint8Array;
    readonly expectedManifestHash: Uint8Array;
    readonly minimumContextSlot: number;
}): Promise<Readonly<{
    observedAtSlot: number;
    recipeAddress: PublicKey;
    recipe: import("./current-oracle-membership-internal.js").OracleRecipeSourceIndexSnapshot | null;
}>>;
/** Prepare only the next authenticated reverse step. Never reset progress or replay completed steps. */
export declare function prepareCurrentOracleRecipeIndexStep(input: {
    readonly connection: Connection;
    readonly accounts: IndexOracleRecipeSourceV1Input["accounts"];
    readonly buckets: OracleRecipeWeightManifestPreviewBucket[];
    readonly expectedRecipeHash: Uint8Array;
    readonly frozenManifestHash: Uint8Array;
    readonly minimumContextSlot: number;
}): Promise<Readonly<{
    indexedSourceCount: number;
    complete: boolean;
    instruction: import("@solana/web3.js").TransactionInstruction | null;
    observedAtSlot: number;
    recipeAddress: PublicKey;
    recipe: import("./current-oracle-membership-internal.js").OracleRecipeSourceIndexSnapshot | null;
}>>;
/** Validate the full frozen preimage before returning reverse-ordered governed builder inputs.
 * These are preparation data, not instructions or permission to submit. Keep every frozen source.
 */
export declare function prepareOracleRecipeSourceIndexInputs(input: {
    readonly accounts: IndexOracleRecipeSourceV1Input["accounts"];
    readonly buckets: OracleRecipeWeightManifestPreviewBucket[];
    readonly frozenManifestHash: Uint8Array;
}): readonly Omit<IndexOracleRecipeSourceV1Input, "programId">[];
/** Read complete authenticated membership in one finalized batch, retaining inactive sources. */
export declare function readCurrentOracleRecipeMembership(input: {
    readonly connection: Connection;
    readonly oracleMonth: PublicKey;
    readonly bucketId: Uint8Array;
    /** Hashes from the caller's independently observed frozen month/recipe manifest. */
    readonly expectedRecipeHash: Uint8Array;
    readonly expectedManifestHash: Uint8Array;
    readonly minimumContextSlot: number;
}): Promise<Readonly<{
    observedAtSlot: number;
    recipeAddress: PublicKey;
    bucketAddress: PublicKey;
    recipe: import("./current-oracle-membership-internal.js").OracleRecipeSourceIndexSnapshot;
    bucket: import("./current-oracle-membership-internal.js").OracleBucketSourceIndexSnapshot;
}>>;
//# sourceMappingURL=current-oracle-membership.d.ts.map