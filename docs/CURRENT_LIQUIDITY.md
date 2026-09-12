# Current liquidity operation plans

`canonicalCurrentLiquidityRequest` normalizes exact add, remove and
`close_position` requests. Amounts are canonical decimal u64 strings; shares
are u128 strings. Add and remove requests contain identity, nonce and 1..32
sorted bin entries. An empty `close_position` requires `entries: []` and an empty
page route. Requests never supply arbitrary accounts or instructions.

`currentLiquidityBuilderInput` derives the native builder accounts from decoded
market/mint identities and a separately admitted page route. The caller obtains
the native instruction through the release-bound governed builder.
`prepareCurrentLiquidityOperation` binds that instruction to an independently
observed finalized snapshot, a Lean admission digest and an unsigned transaction.
`validateCurrentLiquidityOperationPlan` requires an independent reconstruction;
the submitted plan cannot supply its own validation authority.

The hosted edge must obtain Lean admission for ownership, lifecycle, nonce,
position balances and the exact reserve/share page route. The SDK owns native
encoding and address derivation, not those business decisions. Preparation does
not guarantee on-chain execution: the contract checks amounts, slippage,
rounding, custody and current state again.

This plan version supports **hot state only**. Missing or compressed accounts
must be loaded separately and preparation repeated. It never claims to provide
cold-load setup transactions. Oversized requests are rejected, not split or
silently reduced. Plans contain no backend signatures and never submit funds.

The current contract admits manager liquidity additions in Pending/Active/Paused,
and removal or close in Pending/Active/Paused/Settled. Closed pools are rejected.
Closing requires removing every owned share, or an already empty position with
exactly 16 business account metas and no page pairs. Ownership does not bypass
manager, lifecycle, or balance restrictions.
