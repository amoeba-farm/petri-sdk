import candidate from "../../release/local-candidate-build.v1.json" with { type: "json" };
import releasedRuntime from "../../vendor/GOVERNED_RUNTIME_PROVENANCE.json" with { type: "json" };

/** Actual package build inputs. A source inventory digest is never a Git revision. */
export const SDK_PACKAGE_BUILD_IDENTITY = freeze(candidate);
/** Derived byte identity, not a caller-configurable availability switch. */
export const SDK_NATIVE_PACKAGE_MATCHES_RETAINED_RELEASE =
  candidate.nativePackage.sha256 === releasedRuntime.packageArtifact.sha256;

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
