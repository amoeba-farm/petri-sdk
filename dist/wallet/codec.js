/** Browser-native canonical codecs used by the fail-closed wallet boundary. */
export class CurrentWalletError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "CurrentWalletError";
        this.code = code;
    }
}
export function walletError(code, message) {
    throw new CurrentWalletError(code, message);
}
export function exactObject(value, required, optional = [], label = "value") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} must be an object`);
    }
    const record = value;
    const allowed = new Set([...required, ...optional]);
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
            walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} contains unexpected key ${key}`);
        }
    }
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is missing ${key}`);
        }
    }
    return record;
}
export function exactArray(value, label, minimum, maximum) {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} must contain ${minimum}..${maximum} entries`);
    }
    return value;
}
export function canonicalPublicKeyString(value, label, parse) {
    if (typeof value !== "string") {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} must be a public key string`);
    }
    try {
        const canonical = parse(value);
        if (canonical !== value)
            throw new Error("noncanonical");
        return canonical;
    }
    catch {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is not a canonical Solana public key`);
    }
}
export function canonicalDigest(value, label) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} must be a lowercase SHA-256 digest`);
    }
    return value;
}
export function canonicalU64(value, label, positive = false) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} must be a canonical u64 string`);
    }
    const parsed = BigInt(value);
    if (parsed > 0xffffffffffffffffn || (positive && parsed === 0n)) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is outside the admitted u64 range`);
    }
    return value;
}
export function canonicalIndex(value, label, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is outside the admitted integer range`);
    }
    return value;
}
export function decodeBase64(value, label, maximumBytes = 16_384) {
    if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumBytes / 3) * 4) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is not bounded canonical base64`);
    }
    let binary;
    try {
        binary = globalThis.atob(value);
    }
    catch {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is not base64`);
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length === 0 || bytes.length > maximumBytes || encodeBase64(bytes) !== value) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label} is not canonical base64`);
    }
    return bytes;
}
export function encodeBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return globalThis.btoa(binary);
}
export function equalBytes(left, right) {
    if (left.length !== right.length)
        return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}
export function readU16Le(bytes, offset) {
    requireRead(bytes, offset, 2);
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}
export function readU32Le(bytes, offset) {
    requireRead(bytes, offset, 4);
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
export function readU64Le(bytes, offset) {
    requireRead(bytes, offset, 8);
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
}
export function u64Le(value) {
    if (value < 0n || value > 0xffffffffffffffffn) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "u64 value is outside the admitted range");
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    return bytes;
}
export function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value, new WeakSet(), 0, { nodes: 0 }));
}
export function sha256Canonical(value) {
    return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}
/** Copy caller-owned JSON into a deeply frozen canonical graph before async work. */
export function snapshotCanonicalJson(value, label, maximumCharacters = 4_000_000) {
    const serialized = canonicalJson(value);
    if (serialized.length > maximumCharacters) {
        walletError("CURRENT_WALLET_INPUT_INVALID", `${label} exceeds the canonical snapshot limit`);
    }
    const owned = deepFreezeCanonical(JSON.parse(serialized));
    return Object.freeze({
        value: owned,
        canonicalJson: serialized,
        sha256: sha256Hex(new TextEncoder().encode(serialized)),
    });
}
function canonicalValue(value, ancestors, depth, budget) {
    budget.nodes += 1;
    if (depth > 128 || budget.nodes > 250_000) {
        walletError("CURRENT_WALLET_RESPONSE_INVALID", "canonical JSON exceeds its structural limit");
    }
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            walletError("CURRENT_WALLET_RESPONSE_INVALID", "canonical JSON contains a non-integer number");
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (ancestors.has(value))
            walletError("CURRENT_WALLET_RESPONSE_INVALID", "canonical JSON contains a cycle");
        ancestors.add(value);
        const result = value.map((entry) => canonicalValue(entry, ancestors, depth + 1, budget));
        ancestors.delete(value);
        return result;
    }
    if (typeof value === "object") {
        const record = value;
        if (ancestors.has(record))
            walletError("CURRENT_WALLET_RESPONSE_INVALID", "canonical JSON contains a cycle");
        ancestors.add(record);
        const result = Object.fromEntries(Object.keys(record).sort()
            .map((key) => [key, canonicalValue(record[key], ancestors, depth + 1, budget)]));
        ancestors.delete(record);
        return result;
    }
    walletError("CURRENT_WALLET_RESPONSE_INVALID", "canonical JSON contains an unsupported value");
}
function deepFreezeCanonical(value) {
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value)) {
        value.forEach(deepFreezeCanonical);
        return Object.freeze(value);
    }
    Object.values(value).forEach(deepFreezeCanonical);
    return Object.freeze(value);
}
function requireRead(bytes, offset, length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > bytes.length) {
        walletError("CURRENT_WALLET_PLAN_INVALID", "instruction payload is truncated");
    }
}
/** Small synchronous SHA-256 implementation shared by browser validation and observation hashing. */
export function sha256Hex(bytes) {
    const constants = SHA256_K;
    const byteLength = bytes.length;
    const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
    const input = new Uint8Array(paddedLength);
    input.set(bytes);
    input[byteLength] = 0x80;
    const bitLength = BigInt(byteLength) * 8n;
    for (let index = 0; index < 8; index += 1) {
        input[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
    }
    const hash = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);
    const rotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    for (let block = 0; block < input.length; block += 64) {
        for (let index = 0; index < 16; index += 1) {
            const offset = block + index * 4;
            words[index] = ((input[offset] << 24) | (input[offset + 1] << 16)
                | (input[offset + 2] << 8) | input[offset + 3]) >>> 0;
        }
        for (let index = 16; index < 64; index += 1) {
            const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18)
                ^ (words[index - 15] >>> 3);
            const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19)
                ^ (words[index - 2] >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }
        let a = hash[0];
        let b = hash[1];
        let c = hash[2];
        let d = hash[3];
        let e = hash[4];
        let f = hash[5];
        let g = hash[6];
        let h = hash[7];
        for (let index = 0; index < 64; index += 1) {
            const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 = (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
            const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sigma0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    const output = new Uint8Array(32);
    hash.forEach((word, index) => {
        output[index * 4] = word >>> 24;
        output[index * 4 + 1] = word >>> 16;
        output[index * 4 + 2] = word >>> 8;
        output[index * 4 + 3] = word;
    });
    return Array.from(output, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const SHA256_K = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
//# sourceMappingURL=codec.js.map