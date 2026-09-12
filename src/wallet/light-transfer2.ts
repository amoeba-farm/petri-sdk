/** Exact browser-native validation of the pinned Light v0.23.3 cold-load subset. */

import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import { readU16Le, readU32Le, readU64Le, walletError } from "./codec.js";
import {
  LIGHT_COMPRESSION_AUTHORITY,
  LIGHT_COMPRESSION_PROGRAM,
  LIGHT_REGISTERED_PROGRAM,
  LIGHT_SYSTEM_PROGRAM,
  LIGHT_TOKEN_CPI_AUTHORITY,
  LIGHT_TOKEN_PROGRAM_ID,
} from "./manifest.js";

const TRANSFER2_DISCRIMINATOR = 101;
const TRANSFER2_MAX_INPUTS = 8;
const TRANSFER2_MAX_ACCOUNTS = 26;
const TRANSFER2_SHA_FLAT_VERSION = 3;
const CURRENT_TOKEN_DECIMALS = 6;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const CURRENT_STATE_TREE_QUEUE = new Map<string, string>([
  ["bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU", "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto"],
  ["bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi", "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg"],
  ["bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb", "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ"],
  ["bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8", "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq"],
  ["bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2", "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P"],
]);

export interface CurrentWalletLightTransfer2Expectation {
  readonly payer: PublicKey;
  readonly owner: PublicKey;
  readonly mint: PublicKey;
  readonly destination: PublicKey;
  readonly amountAtoms: bigint;
}

interface Transfer2InputIdentity {
  readonly tree: string;
  readonly queue: string;
  readonly leafIndex: number;
}

interface DecodedTransfer2Input extends Transfer2InputIdentity {
  readonly treeIndex: number;
  readonly queueIndex: number;
  readonly amountAtoms: bigint;
  readonly proveByIndex: boolean;
}

/**
 * Validate one complete cold balance load. Every instruction must consume
 * distinct authenticated token inputs and decompress only into the expected
 * Light ATA. No token outputs, lamports, delegate, TLV, CPI, SPL-pool, or
 * transaction-hash mode is admitted.
 */
export function validateCurrentWalletLightTransfer2LoadSequence(
  transfers: readonly TransactionInstruction[],
  expected: CurrentWalletLightTransfer2Expectation,
): void {
  if (transfers.length < 1 || transfers.length > 8
    || expected.amountAtoms < 1n || expected.amountAtoms > U64_MAX) {
    invalid("cold load must contain 1..8 Transfer2 batches for one positive u64 balance");
  }
  let totalAmount = 0n;
  const inputs = new Set<string>();
  for (const transfer of transfers) {
    const decoded = decodeTransfer2Load(transfer, expected);
    totalAmount += decoded.amountAtoms;
    if (totalAmount > U64_MAX) invalid("cold load amount exceeds the current u64 token domain");
    for (const input of decoded.inputs) {
      const identity = `${input.tree}:${input.queue}:${input.leafIndex}`;
      if (inputs.has(identity)) invalid("cold load reuses one compressed input across batches");
      inputs.add(identity);
    }
  }
  if (totalAmount !== expected.amountAtoms) {
    invalid("cold load amount does not equal the authenticated cold balance");
  }
}

