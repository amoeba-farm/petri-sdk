import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  NANDX_ORACLE_PRODUCT_SKU_COUNT,
  RAMX_ORACLE_PRODUCT_SKU_COUNT,
  buildOracleSkuMerkleManifest,
} from "@amoeba/spread-release-tools/oracle-dlmm";
import {
  NANDX_PRODUCT_SKU_GROUP_LAYOUT_SHA256,
  NANDX_PRODUCT_SKU_ROOT_HEX,
  RAMX_PRODUCT_SKU_GROUP_LAYOUT_SHA256,
  RAMX_PRODUCT_SKU_ROOT_HEX,
  parseGovernedNandxProductSkuManifest,
  parseGovernedRamxProductSkuManifest,
} from "@amoeba/spread-release-tools/product-sku-manifest";
import {
  CURRENT_ORACLE_SOURCE_DEFINITION_HASH_DOMAIN,
  CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES,
  CURRENT_ORACLE_SOURCE_TYPE_HASH_DOMAIN,
  CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES,
  currentOracleEmergencyChoiceIndex,
  normalizeCurrentOracleSemanticText,
  redactCurrentOracleActionRequest,
  validateCurrentOracleActionRequest,
} from "./current-oracle-public.js";

export {
  currentOracleEmergencyChoiceIndex,
  normalizeCurrentOracleSemanticText,
  redactCurrentOracleActionRequest,
  validateCurrentOracleActionRequest,
};

type CurrentOracleProduct = "ramx" | "nandx";

interface CurrentOracleActionCommon {
  readonly marketId: CurrentOracleProduct;
  readonly expiryId: string;
  readonly ownerPubkey: string;
}

type CurrentOracleEmergencyDisputeKind = "source" | "update" | "opening";
type CurrentOracleSourceEmergencyChoice = "keep_source" | "reject_source" | "merge_source";
type CurrentOracleUpdateEmergencyChoice =
  | "accept_claim"
  | "accept_alternative_state"
  | "reject_update";
type CurrentOracleOpeningEmergencyChoice =
  | "keep_opening"
  | "accept_alternative_opening"
  | "source_inactive_for_month";
type CurrentOracleEmergencyChoice =
  | CurrentOracleSourceEmergencyChoice
  | CurrentOracleUpdateEmergencyChoice
  | CurrentOracleOpeningEmergencyChoice;

