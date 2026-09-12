import { readCurrentVerifiedCompressedStateEvidence, type CurrentPhotonVerifiedCompressedStateEvidence } from "./current-photon-verified.js";
import { requireCurrentCompressedEvidenceVerifier, type CurrentCompressedEvidenceVerifier } from "./current-compressed-evidence-verifier.js";
import { CURRENT_SPREAD_LIGHT_CPI_AUTHORITY } from "./current-light-identity.js";
import { Buffer } from "buffer";
import { createHash } from "node:crypto";

import {
  PackedAccounts,
  SystemAccountMetaConfig,
  TreeType,
  batchAddressTree,
  batchCpiContext1,
  batchCpiContext2,
  batchCpiContext3,
  batchCpiContext4,
  batchCpiContext5,
  batchMerkleTree1,
  batchMerkleTree2,
  batchMerkleTree3,
  batchMerkleTree4,
  batchMerkleTree5,
  batchQueue1,
  batchQueue2,
  batchQueue3,
  batchQueue4,
  batchQueue5,
  createBN254,
  createRpc,
  deriveAddress,
  getLightSystemAccountMetasV2,
  type AddressWithTree,
  type BN254,
  type CompressedAccountWithMerkleContext,
  type GetCompressedAccountsFilter,
  type HashWithTree,
  type Rpc,
  type TreeInfo,
  type ValidityProof,
  type ValidityProofWithContext,
  type WithContext,
  type WithCursor,
} from "@lightprotocol/stateless.js";
import { getCurrentLightAtaInterface } from "./current-token-primitives.js";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";

import { AmebaSdkError } from "../errors.js";
import { buildRegisteredLightActionPlanV1 } from "./current-light-action-plan-internal.js";
import {
  CURRENT_PROTOCOL_DEVNET_GENESIS_HASH,
} from "./current.js";
import {
  decodeCurrentExecuteCompressedStateV1,
  type CurrentPackedStateTreeInfo,
} from "./current-instructions.js";
import {
  AMOEBA_DLMM_BIN_PAGE_ACCOUNT_SIZE,
  AMOEBA_DLMM_BIN_PAGE_DISCRIMINATOR,
  AMOEBA_DLMM_POOL_ACCOUNT_SIZE,
  AMOEBA_DLMM_POOL_DISCRIMINATOR,
  AMOEBA_DLMM_POSITION_ACCOUNT_SIZE,
  AMOEBA_DLMM_POSITION_DISCRIMINATOR,
  AMOEBA_DLMM_SHARE_PAGE_ACCOUNT_SIZE,
  AMOEBA_DLMM_SHARE_PAGE_DISCRIMINATOR,
  AMOEBA_SPREAD_PROGRAM_ID,
  decodeAmoebaDlmmBinPage,
  decodeAmoebaDlmmPool,
  decodeAmoebaDlmmPosition,
  decodeAmoebaDlmmSharePage,
} from "@amoeba/spread-release-tools/dlmm-accounts";
import {
  buildDecompressAmoebaDlmmLightStateInstruction as buildHistoricalDecompressAmoebaDlmmLightStateInstruction,
} from "@amoeba/spread-historical-rc44/dlmm-instructions";
import type {
  AmoebaDlmmColdAccountLoad,
} from "@amoeba/spread-release-tools/dlmm-light-interface";
import {
  buildRequiredCompressedStateInstructionV1,
  decodeCompressedAmebaStateLeaf,
  deriveCompressedStateAddressV1,
  requiredCompressedStateAccessesV1,
} from "@amoeba/spread-release-tools/compressed-state";
import {
  buildRequiredCompressedStateInstructionV1 as buildHistoricalRequiredCompressedStateInstructionV1,
} from "@amoeba/spread-historical-rc44/compressed-state";
import { isCurrentWriteReleaseAvailable } from "./release-train.js";
import {
  cloneCurrentSpreadInstructionPreservingRegistrationV1,
  governedCurrentSpreadInstructionViewsV1,
  registerCurrentSpreadGovernedOutputV1,
  revalidateFreshCurrentGovernedInstructionsV1,
  semanticCurrentSpreadInstructionV1,
} from "./current-governed-write-internal.js";
import { buildCurrentGovernedInstructionV1 } from "./current-governed-write.js";
import {
  PackedAccountRegistry,
  activeOutputTreeKey,
} from "@amoeba/spread-release-tools/compressed-state";
import type {
  CompressedAmebaStateLeaf,
  CompressedStateDomain,
} from "@amoeba/spread-release-tools/compressed-state";
import {
  buildLightAtaReadyActionPlan as buildReferenceLightAtaReadyActionPlan,
  type CreateLightAtaLoadInstructions,
  type LightAtaLoadRequest,
  type LightAtaReadyActionPlan,
  type LightRpc,
} from "@amoeba/spread-release-tools/reference-client";

const CURRENT_PHOTON_COMMITMENT = "finalized" as const;
const CURRENT_PHOTON_MAX_OWNER_ACCOUNTS = 256;
const CURRENT_PHOTON_ATOMIC_HANDOFF_MS = 30_000;
const CURRENT_PHOTON_MAX_RPC_RESPONSE_BYTES = 16 * 1024 * 1024;
const CURRENT_PHOTON_ADDRESS_TREE = new PublicKey(batchAddressTree);
// Light's Devnet AddressV2 tree is also its queue account.
const CURRENT_PHOTON_ADDRESS_QUEUE = new PublicKey(batchAddressTree);

interface CurrentPhotonStateTreeContext {
  readonly tree: PublicKey;
  readonly queue: PublicKey;
  readonly cpiContext: PublicKey;
}

const CURRENT_PHOTON_STATE_TREE_CONTEXTS: readonly CurrentPhotonStateTreeContext[] = Object.freeze([
  Object.freeze({ tree: new PublicKey(batchMerkleTree1), queue: new PublicKey(batchQueue1), cpiContext: new PublicKey(batchCpiContext1) }),
  Object.freeze({ tree: new PublicKey(batchMerkleTree2), queue: new PublicKey(batchQueue2), cpiContext: new PublicKey(batchCpiContext2) }),
  Object.freeze({ tree: new PublicKey(batchMerkleTree3), queue: new PublicKey(batchQueue3), cpiContext: new PublicKey(batchCpiContext3) }),
  Object.freeze({ tree: new PublicKey(batchMerkleTree4), queue: new PublicKey(batchQueue4), cpiContext: new PublicKey(batchCpiContext4) }),
  Object.freeze({ tree: new PublicKey(batchMerkleTree5), queue: new PublicKey(batchQueue5), cpiContext: new PublicKey(batchCpiContext5) }),
]);

const CURRENT_PHOTON_STATE_TREE_CONTEXT_BY_TREE = new Map(
  CURRENT_PHOTON_STATE_TREE_CONTEXTS.map((context) => [context.tree.toBase58(), context] as const),
);

