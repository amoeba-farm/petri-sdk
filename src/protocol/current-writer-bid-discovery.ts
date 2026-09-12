/** Candidate-only historical bid discovery. Lean owns finalized refund eligibility. */
import { PublicKey, type GetProgramAccountsFilter } from "@solana/web3.js";
import * as nativeWriterAccounts from "@amoeba/spread-release-tools/writer-sleeve-accounts";

interface WriterBidFilterLayout {
  readonly dataSize: number; readonly initializedOffset: number;
  readonly discriminatorOffset: number; readonly discriminator: string;
  readonly accountVersionOffset: number; readonly accountVersion: number;
  readonly auctionOffset: number; readonly bidderOffset: number;
}

/** Current native filters do not limit auctions to sleeve.activeAuction or establish refundability. */
export function currentWriterRefundDiscoveryFilters(ownerPubkey: string): readonly GetProgramAccountsFilter[] {
  const owner = new PublicKey(ownerPubkey);
  if (owner.toBase58() !== ownerPubkey || owner.equals(PublicKey.default)) throw new Error("Canonical writer bid owner required");
  const layout = (nativeWriterAccounts as unknown as {
    readonly WRITER_BID_ACCOUNT_FILTER_LAYOUT?: WriterBidFilterLayout;
  }).WRITER_BID_ACCOUNT_FILTER_LAYOUT;
  if (!layout || !Number.isSafeInteger(layout.dataSize) || layout.dataSize < 1
    || ![layout.initializedOffset, layout.discriminatorOffset, layout.accountVersionOffset, layout.auctionOffset, layout.bidderOffset]
      .every(offset => Number.isSafeInteger(offset) && offset >= 0)
    || !/^[A-Z]{3}$/.test(layout.discriminator) || layout.accountVersionOffset !== layout.discriminatorOffset + 3
    || !Number.isInteger(layout.accountVersion) || layout.accountVersion < 1 || layout.accountVersion > 255
    || layout.initializedOffset >= layout.dataSize || layout.accountVersionOffset >= layout.dataSize
    || layout.auctionOffset + 32 > layout.dataSize || layout.bidderOffset + 32 > layout.dataSize) {
    throw new Error("Current native writer bid discovery layout unavailable");
  }
  // Combine contiguous discriminator/version to stay within the standard four-filter RPC bound.
  const discriminatorAndVersion = Buffer.concat([Buffer.from(layout.discriminator, "ascii"), Buffer.from([layout.accountVersion])]);
  return Object.freeze([
    Object.freeze({ dataSize: layout.dataSize }),
    Object.freeze({ memcmp: Object.freeze({ offset: layout.initializedOffset, bytes: "AQ==", encoding: "base64" as const }) }),
    Object.freeze({ memcmp: Object.freeze({ offset: layout.discriminatorOffset, bytes: discriminatorAndVersion.toString("base64"), encoding: "base64" as const }) }),
    Object.freeze({ memcmp: Object.freeze({ offset: layout.bidderOffset, bytes: owner.toBase58() }) }),
  ]);
}
