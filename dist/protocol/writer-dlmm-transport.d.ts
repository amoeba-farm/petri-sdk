import { TransactionInstruction } from "@solana/web3.js";
/** Candidate construction limits only. No measured compute or packet qualification is claimed. */
export declare const CURRENT_WRITER_DLMM_TRANSPORT_V1: Readonly<{
    setupInstructionNames: readonly string[];
    setupInstructionDataBase64: readonly string[];
    schemaVersion: number;
    preset: string;
    qualified: boolean;
    writerPlanSchemaVersion: number;
    setupMode: string;
    instructionTag: number;
    heapFrameBytes: number;
    computeUnitLimit: number;
    setupProgramId: string;
    setupAccountCount: number;
    setupSignerRoleCount: number;
    actionBatchIndex: number;
    actionInstructionCount: number;
    maximumTransactionBytes: number;
    maximumLookupTables: number;
    maximumLookupAddresses: number;
}>;
export declare const WRITER_DLMM_TRANSPORT_SHA256_V1: string;
/** Exact construction preset binding; the qualified field does not attest measured compute. */
export declare function isExactWriterDlmmTransportV1(value: unknown): boolean;
export declare function currentWriterDlmmComputeInstructions(): readonly TransactionInstruction[];
//# sourceMappingURL=writer-dlmm-transport.d.ts.map