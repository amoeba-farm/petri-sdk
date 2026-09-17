import { Buffer } from "buffer";
import { type Connection, type PublicKey } from "@solana/web3.js";
export interface G3MembershipCursor {
    readonly version: 3;
    readonly scope: string;
    readonly nextPage: number;
    readonly minimumSlot: number;
}
/** Bounded read continuation. A returned prefix is never a complete median/rank witness. */
export declare function readG3MembershipPage(input: {
    connection: Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfoAndContext">;
    programId: PublicKey;
    genesisHash: string;
    oracleMonth: PublicKey;
    bucketId: Uint8Array;
    expectedRecipeHash: Uint8Array;
    expectedManifestHash: Uint8Array;
    minimumSlot: number;
    cursor?: G3MembershipCursor;
    pagesPerRead?: number;
}): Promise<Readonly<{
    sourceIds: readonly Buffer<ArrayBufferLike>[];
    sourceCount: number;
    firstPage: number;
    atEnd: boolean;
    membershipComplete: boolean;
    cursor: G3MembershipCursor | null;
    observedSlot: number;
}>>;
//# sourceMappingURL=membership.d.ts.map