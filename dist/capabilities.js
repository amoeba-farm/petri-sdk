function defineCapability(id, descriptor) {
    return Object.freeze({ id, ...descriptor });
}
/**
 * Stable functional capability inventory. Wallet signing, local
 * configuration, and terminal presentation remain available through the
 * explicit Petri adapter. Chain reads and transaction relay are exposed only
 * through Amoeba's read gateway and prepare-bound product routes.
 */
export const CAPABILITIES = Object.freeze({
    "chain.identity": defineCapability("chain.identity", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "chain.identity",
    }),
    "markets.read": defineCapability("markets.read", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "markets.list",
    }),
    "markets.chart": defineCapability("markets.chart", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "markets.chart",
    }),
    "writers.read": defineCapability("writers.read", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "writers.list",
    }),
    "writers.prepare": defineCapability("writers.prepare", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "prepare",
        method: "writers.closePreview",
        reason: "Edge preparation binds finalized observations, Lean admission, and native SDK manifests.",
    }),
    "writers.liquidity.read": defineCapability("writers.liquidity.read", {
        surface: "api", native: true, petriAdapter: false, effect: "read", method: "writerOperations.liquidity",
        reason: "Finalized writer lane view separates sleeve cash, pool quote, issuer inventory, policy and budgets.",
    }),
    "writers.liquidity.initialize.prepare": defineCapability("writers.liquidity.initialize.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquidityInitialize",
        reason: "Exact native writer lane preparation binds manager authority, canonical pooled custody and admission.",
    }),
    "writers.liquidity.add.prepare": defineCapability("writers.liquidity.add.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquidityAdd",
        reason: "Exact native writer lane preparation binds manager authority, canonical pooled custody and admission.",
    }),
    "writers.liquidity.remove.prepare": defineCapability("writers.liquidity.remove.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquidityRemove",
        reason: "Exact native writer lane preparation binds manager authority, canonical pooled custody and admission.",
    }),
    "writers.liquidity.sweep.prepare": defineCapability("writers.liquidity.sweep.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquiditySweep",
        reason: "Exact native writer lane preparation binds manager authority, canonical pooled custody and admission.",
    }),
    "writers.liquidity.policy.begin.prepare": defineCapability("writers.liquidity.policy.begin.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquidityPolicyBegin",
        reason: "Operator API binds immutable writer liquidity policy and native signing authority.",
    }),
    "writers.liquidity.policy.append.prepare": defineCapability("writers.liquidity.policy.append.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquidityPolicyAppend",
        reason: "Operator API binds immutable writer liquidity policy and native signing authority.",
    }),
    "writers.liquidity.policy.seal.prepare": defineCapability("writers.liquidity.policy.seal.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareLiquidityPolicySeal",
        reason: "Operator API binds immutable writer liquidity policy and native signing authority.",
    }),
    "writers.refunds.read": defineCapability("writers.refunds.read", {
        surface: "api", native: true, petriAdapter: false, effect: "read", method: "writerOperations.refunds",
        reason: "Historical owner bid discovery retains unavailable candidates and finalized refund evidence.",
    }),
    "writers.refunds.prepare": defineCapability("writers.refunds.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareRefund",
        reason: "Exact actor, auction and bid semantics bind the immutable refund destination.",
    }),
    "writers.withdrawals.prepare": defineCapability("writers.withdrawals.prepare", {
        surface: "api", native: true, petriAdapter: false, effect: "prepare", method: "writerOperations.prepareWithdrawal",
        reason: "Unencumbered Funding principal withdrawal burns the owner's exact Flat amount.",
    }),
    "writers.transactions": defineCapability("writers.transactions", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "transaction",
        method: "writerOperations.submit",
        reason: "The SDK relays only locally signed batches bound to an admitted writer-operation plan.",
    }),
    "trades.transactions": defineCapability("trades.transactions", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "transaction",
        method: "trades.submit",
        reason: "The SDK relays only locally signed batches bound to an admitted collective-swap plan.",
    }),
    "wallet.rpc": defineCapability("wallet.rpc", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "amoebaReadGatewayUrl",
        reason: "Wallet re-observation accepts only Amoeba's exact /rpc read gateway.",
    }),
    "staking.read": defineCapability("staking.read", {
        surface: "petri",
        native: false,
        petriAdapter: true,
        effect: "read",
        method: "petri.staking.status",
    }),
    "staking.transactions": defineCapability("staking.transactions", {
        surface: "petri",
        native: false,
        petriAdapter: true,
        effect: "transaction",
        method: "petri.staking.stake",
    }),
    "history.backend": defineCapability("history.backend", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "history.ledger",
    }),
    "oracle.read": defineCapability("oracle.read", {
        surface: "api",
        native: true,
        petriAdapter: true,
        effect: "read",
        method: "oracle.state",
    }),
    "oracle.prepare": defineCapability("oracle.prepare", {
        surface: "api",
        native: false,
        petriAdapter: false,
        effect: "prepare",
        method: "oracle.prepareDraft",
        reason: "Only explicitly typed current Oracle draft actions are exposed; unconfigured actions fail closed.",
    }),
    "oracle.localDrafts": defineCapability("oracle.localDrafts", {
        surface: "petri",
        native: false,
        petriAdapter: true,
        effect: "local-write",
        method: "petri.oracle.drafts.list",
    }),
    "protocol.instructions": defineCapability("protocol.instructions", {
        surface: "protocol",
        native: true,
        petriAdapter: true,
        effect: "plan",
        method: "ameba-sdk/protocol",
    }),
    "local.config": defineCapability("local.config", {
        surface: "petri",
        native: false,
        petriAdapter: true,
        effect: "local-write",
        method: "petri.config.show",
    }),
    "local.mcp": defineCapability("local.mcp", {
        surface: "petri",
        native: false,
        petriAdapter: true,
        effect: "local-write",
        method: "petri.mcp.status",
    }),
    "terminal.tui": defineCapability("terminal.tui", {
        surface: "presentation",
        native: false,
        petriAdapter: true,
        effect: "read",
        method: "petri.tui.open",
    }),
});
function defineTuiCapability(descriptor) {
    return Object.freeze(descriptor);
}
/**
 * Functional and presentation mapping for the interactive Lab Bench. The
 * source-enum names are intentionally machine-checked against ameba_cli.
 */
