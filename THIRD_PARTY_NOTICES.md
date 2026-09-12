# Third-party notices

## Protocol package and governed data

Protocol code is consumed only through the published export maps of two
explicitly separated, locally pinned packages. `@amoeba/spread-historical-rc44`
is the unchanged RC44 artifact from source commit
`1b2230d96e51f6582155d8284900fbfc11ff1f18`, used only for historical/offline
semantics. `@amoeba/spread-release-tools` is the one governed runtime candidate;
its Writer builders and private governance branding use the same instance.
`vendor/GOVERNED_RUNTIME_PROVENANCE.json` records its exact package hash and
deployment correspondence and separate independent-build attestation status. Neither the candidate nor the archive grants live readiness.
Both artifacts are bundled so public consumers do not need private source
access. The immutable `vendor/PROVENANCE.json` records historical source,
package commit, tarball SHA-256 and npm integrity, unpacked size/entry count,
and license-file SHA-256. Consumer installation executes no package build.

The Spread package omits npm `license` metadata but includes the Apache License
2.0 text in `LICENSE`. The SDK accepts this metadata exception only for
`@amoeba/spread-release-tools@0.1.0` with the exact reviewed license-file
SHA-256 recorded in provenance. A changed package, version, artifact, or license
file fails the release gates.

## Runtime dependencies

The SDK and pinned Spread package structurally remove
`@lightprotocol/compressed-token` and `@solana/spl-token`, the two runtime paths
that previously introduced the abandoned native `bigint-buffer@1.1.5` package.
There is no replacement alias or native addon in the production graph. Spread's
public web3-v1 token facade uses exact `@solana-program/token@0.13.0`,
`@solana/kit@6.5.0`, and `@solana-program/system@0.12.2` build inputs. Spread
bundles their reviewed generated implementation and attribution into its
tracked facade; their package manifests are not runtime dependencies. The SDK
consumes that facade without copying token wire grammar or exposing Kit types.
The credential-disabled npm tarball and Git consumer gates require that neither
those private build packages nor an original or replacement `bigint-buffer`
package is installed. Consumer validation uses `--ignore-scripts`, so optional
WebSocket native builds remain outside the reviewed runtime boundary.

The SDK tarball bundles both role-separated Spread artifacts and the shared runtime dependency
closure npm requires for that bundle.
`@solana/web3.js@1.98.4` is licensed under the MIT License. Its transitive
packages retain their own package metadata and license files. Its current
dependency tree includes deprecated `uuid@8.3.2`; the security and migration
implications are recorded in the compatibility guide rather than hidden by a
root-only override. The same exact tree installs `stream-json@1.9.1`, whose
path-filter advisory remains visible in the dependency audit. The SDK reaches
only Jayson's isolated browser client, not stream-json or the affected filters;
that exact non-reachability boundary and the incompatible v3 override are
documented and mechanically pinned in the compatibility guide and security
gate.

The bundled production tree also includes `rpc-websockets@9.3.9`
(`LGPL-3.0-only`) and `text-encoding-utf-8@1.0.2` (Unlicense public-domain
dedication). They are transitive packages in the bundled runtime closure. The
release license policy scopes
each public-domain or reciprocal license to its reviewed package and version;
it does not generally admit a new dependency merely because it uses the same
license identifier. Consumers with dependency-license policies should review
their upstream license files and the current lockfile before deployment.

The exact resolved development and dependency graph used to build this release
candidate is recorded in `package-lock.json` in the source repository. Run
`npm ls --omit=dev` and `npm audit --omit=dev` from a clean checkout to inspect
the installed production tree. Release validation additionally installs the
packed tarball in an empty consumer and treats that consumer's dependency graph
and audit as authoritative. The reviewed advisory exception is documented in
[Compatibility and support](https://github.com/SPACE999978/ameba_sdk/blob/main/docs/COMPATIBILITY.md).
