/** Minimal browser-native RC44 writer account decoders used before wallet compilation. */
import { PublicKey, type AccountInfo } from "@solana/web3.js";
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
    readonly records: readonly {
        readonly occupied: boolean;
        readonly status: number;
        readonly bid: PublicKey;
        readonly bidder: PublicKey;
        readonly orderId: bigint;
    }[];
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
export declare function requireCurrentProgramData(accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>, address: PublicKey, expectedLength: number, label: string): Uint8Array;
export declare function decodeWalletWriterSleeve(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): WalletWriterSleeve;
export declare function decodeWalletWriterSeriesBook(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): WalletWriterSeriesBook;
export declare function decodeWalletWriterAuction(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): WalletWriterAuction;
export declare function decodeWalletWriterBidIndex(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): WalletWriterBidIndex;
export declare function decodeWalletWriterCloseRequest(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): WalletWriterCloseRequest;
export declare function decodeWalletWriterBid(address: PublicKey, accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>): Readonly<{
    address: PublicKey;
    auction: PublicKey;
    bidder: PublicKey;
    refundTokenAccount: PublicKey;
    orderId: bigint;
    seriesIndex: number;
    status: number;
    refundableAtoms: bigint;
}>;
declare class Reader {
    readonly data: Uint8Array;
    offset: number;
    constructor(data: Uint8Array);
    bytes(length: number): Uint8Array;
    zeroBytes(length: number): void;
    u8(): number;
    bool(): boolean;
    u16(): number;
    u64(): bigint;
    pubkey(): PublicKey;
    optionalPubkey(): PublicKey | null;
    finishZeroPadded(): void;
}
export { Reader as WalletWriterAccountReader };
//# sourceMappingURL=writer-accounts.d.ts.map