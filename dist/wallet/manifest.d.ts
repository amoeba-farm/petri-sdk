/** Portable-manifest decoding and browser-native RC44 address primitives. */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
export declare const CURRENT_PROGRAM_ID: PublicKey;
export declare const SYSTEM_PROGRAM_ID: PublicKey;
export declare const COMPUTE_BUDGET_PROGRAM_ID: PublicKey;
export declare const SPL_TOKEN_PROGRAM_ID: PublicKey;
export declare const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey;
export declare const LIGHT_TOKEN_PROGRAM_ID: PublicKey;
export declare const LIGHT_TOKEN_CPI_AUTHORITY: PublicKey;
export declare const LIGHT_TOKEN_COMPRESSIBLE_CONFIG: PublicKey;
export declare const LIGHT_TOKEN_RENT_SPONSOR: PublicKey;
export declare const LIGHT_SYSTEM_PROGRAM: PublicKey;
export declare const LIGHT_REGISTERED_PROGRAM: PublicKey;
export declare const LIGHT_COMPRESSION_AUTHORITY: PublicKey;
export declare const LIGHT_COMPRESSION_PROGRAM: PublicKey;
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
export declare function decodeInstructionManifest(value: unknown, label: string, options?: {
    readonly instructionTag?: "required" | "forbidden";
}): CurrentWalletInstructionManifest;
export declare function manifestInstruction(manifest: CurrentWalletInstructionManifest): TransactionInstruction;
export declare function sameInstruction(actual: TransactionInstruction, expected: TransactionInstruction): boolean;
export declare function requireExactInstruction(actual: TransactionInstruction, expected: TransactionInstruction, label: string): void;
export declare function requireFlags(manifest: CurrentWalletInstructionManifest, flags: readonly (readonly [boolean, boolean])[], label: string): void;
export declare function requireAddress(manifest: CurrentWalletInstructionManifest, index: number, expected: PublicKey | string, label: string): void;
export declare function requireWriteSet(value: unknown, manifests: readonly CurrentWalletInstructionManifest[], label: string): readonly string[];
export declare function pubkey(value: unknown, label: string): PublicKey;
export declare function deriveWriterPda(seed: string, keys: readonly PublicKey[], extra?: readonly Uint8Array[]): PublicKey;
export declare function deriveWriterFlatMint(sleeve: PublicKey): PublicKey;
export declare function deriveWriterSleeveUsdcVault(sleeve: PublicKey): PublicKey;
export declare function deriveWriterFlatStaging(sleeve: PublicKey): PublicKey;
export declare function deriveWriterFlatBurnCustody(sleeve: PublicKey): PublicKey;
export declare function deriveWriterSeriesBook(sleeve: PublicKey): PublicKey;
export declare function deriveWriterSleeve(group: PublicKey): PublicKey;
export declare function deriveWriterBidIndex(auction: PublicKey): PublicKey;
export declare function deriveWriterBid(auction: PublicKey, bidder: PublicKey, orderId: bigint): PublicKey;
export declare function deriveWriterCloseRequest(sleeve: PublicKey, nonce: bigint): PublicKey;
export declare function deriveWriterCloseFlatEscrow(request: PublicKey): PublicKey;
export declare function deriveWriterRetirementCustody(sleeve: PublicKey, market: PublicKey): PublicKey;
export declare function deriveClassicAta(mint: PublicKey, owner: PublicKey): PublicKey;
export declare function deriveLightAta(mint: PublicKey, owner: PublicKey): PublicKey;
export declare function deriveLightSplInterface(mint: PublicKey): PublicKey;
export declare function deriveDlmmPool(market: PublicKey): PublicKey;
export declare function deriveDlmmAuthority(pool: PublicKey): PublicKey;
export declare function deriveDlmmBinPage(pool: PublicKey, pageIndex: number): PublicKey;
export declare function buildCreateLightAta(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction;
export declare function requireCanonicalComputeBudget(instruction: TransactionInstruction): void;
export declare function requireCanonicalLightTransfer2(instruction: TransactionInstruction, payer: PublicKey, owner: PublicKey, mint: PublicKey, target: PublicKey): void;
export declare function requireCanonicalSetupBatch(input: {
    readonly batch: readonly TransactionInstruction[];
    readonly payer: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
    readonly target: PublicKey;
    readonly requireCreate: boolean;
}): void;
export declare function requireCanonicalSwapPdas(input: {
    readonly group: PublicKey;
    readonly sleeve: PublicKey;
    readonly book: PublicKey;
    readonly market: PublicKey;
    readonly pool: PublicKey;
    readonly authority: PublicKey;
    readonly pageIndices: readonly number[];
    readonly pages: readonly string[];
}): void;
export declare function readManifestU16(manifest: CurrentWalletInstructionManifest, offset: number): number;
//# sourceMappingURL=manifest.d.ts.map