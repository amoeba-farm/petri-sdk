# Final lifecycle integration

The SDK now consumes Spread tools source 05142b0fb939b0c6b549a7aa470281dee6b06333 and archive SHA-256 08758889f61e71c15d047d16c80dce8cff733ff05ca783ee4383421282beec76. The deployed ELF source remains 737b7cd6dafbcdbee08a367fe6b1d83fc82810b9. These source identities have different meanings.

The final descriptor SHA-256 is 516f8275c6866c25e4df351f2914e1992fae9725f2bf01425bd84fac9c02847e. The parent-reviewed audit passed its 26 checks with the exact user-approved Oracle differences; it does not claim exact Oracle economic equality, future-payoff equality, terminal-settlement parity before expiry, or transaction-history equality. The dated raw identity snapshot remains slot494297168, with minimum context494294359 and deployment slot494288143.

ELF1237696 bytes/hash6977f9258ceb6f818ba5dd4b7aaef114de44160cec34867a798b0f1867edda5b, allocated payload1241504/hash106dd7e174da6172b701e96b7bdbbc6450932dc6f24bdae39ae7cb8a2b3fbb6c and full ProgramData1241549/hash5e8c3ee65724dabb027f946d88b96a1ace1f6000891b10f007f474844134841b remain separate exact identities, with3808 mandatory zero bytes.

Runtime identity, source, archive, governance and fresh-account predicates are unchanged. The release metadata is bound to final inputs; this is not permission to sign or roll out applications. Final SDK tests, checkers and qualifier reruns were explicitly skipped at user request. No claim that release:check or a final current-write qualifier run passed is made. Previously completed evidence is retained; final-rerun status is recorded in release/final-integration-status-20260907.json. Older candidate and identity-only documents describe historical preparation stages.

Rust artifact_source_commit(), artifact_sha256(), artifact_bytes() and mandatory_zero_padding_bytes() expose ELF identity. payload_sha256()/payload_bytes() expose the entire allocated payload; programdata_account_sha256()/programdata_bytes() expose full account identity; source_commit() remains tools source. TS CurrentLiveDeploymentFacts exposes artifactSourceCommit/artifactSha256/artifactBytes/mandatoryZeroPaddingBytes separately from programDataPayload* and programDataAccount*.
