import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AmebaProtocolError } from "../errors.js";
/** Exact Light Token v0.23.3 idempotent compressible-ATA create bytes. */
export declare const CURRENT_LIGHT_CREATE_ATA_IDEMPOTENT_DATA: readonly [102, 1, 3, 16, 1, 254, 2, 0, 0, 0];
/** SDK-owned native builder shared by Flat transfer and writer cancellation. */
export declare function buildCurrentCreateLightAtaIdempotentInstruction(input: {
    readonly payer: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
}): TransactionInstruction;
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
export declare class CurrentLightRebridgeValidationError extends AmebaProtocolError {
    constructor(message: string);
}
/**
 * Re-bridges a ClassicSpl writer-bid delivery into the same bidder's canonical
 * Light ATA. This is the exact Light Token v0.23.3 TransferInterface SPL-to-Light
 * route used by Spread. The builder neither reads nor validates a WriterBid;
 * callers using it for Writer pickup pass that bid's stored destination as the
 * source. It does not alter or restrict the bid's delivery mode or destination.
 */
export declare function buildCurrentClassicSplToLightAtaRebridgeV1(input: BuildCurrentClassicSplToLightAtaRebridgeV1Input): CurrentClassicSplToLightAtaRebridgeV1;
//# sourceMappingURL=current-light-token-instructions.d.ts.map