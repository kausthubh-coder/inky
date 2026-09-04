import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { readComposioPolicy } from "../convex/composioPolicy.js";

const source = await readFile(new URL("../config/composio-tool-policy.json", import.meta.url), "utf8");
readComposioPolicy(source);

const child = spawn(process.execPath, ["x", "convex", "env", "set", "STUDI_COMPOSIO_TOOL_POLICY_JSON", source], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
});

const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) process.exit(exitCode);