function decodeTransfer2Load(
  instruction: TransactionInstruction,
  expected: CurrentWalletLightTransfer2Expectation,
): { readonly amountAtoms: bigint; readonly inputs: readonly Transfer2InputIdentity[] } {
  if (!instruction.programId.equals(LIGHT_TOKEN_PROGRAM_ID)
    || instruction.keys.length < 12 || instruction.keys.length > TRANSFER2_MAX_ACCOUNTS) {
    invalid("instruction is not the bounded current Transfer2 account grammar");
  }
  const fixed: readonly (readonly [PublicKey, boolean, boolean])[] = [
    [LIGHT_SYSTEM_PROGRAM, false, false],
    [expected.payer, true, true],
    [LIGHT_TOKEN_CPI_AUTHORITY, false, false],
    [LIGHT_REGISTERED_PROGRAM, false, false],
    [LIGHT_COMPRESSION_AUTHORITY, false, false],
    [LIGHT_COMPRESSION_PROGRAM, false, false],
    [PublicKey.default, false, false],
  ];
  fixed.forEach(([address, isSigner, isWritable], index) => {
    if (!sameMeta(instruction.keys[index], address, isSigner, isWritable)) {
      invalid("Transfer2 fixed accounts or payer flags are not exact");
    }
  });

  const packed = instruction.keys.slice(7);
  const mintIndex = packed.length - 3;
  const ownerIndex = packed.length - 2;
  const destinationIndex = packed.length - 1;
  if (mintIndex < 2
    || new Set(packed.slice(0, mintIndex).map((meta) => meta.pubkey.toBase58())).size !== mintIndex
    || packed.slice(0, mintIndex).some((meta) => meta.isSigner || !meta.isWritable)
    || !sameMeta(packed[mintIndex], expected.mint, false, false)
    || !sameMeta(packed[ownerIndex], expected.owner, true, false)
    || !sameMeta(packed[destinationIndex], expected.destination, false, true)) {
    invalid("Transfer2 proof accounts or mint-owner-destination suffix are not exact");
  }

  const cursor = new Cursor(instruction.data);
  if (cursor.u8("discriminator") !== TRANSFER2_DISCRIMINATOR) {
    invalid("instruction discriminator is not Transfer2");
  }
  if (cursor.bool("withTransactionHash")
    || cursor.bool("withLamportsChangeAccountMerkleTreeIndex")
    || cursor.u8("lamportsChangeAccountMerkleTreeIndex") !== 0
    || cursor.u8("lamportsChangeAccountOwnerIndex") !== 0) {
    invalid("Transfer2 transaction-hash or lamport-change mode is not allowed");
  }
  const outputQueue = cursor.u8("outputQueue");
  if (cursor.u16("maxTopUp") !== 0xffff || cursor.option("cpiContext")) {
    invalid("Transfer2 top-up or CPI context is not the pinned load mode");
  }
  if (!cursor.option("compressions") || cursor.vecLength("compressions", 1) !== 1) {
    invalid("Transfer2 must contain one decompression");
  }
  const compressionMode = cursor.u8("compression.mode");
  const compressionAmount = cursor.u64("compression.amount");
  const compressionMint = cursor.u8("compression.mint");
  const compressionDestination = cursor.u8("compression.sourceOrRecipient");
  const compressionAuthority = cursor.u8("compression.authority");
  const poolAccountIndex = cursor.u8("compression.poolAccountIndex");
  const poolIndex = cursor.u8("compression.poolIndex");
  const poolBump = cursor.u8("compression.bump");
  const decimals = cursor.u8("compression.decimals");
  if (compressionMode !== 1 || compressionAmount < 1n
    || compressionMint !== mintIndex || compressionDestination !== destinationIndex
    || compressionAuthority !== 0 || poolAccountIndex !== 0 || poolIndex !== 0
    || poolBump !== 0 || decimals !== CURRENT_TOKEN_DECIMALS) {
    invalid("Transfer2 decompression does not bind exact mint, destination, amount, and pool-free mode");
  }

  const hasProof = cursor.option("proof");
  const proof = hasProof ? cursor.bytes(128, "proof") : null;
  if (proof !== null && proof.every((byte) => byte === 0)) invalid("Transfer2 full proof is all zero");
  const inputCount = cursor.vecLength("inTokenData", TRANSFER2_MAX_INPUTS);
  if (inputCount < 1) invalid("Transfer2 contains no compressed token input");
  const inputs: DecodedTransfer2Input[] = [];
  const referencedProofAccounts = new Set<number>();
  let inputAmount = 0n;
  for (let index = 0; index < inputCount; index += 1) {
    const inputOwner = cursor.u8(`inTokenData[${index}].owner`);
    const amountAtoms = cursor.u64(`inTokenData[${index}].amount`);
    const hasDelegate = cursor.bool(`inTokenData[${index}].hasDelegate`);
    const delegate = cursor.u8(`inTokenData[${index}].delegate`);
    const inputMint = cursor.u8(`inTokenData[${index}].mint`);
    const version = cursor.u8(`inTokenData[${index}].version`);
    const treeIndex = cursor.u8(`inTokenData[${index}].tree`);
    const queueIndex = cursor.u8(`inTokenData[${index}].queue`);
    const leafIndex = cursor.u32(`inTokenData[${index}].leafIndex`);
    const proveByIndex = cursor.bool(`inTokenData[${index}].proveByIndex`);
    const rootIndex = cursor.u16(`inTokenData[${index}].rootIndex`);
    if (inputOwner !== ownerIndex || amountAtoms < 1n || hasDelegate || delegate !== 0
      || inputMint !== mintIndex || version !== TRANSFER2_SHA_FLAT_VERSION
      || treeIndex >= mintIndex || queueIndex >= mintIndex || treeIndex === queueIndex
      || (proveByIndex && rootIndex !== 0)) {
      invalid("Transfer2 input identity, amount, delegate, version, or proof context is not exact");
    }
    inputAmount += amountAtoms;
    if (inputAmount > U64_MAX) invalid("Transfer2 input amount exceeds u64");
    const tree = packed[treeIndex]!.pubkey.toBase58();
    const queue = packed[queueIndex]!.pubkey.toBase58();
    if (CURRENT_STATE_TREE_QUEUE.get(tree) !== queue) {
      invalid("Transfer2 tree and queue are not a pinned current topology pair");
    }
    referencedProofAccounts.add(treeIndex);
    referencedProofAccounts.add(queueIndex);
    inputs.push(Object.freeze({ tree, queue, leafIndex, treeIndex, queueIndex, amountAtoms, proveByIndex }));
  }
  if (referencedProofAccounts.size !== mintIndex
    || [...Array(mintIndex).keys()].some((index) => !referencedProofAccounts.has(index))) {
    invalid("Transfer2 proof-account prefix contains an unused account");
  }
  if (compressionAmount !== inputAmount || outputQueue !== inputs[0]?.queueIndex
    || (hasProof === inputs.every((input) => input.proveByIndex))) {
    invalid("Transfer2 proof mode, output queue, or decompressed amount does not match inputs");
  }
  if (cursor.vecLength("outTokenData", 0) !== 0
    || cursor.option("inLamports") || cursor.option("outLamports")
    || cursor.option("inTlv") || cursor.option("outTlv")) {
    invalid("Transfer2 may not create outputs, move lamports, or carry TLV extensions");
  }
  cursor.finish();
  return Object.freeze({
    amountAtoms: inputAmount,
    inputs: Object.freeze(inputs.map(({ tree, queue, leafIndex }) => Object.freeze({ tree, queue, leafIndex }))),
  });
}

