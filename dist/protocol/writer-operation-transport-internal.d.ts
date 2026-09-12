/** One source object shared with Rust include_str!, never caller policy. */
export declare const WRITER_OPERATION_TRANSPORT_V1: Readonly<{
    instructionTags: readonly number[];
    setupInstructionDataBase64: readonly string[];
    schemaVersion: number;
    preset: string;
    writerPlanSchemaVersion: number;
    setupMode: string;
    setupProgramId: string;
    setupAccountCount: number;
    setupSignerRoleCount: number;
    actionBatchIndex: number;
    actionInstructionCount: number;
}>;
export declare const WRITER_OPERATION_TRANSPORT_SHA256_V1: string;
export declare function isExactWriterOperationTransportV1(value: unknown): boolean;
//# sourceMappingURL=writer-operation-transport-internal.d.ts.map