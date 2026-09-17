import { PublicKey } from "@solana/web3.js";
import { type CreateCurrentSdkAdapterInput } from "../protocol/current-adapter.js";
import { type G3OperationInput, type G3OperationPlan } from "../g3/operations.js";
import { type G3ResolvedIntent } from "../g3/resolver.js";
import type { G3UserOperation } from "../g3/operations.js";
/** Mainnet read composition and G3 preparation; business admission remains host-owned. */
export declare function createMainnetSdkAdapter(input: Omit<CreateCurrentSdkAdapterInput, "programId" | "namespace" | "cluster" | "releaseTag" | "releaseCommit">): Readonly<{
    profile: Readonly<{
        readonly schemaVersion: 1;
        readonly network: "mainnet-beta";
        readonly genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
        readonly programId: "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw";
        readonly deployedSlot: 447697584;
        readonly programData: "8KR6hgcQehz32jm7CvrAriYNhvT2Bu9JuUWHce81J1oh";
        readonly upgradeAuthority: "4hsEKyThDv85YA4HjUaGWn2nWnVbM5V23XcLrEX3UKzn";
        readonly sourceCommit: "fc2cf05393f6b5dec493cbcd9b5173c56c802ade";
        readonly publicExportBaseCommit: "dedcfe2efb39658d2f90a327cab39b1515a8cbc8";
        readonly profileSha256: "e51c6850d1dd262f152a4d2171ded32c7c2ca874da511009b1ac8cbec14977d0";
        readonly artifactBytes: 1402520;
        readonly artifactSha256: "47966df3fb8f1ff997723ccf8868a031b729fc945ae5110d78ea0104dacfea69";
        readonly solanaVerifyVersion: "0.5.1";
        readonly baseImage: "solanafoundation/solana-verifiable-build@sha256:0b4e3716fad9ca4b4aac3e3f977f43aad93a18c22296c0c0f44fc22e644bdd68";
        readonly arch: "v1";
        readonly libraryName: "light_token_minter";
        readonly mountPath: "programs/light_token_minter";
        readonly workspacePath: "programs/light_token_minter";
        readonly cargoArgs: readonly string[];
        readonly lockedSuppliedByVerifier: true;
        readonly publicDockerBuildMatchesDeployedArtifact: false;
        readonly hostedVerificationClaimed: false;
        readonly gateActivationIncluded: true;
        readonly publicSourceCommit: "b66fbc8f25205d15e39a4f974c22f90bcd6992df";
        readonly controllerProgramId: "8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx";
        readonly controllerConfig: "Ec5H8jsGvaLU3T3gp6qTayPjY2qF3geBbVKWz4rsaEHB";
        readonly gate: "Cdym9p7FvtxEAjF8XuCqSrishB7LmBDXaZGDMMgWczu";
        readonly collateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        readonly lightAddressTree: "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx";
        readonly lightTokenConfig: "ACXg8a7VaqecBWrSbdu73W4Pg9gsqXJ3EXAqkHyhvVXg";
        readonly lightRentSponsor: "r18WwUxfG8kQ69bQPAB2jV6zGNKy3GosFGctjQoV4ti";
        readonly bootstrapAuthority: "99riHvpFvwfz2tbrWbanEMPz5iyhHHThBbM7eY35vMwL";
        readonly configAdmin: "99riHvpFvwfz2tbrWbanEMPz5iyhHHThBbM7eY35vMwL";
        readonly oracleAuthority: "C8gpKjnPss4SKpjhBpFGNH7cbD26XCzSWhcjj6gF4dx7";
        readonly recoveryAuthority: "5zkGhzjEXYWw15Jy534ZL3UDQ9N2nQ17jcSRZ2B5C28Y";
        readonly settlementSignerRegistry: "8aQiBEvYzhtTL3daY5cyzghwJDKcDD9MKokVA3Fk7Jay";
        readonly controllerAbi: 3;
        readonly businessGeneration: 3;
        readonly programDataAccountBytes: 1410349;
        readonly programDataAccountSha256: "1388e06542638ff149b4ccd5369f4ebe9f5d1a36860ad1330c1d284c3b336e5d";
        readonly programDataPayloadBytes: 1410304;
        readonly programDataPayloadSha256: "20e7bb1c45be1d75fddd75070ab6c08f8dc2d1ffd303f6aaff8322bc1bb2de84";
        readonly liveReleaseLabel: "spread-mainnet-20260916";
        readonly liveReadProfileId: "ameba-spread-v2-mainnet-b66fbc8f";
        readonly minimumContextSlot: 447700734;
        readonly writeCompatibility: "governance-gate-v1";
        readonly receiptPath: "release/mainnet-deployment-evidence-20260916.json";
        readonly gateEpoch: "9";
        readonly mandatoryZeroPaddingBytes: 7784;
        readonly sourceInputInventorySha256: "968f5eb8a4542b680fbbe6d8c669f35bd0e7b406077f8f3a45f8329d069829d4";
        readonly independentNativeBuilds: 2;
        readonly nativeToolchain: "cargo-build-sbf 4.0.0; platform-tools v1.53; SBF rustc 1.89.0";
        readonly publicNativeBuildMatchesDeployedArtifact: false;
        readonly photonOriginSha256: "6dc1006780af7016c8d394c3a12eb2183d724be6ad20fe3a86726742a14afcb0";
        readonly nativeBuildReproduction: "Two SBF builds from this worktree using separate previously warmed build caches; not clean dependency builds.";
        readonly qualificationScope: "144 remaining September oracle bootstrap transactions in offline LiteSVM against captured Mainnet state and real Light programs/proofs; not trading qualification.";
    }>;
    observeMainnetDeployment: () => Promise<Readonly<{
        network: "mainnet-beta";
        genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
        programId: "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw";
        controllerProgramId: "8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx";
        profileSha256: "e51c6850d1dd262f152a4d2171ded32c7c2ca874da511009b1ac8cbec14977d0";
        observedSlot: number;
        artifactSha256: "47966df3fb8f1ff997723ccf8868a031b729fc945ae5110d78ea0104dacfea69";
        gate: "Cdym9p7FvtxEAjF8XuCqSrishB7LmBDXaZGDMMgWczu";
        gateStatus: import("@amoeba/spread-release-tools/governance-gate").ProtocolGateStatusV1;
        epoch: string;
        gateActive: boolean;
        tradeReady: false;
        readinessReason: "MAINNET_MARKET_AND_PHOTON_QUALIFICATION_REQUIRED" | "MAINNET_GATE_NOT_ACTIVE";
    }>>;
    resolveG3UserIntent: (owner: string, operation: G3UserOperation, request: unknown, floor?: number) => Promise<G3ResolvedIntent>;
    prepareG3UserOperation: (owner: PublicKey, operation: G3OperationInput, floor?: number, lookupTable?: PublicKey) => Promise<Readonly<G3OperationPlan>>;
    revalidateG3UserOperation: (plan: G3OperationPlan, signed: string) => Promise<Readonly<{
        validated: true;
        finalizedObservationSlot: number;
        owner: string;
        signatureBytes: Buffer<ArrayBuffer>;
    }>>;
    readCurrentDeploymentFacts(input?: {
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../protocol/current-adapter.js").CurrentDeploymentFacts>;
    readCurrentChainIdentity(input?: {
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../index.js").CurrentChainIdentityDto>;
    readCurrentMarketAccount(input: {
        readonly marketId: string;
        readonly expiryId: string;
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../protocol/current-adapter.js").CurrentMarketReadResult>;
    readCurrentAmoebaDlmmPool(input: {
        readonly marketId: string;
        readonly expiryId: string;
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../protocol/current-adapter.js").CurrentAmoebaDlmmPoolReadResult>;
    decodeCurrentMarketAccount(input: import("../protocol/current-adapter.js").CurrentFactoryDecodeMarketAccountInput): import("../index.js").CurrentMarketAccount;
    decodeCurrentAmoebaDlmmPoolAccount(input: Omit<import("../protocol/current-adapter.js").DecodeCurrentAmoebaDlmmPoolAccountInput, "programId" | "namespace">): import("../protocol/current-adapter.js").CurrentAmoebaDlmmPoolAccount;
    decodeCurrentAmoebaDlmmBinPageAccount(input: Omit<import("../protocol/current-adapter.js").DecodeCurrentAmoebaDlmmPageAccountInput, "programId" | "namespace">): import("../protocol/current-adapter.js").CurrentAmoebaDlmmBinPageAccount;
    decodeCurrentAmoebaDlmmSharePageAccount(input: Omit<import("../protocol/current-adapter.js").DecodeCurrentAmoebaDlmmPageAccountInput, "programId" | "namespace">): import("../protocol/current-adapter.js").CurrentAmoebaDlmmSharePageAccount;
    decodeCurrentAmoebaDlmmPositionAccount(input: Omit<import("../protocol/current-adapter.js").DecodeCurrentAmoebaDlmmPositionAccountInput, "programId" | "namespace">): import("../protocol/current-adapter.js").CurrentAmoebaDlmmPositionAccount;
    discoverCurrentAmoebaDlmmPages(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly payer?: PublicKey | undefined;
        readonly pool: import("@amoeba/spread-release-tools/dlmm-accounts").AmoebaDlmmPoolAccount;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
        readonly poolAddress: PublicKey;
    }): Promise<import("../protocol/current-adapter.js").CurrentAmoebaDlmmPagesResult>;
    discoverCurrentAmoebaDlmmPositions(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly owner?: PublicKey | undefined;
        readonly limit?: number | undefined;
        readonly payer?: PublicKey | undefined;
        readonly maximumBinId: number;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
        readonly poolAddress: PublicKey;
        readonly expectedPositionCount?: number | undefined;
    }): Promise<import("../protocol/current-adapter.js").CurrentAmoebaDlmmPositionsResult>;
    resolveCurrentAmoebaDlmmState(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly payer?: PublicKey | undefined;
        readonly state: import("../protocol/current-adapter.js").CurrentAmoebaDlmmStateLocator;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
    }): Promise<import("../protocol/current-adapter.js").CurrentResolvedAmoebaDlmmState>;
    resolveCurrentLightAccounts(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly accounts: readonly import("../protocol/current-adapter.js").CurrentLightAccountRequest[];
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
        readonly actionInstructions?: readonly import("@solana/web3.js").TransactionInstruction[] | undefined;
    }): Promise<import("../protocol/current-adapter.js").CurrentLightAccountResolution>;
    validateCurrentHotLightAccount(input: import("../protocol/current-adapter.js").ValidateCurrentHotLightAccountInput): import("../protocol/current-adapter.js").CurrentValidatedHotLightAccount;
    validateCurrentOperationPlan(plan: import("../protocol/current-adapter.js").CurrentOperationPlan): void;
    buildCurrentGovernedInstruction<Name extends import("../index.js").CurrentGovernedBuilderNameV1>(input: {
        readonly builderName: Name;
        readonly builderInput: import("../index.js").CurrentGovernedBuilderInputV1<Name>;
    }): Promise<import("../index.js").CurrentGovernedInstructionMaterializationV1>;
    readCurrentOracleState(input?: {
        readonly marketId?: string;
        readonly expiryId?: string;
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../protocol/current-adapter.js").CurrentOracleState>;
    buildCurrentOracleDraft(input: {
        readonly request: import("../protocol/current-adapter.js").BuildCurrentOracleDraftInput["request"];
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../protocol/current-adapter.js").CurrentOracleDraftPlan>;
    readCurrentPositionExpiryAutomation(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly owner: string;
        readonly state: import("../index.js").CurrentPositionExpiryState;
        readonly automationId?: string | undefined;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
    }): Promise<import("../index.js").CurrentPositionExpiryProjection>;
    syncCurrentPositionExpiryAutomation(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly owner: string;
        readonly state: import("../index.js").CurrentPositionExpiryState;
        readonly request?: {
            readonly owner?: string;
            readonly automationId?: string;
        } | undefined;
        readonly automationId?: string | undefined;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
    }): ReturnType<typeof import("../index.js").syncCurrentPositionExpiryAutomation>;
    prepareCurrentPositionActionContext(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly minimumContextSlot?: number | undefined;
        readonly request: import("../protocol/current-adapter.js").CurrentPositionActionRequest;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
    }): Promise<import("../protocol/current-adapter.js").CurrentPositionActionContext>;
    buildCurrentPositionAction(input: {
        readonly commitment?: import("@solana/web3.js").Commitment | undefined;
        readonly minimumContextSlot?: number | undefined;
        readonly context?: import("../protocol/current-adapter.js").CurrentPositionActionContext | undefined;
        readonly request: import("../protocol/current-adapter.js").CurrentPositionActionRequest;
        readonly marketLayout?: "historical-v2" | "g3" | undefined;
    }): Promise<import("../protocol/current-adapter.js").CurrentPositionActionPlan>;
    readCurrentUserLedger(input: {
        readonly owner: string;
        readonly commitment?: import("@solana/web3.js").Commitment;
    }): Promise<import("../protocol/current-adapter.js").CurrentUserLedgerDto>;
    readCurrentUserCollateral(input: {
        readonly owner: string;
        readonly commitment?: import("@solana/web3.js").Commitment;
        readonly minimumContextSlot?: number;
    }): Promise<import("../protocol/current-adapter.js").CurrentUserCollateralDto>;
    submitCurrentOracleDraft(input: {
        readonly plan: import("../protocol/current-adapter.js").CurrentOracleDraftPlan;
        readonly idempotencyKey: string;
    }): Promise<import("../protocol/current-adapter.js").CurrentSubmissionReceipt>;
}>;
//# sourceMappingURL=adapter.d.ts.map