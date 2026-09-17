/** Finalized canonical staking reads and native economic planning; no transaction execution. */
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { AmebaProtocolError } from "../errors.js";
import * as native from "@amoeba/spread-historical-v2/oracle-dlmm";
import { getAssociatedTokenAddressSync, unpackAccount, unpackMint } from "./current-token-primitives.js";
import { decodeCurrentVaultConfigAccount, CURRENT_PROTOCOL_DEVNET_GENESIS_HASH } from "./current.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { validateCurrentOracleActionRequest } from "./current-oracle-public.js";
import { buildQueueStakeAmbaForSambaInstruction, buildActivateQueuedStakeAmbaForSambaInstruction, buildRequestUnstakeSambaInstruction, buildCompleteUnstakeSambaInstruction } from "./current-builders.js";
const prerequisiteMessages = {
    PLAYER_LEDGER: "The actor's AMBA player ledger is absent; queueing stake requires an existing funded ledger.",
    STAKE_ACTIVATION: "The actor has no queued stake activation to activate.",
    UNSTAKE_REQUEST: "The actor has no unstake request to complete.",
    SAMBA_TOKEN_ACCOUNT: "The actor's sAMBA token account is absent; requesting unstake requires an existing sAMBA account.",
};
function missingPrerequisite(prerequisite, address) {
    return Object.assign(new AmebaProtocolError(prerequisiteMessages[prerequisite], {
        code: `CURRENT_ORACLE_STAKING_${prerequisite}_MISSING`,
        details: { account: address.toBase58(), prerequisite },
    }), { status: 409 });
}
function stateUnavailable(message) {
    return Object.assign(new AmebaProtocolError(message, {
        code: "CURRENT_ORACLE_STAKING_STATE_UNAVAILABLE",
    }), { status: 503 });
}
function capability() {
    const current = native;
    if (typeof current.planCurrentOracleStakingOperationV1 !== "function" || typeof current.decodeOracleMajorTokenConfig !== "function") {
        throw Object.assign(new AmebaProtocolError("The native staking planner and canonical config decoder are unavailable", {
            code: "CURRENT_ORACLE_STAKING_NATIVE_UNAVAILABLE",
        }), { status: 503 });
    }
    return current;
}
/** Each optional record is authenticated classic absence; failed reads throw. No global pause predicate. */
export async function readCurrentOracleStakingState(input) {
    const request = validateCurrentOracleActionRequest(input.request);
    const allowed = ["queue_stake_amba_for_samba", "activate_queued_stake_amba_for_samba", "request_unstake_samba", "complete_unstake_samba"];
    if (!allowed.includes(request.actionType) || input.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID)
        throw new Error("Invalid current staking request/program");
    const api = capability();
    const owner = new PublicKey(request.ownerPubkey);
    const start = await input.connection.getSlot("finalized");
    const floor = input.minimumContextSlot ?? start;
    if (!Number.isSafeInteger(floor) || floor < 0 || start < floor)
        throw new Error("Finalized staking read floor is unavailable");
    const [genesis, time] = await Promise.all([input.connection.getGenesisHash(), input.connection.getBlockTime(start)]);
    if (genesis !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH || time === null || !Number.isSafeInteger(time) || time < 0)
        throw new Error("Finalized Devnet staking clock unavailable");
    const facts = [];
    const read = async (address) => {
        const response = await input.connection.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: Math.max(start, floor) });
        if (!Number.isSafeInteger(response.context.slot) || response.context.slot < start || response.context.slot < floor)
            throw new Error("Staking account read precedes finalized floor");
        const info = response.value;
        facts.push(Object.freeze({ address: address.toBase58(), owner: info?.owner.toBase58() ?? null,
            executable: info?.executable ?? null, dataBase64: info ? Buffer.from(info.data).toString("base64") : null,
            dataSha256: info ? createHash("sha256").update(info.data).digest("hex") : null, observedSlot: response.context.slot }));
        return info;
    };
    const programData = async (address, optional = false, prerequisite) => {
        const info = await read(address);
        const absent = info === null || (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0);
        if (absent && optional)
            return null;
        if (absent && prerequisite)
            throw missingPrerequisite(prerequisite, address);
        if (!info || info.executable || !info.owner.equals(input.programId))
            throw stateUnavailable(`Canonical staking state unavailable: ${address.toBase58()}`);
        return Buffer.from(info.data);
    };
    const pda = (address, bump, seed, extra = []) => {
        const [expected, expectedBump] = PublicKey.findProgramAddressSync([native.CURRENT_STATE_NAMESPACE_SEED, Buffer.from(seed), ...extra], input.programId);
        if (!expected.equals(address) || expectedBump !== bump)
            throw new Error("Staking PDA/bump mismatch");
    };
    const vaultAddress = native.deriveVaultConfigPda(input.programId);
    const vaultInfo = await read(vaultAddress);
    if (vaultInfo === null)
        throw stateUnavailable("Canonical VaultConfig is absent");
    const vault = decodeCurrentVaultConfigAccount({ address: vaultAddress, data: vaultInfo.data, owner: vaultInfo.owner,
        executable: vaultInfo.executable, namespace: "ameba-spread-v2", programId: input.programId });
    const poolAddress = native.deriveOracleStakingPoolPda(input.programId);
    const pool = native.decodeOracleStakingPool((await programData(poolAddress)));
    pda(poolAddress, pool.bump, native.ORACLE_STAKING_POOL_PDA_SEED);
    const configAddress = native.deriveOracleMajorTokenConfigPda(input.programId);
    const sambaMint = native.deriveOracleSambaMintPda(input.programId);
    if (!pool.majorTokenConfig.equals(configAddress) || !pool.sambaMint.equals(sambaMint)
        || !pool.sambaVoteVault.equals(native.deriveOracleSambaVoteVaultPda(input.programId)))
        throw new Error("Staking pool custody identity mismatch");
    const action = request.actionType === "queue_stake_amba_for_samba" ? { kind: "queue", ambaAmount: BigInt(request.ambaAmountAtomic) }
        : request.actionType === "activate_queued_stake_amba_for_samba" ? { kind: "activate", minSambaOut: BigInt(request.minSambaOutAtomic) }
            : request.actionType === "request_unstake_samba" ? { kind: "request_unstake", sambaAmount: BigInt(request.sambaAmountAtomic), minAmbaOut: BigInt(request.minAmbaOutAtomic) }
                : { kind: "complete_unstake" };
    let ambaMint = null;
    if (action.kind !== "complete_unstake") {
        const config = api.decodeOracleMajorTokenConfig((await programData(configAddress)));
        pda(configAddress, config.bump, native.ORACLE_MAJOR_TOKEN_CONFIG_PDA_SEED);
        ambaMint = config.mint;
        if (config.vaultTokenAccount.equals(PublicKey.default) || config.mint.equals(PublicKey.default)
            || config.mint.equals(vault.usdcMint) || config.vaultTokenAccount.equals(vault.vaultTokenAccount))
            throw new Error("AMBA staking and USDC collateral custody must be distinct");
    }
    let playerLedger = null;
    let stakeActivation = null;
    let unstakeRequest = null;
    if (action.kind === "queue" || action.kind === "complete_unstake") {
        const address = native.deriveOraclePlayerLedgerPda(owner, input.programId);
        const bytes = await programData(address, action.kind === "complete_unstake", "PLAYER_LEDGER");
        if (bytes !== null) {
            playerLedger = native.decodeOraclePlayerLedgerBalance(bytes);
            pda(address, playerLedger.bump, native.ORACLE_PLAYER_LEDGER_PDA_SEED, [owner.toBuffer()]);
        }
    }
    if (action.kind === "queue" || action.kind === "activate") {
        const address = native.deriveOracleStakeActivationPda(owner, input.programId);
        const bytes = await programData(address, action.kind === "queue", "STAKE_ACTIVATION");
        if (bytes !== null) {
            stakeActivation = native.decodeOracleStakeActivation(bytes);
            pda(address, stakeActivation.bump, native.ORACLE_STAKE_ACTIVATION_PDA_SEED, [owner.toBuffer()]);
        }
    }
    if (action.kind === "request_unstake" || action.kind === "complete_unstake") {
        const address = native.deriveOracleUnstakeRequestPda(owner, input.programId);
        const bytes = await programData(address, action.kind === "request_unstake", "UNSTAKE_REQUEST");
        if (bytes !== null) {
            unstakeRequest = native.decodeOracleUnstakeRequest(bytes);
            pda(address, unstakeRequest.bump, native.ORACLE_UNSTAKE_REQUEST_PDA_SEED, [owner.toBuffer()]);
        }
    }
    const ownerSambaTokenAccount = getAssociatedTokenAddressSync(sambaMint, owner, false, native.SPL_TOKEN_PROGRAM_ID);
    let sambaMintSupply = pool.sambaSupply;
    let ownerSambaBalance = 0n;
    let rewardFunnelBalance = 0n;
    const token = async (address, mint, tokenOwner, allowAbsent = false, prerequisite) => {
        const info = await read(address);
        const absent = info === null || (!info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0);
        if (absent && allowAbsent)
            return { amount: 0n };
        if (absent && prerequisite)
            throw missingPrerequisite(prerequisite, address);
        if (!info || info.executable || !info.owner.equals(native.SPL_TOKEN_PROGRAM_ID) || info.data.length !== 165)
            throw stateUnavailable(`Canonical SPL staking account absent/invalid: ${address}`);
        const decoded = unpackAccount(address, info, native.SPL_TOKEN_PROGRAM_ID);
        if (!decoded.mint.equals(mint) || !decoded.owner.equals(tokenOwner) || !decoded.isInitialized || decoded.isFrozen
            || decoded.isNative)
            throw new Error("Staking token identity/state mismatch");
        return decoded;
    };
    if (action.kind === "activate" || action.kind === "request_unstake") {
        const info = await read(sambaMint);
        if (!info || info.executable || !info.owner.equals(native.SPL_TOKEN_PROGRAM_ID) || info.data.length !== 82)
            throw stateUnavailable("Canonical sAMBA mint unavailable");
        const mint = unpackMint(sambaMint, info, native.SPL_TOKEN_PROGRAM_ID);
        if (!mint.isInitialized || !mint.mintAuthority?.equals(vaultAddress) || mint.freezeAuthority !== null)
            throw new Error("Canonical sAMBA mint authority mismatch");
        sambaMintSupply = mint.supply;
        ownerSambaBalance = (await token(ownerSambaTokenAccount, sambaMint, owner, action.kind === "activate", "SAMBA_TOKEN_ACCOUNT")).amount;
    }
    if (action.kind === "activate") {
        const funnelAddress = native.deriveOracleRewardFunnelPda(input.programId);
        const funnel = native.decodeOracleRewardFunnel((await programData(funnelAddress)));
        pda(funnelAddress, funnel.bump, native.ORACLE_REWARD_FUNNEL_PDA_SEED);
        const expected = getAssociatedTokenAddressSync(ambaMint, funnelAddress, true, native.SPL_TOKEN_PROGRAM_ID);
        if (!funnel.majorTokenConfig.equals(configAddress) || !funnel.ambaMint.equals(ambaMint) || !funnel.funnelTokenAccount.equals(expected))
            throw new Error("Staking reward funnel identity mismatch");
        rewardFunnelBalance = (await token(expected, ambaMint, funnelAddress)).amount;
    }
    const end = await input.connection.getSlot("finalized");
    if (end < start || facts.some(fact => fact.observedSlot > end))
        throw new Error("Staking finalized read window inconsistent");
    return Object.freeze({ request, readWindowStartSlot: start, readWindowEndSlot: end, currentUnixTimestamp: String(time),
        accountFacts: Object.freeze(facts), ambaMint, ownerSambaTokenAccount,
        nativeInput: { action, owner, currentUnixTimestamp: BigInt(time), playerLedger, stakingPool: pool,
            stakeActivation, unstakeRequest, sambaMintSupply, ownerSambaBalance, rewardFunnelBalance } });
}
export async function prepareCurrentOracleStakingAction(input) {
    const state = await readCurrentOracleStakingState(input);
    const nativePlan = capability().planCurrentOracleStakingOperationV1(state.nativeInput);
    const common = { programId: input.programId, accounts: { owner: state.nativeInput.owner } };
    const action = state.nativeInput.action;
    const instruction = action.kind === "queue" ? buildQueueStakeAmbaForSambaInstruction({ ...common, params: { ambaAmount: action.ambaAmount } })
        : action.kind === "activate" ? buildActivateQueuedStakeAmbaForSambaInstruction({ ...common, params: { minSambaOut: action.minSambaOut },
            accounts: { ...common.accounts, ambaMint: state.ambaMint, ownerSambaTokenAccount: state.ownerSambaTokenAccount } })
            : action.kind === "request_unstake" ? buildRequestUnstakeSambaInstruction({ ...common, params: { sambaAmount: action.sambaAmount, minAmbaOut: action.minAmbaOut },
                accounts: { ...common.accounts, ownerSambaTokenAccount: state.ownerSambaTokenAccount } })
                : buildCompleteUnstakeSambaInstruction(common);
    return Object.freeze({ state, nativePlan, instruction });
}
//# sourceMappingURL=current-oracle-staking.js.map