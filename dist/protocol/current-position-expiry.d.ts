import { type CurrentAdapterContextInput } from "./current-adapter.js";
export interface CurrentPositionExpiryState {
    readonly stateNamespace: "ameba-spread-v2";
    readonly markets: readonly {
        readonly address: string;
        readonly marketId: string;
        readonly expiryId: string;
    }[];
    readonly issues?: readonly string[];
    readonly pools: readonly {
        readonly address: string;
        readonly marketAddress: string;
    }[];
}
export interface ReadCurrentPositionExpiryAutomationInput extends CurrentAdapterContextInput {
    /** Discovery scope only. Position, pool, and settlement facts are independently reread. */
    readonly state: CurrentPositionExpiryState;
    readonly owner: string;
    readonly automationId?: string;
}
export interface CurrentPositionExpiryRecord {
    readonly automationId: string;
    readonly owner: string;
    readonly position: string;
    readonly positionNonce: string;
    readonly market: string;
    readonly marketId: string;
    readonly expiryId: string;
    readonly pool: string;
    readonly oracleMonth: string;
    readonly expiryTs: string;
    readonly poolStatus: string;
    readonly liquidityManager: string;
    readonly poolSourceState: "hot" | "cold";
    readonly sourceState: "hot" | "cold";
    readonly shares: readonly {
        readonly binId: number;
        readonly shares: string;
    }[];
    readonly totalShares: string;
    readonly settlementExists: boolean;
    readonly settlementFinal: boolean;
    readonly settlementRecord: string | null;
    readonly nextAction: "await_expiry" | "await_settlement" | "settle_pool" | "remove_liquidity" | "close_position" | "pool_closed";
    readonly instructionTag: 210 | 255 | null;
    readonly planningSupported: true;
    readonly executionSupported: false;
    readonly requiresMinimumOutputs: boolean;
    readonly blockers: readonly string[];
}
export interface CurrentPositionExpiryProjection {
    readonly stateNamespace: "ameba-spread-v2";
    readonly mode: "planning_only";
    readonly owner: string;
    readonly commitment: "finalized";
    readonly readWindowStartSlot: string;
    readonly readWindowEndSlot: string;
    readonly observedBlockTimeUnixSeconds: string;
    readonly complete: boolean;
    readonly records: readonly CurrentPositionExpiryRecord[];
    readonly record: CurrentPositionExpiryRecord | null;
    readonly readiness: {
        readonly ready: false;
        readonly planningSupported: true;
        readonly executionSupported: false;
        readonly blockers: readonly string[];
    } | null;
    readonly scheduler: {
        readonly enabled: false;
        readonly mode: "planning_only";
        readonly recordCount: number;
    };
    readonly issues: readonly {
        readonly pool: string | null;
        readonly code: string;
    }[];
}
/** Reads a bounded, explicitly supplied pool scope; an incomplete read is never reported as an empty complete portfolio. */
export declare function readCurrentPositionExpiryAutomation(input: ReadCurrentPositionExpiryAutomationInput): Promise<CurrentPositionExpiryProjection>;
export interface SyncCurrentPositionExpiryAutomationInput extends ReadCurrentPositionExpiryAutomationInput {
    readonly request?: {
        readonly owner?: string;
        readonly automationId?: string;
    };
}
/** Refresh planning only. No on-chain expiry executor or durable scheduler is installed by this SDK call. */
export declare function syncCurrentPositionExpiryAutomation(input: SyncCurrentPositionExpiryAutomationInput): Promise<CurrentPositionExpiryProjection & {
    readonly applied: false;
    readonly reason: "CURRENT_EXPIRY_EXECUTOR_UNCONFIGURED";
}>;
//# sourceMappingURL=current-position-expiry.d.ts.map