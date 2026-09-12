import { AmebaInputError } from "../errors.js";
import { assertCurrentWriteReleaseAvailable } from "../protocol/release-train.js";
import type { JsonValue } from "../types.js";
import type { PetriOperationInput } from "./inputs.js";
import {
  OPERATIONS,
  operationById,
  type PetriOperationDefinition,
  type PetriOperationId,
} from "./operations.js";
import {
  executeBuffered,
  runtimeConfig,
  spawnInteractive,
  type PetriAdapterOptions,
  type PetriInput,
  type PetriInteractiveSession,
  type PetriRuntimeConfig,
} from "./process.js";

export type PetriInteractiveOperationId =
  | "markets.openChart"
  | "tui.open"
  | "demo.open";
export type PetriTextOperationId =
  | "meta.help"
  | "meta.version"
  | "markets.staticChart";

export type PetriOperationResult<Id extends PetriOperationId> =
  Id extends PetriInteractiveOperationId
    ? PetriInteractiveSession
    : Id extends PetriTextOperationId
      ? Promise<string>
      : Promise<JsonValue>;

export type PetriTypedOperation<Id extends PetriOperationId> = (
  input?: PetriOperationInput<Id>,
) => PetriOperationResult<Id>;

export type PetriOperation = (
  input?: PetriInput,
) => JsonValue | string | PetriInteractiveSession | Promise<JsonValue | string>;
export type PetriJsonOperation<Id extends PetriOperationId = PetriOperationId> =
  PetriTypedOperation<Id>;
export type PetriTextOperation<Id extends PetriTextOperationId = PetriTextOperationId> =
  PetriTypedOperation<Id>;
export type PetriInteractiveOperation<
  Id extends PetriInteractiveOperationId = PetriInteractiveOperationId,
> = PetriTypedOperation<Id>;

export interface PetriMetaApi {
  frontDoor: PetriTypedOperation<"meta.frontDoor">;
  help: PetriTypedOperation<"meta.help">;
  version: PetriTypedOperation<"meta.version">;
}

export interface PetriMarketsApi {
  list: PetriTypedOperation<"markets.list">;
  show: PetriTypedOperation<"markets.show">;
  status: PetriTypedOperation<"markets.status">;
  print: PetriTypedOperation<"markets.print">;
  chart: PetriTypedOperation<"markets.chart">;
  openChart: PetriTypedOperation<"markets.openChart">;
  staticChart: PetriTypedOperation<"markets.staticChart">;
}

export interface PetriOracleApi {
  recipeDefault: PetriTypedOperation<"oracle.recipeDefault">;
  state: PetriTypedOperation<"oracle.state">;
  markets: PetriTypedOperation<"oracle.markets">;
  latest: PetriTypedOperation<"oracle.latest">;
  history: PetriTypedOperation<"oracle.history">;
  recipe: PetriTypedOperation<"oracle.recipe">;
  sources: {
    list: PetriTypedOperation<"oracle.sources.list">;
    propose: PetriTypedOperation<"oracle.sources.propose">;
    support: PetriTypedOperation<"oracle.sources.support">;
    challenge: PetriTypedOperation<"oracle.sources.challenge">;
  };
  prints: {
    opening: PetriTypedOperation<"oracle.prints.opening">;
    challenge: PetriTypedOperation<"oracle.prints.challenge">;
  };
  updates: {
    commit: PetriTypedOperation<"oracle.updates.commit">;
    reveal: PetriTypedOperation<"oracle.updates.reveal">;
    expire: PetriTypedOperation<"oracle.updates.expire">;
    challenge: PetriTypedOperation<"oracle.updates.challenge">;
  };
  emergency: {
    commit: PetriTypedOperation<"oracle.emergency.commit">;
    reveal: PetriTypedOperation<"oracle.emergency.reveal">;
  };
  rewards: { claim: PetriTypedOperation<"oracle.rewards.claim"> };
  stakes: { settle: PetriTypedOperation<"oracle.stakes.settle"> };
  amba: {
    deposit: PetriTypedOperation<"oracle.amba.deposit">;
    withdraw: PetriTypedOperation<"oracle.amba.withdraw">;
  };
  drafts: {
    listDefault: PetriTypedOperation<"oracle.drafts.listDefault">;
    list: PetriTypedOperation<"oracle.drafts.list">;
    show: PetriTypedOperation<"oracle.drafts.show">;
    validate: PetriTypedOperation<"oracle.drafts.validate">;
    submit: PetriTypedOperation<"oracle.drafts.submit">;
  };
}

