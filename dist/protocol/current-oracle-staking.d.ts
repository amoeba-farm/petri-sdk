/** Finalized canonical staking reads and native economic planning; no transaction execution. */
import { PublicKey, type Connection } from "@solana/web3.js";
import * as native from "@amoeba/spread-historical-v2/oracle-dlmm";
import { type CurrentOracleActionRequest } from "./current-oracle-public.js";
export type CurrentOracleStakingRequest = Extract<CurrentOracleActionRequest, {
    readonly actionType: "queue_stake_amba_for_samba" | "activate_queued_stake_amba_for_samba" | "request_unstake_samba" | "complete_unstake_samba";
}>;
type StakingAction = {
    readonly kind: "queue";
    readonly ambaAmount: bigint;
} | {
    readonly kind: "activate";
    readonly minSambaOut: bigint;
} | {
    readonly kind: "request_unstake";
    readonly sambaAmount: bigint;
    readonly minAmbaOut: bigint;
} | {
    readonly kind: "complete_unstake";
};
interface NativeStakingInput {
    readonly action: StakingAction;
    readonly owner: PublicKey;
    readonly currentUnixTimestamp: bigint;
    readonly playerLedger: ReturnType<typeof native.decodeOraclePlayerLedgerBalance> | null;
    readonly stakingPool: ReturnType<typeof native.decodeOracleStakingPool>;
    readonly stakeActivation: ReturnType<typeof native.decodeOracleStakeActivation> | null;
    readonly unstakeRequest: ReturnType<typeof native.decodeOracleUnstakeRequest> | null;
    readonly sambaMintSupply: bigint;
    readonly ownerSambaBalance: bigint;
    readonly rewardFunnelBalance: bigint;
}
interface NativeStakingPlan {
    readonly instructionTag: 138 | 139 | 131 | 133;
    readonly expectedAmbaAmount: bigint;
    readonly expectedSambaAmount: bigint;
    readonly earliestExecutionTs: bigint;
}
export interface CurrentOracleStakingAccountFact {
    readonly address: string;
    readonly owner: string | null;
    readonly executable: boolean | null;
    readonly dataBase64: string | null;
    readonly dataSha256: string | null;
    readonly observedSlot: number;
}
export interface ReadCurrentOracleStakingStateInput {
    readonly connection: Connection;
    readonly programId: PublicKey;
    readonly request: CurrentOracleStakingRequest;
    readonly minimumContextSlot?: number;
}
export interface CurrentOracleStakingState {
    readonly request: CurrentOracleStakingRequest;
    readonly readWindowStartSlot: number;
    readonly readWindowEndSlot: number;
    readonly currentUnixTimestamp: string;
    readonly accountFacts: readonly CurrentOracleStakingAccountFact[];
    readonly nativeInput: NativeStakingInput;
    readonly ambaMint: PublicKey | null;
    readonly ownerSambaTokenAccount: PublicKey;
}
/** Each optional record is authenticated classic absence; failed reads throw. No global pause predicate. */
export declare function readCurrentOracleStakingState(input: ReadCurrentOracleStakingStateInput): Promise<CurrentOracleStakingState>;
export declare function prepareCurrentOracleStakingAction(input: ReadCurrentOracleStakingStateInput): Promise<Readonly<{
    state: CurrentOracleStakingState;
    nativePlan: NativeStakingPlan;
    instruction: import("@solana/web3.js").TransactionInstruction;
}>>;
export {};
//# sourceMappingURL=current-oracle-staking.d.ts.map