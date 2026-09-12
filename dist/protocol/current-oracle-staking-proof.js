/** Exact staking output transport; economic correctness remains independently admitted by Lean. */
import { AmebaProtocolError } from "../errors.js";
import { Buffer } from "buffer";
/** Require every staking field before projection; never silently drop missing or malformed outputs. */
export function currentOracleStakingProofFacts(facts) {
    const { stakingEvidenceJson, expectedAmbaAmountAtomic, expectedSambaAmountAtomic, earliestExecutionTs } = facts;
    const decimal = (value) => typeof value === "string" && /^(0|[1-9]\d{0,19})$/u.test(value)
        && BigInt(value) <= 18446744073709551615n;
    if (typeof stakingEvidenceJson !== "string" || stakingEvidenceJson.length === 0
        || Buffer.byteLength(stakingEvidenceJson, "utf8") > 131_072
        || !decimal(expectedAmbaAmountAtomic) || !decimal(expectedSambaAmountAtomic)
        || !decimal(earliestExecutionTs)) {
        throw new AmebaProtocolError("Staking proof facts require the exact frame, amounts, and maturity", {
            code: "CURRENT_ORACLE_DRAFT_INVALID",
        });
    }
    return Object.freeze({ stakingEvidenceJson, expectedAmbaAmountAtomic, expectedSambaAmountAtomic, earliestExecutionTs });
}
//# sourceMappingURL=current-oracle-staking-proof.js.map