const CURRENT_LIGHT_FIXED_SYSTEM_METAS: readonly {
  readonly address: PublicKey;
  readonly isWritable: boolean;
}[] = Object.freeze([
  Object.freeze({ address: new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7"), isWritable: false }),
  Object.freeze({ address: CURRENT_SPREAD_LIGHT_CPI_AUTHORITY, isWritable: false }),
  Object.freeze({ address: new PublicKey("35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh"), isWritable: false }),
  Object.freeze({ address: new PublicKey("HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA"), isWritable: false }),
  Object.freeze({ address: new PublicKey("compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq"), isWritable: false }),
  Object.freeze({ address: SystemProgram.programId, isWritable: false }),
]);

export const CURRENT_PHOTON_ERROR_CODES = Object.freeze([
  "CURRENT_PHOTON_URL_INVALID",
  "CURRENT_PHOTON_PROVIDER_UNAUTHORIZED",
  "CURRENT_PHOTON_ENDPOINTS_NOT_SEPARATE",
  "CURRENT_PHOTON_STATE_COMMITMENT_INVALID",
  "CURRENT_PHOTON_GENESIS_MISMATCH",
  "CURRENT_PHOTON_ADDRESS_TREE_MISMATCH",
  "CURRENT_PHOTON_STATE_TREE_TOPOLOGY_MISMATCH",
  "CURRENT_PHOTON_RPC_UNAVAILABLE",
  "CURRENT_PHOTON_STATE_RPC_UNAVAILABLE",
  "CURRENT_PHOTON_ACCOUNT_INVALID",
  "CURRENT_PHOTON_PROOF_INVALID",
  "CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID",
  "CURRENT_PHOTON_OWNER_QUERY_INVALID",
  "CURRENT_PHOTON_OWNER_QUERY_BOUND_EXCEEDED",
  "LIGHT_PROOF_UNAVAILABLE",
] as const);

export type CurrentPhotonErrorCode = (typeof CURRENT_PHOTON_ERROR_CODES)[number];

export class CurrentPhotonError extends AmebaSdkError {
  constructor(
    code: CurrentPhotonErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Record<string, string | number | boolean | null>;
    } = {},
  ) {
    super(message, {
      code,
      cause: options.cause,
      details: options.details,
      retryable: code === "CURRENT_PHOTON_RPC_UNAVAILABLE"
        || code === "CURRENT_PHOTON_STATE_RPC_UNAVAILABLE"
        || code === "LIGHT_PROOF_UNAVAILABLE",
    });
  }
}

export interface CreateCurrentPhotonConnectionInput {
  /** Trusted packaged native verifier for authoritative reads; ordinary transaction transport does not require it. */
  readonly compressedEvidenceVerifier?: CurrentCompressedEvidenceVerifier;
  /** Dedicated Light/Photon endpoint. Its full validated href is retained only by the private RPC transport. */
  readonly photonRpcUrl: string;
  /** Explicitly authorized lowercase SHA-256 of the credential-free `new URL(photonRpcUrl).origin`. */
  readonly authorizedProviderOriginSha256: string;
  /** Standard Solana state transport, constructed with commitment `finalized`. */
  readonly stateConnection: Connection;
  /**
   * Server-only exception for one private Helius Devnet URL that serves both
   * standard state and Light/Photon methods. This must be the literal `true`;
   * equal-origin generic providers remain rejected.
   */
  readonly allowUnifiedPrivateHeliusProvider?: true;
  /** Host-provided Light proof loader; the SDK never assumes a local signer or hidden proof client. */
  readonly createLightAtaLoadInstructions: CreateLightAtaLoadInstructions;
}

export interface CurrentPhotonStateTreeIdentity {
  readonly stateTree: string;
  readonly queue: string;
  readonly cpiContext: string;
}

export interface CurrentPhotonTopology {
  readonly addressTree: string;
  readonly addressQueue: string;
  readonly stateTrees: readonly CurrentPhotonStateTreeIdentity[];
}

export type CurrentAmoebaDlmmColdStateKind = "pool" | "reserve_page" | "share_page" | "position";

/** JSON-safe facts shared by proof-only and payer-bound cold observations. */
export interface CurrentPhotonColdWitnessFacts {
  readonly providerOriginSha256: string;
  readonly kind: CurrentAmoebaDlmmColdStateKind;
  readonly canonicalAddress: string;
  readonly compressedAddress: string;
  readonly owner: string;
  readonly discriminatorBase64: string;
  readonly dataSha256: string;
  readonly bodyDataHash: string;
  readonly addressTree: string;
  readonly addressQueue: string;
  readonly stateTree: string;
  readonly queue: string;
  readonly cpiContext: string;
  readonly leafHash: string;
  readonly leafIndex: string;
  readonly root: string;
  readonly rootIndex: string;
  readonly proveByIndex: boolean;
  readonly proofContextSlot: string;
  readonly stateFinalizedSlot: string;
  readonly proofSha256: string;
}

/** Ownerless authenticated observation for reads, discovery, and readiness. */
export interface CurrentPhotonColdProofWitness extends CurrentPhotonColdWitnessFacts {
  readonly mode: "proof_only";
  readonly witnessDigest: string;
}

/** Operation-scoped witness additionally bound to one payer and exact tag-219 manifest. */
export interface CurrentPhotonColdLoadWitness extends CurrentPhotonColdWitnessFacts {
  readonly mode: "load";
  readonly payer: string;
  readonly proofWitnessDigest: string;
  readonly loadInstructionSha256: string;
  readonly witnessDigest: string;
}

export type CurrentPhotonColdWitness = CurrentPhotonColdProofWitness | CurrentPhotonColdLoadWitness;

export interface CurrentPhotonColdProofObservation {
  readonly kind: CurrentAmoebaDlmmColdStateKind;
  readonly canonicalAddress: PublicKey;
  readonly compressedAddress: PublicKey;
  readonly data: Buffer;
  readonly owner: PublicKey;
  readonly compressedAccount: CompressedAccountWithMerkleContext;
  readonly validityProof: WithContext<ValidityProofWithContext>;
  readonly witness: CurrentPhotonColdProofWitness;
}

export interface CurrentPhotonColdLoadObservation extends AmoebaDlmmColdAccountLoad {
  readonly kind: CurrentAmoebaDlmmColdStateKind;
  readonly payer: PublicKey;
  readonly canonicalAddress: PublicKey;
  readonly compressedAddress: PublicKey;
  readonly compressedAccount: CompressedAccountWithMerkleContext;
  readonly validityProof: WithContext<ValidityProofWithContext>;
  readonly witness: CurrentPhotonColdLoadWitness;
}

export interface CurrentPhotonOwnerQueryConfig {
  /** Mandatory bounded page size. Values above 256 fail closed. */
  readonly limit: BN254;
  readonly filters?: GetCompressedAccountsFilter[];
}

/** Authorized Photon statement bound to the current tree topology and finalized read floor.
 * Groth16/root verification occurs in Light CPI at execution, not in this reader.
 */
export interface CurrentPhotonCompressedStateWitness {
  readonly evidenceTrust: "authorized_photon_provider";
  readonly proofVerification: "onchain_at_execution";
  readonly finalizedRootVerified: false;
  readonly proofBase64: string;
  readonly proofStatementJson: string;
  readonly providerOriginSha256: string;
  readonly canonicalPda: string;
  readonly compressedAddress: string;
  readonly domain: number;
  readonly revision: string;
  readonly dataSha256: string;
  readonly stateTree: string;
  readonly queue: string;
  readonly cpiContext: string;
  readonly leafHash: string;
  readonly leafIndex: string;
  readonly root: string;
  readonly rootIndex: string;
  readonly proveByIndex: boolean;
  readonly proofContextSlot: string;
  readonly stateFinalizedSlot: string;
  readonly proofSha256: string;
  readonly witnessDigest: string;
}

export interface CurrentPhotonCompressedStateObservation {
  readonly canonicalPda: PublicKey;
  readonly compressedAddress: PublicKey;
  readonly leaf: CompressedAmebaStateLeaf;
  readonly witness: CurrentPhotonCompressedStateWitness;
}

/** An authorized-provider address-proof statement; RPC null alone is not nonmembership. */
export interface CurrentPhotonCompressedNonmembershipWitness {
  readonly evidenceTrust: "authorized_photon_provider";
  readonly proofVerification: "onchain_at_execution";
  readonly finalizedRootVerified: false;
  readonly proofBase64: string;
  readonly proofStatementJson: string;
  readonly canonicalPda: string;
  readonly compressedAddress: string;
  readonly domain: number;
  readonly providerOriginSha256: string;
  readonly addressTree: string;
  readonly addressQueue: string;
  readonly root: string;
  readonly rootIndex: string;
  readonly proofContextSlot: string;
  readonly stateFinalizedSlot: string;
  readonly proofSha256: string;
  readonly witnessDigest: string;
}

export type CurrentPhotonCompressedStateEvidence =
  | { readonly exists: true; readonly observation: CurrentPhotonCompressedStateObservation }
  | { readonly exists: false; readonly witness: CurrentPhotonCompressedNonmembershipWitness };

interface CurrentPhotonCompressedStateAccessFactBase {
  readonly domain: number;
  readonly accountIndex: number;
  readonly proofIndex: number;
  readonly canonicalPda: string;
  readonly compressedAddress: string;
}

export type CurrentPhotonCompressedStateAccessFact =
  | CurrentPhotonCompressedStateAccessFactBase & {
      readonly kind: "readOnly";
      readonly treeInfo: CurrentPackedStateTreeInfo;
      readonly revision: string;
      readonly compactDataBase64: string;
    }
  | CurrentPhotonCompressedStateAccessFactBase & {
      readonly kind: "mutable";
      readonly treeInfo: CurrentPackedStateTreeInfo;
      readonly outputStateTreeIndex: number;
      readonly revision: string;
      readonly compactDataBase64: string;
    }
  | CurrentPhotonCompressedStateAccessFactBase & {
      readonly kind: "initialize";
      readonly addressTreeAccountIndex: number;
      readonly addressQueueAccountIndex: number;
      readonly addressRootIndex: number;
      readonly outputStateTreeIndex: number;
    };

export interface CurrentPhotonCompressedCoreAccountFact {
  readonly address: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export type CurrentPhotonCompressedProofTreeFact =
  | {
      readonly kind: "state_v2";
      readonly stateTree: string;
      readonly queue: string;
      readonly cpiContext: string;
    }
  | {
      readonly kind: "address_v2";
      readonly stateTree: string;
      readonly queue: string;
      readonly cpiContext: null;
    };

/** Exact combined-proof facts for one outer ExecuteCompressedStateV1 instruction. */
export interface CurrentPhotonCompressedInstructionWitness {
  readonly providerOriginSha256: string;
  readonly marketSeriesId: string;
  readonly addressTree: string;
  readonly addressQueue: string;
  readonly outputStateTree: string;
  readonly outputQueue: string;
  readonly proofContextSlot: string;
  readonly stateFinalizedSlot: string;
  readonly roots: readonly string[];
  readonly rootIndices: readonly string[];
  readonly leafIndices: readonly string[];
  readonly treeInfos: readonly CurrentPhotonCompressedProofTreeFact[];
  readonly proofSha256: string;
  readonly logicalInstructionSha256: string;
  readonly outerInstructionSha256: string;
  readonly coreAccountCount: number;
  readonly rentPayerIndex: number;
  readonly coreAccounts: readonly CurrentPhotonCompressedCoreAccountFact[];
  readonly accesses: readonly CurrentPhotonCompressedStateAccessFact[];
  readonly observationWitnessDigests: readonly string[];
  readonly existingAccessCount: number;
  readonly initializeAccessCount: number;
  readonly witnessDigest: string;
}

export interface CurrentPhotonPreparedCompressedInstruction {
  readonly instruction: TransactionInstruction;
  readonly witness: CurrentPhotonCompressedInstructionWitness;
}

export interface CurrentPhotonConnection {
  readonly providerOriginSha256: string;
  readonly commitment: typeof CURRENT_PHOTON_COMMITMENT;
  readonly topology: CurrentPhotonTopology;
  readonly stateConnection: Connection;
  getCompressedAccount(
    address?: BN254,
    hash?: BN254,
  ): Promise<CompressedAccountWithMerkleContext | null>;
  getValidityProofAndRpcContext(
    hashes: HashWithTree[],
    newAddresses: AddressWithTree[],
  ): Promise<WithContext<ValidityProofWithContext>>;
  getCompressedAccountsByOwner(
    owner: PublicKey,
    config: CurrentPhotonOwnerQueryConfig,
  ): Promise<WithCursor<CompressedAccountWithMerkleContext[]>>;
  /** Authenticates current cold bytes and proof without creating a payer-bound load instruction. */
  observeCurrentColdAccount(address: PublicKey): Promise<CurrentPhotonColdProofObservation | null>;
  /** Authenticates one canonical current Spread compact-state domain at a finalized Light root. */
  observeCurrentCompressedState(input: {
    readonly canonicalPda: PublicKey;
    readonly domain: CompressedStateDomain;
  }): Promise<CurrentPhotonCompressedStateObservation | null>;
  observeCurrentCompressedStateEvidence(input: {
    readonly canonicalPda: PublicKey;
    readonly domain: CompressedStateDomain;
  }): Promise<CurrentPhotonCompressedStateEvidence>;
  /** Authoritative current/unspent inclusion or nonmembership; never falls back to provider assertions. */
  observeCurrentVerifiedCompressedStateEvidence(input: {
    readonly canonicalPda: PublicKey; readonly domain: CompressedStateDomain; readonly minimumContextSlot?: number;
  }): Promise<CurrentPhotonVerifiedCompressedStateEvidence>;
  /** Builds and authenticates the sole current outer tag-205 transport for one logical action. */
  prepareCurrentCompressedStateInstruction(input: {
    readonly innerInstruction: TransactionInstruction;
    readonly marketSeriesId: string;
    readonly expectedObservations: readonly CurrentPhotonCompressedStateObservation[];
  }): Promise<CurrentPhotonPreparedCompressedInstruction>;
  /** Creates an isolated operation view whose tag-219 signer and atomic cache are bound to this payer only. */
  forPayer(payer: PublicKey | string): CurrentPhotonPayerResolver;
}

export interface CurrentPhotonPayerResolver {
  readonly payer: string;
  readonly providerOriginSha256: string;
  readonly commitment: typeof CURRENT_PHOTON_COMMITMENT;
  readonly topology: CurrentPhotonTopology;
  getCompressedAccount(
    address?: BN254,
    hash?: BN254,
  ): Promise<CompressedAccountWithMerkleContext | null>;
  getValidityProofAndRpcContext(
    hashes: HashWithTree[],
    newAddresses: AddressWithTree[],
  ): Promise<WithContext<ValidityProofWithContext>>;
  /** Structural compatibility with the current DLMM planner; it is backed only by the atomic observation below. */
  resolveColdAccount(address: PublicKey): Promise<AmoebaDlmmColdAccountLoad | null>;
  /** Fetches account, proof, finalized slot, and exact load instruction as one bound observation. */
  resolveCurrentColdAccount(address: PublicKey): Promise<CurrentPhotonColdLoadObservation | null>;
  /** Reads the exact unified balance for one canonical owner/mint ATA through the attested Photon transport. */
  inspectLightAta(input: {
    readonly ata: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
  }): Promise<CurrentPhotonLightAtaBalance | null>;
  /** Builds the current Light-token ATA load/create batches without exposing the credentialed raw RPC. */
  buildLightAtaReadyActionPlan(input: {
    readonly tokenAccounts: readonly LightAtaLoadRequest[];
    readonly actionInstructions: readonly TransactionInstruction[];
  }): Promise<LightAtaReadyActionPlan>;
}

export interface CurrentPhotonLightAtaBalance {
  readonly ata: string;
  readonly owner: string;
  readonly mint: string;
  readonly amountAtomic: string;
  readonly includesColdBalance: boolean;
  readonly providerOriginSha256: string;
  readonly payer: string;
}

interface CurrentPhotonEndpoint {
  readonly href: string;
  readonly origin: string;
  readonly privateHeliusDevnet: boolean;
}

const currentPhotonProviderHrefDigests = new Map<string, number>();
let currentPhotonFetchDelegate: typeof globalThis.fetch | undefined;

function fetchInputHref(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(input).href;
    return new URL(input.url).href;
  } catch {
    return null;
  }
}

async function boundedCurrentPhotonResponse(response: Response): Promise<Response> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > CURRENT_PHOTON_MAX_RPC_RESPONSE_BYTES) {
      throw new TypeError("Current Photon provider response exceeds its byte bound");
    }
  }
  if (response.body === null) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CURRENT_PHOTON_MAX_RPC_RESPONSE_BYTES) {
        await reader.cancel("current Photon provider response byte bound exceeded");
        throw new TypeError("Current Photon provider response exceeds its byte bound");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const currentPhotonGuardedFetch: typeof globalThis.fetch = async (input, init) => {
  const delegate = currentPhotonFetchDelegate;
  if (delegate === undefined) {
    throw new TypeError("Current Photon provider fetch is unavailable");
  }
  const href = fetchInputHref(input);
  if (href === null || !currentPhotonProviderHrefDigests.has(hashHex(href))) {
    return delegate(input, init);
  }
  const response = await delegate(input, { ...init, redirect: "manual" });
  if (
    response.redirected
    || response.type === "opaqueredirect"
    || (response.status >= 300 && response.status < 400)
  ) {
    throw new TypeError("Current Photon provider redirects are not permitted");
  }
  let responseHref: string;
  try {
    responseHref = new URL(response.url).href;
  } catch {
    throw new TypeError("Current Photon provider response URL is unavailable");
  }
  if (hashHex(responseHref) !== hashHex(href)) {
    throw new TypeError("Current Photon provider response URL changed");
  }
  return boundedCurrentPhotonResponse(response);
};

function enterCurrentPhotonFetchGuard(endpoint: CurrentPhotonEndpoint): string {
  const digest = hashHex(endpoint.href);
  if (currentPhotonFetchDelegate === undefined) {
    if (typeof globalThis.fetch !== "function") {
      throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon provider fetch is unavailable");
    }
    currentPhotonFetchDelegate = globalThis.fetch;
    try {
      globalThis.fetch = currentPhotonGuardedFetch;
    } catch {
      currentPhotonFetchDelegate = undefined;
      throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon redirect guard could not be installed");
    }
  }
  if (globalThis.fetch !== currentPhotonGuardedFetch) {
    throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon redirect guard is unavailable");
  }
  currentPhotonProviderHrefDigests.set(
    digest,
    (currentPhotonProviderHrefDigests.get(digest) ?? 0) + 1,
  );
  return digest;
}

function leaveCurrentPhotonFetchGuard(digest: string): void {
  const count = currentPhotonProviderHrefDigests.get(digest);
  if (count === undefined) {
    throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon redirect guard state is invalid");
  }
  if (count === 1) currentPhotonProviderHrefDigests.delete(digest);
  else currentPhotonProviderHrefDigests.set(digest, count - 1);
  if (currentPhotonProviderHrefDigests.size !== 0) return;
  const delegate = currentPhotonFetchDelegate;
  currentPhotonFetchDelegate = undefined;
  if (globalThis.fetch !== currentPhotonGuardedFetch || delegate === undefined) {
    throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon redirect guard was replaced");
  }
  try {
    globalThis.fetch = delegate;
  } catch {
    throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon redirect guard could not be restored");
  }
}

async function withCurrentPhotonFetchGuard<T>(
  endpoint: CurrentPhotonEndpoint,
  action: () => Promise<T>,
): Promise<T> {
  const digest = enterCurrentPhotonFetchGuard(endpoint);
  try {
    return await action();
  } finally {
    leaveCurrentPhotonFetchGuard(digest);
  }
}

interface ValidatedColdAccount {
  readonly kind: CurrentAmoebaDlmmColdStateKind;
  readonly kindTag: number;
  readonly discriminator: Buffer;
  readonly body: Buffer;
  readonly data: Buffer;
  readonly bodyDataHash: Buffer;
  readonly treeContext: CurrentPhotonStateTreeContext;
}

interface InternalColdProofObservation {
  readonly kind: CurrentAmoebaDlmmColdStateKind;
  readonly canonicalAddress: PublicKey;
  readonly compressedAddress: PublicKey;
  readonly data: Buffer;
  readonly owner: PublicKey;
  readonly compressedAccount: CompressedAccountWithMerkleContext;
  readonly validityProof: WithContext<ValidityProofWithContext>;
  readonly validated: ValidatedColdAccount;
  readonly proof: ValidityProof;
  readonly rootIndex: number;
  readonly witness: CurrentPhotonColdProofWitness;
}

interface InternalColdLoadObservation extends Omit<InternalColdProofObservation, "witness"> {
  readonly payer: PublicKey;
  readonly instruction: TransactionInstruction;
  readonly witness: CurrentPhotonColdLoadWitness;
}

interface AtomicHandoff {
  readonly observation: InternalColdLoadObservation;
  readonly compressedKey: string;
  readonly hashKey: string;
  readonly expiresAt: number;
  compressedServed: boolean;
  proofServed: boolean;
}

function photonError(
  code: CurrentPhotonErrorCode,
  message: string,
  options: ConstructorParameters<typeof CurrentPhotonError>[2] = {},
): CurrentPhotonError {
  return new CurrentPhotonError(code, message, options);
}

function parseCurrentPhotonEndpoint(value: string, label: string): CurrentPhotonEndpoint {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    // URL parser errors can echo the input, so never retain them as an error cause.
    void cause;
    throw photonError("CURRENT_PHOTON_URL_INVALID", `${label} must be an HTTPS Devnet RPC URL`);
  }
  const hostname = url.hostname.replace(/\.$/u, "").toLowerCase();
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || /mainnet|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(hostname)
    || [
      "api.devnet.solana.com",
      "api.testnet.solana.com",
      "api.mainnet-beta.solana.com",
    ].includes(hostname)
  ) {
    throw photonError("CURRENT_PHOTON_URL_INVALID", `${label} must be an HTTPS non-mainnet, non-local RPC URL`);
  }
  const apiKeys = url.searchParams.getAll("api-key");
  const privateHeliusDevnet = hostname === "devnet.helius-rpc.com"
    && (url.pathname === "/" || url.pathname === "")
    && url.hash === ""
    && apiKeys.length === 1
    && apiKeys[0]!.length > 0;
  return Object.freeze({
    href: url.href,
    origin: url.origin,
    privateHeliusDevnet,
  });
}

