import { Buffer } from "buffer";
import { VersionedTransaction, type Connection } from "@solana/web3.js";
import type { G3OperationPlan, G3UserOperation } from "./operations.js";
export interface MainnetG3ExpectedIntent {
    readonly owner: string;
    readonly operation: G3UserOperation;
    readonly request: unknown;
}
/** Reconstruct from the original UI intent and fresh chain bytes, never backend metas. Does not sign. */
export declare function materializeMainnetG3Plan(input: {
    connection: Connection;
    plan: G3OperationPlan;
    expected: MainnetG3ExpectedIntent;
}): Promise<Readonly<{
    transaction: VersionedTransaction;
    messageBytes: Uint8Array<ArrayBufferLike> | Buffer<ArrayBufferLike>;
    owner: string;
    operation: "receipt_contribute" | "receipt_transfer" | "receipt_split" | "receipt_claim" | "receipt_close" | "receipt_expire" | "order";
    operationId: string;
    preparedPlanDigest: string;
    messageSha256: string;
    validateSignedTransaction: (signedBase64: string) => Promise<Readonly<{
        owner: string;
        signatureBytes: Buffer<ArrayBuffer>;
    }>>;
}>>;
//# sourceMappingURL=mainnet-browser.d.ts.map