export interface PetriDeveloperApi {
  settlementSigners: {
    initialize: PetriTypedOperation<"settlementSigners.initialize">;
    rotationDigest: PetriTypedOperation<"settlementSigners.rotationDigest">;
    propose: PetriTypedOperation<"settlementSigners.propose">;
    proposeEmergencyRecovery: PetriTypedOperation<"settlementSigners.proposeEmergencyRecovery">;
    activate: PetriTypedOperation<"settlementSigners.activate">;
    cancel: PetriTypedOperation<"settlementSigners.cancel">;
  };
  vault: {
    rotateAuthorities: PetriTypedOperation<"vault.rotateAuthorities">;
  };
  oracle: {
    recipeWeights: { plan: PetriTypedOperation<"oracle.recipeWeights.plan"> };
    activeWeights: { plan: PetriTypedOperation<"oracle.activeWeights.plan"> };
    settlementSources: { plan: PetriTypedOperation<"oracle.settlementSources.plan"> };
    economics: { configure: PetriTypedOperation<"oracle.economics.configure"> };
    closeMonth: PetriTypedOperation<"oracle.closeMonth">;
    sources: {
      resolveChallenge: PetriTypedOperation<"oracle.sources.resolveChallenge">;
    };
    prints: {
      finalize: PetriTypedOperation<"oracle.prints.finalize">;
      expire: PetriTypedOperation<"oracle.prints.expire">;
      finalizePhase: PetriTypedOperation<"oracle.prints.finalizePhase">;
    };
    updates: { finalize: PetriTypedOperation<"oracle.updates.finalize"> };
    emergency: {
      open: PetriTypedOperation<"oracle.emergency.open">;
      resolve: PetriTypedOperation<"oracle.emergency.resolve">;
    };
    amba: { configure: PetriTypedOperation<"oracle.amba.configure"> };
  };
}

/**
 * Complete compatibility adapter for the mounted Petri command surface.
 *
 * It is deliberately separate from the HTTP SDK. Local config, MCP setup,
 * wallet/RPC behavior, explicit signing, and terminal presentation remain in
 * Petri and are never silently performed by AmebaClient.
 */
/** Current-process adapter generated from the pinned Petri command manifest. */
export class PetriAdapter {
  declare readonly meta: PetriMetaApi;
  declare readonly markets: PetriMarketsApi;
  declare readonly contracts: {
    chain: PetriTypedOperation<"contracts.chain">;
  };
  declare readonly trades: {
    prepare: PetriTypedOperation<"trades.prepare">;
    submit: PetriTypedOperation<"trades.submit">;
  };
  declare readonly writers: {
    list: PetriTypedOperation<"writers.list">;
    show: PetriTypedOperation<"writers.show">;
    deposit: PetriTypedOperation<"writers.deposit">;
    bid: PetriTypedOperation<"writers.bid">;
    closePreview: PetriTypedOperation<"writers.closePreview">;
    close: PetriTypedOperation<"writers.close">;
    closeStatus: PetriTypedOperation<"writers.closeStatus">;
    claim: PetriTypedOperation<"writers.claim">;
    transferFlat: PetriTypedOperation<"writers.transferFlat">;
    policyAudit: PetriTypedOperation<"writers.policyAudit">;
  };
  declare readonly liquidity: {
    plan: PetriTypedOperation<"liquidity.plan">;
    add: PetriTypedOperation<"liquidity.add">;
    remove: PetriTypedOperation<"liquidity.remove">;
    closePosition: PetriTypedOperation<"liquidity.closePosition">;
  };
  declare readonly wallet: {
    overview: PetriTypedOperation<"wallet.overview">;
    address: PetriTypedOperation<"wallet.address">;
    balance: PetriTypedOperation<"wallet.balance">;
    collateral: PetriTypedOperation<"wallet.collateral">;
  };
  declare readonly staking: {
    statusDefault: PetriTypedOperation<"staking.statusDefault">;
    status: PetriTypedOperation<"staking.status">;
    stake: PetriTypedOperation<"staking.stake">;
    activate: PetriTypedOperation<"staking.activate">;
    cancel: PetriTypedOperation<"staking.cancel">;
    unstake: PetriTypedOperation<"staking.unstake">;
    claim: PetriTypedOperation<"staking.claim">;
  };
  declare readonly history: { list: PetriTypedOperation<"history.list"> };
  declare readonly settlements: {
    show: PetriTypedOperation<"settlements.show">;
    check: PetriTypedOperation<"settlements.check">;
    oracle: PetriTypedOperation<"settlements.oracle">;
  };
  declare readonly oracle: PetriOracleApi;
  declare readonly config: {
    show: PetriTypedOperation<"config.show">;
    set: PetriTypedOperation<"config.set">;
    reset: PetriTypedOperation<"config.reset">;
  };
  declare readonly mcp: {
    status: PetriTypedOperation<"mcp.status">;
    enable: PetriTypedOperation<"mcp.enable">;
    repair: PetriTypedOperation<"mcp.repair">;
    disable: PetriTypedOperation<"mcp.disable">;
    manifest: PetriTypedOperation<"mcp.manifest">;
  };
  declare readonly update: {
    install: PetriTypedOperation<"update.install">;
    check: PetriTypedOperation<"update.check">;
  };
  declare readonly tui: {
    snapshot: PetriTypedOperation<"tui.snapshot">;
    open: PetriTypedOperation<"tui.open">;
  };
  declare readonly demo: {
    snapshot: PetriTypedOperation<"demo.snapshot">;
    open: PetriTypedOperation<"demo.open">;
  };
  declare readonly developer: PetriDeveloperApi;

