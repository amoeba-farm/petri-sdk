# Lean SDK proof map

The SDK adds eleven public theorems. The canonical source-index and settlement
theorems reused from `ameba_lean` remain indexed in
`../ameba_lean/docs/PROOF_MAP.md`.

| Fully qualified theorem | Module | Meaning |
| --- | --- | --- |
| `Oracle.Trades.plan_sound` | `Oracle.SDK.Rules.TradePlan.Theorems` | Successful execution implies valid input and exact intent preservation. |
| `Oracle.Trades.plan_complete` | `Oracle.SDK.Rules.TradePlan.Theorems` | Every valid matching declarative plan is produced by execution. |
| `Oracle.Trades.plan_success_iff_valid` | `Oracle.SDK.Rules.TradePlan.Theorems` | A successful plan exists exactly on the valid input domain. |
| `Oracle.Trades.plan_error_iff_not_valid` | `Oracle.SDK.Rules.TradePlan.Theorems` | An error exists exactly outside the valid input domain. |
| `Oracle.Trades.tradePlanMatches_deterministic` | `Oracle.SDK.Rules.TradePlan.Theorems` | The declarative plan relation determines one result. |
| `Oracle.Trades.plan_deterministic` | `Oracle.SDK.Rules.TradePlan.Theorems` | Repeated successful execution returns the same result. |
| `Oracle.Trades.plan_zeroQuantity_is_rejected` | `Oracle.SDK.Rules.TradePlan.Theorems` | Zero quantity is rejected before effects. |
| `Oracle.Trades.plan_emptyContract_is_rejected` | `Oracle.SDK.Rules.TradePlan.Theorems` | Empty contract ID is rejected before effects. |
| `Oracle.Transactions.isApproved_eq_true_iff` | `Oracle.SDK.Rules.Approval.Theorems` | The executable approval check matches exact ID-and-intent equality. |
| `Oracle.Settlement.isSettlementReady_eq_true_iff` | `Oracle.SDK.Rules.SettlementReadiness.Theorems` | The executable readiness bit accepts exactly the declarative explicit-fact conditions. |
| `Oracle.Settlement.checkReadiness_eq_ready_iff` | `Oracle.SDK.Rules.SettlementReadiness.Theorems` | The structured readiness result is ready exactly under those conditions. |
