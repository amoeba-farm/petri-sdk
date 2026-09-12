/** Credential-free native verification transport. No helper is built or downloaded implicitly. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";

export const CURRENT_COMPRESSED_EVIDENCE_SCHEMA = "ameba-compressed-evidence-v1" as const;
export interface CurrentCompressedEvidenceVerifierConfiguration {
  /** Deployment-owned absolute executable path; never supplied by a provider or request. */
  readonly executablePath: string;
  /** Actual qualified artifact digest. No default/placeholder binary hash is admitted. */
  readonly executableSha256: string;
  readonly timeoutMs?: number;
}
export interface CurrentCompressedEvidenceStatement {
  readonly kind: "state_merkle" | "state_queue" | "address_absent";
  readonly treeKeyHex: string; readonly queueKeyHex?: string; readonly valueHex: string;
  readonly leafIndex?: string; readonly rootHex?: string; readonly rootIndex?: number; readonly proofHex?: string;
}
export interface CurrentCompressedEvidenceAccount {
  readonly keyHex: string; readonly ownerHex: string; readonly executable: boolean; readonly dataHex: string;
}
export interface CurrentCompressedEvidenceIdentity {
  readonly programIdHex: string; readonly addressTreeKeyHex: string; readonly canonicalPdaHex: string; readonly domain: number;
}
export interface CurrentCompressedEvidenceLeafAccount {
  readonly ownerHex: string; readonly addressHex: string; readonly lamports: string;
  readonly discriminatorHex: string; readonly dataHex: string; readonly dataHashHex: string;
}
export interface CurrentCompressedEvidenceRequest {
  readonly schema: typeof CURRENT_COMPRESSED_EVIDENCE_SCHEMA;
  readonly finalizedSlot: string; readonly minimumSlot: string; readonly contextBindingHex: string;
  readonly identity: CurrentCompressedEvidenceIdentity;
  readonly compressedAccount?: CurrentCompressedEvidenceLeafAccount;
  readonly statement: CurrentCompressedEvidenceStatement;
  readonly accounts: readonly CurrentCompressedEvidenceAccount[];
}
export interface CurrentCompressedEvidenceResult {
  readonly schema: typeof CURRENT_COMPRESSED_EVIDENCE_SCHEMA;
  readonly requestSha256: string; readonly contextBindingHex: string; readonly finalizedSlot: string;
  readonly kind: CurrentCompressedEvidenceStatement["kind"]; readonly valueHex: string;
  readonly compressedAddressHex: string; readonly dataHashHex: string | null;
  readonly treeKeyHex: string; readonly queueKeyHex: string | null;
  readonly rootHex: string | null; readonly rootIndex: number | null;
  readonly verification: "groth16_current_root_and_bloom" | "queue_inclusion_and_bloom";
}
export interface CurrentCompressedEvidenceVerifier {
  readonly executableSha256: string;
  verify(request: CurrentCompressedEvidenceRequest): Promise<CurrentCompressedEvidenceResult>;
}
const issued = new WeakSet<object>();
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const hex32 = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function u64(value: unknown): value is string { return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n; }
function reject(message: string): never { throw new Error(`CURRENT_COMPRESSED_EVIDENCE_INVALID: ${message}`); }
function keys(value: object, expected: readonly string[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) reject("unexpected JSON fields");
}
export function requireCurrentCompressedEvidenceVerifier(value: CurrentCompressedEvidenceVerifier): void {
  if (!issued.has(value)) reject("verifier was not issued from a trusted executable configuration");
}
export function validateCurrentCompressedEvidenceRequest(request: CurrentCompressedEvidenceRequest): void {
  keys(request, ["schema", "finalizedSlot", "minimumSlot", "contextBindingHex", "identity", "statement", "accounts", ...(request.statement?.kind !== "address_absent" ? ["compressedAccount"] : [])]);
  if (request.schema !== CURRENT_COMPRESSED_EVIDENCE_SCHEMA || !u64(request.finalizedSlot) || !u64(request.minimumSlot)
    || BigInt(request.finalizedSlot) < BigInt(request.minimumSlot) || !hex32(request.contextBindingHex)) reject("invalid request identity/slot");
  const identity = request.identity;
  if (!identity || !hex32(identity.programIdHex) || !hex32(identity.addressTreeKeyHex) || !hex32(identity.canonicalPdaHex) || !Number.isInteger(identity.domain) || identity.domain < 1 || identity.domain > 10) reject("invalid compressed identity");
  keys(identity, ["programIdHex", "addressTreeKeyHex", "canonicalPdaHex", "domain"]);
  const statement = request.statement;
  if (!statement || !["state_merkle", "state_queue", "address_absent"].includes(statement.kind)
    || !hex32(statement.treeKeyHex) || !hex32(statement.valueHex)) reject("invalid proof statement");
  const state = statement.kind !== "address_absent"; const proof = statement.kind !== "state_queue";
  keys(statement, ["kind", "treeKeyHex", "valueHex", ...(state ? ["queueKeyHex", "leafIndex"] : []), ...(proof ? ["rootHex", "rootIndex", "proofHex"] : [])]);
  if (state && (!hex32(statement.queueKeyHex) || !u64(statement.leafIndex) || BigInt(statement.leafIndex) > 4_294_967_295n)) reject("invalid state queue/index");
  if (proof && (!hex32(statement.rootHex) || !Number.isInteger(statement.rootIndex) || statement.rootIndex! < 0 || statement.rootIndex! > 65_535
    || typeof statement.proofHex !== "string" || !/^[0-9a-f]{256}$/.test(statement.proofHex))) reject("invalid proof/root");
  if (state) {
    const account = request.compressedAccount;
    if (!account || account.ownerHex !== identity.programIdHex || !hex32(account.addressHex) || account.lamports !== "0"
      || !/^[0-9a-f]{16}$/.test(account.discriminatorHex) || !hex32(account.dataHashHex)
      || typeof account.dataHex !== "string" || account.dataHex.length > 131_072 || !/^(?:[0-9a-f]{2})+$/.test(account.dataHex)) reject("invalid compressed account envelope");
    keys(account, ["ownerHex", "addressHex", "lamports", "discriminatorHex", "dataHex", "dataHashHex"]);
    const data = Buffer.from(account.dataHex, "hex");
    const dataHash = createHash("sha256").update(data).digest(); dataHash[0] = 0;
    if (dataHash.toString("hex") !== account.dataHashHex || account.discriminatorHex !== hash("CompressedAmebaStateLeaf").slice(0, 16)
      || data.length < 46 || data[0] !== 1 || data[1] !== identity.domain || data.subarray(2, 34).toString("hex") !== identity.canonicalPdaHex
      || data.readUInt32LE(42) !== data.length - 46) reject("compressed data hash/domain/PDA binding failed");
  }
  const accountKeys = state ? [statement.treeKeyHex, statement.queueKeyHex!] : [statement.treeKeyHex];
  if (!Array.isArray(request.accounts) || request.accounts.length !== accountKeys.length || new Set(accountKeys).size !== accountKeys.length) reject("invalid account inventory");
  request.accounts.forEach((account, index) => {
    keys(account, ["keyHex", "ownerHex", "executable", "dataHex"]);
    if (account.keyHex !== accountKeys[index] || !hex32(account.ownerHex) || account.executable !== false
      || typeof account.dataHex !== "string" || account.dataHex.length > 32 * 1024 * 1024 || !/^(?:[0-9a-f]{2})+$/.test(account.dataHex)) reject("invalid raw account snapshot");
  });
}
export async function createCurrentCompressedEvidenceVerifier(configuration: CurrentCompressedEvidenceVerifierConfiguration): Promise<CurrentCompressedEvidenceVerifier> {
  const configuredPath = configuration.executablePath;
  const expectedSha256 = configuration.executableSha256;
  const timeoutMs = configuration.timeoutMs ?? 30_000;
  if (!isAbsolute(configuredPath) || !hex32(expectedSha256)) reject("trusted absolute executable and actual SHA256 required");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) reject("timeout outside 100..60000ms");
  const executablePath = await realpath(configuredPath);
  async function attest(): Promise<void> {
    const info = await stat(executablePath);
    if (!info.isFile() || info.size < 1 || info.size > 128 * 1024 * 1024) reject("invalid verifier executable size/type");
    if (hash(await readFile(executablePath)) !== expectedSha256) reject("verifier executable digest mismatch");
  }
  await attest();
  const verifier: CurrentCompressedEvidenceVerifier = Object.freeze({ executableSha256: expectedSha256,
    async verify(value: CurrentCompressedEvidenceRequest): Promise<CurrentCompressedEvidenceResult> {
      // Snapshot caller-owned fields before any await; exact stdin bytes are independently committed.
      const encoded = Buffer.from(JSON.stringify(value), "utf8");
      if (encoded.length > 64 * 1024 * 1024) reject("request exceeds 64MiB");
      const request = JSON.parse(encoded.toString("utf8")) as CurrentCompressedEvidenceRequest;
      validateCurrentCompressedEvidenceRequest(request);
      await attest();
      const stdout = await new Promise<Buffer>((resolve, rejectPromise) => {
        const env: NodeJS.ProcessEnv = {};
        if (process.platform === "win32") for (const name of ["SystemRoot", "WINDIR"]) if (process.env[name]) env[name] = process.env[name];
        const child = spawn(executablePath, [], { shell: false, windowsHide: true, cwd: dirname(executablePath), env, stdio: ["pipe", "pipe", "pipe"] });
        const chunks: Buffer[] = []; let bytes = 0; let errorBytes = 0; let settled = false;
        const fail = () => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); rejectPromise(new Error("CURRENT_COMPRESSED_EVIDENCE_VERIFIER_FAILED: bounded native verification failed")); };
        const timer = setTimeout(fail, timeoutMs);
        child.once("error", fail); child.stdin.once("error", fail);
        child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16_384) fail(); else chunks.push(chunk); });
        child.stderr.on("data", (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 16_384) fail(); });
        child.once("close", code => { if (settled) return; if (code !== 0) return fail(); settled = true; clearTimeout(timer); resolve(Buffer.concat(chunks)); });
        child.stdin.end(encoded);
      });
      let result: CurrentCompressedEvidenceResult;
      try { result = JSON.parse(stdout.toString("utf8")) as CurrentCompressedEvidenceResult; } catch { return reject("native result is not JSON"); }
      if (!result || typeof result !== "object" || Array.isArray(result)) reject("native result is not an object");
      keys(result, ["schema", "requestSha256", "contextBindingHex", "finalizedSlot", "kind", "valueHex", "compressedAddressHex", "dataHashHex", "treeKeyHex", "queueKeyHex", "rootHex", "rootIndex", "verification"]);
      const statement = request.statement;
      if (result.schema !== request.schema || result.requestSha256 !== hash(encoded) || result.contextBindingHex !== request.contextBindingHex
        || result.finalizedSlot !== request.finalizedSlot || result.kind !== statement.kind || result.valueHex !== statement.valueHex
        || result.compressedAddressHex !== (request.compressedAccount?.addressHex ?? statement.valueHex)
        || result.dataHashHex !== (request.compressedAccount?.dataHashHex ?? null)
        || result.treeKeyHex !== statement.treeKeyHex || result.queueKeyHex !== (statement.queueKeyHex ?? null)
        || result.rootHex !== (statement.rootHex ?? null) || result.rootIndex !== (statement.rootIndex ?? null)
        || result.verification !== (statement.kind === "state_queue" ? "queue_inclusion_and_bloom" : "groth16_current_root_and_bloom")) reject("native result does not bind exact request");
      return Object.freeze(result);
    },
  });
  issued.add(verifier); return verifier;
}

