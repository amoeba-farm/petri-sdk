import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  CLASSIC_SPL_TOKEN_PROGRAM_ID,
  CURRENT_LIGHT_TOKEN_PROGRAM_ID,
  deriveLightAssociatedTokenAddress,
} from "@amoeba/spread-release-tools/token-primitives";
import { AmebaProtocolError } from "../errors.js";
import { CURRENT_LIGHT_PROGRAM_DEPLOYMENTS } from "./current-light-deployments.js";

// The bundled token-primitives entrypoint intentionally exposes only the
// public program identities. Keep these three fixed Light v0.23.3 identities
// local so this instruction-only module remains browser-safe and cannot pull
// the Node-only Oracle builder graph into wallet bundles.
const CURRENT_LIGHT_TOKEN_CPI_AUTHORITY = new PublicKey(
  "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy",
);
const CURRENT_LIGHT_TOKEN_COMPRESSIBLE_CONFIG = new PublicKey(
  "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg",
);
const CURRENT_LIGHT_TOKEN_RENT_SPONSOR = new PublicKey(
  "r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti",
);
const PINNED_CURRENT_LIGHT_TOKEN_PROGRAM_ID = new PublicKey(
  CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.tokenProgram.programId,
);
const LIGHT_SPL_INTERFACE_POOL_SEED = Uint8Array.of(112, 111, 111, 108);

/** Exact Light Token v0.23.3 idempotent compressible-ATA create bytes. */
export const CURRENT_LIGHT_CREATE_ATA_IDEMPOTENT_DATA = Object.freeze(
  [102, 1, 3, 16, 1, 254, 2, 0, 0, 0] as const,
);

/** SDK-owned native builder shared by Flat transfer and writer cancellation. */
export function buildCurrentCreateLightAtaIdempotentInstruction(input: {
  readonly payer: PublicKey;
  readonly owner: PublicKey;
  readonly mint: PublicKey;
}): TransactionInstruction {
  const ata = deriveLightAssociatedTokenAddress(input.mint, input.owner);
  return new TransactionInstruction({
    programId: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false },
      { pubkey: CURRENT_LIGHT_TOKEN_COMPRESSIBLE_CONFIG, isSigner: false, isWritable: false },
      { pubkey: CURRENT_LIGHT_TOKEN_RENT_SPONSOR, isSigner: false, isWritable: true },
    ],
    data: Uint8Array.from(CURRENT_LIGHT_CREATE_ATA_IDEMPOTENT_DATA) as TransactionInstruction["data"],
  });
}

export interface BuildCurrentClassicSplToLightAtaRebridgeV1Input {
  /** Owner that pays for the Light ATA and authorizes the classic-SPL debit. */
  readonly bidder: PublicKey;
  /** Caller-supplied bidder-owned classic-SPL source; Writer pickup uses the stored destination. */
  readonly sourceClassicSplAccount: PublicKey;
  readonly mint: PublicKey;
  readonly amountAtoms: bigint;
  readonly decimals: number;
}

export interface CurrentClassicSplToLightAtaRebridgeV1 {
  readonly sourceClassicSplAccount: PublicKey;
  readonly destinationLightAta: PublicKey;
  readonly splInterface: PublicKey;
  /** Idempotent canonical Light ATA creation followed by exact SPL-to-Light Transfer2. */
  readonly instructions: readonly [TransactionInstruction, TransactionInstruction];
}

export class CurrentLightRebridgeValidationError extends AmebaProtocolError {
  constructor(message: string) {
    super(message, { code: "CURRENT_LIGHT_REBRIDGE_INVALID" });
  }
}

/**
 * Re-bridges a ClassicSpl writer-bid delivery into the same bidder's canonical
 * Light ATA. This is the exact Light Token v0.23.3 TransferInterface SPL-to-Light
 * route used by Spread. The builder neither reads nor validates a WriterBid;
 * callers using it for Writer pickup pass that bid's stored destination as the
 * source. It does not alter or restrict the bid's delivery mode or destination.
 */
