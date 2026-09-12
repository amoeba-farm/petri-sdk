/** Minimal browser-native RC44 writer account decoders used before wallet compilation. */

import { PublicKey, type AccountInfo } from "@solana/web3.js";

import { readU16Le, readU64Le, u64Le, walletError } from "./codec.js";
import {
  CURRENT_PROGRAM_ID,
  deriveWriterBidIndex,
  deriveWriterBid,
  deriveWriterCloseRequest,
  deriveWriterPda,
  deriveWriterSeriesBook,
  deriveWriterSleeve,
} from "./manifest.js";

const WRITER_MAX_LIVE_SERIES = 20;
const WRITER_SERIES_STORAGE_CAPACITY = 32;
const WRITER_BID_STORAGE_CAPACITY = 128;

export interface WalletWriterSleeve {
  readonly address: PublicKey;
  readonly vaultConfig: PublicKey;
  readonly expiryTs: bigint;
  readonly settlementMint: PublicKey;
  readonly settlementGroup: PublicKey;
  readonly seriesBook: PublicKey;
  readonly usdcVault: PublicKey;
  readonly flatMint: PublicKey;
  readonly flatSplInterface: PublicKey;
  readonly flatStaging: PublicKey;
  readonly flatBurnCustody: PublicKey;
  readonly policySnapshot: PublicKey;
  readonly policyHash: string;
  readonly closeNonce: bigint;
  readonly seriesCount: number;
  readonly status: number;
  readonly activeAuction: PublicKey | null;
  readonly activeCloseRequest: PublicKey | null;
  readonly writerPrincipalAtoms: bigint;
  readonly lockedPrimaryPremiumAtoms: bigint;
  readonly accountedAssetAtoms: bigint;
  readonly exactReserveAtoms: bigint;
  readonly flatParSupplyAtoms: bigint;
  readonly securityExposureAtoms: bigint;
  readonly auctionNonce: bigint;
}

export interface WalletWriterSeriesRecord {
  readonly active: boolean;
  readonly market: PublicKey;
  readonly contractMint: PublicKey;
  readonly retirementCustody: PublicKey;
}

export interface WalletWriterSeriesBook {
  readonly address: PublicKey;
  readonly sleeve: PublicKey;
  readonly settlementGroup: PublicKey;
  readonly seriesCount: number;
  readonly bookDigest: string;
  readonly records: readonly WalletWriterSeriesRecord[];
}

export interface WalletWriterAuction {
  readonly address: PublicKey;
  readonly sleeve: PublicKey;
  readonly seriesBook: PublicKey;
  readonly policySnapshot: PublicKey;
  readonly auctionNonce: bigint;
  readonly escrow: PublicKey;
  readonly bidIndex: PublicKey;
  readonly status: number;
  readonly bidDeadlineTs: bigint;
}

export interface WalletWriterBidIndex {
  readonly address: PublicKey;
  readonly auction: PublicKey;
  readonly bidCount: number;
  readonly records: readonly { readonly occupied: boolean; readonly status: number; readonly bid: PublicKey; readonly bidder: PublicKey; readonly orderId: bigint }[];
}

export interface WalletWriterCloseRequest {
  readonly address: PublicKey;
  readonly sleeve: PublicKey;
  readonly owner: PublicKey;
  readonly flatEscrow: PublicKey;
  readonly flatMint: PublicKey;
  readonly requestNonce: bigint;
  readonly deadlineTs: bigint;
  readonly status: number;
  readonly seriesCount: number;
  readonly nextDepositIndex: number;
  readonly nextCancelIndex: number;
  readonly requiredClaimAtoms: readonly bigint[];
  readonly depositedClaimAtoms: readonly bigint[];
}

export function requireCurrentProgramData(
  accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>,
  address: PublicKey,
  expectedLength: number,
  label: string,
): Uint8Array {
  const info = accountInfos.get(address.toBase58());
  if (info === null || info === undefined || info.executable
    || !info.owner.equals(CURRENT_PROGRAM_ID) || info.data.length !== expectedLength) {
    walletError("CURRENT_WALLET_ACCOUNT_INVALID", `${label} is absent or has a noncanonical owner/layout`);
  }
  return info.data;
}

