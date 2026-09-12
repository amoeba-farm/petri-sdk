import { PublicKey } from "@solana/web3.js";

export const CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const CURRENT_FINALIZED_OBSERVATION_SOURCE = "current_finalized_rpc" as const;
export const CURRENT_FINALIZED_OBSERVATION_COMMITMENT = "finalized" as const;
export const CURRENT_FINALIZED_OBSERVATION_DIGEST_DOMAIN =
  "ameba_lean:current_finalized_observation:v1" as const;
export const CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as const;

export interface CurrentStateProviderIdentity {
  readonly kind: "solana_json_rpc";
  readonly origin: string;
  readonly originSha256: string;
  readonly genesisHash: typeof CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH;
}

export interface CurrentFinalizedObservedAccount {
  readonly address: string;
  readonly owner: string | null;
  readonly executable: boolean | null;
  readonly dataLength: string | null;
  readonly dataSha256: string | null;
}

export interface CurrentFinalizedObservation {
  readonly schemaVersion: typeof CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION;
  readonly observationSource: typeof CURRENT_FINALIZED_OBSERVATION_SOURCE;
  readonly commitment: typeof CURRENT_FINALIZED_OBSERVATION_COMMITMENT;
  readonly observedAtSlot: string;
  readonly currentFinalizedSlot: string;
  /** Null has a canonical digest encoding, but the v1 validator rejects it. */
  readonly observedBlockTimeUnixSeconds: string | null;
  readonly stateProvider: CurrentStateProviderIdentity;
  readonly orderedAccounts: readonly CurrentFinalizedObservedAccount[];
  readonly currentObservationDigest: string;
}

export type CurrentFinalizedObservationDigestInput =
  Omit<CurrentFinalizedObservation, "currentObservationDigest">
  & { readonly currentObservationDigest?: string };

export class CurrentFinalizedObservationValidationError extends Error {
  readonly code = "CURRENT_FINALIZED_OBSERVATION_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "CurrentFinalizedObservationValidationError";
  }
}

/**
 * Return Lean's exact v1 digest preimage. Object key order is irrelevant;
 * account order is authoritative and is never sorted.
 */
export function currentFinalizedObservationPreimage(
  input: CurrentFinalizedObservationDigestInput,
): Uint8Array {
  const observation = canonicalObservation(input, false, false);
  const fields: [string, string][] = [
    ["schemaVersion", "1"],
    ["observationSource", observation.observationSource],
    ["commitment", observation.commitment],
    ["observedAtSlot", observation.observedAtSlot],
    ["currentFinalizedSlot", observation.currentFinalizedSlot],
    ["observedBlockTimeUnixSeconds", observation.observedBlockTimeUnixSeconds ?? "null"],
    ["stateProvider.kind", observation.stateProvider.kind],
    ["stateProvider.origin", observation.stateProvider.origin],
    ["stateProvider.originSha256", observation.stateProvider.originSha256],
    ["stateProvider.genesisHash", observation.stateProvider.genesisHash],
    ["orderedAccountCount", observation.orderedAccounts.length.toString()],
  ];
  observation.orderedAccounts.forEach((account, index) => {
    fields.push(
      [`orderedAccounts[${index}].address`, account.address],
      [`orderedAccounts[${index}].owner`, account.owner === null ? "null" : `pubkey:${account.owner}`],
      [`orderedAccounts[${index}].executable`, account.executable === null ? "null" : String(account.executable)],
      [`orderedAccounts[${index}].dataLength`, account.dataLength ?? "null"],
      [`orderedAccounts[${index}].dataSha256`, account.dataSha256 === null ? "null" : `sha256:${account.dataSha256}`],
    );
  });
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    encoder.encode(CURRENT_FINALIZED_OBSERVATION_DIGEST_DOMAIN),
    Uint8Array.of(0),
  ];
  for (const [name, value] of fields) parts.push(netstring(name, encoder), netstring(value, encoder));
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const preimage = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    preimage.set(part, offset);
    offset += part.length;
  }
  return preimage;
}

/** Compute Lean's lowercase SHA-256 observation commitment. */
export function computeCurrentFinalizedObservationDigest(
  input: CurrentFinalizedObservationDigestInput,
): string {
  return sha256Hex(currentFinalizedObservationPreimage(input));
}

