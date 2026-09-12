import { PublicKey, type Connection } from "@solana/web3.js";
import { createBN254, type AddressWithTree, type HashWithTree, type CompressedAccountWithMerkleContext, type ValidityProofWithContext, type WithContext } from "@lightprotocol/stateless.js";
import { type CompressedStateDomain } from "@amoeba/spread-release-tools/compressed-state";
import { type CurrentCompressedEvidenceRequest, type CurrentCompressedEvidenceResult, type CurrentCompressedEvidenceVerifier } from "./current-compressed-evidence-verifier.js";
import type { CurrentPhotonTopology } from "./current-photon.js";
export interface CurrentPhotonRawCompressedAccount {
    readonly owner: string;
    readonly address: string | null;
    readonly lamports: string;
    readonly data: {
        readonly discriminatorHex: string;
        readonly dataBase64: string;
        readonly dataHashHex: string;
    } | null;
    readonly tree: string;
    readonly queue: string;
    readonly leafIndex: string;
    readonly proveByIndex: boolean;
    readonly hashHex: string;
}
export interface CurrentPhotonNativeVerificationEvidence {
    /** Raw snapshot is internal evidence for independent consumers; do not blindly expose large tree accounts in public DTOs. */
    readonly request: CurrentCompressedEvidenceRequest;
    readonly result: CurrentCompressedEvidenceResult;
    readonly contextBindingJson: string;
    readonly executableSha256: string;
}
export interface CurrentPhotonVerifiedCompressedStateEvidence {
    readonly exists: boolean;
    readonly canonicalPda: string;
    readonly domain: number;
    readonly compressedAddress: string;
    readonly providerOriginSha256: string;
    readonly compressedAccount: CurrentPhotonRawCompressedAccount | null;
    readonly leaf: {
        readonly schemaVersion: number;
        readonly canonicalPda: string;
        readonly domain: number;
        readonly revision: string;
        readonly dataBase64: string;
    } | null;
    readonly proofBase64: string | null;
    readonly proofStatementJson: string;
    readonly verificationEvidence: CurrentPhotonNativeVerificationEvidence;
}
/** Internal to the attested Photon composition; caller supplies only its already bound transports/topology. */
export declare function readCurrentVerifiedCompressedStateEvidence(input: {
    readonly stateConnection: Connection;
    readonly providerOriginSha256: string;
    readonly topology: CurrentPhotonTopology;
    readonly verifier: CurrentCompressedEvidenceVerifier;
    readonly canonicalPda: PublicKey;
    readonly domain: CompressedStateDomain;
    readonly minimumContextSlot?: number;
    readonly getCompressedAccount: (address: ReturnType<typeof createBN254>) => Promise<CompressedAccountWithMerkleContext | null>;
    readonly getValidityProof: (hashes: HashWithTree[], addresses: AddressWithTree[]) => Promise<WithContext<ValidityProofWithContext>>;
}): Promise<CurrentPhotonVerifiedCompressedStateEvidence>;
//# sourceMappingURL=current-photon-verified.d.ts.map