  readonly #config: PetriRuntimeConfig;

  constructor(options: PetriAdapterOptions = {}) {
    this.#config = runtimeConfig(options);
    for (const operation of OPERATIONS) {
      setNestedOperation(this, operation.method, this.operationFunction(operation));
    }
    freezeNamespaces(this);
  }

  invoke<Id extends PetriOperationId>(
    id: Id,
    input?: PetriOperationInput<Id>,
  ): PetriOperationResult<Id>;
  invoke(
    id: string,
    input?: PetriInput,
  ): JsonValue | string | PetriInteractiveSession | Promise<JsonValue | string>;
  invoke(
    id: string,
    input?: PetriInput,
  ): JsonValue | string | PetriInteractiveSession | Promise<JsonValue | string> {
    const operation = operationById(id);
    if (!operation) throw new AmebaInputError(`Unknown Petri operation id: ${id}`);
    return this.execute(operation, input);
  }

  describe(
    id?: PetriOperationId | string,
  ): PetriOperationDefinition | readonly PetriOperationDefinition[] {
    if (id === undefined) return OPERATIONS;
    const operation = operationById(id);
    if (!operation) throw new AmebaInputError(`Unknown Petri operation id: ${id}`);
    return operation;
  }

  private operationFunction(operation: PetriOperationDefinition): PetriOperation {
    const call = (input?: PetriInput) => this.execute(operation, input);
    Object.defineProperties(call, {
      id: { value: operation.id, enumerable: true },
      definition: { value: operation, enumerable: true },
    });
    return call;
  }

  private execute(
    operation: PetriOperationDefinition,
    input?: PetriInput,
  ): JsonValue | string | PetriInteractiveSession | Promise<JsonValue | string> {
    if (operation.effect === "transaction") {
      assertCurrentWriteReleaseAvailable();
    }
    return operation.output === "interactive"
      ? spawnInteractive(this.#config, operation, input)
      : executeBuffered(this.#config, operation, input);
  }
}

function setNestedOperation(
  target: object,
  path: readonly string[],
  operation: PetriOperation,
): void {
  if (path.length === 0) {
    throw new AmebaInputError("Petri operation method path must not be empty");
  }
  let cursor = target as Record<string, unknown>;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (existing === undefined) {
      const namespace: Record<string, unknown> = {};
      cursor[segment] = namespace;
      cursor = namespace;
    } else if (typeof existing === "object" && existing !== null) {
      cursor = existing as Record<string, unknown>;
    } else {
      throw new AmebaInputError(
        `Petri operation namespace collides at ${path.join(".")}`,
      );
    }
  }
  const leaf = path[path.length - 1];
  if (!leaf) {
    throw new AmebaInputError("Petri operation method path has an empty leaf");
  }
  if (cursor[leaf] !== undefined) {
    throw new AmebaInputError(`Duplicate Petri operation method: ${path.join(".")}`);
  }
  cursor[leaf] = operation;
}

function freezeNamespaces(target: object): void {
  for (const value of Object.values(target)) {
    if (typeof value === "object" && value !== null) {
      freezeNamespaces(value);
      Object.freeze(value);
    }
  }
}
