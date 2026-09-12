import { canonicalSdkPublicKey } from "./protocol/public-key-value.js";
import { observeCurrentV3RuntimeV1 } from "./protocol/current-v3-runtime.js";
/**
 * Browser-safe RC44 wallet boundary.
 *
 * This module never signs and never treats an Edge manifest as authorization.
 * It strictly decodes the portable prepare response, re-observes every bound
 * account at finalized, reconstructs the selected operation, and emits one
 * bounded unsigned v0 transaction for the selected wallet to review/sign.
 */

import {
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  amoebaReadGatewayUrl,
  normalizeAmoebaReadGatewayUrl,
} from "./endpoint-policy.js";

import {
  CurrentWalletError,
  canonicalIndex,
  canonicalPublicKeyString,
  canonicalU64,
  encodeBase64,
  sha256Canonical,
  snapshotCanonicalJson,
  walletError,
} from "./wallet/codec.js";
import {
  decodeAndValidateCurrentWalletExpectedIntent,
  type CurrentCollectiveWalletExpectedIntent,
  type CurrentCollectiveWalletReviewedIntent,
} from "./wallet/intent.js";
import { validateAndMaterializeCollectivePlan } from "./wallet/operations.js";
import { manifestInstruction } from "./wallet/manifest.js";
import {
  CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS,
  CURRENT_WALLET_MAX_TRANSACTION_BYTES,
  CURRENT_WALLET_PROTOCOL_IDENTITY,
  reobserveCurrentWalletPlan,
  type CurrentWalletRpc,
} from "./wallet/observation.js";
import {
  decodeCollectiveOperationPrepareEnvelope,
  type CurrentCollectiveOperationKind,
  type CurrentCollectiveOperationPrepareEnvelope,
} from "./wallet/plans.js";
import { compileCurrentWalletUnsignedBatch } from "./wallet/transaction.js";
import { decodeCurrentCollectiveLookupTableV1 } from "./protocol/current-collective-lookup-table.js";
import { materializeExpiryAuthorization, type CurrentExpiryAuthorizationExpectedIntent } from "./wallet/expiry-authorization.js";

export { CurrentWalletError };
export {
  CURRENT_WALLET_MAX_OBSERVATION_AGE_SECONDS,
  CURRENT_WALLET_MAX_TRANSACTION_BYTES,
  CURRENT_WALLET_PROTOCOL_IDENTITY,
  amoebaReadGatewayUrl,
  decodeCollectiveOperationPrepareEnvelope,
};
export type {
  CurrentCollectiveOperationKind,
  CurrentCollectiveOperationPrepareEnvelope,
  CurrentCollectiveWalletExpectedIntent,
  CurrentCollectiveWalletReviewedIntent,
  CurrentWalletRpc,
};
export type { CurrentExpiryAuthorizationExpectedIntent, CurrentExpiryAuthorizationArtifact } from "./wallet/expiry-authorization.js";
export type { CurrentWalletLpCleanupRequest } from "./wallet/liquidity-cleanup.js";

/** Validates a fixed owner-signed expiry capability; never signs, submits, or refreshes its nonce. */
export async function materializeCurrentExpiryAuthorization(input: {
  readonly authorization: unknown;
  readonly expectedIntent: CurrentExpiryAuthorizationExpectedIntent;
  readonly owner: string | PublicKey;
  readonly nonceAccount: string | PublicKey;
  readonly rpc: CurrentWalletRpc;
}): Promise<{ readonly serializedTransactionBase64: string; readonly messageSha256: string }> {
  const authorization = snapshotCanonicalJson(input.authorization, "expiry authorization", 262144).value;
  const expected = snapshotCanonicalJson<CurrentExpiryAuthorizationExpectedIntent>(input.expectedIntent, "expiry intent", 64000).value;
  return materializeExpiryAuthorization(authorization, expected, canonicalOwner(input.owner),
    canonicalOwner(input.nonceAccount), snapshotCurrentWalletRpc(input.rpc));
}

/** Leave the same ten-second relay margin enforced by the current Edge. */
export const CURRENT_WALLET_OPERATION_RELAY_MARGIN_SECONDS = 10n as const;

