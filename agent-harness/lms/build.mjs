import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(".studi-lms/build", { recursive: true });
await build({
  entryPoints: [
    "agent-harness/lms/cli.ts",
    "agent-harness/lms/server.ts",
    "agent-harness/lms/assets.ts",
    "agent-harness/lms/telemetry.ts",
  ],
  outdir: ".studi-lms/build",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  jsx: "automatic",
  sourcemap: true,
});
