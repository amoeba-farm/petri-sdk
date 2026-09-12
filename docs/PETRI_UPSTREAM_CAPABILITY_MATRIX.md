# Petri upstream capability matrix

This matrix separates historical SDK capability from live byte identity, Lean
admission, route configuration, and write availability. Its detailed operation
rows describe the preserved RC44 semantic baseline, not a live write release.

## Reviewed convergence identities

| Component | Inspected identity | Availability boundary |
| --- | --- | --- |
| Live Spread bytes | ProgramData payload `ae73299ecedbb9153544a600fd663635c1107ab3efa288f7bdec3ffbe557c684` | Finalized byte observation only; source commit unknown; writes unavailable. |
| Historical Spread semantics | `1b2230d96e51f6582155d8284900fbfc11ff1f18` | RC44 decoder/plan baseline and vendored package only. |
| SDK implementation base | `57e328e078d02c48a4b692628b790f51ed7ce1f0` | Base of this unreleased candidate; the release manifest cannot self-name its eventual commit. |
| `ameba_sdk` compatibility base | `57e328e078d02c48a4b692628b790f51ed7ce1f0` | Exact SDK revision pinned by current CLI main; command-graph compatibility target only, not current candidate runtime parity. |
| Lean main | `745d6ddb376b3d646e391038e4af5e21a61eceb9` | Inspected source head, not a declaration of deployed support. |
| CLI / Petri main | `d47907ae215e338412d33859e71c25f034d3f24b` | Exact parity target; matching commands do not establish write ABI compatibility. |

These identities prove only the source and byte boundaries in the canonical
release-train manifest. Availability still requires an exact Spread
governed-write artifact, finalized deployment evidence, Lean/Edge admission,
consumer repins, and full release checks. The SDK branch itself authorizes
nothing.

| Writer-close stage | TypeScript native builder | Rust native rebuild/validator | Schema-v2 setup | Public route identity |
| --- | --- | --- | --- | --- |
| Begin | `BeginWriterCloseV1` | `CloseBegin` | `cold_load`: Flat source, exact minimum and authenticated Light-only balance | `/dlmm/writer-sleeves/closes/prepare` |
| Deposit basket item | `DepositWriterCloseBasketV1` | `CloseBasket` | `cold_load`: claim source, exact positive Lean-admitted minimum and authenticated Light-only balance | `/dlmm/writer-sleeves/closes/next/prepare` |
| Finalize | `FinalizeWriterCloseV1` | `CloseFinalize` | none | `/dlmm/writer-sleeves/closes/next/prepare` |
| Cancel series item | `ProcessWriterCloseCancellationV1`, series selector | `CloseCancel`, series grammar | `canonical_output_create`: actor-paid idempotent claim-destination ATA create; no cold proof | `/dlmm/writer-sleeves/closes/cancel/next/prepare` |
| Cancel Flat | `ProcessWriterCloseCancellationV1`, selector `255` | `CloseCancel`, Flat grammar | `canonical_output_create`: actor-paid idempotent Flat-destination ATA create; no cold proof | `/dlmm/writer-sleeves/closes/cancel/next/prepare` |

Hot plans remain schema version 1 with their original byte shape. A setup stage
uses schema version 2 and binds one discriminated setup mode, its exact proof or
output-create facts, native Light setup batches, setup signer roles, the
complete write set, and execution grouping.
All setup-only batches are explicit; the final setup batch and writer action
share the final execution batch.

The historical submission route identity is
`/dlmm/writer-sleeves/submit`, but SDK submission is currently closed.
Operation receipts are read at `/dlmm/writer-sleeves/status/{operationId}`;
close state is read independently
at `/dlmm/writer-sleeves/close-requests/{request}`.
Each batch is claimed atomically before finalized RPC validation, relayed at
most once, and retained with exact transaction/message hashes once relay may
have been attempted. Status resumes pending observation without resubmission;
transient malformed RPC observations remain retryable, while exact confirmed
transaction mismatches fail closed.

`CURRENT_WRITER_OPERATION_CAPABILITIES` is an immutable SDK-local descriptor.
It proves only builder/validator/schema support. Edge must combine it with Lean
admission, runtime configuration, and deployed-route evidence before advertising
any close capability as `available`.