export const TUI_CAPABILITIES = Object.freeze([
    defineTuiCapability({
        id: "home",
        mode: "presentation",
        sdkMethods: ["petri.tui.open"],
        sourceEnums: {
            HomeAction: ["Trade", "Chart", "Oracle", "Ledger", "Staking", "Help", "ConnectAgents"],
        },
    }),
    defineTuiCapability({
        id: "collective-writers",
        mode: "petri",
        sdkMethods: [
            "petri.writers.list",
            "petri.writers.closePreview",
            "petri.writers.deposit",
        ],
        sourceEnums: {},
    }),
    defineTuiCapability({
        id: "staking",
        mode: "petri",
        sdkMethods: [
            "petri.staking.status",
            "petri.staking.stake",
            "petri.staking.activate",
            "petri.staking.cancel",
            "petri.staking.unstake",
            "petri.staking.claim",
        ],
        sourceEnums: {
            StakingAction: ["Stake", "Activate", "CancelQueue", "Unstake", "Claim", "Refresh"],
        },
    }),
    defineTuiCapability({
        id: "guide",
        mode: "presentation",
        sdkMethods: ["petri.tui.open"],
        sourceEnums: {
            GuideCommand: [
                "ExplainCurrentScreen",
                "OpenTarget",
                "StageTrade",
                "StageOracleForm",
                "StageActionForm",
                "FillActiveForm",
                "FocusControl",
                "SearchOracle",
                "OpenMarketContracts",
                "OpenContract",
                "GoToBucket",
                "HighlightSource",
                "CompareSources",
                "OpenSourceDetail",
                "OpenChallengeView",
                "ShowPhaseTimeline",
                "ShowNextAction",
            ],
        },
    }),
]);
export function capability(id) {
    return CAPABILITIES[id];
}
//# sourceMappingURL=capabilities.js.map