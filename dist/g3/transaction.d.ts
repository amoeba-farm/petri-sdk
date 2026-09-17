import { Buffer } from "buffer";
/** Browser-safe exact-message/signature check. Expected bytes must come from independent review. */
export declare function validateG3SignedMessage(expected: {
    serializedTransactionBase64: string;
    owner: string;
    blockhash: string;
}, signedTransactionBase64: string): Promise<Readonly<{
    owner: string;
    signatureBytes: Buffer<ArrayBuffer>;
}>>;
//# sourceMappingURL=transaction.d.ts.map