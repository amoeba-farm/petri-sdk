# V3 local SDK integration

The selected target is `spread-devnet-v3-20260905`, program
`2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw`. The committed Spread tools and
Rust dependency are `9c10f249d0133adf329da701cda72343d27bbb11`; the artifact
source is separately `889f7228c6e770ccb2aae5340fd80604ee68738c`.

`CURRENT_LIVE_DEPLOYMENT` exposes byte identity and the qualified tooling
`sourceCommit`. Its `artifactSourceCommit` is the deployed source: consumers
must map that field to public `liveSourceCommit`. `liveReadProfileId` is
`ameba-spread-v2-deployed-889f7228`; provenance is
`deployment-receipt-and-finalized-bytes`.

The common public protocol envelope remains programId = the V3 program,
namespace = `ameba-spread-v2`, cluster = `devnet`, releaseTag =
`v0.1.0-rc.44`, releaseCommit = `1b2230d96e51f6582155d8284900fbfc11ff1f18`.
Those last two fields retain historical portable-plan semantics. They do not
identify current program bytes. The protocol plan SDK commit remains
`b2cd10739ecb9419115980425920d6b576caf78e`.

## Runtime boundary

`isCurrentWriteReleaseAvailable()` qualifies exact package capability only.
`observeCurrentV3RuntimeV1({rpc, minimumContextSlot, requireWriteReady})` observes
Program, ProgramData, gate and canonical vault together at finalized commitment.
It validates exact deployment bytes, V3 gate linkage and epoch, and initialized
unpaused vault layout. Frozen, absent and paused states refuse materialization.
Action-specific market, custody, owner and amount checks remain mandatory.

`buildCurrentGovernedInstructionV1` uses the official pinned builder registry;
its RPC needs `getGenesisHash`, `getAccountInfoAndContext`, and
`getMultipleAccountsInfoAndContext`. Inputs cannot supply program, gate or epoch.
`revalidateCurrentGovernedTransactionV1` verifies original serialized signed
bytes against fresh deployment/business readiness and gate epoch. It does not
retail or repair approved bytes. Applications must still verify signatures,
intent, blockhash lifetime and their exact prepared-plan commitment.

`materializeCurrentCollectiveWalletBatch` now uses V3 deployment identity and
runtime readiness. It validates the original governed envelopes, reconstructs
the business view, and returns the original governed bytes after semantic
checks. It rechecks the gate before returning. Call transaction revalidation
after wallet approval and before relay. No SDK function here submits a transaction.

## Reused and excluded work

The restoration branch `1d3ab8103c1a3811f449d3fbcd34db78a777a36e` descends from
security main `dc142465fc5c2a02d57ebd6d25fa83fae8524d6e` and remains in history.
Its ordinary governed transport, Rust opaque contexts, exact signing checks,
compressed registration and business-view validation were retained.

Its Writer auction V2 experiment was excluded: deployed V3 uses Writer auction
V1 tags 233 and 237-239, not V2 tags 12-15, 200, and 249-251. V2 WAP/WSP account
decoders and tests are not current exports. Existing Writer V1 deposits, bids,
close and settlement operations continue through their reviewed grammars.
The retained Rust `ReleaseCompute` setup enum is rejected for every deployed
V1 public operation; consumers should reject it explicitly. No Writer V2
capability should be advertised.

## Scope and evidence

`release/spread-devnet-v3.json` is the upstream manifest; the separate SDK
projection and historical RC44 provenance remain distinguishable. The current
package records deployment correspondence, not an independent clean SBF build
attestation. The captured finalized V3 gate is EmergencyFrozen and fresh
business state is uninitialized. Nothing was activated or bootstrapped.

This is a local, unpushed integration. Canonical Git URLs and real exact commits
are retained; clean remote dependency resolution requires later publication.
Local Rust verification uses a process-scoped Git URL rewrite to the canonical
local Spread repository. No machine-specific paths or global Git config are
committed.

V3 close finalization uses three writable roles per series in book order:
market, contract mint, retirement custody. The browser validator checks these
against fresh book bytes and rechecks readiness before returning an unsigned
packet. The Rust account field is `series_burn_accounts_in_book_order:
Vec<[Pubkey; 3]>`; the previous market-only field is no longer accepted.
The async SDK close-finalization selector accepts only `owner`, `sleeve`, and
`ownerUsdcDestination`. It obtains the opaque upstream finalized observation
itself; caller-supplied observation objects are rejected.
