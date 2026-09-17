# G3 user operation transport

`prepareG3UserOperation` constructs dated receipt actions and funded public-order
actions through the canonical G3 builders. It selects the installed local-test
profile by observed gate and executable bytes, requires the owner as the only
transaction signer, obtains a finalized blockhash, and emits a schema-3 plan.
An optional observed, active, mature address lookup table enables v0 packets.
Order plans include exactly one fixed 1,000,000-unit ComputeBudget limit before
the business instruction. No priority-price instruction is added; wallet and
native reconstruction reject a changed budget prefix.

`validateG3SignedMessage` is browser-safe. It checks the exact independently
reviewed message and the Ed25519 owner signature. `revalidateG3UserOperation`
checks persisted commitments, the operation selector, fresh gate/ELF identity,
epoch, lookup-table bytes and blockhash lifetime before relay. Neither API signs
or sends a transaction. A caller cannot redirect the local profile to public RPC.

`resolveG3UserIntent` accepts canonical JSON addresses/decimal quantities and loads
actual receipt, sleeve and pool accounts with canonical codecs. It never accepts
caller-supplied decoded receipts or pools. Edge binds the resulting instruction to
actual local SBF simulation and the private proof-carrying Lean admission route,
and repeats this process before relay.

Rust `g3_operation::G3OperationPlan` decodes schema 3, checks the package lock and
ordered commitment, reconstructs legacy/v0 messages from independently supplied
instructions, and verifies the owner's Ed25519 signature. The caller must obtain
those expected instructions independently; copying them from the plan is not review.

Validation: SDK build/typecheck and 12 focused tests passed, including a synthetic
RPC fixture containing the exact locked ELF, persisted legacy/v0 plans, actual
owner signatures, epoch changes, expired lifetimes and message mutations. This
is transaction-boundary evidence. The Lean repository also contains an opt-in joined
real SDK/Lean/pinned-SBF lifecycle test. No live deployment is involved.
