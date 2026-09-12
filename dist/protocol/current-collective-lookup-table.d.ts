import { AddressLookupTableAccount, type AccountInfo } from "@solana/web3.js";
import type { CurrentFinalizedObservation } from "../current-finalized-observation.js";
/** One exact raw ALT account; its owner, length, hash and slot bind through the finalized frame. */
export interface CurrentCollectiveLookupTableWitnessV1 {
    readonly address: string;
    readonly dataBase64: string;
}
export declare function decodeCurrentCollectiveLookupTableV1(value: unknown, observation: CurrentFinalizedObservation, fresh?: {
    readonly observedSlot: number;
    readonly accountInfos: ReadonlyMap<string, AccountInfo<Uint8Array> | null>;
}): {
    readonly witness: CurrentCollectiveLookupTableWitnessV1;
    readonly account: AddressLookupTableAccount;
};
//# sourceMappingURL=current-collective-lookup-table.d.ts.map