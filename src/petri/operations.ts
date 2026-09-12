/**
 * Declarative map of every mounted current command behavior in ameba_cli.
 *
 * A command can appear more than once when the CLI exposes both a JSON data
 * path and an interactive terminal path. `developer-ops` entries require a
 * Petri binary compiled with that Cargo feature.
 */

export type PetriOperationAvailability = "public" | "developer-ops";
export type PetriOperationEffect =
  | "read"
  | "plan"
  | "prepare"
  | "local-write"
  | "remote-write"
  | "transaction";
export type PetriOperationOutput = "json" | "text" | "interactive";
export type PetriOperationStatus = "wired" | "stub";

export interface PetriOperationDefinition<Id extends string = string> {
  readonly id: Id;
  readonly method: readonly string[];
  readonly command: readonly string[];
  readonly availability: PetriOperationAvailability;
  readonly effect: PetriOperationEffect;
  readonly output: PetriOperationOutput;
  readonly status: PetriOperationStatus;
  readonly description: string;
}

const operation = <const Id extends string>(
  id: Id,
  method: readonly string[],
  command: readonly string[],
  {
    availability = "public",
    effect = "read",
    output = "json",
    status = "wired",
    description = "",
  }: {
    availability?: PetriOperationAvailability;
    effect?: PetriOperationEffect;
    output?: PetriOperationOutput;
    status?: PetriOperationStatus;
    description?: string;
  } = {},
): PetriOperationDefinition<Id> =>
  Object.freeze({
    id,
    method: Object.freeze(method),
    command: Object.freeze(command),
    availability,
    effect,
    output,
    status,
    description,
  });

