#!/usr/bin/env node

// Emit a production browser artifact without executing the SDK or running qualification.
import { writeFileSync } from "node:fs";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["dist/wallet.js"],
  outfile: "dist/browser-bundle/wallet.js",
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

writeFileSync("dist/browser-bundle/wallet.meta.json", JSON.stringify(result.metafile, null, 2) + "\n");