export type CurrentOracleActionRequest =
  | (CurrentOracleActionCommon & { readonly actionType: "queue_stake_amba_for_samba"; readonly ambaAmountAtomic: string })
  | (CurrentOracleActionCommon & { readonly actionType: "activate_queued_stake_amba_for_samba"; readonly minSambaOutAtomic: string })
  | (CurrentOracleActionCommon & { readonly actionType: "request_unstake_samba"; readonly sambaAmountAtomic: string; readonly minAmbaOutAtomic: string })
  | (CurrentOracleActionCommon & { readonly actionType: "complete_unstake_samba" })
  | (CurrentOracleActionCommon & {
      readonly actionType: "initialize_oracle_month_v5";
      readonly scrambleStartTs: string;
      readonly listingTs: string;
      readonly settlementBaseOracleAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "propose_oracle_source_v3";
      readonly skuId: string;
      readonly sourceId: string;
      readonly bucketId: string;
      readonly sourceType: string;
      readonly canonicalLocator: string;
      readonly sourceDefinition: string;
      readonly listingBondAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "support_oracle_source_v3";
      readonly skuId: string;
      readonly sourceId: string;
      readonly stakeAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "challenge_oracle_source_v2";
      readonly sourceId: string;
      readonly challengeId: string;
      readonly reasonCode: number;
      readonly bondAtomic: string;
      readonly evidenceHashHex: string;
      readonly comparisonSourceId?: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "submit_oracle_opening_claim_v2";
      readonly sourceId: string;
      readonly openingStateAtomic: string;
      readonly sourceTimeUnix: string;
      readonly stakeAtomic: string;
      readonly archiveUrl: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "challenge_oracle_opening_claim_v2";
      readonly sourceId: string;
      readonly challengeId: string;
      readonly alternativeOpeningStateAtomic: string;
      readonly alternativeSourceTimeUnix: string;
      readonly bondAtomic: string;
      readonly archiveUrl: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "finalize_oracle_opening_claim_v2";
      readonly sourceId: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "commit_oracle_update_claim_v3";
      readonly sourceId: string;
      readonly claimId: string;
      readonly priorStateAtomic: string;
      readonly newStateAtomic: string;
      readonly evidenceHashHex: string;
      readonly secretSaltHex: string;
      readonly stakeAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "reveal_oracle_update_claim_v3";
      readonly sourceId: string;
      readonly claimId: string;
      readonly priorStateAtomic: string;
      readonly newStateAtomic: string;
      readonly evidenceHashHex: string;
      readonly secretSaltHex: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "challenge_oracle_update_claim_v2";
      readonly sourceId: string;
      readonly claimantPubkey: string;
      readonly claimId: string;
      readonly challengeId: string;
      readonly alternativeStateAtomic: string;
      readonly bondAtomic: string;
      readonly evidenceHashHex: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "finalize_oracle_update_claim_v2";
      readonly sourceId: string;
      readonly claimantPubkey: string;
      readonly claimId: string;
      readonly challengeId?: string;
      readonly outcome: "accept_claim" | "reject_claim" | "rule_review_unresolved";
      readonly currentStep: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "commit_oracle_emergency_vote_v3";
      readonly disputeId: string;
      readonly disputeKind: "source";
      readonly choice: CurrentOracleSourceEmergencyChoice;
      readonly secretSaltHex: string;
      readonly sambaAmountAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "commit_oracle_emergency_vote_v3";
      readonly disputeId: string;
      readonly disputeKind: "update";
      readonly choice: CurrentOracleUpdateEmergencyChoice;
      readonly secretSaltHex: string;
      readonly sambaAmountAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "commit_oracle_emergency_vote_v3";
      readonly disputeId: string;
      readonly disputeKind: "opening";
      readonly choice: CurrentOracleOpeningEmergencyChoice;
      readonly secretSaltHex: string;
      readonly sambaAmountAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "reveal_oracle_emergency_vote_v2";
      readonly disputeId: string;
      readonly disputeKind: "source";
      readonly choice: CurrentOracleSourceEmergencyChoice;
      readonly secretSaltHex: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "reveal_oracle_emergency_vote_v2";
      readonly disputeId: string;
      readonly disputeKind: "update";
      readonly choice: CurrentOracleUpdateEmergencyChoice;
      readonly secretSaltHex: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "reveal_oracle_emergency_vote_v2";
      readonly disputeId: string;
      readonly disputeKind: "opening";
      readonly choice: CurrentOracleOpeningEmergencyChoice;
      readonly secretSaltHex: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "deposit_oracle_usdc_rewards";
      readonly amountAtomic: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "claim_oracle_usdc_reward";
      readonly rewardKind: "proposer" | "support" | "opening";
      readonly sourceId: string;
    })
  | (CurrentOracleActionCommon & {
      readonly actionType: "claim_oracle_usdc_reward";
      readonly rewardKind: "update";
      readonly sourceId: string;
      readonly claimId: string;
    });

type RedactCurrentOracleSecret<T> = T extends { readonly secretSaltHex: string }
  ? Omit<T, "secretSaltHex">
  : T;

export type CurrentOracleRedactedRequest = RedactCurrentOracleSecret<CurrentOracleActionRequest>;