function unifiedPrivateHeliusProviderAllowed(
  input: CreateCurrentPhotonConnectionInput,
  photonEndpoint: CurrentPhotonEndpoint,
  stateEndpoint: CurrentPhotonEndpoint,
): boolean {
  return input.allowUnifiedPrivateHeliusProvider === true
    && photonEndpoint.href === stateEndpoint.href
    && photonEndpoint.privateHeliusDevnet
    && stateEndpoint.privateHeliusDevnet
    && input.stateConnection.commitment === CURRENT_PHOTON_COMMITMENT;
}

function parsePayer(value: PublicKey | string): PublicKey {
  try {
    const payer = typeof value === "string" ? new PublicKey(value) : value;
    if (payer.equals(SystemProgram.programId)) {
      throw new Error("zero public key");
    }
    return payer;
  } catch (cause) {
    throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "tag-219 payer is not a nonzero Solana public key", { cause });
  }
}

function cloneTreeInfo(info: TreeInfo): TreeInfo {
  return {
    tree: new PublicKey(info.tree),
    queue: new PublicKey(info.queue),
    treeType: info.treeType,
    ...(info.cpiContext === undefined ? {} : { cpiContext: new PublicKey(info.cpiContext) }),
    nextTreeInfo: info.nextTreeInfo === null ? null : cloneTreeInfo(info.nextTreeInfo),
  };
}

function cloneCompressedAccount(account: CompressedAccountWithMerkleContext): CompressedAccountWithMerkleContext {
  return {
    owner: new PublicKey(account.owner),
    lamports: account.lamports.clone(),
    address: account.address === null ? null : [...account.address],
    data: account.data === null ? null : {
      discriminator: [...account.data.discriminator],
      data: Buffer.from(account.data.data),
      dataHash: [...account.data.dataHash],
    },
    treeInfo: cloneTreeInfo(account.treeInfo),
    hash: account.hash.clone(),
    leafIndex: account.leafIndex,
    proveByIndex: account.proveByIndex,
    readOnly: account.readOnly,
  };
}

function cloneValidityProof(
  proof: WithContext<ValidityProofWithContext>,
): WithContext<ValidityProofWithContext> {
  return {
    context: { slot: proof.context.slot },
    value: {
      compressedProof: proof.value.compressedProof === null ? null : {
        a: [...proof.value.compressedProof.a],
        b: [...proof.value.compressedProof.b],
        c: [...proof.value.compressedProof.c],
      },
      roots: proof.value.roots.map((root) => root.clone()),
      rootIndices: [...proof.value.rootIndices],
      leafIndices: [...proof.value.leafIndices],
      leaves: proof.value.leaves.map((leaf) => leaf.clone()),
      treeInfos: proof.value.treeInfos.map(cloneTreeInfo),
      proveByIndices: [...proof.value.proveByIndices],
    },
  };
}

function cloneInstruction(instruction: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.keys.map((meta) => ({
      pubkey: new PublicKey(meta.pubkey),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    data: Buffer.from(instruction.data),
  });
}

function bnKey(value: BN254): string {
  return value.toString(16).padStart(64, "0");
}

function bnHex(value: BN254): string {
  if (value.isNeg() || value.byteLength() > 32) {
    throw photonError("CURRENT_PHOTON_PROOF_INVALID", "Light field value is outside 32 bytes");
  }
  return value.toArrayLike(Buffer, "be", 32).toString("hex");
}

function hashHex(...parts: readonly (Uint8Array | string)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function currentOutputStateTreeIndex(marketSeriesId: string): number {
  if (!/^[A-Z0-9]+-[0-9]{6}-(?:CALL|PUT)-[0-9]{2}$/.test(marketSeriesId)) {
    throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed-state market series id is not canonical");
  }
  const digest = createHash("sha256")
    .update("ameba-spread-v2-light-state-tree-selection-v1\0", "utf8")
    .update(marketSeriesId, "utf8")
    .digest();
  return digest.readUInt32LE(0) % CURRENT_PHOTON_STATE_TREE_CONTEXTS.length;
}

function instructionSha256(instruction: TransactionInstruction): string {
  const hash = createHash("sha256");
  hash.update(instruction.programId.toBuffer());
  hash.update(Buffer.from(instruction.data));
  for (const meta of instruction.keys) {
    hash.update(meta.pubkey.toBuffer());
    hash.update(Buffer.from([Number(meta.isSigner), Number(meta.isWritable)]));
  }
  return hash.digest("hex");
}

function exactCombinedValidityProof(input: {
  readonly hashes: readonly HashWithTree[];
  readonly newAddresses: readonly AddressWithTree[];
  readonly response: WithContext<ValidityProofWithContext>;
  readonly stateFinalizedSlot: number;
  readonly existingAccountsByHash: ReadonlyMap<string, CompressedAccountWithMerkleContext>;
}): void {
  const total = input.hashes.length + input.newAddresses.length;
  const value = input.response.value;
  if (
    total < 1
    || total > 8
    || !Number.isSafeInteger(input.response.context.slot)
    || input.response.context.slot < 1
    || !Number.isSafeInteger(input.stateFinalizedSlot)
    || input.stateFinalizedSlot < input.response.context.slot
    || value.compressedProof === null
    || value.roots.length !== total
    || value.rootIndices.length !== total
    || value.leafIndices.length !== total
    || value.leaves.length !== total
    || value.treeInfos.length !== total
    || value.proveByIndices.length !== total
  ) {
    throw photonError("CURRENT_PHOTON_PROOF_INVALID", "combined compressed-state proof shape or finalized slot is invalid");
  }
  exactByteArray(value.compressedProof.a, 32, "combined validity proof A");
  exactByteArray(value.compressedProof.b, 64, "combined validity proof B");
  exactByteArray(value.compressedProof.c, 32, "combined validity proof C");
  for (let index = 0; index < total; index += 1) {
    const root = value.roots[index];
    const rootIndex = value.rootIndices[index];
    const leafIndex = value.leafIndices[index];
    const proveByIndex = value.proveByIndices[index];
    const tree = value.treeInfos[index];
    if (
      root === undefined
      || root.isZero()
      || rootIndex === undefined
      || !Number.isInteger(rootIndex)
      || rootIndex < 0
      || rootIndex > 0xffff
      || leafIndex === undefined
      || !Number.isSafeInteger(leafIndex)
      || leafIndex < 0
      || leafIndex > 0xffff_ffff
      || typeof proveByIndex !== "boolean"
      || tree === undefined
    ) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "combined compressed-state root context is invalid");
    }
    bnHex(root);
    if (index < input.hashes.length) {
      const requested = input.hashes[index]!;
      const account = input.existingAccountsByHash.get(bnKey(requested.hash));
      exactTreeContext(tree);
      if (
        account === undefined
        || !tree.tree.equals(requested.tree)
        || !tree.queue.equals(requested.queue)
        || !value.leaves[index]!.eq(requested.hash)
        || leafIndex !== account.leafIndex
        || proveByIndex !== account.proveByIndex
      ) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "combined inclusion proof does not bind its requested leaf/tree/queue");
      }
    } else {
      const requested = input.newAddresses[index - input.hashes.length]!;
      if (
        tree.treeType !== TreeType.AddressV2
        || !tree.tree.equals(CURRENT_PHOTON_ADDRESS_TREE)
        || !tree.queue.equals(CURRENT_PHOTON_ADDRESS_QUEUE)
        || !tree.tree.equals(requested.tree)
        || !tree.queue.equals(requested.queue)
        || !value.leaves[index]!.isZero()
      ) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "combined non-inclusion proof does not bind the canonical address tree");
      }
    }
  }
}

function publicTopology(): CurrentPhotonTopology {
  return Object.freeze({
    addressTree: CURRENT_PHOTON_ADDRESS_TREE.toBase58(),
    addressQueue: CURRENT_PHOTON_ADDRESS_QUEUE.toBase58(),
    stateTrees: Object.freeze(CURRENT_PHOTON_STATE_TREE_CONTEXTS.map((context) => Object.freeze({
      stateTree: context.tree.toBase58(),
      queue: context.queue.toBase58(),
      cpiContext: context.cpiContext.toBase58(),
    }))),
  });
}

function validateCurrentPhotonTopology(addressTreeInfo: TreeInfo, stateTreeInfos: readonly TreeInfo[]): void {
  if (
    addressTreeInfo.treeType !== TreeType.AddressV2
    || !addressTreeInfo.tree.equals(CURRENT_PHOTON_ADDRESS_TREE)
    || !addressTreeInfo.queue.equals(CURRENT_PHOTON_ADDRESS_QUEUE)
  ) {
    throw photonError(
      "CURRENT_PHOTON_ADDRESS_TREE_MISMATCH",
      "Light/Photon AddressV2 tree or queue is not the canonical Devnet address space",
    );
  }

  for (const expected of CURRENT_PHOTON_STATE_TREE_CONTEXTS) {
    const matches = stateTreeInfos.filter((candidate) => candidate.tree.equals(expected.tree));
    const actual = matches[0];
    if (
      matches.length !== 1
      || actual === undefined
      || actual.treeType !== TreeType.StateV2
      || !actual.queue.equals(expected.queue)
      || actual.cpiContext === undefined
      || !actual.cpiContext.equals(expected.cpiContext)
    ) {
      throw photonError(
        "CURRENT_PHOTON_STATE_TREE_TOPOLOGY_MISMATCH",
        "Light/Photon is missing an exact authorized StateV2 tree/queue/CPI-context tuple",
        { details: { stateTree: expected.tree.toBase58() } },
      );
    }
  }
}

function exactTreeContext(info: TreeInfo): CurrentPhotonStateTreeContext {
  const expected = CURRENT_PHOTON_STATE_TREE_CONTEXT_BY_TREE.get(info.tree.toBase58());
  if (
    expected === undefined
    || info.treeType !== TreeType.StateV2
    || !info.queue.equals(expected.queue)
    || info.cpiContext === undefined
    || !info.cpiContext.equals(expected.cpiContext)
  ) {
    throw photonError(
      "CURRENT_PHOTON_ACCOUNT_INVALID",
      "compressed account is outside the authorized StateV2 tree/queue/CPI-context set",
    );
  }
  return expected;
}

function exactByteArray(value: readonly number[], expectedLength: number, label: string): Buffer {
  if (
    value.length !== expectedLength
    || value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)
  ) {
    throw photonError("CURRENT_PHOTON_PROOF_INVALID", `${label} is not exactly ${expectedLength} bytes`);
  }
  return Buffer.from(value);
}

function currentColdStateShape(discriminator: Buffer, bodyLength: number): {
  readonly kind: CurrentAmoebaDlmmColdStateKind;
  readonly kindTag: number;
} {
  if (discriminator.equals(AMOEBA_DLMM_POOL_DISCRIMINATOR) && bodyLength === AMOEBA_DLMM_POOL_ACCOUNT_SIZE - 8) {
    return { kind: "pool", kindTag: 0 };
  }
  if (discriminator.equals(AMOEBA_DLMM_BIN_PAGE_DISCRIMINATOR) && bodyLength === AMOEBA_DLMM_BIN_PAGE_ACCOUNT_SIZE - 8) {
    return { kind: "reserve_page", kindTag: 1 };
  }
  if (discriminator.equals(AMOEBA_DLMM_SHARE_PAGE_DISCRIMINATOR) && bodyLength === AMOEBA_DLMM_SHARE_PAGE_ACCOUNT_SIZE - 8) {
    return { kind: "share_page", kindTag: 2 };
  }
  if (discriminator.equals(AMOEBA_DLMM_POSITION_DISCRIMINATOR) && bodyLength === AMOEBA_DLMM_POSITION_ACCOUNT_SIZE - 8) {
    return { kind: "position", kindTag: 3 };
  }
  throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed account is not an exact current Amoeba DLMM layout");
}

