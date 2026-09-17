import { Buffer } from "buffer";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { CurrentGovernedBuilderInputV1 } from "../protocol/current-governed-write.js";
declare const builders: {
    readonly receipt_contribute: "buildContributeWriterInstruction";
    readonly receipt_transfer: "buildTransferWriterContributionInstruction";
    readonly receipt_split: "buildSplitWriterContributionInstruction";
    readonly receipt_claim: "buildClaimWriterContributionInstruction";
    readonly receipt_close: "buildCloseWriterContributionInstruction";
    readonly receipt_expire: "buildExpireUnactivatedWriterV3Instruction";
    readonly order: "buildDlmmOrderInstruction";
};
export type G3UserOperation = keyof typeof builders;
export type G3OperationInput = {
    [K in G3UserOperation]: {
        operation: K;
        builderInput: Omit<CurrentGovernedBuilderInputV1<(typeof builders)[K]>, "programId">;
    };
}[G3UserOperation];
export interface G3OperationPlan {
    schemaVersion: 3;
    operation: G3UserOperation;
    owner: string;
    profileSha256: string;
    sourceCommit: string;
    epoch: string;
    observedSlot: number;
    blockhash: string;
    lastValidBlockHeight: number;
    serializedTransactionBase64: string;
    messageSha256: string;
    preparedPlanDigest: string;
    operationId: string;
    lookupTable?: {
        address: string;
        dataBase64: string;
    };
}
/** Typed canonical construction. The host must admit observed business state before calling. */
export declare function prepareG3UserOperation(connection: Connection, owner: PublicKey, input: G3OperationInput, minimumContextSlot: number, lookupTableAddress?: PublicKey, network?: "local-test" | "mainnet-beta"): Promise<Readonly<G3OperationPlan>>;
/** Revalidate an already admitted durable plan; a plan hash is not business admission. */
export declare function revalidateG3UserOperation(connection: Connection, plan: G3OperationPlan, signedTransactionBase64: string): Promise<Readonly<{
    validated: true;
    finalizedObservationSlot: number;
    owner: string;
    signatureBytes: Buffer<ArrayBuffer>;
}>>;
export {};
//# sourceMappingURL=operations.d.ts.map