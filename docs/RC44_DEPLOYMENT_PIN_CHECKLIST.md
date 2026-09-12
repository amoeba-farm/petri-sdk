# Historical RC44 deployment pin

This document preserves the finalized RC44 receipt used by the historical
reader and plan baseline. It is not the current live ProgramData identity and
does not authorize writes. The shared program and ProgramData addresses were
later upgraded; use `release/release-train.v1.json` for the current
byte-qualified boundary.

## Final release identity

- source commit `1b2230d96e51f6582155d8284900fbfc11ff1f18`;
- source tag `v0.1.0-rc.44`;
- artifact length `1,142,664` bytes;
- artifact SHA-256
  `3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b`;
- deployment transaction
  `24xVihYoZtcdTLaSxH2Q4NWpSt7d9YKtSAwitfXNQzNoigLYtWX31Ksd7iUYHsGZzcX3vMJmjYVLzyZXVdzsdZ65`;
- deployed slot `487702729`; and
- finalized verification context slot `487703026`.

## Byte-exact vendored receipts

- `vendor/RC44_LIVE_BUILD_RECEIPT.json` is the authoritative build receipt.
  Its file SHA-256 is
  `3747c4fefbd233eb87e329516ab2981ae4017c6fe606d7cf497efa3e8973a322`.
- `vendor/RC44_LIVE_DEPLOYMENT_RECEIPT.json` is the authoritative
  `ProgramDataUpgradeReceiptV2`. Its file SHA-256 is
  `8e90997c06c1eae7c7a5424d85c0836657727018b04c7a8a68135edb3cfdad94`
  and its domain-separated internal SHA-256 is
  `c131deef09c3959829b339c9e8093db69d3fd1e735ace5b017631b064fc93f31`.

The V2 deployment receipt binds the exact build receipt, artifact, program and
ProgramData identities, loader, Devnet genesis, upgrade authority, transaction
signature and slot, finalized context, zero-extension capacity evidence,
before/after compatible-account inventory hashes, and preservation of the
program link, owner, executable flag, authority, and compatible current state.
It also binds the `1,241,776`-byte payload capacity, its SHA-256
`bcc76952d9f57a63b0853a372c57bb32e90b0d851d7ba90c252d88be73b54191`,
and the exact `99,112`-byte all-zero tail.

## Separate finalized ProgramData poststate

The current V2 receipt schema intentionally has no full-account SHA-256 or
deployment block-time field. Those fields must not be added to the byte-exact
receipt. The secured finalized `programdata-post-upgrade.bin` evidence is bound
separately in `vendor/PROVENANCE.json` at context slot `487703026`:

- raw ProgramData length `1,241,821` bytes;
- raw ProgramData SHA-256
  `5eef434e2b02d70e3776fe2b7b624be3e87d56884ab74145929fbe1d65b3fb02`;
- payload-capacity length `1,241,776` bytes; and
- payload-capacity SHA-256
  `bcc76952d9f57a63b0853a372c57bb32e90b0d851d7ba90c252d88be73b54191`.

No deployment block time is claimed because it is absent from the
authoritative run receipts. Historical RC43 receipt files remain historical
evidence only. RC44 provenance and package gates now label this material as a
historical semantic baseline.

## Completion gates

The historical baseline may ship only when all of the following pass from a
clean lockfile installation and regenerated tracked `dist`:

```text
npm ci
npm run release:check
git diff --check
```

The release gate independently recomputes both historical receipt file hashes and the V2
domain-separated internal receipt hash, validates every supported finalized
fact above, validates the separate full ProgramData poststate binding, runs the
TypeScript/package/Rust/parity suites, and rejects stale release identities. This
completion does not publish the npm package or mutate any live service.