function validateCurrentColdAccount(
  canonicalAddress: PublicKey,
  compressedAddress: PublicKey,
  account: CompressedAccountWithMerkleContext,
): ValidatedColdAccount {
  const treeContext = exactTreeContext(account.treeInfo);
  if (
    !account.owner.equals(AMOEBA_SPREAD_PROGRAM_ID)
    || account.address === null
    || !Buffer.from(account.address).equals(compressedAddress.toBuffer())
    || account.data === null
    || account.readOnly
    || !account.lamports.isZero()
    || account.hash.isZero()
    || !Number.isSafeInteger(account.leafIndex)
    || account.leafIndex < 0
    || account.leafIndex > 0xffff_ffff
  ) {
    throw photonError(
      "CURRENT_PHOTON_ACCOUNT_INVALID",
      "compressed DLMM address, owner, mutability, lamports, hash, or leaf index is invalid",
    );
  }
  const discriminator = exactByteArray(account.data.discriminator, 8, "compressed account discriminator");
  const body = Buffer.from(account.data.data);
  const shape = currentColdStateShape(discriminator, body.length);
  const expectedCompressedInfo = Buffer.alloc(24);
  expectedCompressedInfo[14] = 2;
  if (!body.subarray(body.length - expectedCompressedInfo.length).equals(expectedCompressedInfo)) {
    throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed DLMM state does not carry the exact compressed CompressionInfo");
  }
  const bodyDataHash = createHash("sha256").update(body).digest();
  bodyDataHash[0] = 0;
  if (!exactByteArray(account.data.dataHash, 32, "compressed account body hash").equals(bodyDataHash)) {
    throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed DLMM body hash is invalid");
  }
  const data = Buffer.concat([discriminator, body]);
  try {
    switch (shape.kind) {
      case "pool":
        decodeAmoebaDlmmPool(canonicalAddress, data, AMOEBA_SPREAD_PROGRAM_ID);
        break;
      case "reserve_page":
        decodeAmoebaDlmmBinPage(canonicalAddress, data, AMOEBA_SPREAD_PROGRAM_ID);
        break;
      case "share_page":
        decodeAmoebaDlmmSharePage(canonicalAddress, data, AMOEBA_SPREAD_PROGRAM_ID);
        break;
      case "position":
        decodeAmoebaDlmmPosition(canonicalAddress, data, AMOEBA_SPREAD_PROGRAM_ID);
        break;
    }
  } catch (cause) {
    throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed DLMM bytes fail the exact rc.44 PDA/layout validator", { cause });
  }
  return { ...shape, discriminator, body, data, bodyDataHash, treeContext };
}

function validateCurrentValidityProof(
  account: CompressedAccountWithMerkleContext,
  treeContext: CurrentPhotonStateTreeContext,
  response: WithContext<ValidityProofWithContext>,
  stateFinalizedSlot: number,
): { readonly proof: ValidityProof; readonly root: BN254; readonly rootIndex: number } {
  const value = response.value;
  const proof = value.compressedProof;
  const proofTree = value.treeInfos[0];
  const root = value.roots[0];
  const rootIndex = value.rootIndices[0];
  if (
    !Number.isSafeInteger(response.context.slot)
    || response.context.slot < 1
    || !Number.isSafeInteger(stateFinalizedSlot)
    || stateFinalizedSlot < response.context.slot
    || proof === null
    || root === undefined
    || root.isZero()
    || rootIndex === undefined
    || !Number.isInteger(rootIndex)
    || rootIndex < 0
    || rootIndex > 0xffff
    || value.roots.length !== 1
    || value.rootIndices.length !== 1
    || value.leafIndices.length !== 1
    || value.leaves.length !== 1
    || value.treeInfos.length !== 1
    || value.proveByIndices.length !== 1
    || value.leafIndices[0] !== account.leafIndex
    || value.proveByIndices[0] !== account.proveByIndex
    || !value.leaves[0]!.eq(account.hash)
    || proofTree === undefined
    || !proofTree.tree.equals(account.treeInfo.tree)
    || !proofTree.queue.equals(account.treeInfo.queue)
    || proofTree.treeType !== TreeType.StateV2
    || proofTree.cpiContext === undefined
    || !proofTree.cpiContext.equals(treeContext.cpiContext)
  ) {
    throw photonError("CURRENT_PHOTON_PROOF_INVALID", "validity proof does not bind one authorized finalized compressed account");
  }
  exactByteArray(proof.a, 32, "validity proof A");
  exactByteArray(proof.b, 64, "validity proof B");
  exactByteArray(proof.c, 32, "validity proof C");
  bnHex(root);
  bnHex(account.hash);
  return { proof, root, rootIndex };
}

function u16(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "tag-219 u16 field is out of range");
  }
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u32(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "tag-219 u32 field is out of range");
  }
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function assertMeta(meta: AccountMeta | undefined, address: PublicKey, isSigner: boolean, isWritable: boolean): void {
  if (
    meta === undefined
    || !meta.pubkey.equals(address)
    || meta.isSigner !== isSigner
    || meta.isWritable !== isWritable
  ) {
    throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "PackedAccounts produced a noncanonical tag-219 account meta");
  }
}

function instructionDigest(instruction: TransactionInstruction): string {
  const hash = createHash("sha256");
  hash.update(instruction.programId.toBuffer());
  for (const meta of instruction.keys) {
    hash.update(meta.pubkey.toBuffer());
    hash.update(Buffer.from([Number(meta.isSigner), Number(meta.isWritable)]));
  }
  hash.update(instruction.data);
  return hash.digest("hex");
}

async function buildCurrentTag219Instruction(input: {
  readonly payer: PublicKey;
  readonly canonicalAddress: PublicKey;
  readonly account: CompressedAccountWithMerkleContext;
  readonly validated: ValidatedColdAccount;
  readonly proof: ValidityProof;
  readonly rootIndex: number;
  readonly rpc: Connection;
  readonly minimumContextSlot: number;
}): Promise<TransactionInstruction> {
  const lightConfig = PublicKey.findProgramAddressSync([
    Buffer.from("compressible_config", "ascii"),
    Buffer.alloc(2),
  ], AMOEBA_SPREAD_PROGRAM_ID)[0];
  const rentSponsor = PublicKey.findProgramAddressSync([
    Buffer.from("rent_sponsor", "ascii"),
  ], AMOEBA_SPREAD_PROGRAM_ID)[0];
  const packed = PackedAccounts.newWithSystemAccountsV2(SystemAccountMetaConfig.new(AMOEBA_SPREAD_PROGRAM_ID));
  packed.addPreAccountsSignerMut(input.payer);
  packed.addPreAccountsMeta({ pubkey: lightConfig, isSigner: false, isWritable: false });
  packed.addPreAccountsMeta({ pubkey: rentSponsor, isSigner: false, isWritable: true });
  const outputQueueIndex = packed.insertOrGet(input.validated.treeContext.queue);
  const treeIndex = packed.insertOrGet(input.validated.treeContext.tree);
  const queueIndex = packed.insertOrGet(input.validated.treeContext.queue);
  const cpiContextIndex = packed.insertOrGetReadOnly(input.validated.treeContext.cpiContext);
  const packedMetas = packed.toAccountMetas();
  if (
    packedMetas.systemStart !== 3
    || packedMetas.packedStart !== 9
    || outputQueueIndex !== 0
    || treeIndex !== 1
    || queueIndex !== 0
    || cpiContextIndex !== 2
    || packedMetas.remainingAccounts.length !== 12
  ) {
    throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "Light 0.23 PackedAccounts V2 ordering differs from the pinned rc.44 ABI");
  }
  assertMeta(packedMetas.remainingAccounts[0], input.payer, true, true);
  assertMeta(packedMetas.remainingAccounts[1], lightConfig, false, false);
  assertMeta(packedMetas.remainingAccounts[2], rentSponsor, false, true);
  for (const [index, fixed] of CURRENT_LIGHT_FIXED_SYSTEM_METAS.entries()) {
    assertMeta(packedMetas.remainingAccounts[index + 3], fixed.address, false, fixed.isWritable);
  }
  assertMeta(packedMetas.remainingAccounts[9], input.validated.treeContext.queue, false, true);
  assertMeta(packedMetas.remainingAccounts[10], input.validated.treeContext.tree, false, true);
  assertMeta(packedMetas.remainingAccounts[11], input.validated.treeContext.cpiContext, false, false);

  const proofBytes = Buffer.concat([
    exactByteArray(input.proof.a, 32, "validity proof A"),
    exactByteArray(input.proof.b, 64, "validity proof B"),
    exactByteArray(input.proof.c, 32, "validity proof C"),
  ]);
  const duplicatedIdentity = input.validated.kindTag === 1 || input.validated.kindTag === 2
    ? input.validated.body.subarray(38, 40)
    : input.validated.kindTag === 3
      ? input.validated.body.subarray(70, 78)
      : Buffer.alloc(0);
  const lightPayload = Buffer.concat([
    Buffer.from([packedMetas.systemStart, 1, outputQueueIndex, 1]),
    proofBytes,
    u32(1),
    u16(input.account.proveByIndex ? 0 : input.rootIndex),
    Buffer.from([Number(input.account.proveByIndex), treeIndex, queueIndex]),
    u32(input.account.leafIndex),
    Buffer.from([input.validated.kindTag]),
    input.validated.body,
    duplicatedIdentity,
  ]);
  const keys = [
    ...packedMetas.remainingAccounts,
    { pubkey: input.canonicalAddress, isSigner: false, isWritable: true },
  ];
  const instruction = isCurrentWriteReleaseAvailable()
    ? (await buildCurrentGovernedInstructionV1({
      rpc: input.rpc,
      minimumContextSlot: input.minimumContextSlot,
      builderName: "buildDecompressAmoebaDlmmLightStateInstruction",
      builderInput: { accounts: keys, lightPayload },
    })).instructions[0]!
    : buildHistoricalDecompressAmoebaDlmmLightStateInstruction({
      accounts: keys,
      lightPayload,
      programId: AMOEBA_SPREAD_PROGRAM_ID,
    });
  const semanticInstruction = semanticCurrentSpreadInstructionV1(instruction);
  if (
    !instruction.programId.equals(AMOEBA_SPREAD_PROGRAM_ID)
    || semanticInstruction.data.length > 16_384
    || semanticInstruction.data[0] !== 219
    || semanticInstruction.keys.length !== 13
  ) {
    throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "built tag-219 instruction is outside the exact one-account grammar");
  }
  for (let index = 0; index < keys.length; index += 1) {
    const expected = keys[index]!;
    assertMeta(semanticInstruction.keys[index], expected.pubkey, expected.isSigner, expected.isWritable);
  }
  return instruction;
}

function createColdProofWitness(input: {
  readonly providerOriginSha256: string;
  readonly canonicalAddress: PublicKey;
  readonly compressedAddress: PublicKey;
  readonly account: CompressedAccountWithMerkleContext;
  readonly validated: ValidatedColdAccount;
  readonly proofResponse: WithContext<ValidityProofWithContext>;
  readonly proof: ValidityProof;
  readonly root: BN254;
  readonly rootIndex: number;
  readonly stateFinalizedSlot: number;
}): CurrentPhotonColdProofWitness {
  const proofBytes = Buffer.concat([
    exactByteArray(input.proof.a, 32, "validity proof A"),
    exactByteArray(input.proof.b, 64, "validity proof B"),
    exactByteArray(input.proof.c, 32, "validity proof C"),
  ]);
  const base = {
    providerOriginSha256: input.providerOriginSha256,
    kind: input.validated.kind,
    canonicalAddress: input.canonicalAddress.toBase58(),
    compressedAddress: input.compressedAddress.toBase58(),
    owner: input.account.owner.toBase58(),
    discriminatorBase64: input.validated.discriminator.toString("base64"),
    dataSha256: hashHex(input.validated.data),
    bodyDataHash: input.validated.bodyDataHash.toString("hex"),
    addressTree: CURRENT_PHOTON_ADDRESS_TREE.toBase58(),
    addressQueue: CURRENT_PHOTON_ADDRESS_QUEUE.toBase58(),
    stateTree: input.validated.treeContext.tree.toBase58(),
    queue: input.validated.treeContext.queue.toBase58(),
    cpiContext: input.validated.treeContext.cpiContext.toBase58(),
    leafHash: bnHex(input.account.hash),
    leafIndex: String(input.account.leafIndex),
    root: bnHex(input.root),
    rootIndex: String(input.rootIndex),
    proveByIndex: input.account.proveByIndex,
    proofContextSlot: String(input.proofResponse.context.slot),
    stateFinalizedSlot: String(input.stateFinalizedSlot),
    proofSha256: hashHex(proofBytes),
  } as const;
  const witnessDigest = hashHex(JSON.stringify([
    "ameba-spread-v2/current-photon-proof-witness-v1",
    ...Object.values(base),
  ]));
  return Object.freeze({ mode: "proof_only", ...base, witnessDigest });
}

function createColdLoadWitness(input: {
  readonly proofWitness: CurrentPhotonColdProofWitness;
  readonly payer: PublicKey;
  readonly instruction: TransactionInstruction;
}): CurrentPhotonColdLoadWitness {
  const {
    mode: _mode,
    witnessDigest: proofWitnessDigest,
    ...facts
  } = input.proofWitness;
  void _mode;
  const base = {
    ...facts,
    payer: input.payer.toBase58(),
    proofWitnessDigest,
    loadInstructionSha256: instructionDigest(input.instruction),
  } as const;
  const witnessDigest = hashHex(JSON.stringify([
    "ameba-spread-v2/current-photon-load-witness-v1",
    ...Object.values(base),
  ]));
  return Object.freeze({ mode: "load", ...base, witnessDigest });
}

function projectProofObservation(
  observation: InternalColdProofObservation,
): CurrentPhotonColdProofObservation {
  return {
    kind: observation.kind,
    canonicalAddress: new PublicKey(observation.canonicalAddress),
    compressedAddress: new PublicKey(observation.compressedAddress),
    data: Buffer.from(observation.data),
    owner: new PublicKey(observation.owner),
    compressedAccount: cloneCompressedAccount(observation.compressedAccount),
    validityProof: cloneValidityProof(observation.validityProof),
    witness: observation.witness,
  };
}

