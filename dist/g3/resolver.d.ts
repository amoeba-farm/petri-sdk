import { type Connection } from "@solana/web3.js";
import type { G3OperationInput, G3UserOperation } from "./operations.js";
export interface G3RawAccount {
    address: string;
    owner: string;
    executable: boolean;
    dataBase64: string;
    observedSlot: number;
}
export interface G3ResolvedIntent {
    input: G3OperationInput;
    observedSlot: number;
    rawAccounts: G3RawAccount[];
}
/** Public intents contain addresses and canonical decimal scalars, never decoded pool/receipt facts. */
export declare function resolveG3UserIntent(connection: Connection, ownerText: string, operation: G3UserOperation, request: unknown, minimumContextSlot?: number, network?: "local-test" | "mainnet-beta"): Promise<G3ResolvedIntent>;
//# sourceMappingURL=resolver.d.ts.map