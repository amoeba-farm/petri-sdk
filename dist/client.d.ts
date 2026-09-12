import { type CurrentWriterLiquidityPolicyBeginRequest, type CurrentWriterLiquidityPolicyAppendRequest, type CurrentWriterLiquidityPolicySealRequest } from "./protocol/writer-dlmm-public.js";
import { type CurrentWriterLiquidityInitializeRequest, type CurrentWriterLiquidityAddRequest, type CurrentWriterLiquidityRemoveRequest, type CurrentWriterLiquiditySweepRequest } from "./protocol/writer-dlmm-public.js";
import type { CurrentWriterRefundPrepareRequest, CurrentWriterWithdrawalPrepareRequest, CurrentWriterFundsPrepareResponse, CurrentWriterRefundsRequest, CurrentWriterRefundsResponse } from "./types.js";
import type { CurrentWriterLiquidityReadRequest, CurrentWriterLiquidityResponse } from "./types.js";
import type { AmebaClientOptions, AmebaResponseMetadata, CapabilityDescriptor, ChainIdentityResponse, ChartRequest, ChartResponse, HistoryRequest, JsonRequestValue, JsonValue, LedgerResponse, MarketSnapshotResponse, MarketsResponse, OracleDraftPrepareRequest, OracleDraftPrepareResponse, OracleHistoryResponse, OracleLatestResponse, OracleMarketResponse, OracleMarketsResponse, OracleStateResponse, ProgramRegistryResponse, RequestControl, CurrentCollectiveOperationStatusResponse, CurrentCollectiveOperationSubmitRequest, CurrentCollectiveOperationSubmitResponse } from "./types.js";
type HttpMethod = "GET" | "POST";
type QueryValue = string | number | bigint | boolean | undefined;
interface BackendRequestOptions extends RequestControl {
    body?: JsonRequestValue | object;
    query?: Readonly<Record<string, QueryValue>>;
}
type ResponseDecoder<T> = (payload: JsonValue, context: {
    method: HttpMethod;
    url: string;
}) => T;
declare class BackendTransport {
    readonly baseUrl: URL;
    readonly clientId: "ameba-sdk" | "ameba-operator-sdk";
    readonly timeoutMs: number;
    readonly maxResponseBytes: number;
    readonly fetchImpl: typeof globalThis.fetch;
    readonly headers: Readonly<Record<string, string>>;
    readonly onResponse?: (metadata: AmebaResponseMetadata) => void;
    constructor(options: AmebaClientOptions);
    get<T>(path: string, decoder: ResponseDecoder<T>, options?: BackendRequestOptions): Promise<T>;
    post<T>(path: string, body: JsonRequestValue | object, decoder: ResponseDecoder<T>, options?: BackendRequestOptions): Promise<T>;
    requireOperator(capability: string): void;
    private request;
}
export declare class AmebaClient {
    readonly chain: ChainApi;
    readonly writerOperations: CollectiveOperationApi;
    readonly trades: CollectiveOperationApi;
    readonly programs: ProgramRegistryApi;
    readonly markets: MarketsApi;
    readonly contracts: ContractsApi;
    readonly history: HistoryApi;
    readonly oracle: OracleApi;
    constructor(options?: AmebaClientOptions);
    capabilities(): Readonly<Record<string, CapabilityDescriptor>>;
}
/**
 * Explicit operator-lane client for scheduler controls and settlement
 * publication. Backend authentication and runtime policy remain authoritative.
 */
export declare class AmebaOperatorClient extends AmebaClient {
    constructor(options?: Omit<AmebaClientOptions, "clientMode">);
}
export declare class ChainApi {
    private readonly transport;
    constructor(transport: BackendTransport);
    identity(control?: RequestControl): Promise<ChainIdentityResponse>;
}
/**
 * Typed prepare-bound submission/status lane. This class cannot address a raw
 * Solana submission method and never retries POST after an ambiguous result.
 */
export declare class CollectiveOperationApi {
    private readonly transport;
    private readonly routeBase;
    private readonly operationKinds;
    constructor(transport: BackendTransport, routeBase: "/dlmm/writer-sleeves" | "/dlmm/trades", operationKinds: readonly string[]);
    liquidity(request: CurrentWriterLiquidityReadRequest, control?: RequestControl): Promise<CurrentWriterLiquidityResponse>;
    refunds(request: CurrentWriterRefundsRequest, control?: RequestControl): Promise<CurrentWriterRefundsResponse>;
    prepareLiquidityInitialize(request: CurrentWriterLiquidityInitializeRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    prepareLiquidityAdd(request: CurrentWriterLiquidityAddRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    prepareLiquidityRemove(request: CurrentWriterLiquidityRemoveRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    prepareLiquiditySweep(request: CurrentWriterLiquiditySweepRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    private prepareLiquidity;
    prepareLiquidityPolicyBegin(request: CurrentWriterLiquidityPolicyBeginRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    prepareLiquidityPolicyAppend(request: CurrentWriterLiquidityPolicyAppendRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    prepareLiquidityPolicySeal(request: CurrentWriterLiquidityPolicySealRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    private prepareLiquidityPolicy;
    prepareRefund(request: CurrentWriterRefundPrepareRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    prepareWithdrawal(request: CurrentWriterWithdrawalPrepareRequest, control?: RequestControl): Promise<CurrentWriterFundsPrepareResponse>;
    private prepareFunds;
    submit(request: CurrentCollectiveOperationSubmitRequest, control?: RequestControl): Promise<CurrentCollectiveOperationSubmitResponse>;
    status(operationId: string, control?: RequestControl): Promise<CurrentCollectiveOperationStatusResponse>;
}
export declare class ProgramRegistryApi {
    private readonly transport;
    constructor(transport: BackendTransport);
    get(control?: RequestControl): Promise<ProgramRegistryResponse>;
}
export declare class MarketsApi {
    private readonly transport;
    constructor(transport: BackendTransport);
    list(control?: RequestControl): Promise<MarketsResponse>;
    snapshot(market: string, options?: RequestControl): Promise<MarketSnapshotResponse>;
    chart(market: string, options?: ChartRequest): Promise<ChartResponse>;
}
export declare class ContractsApi {
    show(): never;
    quote(): never;
}
export declare class HistoryApi {
    private readonly transport;
    constructor(transport: BackendTransport);
    ledger(request: HistoryRequest): Promise<LedgerResponse>;
}
export declare class OracleApi {
    private readonly transport;
    constructor(transport: BackendTransport);
    state(control?: RequestControl): Promise<OracleStateResponse>;
    markets(control?: RequestControl): Promise<OracleMarketsResponse>;
    markets(market: string, control?: RequestControl): Promise<OracleMarketResponse>;
    latest(market?: string, control?: RequestControl): Promise<OracleLatestResponse>;
    history(market?: string, control?: RequestControl): Promise<OracleHistoryResponse>;
    /** Returns an unsigned oracle transaction preparation. */
    prepareDraft(request: OracleDraftPrepareRequest, control?: RequestControl): Promise<OracleDraftPrepareResponse>;
}
export {};
//# sourceMappingURL=client.d.ts.map