# Governed write foundation

This SDK branch adds the release-bound construction and submission checks needed
by a future exact governed-write release. It does **not** change
`SDK_RELEASE_TRAIN`, select Generation 2 as the current release, or make
`isCurrentWriteReleaseAvailable()` return true.

## Finalized gate observation

`observeReviewedGeneration2GovernanceGateV1` reads the exact reviewed
Generation 2 gate at finalized commitment. It verifies Devnet genesis, the
canonical gate PDA and bump, controller ownership, non-executability, embedded
controller config, target Program and ProgramData, the 192-byte `AGVGAT01`
layout, canonical status fields, and `Active` status.

The resulting context is live-state evidence only. A release must still bind an
exact Spread source commit, reproducible ProgramData artifact, assigned-tag
manifest, SDK/Lean/Edge/Petri versions, and finalized deployment receipts.

## Envelope materialization

`buildGovernedInstructionEnvelopeV1` defensively clones one already-built
business instruction, verifies its tag against a caller-supplied exact-release
allowlist, preserves every original byte and ordered account privilege, adds
the canonical gate exactly once as the absolute-final read-only non-signer, and
appends the exact 16-byte `AGV1` epoch tail. It rejects empty or oversized data,
unknown or duplicate tag authority, an existing gate, and a nested tail.

`materializeFreshGovernedInstructionEnvelopeV1` snapshots the business
instruction and tag authority, then re-observes the same gate at finalized
commitment with `minContextSlot` equal to the planned observation slot. A
freeze, generation change, identity change, epoch advance, or regressed context
fails before unsigned materialization. It performs no signing or submission.

`revalidateFreshGovernedInstructionEnvelopeV1` is the corresponding seam for an
instruction already emitted by Spread's canonical governed builders. It
snapshots and inspects that envelope, performs the same finalized re-observation,
and inspects it again without adding a second gate or tail.

`revalidateCurrentGovernedTransactionV1` is the package-owned Edge submission
seam. It accepts exact signed legacy or v0 bytes, resolves every address lookup
table from canonical finalized account bytes, derives effective transaction
privileges, re-observes the selected Active gate at or after those reads, and
checks every target Spread instruction against the release-owned tag manifest
and current epoch. It also allows a setup-only workflow transaction while still
requiring the gate to be Active. It never rebuilds, signs, or submits bytes.
The current unavailable release rejects before parsing or RPC; activation
requires the release train to provide the exact source, package, manifest,
payload, generation, and assigned-tag pins.

## Spread integration boundary

Current Spread source already owns its canonical construction surface at
`@amoeba/spread-release-tools/governance-gate`, including
`withAmoebaGovernanceGateV1`, `createAmoebaGovernedInstructionV1`,
`assertAmoebaGovernanceEnvelopeV1`, and finalized re-observation. The exact
current package also exports `@amoeba/spread-release-tools/governed-transaction-planner`.

`buildCurrentGovernedInstructionV1` is the public async construction surface.
The caller selects only an SDK-exported official builder and supplies its typed
business input. The package selects the exact release identity and instruction
manifest, observes its finalized Active gate, binds the resulting target
capability through Spread, and re-observes that same epoch after construction.
The caller cannot supply a program, gate, epoch, tag allowlist, source identity,
or artifact identity.

Spread-owned builders emit their canonical governed instruction directly. The
three SDK-owned business builders (user-collateral initialization, ordinary
withdrawal, and emergency signer recovery) are explicitly classified and sent
through Spread's `createAmoebaGovernedInstructionV1`; both validators then prove
that the canonical envelope preserved every business byte and ordered account
privilege. Historical synchronous current builders throw as soon as a governed
release becomes available, so they cannot remain an ungated compatibility path.

`createCurrentSdkAdapter` exposes the same operation as
`buildCurrentGovernedInstruction`. Current Oracle direct, compressed, and
tag-219 planning retains the exact governed instruction for compilation and
uses only a Spread-validated semantic view for legacy account/payload decoding.
Writer and collective-swap plan manifests likewise retain exact governed bytes.
Their semantic checks cannot strip an arbitrary lookalike trailer. A second
finalized gate observation occurs immediately before Oracle compilation, and
Edge must call `revalidateCurrentGovernedTransactionV1` on the exact signed
bytes immediately before submission.

## Writer delivery custody and Classic SPL re-bridge

Writer bids continue to support both immutable delivery modes. A `LightToken`
bid delivers to the bidder's canonical Light ATA, while a `ClassicSpl` bid
delivers to the exact bidder-owned mint account stored in the bid. The SDK does
not substitute one destination for the other or reinterpret the stored mode.

After a successful `ClassicSpl` delivery,
`buildCurrentClassicSplToLightAtaRebridgeV1` can materialize the canonical
post-delivery route into that same bidder's Light ATA. It emits the exact Light
Token idempotent ATA creation followed by the exact TransferInterface
SPL-to-Light `Transfer2` wire already used and parity-tested by Spread. The
bidder remains payer, source owner, and signer. The source account is a
caller-supplied bidder-owned classic-SPL account; the helper does not read or
validate a WriterBid, so Writer pickup callers must pass that bid's stored
destination. The Light program's canonical CPI validates the source owner,
mint, and amount atomically. This is a manual builder and is never invoked by a
Writer execute, SDK materializer, or submit path. It introduces no new Spread
instruction, allowlist, custody authority, or delivery restriction.

The fixed SDK receipt is not derived from this helper. Its upstream constructor
is Spread's `light_token_instruction.rs::official_transfer`, which calls
`light_token::instruction::TransferInterface::instruction()` with source owner
`spl_token::id()`, destination owner `light_token_program_id()`, the bidder as
both payer and authority, and the canonical SPL-interface PDA. Spread's
`local_transfer_routes_match_light_sdk` test compares that official result
against all four local delivery permutations. The reviewed lock pins
`light-token` 0.23.0 (checksum
`962fc0c26808f218cd4fb782a15adc24a2163e2e64cacd74c9ca86540cf9afb3`) and
`light-token-interface` 0.5.0; the SDK regression uses an independently copied
account/data vector from that construction and round-trips both legacy and v0
transaction serialization.

The currently installed RC44 archive predates the governance exports and
remains historical/read-only. Enabling this path still requires all of the
following exact evidence and pins:

- final reviewed Spread source commit and package tarball SHA-256;
- mechanically complete assigned-instruction manifest and its SHA-256;
- two byte-identical reproducible SBF builds, with exact payload length and
  SHA-256;
- finalized deployment receipt proving the target ProgramData payload equals
  that artifact, plus matching `CURRENT_LIVE_DEPLOYMENT.sourceCommit`, payload,
  and `writeCompatibility` fields;
- a selected live Generation 2 identity with non-null activation evidence and
  the finalized Active gate observation; and
- matching SDK, Lean, and Edge dependency/release pins.

The existing Generation 2 ceremony can substantiate the immutable controller
and gate identity if its linkage remains exact. It cannot substantiate the
Spread source or the ProgramData payload, so it is insufficient by itself to
enable writes. No Oracle median or weighting rule is changed by this work.