function sameMeta(
  meta: { readonly pubkey: PublicKey; readonly isSigner: boolean; readonly isWritable: boolean } | undefined,
  address: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
): boolean {
  return meta !== undefined && meta.pubkey.equals(address)
    && meta.isSigner === isSigner && meta.isWritable === isWritable;
}

class Cursor {
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 16_384) {
      invalid("Transfer2 data size is outside 1..16384 bytes");
    }
    this.#bytes = bytes;
  }

  u8(field: string): number {
    this.#require(1, field);
    return this.#bytes[this.#offset++]!;
  }
  bool(field: string): boolean {
    const value = this.u8(field);
    if (value > 1) invalid(`${field} is not a canonical Borsh bool`);
    return value === 1;
  }
  u16(field: string): number {
    this.#require(2, field);
    const value = readU16Le(this.#bytes, this.#offset);
    this.#offset += 2;
    return value;
  }
  u32(field: string): number {
    this.#require(4, field);
    const value = readU32Le(this.#bytes, this.#offset);
    this.#offset += 4;
    return value;
  }
  u64(field: string): bigint {
    this.#require(8, field);
    const value = readU64Le(this.#bytes, this.#offset);
    this.#offset += 8;
    return value;
  }
  option(field: string): boolean {
    const value = this.u8(`${field} option`);
    if (value > 1) invalid(`${field} has a noncanonical Borsh option`);
    return value === 1;
  }
  vecLength(field: string, maximum: number): number {
    const value = this.u32(`${field} length`);
    if (value > maximum) invalid(`${field} exceeds its current bound`);
    return value;
  }
  bytes(length: number, field: string): Uint8Array {
    this.#require(length, field);
    const value = this.#bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }
  finish(): void {
    if (this.#offset !== this.#bytes.length) invalid("Transfer2 contains trailing bytes");
  }
  #require(length: number, field: string): void {
    if (this.#offset + length > this.#bytes.length) invalid(`Transfer2 ${field} is truncated`);
  }
}

function invalid(message: string): never {
  walletError("CURRENT_WALLET_PLAN_INVALID", `current Light Transfer2 invalid: ${message}`);
}
