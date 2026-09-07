import { createServer } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

// Vite picks the next free port when another worktree is already previewing.
const desktop = process.argv.includes("--desktop");
const server = await createServer({ server: { host: "127.0.0.1", port: 4174, strictPort: false, open: desktop ? false : "/?preview=gallery" } });
await server.listen();
server.printUrls();
console.log(`Studi gallery: ${server.resolvedUrls.local[0]}?preview=gallery`);
let child;
if (desktop) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, [fileURLToPath(new URL("./preview-desktop.mjs", import.meta.url)), `--studi-preview-url=${server.resolvedUrls.local[0]}?preview=week`], { stdio: "inherit", env, windowsHide: true });
  child.on("exit", () => void close());
  child.on("error", error => { console.error(error); void close(); });
}
const close = async () => { child?.kill(); await server.close(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
