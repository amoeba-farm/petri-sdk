import { CURRENT_LIVE_DEPLOYMENT } from "../protocol/release-train.js";
/** Portable-manifest decoding and browser-native RC44 address primitives. */

import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  canonicalIndex,
  canonicalPublicKeyString,
  decodeBase64,
  equalBytes,
  exactArray,
  exactObject,
  readU16Le,
  u64Le,
  walletError,
} from "./codec.js";

export const CURRENT_PROGRAM_ID = new PublicKey(CURRENT_LIVE_DEPLOYMENT.programId);
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey("ComputeBudget111111111111111111111111111111");
export const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const LIGHT_TOKEN_PROGRAM_ID = new PublicKey("cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m");
export const LIGHT_TOKEN_CPI_AUTHORITY = new PublicKey("GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy");
export const LIGHT_TOKEN_COMPRESSIBLE_CONFIG = new PublicKey("ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg");
export const LIGHT_TOKEN_RENT_SPONSOR = new PublicKey("r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti");
export const LIGHT_SYSTEM_PROGRAM = new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");
export const LIGHT_REGISTERED_PROGRAM = new PublicKey("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh");
export const LIGHT_COMPRESSION_AUTHORITY = new PublicKey("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA");
export const LIGHT_COMPRESSION_PROGRAM = new PublicKey("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq");

const TEXT = new TextEncoder();
const NAMESPACE = TEXT.encode("ameba-spread-v2");

