import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const receiptPath = join(root, ".agents", "studi-qa", "runs", `${options.profileName}.json`);
if (!existsSync(receiptPath)) throw new Error(`QA receipt does not exist: ${receiptPath}`);
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
if (receipt.workspaceRoot !== root) throw new Error("Receipt belongs to another worktree");

const app = processRecord(receipt.processId);
if (app && (!app.command.includes("electron") || !app.command.includes(`--user-data-dir=${receipt.profilePath}`))) {
  throw new Error(`Process ${receipt.processId} no longer matches this QA run; refusing to stop it`);
}
const relay = processRecord(receipt.clerkHandoffProcessId);
if (relay && (!relay.command.includes("clerk-qa-handoff.mjs") || !relay.command.includes(new URL(receipt.clerkClaimUrl).port))) {
  throw new Error(`Process ${receipt.clerkHandoffProcessId} no longer matches this QA run; refusing to stop it`);
}

if (!options.dryRun) {
  if (app) {
    const result = spawnSync(process.execPath, [join(root, ".agents", "skills", "test-studi", "scripts", "close-studi-qa.mjs"), receipt.mainInspectorEndpoint], {
      cwd: root, stdio: "inherit", windowsHide: true,
    });
    if (result.status !== 0) throw new Error("QA app did not close cleanly; leaving the receipt for diagnosis");
    const deadline = Date.now() + 15_000;
    while (processRecord(receipt.processId) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 100));
    if (processRecord(receipt.processId)) throw new Error("QA app is still quitting; receipt retained");
  }
  if (relay) { try { process.kill(receipt.clerkHandoffProcessId, "SIGTERM"); } catch {} }
  rmSync(receiptPath);
}
console.log(JSON.stringify({ stopped: !options.dryRun, profilePath: receipt.profilePath }));

function parseArgs(argv) {
  const parsed = { profileName: "profile", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--profile-name") parsed.profileName = argv[++index];
    else if (argv[index] === "--dry-run") parsed.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(parsed.profileName)) throw new Error("--profile-name is invalid");
  return parsed;
}

function processRecord(pid) {
  if (!pid) return null;
  if (process.platform === "win32") {
    const command = `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress)`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !result.stdout.trim()) return null;
    const row = JSON.parse(result.stdout);
    return { pid: row.ProcessId, command: row.CommandLine || "" };
  }
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    return command ? { pid, command } : null;
  } catch { return null; }
}
