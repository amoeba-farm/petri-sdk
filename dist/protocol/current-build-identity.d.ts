/** Actual package build inputs. A source inventory digest is never a Git revision. */
export declare const SDK_PACKAGE_BUILD_IDENTITY: Readonly<{
    schemaVersion: number;
    kind: string;
    qualified: boolean;
    deployed: boolean;
    packageName: string;
    packageVersion: string;
    sdkSource: {
        baseCommit: string;
        sourceCommit: null;
        sourceInventory: string;
        sourceInventorySha256: string;
    };
    nativePackage: {
        name: string;
        sourceCommit: string;
        dependencySpec: string;
        path: string;
        bytes: number;
        sha256: string;
        npmSha1: string;
        npmIntegrity: string;
        entryCount: number;
        unpackedBytes: number;
    };
    nativePackageSource: {
        repository: string;
        sourceCommit: string;
        sourceTree: string;
        sourceInventory: string;
        sourceInventorySha256: string;
    };
    nativeSource: {
        baseCommit: string;
        sourceCommit: string;
        sourceTree: string;
        rustInputsSha256: string;
        sourceInventory: string;
        sourceInventorySha256: string;
        sourceInventoryAlgorithm: string;
        cargoGitRevision: string;
    };
    nativeSbf: {
        fileName: string;
        bytes: number;
        sha256: string;
    };
    retainedLiveRelease: {
        descriptor: string;
        runtime: string;
    };
    nativeBuildReceipt: {
        path: string;
        sha256: string;
    };
    priorLocalBuildArtifacts: {
        scope: string;
        nativeRustInputsSha256: string;
        compressedEvidenceVerifier: {
            bytes: number;
            sha256: string;
            target: string;
            executionPerformed: boolean;
        };
        nativeSbf: {
            bytes: number;
            sha256: string;
            architecture: string;
            features: string[];
            executionPerformed: boolean;
        };
    };
    qualificationScope: string;
    finalizedDeployment: {
        descriptor: string;
        evidence: string;
        sourceCommit: string;
        artifactSha256: string;
        payloadSha256: string;
        deployedSlot: number;
        finalizedSlot: number;
        gateEpoch: string;
    };
}>;
/** Derived byte identity, not a caller-configurable availability switch. */
export declare const SDK_NATIVE_PACKAGE_MATCHES_RETAINED_RELEASE: boolean;
//# sourceMappingURL=current-build-identity.d.ts.map