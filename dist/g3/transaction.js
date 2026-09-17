import { Buffer } from "buffer";
import { VersionedTransaction } from "@solana/web3.js";
/** Browser-safe exact-message/signature check. Expected bytes must come from independent review. */
export async function validateG3SignedMessage(expected, signedTransactionBase64) {
    const decode = (value) => {
        if (typeof value !== "string" || value.length > 1644)
            throw new Error("G3 packet is oversized");
        const bytes = Buffer.from(value, "base64");
        if (!bytes.length || bytes.length > 1232 || bytes.toString("base64") !== value)
            throw new Error("G3 packet is not canonical base64");
        return VersionedTransaction.deserialize(bytes);
    };
    const prepared = decode(expected.serializedTransactionBase64), signed = decode(signedTransactionBase64);
    const message = signed.message.serialize();
    if (!Buffer.from(prepared.message.serialize()).equals(Buffer.from(message))
        || signed.message.staticAccountKeys[0]?.toBase58() !== expected.owner || signed.message.recentBlockhash !== expected.blockhash
        || signed.message.header.numRequiredSignatures !== 1 || signed.signatures.length !== 1)
        throw new Error("G3 signed transaction differs from reviewed message or owner");
    const key = await globalThis.crypto.subtle.importKey("raw", new Uint8Array(signed.message.staticAccountKeys[0].toBytes()), { name: "Ed25519" }, false, ["verify"]);
    if (!await globalThis.crypto.subtle.verify("Ed25519", key, new Uint8Array(signed.signatures[0]), new Uint8Array(message)))
        throw new Error("G3 owner signature is invalid");
    return Object.freeze({ owner: expected.owner, signatureBytes: Buffer.from(signed.signatures[0]) });
}
//# sourceMappingURL=transaction.js.map