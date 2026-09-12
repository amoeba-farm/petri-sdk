# ameba-sdk 0.2.0

This unreleased candidate converts the SDK from an RC44-as-current package into
a byte-qualified read-only release with an explicitly historical RC44 semantic
baseline.

## Live identity and governance

- Adds one canonical release-train manifest separating inspected source heads,
  finalized live bytes, selected Generation 1 governance, reviewed Generation
  2 candidate inputs, historical reader semantics, and deployment
  authorization.
- Qualifies the current Devnet Program, ProgramData, and Generation 1 gate in
  one finalized observation without claiming an unknown source commit.
- Adds strict TypeScript and Rust `ProtocolGateV1` decoders, canonical PDA
  derivation, exact `AGV1` epoch-tail codecs, and freeze/epoch race checks.
- Keeps the governed envelope surface inspection-only. No current instruction
  builder or recognized-tag manifest is invented.

## Fail-closed mutation boundary

- Reports `writeRelease.status: "unavailable"` and exposes
  `CURRENT_PROGRAM_WRITE_ABI_UNAVAILABLE`.
- Closes typed HTTP submission before network access.
- Closes every Petri transaction effect before process execution.
- Marks the historical wallet materializer and RC44 vendor package
  `currentWriteEligible: false`.
- Preserves RC44 decoders, builders, fixtures, portable-plan validators, and
  unsigned review tooling for migration and differential testing.

## Supply chain and browser boundary

- Advances CLI parity to
  `d47907ae215e338412d33859e71c25f034d3f24b`.
- Splits pull-request source verification from trusted full verification.
- Fetches exact private CLI and Spread inputs with isolated per-repository SSH
  keys, a pinned GitHub host key, strict SSH settings, and credential-free bare
  mirrors; key material is removed before checkout, install, or tests.
- Pins every GitHub Action by full SHA and installs dependencies with lifecycle
  scripts disabled.
- Proves both wallet and governance protocol browser bundles import no Node
  builtins and acquire no global `process` or `Buffer`.
- Primes only public dependencies, then proves packed SDK tarball consumers can
  install offline without Git credentials.

This release is not published or deployed. Generation 2 review metadata,
source branches, and passing local checks are not deployment or authority
handoff authorization.
