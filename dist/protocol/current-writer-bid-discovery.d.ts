/** Candidate-only historical bid discovery. Lean owns finalized refund eligibility. */
import { type GetProgramAccountsFilter } from "@solana/web3.js";
/** Current native filters do not limit auctions to sleeve.activeAuction or establish refundability. */
export declare function currentWriterRefundDiscoveryFilters(ownerPubkey: string): readonly GetProgramAccountsFilter[];
//# sourceMappingURL=current-writer-bid-discovery.d.ts.map