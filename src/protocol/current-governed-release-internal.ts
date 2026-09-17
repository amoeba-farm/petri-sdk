import candidate from "../../release/local-candidate-build.v1.json" with { type: "json" };
// Current finalized evidence is SDK-owned; the immutable native client package keeps
// its historical deployment descriptor, not an invented contract source revision.
import upstream from "../../release/spread-refactor-final-20260912.json" with { type: "json" };
import {
  CURRENT_GOVERNANCE_GENERATION_1,
  CURRENT_GOVERNANCE_GENERATION_3,
  CURRENT_LIVE_DEPLOYMENT,
  REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE,
  SDK_RELEASE_TRAIN,
  CurrentWriteReleaseUnavailableError,
  type GovernanceIdentityV1,
} from "./release-train.js";
import {
  GovernedTransactionValidationError,
  type BoundGovernedWriteReleaseV1,
} from "./governed-transaction-internal.js";
import runtimeReceipt from "../../vendor/GOVERNED_RUNTIME_PROVENANCE.json" with { type: "json" };
import { isExactWriterOperationTransportV1, WRITER_OPERATION_TRANSPORT_SHA256_V1 } from "./writer-operation-transport-internal.js";
import { isExactWriterDlmmTransportV1, WRITER_DLMM_TRANSPORT_SHA256_V1 } from "./writer-dlmm-transport.js";
import { PublicKey } from "@solana/web3.js";
import { CURRENT_VAULT_INSTRUCTION_TAG, CURRENT_AMOEBA_DLMM_INSTRUCTION_TAG } from "./current-instruction-tags.js";

/**
 * Resolves the one package-owned governed-write release. This file is not a
 * package export: callers cannot substitute a controller, instruction-tag
 * allowlist, source commit, package artifact, manifest, or deployed payload.
 */
