/** Canonical unsigned v0 transaction compilation for one reconstructed wallet batch. */
import { PublicKey, TransactionMessage, VersionedTransaction, } from "@solana/web3.js";
import { sha256Hex, walletError } from "./codec.js";
import { CURRENT_WALLET_MAX_TRANSACTION_BYTES } from "./observation.js";
export function compileCurrentWalletUnsignedBatch(owner, recentBlockhash, instructions, lookupTables = []) {
    if (instructions.length < 1 || instructions.length > 32) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "one wallet execution batch must contain 1..32 instructions");
    }
    const message = new TransactionMessage({
        payerKey: owner,
        recentBlockhash,
        instructions: [...instructions],
    }).compileToV0Message([...lookupTables]);
    if (lookupTables.length > 1 || message.addressTableLookups.length !== lookupTables.length
        || message.addressTableLookups.some((lookup, index) => !lookup.accountKey.equals(lookupTables[index].key))) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "wallet lookup table must be the one exact used prepared table");
    }
    if (message.header.numRequiredSignatures !== 1
        || message.staticAccountKeys[0]?.toBase58() !== owner.toBase58()) {
        walletError("CURRENT_WALLET_SIGNER_INVALID", "compiled transaction does not bind exactly the selected wallet signer");
    }
    const transaction = new VersionedTransaction(message);
    if (transaction.signatures.length !== 1
        || transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
        walletError("CURRENT_WALLET_SIGNER_INVALID", "materialized transaction is not canonically unsigned");
    }
    let messageBytes;
    let unsignedTransactionBytes;
    try {
        messageBytes = message.serialize();
        unsignedTransactionBytes = transaction.serialize();
    }
    catch (error) {
        if (error instanceof RangeError || (error instanceof Error && /(?:overrun|too large)/iu.test(error.message))) {
            walletError("CURRENT_WALLET_TRANSACTION_TOO_LARGE", `unsigned transaction exceeds ${CURRENT_WALLET_MAX_TRANSACTION_BYTES} bytes`);
        }
        walletError("CURRENT_WALLET_PLAN_INVALID", "unsigned transaction serialization failed closed");
    }
    if (unsignedTransactionBytes.length > CURRENT_WALLET_MAX_TRANSACTION_BYTES) {
        walletError("CURRENT_WALLET_TRANSACTION_TOO_LARGE", `unsigned transaction exceeds ${CURRENT_WALLET_MAX_TRANSACTION_BYTES} bytes`);
    }
    return Object.freeze({
        messageSha256: sha256Hex(messageBytes),
        unsignedTransactionSha256: sha256Hex(unsignedTransactionBytes),
        unsignedTransactionBytes: new Uint8Array(unsignedTransactionBytes),
    });
}
//# sourceMappingURL=transaction.js.map