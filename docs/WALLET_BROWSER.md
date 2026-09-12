# Browser wallet boundary

`ameba-sdk/wallet` preserves the browser-safe historical RC44 review boundary
between a portable prepare response and unsigned bytes. A prepare response is a
manifest, not authorization. The module accepts no signing capability, submits
nothing, and reports
`CURRENT_WALLET_PROTOCOL_IDENTITY.currentWriteEligible === false`.

The current live ProgramData bytes differ from RC44. The materializer therefore
rejects live use at its exact Program/ProgramData identity check; it remains
packaged for deterministic migration, fixture replay, and cross-language
differentials until an exact governed write release replaces it.

## Public API

```ts
import { Connection } from "@solana/web3.js";
import {
  CURRENT_WALLET_PROTOCOL_IDENTITY,
  amoebaReadGatewayUrl,
  decodeCollectiveOperationPrepareEnvelope,
  materializeCurrentCollectiveWalletBatch,
  type CurrentCollectiveWalletExpectedIntent,
  type CurrentWalletRpc,
} from "ameba-sdk/wallet";

// Historical/sacrificial RC44 replay only. Current live ProgramData is
// intentionally rejected until a governed write release exists.
const connection = new Connection(amoebaReadGatewayUrl(), "finalized");

// Capture this from the user's local action before sending the prepare request.
const expectedIntent: CurrentCollectiveWalletExpectedIntent = {
  operation: "transfer_flat",
  owner: connectedWalletPublicKey.toBase58(),
  sleeve: selectedSleeve.toBase58(),
  destinationOwner: enteredDestination.toBase58(),
  amountAtoms: enteredAmountAtoms,
};
const prepareResponse = await prepareFlatTransfer(expectedIntent);
const decoded = decodeCollectiveOperationPrepareEnvelope(prepareResponse);
const materialized = await materializeCurrentCollectiveWalletBatch({
  prepareResponse,
  expectedIntent,
  owner: connectedWalletPublicKey,
  batchIndex: decoded.operationPlan.actionBatchIndex,
  rpc: connection satisfies CurrentWalletRpc,
});

// Review and preserve both values before asking the wallet to sign.
displayBinding(materialized.binding, materialized.bindingDigest);
const unsignedBytes = materialized.unsignedTransactionBytes;
```

`materializeCurrentCollectiveWalletBatch` first snapshots both the unmodified
prepare envelope and the caller-local economic intent before any asynchronous
work, then strictly decodes and compares them. Setup mode, hot/cold custody,
and an exact close stage are not caller-local inputs: they remain independently
verified plan/current-state facts in `binding.reviewedIntent`. The boundary
independently re-observes the ordered historical account set through an injected
`Connection`-compatible read capability at `finalized`. Its `rpcEndpoint` must
be the exact Amoeba `/rpc` gateway; direct Solana, Helius, and arbitrary
provider endpoints fail before any network method is called. It verifies the pinned
Devnet genesis and exact historical RC44 Program/ProgramData identity, checks the
observation deadline and freshness, and reconstructs the requested canonical
execution batch. It then fetches and validates a fresh finalized blockhash and
compiles one unsigned versioned transaction bounded to 1,232 bytes and the
selected wallet as its only required signer.

The result contains reconstructed `TransactionInstruction` values, unsigned
bytes and base64, and an exact binding for the operation, prepared plan,
observation, Lean admission, wallet, batch, finalized re-observation, blockhash,
message, and transaction digest. The binding also contains the immutable
caller intent, verified semantic/stage/custody projection, and an SDK-computed
`reviewDigest`. That review digest is operation-level and stable across batch
selection; the selected `batchIndex` is bound separately by `bindingDigest`.
It never treats the portable manifest as authority and never signs.

`CURRENT_WALLET_PROTOCOL_IDENTITY` is retained as a compatibility name, but
its `identityKind` is `historical-rc44-wallet-materializer`.
`protocolPlanSdkCommit` names the reviewed SDK identity that defined those
portable plans (`b2cd107…`); it is not a current-live source claim. The
published package's Git/npm provenance identifies the wallet implementation,
avoiding an impossible self-referential source-commit constant.

## Historical operations

The wallet boundary admits only the reviewed RC44 operation shapes accepted by
the historical validator:

- writer deposit and bid;
- writer close begin, basket, finalize, and cancel;
- Flat residual settlement claim;
- Flat holder transfer; and
- collective swap exact-in.

Collective-long settlement claims require `collectiveClaimSeriesBookBase64`: the
exact 8,312-byte native series book from the finalized preparation snapshot.
The plan commits these bytes and binds the requested index to the unique record
matching the instruction's market, mint, retirement custody, sleeve, and group.
The wallet requires the same book bytes on fresh re-observation before producing
unsigned bytes. Only hot accounts are supported; native settlement gates remain
authoritative. Internal policy, auction, and reconciliation variants are rejected.

## Browser gate

`npm run check:wallet-browser` bundles both the wallet entry and browser
governance protocol entry, executes them with browser-like globals, and rejects
Node crypto, buffer, process, filesystem, child-process, and network builtins,
as well as reliance on global `process` or `Buffer`.
`npm run check:package` separately installs the packed SDK without
the optional server peer and imports `ameba-sdk/wallet` under the browser
condition.
