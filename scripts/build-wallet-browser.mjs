#!/usr/bin/env node

// Emit a production browser artifact without executing the SDK or running qualification.
import { writeFileSync } from "node:fs";
import { build } from "esbuild";

for (const [entry, output] of [["dist/wallet.js", "wallet"], ["dist/g3/browser.js", "g3"]]) {
const result = await build({
  entryPoints: [entry],
  outfile: `dist/browser-bundle/${output}.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLimit: 0,
  logLevel: "info",
});

writeFileSync(`dist/browser-bundle/${output}.meta.json`, JSON.stringify(result.metafile, null, 2) + "\n");

}
