# CLI parity

The SDK Petri manifest is checked against CLI commit
`d47907ae215e338412d33859e71c25f034d3f24b`. It preserves the same
collective secondary-trade and writer command families:

```text
trades prepare
trades submit
writers list
writers show
writers deposit
writers bid
writers close-preview
writers close
writers close-status
writers claim
writers transfer-flat
writers policy-audit
```

Command presence is not write availability. `trades.submit` and every other
`transaction` effect fail in the SDK adapter with
`CURRENT_PROGRAM_WRITE_ABI_UNAVAILABLE` until a governed cross-repository
release exists. Read and preparation parity can still be tested.

Trade commands accept only semantic exact-input selectors. Petri never accepts caller-supplied program accounts, PDAs, metas, or reserve-page routes.

Close is staged. `close-preview` displays the Lean-admitted preview; `close` prepares/submits the next bounded stage; `close-status` shows the request and remaining cancellation/finalization work.

The parity gate compares command paths, the exact CLI commit,
public/developer binaries, and structured help. It does not infer live
write-compatibility from a matching command graph.
