import { Buffer } from "buffer";
export { materializeMainnetG3Plan, type MainnetG3ExpectedIntent } from "./mainnet-browser.js";
export { validateG3SignedMessage } from "./transaction.js";
import { type TransactionInstruction } from "@solana/web3.js";
export declare const G3_ORDER_COMPUTE_UNITS = 1000000;
/** Exact zero-priority-fee compute prefix for the bounded order route. */
export declare function g3BusinessInstructions(operation: string, instructions: readonly TransactionInstruction[]): readonly TransactionInstruction[];
import { type GovernanceGateContextV1 } from "@amoeba/spread-release-tools/governance-gate";
export type G3OperationFamily = "public-order" | "writer-receipt" | "oracle-council" | "oracle-evidence" | "current-protocol";
/** Inspect the authenticated business view, preserving the AMG3/AGV1 separation. */
export declare function inspectG3Instruction(instruction: TransactionInstruction, context: GovernanceGateContextV1): Readonly<{
    generation: 3;
    family: G3OperationFamily;
    action: string;
    tag: number;
    businessData: Buffer<ArrayBuffer>;
    accounts: readonly import("@solana/web3.js").AccountMeta[];
    quantities: Readonly<Record<string, string>>;
    protocolFeeAtoms: "0";
}>;
//# sourceMappingURL=browser.d.ts.map