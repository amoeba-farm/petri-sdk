import { validateCurrentWriterDlmmRequest } from "./protocol/writer-dlmm-public.js";
import { validateCurrentWriterLiquidityRequest } from "./protocol/writer-dlmm-public.js";
import { currentOracleActivationSetupManifests } from "./protocol/current-oracle-staking-setup.js";
import { decodeCollectiveOperationPrepareEnvelope } from "./wallet/plans.js";
import { decodeAndValidateCurrentWalletExpectedIntent } from "./wallet/intent.js";
import { CURRENT_SPREAD_LIGHT_CPI_AUTHORITY } from "./protocol/current-light-identity.js";
import { CURRENT_LIVE_DEPLOYMENT } from "./protocol/release-train.js";
import { MAINNET_PROFILE } from "./mainnet/profile.js";
import { CAPABILITIES } from "./capabilities.js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { AMOEBA_BACKEND_URL, normalizeAmoebaBackendUrl, } from "./endpoint-policy.js";
import { redactCurrentOracleActionRequest, validateCurrentOracleActionRequest, } from "./protocol/current-oracle-public.js";
import { CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL } from "./protocol/identity.js";
import { assertCurrentWriteReleaseAvailable } from "./protocol/release-train.js";
import { validateCurrentFinalizedObservation, } from "./current-finalized-observation.js";
import { CURRENT_LIGHT_PROGRAM_DEPLOYMENTS, } from "./protocol/current-light-deployments.js";
import { AmebaAbortError, AmebaBackendError, AmebaCurrentStateUnavailableError, AmebaInputError, AmebaResponseValidationError, AmebaTimeoutError, AmebaTransportError, AmebaUnsupportedCapabilityError, } from "./errors.js";
import { SDK_VERSION } from "./version.js";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
class BackendTransport {
    baseUrl;
    clientId;
    timeoutMs;
    maxResponseBytes;
    fetchImpl;
    headers;
    onResponse;
    constructor(options) {
        this.baseUrl = normalizeAmoebaBackendUrl(options.backendUrl ?? AMOEBA_BACKEND_URL);
        this.clientId =
            options.clientMode === "operator"
                ? "ameba-operator-sdk"
                : "ameba-sdk";
        this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
        this.maxResponseBytes = positiveInteger(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes");
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        if (typeof this.fetchImpl !== "function") {
            throw new AmebaInputError("A fetch implementation is required");
        }
        this.headers = Object.freeze({ ...(options.headers ?? {}) });
        if (options.responseValidation !== undefined && options.responseValidation !== "exact") {
            throw new AmebaInputError("responseValidation must be exact for the current protocol");
        }
        this.onResponse = options.onResponse;
    }
    get(path, decoder, options = {}) {
        return this.request("GET", path, decoder, options);
    }
    post(path, body, decoder, options = {}) {
        return this.request("POST", path, decoder, { ...options, body });
    }
    requireOperator(capability) {
        if (this.clientId !== "ameba-operator-sdk") {
            throw new AmebaInputError(`${capability} requires operator client mode; use AmebaOperatorClient`);
        }
    }
    async request(method, path, decoder, options) {
        const url = new URL(path.replace(/^\/+/, ""), this.baseUrl);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined)
                url.searchParams.set(key, String(value));
        }
        const context = Object.freeze({ method, url: url.toString() });
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeoutMs = positiveInteger(options.timeoutMs ?? this.timeoutMs, "timeoutMs");
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error(`Ameba backend request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const abortFromCaller = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted)
            abortFromCaller();
        else
            options.signal?.addEventListener("abort", abortFromCaller, { once: true });
        let response;
        let raw;
        try {
            response = await this.fetchImpl(url, {
                method,
                headers: {
                    ...this.headers,
                    accept: "application/json",
                    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
                    ...(options.idempotencyKey === undefined
                        ? {}
                        : { "idempotency-key": nonempty(options.idempotencyKey, "idempotencyKey") }),
                    "x-ameba-client": this.clientId,
                    "x-ameba-sdk-version": SDK_VERSION,
                },
                body: options.body === undefined
                    ? undefined
                    : JSON.stringify(options.body, bigintReplacer),
                redirect: "error",
                signal: controller.signal,
            });
            raw = await readBoundedResponseText(response, this.maxResponseBytes, context);
        }
        catch (cause) {
            if (cause instanceof AmebaResponseValidationError)
                throw cause;
            if (options.signal?.aborted) {
                throw new AmebaAbortError(options.signal.reason, { cause, context });
            }
            if (timedOut)
                throw new AmebaTimeoutError(timeoutMs, { cause, context });
            throw new AmebaTransportError(`Ameba backend request failed: ${errorMessage(cause)}`, { cause, context });
        }
        finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener("abort", abortFromCaller);
        }
        const metadata = responseMetadata(method, url, response, startedAt);
        try {
            this.onResponse?.(metadata);
        }
        catch {
            // Observability callbacks must not change request outcomes.
        }
        let payload;
        try {
            payload = parseJson(raw, response.status, context);
        }
        catch (cause) {
            if (response.ok)
                throw cause;
            throw new AmebaBackendError(`Ameba backend returned HTTP ${response.status} with a non-JSON response`, {
                status: response.status,
                requestId: metadata.requestId,
                retryAfterMs: metadata.rateLimit?.retryAfterMs,
                details: { preview: raw.slice(0, 512) },
                cause,
                context,
            });
        }
        if (!response.ok || isBackendFailure(payload)) {
            const backend = currentBackendError(payload, context);
            if (backend.code === "CURRENT_STATE_UNAVAILABLE") {
                if (response.status !== 503
                    || backend.message !== "current Market discovery is not authoritative"
                    || response.headers.get("cache-control") !== "no-store"
                    || response.headers.get("content-type") !== "application/json; charset=utf-8") {
                    throw new AmebaResponseValidationError("$", "CURRENT_STATE_UNAVAILABLE must use the frozen 503 body and no-store JSON headers", { details: payload, context });
                }
                throw new AmebaCurrentStateUnavailableError({
                    requestId: metadata.requestId,
                    details: payload,
                    context,
                });
            }
            throw new AmebaBackendError(backend.message, {
                status: response.status,
                code: backend.code,
                requestId: metadata.requestId,
                retryAfterMs: metadata.rateLimit?.retryAfterMs,
                details: payload,
                context,
            });
        }
        return decoder(payload, context);
    }
}
export class AmebaClient {
    chain;
    writerOperations;
    trades;
    programs;
    markets;
    contracts;
    history;
    oracle;
    constructor(options = {}) {
        const transport = new BackendTransport(options);
        this.chain = new ChainApi(transport);
        this.writerOperations = new CollectiveOperationApi(transport, "/dlmm/writer-sleeves", WRITER_OPERATION_KINDS);
        this.trades = new CollectiveOperationApi(transport, "/dlmm/trades", TRADE_OPERATION_KINDS);
        this.programs = new ProgramRegistryApi(transport);
        this.markets = new MarketsApi(transport);
        this.contracts = new ContractsApi();
        this.history = new HistoryApi(transport);
        this.oracle = new OracleApi(transport);
    }
    capabilities() {
        return CAPABILITIES;
    }
}
/**
 * Explicit operator-lane client for scheduler controls and settlement
 * publication. Backend authentication and runtime policy remain authoritative.
 */
export class AmebaOperatorClient extends AmebaClient {
    constructor(options = {}) {
        super({ ...options, clientMode: "operator" });
    }
}
export class ChainApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    identity(control = {}) {
        return this.transport.get("/chain/identity", currentResponse(decodeChainIdentityData), control);
    }
}
const WRITER_OPERATION_KINDS = Object.freeze([
    "writer_liquidity_policy_begin", "writer_liquidity_policy_append", "writer_liquidity_policy_seal",
    "writer_liquidity_initialize", "writer_liquidity_add", "writer_liquidity_remove", "writer_liquidity_sweep",
    "withdraw_principal", "auction_refund",
    "deposit",
    "bid",
    "close_begin",
    "close_basket",
    "close_finalize",
    "close_cancel",
    "settlement_claim_flat",
    "settlement_claim_collective",
    "transfer_flat",
]);
const TRADE_OPERATION_KINDS = Object.freeze([
    "collective_swap_exact_in",
]);
/**
 * Typed prepare-bound submission/status lane. This class cannot address a raw
 * Solana submission method and never retries POST after an ambiguous result.
 */
export class CollectiveOperationApi {
    transport;
    routeBase;
    operationKinds;
    constructor(transport, routeBase, operationKinds) {
        this.transport = transport;
        this.routeBase = routeBase;
        this.operationKinds = operationKinds;
    }
    liquidity(request, control = {}) {
        if (this.routeBase !== "/dlmm/writer-sleeves")
            throw new AmebaInputError("Writer liquidity reads require writerOperations");
        if (!request || typeof request !== "object" || Array.isArray(request) || Object.hasOwn(request, "operation"))
            throw new AmebaInputError("Writer liquidity read identity is invalid");
        const identity = validateCurrentWriterLiquidityRequest({ ...request, operation: "writer_liquidity_initialize" });
        return this.transport.get(`${this.routeBase}/${identity.sleeve}/liquidity`, currentResponse((data, context) => decodeCurrentWriterLiquidity(data, identity, context)), { ...control, query: { owner: identity.owner, seriesIndex: identity.seriesIndex } });
    }
    refunds(request, control = {}) {
        if (this.routeBase !== "/dlmm/writer-sleeves")
            throw new AmebaInputError("Writer refund reads require writerOperations");
        rejectUnknownInputFields(request, ["owner", "cursor", "limit"], "writer refunds request");
        const owner = request.owner;
        const cursor = request.cursor;
        const limit = request.limit ?? 16;
        validateInputBase58(owner, "owner", 32, 44, 32);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
            throw new AmebaInputError("Writer refund limit must be1..32");
        if (cursor !== undefined && (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 2048 || /[\0\r\n]/.test(cursor))) {
            throw new AmebaInputError("Writer refund cursor must be bounded opaque text");
        }
        return this.transport.get(`${this.routeBase}/refunds`, currentResponse((data, context) => decodeCurrentWriterRefunds(data, owner, limit, context)), { ...control, query: { owner, cursor, limit } });
    }
    prepareLiquidityInitialize(request, control = {}) {
        return this.prepareLiquidity("writer_liquidity_initialize", "initialize", request, control);
    }
    prepareLiquidityAdd(request, control = {}) {
        return this.prepareLiquidity("writer_liquidity_add", "add", request, control);
    }
    prepareLiquidityRemove(request, control = {}) {
        return this.prepareLiquidity("writer_liquidity_remove", "remove", request, control);
    }
    prepareLiquiditySweep(request, control = {}) {
        return this.prepareLiquidity("writer_liquidity_sweep", "sweep", request, control);
    }
    prepareLiquidity(operation, action, request, control) {
        if (this.routeBase !== "/dlmm/writer-sleeves")
            throw new AmebaInputError("Writer liquidity preparation requires writerOperations");
        if (!request || typeof request !== "object" || Array.isArray(request) || Object.hasOwn(request, "operation"))
            throw new AmebaInputError("Writer liquidity operation is selected by the method");
        const intent = validateCurrentWriterLiquidityRequest({ ...request, operation });
        const { operation: _operation, ...body } = intent;
        return this.transport.post(`${this.routeBase}/liquidity/${action}/prepare`, body, (payload, context) => decodeCurrentWriterPrepareResponse(payload, intent, context), control);
    }
    prepareLiquidityPolicyBegin(request, control = {}) {
        return this.prepareLiquidityPolicy("writer_liquidity_policy_begin", "begin", request, control);
    }
    prepareLiquidityPolicyAppend(request, control = {}) {
        return this.prepareLiquidityPolicy("writer_liquidity_policy_append", "append", request, control);
    }
    prepareLiquidityPolicySeal(request, control = {}) {
        return this.prepareLiquidityPolicy("writer_liquidity_policy_seal", "seal", request, control);
    }
    prepareLiquidityPolicy(operation, action, request, control) {
        if (this.routeBase !== "/dlmm/writer-sleeves")
            throw new AmebaInputError("Writer liquidity policy preparation requires writerOperations");
        this.transport.requireOperator("writer liquidity policy preparation");
        if (!request || typeof request !== "object" || Array.isArray(request) || Object.hasOwn(request, "operation"))
            throw new AmebaInputError("Writer liquidity policy operation is selected by the method");
        const intent = validateCurrentWriterDlmmRequest({ ...request, operation });
        const { operation: _operation, ...body } = intent;
        return this.transport.post(`${this.routeBase}/liquidity/policy/${action}/prepare`, body, (payload, context) => decodeCurrentWriterPrepareResponse(payload, intent, context), control);
    }
    prepareRefund(request, control = {}) {
        return this.prepareFunds("auction_refund", "refunds", request, control);
    }
    prepareWithdrawal(request, control = {}) {
        return this.prepareFunds("withdraw_principal", "withdrawals", request, control);
    }
    prepareFunds(operation, path, request, control) {
        if (this.routeBase !== "/dlmm/writer-sleeves")
            throw new AmebaInputError("Writer funds preparation requires writerOperations");
        const fields = operation === "auction_refund" ? ["owner", "auction", "bid"] : ["owner", "sleeve", "amountAtoms"];
        rejectUnknownInputFields(request, fields, "writer funds request");
        const captured = Object.freeze(Object.fromEntries(fields.map(field => [field, request[field]])));
        for (const field of fields) {
            if (field === "amountAtoms")
                validateInputPositiveU64(captured[field], field);
            else
                validateInputBase58(captured[field], field, 32, 44, 32);
        }
        return this.transport.post(`${this.routeBase}/${path}/prepare`, captured, (payload, context) => decodeCurrentWriterPrepareResponse(payload, { operation, ...captured }, context), control);
    }
    submit(request, control = {}) {
        // A prepared/signed RC44 envelope is not a governed-write release. Keep
        // the network mutation seam closed before parsing or making any request.
        assertCurrentWriteReleaseAvailable();
        validateCurrentCollectiveOperationSubmitRequest(request);
        return this.transport.post(`${this.routeBase}/submit`, request, currentResponse(decodeCurrentCollectiveOperationSubmitData), control);
    }
    status(operationId, control = {}) {
        const canonicalOperationId = lowercaseSha256Input(operationId, "operationId");
        return this.transport.get(`${this.routeBase}/status/${canonicalOperationId}`, currentResponse(decodeCurrentCollectiveOperationStatusData(this.operationKinds)), control);
    }
}
export class ProgramRegistryApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    get(control = {}) {
        return this.transport.get("/dlmm/program-registry", currentResponse(decodeProgramRegistryData), control);
    }
}
export class MarketsApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    list(control = {}) {
        return this.transport.get("/dlmm/markets", currentResponse(decodeMarketsData), control);
    }
    snapshot(market, options = {}) {
        const marketId = validateInputCurrentProductId(market, "market");
        return this.transport.get(`/dlmm/markets/${encodeURIComponent(marketId)}/snapshot`, currentResponse(decodeMarketSnapshotData(marketId)), options);
    }
    chart(market, options = {}) {
        const marketId = productSegment(market, "market");
        const path = `/dlmm/markets/${marketId}/chart`;
        const windowMs = options.windowMs === undefined
            ? chartRangeWindowMs(options.range)
            : positiveInteger(options.windowMs, "windowMs");
        return this.transport.get(path, currentResponse(decodeChartData), {
            ...options,
            query: {
                windowMs,
                includeSimulation: options.includeSimulation,
            },
        });
    }
}
export class ContractsApi {
    show() {
        throw new AmebaUnsupportedCapabilityError("contracts.show", "the current backend exposes the canonical market snapshot but no single-contract route");
    }
    quote() {
        throw new AmebaUnsupportedCapabilityError("contracts.quote", "use the canonical market snapshot; the SDK does not invent a DLMM fair price");
    }
}
export class HistoryApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    ledger(request) {
        const owner = validateInputBase58(request.owner, "owner", 32, 44, 32);
        return this.transport.get(`/users/${encodeURIComponent(owner)}/ledger`, currentResponse(decodeLedgerData(owner)), {
            ...request,
            query: {
                limit: request.limit === undefined
                    ? undefined
                    : positiveInteger(request.limit, "limit"),
                marketId: request.marketId === undefined
                    ? undefined
                    : validateInputCurrentProductId(request.marketId, "marketId"),
                refresh: request.refresh,
            },
        });
    }
}
export class OracleApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    state(control = {}) {
        return this.transport.get("/dlmm/oracle/state", currentResponse(decodeOracleStateData), control);
    }
    markets(marketOrControl = {}, maybeControl = {}) {
        if (typeof marketOrControl === "string") {
            const marketId = validateInputCurrentProductId(marketOrControl, "market");
            return this.transport.get(`/dlmm/oracle/markets/${encodeURIComponent(marketId)}`, currentResponse(decodeOracleMarketData(marketId)), maybeControl);
        }
        return this.transport.get("/dlmm/oracle/markets", currentResponse(decodeOracleMarketsData), marketOrControl);
    }
    latest(market, control = {}) {
        const marketId = market === undefined ? undefined : validateInputCurrentProductId(market, "market");
        const path = marketId
            ? `/dlmm/oracle/markets/${encodeURIComponent(marketId)}/latest`
            : "/dlmm/oracle/latest";
        return this.transport.get(path, currentResponse(decodeOracleLatestData(marketId)), control);
    }
    history(market, control = {}) {
        const marketId = market === undefined ? undefined : validateInputCurrentProductId(market, "market");
        const path = marketId
            ? `/dlmm/oracle/markets/${encodeURIComponent(marketId)}/history`
            : "/dlmm/oracle/history";
        return this.transport.get(path, currentResponse(decodeOracleHistoryData(marketId)), control);
    }
    /** Returns an unsigned oracle transaction preparation. */
    prepareDraft(request, control = {}) {
        let normalizedRequest;
        try {
            normalizedRequest = validateCurrentOracleActionRequest(request);
        }
        catch (cause) {
            throw new AmebaInputError(cause instanceof Error ? cause.message : "current Oracle action request is invalid");
        }
        return this.transport.post("/dlmm/oracle/drafts/prepare", normalizedRequest, currentResponse(decodeOracleDraftPrepareData(normalizedRequest)), control);
    }
}
/** Validate the public wrapper, then retain the exact portable material for independent wallet review. */
function decodeCurrentWriterPrepareResponse(payload, expectedIntent, context) {
    let portable;
    currentResponse((data) => {
        const { protocol: _protocol, freshness: _freshness, ...material } = data;
        const envelope = decodeCollectiveOperationPrepareEnvelope(material);
        decodeAndValidateCurrentWalletExpectedIntent(expectedIntent, envelope);
        portable = material;
    })(payload, context);
    return portable;
}
function decodeCurrentWriterLiquidity(payload, expected, context) {
    const path = "$.data";
    const fields = ["protocol", "schema", "owner", "sleeve", "seriesIndex", "market", "pool", "policyAddress", "positionAddress",
        "policyAuthority", "managementAuthority", "actorCanManage", "policyLifecycle", "positionInitialized", "reasonCode",
        "accounting", "budget", "bins", "observedSlot", "evidenceDigest"];
    const root = exactObject(payload, [...fields, "freshness"], fields, path, context);
    exactString(root.schema, "writer-liquidity-v1", `${path}.schema`, context);
    exactString(root.owner, expected.owner, `${path}.owner`, context);
    exactString(root.sleeve, expected.sleeve, `${path}.sleeve`, context);
    if (safeIntegerValue(root.seriesIndex, `${path}.seriesIndex`, context, 0, 19) !== expected.seriesIndex) {
        fail(`${path}.seriesIndex`, "selected series does not match request", root.seriesIndex, context);
    }
    for (const field of ["market", "pool", "policyAddress", "positionAddress", "policyAuthority", "managementAuthority"]) {
        if (field === "managementAuthority" && root[field] === null)
            continue;
        if (base58Address(root[field], `${path}.${field}`, context) === SYSTEM_PROGRAM_ID)
            fail(`${path}.${field}`, "nonzero address required", root[field], context);
    }
    const lifecycle = enumString(root.policyLifecycle, ["uncreated", "building", "sealed"], `${path}.policyLifecycle`, context);
    const canManage = booleanValue(root.actorCanManage, `${path}.actorCanManage`, context);
    const initialized = booleanValue(root.positionInitialized, `${path}.positionInitialized`, context);
    if (root.reasonCode !== null)
        nonemptyStringValue(root.reasonCode, `${path}.reasonCode`, context);
    if ((canManage && (lifecycle !== "sealed" || root.managementAuthority !== expected.owner))
        || (lifecycle === "sealed" && root.managementAuthority === null))
        fail(path, "management authority and policy lifecycle disagree", root, context);
    const amounts = ["assetsAtoms", "principalAtoms", "grossPrimaryPremiumAtoms", "reserveAtoms", "operationalBufferAtoms",
        "physicalSupplyAtoms", "issuerControlledAtoms", "externalOpenInterestAtoms"];
    const nullableAmounts = ["freeCashAtoms", "sleeveCashAtoms", "writerPoolQuoteAtoms", "writerUncommittedQuoteAtoms",
        "positionOptionAtoms", "positionQuoteAtoms", "positionUncommittedQuoteAtoms"];
    const accountingFields = [...amounts, ...nullableAmounts];
    const accounting = exactObject(root.accounting, accountingFields, accountingFields, `${path}.accounting`, context);
    for (const field of amounts)
        canonicalU64(accounting[field], `${path}.accounting.${field}`, context);
    for (const field of nullableAmounts)
        if (accounting[field] !== null)
            canonicalU64(accounting[field], `${path}.accounting.${field}`, context);
    if (root.budget !== null) {
        const budgetAmounts = ["monthStartUnixSeconds", "monthlyCapAtoms", "monthlySpentAtoms", "monthlyRemainingAtoms",
            "seriesMonthlyCapAtoms", "seriesMonthlySpentAtoms", "seriesMonthlyRemainingAtoms", "transactionCapAtoms",
            "seriesTransactionCapAtoms", "reserveReleaseSpendRatioPpm", "conservativeClaimValueAtoms", "sellerFloorQuoteAtoms"];
        const budgetFields = [...budgetAmounts, "priceSeparationTicks"];
        const budget = exactObject(root.budget, budgetFields, budgetFields, `${path}.budget`, context);
        for (const field of budgetAmounts)
            canonicalU64(budget[field], `${path}.budget.${field}`, context);
        if (BigInt(budget.reserveReleaseSpendRatioPpm) > 1000000n)
            fail(`${path}.budget.reserveReleaseSpendRatioPpm`, "ratio exceeds one million ppm", budget.reserveReleaseSpendRatioPpm, context);
        safeIntegerValue(budget.priceSeparationTicks, `${path}.budget.priceSeparationTicks`, context, 1, 65535);
    }
    const bins = arrayValue(root.bins, `${path}.bins`, context);
    if (bins.length > 32 || (!initialized && bins.length !== 0))
        fail(`${path}.bins`, "position bin inventory is invalid", root.bins, context);
    let previous = 0;
    bins.forEach((value, index) => {
        const binPath = `${path}.bins[${index}]`;
        const fields = ["binId", "optionAtoms", "quoteAtoms"];
        const bin = exactObject(value, fields, fields, binPath, context);
        previous = safeIntegerValue(bin.binId, `${binPath}.binId`, context, previous + 1, 2048);
        canonicalU64(bin.optionAtoms, `${binPath}.optionAtoms`, context);
        canonicalU64(bin.quoteAtoms, `${binPath}.quoteAtoms`, context);
    });
    canonicalU64(root.observedSlot, `${path}.observedSlot`, context);
    sha256Digest(root.evidenceDigest, `${path}.evidenceDigest`, context);
}
function decodeCurrentWriterRefunds(payload, expectedOwner, limit, context) {
    const fields = ["protocol", "schema", "owner", "discoverySlot", "inventoryScope", "rows", "nextCursor"];
    const root = exactObject(payload, [...fields, "freshness"], fields, "$.data", context);
    exactString(root.schema, "writer-auction-refunds-v1", "$.data.schema", context);
    exactString(root.owner, expectedOwner, "$.data.owner", context);
    exactString(root.inventoryScope, "owner_classic_bid_accounts_at_discovery_slot", "$.data.inventoryScope", context);
    const discoverySlot = canonicalU64(root.discoverySlot, "$.data.discoverySlot", context);
    const rows = arrayValue(root.rows, "$.data.rows", context);
    if (rows.length > limit)
        fail("$.data.rows", "refund page exceeds requested limit", root.rows, context);
    const identities = new Set();
    rows.forEach((value, index) => {
        const path = `$.data.rows[${index}]`;
        const fields = ["owner", "auction", "bid", "sleeve", "refundTokenAccount", "remainingRefundAtoms", "refundableNow", "status", "reasonCode", "observedSlot", "evidenceDigest"];
        const row = exactObject(value, fields, fields, path, context);
        exactString(row.owner, expectedOwner, `${path}.owner`, context);
        const bid = base58Address(row.bid, `${path}.bid`, context);
        if (identities.has(bid))
            fail(`${path}.bid`, "duplicate bid candidate", row.bid, context);
        identities.add(bid);
        for (const field of ["auction", "sleeve", "refundTokenAccount"]) {
            if (row[field] !== null)
                base58Address(row[field], `${path}.${field}`, context);
        }
        const status = enumString(row.status, ["refundable", "blocked", "unavailable"], `${path}.status`, context);
        const refundable = booleanValue(row.refundableNow, `${path}.refundableNow`, context);
        if (row.remainingRefundAtoms !== null)
            canonicalU64(row.remainingRefundAtoms, `${path}.remainingRefundAtoms`, context);
        if (row.observedSlot !== null && BigInt(canonicalU64(row.observedSlot, `${path}.observedSlot`, context)) < BigInt(discoverySlot)) {
            fail(`${path}.observedSlot`, "refund evidence precedes discovery", row.observedSlot, context);
        }
        if (row.evidenceDigest !== null)
            sha256Digest(row.evidenceDigest, `${path}.evidenceDigest`, context);
        if (row.reasonCode !== null)
            nonemptyStringValue(row.reasonCode, `${path}.reasonCode`, context);
        if (refundable !== (status === "refundable") || (status === "unavailable" && row.remainingRefundAtoms !== null)
            || (refundable && ([row.auction, row.sleeve, row.refundTokenAccount, row.remainingRefundAtoms, row.observedSlot, row.evidenceDigest].some(field => field === null)
                || row.remainingRefundAtoms === "0"))) {
            fail(path, "refund availability and evidence fields disagree", row, context);
        }
    });
    if (root.nextCursor !== null) {
        const cursor = nonemptyStringValue(root.nextCursor, "$.data.nextCursor", context);
        if (cursor.length > 2048 || rows.length === 0)
            fail("$.data.nextCursor", "invalid bounded continuation", root.nextCursor, context);
    }
}
const CURRENT_PROGRAM_ID = CURRENT_LIVE_DEPLOYMENT.programId;
const CURRENT_LIGHT_TOKEN_PROGRAM_ID = "cTokenmWW8bLPjZEBAUgYy3zKxQZW6VKi7bqNFEVv3m";
const CURRENT_LIGHT_CPI_AUTHORITY = "GXtd2izAiMJPwMEjfgTRH3d7k9mjn4Jq3JrWFv9gySYy";
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const CURRENT_LOOKUP_TABLE_PROGRAM_ID = "AddressLookupTab1e1111111111111111111111111";
const CURRENT_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const CURRENT_PROGRAM_DATA_ADDRESS = CURRENT_LIVE_DEPLOYMENT.programDataAddress;
const CURRENT_UPGRADE_AUTHORITY = CURRENT_LIVE_DEPLOYMENT.upgradeAuthority.address;
const CURRENT_PROGRAM_PAYLOAD_SHA256 = CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256;
const CURRENT_LIGHT_SYSTEM_PROGRAM_ID = "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7";
const CURRENT_LIGHT_REGISTERED_PROGRAM_PDA = CURRENT_SPREAD_LIGHT_CPI_AUTHORITY.toBase58();
const CURRENT_LIGHT_NOOP_PROGRAM_ID = "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh";
const CURRENT_LIGHT_ACCOUNT_COMPRESSION_AUTHORITY = "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA";
const CURRENT_LIGHT_COMPRESSION_PROGRAM_ID = "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq";
const CURRENT_LIGHT_CONFIG_PROGRAM_ID = "Lighton6oQpVkeewmo2mcPTQQp7kYHr4fWpAgJyEmDX";
const CURRENT_LIGHT_CONFIG = "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg";
const CURRENT_LIGHT_RENT_SPONSOR = "r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti";
const CURRENT_LIGHT_ADDRESS_TREE = "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx";
const CURRENT_LIGHT_STATE_CONTEXTS = Object.freeze([
    Object.freeze({ stateTree: "bmt1LryLZUMmF7ZtqESaw7wifBXLfXHQYoE4GAmrahU", queue: "oq1na8gojfdUhsfCpyjNt6h4JaDWtHf1yQj4koBWfto", cpiContext: "cpi15BoVPKgEPw5o8wc2T816GE7b378nMXnhH3Xbq4y" }),
    Object.freeze({ stateTree: "bmt2UxoBxB9xWev4BkLvkGdapsz6sZGkzViPNph7VFi", queue: "oq2UkeMsJLfXt2QHzim242SUi3nvjJs8Pn7Eac9H9vg", cpiContext: "cpi2yGapXUR3As5SjnHBAVvmApNiLsbeZpF3euWnW6B" }),
    Object.freeze({ stateTree: "bmt3ccLd4bqSVZVeCJnH1F6C8jNygAhaDfxDwePyyGb", queue: "oq3AxjekBWgo64gpauB6QtuZNesuv19xrhaC1ZM1THQ", cpiContext: "cpi3mbwMpSX8FAGMZVP85AwxqCaQMfEk9Em1v8QK9Rf" }),
    Object.freeze({ stateTree: "bmt4d3p1a4YQgk9PeZv5s4DBUmbF5NxqYpk9HGjQsd8", queue: "oq4ypwvVGzCUMoiKKHWh4S1SgZJ9vCvKpcz6RT6A8dq", cpiContext: "cpi4yyPDc4bCgHAnsenunGA8Y77j3XEDyjgfyCKgcoc" }),
    Object.freeze({ stateTree: "bmt5yU97jC88YXTuSukYHa8Z5Bi2ZDUtmzfkDTA2mG2", queue: "oq5oh5ZR3yGomuQgFduNDzjtGvVWfDRGLuDVjv9a96P", cpiContext: "cpi5ZTjdgYpZ1Xr7B1cMLLUE81oTtJbNNAyKary2nV6" }),
]);
const CURRENT_PROTOCOL_FIELDS = Object.freeze({
    programId: CURRENT_PROGRAM_ID,
    namespace: "ameba-spread-v2",
    cluster: "devnet",
    releaseTag: "v0.1.0-rc.44",
    releaseCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18",
});
const CURRENT_ORACLE_LOGICAL_TAG_BY_ACTION = Object.freeze({
    initialize_oracle_month_v5: 181,
    propose_oracle_source_v3: 182,
    support_oracle_source_v3: 183,
    challenge_oracle_source_v2: 161,
    submit_oracle_opening_claim_v2: 162,
    challenge_oracle_opening_claim_v2: 163,
    finalize_oracle_opening_claim_v2: 165,
    commit_oracle_update_claim_v3: 166,
    reveal_oracle_update_claim_v3: 198,
    challenge_oracle_update_claim_v2: 168,
    finalize_oracle_update_claim_v2: 199,
    commit_oracle_emergency_vote_v3: 176,
    reveal_oracle_emergency_vote_v2: 177,
    queue_stake_amba_for_samba: 138,
    activate_queued_stake_amba_for_samba: 139,
    request_unstake_samba: 131,
    complete_unstake_samba: 133,
    deposit_oracle_usdc_rewards: 155,
    claim_oracle_usdc_reward: 174,
});
const CURRENT_ORACLE_INSTRUCTION_NAME_BY_ACTION = Object.freeze({
    initialize_oracle_month_v5: "InitializeOracleMonthV5",
    propose_oracle_source_v3: "ProposeOracleSourceV3",
    support_oracle_source_v3: "SupportOracleSourceV3",
    challenge_oracle_source_v2: "ChallengeOracleSourceV2",
    submit_oracle_opening_claim_v2: "SubmitOracleOpeningClaimV2",
    challenge_oracle_opening_claim_v2: "ChallengeOracleOpeningClaimV2",
    finalize_oracle_opening_claim_v2: "FinalizeOracleOpeningClaimV2",
    commit_oracle_update_claim_v3: "CommitOracleUpdateClaimV3",
    reveal_oracle_update_claim_v3: "RevealOracleUpdateClaimV3",
    challenge_oracle_update_claim_v2: "ChallengeOracleUpdateClaimV2",
    finalize_oracle_update_claim_v2: "FinalizeOracleUpdateClaimV2",
    commit_oracle_emergency_vote_v3: "CommitOracleEmergencyVoteV3",
    reveal_oracle_emergency_vote_v2: "RevealOracleEmergencyVoteV2",
    queue_stake_amba_for_samba: "QueueStakeAmbaForSamba",
    activate_queued_stake_amba_for_samba: "ActivateQueuedStakeAmbaForSamba",
    request_unstake_samba: "RequestUnstakeSamba",
    complete_unstake_samba: "CompleteUnstakeSamba",
    deposit_oracle_usdc_rewards: "DepositOracleUsdcRewards",
    claim_oracle_usdc_reward: "ClaimOracleUsdcReward",
});
const CURRENT_ORACLE_DIRECT_ACTIONS = new Set([
    "queue_stake_amba_for_samba", "activate_queued_stake_amba_for_samba", "request_unstake_samba", "complete_unstake_samba",
    "initialize_oracle_month_v5",
    "commit_oracle_emergency_vote_v3",
    "reveal_oracle_emergency_vote_v2",
    "deposit_oracle_usdc_rewards",
]);
function currentResponse(decodeData) {
    return (payload, context) => {
        const root = exactObject(payload, ["ok", "data"], ["ok", "data"], "$", context);
        if (root.ok !== true)
            fail("$.ok", "expected true", root.ok, context);
        const data = objectValue(root.data, "$.data", context);
        validateCurrentProtocol(data.protocol, "$.data.protocol", context);
        decodeCurrentFreshness(data, context, "$.data");
        decodeData(data, context, "$.data");
        return payload;
    };
}
function decodeCurrentFreshness(data, context, path) {
    if (Object.hasOwn(data, "freshness")) {
        const freshnessPath = `${path}.freshness`;
        const fields = ["source", "observedAt", "observedAtSlot", "ageMs", "maximumAgeMs", "stale",
            "refreshHealthy", "readReady", "tradeReady", "lastAttemptAt", "lastErrorCode"];
        const freshness = exactObject(data.freshness, fields, fields, freshnessPath, context);
        exactString(freshness.source, "redis-last-known-good", `${freshnessPath}.source`, context);
        isoTimestamp(freshness.observedAt, `${freshnessPath}.observedAt`, context);
        canonicalU64(freshness.observedAtSlot, `${freshnessPath}.observedAtSlot`, context);
        const age = safeIntegerValue(freshness.ageMs, `${freshnessPath}.ageMs`, context, 0);
        const maximumAge = safeIntegerValue(freshness.maximumAgeMs, `${freshnessPath}.maximumAgeMs`, context, 1);
        exactBoolean(freshness.stale, age > maximumAge, `${freshnessPath}.stale`, context);
        const healthy = booleanValue(freshness.refreshHealthy, `${freshnessPath}.refreshHealthy`, context);
        for (const field of ["readReady", "tradeReady"]) {
            const ready = booleanValue(freshness[field], `${freshnessPath}.${field}`, context);
            if (ready && (age > maximumAge || !healthy))
                fail(`${freshnessPath}.${field}`, "stale or unhealthy snapshot cannot be ready", ready, context);
        }
        if (freshness.lastAttemptAt !== null)
            isoTimestamp(freshness.lastAttemptAt, `${freshnessPath}.lastAttemptAt`, context);
        if (freshness.lastErrorCode !== null)
            stringPattern(freshness.lastErrorCode, /^[A-Za-z0-9_.:-]{1,128}$/u, `${freshnessPath}.lastErrorCode`, context, "a bounded error code");
    }
}
function decodeChainIdentityData(data, context, path) {
    exactObject(data, ["freshness", "protocol", "identity"], ["protocol", "identity"], path, context);
    const identityPath = `${path}.identity`;
    const identity = exactObject(data.identity, [
        "stateNamespace", "cluster", "genesisHash", "releaseTag", "releaseCommit", "observedSlot", "program", "collateral", "light",
        "liveReleaseLabel", "liveSourceCommit", "liveReadProfileId", "reviewedBridgeSourceCommit", "deploymentProvenance", "writeCompatibility", "governance",
    ], ["stateNamespace", "cluster", "genesisHash", "releaseTag", "releaseCommit", "observedSlot", "program"], identityPath, context);
    const mainnet = data.protocol.cluster === MAINNET_PROFILE.network;
    const live = mainnet ? { ...CURRENT_LIVE_DEPLOYMENT, cluster: MAINNET_PROFILE.network,
        genesisHash: MAINNET_PROFILE.genesisHash, releaseLabel: MAINNET_PROFILE.liveReleaseLabel,
        artifactSourceCommit: MAINNET_PROFILE.publicSourceCommit, liveReadProfileId: MAINNET_PROFILE.liveReadProfileId,
        programDataAccountBytes: MAINNET_PROFILE.programDataAccountBytes, programDataSlot: MAINNET_PROFILE.deployedSlot,
        programDataPayloadBytes: MAINNET_PROFILE.programDataPayloadBytes, programDataPayloadSha256: MAINNET_PROFILE.programDataPayloadSha256,
        programDataAccountSha256: MAINNET_PROFILE.programDataAccountSha256 } : CURRENT_LIVE_DEPLOYMENT;
    for (const [field, expected] of Object.entries({ liveReleaseLabel: live.releaseLabel, liveSourceCommit: live.artifactSourceCommit, liveReadProfileId: live.liveReadProfileId, reviewedBridgeSourceCommit: live.artifactSourceCommit, deploymentProvenance: live.provenance, writeCompatibility: live.writeCompatibility })) {
        if (Object.hasOwn(identity, field))
            exactString(identity[field], expected, `${identityPath}.${field}`, context);
    }
    exactString(identity.stateNamespace, CURRENT_PROTOCOL_FIELDS.namespace, `${identityPath}.stateNamespace`, context);
    exactString(identity.cluster, live.cluster, `${identityPath}.cluster`, context);
    exactString(identity.genesisHash, live.genesisHash, `${identityPath}.genesisHash`, context);
    exactString(identity.releaseTag, CURRENT_PROTOCOL_FIELDS.releaseTag, `${identityPath}.releaseTag`, context);
    exactString(identity.releaseCommit, CURRENT_PROTOCOL_FIELDS.releaseCommit, `${identityPath}.releaseCommit`, context);
    canonicalU64(identity.observedSlot, `${identityPath}.observedSlot`, context);
    if (data.freshness)
        exactString(data.freshness.observedAtSlot, identity.observedSlot, `${path}.freshness.observedAtSlot`, context);
    const programPath = `${identityPath}.program`;
    const program = exactObject(identity.program, [
        "programId", "programDataAddress", "programDataBytes", "upgradeAuthority", "executable",
        "deployedSlot", "payloadBytes", "payloadSha256", "rawAccountSha256",
    ], [
        "programId", "programDataAddress", "programDataBytes", "upgradeAuthority", "executable",
        "deployedSlot", "payloadBytes", "payloadSha256",
    ], programPath, context);
    exactString(program.programId, CURRENT_PROGRAM_ID, `${programPath}.programId`, context);
    exactString(program.programDataAddress, CURRENT_PROGRAM_DATA_ADDRESS, `${programPath}.programDataAddress`, context);
    if (program.programDataBytes !== live.programDataAccountBytes)
        fail(`${programPath}.programDataBytes`, "expected the exact selected ProgramData allocation", program.programDataBytes, context);
    exactString(program.upgradeAuthority, CURRENT_UPGRADE_AUTHORITY, `${programPath}.upgradeAuthority`, context);
    exactBoolean(program.executable, true, `${programPath}.executable`, context);
    exactString(program.deployedSlot, String(live.programDataSlot), `${programPath}.deployedSlot`, context);
    if (program.payloadBytes !== live.programDataPayloadBytes)
        fail(`${programPath}.payloadBytes`, "expected the selected payload length", program.payloadBytes, context);
    exactString(program.payloadSha256, live.programDataPayloadSha256, `${programPath}.payloadSha256`, context);
    if (Object.hasOwn(program, "rawAccountSha256"))
        exactString(program.rawAccountSha256, live.programDataAccountSha256, `${programPath}.rawAccountSha256`, context);
    if (Object.hasOwn(identity, "governance")) {
        if (!mainnet)
            fail(`${identityPath}.governance`, "Mainnet governance cannot describe Devnet", identity.governance, context);
        const gp = `${identityPath}.governance`;
        const fields = ["network", "genesisHash", "programId", "controllerProgramId", "profileSha256", "observedSlot", "artifactSha256", "gate", "gateStatus", "epoch", "gateActive", "tradeReady", "readinessReason"];
        const governance = exactObject(identity.governance, fields, fields, gp, context);
        for (const [field, expected] of Object.entries({ network: MAINNET_PROFILE.network, genesisHash: MAINNET_PROFILE.genesisHash,
            programId: MAINNET_PROFILE.programId, controllerProgramId: MAINNET_PROFILE.controllerProgramId, profileSha256: MAINNET_PROFILE.profileSha256,
            artifactSha256: MAINNET_PROFILE.artifactSha256, gate: MAINNET_PROFILE.gate }))
            exactString(governance[field], expected, `${gp}.${field}`, context);
        if (![0, 1, 2].includes(governance.gateStatus) || typeof governance.observedSlot !== "number"
            || !Number.isSafeInteger(governance.observedSlot) || governance.observedSlot < MAINNET_PROFILE.deployedSlot)
            fail(gp, "invalid finalized gate status/slot", governance, context);
        canonicalU64(governance.epoch, `${gp}.epoch`, context);
        exactBoolean(governance.gateActive, governance.gateStatus === 0, `${gp}.gateActive`, context);
        exactBoolean(governance.tradeReady, false, `${gp}.tradeReady`, context);
        exactString(governance.readinessReason, governance.gateStatus === 0 ? "MAINNET_MARKET_AND_PHOTON_QUALIFICATION_REQUIRED" : "MAINNET_GATE_NOT_ACTIVE", `${gp}.readinessReason`, context);
    }
    if (!Object.hasOwn(identity, "collateral") && !Object.hasOwn(identity, "light"))
        return;
    const collateralPath = `${identityPath}.collateral`;
    const collateral = exactObject(identity.collateral, [
        "vaultConfigAddress", "mintAddress", "custodyAddress", "tokenProgram", "decimals",
        "custodyAuthority", "custodyAmountAtomic",
    ], [
        "vaultConfigAddress", "mintAddress", "custodyAddress", "tokenProgram", "decimals",
        "custodyAuthority", "custodyAmountAtomic",
    ], collateralPath, context);
    const vaultConfig = base58Address(collateral.vaultConfigAddress, `${collateralPath}.vaultConfigAddress`, context);
    base58Address(collateral.mintAddress, `${collateralPath}.mintAddress`, context);
    base58Address(collateral.custodyAddress, `${collateralPath}.custodyAddress`, context);
    exactString(collateral.tokenProgram, SPL_TOKEN_PROGRAM_ID, `${collateralPath}.tokenProgram`, context);
    if (collateral.decimals !== 6)
        fail(`${collateralPath}.decimals`, "current collateral mint must use exactly 6 decimals", collateral.decimals, context);
    const custodyAuthority = base58Address(collateral.custodyAuthority, `${collateralPath}.custodyAuthority`, context);
    if (custodyAuthority !== vaultConfig)
        fail(`${collateralPath}.custodyAuthority`, "must equal the current VaultConfig PDA", custodyAuthority, context);
    canonicalUnsignedDecimal(collateral.custodyAmountAtomic, `${collateralPath}.custodyAmountAtomic`, context);
    const lightPath = `${identityPath}.light`;
    const light = exactObject(identity.light, [
        "tokenProgram", "systemProgram", "accountCompressionProgram", "compressibleConfigProgram",
        "cpiAuthority", "compressibleConfig", "rentSponsor", "addressTree", "addressQueue", "stateTrees",
    ], [
        "tokenProgram", "systemProgram", "accountCompressionProgram", "compressibleConfigProgram",
        "cpiAuthority", "compressibleConfig", "rentSponsor", "addressTree", "addressQueue", "stateTrees",
    ], lightPath, context);
    validateLinkedProgramIdentity(light.tokenProgram, CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.tokenProgram, `${lightPath}.tokenProgram`, context);
    validateLinkedProgramIdentity(light.systemProgram, CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.systemProgram, `${lightPath}.systemProgram`, context);
    validateLinkedProgramIdentity(light.accountCompressionProgram, CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.accountCompressionProgram, `${lightPath}.accountCompressionProgram`, context);
    validateLinkedProgramIdentity(light.compressibleConfigProgram, CURRENT_LIGHT_PROGRAM_DEPLOYMENTS.compressibleConfigProgram, `${lightPath}.compressibleConfigProgram`, context);
    exactString(light.cpiAuthority, CURRENT_LIGHT_CPI_AUTHORITY, `${lightPath}.cpiAuthority`, context);
    exactString(light.compressibleConfig, CURRENT_LIGHT_CONFIG, `${lightPath}.compressibleConfig`, context);
    exactString(light.rentSponsor, CURRENT_LIGHT_RENT_SPONSOR, `${lightPath}.rentSponsor`, context);
    exactString(light.addressTree, CURRENT_LIGHT_ADDRESS_TREE, `${lightPath}.addressTree`, context);
    exactString(light.addressQueue, CURRENT_LIGHT_ADDRESS_TREE, `${lightPath}.addressQueue`, context);
    const trees = arrayValue(light.stateTrees, `${lightPath}.stateTrees`, context);
    if (trees.length !== CURRENT_LIGHT_STATE_CONTEXTS.length)
        fail(`${lightPath}.stateTrees`, "expected the five authorized StateV2 contexts", trees, context);
    trees.forEach((treeValue, index) => {
        const treePath = `${lightPath}.stateTrees[${index}]`;
        const tree = exactObject(treeValue, ["stateTree", "queue", "cpiContext"], ["stateTree", "queue", "cpiContext"], treePath, context);
        const expected = CURRENT_LIGHT_STATE_CONTEXTS[index];
        exactString(tree.stateTree, expected.stateTree, `${treePath}.stateTree`, context);
        exactString(tree.queue, expected.queue, `${treePath}.queue`, context);
        exactString(tree.cpiContext, expected.cpiContext, `${treePath}.cpiContext`, context);
    });
}
function validateLinkedProgramIdentity(value, expected, path, context) {
    const fields = [
        "programId", "programDataAddress", "programDataBytes", "upgradeAuthority", "executable",
        "deployedSlot", "payloadBytes", "payloadSha256",
    ];
    const program = exactObject(value, fields, fields, path, context);
    exactString(program.programId, expected.programId, `${path}.programId`, context);
    exactString(program.programDataAddress, expected.programDataAddress, `${path}.programDataAddress`, context);
    if (program.programDataBytes !== expected.programDataBytes)
        fail(`${path}.programDataBytes`, "expected the reviewed Light ProgramData allocation", program.programDataBytes, context);
    exactString(program.upgradeAuthority, expected.upgradeAuthority, `${path}.upgradeAuthority`, context);
    exactBoolean(program.executable, true, `${path}.executable`, context);
    exactString(program.deployedSlot, String(expected.deployedSlot), `${path}.deployedSlot`, context);
    if (program.payloadBytes !== expected.payloadBytes)
        fail(`${path}.payloadBytes`, "expected the reviewed Light program payload length", program.payloadBytes, context);
    exactString(program.payloadSha256, expected.payloadSha256, `${path}.payloadSha256`, context);
}
function decodeProgramRegistryData(data, context, path) {
    exactObject(data, ["freshness", "protocol", "programs"], ["protocol", "programs"], path, context);
    const programs = arrayValue(data.programs, `${path}.programs`, context);
    if (programs.length !== 1)
        fail(`${path}.programs`, "expected the one current Spread deployment", programs, context);
    programs.forEach((program, index) => validateCurrentProtocol(program, `${path}.programs[${index}]`, context));
}
function decodeMarketsData(data, context, path) {
    exactObject(data, ["freshness", "protocol", "markets"], ["protocol", "markets"], path, context);
    const markets = arrayValue(data.markets, `${path}.markets`, context);
    const seenProducts = new Set();
    markets.forEach((market, index) => {
        validateMarketSummary(market, `${path}.markets[${index}]`, context);
        const marketId = objectValue(market, `${path}.markets[${index}]`, context).marketId;
        if (seenProducts.has(marketId))
            fail(`${path}.markets[${index}].marketId`, "duplicate product market row", marketId, context);
        seenProducts.add(marketId);
    });
}
function validateMarketSummary(value, path, context) {
    const market = exactObject(value, [
        "marketId", "name", "displayName", "symbol", "title", "subtitle", "status", "onChainAvailable", "expiries",
    ], [
        "marketId", "name", "displayName", "symbol", "title", "subtitle", "status", "onChainAvailable", "expiries",
    ], path, context);
    const marketId = currentProductId(market.marketId, `${path}.marketId`, context);
    for (const field of ["name", "displayName", "symbol", "title", "subtitle"]) {
        nonemptyStringValue(market[field], `${path}.${field}`, context);
    }
    enumString(market.status, ["current", "paused"], `${path}.status`, context);
    exactBoolean(market.onChainAvailable, true, `${path}.onChainAvailable`, context);
    const seenSeries = new Set();
    const expiries = arrayValue(market.expiries, `${path}.expiries`, context);
    if (expiries.length === 0)
        fail(`${path}.expiries`, "current product rows require at least one exact series", expiries, context);
    expiries.forEach((expiry, index) => {
        validateMarketExpiry(expiry, marketId, `${path}.expiries[${index}]`, context);
        const seriesId = objectValue(expiry, `${path}.expiries[${index}]`, context).expiryId;
        if (seenSeries.has(seriesId))
            fail(`${path}.expiries[${index}].expiryId`, "duplicate current series row", seriesId, context);
        seenSeries.add(seriesId);
    });
}
function validateMarketExpiry(value, marketId, path, context) {
    const expiry = exactObject(value, [
        "expiryId", "label", "optionKind", "lowerStrike", "upperStrike", "priceDisplayDecimals",
        "quoteDisplayDecimals", "fairPrice", "settlementUtc", "poolStatus",
    ], [
        "expiryId", "label", "optionKind", "lowerStrike", "upperStrike", "priceDisplayDecimals",
        "quoteDisplayDecimals", "fairPrice", "settlementUtc", "poolStatus",
    ], path, context);
    currentSeriesId(expiry.expiryId, marketId, `${path}.expiryId`, context);
    nonemptyStringValue(expiry.label, `${path}.label`, context);
    enumString(expiry.optionKind, ["call_spread", "put_spread"], `${path}.optionKind`, context);
    const lowerStrike = canonicalUnsignedDecimal(expiry.lowerStrike, `${path}.lowerStrike`, context);
    const upperStrike = canonicalUnsignedDecimal(expiry.upperStrike, `${path}.upperStrike`, context);
    if (BigInt(lowerStrike) >= BigInt(upperStrike)) {
        fail(`${path}.upperStrike`, "must be greater than lowerStrike", expiry.upperStrike, context);
    }
    safeIntegerValue(expiry.priceDisplayDecimals, `${path}.priceDisplayDecimals`, context, 0, 18);
    safeIntegerValue(expiry.quoteDisplayDecimals, `${path}.quoteDisplayDecimals`, context, 0, 18);
    if (expiry.fairPrice !== null) {
        if (typeof expiry.fairPrice === "string")
            canonicalDecimalText(expiry.fairPrice, `${path}.fairPrice`, context);
        else
            finiteNumberValue(expiry.fairPrice, `${path}.fairPrice`, context, 0);
    }
    if (expiry.settlementUtc !== null)
        isoTimestamp(expiry.settlementUtc, `${path}.settlementUtc`, context);
    nonemptyStringValue(expiry.poolStatus, `${path}.poolStatus`, context);
}
function decodeMarketSnapshotData(expectedMarketId) {
    return (data, context, path) => {
        exactObject(data, ["freshness",
            "protocol", "marketId", "name", "displayName", "symbol", "title", "subtitle", "status",
            "onChainAvailable", "expiries", "observedAtSlot",
        ], [
            "protocol", "marketId", "name", "displayName", "symbol", "title", "subtitle", "status",
            "onChainAvailable", "expiries", "observedAtSlot",
        ], path, context);
        validateMarketSummary({
            marketId: data.marketId,
            name: data.name,
            displayName: data.displayName,
            symbol: data.symbol,
            title: data.title,
            subtitle: data.subtitle,
            status: data.status,
            onChainAvailable: data.onChainAvailable,
            expiries: data.expiries,
        }, path, context);
        if (data.marketId !== expectedMarketId) {
            fail(`${path}.marketId`, "must match the requested product", data.marketId, context);
        }
        canonicalU64(data.observedAtSlot, `${path}.observedAtSlot`, context);
    };
}
function decodeChartData(data, context, path) {
    exactObject(data, ["freshness", "protocol", "points"], ["protocol", "points"], path, context);
    arrayValue(data.points, `${path}.points`, context).forEach((point, index) => {
        const pointPath = `${path}.points[${index}]`;
        const row = exactObject(point, [
            "schemaVersion", "marketId", "expiryId", "expiryLabel", "settlementUtc", "timestampMs",
            "asOf", "fairPriceMicros", "oraclePriceMicros", "liquidityQuoteAtomic", "notionalQuoteAtomic",
        ], [
            "schemaVersion", "marketId", "expiryId", "expiryLabel", "settlementUtc", "timestampMs",
            "asOf", "fairPriceMicros", "oraclePriceMicros", "liquidityQuoteAtomic", "notionalQuoteAtomic",
        ], pointPath, context);
        if (row.schemaVersion !== 1)
            fail(`${pointPath}.schemaVersion`, "expected current chart schema version 1", row.schemaVersion, context);
        currentProductId(row.marketId, `${pointPath}.marketId`, context);
        for (const field of ["expiryId", "expiryLabel", "settlementUtc"]) {
            if (row[field] !== null)
                fail(`${pointPath}.${field}`, "market-wide chart points require null expiry metadata", row[field], context);
        }
        canonicalU64(row.timestampMs, `${pointPath}.timestampMs`, context);
        isoTimestamp(row.asOf, `${pointPath}.asOf`, context);
        for (const field of [
            "fairPriceMicros", "oraclePriceMicros", "liquidityQuoteAtomic", "notionalQuoteAtomic",
        ])
            canonicalUnsignedDecimal(row[field], `${pointPath}.${field}`, context);
    });
}
function decodeCurrentCollectiveOperationSubmitData(data, context, path) {
    exactObject(data, ["freshness",
        "protocol", "operationId", "preparedPlanDigest", "batchIndex", "batchCount",
        "submission", "confirmation",
    ], [
        "protocol", "operationId", "preparedPlanDigest", "batchIndex", "batchCount",
        "submission", "confirmation",
    ], path, context);
    stringPattern(data.operationId, /^[0-9a-f]{64}$/, `${path}.operationId`, context, "a lowercase SHA-256 digest");
    stringPattern(data.preparedPlanDigest, /^[0-9a-f]{64}$/, `${path}.preparedPlanDigest`, context, "a lowercase SHA-256 digest");
    const batchIndex = safeIntegerValue(data.batchIndex, `${path}.batchIndex`, context, 0, 255);
    const batchCount = safeIntegerValue(data.batchCount, `${path}.batchCount`, context, 1, 256);
    if (batchIndex >= batchCount) {
        fail(`${path}.batchIndex`, "must be lower than batchCount", data.batchIndex, context);
    }
    const submission = exactObject(data.submission, ["signature"], ["signature"], `${path}.submission`, context);
    base58Text(submission.signature, `${path}.submission.signature`, context, 64, 88, 64);
    validateCurrentConfirmation(data.confirmation, `${path}.confirmation`, context);
}
function decodeCurrentCollectiveOperationStatusData(operationKinds) {
    return (data, context, path) => {
        exactObject(data, ["freshness",
            "protocol", "operationId", "preparedPlanDigest", "operation", "status",
            "nextBatchIndex", "batchCount", "submissions", "lastError",
        ], [
            "protocol", "operationId", "preparedPlanDigest", "operation", "status",
            "nextBatchIndex", "batchCount", "submissions", "lastError",
        ], path, context);
        stringPattern(data.operationId, /^[0-9a-f]{64}$/, `${path}.operationId`, context, "a lowercase SHA-256 digest");
        stringPattern(data.preparedPlanDigest, /^[0-9a-f]{64}$/, `${path}.preparedPlanDigest`, context, "a lowercase SHA-256 digest");
        enumString(data.operation, operationKinds, `${path}.operation`, context);
        enumString(data.status, ["prepared", "submitted", "pending", "confirmed", "failed"], `${path}.status`, context);
        const batchCount = safeIntegerValue(data.batchCount, `${path}.batchCount`, context, 1, 256);
        const nextBatchIndex = safeIntegerValue(data.nextBatchIndex, `${path}.nextBatchIndex`, context, 0, batchCount);
        const submissions = arrayValue(data.submissions, `${path}.submissions`, context);
        if (submissions.length > batchCount || submissions.length > nextBatchIndex + 1) {
            fail(`${path}.submissions`, "contains more batches than the lifecycle cursor permits", data.submissions, context);
        }
        const seen = new Set();
        submissions.forEach((value, index) => {
            const submissionPath = `${path}.submissions[${index}]`;
            const submission = exactObject(value, [
                "batchIndex", "signature", "transactionSha256", "messageSha256", "status", "confirmation",
            ], [
                "batchIndex", "signature", "transactionSha256", "messageSha256", "status", "confirmation",
            ], submissionPath, context);
            const batchIndex = safeIntegerValue(submission.batchIndex, `${submissionPath}.batchIndex`, context, 0, batchCount - 1);
            if (seen.has(batchIndex)) {
                fail(`${submissionPath}.batchIndex`, "must be unique", submission.batchIndex, context);
            }
            seen.add(batchIndex);
            base58Text(submission.signature, `${submissionPath}.signature`, context, 64, 88, 64);
            stringPattern(submission.transactionSha256, /^[0-9a-f]{64}$/, `${submissionPath}.transactionSha256`, context, "a lowercase SHA-256 digest");
            stringPattern(submission.messageSha256, /^[0-9a-f]{64}$/, `${submissionPath}.messageSha256`, context, "a lowercase SHA-256 digest");
            enumString(submission.status, ["submitted", "pending", "confirmed", "failed"], `${submissionPath}.status`, context);
            if (submission.confirmation !== null) {
                validateCurrentConfirmation(submission.confirmation, `${submissionPath}.confirmation`, context);
            }
        });
        if (data.lastError !== null) {
            nonemptyStringValue(data.lastError, `${path}.lastError`, context);
        }
    };
}
function validateCurrentConfirmation(value, path, context) {
    const confirmation = objectValue(value, path, context);
    const status = enumString(confirmation.status, ["pending", "failed", "confirmed"], `${path}.status`, context);
    if (status !== "confirmed") {
        exactObject(confirmation, ["status", "reason"], ["status", "reason"], path, context);
        enumString(confirmation.reason, [
            "signature_not_found", "transaction_failed", "not_confirmed", "transaction_not_available",
        ], `${path}.reason`, context);
        return;
    }
    exactObject(confirmation, [
        "status", "confirmationStatus", "confirmedSlot", "confirmedTransactionSha256", "messageSha256", "blockTime",
    ], [
        "status", "confirmationStatus", "confirmedSlot", "confirmedTransactionSha256", "messageSha256", "blockTime",
    ], path, context);
    enumString(confirmation.confirmationStatus, ["confirmed", "finalized"], `${path}.confirmationStatus`, context);
    canonicalU64(confirmation.confirmedSlot, `${path}.confirmedSlot`, context);
    stringPattern(confirmation.confirmedTransactionSha256, /^[0-9a-f]{64}$/, `${path}.confirmedTransactionSha256`, context, "a lowercase SHA-256 digest");
    stringPattern(confirmation.messageSha256, /^[0-9a-f]{64}$/, `${path}.messageSha256`, context, "a lowercase SHA-256 digest");
    if (confirmation.blockTime !== null)
        canonicalU64(confirmation.blockTime, `${path}.blockTime`, context);
}
function decodeLedgerData(expectedOwner) {
    return (data, context, path) => {
        exactObject(data, ["freshness", "protocol", "ledger"], ["protocol", "ledger"], path, context);
        const ledger = exactObject(data.ledger, [
            "stateNamespace", "ownerPubkey", "summaries", "events",
        ], [
            "stateNamespace", "ownerPubkey", "summaries", "events",
        ], `${path}.ledger`, context);
        exactString(ledger.stateNamespace, CURRENT_PROTOCOL_FIELDS.namespace, `${path}.ledger.stateNamespace`, context);
        const owner = base58Address(ledger.ownerPubkey, `${path}.ledger.ownerPubkey`, context);
        if (owner !== expectedOwner)
            fail(`${path}.ledger.ownerPubkey`, "must match the requested owner", owner, context);
        const summaries = arrayValue(ledger.summaries, `${path}.ledger.summaries`, context);
        if (summaries.length > 1)
            fail(`${path}.ledger.summaries`, "must contain at most the canonical player-ledger balance", summaries, context);
        summaries.forEach((value, index) => {
            const summaryPath = `${path}.ledger.summaries[${index}]`;
            const summary = exactObject(value, ["kind", "address", "found", "balance"], ["kind", "address", "found", "balance"], summaryPath, context);
            exactString(summary.kind, "oracle_player_ledger_balance", `${summaryPath}.kind`, context);
            base58Address(summary.address, `${summaryPath}.address`, context);
            exactBoolean(summary.found, true, `${summaryPath}.found`, context);
            const balance = exactObject(summary.balance, [
                "bump", "ownerPubkey", "availableBalance", "lockedBalance", "lastUpdatedSlot", "lastBalanceChangeSlot",
            ], [
                "bump", "ownerPubkey", "availableBalance", "lockedBalance", "lastUpdatedSlot", "lastBalanceChangeSlot",
            ], `${summaryPath}.balance`, context);
            safeIntegerValue(balance.bump, `${summaryPath}.balance.bump`, context, 0, 255);
            const balanceOwner = base58Address(balance.ownerPubkey, `${summaryPath}.balance.ownerPubkey`, context);
            if (balanceOwner !== expectedOwner)
                fail(`${summaryPath}.balance.ownerPubkey`, "must match the requested owner", balanceOwner, context);
            decimalAmount(balance.availableBalance, `${summaryPath}.balance.availableBalance`, context);
            decimalAmount(balance.lockedBalance, `${summaryPath}.balance.lockedBalance`, context);
            canonicalU64(balance.lastUpdatedSlot, `${summaryPath}.balance.lastUpdatedSlot`, context);
            canonicalU64(balance.lastBalanceChangeSlot, `${summaryPath}.balance.lastBalanceChangeSlot`, context);
        });
        const events = arrayValue(ledger.events, `${path}.ledger.events`, context);
        if (events.length !== 0)
            fail(`${path}.ledger.events`, "current ledger event history is not exposed by rc.44", events, context);
    };
}
function decodeOracleStateData(data, context, path) {
    exactObject(data, ["freshness", "protocol", "state", "markets"], ["protocol", "state", "markets"], path, context);
    const state = exactObject(data.state, ["status", "markets", "months", "latest", "history"], ["status", "markets", "months", "latest", "history"], `${path}.state`, context);
    enumString(state.status, ["empty", "current"], `${path}.state.status`, context);
    const markets = validateOracleFacts(state.markets, `${path}.state.markets`, context);
    const months = validateOracleFacts(state.months, `${path}.state.months`, context);
    if (state.latest !== null)
        validateOracleFact(state.latest, `${path}.state.latest`, context);
    const history = validateOracleFacts(state.history, `${path}.state.history`, context);
    validateOracleFacts(data.markets, `${path}.markets`, context);
    if (JSON.stringify(state.markets) !== JSON.stringify(data.markets)) {
        fail(`${path}.markets`, "must exactly match state.markets", data.markets, context);
    }
    if (state.status === "empty" && (markets.length !== 0 || months.length !== 0 || history.length !== 0 || state.latest !== null)) {
        fail(`${path}.state.status`, "empty Oracle state must contain no current facts", state.status, context);
    }
    if (state.status === "current" && markets.length === 0) {
        fail(`${path}.state.status`, "current Oracle state requires at least one current Market fact", state.status, context);
    }
}
function decodeOracleMarketsData(data, context, path) {
    exactObject(data, ["freshness", "protocol", "markets"], ["protocol", "markets"], path, context);
    validateOracleFacts(data.markets, `${path}.markets`, context);
}
function decodeOracleMarketData(expectedMarketId) {
    return (data, context, path) => {
        exactObject(data, ["freshness", "protocol", "market", "months", "latest", "history"], ["protocol", "market", "months", "latest", "history"], path, context);
        validateMarketSummary(data.market, `${path}.market`, context);
        const market = objectValue(data.market, `${path}.market`, context);
        if (market.marketId !== expectedMarketId)
            fail(`${path}.market.marketId`, "must match the requested product", market.marketId, context);
        validateOracleFacts(data.months, `${path}.months`, context, expectedMarketId);
        if (data.latest !== null)
            validateOracleFact(data.latest, `${path}.latest`, context, expectedMarketId);
        validateOracleFacts(data.history, `${path}.history`, context, expectedMarketId);
    };
}
function decodeOracleLatestData(expectedMarketId) {
    return (data, context, path) => {
        exactObject(data, ["freshness", "protocol", "latest"], ["protocol", "latest"], path, context);
        if (data.latest !== null)
            validateOracleFact(data.latest, `${path}.latest`, context, expectedMarketId);
    };
}
function decodeOracleHistoryData(expectedMarketId) {
    return (data, context, path) => {
        exactObject(data, ["freshness", "protocol", "history"], ["protocol", "history"], path, context);
        validateOracleFacts(data.history, `${path}.history`, context, expectedMarketId);
    };
}
function validateOracleFacts(value, path, context, expectedMarketId) {
    const facts = arrayValue(value, path, context);
    const seen = new Set();
    facts.forEach((fact, index) => {
        const identity = validateOracleFact(fact, `${path}[${index}]`, context, expectedMarketId);
        const key = `${identity.marketId}/${identity.expiryId}`;
        if (seen.has(key))
            fail(`${path}[${index}].expiryId`, "duplicate current Oracle series fact", identity.expiryId, context);
        seen.add(key);
    });
    return facts;
}
function validateOracleFact(value, path, context, expectedMarketId) {
    const fact = exactObject(value, [
        "marketId", "expiryId", "onChainAvailable", "oracleMonthAvailable", "lastUpdatedSlot", "settlementStatus",
    ], [
        "marketId", "expiryId", "onChainAvailable", "oracleMonthAvailable", "lastUpdatedSlot", "settlementStatus",
    ], path, context);
    const marketId = currentProductId(fact.marketId, `${path}.marketId`, context);
    if (expectedMarketId !== undefined && marketId !== expectedMarketId) {
        fail(`${path}.marketId`, "must match the requested product", marketId, context);
    }
    const expiryId = currentSeriesId(fact.expiryId, marketId, `${path}.expiryId`, context);
    exactBoolean(fact.onChainAvailable, true, `${path}.onChainAvailable`, context);
    booleanValue(fact.oracleMonthAvailable, `${path}.oracleMonthAvailable`, context);
    if (fact.lastUpdatedSlot !== null)
        canonicalU64(fact.lastUpdatedSlot, `${path}.lastUpdatedSlot`, context);
    if (fact.settlementStatus !== null)
        jsonPrimitiveValue(fact.settlementStatus, `${path}.settlementStatus`, context);
    return Object.freeze({ marketId, expiryId });
}
function decodeOracleDraftPrepareData(expectedRequest) {
    return (data, context, path) => {
        exactObject(data, ["freshness", "protocol", "draft"], ["protocol", "draft"], path, context);
        validateOracleDraftPlan(data.draft, expectedRequest, `${path}.draft`, context);
    };
}
function validateOracleDraftPlan(value, expectedRequest, path, context) {
    const plan = exactObject(value, [
        "stateNamespace", "deployment", "operation", "operationId", "instructions",
        "setupInstructionBatches", "proofFacts", "actionType", "request", "oracle",
        "currentInstructionTags", "transportInstructionTags", "transportInstructionName",
        "logicalInstruction", "outerInstruction", "compressedTransport", "transactionLookupTable",
        "transportMetrics", "setupTransactions",
        "transaction", "preparedPlanDigest",
    ], [
        "stateNamespace", "deployment", "operation", "operationId", "instructions",
        "setupInstructionBatches", "proofFacts", "actionType", "request", "oracle",
        "currentInstructionTags", "transportInstructionTags", "transportInstructionName",
        "logicalInstruction", "outerInstruction", "compressedTransport", "transactionLookupTable",
        "transportMetrics", "setupTransactions",
        "transaction", "preparedPlanDigest",
    ], path, context);
    exactString(plan.stateNamespace, CURRENT_PROTOCOL_FIELDS.namespace, `${path}.stateNamespace`, context);
    validateOracleDraftDeployment(plan.deployment, `${path}.deployment`, context);
    exactString(plan.operation, "oracle_draft", `${path}.operation`, context);
    sha256Digest(plan.operationId, `${path}.operationId`, context);
    sha256Digest(plan.preparedPlanDigest, `${path}.preparedPlanDigest`, context);
    exactString(plan.actionType, expectedRequest.actionType, `${path}.actionType`, context);
    validateExactJsonProjection(plan.request, redactCurrentOracleActionRequest(expectedRequest), `${path}.request`, context);
    const logicalTag = CURRENT_ORACLE_LOGICAL_TAG_BY_ACTION[expectedRequest.actionType];
    const logicalName = CURRENT_ORACLE_INSTRUCTION_NAME_BY_ACTION[expectedRequest.actionType];
    const direct = CURRENT_ORACLE_DIRECT_ACTIONS.has(expectedRequest.actionType);
    const transportTag = direct ? logicalTag : 205;
    const transportName = direct ? logicalName : "ExecuteCompressedStateV1";
    const logical = validateOracleInstructionManifest(plan.logicalInstruction, { actionType: expectedRequest.actionType, tag: logicalTag, instructionName: logicalName, wrapped: false }, `${path}.logicalInstruction`, context);
    const outer = validateOracleInstructionManifest(plan.outerInstruction, {
        actionType: expectedRequest.actionType,
        tag: transportTag,
        instructionName: transportName,
        wrapped: !direct,
        logicalTag,
        logicalInstructionName: logicalName,
    }, `${path}.outerInstruction`, context);
    const currentTags = arrayValue(plan.currentInstructionTags, `${path}.currentInstructionTags`, context);
    if (currentTags.length !== 1 || currentTags[0] !== logicalTag)
        fail(`${path}.currentInstructionTags`, `expected only logical Oracle tag ${logicalTag}`, currentTags, context);
    const transportTags = arrayValue(plan.transportInstructionTags, `${path}.transportInstructionTags`, context);
    if (transportTags.length !== 1 || transportTags[0] !== transportTag)
        fail(`${path}.transportInstructionTags`, `expected only transport tag ${transportTag}`, transportTags, context);
    exactString(plan.transportInstructionName, transportName, `${path}.transportInstructionName`, context);
    const instructions = arrayValue(plan.instructions, `${path}.instructions`, context);
    const prefix = logicalTag === 139 ? currentOracleActivationSetupManifests(new PublicKey(CURRENT_PROGRAM_ID), new PublicKey(expectedRequest.ownerPubkey)) : [];
    if (instructions.length !== prefix.length + 1)
        fail(`${path}.instructions`, "Oracle instruction count differs from exact action grammar", instructions, context);
    prefix.forEach((expected, index) => validateExactJsonProjection(instructions[index], expected, `${path}.instructions[${index}]`, context));
    validateExactJsonProjection(instructions[instructions.length - 1], plan.outerInstruction, `${path}.instructions`, context);
    const actionInstructions = [...prefix.map(expected => ({
            object: expected, programId: expected.programId, dataBase64: expected.dataBase64,
            data: canonicalBase64(expected.dataBase64, path, context), accounts: expected.accounts,
        })), outer];
    const setupBatches = arrayValue(plan.setupInstructionBatches, `${path}.setupInstructionBatches`, context);
    if (setupBatches.length !== 0)
        fail(`${path}.setupInstructionBatches`, "current Oracle drafts have no setup instruction batches", setupBatches, context);
    const setupTransactions = arrayValue(plan.setupTransactions, `${path}.setupTransactions`, context);
    if (setupTransactions.length !== 0)
        fail(`${path}.setupTransactions`, "current Oracle drafts have no setup transactions", setupTransactions, context);
    const oracle = validateOraclePlanIdentity(plan.oracle, expectedRequest, `${path}.oracle`, context);
    const proof = validateOracleDraftProofFacts(plan.proofFacts, expectedRequest, oracle, logicalTag, transportTag, `${path}.proofFacts`, context);
    const logicalInstructionDigest = oracleInstructionSha256(logical);
    const outerInstructionDigest = oracleInstructionSha256(outer);
    exactString(proof.logicalInstructionSha256, logicalInstructionDigest, `${path}.proofFacts.logicalInstructionSha256`, context);
    exactString(proof.outerInstructionSha256, outerInstructionDigest, `${path}.proofFacts.outerInstructionSha256`, context);
    let compressedWitness = null;
    let decodedOuter = null;
    let lookupWitness = null;
    if (direct) {
        if (plan.compressedTransport !== null)
            fail(`${path}.compressedTransport`, "direct Oracle actions must not carry a tag-205 witness", plan.compressedTransport, context);
        if (plan.transactionLookupTable !== null)
            fail(`${path}.transactionLookupTable`, "direct Oracle actions must not use a compressed-state lookup table", plan.transactionLookupTable, context);
        validateExactJsonProjection(plan.outerInstruction, plan.logicalInstruction, `${path}.outerInstruction`, context);
    }
    else {
        decodedOuter = decodeOracleCompressedEnvelopeForClient(outer.data, `${path}.outerInstruction.dataBase64`, context);
        if (decodedOuter.logicalTag !== logicalTag || bytesToBase64(decodedOuter.inner) !== logical.dataBase64) {
            fail(`${path}.outerInstruction.dataBase64`, "tag 205 must contain the exact selected logical Oracle instruction", outer.dataBase64, context);
        }
        compressedWitness = validateOracleCompressedWitness(plan.compressedTransport, expectedRequest, outer, decodedOuter, proof, `${path}.compressedTransport`, context);
        lookupWitness = validateOracleLookupTableWitness(plan.transactionLookupTable, `${path}.transactionLookupTable`, context);
    }
    const transportMetrics = validateOracleTransportMetrics(plan.transportMetrics, outer, expectedRequest.ownerPubkey, plan.transactionLookupTable, `${path}.transportMetrics`, context);
    validateOracleLookupProofBinding(proof, plan.transactionLookupTable, transportMetrics, `${path}.proofFacts`, context);
    const parsedTransaction = validateOracleDraftTransaction(plan.transaction, actionInstructions, expectedRequest.ownerPubkey, proof.recentBlockhash, transportMetrics, lookupWitness, `${path}.transaction`, context);
    if (parsedTransaction.version !== 0)
        fail(`${path}.transaction.serializedTransactionBase64`, "Oracle prepares require the exact v0 transport", parsedTransaction.version, context);
    if (compressedWitness !== null && decodedOuter !== null) {
        validateOracleCompressedDigestBindings(compressedWitness, decodedOuter, logical, outer, `${path}.compressedTransport`, context);
        validateOracleCompressedAccessBindings(compressedWitness, decodedOuter, outer, `${path}.compressedTransport`, context);
    }
    if (lookupWitness !== null)
        validateOracleLookupDigestBindings(lookupWitness, `${path}.transactionLookupTable`, context);
    validateOracleParsedTransportMetrics(parsedTransaction, transportMetrics, lookupWitness, `${path}.transportMetrics`, context);
    exactString(plan.operationId, oracleOperationId(actionInstructions, proof), `${path}.operationId`, context);
    const { preparedPlanDigest: _preparedPlanDigest, ...planWithoutDigest } = plan;
    exactString(plan.preparedPlanDigest, preparedPlanSha256("oracle_draft", planWithoutDigest), `${path}.preparedPlanDigest`, context);
}
function validateOracleDraftDeployment(value, path, context) {
    const deployment = exactObject(value, [
        "schemaVersion", "sourceCommit", "release", "cluster", "rpcUrl", "genesisHash",
        "programId", "programDataAddress", "programDataBytes", "upgradeAuthority", "deployedSlot",
        "programPayloadBytes", "programPayloadSha256", "namespace", "liquidityEngine",
        "contractMintModel", "stateTransport",
    ], [
        "schemaVersion", "sourceCommit", "release", "cluster", "rpcUrl", "genesisHash",
        "programId", "programDataAddress", "programDataBytes", "upgradeAuthority", "deployedSlot",
        "programPayloadBytes", "programPayloadSha256", "namespace", "liquidityEngine",
        "contractMintModel", "stateTransport",
    ], path, context);
    if (deployment.schemaVersion !== 2)
        fail(`${path}.schemaVersion`, "expected current deployment schema 2", deployment.schemaVersion, context);
    const exactFields = {
        sourceCommit: CURRENT_PROTOCOL_FIELDS.releaseCommit,
        release: CURRENT_PROTOCOL_FIELDS.releaseTag,
        cluster: CURRENT_PROTOCOL_FIELDS.cluster,
        rpcUrl: CURRENT_PROTOCOL_DEPLOYMENT_RECEIPT_RPC_URL,
        genesisHash: CURRENT_DEVNET_GENESIS_HASH,
        programId: CURRENT_PROGRAM_ID,
        programDataAddress: CURRENT_PROGRAM_DATA_ADDRESS,
        upgradeAuthority: CURRENT_UPGRADE_AUTHORITY,
        programPayloadSha256: CURRENT_PROGRAM_PAYLOAD_SHA256,
        namespace: CURRENT_PROTOCOL_FIELDS.namespace,
        liquidityEngine: "in_program_ameba_dlmm",
        contractMintModel: "classic_spl_with_light_interface",
        stateTransport: "light_hot_compressed_cold",
    };
    for (const [field, expected] of Object.entries(exactFields))
        exactString(deployment[field], expected, `${path}.${field}`, context);
    if (deployment.programDataBytes !== 1_241_821)
        fail(`${path}.programDataBytes`, "expected exact rc.44 ProgramData allocation", deployment.programDataBytes, context);
    if (deployment.deployedSlot !== 487_702_729)
        fail(`${path}.deployedSlot`, "expected exact rc.44 deployment slot", deployment.deployedSlot, context);
    if (deployment.programPayloadBytes !== 1_142_664)
        fail(`${path}.programPayloadBytes`, "expected exact rc.44 payload length", deployment.programPayloadBytes, context);
}
function validateOracleInstructionManifest(value, expected, path, context) {
    const manifest = exactObject(value, ["programId", "dataBase64", "accounts", "decodedParams"], ["programId", "dataBase64", "accounts", "decodedParams"], path, context);
    exactString(manifest.programId, CURRENT_PROGRAM_ID, `${path}.programId`, context);
    const data = canonicalBase64(manifest.dataBase64, `${path}.dataBase64`, context);
    if (data.length < 1 || data[0] !== expected.tag)
        fail(`${path}.dataBase64`, `expected instruction tag ${expected.tag}`, manifest.dataBase64, context);
    const accounts = arrayValue(manifest.accounts, `${path}.accounts`, context).map((value, index) => {
        const metaPath = `${path}.accounts[${index}]`;
        const meta = exactObject(value, ["pubkey", "isSigner", "isWritable"], ["pubkey", "isSigner", "isWritable"], metaPath, context);
        return Object.freeze({
            pubkey: base58Address(meta.pubkey, `${metaPath}.pubkey`, context),
            isSigner: booleanValue(meta.isSigner, `${metaPath}.isSigner`, context),
            isWritable: booleanValue(meta.isWritable, `${metaPath}.isWritable`, context),
        });
    });
    if (accounts.length < 1 || accounts.length > 96)
        fail(`${path}.accounts`, "Oracle instruction account count is outside 1..96", manifest.accounts, context);
    const decodedKeys = expected.wrapped
        ? ["instructionName", "tag", "oracleActionType", "logicalInstructionName", "logicalTag"]
        : ["instructionName", "tag", "oracleActionType"];
    const decoded = exactObject(manifest.decodedParams, decodedKeys, decodedKeys, `${path}.decodedParams`, context);
    exactString(decoded.instructionName, expected.instructionName, `${path}.decodedParams.instructionName`, context);
    if (decoded.tag !== expected.tag)
        fail(`${path}.decodedParams.tag`, `expected tag ${expected.tag}`, decoded.tag, context);
    exactString(decoded.oracleActionType, expected.actionType, `${path}.decodedParams.oracleActionType`, context);
    if (expected.wrapped) {
        exactString(decoded.logicalInstructionName, expected.logicalInstructionName, `${path}.decodedParams.logicalInstructionName`, context);
        if (decoded.logicalTag !== expected.logicalTag)
            fail(`${path}.decodedParams.logicalTag`, `expected logical tag ${expected.logicalTag}`, decoded.logicalTag, context);
    }
    return Object.freeze({ object: manifest, programId: CURRENT_PROGRAM_ID, dataBase64: manifest.dataBase64, data, accounts: Object.freeze(accounts) });
}
function validateOraclePlanIdentity(value, request, path, context) {
    const oracle = exactObject(value, ["marketId", "expiryId", "ownerPubkey", "market", "oracleMonth", "vaultConfig"], ["marketId", "expiryId", "ownerPubkey", "market", "oracleMonth", "vaultConfig"], path, context);
    exactString(oracle.marketId, request.marketId, `${path}.marketId`, context);
    exactString(oracle.expiryId, request.expiryId, `${path}.expiryId`, context);
    exactString(oracle.ownerPubkey, request.ownerPubkey, `${path}.ownerPubkey`, context);
    base58Address(oracle.market, `${path}.market`, context);
    base58Address(oracle.oracleMonth, `${path}.oracleMonth`, context);
    base58Address(oracle.vaultConfig, `${path}.vaultConfig`, context);
    return oracle;
}
function validateOracleDraftProofFacts(value, request, oracle, logicalTag, transportTag, path, context) {
    const proof = exactObject(value, [
        "actionType", "marketId", "expiryId", "ownerPubkey", "marketAddress", "oracleMonth",
        "logicalTag", "transportTag", "logicalInstructionSha256", "outerInstructionSha256",
        "witnessDigest", "providerOriginSha256", "proofContextSlot", "stateFinalizedSlot",
        "lookupTableAddress", "lookupTableAddressesSha256", "lookupTableAccountDataSha256",
        "lookupTableObservedFinalizedSlot", "lookupTableWritableIndexes", "lookupTableReadonlyIndexes",
        "serializedByteLength", "noLookupTableSerializedByteLength", "theoreticalAltMinimizedByteLength",
        "plannerFactsSha256", "recentBlockhash", ...([131, 133, 138, 139].includes(logicalTag)
            ? ["stakingEvidenceJson", "expectedAmbaAmountAtomic", "expectedSambaAmountAtomic", "earliestExecutionTs"] : []),
        ...([176, 177].includes(logicalTag) ? ["disputeEvidenceJson"] : []),
    ], [
        "actionType", "marketId", "expiryId", "ownerPubkey", "marketAddress", "oracleMonth",
        "logicalTag", "transportTag", "logicalInstructionSha256", "outerInstructionSha256",
        "witnessDigest", "providerOriginSha256", "proofContextSlot", "stateFinalizedSlot",
        "lookupTableAddress", "lookupTableAddressesSha256", "lookupTableAccountDataSha256",
        "lookupTableObservedFinalizedSlot", "lookupTableWritableIndexes", "lookupTableReadonlyIndexes",
        "serializedByteLength", "noLookupTableSerializedByteLength", "theoreticalAltMinimizedByteLength",
        "plannerFactsSha256", "recentBlockhash", ...([131, 133, 138, 139].includes(logicalTag)
            ? ["stakingEvidenceJson", "expectedAmbaAmountAtomic", "expectedSambaAmountAtomic", "earliestExecutionTs"] : []),
        ...([176, 177].includes(logicalTag) ? ["disputeEvidenceJson"] : []),
    ], path, context);
    exactString(proof.actionType, request.actionType, `${path}.actionType`, context);
    if ([131, 133, 138, 139].includes(logicalTag)) {
        for (const field of ["expectedAmbaAmountAtomic", "expectedSambaAmountAtomic", "earliestExecutionTs"]) {
            canonicalU64(proof[field], `${path}.${field}`, context);
        }
    }
    exactString(proof.marketId, request.marketId, `${path}.marketId`, context);
    exactString(proof.expiryId, request.expiryId, `${path}.expiryId`, context);
    exactString(proof.ownerPubkey, request.ownerPubkey, `${path}.ownerPubkey`, context);
    exactString(proof.marketAddress, oracle.market, `${path}.marketAddress`, context);
    if (logicalTag === 155) {
        if (proof.oracleMonth !== null)
            fail(`${path}.oracleMonth`, "global reward funding has no month-scoped proof fact", proof.oracleMonth, context);
    }
    else {
        exactString(proof.oracleMonth, oracle.oracleMonth, `${path}.oracleMonth`, context);
    }
    if (proof.logicalTag !== logicalTag)
        fail(`${path}.logicalTag`, `expected logical tag ${logicalTag}`, proof.logicalTag, context);
    if (proof.transportTag !== transportTag)
        fail(`${path}.transportTag`, `expected transport tag ${transportTag}`, proof.transportTag, context);
    for (const field of ["logicalInstructionSha256", "outerInstructionSha256", "plannerFactsSha256"])
        sha256Digest(proof[field], `${path}.${field}`, context);
    base58Address(proof.recentBlockhash, `${path}.recentBlockhash`, context);
    const compressed = transportTag === 205;
    for (const field of ["witnessDigest", "providerOriginSha256"]) {
        if (compressed)
            sha256Digest(proof[field], `${path}.${field}`, context);
        else if (proof[field] !== null)
            fail(`${path}.${field}`, "direct Oracle action must use null compressed proof summary", proof[field], context);
    }
    for (const field of ["proofContextSlot", "stateFinalizedSlot"]) {
        if (compressed)
            canonicalU64(proof[field], `${path}.${field}`, context);
        else if (proof[field] !== null)
            fail(`${path}.${field}`, "direct Oracle action must use null compressed slot summary", proof[field], context);
    }
    for (const field of [
        "lookupTableAddress", "lookupTableAddressesSha256", "lookupTableAccountDataSha256",
        "lookupTableObservedFinalizedSlot", "lookupTableWritableIndexes", "lookupTableReadonlyIndexes",
    ]) {
        if (compressed) {
            if (typeof proof[field] !== "string")
                fail(`${path}.${field}`, "wrapped Oracle action requires lookup-table proof facts", proof[field], context);
        }
        else if (proof[field] !== null) {
            fail(`${path}.${field}`, "direct Oracle action must use null lookup-table proof facts", proof[field], context);
        }
    }
    for (const field of ["serializedByteLength", "noLookupTableSerializedByteLength", "theoreticalAltMinimizedByteLength"]) {
        safeIntegerValue(proof[field], `${path}.${field}`, context, 1, 65_535);
    }
    if ([131, 133, 138, 139, 176, 177].includes(logicalTag)) {
        const field = [176, 177].includes(logicalTag) ? "disputeEvidenceJson" : "stakingEvidenceJson";
        const clockField = field === "disputeEvidenceJson" ? "currentSlot" : "currentUnixTimestamp";
        if (typeof proof[field] !== "string" || proof[field].length > 100_000)
            fail(path, "Oracle evidence frame is missing or oversized", proof[field], context);
        let frame;
        try {
            frame = JSON.parse(proof[field]);
        }
        catch {
            fail(path, "Oracle evidence is not JSON", proof[field], context);
        }
        const evidence = exactObject(frame, ["readWindowStartSlot", "readWindowEndSlot", clockField, "accountFacts"], ["readWindowStartSlot", "readWindowEndSlot", clockField, "accountFacts"], path, context);
        const start = safeIntegerValue(evidence.readWindowStartSlot, path, context, 0);
        const end = safeIntegerValue(evidence.readWindowEndSlot, path, context, start);
        canonicalU64(evidence[clockField], path, context);
        if (clockField === "currentSlot" && (BigInt(evidence[clockField]) < BigInt(start) || BigInt(evidence[clockField]) > BigInt(end)))
            fail(path, "dispute economic slot is outside evidence frame", evidence[clockField], context);
        const facts = arrayValue(evidence.accountFacts, path, context);
        if (facts.length < 1 || facts.length > 32)
            fail(path, "Oracle account count invalid", facts, context);
        const addresses = new Set();
        for (const value of facts) {
            const fact = exactObject(value, ["address", "owner", "executable", "dataBase64", "dataSha256", "observedSlot"], ["address", "owner", "executable", "dataBase64", "dataSha256", "observedSlot"], path, context);
            const address = base58Address(fact.address, path, context);
            if (addresses.has(address))
                fail(path, "Oracle evidence repeats an account", fact.address, context);
            addresses.add(address);
            safeIntegerValue(fact.observedSlot, path, context, start, end);
            if (fact.owner === null) {
                if (fact.executable !== null || fact.dataBase64 !== null || fact.dataSha256 !== null)
                    fail(path, "Oracle absence has partial account data", fact, context);
            }
            else {
                base58Address(fact.owner, path, context);
                booleanValue(fact.executable, path, context);
                const bytes = fact.dataBase64 === "" ? new Uint8Array() : canonicalBase64(fact.dataBase64, path, context);
                exactString(fact.dataSha256, sha256Hex(bytes), path, context);
            }
        }
    }
    return proof;
}
function decodeOracleCompressedEnvelopeForClient(bytes, path, context) {
    let offset = 0;
    const requireBytes = (length, label) => {
        if (offset + length > bytes.length)
            fail(path, `tag 205 is truncated while reading ${label}`, bytesToBase64(bytes), context);
    };
    const u8 = (label) => { requireBytes(1, label); return bytes[offset++]; };
    const u16 = (label) => { requireBytes(2, label); const result = bytes[offset] | (bytes[offset + 1] << 8); offset += 2; return result; };
    const u32 = (label) => { requireBytes(4, label); const result = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; offset += 4; return result; };
    const slice = (length, label) => { requireBytes(length, label); const result = bytes.slice(offset, offset + length); offset += length; return result; };
    if (u8("outer tag") !== 205)
        fail(path, "expected ExecuteCompressedStateV1 tag 205", bytes[0], context);
    const coreAccountCount = u8("core account count");
    const rentPayerIndex = u8("rent payer index");
    const proofOption = u8("validity proof option");
    let proof = null;
    if (proofOption === 1)
        proof = slice(128, "validity proof");
    else if (proofOption !== 0)
        fail(path, "tag 205 proof option is noncanonical", proofOption, context);
    const accessCount = u8("access count");
    if (accessCount < 1 || accessCount > 8)
        fail(path, "tag 205 access count is outside 1..8", accessCount, context);
    const compactLengths = Object.freeze({ 1: 44, 2: 152, 3: 112, 4: 104, 5: 81, 6: 16, 7: 17, 8: 115, 9: 190, 10: 96 });
    const accesses = [];
    for (let index = 0; index < accessCount; index += 1) {
        const kindByte = u8(`access ${index} kind`);
        const accountIndex = u8(`access ${index} account index`);
        if (kindByte === 2) {
            const domain = u8(`access ${index} domain`);
            if (compactLengths[domain] === undefined)
                fail(path, "tag 205 initialize domain is unknown", domain, context);
            accesses.push({ kind: "initialize", accountIndex, domain, addressTreeAccountIndex: u8("address tree index"), addressQueueAccountIndex: u8("address queue index"), addressRootIndex: u16("address root index"), outputStateTreeIndex: u8("output state tree index") });
            continue;
        }
        if (kindByte !== 0 && kindByte !== 1)
            fail(path, "tag 205 access kind is invalid", kindByte, context);
        const treeInfo = { rootIndex: u16("root index"), proveByIndex: u8("prove by index"), treeAccountIndex: u8("tree account index"), queueAccountIndex: u8("queue account index"), leafIndex: u32("leaf index") };
        if (treeInfo.proveByIndex !== 0 && treeInfo.proveByIndex !== 1)
            fail(path, "tag 205 proveByIndex is noncanonical", treeInfo.proveByIndex, context);
        const outputStateTreeIndex = kindByte === 1 ? u8("output state tree index") : undefined;
        const domain = u8(`access ${index} domain`);
        const compactLength = compactLengths[domain];
        if (compactLength === undefined)
            fail(path, "tag 205 compact domain is unknown", domain, context);
        const revision = readU64Le(slice(8, "revision"), 0).toString();
        const compactDataBase64 = bytesToBase64(slice(compactLength, "compact data"));
        accesses.push(kindByte === 0
            ? { kind: "readOnly", accountIndex, domain, treeInfo: { ...treeInfo, proveByIndex: treeInfo.proveByIndex === 1 }, revision, compactDataBase64 }
            : { kind: "mutable", accountIndex, domain, treeInfo: { ...treeInfo, proveByIndex: treeInfo.proveByIndex === 1 }, outputStateTreeIndex, revision, compactDataBase64 });
    }
    const innerLength = u16("inner instruction length");
    if (innerLength < 1 || innerLength > 12_288)
        fail(path, "tag 205 inner instruction length is outside 1..12288", innerLength, context);
    const inner = slice(innerLength, "inner instruction");
    if (offset !== bytes.length)
        fail(path, "tag 205 has trailing bytes", bytesToBase64(bytes.slice(offset)), context);
    if (rentPayerIndex >= coreAccountCount)
        fail(path, "tag 205 rent payer is outside the core prefix", rentPayerIndex, context);
    accesses.forEach((access) => {
        if (access.accountIndex >= coreAccountCount)
            fail(path, "tag 205 access is outside the core prefix", access.accountIndex, context);
    });
    return Object.freeze({ coreAccountCount, rentPayerIndex, proof, accesses: Object.freeze(accesses), inner, logicalTag: inner[0] });
}
function validateOracleCompressedWitness(value, request, outer, decodedOuter, proofFacts, path, context) {
    const witness = exactObject(value, [
        "providerOriginSha256", "marketSeriesId", "addressTree", "addressQueue", "outputStateTree", "outputQueue",
        "proofContextSlot", "stateFinalizedSlot", "roots", "rootIndices", "leafIndices", "treeInfos",
        "proofSha256", "logicalInstructionSha256", "outerInstructionSha256", "coreAccountCount", "rentPayerIndex",
        "coreAccounts", "accesses", "observationWitnessDigests", "existingAccessCount", "initializeAccessCount", "witnessDigest",
    ], [
        "providerOriginSha256", "marketSeriesId", "addressTree", "addressQueue", "outputStateTree", "outputQueue",
        "proofContextSlot", "stateFinalizedSlot", "roots", "rootIndices", "leafIndices", "treeInfos",
        "proofSha256", "logicalInstructionSha256", "outerInstructionSha256", "coreAccountCount", "rentPayerIndex",
        "coreAccounts", "accesses", "observationWitnessDigests", "existingAccessCount", "initializeAccessCount", "witnessDigest",
    ], path, context);
    for (const field of ["providerOriginSha256", "proofSha256", "logicalInstructionSha256", "outerInstructionSha256", "witnessDigest"])
        sha256Digest(witness[field], `${path}.${field}`, context);
    exactString(witness.marketSeriesId, request.expiryId, `${path}.marketSeriesId`, context);
    exactString(witness.addressTree, CURRENT_LIGHT_ADDRESS_TREE, `${path}.addressTree`, context);
    exactString(witness.addressQueue, CURRENT_LIGHT_ADDRESS_TREE, `${path}.addressQueue`, context);
    const outputTree = base58Address(witness.outputStateTree, `${path}.outputStateTree`, context);
    const outputQueue = base58Address(witness.outputQueue, `${path}.outputQueue`, context);
    if (!CURRENT_LIGHT_STATE_CONTEXTS.some((entry) => entry.stateTree === outputTree && entry.queue === outputQueue)) {
        fail(`${path}.outputStateTree`, "output tree/queue is not an authorized StateV2 pair", witness.outputStateTree, context);
    }
    canonicalU64(witness.proofContextSlot, `${path}.proofContextSlot`, context);
    canonicalU64(witness.stateFinalizedSlot, `${path}.stateFinalizedSlot`, context);
    exactString(witness.providerOriginSha256, proofFacts.providerOriginSha256, `${path}.providerOriginSha256`, context);
    exactString(witness.proofContextSlot, proofFacts.proofContextSlot, `${path}.proofContextSlot`, context);
    exactString(witness.stateFinalizedSlot, proofFacts.stateFinalizedSlot, `${path}.stateFinalizedSlot`, context);
    exactString(witness.logicalInstructionSha256, proofFacts.logicalInstructionSha256, `${path}.logicalInstructionSha256`, context);
    exactString(witness.outerInstructionSha256, proofFacts.outerInstructionSha256, `${path}.outerInstructionSha256`, context);
    exactString(witness.witnessDigest, proofFacts.witnessDigest, `${path}.witnessDigest`, context);
    const roots = arrayValue(witness.roots, `${path}.roots`, context);
    const rootIndices = arrayValue(witness.rootIndices, `${path}.rootIndices`, context);
    const leafIndices = arrayValue(witness.leafIndices, `${path}.leafIndices`, context);
    const treeInfos = arrayValue(witness.treeInfos, `${path}.treeInfos`, context);
    if (roots.length < 1 || roots.length > 16 || roots.length !== rootIndices.length || roots.length !== leafIndices.length || roots.length !== treeInfos.length) {
        fail(path, "compressed proof root/index/tree arrays must be nonempty and length-equal", witness, context);
    }
    roots.forEach((root, index) => stringPattern(root, /^[0-9a-f]{64}$/, `${path}.roots[${index}]`, context, "a 32-byte lowercase proof root"));
    rootIndices.forEach((rootIndex, index) => canonicalU64(rootIndex, `${path}.rootIndices[${index}]`, context));
    leafIndices.forEach((leafIndex, index) => canonicalU64(leafIndex, `${path}.leafIndices[${index}]`, context));
    treeInfos.forEach((tree, index) => validateOracleProofTreeFact(tree, `${path}.treeInfos[${index}]`, context));
    const coreAccountCount = safeIntegerValue(witness.coreAccountCount, `${path}.coreAccountCount`, context, 1, 255);
    const rentPayerIndex = safeIntegerValue(witness.rentPayerIndex, `${path}.rentPayerIndex`, context, 0, coreAccountCount - 1);
    if (coreAccountCount !== decodedOuter.coreAccountCount || rentPayerIndex !== decodedOuter.rentPayerIndex)
        fail(path, "witness core/rent indexes do not match tag-205 bytes", witness, context);
    const coreAccounts = arrayValue(witness.coreAccounts, `${path}.coreAccounts`, context);
    if (coreAccounts.length !== coreAccountCount || outer.accounts.length < coreAccountCount)
        fail(`${path}.coreAccounts`, "witness core prefix length does not match the outer instruction", coreAccounts, context);
    coreAccounts.forEach((value, index) => {
        const itemPath = `${path}.coreAccounts[${index}]`;
        const item = exactObject(value, ["address", "isSigner", "isWritable"], ["address", "isSigner", "isWritable"], itemPath, context);
        const outerMeta = outer.accounts[index];
        exactString(item.address, outerMeta.pubkey, `${itemPath}.address`, context);
        if (item.isSigner !== outerMeta.isSigner || item.isWritable !== outerMeta.isWritable)
            fail(itemPath, "witness core flags do not match outer metas", item, context);
    });
    const accesses = arrayValue(witness.accesses, `${path}.accesses`, context);
    if (accesses.length !== decodedOuter.accesses.length)
        fail(`${path}.accesses`, "witness access count does not match tag-205 bytes", accesses, context);
    accesses.forEach((access, index) => validateOracleAccessFact(access, decodedOuter.accesses[index], `${path}.accesses[${index}]`, context));
    const observations = arrayValue(witness.observationWitnessDigests, `${path}.observationWitnessDigests`, context);
    observations.forEach((digest, index) => sha256Digest(digest, `${path}.observationWitnessDigests[${index}]`, context));
    const existing = safeIntegerValue(witness.existingAccessCount, `${path}.existingAccessCount`, context, 0, accesses.length);
    const initialize = safeIntegerValue(witness.initializeAccessCount, `${path}.initializeAccessCount`, context, 0, accesses.length);
    if (existing + initialize !== accesses.length)
        fail(path, "existing and initialize access counts must cover the exact access list", witness, context);
    if (decodedOuter.proof === null)
        fail(path, "wrapped Oracle transport requires an exact validity proof", witness, context);
    return witness;
}
function validateOracleProofTreeFact(value, path, context) {
    const object = objectValue(value, path, context);
    const kind = enumString(object.kind, ["state_v2", "address_v2"], `${path}.kind`, context);
    exactObject(object, ["kind", "stateTree", "queue", "cpiContext"], ["kind", "stateTree", "queue", "cpiContext"], path, context);
    const tree = base58Address(object.stateTree, `${path}.stateTree`, context);
    const queue = base58Address(object.queue, `${path}.queue`, context);
    if (kind === "address_v2") {
        exactString(tree, CURRENT_LIGHT_ADDRESS_TREE, `${path}.stateTree`, context);
        exactString(queue, CURRENT_LIGHT_ADDRESS_TREE, `${path}.queue`, context);
        if (object.cpiContext !== null)
            fail(`${path}.cpiContext`, "address-v2 proof context must be null", object.cpiContext, context);
    }
    else {
        const cpi = base58Address(object.cpiContext, `${path}.cpiContext`, context);
        if (!CURRENT_LIGHT_STATE_CONTEXTS.some((entry) => entry.stateTree === tree && entry.queue === queue && entry.cpiContext === cpi)) {
            fail(path, "proof tree tuple is not an authorized StateV2 context", object, context);
        }
    }
}
function validateOracleAccessFact(value, decoded, path, context) {
    const object = objectValue(value, path, context);
    const kind = enumString(object.kind, ["readOnly", "mutable", "initialize"], `${path}.kind`, context);
    const keys = kind === "readOnly"
        ? ["domain", "accountIndex", "proofIndex", "canonicalPda", "compressedAddress", "kind", "treeInfo", "revision", "compactDataBase64"]
        : kind === "mutable"
            ? ["domain", "accountIndex", "proofIndex", "canonicalPda", "compressedAddress", "kind", "treeInfo", "outputStateTreeIndex", "revision", "compactDataBase64"]
            : ["domain", "accountIndex", "proofIndex", "canonicalPda", "compressedAddress", "kind", "addressTreeAccountIndex", "addressQueueAccountIndex", "addressRootIndex", "outputStateTreeIndex"];
    const access = exactObject(object, keys, keys, path, context);
    safeIntegerValue(access.domain, `${path}.domain`, context, 1, 10);
    safeIntegerValue(access.accountIndex, `${path}.accountIndex`, context, 0, 255);
    safeIntegerValue(access.proofIndex, `${path}.proofIndex`, context, 0, 15);
    base58Address(access.canonicalPda, `${path}.canonicalPda`, context);
    base58Address(access.compressedAddress, `${path}.compressedAddress`, context);
    for (const field of ["kind", "domain", "accountIndex"]) {
        if (access[field] !== decoded[field])
            fail(`${path}.${field}`, "witness access does not match tag-205 bytes", access[field], context);
    }
    if (kind === "readOnly" || kind === "mutable") {
        validatePackedTreeInfo(access.treeInfo, decoded.treeInfo, `${path}.treeInfo`, context);
        exactString(access.revision, decoded.revision, `${path}.revision`, context);
        canonicalBase64(access.compactDataBase64, `${path}.compactDataBase64`, context);
        exactString(access.compactDataBase64, decoded.compactDataBase64, `${path}.compactDataBase64`, context);
    }
    const numericFields = kind === "initialize"
        ? ["addressTreeAccountIndex", "addressQueueAccountIndex", "addressRootIndex", "outputStateTreeIndex"]
        : kind === "mutable"
            ? ["outputStateTreeIndex"]
            : [];
    numericFields.forEach((field) => {
        safeIntegerValue(access[field], `${path}.${field}`, context, 0, field === "addressRootIndex" ? 65_535 : 255);
        if (access[field] !== decoded[field])
            fail(`${path}.${field}`, "witness packed access field does not match tag-205 bytes", access[field], context);
    });
}
function validatePackedTreeInfo(value, decoded, path, context) {
    const tree = exactObject(value, ["rootIndex", "proveByIndex", "treeAccountIndex", "queueAccountIndex", "leafIndex"], ["rootIndex", "proveByIndex", "treeAccountIndex", "queueAccountIndex", "leafIndex"], path, context);
    safeIntegerValue(tree.rootIndex, `${path}.rootIndex`, context, 0, 65_535);
    booleanValue(tree.proveByIndex, `${path}.proveByIndex`, context);
    safeIntegerValue(tree.treeAccountIndex, `${path}.treeAccountIndex`, context, 0, 255);
    safeIntegerValue(tree.queueAccountIndex, `${path}.queueAccountIndex`, context, 0, 255);
    safeIntegerValue(tree.leafIndex, `${path}.leafIndex`, context, 0, 4_294_967_295);
    validateExactJsonProjection(tree, decoded, path, context);
}
function validateOracleLookupTableWitness(value, path, context) {
    const lookup = exactObject(value, [
        "address", "owner", "authority", "deactivationSlot", "lastExtendedSlot",
        "lastExtendedSlotStartIndex", "observedFinalizedSlot", "addresses", "addressesSha256",
        "accountDataSha256", "writableIndexes", "readonlyIndexes", "serializedByteLength",
    ], [
        "address", "owner", "authority", "deactivationSlot", "lastExtendedSlot",
        "lastExtendedSlotStartIndex", "observedFinalizedSlot", "addresses", "addressesSha256",
        "accountDataSha256", "writableIndexes", "readonlyIndexes", "serializedByteLength",
    ], path, context);
    base58Address(lookup.address, `${path}.address`, context);
    exactString(lookup.owner, CURRENT_LOOKUP_TABLE_PROGRAM_ID, `${path}.owner`, context);
    if (lookup.authority !== null)
        base58Address(lookup.authority, `${path}.authority`, context);
    exactString(lookup.deactivationSlot, "18446744073709551615", `${path}.deactivationSlot`, context);
    const lastExtendedSlot = canonicalU64(lookup.lastExtendedSlot, `${path}.lastExtendedSlot`, context);
    const observedSlot = canonicalU64(lookup.observedFinalizedSlot, `${path}.observedFinalizedSlot`, context);
    if (BigInt(observedSlot) <= BigInt(lastExtendedSlot))
        fail(`${path}.observedFinalizedSlot`, "lookup table must be active at a later finalized slot", lookup.observedFinalizedSlot, context);
    const addresses = arrayValue(lookup.addresses, `${path}.addresses`, context).map((address, index) => base58Address(address, `${path}.addresses[${index}]`, context));
    if (addresses.length < 1 || addresses.length > 256 || new Set(addresses).size !== addresses.length)
        fail(`${path}.addresses`, "lookup table must contain 1..256 unique addresses", lookup.addresses, context);
    const startIndex = safeIntegerValue(lookup.lastExtendedSlotStartIndex, `${path}.lastExtendedSlotStartIndex`, context, 0, addresses.length);
    if (startIndex > addresses.length)
        fail(`${path}.lastExtendedSlotStartIndex`, "lookup extension index exceeds address count", startIndex, context);
    sha256Digest(lookup.addressesSha256, `${path}.addressesSha256`, context);
    sha256Digest(lookup.accountDataSha256, `${path}.accountDataSha256`, context);
    const writable = validateOracleLookupIndexes(lookup.writableIndexes, addresses.length, `${path}.writableIndexes`, context);
    const readonly = validateOracleLookupIndexes(lookup.readonlyIndexes, addresses.length, `${path}.readonlyIndexes`, context);
    const all = [...writable, ...readonly];
    if (all.length < 1 || new Set(all).size !== all.length)
        fail(path, "lookup writable/readonly indexes must be nonempty and disjoint", lookup, context);
    safeIntegerValue(lookup.serializedByteLength, `${path}.serializedByteLength`, context, 1, 1_232);
    return lookup;
}
function validateOracleLookupIndexes(value, addressCount, path, context) {
    const indexes = arrayValue(value, path, context).map((index, offset) => safeIntegerValue(index, `${path}[${offset}]`, context, 0, addressCount - 1));
    if (new Set(indexes).size !== indexes.length)
        fail(path, "lookup indexes must be unique", indexes, context);
    return indexes;
}
function validateOracleTransportMetrics(value, outer, ownerPubkey, lookupValue, path, context) {
    const metrics = exactObject(value, [
        "outerInstructionDataBytes", "outerAccountMetaCount", "outerUniqueAccountKeys",
        "noLookupTableSerializedByteLength", "serializedByteLength", "theoreticalAltMinimizedByteLength",
        "packetDataSizeLimit",
    ], [
        "outerInstructionDataBytes", "outerAccountMetaCount", "outerUniqueAccountKeys",
        "noLookupTableSerializedByteLength", "serializedByteLength", "theoreticalAltMinimizedByteLength",
        "packetDataSizeLimit",
    ], path, context);
    if (metrics.outerInstructionDataBytes !== outer.data.length)
        fail(`${path}.outerInstructionDataBytes`, "must equal outer instruction data bytes", metrics.outerInstructionDataBytes, context);
    if (metrics.outerAccountMetaCount !== outer.accounts.length)
        fail(`${path}.outerAccountMetaCount`, "must equal outer instruction account count", metrics.outerAccountMetaCount, context);
    const uniqueKeys = new Set([ownerPubkey, outer.programId, ...outer.accounts.map((meta) => meta.pubkey)]).size;
    if (metrics.outerUniqueAccountKeys !== uniqueKeys)
        fail(`${path}.outerUniqueAccountKeys`, "must equal exact outer transaction key cardinality", metrics.outerUniqueAccountKeys, context);
    const noLookup = safeIntegerValue(metrics.noLookupTableSerializedByteLength, `${path}.noLookupTableSerializedByteLength`, context, 1, 65_535);
    const serialized = safeIntegerValue(metrics.serializedByteLength, `${path}.serializedByteLength`, context, 1, 1_232);
    const theoretical = safeIntegerValue(metrics.theoreticalAltMinimizedByteLength, `${path}.theoreticalAltMinimizedByteLength`, context, 1, 65_535);
    if (metrics.packetDataSizeLimit !== 1_232)
        fail(`${path}.packetDataSizeLimit`, "expected Solana packet limit 1232", metrics.packetDataSizeLimit, context);
    if (theoretical > noLookup)
        fail(`${path}.theoreticalAltMinimizedByteLength`, "theoretical ALT minimum cannot exceed the no-lookup transaction", theoretical, context);
    if (lookupValue === null) {
        if (serialized !== noLookup)
            fail(`${path}.serializedByteLength`, "direct transaction length must equal no-lookup length", serialized, context);
    }
    else {
        const lookup = objectValue(lookupValue, `${path}.transactionLookupTable`, context);
        if (lookup.serializedByteLength !== serialized)
            fail(`${path}.serializedByteLength`, "must match lookup witness serialized length", serialized, context);
    }
    return metrics;
}
function validateOracleLookupProofBinding(proof, lookupValue, metrics, path, context) {
    const metricFields = [
        "serializedByteLength", "noLookupTableSerializedByteLength", "theoreticalAltMinimizedByteLength",
    ];
    metricFields.forEach((field) => {
        if (proof[field] !== metrics[field])
            fail(`${path}.${field}`, `must equal transportMetrics.${field}`, proof[field], context);
    });
    if (lookupValue === null) {
        for (const field of [
            "lookupTableAddress", "lookupTableAddressesSha256", "lookupTableAccountDataSha256",
            "lookupTableObservedFinalizedSlot", "lookupTableWritableIndexes", "lookupTableReadonlyIndexes",
        ]) {
            if (proof[field] !== null)
                fail(`${path}.${field}`, "direct Oracle action has no lookup table", proof[field], context);
        }
        return;
    }
    const lookup = objectValue(lookupValue, `${path}.transactionLookupTable`, context);
    const expected = {
        lookupTableAddress: lookup.address,
        lookupTableAddressesSha256: lookup.addressesSha256,
        lookupTableAccountDataSha256: lookup.accountDataSha256,
        lookupTableObservedFinalizedSlot: lookup.observedFinalizedSlot,
        lookupTableWritableIndexes: arrayValue(lookup.writableIndexes, `${path}.transactionLookupTable.writableIndexes`, context).join(","),
        lookupTableReadonlyIndexes: arrayValue(lookup.readonlyIndexes, `${path}.transactionLookupTable.readonlyIndexes`, context).join(","),
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
        if (proof[field] !== expectedValue)
            fail(`${path}.${field}`, "must bind the exact lookup-table witness", proof[field], context);
    }
}
function validateOracleDraftTransaction(value, actionInstructions, expectedOwner, expectedRecentBlockhash, transportMetrics, lookupValue, path, context) {
    const transaction = exactObject(value, ["serializedTransactionBase64", "recentBlockhash", "backendPartialSignatures", "approvedInstructions"], ["serializedTransactionBase64", "recentBlockhash", "backendPartialSignatures", "approvedInstructions"], path, context);
    const serialized = canonicalBase64(transaction.serializedTransactionBase64, `${path}.serializedTransactionBase64`, context);
    if (serialized.length > 1_232)
        fail(`${path}.serializedTransactionBase64`, "serialized Oracle transaction exceeds the Solana packet bound", transaction.serializedTransactionBase64, context);
    if (serialized.length !== transportMetrics.serializedByteLength)
        fail(`${path}.serializedTransactionBase64`, "serialized bytes must match transport metrics", transaction.serializedTransactionBase64, context);
    if (lookupValue !== null && objectValue(lookupValue, `${path}.transactionLookupTable`, context).serializedByteLength !== serialized.length) {
        fail(`${path}.serializedTransactionBase64`, "serialized bytes must match lookup-table witness", transaction.serializedTransactionBase64, context);
    }
    exactString(transaction.recentBlockhash, expectedRecentBlockhash, `${path}.recentBlockhash`, context);
    base58Address(transaction.recentBlockhash, `${path}.recentBlockhash`, context);
    const signatures = arrayValue(transaction.backendPartialSignatures, `${path}.backendPartialSignatures`, context);
    if (signatures.length !== 0)
        fail(`${path}.backendPartialSignatures`, "current public Oracle actions have no backend signer", signatures, context);
    const approved = arrayValue(transaction.approvedInstructions, `${path}.approvedInstructions`, context);
    if (approved.length !== actionInstructions.length)
        fail(`${path}.approvedInstructions`, "Oracle draft requires exactly one approved transport instruction", approved, context);
    actionInstructions.forEach((outer, instructionIndex) => {
        const instructionPath = `${path}.approvedInstructions[${instructionIndex}]`;
        const instruction = exactObject(approved[instructionIndex], ["programId", "accounts", "dataBase64"], ["programId", "accounts", "dataBase64"], instructionPath, context);
        exactString(instruction.programId, outer.programId, `${instructionPath}.programId`, context);
        exactString(instruction.dataBase64, outer.dataBase64, `${instructionPath}.dataBase64`, context);
        const accounts = arrayValue(instruction.accounts, `${instructionPath}.accounts`, context);
        if (accounts.length !== outer.accounts.length)
            fail(`${instructionPath}.accounts`, "approved account count must match the outer manifest", accounts, context);
        accounts.forEach((value, index) => {
            const metaPath = `${instructionPath}.accounts[${index}]`;
            const meta = exactObject(value, ["address", "isSigner", "isWritable"], ["address", "isSigner", "isWritable"], metaPath, context);
            const expected = outer.accounts[index];
            exactString(meta.address, expected.pubkey, `${metaPath}.address`, context);
            if (meta.isSigner !== expected.isSigner || meta.isWritable !== expected.isWritable)
                fail(metaPath, "approved meta flags must match the outer manifest", meta, context);
        });
    });
    const parsed = validateSerializedApprovedTransaction(serialized, transaction.recentBlockhash, expectedOwner, approved, 0, lookupValue ?? undefined, true, `${path}.serializedTransactionBase64`, context);
    if (parsed.signatures.length !== 1 || parsed.signatures[0].some((byte) => byte !== 0)) {
        fail(`${path}.serializedTransactionBase64`, "Oracle prepare must contain exactly one zeroed payer signature slot", transaction.serializedTransactionBase64, context);
    }
    return parsed;
}
function validateOracleCompressedDigestBindings(witness, decodedOuter, logical, outer, path, context) {
    if (decodedOuter.proof === null)
        fail(`${path}.proofSha256`, "tag 205 is missing its validity proof", null, context);
    exactString(witness.proofSha256, sha256Hex(decodedOuter.proof), `${path}.proofSha256`, context);
    exactString(witness.logicalInstructionSha256, oracleInstructionSha256(logical), `${path}.logicalInstructionSha256`, context);
    exactString(witness.outerInstructionSha256, oracleInstructionSha256(outer), `${path}.outerInstructionSha256`, context);
    const orderedFacts = {
        providerOriginSha256: witness.providerOriginSha256,
        marketSeriesId: witness.marketSeriesId,
        addressTree: witness.addressTree,
        addressQueue: witness.addressQueue,
        outputStateTree: witness.outputStateTree,
        outputQueue: witness.outputQueue,
        proofContextSlot: witness.proofContextSlot,
        stateFinalizedSlot: witness.stateFinalizedSlot,
        roots: witness.roots,
        rootIndices: witness.rootIndices,
        leafIndices: witness.leafIndices,
        treeInfos: witness.treeInfos,
        proofSha256: witness.proofSha256,
        logicalInstructionSha256: witness.logicalInstructionSha256,
        outerInstructionSha256: witness.outerInstructionSha256,
        coreAccountCount: witness.coreAccountCount,
        rentPayerIndex: witness.rentPayerIndex,
        coreAccounts: witness.coreAccounts,
        accesses: witness.accesses,
        observationWitnessDigests: witness.observationWitnessDigests,
        existingAccessCount: witness.existingAccessCount,
        initializeAccessCount: witness.initializeAccessCount,
    };
    exactString(witness.witnessDigest, sha256Hex("ameba-spread-v2/current-compressed-instruction-witness-v1\0", JSON.stringify(orderedFacts)), `${path}.witnessDigest`, context);
}
function validateOracleCompressedAccessBindings(witness, decodedOuter, outer, path, context) {
    const roots = arrayValue(witness.roots, `${path}.roots`, context);
    const rootIndices = arrayValue(witness.rootIndices, `${path}.rootIndices`, context);
    const leafIndices = arrayValue(witness.leafIndices, `${path}.leafIndices`, context);
    const treeInfos = arrayValue(witness.treeInfos, `${path}.treeInfos`, context);
    const accesses = arrayValue(witness.accesses, `${path}.accesses`, context);
    if (roots.length !== accesses.length)
        fail(path, "proof arrays must map one-to-one to ordered compressed accesses", witness, context);
    const proofIndexes = accesses.map((value, index) => safeIntegerValue(objectValue(value, `${path}.accesses[${index}]`, context).proofIndex, `${path}.accesses[${index}].proofIndex`, context, 0, accesses.length - 1));
    if (new Set(proofIndexes).size !== proofIndexes.length || proofIndexes.some((value, index) => value !== index)) {
        fail(`${path}.accesses`, "proofIndex must preserve exact existing-then-initialize proof order", accesses, context);
    }
    const coreCount = witness.coreAccountCount;
    const fixedSuffix = [
        SYSTEM_PROGRAM_ID,
        CURRENT_LIGHT_SYSTEM_PROGRAM_ID,
        CURRENT_LIGHT_REGISTERED_PROGRAM_PDA,
        CURRENT_LIGHT_NOOP_PROGRAM_ID,
        CURRENT_LIGHT_ACCOUNT_COMPRESSION_AUTHORITY,
        CURRENT_LIGHT_COMPRESSION_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
    ];
    fixedSuffix.forEach((address, offset) => {
        const meta = outer.accounts[coreCount + offset];
        if (meta === undefined || meta.pubkey !== address || meta.isSigner || meta.isWritable)
            fail(`${path}.coreAccounts`, "tag-205 fixed Light suffix differs from the authorized topology", outer.object.accounts, context);
    });
    const packedStart = coreCount + fixedSuffix.length;
    const usedPackedIndexes = new Set();
    const accessAccountIndexes = new Set(accesses.map((value, index) => objectValue(value, `${path}.accesses[${index}]`, context).accountIndex));
    const logicalAccounts = outer.accounts.slice(0, coreCount);
    logicalAccounts.forEach((account, index) => {
        const witnessCore = objectValue(arrayValue(witness.coreAccounts, `${path}.coreAccounts`, context)[index], `${path}.coreAccounts[${index}]`, context);
        const expectedWritable = account.isWritable || index === decodedOuter.rentPayerIndex || accessAccountIndexes.has(index);
        if (witnessCore.address !== account.pubkey || witnessCore.isSigner !== account.isSigner || witnessCore.isWritable !== expectedWritable)
            fail(`${path}.coreAccounts[${index}]`, "tag-205 core role/flag binding is inconsistent", witnessCore, context);
    });
    accesses.forEach((value, index) => {
        const access = objectValue(value, `${path}.accesses[${index}]`, context);
        const proofIndex = proofIndexes[index];
        const tree = objectValue(treeInfos[proofIndex], `${path}.treeInfos[${proofIndex}]`, context);
        const rootIndex = Number(canonicalU64(rootIndices[proofIndex], `${path}.rootIndices[${proofIndex}]`, context));
        const leafIndex = Number(canonicalU64(leafIndices[proofIndex], `${path}.leafIndices[${proofIndex}]`, context));
        if (access.kind === "initialize") {
            exactString(tree.kind, "address_v2", `${path}.treeInfos[${proofIndex}].kind`, context);
            if (access.addressRootIndex !== rootIndex)
                fail(`${path}.accesses[${index}].addressRootIndex`, "must bind rootIndices[proofIndex]", access.addressRootIndex, context);
            bindOraclePackedAccount(outer, access.addressTreeAccountIndex, tree.stateTree, true, packedStart, usedPackedIndexes, `${path}.accesses[${index}].addressTreeAccountIndex`, context);
            bindOraclePackedAccount(outer, access.addressQueueAccountIndex, tree.queue, true, packedStart, usedPackedIndexes, `${path}.accesses[${index}].addressQueueAccountIndex`, context);
            bindOraclePackedAccount(outer, access.outputStateTreeIndex, witness.outputQueue, true, packedStart, usedPackedIndexes, `${path}.accesses[${index}].outputStateTreeIndex`, context);
        }
        else {
            exactString(tree.kind, "state_v2", `${path}.treeInfos[${proofIndex}].kind`, context);
            const packedTree = objectValue(access.treeInfo, `${path}.accesses[${index}].treeInfo`, context);
            if (packedTree.rootIndex !== rootIndex || packedTree.leafIndex !== leafIndex)
                fail(`${path}.accesses[${index}].treeInfo`, "packed root/leaf indexes must bind the proof arrays", packedTree, context);
            const writable = access.kind === "mutable";
            bindOraclePackedAccount(outer, packedTree.treeAccountIndex, tree.stateTree, writable, packedStart, usedPackedIndexes, `${path}.accesses[${index}].treeInfo.treeAccountIndex`, context);
            bindOraclePackedAccount(outer, packedTree.queueAccountIndex, tree.queue, writable, packedStart, usedPackedIndexes, `${path}.accesses[${index}].treeInfo.queueAccountIndex`, context);
            if (writable)
                bindOraclePackedAccount(outer, access.outputStateTreeIndex, tree.queue, true, packedStart, usedPackedIndexes, `${path}.accesses[${index}].outputStateTreeIndex`, context);
        }
    });
    for (let index = packedStart; index < outer.accounts.length; index += 1) {
        if (!usedPackedIndexes.has(index))
            fail(`${path}.accesses`, "outer suffix contains an unbound packed Light account", outer.accounts[index].pubkey, context);
    }
    if (BigInt(witness.stateFinalizedSlot) < BigInt(witness.proofContextSlot))
        fail(`${path}.stateFinalizedSlot`, "must not precede the proof context slot", witness.stateFinalizedSlot, context);
    roots.forEach((root, index) => {
        if (root === "0".repeat(64))
            fail(`${path}.roots[${index}]`, "proof root must be nonzero", root, context);
    });
}
function bindOraclePackedAccount(outer, index, address, writable, packedStart, used, path, context) {
    if (!Number.isSafeInteger(index) || index < packedStart || index >= outer.accounts.length)
        fail(path, "packed account index is outside the exact suffix", index, context);
    const meta = outer.accounts[index];
    if (meta.pubkey !== address || meta.isSigner || (writable && !meta.isWritable))
        fail(path, "packed account identity/flags do not match the proof tree", meta, context);
    used.add(index);
}
function validateOracleLookupDigestBindings(lookup, path, context) {
    const addresses = arrayValue(lookup.addresses, `${path}.addresses`, context).map((value) => value);
    const count = new Uint8Array(4);
    writeU32Le(count, 0, addresses.length);
    exactString(lookup.addressesSha256, sha256Hex("ameba-spread-v2/current-oracle-lookup-table-addresses-v1\0", count, ...addresses.map(decodeBase58)), `${path}.addressesSha256`, context);
    const accountData = new Uint8Array(56 + addresses.length * 32);
    writeU32Le(accountData, 0, 1);
    writeU64Le(accountData, 4, BigInt(lookup.deactivationSlot));
    writeU64Le(accountData, 12, BigInt(lookup.lastExtendedSlot));
    accountData[20] = lookup.lastExtendedSlotStartIndex;
    accountData[21] = lookup.authority === null ? 0 : 1;
    if (lookup.authority !== null)
        accountData.set(decodeBase58(lookup.authority), 22);
    addresses.forEach((address, index) => accountData.set(decodeBase58(address), 56 + index * 32));
    exactString(lookup.accountDataSha256, sha256Hex(accountData), `${path}.accountDataSha256`, context);
}
function validateOracleParsedTransportMetrics(parsed, metrics, lookup, path, context) {
    if (parsed.serializedByteLength !== metrics.serializedByteLength)
        fail(`${path}.serializedByteLength`, "must equal the parsed transaction bytes", metrics.serializedByteLength, context);
    if (lookup === null) {
        if (parsed.lookup !== null || parsed.loadedWritableCount !== 0 || parsed.loadedReadonlyCount !== 0)
            fail(path, "direct Oracle action must not load ALT accounts", metrics, context);
    }
    else {
        if (parsed.lookup === null)
            fail(path, "wrapped Oracle action must use its exact authorized ALT", metrics, context);
        exactString(parsed.lookup.address, lookup.address, `${path}.lookupTableAddress`, context);
        validateExactJsonProjection(parsed.lookup.writableIndexes, lookup.writableIndexes, `${path}.lookupWritableIndexes`, context);
        validateExactJsonProjection(parsed.lookup.readonlyIndexes, lookup.readonlyIndexes, `${path}.lookupReadonlyIndexes`, context);
    }
    const instructionBytes = parsed.instructions.reduce((sum, instruction) => sum + 1 + shortVectorLength(instruction.accountAddresses.length) + instruction.accountAddresses.length + shortVectorLength(instruction.data.length) + instruction.data.length, 0);
    const uniqueKeys = parsed.accountFlags.size;
    const signatureCount = parsed.signatures.length;
    const noLookup = shortVectorLength(signatureCount) + signatureCount * 64 + 1 + 3
        + shortVectorLength(uniqueKeys) + uniqueKeys * 32 + 32 + shortVectorLength(parsed.instructions.length)
        + instructionBytes + 1;
    if (metrics.noLookupTableSerializedByteLength !== noLookup)
        fail(`${path}.noLookupTableSerializedByteLength`, "does not match exact no-lookup v0 compilation", metrics.noLookupTableSerializedByteLength, context);
    const signerKeys = [...parsed.accountFlags.values()].filter((flags) => flags.isSigner).length;
    const nonSigner = [...parsed.accountFlags.entries()].filter(([, flags]) => !flags.isSigner);
    const theoreticalWritable = nonSigner.filter(([, flags]) => flags.isWritable).length;
    const theoreticalReadonly = nonSigner.length - theoreticalWritable;
    const theoretical = shortVectorLength(signatureCount) + signatureCount * 64 + 1 + 3
        + shortVectorLength(signerKeys) + signerKeys * 32 + 32 + shortVectorLength(parsed.instructions.length)
        + instructionBytes
        + 1 + 32 + shortVectorLength(theoreticalWritable) + theoreticalWritable
        + shortVectorLength(theoreticalReadonly) + theoreticalReadonly;
    if (metrics.theoreticalAltMinimizedByteLength !== theoretical)
        fail(`${path}.theoreticalAltMinimizedByteLength`, "does not match exact all-eligible-account ALT compilation", metrics.theoreticalAltMinimizedByteLength, context);
}
function validateApprovedInstruction(value, path, context, requireCurrentProgram) {
    const instruction = exactObject(value, ["programId", "accounts", "dataBase64"], ["programId", "accounts", "dataBase64"], path, context);
    const programId = base58Address(instruction.programId, `${path}.programId`, context);
    if (requireCurrentProgram && programId !== CURRENT_PROGRAM_ID) {
        fail(`${path}.programId`, "must be the current Spread program", programId, context);
    }
    const accounts = arrayValue(instruction.accounts, `${path}.accounts`, context).map((meta, index) => {
        const metaPath = `${path}.accounts[${index}]`;
        const item = exactObject(meta, ["address", "isSigner", "isWritable"], ["address", "isSigner", "isWritable"], metaPath, context);
        return Object.freeze({
            address: base58Address(item.address, `${metaPath}.address`, context),
            isSigner: booleanValue(item.isSigner, `${metaPath}.isSigner`, context),
            isWritable: booleanValue(item.isWritable, `${metaPath}.isWritable`, context),
        });
    });
    const bytes = canonicalBase64(instruction.dataBase64, `${path}.dataBase64`, context);
    if (bytes.length === 0 || bytes.length > 16_384) {
        fail(`${path}.dataBase64`, "instruction data must contain 1..16384 bytes", instruction.dataBase64, context);
    }
    return Object.freeze({
        programId,
        dataBase64: instruction.dataBase64,
        data: bytes,
        tag: bytes[0],
        accounts: Object.freeze(accounts),
    });
}
function validateSerializedApprovedTransaction(serialized, expectedRecentBlockhash, expectedPayer, approvedValues, expectedVersion, lookupWitness, requireCurrentProgram, path, context) {
    const parsed = parseSolanaTransaction(serialized, lookupWitness, path, context);
    if (parsed.version !== expectedVersion) {
        fail(path, expectedVersion === null ? "expected a legacy unsigned Solana transaction" : "expected a v0 unsigned Solana transaction", parsed.version, context);
    }
    exactString(parsed.payer, expectedPayer, path, context);
    exactString(parsed.recentBlockhash, expectedRecentBlockhash, path, context);
    if (parsed.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
        fail(path, "prepared transaction must not contain an undisclosed signature", bytesToBase64(serialized), context);
    }
    const approved = approvedValues.map((value, index) => validateApprovedInstruction(value, `${path}.approvedInstructions[${index}]`, context, requireCurrentProgram));
    if (parsed.instructions.length !== approved.length) {
        fail(path, "serialized instruction count must match approvedInstructions", parsed.instructions.length, context);
    }
    approved.forEach((expected, index) => {
        const actual = parsed.instructions[index];
        if (actual.programId !== expected.programId)
            fail(path, `serialized instruction ${index} program differs from its approved manifest`, actual.programId, context);
        if (!bytesEqual(actual.data, expected.data))
            fail(path, `serialized instruction ${index} bytes differ from its approved manifest`, bytesToBase64(actual.data), context);
        if (actual.accountAddresses.length !== expected.accounts.length
            || actual.accountAddresses.some((address, accountIndex) => address !== expected.accounts[accountIndex]?.address)) {
            fail(path, `serialized instruction ${index} account order differs from its approved manifest`, actual.accountAddresses, context);
        }
    });
    const expectedFlags = new Map();
    const addExpected = (address, isSigner, isWritable) => {
        const prior = expectedFlags.get(address);
        expectedFlags.set(address, {
            isSigner: isSigner || prior?.isSigner === true,
            isWritable: isWritable || prior?.isWritable === true,
        });
    };
    addExpected(expectedPayer, true, true);
    approved.forEach((instruction) => {
        addExpected(instruction.programId, false, false);
        instruction.accounts.forEach((account) => addExpected(account.address, account.isSigner, account.isWritable));
    });
    if (parsed.accountFlags.size !== expectedFlags.size) {
        fail(path, "serialized account-key set contains missing or extra identities", [...parsed.accountFlags.keys()], context);
    }
    for (const [address, expected] of expectedFlags) {
        const actual = parsed.accountFlags.get(address);
        if (actual === undefined || actual.isSigner !== expected.isSigner || actual.isWritable !== expected.isWritable) {
            fail(path, `serialized signer/writable policy differs for ${address}`, actual, context);
        }
    }
    return parsed;
}
function parseSolanaTransaction(bytes, lookupWitness, path, context) {
    let offset = 0;
    const requireBytes = (length, label) => {
        if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
            fail(path, `serialized transaction is truncated while reading ${label}`, bytesToBase64(bytes), context);
        }
    };
    const u8 = (label) => {
        requireBytes(1, label);
        return bytes[offset++];
    };
    const slice = (length, label) => {
        requireBytes(length, label);
        const result = bytes.slice(offset, offset + length);
        offset += length;
        return result;
    };
    const shortVector = (label) => {
        let value = 0;
        let multiplier = 1;
        let count = 0;
        let finalPayload = 0;
        while (true) {
            const byte = u8(label);
            finalPayload = byte & 0x7f;
            value += finalPayload * multiplier;
            count += 1;
            if (count > 3 || value > 65_535)
                fail(path, `${label} short-vector is outside the current bound`, value, context);
            if ((byte & 0x80) === 0)
                break;
            multiplier *= 128;
        }
        if (count > 1 && finalPayload === 0)
            fail(path, `${label} short-vector is not minimally encoded`, value, context);
        return value;
    };
    const signatureCount = shortVector("signature count");
    if (signatureCount < 1 || signatureCount > 32)
        fail(path, "serialized transaction signature count is outside 1..32", signatureCount, context);
    const signatures = Object.freeze(Array.from({ length: signatureCount }, (_, index) => slice(64, `signature ${index}`)));
    const firstMessageByte = u8("message version/header");
    const version = (firstMessageByte & 0x80) === 0
        ? null
        : (firstMessageByte & 0x7f) === 0
            ? 0
            : fail(path, "only legacy and v0 Solana transactions are current", firstMessageByte & 0x7f, context);
    const numRequiredSignatures = version === null ? firstMessageByte : u8("required signature count");
    const numReadonlySigned = u8("readonly signed count");
    const numReadonlyUnsigned = u8("readonly unsigned count");
    const staticCount = shortVector("static account count");
    if (staticCount < 1
        || staticCount > 256
        || numRequiredSignatures !== signatureCount
        || numRequiredSignatures > staticCount
        || numReadonlySigned > numRequiredSignatures
        || numReadonlyUnsigned > staticCount - numRequiredSignatures) {
        fail(path, "serialized transaction header/account counts are inconsistent", { staticCount, numRequiredSignatures }, context);
    }
    const staticKeys = Object.freeze(Array.from({ length: staticCount }, (_, index) => encodeBase58(slice(32, `static account ${index}`))));
    const recentBlockhash = encodeBase58(slice(32, "recent blockhash"));
    const instructionCount = shortVector("compiled instruction count");
    if (instructionCount < 1 || instructionCount > 64)
        fail(path, "serialized instruction count is outside 1..64", instructionCount, context);
    const compiled = [];
    let compiledInstructionBytes = shortVectorLength(instructionCount);
    for (let index = 0; index < instructionCount; index += 1) {
        const before = offset;
        const programIndex = u8(`instruction ${index} program index`);
        const accountCount = shortVector(`instruction ${index} account count`);
        const accountIndexes = Object.freeze(Array.from({ length: accountCount }, () => u8(`instruction ${index} account index`)));
        const dataLength = shortVector(`instruction ${index} data length`);
        const data = slice(dataLength, `instruction ${index} data`);
        compiledInstructionBytes += offset - before;
        compiled.push({ programIndex, accountIndexes, data });
    }
    let lookup = null;
    let loadedWritable = [];
    let loadedReadonly = [];
    if (version === 0) {
        const lookupCount = shortVector("address lookup count");
        if (lookupCount > 1)
            fail(path, "current Oracle transport admits at most one address lookup table", lookupCount, context);
        if (lookupCount === 1) {
            if (lookupWitness === undefined)
                fail(path, "serialized v0 transaction unexpectedly uses an address lookup table", lookupCount, context);
            const address = encodeBase58(slice(32, "lookup table address"));
            const writableCount = shortVector("lookup writable count");
            const writableIndexes = Object.freeze(Array.from({ length: writableCount }, () => u8("lookup writable index")));
            const readonlyCount = shortVector("lookup readonly count");
            const readonlyIndexes = Object.freeze(Array.from({ length: readonlyCount }, () => u8("lookup readonly index")));
            const witnessAddresses = arrayValue(lookupWitness.addresses, `${path}.transactionLookupTable.addresses`, context).map((entry, index) => base58Address(entry, `${path}.transactionLookupTable.addresses[${index}]`, context));
            exactString(address, lookupWitness.address, path, context);
            const expectedWritable = arrayValue(lookupWitness.writableIndexes, `${path}.transactionLookupTable.writableIndexes`, context);
            const expectedReadonly = arrayValue(lookupWitness.readonlyIndexes, `${path}.transactionLookupTable.readonlyIndexes`, context);
            if (JSON.stringify(writableIndexes) !== JSON.stringify(expectedWritable) || JSON.stringify(readonlyIndexes) !== JSON.stringify(expectedReadonly)) {
                fail(path, "serialized ALT writable/readonly indexes differ from the attested lookup witness", { writableIndexes, readonlyIndexes }, context);
            }
            loadedWritable = writableIndexes.map((index) => witnessAddresses[index] ?? fail(path, "serialized writable ALT index is out of range", index, context));
            loadedReadonly = readonlyIndexes.map((index) => witnessAddresses[index] ?? fail(path, "serialized readonly ALT index is out of range", index, context));
            lookup = Object.freeze({ address, writableIndexes, readonlyIndexes });
        }
        else if (lookupWitness !== undefined) {
            fail(path, "wrapped Oracle transaction omitted its attested address lookup table", lookupCount, context);
        }
    }
    else if (lookupWitness !== undefined) {
        fail(path, "legacy transaction cannot carry an Oracle lookup witness", lookupWitness, context);
    }
    if (offset !== bytes.length)
        fail(path, "serialized transaction has trailing bytes", bytesToBase64(bytes.slice(offset)), context);
    const allKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
    if (new Set(allKeys).size !== allKeys.length)
        fail(path, "serialized transaction account keys are not unique", allKeys, context);
    const accountFlags = new Map();
    staticKeys.forEach((address, index) => {
        const isSigner = index < numRequiredSignatures;
        const isWritable = isSigner
            ? index < numRequiredSignatures - numReadonlySigned
            : index < staticCount - numReadonlyUnsigned;
        accountFlags.set(address, Object.freeze({ isSigner, isWritable }));
    });
    loadedWritable.forEach((address) => accountFlags.set(address, Object.freeze({ isSigner: false, isWritable: true })));
    loadedReadonly.forEach((address) => accountFlags.set(address, Object.freeze({ isSigner: false, isWritable: false })));
    const instructions = Object.freeze(compiled.map((instruction, index) => {
        const programId = allKeys[instruction.programIndex];
        if (programId === undefined)
            fail(path, `serialized instruction ${index} program index is out of range`, instruction.programIndex, context);
        const accountAddresses = Object.freeze(instruction.accountIndexes.map((accountIndex) => allKeys[accountIndex] ?? fail(path, `serialized instruction ${index} account index is out of range`, accountIndex, context)));
        return Object.freeze({ programId, accountAddresses, data: instruction.data });
    }));
    return Object.freeze({
        serializedByteLength: bytes.length,
        version,
        payer: staticKeys[0],
        recentBlockhash,
        signatures,
        accountFlags,
        instructions,
        lookup,
        staticAccountCount: staticCount,
        loadedWritableCount: loadedWritable.length,
        loadedReadonlyCount: loadedReadonly.length,
        compiledInstructionBytes,
    });
}
function validateSetupTransactionBytes(bytes, kind, expectedPayer, expectedRecentBlockhash, path, context) {
    const parsed = parseSolanaTransaction(bytes, undefined, path, context);
    if (parsed.version !== null)
        fail(path, "setup transactions must use the canonical legacy wire format", parsed.version, context);
    exactString(parsed.payer, expectedPayer, path, context);
    exactString(parsed.recentBlockhash, expectedRecentBlockhash, path, context);
    if (parsed.signatures.some((signature) => signature.some((byte) => byte !== 0)))
        fail(path, "setup transaction must be unsigned", bytesToBase64(bytes), context);
    if (kind === "protocol_state_load") {
        if (parsed.instructions.length !== 1)
            fail(path, "protocol_state_load must contain exactly one tag-219 instruction", parsed.instructions.length, context);
        const instruction = parsed.instructions[0];
        exactString(instruction.programId, CURRENT_PROGRAM_ID, path, context);
        if (instruction.data.length < 153 || instruction.data.length > 16_384 || instruction.data[0] !== 219)
            fail(path, "protocol_state_load must contain the bounded rc.44 tag-219 payload", bytesToBase64(instruction.data), context);
        if (instruction.data[1] !== 3 || instruction.data[2] !== 1 || instruction.data[3] !== 0 || instruction.data[4] !== 1 || readU32Le(instruction.data, 133) !== 1) {
            fail(path, "tag-219 Light packed-account/proof header is not canonical", bytesToBase64(instruction.data), context);
        }
        if (instruction.accountAddresses.length !== 13 || instruction.accountAddresses[0] !== expectedPayer)
            fail(path, "tag-219 must contain the exact 13-account payer-bound grammar", instruction.accountAddresses, context);
        const fixed = [
            "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7",
            CURRENT_SPREAD_LIGHT_CPI_AUTHORITY.toBase58(),
            "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh",
            "HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA",
            CURRENT_LIGHT_COMPRESSION_PROGRAM_ID,
            SYSTEM_PROGRAM_ID,
        ];
        fixed.forEach((address, index) => exactString(instruction.accountAddresses[index + 3], address, path, context));
        const tree = instruction.accountAddresses[10];
        const queue = instruction.accountAddresses[9];
        const cpi = instruction.accountAddresses[11];
        if (!CURRENT_LIGHT_STATE_CONTEXTS.some((entry) => entry.stateTree === tree && entry.queue === queue && entry.cpiContext === cpi))
            fail(path, "tag-219 tree/queue/CPI tuple is not authorized", { tree, queue, cpi }, context);
        const expectedFlags = [
            [true, true], [false, false], [false, true],
            [false, false], [false, false], [false, false], [false, false], [false, false], [false, false],
            [false, true], [false, true], [false, false], [false, true],
        ];
        instruction.accountAddresses.forEach((address, index) => {
            const actual = parsed.accountFlags.get(address);
            const expected = expectedFlags[index];
            if (actual?.isSigner !== expected[0] || actual.isWritable !== expected[1])
                fail(path, `tag-219 account ${index} flags are not canonical`, actual, context);
        });
        return;
    }
    if (kind === "light_ata_load") {
        if (parsed.instructions.length < 2 || parsed.instructions.length > 8)
            fail(path, "light_ata_load requires compute budget followed by 1..7 Light Token instructions", parsed.instructions.length, context);
        const compute = parsed.instructions[0];
        exactString(compute.programId, "ComputeBudget111111111111111111111111111111", path, context);
        if (compute.data.length !== 5 || compute.data[0] !== 2)
            fail(path, "light_ata_load compute-unit limit is not canonical", bytesToBase64(compute.data), context);
        const units = readU32Le(compute.data, 1);
        if (units < 50_000 || units > 1_400_000)
            fail(path, "light_ata_load compute-unit limit is outside the current bound", units, context);
        parsed.instructions.slice(1).forEach((instruction, index) => {
            exactString(instruction.programId, CURRENT_LIGHT_TOKEN_PROGRAM_ID, path, context);
            if (instruction.data.length < 1 || instruction.data.length > 16_384 || !instruction.accountAddresses.includes(expectedPayer))
                fail(path, `Light ATA load instruction ${index} is not payer-bound`, bytesToBase64(instruction.data), context);
        });
        const payerFlags = parsed.accountFlags.get(expectedPayer);
        if (payerFlags?.isSigner !== true || payerFlags.isWritable !== true)
            fail(path, "Light ATA load payer must be the writable signer", payerFlags, context);
        return;
    }
}
function shortVectorLength(value) {
    let remaining = value;
    let length = 0;
    do {
        length += 1;
        remaining = Math.floor(remaining / 128);
    } while (remaining > 0);
    return length;
}
function bytesEqual(left, right) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
const SHA256_K = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function sha256Bytes(...parts) {
    const encoder = new TextEncoder();
    const encoded = parts.map((part) => typeof part === "string" ? encoder.encode(part) : part);
    const byteLength = encoded.reduce((sum, part) => sum + part.length, 0);
    const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
    const input = new Uint8Array(paddedLength);
    let inputOffset = 0;
    encoded.forEach((part) => { input.set(part, inputOffset); inputOffset += part.length; });
    input[byteLength] = 0x80;
    const bitLength = BigInt(byteLength) * 8n;
    for (let index = 0; index < 8; index += 1)
        input[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const words = new Uint32Array(64);
    const rotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
    for (let block = 0; block < input.length; block += 64) {
        for (let index = 0; index < 16; index += 1) {
            const offset = block + index * 4;
            words[index] = ((input[offset] << 24) | (input[offset + 1] << 16) | (input[offset + 2] << 8) | input[offset + 3]) >>> 0;
        }
        for (let index = 16; index < 64; index += 1) {
            const s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
            const s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }
        let a = hash[0];
        let b = hash[1];
        let c = hash[2];
        let d = hash[3];
        let e = hash[4];
        let f = hash[5];
        let g = hash[6];
        let h = hash[7];
        for (let index = 0; index < 64; index += 1) {
            const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temporary1 = (h + sigma1 + choice + SHA256_K[index] + words[index]) >>> 0;
            const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sigma0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    const output = new Uint8Array(32);
    hash.forEach((word, index) => {
        output[index * 4] = word >>> 24;
        output[index * 4 + 1] = word >>> 16;
        output[index * 4 + 2] = word >>> 8;
        output[index * 4 + 3] = word;
    });
    return output;
}
function bytesHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sha256Hex(...parts) {
    return bytesHex(sha256Bytes(...parts));
}
function compareCanonicalText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function canonicalJsonValue(value) {
    if (Array.isArray(value))
        return value.map(canonicalJsonValue);
    if (isObject(value)) {
        return Object.fromEntries(Object.keys(value).sort(compareCanonicalText).map((key) => [key, canonicalJsonValue(value[key])]));
    }
    return value;
}
function oracleInstructionSha256(manifest) {
    const parts = [decodeBase58(manifest.programId), manifest.data];
    manifest.accounts.forEach((account) => {
        parts.push(decodeBase58(account.pubkey), Uint8Array.of(Number(account.isSigner), Number(account.isWritable)));
    });
    return sha256Hex(...parts);
}
function oracleOperationId(instructions, proofFacts) {
    const parts = ["oracle_draft", Uint8Array.of(instructions.length)];
    for (const instruction of instructions) {
        const decoded = objectValue(instruction.object.decodedParams, "$.decodedParams", { method: "POST", url: "/dlmm/oracle/drafts/prepare" });
        parts.push(instruction.programId, instruction.data);
        instruction.accounts.forEach(account => parts.push(decodeBase58(account.pubkey), Uint8Array.of(Number(account.isSigner), Number(account.isWritable))));
        parts.push(JSON.stringify(Object.fromEntries(Object.entries(decoded).sort(([left], [right]) => compareCanonicalText(left, right)))));
    }
    parts.push(Uint8Array.of(0));
    parts.push(JSON.stringify(Object.fromEntries(Object.entries(proofFacts).sort(([left], [right]) => compareCanonicalText(left, right)))));
    return sha256Hex(...parts);
}
function preparedPlanSha256(operation, planWithoutDigest) {
    return sha256Hex("ameba-spread-v2/current-prepared-plan-v1\0", operation, "\0", JSON.stringify(canonicalJsonValue(planWithoutDigest)));
}
function readU32Le(bytes, offset) {
    if (offset < 0 || offset + 4 > bytes.length)
        return -1;
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function writeU32Le(bytes, offset, value) {
    bytes[offset] = value;
    bytes[offset + 1] = value >>> 8;
    bytes[offset + 2] = value >>> 16;
    bytes[offset + 3] = value >>> 24;
}
function writeU64Le(bytes, offset, value) {
    for (let index = 0; index < 8; index += 1)
        bytes[offset + index] = Number((value >> BigInt(index * 8)) & 0xffn);
}
function validateExactJsonProjection(value, expected, path, context) {
    if (Array.isArray(expected)) {
        const actual = arrayValue(value, path, context);
        if (actual.length !== expected.length)
            fail(path, "array length does not match the SDK-issued projection", actual, context);
        expected.forEach((entry, index) => validateExactJsonProjection(actual[index], entry, `${path}[${index}]`, context));
        return;
    }
    if (isObject(expected)) {
        const expectedKeys = Object.keys(expected);
        const actual = exactObject(value, expectedKeys, expectedKeys, path, context);
        expectedKeys.forEach((field) => validateExactJsonProjection(actual[field], expected[field], `${path}.${field}`, context));
        return;
    }
    if (value !== expected)
        fail(path, "value does not match the SDK-issued projection", value, context);
}
function validateCurrentProtocol(value, path, context) {
    const protocol = exactObject(value, Object.keys(CURRENT_PROTOCOL_FIELDS), Object.keys(CURRENT_PROTOCOL_FIELDS), path, context);
    for (const [field, expected] of Object.entries(CURRENT_PROTOCOL_FIELDS)) {
        exactString(protocol[field], field === "cluster" && protocol.cluster === MAINNET_PROFILE.network ? MAINNET_PROFILE.network : expected, `${path}.${field}`, context);
    }
}
function exactObject(value, allowed, required, path, context) {
    const object = objectValue(value, path, context);
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(object).find((field) => !allowedSet.has(field));
    if (unknown !== undefined)
        fail(`${path}.${unknown}`, "unexpected field", object[unknown], context);
    const missing = required.find((field) => !Object.hasOwn(object, field));
    if (missing !== undefined)
        fail(`${path}.${missing}`, "required field is missing", undefined, context);
    return object;
}
function objectValue(value, path, context) {
    if (!isObject(value))
        fail(path, "expected an object", value, context);
    return value;
}
function arrayValue(value, path, context) {
    if (!Array.isArray(value))
        fail(path, "expected an array", value, context);
    return value;
}
function nonemptyStringValue(value, path, context) {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim() || /[\0\r\n]/.test(value)) {
        fail(path, "expected nonempty trimmed text", value, context);
    }
    return value;
}
function currentProductId(value, path, context) {
    const product = nonemptyStringValue(value, path, context);
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(product)) {
        fail(path, "expected a canonical lowercase product identifier", value, context);
    }
    return product;
}
function currentSeriesId(value, marketId, path, context) {
    const series = nonemptyStringValue(value, path, context);
    const match = /^([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)-([A-Za-z0-9]+)-([A-Za-z0-9]+)-([0-9]{2})$/.exec(series);
    if (match === null) {
        fail(path, "expected the full on-chain series label PRODUCT-MATURITY-SIDE-NN", value, context);
    }
    if (match[1].toLowerCase() !== marketId) {
        fail(path, "series product must match marketId", value, context);
    }
    return series;
}
function exactString(value, expected, path, context) {
    if (value !== expected)
        fail(path, `expected ${JSON.stringify(expected)}`, value, context);
    return expected;
}
function enumString(value, allowed, path, context) {
    if (typeof value !== "string" || !allowed.includes(value))
        fail(path, `expected ${allowed.join(" or ")}`, value, context);
    return value;
}
function stringPattern(value, pattern, path, context, expectation) {
    if (typeof value !== "string" || !pattern.test(value))
        fail(path, `expected ${expectation}`, value, context);
    return value;
}
function booleanValue(value, path, context) {
    if (typeof value !== "boolean")
        fail(path, "expected a boolean", value, context);
    return value;
}
function exactBoolean(value, expected, path, context) {
    if (value !== expected)
        fail(path, `expected ${expected}`, value, context);
    return expected;
}
function finiteNumberValue(value, path, context, minimum, inclusive = true) {
    if (typeof value !== "number" || !Number.isFinite(value))
        fail(path, "expected a finite number", value, context);
    if (minimum !== undefined && (inclusive ? value < minimum : value <= minimum))
        fail(path, `expected a number ${inclusive ? ">=" : ">"} ${minimum}`, value, context);
    return value;
}
function safeIntegerValue(value, path, context, minimum, maximum = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `expected a safe integer from ${minimum} through ${maximum}`, value, context);
    }
    return value;
}
function canonicalUnsignedDecimal(value, path, context) {
    return stringPattern(value, /^(0|[1-9][0-9]*)$/, path, context, "a canonical unsigned decimal string");
}
function canonicalU64(value, path, context) {
    const decimal = canonicalUnsignedDecimal(value, path, context);
    if (BigInt(decimal) > 18446744073709551615n) {
        fail(path, "expected a canonical u64 decimal string", value, context);
    }
    return decimal;
}
function canonicalPositiveU64(value, path, context) {
    const decimal = canonicalU64(value, path, context);
    if (decimal === "0")
        fail(path, "expected a positive canonical u64 decimal string", value, context);
    return decimal;
}
function sha256Digest(value, path, context) {
    return stringPattern(value, /^[0-9a-f]{64}$/, path, context, "a lowercase SHA-256 digest");
}
function decimalAmount(value, path, context, positive = false) {
    const amount = canonicalUnsignedDecimal(value, path, context);
    if (positive && amount === "0")
        fail(path, "expected a positive decimal amount", value, context);
    return amount;
}
function canonicalDecimalText(value, path, context) {
    return stringPattern(value, /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, path, context, "a canonical nonnegative decimal string");
}
function base58Address(value, path, context) {
    return base58Text(value, path, context, 32, 44, 32);
}
function base58Text(value, path, context, minimumLength, maximumLength, expectedBytes) {
    if (typeof value !== "string" || value.length < minimumLength || value.length > maximumLength || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
        fail(path, "expected canonical base58 text", value, context);
    }
    if (expectedBytes !== undefined && decodedBase58Length(value) !== expectedBytes) {
        fail(path, `expected canonical base58 encoding of ${expectedBytes} bytes`, value, context);
    }
    return value;
}
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value) {
    const bytes = [0];
    for (const character of value) {
        let carry = BASE58_ALPHABET.indexOf(character);
        if (carry < 0)
            throw new Error("invalid base58 character");
        for (let index = 0; index < bytes.length; index += 1) {
            carry += bytes[index] * 58;
            bytes[index] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    let leadingZeroes = 0;
    while (leadingZeroes < value.length && value[leadingZeroes] === "1")
        leadingZeroes += 1;
    const bodyLength = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
    const result = new Uint8Array(leadingZeroes + bodyLength);
    for (let index = 0; index < bodyLength; index += 1)
        result[result.length - 1 - index] = bytes[index];
    return result;
}
function encodeBase58(bytes) {
    let leadingZeroes = 0;
    while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0)
        leadingZeroes += 1;
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let index = 0; index < digits.length; index += 1) {
            carry += digits[index] << 8;
            digits[index] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }
    const body = leadingZeroes === bytes.length
        ? ""
        : digits.slice().reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
    return "1".repeat(leadingZeroes) + body;
}
function decodedBase58Length(value) {
    try {
        return decodeBase58(value).length;
    }
    catch {
        return -1;
    }
}
function canonicalBase64(value, path, context) {
    if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        fail(path, "expected canonical padded base64", value, context);
    }
    let decoded;
    try {
        decoded = globalThis.atob(value);
    }
    catch {
        fail(path, "expected valid base64", value, context);
    }
    if (globalThis.btoa(decoded) !== value) {
        fail(path, "expected canonical padded base64", value, context);
    }
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
function isoTimestamp(value, path, context) {
    const timestamp = nonemptyStringValue(value, path, context);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
        fail(path, "expected a UTC ISO-8601 timestamp", value, context);
    }
    return timestamp;
}
function stringArrayValue(value, path, context) {
    return arrayValue(value, path, context).map((entry, index) => nonemptyStringValue(entry, `${path}[${index}]`, context));
}
function jsonObjectValue(value, path, context) {
    const object = objectValue(value, path, context);
    validateJsonValue(object, path, context);
    return object;
}
function jsonPrimitiveValue(value, path, context) {
    if (value === undefined || Array.isArray(value) || isObject(value)) {
        fail(path, "expected a JSON primitive", value, context);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
        fail(path, "JSON number must be finite", value, context);
    }
}
function jsonArrayValue(value, path, context) {
    const array = arrayValue(value, path, context);
    array.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, context));
    return array;
}
function validateJsonValue(value, path, context, depth = 0) {
    if (depth > 64)
        fail(path, "JSON nesting exceeds the current response bound", value, context);
    if (value === undefined)
        fail(path, "undefined is not valid JSON", value, context);
    if (typeof value === "number" && !Number.isFinite(value))
        fail(path, "JSON number must be finite", value, context);
    if (Array.isArray(value)) {
        value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, context, depth + 1));
    }
    else if (isObject(value)) {
        for (const [field, entry] of Object.entries(value))
            validateJsonValue(entry, `${path}.${field}`, context, depth + 1);
    }
}
function fail(path, message, value, context) {
    throw new AmebaResponseValidationError(path, message, {
        details: { received: describe(value) },
        context,
    });
}
async function readBoundedResponseText(response, maximumBytes, context) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
        const parsedLength = Number(declaredLength);
        if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
            throw new AmebaResponseValidationError("$", `backend response exceeds ${maximumBytes} bytes`, {
                details: { maximumBytes, declaredBytes: parsedLength },
                context,
            });
        }
    }
    if (!response.body) {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maximumBytes) {
            throw new AmebaResponseValidationError("$", `backend response exceeds ${maximumBytes} bytes`, {
                details: { maximumBytes },
                context,
            });
        }
        return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > maximumBytes) {
                await reader.cancel("response size limit exceeded");
                throw new AmebaResponseValidationError("$", `backend response exceeds ${maximumBytes} bytes`, {
                    details: { maximumBytes },
                    context,
                });
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
}
function productSegment(raw, label) {
    return encodeURIComponent(validateInputCurrentProductId(raw, label));
}
function segment(raw, label) {
    return encodeURIComponent(nonempty(raw, label));
}
function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
}
function readU64Le(bytes, offset) {
    let value = 0n;
    for (let index = 7; index >= 0; index -= 1) {
        value = (value << 8n) | BigInt(bytes[offset + index]);
    }
    return value;
}
function nonempty(raw, label) {
    const value = raw.trim();
    if (!value)
        throw new AmebaInputError(`${label} must not be empty`);
    return value;
}
function optionalNonempty(raw, label) {
    return raw === undefined ? undefined : nonempty(raw, label);
}
function rejectUnknownInputFields(request, allowedFields, label) {
    const allowed = new Set(allowedFields);
    const unknown = Object.keys(request).filter((field) => !allowed.has(field));
    if (unknown.length > 0)
        throw new AmebaInputError(`${label} contains unsupported fields: ${unknown.join(", ")}`);
    const missing = allowedFields.find((field) => !Object.hasOwn(request, field));
    if (missing !== undefined)
        throw new AmebaInputError(`${label} requires ${missing}`);
}
function validateInputPositiveU64(value, label) {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > 18446744073709551615n) {
        throw new AmebaInputError(`${label} must be a positive canonical u64 decimal string`);
    }
    return value;
}
function validateCurrentCollectiveOperationSubmitRequest(request) {
    rejectUnknownInputFields(request, [
        "operationId", "preparedPlanDigest", "owner", "batchIndex",
        "serializedTransactionBase64", "signedTransactionBase64",
    ], "collective operation submission");
    lowercaseSha256Input(request.operationId, "operationId");
    lowercaseSha256Input(request.preparedPlanDigest, "preparedPlanDigest");
    if (!Number.isSafeInteger(request.batchIndex) || request.batchIndex < 0 || request.batchIndex > 255) {
        throw new AmebaInputError("batchIndex must be a safe integer from 0 through 255");
    }
    const preparedBytes = validateInputBase64(request.serializedTransactionBase64, "serializedTransactionBase64");
    const signedBytes = validateInputBase64(request.signedTransactionBase64, "signedTransactionBase64");
    if (preparedBytes.length > 1_232 || signedBytes.length > 1_232) {
        throw new AmebaInputError("submitted transactions must fit the 1232-byte Solana packet bound");
    }
    validateInputBase58(request.owner, "owner", 32, 44, 32);
    validateSignedTransactionBinding(request, preparedBytes, signedBytes);
}
function validateSignedTransactionBinding(request, preparedBytes, signedBytes) {
    let prepared;
    let signed;
    try {
        prepared = VersionedTransaction.deserialize(preparedBytes);
        signed = VersionedTransaction.deserialize(signedBytes);
    }
    catch (cause) {
        throw new AmebaInputError("submitted transactions must be canonical Solana transaction envelopes", {
            cause: cause instanceof Error ? cause.message : String(cause),
        });
    }
    if (!equalBytes(prepared.serialize(), preparedBytes) || !equalBytes(signed.serialize(), signedBytes)) {
        throw new AmebaInputError("submitted transactions must not contain trailing or noncanonical bytes");
    }
    const preparedMessage = prepared.message.serialize();
    const signedMessage = signed.message.serialize();
    if (!equalBytes(preparedMessage, signedMessage)) {
        throw new AmebaInputError("signedTransactionBase64 must contain the exact prepared message");
    }
    const signerCount = prepared.message.header.numRequiredSignatures;
    if (prepared.signatures.length !== signerCount || signed.signatures.length !== signerCount) {
        throw new AmebaInputError("transaction signature slots must match the required signer count");
    }
    const ownerIndex = prepared.message.staticAccountKeys
        .slice(0, signerCount)
        .findIndex((key) => key.toBase58() === request.owner);
    if (ownerIndex < 0) {
        throw new AmebaInputError("owner must be a required signer of the prepared transaction");
    }
    if (!allZero(prepared.signatures[ownerIndex])) {
        throw new AmebaInputError("the prepared transaction owner signature slot must be empty");
    }
    if (allZero(signed.signatures[ownerIndex])) {
        throw new AmebaInputError("signedTransactionBase64 must contain the owner signature");
    }
    prepared.signatures.forEach((signature, index) => {
        if (!allZero(signature) && !equalBytes(signature, signed.signatures[index])) {
            throw new AmebaInputError("signedTransactionBase64 must preserve prepared partial signatures");
        }
    });
    if (signed.signatures.some(allZero)) {
        throw new AmebaInputError("signedTransactionBase64 must contain every required signature");
    }
}
function lowercaseSha256Input(value, label) {
    if (!/^[0-9a-f]{64}$/u.test(value)) {
        throw new AmebaInputError(`${label} must be a lowercase SHA-256 digest`);
    }
    return value;
}
function equalBytes(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function allZero(bytes) {
    return bytes.every((value) => value === 0);
}
function validateInputCurrentProductId(value, label) {
    const product = nonempty(value, label);
    if (product !== value || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(product)) {
        throw new AmebaInputError(`${label} must be a canonical lowercase product identifier`);
    }
    return product;
}
function validateInputCurrentSeriesId(value, marketId, label) {
    const series = nonempty(value, label);
    const match = /^([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)-([A-Za-z0-9]+)-([A-Za-z0-9]+)-([0-9]{2})$/.exec(series);
    if (series !== value || match === null || (marketId !== undefined && match[1].toLowerCase() !== marketId)) {
        throw new AmebaInputError(marketId === undefined
            ? `${label} must be a full on-chain series label`
            : `${label} must be the full on-chain series label for ${marketId}`);
    }
    return series;
}
function validateInputBase64(value, label) {
    if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new AmebaInputError(`${label} must be canonical padded base64`);
    }
    try {
        const decoded = globalThis.atob(value);
        if (globalThis.btoa(decoded) !== value)
            throw new Error("non-canonical base64");
        return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    }
    catch {
        throw new AmebaInputError(`${label} must be canonical padded base64`);
    }
}
function validateInputBase58(value, label, minimumLength, maximumLength, expectedBytes) {
    if (value.length < minimumLength || value.length > maximumLength || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
        throw new AmebaInputError(`${label} must be canonical base58 text`);
    }
    if (expectedBytes !== undefined && decodedBase58Length(value) !== expectedBytes) {
        throw new AmebaInputError(`${label} must encode exactly ${expectedBytes} bytes`);
    }
    return value;
}
function positiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new AmebaInputError(`${label} must be a positive safe integer`);
    }
    return value;
}
function finiteNumber(value, label) {
    if (!Number.isFinite(value))
        throw new AmebaInputError(`${label} must be finite`);
    return value;
}
function chartRangeWindowMs(range) {
    switch (range) {
        case "1h":
            return 60 * 60 * 1_000;
        case "24h":
            return 24 * 60 * 60 * 1_000;
        case "7d":
            return 7 * 24 * 60 * 60 * 1_000;
        case "30d":
            return 30 * 24 * 60 * 60 * 1_000;
        case "all":
        case undefined:
            return undefined;
    }
}
function parseJson(raw, status, context) {
    if (!raw.trim())
        return null;
    try {
        return JSON.parse(raw);
    }
    catch (cause) {
        throw new AmebaResponseValidationError("$", `backend returned invalid JSON for HTTP ${status}`, {
            cause,
            details: { preview: raw.slice(0, 512) },
            context,
        });
    }
}
function isBackendFailure(payload) {
    return isObject(payload) && payload.ok === false;
}
function currentBackendError(payload, context) {
    const error = exactObject(payload, ["ok", "code", "message"], ["ok", "code", "message"], "$", context);
    if (error.ok !== false)
        fail("$.ok", "expected false", error.ok, context);
    return Object.freeze({
        code: nonemptyStringValue(error.code, "$.code", context),
        message: nonemptyStringValue(error.message, "$.message", context),
    });
}
function responseMetadata(method, url, response, startedAt) {
    const resetSeconds = numberHeader(response.headers.get("x-ratelimit-reset"));
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const rateLimit = {
        limit: numberHeader(response.headers.get("x-ratelimit-limit")),
        remaining: numberHeader(response.headers.get("x-ratelimit-remaining")),
        resetAt: resetSeconds === undefined
            ? undefined
            : new Date(resetSeconds > 10_000_000_000 ? resetSeconds : resetSeconds * 1_000),
        retryAfterMs,
    };
    const hasRateLimit = Object.values(rateLimit).some((value) => value !== undefined);
    return Object.freeze({
        method,
        url: url.toString(),
        status: response.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        requestId: response.headers.get("x-request-id") ?? undefined,
        rateLimit: hasRateLimit ? Object.freeze(rateLimit) : undefined,
    });
}
function parseRetryAfter(value) {
    if (value === null)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.ceil(seconds * 1_000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
function numberHeader(value) {
    if (value === null)
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function describe(value) {
    if (value === undefined)
        return "missing";
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function bigintReplacer(_key, value) {
    return typeof value === "bigint" ? value.toString() : value;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=client.js.map