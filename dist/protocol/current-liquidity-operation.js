import { derivePositionSettlementAuthorityPda } from "./writer-sleeve.js";
/** Exact, JSON-safe plans for Lean-admitted current liquidity operations. */
import { createHash } from "node:crypto";
import { ComputeBudgetProgram, PACKET_DATA_SIZE, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { validateCurrentFinalizedObservation } from "../current-finalized-observation.js";
import { AmebaProtocolError } from "../errors.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
import { semanticCurrentSpreadInstructionV1 } from "./current-governed-write-internal.js";
import { canonicalCurrentLiquidityRequest, currentLiquidityBuilderInput } from "./current-liquidity-instruction.js";
function rejected(message) {
    throw new AmebaProtocolError(message, { code: "CURRENT_LIQUIDITY_PLAN_INVALID" });
}
function uint(value, width) {
    let remaining = BigInt(value);
    const bytes = Buffer.alloc(width);
    for (let index = 0; index < width; index += 1) {
        bytes[index] = Number(remaining & 255n);
        remaining >>= 8n;
    }
    if (remaining !== 0n)
        rejected("liquidity wire integer exceeds its native field");
    return bytes;
}
function expectedData(request) {
    const rows = request.action === "add" ? request.entries.map((entry) => Buffer.concat([
        uint(entry.binId, 2), uint(entry.maximumOptionAmount, 8), uint(entry.maximumQuoteAmount, 8), uint(entry.minimumShares, 16),
    ])) : request.entries.map((entry) => Buffer.concat([
        uint(entry.binId, 2), uint(entry.shares, 16), uint(entry.minimumOptionOut, 8), uint(entry.minimumQuoteOut, 8),
    ]));
    return Buffer.concat([uint(request.action === "add" ? 209 : 210, 1), uint(request.positionNonce, 8),
        uint(rows.length, 4), ...rows,
        ...(request.action === "add" ? [] : [uint(request.action === "close_position" ? 1 : 0, 1)])]);
}
function manifest(instruction, instructionName) {
    return Object.freeze({ programId: instruction.programId.toBase58(), dataBase64: instruction.data.toString("base64"),
        decodedParams: Object.freeze({ tag: instruction.data[0], instructionName }),
        accounts: Object.freeze(instruction.keys.map((meta) => Object.freeze({ pubkey: meta.pubkey.toBase58(),
            isSigner: meta.isSigner, isWritable: meta.isWritable }))) });
}
function requireExactInstruction(input, request, observation) {
    if (input.instruction.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID)
        rejected("foreign liquidity program");
    const instruction = semanticCurrentSpreadInstructionV1(input.instruction);
    if (!instruction.data.equals(expectedData(request)))
        rejected("liquidity bytes do not match the exact request");
    const { accounts } = currentLiquidityBuilderInput({ request, market: new PublicKey(input.market),
        optionMint: new PublicKey(input.optionMint), quoteMint: new PublicKey(input.quoteMint),
        programId: new PublicKey(AMOEBA_SPREAD_PROGRAM_ID), pageIndices: input.pageIndices }).builderInput;
    const expected = [accounts.owner, accounts.pool, accounts.position, accounts.authority, accounts.optionMint,
        accounts.quoteMint, accounts.optionVault, accounts.quoteVault, accounts.ownerOptionAccount,
        accounts.ownerQuoteAccount, accounts.lightTokenProgram, accounts.lightCpiAuthority, accounts.optionInterface,
        accounts.quoteInterface, accounts.splTokenProgram, SystemProgram.programId,
        ...(request.action === "add" ? [derivePositionSettlementAuthorityPda(accounts.owner, accounts.position, new PublicKey(AMOEBA_SPREAD_PROGRAM_ID))[0]] : []),
        ...accounts.pagePairs.flatMap((pair) => [pair.reservePage, pair.sharePage])];
    const writable = new Set([0, 1, 2, 6, 7, 8, 9, 12, 13, ...expected.slice(16).map((_, index) => index + 16)]);
    if (instruction.keys.length !== expected.length || instruction.keys.some((meta, index) => !meta.pubkey.equals(expected[index]) || meta.isSigner !== (index === 0) || meta.isWritable !== writable.has(index))) {
        rejected("liquidity account identities or privileges do not match the canonical route");
    }
    const observed = new Map(observation.orderedAccounts.map((account) => [account.address, account]));
    const pageStart = request.action === "add" ? 17 : 16;
    const programOwned = new Set([1, 2, ...expected.slice(pageStart).map((_, index) => index + pageStart)]);
    for (const index of [1, 2, 4, 5, 6, 7, 8, 9, 12, 13, ...expected.slice(pageStart).map((_, offset) => offset + pageStart)]) {
        const account = observed.get(expected[index].toBase58());
        if (!account || account.owner === null || account.executable !== false || account.dataLength === null
            || account.dataSha256 === null || (programOwned.has(index) && account.owner !== AMOEBA_SPREAD_PROGRAM_ID)) {
            rejected(`liquidity state account ${index} is not bound to the finalized observation`);
        }
    }
    return accounts;
}
/** Bind exact native bytes, finalized evidence, semantic admission and unsigned transaction. */
export function prepareCurrentLiquidityOperation(input) {
    const request = canonicalCurrentLiquidityRequest(input.request);
    const observation = validateCurrentFinalizedObservation(input.currentObservation);
    if (!/^[0-9a-f]{64}$/u.test(input.leanAdmissionDigest))
        rejected("liquidity admission digest is not SHA-256");
    const accounts = requireExactInstruction(input, request, observation);
    const compute = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
    const instructions = Object.freeze([manifest(compute, "SetComputeUnitLimit"),
        manifest(input.instruction, request.action === "add" ? "AddAmoebaDlmmLiquidityV1" : "RemoveAmoebaDlmmLiquidityV1")]);
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: accounts.owner,
        recentBlockhash: input.recentBlockhash, instructions: [compute, input.instruction] }).compileToLegacyMessage());
    let serializedTransactionBase64;
    try {
        const bytes = Buffer.from(transaction.serialize());
        if (bytes.length > PACKET_DATA_SIZE)
            rejected("liquidity transaction exceeds the Solana packet bound");
        serializedTransactionBase64 = bytes.toString("base64");
    }
    catch {
        rejected("liquidity request does not fit one exact unsigned transaction; reduce the entry count");
    }
    const liquidity = Object.freeze({ marketId: request.marketId, expiryId: request.expiryId,
        ownerPubkey: request.ownerPubkey, market: new PublicKey(input.market).toBase58(),
        pool: accounts.pool.toBase58(), position: accounts.position.toBase58(),
        optionMint: accounts.optionMint.toBase58(), quoteMint: accounts.quoteMint.toBase58(),
        pageIndices: Object.freeze([...input.pageIndices]) });
    const bound = {
        schemaVersion: 1, stateNamespace: "ameba-spread-v2",
        operation: "amoeba_dlmm_liquidity", request, currentObservation: observation,
        currentObservationDigest: observation.currentObservationDigest, leanAdmissionDigest: input.leanAdmissionDigest,
        liquidity, instructions, setupInstructionBatches: [], setupTransactions: [],
        writeSet: [...new Set(instructions.flatMap((ix) => ix.accounts.filter((meta) => meta.isWritable).map((meta) => meta.pubkey)))],
        signerRoles: [{ pubkey: request.ownerPubkey, role: "liquidity_manager",
                scope: "main", setupBatchIndex: null, instructionIndexes: [1] }],
        proofFacts: { currentObservationDigest: observation.currentObservationDigest, leanAdmissionDigest: input.leanAdmissionDigest },
        transaction: { serializedTransactionBase64, recentBlockhash: input.recentBlockhash, backendPartialSignatures: [],
            approvedInstructions: instructions.map((ix) => ({ programId: ix.programId, dataBase64: ix.dataBase64,
                accounts: ix.accounts.map((meta) => ({ address: meta.pubkey, isSigner: meta.isSigner, isWritable: meta.isWritable })) })) },
    };
    const operationId = hash("ameba:current_liquidity_operation:v1\0", bound);
    const withoutDigest = { ...bound, operationId };
    return freeze({ ...withoutDigest, preparedPlanDigest: hash("ameba-spread-v2/current-prepared-plan-v1\0amoeba_dlmm_liquidity\0", withoutDigest) });
}
/** Portable validation requires independently rebuilt evidence, never the plan's self-asserted facts. */
export function validateCurrentLiquidityOperationPlan(plan, independentlyRebuilt) {
    const expected = prepareCurrentLiquidityOperation(independentlyRebuilt);
    if (canonical(plan) !== canonical(expected))
        rejected("liquidity plan differs from its independent reconstruction");
    return expected;
}
function canonical(value) {
    const order = (item) => Array.isArray(item) ? item.map(order)
        : item !== null && typeof item === "object"
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
                .map(([key, nested]) => [key, order(nested)])) : item;
    return JSON.stringify(order(value));
}
function hash(domain, value) {
    return createHash("sha256").update(domain).update(canonical(value)).digest("hex");
}
function freeze(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    }
    return value;
}
//# sourceMappingURL=current-liquidity-operation.js.map