/** Exact staking output transport; economic correctness remains independently admitted by Lean. */
import { AmebaProtocolError } from "../errors.js";
import { Buffer } from "buffer";

export interface CurrentOracleStakingProofFacts {
  readonly stakingEvidenceJson: string;
  readonly expectedAmbaAmountAtomic: string;
  readonly expectedSambaAmountAtomic: string;
  readonly earliestExecutionTs: string;
}

/** Require every staking field before projection; never silently drop missing or malformed outputs. */
export function currentOracleStakingProofFacts(
  facts: Readonly<Record<string, unknown>>,
): Readonly<CurrentOracleStakingProofFacts> {
  const { stakingEvidenceJson, expectedAmbaAmountAtomic, expectedSambaAmountAtomic, earliestExecutionTs } = facts;
  const decimal = (value: unknown): value is string =>
    typeof value === "string" && /^(0|[1-9]\d{0,19})$/u.test(value)
      && BigInt(value) <= 18_446_744_073_709_551_615n;
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
