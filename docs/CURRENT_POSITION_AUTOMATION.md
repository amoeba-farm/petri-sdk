# Current collateral and expiry planning

The server-only `ameba-sdk/protocol` entry point and `createCurrentSdkAdapter`
expose two-phase collateral preparation:

```ts
const context = await adapter.prepareCurrentPositionActionContext({
  request: { action: "deposit_collateral", ownerPubkey, amount: 1000n },
  minimumContextSlot,
  commitment: "finalized",
});
// Independently validate context.observation and obtain the application's Lean admission.
const plan = await adapter.buildCurrentPositionAction({
  request: context.request,
  context,
  commitment: "finalized",
});
adapter.validateCurrentOperationPlan(plan);
```

Supported actions are `init_collateral`, `deposit_collateral`, and
`withdraw_collateral`. Initialization has no amount; the other actions require a
positive u64 bigint. Contexts are opaque objects issued for the exact connection
and request. A copied, substituted, or earlier-than-requested context is rejected.
The builder rereads governance before producing unsigned transaction bytes.
`buildCurrentPositionAction` can acquire its own context when none is supplied;
applications that admit an observation before building should use both phases.

Plans bind canonical VaultConfig, owner collateral, classic SPL mint/custody/ATA
identities and balances, exact governed instructions, observation bytes, signer
roles, write set, transaction and digest. Deposit and withdrawal require existing
canonical token accounts; this API does not create ATAs implicitly. Initialization
requires an absent UserCollateral PDA. The independent Edge/Lean admission and
freshness checks remain mandatory before submission. Neither method signs or
submits a transaction.

Native plans support `validateCurrentOperationPlan`, `currentOperationPlanToJson`
and `validateCurrentOperationPlanJson`. Only the originating adapter accepts its
issued object in the bound validator. Portable validation verifies the plan's
structure and bindings; it does not replace current RPC evidence or Lean admission.

## Position-expiry planning

`readCurrentPositionExpiryAutomation({state, owner, automationId?})` is available
on the bound adapter. The top-level form additionally requires the usual
`connection`, `programId`, `namespace`, and optional finalized `commitment` and
`photonConnection` inputs. `state` supplies the Market/pool discovery scope:
`markets: [{address, marketId, expiryId}]`,
`pools: [{address, marketAddress}]`, `stateNamespace`, and optional `issues`.

The reader independently resolves canonical pools, all pool positions (including
cold accounts where a Photon capability is needed), shared anchor OracleMonths,
and referenced settlement records. It filters by the requested owner only after
checking the global position count. Each stable record contains the exact owned
share vector and next step: await expiry, await final settlement, settle the pool,
remove liquidity, or close an empty position. Removal still requires explicit
minimum outputs and a fresh admitted liquidity plan. No zero-slippage bounds or
recipient choices are inferred.

The projection is a finalized read window, not an atomic admission snapshot.
`complete` describes only the supplied discovery scope. Market/pool scan issues
and incomplete fresh reads keep it false. `records` must not be interpreted as a
complete portfolio in that case. Stable record IDs do not denote persisted jobs.

`syncCurrentPositionExpiryAutomation` refreshes the same planning projection;
its optional request accepts only `owner` and `automationId`. It returns
`applied: false`, `mode: "planning_only"`, and
`reason: "CURRENT_EXPIRY_EXECUTOR_UNCONFIGURED"`. The scheduler is disabled and
readiness never claims execution support. A durable scheduler, signer policy,
transaction journal, caller-selected economic bounds and admitted execution
workflow belong to the integrating application. Execution requests are explicitly
rejected, rather than represented as successful synchronization.

## Exact swap compute budget

`prepareCollectiveSwapOperation` accepts optional
`computeUnitLimit: COLLECTIVE_SWAP_COMPUTE_UNIT_LIMIT` (exactly 1,000,000 units).
The budget is part of both plan digests and requires the trader signer index `[1]`.
Omitting it preserves the existing one-instruction plan and signer index `[0]`.
`buildCurrentGovernedInstructionV1` still produces the business instruction.
After independent plan reconstruction/validation,
`collectiveSwapExecutionInstructions(plan)` returns the canonical execution
manifest, including the fixed ComputeBudget prefix when selected. It adds no
priority fee and accepts no caller-selected instruction bytes. The public wallet
materializer independently reconstructs this prefix. Edge preparation, relay and
confirmation must use that same admitted sequence; appending a prefix afterward
is not supported.

The Rust portable validator accepts the same optional field, commits it to both
digests and reconstructs the fixed prefix in `execution_instructions`. Governed
Rust signing uses this complete sequence. Other limits and misplaced signer
indexes are rejected even when an input recomputes its digests.