/**
 * Strictly validate the complete admitted v1 observation and return an
 * immutable canonical projection. Missing/extra keys and partial-null account
 * states are rejected, as are unavailable block times and stale slots.
 */
export function validateCurrentFinalizedObservation(
  value: unknown,
): CurrentFinalizedObservation {
  const observation = canonicalObservation(value, true, true);
  const expected = computeCurrentFinalizedObservationDigest(observation);
  if (observation.currentObservationDigest !== expected) {
    invalid("currentObservationDigest does not match the canonical v1 preimage");
  }
  return observation;
}

function canonicalObservation(
  value: unknown,
  requireDigest: boolean,
  requireAdmissibleBlockTime: boolean,
): CurrentFinalizedObservation {
  const object = exactObject(value, requireDigest
    ? [
        "schemaVersion", "observationSource", "commitment", "observedAtSlot",
        "currentFinalizedSlot", "observedBlockTimeUnixSeconds", "stateProvider",
        "orderedAccounts", "currentObservationDigest",
      ]
    : [
        "schemaVersion", "observationSource", "commitment", "observedAtSlot",
        "currentFinalizedSlot", "observedBlockTimeUnixSeconds", "stateProvider",
        "orderedAccounts",
      ], !requireDigest ? ["currentObservationDigest"] : []);
  if (object.schemaVersion !== CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION) invalid("schemaVersion must be 1");
  if (object.observationSource !== CURRENT_FINALIZED_OBSERVATION_SOURCE) invalid("observationSource is not current_finalized_rpc");
  if (object.commitment !== CURRENT_FINALIZED_OBSERVATION_COMMITMENT) invalid("commitment is not finalized");
  const observedAtSlot = positiveDecimal(object.observedAtSlot, "observedAtSlot");
  const currentFinalizedSlot = positiveDecimal(object.currentFinalizedSlot, "currentFinalizedSlot");
  if (observedAtSlot !== currentFinalizedSlot) invalid("observedAtSlot must equal currentFinalizedSlot");
  const observedBlockTimeUnixSeconds = object.observedBlockTimeUnixSeconds === null
    ? null
    : positiveDecimal(object.observedBlockTimeUnixSeconds, "observedBlockTimeUnixSeconds");
  if (requireAdmissibleBlockTime && observedBlockTimeUnixSeconds === null) {
    invalid("observedBlockTimeUnixSeconds is unavailable");
  }

  const provider = exactObject(object.stateProvider, ["kind", "origin", "originSha256", "genesisHash"]);
  if (provider.kind !== "solana_json_rpc") invalid("stateProvider.kind is not solana_json_rpc");
  const origin = canonicalProviderOrigin(provider.origin);
  const originSha256 = lowercaseSha256(provider.originSha256, "stateProvider.originSha256");
  if (originSha256 !== sha256Hex(new TextEncoder().encode(origin))) {
    invalid("stateProvider.originSha256 does not hash the exact UTF-8 origin");
  }
  if (provider.genesisHash !== CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH) {
    invalid("stateProvider.genesisHash is not the frozen RC44 Devnet genesis");
  }

  if (!Array.isArray(object.orderedAccounts)
    || object.orderedAccounts.length < 1
    || object.orderedAccounts.length > 256) {
    invalid("orderedAccounts must contain 1..256 entries");
  }
  const seen = new Set<string>();
  const orderedAccounts = object.orderedAccounts.map((entry, index): CurrentFinalizedObservedAccount => {
    const account = exactObject(entry, ["address", "owner", "executable", "dataLength", "dataSha256"]);
    const address = canonicalPubkey(account.address, `orderedAccounts[${index}].address`);
    if (seen.has(address)) invalid("orderedAccounts addresses must be unique");
    seen.add(address);
    const present = [account.owner, account.executable, account.dataLength, account.dataSha256]
      .map((field) => field !== null);
    if (!present.every((state) => state === present[0])) {
      invalid(`orderedAccounts[${index}] has a partial-null account state`);
    }
    if (!present[0]) {
      return Object.freeze({ address, owner: null, executable: null, dataLength: null, dataSha256: null });
    }
    if (typeof account.executable !== "boolean") invalid(`orderedAccounts[${index}].executable must be boolean`);
    return Object.freeze({
      address,
      owner: canonicalPubkey(account.owner, `orderedAccounts[${index}].owner`),
      executable: account.executable,
      dataLength: unsignedDecimal(account.dataLength, `orderedAccounts[${index}].dataLength`),
      dataSha256: lowercaseSha256(account.dataSha256, `orderedAccounts[${index}].dataSha256`),
    });
  });
  const currentObservationDigest = requireDigest
    ? lowercaseSha256(object.currentObservationDigest, "currentObservationDigest")
    : typeof object.currentObservationDigest === "string" && object.currentObservationDigest.length > 0
      ? lowercaseSha256(object.currentObservationDigest, "currentObservationDigest")
      : "";
  return Object.freeze({
    schemaVersion: CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION,
    observationSource: CURRENT_FINALIZED_OBSERVATION_SOURCE,
    commitment: CURRENT_FINALIZED_OBSERVATION_COMMITMENT,
    observedAtSlot,
    currentFinalizedSlot,
    observedBlockTimeUnixSeconds,
    stateProvider: Object.freeze({
      kind: "solana_json_rpc",
      origin,
      originSha256,
      genesisHash: CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH,
    }),
    orderedAccounts: Object.freeze(orderedAccounts),
    currentObservationDigest,
  });
}

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("observation value is not an object");
  const object = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) if (!allowed.has(key)) invalid(`unexpected key ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(object, key)) invalid(`missing key ${key}`);
  return object;
}

function canonicalProviderOrigin(value: unknown): string {
  if (typeof value !== "string") invalid("stateProvider.origin must be a string");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid("stateProvider.origin is not a WHATWG URL origin");
  }
  const authority = /^https:\/\/([a-z0-9.-]+)(?::([0-9]+))?$/u.exec(value);
  const port = authority?.[2];
  if (
    parsed.protocol !== "https:"
    || parsed.origin !== value
    || authority === null
    || (port !== undefined && (
      !/^[1-9][0-9]*$/u.test(port)
      || Number(port) > 65_535
      || Number(port) === 443
      || Number(port).toString() !== port
    ))
  ) {
    invalid("stateProvider.origin is not the canonical non-secret HTTPS v1 origin");
  }
  return value;
}

function canonicalPubkey(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string`);
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) invalid(`${label} is not canonical Base58`);
    return value;
  } catch (cause) {
    if (cause instanceof CurrentFinalizedObservationValidationError) throw cause;
    invalid(`${label} is not a Solana public key`);
  }
}

