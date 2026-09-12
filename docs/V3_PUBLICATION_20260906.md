# September 6 current deployment binding

The current TypeScript tools and Rust dependency are pinned to published Spread
source `fd82d9b2eea124558d11564da4517f0763ef8ea0`. Its separately identified
deployed artifact source is `e57473cea72f387e5d877d70e9495f07bebfcdaa`, built
with `devnet-v3-governance-controller` and `devnet-solo-backfill-2026`.
The payload is 1,231,264 bytes with SHA-256
`bf05c3c19a5c1f7d3c3c4db157106d2b868fcb507b1171728645c40b57936e0a`.

`release/current-deployment.v1.json` selects this identity. The September 6
12:47:52 UTC checkpoint records deployment slot 494031585 but no exact finalized
ProgramData RPC context. Consequently `minimumContextSlot` is a required floor
for future finalized reads, and `finalizedObservationSlot` is null. This replaces
the current descriptor's misleading `finalizedVerificationContextSlot` field.
Consumers should use `CURRENT_LIVE_DEPLOYMENT.minimumContextSlot`.

The full ProgramData hash is deterministically reconstructed from the checkpoint
header and hash-verified artifact. The new compressed fixture labels this
reconstruction and its synthetic gate state explicitly. Historical receipts,
the earlier archive, and original raw and HTTP fixtures remain unchanged.
Synthetic current HTTP samples live under `test/helpers/current-20260906`.
These fixtures are test inputs, not fresh RPC or HTTP observations.

Package capability still requires fresh finalized program, ProgramData, gate,
and business-state checks before constructing a current write. Tests retain
frozen, paused, uninitialized, regressed-slot, stale-epoch, and substituted-byte
refusals, including rejection of the historical ProgramData. Deployed Writer V1
remains selected; RC44 stays the historical semantic reader baseline.

The dated checkpoint has thirteen market definitions, zero contract supply,
400 sources, and eight coverage manifests. Preparation is pending; November and
December remain paused. Light/DLMM initialization has a separate controller-PDA
authorization blocker. No funded/trade-ready or completed activation claim is
made. Gate Active at epoch 3 is a dated observation, never permanent permission.

Git publication targets the existing private SDK repository. It does not make
private Rust Git dependencies anonymously available or publish an npm release.
Push-triggered CI runs verification only; it now fetches both the historical
semantic and exact current Spread commits before discarding fetch credentials.
No application deployment, chain transaction, or lifecycle executor operation
is part of this change.