/** Locate and fingerprint packaged native source without building, installing or executing it. */
export async function readCurrentCompressedEvidenceVerifierSource() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@amoeba/spread-release-tools/compressed-evidence-verifier-source");
  const root = dirname(manifestPath);
  const bytes = await readFile(manifestPath);
  if (bytes.length > 16_384) reject("source locator exceeds bound");
  const manifest = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  keys(manifest, ["schemaVersion", "interfaceSchema", "packageName", "packageVersion", "manifest", "lockfile", "sources", "interface", "binaryName", "artifactStatus", "lockProvenance"]);
  if (manifest.schemaVersion !== 1 || manifest.interfaceSchema !== CURRENT_COMPRESSED_EVIDENCE_SCHEMA
    || manifest.packageName !== "ameba-current-compressed-evidence-verifier" || manifest.packageVersion !== "0.1.0"
    || manifest.binaryName !== "ameba-current-compressed-evidence-verifier" || manifest.manifest !== "Cargo.toml"
    || manifest.lockfile !== "Cargo.lock" || manifest.interface !== "INTERFACE.md"
    || JSON.stringify(manifest.sources) !== '["src/main.rs"]' || manifest.artifactStatus !== "source-only-unqualified"
    || typeof manifest.lockProvenance !== "string") reject("native source locator differs from agreed package contract");
  const files = [];
  for (const relativePath of ["source.json", "Cargo.toml", "Cargo.lock", "INTERFACE.md", "src/main.rs"]) {
    const path = join(root, relativePath); const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > 4 * 1024 * 1024) reject("native source file is absent or oversized");
    files.push(Object.freeze({ relativePath, path, sha256: hash(await readFile(path)) }));
  }
  return Object.freeze({ root, manifest: Object.freeze(manifest), files: Object.freeze(files), artifactStatus: "source-only-unqualified" as const });
}