export function decodeWalletWriterSleeve(
  address: PublicKey,
  accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>,
): WalletWriterSleeve {
  const reader = writerReader(requireCurrentProgramData(accountInfos, address, 764, "writer sleeve"), "WSL");
  const vaultConfig = reader.pubkey();
  reader.bytes(32);
  const expiryTs = reader.u64();
  const settlementMint = reader.pubkey();
  const settlementGroup = reader.pubkey();
  const seriesBook = reader.pubkey();
  const usdcVault = reader.pubkey();
  const flatMint = reader.pubkey();
  const flatSplInterface = reader.pubkey();
  const flatStaging = reader.pubkey();
  const flatBurnCustody = reader.pubkey();
  reader.pubkey();
  const policySnapshot = reader.pubkey();
  reader.u64();
  const policyHash = hex32(reader.bytes(32));
  reader.bytes(32 * 2);
  const accounting = Array.from({ length: 16 }, () => reader.u64());
  const auctionNonce = reader.u64();
  const closeNonce = reader.u64();
  const seriesCount = reader.u8();
  const status = reader.u8();
  const securityMode = reader.u8();
  if (reader.u8() !== 0 || status > 7 || securityMode > 1) invalid("writer sleeve flags are invalid");
  const activeAuction = reader.optionalPubkey();
  const activeCloseRequest = reader.optionalPubkey();
  reader.u64();
  reader.u64();
  reader.zeroBytes(32);
  reader.finishZeroPadded();
  if (seriesCount > WRITER_MAX_LIVE_SERIES || accounting[3]! > accounting[2]!
    || !deriveWriterSleeve(settlementGroup).equals(address)) {
    invalid("writer sleeve identity is not canonical");
  }
  return Object.freeze({
    address, vaultConfig, expiryTs, settlementMint, settlementGroup, seriesBook, usdcVault,
    flatMint, flatSplInterface, flatStaging, flatBurnCustody, policySnapshot, policyHash, closeNonce, seriesCount,
    status, activeAuction, activeCloseRequest, auctionNonce,
    writerPrincipalAtoms: accounting[0]!, lockedPrimaryPremiumAtoms: accounting[1]!, accountedAssetAtoms: accounting[2]!,
    exactReserveAtoms: accounting[3]!, flatParSupplyAtoms: accounting[6]!, securityExposureAtoms: accounting[7]!,
  });
}

export function decodeWalletWriterSeriesBook(
  address: PublicKey,
  accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>,
): WalletWriterSeriesBook {
  const reader = writerReader(requireCurrentProgramData(accountInfos, address, 8_312, "writer series book"), "WSB");
  const sleeve = reader.pubkey();
  const settlementGroup = reader.pubkey();
  const seriesCount = reader.u8();
  const maxSeries = reader.u8();
  reader.bool();
  reader.zeroBytes(7);
  const bookDigest = hex32(reader.bytes(32));
  reader.u64();
  const allRecords = Array.from({ length: WRITER_SERIES_STORAGE_CAPACITY }, () => decodeSeriesRecord(reader));
  reader.finishZeroPadded();
  if (seriesCount > WRITER_MAX_LIVE_SERIES || maxSeries !== WRITER_MAX_LIVE_SERIES
    || allRecords.slice(seriesCount).some((record) => !record.zero)
    || !deriveWriterSeriesBook(sleeve).equals(address)) {
    invalid("writer series book identity or zero tail is invalid");
  }
  return Object.freeze({
    address,
    sleeve,
    settlementGroup,
    seriesCount,
    bookDigest,
    records: Object.freeze(allRecords.slice(0, seriesCount).map((record) => Object.freeze({
      active: record.active,
      market: record.market,
      contractMint: record.contractMint,
      retirementCustody: record.retirementCustody,
    }))),
  });
}

export function decodeWalletWriterAuction(
  address: PublicKey,
  accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>,
): WalletWriterAuction {
  const reader = writerReader(requireCurrentProgramData(accountInfos, address, 1_534, "writer auction"), "WAU");
  const sleeve = reader.pubkey();
  const seriesBook = reader.pubkey();
  const policySnapshot = reader.pubkey();
  const auctionNonce = reader.u64();
  const escrow = reader.pubkey();
  const bidIndex = reader.pubkey();
  reader.pubkey();
  reader.u64();
  reader.bytes(32 * 5);
  reader.u64();
  const bidDeadlineTs = reader.u64();
  reader.u64(); reader.u64();
  const counters = Array.from({ length: 5 }, () => reader.u16());
  reader.zeroBytes(6);
  for (let index = 0; index < 5; index += 1) reader.u64();
  reader.bytes(32);
  const status = reader.u8();
  if (status > 7) invalid("writer auction status is invalid");
  reader.zeroBytes(7);
  reader.u64();
  for (let index = 0; index < WRITER_SERIES_STORAGE_CAPACITY * 4; index += 1) reader.u64();
  reader.finishZeroPadded();
  const [bidCount, planned, executed, refunded, cursor] = counters;
  if (bidCount! > WRITER_BID_STORAGE_CAPACITY || planned! > bidCount!
    || executed! > planned! || refunded! > bidCount! || cursor! > bidCount!
    || !deriveWriterPda("writer_auction_v1", [sleeve], [u64Le(auctionNonce)]).equals(address)
    || !deriveWriterBidIndex(address).equals(bidIndex)) {
    invalid("writer auction identity or counters are invalid");
  }
  return Object.freeze({ address, sleeve, seriesBook, policySnapshot, auctionNonce, escrow, bidIndex, status, bidDeadlineTs });
}

