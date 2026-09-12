import { type CurrentPhotonVerifiedCompressedStateEvidence } from "./current-photon-verified.js";
import { type CurrentCompressedEvidenceVerifier } from "./current-compressed-evidence-verifier.js";
import { Buffer } from "buffer";
import { type AddressWithTree, type BN254, type CompressedAccountWithMerkleContext, type GetCompressedAccountsFilter, type HashWithTree, type ValidityProofWithContext, type WithContext, type WithCursor } from "@lightprotocol/stateless.js";
import { PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import { AmebaSdkError } from "../errors.js";
import { type CurrentPackedStateTreeInfo } from "./current-instructions.js";
import type { AmoebaDlmmColdAccountLoad } from "@amoeba/spread-release-tools/dlmm-light-interface";
import type { CompressedAmebaStateLeaf, CompressedStateDomain } from "@amoeba/spread-release-tools/compressed-state";
import { type CreateLightAtaLoadInstructions, type LightAtaLoadRequest, type LightAtaReadyActionPlan } from "@amoeba/spread-release-tools/reference-client";
declare const CURRENT_PHOTON_COMMITMENT: "finalized";
export declare const CURRENT_PHOTON_ERROR_CODES: readonly ["CURRENT_PHOTON_URL_INVALID", "CURRENT_PHOTON_PROVIDER_UNAUTHORIZED", "CURRENT_PHOTON_ENDPOINTS_NOT_SEPARATE", "CURRENT_PHOTON_STATE_COMMITMENT_INVALID", "CURRENT_PHOTON_GENESIS_MISMATCH", "CURRENT_PHOTON_ADDRESS_TREE_MISMATCH", "CURRENT_PHOTON_STATE_TREE_TOPOLOGY_MISMATCH", "CURRENT_PHOTON_RPC_UNAVAILABLE", "CURRENT_PHOTON_STATE_RPC_UNAVAILABLE", "CURRENT_PHOTON_ACCOUNT_INVALID", "CURRENT_PHOTON_PROOF_INVALID", "CURRENT_PHOTON_LOAD_INSTRUCTION_INVALID", "CURRENT_PHOTON_OWNER_QUERY_INVALID", "CURRENT_PHOTON_OWNER_QUERY_BOUND_EXCEEDED", "LIGHT_PROOF_UNAVAILABLE"];
export type CurrentPhotonErrorCode = (typeof CURRENT_PHOTON_ERROR_CODES)[number];
export declare class CurrentPhotonError extends AmebaSdkError {
    constructor(code: CurrentPhotonErrorCode, message: string, options?: {
        readonly cause?: unknown;
        readonly details?: Record<string, string | number | boolean | null>;
    });
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
export type CurrentPhotonCompressedStateEvidence = {
    readonly exists: true;
    readonly observation: CurrentPhotonCompressedStateObservation;
} | {
    readonly exists: false;
    readonly witness: CurrentPhotonCompressedNonmembershipWitness;
};
interface CurrentPhotonCompressedStateAccessFactBase {
    readonly domain: number;
    readonly accountIndex: number;
    readonly proofIndex: number;
    readonly canonicalPda: string;
    readonly compressedAddress: string;
}
export type CurrentPhotonCompressedStateAccessFact = CurrentPhotonCompressedStateAccessFactBase & {
    readonly kind: "readOnly";
    readonly treeInfo: CurrentPackedStateTreeInfo;
    readonly revision: string;
    readonly compactDataBase64: string;
} | CurrentPhotonCompressedStateAccessFactBase & {
    readonly kind: "mutable";
    readonly treeInfo: CurrentPackedStateTreeInfo;
    readonly outputStateTreeIndex: number;
    readonly revision: string;
    readonly compactDataBase64: string;
} | CurrentPhotonCompressedStateAccessFactBase & {
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
export type CurrentPhotonCompressedProofTreeFact = {
    readonly kind: "state_v2";
    readonly stateTree: string;
    readonly queue: string;
    readonly cpiContext: string;
} | {
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
    getCompressedAccount(address?: BN254, hash?: BN254): Promise<CompressedAccountWithMerkleContext | null>;
    getValidityProofAndRpcContext(hashes: HashWithTree[], newAddresses: AddressWithTree[]): Promise<WithContext<ValidityProofWithContext>>;
    getCompressedAccountsByOwner(owner: PublicKey, config: CurrentPhotonOwnerQueryConfig): Promise<WithCursor<CompressedAccountWithMerkleContext[]>>;
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
        readonly canonicalPda: PublicKey;
        readonly domain: CompressedStateDomain;
        readonly minimumContextSlot?: number;
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
    getCompressedAccount(address?: BN254, hash?: BN254): Promise<CompressedAccountWithMerkleContext | null>;
    getValidityProofAndRpcContext(hashes: HashWithTree[], newAddresses: AddressWithTree[]): Promise<WithContext<ValidityProofWithContext>>;
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
/**
 * Creates the sole current Photon composition. The caller supplies no proof callback or
 * resolver: account bytes, inclusion proof, finalized slot, and tag-219 manifest all come
 * from the pinned Light 0.23 transport and are validated as one observation.
 */
export declare function createCurrentPhotonConnection(input: CreateCurrentPhotonConnectionInput): Promise<CurrentPhotonConnection>;
export {};
//# sourceMappingURL=current-photon.d.ts.map