import v3 from "../../release/current-deployment.v1.json" with { type: "json" };
import { AmebaProtocolError } from "../errors.js";
import { currentGovernedWriteReleaseV1 } from "./current-governed-release-internal.js";
import { SDK_PACKAGE_BUILD_IDENTITY, SDK_NATIVE_PACKAGE_MATCHES_RETAINED_RELEASE } from "./current-build-identity.js";
export { SDK_PACKAGE_BUILD_IDENTITY } from "./current-build-identity.js";
/**
 * The RC44 package is retained only as a semantic reader baseline. It is not
 * evidence for the bytes currently deployed at the shared program address and
 * it is not eligible to construct a current write.
 */
export const HISTORICAL_RC44_READER_BASELINE = deepFreeze({
    kind: "historical-reader-semantic-baseline",
    stateNamespace: "ameba-spread-v2",
    spreadRelease: "v0.1.0-rc.44",
    spreadSourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18",
    sdkProtocolPlanCommit: "b2cd10739ecb9419115980425920d6b576caf78e",
    spreadPackage: {
        name: "@amoeba/spread-release-tools",
        version: "0.1.0",
        sourceCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18",
        artifactSha256: "ca6d861d8b576a3df3de14892f01a10a59bcab6bedf9f3643b7f0a8a7ccf5d7c",
    },
    deployment: {
        programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH",
        programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3",
        deployedSlot: 487_702_729,
        programPayloadBytes: 1_142_664,
        programPayloadSha256: "3bc781297d83e72faad1c63274f7f3745ef46bb60dcff16dd28a045b734a6c0b",
        upgradeAuthority: {
            mode: "external-authority",
            address: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq",
        },
    },
    currentWriteEligible: false,
});
/** Exact finalized byte identity currently observed at the target program. */
export const HISTORICAL_GENERATION_1_DEPLOYMENT = deepFreeze({
    kind: "finalized-live-byte-observation",
    provenance: "live-byte-identity-only",
    releaseLabel: "ameba-spread-governance-bridge-devnet-v1",
    cluster: "devnet",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    stateNamespace: "ameba-spread-v2",
    sourceCommit: null,
    programId: "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH",
    programAccountBytes: 36,
    programAccountSha256: "1096d571b6d1a509ecc018f3aa3f1375757bdcbd1d0b89dd62ab3dcb985a07a0",
    programDataAddress: "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3",
    programDataAccountBytes: 1_241_821,
    programDataAccountSha256: "985ed6c25d69cdef58e5904362f46776da6c151857d143d61b86c58883b783b2",
    programDataPayloadBytes: 1_241_776,
    programDataPayloadSha256: "ae73299ecedbb9153544a600fd663635c1107ab3efa288f7bdec3ffbe557c684",
    programDataSlot: 491_417_083,
    finalizedVerificationContextSlot: 491_618_371,
    upgradeAuthority: {
        mode: "external-authority",
        address: "CqFREUP84XzdUC6WeDZrzTBXLwnfMQM2K9MvwdhApXt4",
    },
    deploymentReceiptSignature: "4YAeu29vSPfm5Gk7xvN5w4u1X7z3qT4tDUxL9Py16xB4Fp3QpN3DsZbdGQeWNLydZxXJn2ejp4Q1qPDBbdf956Lh",
    writeCompatibility: "unavailable-governance-gate-v1",
});
export const CURRENT_LIVE_DEPLOYMENT = deepFreeze({ ...v3.deployment, cluster: "devnet", stateNamespace: "ameba-spread-v2", genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" });
export const CURRENT_GOVERNANCE_GENERATION_3 = deepFreeze({ ...v3.governance, identityGeneration: 3 });
/** Governance generation that owns the gate linked to the live deployment. */
export const CURRENT_GOVERNANCE_GENERATION_1 = deepFreeze({
    identityGeneration: 1,
    live: true,
    observedCluster: "devnet",
    controllerProgramId: "CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa",
    controllerConfigPda: "EidroUR2MafnWYtoY2HPsycNkLnis493Nj7CNZGohShi",
    protocolGatePda: "4xsWiYnxBmWPY51YY3QJc1JVfQxz3wk7dyfgmsYfkueV",
    targetProgramId: HISTORICAL_GENERATION_1_DEPLOYMENT.programId,
    targetProgramData: HISTORICAL_GENERATION_1_DEPLOYMENT.programDataAddress,
    identityManifestSha256: "0c77e0dc9b9607f7f1d8aec914f80a7bc610a40c3a5ebe7d3268f744e705c4d7",
    reviewedControllerSourceCommit: "9f3414315d53f70fe029c7f3480c9d45b8674da2",
    controllerArtifactSha256: "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18",
    controllerProgramDataSha256: "ee11d4993f433522ea66df7c28877eb6295be9fb799c49baea5208657622a0f7",
    controllerImmutabilityReceiptSha256: "8a968e0139d4dd7da538b1de147f9448eec404aa986092c466b2cad9dc74c365",
    spreadBridgePlanSha256: "c5f0cc74af19eb7126f599d86008a99948d6aedabd4ad686f5103dbade084c45",
    bridgeAbi: {
        gateDiscriminatorAscii: "AGVGAT01",
        gateLength: 192,
        gateVersion: 1,
        tailMagicAscii: "AGV1",
        tailLength: 16,
        tailVersion: 1,
    },
    pinnedObservation: {
        status: "EmergencyFrozen",
        epoch: "1",
        accountSha256: "442f9708578f917394b829c17fad0655701c07438f1769577e0e3f353775be52",
        observedAtOrAfterSlot: 492_266_411,
    },
});
/** Reviewed Generation 2 candidate. Review is deliberately not activation. */
export const REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE = deepFreeze({
    identityGeneration: 2,
    live: false,
    environment: "devnet",
    controllerProgramId: "FqCshwTvCzQRZYHFiX96nwiG93xwgWRMyCj5onvoo7Lm",
    controllerProgramData: "7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed",
    controllerConfigPda: "CvWy6F8YAB1FZD9kuDFBpKU11V1w93nbXXizFobSmYR8",
    protocolGatePda: "CiszKKUZAUAb4DrZF8FBUJf136SVLY73d6J2MdyrinLL",
    targetProgramId: HISTORICAL_GENERATION_1_DEPLOYMENT.programId,
    targetProgramData: HISTORICAL_GENERATION_1_DEPLOYMENT.programDataAddress,
    controllerSourceCommit: "b54648cf4753a8093ac0e21a0dceb0db8eebb29b",
    identityManifestSha256: "d9e3cb29f7b11345bc4a1f381017231693e25f7ac2e4ec8a093430cb35540326",
    artifactSha256: "6c833854f4d7b9b37264c214673a321b4ef62b59fd7fd4733c26eaaa3bd2e157",
    programDataSha256: "d42c14178ca92dacc6af30ffa98e3c08029cf1b54102ad197fe1ab16a8bd16ba",
    immutabilityReceiptSha256: "dab00a14070413968532c9c28ab96b33ca6bf84b6b841c0f10e191b529b93208",
    spreadBridgePlanSha256: "f1c2d6790e84c843852ea780e0f2f6ea7a3e8a4155a8fecf849748a86342b69e",
    independentReviewCount: 2,
    productionUseAuthorized: true,
    mainnetAllowed: false,
    activationEvidence: null,
    upgradeAuthority: { mode: "immutable-none", address: null },
    pinnedObservation: {
        status: "Active",
        epoch: "2",
        accountSha256: "c0448b07caa4edf93fb85530ef42620abb9fe332067c83bd4d09e8bc860ef60e",
        observedAtOrAfterSlot: 492_266_411,
    },
});
/** The one canonical release-train record consumed by SDK release checks. */
export const RETAINED_DEPLOYED_SDK_RELEASE_TRAIN = deepFreeze({
    schema: "ameba.sdk.release-train.v1",
    schemaVersion: 1,
    preparedDate: "2026-09-11",
    packageSource: {
        repository: "SPACE999978/ameba_sdk",
        implementationBaseCommit: "57e328e078d02c48a4b692628b790f51ed7ce1f0",
        candidateCommit: null,
        status: "unreleased-candidate",
    },
    protocolPlanSource: {
        sdkCommit: "b2cd10739ecb9419115980425920d6b576caf78e",
        scope: "historical-rc44-portable-plans",
        currentWriteEligible: false,
    },
    sourceHeads: {
        sdkBase: "57e328e078d02c48a4b692628b790f51ed7ce1f0",
        spread: "397bd8403c7803574597a7ff3650a303b92f96c0",
        governance: "bfb79641641009839e8e73fd92ee45fda51314e5",
        lean: "745d6ddb376b3d646e391038e4af5e21a61eceb9",
        cli: "d47907ae215e338412d33859e71c25f034d3f24b",
    },
    readerSemanticBaseline: HISTORICAL_RC44_READER_BASELINE,
    finalizedLiveDeployment: CURRENT_LIVE_DEPLOYMENT,
    selectedGovernanceGeneration: 3,
    liveGovernanceIdentity: CURRENT_GOVERNANCE_GENERATION_3,
    reviewedCandidateGovernanceIdentity: REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE,
    fixtures: {
        governanceGates: {
            path: "fixtures/governance-gates-v1.json",
            sha256: "19401693c8295a4ec84ad75fcd561ccc7ae55bf5484f476ede2f27d4ccab08bf",
        },
        currentFinalizedObservation: {
            path: "fixtures/current-finalized-observation-v1.json",
            sha256: "0663e45137344dff86517d03b3106fd009e96d63de0eb1d2e0140f87c5eb067f",
        },
        writerSemantics: {
            path: "fixtures/writer_sleeve_math_v1.json",
            sha256: "2a6da8a7d76b85cfc73e6395ade978e944679a000d4f8e181b85118b725c2f58",
        },
    },
    toolchain: {
        nodeMajors: [22, 24],
        npm: "10.9.8",
        typescript: "5.9.3",
    },
    ci: {
        cliParityCommit: "d47907ae215e338412d33859e71c25f034d3f24b",
        cliSdkCompatibilityCommit: "57e328e078d02c48a4b692628b790f51ed7ce1f0",
        spreadSemanticCommit: "1b2230d96e51f6582155d8284900fbfc11ff1f18",
        pullRequestSecrets: false,
        dependencyLifecycleScripts: false,
    },
    writeRelease: {
        "status": "available",
        "compatibility": "governance-gate-v1",
        "governanceIdentityGeneration": 3,
        "spreadReleaseCommit": "397bd8403c7803574597a7ff3650a303b92f96c0",
        "spreadPackageArtifactSha256": "de8d9feb83f009bd4744b74285f8b379e3dea8c8059e2c86013d56613e038872",
        "instructionManifestSha256": "1aed01b9e8b251a01996ac880511d84fd42db48d259d385557a38de662387736",
        "programDataPayloadSha256": "903c58504f44e8820e5c9f99765b26be15a97504ec5fdd0855f3668f29927fee",
        "assignedInstructionTags": [
            0,
            2,
            3,
            9,
            10,
            11,
            30,
            59,
            63,
            64,
            65,
            75,
            80,
            81,
            84,
            86,
            87,
            89,
            90,
            91,
            92,
            93,
            94,
            96,
            109,
            110,
            113,
            116,
            121,
            122,
            124,
            128,
            129,
            131,
            133,
            135,
            136,
            137,
            138,
            139,
            140,
            141,
            154,
            155,
            156,
            157,
            158,
            159,
            161,
            162,
            163,
            164,
            165,
            166,
            167,
            168,
            169,
            170,
            171,
            173,
            174,
            175,
            176,
            177,
            178,
            179,
            180,
            181,
            182,
            183,
            184,
            185,
            186,
            187,
            190,
            191,
            192,
            193,
            194,
            195,
            196,
            197,
            198,
            199,
            200,
            201,
            202,
            203,
            205,
            207,
            208,
            209,
            210,
            213,
            215,
            216,
            217,
            218,
            219,
            220,
            221,
            222,
            223,
            224,
            225,
            226,
            227,
            228,
            229,
            230,
            231,
            232,
            233,
            234,
            235,
            236,
            237,
            238,
            239,
            240,
            241,
            242,
            243,
            244,
            245,
            246,
            247,
            248,
            249,
            250,
            251,
            252,
            253,
            254,
            255
        ],
        "writerOperationTransport": {
            "schemaVersion": 1,
            "preset": "writer-auction-v2-full-inventory-v1",
            "writerPlanSchemaVersion": 2,
            "setupMode": "release_compute",
            "instructionTags": [
                14,
                15,
                200
            ],
            "setupProgramId": "ComputeBudget111111111111111111111111111111",
            "setupInstructionDataBase64": [
                "AQAAAQA=",
                "AsBcFQA="
            ],
            "setupAccountCount": 0,
            "setupSignerRoleCount": 0,
            "actionBatchIndex": 0,
            "actionInstructionCount": 1
        },
        "writerOperationTransportSha256": "07cb128836a19005cfe4220154750ed8f20f4ac7203a4110908f561e58382e25",
        "writerDlmmTransport": {
            "schemaVersion": 1,
            "preset": "writer-liquidity-v1-candidate",
            "qualified": false,
            "writerPlanSchemaVersion": 2,
            "setupMode": "writer_liquidity_compute",
            "instructionTag": 159,
            "heapFrameBytes": 65536,
            "computeUnitLimit": 1400000,
            "setupProgramId": "ComputeBudget111111111111111111111111111111",
            "setupInstructionNames": [
                "RequestHeapFrame",
                "SetComputeUnitLimit"
            ],
            "setupInstructionDataBase64": [
                "AQAAAQA=",
                "AsBcFQA="
            ],
            "setupAccountCount": 0,
            "setupSignerRoleCount": 0,
            "actionBatchIndex": 0,
            "actionInstructionCount": 1,
            "maximumTransactionBytes": 1232,
            "maximumLookupTables": 1,
            "maximumLookupAddresses": 256
        },
        "writerDlmmTransportSha256": "f34bf779fa19744f32cdd2fc7c6cddd3e95d1809ca1105137bed1f48e76393de"
    },
    authorization: {
        channel: "preproduction",
        environment: "devnet",
        deploymentEnabled: false,
        upgradeAuthorized: false,
        authorityHandoffAuthorized: false,
        productionEnabled: false,
        mainnetEnabled: false,
        branchOrReviewIsAuthority: false,
    },
    rollback: {
        mutationPolicy: "fail-closed",
        readerFallback: "historical-rc44-semantic-decoders-only",
    },
});
export const SDK_RELEASE_TRAIN = deepFreeze({
    ...RETAINED_DEPLOYED_SDK_RELEASE_TRAIN,
    packageBuildIdentity: SDK_PACKAGE_BUILD_IDENTITY,
    currentWriteEligible: SDK_NATIVE_PACKAGE_MATCHES_RETAINED_RELEASE,
    writeRelease: {
        ...RETAINED_DEPLOYED_SDK_RELEASE_TRAIN.writeRelease,
        status: SDK_NATIVE_PACKAGE_MATCHES_RETAINED_RELEASE ? "available" : "unavailable",
        packageCompatibility: SDK_NATIVE_PACKAGE_MATCHES_RETAINED_RELEASE ? "retained-native-artifact" : "native-package-digest-mismatch",
    },
});
export class SdkReleaseTrainValidationError extends AmebaProtocolError {
    constructor(message) {
        super(message, { code: "SDK_RELEASE_TRAIN_INVALID" });
    }
}
export class CurrentWriteReleaseUnavailableError extends AmebaProtocolError {
    constructor() {
        super("current program mutation is unavailable until an exact governed-write release is finalized", {
            code: "CURRENT_PROGRAM_WRITE_ABI_UNAVAILABLE",
            details: {
                writeCompatibility: CURRENT_LIVE_DEPLOYMENT.writeCompatibility,
                selectedGovernanceGeneration: SDK_RELEASE_TRAIN.selectedGovernanceGeneration,
            },
        });
    }
}
/** Strictly rejects omitted, extra, substituted, or cross-generation fields. */
export function validateSdkReleaseTrain(value) {
    let received;
    try {
        received = canonicalJson(value);
    }
    catch (cause) {
        throw new SdkReleaseTrainValidationError(`release-train value is not canonical JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (received !== EXPECTED_RELEASE_TRAIN_CANONICAL_JSON) {
        throw new SdkReleaseTrainValidationError("release-train value differs from the exact reviewed reader, deployment, governance, or authorization identities");
    }
    return SDK_RELEASE_TRAIN;
}
export function isCurrentWriteReleaseAvailable() {
    try {
        currentGovernedWriteReleaseV1();
        return true;
    }
    catch {
        return false;
    }
}
/** Readiness is qualified package evidence, never a caller switch. */
export function assertCurrentWriteReleaseAvailable() {
    if (!isCurrentWriteReleaseAvailable())
        throw new CurrentWriteReleaseUnavailableError();
}
const EXPECTED_RELEASE_TRAIN_CANONICAL_JSON = canonicalJson(SDK_RELEASE_TRAIN);
function canonicalJson(value, seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value) || !Number.isSafeInteger(value) || Object.is(value, -0)) {
            throw new TypeError("numbers must be finite safe integers");
        }
        return JSON.stringify(value);
    }
    if (typeof value !== "object") {
        throw new TypeError("values must be JSON objects, arrays, or primitives");
    }
    const object = value;
    if (seen.has(object))
        throw new TypeError("cycles are not allowed");
    seen.add(object);
    try {
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype) {
                throw new TypeError("array subclasses are not allowed");
            }
            const keys = Reflect.ownKeys(value);
            const expectedKeys = [...Array(value.length)].map((_, index) => String(index));
            if (keys.length !== expectedKeys.length + 1
                || keys.at(-1) !== "length"
                || !expectedKeys.every((key, index) => keys[index] === key)) {
                throw new TypeError("arrays must be dense and contain no extra properties");
            }
            return `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype) {
            throw new TypeError("object prototypes are not allowed");
        }
        const record = value;
        const ownKeys = Reflect.ownKeys(record);
        if (ownKeys.some((key) => typeof key !== "string")) {
            throw new TypeError("symbol properties are not allowed");
        }
        const descriptors = Object.getOwnPropertyDescriptors(record);
        for (const key of ownKeys) {
            const descriptor = descriptors[key];
            if (descriptor === undefined
                || descriptor.enumerable !== true
                || !("value" in descriptor)) {
                throw new TypeError("objects must contain only enumerable data properties");
            }
        }
        return `{${ownKeys.sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(descriptors[key].value, seen)}`).join(",")}}`;
    }
    finally {
        seen.delete(object);
    }
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const nested of Object.values(value))
            deepFreeze(nested);
        Object.freeze(value);
    }
    return value;
}
//# sourceMappingURL=release-train.js.map