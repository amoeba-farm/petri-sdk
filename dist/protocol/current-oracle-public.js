/** Current semantic source hashing is NFC + trim + control rejection + bounded UTF-8. */
export const CURRENT_ORACLE_SOURCE_TYPE_HASH_DOMAIN = "ameba-oracle-source-type-v1";
export const CURRENT_ORACLE_SOURCE_DEFINITION_HASH_DOMAIN = "ameba-oracle-source-definition-v1";
export const CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES = 128;
export const CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES = 4_096;
/** Reviewed known-answer vectors for the current semantic source hashing grammar. */
export const CURRENT_ORACLE_SEMANTIC_HASH_VECTORS = Object.freeze({
    sourceType: Object.freeze({
        input: " retail-index ",
        normalized: "retail-index",
        sha256Hex: "1dd8023882a982d42fcebfabe7f2b1aaeb16f866565193dc41435d603ebc5c1e",
    }),
    sourceDefinition: Object.freeze({
        input: " Cafe\u0301 weighted basket ",
        normalized: "Caf\u00e9 weighted basket",
        sha256Hex: "77a4930c70595499a95d14b056c034cb67e74d57a163d370fff90b19307a6881",
    }),
});
export const CURRENT_ORACLE_LOCATOR_MAX_BYTES = 2_048;
export const CURRENT_ORACLE_ACTION_TYPES = Object.freeze([
    "queue_stake_amba_for_samba", "activate_queued_stake_amba_for_samba", "request_unstake_samba", "complete_unstake_samba",
    "initialize_oracle_month_v5",
    "propose_oracle_source_v3",
    "support_oracle_source_v3",
    "challenge_oracle_source_v2",
    "submit_oracle_opening_claim_v2",
    "challenge_oracle_opening_claim_v2",
    "finalize_oracle_opening_claim_v2",
    "commit_oracle_update_claim_v3",
    "reveal_oracle_update_claim_v3",
    "challenge_oracle_update_claim_v2",
    "finalize_oracle_update_claim_v2",
    "commit_oracle_emergency_vote_v3",
    "reveal_oracle_emergency_vote_v2",
    "deposit_oracle_usdc_rewards",
    "claim_oracle_usdc_reward",
]);
const CURRENT_ORACLE_U64_MAX = (1n << 64n) - 1n;
const CURRENT_ORACLE_COMMON_KEYS = ["marketId", "expiryId", "ownerPubkey", "actionType"];
const CURRENT_ORACLE_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CURRENT_ORACLE_WAYBACK_PREFIX = "https://web.archive.org/web/";
function oracleRecord(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${label} must be a plain object.`);
    }
    return value;
}
function oracleExactKeys(value, label, required, optional = []) {
    const allowed = new Set([...required, ...optional]);
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key)).sort();
    if (unexpected.length > 0)
        throw new Error(`${label} exact-key mismatch: extra=[${unexpected.join(",")}].`);
    const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
    if (missing !== undefined)
        throw new Error(`${label} is missing required field '${missing}'.`);
}
function oracleString(value, key) {
    if (typeof value[key] !== "string")
        throw new Error(`${key} must be a string.`);
    return value[key];
}
function oracleProduct(value) {
    if (value !== "ramx" && value !== "nandx") {
        throw new Error("marketId must be exactly 'ramx' or 'nandx'.");
    }
    return value;
}
function oracleSeries(value, product) {
    if (typeof value !== "string" || !/^(RAMX|NANDX)-[0-9]{4}(0[1-9]|1[0-2])-(CALL|PUT)-01$/.test(value)) {
        throw new Error("expiryId must be the full current PRODUCT-YYYYMM-CALL|PUT-01 series label.");
    }
    if (value.slice(0, value.indexOf("-")).toLowerCase() !== product) {
        throw new Error("expiryId product must exactly match marketId.");
    }
    return value;
}
function oracleDecodedBase58Length(value) {
    let numeric = 0n;
    for (const character of value) {
        const digit = CURRENT_ORACLE_BASE58_ALPHABET.indexOf(character);
        if (digit < 0)
            return -1;
        numeric = numeric * 58n + BigInt(digit);
    }
    let bodyBytes = 0;
    while (numeric > 0n) {
        numeric >>= 8n;
        bodyBytes += 1;
    }
    let leadingZeroBytes = 0;
    while (leadingZeroBytes < value.length && value[leadingZeroBytes] === "1")
        leadingZeroBytes += 1;
    return leadingZeroBytes + bodyBytes;
}
function oraclePubkey(value, label) {
    if (typeof value !== "string"
        || value.length < 32
        || value.length > 44
        || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)
        || oracleDecodedBase58Length(value) !== 32
        || value === "11111111111111111111111111111111") {
        throw new Error(`${label} must be a canonical nonzero base58 public key.`);
    }
    return value;
}
function oracleU64(value, label, positive = false) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new Error(`${label} must be a canonical unsigned decimal string.`);
    }
    const parsed = BigInt(value);
    if (parsed > CURRENT_ORACLE_U64_MAX || (positive && parsed === 0n)) {
        throw new Error(`${label} must ${positive ? "be positive and " : ""}fit in u64.`);
    }
    return value;
}
function oracleU8(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`${label} must be an integer from 0 through 255.`);
    }
    return value;
}
function oracleLabel(value, label) {
    if (typeof value !== "string")
        throw new Error(`${label} must be a canonical current bytes32 label.`);
    const bytes = new TextEncoder().encode(value);
    if (bytes.length === 0
        || bytes.length > 32
        || value.trim() !== value
        || [...bytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
        throw new Error(`${label} must be 1 through 32 printable ASCII bytes with no surrounding whitespace.`);
    }
    return value;
}
function oracleHex32(value, label, nonzero = false) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error(`${label} must be lowercase bytes32 hex (exactly 32 bytes of lowercase hexadecimal).`);
    }
    if (nonzero && /^0{64}$/.test(value))
        throw new Error(`${label} must be nonzero lowercase bytes32 hex.`);
    return value;
}
export function normalizeCurrentOracleSemanticText(value, label, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
        throw new Error("maxBytes must be a positive bounded safe integer.");
    }
    if (typeof value !== "string")
        throw new Error(`${label} must be a string.`);
    const normalized = value.normalize("NFC").trim();
    const bytes = new TextEncoder().encode(normalized);
    if (normalized.length === 0)
        throw new Error(`${label} must be nonempty after canonical normalization.`);
    if (bytes.length > maxBytes)
        throw new Error(`${label} must contain at most ${maxBytes} UTF-8 bytes.`);
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
        throw new Error(`${label} must be valid NFC Unicode without control characters.`);
    }
    return normalized;
}
function oracleArchiveUrl(value, sourceTime) {
    const normalized = normalizeCurrentOracleSemanticText(value, "archiveUrl", 384);
    if (!normalized.startsWith(CURRENT_ORACLE_WAYBACK_PREFIX) || /[\x00-\x20\x7f]/.test(normalized)) {
        throw new Error(`archiveUrl must start with '${CURRENT_ORACLE_WAYBACK_PREFIX}' and contain no whitespace.`);
    }
    const match = /^(\d{14})\/(https?:\/\/[^\s]+)$/.exec(normalized.slice(CURRENT_ORACLE_WAYBACK_PREFIX.length));
    if (match === null)
        throw new Error("archiveUrl must contain an exact 14-digit capture timestamp and archived target.");
    const capture = match[1];
    const year = Number(capture.slice(0, 4));
    const month = Number(capture.slice(4, 6));
    const day = Number(capture.slice(6, 8));
    const hour = Number(capture.slice(8, 10));
    const minute = Number(capture.slice(10, 12));
    const second = Number(capture.slice(12, 14));
    const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
    const rendered = new Date(milliseconds);
    if (!Number.isFinite(milliseconds)
        || rendered.getUTCFullYear() !== year
        || rendered.getUTCMonth() !== month - 1
        || rendered.getUTCDate() !== day
        || rendered.getUTCHours() !== hour
        || rendered.getUTCMinutes() !== minute
        || rendered.getUTCSeconds() !== second
        || BigInt(Math.trunc(milliseconds / 1_000)) !== BigInt(sourceTime)) {
        throw new Error("archiveUrl capture timestamp must exactly equal sourceTime and be valid.");
    }
    try {
        const archivedTarget = new URL(match[2]);
        if ((archivedTarget.protocol !== "http:" && archivedTarget.protocol !== "https:") || archivedTarget.host.length === 0) {
            throw new Error();
        }
    }
    catch {
        throw new Error("archiveUrl archived target must be an absolute http(s) URL with a host.");
    }
    return normalized;
}
function oracleCommon(value) {
    const marketId = oracleProduct(value.marketId);
    return {
        marketId,
        expiryId: oracleSeries(value.expiryId, marketId),
        ownerPubkey: oraclePubkey(value.ownerPubkey, "ownerPubkey"),
    };
}
function oracleActionKeys(required, optional = []) {
    return { required: [...CURRENT_ORACLE_COMMON_KEYS, ...required], optional };
}
/** Browser-safe exact normalizer for the 15 current public Oracle actions. */
export function validateCurrentOracleActionRequest(request) {
    const value = oracleRecord(request, "current Oracle action request");
    const actionType = oracleString(value, "actionType");
    const common = oracleCommon(value);
    const keys = (required, optional = []) => {
        const shape = oracleActionKeys(required, optional);
        oracleExactKeys(value, actionType, shape.required, shape.optional);
    };
    switch (actionType) {
        case "queue_stake_amba_for_samba":
            keys(["ambaAmountAtomic"]);
            return Object.freeze({ ...common, actionType, ambaAmountAtomic: oracleU64(value.ambaAmountAtomic, "ambaAmountAtomic", true) });
        case "activate_queued_stake_amba_for_samba":
            keys(["minSambaOutAtomic"]);
            return Object.freeze({ ...common, actionType, minSambaOutAtomic: oracleU64(value.minSambaOutAtomic, "minSambaOutAtomic") });
        case "request_unstake_samba":
            keys(["sambaAmountAtomic", "minAmbaOutAtomic"]);
            return Object.freeze({ ...common, actionType, sambaAmountAtomic: oracleU64(value.sambaAmountAtomic, "sambaAmountAtomic", true), minAmbaOutAtomic: oracleU64(value.minAmbaOutAtomic, "minAmbaOutAtomic") });
        case "complete_unstake_samba":
            keys([]);
            return Object.freeze({ ...common, actionType });
        case "initialize_oracle_month_v5": {
            keys(["scrambleStartTs", "listingTs", "settlementBaseOracleAtomic"]);
            const scrambleStartTs = oracleU64(value.scrambleStartTs, "scrambleStartTs", true);
            const listingTs = oracleU64(value.listingTs, "listingTs", true);
            if (BigInt(listingTs) <= BigInt(scrambleStartTs))
                throw new Error("listingTs must be later than scrambleStartTs.");
            return Object.freeze({ ...common, actionType, scrambleStartTs, listingTs, settlementBaseOracleAtomic: oracleU64(value.settlementBaseOracleAtomic, "settlementBaseOracleAtomic", true) });
        }
        case "propose_oracle_source_v3": {
            keys(["skuId", "sourceId", "bucketId", "sourceType", "canonicalLocator", "sourceDefinition", "listingBondAtomic"]);
            const skuId = oracleLabel(value.skuId, "skuId");
            const bucketId = oracleLabel(value.bucketId, "bucketId");
            if (skuId !== bucketId)
                throw new Error("propose_oracle_source_v3 requires skuId to exactly equal bucketId.");
            return Object.freeze({ ...common, actionType, skuId, sourceId: oracleHex32(value.sourceId, "sourceId", true), bucketId, sourceType: normalizeCurrentOracleSemanticText(value.sourceType, "sourceType", CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES), canonicalLocator: normalizeCurrentOracleSemanticText(value.canonicalLocator, "canonicalLocator", CURRENT_ORACLE_LOCATOR_MAX_BYTES), sourceDefinition: normalizeCurrentOracleSemanticText(value.sourceDefinition, "sourceDefinition", CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES), listingBondAtomic: oracleU64(value.listingBondAtomic, "listingBondAtomic", true) });
        }
        case "support_oracle_source_v3":
            keys(["skuId", "sourceId", "stakeAtomic"]);
            return Object.freeze({ ...common, actionType, skuId: oracleLabel(value.skuId, "skuId"), sourceId: oracleHex32(value.sourceId, "sourceId", true), stakeAtomic: oracleU64(value.stakeAtomic, "stakeAtomic", true) });
        case "challenge_oracle_source_v2": {
            const reasonCode = oracleU8(value.reasonCode, "reasonCode");
            const hasComparison = Object.prototype.hasOwnProperty.call(value, "comparisonSourceId");
            if ((reasonCode === 8) !== hasComparison)
                throw new Error("comparisonSourceId is required exactly when reasonCode is 8.");
            keys(["sourceId", "challengeId", "reasonCode", "bondAtomic", "evidenceHashHex"], hasComparison ? ["comparisonSourceId"] : []);
            return Object.freeze({ ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true), challengeId: oracleHex32(value.challengeId, "challengeId", true), reasonCode, bondAtomic: oracleU64(value.bondAtomic, "bondAtomic", true), evidenceHashHex: oracleHex32(value.evidenceHashHex, "evidenceHashHex", true), ...(hasComparison ? { comparisonSourceId: oracleHex32(value.comparisonSourceId, "comparisonSourceId", true) } : {}) });
        }
        case "submit_oracle_opening_claim_v2": {
            keys(["sourceId", "openingStateAtomic", "sourceTimeUnix", "stakeAtomic", "archiveUrl"]);
            const sourceTimeUnix = oracleU64(value.sourceTimeUnix, "sourceTimeUnix", true);
            return Object.freeze({ ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true), openingStateAtomic: oracleU64(value.openingStateAtomic, "openingStateAtomic"), sourceTimeUnix, stakeAtomic: oracleU64(value.stakeAtomic, "stakeAtomic", true), archiveUrl: oracleArchiveUrl(value.archiveUrl, sourceTimeUnix) });
        }
        case "challenge_oracle_opening_claim_v2": {
            keys(["sourceId", "challengeId", "alternativeOpeningStateAtomic", "alternativeSourceTimeUnix", "bondAtomic", "archiveUrl"]);
            const alternativeSourceTimeUnix = oracleU64(value.alternativeSourceTimeUnix, "alternativeSourceTimeUnix", true);
            return Object.freeze({ ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true), challengeId: oracleHex32(value.challengeId, "challengeId", true), alternativeOpeningStateAtomic: oracleU64(value.alternativeOpeningStateAtomic, "alternativeOpeningStateAtomic"), alternativeSourceTimeUnix, bondAtomic: oracleU64(value.bondAtomic, "bondAtomic", true), archiveUrl: oracleArchiveUrl(value.archiveUrl, alternativeSourceTimeUnix) });
        }
        case "finalize_oracle_opening_claim_v2":
            keys(["sourceId"]);
            return Object.freeze({ ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true) });
        case "commit_oracle_update_claim_v3":
        case "reveal_oracle_update_claim_v3": {
            const isCommit = actionType === "commit_oracle_update_claim_v3";
            keys(["sourceId", "claimId", "priorStateAtomic", "newStateAtomic", "sourceTimeUnix", "evidenceHashHex", "archiveUrl", "secretSaltHex", ...(isCommit ? ["stakeAtomic"] : [])]);
            const priorStateAtomic = oracleU64(value.priorStateAtomic, "priorStateAtomic");
            const newStateAtomic = oracleU64(value.newStateAtomic, "newStateAtomic");
            const sourceTimeUnix = oracleU64(value.sourceTimeUnix, "sourceTimeUnix", true);
            if (priorStateAtomic === newStateAtomic)
                throw new Error(`${actionType} requires newStateAtomic to differ from priorStateAtomic.`);
            const normalized = { ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true), claimId: oracleHex32(value.claimId, "claimId", true), priorStateAtomic, newStateAtomic, sourceTimeUnix, evidenceHashHex: oracleHex32(value.evidenceHashHex, "evidenceHashHex", true), archiveUrl: oracleArchiveUrl(value.archiveUrl, sourceTimeUnix), secretSaltHex: oracleHex32(value.secretSaltHex, "secretSaltHex", true) };
            return Object.freeze(isCommit ? { ...normalized, actionType: "commit_oracle_update_claim_v3", stakeAtomic: oracleU64(value.stakeAtomic, "stakeAtomic", true) } : { ...normalized, actionType: "reveal_oracle_update_claim_v3" });
        }
        case "challenge_oracle_update_claim_v2":
            keys(["sourceId", "claimantPubkey", "claimId", "challengeId", "alternativeStateAtomic", "alternativeSourceTimeUnix", "bondAtomic", "evidenceHashHex", "archiveUrl"]);
            {
                const alternativeSourceTimeUnix = oracleU64(value.alternativeSourceTimeUnix, "alternativeSourceTimeUnix", true);
                return Object.freeze({ ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true), claimantPubkey: oraclePubkey(value.claimantPubkey, "claimantPubkey"), claimId: oracleHex32(value.claimId, "claimId", true), challengeId: oracleHex32(value.challengeId, "challengeId", true), alternativeStateAtomic: oracleU64(value.alternativeStateAtomic, "alternativeStateAtomic"), alternativeSourceTimeUnix, bondAtomic: oracleU64(value.bondAtomic, "bondAtomic", true), evidenceHashHex: oracleHex32(value.evidenceHashHex, "evidenceHashHex", true), archiveUrl: oracleArchiveUrl(value.archiveUrl, alternativeSourceTimeUnix) });
            }
        case "finalize_oracle_update_claim_v2": {
            const outcome = oracleString(value, "outcome");
            if (outcome !== "accept_claim" && outcome !== "reject_claim" && outcome !== "rule_review_unresolved")
                throw new Error("outcome must be accept_claim, reject_claim, or rule_review_unresolved.");
            const hasChallenge = Object.prototype.hasOwnProperty.call(value, "challengeId");
            if (outcome !== "accept_claim" && !hasChallenge)
                throw new Error("challengeId is required for reject_claim and rule_review_unresolved.");
            keys(["sourceId", "claimantPubkey", "claimId", "outcome", "currentStep"], ["challengeId"]);
            return Object.freeze({ ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true), claimantPubkey: oraclePubkey(value.claimantPubkey, "claimantPubkey"), claimId: oracleHex32(value.claimId, "claimId", true), ...(hasChallenge ? { challengeId: oracleHex32(value.challengeId, "challengeId", true) } : {}), outcome, currentStep: oracleU64(value.currentStep, "currentStep", true) });
        }
        case "commit_oracle_emergency_vote_v3":
        case "reveal_oracle_emergency_vote_v2": {
            const isCommit = actionType === "commit_oracle_emergency_vote_v3";
            keys(["disputeId", "disputeKind", "choice", "secretSaltHex", ...(isCommit ? ["sambaAmountAtomic"] : [])]);
            const disputeKind = oracleString(value, "disputeKind");
            if (disputeKind !== "source" && disputeKind !== "update" && disputeKind !== "opening")
                throw new Error("disputeKind must be exactly 'source', 'update', or 'opening'.");
            const choice = oracleString(value, "choice");
            currentOracleEmergencyChoiceIndex(disputeKind, choice);
            const normalized = { ...common, actionType, disputeId: oracleHex32(value.disputeId, "disputeId", true), disputeKind, choice, secretSaltHex: oracleHex32(value.secretSaltHex, "secretSaltHex") };
            return Object.freeze(isCommit ? { ...normalized, actionType: "commit_oracle_emergency_vote_v3", sambaAmountAtomic: oracleU64(value.sambaAmountAtomic, "sambaAmountAtomic", true) } : { ...normalized, actionType: "reveal_oracle_emergency_vote_v2" });
        }
        case "deposit_oracle_usdc_rewards":
            keys(["amountAtomic"]);
            return Object.freeze({ ...common, actionType, amountAtomic: oracleU64(value.amountAtomic, "amountAtomic", true) });
        case "claim_oracle_usdc_reward": {
            const rewardKind = oracleString(value, "rewardKind");
            if (rewardKind !== "proposer" && rewardKind !== "support" && rewardKind !== "opening" && rewardKind !== "update")
                throw new Error("rewardKind must be proposer, support, opening, or update.");
            keys(["rewardKind", "sourceId", ...(rewardKind === "update" ? ["claimId"] : [])]);
            const base = { ...common, actionType, sourceId: oracleHex32(value.sourceId, "sourceId", true) };
            return Object.freeze(rewardKind === "update" ? { ...base, rewardKind, claimId: oracleHex32(value.claimId, "claimId", true) } : { ...base, rewardKind });
        }
        default:
            throw new Error(`Unsupported current Oracle actionType '${actionType}'.`);
    }
}
export function redactCurrentOracleActionRequest(request) {
    const normalized = validateCurrentOracleActionRequest(request);
    if ("secretSaltHex" in normalized) {
        const { secretSaltHex: _secretSaltHex, ...redacted } = normalized;
        return Object.freeze(redacted);
    }
    return normalized;
}
export function currentOracleEmergencyChoiceIndex(kind, choice) {
    switch (kind) {
        case "source":
            if (choice === "keep_source")
                return 0;
            if (choice === "reject_source")
                return 1;
            if (choice === "merge_source")
                return 2;
            break;
        case "update":
            if (choice === "accept_claim")
                return 0;
            if (choice === "accept_alternative_state")
                return 1;
            if (choice === "reject_update")
                return 2;
            break;
        case "opening":
            if (choice === "keep_opening")
                return 0;
            if (choice === "accept_alternative_opening")
                return 1;
            if (choice === "source_inactive_for_month")
                return 2;
            break;
        default:
            throw new Error("kind must be source, update, or opening.");
    }
    throw new Error(`choice is not valid for ${kind} emergency disputes.`);
}
//# sourceMappingURL=current-oracle-public.js.map