export interface MaterializeCurrentCollectiveWalletBatchInput {
  /** The exact unmodified JSON value returned by one current prepare route. */
  readonly prepareResponse: unknown;
  /** Canonical caller-local intent captured before the prepare request. */
  readonly expectedIntent: CurrentCollectiveWalletExpectedIntent;
  /** The wallet that will review and sign. It must be the plan's sole signer. */
  readonly owner: string | PublicKey;
  /** Exactly one canonical executionInstructionBatches index. */
  readonly batchIndex: number;
  /** An injected Connection-compatible capability for Amoeba's exact `/rpc` gateway. */
  readonly rpc: CurrentWalletRpc;
}

export interface CurrentCollectiveWalletBatchBinding {
  readonly schemaVersion: 1;
  readonly operation: CurrentCollectiveOperationKind;
  readonly operationId: string;
  readonly preparedPlanDigest: string;
  readonly currentObservationDigest: string;
  readonly leanAdmissionDigest: string;
  readonly prepareResponseSha256: string;
  readonly reviewedIntent: CurrentCollectiveWalletReviewedIntent;
  readonly reviewDigest: string;
  readonly owner: string;
  readonly batchIndex: number;
  readonly actionBatchIndex: number;
  readonly reobservedFinalizedSlot: number;
  readonly rpcOrigin: string;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly messageSha256: string;
  readonly unsignedTransactionSha256: string;
}

export interface MaterializedCurrentCollectiveWalletBatch {
  /** Independently reconstructed instructions for exactly one plan batch. */
  readonly instructions: readonly TransactionInstruction[];
  /** Canonical unsigned VersionedTransaction serialization. */
  readonly unsignedTransactionBytes: Uint8Array;
  readonly unsignedTransactionBase64: string;
  readonly binding: Readonly<CurrentCollectiveWalletBatchBinding>;
  readonly bindingDigest: string;
}

/**
 * Materialize one reviewed RC44 collective operation batch for wallet signing.
 *
 * No signing capability is accepted. Callers must preserve and display the
 * returned binding alongside the bytes, then submit only the wallet-signed
 * serialization through Edge's bound submit route.
 */
