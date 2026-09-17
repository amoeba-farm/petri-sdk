import * as oracle from "@amoeba/spread-release-tools/oracle-dlmm";
import { AmebaProtocolError } from "../errors.js";
/** No fallback to caller encoders, historical packages, or fabricated native exports. */
export function oracleMembershipRuntime() {
    const runtime = oracle;
    if (runtime.INDEX_ORACLE_RECIPE_SOURCE_V1_TAG !== 200
        || runtime.ORACLE_RECIPE_SOURCE_INDEX_LEN !== 209 || runtime.ORACLE_BUCKET_SOURCE_INDEX_HEADER_LEN !== 110
        || runtime.ORACLE_MEMBER_PAGE_LEN !== 233 || runtime.ORACLE_MEMBERS_PER_PAGE !== 6
        || [runtime.buildIndexOracleRecipeSourceV1Instruction, runtime.deriveOracleRecipeSourceIndexPda,
            runtime.deriveOracleBucketSourceIndexPda, runtime.decodeOracleRecipeSourceIndex,
            runtime.decodeOracleBucketSourceIndex, runtime.encodeIndexOracleRecipeSourceV1Params,
            runtime.buildOracleRecipeSourceIndexPlan, runtime.nextOracleRecipeSourceIndexStep,
            runtime.deriveOracleMemberPagePda, runtime.decodeOracleMemberPage].some(value => typeof value !== "function")) {
        throw new AmebaProtocolError("pinned Spread package does not provide the frozen recipe membership ABI; a qualified native package release is required", {
            code: "CURRENT_ORACLE_MEMBERSHIP_RUNTIME_UNAVAILABLE",
        });
    }
    return runtime;
}
/** Invoked only by the normal SDK governed builder registry. */
export function buildNativeIndexOracleRecipeSourceV1Instruction(input) {
    const runtime = oracleMembershipRuntime();
    if (runtime.encodeIndexOracleRecipeSourceV1Params(input.params).length !== 194) {
        throw new AmebaProtocolError("native recipe index payload must be exactly 194 bytes", { code: "CURRENT_ORACLE_MEMBERSHIP_INVALID" });
    }
    return runtime.buildIndexOracleRecipeSourceV1Instruction(input);
}
//# sourceMappingURL=current-oracle-membership-internal.js.map