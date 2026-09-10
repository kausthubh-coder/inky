import { createServer } from "vite";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Vite picks the next free port when another worktree is already previewing.
const desktop = process.argv.includes("--desktop");
const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim(); }
  catch { return "unknown"; }
};
const source = () => ({
  root,
  branch: git("branch", "--show-current") || "detached HEAD",
  revision: git("rev-parse", "--short", "HEAD"),
  version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  modified: git("status", "--porcelain", "--", "desktop/src", "desktop/shared") !== "",
});
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 4174, strictPort: false, open: false },
  plugins: [{
    name: "studi-preview-source",
    configureServer(vite) {
      vite.middlewares.use("/__studi_preview/source", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(source()));
      });
    },
  }],
});
await server.listen();
const info = source();
console.log(`\nStudi ${info.version} · ${info.branch} · ${info.revision}${info.modified ? " + local edits" : ""}\nSource: ${root}`);
server.printUrls();
const base = server.resolvedUrls.local[0];
console.log(`Open this run: ${base}?preview=gallery`);
let child;
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  child?.kill();
  await server.close();
};
if (desktop) {
  const { default: electronPath } = await import("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, [fileURLToPath(new URL("./preview-desktop.mjs", import.meta.url)), `--studi-preview-url=${base}?preview=week`], { cwd: root, stdio: "inherit", env, windowsHide: true });
  child.on("exit", () => void close());
  child.on("error", error => { console.error(error); void close(); });
} else if (!process.argv.includes("--no-open")) {
  server.config.server.open = "/?preview=gallery";
  server.openBrowser();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
