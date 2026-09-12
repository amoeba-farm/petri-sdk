# Governed Rust write restoration candidate

This is implementation and offline verification, not a deployment receipt. The
shipping release train remains unavailable. Historical RC44 artifacts, source
pins, and receipts retain their original identity; none is evidence for the new
Writer V2 runtime.

## Admission and signing contract

1. `current_governed_write_release_v1()` qualifies only the compiled package's
   Generation 2 release train and governed runtime receipt. Its opaque return
   value cannot be constructed from caller data. There is no environment,
   feature, public test constructor, caller controller, or caller tag allowlist.
2. Obtain the Program, ProgramData, and canonical Gate in one finalized account
   observation, after independently checking the exact Devnet genesis.
   `observe_current_governed_write_context_v1()` validates exact owner,
   executable flag, headers, hashes, payload, zero padding, deployment slot,
   authority, gate PDA/bump/links, Active status, and epoch.
3. The current typed Writer, collective-swap, and Flat JSON parsers require that
   opaque context. Writer/swap rebuilding uses the checked business view but
   preserves the original governed bytes and portable commitments. Unknown and
   retired tags, forged tails, extra accounts, elevated Gate privileges,
   semantic substitutions, and missing business observations fail closed.
4. Before opening any signer, call `prepare_current_governed_signing_v1()` with
   another finalized deployment observation and the exact ordered raw business
   accounts from the approved snapshot. Present accounts must match every
   owner/executable/length/hash fact; absent accounts must remain absent. The
   returned opaque signing session fixes the exact legacy message and blockhash.
5. Sign that exact message. After any interactive or hardware approval, obtain
   a fresh finalized full observation and call
   `revalidate_current_governed_signed_transaction_v1()`. A new epoch, freeze,
   deployment change, business-account change, or changed message is rejected;
   the SDK never re-tails or silently repairs an approved transaction.
6. The caller must independently verify the actual signatures, blockhash
   validity/last-valid height, product deadline, and explicit user intent, then
   use its existing typed product relay. The SDK introduces no generic
   broadcaster. JavaScript/Rust compiler ordering may differ only where the
   resolved complete key set and effective privileges are identical; a signing
   session still accepts only its exact original raw message.

The current CLI previously accepted one execution batch only. This work does
not invent an unapproved multi-transaction scheduler: any preceding cold-load
batch that changes the approved snapshot requires a newly prepared current plan.

## Writer V2 and transport

The eight current builders use tags `12, 13, 14, 15, 200, 249, 250, 251`; retired
tags `233, 237, 238, 239` have no current compatibility aliases. Account finance
and layouts are imported from the one current Spread Rust crate, not recreated
as a private SDK protocol implementation. WAP/WSP decoders bind the canonical
parents, exact sizes (366/758), layout flags, bounds, and cancellation bitmap.

Search, materialization, and activation need the release-owned schema-2
`release_compute` grammar. `src/protocol/writer-operation-transport.v1.json` is
the single object consumed by TypeScript and Rust. The train's
`writeRelease.writerOperationTransport` and governed runtime provenance's
`writerOperationTransport` must both equal it exactly, including no extra keys.
Both copies must also carry `writerOperationTransportSha256`, the SHA-256 of
recursively sorted compact JSON encoded as UTF-8 without a trailing newline.
The release policy must bind that same object alongside final runtime evidence.

The one execution batch is exactly RequestHeapFrame(65,536),
SetComputeUnitLimit(1,400,000), then one governed action. Setup has no accounts,
signers, proof facts, output-creation facts, or extra instructions. Original raw
setup and execution bytes participate in both operation and prepared-plan
commitments before approval. Heavy current schema-1 plans are rejected. Existing
historical schema-1 and current Light cold/output-creation schema-2 behavior is
not redefined.

## Verification status and final handoff

Tests exercise actual bundled TypeScript builders, exact Rust named-builder
parity for all eight V2 instructions, per-field rehashed semantic tampering,
whole-batch rehashed compute tampering, original-message deterministic local
signing, finalized before/after observations, stale epoch/freeze/deployment
mutations, strict WAP/WSP account decoders, current swap admission, and actual
JavaScript Flat hot/absent-destination preparation.

`scripts/emit-governed-writer-rust-fixture.mjs` uses one explicitly named
test-only VM substitution: the compiled Writer module's semantic-view resolver
binds the exact fixture release before calling the real registered runtime
inspector. Module/dependency/package hashes and negative substitutions are
recorded. Every other link is the actual installed runtime. This fixture is
unattested and cannot authorize current deployment or writes.

While the final Spread source commit is not available, Rust tests run only in
the separate `writer_v2_rust_verify/ameba_sdk` worktree with an explicitly local
Cargo patch to the shared dirty Spread source. That override is not tracked in
this SDK. The source checkout's tracked Cargo pin remains historical; it cannot
compile these new V2 types until the final current dependency is pinned. Do not
report the isolated candidate test as a clean-checkout or release proof.

Final integration must pin the actual reviewed Spread commit in Cargo/lock and
the current package/provenance verifier, repack the exact matching current
TypeScript artifact, preserve the historical archive/receipts separately, bind
the transport object, and rerun all tests and clean-checkout/package gates.
Only final reproducible program/deployment and governance evidence may populate
available release metadata. No readiness boolean is a substitute for that work.
The public JavaScript availability methods now invoke the same package-owned
qualifier instead of returning false unconditionally. Their shipping result is
still false with the unchanged unavailable receipts. An offline test VM checks
the exact compiled qualifier against synthetic imported receipt documents and
more than 50 one-field or mutually wrong transport mutations; it replaces no
qualifier function and cannot certify a deployment.

The live-reader adapter now selects that same package-qualified Generation 2
gate after promotion, preserves frozen-state reads, and reports readiness only
for a qualified release with an Active nonzero epoch. Read facts never issue a
signing capability. The compiled-reader/qualifier/gate test uses only isolated
receipt-document substitution and checks both ready and frozen states.

The current shared Writer fixture is byte-identical to the reviewed Spread/Lean
distinct-series settlement vector (SHA-256
`17c6098bbf24077ff694e94cf0cbb6a24731f5a242c5580cc799bd78ea4c4011`).
The original RC44 fixture remains under
`fixtures/historical-rc44-writer_sleeve_math_v1.json`, verified against the
unchanged historical provenance receipt; current constants and the current
fixture receipt no longer relabel that archived evidence.

`emit-governed-cli-fixture.mjs` emits explicitly synthetic receipt documents and
raw accounts for a separate CLI integration copy. It records the exact original
code and substituted-document hashes. No emitted receipt is a shipping file or
final release attestation, and no public test constructor/readiness override is
added to the SDK.

Candidate verification on 2026-09-05 passed all 333 JavaScript tests, 61 Rust
tests in the ordinary isolated dependency-override copy, package/current/type
checks, and 3 positive plus 59 negative compiled release-qualification cases.
The separate CLI synthetic receipt copy passed its actual snapshot/sign/relay
integration lane; the ordinary CLI candidate passed 720 tests and all 15
pre-network/signer refusal checks. These are candidate proofs, not final pinned
release or deployed-program proofs. Strict Rust clippy additionally surfaced
12 pre-existing warnings in historical SDK helpers/tests; the two new warnings
in this change were corrected without broadening the historical code edits.