export const OPERATIONS = Object.freeze([
  operation("meta.frontDoor", ["meta", "frontDoor"], []),
  operation("meta.help", ["meta", "help"], ["help"], { output: "text" }),
  operation("meta.version", ["meta", "version"], ["--version"], {
    output: "text",
  }),

  operation("markets.list", ["markets", "list"], ["markets"]),
  operation("markets.show", ["markets", "show"], ["markets", "show"]),
  operation("markets.status", ["markets", "status"], ["markets", "status"]),
  operation("markets.print", ["markets", "print"], ["markets", "print"]),
  operation("markets.chart", ["markets", "chart"], ["markets", "chart"]),
  operation("markets.openChart", ["markets", "openChart"], ["markets", "chart"], {
    output: "interactive",
  }),
  operation("markets.staticChart", ["markets", "staticChart"], ["markets", "chart", "--static"], {
    output: "text",
  }),

  operation("contracts.chain", ["contracts", "chain"], ["contracts"]),

  operation("trades.prepare", ["trades", "prepare"], ["trades", "prepare"], {
    effect: "prepare",
    description: "Prepare one exact-input collective DLMM secondary swap",
  }),
  operation("trades.submit", ["trades", "submit"], ["trades", "submit"], {
    effect: "transaction",
    description: "Submit one prepared collective DLMM secondary swap",
  }),

  operation("writers.list", ["writers", "list"], ["writers", "list"]),
  operation("writers.show", ["writers", "show"], ["writers", "show"]),
  operation("writers.deposit", ["writers", "deposit"], ["writers", "deposit"], {
    effect: "transaction",
  }),
  operation("writers.bid", ["writers", "bid"], ["writers", "bid"], {
    effect: "transaction",
  }),
  operation("writers.closePreview", ["writers", "closePreview"], ["writers", "close-preview"], {
    effect: "plan",
  }),
  operation("writers.close", ["writers", "close"], ["writers", "close"], {
    effect: "transaction",
  }),
  operation("writers.closeStatus", ["writers", "closeStatus"], ["writers", "close-status"]),
  operation("writers.claim", ["writers", "claim"], ["writers", "claim"], {
    effect: "transaction",
  }),
  operation("writers.transferFlat", ["writers", "transferFlat"], ["writers", "transfer-flat"], {
    effect: "transaction",
  }),
  operation("writers.policyAudit", ["writers", "policyAudit"], ["writers", "policy-audit"]),

  operation("liquidity.plan", ["liquidity", "plan"], ["liquidity", "plan"], {
    effect: "prepare",
  }),
  operation("liquidity.add", ["liquidity", "add"], ["liquidity", "add"], {
    effect: "transaction",
  }),
  operation("liquidity.remove", ["liquidity", "remove"], ["liquidity", "remove"], {
    effect: "transaction",
  }),
  operation(
    "liquidity.closePosition",
    ["liquidity", "closePosition"],
    ["liquidity", "close-position"],
    { effect: "transaction" },
  ),

  operation("wallet.overview", ["wallet", "overview"], ["wallet"]),
  operation("wallet.address", ["wallet", "address"], ["wallet", "address"]),
  operation("wallet.balance", ["wallet", "balance"], ["wallet", "balance"]),
  operation("wallet.collateral", ["wallet", "collateral"], ["wallet", "collateral"]),
  operation("staking.statusDefault", ["staking", "statusDefault"], ["staking"]),
  operation("staking.status", ["staking", "status"], ["staking", "status"]),
  operation("staking.stake", ["staking", "stake"], ["staking", "stake"], {
    effect: "transaction",
  }),
  operation("staking.activate", ["staking", "activate"], ["staking", "activate"], {
    effect: "transaction",
  }),
  operation("staking.cancel", ["staking", "cancel"], ["staking", "cancel"], {
    effect: "transaction",
  }),
  operation("staking.unstake", ["staking", "unstake"], ["staking", "unstake"], {
    effect: "transaction",
  }),
  operation("staking.claim", ["staking", "claim"], ["staking", "claim"], {
    effect: "transaction",
  }),
  operation("history.list", ["history", "list"], ["history"]),

  operation("settlements.show", ["settlements", "show"], ["settlements", "show"]),
  operation("settlements.check", ["settlements", "check"], ["settlements", "check"]),
  operation("settlements.oracle", ["settlements", "oracle"], ["settlements", "oracle"]),

  operation("oracle.recipeDefault", ["oracle", "recipeDefault"], ["oracle"]),
  operation("oracle.state", ["oracle", "state"], ["oracle", "state"]),
  operation("oracle.markets", ["oracle", "markets"], ["oracle", "markets"]),
  operation("oracle.latest", ["oracle", "latest"], ["oracle", "latest"]),
  operation("oracle.history", ["oracle", "history"], ["oracle", "history"]),
  operation("oracle.recipe", ["oracle", "recipe"], ["oracle", "recipe"]),
  operation("oracle.sources.list", ["oracle", "sources", "list"], ["oracle", "sources"]),
  operation(
    "oracle.sources.propose",
    ["oracle", "sources", "propose"],
    ["oracle", "sources", "propose"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.sources.support",
    ["oracle", "sources", "support"],
    ["oracle", "sources", "support"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.sources.challenge",
    ["oracle", "sources", "challenge"],
    ["oracle", "sources", "challenge"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.prints.opening",
    ["oracle", "prints", "opening"],
    ["oracle", "prints", "opening"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.prints.challenge",
    ["oracle", "prints", "challenge"],
    ["oracle", "prints", "challenge"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.updates.commit",
    ["oracle", "updates", "commit"],
    ["oracle", "updates", "commit"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.updates.reveal",
    ["oracle", "updates", "reveal"],
    ["oracle", "updates", "reveal"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.updates.expire",
    ["oracle", "updates", "expire"],
    ["oracle", "updates", "expire"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.updates.challenge",
    ["oracle", "updates", "challenge"],
    ["oracle", "updates", "challenge"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.emergency.commit",
    ["oracle", "emergency", "commit"],
    ["oracle", "emergency", "commit"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.emergency.reveal",
    ["oracle", "emergency", "reveal"],
    ["oracle", "emergency", "reveal"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.rewards.claim",
    ["oracle", "rewards", "claim"],
    ["oracle", "rewards", "claim"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.stakes.settle",
    ["oracle", "stakes", "settle"],
    ["oracle", "stakes", "settle"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.amba.deposit",
    ["oracle", "amba", "deposit"],
    ["oracle", "amba", "deposit"],
    { effect: "local-write" },
  ),
  operation(
    "oracle.amba.withdraw",
    ["oracle", "amba", "withdraw"],
    ["oracle", "amba", "withdraw"],
    { effect: "local-write" },
  ),
  operation("oracle.drafts.listDefault", ["oracle", "drafts", "listDefault"], ["oracle", "drafts"]),
  operation("oracle.drafts.list", ["oracle", "drafts", "list"], ["oracle", "drafts", "list"]),
  operation("oracle.drafts.show", ["oracle", "drafts", "show"], ["oracle", "drafts", "show"]),
  operation(
    "oracle.drafts.validate",
    ["oracle", "drafts", "validate"],
    ["oracle", "drafts", "validate"],
  ),
  operation(
    "oracle.drafts.submit",
    ["oracle", "drafts", "submit"],
    ["oracle", "drafts", "submit"],
    { effect: "transaction" },
  ),

  operation("config.show", ["config", "show"], ["config", "show"]),
  operation("config.set", ["config", "set"], ["config", "set"], {
    effect: "local-write",
  }),
  operation("config.reset", ["config", "reset"], ["config", "reset"], {
    effect: "local-write",
  }),

  operation("update.install", ["update", "install"], ["update"], {
    effect: "local-write",
  }),
  operation("update.check", ["update", "check"], ["update", "check"], {
    effect: "local-write",
  }),

  operation("mcp.status", ["mcp", "status"], ["mcp", "status"]),
  operation("mcp.enable", ["mcp", "enable"], ["mcp", "enable"], {
    effect: "local-write",
  }),
  operation("mcp.repair", ["mcp", "repair"], ["mcp", "repair"], {
    effect: "local-write",
  }),
  operation("mcp.disable", ["mcp", "disable"], ["mcp", "disable"], {
    effect: "local-write",
  }),
  operation("mcp.manifest", ["mcp", "manifest"], ["mcp", "manifest"]),

  operation("tui.snapshot", ["tui", "snapshot"], ["tui"]),
  operation("tui.open", ["tui", "open"], ["tui"], { output: "interactive" }),
  operation("demo.snapshot", ["demo", "snapshot"], ["demo"]),
  operation("demo.open", ["demo", "open"], ["demo"], { output: "interactive" }),

  operation(
    "settlementSigners.initialize",
    ["developer", "settlementSigners", "initialize"],
    ["settlement-signers", "initialize"],
    { availability: "developer-ops", effect: "prepare" },
  ),
  operation(
    "settlementSigners.rotationDigest",
    ["developer", "settlementSigners", "rotationDigest"],
    ["settlement-signers", "rotation-digest"],
    { availability: "developer-ops", effect: "plan" },
  ),
  operation(
    "settlementSigners.propose",
    ["developer", "settlementSigners", "propose"],
    ["settlement-signers", "propose"],
    { availability: "developer-ops", effect: "prepare" },
  ),
  operation(
    "settlementSigners.proposeEmergencyRecovery",
    ["developer", "settlementSigners", "proposeEmergencyRecovery"],
    ["settlement-signers", "propose-emergency-recovery"],
    { availability: "developer-ops", effect: "prepare" },
  ),
  operation(
    "settlementSigners.activate",
    ["developer", "settlementSigners", "activate"],
    ["settlement-signers", "activate"],
    { availability: "developer-ops", effect: "transaction" },
  ),
  operation(
    "settlementSigners.cancel",
    ["developer", "settlementSigners", "cancel"],
    ["settlement-signers", "cancel"],
    { availability: "developer-ops", effect: "prepare" },
  ),
  operation(
    "vault.rotateAuthorities",
    ["developer", "vault", "rotateAuthorities"],
    ["vault", "rotate-authorities"],
    { availability: "developer-ops", effect: "prepare" },
  ),
  operation(
    "oracle.recipeWeights.plan",
    ["developer", "oracle", "recipeWeights", "plan"],
    ["oracle", "recipe-weights", "plan"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.activeWeights.plan",
    ["developer", "oracle", "activeWeights", "plan"],
    ["oracle", "active-weights", "plan"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.settlementSources.plan",
    ["developer", "oracle", "settlementSources", "plan"],
    ["oracle", "settlement-sources", "plan"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.economics.configure",
    ["developer", "oracle", "economics", "configure"],
    ["oracle", "economics", "configure"],
    { availability: "developer-ops", effect: "transaction" },
  ),
  operation(
    "oracle.closeMonth",
    ["developer", "oracle", "closeMonth"],
    ["oracle", "close-month"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.sources.resolveChallenge",
    ["developer", "oracle", "sources", "resolveChallenge"],
    ["oracle", "sources", "resolve-challenge"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.prints.finalize",
    ["developer", "oracle", "prints", "finalize"],
    ["oracle", "prints", "finalize"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.prints.expire",
    ["developer", "oracle", "prints", "expire"],
    ["oracle", "prints", "expire"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.prints.finalizePhase",
    ["developer", "oracle", "prints", "finalizePhase"],
    ["oracle", "prints", "finalize-phase"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.updates.finalize",
    ["developer", "oracle", "updates", "finalize"],
    ["oracle", "updates", "finalize"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.emergency.open",
    ["developer", "oracle", "emergency", "open"],
    ["oracle", "emergency", "open"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.emergency.resolve",
    ["developer", "oracle", "emergency", "resolve"],
    ["oracle", "emergency", "resolve"],
    { availability: "developer-ops", effect: "local-write" },
  ),
  operation(
    "oracle.amba.configure",
    ["developer", "oracle", "amba", "configure"],
    ["oracle", "amba", "configure"],
    { availability: "developer-ops", effect: "local-write" },
  ),
]);

export const OPERATIONS_BY_ID = Object.freeze(
  Object.fromEntries(OPERATIONS.map((entry) => [entry.id, entry])),
) as Readonly<Record<string, PetriOperationDefinition>>;

export type PetriOperationId = (typeof OPERATIONS)[number]["id"];

export function operationById(id: string): PetriOperationDefinition | undefined {
  return OPERATIONS_BY_ID[id];
}