function positiveDecimal(value: unknown, label: string): string {
  const encoded = unsignedDecimal(value, label);
  if (encoded === "0") invalid(`${label} must be positive`);
  return encoded;
}

function unsignedDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    invalid(`${label} is not a canonical unsigned decimal string`);
  }
  return value;
}

function lowercaseSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) invalid(`${label} is not a lowercase SHA-256 digest`);
  return value;
}

function netstring(value: string, encoder: TextEncoder): Uint8Array {
  const bytes = encoder.encode(value);
  const prefix = encoder.encode(`${bytes.length}:`);
  const result = new Uint8Array(prefix.length + bytes.length + 1);
  result.set(prefix, 0);
  result.set(bytes, prefix.length);
  result[result.length - 1] = 0x2c;
  return result;
}

function invalid(message: string): never {
  throw new CurrentFinalizedObservationValidationError(message);
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

function sha256Hex(bytes: Uint8Array): string {
  const byteLength = bytes.length;
  const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
  const input = new Uint8Array(paddedLength);
  input.set(bytes);
  input[byteLength] = 0x80;
  const bitLength = BigInt(byteLength) * 8n;
  for (let index = 0; index < 8; index += 1) input[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotate = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));
  for (let block = 0; block < input.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = block + index * 4;
      words[index] = ((input[offset]! << 24) | (input[offset + 1]! << 16) | (input[offset + 2]! << 8) | input[offset + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15]!, 7) ^ rotate(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rotate(words[index - 2]!, 17) ^ rotate(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = hash[0]!; let b = hash[1]!; let c = hash[2]!; let d = hash[3]!;
    let e = hash[4]!; let f = hash[5]!; let g = hash[6]!; let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sigma1 + choice + SHA256_K[index]! + words[index]!) >>> 0;
      const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0; hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0; hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0; hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0; hash[7] = (hash[7]! + h) >>> 0;
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
