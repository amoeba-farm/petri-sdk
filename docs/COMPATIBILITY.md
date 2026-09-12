# Compatibility

## Current live boundary

The current Devnet program remains
`9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH`, linked to ProgramData
`2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3`. The SDK qualifies the
finalized live allocation as 1,241,821 bytes with payload SHA-256
`ae73299ecedbb9153544a600fd663635c1107ab3efa288f7bdec3ffbe557c684`
and full-account SHA-256
`985ed6c25d69cdef58e5904362f46776da6c151857d143d61b86c58883b783b2`.
Its deployment slot is 491,417,083 and its source commit is deliberately
`null`: finalized bytes do not prove source correspondence.

Generation 1 is the selected live governance identity. Its canonical
`ProtocolGateV1` PDA is
`4xsWiYnxBmWPY51YY3QJc1JVfQxz3wk7dyfgmsYfkueV`, owned by controller
`CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa`. The pinned fixture is
`EmergencyFrozen` at epoch 1. A live check re-observes the gate instead of
assuming that mutable status remains unchanged.

The reviewed Generation 2 controller and gate are candidate inputs only.
`productionUseAuthorized` in a review record, a branch merge, or an immutable
controller does not constitute activation. The candidate has no activation
evidence and is never aliased to Generation 1.

No exact Spread source/artifact/instruction manifest has been tied to the
current live bytes as a governed-write release. Consequently:

- `isCurrentWriteReleaseAvailable()` is always `false`;
- typed HTTP submission and Petri transaction effects fail before side effects;
- no SDK API appends a governance tail to a historical instruction and calls it
  current; and
- the package makes no current write-compatibility claim.

## Historical RC44 semantic baseline

Spread `v0.1.0-rc.44` at
`1b2230d96e51f6582155d8284900fbfc11ff1f18` remains the exact historical
reader, decoder, fixture, and plan baseline. Its deployed payload was
1,142,664 bytes with SHA-256
`3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b`,
at slot 487,702,729.

The legacy `CURRENT_PROTOCOL_*` names remain for source compatibility and
are deprecated as live identity. New code should use
`HISTORICAL_RC44_PROTOCOL_*` or `HISTORICAL_RC44_READER_BASELINE`.
Historical writer tags 220–248 and collective DLMM tags 252–255 retain their
exact byte decoders and builders. They are not authorization to submit against
the current program.

The public RC44 object's `rpcUrl` field is immutable receipt metadata, not a
connection default. Current client reads use Amoeba `/rpc`. The explicit
server-only private provider mode remains query-authenticated, finalized,
redirect-free, and body-bounded.

## Governance wire compatibility

The SDK and Rust host agree on:

- the exact 192-byte `AGVGAT01` gate layout and canonical status fields;
- config PDA seeds `["ameba-upgrade-v1", "target", targetProgram]`;
- gate PDA seeds `["ameba-upgrade-v1", "gate", targetProgram]`;
- the 16-byte `AGV1` tail with version 1, three zero reserved bytes, and a
  little-endian `u64` epoch; and
- one exact final read-only, non-signer gate meta.

The governed-envelope API is inspection-only. It accepts a caller-supplied
recognized-tag allowlist because no reviewed current write manifest exists.

## Packed historical dependency

`@amoeba/spread-release-tools` is bundled from the reviewed local archive
`vendor/amoeba-spread-release-tools-0.1.0.tgz`. The archive is exactly
952,250 bytes, 581 entries, and SHA-256
`ca6d861d8b576a3df3de14892f01a10a59bcab6bedf9f3643b7f0a8a7ccf5d7c`.
`vendor/PROVENANCE.json` labels it
`historical-reader-semantic-baseline` and `currentWriteEligible: false`.

The release gate parses the gzip/USTAR archive without extraction, validates
paths, types, checksums, sizes, padding, terminators, duplicates, UTF-8, and
release-text policy, and byte-compares every nested file. Packed SDK consumer
tests prime only public registry dependencies under an empty credential
profile, then install and import the real tarball offline with Git credential
acquisition disabled.

Self-containment requires an approximately 8.5 MB compressed and 42 MB
unpacked SDK artifact. Exact measurements and narrow fail-closed ceilings live
in `scripts/release-artifact-policy.mjs`.

## Dependency audit

The pinned Solana tree currently carries advisory
`GHSA-w5hq-g745-h8pq` through
`@solana/web3.js -> jayson -> uuid@8.3.2`. The vulnerable API concerns
caller-provided output buffers in UUID v3/v5/v6; this SDK does not expose or
call those paths, while `jayson` uses UUID v4 for request identifiers.

The archive's bundled dependency graph prevents a top-level npm override from
replacing that nested UUID. Forcing an unsupported major inside the reviewed
archive would destroy artifact reproducibility. The audit policy therefore
allows only this exact moderate advisory and propagation graph, and rejects
new packages, URLs, severities, high findings, or critical findings.

The installed tree also reports
[`GHSA-528h-pc64-c93x`](https://github.com/advisories/GHSA-528h-pc64-c93x) for
`stream-json@1.9.1` through `@solana/web3.js@1.98.4 -> jayson@4.3.0`.
The affected code is limited to the `pick`, `ignore`, `filter`, and `replace`
path filters; the advisory explicitly excludes `streamArray`, `streamObject`,
and `streamValues`. More
importantly, every shipped web3.js runtime entry imports only
`jayson/lib/client/browser`. That isolated client uses built-in JSON parsing
and imports neither Jayson's root/utils module nor `stream-json`. The affected
filter code is therefore installed but not reachable from this SDK.

This is a non-reachability disposition, not a claim that the installed package
is patched or that the dependency audit is empty. The security gate pins the
exact web3.js, Jayson, and stream-json versions, lockfile artifact integrities,
runtime source hashes, entrypoint mappings, and import boundary. Any new
advisory, changed source, direct SDK import, Jayson-root/utils import, or
stream-json filter import fails closed. `stream-json@3.5.0` is the first fixed
version, but its current v3 line is ESM with renamed lowercase subpaths while
Jayson 4.3.0 is CommonJS and declares `^1.9.1`; forcing that major override
would break module loading rather than safely remediate it. Removal of either
reviewed finding requires an upstream-compatible dependency update and a
complete compatibility run.
