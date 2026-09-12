import { PublicKey } from "@solana/web3.js";
/** Canonical value conversion across independently installed web3.js copies. */
export function canonicalSdkPublicKey(value) {
    if (typeof value === "string") {
        const key = new PublicKey(value);
        if (key.toBase58() !== value)
            throw new TypeError("noncanonical public key");
        return key;
    }
    if (value === null || typeof value !== "object")
        throw new TypeError("public key required");
    const candidate = value;
    const toBytes = candidate.toBytes, toBase58 = candidate.toBase58;
    if (typeof toBytes !== "function" || typeof toBase58 !== "function")
        throw new TypeError("public key methods required");
    const bytes = Reflect.apply(toBytes, value, []);
    const encoded = Reflect.apply(toBase58, value, []);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 32 || typeof encoded !== "string")
        throw new TypeError("public key shape invalid");
    const key = new PublicKey(Uint8Array.from(bytes));
    if (key.toBase58() !== encoded)
        throw new TypeError("public key bytes and encoding differ");
    return key;
}
export function isSdkPublicKey(value) {
    if (typeof value === "string")
        return false;
    try {
        canonicalSdkPublicKey(value);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=public-key-value.js.map