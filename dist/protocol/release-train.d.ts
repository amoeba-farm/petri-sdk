import { AmebaProtocolError } from "../errors.js";
export { SDK_PACKAGE_BUILD_IDENTITY } from "./current-build-identity.js";
/**
 * The RC44 package is retained only as a semantic reader baseline. It is not
 * evidence for the bytes currently deployed at the shared program address and
 * it is not eligible to construct a current write.
 */
export declare const HISTORICAL_RC44_READER_BASELINE: Readonly<{
    readonly kind: "historical-reader-semantic-baseline";
    readonly stateNamespace: "ameba-spread-v2";
    readonly spreadRelease: "v0.1.0-rc.44";
    readonly spreadSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
    readonly sdkProtocolPlanCommit: "b2cd10739ecb9419115980425920d6b576caf78e";
    readonly spreadPackage: {
        readonly name: "@amoeba/spread-release-tools";
        readonly version: "0.1.0";
        readonly sourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
        readonly artifactSha256: "ca6d861d8b576a3df3de14892f01a10a59bcab6bedf9f3643b7f0a8a7ccf5d7c";
    };
    readonly deployment: {
        readonly programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
        readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
        readonly deployedSlot: 487702729;
        readonly programPayloadBytes: 1142664;
        readonly programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
        readonly upgradeAuthority: {
            readonly mode: "external-authority";
            readonly address: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
        };
    };
    readonly currentWriteEligible: false;
}>;
/** Exact finalized byte identity currently observed at the target program. */
export declare const HISTORICAL_GENERATION_1_DEPLOYMENT: Readonly<{
    readonly kind: "finalized-live-byte-observation";
    readonly provenance: "live-byte-identity-only";
    readonly releaseLabel: "ameba-spread-governance-bridge-devnet-v1";
    readonly cluster: "devnet";
    readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly stateNamespace: "ameba-spread-v2";
    readonly sourceCommit: null;
    readonly programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
    readonly programAccountBytes: 36;
    readonly programAccountSha256: "1096d571b6d1a509ecc018f3aa3f1375757bdcbd1d0b89dd62ab3dcb985a07a0";
    readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
    readonly programDataAccountBytes: 1241821;
    readonly programDataAccountSha256: "985ed6c25d69cdef58e5904362f46776da6c151857d143d61b86c58883b783b2";
    readonly programDataPayloadBytes: 1241776;
    readonly programDataPayloadSha256: "ae73299ecedbb9153544a600fd663635c1107ab3efa288f7bdec3ffbe557c684";
    readonly programDataSlot: 491417083;
    readonly finalizedVerificationContextSlot: 491618371;
    readonly upgradeAuthority: {
        readonly mode: "external-authority";
        readonly address: "CqFREUP84XzdUC6WeDZrzTBXLwnfMQM2K9MvwdhApXt4";
    };
    readonly deploymentReceiptSignature: "4YAeu29vSPfm5Gk7xvN5w4u1X7z3qT4tDUxL9Py16xB4Fp3QpN3DsZbdGQeWNLydZxXJn2ejp4Q1qPDBbdf956Lh";
    readonly writeCompatibility: "unavailable-governance-gate-v1";
}>;
export declare const CURRENT_LIVE_DEPLOYMENT: Readonly<{
    readonly cluster: "devnet";
    readonly stateNamespace: "ameba-spread-v2";
    readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
    readonly kind: string;
    readonly provenance: string;
    readonly releaseLabel: string;
    readonly sourceCommit: string;
    readonly artifactSourceCommit: string;
    readonly programId: string;
    readonly programDataAddress: string;
    readonly programAccountBytes: number;
    readonly programAccountSha256: string;
    readonly programDataAccountBytes: number;
    readonly programDataAccountSha256: string;
    readonly programDataPayloadBytes: number;
    readonly programDataPayloadSha256: string;
    readonly artifactBytes: number;
    readonly artifactSha256: string;
    readonly mandatoryZeroPaddingBytes: number;
    readonly programDataSlot: number;
    readonly upgradeAuthority: {
        mode: string;
        address: string;
    };
    readonly writeCompatibility: string;
    readonly liveReadProfileId: string;
    readonly buildFeatures: string[];
    readonly minimumContextSlot: number;
    readonly finalizedObservationSlot: number;
    readonly observedAt: string;
    readonly receiptPath: string;
    readonly descriptorPath: string;
}>;
export declare const CURRENT_GOVERNANCE_GENERATION_3: Readonly<{
    readonly identityGeneration: 3;
    readonly live: boolean;
    readonly environment: string;
    readonly controllerProgramId: string;
    readonly controllerProgramData: string;
    readonly controllerConfigPda: string;
    readonly protocolGatePda: string;
    readonly targetProgramId: string;
    readonly targetProgramData: string;
    readonly controllerSourceCommit: string;
    readonly artifactSha256: string;
    readonly programDataSha256: string;
    readonly deploymentReceiptSha256: string;
    readonly mainnetAllowed: boolean;
    readonly upgradeAuthority: {
        mode: string;
        address: string;
    };
    readonly bridgeAbi: {
        gateDiscriminatorAscii: string;
        gateLength: number;
        gateVersion: number;
        tailMagicAscii: string;
        tailLength: number;
        tailVersion: number;
    };
    readonly pinnedObservation: {
        status: string;
        epoch: string;
        accountSha256: string;
        observedAt: string;
        observedAtOrAfterSlot: number;
        provenance: string;
    };
    readonly identityManifestSha256: string;
}>;
/** Governance generation that owns the gate linked to the live deployment. */
export declare const CURRENT_GOVERNANCE_GENERATION_1: Readonly<{
    readonly identityGeneration: 1;
    readonly live: true;
    readonly observedCluster: "devnet";
    readonly controllerProgramId: "CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa";
    readonly controllerConfigPda: "EidroUR2MafnWYtoY2HPsycNkLnis493Nj7CNZGohShi";
    readonly protocolGatePda: "4xsWiYnxBmWPY51YY3QJc1JVfQxz3wk7dyfgmsYfkueV";
    readonly targetProgramId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
    readonly targetProgramData: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
    readonly identityManifestSha256: "0c77e0dc9b9607f7f1d8aec914f80a7bc610a40c3a5ebe7d3268f744e705c4d7";
    readonly reviewedControllerSourceCommit: "9f3414315d53f70fe029c7f3480c9d45b8674da2";
    readonly controllerArtifactSha256: "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18";
    readonly controllerProgramDataSha256: "ee11d4993f433522ea66df7c28877eb6295be9fb799c49baea5208657622a0f7";
    readonly controllerImmutabilityReceiptSha256: "8a968e0139d4dd7da538b1de147f9448eec404aa986092c466b2cad9dc74c365";
    readonly spreadBridgePlanSha256: "c5f0cc74af19eb7126f599d86008a99948d6aedabd4ad686f5103dbade084c45";
    readonly bridgeAbi: {
        readonly gateDiscriminatorAscii: "AGVGAT01";
        readonly gateLength: 192;
        readonly gateVersion: 1;
        readonly tailMagicAscii: "AGV1";
        readonly tailLength: 16;
        readonly tailVersion: 1;
    };
    readonly pinnedObservation: {
        readonly status: "EmergencyFrozen";
        readonly epoch: "1";
        readonly accountSha256: "442f9708578f917394b829c17fad0655701c07438f1769577e0e3f353775be52";
        readonly observedAtOrAfterSlot: 492266411;
    };
}>;
/** Reviewed Generation 2 candidate. Review is deliberately not activation. */
export declare const REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE: Readonly<{
    readonly identityGeneration: 2;
    readonly live: false;
    readonly environment: "devnet";
    readonly controllerProgramId: "FqCshwTvCzQRZYHFiX96nwiG93xwgWRMyCj5onvoo7Lm";
    readonly controllerProgramData: "7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed";
    readonly controllerConfigPda: "CvWy6F8YAB1FZD9kuDFBpKU11V1w93nbXXizFobSmYR8";
    readonly protocolGatePda: "CiszKKUZAUAb4DrZF8FBUJf136SVLY73d6J2MdyrinLL";
    readonly targetProgramId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
    readonly targetProgramData: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
    readonly controllerSourceCommit: "b54648cf4753a8093ac0e21a0dceb0db8eebb29b";
    readonly identityManifestSha256: "d9e3cb29f7b11345bc4a1f381017231693e25f7ac2e4ec8a093430cb35540326";
    readonly artifactSha256: "6c833854f4d7b9b37264c214673a321b4ef62b59fd7fd4733c26eaaa3bd2e157";
    readonly programDataSha256: "d42c14178ca92dacc6af30ffa98e3c08029cf1b54102ad197fe1ab16a8bd16ba";
    readonly immutabilityReceiptSha256: "dab00a14070413968532c9c28ab96b33ca6bf84b6b841c0f10e191b529b93208";
    readonly spreadBridgePlanSha256: "f1c2d6790e84c843852ea780e0f2f6ea7a3e8a4155a8fecf849748a86342b69e";
    readonly independentReviewCount: 2;
    readonly productionUseAuthorized: true;
    readonly mainnetAllowed: false;
    readonly activationEvidence: null;
    readonly upgradeAuthority: {
        readonly mode: "immutable-none";
        readonly address: null;
    };
    readonly pinnedObservation: {
        readonly status: "Active";
        readonly epoch: "2";
        readonly accountSha256: "c0448b07caa4edf93fb85530ef42620abb9fe332067c83bd4d09e8bc860ef60e";
        readonly observedAtOrAfterSlot: 492266411;
    };
}>;
/** The one canonical release-train record consumed by SDK release checks. */
export declare const RETAINED_DEPLOYED_SDK_RELEASE_TRAIN: Readonly<{
    readonly schema: "ameba.sdk.release-train.v1";
    readonly schemaVersion: 1;
    readonly preparedDate: "2026-09-11";
    readonly packageSource: {
        readonly repository: "SPACE999978/ameba_sdk";
        readonly implementationBaseCommit: "57e328e078d02c48a4b692628b790f51ed7ce1f0";
        readonly candidateCommit: null;
        readonly status: "unreleased-candidate";
    };
    readonly protocolPlanSource: {
        readonly sdkCommit: "b2cd10739ecb9419115980425920d6b576caf78e";
        readonly scope: "historical-rc44-portable-plans";
        readonly currentWriteEligible: false;
    };
    readonly sourceHeads: {
        readonly sdkBase: "57e328e078d02c48a4b692628b790f51ed7ce1f0";
        readonly spread: "397bd8403c7803574597a7ff3650a303b92f96c0";
        readonly governance: "bfb79641641009839e8e73fd92ee45fda51314e5";
        readonly lean: "745d6ddb376b3d646e391038e4af5e21a61eceb9";
        readonly cli: "d47907ae215e338412d33859e71c25f034d3f24b";
    };
    readonly readerSemanticBaseline: Readonly<{
        readonly kind: "historical-reader-semantic-baseline";
        readonly stateNamespace: "ameba-spread-v2";
        readonly spreadRelease: "v0.1.0-rc.44";
        readonly spreadSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
        readonly sdkProtocolPlanCommit: "b2cd10739ecb9419115980425920d6b576caf78e";
        readonly spreadPackage: {
            readonly name: "@amoeba/spread-release-tools";
            readonly version: "0.1.0";
            readonly sourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
            readonly artifactSha256: "ca6d861d8b576a3df3de14892f01a10a59bcab6bedf9f3643b7f0a8a7ccf5d7c";
        };
        readonly deployment: {
            readonly programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
            readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
            readonly deployedSlot: 487702729;
            readonly programPayloadBytes: 1142664;
            readonly programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
            readonly upgradeAuthority: {
                readonly mode: "external-authority";
                readonly address: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
            };
        };
        readonly currentWriteEligible: false;
    }>;
    readonly finalizedLiveDeployment: Readonly<{
        readonly cluster: "devnet";
        readonly stateNamespace: "ameba-spread-v2";
        readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
        readonly kind: string;
        readonly provenance: string;
        readonly releaseLabel: string;
        readonly sourceCommit: string;
        readonly artifactSourceCommit: string;
        readonly programId: string;
        readonly programDataAddress: string;
        readonly programAccountBytes: number;
        readonly programAccountSha256: string;
        readonly programDataAccountBytes: number;
        readonly programDataAccountSha256: string;
        readonly programDataPayloadBytes: number;
        readonly programDataPayloadSha256: string;
        readonly artifactBytes: number;
        readonly artifactSha256: string;
        readonly mandatoryZeroPaddingBytes: number;
        readonly programDataSlot: number;
        readonly upgradeAuthority: {
            mode: string;
            address: string;
        };
        readonly writeCompatibility: string;
        readonly liveReadProfileId: string;
        readonly buildFeatures: string[];
        readonly minimumContextSlot: number;
        readonly finalizedObservationSlot: number;
        readonly observedAt: string;
        readonly receiptPath: string;
        readonly descriptorPath: string;
    }>;
    readonly selectedGovernanceGeneration: 3;
    readonly liveGovernanceIdentity: Readonly<{
        readonly identityGeneration: 3;
        readonly live: boolean;
        readonly environment: string;
        readonly controllerProgramId: string;
        readonly controllerProgramData: string;
        readonly controllerConfigPda: string;
        readonly protocolGatePda: string;
        readonly targetProgramId: string;
        readonly targetProgramData: string;
        readonly controllerSourceCommit: string;
        readonly artifactSha256: string;
        readonly programDataSha256: string;
        readonly deploymentReceiptSha256: string;
        readonly mainnetAllowed: boolean;
        readonly upgradeAuthority: {
            mode: string;
            address: string;
        };
        readonly bridgeAbi: {
            gateDiscriminatorAscii: string;
            gateLength: number;
            gateVersion: number;
            tailMagicAscii: string;
            tailLength: number;
            tailVersion: number;
        };
        readonly pinnedObservation: {
            status: string;
            epoch: string;
            accountSha256: string;
            observedAt: string;
            observedAtOrAfterSlot: number;
            provenance: string;
        };
        readonly identityManifestSha256: string;
    }>;
    readonly reviewedCandidateGovernanceIdentity: Readonly<{
        readonly identityGeneration: 2;
        readonly live: false;
        readonly environment: "devnet";
        readonly controllerProgramId: "FqCshwTvCzQRZYHFiX96nwiG93xwgWRMyCj5onvoo7Lm";
        readonly controllerProgramData: "7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed";
        readonly controllerConfigPda: "CvWy6F8YAB1FZD9kuDFBpKU11V1w93nbXXizFobSmYR8";
        readonly protocolGatePda: "CiszKKUZAUAb4DrZF8FBUJf136SVLY73d6J2MdyrinLL";
        readonly targetProgramId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
        readonly targetProgramData: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
        readonly controllerSourceCommit: "b54648cf4753a8093ac0e21a0dceb0db8eebb29b";
        readonly identityManifestSha256: "d9e3cb29f7b11345bc4a1f381017231693e25f7ac2e4ec8a093430cb35540326";
        readonly artifactSha256: "6c833854f4d7b9b37264c214673a321b4ef62b59fd7fd4733c26eaaa3bd2e157";
        readonly programDataSha256: "d42c14178ca92dacc6af30ffa98e3c08029cf1b54102ad197fe1ab16a8bd16ba";
        readonly immutabilityReceiptSha256: "dab00a14070413968532c9c28ab96b33ca6bf84b6b841c0f10e191b529b93208";
        readonly spreadBridgePlanSha256: "f1c2d6790e84c843852ea780e0f2f6ea7a3e8a4155a8fecf849748a86342b69e";
        readonly independentReviewCount: 2;
        readonly productionUseAuthorized: true;
        readonly mainnetAllowed: false;
        readonly activationEvidence: null;
        readonly upgradeAuthority: {
            readonly mode: "immutable-none";
            readonly address: null;
        };
        readonly pinnedObservation: {
            readonly status: "Active";
            readonly epoch: "2";
            readonly accountSha256: "c0448b07caa4edf93fb85530ef42620abb9fe332067c83bd4d09e8bc860ef60e";
            readonly observedAtOrAfterSlot: 492266411;
        };
    }>;
    readonly fixtures: {
        readonly governanceGates: {
            readonly path: "fixtures/governance-gates-v1.json";
            readonly sha256: "19401693c8295a4ec84ad75fcd561ccc7ae55bf5484f476ede2f27d4ccab08bf";
        };
        readonly currentFinalizedObservation: {
            readonly path: "fixtures/current-finalized-observation-v1.json";
            readonly sha256: "0663e45137344dff86517d03b3106fd009e96d63de0eb1d2e0140f87c5eb067f";
        };
        readonly writerSemantics: {
            readonly path: "fixtures/writer_sleeve_math_v1.json";
            readonly sha256: "2a6da8a7d76b85cfc73e6395ade978e944679a000d4f8e181b85118b725c2f58";
        };
    };
    readonly toolchain: {
        readonly nodeMajors: readonly [22, 24];
        readonly npm: "10.9.8";
        readonly typescript: "5.9.3";
    };
    readonly ci: {
        readonly cliParityCommit: "d47907ae215e338412d33859e71c25f034d3f24b";
        readonly cliSdkCompatibilityCommit: "57e328e078d02c48a4b692628b790f51ed7ce1f0";
        readonly spreadSemanticCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
        readonly pullRequestSecrets: false;
        readonly dependencyLifecycleScripts: false;
    };
    readonly writeRelease: {
        readonly status: "available";
        readonly compatibility: "governance-gate-v1";
        readonly governanceIdentityGeneration: 3;
        readonly spreadReleaseCommit: "397bd8403c7803574597a7ff3650a303b92f96c0";
        readonly spreadPackageArtifactSha256: "de8d9feb83f009bd4744b74285f8b379e3dea8c8059e2c86013d56613e038872";
        readonly instructionManifestSha256: "1aed01b9e8b251a01996ac880511d84fd42db48d259d385557a38de662387736";
        readonly programDataPayloadSha256: "903c58504f44e8820e5c9f99765b26be15a97504ec5fdd0855f3668f29927fee";
        readonly assignedInstructionTags: readonly [0, 2, 3, 9, 10, 11, 30, 59, 63, 64, 65, 75, 80, 81, 84, 86, 87, 89, 90, 91, 92, 93, 94, 96, 109, 110, 113, 116, 121, 122, 124, 128, 129, 131, 133, 135, 136, 137, 138, 139, 140, 141, 154, 155, 156, 157, 158, 159, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 205, 207, 208, 209, 210, 213, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255];
        readonly writerOperationTransport: {
            readonly schemaVersion: 1;
            readonly preset: "writer-auction-v2-full-inventory-v1";
            readonly writerPlanSchemaVersion: 2;
            readonly setupMode: "release_compute";
            readonly instructionTags: readonly [14, 15, 200];
            readonly setupProgramId: "ComputeBudget111111111111111111111111111111";
            readonly setupInstructionDataBase64: readonly ["AQAAAQA=", "AsBcFQA="];
            readonly setupAccountCount: 0;
            readonly setupSignerRoleCount: 0;
            readonly actionBatchIndex: 0;
            readonly actionInstructionCount: 1;
        };
        readonly writerOperationTransportSha256: "07cb128836a19005cfe4220154750ed8f20f4ac7203a4110908f561e58382e25";
        readonly writerDlmmTransport: {
            readonly schemaVersion: 1;
            readonly preset: "writer-liquidity-v1-candidate";
            readonly qualified: false;
            readonly writerPlanSchemaVersion: 2;
            readonly setupMode: "writer_liquidity_compute";
            readonly instructionTag: 159;
            readonly heapFrameBytes: 65536;
            readonly computeUnitLimit: 1400000;
            readonly setupProgramId: "ComputeBudget111111111111111111111111111111";
            readonly setupInstructionNames: readonly ["RequestHeapFrame", "SetComputeUnitLimit"];
            readonly setupInstructionDataBase64: readonly ["AQAAAQA=", "AsBcFQA="];
            readonly setupAccountCount: 0;
            readonly setupSignerRoleCount: 0;
            readonly actionBatchIndex: 0;
            readonly actionInstructionCount: 1;
            readonly maximumTransactionBytes: 1232;
            readonly maximumLookupTables: 1;
            readonly maximumLookupAddresses: 256;
        };
        readonly writerDlmmTransportSha256: "f34bf779fa19744f32cdd2fc7c6cddd3e95d1809ca1105137bed1f48e76393de";
    };
    readonly authorization: {
        readonly channel: "preproduction";
        readonly environment: "devnet";
        readonly deploymentEnabled: false;
        readonly upgradeAuthorized: false;
        readonly authorityHandoffAuthorized: false;
        readonly productionEnabled: false;
        readonly mainnetEnabled: false;
        readonly branchOrReviewIsAuthority: false;
    };
    readonly rollback: {
        readonly mutationPolicy: "fail-closed";
        readonly readerFallback: "historical-rc44-semantic-decoders-only";
    };
}>;
export declare const SDK_RELEASE_TRAIN: Readonly<{
    packageBuildIdentity: Readonly<{
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
    currentWriteEligible: boolean;
    writeRelease: {
        status: "available" | "unavailable";
        packageCompatibility: string;
        compatibility: "governance-gate-v1";
        governanceIdentityGeneration: 3;
        spreadReleaseCommit: "397bd8403c7803574597a7ff3650a303b92f96c0";
        spreadPackageArtifactSha256: "de8d9feb83f009bd4744b74285f8b379e3dea8c8059e2c86013d56613e038872";
        instructionManifestSha256: "1aed01b9e8b251a01996ac880511d84fd42db48d259d385557a38de662387736";
        programDataPayloadSha256: "903c58504f44e8820e5c9f99765b26be15a97504ec5fdd0855f3668f29927fee";
        assignedInstructionTags: readonly [0, 2, 3, 9, 10, 11, 30, 59, 63, 64, 65, 75, 80, 81, 84, 86, 87, 89, 90, 91, 92, 93, 94, 96, 109, 110, 113, 116, 121, 122, 124, 128, 129, 131, 133, 135, 136, 137, 138, 139, 140, 141, 154, 155, 156, 157, 158, 159, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 205, 207, 208, 209, 210, 213, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255];
        writerOperationTransport: {
            readonly schemaVersion: 1;
            readonly preset: "writer-auction-v2-full-inventory-v1";
            readonly writerPlanSchemaVersion: 2;
            readonly setupMode: "release_compute";
            readonly instructionTags: readonly [14, 15, 200];
            readonly setupProgramId: "ComputeBudget111111111111111111111111111111";
            readonly setupInstructionDataBase64: readonly ["AQAAAQA=", "AsBcFQA="];
            readonly setupAccountCount: 0;
            readonly setupSignerRoleCount: 0;
            readonly actionBatchIndex: 0;
            readonly actionInstructionCount: 1;
        };
        writerOperationTransportSha256: "07cb128836a19005cfe4220154750ed8f20f4ac7203a4110908f561e58382e25";
        writerDlmmTransport: {
            readonly schemaVersion: 1;
            readonly preset: "writer-liquidity-v1-candidate";
            readonly qualified: false;
            readonly writerPlanSchemaVersion: 2;
            readonly setupMode: "writer_liquidity_compute";
            readonly instructionTag: 159;
            readonly heapFrameBytes: 65536;
            readonly computeUnitLimit: 1400000;
            readonly setupProgramId: "ComputeBudget111111111111111111111111111111";
            readonly setupInstructionNames: readonly ["RequestHeapFrame", "SetComputeUnitLimit"];
            readonly setupInstructionDataBase64: readonly ["AQAAAQA=", "AsBcFQA="];
            readonly setupAccountCount: 0;
            readonly setupSignerRoleCount: 0;
            readonly actionBatchIndex: 0;
            readonly actionInstructionCount: 1;
            readonly maximumTransactionBytes: 1232;
            readonly maximumLookupTables: 1;
            readonly maximumLookupAddresses: 256;
        };
        writerDlmmTransportSha256: "f34bf779fa19744f32cdd2fc7c6cddd3e95d1809ca1105137bed1f48e76393de";
    };
    schema: "ameba.sdk.release-train.v1";
    schemaVersion: 1;
    preparedDate: "2026-09-11";
    packageSource: {
        readonly repository: "SPACE999978/ameba_sdk";
        readonly implementationBaseCommit: "57e328e078d02c48a4b692628b790f51ed7ce1f0";
        readonly candidateCommit: null;
        readonly status: "unreleased-candidate";
    };
    protocolPlanSource: {
        readonly sdkCommit: "b2cd10739ecb9419115980425920d6b576caf78e";
        readonly scope: "historical-rc44-portable-plans";
        readonly currentWriteEligible: false;
    };
    sourceHeads: {
        readonly sdkBase: "57e328e078d02c48a4b692628b790f51ed7ce1f0";
        readonly spread: "397bd8403c7803574597a7ff3650a303b92f96c0";
        readonly governance: "bfb79641641009839e8e73fd92ee45fda51314e5";
        readonly lean: "745d6ddb376b3d646e391038e4af5e21a61eceb9";
        readonly cli: "d47907ae215e338412d33859e71c25f034d3f24b";
    };
    readerSemanticBaseline: Readonly<{
        readonly kind: "historical-reader-semantic-baseline";
        readonly stateNamespace: "ameba-spread-v2";
        readonly spreadRelease: "v0.1.0-rc.44";
        readonly spreadSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
        readonly sdkProtocolPlanCommit: "b2cd10739ecb9419115980425920d6b576caf78e";
        readonly spreadPackage: {
            readonly name: "@amoeba/spread-release-tools";
            readonly version: "0.1.0";
            readonly sourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
            readonly artifactSha256: "ca6d861d8b576a3df3de14892f01a10a59bcab6bedf9f3643b7f0a8a7ccf5d7c";
        };
        readonly deployment: {
            readonly programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
            readonly programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
            readonly deployedSlot: 487702729;
            readonly programPayloadBytes: 1142664;
            readonly programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b";
            readonly upgradeAuthority: {
                readonly mode: "external-authority";
                readonly address: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
            };
        };
        readonly currentWriteEligible: false;
    }>;
    finalizedLiveDeployment: Readonly<{
        readonly cluster: "devnet";
        readonly stateNamespace: "ameba-spread-v2";
        readonly genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
        readonly kind: string;
        readonly provenance: string;
        readonly releaseLabel: string;
        readonly sourceCommit: string;
        readonly artifactSourceCommit: string;
        readonly programId: string;
        readonly programDataAddress: string;
        readonly programAccountBytes: number;
        readonly programAccountSha256: string;
        readonly programDataAccountBytes: number;
        readonly programDataAccountSha256: string;
        readonly programDataPayloadBytes: number;
        readonly programDataPayloadSha256: string;
        readonly artifactBytes: number;
        readonly artifactSha256: string;
        readonly mandatoryZeroPaddingBytes: number;
        readonly programDataSlot: number;
        readonly upgradeAuthority: {
            mode: string;
            address: string;
        };
        readonly writeCompatibility: string;
        readonly liveReadProfileId: string;
        readonly buildFeatures: string[];
        readonly minimumContextSlot: number;
        readonly finalizedObservationSlot: number;
        readonly observedAt: string;
        readonly receiptPath: string;
        readonly descriptorPath: string;
    }>;
    selectedGovernanceGeneration: 3;
    liveGovernanceIdentity: Readonly<{
        readonly identityGeneration: 3;
        readonly live: boolean;
        readonly environment: string;
        readonly controllerProgramId: string;
        readonly controllerProgramData: string;
        readonly controllerConfigPda: string;
        readonly protocolGatePda: string;
        readonly targetProgramId: string;
        readonly targetProgramData: string;
        readonly controllerSourceCommit: string;
        readonly artifactSha256: string;
        readonly programDataSha256: string;
        readonly deploymentReceiptSha256: string;
        readonly mainnetAllowed: boolean;
        readonly upgradeAuthority: {
            mode: string;
            address: string;
        };
        readonly bridgeAbi: {
            gateDiscriminatorAscii: string;
            gateLength: number;
            gateVersion: number;
            tailMagicAscii: string;
            tailLength: number;
            tailVersion: number;
        };
        readonly pinnedObservation: {
            status: string;
            epoch: string;
            accountSha256: string;
            observedAt: string;
            observedAtOrAfterSlot: number;
            provenance: string;
        };
        readonly identityManifestSha256: string;
    }>;
    reviewedCandidateGovernanceIdentity: Readonly<{
        readonly identityGeneration: 2;
        readonly live: false;
        readonly environment: "devnet";
        readonly controllerProgramId: "FqCshwTvCzQRZYHFiX96nwiG93xwgWRMyCj5onvoo7Lm";
        readonly controllerProgramData: "7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed";
        readonly controllerConfigPda: "CvWy6F8YAB1FZD9kuDFBpKU11V1w93nbXXizFobSmYR8";
        readonly protocolGatePda: "CiszKKUZAUAb4DrZF8FBUJf136SVLY73d6J2MdyrinLL";
        readonly targetProgramId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
        readonly targetProgramData: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
        readonly controllerSourceCommit: "b54648cf4753a8093ac0e21a0dceb0db8eebb29b";
        readonly identityManifestSha256: "d9e3cb29f7b11345bc4a1f381017231693e25f7ac2e4ec8a093430cb35540326";
        readonly artifactSha256: "6c833854f4d7b9b37264c214673a321b4ef62b59fd7fd4733c26eaaa3bd2e157";
        readonly programDataSha256: "d42c14178ca92dacc6af30ffa98e3c08029cf1b54102ad197fe1ab16a8bd16ba";
        readonly immutabilityReceiptSha256: "dab00a14070413968532c9c28ab96b33ca6bf84b6b841c0f10e191b529b93208";
        readonly spreadBridgePlanSha256: "f1c2d6790e84c843852ea780e0f2f6ea7a3e8a4155a8fecf849748a86342b69e";
        readonly independentReviewCount: 2;
        readonly productionUseAuthorized: true;
        readonly mainnetAllowed: false;
        readonly activationEvidence: null;
        readonly upgradeAuthority: {
            readonly mode: "immutable-none";
            readonly address: null;
        };
        readonly pinnedObservation: {
            readonly status: "Active";
            readonly epoch: "2";
            readonly accountSha256: "c0448b07caa4edf93fb85530ef42620abb9fe332067c83bd4d09e8bc860ef60e";
            readonly observedAtOrAfterSlot: 492266411;
        };
    }>;
    fixtures: {
        readonly governanceGates: {
            readonly path: "fixtures/governance-gates-v1.json";
            readonly sha256: "19401693c8295a4ec84ad75fcd561ccc7ae55bf5484f476ede2f27d4ccab08bf";
        };
        readonly currentFinalizedObservation: {
            readonly path: "fixtures/current-finalized-observation-v1.json";
            readonly sha256: "0663e45137344dff86517d03b3106fd009e96d63de0eb1d2e0140f87c5eb067f";
        };
        readonly writerSemantics: {
            readonly path: "fixtures/writer_sleeve_math_v1.json";
            readonly sha256: "2a6da8a7d76b85cfc73e6395ade978e944679a000d4f8e181b85118b725c2f58";
        };
    };
    toolchain: {
        readonly nodeMajors: readonly [22, 24];
        readonly npm: "10.9.8";
        readonly typescript: "5.9.3";
    };
    ci: {
        readonly cliParityCommit: "d47907ae215e338412d33859e71c25f034d3f24b";
        readonly cliSdkCompatibilityCommit: "57e328e078d02c48a4b692628b790f51ed7ce1f0";
        readonly spreadSemanticCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18";
        readonly pullRequestSecrets: false;
        readonly dependencyLifecycleScripts: false;
    };
    authorization: {
        readonly channel: "preproduction";
        readonly environment: "devnet";
        readonly deploymentEnabled: false;
        readonly upgradeAuthorized: false;
        readonly authorityHandoffAuthorized: false;
        readonly productionEnabled: false;
        readonly mainnetEnabled: false;
        readonly branchOrReviewIsAuthority: false;
    };
    rollback: {
        readonly mutationPolicy: "fail-closed";
        readonly readerFallback: "historical-rc44-semantic-decoders-only";
    };
}>;
export type SdkReleaseTrain = typeof SDK_RELEASE_TRAIN;
export type CurrentGovernanceIdentity = typeof CURRENT_GOVERNANCE_GENERATION_3;
export type ReviewedGovernanceGeneration2Identity = typeof REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE;
export type GovernanceIdentityV1 = CurrentGovernanceIdentity | typeof CURRENT_GOVERNANCE_GENERATION_1 | ReviewedGovernanceGeneration2Identity;
export declare class SdkReleaseTrainValidationError extends AmebaProtocolError {
    constructor(message: string);
}
export declare class CurrentWriteReleaseUnavailableError extends AmebaProtocolError {
    constructor();
}
/** Strictly rejects omitted, extra, substituted, or cross-generation fields. */
export declare function validateSdkReleaseTrain(value: unknown): SdkReleaseTrain;
export declare function isCurrentWriteReleaseAvailable(): boolean;
/** Readiness is qualified package evidence, never a caller switch. */
export declare function assertCurrentWriteReleaseAvailable(): void;
//# sourceMappingURL=release-train.d.ts.map