# Petri SDK

Open-source TypeScript/Rust SDK for Amoeba/Petri (Apache-2.0), including the current Mainnet read profile and historical Devnet interfaces.

## Install

```bash
npm install https://github.com/amoeba-farm/petri-sdk/releases/download/v0.2.0/ameba-sdk-0.2.0.tgz
```

The package name and import is `ameba-sdk`. Node.js 22–24 is required.

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

## Reference


Typed TypeScript and Rust boundaries for Amoeba protocol reads, governance identity, and unsigned transaction review.

## Release status

The current Mainnet read profile binds governed deployment
`2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw`, deployed at slot `447697584`,
artifact SHA-256 `47966df3fb8f1ff997723ccf8868a031b729fc945ae5110d78ea0104dacfea69`,
and Active gate epoch 9. Package capability, deployment identity, and trading
readiness remain separate; the SDK fails closed when exact account or identity
requirements are absent.

See [V3 integration and public API contract](./docs/V3_LOCAL_INTEGRATION.md).
Historical RC44 plan metadata and receipts remain explicitly historical. The
undeployed Writer auction V2 candidate is retained only in Git history and its
historical design notes; it is excluded from current exports.

The canonical records are [the Mainnet profile](./release/mainnet-profile.v1.json),
[the release train](./release/release-train.v1.json), and
[upstream V3 manifest](./release/spread-devnet-v3.json). SDK publication does
not authorize activation, bootstrap, signing, or deployment.

## Package surfaces

- `ameba-sdk/client`: strict Amoeba HTTP reads, preparation, and status. It
  has no generic Solana relay; typed submission requires the governed release and surrounding admission.
- `ameba-sdk/protocol`: release-train validation, exact 192-byte governance
  gate and 16-byte `AGV1` tail codecs, live deployment qualification,
  historical RC44 decoders/builders, and portable plan validators.
- `ameba-sdk/wallet`: browser-safe G3 prepare-envelope validation and unsigned
  v0 materialization. It never signs or submits.
- `ameba-sdk/operator`: server-side finalized qualification of the exact
  Program, ProgramData, and Generation 3 gate in one observation.
- `ameba-sdk/petri`: shell-free command adapter. Reads and planning remain
  callable; every transaction effect is closed until a governed write release
  exists.

Client network access is fixed to `https://api.amoeba.farm` (or loopback for
local integration). Mainnet direct reads are a separate server-side surface
that requires an authenticated private Helius endpoint; browser code does not
receive provider credentials.

## Identity example

```js
import { MAINNET_PROFILE } from "ameba-sdk/mainnet";

console.log(MAINNET_PROFILE.programId);
console.log(MAINNET_PROFILE.artifactSha256);
console.log(MAINNET_PROFILE.gateEpoch); // "9"
```

See [Compatibility](./docs/COMPATIBILITY.md),
[API](./docs/API.md), and
[Browser wallet boundary](./docs/WALLET_BROWSER.md).

## Verification

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
cargo check --locked
```

These checks are local and read-only. They do not contact Mainnet or require
private repository credentials.

The npm package is Apache-2.0. The Rust host crate is intentionally
non-publishable. No command above deploys, upgrades, transfers authority,
publishes, tags, or signs a production transaction.