export function decodeWalletWriterBidIndex(
  address: PublicKey,
  accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>,
): WalletWriterBidIndex {
  const reader = writerReader(requireCurrentProgramData(accountInfos, address, 14_936, "writer bid index"), "WBI");
  const auction = reader.pubkey();
  const bidCount = reader.u16();
  const planned = reader.u16();
  const executed = reader.u16();
  const refunded = reader.u16();
  const cursor = reader.u16();
  reader.bytes(32);
  reader.u64();
  const records = Array.from({ length: WRITER_BID_STORAGE_CAPACITY }, () => decodeBidIndexRecord(reader));
  reader.finishZeroPadded();
  if (bidCount > WRITER_BID_STORAGE_CAPACITY || planned > bidCount || executed > planned
    || refunded > bidCount || cursor > bidCount || records.slice(bidCount).some((record) => !record.zero)
    || !deriveWriterBidIndex(auction).equals(address)) {
    invalid("writer bid index identity, counters, or zero tail is invalid");
  }
  return Object.freeze({ address, auction, bidCount, records: Object.freeze(records.slice(0, bidCount)) });
}

export function decodeWalletWriterCloseRequest(
  address: PublicKey,
  accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>,
): WalletWriterCloseRequest {
  const reader = writerReader(requireCurrentProgramData(accountInfos, address, 1_088, "writer close request"), "WCR");
  const sleeve = reader.pubkey();
  const owner = reader.pubkey();
  const flatEscrow = reader.pubkey();
  const flatMint = reader.pubkey();
  const requestNonce = reader.u64();
  for (let index = 0; index < 9; index += 1) reader.u64();
  reader.bytes(64);
  const deadlineTs = reader.u64();
  const status = reader.u8();
  const seriesCount = reader.u8();
  const nextDeposit = reader.u8();
  const nextCancel = reader.u8();
  reader.zeroBytes(6);
  const requiredAll = Array.from({ length: WRITER_SERIES_STORAGE_CAPACITY }, () => reader.u64());
  const depositedAll = Array.from({ length: WRITER_SERIES_STORAGE_CAPACITY }, () => reader.u64());
  const externalAll = Array.from({ length: WRITER_SERIES_STORAGE_CAPACITY }, () => reader.u64());
  reader.u64();
  reader.u64();
  reader.u64();
  reader.finishZeroPadded();
  if (status > 4 || seriesCount > WRITER_MAX_LIVE_SERIES || nextDeposit > seriesCount || nextCancel > seriesCount
    || [...requiredAll.slice(seriesCount), ...depositedAll.slice(seriesCount), ...externalAll.slice(seriesCount)]
      .some((amount) => amount !== 0n)
    || !deriveWriterCloseRequest(sleeve, requestNonce).equals(address)) {
    invalid("writer close request identity, cursors, or zero tail is invalid");
  }
  return Object.freeze({
    address, sleeve, owner, flatEscrow, flatMint, requestNonce, deadlineTs, status, seriesCount,
    nextDepositIndex: nextDeposit, nextCancelIndex: nextCancel,
    requiredClaimAtoms: Object.freeze(requiredAll.slice(0, seriesCount)),
    depositedClaimAtoms: Object.freeze(depositedAll.slice(0, seriesCount)),
  });
}

interface DecodedSeriesRecord extends WalletWriterSeriesRecord {
  readonly zero: boolean;
}

