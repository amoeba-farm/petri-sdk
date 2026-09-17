import { Buffer } from "buffer";
import { type Connection, type TransactionInstruction } from "@solana/web3.js";
import { type OracleCouncilInstructionInput } from "@amoeba/spread-release-tools/oracle-council";
import type { CurrentGovernedBuilderInputV1, CurrentGovernedBuilderNameV1 } from "../protocol/current-governed-write.js";
export declare const G3_INTEGRATION_LOCK: Readonly<{
    schema: string;
    businessGeneration: number;
    controllerAbi: number;
    governanceTailVersion: number;
    spread: {
        sourceCommit: string;
        packagePath: string;
        packageSha256: string;
        packageBytes: number;
        elfSha256: string;
        elfBytes: number;
        sbfArchitecture: string;
        sourceTree: string;
        instructionManifestSha256: string;
        importedBuildReceipt: string;
        importedBuildReceiptSha256: string;
    };
    profile: {
        kind: string;
        production: null;
        profileSha256: string;
        clusterDomain: string;
        genesisHash: string;
        programId: string;
        controllerProgramId: string;
        controllerConfig: string;
        gate: string;
        collateralMint: string;
        profileFile: string;
    };
    observedDeployment: null;
    schemas: {
        membershipCursor: number;
        orderCursor: number;
        durableJournal: number;
        sourceRegistry: number;
        publicPlan: number;
        finalizedObservationFrame: number;
    };
    fees: {
        tradingBps: number;
        lpBps: number;
        protocolBps: number;
        writerPrimaryBps: number;
    };
    retiredTags: number[];
    qualification: {
        allIntegrationCasesPassed: boolean;
        productionProfile: boolean;
    };
    historicalV2Archive: {
        path: string;
        sha256: string;
        transform: string;
        sourceCommit: string;
    };
}>;
export interface G3CandidateContext {
    readonly kind: "g3-local-candidate" | "g3-mainnet";
    readonly observedSlot: number;
    readonly epoch: string;
}
/** Only the installed local-test tuple is selectable until a production lock is reviewed. */
export declare function observeG3Candidate(connection: Connection, minimumContextSlot: number): Promise<G3CandidateContext>;
export declare function inspectG3CandidateInstructions(candidate: G3CandidateContext, instructions: readonly TransactionInstruction[]): Readonly<{
    generation: 3;
    family: import("./browser.js").G3OperationFamily;
    action: string;
    tag: number;
    businessData: Buffer<ArrayBuffer>;
    accounts: readonly import("@solana/web3.js").AccountMeta[];
    quantities: Readonly<Record<string, string>>;
    protocolFeeAtoms: "0";
}>[];
/** Uses the same private official-builder registry; never caller-supplied encoder code. */
export declare function buildG3CandidateInstruction<Name extends CurrentGovernedBuilderNameV1>(input: {
    context: G3CandidateContext;
    builderName: Name;
    builderInput: CurrentGovernedBuilderInputV1<Name>;
}): readonly TransactionInstruction[];
export declare function buildG3CouncilInstruction(input: Omit<OracleCouncilInstructionInput, "context"> & {
    candidate: G3CandidateContext;
}): TransactionInstruction;
/** Re-observe exact executable and gate before signing; an epoch change requires a new message. */
export declare function revalidateG3Candidate(connection: Connection, candidate: G3CandidateContext): Promise<G3CandidateContext>;
/** Exact production observation; frozen gates never mint a builder context. */
export declare function observeG3Mainnet(connection: Connection, minimumContextSlot?: number): Promise<G3CandidateContext>;
//# sourceMappingURL=runtime.d.ts.map