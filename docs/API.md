# API

## HTTP client

`AmebaClient` exposes strict current reads for chain identity, program registry,
markets, charts, history, and Oracle state. Its remote endpoint is the hosted
Amoeba API (or a loopback development server), never a Solana or provider RPC.
`amoebaReadGatewayUrl()` derives the sole client read gateway at `/rpc`.

There is no generic `chain.submitSigned` API. The typed writer/trade status
routes remain readable, but both typed `submit` methods fail synchronously
with `CURRENT_PROGRAM_WRITE_ABI_UNAVAILABLE` before request parsing or
network access. Their request types remain published so consumers can migrate
without inventing a generic relay. When a governed write release eventually
reopens submission, it must continue to bind `operationId`,
`preparedPlanDigest`, owner, batch index, exact prepared bytes, and exact
wallet-signed bytes; POST must never be blindly retried.

## Protocol

`ameba-sdk/protocol` exports four deliberately separate surfaces:

- `CURRENT_LIVE_DEPLOYMENT` and `readCurrentLiveDeploymentFacts` for
  byte-qualified finalized live reads;
- `CURRENT_GOVERNANCE_GENERATION_1` plus the exact gate/PDA/tail codecs;
- `REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE`, which is never selected by a
  review flag alone; and
- `HISTORICAL_RC44_READER_BASELINE` plus the historical Vault, writer, DLMM,
  and portable-plan semantics.

`validateSdkReleaseTrain` accepts only the exact canonical release graph,
including authorization fields. `assertCurrentWriteReleaseAvailable` is the
shared fail-closed mutation seam. The governance instruction API is an
inspector, not a builder: it validates one final read-only gate meta, one exact
`AGV1` tail, the observed epoch, and a caller-supplied exact-release tag
allowlist.

`prepareWriterOperation` is the historical RC44 planner. It accepts only
native `TransactionInstruction` values and validates exact payload grammar,
operation/tag admission, signer/write-set coverage, every observed account,
and every admitted semantic field. It does not append governance bytes and
must not be submitted against the live program. Collective-long claims remain
fail-closed because RC44 does not encode the caller-selected `seriesIndex`.
The TypeScript-only policy/auction/reconciliation/settlement variants likewise
remain fail-closed until their semantic schemas and Rust reconstruction paths
are reviewed.

Every wallet owner used for a cold proof or canonical Light output must pass the same strict RFC8032 compressed-point admission in TypeScript and Rust. Noncanonical field encodings, an asserted sign for `x = 0`, and encodings whose Edwards equation has no square root fail closed before ATA derivation.

Hot operations retain the byte-for-byte schema-v1 shape. Schema v2 has two discriminated modes. Begin-close and basket deposit use `cold_load`: proof facts bind the derived ATA, token owner, mint, payer, authenticated amount, and exact Lean-admitted `minimumAmountAtoms`; every independently built native batch has the exact compute/idempotent-create and fully decoded Light v0.23.3 `Transfer2` grammar. The decoder binds the payer, current tree/queue topology, proof mode, unique compressed input identities, amounts, mint, destination, absence of token outputs/lamport movement/extensions, and cross-batch input uniqueness; the final load plus writer instruction is inseparable. Series and Flat cancellation use `canonical_output_create`: no cold balance is claimed or loaded, exact owner/mint/payer/ATA facts are bound, and the SDK constructs the 600,000-unit compute plus official idempotent Light ATA-create batch. `currentWriterCanonicalOutputSetupInstructionBatches` exposes that exact pre-observation batch so callers can bind all metas and the write set before `prepareWriterOperation`, which independently rebuilds it. `validateWriterOperationPlan` requires independently rebuilt semantic input and compares the complete canonical plan.

Rust `parse_writer_operation_json` deliberately remains schema-v1/hot-only. `parse_writer_operation_json_with_setup` accepts v1 with no setup or v2 only when the caller supplies independently rebuilt native Light batches whose bytes, ordered metas, setup mode/facts, target, signer coverage, write set, commitments, and final atomic grouping exactly match. A self-authored portable manifest is never sufficient admission. A Rust test executes the TypeScript fixture emitter and validates one v1 plan plus all four v2 close targets across the language boundary.

The SDK performs no writer reserve, close, auction, settlement, or security arithmetic. Lean admits semantics; Spread recomputes or verifies all financial facts.

`prepareFlatTransferOperation` is a separate Light Token operation boundary because Flat transfer is not a Spread writer instruction. It derives the Flat mint and Light ATAs, validates the exact current mint/token layouts and custody policy, rebuilds the official Light create-ATA/`TransferChecked` bytes, and binds finalized account bytes. A hot-absent destination is queried through the authenticated Light resolver before it may be treated as new. One cold source or destination may carry proof facts, exact native load batches, a writable set, explicit per-batch signer roles, and exact execution grouping. Rust admission requires independently rebuilt `light_client::interface::create_load_instructions` output and requires the final fresh load plus `TransferChecked` to remain atomic. If both ATAs need loads, earlier loads finalize sequentially and the final ATA proof is fetched only afterward.

`prepareCollectiveSwapOperation` accepts the independently rebuilt native tag-254 instruction plus admitted semantic selectors. It strictly decodes the payload, account order/flags, writer and pool PDA chain, exact writable set, exact trader signer, and complete finalized state evidence for every account used to rebuild the route. `validateCollectiveSwapOperationPlan` compares the complete portable plan with a fresh native reconstruction. Bin zero is a valid `u16` limit endpoint; the only valid deadline is finalized observed block time plus 120 seconds.

## Petri

The Petri adapter preserves these historical writer command identities:

`list`, `show`, `deposit`, `bid`, `closePreview`, `close`, `closeStatus`, `claim`, `transferFlat`, and `policyAudit`.

It also exposes `trades.prepare` and `trades.submit` for the historical
collective-DLMM shape. Read and planning operations remain callable.
`deposit`, `bid`, `close`, `claim`, `transferFlat`, `trades.submit`,
and every other operation classified as `transaction` fail before process
execution while the release train is write-unavailable.

Other non-read local effects require an absolute Petri binary path. No
operation adds confirmation, keypair, PDA, account meta, or financial inputs
implicitly.
The adapter has no RPC URL option and removes Solana, Helius, Photon, and public
browser RPC environment overrides before spawning Petri.

## Writer-close route helpers

The Rust SDK retains exact historical route helpers for
`/dlmm/writer-sleeves/closes/prepare`,
`/dlmm/writer-sleeves/closes/next/prepare`,
`/dlmm/writer-sleeves/closes/cancel/next/prepare`, submit, status, and
close-request reads. These are route identities only.
`CURRENT_WRITER_OPERATION_CAPABILITIES` reports reconstruction and
validation facts; it does not claim a current write ABI, configured route, or
public deployment.