function decodeSeriesRecord(reader: Reader): DecodedSeriesRecord {
  const active = reader.bool();
  const optionKind = reader.u8();
  const custodyStatus = reader.u8();
  const settlementStatus = reader.u8();
  reader.zeroBytes(4);
  const seriesId = reader.bytes(32);
  const market = reader.pubkey();
  const contractMint = reader.pubkey();
  const retirementCustody = reader.pubkey();
  const amounts = Array.from({ length: 11 }, () => reader.u64());
  const payoffDigest = reader.bytes(32);
  if (optionKind > 1 || custodyStatus > 2 || settlementStatus > 2) invalid("writer series enum is invalid");
  const zero = !active && optionKind === 0 && custodyStatus === 0 && settlementStatus === 0
    && seriesId.every((byte) => byte === 0)
    && market.equals(PublicKey.default) && contractMint.equals(PublicKey.default)
    && retirementCustody.equals(PublicKey.default) && amounts.every((amount) => amount === 0n)
    && payoffDigest.every((byte) => byte === 0);
  return Object.freeze({ active, market, contractMint, retirementCustody, zero });
}

function decodeBidIndexRecord(reader: Reader) {
  const occupied = reader.bool();
  const status = reader.u8();
  const seriesIndex = reader.u8();
  if (reader.u8() !== 0 || status > 6) invalid("writer bid-index record is invalid");
  const amounts = Array.from({ length: 5 }, () => reader.u64());
  const bid = reader.pubkey();
  const bidder = reader.pubkey();
  const orderId = reader.u64();
  return Object.freeze({
    occupied, status, bid, bidder, orderId,
    zero: !occupied && status === 0 && seriesIndex === 0 && amounts.every((amount) => amount === 0n)
      && bid.equals(PublicKey.default) && bidder.equals(PublicKey.default) && orderId === 0n,
  });
}

export function decodeWalletWriterBid(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>) {
  const reader = writerReader(requireCurrentProgramData(accountInfos, address, 230, "writer bid"), "WBD");
  const auction = reader.pubkey(); const bidder = reader.pubkey(); const refundTokenAccount = reader.pubkey();
  reader.pubkey(); const orderId = reader.u64(); const seriesIndex = reader.u8(); const status = reader.u8();
  const deliveryMode = reader.u8(); reader.zeroBytes(5);
  reader.u64(); reader.u64(); reader.u64(); reader.u64();
  const escrowedAtoms = reader.u64(); const premiumChargedAtoms = reader.u64(); const feeChargedAtoms = reader.u64(); const refundedAtoms = reader.u64();
  reader.u64(); reader.u64(); reader.finishZeroPadded();
  if (status > 6 || deliveryMode > 1 || seriesIndex >= WRITER_MAX_LIVE_SERIES || orderId === 0n
    || !deriveWriterBid(auction, bidder, orderId).equals(address)
    || premiumChargedAtoms + feeChargedAtoms + refundedAtoms > escrowedAtoms) invalid("writer bid identity/accounting mismatch");
  return Object.freeze({ address, auction, bidder, refundTokenAccount, orderId, seriesIndex, status,
    refundableAtoms: escrowedAtoms - premiumChargedAtoms - feeChargedAtoms - refundedAtoms });
}

class Reader {
  readonly data: Uint8Array;
  offset = 0;

  constructor(data: Uint8Array) { this.data = data; }

  bytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      invalid("writer account is truncated");
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  zeroBytes(length: number): void {
    if (this.bytes(length).some((byte) => byte !== 0)) invalid("writer account reserved bytes are nonzero");
  }

  u8(): number { return this.bytes(1)[0]!; }
  bool(): boolean {
    const value = this.u8();
    if (value > 1) invalid("writer bool is invalid");
    return value === 1;
  }
  u16(): number {
    const value = readU16Le(this.data, this.offset);
    this.offset += 2;
    return value;
  }
  u64(): bigint {
    const value = readU64Le(this.data, this.offset);
    this.offset += 8;
    return value;
  }
  pubkey(): PublicKey { return new PublicKey(this.bytes(32)); }
  optionalPubkey(): PublicKey | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag === 1) return this.pubkey();
    invalid("optional writer public key tag is invalid");
  }
  finishZeroPadded(): void {
    if (this.data.subarray(this.offset).some((byte) => byte !== 0)) invalid("writer account padding is nonzero");
    this.offset = this.data.length;
  }
}

export { Reader as WalletWriterAccountReader };

function writerReader(data: Uint8Array, discriminator: string): Reader {
  const reader = new Reader(data);
  if (!reader.bool()) invalid("writer account is uninitialized");
  reader.u8();
  const actual = String.fromCharCode(...reader.bytes(3));
  if (actual !== discriminator || reader.u8() !== 1) invalid("writer account discriminator/version is invalid");
  return reader;
}

function invalid(message: string): never {
  walletError("CURRENT_WALLET_ACCOUNT_INVALID", message);
}

function hex32(bytes: Uint8Array): string {
  if (bytes.length !== 32) invalid("writer commitment is not 32 bytes");
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
