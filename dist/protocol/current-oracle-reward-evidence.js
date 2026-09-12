/** Owner-specific Oracle evidence uses native finalized root/queue verification. Classic RPC absence never establishes compact nonmembership. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { CompressedStateDomain } from "@amoeba/spread-release-tools/compressed-state";
import { deriveOracleSourcePda, deriveOracleSupportPositionPda, deriveOracleOpeningClaimPda, deriveOracleMonthPda, deriveVaultConfigPda, deriveOracleUpdateClaimV2Pda, deriveOracleUsdcRewardSchedulePda, deriveOracleUsdcRewardReceiptPda } from "@amoeba/spread-release-tools/oracle-dlmm";
import { validateCurrentOracleActionRequest } from "./current-oracle-public.js";
import { CurrentOraclePlannerError, readCurrentOracleRewardEntitlementInputs, readUpdateClaimByIdentity, readClassicSourceReward } from "./current-oracle-planner.js";
import { CURRENT_PROTOCOL_DEVNET_GENESIS_HASH, decodeCurrentMarketAccount, decodeCurrentOracleMonthAccount, decodeCurrentVaultConfigAccount } from "./current.js";
import { AMOEBA_SPREAD_PROGRAM_ID } from "./identity.js";
function retainNativeEvidence(evidence, includeSnapshots) {
    if (includeSnapshots)
        return evidence;
    const { accounts: _accounts, ...request } = evidence.verificationEvidence.request;
    return Object.freeze({ ...evidence, verificationEvidence: Object.freeze({ ...evidence.verificationEvidence,
            request: Object.freeze(request), nativeAccountSnapshotsIncluded: false }) });
}
function nativeSnapshotPreference(value) {
    if (value !== undefined && typeof value !== "boolean")
        throw new Error("includeNativeAccountSnapshots must be boolean");
    return value !== false;
}
const compactFact = (evidence) => {
    if (!evidence.exists || evidence.leaf === null || evidence.compressedAccount === null)
        throw new Error("Verified membership payload missing");
    return Object.freeze({ canonicalPda: evidence.canonicalPda, domain: evidence.domain, dataBase64: evidence.leaf.dataBase64, evidence });
};
function captureReads(connection, floor, accounts) {
    // The edge supplies a frozen capability facade. An empty proxy target permits
    // interception without violating invariants of its non-configurable methods.
    return new Proxy({}, { get(_target, key) {
            const target = connection;
            if (key === "getAccountInfo")
                return async (address) => {
                    const response = await target.getAccountInfoAndContext(address, { commitment: "finalized", minContextSlot: floor });
                    if (!Number.isSafeInteger(response.context.slot) || response.context.slot < floor)
                        throw new Error("Reward account precedes finalized read floor");
                    const info = response.value;
                    const fact = Object.freeze({ address: address.toBase58(), owner: info?.owner.toBase58() ?? null, executable: info?.executable ?? null,
                        dataBase64: info ? Buffer.from(info.data).toString("base64") : null,
                        dataSha256: info ? createHash("sha256").update(info.data).digest("hex") : null, observedSlot: response.context.slot });
                    const previous = accounts.find(value => value.address === fact.address);
                    if (previous && (previous.dataSha256 !== fact.dataSha256 || previous.owner !== fact.owner || previous.executable !== fact.executable))
                        throw new Error("Reward account changed within read window");
                    if (!previous)
                        accounts.push(fact);
                    return info;
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
}
/** Fetches entitlement inputs and a real receipt membership/nonmembership proof for one exact owner/subject. */
export async function readCurrentOracleOwnerRewardEvidence(input) {
    const includeSnapshots = nativeSnapshotPreference(input.includeNativeAccountSnapshots);
    const request = validateCurrentOracleActionRequest(input.request);
    if (request.actionType !== "claim_oracle_usdc_reward" || input.commitment !== "finalized"
        || input.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID)
        throw new Error("Exact current finalized reward request required");
    const start = await input.connection.getSlot("finalized");
    const floor = input.minimumContextSlot ?? start;
    if (!Number.isSafeInteger(floor) || floor < 0 || start < floor
        || await input.connection.getGenesisHash() !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH)
        throw new Error("Finalized Devnet reward read floor unavailable");
    const classicAccounts = [];
    const verified = new Map();
    const evidenceRows = [];
    const observe = (canonicalPda, domain) => {
        const key = `${canonicalPda.toBase58()}:${domain}`;
        let pending = verified.get(key);
        if (pending === undefined) {
            const photon = input.photonConnection;
            if (!photon || typeof photon.observeCurrentVerifiedCompressedStateEvidence !== "function")
                throw new Error("Finalized native compressed verification capability unavailable");
            pending = photon.observeCurrentVerifiedCompressedStateEvidence({ canonicalPda, domain, minimumContextSlot: Math.max(start, floor) }).then(evidence => {
                if (evidence.canonicalPda !== canonicalPda.toBase58() || evidence.domain !== domain)
                    throw new Error("Verified compact business identity mismatch");
                const retained = retainNativeEvidence(evidence, includeSnapshots);
                evidenceRows.push(retained);
                return retained;
            });
            verified.set(key, pending);
        }
        return pending;
    };
    const context = { ...input, connection: captureReads(input.connection, Math.max(start, floor), classicAccounts),
        compressedEvidenceReader: async ({ canonicalPda, domain }) => {
            const evidence = await observe(canonicalPda, domain);
            if (!evidence.exists)
                return null;
            if (!evidence.leaf)
                throw new Error("Verified compact leaf unavailable");
            return { canonicalPda, compressedAddress: new PublicKey(evidence.compressedAddress),
                leaf: { schemaVersion: evidence.leaf.schemaVersion, domain, canonicalPda, revision: BigInt(evidence.leaf.revision), data: Buffer.from(evidence.leaf.dataBase64, "base64") },
                witness: { witnessDigest: evidence.verificationEvidence.result.requestSha256 } };
        } };
    const owner = new PublicKey(request.ownerPubkey);
    const sourceId = Buffer.from(request.sourceId, "hex");
    const source = deriveOracleSourcePda({ oracleMonthPda: input.oracleMonthAddress, sourceId, programId: input.programId });
    const schedule = deriveOracleUsdcRewardSchedulePda({ oracleMonthPda: input.oracleMonthAddress, programId: input.programId });
    const subject = request.rewardKind === "support" ? deriveOracleSupportPositionPda({ oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source, supporter: owner, programId: input.programId })
        : request.rewardKind === "opening" ? deriveOracleOpeningClaimPda({ oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source, programId: input.programId })
            : request.rewardKind === "update" ? deriveOracleUpdateClaimV2Pda({ oracleMonthPda: input.oracleMonthAddress, oracleSourcePda: source, claimant: owner, claimId: Buffer.from(request.claimId, "hex"), programId: input.programId }) : source;
    const receiptAddress = deriveOracleUsdcRewardReceiptPda({ rewardSchedulePda: schedule, rewardKind: request.rewardKind, subjectPda: subject, recipient: owner, programId: input.programId });
    let receipt = null;
    let status = "unavailable";
    let amount = null;
    let errorCode;
    let proofFacts = {};
    try {
        const accountInput = async (address) => {
            const info = await context.connection.getAccountInfo(address, "finalized");
            if (info === null)
                throw new Error(`Reward anchor absent: ${address}`);
            return { address, data: info.data, owner: info.owner, executable: info.executable,
                namespace: "ameba-spread-v2", programId: input.programId };
        };
        context.market = decodeCurrentMarketAccount(await accountInput(input.marketAddress));
        if (context.market.seriesIdentity.product !== request.marketId || context.market.seriesIdentity.fullSeriesId !== request.expiryId
            || !deriveOracleMonthPda({ marketPda: input.marketAddress, expiryTs: context.market.expiryTs, programId: input.programId }).equals(input.oracleMonthAddress)
            || !deriveVaultConfigPda(input.programId).equals(input.vaultConfigAddress))
            throw new Error("Reward request anchor identity mismatch");
        context.oracleMonth = decodeCurrentOracleMonthAccount({ ...await accountInput(input.oracleMonthAddress), expiryTs: context.market.expiryTs });
        context.vaultConfig = decodeCurrentVaultConfigAccount(await accountInput(input.vaultConfigAddress));
        const evidence = await observe(receiptAddress, CompressedStateDomain.OracleUsdcRewardReceipt);
        if (evidence.exists) {
            const bytes = Buffer.from(compactFact(evidence).dataBase64, "base64");
            const kind = ["proposer", "support", "opening", "update"].indexOf(request.rewardKind);
            if (bytes.length !== 81 || bytes[0] !== kind || !new PublicKey(bytes.subarray(1, 33)).equals(subject)
                || !new PublicKey(bytes.subarray(33, 65)).equals(owner) || bytes.readBigUInt64LE(65) === 0n)
                throw new Error("Compact reward receipt identity/layout mismatch");
            amount = bytes.readBigUInt64LE(65).toString();
            receipt = Object.freeze({ address: receiptAddress.toBase58(), subject: subject.toBase58(), kind: request.rewardKind, exists: true,
                amountAtomic: amount, claimedSlot: bytes.readBigUInt64LE(73).toString(), membership: compactFact(evidence), nonmembership: null });
            status = "already_claimed";
        }
        else {
            receipt = Object.freeze({ address: receiptAddress.toBase58(), subject: subject.toBase58(), kind: request.rewardKind, exists: false,
                amountAtomic: null, claimedSlot: null, membership: null, nonmembership: evidence });
            if (request.rewardKind === "support") {
                const support = await observe(subject, CompressedStateDomain.OracleSupportPosition);
                if (!support.exists) {
                    proofFacts = { supportNonmembershipRequestSha256: support.verificationEvidence.result.requestSha256 };
                    status = "ineligible";
                }
            }
            if (status !== "ineligible") {
                const resolved = await readCurrentOracleRewardEntitlementInputs({ ...context, request });
                amount = resolved.entitlementAmount.toString();
                proofFacts = { ...resolved.actionFacts, schedule: schedule.toBase58(), subject: subject.toBase58() };
                status = "claimable";
            }
        }
    }
    catch (error) {
        errorCode = error instanceof CurrentOraclePlannerError ? error.code : "CURRENT_ORACLE_EVIDENCE_UNAVAILABLE";
        status = errorCode === "CURRENT_ORACLE_REWARD_NOT_ENTITLED" ? "ineligible" : "unavailable";
        amount = null;
    }
    const end = await input.connection.getSlot("finalized");
    if (end < start || classicAccounts.some(value => value.observedSlot > end)
        || evidenceRows.some(value => BigInt(value.verificationEvidence.result.finalizedSlot) < BigInt(floor)
            || BigInt(value.verificationEvidence.result.finalizedSlot) > BigInt(end))) {
        status = "unavailable";
        errorCode = "CURRENT_ORACLE_EVIDENCE_SLOT_MISMATCH";
        amount = null;
    }
    return Object.freeze({ evidenceTrust: "finalized_native_light_verifier", finalizedStateVerified: status !== "unavailable" && receipt !== null,
        request, status, entitlementAmountAtomic: amount, readWindowStartSlot: start, readWindowEndSlot: end,
        classicAccounts: Object.freeze(classicAccounts), compressedAccounts: Object.freeze(evidenceRows.filter(value => value.exists).map(compactFact)),
        nonmembershipAccounts: Object.freeze(evidenceRows.filter(value => !value.exists)),
        receipt, proofFacts, ...(errorCode === undefined ? {} : { errorCode }) });
}
/** Adds retained merge origins and owner update-claim identities to the caller's authenticated source inventory. */
export async function readCurrentOracleOwnerRewardInventory(input) {
    const includeNativeAccountSnapshots = nativeSnapshotPreference(input.includeNativeAccountSnapshots);
    if (input.commitment !== "finalized" || input.sourceIds.length > 256)
        throw new Error("Bounded finalized source inventory required");
    const cursor = input.cursor ?? 0;
    const limit = input.limit ?? 16;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw new Error("Reward inventory cursor/limit invalid");
    const owner = new PublicKey(input.ownerPubkey);
    const start = await input.connection.getSlot("finalized");
    const floor = input.minimumContextSlot ?? start;
    if (!Number.isSafeInteger(floor) || floor < 0 || start < floor)
        throw new Error("Invalid reward inventory read floor");
    const sources = new Set(input.sourceIds.map(sourceId => {
        if (!/^[0-9a-f]{64}$/.test(sourceId) || /^0+$/.test(sourceId))
            throw new Error("Invalid source inventory identity");
        return sourceId;
    }));
    const classicAccounts = [];
    const context = { ...input, connection: captureReads(input.connection, Math.max(start, floor), classicAccounts) };
    const [updates, retained] = await Promise.all([
        input.connection.getProgramAccounts(input.programId, { commitment: "finalized", minContextSlot: Math.max(start, floor), withContext: true,
            filters: [{ dataSize: 384 }, { memcmp: { offset: 2, bytes: input.oracleMonthAddress.toBase58() } }, { memcmp: { offset: 130, bytes: owner.toBase58() } }] }),
        input.connection.getProgramAccounts(input.programId, { commitment: "finalized", minContextSlot: Math.max(start, floor), withContext: true,
            filters: [{ dataSize: 288 }, { memcmp: { offset: 6, bytes: input.oracleMonthAddress.toBase58() } }] }),
    ]);
    if (updates.value.length > 4096 || retained.value.length > 4096 || updates.context.slot < floor || retained.context.slot < floor)
        throw new Error("Reward inventory bound or finalized slot invalid");
    const discovered = new Map([...updates.value.map(row => ({ ...row, slot: updates.context.slot })),
        ...retained.value.map(row => ({ ...row, slot: retained.context.slot }))].map(row => [row.pubkey.toBase58(), row]));
    const discoveryContext = { ...context, connection: new Proxy({}, { get(_target, key) {
                const target = context.connection;
                if (key === "getAccountInfo")
                    return async (address) => {
                        const row = discovered.get(address.toBase58());
                        if (!row)
                            return target.getAccountInfo(address, "finalized");
                        if (!classicAccounts.some(fact => fact.address === address.toBase58()))
                            classicAccounts.push(Object.freeze({ address: address.toBase58(),
                                owner: row.account.owner.toBase58(), executable: row.account.executable, dataBase64: Buffer.from(row.account.data).toString("base64"),
                                dataSha256: createHash("sha256").update(row.account.data).digest("hex"), observedSlot: row.slot }));
                        return row.account;
                    };
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } }) };
    const updateCandidates = [];
    for (const row of updates.value) {
        const bytes = Buffer.from(row.account.data);
        const sourceId = bytes.subarray(98, 130);
        const claimId = bytes.subarray(34, 66);
        const source = deriveOracleSourcePda({ oracleMonthPda: input.oracleMonthAddress, sourceId, programId: input.programId });
        const decoded = await readUpdateClaimByIdentity(discoveryContext, source, sourceId, owner, claimId);
        if (!decoded.address.equals(row.pubkey))
            throw new Error("Update inventory PDA mismatch");
        if (decoded.status === "Finalized")
            updateCandidates.push({ actionType: "claim_oracle_usdc_reward", marketId: input.marketId,
                expiryId: input.expiryId, ownerPubkey: owner.toBase58(), rewardKind: "update", sourceId: sourceId.toString("hex"), claimId: claimId.toString("hex") });
    }
    for (const row of retained.value) {
        const source = new PublicKey(row.account.data.subarray(102, 134));
        const decoded = await readClassicSourceReward(discoveryContext, source);
        if (!decoded.address.equals(row.pubkey))
            throw new Error("Retained merge inventory PDA mismatch");
        sources.add(decoded.sourceId.toString("hex"));
    }
    if (sources.size > 4096)
        throw new Error("Expanded reward source inventory exceeds bound");
    const candidates = [...sources].sort().flatMap(sourceId => ["proposer", "support", "opening"].map(rewardKind => ({
        actionType: "claim_oracle_usdc_reward", marketId: input.marketId, expiryId: input.expiryId,
        ownerPubkey: owner.toBase58(), rewardKind, sourceId,
    })));
    candidates.push(...updateCandidates);
    const key = (request) => `${request.rewardKind}:${request.sourceId}:${request.rewardKind === "update" ? request.claimId : ""}`;
    const ordered = [...new Map(candidates.map(request => [key(request), request])).values()].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
    if (cursor > ordered.length)
        throw new Error("Reward inventory cursor exceeds candidate count");
    const page = ordered.slice(cursor, cursor + limit);
    const evidence = [];
    for (let index = 0; index < page.length; index += 4)
        evidence.push(...await Promise.all(page.slice(index, index + 4).map(request => readCurrentOracleOwnerRewardEvidence({ ...input, request, minimumContextSlot: floor, includeNativeAccountSnapshots }))));
    return Object.freeze({ ownerPubkey: owner.toBase58(), candidateCount: ordered.length, cursor, limit,
        nextCursor: cursor + page.length < ordered.length ? cursor + page.length : null,
        candidates: Object.freeze(page), evidence: Object.freeze(evidence),
        classicAccounts: Object.freeze(classicAccounts), coverage: Object.freeze({ sourceInventory: "caller_supplied",
            suppliedSourceIds: Object.freeze([...input.sourceIds]), expandedSourceIds: Object.freeze([...sources].sort()),
            updateQuery: { programId: input.programId.toBase58(), dataSize: 384, monthOffset: 2, ownerOffset: 130,
                contextSlot: updates.context.slot, addresses: updates.value.map(row => row.pubkey.toBase58()) },
            retainedMergeQuery: { programId: input.programId.toBase58(), dataSize: 288, monthOffset: 6,
                contextSlot: retained.context.slot, addresses: retained.value.map(row => row.pubkey.toBase58()) },
            globalInventoryComplete: false }) });
}
/** Server facade: derives canonical anchors from the exact requested market before owner discovery. */
export async function readCurrentOracleOwnerBountyInventory(input) {
    const includeNativeAccountSnapshots = nativeSnapshotPreference(input.includeNativeAccountSnapshots);
    if (input.namespace !== "ameba-spread-v2" || input.programId.toBase58() !== AMOEBA_SPREAD_PROGRAM_ID)
        throw new Error("Current bounty namespace/program required");
    const start = await input.connection.getSlot("finalized");
    const floor = input.minimumContextSlot ?? start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(floor) || floor < 0 || start < floor)
        throw new Error("Current bounty finalized floor invalid");
    const anchors = [];
    const connection = captureReads(input.connection, Math.max(start, floor), anchors);
    const { readCurrentMarketAccount } = await import("./current-adapter.js");
    const marketRead = await readCurrentMarketAccount({ connection, programId: input.programId, namespace: input.namespace,
        marketId: input.marketId, expiryId: input.expiryId, commitment: "finalized" });
    if (!marketRead.found || marketRead.market === null)
        throw new Error("Exact current bounty market is absent");
    const market = marketRead.market;
    const marketAddress = marketRead.address;
    const oracleMonthAddress = deriveOracleMonthPda({ marketPda: marketAddress, expiryTs: market.expiryTs, programId: input.programId });
    const vaultConfigAddress = deriveVaultConfigPda(input.programId);
    const account = async (address) => {
        const info = await connection.getAccountInfo(address, "finalized");
        if (!info)
            throw new Error("Current bounty anchor is absent");
        return { address, owner: info.owner, executable: info.executable, data: info.data, namespace: input.namespace, programId: input.programId };
    };
    const oracleMonth = decodeCurrentOracleMonthAccount({ ...await account(oracleMonthAddress), expiryTs: market.expiryTs });
    const vaultConfig = decodeCurrentVaultConfigAccount(await account(vaultConfigAddress));
    const inventory = await readCurrentOracleOwnerRewardInventory({ ...input, connection: input.connection, commitment: "finalized",
        marketAddress, market, oracleMonthAddress, oracleMonth, vaultConfigAddress, vaultConfig, minimumContextSlot: Math.max(start, floor), includeNativeAccountSnapshots });
    return Object.freeze({ ...inventory, marketAddress: marketAddress.toBase58(), oracleMonthAddress: oracleMonthAddress.toBase58(),
        anchorAccounts: Object.freeze(anchors) });
}
//# sourceMappingURL=current-oracle-reward-evidence.js.map