function semanticHash(value: unknown, label: string, maxBytes: number, domain: string): Buffer {
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

export function encodeCurrentOracleLabelBytes32(value: string, label: string): Buffer {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const bytes = Buffer.from(value, "utf8");
  if (
    bytes.length === 0
    || bytes.length > 32
    || value.trim() !== value
    || [...bytes].some((byte) => byte < 0x20 || byte > 0x7e)
  ) {
    throw new Error(
      `${label} must be 1 through 32 printable ASCII bytes with no surrounding whitespace.`,
    );
  }
  const encoded = Buffer.alloc(32);
  bytes.copy(encoded);
  return encoded;
}

export function parseCurrentOracleHex32(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be exactly 32 bytes of lowercase hexadecimal.`);
  }
  return Buffer.from(value, "hex");
}

export function currentOracleSourceTypeHash(value: unknown): Buffer {
  return semanticHash(
    value,
    "sourceType",
    CURRENT_ORACLE_SOURCE_TYPE_MAX_BYTES,
    CURRENT_ORACLE_SOURCE_TYPE_HASH_DOMAIN,
  );
}

export function currentOracleSourceDefinitionHash(value: unknown): Buffer {
  return semanticHash(
    value,
    "sourceDefinition",
    CURRENT_ORACLE_SOURCE_DEFINITION_MAX_BYTES,
    CURRENT_ORACLE_SOURCE_DEFINITION_HASH_DOMAIN,
  );
}

interface VerifiedGovernedSkuManifest {
  readonly product: CurrentOracleProduct;
  readonly requiredSkuRootHex: string;
  readonly requiredSkuCount: number;
  readonly layoutSha256: string;
  readonly requiredSkuIdHex: readonly string[];
  readonly sortedSkuLabels: readonly string[];
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
} as const;

function governedSkuProduct(value: unknown): CurrentOracleProduct {
  if (value !== "ramx" && value !== "nandx") {
    throw new Error("marketId must be exactly 'ramx' or 'nandx'.");
  }
  return value;
}

async function loadVerifiedGovernedSkuManifest(
  productInput: unknown,
): Promise<VerifiedGovernedSkuManifest> {
  const product = governedSkuProduct(productInput);
  const config = GOVERNED_MANIFEST_CONFIG[product];
  const manifestUrl = new URL(`../../vendor/governance/${config.filename}`, import.meta.url);
  const raw = await readFile(manifestUrl, "utf8");
  const governed = config.parse(JSON.parse(raw) as unknown);
  const recomputed = buildOracleSkuMerkleManifest(governed.requiredSkuIds);
  const requiredSkuRootHex = recomputed.requiredSkuRoot.toString("hex");

  if (
    governed.document.product.marketId !== product
    || governed.document.requiredSkuCount !== config.requiredSkuCount
    || governed.requiredSkuIds.length !== config.requiredSkuCount
    || recomputed.requiredSkuCount !== config.requiredSkuCount
    || requiredSkuRootHex !== config.requiredSkuRootHex
    || governed.requiredSkuRoot.toString("hex") !== config.requiredSkuRootHex
    || governed.document.requiredSkuRootHex !== config.requiredSkuRootHex
    || governed.layoutSha256 !== config.layoutSha256
  ) {
    throw new Error(`${product.toUpperCase()} governed SKU manifest does not match rc.44 constants.`);
  }
  const requiredSkuIdHex = governed.requiredSkuIds.map((skuId, index) => {
    const hex = Buffer.from(skuId).toString("hex");
    if (recomputed.proofs[index]?.skuId.toString("hex") !== hex) {
      throw new Error(`${product.toUpperCase()} governed SKU manifest ordering is not canonical.`);
    }
    return hex;
  });
  if (
    governed.sortedSkuLabels.length !== requiredSkuIdHex.length
    || new Set(governed.sortedSkuLabels).size !== governed.sortedSkuLabels.length
  ) {
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

export async function loadCurrentGovernedSkuManifest(
  product: "ramx" | "nandx",
): Promise<Readonly<{
  product: "ramx" | "nandx";
  requiredSkuRoot: Buffer;
  requiredSkuCount: number;
  layoutSha256: string;
  requiredSkuIds: readonly Buffer[];
  sortedSkuLabels: readonly string[];
}>> {
  const verified = await loadVerifiedGovernedSkuManifest(product);
  return Object.freeze({
    product: verified.product,
    requiredSkuRoot: Buffer.from(verified.requiredSkuRootHex, "hex"),
    requiredSkuCount: verified.requiredSkuCount,
    layoutSha256: verified.layoutSha256,
    requiredSkuIds: Object.freeze(
      verified.requiredSkuIdHex.map((skuIdHex) => Buffer.from(skuIdHex, "hex")),
    ),
    sortedSkuLabels: verified.sortedSkuLabels,
  });
}

export async function getCurrentGovernedSkuProof(
  product: "ramx" | "nandx",
  skuId: string,
): Promise<Readonly<{
  skuId: Buffer;
  skuIndex: number;
  skuProof: readonly Buffer[];
  requiredSkuRoot: Buffer;
  requiredSkuCount: number;
}>> {
  const canonicalSkuId = encodeCurrentOracleLabelBytes32(skuId, "skuId");
  const manifest = await loadCurrentGovernedSkuManifest(product);
  const skuIndex = manifest.requiredSkuIds.findIndex((candidate) => candidate.equals(canonicalSkuId));
  if (skuIndex < 0) {
    const otherProduct: CurrentOracleProduct = product === "ramx" ? "nandx" : "ramx";
    const otherManifest = await loadCurrentGovernedSkuManifest(otherProduct);
    const belongsToOtherProduct = otherManifest.requiredSkuIds.some((candidate) =>
      candidate.equals(canonicalSkuId)
    );
    throw new Error(
      belongsToOtherProduct
        ? `skuId belongs to ${otherProduct.toUpperCase()}, not ${product.toUpperCase()}.`
        : `skuId is not present in the governed ${product.toUpperCase()} manifest.`,
    );
  }
  const recomputed = buildOracleSkuMerkleManifest(manifest.requiredSkuIds);
  if (
    recomputed.requiredSkuCount !== manifest.requiredSkuCount
    || !recomputed.requiredSkuRoot.equals(manifest.requiredSkuRoot)
  ) {
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
