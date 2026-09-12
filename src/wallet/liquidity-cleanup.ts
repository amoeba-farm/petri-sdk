/** Browser-native review of an exact manager-owned full position cleanup. No signing or submission. */
import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction, type AccountInfo } from "@solana/web3.js";
import { inspectGovernedInstructionEnvelopeV1 } from "../protocol/governance.js";
import { currentGovernedWriteReleaseV1 } from "../protocol/current-governed-release-internal.js";
import { canonicalIndex, canonicalJson, canonicalU64, decodeBase64, equalBytes, exactArray,
  exactObject, readU16Le, readU32Le, readU64Le, sha256Hex, u64Le, walletError } from "./codec.js";
import { CURRENT_PROGRAM_ID, LIGHT_TOKEN_CPI_AUTHORITY, LIGHT_TOKEN_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID, deriveDlmmAuthority, deriveDlmmBinPage, deriveDlmmPool, deriveLightAta,
  deriveLightSplInterface, pubkey, requireExactInstruction } from "./manifest.js";
import { decodeCurrentWalletDlmmPage, decodeCurrentWalletDlmmPool } from "./swap-accounts.js";
import type { CurrentWalletReobservation } from "./observation.js";

export interface CurrentWalletLpCleanupRequest {
  readonly action: "close_position";
  readonly ownerPubkey: string;
  readonly marketId: string;
  readonly expiryId: string;
  readonly positionNonce: string;
  readonly entries: readonly { readonly binId: number; readonly shares: string;
    readonly minimumOptionOut: string; readonly minimumQuoteOut: string }[];
}

const TEXT = new TextEncoder();
function invalid(message: string): never { return walletError("CURRENT_WALLET_CLEANUP_INVALID", message); }
function uint(value: string | number, width: number): Uint8Array {
  let remaining = BigInt(value);
  if (remaining < 0n) invalid("cleanup integers cannot be negative");
  const bytes = new Uint8Array(width);
  for (let i = 0; i < width; i += 1) { bytes[i] = Number(remaining & 255n); remaining >>= 8n; }
  if (remaining !== 0n) invalid("cleanup integer exceeds its wire bound");
  return bytes;
}
function derive(seed: string, ...parts: readonly Uint8Array[]): readonly [PublicKey, number] {
  return PublicKey.findProgramAddressSync([TEXT.encode("ameba-spread-v2"), TEXT.encode(seed), ...parts], CURRENT_PROGRAM_ID);
}
function account(accounts: ReadonlyMap<string, AccountInfo<Uint8Array> | null>, address: PublicKey,
  length: number, outer: string, inner: string, bump: number): Uint8Array {
  const value = accounts.get(address.toBase58());
  if (!value || value.executable || !value.owner.equals(CURRENT_PROGRAM_ID) || value.data.length !== length ||
      !equalBytes(value.data.slice(0, 8), TEXT.encode(outer)) || value.data[8] !== 1 || value.data[9] !== bump ||
      !equalBytes(value.data.slice(10, 13), TEXT.encode(inner)) || value.data[13] !== 1) invalid("cleanup account identity is invalid");
  return value.data;
}
function instruction(value: unknown): TransactionInstruction {
  const row = exactObject(value, ["programId", "dataBase64", "accounts", "decodedParams"], [], "cleanup instruction");
  return new TransactionInstruction({ programId: pubkey(row.programId, "programId"),
    data: Buffer.from(decodeBase64(row.dataBase64, "instruction bytes", 1232)),
    keys: exactArray(row.accounts, "instruction accounts", 0, 64).map((raw) => {
      const meta = exactObject(raw, ["pubkey", "isSigner", "isWritable"]);
      if (typeof meta.isSigner !== "boolean" || typeof meta.isWritable !== "boolean") invalid("cleanup flags are invalid");
      return { pubkey: pubkey(meta.pubkey, "account"), isSigner: meta.isSigner, isWritable: meta.isWritable };
    }) });
}