export interface CurrentWalletInstructionAccountMeta {
  readonly address: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface CurrentWalletInstructionManifest {
  readonly programId: string;
  readonly instructionName: string;
  readonly instructionTag?: number;
  readonly dataBase64: string;
  readonly accounts: readonly CurrentWalletInstructionAccountMeta[];
}

export function decodeInstructionManifest(
  value: unknown,
  label: string,
  options: { readonly instructionTag?: "required" | "forbidden" } = {},
): CurrentWalletInstructionManifest {
  const tagRequired = options.instructionTag === "required";
  const object = exactObject(
    value,
    tagRequired
      ? ["programId", "instructionName", "instructionTag", "dataBase64", "accounts"]
      : ["programId", "instructionName", "dataBase64", "accounts"],
    options.instructionTag === undefined ? ["instructionTag"] : [],
    label,
  );
  const programId = pubkey(object.programId, `${label}.programId`).toBase58();
  if (typeof object.instructionName !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(object.instructionName)) {
    walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label}.instructionName is invalid`);
  }
  const data = decodeBase64(object.dataBase64, `${label}.dataBase64`);
  let instructionTag: number | undefined;
  if (object.instructionTag !== undefined) {
    instructionTag = canonicalIndex(object.instructionTag, `${label}.instructionTag`, 255);
    if (data[0] !== instructionTag) {
      walletError("CURRENT_WALLET_PLAN_INVALID", `${label} tag differs from its instruction bytes`);
    }
  }
  const accountValues = exactArray(object.accounts, `${label}.accounts`, 0, 256);
  const accounts = Object.freeze(accountValues.map((entry, index) => {
    const account = exactObject(entry, ["address", "isSigner", "isWritable"], [], `${label}.accounts[${index}]`);
    if (typeof account.isSigner !== "boolean" || typeof account.isWritable !== "boolean") {
      walletError("CURRENT_WALLET_RESPONSE_INVALID", `${label}.accounts[${index}] flags must be boolean`);
    }
    return Object.freeze({
      address: pubkey(account.address, `${label}.accounts[${index}].address`).toBase58(),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    });
  }));
  return Object.freeze({
    programId,
    instructionName: object.instructionName,
    ...(instructionTag === undefined ? {} : { instructionTag }),
    dataBase64: object.dataBase64 as string,
    accounts,
  });
}

export function manifestInstruction(manifest: CurrentWalletInstructionManifest): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(manifest.programId),
    keys: manifest.accounts.map((meta) => ({
      pubkey: new PublicKey(meta.address),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: decodeBase64(manifest.dataBase64, `${manifest.instructionName}.dataBase64`) as TransactionInstruction["data"],
  });
}

export function sameInstruction(
  actual: TransactionInstruction,
  expected: TransactionInstruction,
): boolean {
  return actual.programId.equals(expected.programId)
    && equalBytes(actual.data, expected.data)
    && actual.keys.length === expected.keys.length
    && actual.keys.every((meta, index) => {
      const right = expected.keys[index];
      return right !== undefined && meta.pubkey.equals(right.pubkey)
        && meta.isSigner === right.isSigner && meta.isWritable === right.isWritable;
    });
}

export function requireExactInstruction(
  actual: TransactionInstruction,
  expected: TransactionInstruction,
  label: string,
): void {
  if (!sameInstruction(actual, expected)) {
    walletError("CURRENT_WALLET_PLAN_MISMATCH", `${label} differs from the browser-native RC44 reconstruction`);
  }
}

export function requireFlags(
  manifest: CurrentWalletInstructionManifest,
  flags: readonly (readonly [boolean, boolean])[],
  label: string,
): void {
  if (manifest.accounts.length !== flags.length) {
    walletError("CURRENT_WALLET_PLAN_MISMATCH", `${label} has the wrong account count`);
  }
  flags.forEach(([isSigner, isWritable], index) => {
    const meta = manifest.accounts[index]!;
    if (meta.isSigner !== isSigner || meta.isWritable !== isWritable) {
      walletError("CURRENT_WALLET_PLAN_MISMATCH", `${label} account ${index} has noncanonical flags`);
    }
  });
}

export function requireAddress(
  manifest: CurrentWalletInstructionManifest,
  index: number,
  expected: PublicKey | string,
  label: string,
): void {
  const expectedString = typeof expected === "string" ? expected : expected.toBase58();
  if (manifest.accounts[index]?.address !== expectedString) {
    walletError("CURRENT_WALLET_PLAN_MISMATCH", `${label} is not the expected account`);
  }
}

export function requireWriteSet(
  value: unknown,
  manifests: readonly CurrentWalletInstructionManifest[],
  label: string,
): readonly string[] {
  const entries = exactArray(value, label, 1, 256).map((entry, index) =>
    pubkey(entry, `${label}[${index}]`).toBase58());
  if (new Set(entries).size !== entries.length || entries.some((entry, index) => index > 0 && entries[index - 1]! >= entry)) {
    walletError("CURRENT_WALLET_PLAN_INVALID", `${label} must be unique and lexicographically sorted`);
  }
  const exact = [...new Set(manifests.flatMap((manifest) => manifest.accounts
    .filter((meta) => meta.isWritable).map((meta) => meta.address)))].sort();
  if (entries.length !== exact.length || entries.some((entry, index) => entry !== exact[index])) {
    walletError("CURRENT_WALLET_PLAN_MISMATCH", `${label} differs from exact writable metas`);
  }
  return Object.freeze(entries);
}

export function pubkey(value: unknown, label: string): PublicKey {
  const canonical = canonicalPublicKeyString(value, label, (candidate) => new PublicKey(candidate).toBase58());
  return new PublicKey(canonical);
}

export function deriveWriterPda(seed: string, keys: readonly PublicKey[], extra: readonly Uint8Array[] = []): PublicKey {
  return PublicKey.findProgramAddressSync(
    [NAMESPACE, TEXT.encode(seed), ...keys.map((key) => key.toBytes()), ...extra],
    CURRENT_PROGRAM_ID,
  )[0];
}

export function deriveWriterFlatMint(sleeve: PublicKey): PublicKey {
  return deriveWriterPda("writer_flat_mint_v1", [sleeve]);
}

export function deriveWriterSleeveUsdcVault(sleeve: PublicKey): PublicKey {
  return deriveWriterPda("writer_sleeve_usdc_v1", [sleeve]);
}

export function deriveWriterFlatStaging(sleeve: PublicKey): PublicKey {
  return deriveWriterPda("writer_flat_staging_v1", [sleeve]);
}

export function deriveWriterFlatBurnCustody(sleeve: PublicKey): PublicKey {
  return deriveWriterPda("writer_flat_burn_v1", [sleeve]);
}

export function deriveWriterSeriesBook(sleeve: PublicKey): PublicKey {
  return deriveWriterPda("writer_series_book_v1", [sleeve]);
}

export function deriveWriterSleeve(group: PublicKey): PublicKey {
  return deriveWriterPda("writer_sleeve_v1", [group]);
}

export function deriveWriterBidIndex(auction: PublicKey): PublicKey {
  return deriveWriterPda("writer_bid_index_v1", [auction]);
}

export function deriveWriterBid(auction: PublicKey, bidder: PublicKey, orderId: bigint): PublicKey {
  return deriveWriterPda("writer_bid_v1", [auction, bidder], [u64Le(orderId)]);
}

export function deriveWriterCloseRequest(sleeve: PublicKey, nonce: bigint): PublicKey {
  return deriveWriterPda("writer_close_v1", [sleeve], [u64Le(nonce)]);
}

export function deriveWriterCloseFlatEscrow(request: PublicKey): PublicKey {
  return deriveWriterPda("writer_close_flat_escrow_v1", [request]);
}

export function deriveWriterRetirementCustody(sleeve: PublicKey, market: PublicKey): PublicKey {
  return deriveWriterPda("writer_retirement_v1", [sleeve, market]);
}

export function deriveClassicAta(mint: PublicKey, owner: PublicKey): PublicKey {
  if (!PublicKey.isOnCurve(owner.toBytes())) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "classic ATA owner must be on curve");
  }
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), SPL_TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function deriveLightAta(mint: PublicKey, owner: PublicKey): PublicKey {
  if (!PublicKey.isOnCurve(owner.toBytes())) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Light ATA owner must be on curve");
  }
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), LIGHT_TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    LIGHT_TOKEN_PROGRAM_ID,
  )[0];
}

export function deriveLightSplInterface(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [TEXT.encode("pool"), mint.toBytes()],
    LIGHT_TOKEN_PROGRAM_ID,
  )[0];
}

export function deriveDlmmPool(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [NAMESPACE, TEXT.encode("ameba-dlmm-pool-v1"), market.toBytes()], CURRENT_PROGRAM_ID,
  )[0];
}

export function deriveDlmmAuthority(pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [NAMESPACE, TEXT.encode("ameba-dlmm-authority-v1"), pool.toBytes()], CURRENT_PROGRAM_ID,
  )[0];
}

export function deriveDlmmBinPage(pool: PublicKey, pageIndex: number): PublicKey {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, canonicalIndex(pageIndex, "pageIndex", 0xffff), true);
  return PublicKey.findProgramAddressSync(
    [NAMESPACE, TEXT.encode("ameba-dlmm-page-v1"), pool.toBytes(), bytes], CURRENT_PROGRAM_ID,
  )[0];
}

export function buildCreateLightAta(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: LIGHT_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: deriveLightAta(mint, owner), isSigner: false, isWritable: true },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false },
      { pubkey: LIGHT_TOKEN_COMPRESSIBLE_CONFIG, isSigner: false, isWritable: false },
      { pubkey: LIGHT_TOKEN_RENT_SPONSOR, isSigner: false, isWritable: true },
    ],
    data: Uint8Array.of(102, 1, 3, 16, 1, 254, 2, 0, 0, 0) as TransactionInstruction["data"],
  });
}

export function requireCanonicalComputeBudget(instruction: TransactionInstruction): void {
  if (!instruction.programId.equals(COMPUTE_BUDGET_PROGRAM_ID) || instruction.keys.length !== 0
    || instruction.data.length !== 5 || instruction.data[0] !== 2) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "setup compute-budget instruction is not canonical");
  }
  const units = new DataView(
    instruction.data.buffer,
    instruction.data.byteOffset + 1,
    4,
  ).getUint32(0, true);
  if (units < 50_000 || units > 1_400_000) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "setup compute-unit limit is outside the admitted range");
  }
}

export function requireCanonicalLightTransfer2(
  instruction: TransactionInstruction,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  target: PublicKey,
): void {
  if (!instruction.programId.equals(LIGHT_TOKEN_PROGRAM_ID)
    || instruction.data.length < 1 || instruction.data.length > 16_384
    || instruction.data[0] !== 101 || instruction.keys.length < 12) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "cold setup is not one bounded Light Transfer2 instruction");
  }
  const fixed: readonly (readonly [PublicKey, boolean, boolean])[] = [
    [LIGHT_SYSTEM_PROGRAM, false, false],
    [payer, true, true],
    [LIGHT_TOKEN_CPI_AUTHORITY, false, false],
    [LIGHT_REGISTERED_PROGRAM, false, false],
    [LIGHT_COMPRESSION_AUTHORITY, false, false],
    [LIGHT_COMPRESSION_PROGRAM, false, false],
    [PublicKey.default, false, false],
  ];
  const fixedMatch = fixed.every(([address, isSigner, isWritable], index) => {
    const meta = instruction.keys[index];
    return meta !== undefined && meta.pubkey.equals(address)
      && meta.isSigner === isSigner && meta.isWritable === isWritable;
  });
  const suffixStart = instruction.keys.length - 3;
  const proofMetas = instruction.keys.slice(7, suffixStart);
  const suffix = instruction.keys.slice(suffixStart);
  if (!fixedMatch || proofMetas.length < 2
    || proofMetas.some((meta) => meta.isSigner || !meta.isWritable)
    || !suffix[0]?.pubkey.equals(mint) || suffix[0].isSigner || suffix[0].isWritable
    || !suffix[1]?.pubkey.equals(owner) || !suffix[1].isSigner || suffix[1].isWritable
    || !suffix[2]?.pubkey.equals(target) || suffix[2].isSigner || !suffix[2].isWritable) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "Light Transfer2 identities or metas are not canonical");
  }
}

export function requireCanonicalSetupBatch(input: {
  readonly batch: readonly TransactionInstruction[];
  readonly payer: PublicKey;
  readonly owner: PublicKey;
  readonly mint: PublicKey;
  readonly target: PublicKey;
  readonly requireCreate: boolean;
}): void {
  if (input.batch.length !== 3) {
    walletError("CURRENT_WALLET_PLAN_INVALID", "cold setup batch must be exact compute/create/Transfer2");
  }
  requireCanonicalComputeBudget(input.batch[0]!);
  requireExactInstruction(
    input.batch[1]!,
    buildCreateLightAta(input.payer, input.owner, input.mint),
    "cold setup Light ATA create",
  );
  requireCanonicalLightTransfer2(input.batch[2]!, input.payer, input.owner, input.mint, input.target);
}

export function requireCanonicalSwapPdas(input: {
  readonly group: PublicKey;
  readonly sleeve: PublicKey;
  readonly book: PublicKey;
  readonly market: PublicKey;
  readonly pool: PublicKey;
  readonly authority: PublicKey;
  readonly pageIndices: readonly number[];
  readonly pages: readonly string[];
}): void {
  if (!deriveWriterSleeve(input.group).equals(input.sleeve)
    || !deriveWriterSeriesBook(input.sleeve).equals(input.book)
    || !deriveDlmmPool(input.market).equals(input.pool)
    || !deriveDlmmAuthority(input.pool).equals(input.authority)
    || input.pages.length !== input.pageIndices.length
    || input.pages.some((page, index) => !deriveDlmmBinPage(input.pool, input.pageIndices[index]!).equals(new PublicKey(page)))) {
    walletError("CURRENT_WALLET_PLAN_MISMATCH", "collective swap parent/child PDAs are not canonical");
  }
}

export function readManifestU16(manifest: CurrentWalletInstructionManifest, offset: number): number {
  return readU16Le(decodeBase64(manifest.dataBase64, `${manifest.instructionName}.dataBase64`), offset);
}
