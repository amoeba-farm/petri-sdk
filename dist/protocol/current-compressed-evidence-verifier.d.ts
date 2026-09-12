export declare const CURRENT_COMPRESSED_EVIDENCE_SCHEMA: "ameba-compressed-evidence-v1";
export interface CurrentCompressedEvidenceVerifierConfiguration {
    /** Deployment-owned absolute executable path; never supplied by a provider or request. */
    readonly executablePath: string;
    /** Actual qualified artifact digest. No default/placeholder binary hash is admitted. */
    readonly executableSha256: string;
    readonly timeoutMs?: number;
}
export interface CurrentCompressedEvidenceStatement {
    readonly kind: "state_merkle" | "state_queue" | "address_absent";
    readonly treeKeyHex: string;
    readonly queueKeyHex?: string;
    readonly valueHex: string;
    readonly leafIndex?: string;
    readonly rootHex?: string;
    readonly rootIndex?: number;
    readonly proofHex?: string;
}
export interface CurrentCompressedEvidenceAccount {
    readonly keyHex: string;
    readonly ownerHex: string;
    readonly executable: boolean;
    readonly dataHex: string;
}
export interface CurrentCompressedEvidenceIdentity {
    readonly programIdHex: string;
    readonly addressTreeKeyHex: string;
    readonly canonicalPdaHex: string;
    readonly domain: number;
}
export interface CurrentCompressedEvidenceLeafAccount {
    readonly ownerHex: string;
    readonly addressHex: string;
    readonly lamports: string;
    readonly discriminatorHex: string;
    readonly dataHex: string;
    readonly dataHashHex: string;
}
export interface CurrentCompressedEvidenceRequest {
    readonly schema: typeof CURRENT_COMPRESSED_EVIDENCE_SCHEMA;
    readonly finalizedSlot: string;
    readonly minimumSlot: string;
    readonly contextBindingHex: string;
    readonly identity: CurrentCompressedEvidenceIdentity;
    readonly compressedAccount?: CurrentCompressedEvidenceLeafAccount;
    readonly statement: CurrentCompressedEvidenceStatement;
    readonly accounts: readonly CurrentCompressedEvidenceAccount[];
}
export interface CurrentCompressedEvidenceResult {
    readonly schema: typeof CURRENT_COMPRESSED_EVIDENCE_SCHEMA;
    readonly requestSha256: string;
    readonly contextBindingHex: string;
    readonly finalizedSlot: string;
    readonly kind: CurrentCompressedEvidenceStatement["kind"];
    readonly valueHex: string;
    readonly compressedAddressHex: string;
    readonly dataHashHex: string | null;
    readonly treeKeyHex: string;
    readonly queueKeyHex: string | null;
    readonly rootHex: string | null;
    readonly rootIndex: number | null;
    readonly verification: "groth16_current_root_and_bloom" | "queue_inclusion_and_bloom";
}
export interface CurrentCompressedEvidenceVerifier {
    readonly executableSha256: string;
    verify(request: CurrentCompressedEvidenceRequest): Promise<CurrentCompressedEvidenceResult>;
}
export declare function requireCurrentCompressedEvidenceVerifier(value: CurrentCompressedEvidenceVerifier): void;
export declare function validateCurrentCompressedEvidenceRequest(request: CurrentCompressedEvidenceRequest): void;
export declare function createCurrentCompressedEvidenceVerifier(configuration: CurrentCompressedEvidenceVerifierConfiguration): Promise<CurrentCompressedEvidenceVerifier>;
/** Locate and fingerprint packaged native source without building, installing or executing it. */
export declare function readCurrentCompressedEvidenceVerifierSource(): Promise<Readonly<{
    root: string;
    manifest: Readonly<Record<string, unknown>>;
    files: readonly Readonly<{
        relativePath: string;
        path: string;
        sha256: string;
    }>[];
    artifactStatus: "source-only-unqualified";
}>>;
//# sourceMappingURL=current-compressed-evidence-verifier.d.ts.map