function projectLoadObservation(
  observation: InternalColdLoadObservation,
): CurrentPhotonColdLoadObservation {
  return {
    kind: observation.kind,
    payer: new PublicKey(observation.payer),
    canonicalAddress: new PublicKey(observation.canonicalAddress),
    compressedAddress: new PublicKey(observation.compressedAddress),
    data: Buffer.from(observation.data),
    owner: new PublicKey(observation.owner),
    loadInstructions: Object.freeze([
      cloneCurrentSpreadInstructionPreservingRegistrationV1(observation.instruction),
    ]),
    compressedAccount: cloneCompressedAccount(observation.compressedAccount),
    validityProof: cloneValidityProof(observation.validityProof),
    witness: observation.witness,
  };
}

class CurrentPhotonConnectionImpl implements CurrentPhotonConnection {
  readonly providerOriginSha256: string;
  readonly commitment = CURRENT_PHOTON_COMMITMENT;
  readonly topology = publicTopology();
  readonly #rpc: Rpc;
  readonly #providerEndpoint: CurrentPhotonEndpoint;
  readonly #createLightAtaLoadInstructions: CreateLightAtaLoadInstructions;
  readonly #compressedEvidenceVerifier: CurrentCompressedEvidenceVerifier | undefined;
  readonly #addressTreeInfo: TreeInfo;
  readonly #stateTreeInfos: ReadonlyMap<string, TreeInfo>;

  constructor(
    rpc: Rpc,
    readonly stateConnection: Connection,
    providerEndpoint: CurrentPhotonEndpoint,
    providerOriginSha256: string,
    addressTreeInfo: TreeInfo,
    stateTreeInfos: readonly TreeInfo[],
    createLightAtaLoadInstructions: CreateLightAtaLoadInstructions,
    compressedEvidenceVerifier?: CurrentCompressedEvidenceVerifier,
  ) {
    this.#rpc = rpc;
    this.#providerEndpoint = providerEndpoint;
    this.providerOriginSha256 = providerOriginSha256;
    this.#addressTreeInfo = cloneTreeInfo(addressTreeInfo);
    this.#stateTreeInfos = new Map(stateTreeInfos.map((info) => [info.tree.toBase58(), cloneTreeInfo(info)]));
    this.#createLightAtaLoadInstructions = createLightAtaLoadInstructions;
    if (compressedEvidenceVerifier !== undefined) requireCurrentCompressedEvidenceVerifier(compressedEvidenceVerifier);
    this.#compressedEvidenceVerifier = compressedEvidenceVerifier;
  }

