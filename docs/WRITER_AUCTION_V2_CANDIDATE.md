# Writer auction V2 source candidate

This SDK exposes the current Writer V2 wire and account ABI. It does not attest
a deployed program or enable writes. `release/release-train.v1.json` remains
unavailable until exact final source, package, program bytes and governance
activation evidence are reviewed together.

The Writer paper controls financial semantics. Oracle composition remains
capital-independent median-based; this integration adds no financial arithmetic.

## Exact current operations

| Operation | Tag | Builder suffix | Caller-controlled semantic fields |
| --- | ---: | --- | --- |
| `auction_policy_adopt` | 12 | `AdoptWriterAuctionAllocationPolicyV1` | actor, sleeve, policySnapshot, firstAuctionNonce, expectedEffectivePolicyHash |
| `auction_commit` | 13 | `CommitWriterAuctionV2` | actor, sleeve, policySnapshot, auctionNonce, reserveVectorCommitment, bidDeadlineTs, revealDeadlineTs, executeDeadlineTs |
| `auction_search` | 14 | `SearchWriterAuctionChunkV2` | actor, auction, expectedBucketStart, expectedCandidateLots, expectedEvaluated, expectedTranscriptDigest, maxEvaluations |
| `auction_materialize` | 15 | `MaterializeWriterAuctionChunkV2` | actor, auction, expectedCursor, maxRecords, winningAllocationDigest |
| `auction_activate` | 200 | `ActivateWriterAuctionPlanV2` | actor, auction |
| `auction_custody_mint` | 249 | `MintWriterAuctionCustodyV2` | actor, auction, bid |
| `auction_deliver` | 250 | `DeliverWriterAuctionCustodyV2` | actor, auction, bid, destination, route |
| `auction_finalize` | 251 | `FinalizeOrAbortWriterAuctionV2` | actor, auction, abort |

Each suffix is wrapped as `build<suffix>Instruction` in the governed async SDK
builder registry. Every payload byte and listed identity is bound. Unsigned
amounts use canonical decimal strings in operation semantics, digests use
lowercase 64-character hexadecimal, and account identities use canonical base58.
Derived financial state and eligibility remain authoritative on chain. Exact
instruction account inventory, privileges, write set, signers and finalized
business-state observation remain part of the plan commitment.

Tags 233, 237, 238 and 239 are retired. Their old exported builder names are
explicit throwing tombstones, never current registry entries. `auction_plan`
and `auction_fill` are not reinterpreted as multi-stage V2 operations. Reveal
and the other unchanged Writer lanes retain their existing byte assignments.

## Custody and pickup

The canonical classic-SPL contract mint remains the sole asset. The per-bid
claim vault uses the historical Auction PDA as authority. Custody mint has 24
business roles; pickup has 17. Paid obligations survive expiry and finalization.

Route 0 uses the immutable stored destination. An existing valid destination
permits permissionless pickup. If that destination is an absent canonical Light
ATA, the actor must be the bidder to pay for creation. Route 1 requires the bidder
signer and the canonical same-mint Light ATA. It may create that ATA. An existing
classic bidder recipient may have its own delegate or close authority; strict
protocol-custody vault checks are unchanged. Refund-before-pickup and
pickup-before-refund both preserve the acquired delivery obligation.

The SDK reexports the exact 366-byte WAP and 758-byte WSP codecs and their PDA
helpers. Existing account sizes and the immutable historical fixture hashes are
not rewritten.

## Two package roles, one current governance runtime

`@amoeba/spread-historical-rc44` resolves the unchanged archived tarball recorded
in `vendor/PROVENANCE.json`. Documented synchronous historical builders and
offline planner branches may use it only while the current write train is
unavailable. They refuse once a current write release is available.

`@amoeba/spread-release-tools` resolves the separate candidate in
`vendor/GOVERNED_RUNTIME_PROVENANCE.json`. Current builders and the private
governance context use this same package instance. New V2 builders have no
historical fallback. The current async materializer observes the finalized gate
and revalidates it after construction. Light planning also revalidates around
its async boundary and rejects altered action bytes, metas or grouping.

Tests use fixture-only governance accounts and deterministic test keys. Offline
construction/signing/revalidation is not a deployment receipt or permission to
submit. Final release handoff requires an exact clean Spread source commit,
matching reproducible package and instruction manifest, attested SBF bytes,
finalized deployment/activation evidence and synchronized downstream clients.
