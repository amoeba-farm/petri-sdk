/** Browser-safe root condition: HTTP client APIs plus inert current identity constants. */
export * from "./client-entry.js";
export { AMOEBA_SPREAD_PROGRAM_ID, CURRENT_NAMESPACE } from "./protocol/identity.js";
export {
  CURRENT_GOVERNANCE_GENERATION_1,
  CURRENT_LIVE_DEPLOYMENT,
  HISTORICAL_RC44_READER_BASELINE,
  REVIEWED_GOVERNANCE_GENERATION_2_CANDIDATE,
  SDK_RELEASE_TRAIN,
  SDK_PACKAGE_BUILD_IDENTITY,
  CurrentWriteReleaseUnavailableError,
  assertCurrentWriteReleaseAvailable,
  isCurrentWriteReleaseAvailable,
  validateSdkReleaseTrain,
} from "./protocol/release-train.js";
