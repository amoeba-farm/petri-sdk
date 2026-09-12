# Changelog

## Unreleased — owner-signed expiry authorization

- Add browser-native `materializeCurrentExpiryAuthorization` for independently
  reviewed collective-long claims and full LP position cleanup. It verifies the
  native account identities, exact amounts/destinations, current governed state,
  owner-controlled durable nonce and byte-for-byte unsigned transaction.
- Export the corresponding expected-intent, artifact and LP cleanup request
  types from `ameba-sdk/wallet`. This API does not sign, submit or refresh nonces.

All notable changes to the supported SDK surfaces are documented here. This
project follows [Semantic Versioning](https://semver.org/).

## 0.2.0 - Unreleased

### Fixed

- Canonical collateral packet key order and live deployment identity on user reads.

- Update-reward preparation uses the registration's reward units and the SKU's
  total registered units, matching native integer rounding and custody checks.

### Added

- Collective claims bind the selected series to finalized book bytes across
  TypeScript, Rust, and wallet validation, including fresh pre-sign re-observation.

- Finalized trader-blocker deployment and Active12 identity, with exact native
  tools provenance and zero-page empty-position close support.

- Two-phase governed collateral plans, finalized position-expiry planning reads,
  and an optional exact-admitted swap compute budget. See
  [current collateral and expiry planning](./docs/CURRENT_POSITION_AUTOMATION.md).
  Expiry sync refreshes planning only; it does not install an executor.

- Exact hot-state liquidity plans with independently reconstructed native bytes,
  finalized evidence, Lean admission binding and portable validation. See
  [current liquidity](./docs/CURRENT_LIQUIDITY.md).
- Release regression fixtures reconciled with the retained final lifecycle
  evidence, preserving historical staging refusal and current gate mutations.
- Canonical release-train separation of finalized live byte identity, live
  Generation 1 governance, reviewed non-live Generation 2 candidate inputs,
  historical RC44 reader semantics, and explicit deployment authorization.
- Read-only current Program/ProgramData/gate qualification with an intentionally
  unknown source commit and no inferred write compatibility.
- Exact TypeScript and Rust 192-byte governance gate decoding, config/gate PDA
  derivation, 16-byte `AGV1` epoch-tail codecs, and stale/frozen observation
  rejection.
- Shared fail-closed mutation policy for HTTP submission and all Petri
  transaction effects.
- Credential-isolated CI with secret-free pull-request verification,
  credential-free private dependency mirrors, pinned GitHub host trust, and
  full-SHA action references.
- Historical Amoeba Spread `v0.1.0-rc.44` Devnet source, artifact,
  ProgramData, transaction, and receipt identity.
- TypeScript and Rust collective-writer account, PDA, instruction, and
  collective-DLMM construction/decoding surfaces.
- Strict current instruction decoding with a 16,384-byte outer cap and exact
  payload consumption.
- Portable writer operation plans bound to finalized observation, private Lean
  admission, independently rebuilt native instructions, exact writable metas,
  and exact signer coverage.
- Complete `CloseBegin`, `CloseBasket`, `CloseFinalize`, and series/Flat
  `CloseCancel` TypeScript/Rust operation parity. Hot operations retain the
  byte-compatible schema-v1 plan. Schema v2 distinguishes Begin/Basket
  `cold_load` inputs (explicit Lean-admitted minimum, independently rebuilt
  compute/create/Transfer2 envelope) from cancellation
  `canonical_output_create` destinations (SDK-built compute plus exact
  idempotent Light ATA create, with no cold-balance proof).
- Rust endpoint helpers for begin, forward progression, cancellation
  progression, shared submission, operation status, and close-request reads.
- Petri parity for `writers list`, `show`, `deposit`, `bid`, `close-preview`,
  `close`, `close-status`, `claim`, `transfer-flat`, and `policy-audit`.
- Byte-exact shared writer fixture and separately labeled Light fixture-suite
  attestation.
- Full TypeScript/Rust decoding of payer-bound Light v0.23.3 `Transfer2` cold
  loads, including proof topology, amounts, destination, forbidden outputs and
  lamport/TLV fields, and sequential compressed-input uniqueness.
- Native binding for every admitted writer semantic field, with unbound
  collective-claim and TypeScript-only operation variants rejected fail-closed.
- A self-contained RC44 Spread runtime artifact, source-commit/tarball/license
  provenance, and credential-free packed/Git consumer gates, so protocol
  imports never rely on ambient GitHub authentication or a peer installation.
- Path-safe inspection of every text file in the exact Spread archive and its
  nested SDK bundle, with traversal, link, special-file, malformed-header,
  secret, private-marker, and machine-path admission kept fail-closed.
- Strict RFC8032 owner-point admission in Rust with shared web3.js vectors for
  noncanonical field values, invalid zero-x sign bits, and nonsquare points.
- A dedicated browser-safe historical `ameba-sdk/wallet` surface that strictly decodes
  current prepare envelopes, independently re-observes every bound account at
  finalized, reconstructs the exact supported instructions, and materializes
  one bounded unsigned v0 transaction without accepting signing authority.
- A client-through-Amoeba network boundary: browser/Petri reads are fixed to
  Amoeba `/rpc`, generic transaction submission is removed in favor of typed
  writer/trade submit and status routes, and direct provider selectors are
  rejected or stripped.
- An explicit server-only unified private Helius Devnet state/Photon mode,
  admitted only for one exact query-authenticated href with finalized state
  commitment and the preauthorized provider-origin hash, with bounded response
  reads and redirects disabled.

### Boundaries

- Spread recomputes or verifies every amount and liability.
- Lean owns semantic admission and financial policy.
- The SDK owns wire construction, strict decoding, and portable plan binding;
  it contains no independent writer financial formulas.
- Current signing and submission are unavailable. Historical unsigned
  materialization remains for review and migration only.

### Release status

- Not published from this checkout.
- See [the 0.2.0 release notes](./docs/RELEASE_NOTES_0.2.0.md).
