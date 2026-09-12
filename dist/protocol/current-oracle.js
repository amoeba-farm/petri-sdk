import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NANDX_ORACLE_PRODUCT_SKU_COUNT, RAMX_ORACLE_PRODUCT_SKU_COUNT, buildOracleSkuMerkleManifest, } from "@amoeba/spread-release-tools/oracle-dlmm";
import { NANDX_PRODUCT_SKU_GROUP_LAYOUT_SHA256, NANDX_PRODUCT_SKU_ROOT_HEX, RAMX_PRODUCT_SKU_GROUP_LAYOUT_SHA256, RAMX_PRODUCT_SKU_ROOT_HEX, parseGovernedNandxProductSkuManifest, parseGovernedRamxProductSkuManifest, } from "@amoeba/spread-release-tools/product-sku-manifest";
import { CURRENT_ORACLE_SOURCE_DEFINITION_HASH_DOMAIN, CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES, CURRENT_ORACLE_SOURCE_TYPE_HASH_DOMAIN, CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES, currentOracleEmergencyChoiceIndex, normalizeCurrentOracleSemanticText, redactCurrentOracleActionRequest, validateCurrentOracleActionRequest, } from "./current-oracle-public.js";
export { currentOracleEmergencyChoiceIndex, normalizeCurrentOracleSemanticText, redactCurrentOracleActionRequest, validateCurrentOracleActionRequest, };
function semanticHash(value, label, maxBytes, domain) {
    const normalized = normalizeCurrentOracleSemanticText(value, label, maxBytes);
    const bytes = Buffer.from(normalized, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length, 0);
    return createHash("sha256")
        .update(Buffer.from(domain, "utf8"))
        .update(Buffer.from([0]))
        .update(length)
        .update(bytes)
        .digest();
}
export function encodeCurrentOracleLabelBytes32(value, label) {
    if (typeof value !== "string") {
        throw new Error(`${label} must be a string.`);
    }
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length === 0
        || bytes.length > 32
        || value.trim() !== value
        || [...bytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
        throw new Error(`${label} must be 1 through 32 printable ASCII bytes with no surrounding whitespace.`);
    }
    const encoded = Buffer.alloc(32);
    bytes.copy(encoded);
    return encoded;
}
export function parseCurrentOracleHex32(value, label) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error(`${label} must be exactly 32 bytes of lowercase hexadecimal.`);
    }
    return Buffer.from(value, "hex");
}
export function currentOracleSourceTypeHash(value) {
    return semanticHash(value, "sourceType", CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES, CURRENT_ORACLE_SOURCE_TYPE_HASH_DOMAIN);
}
export function currentOracleSourceDefinitionHash(value) {
    return semanticHash(value, "sourceDefinition", CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES, CURRENT_ORACLE_SOURCE_DEFINITION_HASH_DOMAIN);
}
const GOVERNED_MANIFEST_CONFIG = {
    ramx: {
        filename: "ramx_product_sku_manifest.v1.json",
        parse: parseGovernedRamxProductSkuManifest,
        requiredSkuRootHex: RAMX_PRODUCT_SKU_ROOT_HEX,
        requiredSkuCount: RAMX_ORACLE_PRODUCT_SKU_COUNT,
        layoutSha256: RAMX_PRODUCT_SKU_GROUP_LAYOUT_SHA256,
    },
    nandx: {
        filename: "nandx_product_sku_manifest.v1.json",
        parse: parseGovernedNandxProductSkuManifest,
        requiredSkuRootHex: NANDX_PRODUCT_SKU_ROOT_HEX,
        requiredSkuCount: NANDX_ORACLE_PRODUCT_SKU_COUNT,
        layoutSha256: NANDX_PRODUCT_SKU_GROUP_LAYOUT_SHA256,
    },
};
function governedSkuProduct(value) {
    if (value !== "ramx" && value !== "nandx") {
        throw new Error("marketId must be exactly 'ramx' or 'nandx'.");
    }
    return value;
}
async function loadVerifiedGovernedSkuManifest(productInput) {
    const product = governedSkuProduct(productInput);
    const config = GOVERNED_MANIFEST_CONFIG[product];
    const manifestUrl = new URL(`../../vendor/governance/${config.filename}`, import.meta.url);
    const raw = await readFile(manifestUrl, "utf8");
    const governed = config.parse(JSON.parse(raw));
    const recomputed = buildOracleSkuMerkleManifest(governed.requiredSkuIds);
    const requiredSkuRootHex = recomputed.requiredSkuRoot.toString("hex");
    if (governed.document.product.marketId !== product
        || governed.document.requiredSkuCount !== config.requiredSkuCount
        || governed.requiredSkuIds.length !== config.requiredSkuCount
        || recomputed.requiredSkuCount !== config.requiredSkuCount
        || requiredSkuRootHex !== config.requiredSkuRootHex
        || governed.requiredSkuRoot.toString("hex") !== config.requiredSkuRootHex
        || governed.document.requiredSkuRootHex !== config.requiredSkuRootHex
        || governed.layoutSha256 !== config.layoutSha256) {
        throw new Error(`${product.toUpperCase()} governed SKU manifest does not match rc.44 constants.`);
    }
    const requiredSkuIdHex = governed.requiredSkuIds.map((skuId, index) => {
        const hex = Buffer.from(skuId).toString("hex");
        if (recomputed.proofs[index]?.skuId.toString("hex") !== hex) {
            throw new Error(`${product.toUpperCase()} governed SKU manifest ordering is not canonical.`);
        }
        return hex;
    });
    if (governed.sortedSkuLabels.length !== requiredSkuIdHex.length
        || new Set(governed.sortedSkuLabels).size !== governed.sortedSkuLabels.length) {
        throw new Error(`${product.toUpperCase()} governed SKU labels are not complete and unique.`);
    }
    return Object.freeze({
        product,
        requiredSkuRootHex,
        requiredSkuCount: recomputed.requiredSkuCount,
        layoutSha256: governed.layoutSha256,
        requiredSkuIdHex: Object.freeze(requiredSkuIdHex),
        sortedSkuLabels: Object.freeze([...governed.sortedSkuLabels]),
    });
}
export async function loadCurrentGovernedSkuManifest(product) {
    const verified = await loadVerifiedGovernedSkuManifest(product);
    return Object.freeze({
        product: verified.product,
        requiredSkuRoot: Buffer.from(verified.requiredSkuRootHex, "hex"),
        requiredSkuCount: verified.requiredSkuCount,
        layoutSha256: verified.layoutSha256,
        requiredSkuIds: Object.freeze(verified.requiredSkuIdHex.map((skuIdHex) => Buffer.from(skuIdHex, "hex"))),
        sortedSkuLabels: verified.sortedSkuLabels,
    });
}
export async function getCurrentGovernedSkuProof(product, skuId) {
    const canonicalSkuId = encodeCurrentOracleLabelBytes32(skuId, "skuId");
    const manifest = await loadCurrentGovernedSkuManifest(product);
    const skuIndex = manifest.requiredSkuIds.findIndex((candidate) => candidate.equals(canonicalSkuId));
    if (skuIndex < 0) {
        const otherProduct = product === "ramx" ? "nandx" : "ramx";
        const otherManifest = await loadCurrentGovernedSkuManifest(otherProduct);
        const belongsToOtherProduct = otherManifest.requiredSkuIds.some((candidate) => candidate.equals(canonicalSkuId));
        throw new Error(belongsToOtherProduct
            ? `skuId belongs to ${otherProduct.toUpperCase()}, not ${product.toUpperCase()}.`
            : `skuId is not present in the governed ${product.toUpperCase()} manifest.`);
    }
    const recomputed = buildOracleSkuMerkleManifest(manifest.requiredSkuIds);
    if (recomputed.requiredSkuCount !== manifest.requiredSkuCount
        || !recomputed.requiredSkuRoot.equals(manifest.requiredSkuRoot)) {
        throw new Error(`${product.toUpperCase()} governed SKU proof root/count changed during derivation.`);
    }
    const proof = recomputed.proofs[skuIndex];
    if (proof === undefined || !proof.skuId.equals(canonicalSkuId)) {
        throw new Error(`${product.toUpperCase()} governed SKU proof index is inconsistent.`);
    }
    return Object.freeze({
        skuId: Buffer.from(proof.skuId),
        skuIndex: proof.skuIndex,
        skuProof: Object.freeze(proof.proof.map((node) => Buffer.from(node))),
        requiredSkuRoot: Buffer.from(recomputed.requiredSkuRoot),
        requiredSkuCount: recomputed.requiredSkuCount,
    });
}
//# sourceMappingURL=current-oracle.js.map