export function validateWalletLpCleanup(raw: unknown, request: CurrentWalletLpCleanupRequest,
  expectedMarket: string, expectedPosition: string, owner: PublicKey, fresh: CurrentWalletReobservation):
  { readonly instructions: readonly TransactionInstruction[]; readonly expiryTs: bigint } {
  const plan = exactObject(raw, ["schemaVersion", "stateNamespace", "operation", "operationId", "request",
    "currentObservation", "currentObservationDigest", "leanAdmissionDigest", "liquidity", "instructions",
    "setupInstructionBatches", "setupTransactions", "writeSet", "signerRoles", "proofFacts", "transaction", "preparedPlanDigest"]);
  if (plan.schemaVersion !== 1 || plan.stateNamespace !== "ameba-spread-v2" || plan.operation !== "amoeba_dlmm_liquidity" ||
      canonicalJson(plan.request) !== canonicalJson(request) || request.action !== "close_position" ||
      request.ownerPubkey !== owner.toBase58()) invalid("cleanup does not match the locally reviewed intent");
  exactObject(request, ["action", "ownerPubkey", "marketId", "expiryId", "positionNonce", "entries"]);
  const { preparedPlanDigest, operationId, ...bound } = plan;
  const digest = (domain: string, value: unknown) => sha256Hex(TEXT.encode(domain + canonicalJson(value)));
  if (operationId !== digest("ameba:current_liquidity_operation:v1\0", bound) ||
      preparedPlanDigest !== digest("ameba-spread-v2/current-prepared-plan-v1\0amoeba_dlmm_liquidity\0", { ...bound, operationId })) {
    invalid("cleanup plan digest is inconsistent");
  }
  const liquidity = exactObject(plan.liquidity, ["marketId", "expiryId", "ownerPubkey", "market", "pool",
    "position", "optionMint", "quoteMint", "pageIndices"]);
  const market = pubkey(expectedMarket, "reviewed market");
  const poolAddress = deriveDlmmPool(market);
  const pool = decodeCurrentWalletDlmmPool(poolAddress, fresh.accountInfos);
  const nonce = canonicalU64(request.positionNonce, "position nonce");
  const [position, positionBump] = derive("ameba-dlmm-position-v1", poolAddress.toBytes(), owner.toBytes(), u64Le(BigInt(nonce)));
  if (!position.equals(pubkey(expectedPosition, "reviewed position")) || !pool.liquidityManager.equals(owner) ||
      liquidity.market !== market.toBase58() || liquidity.pool !== poolAddress.toBase58() ||
      liquidity.position !== position.toBase58() || liquidity.optionMint !== pool.optionMint.toBase58() ||
      liquidity.quoteMint !== pool.quoteMint.toBase58() || liquidity.ownerPubkey !== owner.toBase58() ||
      liquidity.marketId !== request.marketId || liquidity.expiryId !== request.expiryId) invalid("cleanup target or owner changed");
  const positionBytes = account(fresh.accountInfos, position, 637, "ADPOSIV1", "ALP", positionBump);
  if (!new PublicKey(positionBytes.slice(14, 46)).equals(poolAddress) ||
      !new PublicKey(positionBytes.slice(46, 78)).equals(owner) || readU64Le(positionBytes, 78) !== BigInt(nonce)) {
    invalid("cleanup position does not belong to the selected manager");
  }
  const lower = readU16Le(positionBytes, 86), count = positionBytes[88]!;
  if (lower < 1 || count < 1 || count > 32 || lower + count - 1 > pool.maximumBinId) invalid("cleanup position range is invalid");
  const rows = exactArray(request.entries, "cleanup entries", 0, 32);
  const entries = rows.map((value, index) => {
    const row = exactObject(value, ["binId", "shares", "minimumOptionOut", "minimumQuoteOut"]);
    const binId = canonicalIndex(row.binId, "cleanup bin", pool.maximumBinId);
    if (binId < lower || binId >= lower + count || (index > 0 && binId <= request.entries[index - 1]!.binId)) invalid("cleanup bins are not canonical");
    if (typeof row.shares !== "string" || !/^[1-9][0-9]*$/u.test(row.shares)) invalid("cleanup shares must be positive canonical integers");
    return { binId, shares: row.shares, minimumOptionOut: canonicalU64(row.minimumOptionOut, "minimum option out"),
      minimumQuoteOut: canonicalU64(row.minimumQuoteOut, "minimum quote out") };
  });
  let bitmap = 0;
  for (let i = 0; i < 32; i += 1) {
    const owned = readU64Le(positionBytes, 93 + i * 16) + (readU64Le(positionBytes, 101 + i * 16) << 64n);
    if (owned !== 0n) bitmap = (bitmap | (1 << i)) >>> 0;
    const selected = entries.find((entry) => entry.binId === lower + i);
    if ((i >= count && owned !== 0n) || BigInt(selected?.shares ?? "0") !== owned) invalid("cleanup must close exactly the owned shares");
  }
  if (readU32Le(positionBytes, 89) !== bitmap) invalid("cleanup position bitmap is inconsistent");
  const pages = exactArray(liquidity.pageIndices, "cleanup pages", 0, 4).map((value) => canonicalIndex(value, "page", 63));
  const touched = [...new Set(entries.map((row) => Math.floor((row.binId - 1) / 32)))];
  if (pages.some((page, index) => index > 0 && page <= pages[index - 1]!) ||
      pages.length > touched.length + 2 || touched.some((page) => !pages.includes(page)) || (!entries.length && pages.length)) invalid("cleanup page route is invalid");
  const pagePairs = pages.flatMap((page) => {
    const reserve = deriveDlmmBinPage(poolAddress, page);
    decodeCurrentWalletDlmmPage(reserve, fresh.accountInfos);
    const [shares, bump] = derive("ameba-dlmm-shares-v1", poolAddress.toBytes(), uint(page, 2));
    const data = account(fresh.accountInfos, shares, 594, "ADSHARE1", "ASP", bump);
    if (!new PublicKey(data.slice(14, 46)).equals(poolAddress) || readU16Le(data, 46) !== page || readU16Le(data, 48) !== page * 32 + 1) invalid("cleanup share page is not canonical");
    return [reserve, shares];
  });
  const expected = [owner, poolAddress, position, deriveDlmmAuthority(poolAddress), pool.optionMint, pool.quoteMint,
    derive("ameba-dlmm-vault-v1", poolAddress.toBytes(), pool.optionMint.toBytes())[0],
    derive("ameba-dlmm-vault-v1", poolAddress.toBytes(), pool.quoteMint.toBytes())[0],
    deriveLightAta(pool.optionMint, owner), deriveLightAta(pool.quoteMint, owner), LIGHT_TOKEN_PROGRAM_ID,
    LIGHT_TOKEN_CPI_AUTHORITY, deriveLightSplInterface(pool.optionMint), deriveLightSplInterface(pool.quoteMint),
    SPL_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, ...pagePairs];
  const writable = new Set([0, 1, 2, 6, 7, 8, 9, 12, 13, ...pagePairs.map((_, index) => index + 16)]);
  const batch = exactArray(plan.instructions, "cleanup instructions", 2, 2).map(instruction);
  requireExactInstruction(batch[0]!, ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), "cleanup compute budget");
  const governed = inspectGovernedInstructionEnvelopeV1({ instruction: batch[1]!, context: fresh.governance,
    recognizedInstructionTags: currentGovernedWriteReleaseV1().assignedInstructionTags });
  const data = Buffer.concat([uint(210, 1), uint(nonce, 8), uint(entries.length, 4), ...entries.flatMap((entry) => [
    uint(entry.binId, 2), uint(entry.shares, 16), uint(entry.minimumOptionOut, 8), uint(entry.minimumQuoteOut, 8),
  ]), uint(1, 1)]);
  if (!batch[1]!.programId.equals(CURRENT_PROGRAM_ID) || !equalBytes(governed.legacyData, data) ||
      batch[1]!.keys.length !== expected.length + 1 || expected.some((address, index) => {
        const meta = batch[1]!.keys[index]!;
        return !meta.pubkey.equals(address) || meta.isSigner !== (index === 0) || meta.isWritable !== writable.has(index);
      })) invalid("cleanup instruction changed its reviewed amounts, destinations, or privileges");
  return Object.freeze({ instructions: Object.freeze(batch), expiryTs: pool.expiryTs });
}
