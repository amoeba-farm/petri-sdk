/** Exact browser-native durable nonce wrapping of reviewed long claims and LP cleanup. */
import { NonceAccount, PublicKey, SystemProgram } from "@solana/web3.js";
import { canonicalJson, canonicalU64, encodeBase64, exactObject, readU32Le, walletError } from "./codec.js";
import { decodeAndValidateCurrentWalletExpectedIntent } from "./intent.js";
import { validateWalletLpCleanup } from "./liquidity-cleanup.js";
import { validateAndMaterializeCollectivePlan } from "./operations.js";
import { reobserveCurrentWalletPlan } from "./observation.js";
import { decodeCollectiveOperationPrepareEnvelope } from "./plans.js";
import { compileCurrentWalletUnsignedBatch } from "./transaction.js";
import { decodeWalletWriterSleeve } from "./writer-accounts.js";
export async function materializeExpiryAuthorization(authorization, expected, owner, nonceAddress, rpc) {
    const value = exactObject(authorization, ["kind", "owner", "nonceAccount", "durableNonce", "expiryUnixSeconds",
        "sourcePlan", "sourceEnvelope", "serializedTransactionBase64", "messageSha256"], [], "expiry authorization");
    if (value.kind !== expected.kind || value.owner !== owner.toBase58() || value.nonceAccount !== nonceAddress.toBase58()) {
        walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "authorization differs from the selected owner, kind, or nonce account");
    }
    let observation;
    let envelope;
    if (expected.kind === "long_claim") {
        exactObject(expected, ["kind", "request"]);
        envelope = decodeCollectiveOperationPrepareEnvelope(value.sourceEnvelope);
        if (envelope.operationPlan.operation !== "settlement_claim_collective" ||
            canonicalJson(envelope.operationPlan.raw) !== canonicalJson(value.sourcePlan)) {
            walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "long authorization source plans differ");
        }
        decodeAndValidateCurrentWalletExpectedIntent(expected.request, envelope);
        if (expected.request.owner !== owner.toBase58())
            walletError("CURRENT_WALLET_SIGNER_INVALID", "long owner changed");
        observation = envelope.operationPlan.currentObservation;
    }
    else {
        exactObject(expected, ["kind", "request", "market", "position"]);
        if (value.sourceEnvelope !== null || !value.sourcePlan || typeof value.sourcePlan !== "object") {
            walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "LP authorization source envelope is invalid");
        }
        observation = value.sourcePlan.currentObservation;
    }
    const fresh = await reobserveCurrentWalletPlan(rpc, observation);
    let instructions, expiryTs;
    if (expected.kind === "long_claim" && envelope) {
        const batches = validateAndMaterializeCollectivePlan(envelope, fresh);
        if (batches.length !== 1)
            walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "long authorization needs one batch");
        instructions = batches[0];
        expiryTs = decodeWalletWriterSleeve(new PublicKey(expected.request.sleeve), fresh.accountInfos).expiryTs;
    }
    else if (expected.kind === "lp_cleanup") {
        const cleanup = validateWalletLpCleanup(value.sourcePlan, expected.request, expected.market, expected.position, owner, fresh);
        instructions = cleanup.instructions;
        expiryTs = cleanup.expiryTs;
    }
    else
        walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "authorization kind is invalid");
    if (canonicalU64(value.expiryUnixSeconds, "expiry", true) !== expiryTs.toString()) {
        walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "authorization expiry differs from the finalized target");
    }
    const response = await rpc.getMultipleAccountsInfoAndContext([nonceAddress], {
        commitment: "finalized", minContextSlot: fresh.observedSlot,
    });
    const info = response.value?.[0];
    if (!Number.isSafeInteger(response.context?.slot) || response.context.slot < fresh.observedSlot ||
        response.value.length !== 1 || !info || info.executable || !info.owner.equals(SystemProgram.programId) ||
        info.data.length !== 80 || readU32Le(info.data, 0) > 1 || readU32Le(info.data, 4) !== 1) {
        walletError("CURRENT_WALLET_NONCE_INVALID", "nonce account is absent, stale, or not initialized");
    }
    const nonce = NonceAccount.fromAccountData(info.data);
    if (!nonce.authorizedPubkey.equals(owner) || nonce.nonce !== value.durableNonce) {
        walletError("CURRENT_WALLET_NONCE_INVALID", "nonce authority or durable nonce changed");
    }
    const compiled = compileCurrentWalletUnsignedBatch(owner, nonce.nonce, [
        SystemProgram.nonceAdvance({ noncePubkey: nonceAddress, authorizedPubkey: owner }), ...instructions,
    ]);
    const serializedTransactionBase64 = encodeBase64(compiled.unsignedTransactionBytes);
    if (serializedTransactionBase64 !== value.serializedTransactionBase64 || compiled.messageSha256 !== value.messageSha256) {
        walletError("CURRENT_WALLET_AUTHORIZATION_MISMATCH", "nonce transaction differs from independently reconstructed instructions");
    }
    return Object.freeze({ serializedTransactionBase64, messageSha256: compiled.messageSha256 });
}
//# sourceMappingURL=expiry-authorization.js.map