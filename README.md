# Petri SDK

Open-source TypeScript and Rust SDK for Amoeba/Petri (Apache-2.0). This is a pre-production Devnet preview; package capability does not grant runtime permission.

## Install

```bash
npm install https://github.com/amoeba-farm/petri-sdk/releases/download/v0.2.0/ameba-sdk-0.2.0.tgz
```

The package name and import remain `ameba-sdk`. Node.js 22–24 is required.

```toml
[dependencies]
ameba-sdk = { git = "https://github.com/amoeba-farm/petri-sdk.git", tag = "v0.2.0" }
```

## Build from source

```bash
npm ci --ignore-scripts
npm run build
cargo build --locked
```

Native Spread dependencies are included as exact, pinned source/package snapshots. No private repository credentials are required. Source identities are recorded in `PUBLIC_SOURCE_PROVENANCE.json`; this publication changes distribution metadata, not deployment identity or signing policy.

## Reference


Typed TypeScript and Rust boundaries for Amoeba protocol reads, historical
RC44 semantics, governance identity, and unsigned transaction review.

## Release status

The current local integration supports the exact V3 governed deployment
`2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw`, with deployed Writer auction V1.
Package capability and runtime permission are separate: frozen gates, missing
business state and paused vaults refuse materialization before signing.

See [V3 integration and public API contract](./docs/V3_LOCAL_INTEGRATION.md).
Historical RC44 plan metadata and receipts remain explicitly historical. The
undeployed Writer auction V2 candidate is retained only in Git history and its
historical design notes; it is excluded from current exports.

The canonical records are [the release train](./release/release-train.v1.json)
and [upstream V3 manifest](./release/spread-devnet-v3.json). This is a local,
unpushed integration; no activation, bootstrap or deployment is authorized.

## Package surfaces

- `ameba-sdk/client`: strict Amoeba HTTP reads, preparation, and status. It
  has no generic Solana relay; typed submission requires the governed release and surrounding admission.
- `ameba-sdk/protocol`: release-train validation, exact 192-byte governance
  gate and 16-byte `AGV1` tail codecs, live deployment qualification,
  historical RC44 decoders/builders, and portable plan validators.
- `ameba-sdk/wallet`: browser-safe V3 governed prepare-envelope
  validation and unsigned v0 materialization. It never signs or submits and
  rejects the current live ProgramData identity.
- `ameba-sdk/operator`: server-side finalized qualification of the exact
  Program, ProgramData, and Generation 1 gate in one observation.
- `ameba-sdk/petri`: shell-free command adapter. Reads and planning remain
  callable; every transaction effect is closed until a governed write release
  exists.

Client network access is fixed to `https://api.amoeba.farm` (or loopback for
local integration). Solana reads use `https://api.amoeba.farm/rpc`; browser
and Petri consumers cannot select a validator or private provider endpoint.

## Identity example

```js
import { Connection } from "@solana/web3.js";
import {
  CURRENT_LIVE_DEPLOYMENT,
  HISTORICAL_RC44_READER_BASELINE,
  SDK_RELEASE_TRAIN,
  isCurrentWriteReleaseAvailable,
  readCurrentLiveDeploymentFacts,
} from "ameba-sdk/protocol";

console.log(CURRENT_LIVE_DEPLOYMENT.programDataPayloadSha256);
console.log(HISTORICAL_RC44_READER_BASELINE.spreadRelease);
console.log(SDK_RELEASE_TRAIN.selectedGovernanceGeneration); // 1
console.log(isCurrentWriteReleaseAvailable()); // false

const facts = await readCurrentLiveDeploymentFacts({
  rpc: new Connection("https://api.amoeba.farm/rpc", "finalized"),
});
console.log(facts.governance.status, facts.governance.epoch);
```

See [Compatibility](./docs/COMPATIBILITY.md),
[API](./docs/API.md), and
[Browser wallet boundary](./docs/WALLET_BROWSER.md).

## Verification

```sh
npm ci --ignore-scripts
npm run check:source
npm run check:rust
npm run check:live
```

`npm run check:live` performs a read-only finalized request through the
public Amoeba RPC gateway. The full `npm run release:check` additionally
requires exact credential-free local mirrors of the private CLI and historical
Spread repositories; CI creates those mirrors in an isolated credential
bootstrap step.

The npm package is Apache-2.0. The Rust host crate is intentionally
non-publishable. No command above deploys, upgrades, transfers authority,
publishes, tags, or signs a production transaction.
