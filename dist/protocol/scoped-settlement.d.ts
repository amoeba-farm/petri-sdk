/** Source-owned decoding of wallet/position settlement capabilities. No signing or policy decisions. */
import { Buffer } from "buffer";
import { PublicKey, type AccountInfo, type Connection, type TransactionInstruction } from "@solana/web3.js";
export declare function decodeCurrentScopedLongAuthorization(input: {
    address: PublicKey;
    account: AccountInfo<Buffer>;
    programId: PublicKey;
}): {
    owner: string;
    mint: string;
    amountAtoms: string;
    authority: string;
};
export declare function decodeCurrentScopedPositionAuthorization(input: {
    address: PublicKey;
    account: AccountInfo<Buffer>;
    programId: PublicKey;
}): {
    owner: string;
    pool: string;
    position: string;
    authority: string;
};
/** Finalized, bounded inventory. Capability presence is reread again before keeper signing. */
export declare function discoverCurrentScopedSettlements(input: {
    connection: Connection;
    programId: PublicKey;
}): Promise<{
    longs: {
        kind: "long_claim";
        owner: string;
        target: string;
        expiryUnixSeconds: string;
        request: {
            owner: string;
            sleeve: string;
            claimVariant: "collective_long";
            seriesIndex: number;
            amountAtoms: string;
        };
    }[];
    positions: {
        owner: string;
        pool: string;
        position: string;
        authority: string;
    }[];
}>;
/** Converts an already-admitted canonical manual claim into native scoped-builder arguments. */
export declare function currentScopedCollectiveBuilderInput(instruction: TransactionInstruction, keeper: PublicKey): {
    keeper: PublicKey;
};
//# sourceMappingURL=scoped-settlement.d.ts.map