# SDK Devnet operation source fixes

Local source changes based on SDK `b7422f925750d1742b64ff449c024e5d0d8e0b4d`. This is implementation evidence, not qualification or a release. Generated `dist`, native archives, lockfiles, provenance, deployment identities, and release inventories remain unchanged.

## Implemented

- Collateral prerequisites distinguish absent UserCollateral, absent classic SPL account, malformed token identity/layout, owner balance, available collateral balance, and vault custody balance. Amount diagnostics use atomic units and identify the canonical account. Existing custody checks remain enforced.
- Oracle funding distinguishes missing classic SPL accounts, wrong identity/policy, and insufficient balance. Oracle collateral diagnostics identify the exact owner/PDA and initialization prerequisite.
- Oracle phase errors report observed and allowed phases. Initialization distinguishes wrong authority from an existing month. Update finalization reports the exact required authority signer before checking its timing window; both restrictions remain enforced.
- Bounty planning identifies the reward schedule, receipt, and recipient collateral in proof facts. Authenticated existing receipt evidence reports an already-claimed entitlement. Missing compressed records report domain and canonical PDA; unavailable evidence is never converted to zero. A fully resolved zero allocation is a separate prerequisite error.

## Oracle membership interface

`prepareOracleRecipeSourceIndexInputs` validates the complete supplied frozen preimage using the native recipe hash function, requires nonzero fixed hashes and 1–8 sources per bucket, and produces reverse-ordered inputs. It retains every frozen source, including inactive sources. These inputs contain no signatures or execution authority.

`readCurrentOracleRecipeMembership` reads both canonical indexes in one finalized batch, checks Devnet, slot floor, program ownership, native layouts/PDA bumps, completion, frozen recipe and manifest hashes, and bucket ordering. The caller must supply hashes from its independently observed frozen month and recipe manifest. The result is read data, not an admission capability.

The source interface follows Spread `clients/ts/amoebaOracleDlmm/oracleMembership.ts`:

- Tag 200, `IndexOracleRecipeSourceV1`: six 32-byte fields (`previousHash`, `bucketId`, `sourceId`, `sourceTypeHash`, `canonicalLocatorHash`, `sourceDefinitionHash`) and LE u16 `bucketWeightBps`; 194-byte payload, 195 bytes including tag. Weight is 1–10000.
- Seven accounts: payer signer/writable; market read-only; month read-only; finalized recipe manifest read-only; recipe source index writable; bucket source index writable; system program read-only. Any payer may contribute. Indexing is an ordinary governed instruction with no Photon/compressed wrapper.
- Recipe index: namespace + `oracle-recipe-source-index` + month, `ORI` v1, 209 bytes. Bucket index: namespace + `oracle-bucket-source-index` + month + bucket ID, `OBI` v1, 366 bytes, at most eight ascending source IDs.
- Tag 122 keeps sources at slot 7, appending two read-only indexes after them (10–13 core accounts). Tag 197 keeps source at slot 4 physically writable/logically Read, observations at slot 5, and indexes last (8/11 core accounts). Native Spread builders own these exact tail metas and compressed access contracts. Median consumers must visit all frozen sources; only active sources contribute economically.

The SDK registers index and median builders through the existing governed materializer. The membership runtime checks the native export set and sizes and rejects the currently pinned package when the interface is absent. Source grammar now recognizes tag 200, but the unchanged released inventory still excludes it. The browser-safe release validator accepts only the exact known inventory selected by package-owned provenance, cross-checked against the release record. Native-package qualification checks that this inventory matches the actual membership export set. No new operation is advertised as released.

Before this new interface can execute, a separate coherent release must supply the matching native package, artifact/provenance/deployment correspondence, tag-200 release inventory, and deployed contract. The source tag constant, payload grammar and builder registration are implemented; no further source tag promotion is needed. Existing frozen recipes need their authenticated indexes completed before the new active/median consumers run. No historical layout fallback is added.

## Admission and external prerequisites

`current-liquidity-instruction.ts` delegates lifecycle, authorization, and amount admission to Lean; `current-liquidity-operation.ts` binds exact request bytes, canonical metas, finalized observation hashes, and the Lean admission digest. Removal/position-close requires Pending, Paused, or Settled under the inspected contract. Active removal needs an independently authorized lifecycle transition; the SDK never adds a pause. Updated swap/add layouts and original removal layout are preserved.

`writer-operation.ts` binds transport and semantic identity; it does not select a sleeve or override lifecycle admission. The backend owns selection and eligibility for deposits, bids, claims, and close stages. Raw native refund/direct withdrawal builders exist, but those actions are absent from the portable writer operation union. Staking builders exist without a supported oracle action planner. Emergency commit/reveal has SDK planner support, but this alone does not establish backend release availability. No seat-approval semantic operation was identified in the SDK surface.

Retained owner bounty evidence reports unavailable owner inventory and null claimable/claimed amounts despite complete public source coverage. It requires support/merge lineage, accepted opening/finalized update records, registration units, and finalized receipt membership/nonmembership. It does not prove zero entitlement. Retained authority evidence identifies `C8gpKjnPss4SKpjhBpFGNH7cbD26XCzSWhcjj6gF4dx7`; actor `99riHvpFvwfz2tbrWbanEMPz5iyhHHThBbM7eY35vMwL` is not that signer. These are retained observations, not refreshed live state.

The SDK's prepared/signed transaction, idempotency, confirmation, and receipt binding paths are unchanged. Relay failure remains a backend diagnosis; an expired/unobserved attempt is not resent. Actual funding, collateral initialization, entitlement evidence, signer availability, and lifecycle prerequisites remain external requirements.

## Verification boundary

Only source/retained-evidence inspection, packaged declaration inspection, syntax-only parsing and `git diff --check` were used. No tests, typecheck, builds, simulations, signing, submissions, funding, service changes, pushes, merges, publication, or deployment were performed. Full qualification is deferred. See `sdk-source-integration-20260909.md` for the subsequent source-integration pass.
