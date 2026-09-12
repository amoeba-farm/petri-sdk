# Governance V2 security status

Date: 2026-09-03

This is the release disposition for the 310-assignment Governance V2 SDK
security pack. It distinguishes work completed in this SDK candidate from
cross-repository or deployment work that cannot be honestly inferred.

## Repository and evidence baseline

- The pack SHA-256 manifest verified all 36 supplied files.
- SDK work began at exact clean commit
  `57e328e078d02c48a4b692628b790f51ed7ce1f0`, matching the inspected
  `origin/main`.
- Exact clean worktrees were identified for the pack's Spread and governance
  heads. Dirty canonical checkouts were not used as evidence or modified.
- Current Lean and CLI heads were inspected separately. Historical worktrees
  and current source heads were not collapsed into a deployment claim.

The canonical source/identity graph is
`release/release-train.v1.json`. Its SDK `candidateCommit` is `null`
because a commit cannot safely embed its own Git hash; Git identity remains an
external release receipt.

## Completed SDK controls

| Pack area | Candidate disposition |
| --- | --- |
| SDI identity and release train | Implemented: separate historical, live, and candidate identities; canonical schema; mutation tests; source remains unknown where unproven. |
| SDG governance wire | Implemented for read/inspection: exact gate decoder, PDAs, tail codec, account linkage, status semantics, epoch/freeze re-observation, and batch envelope inspection. |
| SDS supply chain | Implemented: current CLI parity pin, isolated per-repository fetch credentials, pinned host key, full-SHA actions, secret-free pull-request matrix, lifecycle scripts disabled, offline consumer install. |
| SDP protocol compatibility | Historical RC44 decoder/builder/differential suite retained and relabeled; no current governed builder is exported. |
| SDW wallet | Historical wallet firewall retained, explicitly ineligible for current writes, and browser-bundled without Node capabilities. |
| SDL Light boundary | Existing exact RC44 Light proof/custody/setup tests retained; no claim is made that those shapes are a governed live write release. |
| SDN network handoff | Generic relay remains absent; typed submission now fails before network access; reads, preparation, status, redirect, credential, timeout, and body bounds remain tested. |

The TypeScript suite, Rust suite, package/reproducibility checks, browser
bundles, CI policy mutations, historical Spread archive verification, and
read-only live qualifier are the executable evidence. Passing historical
differentials proves semantic preservation, not current write compatibility.

## Intentionally unavailable

The following requirements remain unavailable rather than being represented by
synthetic fixtures or renamed constants:

- a reproducible Spread package whose exact source, governed instruction
  manifest, and artifact correspond to the finalized live ProgramData bytes;
- governance envelopes on every exact assigned current mutator;
- governed wallet packet-size and ALT closure for those exact current
  mutators;
- Lean, Edge, SDK, and Petri agreement on one governed plan schema;
- finalized deployment, controller activation, authority handoff, and public
  capability evidence; and
- protected release/tag policy plus explicit publish authorization.

Consequently, all pack tests whose pass condition requires an actual governed
write release, deployment ceremony, sacrificial deployment, or full
cross-repository stack remain `inconclusive` or `not executed` for release
enablement. They do not override the fail-closed result.

## Release decision

- Current finalized reads: **admitted by exact byte qualification**.
- Historical RC44 decoders/planners: **admitted for read, replay, and
  migration**.
- Current program mutation: **unavailable**.
- Generation 2 activation: **not established**.
- Deployment, authority transfer, signing, npm publication, Git tag, or GitHub
  release: **not authorized or performed by this candidate**.

The next release may enable mutation only after the unavailable items above
become exact, finalized, cross-repository evidence and the full 310-assignment
matrix is replayed against that one release train.