  async getCompressedAccount(
    address?: BN254,
    hash?: BN254,
  ): Promise<CompressedAccountWithMerkleContext | null> {
    try {
      const account = await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getCompressedAccount(address, hash),
      );
      return account === null ? null : cloneCompressedAccount(account);
    } catch {
      // Photon errors may echo credential-bearing path/query data. Never retain the transport cause.
      throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "Light compressed-account read failed");
    }
  }

  async getValidityProofAndRpcContext(
    hashes: HashWithTree[],
    newAddresses: AddressWithTree[],
  ): Promise<WithContext<ValidityProofWithContext>> {
    try {
      return cloneValidityProof(await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getValidityProofAndRpcContext(hashes, newAddresses),
      ));
    } catch {
      throw photonError("LIGHT_PROOF_UNAVAILABLE", "Light validity proof is unavailable");
    }
  }

  async getCompressedAccountsByOwner(
    owner: PublicKey,
    config: CurrentPhotonOwnerQueryConfig,
  ): Promise<WithCursor<CompressedAccountWithMerkleContext[]>> {
    let limit: number;
    try {
      limit = Number(BigInt(config.limit.toString(10)));
    } catch (cause) {
      throw photonError("CURRENT_PHOTON_OWNER_QUERY_INVALID", "compressed owner query limit is invalid", { cause });
    }
    if (
      !owner.equals(AMOEBA_SPREAD_PROGRAM_ID)
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > CURRENT_PHOTON_MAX_OWNER_ACCOUNTS
    ) {
      throw photonError(
        "CURRENT_PHOTON_OWNER_QUERY_INVALID",
        "cold discovery is restricted to 1-256 accounts owned by the current Spread program",
      );
    }
    let result: WithCursor<CompressedAccountWithMerkleContext[]>;
    try {
      result = await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getCompressedAccountsByOwner(owner, {
          limit: config.limit,
          ...(config.filters === undefined ? {} : { filters: config.filters }),
        }),
      );
    } catch {
      throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "bounded compressed owner query failed");
    }
    if (result.cursor !== null || result.items.length > limit) {
      throw photonError(
        "CURRENT_PHOTON_OWNER_QUERY_BOUND_EXCEEDED",
        "compressed owner query is incomplete or exceeds its explicit bound",
      );
    }
    for (const account of result.items) {
      if (!account.owner.equals(owner)) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed owner query returned a foreign-owned account");
      }
      exactTreeContext(account.treeInfo);
    }
    return { cursor: null, items: result.items.map(cloneCompressedAccount) };
  }

  async observeCurrentColdAccount(
    canonicalAddress: PublicKey,
  ): Promise<CurrentPhotonColdProofObservation | null> {
    const observation = await this.observeProof(canonicalAddress);
    return observation === null ? null : projectProofObservation(observation);
  }

  async observeCurrentCompressedState(input: {
    readonly canonicalPda: PublicKey;
    readonly domain: CompressedStateDomain;
  }): Promise<CurrentPhotonCompressedStateObservation | null> {
    if (!input.canonicalPda.equals(new PublicKey(input.canonicalPda)) || input.canonicalPda.equals(SystemProgram.programId)) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed-state canonical PDA is invalid");
    }
    const compressedAddress = deriveCompressedStateAddressV1(
      AMOEBA_SPREAD_PROGRAM_ID,
      this.#addressTreeInfo.tree,
      input.domain,
      input.canonicalPda,
    );
    let account: CompressedAccountWithMerkleContext | null;
    try {
      account = await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getCompressedAccount(createBN254(compressedAddress.toBytes())),
      );
    } catch {
      throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current compact-state account read failed");
    }
    if (account === null) return null;
    const cloned = cloneCompressedAccount(account);
    const treeContext = exactTreeContext(cloned.treeInfo);
    let leaf: CompressedAmebaStateLeaf;
    try {
      leaf = decodeCompressedAmebaStateLeaf(cloned);
    } catch (cause) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "current compact-state leaf envelope is invalid", { cause });
    }
    if (
      !cloned.owner.equals(AMOEBA_SPREAD_PROGRAM_ID)
      || cloned.address === null
      || !Buffer.from(cloned.address).equals(compressedAddress.toBuffer())
      || leaf.domain !== input.domain
      || !leaf.canonicalPda.equals(input.canonicalPda)
    ) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "current compact-state leaf identity is invalid");
    }
    let response: WithContext<ValidityProofWithContext>;
    try {
      response = await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getValidityProofAndRpcContext([{
          hash: cloned.hash,
          tree: cloned.treeInfo.tree,
          queue: cloned.treeInfo.queue,
        }], []),
      );
    } catch {
      throw photonError("LIGHT_PROOF_UNAVAILABLE", "current compact-state validity proof is unavailable");
    }
    let stateFinalizedSlot: number;
    try {
      stateFinalizedSlot = await this.stateConnection.getSlot(CURRENT_PHOTON_COMMITMENT);
    } catch {
      throw photonError("CURRENT_PHOTON_STATE_RPC_UNAVAILABLE", "finalized state slot is unavailable");
    }
    const clonedProof = cloneValidityProof(response);
    const validated = validateCurrentValidityProof(cloned, treeContext, clonedProof, stateFinalizedSlot);
    const proofBytes = Buffer.concat([
      exactByteArray(validated.proof.a, 32, "compact-state proof A"),
      exactByteArray(validated.proof.b, 64, "compact-state proof B"),
      exactByteArray(validated.proof.c, 32, "compact-state proof C"),
    ]);
    const facts = {
      evidenceTrust: "authorized_photon_provider" as const,
      proofVerification: "onchain_at_execution" as const,
      finalizedRootVerified: false as const,
      proofBase64: proofBytes.toString("base64"),
      proofStatementJson: JSON.stringify({ kind: "membership", requestedHash: bnHex(cloned.hash), compressedAddress: compressedAddress.toBase58(),
        roots: clonedProof.value.roots.map(bnHex), rootIndices: clonedProof.value.rootIndices,
        leaves: clonedProof.value.leaves.map(bnHex), leafIndices: clonedProof.value.leafIndices, proveByIndices: clonedProof.value.proveByIndices,
        trees: clonedProof.value.treeInfos.map(tree => ({ tree: tree.tree.toBase58(), queue: tree.queue.toBase58(), treeType: tree.treeType })), contextSlot: clonedProof.context.slot }),
      providerOriginSha256: this.providerOriginSha256,
      canonicalPda: input.canonicalPda.toBase58(),
      compressedAddress: compressedAddress.toBase58(),
      domain: input.domain,
      revision: leaf.revision.toString(),
      dataSha256: hashHex(leaf.data),
      stateTree: cloned.treeInfo.tree.toBase58(),
      queue: cloned.treeInfo.queue.toBase58(),
      cpiContext: treeContext.cpiContext.toBase58(),
      leafHash: bnHex(cloned.hash),
      leafIndex: String(cloned.leafIndex),
      root: bnHex(validated.root),
      rootIndex: String(validated.rootIndex),
      proveByIndex: cloned.proveByIndex,
      proofContextSlot: String(clonedProof.context.slot),
      stateFinalizedSlot: String(stateFinalizedSlot),
      proofSha256: hashHex(proofBytes),
    };
    const witness = Object.freeze({
      ...facts,
      witnessDigest: hashHex(
        "ameba-spread-v2/current-compressed-state-witness-v1\0",
        JSON.stringify(facts),
      ),
    });
    return Object.freeze({
      canonicalPda: new PublicKey(input.canonicalPda),
      compressedAddress: new PublicKey(compressedAddress),
      leaf: Object.freeze({
        schemaVersion: leaf.schemaVersion,
        domain: leaf.domain,
        canonicalPda: new PublicKey(leaf.canonicalPda),
        revision: leaf.revision,
        data: Buffer.from(leaf.data),
      }),
      witness,
    });
  }

  async observeCurrentCompressedStateEvidence(input: {
    readonly canonicalPda: PublicKey;
    readonly domain: CompressedStateDomain;
  }): Promise<CurrentPhotonCompressedStateEvidence> {
    const observation = await this.observeCurrentCompressedState(input);
    if (observation !== null) return Object.freeze({ exists: true as const, observation });
    const compressedAddress = deriveCompressedStateAddressV1(
      AMOEBA_SPREAD_PROGRAM_ID, this.#addressTreeInfo.tree, input.domain, input.canonicalPda,
    );
    const newAddresses = [{ address: createBN254(compressedAddress.toBytes()),
      tree: this.#addressTreeInfo.tree, queue: this.#addressTreeInfo.queue }];
    const response = cloneValidityProof(await this.getValidityProofAndRpcContext([], newAddresses));
    const stateFinalizedSlot = await this.stateConnection.getSlot(CURRENT_PHOTON_COMMITMENT);
    exactCombinedValidityProof({ hashes: [], newAddresses, response, stateFinalizedSlot,
      existingAccountsByHash: new Map() });
    const proof = response.value.compressedProof!;
    const proofBytes = Buffer.concat([exactByteArray(proof.a, 32, "non-inclusion proof A"), exactByteArray(proof.b, 64, "non-inclusion proof B"), exactByteArray(proof.c, 32, "non-inclusion proof C")]);
    const facts = {
      evidenceTrust: "authorized_photon_provider" as const,
      proofVerification: "onchain_at_execution" as const,
      finalizedRootVerified: false as const,
      proofBase64: proofBytes.toString("base64"),
      proofStatementJson: JSON.stringify({ kind: "nonmembership", requestedAddress: compressedAddress.toBase58(),
        roots: response.value.roots.map(bnHex), rootIndices: response.value.rootIndices,
        leaves: response.value.leaves.map(bnHex), leafIndices: response.value.leafIndices, proveByIndices: response.value.proveByIndices,
        trees: response.value.treeInfos.map(tree => ({ tree: tree.tree.toBase58(), queue: tree.queue.toBase58(), treeType: tree.treeType })), contextSlot: response.context.slot }),
      canonicalPda: input.canonicalPda.toBase58(), compressedAddress: compressedAddress.toBase58(),
      domain: input.domain, providerOriginSha256: this.providerOriginSha256,
      addressTree: this.#addressTreeInfo.tree.toBase58(), addressQueue: this.#addressTreeInfo.queue.toBase58(),
      root: bnHex(response.value.roots[0]!), rootIndex: String(response.value.rootIndices[0]!),
      proofContextSlot: String(response.context.slot), stateFinalizedSlot: String(stateFinalizedSlot),
      proofSha256: hashHex(Buffer.concat([exactByteArray(proof.a, 32, "non-inclusion proof A"),
        exactByteArray(proof.b, 64, "non-inclusion proof B"), exactByteArray(proof.c, 32, "non-inclusion proof C")])),
    };
    return Object.freeze({ exists: false as const, witness: Object.freeze({ ...facts,
      witnessDigest: hashHex("ameba-spread-v2/current-compressed-nonmembership-v1\0", JSON.stringify(facts)) }) });
  }

  async observeCurrentVerifiedCompressedStateEvidence(input: {
    readonly canonicalPda: PublicKey; readonly domain: CompressedStateDomain; readonly minimumContextSlot?: number;
  }): Promise<CurrentPhotonVerifiedCompressedStateEvidence> {
    if (this.#compressedEvidenceVerifier === undefined) throw photonError("CURRENT_PHOTON_PROOF_INVALID", "authoritative compressed reads require the actual qualified native verifier executable");
    return readCurrentVerifiedCompressedStateEvidence({ ...input, stateConnection: this.stateConnection,
      topology: this.topology, providerOriginSha256: this.providerOriginSha256, verifier: this.#compressedEvidenceVerifier,
      getCompressedAccount: address => this.getCompressedAccount(address),
      getValidityProof: (hashes, addresses) => this.getValidityProofAndRpcContext(hashes, addresses) });
  }

  async prepareCurrentCompressedStateInstruction(input: {
    readonly innerInstruction: TransactionInstruction;
    readonly marketSeriesId: string;
    readonly expectedObservations: readonly CurrentPhotonCompressedStateObservation[];
  }): Promise<CurrentPhotonPreparedCompressedInstruction> {
    if (!input.innerInstruction.programId.equals(AMOEBA_SPREAD_PROGRAM_ID)) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed logical instruction has a foreign program id");
    }
    const governedViews = isCurrentWriteReleaseAvailable()
      ? governedCurrentSpreadInstructionViewsV1(input.innerInstruction)
      : null;
    const semanticInnerInstruction = governedViews?.semanticInstruction ?? input.innerInstruction;
    const outputContext = CURRENT_PHOTON_STATE_TREE_CONTEXTS[currentOutputStateTreeIndex(input.marketSeriesId)]!;
    const outputStateTreeInfo = this.#stateTreeInfos.get(outputContext.tree.toBase58());
    if (outputStateTreeInfo === undefined) {
      throw photonError("CURRENT_PHOTON_STATE_TREE_TOPOLOGY_MISMATCH", "selected current output state tree is unavailable");
    }
    const treeContext = {
      addressTreeInfo: cloneTreeInfo(this.#addressTreeInfo),
      outputStateTreeInfo: cloneTreeInfo(outputStateTreeInfo),
    };
    const requiredRequests = Object.freeze([...requiredCompressedStateAccessesV1({
      innerInstruction: semanticInnerInstruction,
      trees: treeContext,
    })]);
    const requiredIdentities = requiredRequests.map((request) => {
      const canonicalPda = semanticInnerInstruction.keys[request.accountIndex]?.pubkey;
      if (canonicalPda === undefined) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed-state access index is outside the logical account list");
      }
      const compressedAddress = deriveCompressedStateAddressV1(
        AMOEBA_SPREAD_PROGRAM_ID,
        this.#addressTreeInfo.tree,
        request.domain,
        canonicalPda,
      );
      return Object.freeze({ request, canonicalPda, compressedAddress });
    });
    const requiredByAddress = new Map(requiredIdentities.map((identity) => [
      identity.compressedAddress.toBase58(),
      identity,
    ]));
    if (requiredByAddress.size !== requiredIdentities.length) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compressed-state access contract contains a duplicate logical address");
    }
    const expectedByAddress = new Map<string, CurrentPhotonCompressedStateObservation>();
    for (const observation of input.expectedObservations) {
      if (observation.witness.providerOriginSha256 !== this.providerOriginSha256) {
        throw photonError("CURRENT_PHOTON_PROVIDER_UNAUTHORIZED", "expected compact-state observation belongs to another provider");
      }
      const addressKey = observation.compressedAddress.toBase58();
      const required = requiredByAddress.get(addressKey);
      const stateTreeInfo = this.#stateTreeInfos.get(observation.witness.stateTree);
      const observationFacts = {
        evidenceTrust: observation.witness.evidenceTrust,
        proofVerification: observation.witness.proofVerification,
        finalizedRootVerified: observation.witness.finalizedRootVerified,
        proofBase64: observation.witness.proofBase64,
        proofStatementJson: observation.witness.proofStatementJson,
        providerOriginSha256: observation.witness.providerOriginSha256,
        canonicalPda: observation.witness.canonicalPda,
        compressedAddress: observation.witness.compressedAddress,
        domain: observation.witness.domain,
        revision: observation.witness.revision,
        dataSha256: observation.witness.dataSha256,
        stateTree: observation.witness.stateTree,
        queue: observation.witness.queue,
        cpiContext: observation.witness.cpiContext,
        leafHash: observation.witness.leafHash,
        leafIndex: observation.witness.leafIndex,
        root: observation.witness.root,
        rootIndex: observation.witness.rootIndex,
        proveByIndex: observation.witness.proveByIndex,
        proofContextSlot: observation.witness.proofContextSlot,
        stateFinalizedSlot: observation.witness.stateFinalizedSlot,
        proofSha256: observation.witness.proofSha256,
      };
      if (
        required === undefined
        || observation.witness.evidenceTrust !== "authorized_photon_provider"
        || observation.witness.proofVerification !== "onchain_at_execution"
        || observation.witness.finalizedRootVerified !== false
        || observation.witness.proofStatementJson !== JSON.stringify({ kind: "membership", requestedHash: observation.witness.leafHash,
          compressedAddress: observation.witness.compressedAddress, roots: [observation.witness.root], rootIndices: [Number(observation.witness.rootIndex)],
          leaves: [observation.witness.leafHash], leafIndices: [Number(observation.witness.leafIndex)], proveByIndices: [observation.witness.proveByIndex],
          trees: [{ tree: observation.witness.stateTree, queue: observation.witness.queue, treeType: TreeType.StateV2 }], contextSlot: Number(observation.witness.proofContextSlot) })
        || Buffer.from(observation.witness.proofBase64, "base64").length !== 128
        || Buffer.from(observation.witness.proofBase64, "base64").toString("base64") !== observation.witness.proofBase64
        || hashHex(Buffer.from(observation.witness.proofBase64, "base64")) !== observation.witness.proofSha256
        || observation.leaf.domain !== required.request.domain
        || !observation.canonicalPda.equals(required.canonicalPda)
        || observation.witness.canonicalPda !== required.canonicalPda.toBase58()
        || observation.witness.compressedAddress !== addressKey
        || observation.witness.domain !== observation.leaf.domain
        || observation.witness.revision !== observation.leaf.revision.toString()
        || observation.witness.dataSha256 !== hashHex(observation.leaf.data)
        || stateTreeInfo === undefined
        || observation.witness.queue !== stateTreeInfo.queue.toBase58()
        || observation.witness.cpiContext !== stateTreeInfo.cpiContext?.toBase58()
        || !/^[0-9a-f]{64}$/.test(observation.witness.leafHash)
        || !/^[0-9a-f]{64}$/.test(observation.witness.root)
        || !/^[0-9a-f]{64}$/.test(observation.witness.proofSha256)
        || !/^(0|[1-9][0-9]*)$/.test(observation.witness.leafIndex)
        || !/^(0|[1-9][0-9]*)$/.test(observation.witness.rootIndex)
        || !/^(0|[1-9][0-9]*)$/.test(observation.witness.proofContextSlot)
        || !/^(0|[1-9][0-9]*)$/.test(observation.witness.stateFinalizedSlot)
        || BigInt(observation.witness.stateFinalizedSlot) < BigInt(observation.witness.proofContextSlot)
        || observation.witness.witnessDigest !== hashHex(
          "ameba-spread-v2/current-compressed-state-witness-v1\0",
          JSON.stringify(observationFacts),
        )
      ) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "expected compact-state observation is outside the exact logical access contract");
      }
      if (expectedByAddress.has(addressKey)) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "duplicate expected compact-state observation");
      }
      expectedByAddress.set(addressKey, observation);
    }
    let capturedResponse: WithContext<ValidityProofWithContext> | undefined;
    let capturedHashes: readonly HashWithTree[] = [];
    let capturedNewAddresses: readonly AddressWithTree[] = [];
    let stateFinalizedSlot = 0;
    const observedAddressExistence = new Map<string, boolean>();
    const observedAccountsByHash = new Map<string, CompressedAccountWithMerkleContext>();
    const rpc = {
      getCompressedAccount: async (address?: BN254, hash?: BN254): Promise<CompressedAccountWithMerkleContext | null> => {
        const account = await this.getCompressedAccount(address, hash);
        if (address === undefined) return account;
        const addressKey = new PublicKey(address.toArrayLike(Buffer, "be", 32)).toBase58();
        if (!requiredByAddress.has(addressKey) || observedAddressExistence.has(addressKey)) {
          throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "proof builder requested an unexpected or duplicate compressed-state address");
        }
        observedAddressExistence.set(addressKey, account !== null);
        const expected = expectedByAddress.get(addressKey);
        if (account === null) {
          if (expected !== undefined) {
            throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "observed compact state disappeared before outer proof preparation");
          }
          return null;
        }
        if (expected === undefined) {
          throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "existing compact state lacks the exact planner observation");
        }
        const leaf = decodeCompressedAmebaStateLeaf(account);
        if (
          leaf.domain !== expected.leaf.domain
          || !leaf.canonicalPda.equals(expected.canonicalPda)
          || leaf.revision !== expected.leaf.revision
          || hashHex(leaf.data) !== expected.witness.dataSha256
          || !account.hash.eq(createBN254(Buffer.from(expected.witness.leafHash, "hex")))
        ) {
          throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "compact-state observation changed before outer proof preparation");
        }
        observedAccountsByHash.set(bnKey(account.hash), account);
        return account;
      },
      getValidityProofAndRpcContext: async (
        hashes: HashWithTree[],
        newAddresses: AddressWithTree[],
      ): Promise<WithContext<ValidityProofWithContext>> => {
        if (capturedResponse !== undefined) {
          throw photonError("CURRENT_PHOTON_PROOF_INVALID", "compressed-state proof builder requested more than one proof");
        }
        const response = await this.getValidityProofAndRpcContext(hashes, newAddresses);
        try {
          stateFinalizedSlot = await this.stateConnection.getSlot(CURRENT_PHOTON_COMMITMENT);
        } catch {
          throw photonError("CURRENT_PHOTON_STATE_RPC_UNAVAILABLE", "finalized state slot is unavailable");
        }
        exactCombinedValidityProof({
          hashes,
          newAddresses,
          response,
          stateFinalizedSlot,
          existingAccountsByHash: observedAccountsByHash,
        });
        // The authoritative proof builder resolves read/mutable accesses with
        // getCompressedAccount, but explicit initialize accesses go directly
        // into the non-inclusion portion of the combined validity proof. Bind
        // those proven-absent addresses into the same existence map so the
        // final exact-set check distinguishes initialize from an omitted read.
        for (const next of newAddresses) {
          const addressKey = new PublicKey(next.address.toArrayLike(Buffer, "be", 32)).toBase58();
          const required = requiredByAddress.get(addressKey);
          if (
            required === undefined
            || (required.request.kind !== "initialize" && required.request.kind !== "mutableOrInitialize")
            || !next.tree.equals(this.#addressTreeInfo.tree)
            || !next.queue.equals(this.#addressTreeInfo.queue)
            || observedAddressExistence.get(addressKey) === true
          ) {
            throw photonError("CURRENT_PHOTON_PROOF_INVALID", "combined proof contains an unexpected initialize address");
          }
          observedAddressExistence.set(addressKey, false);
        }
        capturedHashes = hashes;
        capturedNewAddresses = newAddresses;
        capturedResponse = response;
        return response;
      },
    };
    let prepared;
    try {
      const proofBuilderInput = {
        rpc,
        innerInstruction: input.innerInstruction,
        trees: {
          addressTreeInfo: cloneTreeInfo(this.#addressTreeInfo),
          outputStateTreeInfo: cloneTreeInfo(outputStateTreeInfo),
        },
        ...(governedViews === null ? {} : { governance: governedViews.spreadGovernance }),
      };
      // No-governance construction belongs only to the immutable historical
      // offline branch. Current writes always use the matching governed runtime.
      const proofBuilder = governedViews === null
        ? buildHistoricalRequiredCompressedStateInstructionV1
        : buildRequiredCompressedStateInstructionV1;
      prepared = await (proofBuilder as unknown as (
        value: typeof proofBuilderInput,
      ) => Promise<{ readonly instruction: TransactionInstruction }>)(proofBuilderInput);
    } catch (cause) {
      if (cause instanceof CurrentPhotonError) throw cause;
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "current compressed-state instruction preparation failed", { cause });
    }
    if (capturedResponse === undefined) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "compressed-state preparation did not produce one combined proof");
    }
    if (observedAddressExistence.size !== requiredIdentities.length) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "proof builder did not resolve the exact required compressed access set");
    }
    for (const identity of requiredIdentities) {
      const key = identity.compressedAddress.toBase58();
      const exists = observedAddressExistence.get(key);
      if (exists === undefined) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "required compressed access was not resolved");
      }
      if ((identity.request.kind === "readOnly" || identity.request.kind === "mutable") && !exists) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "required existing compressed access is absent");
      }
      if (identity.request.kind === "initialize" && exists) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "create-only compressed access already exists");
      }
      if (exists !== expectedByAddress.has(key)) {
        throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "planner observations and proof access existence differ");
      }
    }
    if (expectedByAddress.size !== input.expectedObservations.length) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "planner observation set is not exact");
    }
    const proof = capturedResponse.value.compressedProof!;
    const proofBytes = Buffer.concat([
      exactByteArray(proof.a, 32, "combined proof A"),
      exactByteArray(proof.b, 64, "combined proof B"),
      exactByteArray(proof.c, 32, "combined proof C"),
    ]);
    const semanticOuterInstruction = governedViews === null
      ? prepared.instruction
      : registerCurrentSpreadGovernedOutputV1({
        sourceInstruction: input.innerInstruction,
        outputInstruction: prepared.instruction,
      }).semanticInstruction;
    const decodedOuter = decodeCurrentExecuteCompressedStateV1(semanticOuterInstruction.data);
    if (
      decodedOuter.coreAccountCount !== semanticInnerInstruction.keys.length
      || decodedOuter.innerInstructionDataBase64 !== Buffer.from(semanticInnerInstruction.data).toString("base64")
      || decodedOuter.accesses.length !== requiredIdentities.length
    ) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "outer compressed envelope does not bind the exact logical instruction/access count");
    }
    const proofValue = capturedResponse.value;
    const proofIndexByAddress = new Map<string, number>();
    let existingProofIndex = 0;
    let initializeProofIndex = capturedHashes.length;
    for (const identity of requiredIdentities) {
      const address = identity.compressedAddress.toBase58();
      const exists = observedAddressExistence.get(address);
      if (exists === undefined || proofIndexByAddress.has(address)) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "compressed access proof ordering is ambiguous");
      }
      proofIndexByAddress.set(address, exists ? existingProofIndex++ : initializeProofIndex++);
    }
    if (existingProofIndex !== capturedHashes.length || initializeProofIndex !== capturedHashes.length + capturedNewAddresses.length) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "compressed access proof indexes do not match the combined proof request");
    }

    const packed = new PackedAccountRegistry();
    for (let index = 0; index < decodedOuter.accesses.length; index += 1) {
      const encoded = decodedOuter.accesses[index]!;
      const identity = requiredIdentities[index]!;
      const proofIndex = proofIndexByAddress.get(identity.compressedAddress.toBase58());
      const treeInfo = proofIndex === undefined ? undefined : proofValue.treeInfos[proofIndex];
      if (proofIndex === undefined || treeInfo === undefined) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "compressed access proof tree is unavailable");
      }
      if (encoded.kind === "mutable") {
        packed.add(treeInfo.tree, true);
        packed.add(treeInfo.queue, true);
        packed.add(activeOutputTreeKey(treeInfo), true);
      } else if (encoded.kind === "initialize") {
        packed.add(treeInfo.tree, true);
        packed.add(treeInfo.queue, true);
        packed.add(activeOutputTreeKey(outputStateTreeInfo), true);
      }
    }
    for (let index = 0; index < decodedOuter.accesses.length; index += 1) {
      const encoded = decodedOuter.accesses[index]!;
      if (encoded.kind !== "readOnly") continue;
      const identity = requiredIdentities[index]!;
      const proofIndex = proofIndexByAddress.get(identity.compressedAddress.toBase58());
      const treeInfo = proofIndex === undefined ? undefined : proofValue.treeInfos[proofIndex];
      if (treeInfo === undefined) throw photonError("CURRENT_PHOTON_PROOF_INVALID", "read-only access proof tree is unavailable");
      packed.add(treeInfo.tree, false);
      packed.add(treeInfo.queue, false);
    }

    const expectedSuffix: readonly AccountMeta[] = [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...getLightSystemAccountMetasV2(SystemAccountMetaConfig.new(input.innerInstruction.programId)),
      ...packed.metas(),
    ];
    const actualSuffix = semanticOuterInstruction.keys.slice(decodedOuter.coreAccountCount);
    if (
      actualSuffix.length !== expectedSuffix.length
      || actualSuffix.some((actual, index) => {
        const expected = expectedSuffix[index];
        return expected === undefined
          || !actual.pubkey.equals(expected.pubkey)
          || actual.isSigner !== expected.isSigner
          || actual.isWritable !== expected.isWritable;
      })
    ) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "outer compressed suffix metas differ from the authorized Light topology");
    }

    const accesses = Object.freeze(decodedOuter.accesses.map((encoded, index) => {
      const identity = requiredIdentities[index];
      if (identity === undefined) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "outer compressed access exceeds the required contract");
      }
      const addressKey = identity.compressedAddress.toBase58();
      const kind = identity.request.kind === "mutableOrInitialize"
        ? observedAddressExistence.get(addressKey) === true ? "mutable" : "initialize"
        : identity.request.kind;
      const proofIndex = proofIndexByAddress.get(addressKey);
      const proofTree = proofIndex === undefined ? undefined : proofValue.treeInfos[proofIndex];
      if (
        encoded.kind !== kind
        || encoded.accountIndex !== identity.request.accountIndex
        || encoded.domain !== identity.request.domain
        || proofIndex === undefined
        || proofTree === undefined
      ) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "outer compressed access kind/domain/index/order differs from the required contract");
      }
      const common = {
        domain: identity.request.domain,
        accountIndex: identity.request.accountIndex,
        proofIndex,
        canonicalPda: identity.canonicalPda.toBase58(),
        compressedAddress: addressKey,
      } as const;
      if (encoded.kind === "initialize") {
        if (
          proofTree.treeType !== TreeType.AddressV2
          || encoded.addressTreeAccountIndex !== packed.indexOf(proofTree.tree)
          || encoded.addressQueueAccountIndex !== packed.indexOf(proofTree.queue)
          || encoded.addressRootIndex !== proofValue.rootIndices[proofIndex]
          || encoded.outputStateTreeIndex !== packed.indexOf(activeOutputTreeKey(outputStateTreeInfo))
        ) {
          throw photonError("CURRENT_PHOTON_PROOF_INVALID", "initialize access packed address-tree fields differ from the exact non-inclusion proof");
        }
        return Object.freeze({
          ...common,
          kind: "initialize" as const,
          addressTreeAccountIndex: encoded.addressTreeAccountIndex,
          addressQueueAccountIndex: encoded.addressQueueAccountIndex,
          addressRootIndex: encoded.addressRootIndex,
          outputStateTreeIndex: encoded.outputStateTreeIndex,
        });
      }
      const observation = expectedByAddress.get(addressKey);
      if (
        observation === undefined
        || encoded.treeInfo.rootIndex !== proofValue.rootIndices[proofIndex]
        || encoded.treeInfo.proveByIndex !== proofValue.proveByIndices[proofIndex]
        || encoded.treeInfo.treeAccountIndex !== packed.indexOf(proofTree.tree)
        || encoded.treeInfo.queueAccountIndex !== packed.indexOf(proofTree.queue)
        || encoded.treeInfo.leafIndex !== proofValue.leafIndices[proofIndex]
        || String(encoded.treeInfo.leafIndex) !== observation.witness.leafIndex
        || encoded.revision !== observation.leaf.revision
        || encoded.compactDataBase64 !== Buffer.from(observation.leaf.data).toString("base64")
      ) {
        throw photonError("CURRENT_PHOTON_PROOF_INVALID", "existing access packed tree/revision/body fields differ from the exact observation/proof");
      }
      if (encoded.kind === "mutable") {
        if (encoded.outputStateTreeIndex !== packed.indexOf(activeOutputTreeKey(proofTree))) {
          throw photonError("CURRENT_PHOTON_PROOF_INVALID", "mutable access output tree differs from the exact proof context");
        }
        return Object.freeze({
          ...common,
          kind: "mutable" as const,
          treeInfo: encoded.treeInfo,
          outputStateTreeIndex: encoded.outputStateTreeIndex,
          revision: encoded.revision.toString(),
          compactDataBase64: encoded.compactDataBase64,
        });
      }
      return Object.freeze({
        ...common,
        kind: "readOnly" as const,
        treeInfo: encoded.treeInfo,
        revision: encoded.revision.toString(),
        compactDataBase64: encoded.compactDataBase64,
      });
    }));
    const coreAccounts = Object.freeze(semanticOuterInstruction.keys.slice(0, decodedOuter.coreAccountCount)
      .map((meta, accountIndex) => {
        const inner = semanticInnerInstruction.keys[accountIndex];
        const expectedWritable = inner !== undefined && (
          inner.isWritable
          || accountIndex === decodedOuter.rentPayerIndex
          || requiredRequests.some((request) => request.accountIndex === accountIndex)
        );
        if (
          inner === undefined
          || !meta.pubkey.equals(inner.pubkey)
          || meta.isSigner !== inner.isSigner
          || meta.isWritable !== expectedWritable
        ) {
          throw photonError("CURRENT_PHOTON_PROOF_INVALID", "outer compressed core account prefix or flags differ from the logical instruction");
        }
        return Object.freeze({
          address: meta.pubkey.toBase58(),
          isSigner: meta.isSigner,
          isWritable: meta.isWritable,
        });
      }));
    if (
      coreAccounts[decodedOuter.rentPayerIndex]?.isSigner !== true
      || coreAccounts[decodedOuter.rentPayerIndex]?.isWritable !== true
    ) {
      throw photonError("CURRENT_PHOTON_PROOF_INVALID", "outer compressed rent payer is not the exact writable signer");
    }
    const observationWitnessDigests = Object.freeze(requiredIdentities.flatMap((identity) => {
      const observed = expectedByAddress.get(identity.compressedAddress.toBase58());
      return observed === undefined ? [] : [observed.witness.witnessDigest];
    }));
    const facts = {
      providerOriginSha256: this.providerOriginSha256,
      marketSeriesId: input.marketSeriesId,
      addressTree: this.#addressTreeInfo.tree.toBase58(),
      addressQueue: this.#addressTreeInfo.queue.toBase58(),
      outputStateTree: outputStateTreeInfo.tree.toBase58(),
      outputQueue: outputStateTreeInfo.queue.toBase58(),
      proofContextSlot: String(capturedResponse.context.slot),
      stateFinalizedSlot: String(stateFinalizedSlot),
      roots: Object.freeze(proofValue.roots.map(bnHex)),
      rootIndices: Object.freeze(proofValue.rootIndices.map(String)),
      leafIndices: Object.freeze(proofValue.leafIndices.map(String)),
      treeInfos: Object.freeze(proofValue.treeInfos.map((tree): CurrentPhotonCompressedProofTreeFact => {
        if (tree.treeType === TreeType.AddressV2) {
          return Object.freeze({
            kind: "address_v2",
            stateTree: tree.tree.toBase58(),
            queue: tree.queue.toBase58(),
            cpiContext: null,
          });
        }
        const authorized = exactTreeContext(tree);
        return Object.freeze({
          kind: "state_v2",
          stateTree: tree.tree.toBase58(),
          queue: tree.queue.toBase58(),
          cpiContext: authorized.cpiContext.toBase58(),
        });
      })),
      proofSha256: hashHex(proofBytes),
      logicalInstructionSha256: instructionSha256(semanticInnerInstruction),
      outerInstructionSha256: instructionSha256(prepared.instruction),
      coreAccountCount: decodedOuter.coreAccountCount,
      rentPayerIndex: decodedOuter.rentPayerIndex,
      coreAccounts,
      accesses,
      observationWitnessDigests,
      existingAccessCount: capturedHashes.length,
      initializeAccessCount: capturedNewAddresses.length,
    };
    const witness = Object.freeze({
      providerOriginSha256: facts.providerOriginSha256,
      marketSeriesId: facts.marketSeriesId,
      addressTree: facts.addressTree,
      addressQueue: facts.addressQueue,
      outputStateTree: facts.outputStateTree,
      outputQueue: facts.outputQueue,
      proofContextSlot: facts.proofContextSlot,
      stateFinalizedSlot: facts.stateFinalizedSlot,
      roots: facts.roots,
      rootIndices: facts.rootIndices,
      leafIndices: facts.leafIndices,
      treeInfos: facts.treeInfos,
      proofSha256: facts.proofSha256,
      logicalInstructionSha256: facts.logicalInstructionSha256,
      outerInstructionSha256: facts.outerInstructionSha256,
      coreAccountCount: facts.coreAccountCount,
      rentPayerIndex: facts.rentPayerIndex,
      coreAccounts: facts.coreAccounts,
      accesses: facts.accesses,
      observationWitnessDigests: facts.observationWitnessDigests,
      existingAccessCount: facts.existingAccessCount,
      initializeAccessCount: facts.initializeAccessCount,
      witnessDigest: hashHex(
        "ameba-spread-v2/current-compressed-instruction-witness-v1\0",
        JSON.stringify(facts),
      ),
    });
    return Object.freeze({ instruction: cloneInstruction(prepared.instruction), witness });
  }

  forPayer(payer: PublicKey | string): CurrentPhotonPayerResolver {
    return new CurrentPhotonPayerResolverImpl(this, parsePayer(payer));
  }

  async observeProof(
    canonicalAddress: PublicKey,
  ): Promise<InternalColdProofObservation | null> {
    const compressedAddress = deriveAddress(
      canonicalAddress.toBytes(),
      CURRENT_PHOTON_ADDRESS_TREE,
      AMOEBA_SPREAD_PROGRAM_ID,
    );
    let account: CompressedAccountWithMerkleContext | null;
    try {
      account = await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getCompressedAccount(createBN254(compressedAddress.toBytes())),
      );
    } catch {
      throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "atomic Light compressed-account observation failed");
    }
    if (account === null) return null;
    const clonedAccount = cloneCompressedAccount(account);
    const validated = validateCurrentColdAccount(canonicalAddress, compressedAddress, clonedAccount);
    let proofResponse: WithContext<ValidityProofWithContext>;
    try {
      proofResponse = await withCurrentPhotonFetchGuard(
        this.#providerEndpoint,
        () => this.#rpc.getValidityProofAndRpcContext([{
          hash: clonedAccount.hash as BN254,
          tree: clonedAccount.treeInfo.tree,
          queue: clonedAccount.treeInfo.queue,
        }], []),
      );
    } catch {
      throw photonError("LIGHT_PROOF_UNAVAILABLE", "atomic Light validity proof is unavailable");
    }
    let stateFinalizedSlot: number;
    try {
      stateFinalizedSlot = await this.stateConnection.getSlot(CURRENT_PHOTON_COMMITMENT);
    } catch {
      throw photonError("CURRENT_PHOTON_STATE_RPC_UNAVAILABLE", "finalized state slot is unavailable");
    }
    const clonedProof = cloneValidityProof(proofResponse);
    const proofFacts = validateCurrentValidityProof(
      clonedAccount,
      validated.treeContext,
      clonedProof,
      stateFinalizedSlot,
    );
    const witness = createColdProofWitness({
      providerOriginSha256: this.providerOriginSha256,
      canonicalAddress,
      compressedAddress,
      account: clonedAccount,
      validated,
      proofResponse: clonedProof,
      proof: proofFacts.proof,
      root: proofFacts.root,
      rootIndex: proofFacts.rootIndex,
      stateFinalizedSlot,
    });
    return {
      kind: validated.kind,
      canonicalAddress: new PublicKey(canonicalAddress),
      compressedAddress: new PublicKey(compressedAddress),
      data: Buffer.from(validated.data),
      owner: new PublicKey(clonedAccount.owner),
      compressedAccount: clonedAccount,
      validityProof: clonedProof,
      validated,
      proof: proofFacts.proof,
      rootIndex: proofFacts.rootIndex,
      witness,
    };
  }

  async observeForPayer(
    canonicalAddress: PublicKey,
    payer: PublicKey,
  ): Promise<InternalColdLoadObservation | null> {
    const proofObservation = await this.observeProof(canonicalAddress);
    if (proofObservation === null) return null;
    const minimumContextSlot = Number(proofObservation.witness.stateFinalizedSlot);
    if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 0) {
      throw photonError("CURRENT_PHOTON_STATE_RPC_UNAVAILABLE", "finalized tag-219 governance floor is invalid");
    }
    const instruction = await buildCurrentTag219Instruction({
      payer,
      canonicalAddress,
      account: proofObservation.compressedAccount,
      validated: proofObservation.validated,
      proof: proofObservation.proof,
      rootIndex: proofObservation.rootIndex,
      rpc: this.stateConnection,
      minimumContextSlot,
    });
    const witness = createColdLoadWitness({
      proofWitness: proofObservation.witness,
      payer,
      instruction,
    });
    return {
      ...proofObservation,
      payer: new PublicKey(payer),
      instruction,
      witness,
    };
  }

  async buildLightAtaReadyActionPlanForPayer(
    payer: PublicKey,
    input: {
      readonly tokenAccounts: readonly LightAtaLoadRequest[];
      readonly actionInstructions: readonly TransactionInstruction[];
    },
  ): Promise<LightAtaReadyActionPlan> {
    return buildRegisteredLightActionPlanV1({
      actions: input.actionInstructions,
      cloneRegistered: cloneCurrentSpreadInstructionPreservingRegistrationV1,
      revalidate: (instructions) => revalidateFreshCurrentGovernedInstructionsV1({ rpc: this.stateConnection, instructions }),
      buildPlan: (actionInstructions) => buildReferenceLightAtaReadyActionPlan({
        governance: governedCurrentSpreadInstructionViewsV1(actionInstructions[0]!).spreadGovernance,
        rpc: this.#rpc as LightRpc,
        payer,
        tokenAccounts: input.tokenAccounts,
        actionInstructions,
        createLoadInstructions: this.#createLightAtaLoadInstructions,
      }),
    });
  }

  async inspectLightAtaForPayer(
    payer: PublicKey,
    input: {
      readonly ata: PublicKey;
      readonly owner: PublicKey;
      readonly mint: PublicKey;
    },
  ): Promise<CurrentPhotonLightAtaBalance | null> {
    let account: Awaited<ReturnType<typeof getCurrentLightAtaInterface>>;
    try {
      account = await getCurrentLightAtaInterface(
        this.#rpc,
        input.ata,
        input.owner,
        input.mint,
        CURRENT_PHOTON_COMMITMENT,
      );
    } catch (cause) {
      if (cause instanceof Error
        && cause.message === "authenticated Light ATA has no hot or cold token source.") {
        return null;
      }
      throw photonError(
        "LIGHT_PROOF_UNAVAILABLE",
        "current Light ATA balance could not be authenticated through the authorized provider",
      );
    }
    const parsed = account.parsed;
    if (account._sources.length === 0
      || account._sources.some((source) => source.kind !== "light_cold" || source.loadContext === undefined)) {
      throw photonError(
        "CURRENT_PHOTON_ACCOUNT_INVALID",
        "writer-loadable Light ATA proof must contain only Light cold sources",
      );
    }
    if (
      !parsed.address.equals(input.ata)
      || !parsed.owner.equals(input.owner)
      || !parsed.mint.equals(input.mint)
      || parsed.amount < 0n
      || parsed.isFrozen
      || parsed.delegate !== null
      || parsed.delegatedAmount !== 0n
      || parsed.isNative
      || parsed.closeAuthority !== null
    ) {
      throw photonError("CURRENT_PHOTON_ACCOUNT_INVALID", "current Light ATA balance identity or policy is invalid");
    }
    return Object.freeze({
      ata: input.ata.toBase58(),
      owner: input.owner.toBase58(),
      mint: input.mint.toBase58(),
      amountAtomic: parsed.amount.toString(),
      includesColdBalance: account.isCold || (account._sources?.some((source) => source.loadContext !== undefined) ?? false),
      providerOriginSha256: this.providerOriginSha256,
      payer: payer.toBase58(),
    });
  }
}