export function buildCurrentClassicSplToLightAtaRebridgeV1(
  input: BuildCurrentClassicSplToLightAtaRebridgeV1Input,
): CurrentClassicSplToLightAtaRebridgeV1 {
  if (!CURRENT_LIGHT_TOKEN_PROGRAM_ID.equals(PINNED_CURRENT_LIGHT_TOKEN_PROGRAM_ID)) {
    throw new CurrentLightRebridgeValidationError(
      "Light token primitive does not match the pinned current deployment identity",
    );
  }
  if (input === null || typeof input !== "object") {
    throw new CurrentLightRebridgeValidationError("re-bridge input is malformed");
  }
  const bidder = exactNondefaultKey(input.bidder, "bidder");
  const source = exactNondefaultKey(
    input.sourceClassicSplAccount,
    "source classic-SPL account",
  );
  const mint = exactNondefaultKey(input.mint, "mint");
  const amountAtoms = input.amountAtoms;
  const decimals = input.decimals;
  if (
    typeof amountAtoms !== "bigint"
    || amountAtoms <= 0n
    || amountAtoms > 0xffff_ffff_ffff_ffffn
  ) {
    throw new CurrentLightRebridgeValidationError("re-bridge amount must be a positive u64");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new CurrentLightRebridgeValidationError("re-bridge decimals must be a u8");
  }
  const destination = deriveLightAssociatedTokenAddress(mint, bidder);
  const [splInterface, splInterfaceBump] = PublicKey.findProgramAddressSync(
    [LIGHT_SPL_INTERFACE_POOL_SEED, mint.toBytes()],
    CURRENT_LIGHT_TOKEN_PROGRAM_ID,
  );
  if (
    source.equals(destination)
    || source.equals(mint)
    || source.equals(splInterface)
  ) {
    throw new CurrentLightRebridgeValidationError(
      "re-bridge source collides with a canonical mint, interface, or destination account",
    );
  }
  const createDestination = buildCurrentCreateLightAtaIdempotentInstruction({
    payer: bidder,
    owner: bidder,
    mint,
  });
  const transfer = new TransactionInstruction({
    programId: CURRENT_LIGHT_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(CURRENT_LIGHT_TOKEN_CPI_AUTHORITY.toBytes()), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(bidder.toBytes()), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(mint.toBytes()), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(destination.toBytes()), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(bidder.toBytes()), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(source.toBytes()), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(splInterface.toBytes()), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(CLASSIC_SPL_TOKEN_PROGRAM_ID.toBytes()), isSigner: false, isWritable: false },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false },
    ],
    data: encodeClassicSplToLightTransfer2V1(
      amountAtoms,
      splInterfaceBump,
      decimals,
    ),
  });
  return Object.freeze({
    sourceClassicSplAccount: source,
    destinationLightAta: new PublicKey(destination.toBytes()),
    splInterface: new PublicKey(splInterface.toBytes()),
    instructions: Object.freeze([createDestination, transfer] as const),
  });
}

function encodeClassicSplToLightTransfer2V1(
  amount: bigint,
  splInterfaceBump: number,
  decimals: number,
): TransactionInstruction["data"] {
  const data = new Uint8Array(59);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  data[offset++] = 101; // Transfer2
  data.set([0, 0, 0, 0, 0, 0xff, 0xff, 0, 1], offset);
  offset += 9;
  view.setUint32(offset, 2, true); // exactly two compression operations
  offset += 4;
  offset = writeCompression(data, view, offset, {
    mode: 0,
    amount,
    mintIndex: 0,
    sourceOrRecipientIndex: 3,
    authorityIndex: 2,
    poolAccountIndex: 4,
    poolIndex: 0,
    bump: splInterfaceBump,
    decimals,
  });
  offset = writeCompression(data, view, offset, {
    mode: 1,
    amount,
    mintIndex: 0,
    sourceOrRecipientIndex: 1,
    authorityIndex: 0,
    poolAccountIndex: 0,
    poolIndex: 0,
    bump: 0,
    decimals: 0,
  });
  // proof=None, input/output token vectors empty, and no lamport/TLV options.
  data.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], offset);
  offset += 13;
  if (offset !== data.length) {
    throw new CurrentLightRebridgeValidationError("re-bridge Transfer2 encoding length diverged");
  }
  return data as TransactionInstruction["data"];
}

function writeCompression(
  data: Uint8Array,
  view: DataView,
  offset: number,
  value: {
    readonly mode: number;
    readonly amount: bigint;
    readonly mintIndex: number;
    readonly sourceOrRecipientIndex: number;
    readonly authorityIndex: number;
    readonly poolAccountIndex: number;
    readonly poolIndex: number;
    readonly bump: number;
    readonly decimals: number;
  },
): number {
  data[offset++] = value.mode;
  view.setBigUint64(offset, value.amount, true);
  offset += 8;
  for (const byte of [
    value.mintIndex,
    value.sourceOrRecipientIndex,
    value.authorityIndex,
    value.poolAccountIndex,
    value.poolIndex,
    value.bump,
    value.decimals,
  ]) data[offset++] = byte;
  return offset;
}

function exactNondefaultKey(value: unknown, label: string): PublicKey {
  if (!(value instanceof PublicKey) || value.equals(PublicKey.default)) {
    throw new CurrentLightRebridgeValidationError(`${label} must be a nondefault PublicKey`);
  }
  return new PublicKey(value.toBytes());
}
