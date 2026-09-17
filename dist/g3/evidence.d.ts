import { Buffer } from "buffer";
import { type Connection, type PublicKey } from "@solana/web3.js";
import { type OracleEvidenceKind } from "@amoeba/spread-release-tools/oracle-evidence";
/** Re-read the actual draft before selecting one upload. This never signs future chunks. */
export declare function prepareNextG3EvidenceUpload(input: {
    connection: Pick<Connection, "getAccountInfo">;
    programId: PublicKey;
    payer: PublicKey;
    kind: OracleEvidenceKind;
    bytes: Uint8Array;
}): Promise<Readonly<{
    address: PublicKey;
    commitment: Buffer<ArrayBufferLike>;
    writtenBytes: number;
    totalBytes: number;
    complete: boolean;
    instruction: import("@solana/web3.js").TransactionInstruction | null;
}>>;
//# sourceMappingURL=evidence.d.ts.map