export async function materializeCurrentCollectiveWalletBatch(
  input: MaterializeCurrentCollectiveWalletBatchInput,
): Promise<MaterializedCurrentCollectiveWalletBatch> {
  if (input === null || typeof input !== "object") {
    walletError("CURRENT_WALLET_INPUT_INVALID", "wallet materialization input must be an object");
  }
  // Capture every caller-controlled value exactly once and detach all JSON
  // graphs before any await. The RPC methods are likewise captured once.
  const rawPrepareResponse = input.prepareResponse;
  const rawExpectedIntent = input.expectedIntent;
  const rawOwner = input.owner;
  const rawBatchIndex = input.batchIndex;
  const rawRpc = input.rpc;
  const prepareSnapshot = snapshotCanonicalJson(
    rawPrepareResponse,
    "prepare response",
  );
  const intentSnapshot = snapshotCanonicalJson<CurrentCollectiveWalletExpectedIntent>(
    rawExpectedIntent,
    "expectedIntent",
    64_000,
  );
  const envelope = decodeCollectiveOperationPrepareEnvelope(prepareSnapshot.value);
  const owner = canonicalOwner(rawOwner);
  const batchIndex = canonicalIndex(
    rawBatchIndex,
    "batchIndex",
    envelope.operationPlan.executionInstructionBatches.length - 1,
  );
  const rpc = snapshotCurrentWalletRpc(rawRpc);
  const expectedOwner = envelope.operationPlan.operation === "collective_swap_exact_in"
    ? envelope.operationPlan.semantic.trader
    : envelope.operationPlan.semantic.owner;
  if (expectedOwner !== owner.toBase58()) {
    walletError("CURRENT_WALLET_SIGNER_INVALID", "selected wallet is not the prepared operation owner");
  }
  const review = decodeAndValidateCurrentWalletExpectedIntent(
    intentSnapshot.value,
    envelope,
  );
  // A portable manifest is never authorization, but compiling the selected
  // batch here establishes the signer and packet-size ceiling before network
  // work. The independently reconstructed batch is compiled again below.
  compileCurrentWalletUnsignedBatch(
    owner,
    PublicKey.default.toBase58(),
    envelope.operationPlan.executionInstructionBatches[batchIndex]!.map(manifestInstruction),
    envelope.operationPlan.transactionLookupTable === undefined ? [] : [decodeCurrentCollectiveLookupTableV1(
      envelope.operationPlan.transactionLookupTable, envelope.operationPlan.currentObservation).account],
  );
  const reobservation = await reobserveCurrentWalletPlan(
    rpc,
    envelope.operationPlan.currentObservation,
  );
  requireUnexpiredOperation(envelope, reobservation.observedBlockTimeUnixSeconds);
  const executionBatches = validateAndMaterializeCollectivePlan(envelope, reobservation);
  const instructions = executionBatches[batchIndex]!;

  const latest = await rpc.getLatestBlockhashAndContext({
    commitment: "finalized",
    minContextSlot: reobservation.observedSlot,
  });
  if (!latest || !Number.isSafeInteger(latest.context?.slot)
    || latest.context.slot < reobservation.observedSlot
    || typeof latest.value?.blockhash !== "string"
    || !Number.isSafeInteger(latest.value.lastValidBlockHeight)
    || latest.value.lastValidBlockHeight <= 0) {
    walletError("CURRENT_WALLET_BLOCKHASH_INVALID", "finalized latest blockhash response is malformed or regressed");
  }
  const recentBlockhash = canonicalBlockhash(latest.value.blockhash);
  const latestContextSlot = latest.context.slot;
  const lastValidBlockHeight = latest.value.lastValidBlockHeight;
  const validity = await rpc.isBlockhashValid(recentBlockhash, {
    commitment: "finalized",
    minContextSlot: latestContextSlot,
  });
  if (!validity || !Number.isSafeInteger(validity.context?.slot)
    || validity.context.slot < latestContextSlot || validity.value !== true) {
    walletError("CURRENT_WALLET_BLOCKHASH_INVALID", "finalized recent blockhash is invalid or expired");
  }

  const finalRuntime = await observeCurrentV3RuntimeV1({rpc, minimumContextSlot:Math.max(reobservation.governance.finalizedObservationSlot, validity.context.slot), requireWriteReady:true});
  if (finalRuntime.gate.epoch !== reobservation.governance.epoch) walletError("GOVERNED_INSTRUCTION_EPOCH_STALE", "governance epoch changed during wallet materialization");
  const lookupTables = envelope.operationPlan.transactionLookupTable === undefined ? [] : [decodeCurrentCollectiveLookupTableV1(
    envelope.operationPlan.transactionLookupTable, envelope.operationPlan.currentObservation, reobservation).account];
  const compiled = compileCurrentWalletUnsignedBatch(owner, recentBlockhash, instructions, lookupTables);
  const unsignedTransactionBytes = compiled.unsignedTransactionBytes;
  const binding = Object.freeze<CurrentCollectiveWalletBatchBinding>({
    schemaVersion: 1,
    operation: envelope.operationPlan.operation,
    operationId: envelope.operationPlan.operationId,
    preparedPlanDigest: envelope.operationPlan.preparedPlanDigest,
    currentObservationDigest: envelope.operationPlan.currentObservationDigest,
    leanAdmissionDigest: envelope.leanAdmissionDigest,
    prepareResponseSha256: prepareSnapshot.sha256,
    reviewedIntent: review.reviewedIntent,
    reviewDigest: review.reviewDigest,
    owner: owner.toBase58(),
    batchIndex,
    actionBatchIndex: envelope.operationPlan.actionBatchIndex,
    reobservedFinalizedSlot: reobservation.observedSlot,
    rpcOrigin: reobservation.rpcOrigin,
    recentBlockhash,
    lastValidBlockHeight,
    messageSha256: compiled.messageSha256,
    unsignedTransactionSha256: compiled.unsignedTransactionSha256,
  });
  return Object.freeze({
    instructions: Object.freeze([...instructions]),
    unsignedTransactionBytes: new Uint8Array(unsignedTransactionBytes),
    unsignedTransactionBase64: encodeBase64(unsignedTransactionBytes),
    binding,
    bindingDigest: sha256Canonical({
      domain: "ameba:current_collective_wallet_batch_binding:v1",
      binding,
    }),
  });
}

