# Writer bid-index preparation candidate

This isolated SDK branch prepares Spread source
`d739bcd15068fb79e0b32d0c4eda02703c6417d4`. It is not a deployed release:
current write qualification is unavailable until the parent's final receipt
binds the program, controller, exact artifact and full ProgramData bytes.
The preceding release files and immutable archives are preserved.

The normal operator API is `buildCurrentGovernedInstructionV1` with
`builderName: "buildPrepareWriterBidIndexV1Instruction"`. The exact upstream
input has the canonical preparation accounts, `auctionNonce`, and `phase: 0 | 1`.
The SDK registers the upstream builder, exports its types, and strictly decodes
tag 249 as an eight-byte nonce followed by one phase byte. Bytes 250 and 251
remain unassigned. The standard governance gate and signed epoch tail apply.

A fresh caller must perform this sequence:

1. Build phase 0 from fresh state, sign and confirm its own transaction. The
   canonical bid index must then contain exactly 10,000 zero bytes.
2. Re-read finalized state and rebuild phase 1 with a fresh governance context,
   sign and confirm another transaction. The index must then contain exactly
   14,936 zero bytes.
3. Re-read finalized state and build `buildCommitWriterAuctionV1Instruction`
   for that same future auction and nonce. Commit initializes the prepared
   index once. Do not combine preparation phases or reset initialized state.

The SDK does not send these transactions. There is no auction lifecycle
executor or commit-builder caller in this repository; its commit references
are exports, decoding, and tests. The user writer-plan API deliberately refuses
operator auction actions for lack of reviewed semantic bindings and stays
unchanged. Actual fresh lifecycle callers are owned by the parent and other
components and must implement the sequence above.

The staged ELF is 1,236,592 bytes, SHA-256
`0dd6a6def09a8fc690572bf5a430157644b9b1e5ebac60a2f07c481a3bf0d22d`.
The planned deployed payload has capacity 1,241,504 bytes and exactly 4,912
mandatory zero padding bytes, SHA-256
`23f6d99a47cc79d2babad6758531664414cfc51df313ae82ea2cfd6c32829f87`.
These are distinct identities. Final receipt reconciliation must preserve that
distinction, pin the full account hash and slot, and admit no arbitrary padding.
No new deployed identity or write eligibility is inferred from this candidate.
