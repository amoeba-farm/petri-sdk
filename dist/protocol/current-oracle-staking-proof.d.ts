export interface CurrentOracleStakingProofFacts {
    readonly stakingEvidenceJson: string;
    readonly expectedAmbaAmountAtomic: string;
    readonly expectedSambaAmountAtomic: string;
    readonly earliestExecutionTs: string;
}
/** Require every staking field before projection; never silently drop missing or malformed outputs. */
export declare function currentOracleStakingProofFacts(facts: Readonly<Record<string, unknown>>): Readonly<CurrentOracleStakingProofFacts>;
//# sourceMappingURL=current-oracle-staking-proof.d.ts.map