function snapshotCurrentWalletRpc(value: CurrentWalletRpc): CurrentWalletRpc {
  if (value === null || typeof value !== "object") {
    walletError("CURRENT_WALLET_RPC_INVALID", "the injected finalized RPC capability is not an object");
  }
  const target = value as CurrentWalletRpc;
  let rpcEndpoint: string;
  try {
    rpcEndpoint = normalizeAmoebaReadGatewayUrl(target.rpcEndpoint);
  } catch {
    walletError(
      "CURRENT_WALLET_RPC_INVALID",
      "wallet reads must use Amoeba's exact /rpc gateway",
    );
  }
  const getGenesisHash = rpcMethod(target, "getGenesisHash");
  const getMultipleAccountsInfoAndContext = rpcMethod(target, "getMultipleAccountsInfoAndContext");
  const getBlockTime = rpcMethod(target, "getBlockTime");
  const getLatestBlockhashAndContext = rpcMethod(target, "getLatestBlockhashAndContext");
  const isBlockhashValid = rpcMethod(target, "isBlockhashValid");
  return Object.freeze({
    rpcEndpoint,
    getGenesisHash: getGenesisHash.bind(target),
    getMultipleAccountsInfoAndContext: getMultipleAccountsInfoAndContext.bind(target),
    getBlockTime: getBlockTime.bind(target),
    getLatestBlockhashAndContext: getLatestBlockhashAndContext.bind(target),
    isBlockhashValid: isBlockhashValid.bind(target),
  }) as CurrentWalletRpc;
}

function rpcMethod(
  target: CurrentWalletRpc,
  name: keyof CurrentWalletRpc,
): (...arguments_: any[]) => any {
  const method = target[name];
  if (typeof method !== "function") {
    walletError("CURRENT_WALLET_RPC_INVALID", `the injected RPC is missing ${String(name)}`);
  }
  return method as (...arguments_: any[]) => any;
}

function canonicalOwner(value: string | PublicKey): PublicKey {
  const stringValue = typeof value === "string" ? value : canonicalSdkPublicKey(value).toBase58();
  return new PublicKey(canonicalPublicKeyString(
    stringValue,
    "owner",
    (entry) => new PublicKey(entry).toBase58(),
  ));
}

function canonicalBlockhash(value: string): string {
  try {
    const canonical = new PublicKey(value).toBase58();
    if (canonical !== value) throw new Error("noncanonical");
    return canonical;
  } catch {
    walletError("CURRENT_WALLET_BLOCKHASH_INVALID", "latest finalized blockhash is not canonical base58");
  }
}

function requireUnexpiredOperation(
  envelope: CurrentCollectiveOperationPrepareEnvelope,
  now: bigint,
): void {
  const operation = envelope.operationPlan.operation;
  let deadline: bigint | null = null;
  if (operation === "collective_swap_exact_in") {
    deadline = BigInt(canonicalU64(envelope.operationPlan.semantic.deadlineTs, "semantic.deadlineTs", true));
  } else if (operation === "close_begin") {
    deadline = BigInt(envelope.operationPlan.currentObservation.observedBlockTimeUnixSeconds!) + 120n;
  } else if (operation === "close_basket" || operation === "close_finalize") {
    deadline = BigInt(canonicalU64(
      envelope.leanAdmission.facts !== null && typeof envelope.leanAdmission.facts === "object"
        ? (envelope.leanAdmission.facts as Readonly<Record<string, unknown>>).requestDeadlineUnixSeconds
        : undefined,
      "leanAdmission.facts.requestDeadlineUnixSeconds",
      true,
    ));
  }
  if (deadline !== null && now + CURRENT_WALLET_OPERATION_RELAY_MARGIN_SECONDS >= deadline) {
    walletError("CURRENT_WALLET_PLAN_STALE", "operation deadline no longer leaves the required relay margin");
  }
}
