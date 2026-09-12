# Lean SDK invariant ledger

The declarations are the checked source of truth. This file is a retrieval
index for the SDK-specific guarantees; canonical `ameba_lean` oracle invariants
remain indexed in `../ameba_lean/docs/INVARIANTS.md`.

| ID | Guarantee | Owning predicates | Establishing theorems |
| --- | --- | --- | --- |
| **SDK-TRADE-001** | Public trade planning accepts exactly a nonempty contract ID and positive quantity; invalid intents are rejected before quote or preparation ports run. | `Oracle.Trades.ValidTradeCommand` | `plan_sound`, `plan_complete`, `plan_success_iff_valid`, `plan_error_iff_not_valid`, `plan_zeroQuantity_is_rejected`, `plan_emptyContract_is_rejected` |
| **SDK-TRADE-002** | A successful plan preserves the caller's contract, side, and quantity exactly and is deterministic. | `Oracle.Trades.TradePlanMatches` | `plan_sound`, `plan_complete`, `tradePlanMatches_deterministic`, `plan_deterministic` |
| **SDK-TX-001** | An approval is accepted exactly when both transaction ID and semantic intent match the validated preparation. | `Oracle.Transactions.ApprovalMatches` | `isApproved_eq_true_iff` |
| **SDK-SET-001** | Settlement is ready exactly after its earliest observed slot, with a finalized oracle, reconciled positions, and no open challenge. All facts are explicit inputs rather than hidden clock/RPC reads. | `Oracle.Settlement.ReadyForSettlement` | `isSettlementReady_eq_true_iff`, `checkReadiness_eq_ready_iff` |

## Operational boundaries, not formal claims

Typed ports, concrete transport truthfulness, Solana message parsing, account
ownership/PDA validation, signer implementation, and chain confirmation are
effectful boundaries. The current SDK types separate those phases but do not
prove an external backend, validator, signer, or RPC node honest.