class CurrentPhotonPayerResolverImpl implements CurrentPhotonPayerResolver {
  readonly payer: string;
  readonly providerOriginSha256: string;
  readonly commitment = CURRENT_PHOTON_COMMITMENT;
  readonly topology: CurrentPhotonTopology;

  private readonly inFlight = new Map<string, Promise<InternalColdLoadObservation | null>>();
  private readonly handoffByCompressedAddress = new Map<string, AtomicHandoff>();
  private readonly handoffByHash = new Map<string, AtomicHandoff>();
  readonly #connection: CurrentPhotonConnectionImpl;
  readonly #payerKey: PublicKey;

  constructor(
    connection: CurrentPhotonConnectionImpl,
    payerKey: PublicKey,
  ) {
    this.#connection = connection;
    this.#payerKey = payerKey;
    this.payer = payerKey.toBase58();
    this.providerOriginSha256 = connection.providerOriginSha256;
    this.topology = connection.topology;
  }

  async getCompressedAccount(
    address?: BN254,
    hash?: BN254,
  ): Promise<CompressedAccountWithMerkleContext | null> {
    const byAddress = address === undefined ? undefined : this.validHandoff(this.handoffByCompressedAddress.get(bnKey(address)));
    const byHash = hash === undefined ? undefined : this.validHandoff(this.handoffByHash.get(bnKey(hash)));
    const handoff = byAddress ?? byHash;
    if (handoff !== undefined && (byAddress === undefined || byHash === undefined || byAddress === byHash)) {
      handoff.compressedServed = true;
      const result = cloneCompressedAccount(handoff.observation.compressedAccount);
      this.releaseHandoffIfConsumed(handoff);
      return result;
    }
    return this.#connection.getCompressedAccount(address, hash);
  }

