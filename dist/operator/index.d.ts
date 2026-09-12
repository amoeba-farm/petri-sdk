/** Byte-qualified live facts plus explicitly historical RC44 discovery semantics. */
export { CURRENT_PROTOCOL_DEPLOYMENT, CURRENT_PROTOCOL_RELEASE, CURRENT_PROTOCOL_SOURCE_COMMIT, HISTORICAL_RC44_PROTOCOL_DEPLOYMENT, HISTORICAL_RC44_PROTOCOL_RELEASE, HISTORICAL_RC44_PROTOCOL_SOURCE_COMMIT, discoverCurrentMarkets, discoverCurrentMarkets as discoverHistoricalRc44Markets, validateCurrentDeploymentIdentity, validateCurrentDeploymentIdentity as validateHistoricalRc44DeploymentIdentity, } from "../protocol/current.js";
export type { CurrentMarketDiscoveryOptions, CurrentMarketDiscoveryResult, } from "../protocol/current.js";
export { CURRENT_GOVERNANCE_GENERATION_1, CURRENT_LIVE_DEPLOYMENT, HISTORICAL_RC44_READER_BASELINE, REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE, SDK_RELEASE_TRAIN, assertCurrentWriteReleaseAvailable, isCurrentWriteReleaseAvailable, } from "../protocol/release-train.js";
export { CurrentLiveDeploymentValidationError, readCurrentLiveDeploymentFacts, } from "../protocol/current-live-deployment.js";
export type { CurrentLiveDeploymentFacts, CurrentLiveDeploymentRpc, } from "../protocol/current-live-deployment.js";
export { CURRENT_FINALIZED_OBSERVATION_COMMITMENT, CURRENT_FINALIZED_OBSERVATION_DEVNET_GENESIS_HASH, CURRENT_FINALIZED_OBSERVATION_DIGEST_DOMAIN, CURRENT_FINALIZED_OBSERVATION_SCHEMA_VERSION, CURRENT_FINALIZED_OBSERVATION_SOURCE, CurrentFinalizedObservationValidationError, computeCurrentFinalizedObservationDigest, currentFinalizedObservationPreimage, validateCurrentFinalizedObservation, } from "../current-finalized-observation.js";
export type { CurrentFinalizedObservation, CurrentFinalizedObservationDigestInput, CurrentFinalizedObservedAccount, CurrentStateProviderIdentity, } from "../current-finalized-observation.js";
export * from "@amoeba/spread-release-tools/oracle-current-v3-funding";
export * from "./current-oracle-opening.js";
export { readCurrentOracleRecipeIndexProgress, readCurrentOracleRecipeMembership, prepareCurrentOracleRecipeIndexStep, prepareOracleRecipeSourceIndexInputs } from "../protocol/current-oracle-membership.js";
export { CURRENT_ORACLE_SEMANTIC_HASH_VECTORS, currentOracleSourceDefinitionHash, currentOracleSourceTypeHash, normalizeCurrentOracleSemanticText, } from "../protocol/index.js";
//# sourceMappingURL=index.d.ts.map