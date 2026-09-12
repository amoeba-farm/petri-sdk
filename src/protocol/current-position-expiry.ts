/** Finalized expiry planning for current LP positions. This module never persists records or executes transactions. */
import {createHash} from "node:crypto";
import {PublicKey} from "@solana/web3.js";
import {
  CurrentSdkOperationError, discoverCurrentAmoebaDlmmPositions, readCurrentAmoebaDlmmPool,
  type CurrentAdapterContextInput, type CurrentAmoebaDlmmPositionAccount,
} from "./current-adapter.js";
import {CURRENT_PROTOCOL_DEVNET_GENESIS_HASH, CURRENT_ORACLE_MONTH_ACCOUNT_SIZE,
  CURRENT_SETTLEMENT_RECORD_V2_ACCOUNT_SIZE, decodeCurrentOracleMonthAccount,
  decodeCurrentSettlementRecordV2Account} from "./current.js";
import {AMOEBA_SPREAD_PROGRAM_ID} from "./identity.js";

export interface CurrentPositionExpiryState {
  readonly stateNamespace: "ameba-spread-v2";
  readonly markets: readonly {readonly address: string; readonly marketId: string; readonly expiryId: string}[];
  readonly issues?: readonly string[];
  readonly pools: readonly {readonly address: string; readonly marketAddress: string}[];
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
  readonly shares: readonly {readonly binId: number; readonly shares: string}[];
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
  readonly readiness: {readonly ready: false; readonly planningSupported: true; readonly executionSupported: false; readonly blockers: readonly string[]} | null;
  readonly scheduler: {readonly enabled: false; readonly mode: "planning_only"; readonly recordCount: number};
  readonly issues: readonly {readonly pool: string | null; readonly code: string}[];
}
function invalid(message: string): never {
  throw new CurrentSdkOperationError("CURRENT_POSITION_EXPIRY_INPUT_INVALID", message);
}
function canonicalAddress(value: string): string {
  const key = new PublicKey(value).toBase58();
  if (key !== value) invalid("address must be canonical");
  return key;
}
function slot(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalid("finalized slot is invalid");
  return value;
}
/** Reads a bounded, explicitly supplied pool scope; an incomplete read is never reported as an empty complete portfolio. */
export async function readCurrentPositionExpiryAutomation(input: ReadCurrentPositionExpiryAutomationInput): Promise<CurrentPositionExpiryProjection> {
  if (input.namespace !== "ameba-spread-v2" || input.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID
    || input.state?.stateNamespace !== input.namespace || (input.commitment !== undefined && input.commitment !== "finalized")) invalid("current finalized namespace is required");
  input = {...input};
  const owner = canonicalAddress(input.owner);
  const automationId = input.automationId;
  if (automationId !== undefined && !/^[0-9a-f]{64}$/.test(automationId)) invalid("automationId must be a canonical SHA-256 identifier");
  if (!Array.isArray(input.state.markets) || !Array.isArray(input.state.pools) || input.state.markets.length > 256 || input.state.pools.length > 256) invalid("market/pool discovery scope exceeds 256");
  // Snapshot caller-owned discovery metadata before the first await.
  const scopeIssues = [...(input.state.issues ?? [])];
  if (scopeIssues.some(code => typeof code !== "string")) invalid("scope issue codes must be strings");
  const markets = input.state.markets.map(m => ({address: canonicalAddress(m.address), marketId: m.marketId, expiryId: m.expiryId}));
  const pools = input.state.pools.map(p => ({address: canonicalAddress(p.address), marketAddress: canonicalAddress(p.marketAddress)}));
  if (new Set(pools.map(p => p.address)).size !== pools.length || new Set(markets.map(m => m.address)).size !== markets.length) invalid("discovery scope contains duplicates");
  const selections = pools.map(pool => {
    const matches = markets.filter(m => m.address === pool.marketAddress);
    if (matches.length !== 1) invalid("pool requires one canonical Market join");
    return {...pool, market: matches[0]!};
  });
  const start = slot(await input.connection.getSlot("finalized"));
  const [genesis, time] = await Promise.all([input.connection.getGenesisHash(), input.connection.getBlockTime(start)]);
  if (genesis !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH || time === null || !Number.isSafeInteger(time) || time < 0) invalid("Devnet finalized time is unavailable");
  const records: CurrentPositionExpiryRecord[] = [];
  const issues: {pool: string | null; code: string}[] = [];
  const rereadOrUnrelated = new Set(["current_page_scan_failed", "current_position_scan_failed", "current_readiness_facts_unavailable"]);
  for (const code of scopeIssues) if (!rereadOrUnrelated.has(code)) issues.push({pool: null, code});
  // Eight bounded concurrent pool reads. The projection is a read window, not an atomic transaction admission.
  for (let offset = 0; offset < selections.length; offset += 8) {
    await Promise.all(selections.slice(offset, offset + 8).map(async selected => {
      try {
        const resolved = await readCurrentAmoebaDlmmPool({...input, marketId: selected.market.marketId, expiryId: selected.market.expiryId});
        const pool = resolved.pool;
        if (resolved.poolAddress.toBase58() !== selected.address || pool.market.toBase58() !== selected.market.address) invalid("fresh pool differs from requested canonical Market");
        const positions = await discoverCurrentAmoebaDlmmPositions({...input, poolAddress: resolved.poolAddress, owner: undefined,
          maximumBinId: pool.maximumBinId, expectedPositionCount: pool.positionCount, limit: 256});
        // Check all owners before filtering: the count is global to the pool.
        if (positions.positions.length !== pool.positionCount) invalid("fresh position count differs from pool accounting");
        const monthInfo = await input.connection.getAccountInfo(pool.oracleMonth, "finalized");
        if (!monthInfo || monthInfo.data.length !== CURRENT_ORACLE_MONTH_ACCOUNT_SIZE) invalid("anchor OracleMonth is unavailable");
        const month = decodeCurrentOracleMonthAccount({address: pool.oracleMonth, data: monthInfo.data, owner: monthInfo.owner,
          executable: monthInfo.executable, namespace: input.namespace, programId: input.programId, expiryTs: pool.expiryTs});
        let settlementExists = false;
        if (month.settlementRecord !== null) {
          const info = await input.connection.getAccountInfo(month.settlementRecord, "finalized");
          if (!info || info.data.length !== CURRENT_SETTLEMENT_RECORD_V2_ACCOUNT_SIZE) invalid("referenced settlement record is unavailable");
          decodeCurrentSettlementRecordV2Account({address: month.settlementRecord, data: info.data, owner: info.owner,
            executable: info.executable, namespace: input.namespace, programId: input.programId,
            expectedMarket: month.market, expectedOracleMonth: pool.oracleMonth, expectedSettlementTs: month.finalizedAtTs});
          settlementExists = true;
        }
        const settlementFinal = settlementExists && month.settlementStatus === "Final";
        for (const resolvedPosition of positions.positions) {
          const position: CurrentAmoebaDlmmPositionAccount = resolvedPosition.position;
          if (position.owner.toBase58() !== owner) continue;
          const shares = position.liquidityShares.flatMap((amount, index) => amount === 0n ? [] : [{binId: position.lowerBinId + index, shares: amount.toString()}]);
          const totalShares = position.liquidityShares.reduce((total, amount) => total + amount, 0n).toString();
          const nextAction = pool.status === "Closed" ? "pool_closed" : BigInt(time) < pool.expiryTs ? "await_expiry"
            : !settlementFinal ? "await_settlement" : pool.status !== "Settled" ? "settle_pool"
              : totalShares !== "0" ? "remove_liquidity" : "close_position";
          const blockers = ["CURRENT_EXPIRY_EXECUTOR_UNCONFIGURED"];
          if (nextAction === "await_expiry") blockers.push("MARKET_NOT_EXPIRED");
          if (nextAction === "await_settlement") blockers.push("FINAL_SETTLEMENT_REQUIRED");
          if (nextAction === "pool_closed") blockers.push("POOL_CLOSED");
          if (pool.liquidityManager.toBase58() !== owner) blockers.push("DESIGNATED_MANAGER_REQUIRED");
          if (resolved.sourceState === "cold" || resolvedPosition.sourceState === "cold") blockers.push("AUTHENTICATED_COLD_LOAD_REQUIRED");
          records.push(Object.freeze({automationId: createHash("sha256").update(`ameba:current_position_expiry:v1\0${owner}\0${position.address.toBase58()}`).digest("hex"),
            owner, position: position.address.toBase58(), positionNonce: position.positionNonce.toString(),
            market: selected.market.address, marketId: selected.market.marketId, expiryId: selected.market.expiryId,
            pool: selected.address, oracleMonth: pool.oracleMonth.toBase58(), expiryTs: pool.expiryTs.toString(), poolStatus: pool.status,
            liquidityManager: pool.liquidityManager.toBase58(), poolSourceState: resolved.sourceState,
            sourceState: resolvedPosition.sourceState, shares: Object.freeze(shares.map(s => Object.freeze(s))), totalShares,
            settlementExists, settlementFinal, settlementRecord: month.settlementRecord?.toBase58() ?? null,
            nextAction, instructionTag: nextAction === "settle_pool" ? 255 : nextAction === "remove_liquidity" || nextAction === "close_position" ? 210 : null,
            planningSupported: true, executionSupported: false, requiresMinimumOutputs: nextAction === "remove_liquidity",
            blockers: Object.freeze(blockers)}));
        }
      } catch (error) {
        issues.push({pool: selected.address, code: error instanceof CurrentSdkOperationError ? error.code! : "CURRENT_POSITION_EXPIRY_OBSERVATION_FAILED"});
      }
    }));
  }
  records.sort((a,b) => a.automationId.localeCompare(b.automationId));
  issues.sort((a,b) => (a.pool ?? "").localeCompare(b.pool ?? "") || a.code.localeCompare(b.code));
  const record = automationId === undefined ? null : records.find(r => r.automationId === automationId) ?? null;
  const end = slot(await input.connection.getSlot("finalized"));
  if (end < start) invalid("finalized observation regressed");
  return Object.freeze({stateNamespace: "ameba-spread-v2", mode: "planning_only", owner, commitment: "finalized",
    readWindowStartSlot: String(start), readWindowEndSlot: String(end), observedBlockTimeUnixSeconds: String(time), complete: issues.length === 0,
    records: Object.freeze(records), record,
    readiness: record === null ? null : Object.freeze({ready: false, planningSupported: true, executionSupported: false, blockers: record.blockers}),
    scheduler: Object.freeze({enabled: false, mode: "planning_only", recordCount: records.length}),
    issues: Object.freeze(issues.map(i => Object.freeze(i)))});
}
export interface SyncCurrentPositionExpiryAutomationInput extends ReadCurrentPositionExpiryAutomationInput {
  readonly request?: {readonly owner?: string; readonly automationId?: string};
}
/** Refresh planning only. No on-chain expiry executor or durable scheduler is installed by this SDK call. */
export async function syncCurrentPositionExpiryAutomation(input: SyncCurrentPositionExpiryAutomationInput): Promise<CurrentPositionExpiryProjection & {
  readonly applied: false; readonly reason: "CURRENT_EXPIRY_EXECUTOR_UNCONFIGURED";
}> {
  const request = input.request ?? {};
  if (Object.keys(request).some(key => key !== "owner" && key !== "automationId")) {
    throw new CurrentSdkOperationError("CURRENT_EXPIRY_EXECUTION_UNAVAILABLE", "sync only refreshes planning; execution, signer policy and durable state must be configured separately");
  }
  if (request.owner !== undefined && request.owner !== input.owner) invalid("sync owner differs from read owner");
  if (request.automationId !== undefined && input.automationId !== undefined && request.automationId !== input.automationId) invalid("sync automationId differs");
  const projection = await readCurrentPositionExpiryAutomation({...input, automationId: request.automationId ?? input.automationId});
  return Object.freeze({...projection, applied: false, reason: "CURRENT_EXPIRY_EXECUTOR_UNCONFIGURED"});
}