  async getValidityProofAndRpcContext(
    hashes: HashWithTree[],
    newAddresses: AddressWithTree[],
  ): Promise<WithContext<ValidityProofWithContext>> {
    if (hashes.length === 1 && newAddresses.length === 0) {
      const requested = hashes[0]!;
      const handoff = this.validHandoff(this.handoffByHash.get(bnKey(requested.hash)));
      if (
        handoff !== undefined
        && requested.tree.equals(handoff.observation.compressedAccount.treeInfo.tree)
        && requested.queue.equals(handoff.observation.compressedAccount.treeInfo.queue)
      ) {
        handoff.proofServed = true;
        const result = cloneValidityProof(handoff.observation.validityProof);
        this.releaseHandoffIfConsumed(handoff);
        return result;
      }
    }
    return this.#connection.getValidityProofAndRpcContext(hashes, newAddresses);
  }

  async resolveColdAccount(address: PublicKey): Promise<AmoebaDlmmColdAccountLoad | null> {
    const observation = await this.observe(address);
    if (observation === null) return null;
    this.registerAtomicHandoff(observation);
    return {
      data: Buffer.from(observation.data),
      owner: new PublicKey(observation.owner),
      loadInstructions: Object.freeze([
        cloneCurrentSpreadInstructionPreservingRegistrationV1(observation.instruction),
      ]),
    };
  }

  async resolveCurrentColdAccount(address: PublicKey): Promise<CurrentPhotonColdLoadObservation | null> {
    const observation = await this.observe(address);
    return observation === null ? null : projectLoadObservation(observation);
  }

  async buildLightAtaReadyActionPlan(input: {
    readonly tokenAccounts: readonly LightAtaLoadRequest[];
    readonly actionInstructions: readonly TransactionInstruction[];
  }): Promise<LightAtaReadyActionPlan> {
    return this.#connection.buildLightAtaReadyActionPlanForPayer(this.#payerKey, input);
  }

  async inspectLightAta(input: {
    readonly ata: PublicKey;
    readonly owner: PublicKey;
    readonly mint: PublicKey;
  }): Promise<CurrentPhotonLightAtaBalance | null> {
    return this.#connection.inspectLightAtaForPayer(this.#payerKey, input);
  }

  private async observe(address: PublicKey): Promise<InternalColdLoadObservation | null> {
    const key = address.toBase58();
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    const pending = this.#connection.observeForPayer(address, this.#payerKey);
    this.inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    }
  }

  private registerAtomicHandoff(observation: InternalColdLoadObservation): void {
    if (!observation.payer.equals(this.#payerKey)) {
      throw photonError("CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "atomic handoff payer does not match its owner-scoped resolver");
    }
    const compressedKey = bnKey(createBN254(observation.compressedAddress.toBytes()));
    const hashKey = bnKey(observation.compressedAccount.hash as BN254);
    const handoff: AtomicHandoff = {
      observation,
      compressedKey,
      hashKey,
      expiresAt: Date.now() + CURRENT_PHOTON_ATOMIC_HANDOFF_MS,
      compressedServed: false,
      proofServed: false,
    };
    const oldByAddress = this.handoffByCompressedAddress.get(compressedKey);
    if (oldByAddress !== undefined) this.releaseHandoff(oldByAddress);
    const oldByHash = this.handoffByHash.get(hashKey);
    if (oldByHash !== undefined) this.releaseHandoff(oldByHash);
    this.handoffByCompressedAddress.set(compressedKey, handoff);
    this.handoffByHash.set(hashKey, handoff);
  }

  private validHandoff(handoff: AtomicHandoff | undefined): AtomicHandoff | undefined {
    if (handoff !== undefined && handoff.expiresAt <= Date.now()) {
      this.releaseHandoff(handoff);
      return undefined;
    }
    return handoff;
  }

  private releaseHandoffIfConsumed(handoff: AtomicHandoff): void {
    if (handoff.compressedServed && handoff.proofServed) this.releaseHandoff(handoff);
  }

  private releaseHandoff(handoff: AtomicHandoff): void {
    if (this.handoffByCompressedAddress.get(handoff.compressedKey) === handoff) {
      this.handoffByCompressedAddress.delete(handoff.compressedKey);
    }
    if (this.handoffByHash.get(handoff.hashKey) === handoff) {
      this.handoffByHash.delete(handoff.hashKey);
    }
  }
}

/**
 * Creates the sole current Photon composition. The caller supplies no proof callback or
 * resolver: account bytes, inclusion proof, finalized slot, and tag-219 manifest all come
 * from the pinned Light 0.23 transport and are validated as one observation.
 */
export async function createCurrentPhotonConnection(
  input: CreateCurrentPhotonConnectionInput,
): Promise<CurrentPhotonConnection> {
  const photonEndpoint = parseCurrentPhotonEndpoint(input.photonRpcUrl, "Photon RPC URL");
  const stateEndpoint = parseCurrentPhotonEndpoint(input.stateConnection.rpcEndpoint, "state RPC URL");
  const providerOriginSha256 = hashHex(photonEndpoint.origin);
  if (
    !/^[0-9a-f]{64}$/.test(input.authorizedProviderOriginSha256)
    || input.authorizedProviderOriginSha256 !== providerOriginSha256
  ) {
    throw photonError(
      "CURRENT_PHOTON_PROVIDER_UNAUTHORIZED",
      "Photon provider origin does not match the explicitly authorized origin hash",
    );
  }
  if (
    photonEndpoint.origin === stateEndpoint.origin
    && !unifiedPrivateHeliusProviderAllowed(input, photonEndpoint, stateEndpoint)
  ) {
    throw photonError(
      "CURRENT_PHOTON_ENDPOINTS_NOT_SEPARATE",
      "Light/Photon RPC must be distinct from the finalized standard state RPC unless one exact private Helius Devnet URL is explicitly authorized",
    );
  }
  if (input.stateConnection.commitment !== CURRENT_PHOTON_COMMITMENT) {
    throw photonError(
      "CURRENT_PHOTON_STATE_COMMITMENT_INVALID",
      "the standard state Connection must be constructed with finalized commitment",
    );
  }
  if (typeof input.createLightAtaLoadInstructions !== "function") {
    throw photonError(
      "CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID",
      "the current Light ATA loader callback must be supplied before transport attestation",
    );
  }
  let rpc: Rpc;
  try {
    rpc = createRpc(
      photonEndpoint.href,
      photonEndpoint.href,
      photonEndpoint.href,
      {
        commitment: CURRENT_PHOTON_COMMITMENT,
        disableRetryOnRateLimit: true,
        fetch: currentPhotonGuardedFetch,
      },
    );
  } catch {
    throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon transport could not be constructed");
  }
  let stateGenesis: string;
  let photonGenesis: string;
  let addressTreeInfo: TreeInfo;
  let stateTreeInfos: TreeInfo[];
  try {
    [stateGenesis, photonGenesis, addressTreeInfo, stateTreeInfos] = await withCurrentPhotonFetchGuard(
      photonEndpoint,
      () => Promise.all([
        input.stateConnection.getGenesisHash(),
        rpc.getGenesisHash(),
        rpc.getAddressTreeInfoV2(),
        rpc.getStateTreeInfos(),
      ]),
    );
  } catch {
    // Provider errors can include the private href; retain only the typed boundary failure.
    throw photonError("CURRENT_PHOTON_RPC_UNAVAILABLE", "current Photon topology attestation failed");
  }
  if (
    stateGenesis !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH
    || photonGenesis !== CURRENT_PROTOCOL_DEVNET_GENESIS_HASH
  ) {
    throw photonError(
      "CURRENT_PHOTON_GENESIS_MISMATCH",
      "Photon and standard state transports must both attest the maintained Devnet genesis",
    );
  }
  validateCurrentPhotonTopology(addressTreeInfo, stateTreeInfos);
  return new CurrentPhotonConnectionImpl(
    rpc,
    input.stateConnection,
    photonEndpoint,
    providerOriginSha256,
    addressTreeInfo,
    stateTreeInfos,
    input.createLightAtaLoadInstructions,
    input.compressedEvidenceVerifier,
  );
}