export function currentGovernedWriteReleaseV1(): BoundGovernedWriteReleaseV1 {
  if (candidate.nativePackage.sha256 !== runtimeReceipt.packageArtifact.sha256) {
    throw new GovernedTransactionValidationError("G3_DEPLOYMENT_BINDING_REQUIRED", "The installed package is not the recorded deployed release; use an observed matching integration profile");
  }
  const train = SDK_RELEASE_TRAIN as unknown as {
    readonly selectedGovernanceGeneration: unknown;
    readonly liveGovernanceIdentity: unknown;
    readonly sourceHeads: { readonly spread?: unknown };
    readonly writeRelease: Readonly<Record<string, unknown>>;
  };
  const release = train.writeRelease;
  if (release.status !== "available") throw new CurrentWriteReleaseUnavailableError();
  const identity = selectedReleaseIdentity(
    train.selectedGovernanceGeneration,
    train.liveGovernanceIdentity,
  );
  const liveDeployment = CURRENT_LIVE_DEPLOYMENT as unknown as {
    readonly sourceCommit: unknown;
    readonly programDataPayloadSha256: unknown;
    readonly writeCompatibility: unknown;
  };
  const identityEvidence = identity as unknown as {
    readonly live?: unknown;
    readonly activationEvidence?: unknown;
  };
  const runtime = runtimeReceipt as Readonly<Record<string, any>>;
  const document = SDK_RELEASE_TRAIN as unknown as Readonly<Record<string, any>>;
  const live = CURRENT_LIVE_DEPLOYMENT as unknown as Readonly<Record<string, any>>;
  const selected = identity as unknown as Readonly<Record<string, any>>;
  const reviewed = CURRENT_GOVERNANCE_GENERATION_3 as unknown as Readonly<Record<string, any>>;
  // Older descriptors have only historical controller evidence. It cannot qualify a current release.
  const currentControllerEvidence = (upstream.accountEvidence as {
    readonly controllerProgramData?: { readonly sha256?: unknown } | null;
  }).controllerProgramData;
  // This browser-safe validator knows both ABI inventories. Only package-owned provenance
  // selects the membership generation; actual native exports are required by its builders
  // and by the native-package qualification check. No caller can select this inventory.
  const nativeHasMembershipTag = Array.isArray(runtime.assignedInstructionTags)
    && runtime.assignedInstructionTags.includes(CURRENT_VAULT_INSTRUCTION_TAG.IndexOracleRecipeSourceV1);
  const tags = [...Object.values(CURRENT_VAULT_INSTRUCTION_TAG), ...Object.values(CURRENT_AMOEBA_DLMM_INSTRUCTION_TAG)]
    // Tag 200 is recognized source grammar, but old packages/releases must still exclude it.
    // A new native implementation requires both pinned metadata inventories to match exactly below.
    .filter(tag => tag !== CURRENT_VAULT_INSTRUCTION_TAG.IndexOracleRecipeSourceV1 || nativeHasMembershipTag)
    .sort((a,b) => a-b);
  if (
    upstream.sdkDescriptorOwnership.nativePackageSourceCommit !== runtime.sourceCommit
    || upstream.sdkDescriptorOwnership.nativePackageSha256 !== runtime.packageArtifact?.sha256
    || upstream.sdkDescriptorOwnership.artifactSourceCommit !== live.artifactSourceCommit
    || runtime.nativePackageBytesMatchImmutableSource !== true
    || live.artifactSourceCommit !== upstream.spread.sourceCommit
    || live.artifactSha256 !== upstream.spread.artifactSha256
    || live.artifactBytes !== upstream.spread.artifactBytes
    || live.programDataPayloadSha256 !== upstream.accountEvidence.spreadProgramData.payloadSha256
    || live.programDataPayloadBytes + 45 !== upstream.accountEvidence.spreadProgramData.bytes
    || !Number.isSafeInteger(live.mandatoryZeroPaddingBytes) || live.mandatoryZeroPaddingBytes < 0
    || live.artifactBytes + live.mandatoryZeroPaddingBytes !== live.programDataPayloadBytes
    || selected.controllerSourceCommit !== upstream.controller.sourceCommit
    || selected.artifactSha256 !== upstream.controller.artifactSha256
    || !hex(currentControllerEvidence?.sha256, 64)
    || selected.programDataSha256 !== currentControllerEvidence?.sha256
    || live.programDataAccountSha256 !== upstream.accountEvidence.spreadProgramData.sha256
    || live.programDataAccountBytes !== upstream.accountEvidence.spreadProgramData.bytes
    || !sameJson(live.buildFeatures, upstream.buildFeatures)
    || release.instructionManifestSha256 !== upstream.abi.instructionManifestSha256
    || selected.identityManifestSha256 !== upstream.governanceIdentity.sha256
    || release.status !== "available"
    || release.compatibility !== "governance-gate-v1"
    || release.governanceIdentityGeneration !== identity.identityGeneration
    || release.spreadReleaseCommit !== train.sourceHeads.spread
    || release.spreadReleaseCommit !== liveDeployment.sourceCommit
    || release.programDataPayloadSha256 !== liveDeployment.programDataPayloadSha256
    || release.compatibility !== liveDeployment.writeCompatibility
    || identityEvidence.live !== true
    || identity.identityGeneration !== 3
    || document.schema !== "ameba.sdk.release-train.v1" || document.schemaVersion !== 1
    || document.authorization.mainnetEnabled !== false
    || live.cluster !== "devnet" || live.genesisHash !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    || live.stateNamespace !== "ameba-spread-v2"
    || selected.environment !== "devnet" || selected.mainnetAllowed !== false
    || selected.upgradeAuthority?.mode !== "governed-authority" || selected.upgradeAuthority?.address !== "Frc28QFQxqUxF9HPgzcmm5VkqorqUb2LeLPE5uKU6Ycp"
    || ["controllerProgramData", "controllerSourceCommit", "artifactSha256",
      "programDataSha256", "deploymentReceiptSha256", "upgradeAuthority"]
      .some(key => !sameJson(selected[key],reviewed[key]))
    || !canonicalPubkey(selected.controllerProgramData) || !hex(selected.controllerSourceCommit,40)
    || ["artifactSha256", "programDataSha256", "deploymentReceiptSha256"]
      .some(key=>!hex(selected[key],64))
    || selected.controllerProgramId !== "8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx"
    || selected.controllerConfigPda !== "Ec5H8jsGvaLU3T3gp6qTayPjY2qF3geBbVKWz4rsaEHB"
    || selected.protocolGatePda !== "Cdym9p7FvtxEAjF8XuCqSrishB7LmBDXaZGDMMgWczu"
    || selected.targetProgramId !== "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw"
    || selected.targetProgramData !== "8KR6hgcQehz32jm7CvrAriYNhvT2Bu9JuUWHce81J1oh"
    || live.programId !== selected.targetProgramId || live.programDataAddress !== selected.targetProgramData
    || runtime.schemaVersion !== 1 || runtime.protocol !== "ameba_spread"
    || runtime.currentWriteEligible !== true || runtime.deploymentCorrespondenceVerified !== true || runtime.sourceWorktreeDirty !== false
    || !sameJson(runtime.deployment,live) || runtime.sourceCommit !== release.spreadReleaseCommit
    || !hex(release.spreadReleaseCommit,40) || !hex(release.spreadPackageArtifactSha256,64)
    || !hex(release.instructionManifestSha256,64) || !hex(release.programDataPayloadSha256,64)
    || runtime.packageArtifact?.sha256 !== release.spreadPackageArtifactSha256
    || runtime.instructionManifestSourceSha256 !== release.instructionManifestSha256
    || !sameJson(release.assignedInstructionTags,tags) || !sameJson(runtime.assignedInstructionTags,tags)
    || live.programAccountBytes !== 36 || !hex(live.programAccountSha256,64) || !hex(live.programDataAccountSha256,64)
    || !positiveInteger(live.programDataPayloadBytes) || !positiveInteger(live.programDataAccountBytes)
    || live.programDataPayloadBytes+45 > live.programDataAccountBytes
    || !positiveInteger(live.programDataSlot) || !positiveInteger(live.minimumContextSlot)
    || live.minimumContextSlot < live.programDataSlot
    || live.upgradeAuthority?.mode !== "external-authority" || live.upgradeAuthority?.address !== "4hsEKyThDv85YA4HjUaGWn2nWnVbM5V23XcLrEX3UKzn"
    || !isExactWriterOperationTransportV1(release.writerOperationTransport)
    || release.writerOperationTransportSha256 !== WRITER_OPERATION_TRANSPORT_SHA256_V1
    || runtime.writerOperationTransportSha256 !== WRITER_OPERATION_TRANSPORT_SHA256_V1
    || !isExactWriterOperationTransportV1(
      (runtimeReceipt as Readonly<Record<string, unknown>>).writerOperationTransport,
    )
    || (tags.includes(CURRENT_VAULT_INSTRUCTION_TAG.ManageWriterDlmmV1) && (
      !isExactWriterDlmmTransportV1(release.writerDlmmTransport)
      || !isExactWriterDlmmTransportV1(runtime.writerDlmmTransport)
      || release.writerDlmmTransportSha256 !== WRITER_DLMM_TRANSPORT_SHA256_V1
      || runtime.writerDlmmTransportSha256 !== WRITER_DLMM_TRANSPORT_SHA256_V1
    ))

  ) {
    throw new GovernedTransactionValidationError(
      "CURRENT_GOVERNED_WRITE_RELEASE_INVALID",
      "current governed write release lacks exact source, payload, generation, or compatibility pins",
    );
  }
  return {
    identity,
    governanceIdentityGeneration: identity.identityGeneration,
    spreadReleaseCommit: release.spreadReleaseCommit as string,
    spreadPackageArtifactSha256: release.spreadPackageArtifactSha256 as string,
    instructionManifestSha256: release.instructionManifestSha256 as string,
    programDataPayloadSha256: release.programDataPayloadSha256 as string,
    assignedInstructionTags: release.assignedInstructionTags as readonly number[],
  };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function hex(value: unknown, length: number): boolean {
  return typeof value === "string" && value.length === length && /^[a-f0-9]+$/u.test(value) && !/^0+$/u.test(value);
}
function canonicalPubkey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const key = new PublicKey(value); return key.toBase58() === value && !key.equals(PublicKey.default); }
  catch { return false; }
}
function sameJson(left: unknown,right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value,index)=>sameJson(value,right[index]));
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key=>Object.hasOwn(b,key)&&sameJson(a[key],b[key]));
}

function selectedReleaseIdentity(
  generation: unknown,
  liveIdentity: unknown,
): GovernanceIdentityV1 {
  if (generation === 3 && liveIdentity === CURRENT_GOVERNANCE_GENERATION_3) {
    return CURRENT_GOVERNANCE_GENERATION_3;
  }
  if (generation === 1 && liveIdentity === CURRENT_GOVERNANCE_GENERATION_1) {
    return CURRENT_GOVERNANCE_GENERATION_1;
  }
  if (generation === 2 && liveIdentity === REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE) {
    return REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE;
  }
  throw new GovernedTransactionValidationError(
    "CURRENT_GOVERNED_WRITE_RELEASE_INVALID",
    "current governed write release does not select one exact live governance identity",
  );
}
