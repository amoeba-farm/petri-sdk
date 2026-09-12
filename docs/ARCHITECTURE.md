# Architecture

## Current supported path

```text
browser / Petri / SDK -> api.amoeba.farm
                       -> /rpc finalized reads
                       -> typed prepare and status routes
                       -> exact live Program + ProgramData + Gen1 gate qualifier

historical RC44 bytes -> strict decoders / planners / unsigned review only
transaction effect   -> CURRENT_PROGRAM_WRITE_ABI_UNAVAILABLE
```

The SDK has no current transaction-submission path. `AmebaClient` keeps the
typed submit method for API compatibility but closes it before validation or
network access. The Petri adapter closes every operation classified as
`transaction` before spawning a process. Historical instruction builders
remain deterministic tools for readers, differentials, and migration.

The live qualifier observes Program, ProgramData, and the selected Generation
1 governance gate in one finalized `getMultipleAccountsInfoAndContext` call.
It validates Devnet genesis, loader ownership, executable flags, upgradeable
loader linkage, allocation, raw and payload hashes, upgrade authority, gate
owner/PDA/bump/links, and a monotonic context slot. It proves byte identity,
not source correspondence or write compatibility.

## Future governed write path

```text
finalized live bytes + selected governance identity
  + exact Spread source/artifact/instruction manifest
  + exact SDK/Lean/Edge/Petri release pins
  + finalized deployment and authority-handoff evidence
  -> gate included exactly once as final readonly non-signer
  -> AGV1 tail binds exact observed epoch
  -> gate re-observed finalized before unsigned materialization
  -> Lean admission and SDK reconstruction agree
  -> caller reviews; external wallet signs
  -> typed bounded submission
```

None of the prerequisites above may be inferred from a source branch,
reviewed-candidate flag, or matching state namespace. Until a single release
train satisfies them, `writeRelease.status` remains `unavailable`.

## Ownership

Node Edge owns HTTP, finalized observations, prepared-plan persistence,
timeouts, pools, and bounded relay. Lean owns deterministic policy and semantic
admission. The SDK owns release identity, strict public decoding, PDA
derivation, exact byte/meta reconstruction, portable plan validation, and
browser-safe unsigned review. Spread owns custody and on-chain enforcement.
Petri owns local wallet interaction and signing UX. Governance ceremonies own
controller authority and activation.

No SDK layer owns financial policy, signer selection, private-key custody,
authority transfer, or deployment authorization.

## Network and credential boundary

No browser surface accepts a Solana or Helius endpoint. The hosted read gateway
is derived as `https://api.amoeba.farm/rpc`; loopback remains available for
local integration. The explicit server-only unified private Helius mode
requires an exact query-authenticated Devnet href, authorized origin hash, and
finalized commitment. Redirects are rejected and Photon response bodies are
bounded.

CI fetches exact private repositories with per-repository deploy keys in a
minimal bootstrap step. It uses a pinned GitHub host key, writes credential-free
bare mirrors, removes key material, and only then checks out or executes
repository and dependency code. Pull requests run a secret-free source/package
matrix.

## Historical plan boundary

RC44 writer and collective-swap plans are never trusted because their hashes
agree. Historical validation still compares independently rebuilt native
instructions, ordered account flags, writable identities, signer coverage,
finalized observations, and Lean admission. This is preserved for regression
and migration value; it does not make an RC44 transaction current.
