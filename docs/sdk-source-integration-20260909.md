# SDK source integration handoff

SDK base: `b7422f925750d1742b64ff449c024e5d0d8e0b4d`, isolated `edf5/ameba_sdk`. Reconciled directly with final `f22b/ameba_spread` sources and `021e/ameba_lean` consumers. All edits remain local and uncommitted.

Spread reviewed the completed SDK Opening wrapper and plan/resume bridge and acknowledged the final interfaces match. Lean separately acknowledged the SDK/relay boundary. TypeScript `createSourceFile` syntax-only parsing covered all 16 changed/new `.ts` and `.mjs` files with zero parse diagnostics; `git diff --check` passed. No SDK code, package checker, test, typecheck, or build was executed.

## Fixed integration gaps

- SDK source recognizes tag 200 and checks six nonzero 32-byte hashes plus bounded LE u16 weight (194-byte payload). The released admission inventory is separate from known grammar. Existing package-owned release/provenance inventories still exclude 200; builders additionally require actual native exports. The release validator remains browser-safe, without importing native operator modules into wallet/browser paths.
- `readCurrentOracleRecipeIndexProgress` reads absent, prefunded, partial or complete canonical recipe state at a finalized floor. `prepareCurrentOracleRecipeIndexStep` binds the SDK release/gate, calls native `buildOracleRecipeSourceIndexPlan` and `nextOracleRecipeSourceIndexStep`, reconciles the authenticated reverse prefix, and returns only the next instruction or null when complete. It never resets or automatically replays progress.
- `readCurrentOracleRecipeMembership` remains complete-only for active/median consumers. It binds ORI/OBI layouts, ownership, canonical addresses, hashes and ascending membership; inactive frozen sources are retained.
- `ameba-sdk/operator` now exports `planCurrentOracleOpeningMonth`, `assertCurrentOracleOpeningActionAdvanced`, `redactedCurrentOracleOpeningPlan`, evidence parsing/types and the membership helpers. The planner calls the real native `oracle-current-v3-opening` subpath, obtains SDK-owned governance and finalized time, imposes a finalized account-read floor, and validates output instructions. Its RPC wrapper refuses simulation/submission. `index_recipe_sources` and membership progress are included in the SDK result type. Opening verification uses the native Opening helper, not the recipe-only lifecycle helper.
- Source packaging inventories now require the new emitted SDK modules and the native `oracle-dlmm`, `oracle-current-v3-opening`, and `oracle-current-v3-lifecycle` subpaths. Native qualification compares tag-200 admission against the real export set and lifecycle action map. Fixture generators preserve the actual released tag inventory instead of granting every recognized grammar tag. These scripts were edited, not executed.

## Exact Spread consumption

The native plan contains `{oracleMonthPda, manifestHash, expectedBucketCount, steps}`. Each reverse step contains `{params, instruction}`. Resume returns `{indexedSourceCount, complete, nextStep}` after checking recipe/month/root/counts, last reverse step, indexed bucket count and total weight. SDK reads canonical finalized metadata before calling it.

Tag 200 uses seven ordinary governed core accounts, no compressed transport. ORI is 209 bytes, OBI 366 bytes with eight maximum source IDs. Tag 122 retains sources from slot 7 followed by two read-only indexes, 10–13 core accounts, and writable month at slot 2. Tag 197 retains source at 4 logically read-only; compressed transport makes it physically writable. Observations stay at 5, optional grace accounts at 6–8, indexes last, 8/11 core accounts. SDK delegates those exact metas and access contracts to native builders. Median traversal includes inactive sources; they do not contribute economically.

## Lean boundary acknowledgment

Lean reviewed and acknowledged unchanged SDK position request/context/plan shapes and `revalidateCurrentGovernedTransactionV1({serializedTransactionBase64, minimumContextSlot, rpc}) -> {validated:true, finalizedObservationSlot, ...}`. SDK reviewed Lean's retained `instructionAdmission`, maximum transaction bytes, manifest, revalidated ALT, exact packet/digests and confirmation context. New prerequisite codes and additive bounty proof facts are preserved without treating missing owner evidence as zero entitlement. No mismatch was found in this source review.

Lean has no direct user-action membership consumer; its monthly Opening path remains the native Spread planner. No speculative routes, startup requirements, public action masks, or passthroughs were added. No further Lean changes are required for the SDK facade.

## Remaining prerequisites

The real package model is SDK `file:vendor/...tgz` plus bundled native dependencies; Lean consumes an exact Git SDK revision and hydrates its verified vendor archives. New native source exports must arrive through a real built archive, with actual checksums/provenance, generated SDK `dist`, a coherent release inventory and matching contract identity. Package managers must not be pointed at peer source folders or have shared stores mutated. Existing hashes, pins, release receipts and generated artifacts were not changed.

Compilation, type checking, behavioral tests, package/install qualification, proof/packet limits, publication and deployment remain unperformed. Later on-chain index creation/progress, funding, collateral, lifecycle and signer/evidence prerequisites are separate from source integration. Nothing in this handoff establishes live readiness.
