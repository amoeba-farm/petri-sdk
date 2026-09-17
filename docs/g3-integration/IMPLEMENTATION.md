# G3 SDK and Lean integration pass

Source: Spread `7d22fd9a55199b54c099b842ec705571abeb27ac`, including council adjudication, retired AMBA/sAMBA staking and zero optional bounty support. The supplied integration guide predates those removals; no token voting or staking was restored.

This is a source candidate. The full M01–M18 / IC-01–IC-36 integration is not complete. No deployment or live write was performed. Historical deployed identities remain historical, and old live-write preparation rejects the different installed G3 archive. `ameba-sdk/g3` selects the exact local-test tuple by observed gate and executable bytes; callers cannot choose a production profile.

## Implemented surfaces

- `ameba-sdk/g3`: canonical funded-order, writer-receipt, council, evidence, history, membership, optional bounty and compressed-state exports. Official registry entries cover receipt actions, order actions and metadata uploads. Existing retired construction names reject explicitly.
- `ameba-sdk/g3/browser`: G3 suffix/governance envelope inspection, exact receipt/order selector lengths, quantity strings and retired-tag rejection. Existing full wallet transaction reconstruction still requires migration.
- Receipt payout math: the canonical TS implementation and native G3 Rust implementation agree with the new checked Lean facade on 1,683 shared vectors. Exact interval rounding and payable-loss bounds are proved; this calculation alone does not authenticate a receipt or authorize a claim.
- Membership: bounded page reads, source/root/owner/PDA checks, cross-page order validation and scope-bound continuation. A 42-source test verifies continuation; a prefix is never labeled complete membership.
- Source observations: 352-byte classic and 216-byte compact layouts, u32 total count, latest timestamp, version 3/4 inline observation records, and independent Lean binding of both compact leaves to decoded fields. Public snapshots distinguish the inline 32-entry prefix from full history and use schema 2 with a distinct storage scope.
- Durable plans: active quota excludes terminal history; submitted/uncertain records persist; signed bytes and lifetime are retained before relay; provider signature mismatch remains uncertain. Terminal status cannot become active again. Bounded schema-1 retention migration rewrites known IDs through immutable CAS without replay.

## Validation and limits

Focused SDK tests, Rust payout differential, Lean payout differential, focused source builds, 65 Edge reader/snapshot tests, eight storage-scope tests and eleven registry tests (including actual Redis with two replicas) passed during this pass. CI archive-integrity checks validate actual installed package archives. See evidence logs for exact runs.

The broad SDK regression run had 187 passes and 64 failures. These include retired auction/Flat/staking interfaces, old live-deployment expectations and changed account/envelope shapes; they have not all been repaired or individually discharged. The broader Rust library suite had 55 passes and 10 failures. The Edge suite before final archive installation had 436 passes, 78 failures and eight skips; those failures include consumers still calling removed writer helpers. The full Lean build and current Lean test executable passed. Lean's architecture checker reports 16 issues in unchanged WriterDlmm files. Full qualification is not represented by the focused results.

## Remaining integration

1. Replace retained writer/settlement/oracle operation DTOs and raw admission layouts throughout the existing HTTP prepare/submit/status pipeline. Wire the new receipt and funded-order operations into that pipeline and its browser/Rust/Petri reconstruction.
2. Finish Lean-backed full history/median paging and remove the existing complete-series 256-source backend limit through bounded continuation. The new SDK page API does not remove that backend limit.
3. Wire metadata upload/reveal continuation into actual lifecycle scheduling, including private preimage handling, exact legal reveal phase, and restart recovery. The SDK helper prepares only the next observed chunk.
4. Complete all HTTP-to-SBF, genuine cold-load/Light-proof, signed replay, settlement and action-mask cases from the guide against the installed archives.
5. Supply and qualify the production profile and finalized deployment tuple. The included artifact/profile is explicitly local-test-only.

Existing public endpoint paths were preserved. The private staking and token-vote admission routes now return `G3_OPERATION_RETIRED`. No replacement endpoint family or arbitrary relay was added.

## Bounded cutover

Keep old attempts addressable under their original deployment scope. Before replacing their short-lived schema-1 storage, enumerate retained IDs and call `migratePreparedPlanRetentionPage` in batches of at most 100. It preserves immutable plan and submission bytes, persists unresolved work and frees completed quota. It cannot recover an entry already deleted by the old TTL. Archive old source snapshots; schema-2 scope performs new discovery rather than relabeling them.

Build SDK, pack it, install the resulting archive in Edge using pnpm, and verify both direct Spread and SDK-bundled archive hashes. `edge/vendor/g3-consumer-bindings.json` records exact archives; `release/g3-integration-lock.v1.json` records the selected ABI/artifact/profile. A source inventory digest is distinct from a Git commit and from evidence of a deployment.
