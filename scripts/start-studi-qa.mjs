import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const helperRoot = join(root, ".agents", "skills", "test-studi", "scripts");
if (process.argv[2] === "--watch-receipt") {
  await watchReceipt(process.argv[3]);
  process.exit(0);
}
const options = parseArgs(process.argv.slice(2));
const requestedProfileName = options.profileName;
const runId = `studi-e2e-qa-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
const profileName = options.persistent ? requestedProfileName : runId;
const qaRoot = join(root, ".agents", "studi-qa");
const profilePath = options.persistent ? join(qaRoot, profileName) : join(resolve(options.profileParent), runId);
const receiptPath = join(qaRoot, "runs", `${profileName}.json`);
const electronPath = process.platform === "win32"
  ? join(root, "node_modules", "electron", "dist", "electron.exe")
  : join(root, "node_modules", "electron", "dist", "electron");
const mainPath = join(root, "dist", "electron", "main.js");
const rendererPath = join(root, "dist", "client", "index.html");
const handoffScript = join(helperRoot, "clerk-qa-handoff.mjs");
const proxySetupScript = join(root, "scripts", "studi-qa-proxy.mjs");
const logPaths = {
  electronStdout: join(profilePath, "logs", "electron.stdout.log"),
  electronStderr: join(profilePath, "logs", "electron.stderr.log"),
  clerkRelayStdout: join(profilePath, "logs", "clerk-relay.stdout.log"),
  clerkRelayStderr: join(profilePath, "logs", "clerk-relay.stderr.log"),
};

for (const path of [electronPath, mainPath, rendererPath, handoffScript]) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`Built Studi artifact is missing: ${path}. Run bun run build first.`);
}
if ([join(qaRoot, "runs"), join(qaRoot, "codex-auth")].includes(profilePath)) fail("Profile name is reserved for QA tooling");
for (const path of [join(root, ".agents"), qaRoot, profilePath]) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail("QA profiles and parent directories must not be linked");
}

const profileExisted = existsSync(profilePath);
const profileHadData = profileExisted && readdirSync(profilePath).length > 0;
if (findProfileProcess(profilePath)) fail(`QA profile is already running: ${profilePath}. Reuse its receipt or choose --profile-name.`);

const port = options.port || await freePort();
const clerkPort = options.clerkHandoffPort || await distinctFreePort([port]);
const mainInspectorPort = await distinctFreePort([port, clerkPort]);
for (const candidate of [port, clerkPort]) {
  if (!await portAvailable(candidate)) fail(`Loopback port ${candidate} is already in use.`);
}

const config = readFileSync(join(root, "dist", "electron", "auth", "config.js"), "utf8");
const clerkHost = config.match(/clerkIssuer:\s*["']https:\/\/([a-z0-9.-]+\.clerk\.accounts\.dev)["']/i)?.[1];
if (!clerkHost) fail("Built artifact must configure a development Clerk issuer.");

const cdpEndpoint = `http://127.0.0.1:${port}`;
const mainInspectorEndpoint = `http://127.0.0.1:${mainInspectorPort}`;
const clerkHandoffEndpoint = `http://127.0.0.1:${clerkPort}/publish`;
const clerkClaimUrl = `http://127.0.0.1:${clerkPort}/claim`;
const testEmail = qaEmail(profileName);
const proxyServer = safeProxyServer(process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
const launchArguments = [
  ".",
  `--inspect=127.0.0.1:${mainInspectorPort}`,
  `--user-data-dir=${profilePath}`,
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${port}`,
  `--studi-qa-clerk-handoff=${clerkHandoffEndpoint}`,
  ...(proxyServer ? [`--proxy-server=${proxyServer}`, "--proxy-bypass-list=<-loopback>", "--ignore-certificate-errors"] : []),
  ...(process.platform !== "win32" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
];

const dryReceipt = {
  schemaVersion: 1, dryRun: true, persistent: options.persistent,
  profileReused: options.persistent && profileHadData, profileReset: false, resetRequested: false,
  testEmail, receiptPath, importCodexAuth: options.importCodexAuth, workspaceRoot: root,
  executable: electronPath, profilePath, cdpEndpoint, mainInspectorEndpoint, clerkClaimUrl,
  launchArguments, logPaths, processId: null, cdpReady: null,
};
if (options.dryRun) {
  console.log(JSON.stringify(dryReceipt));
  process.exit(0);
}

mkdirSync(dirname(receiptPath), { recursive: true });
let lock;
try {
  lock = openSync(`${receiptPath}.lock`, "wx");
} catch {
  fail(`Another launcher owns ${receiptPath}.lock`);
}

let relay;
let launched;
try {
  mkdirSync(profilePath, { recursive: true });
  let codexAuthImported = false;
  let codexAuthMissing = false;
  if (options.importCodexAuth) {
    const imported = spawnSync(process.execPath, [join(helperRoot, "sync-studi-qa-codex-auth.mjs"), "--import", "--profile", profilePath], {
      cwd: root, stdio: "ignore", windowsHide: true,
    });
    codexAuthImported = imported.status === 0;
    codexAuthMissing = !codexAuthImported;
  }

  relay = detached(process.execPath, [handoffScript, "--port", String(clerkPort), "--clerk-host", clerkHost], {
    stdoutPath: logPaths.clerkRelayStdout,
    stderrPath: logPaths.clerkRelayStderr,
  });
  await waitForHealth(`http://127.0.0.1:${clerkPort}/health`, relay.pid, 5_000);

  const startedAt = new Date();
  if (process.platform !== "win32" && !process.env.DISPLAY) {
    launched = detached("xvfb-run", ["-a", electronPath, ...launchArguments], {
      stdoutPath: logPaths.electronStdout,
      stderrPath: logPaths.electronStderr,
    });
  } else {
    launched = detached(electronPath, launchArguments, {
      stdoutPath: logPaths.electronStdout,
      stderrPath: logPaths.electronStderr,
    });
  }

  const cdpReady = await waitForCdp(cdpEndpoint, launched.pid, options.readinessTimeoutSeconds * 1_000);
  const electronProcess = process.platform === "win32"
    ? { pid: launched.pid }
    : findProfileProcess(profilePath);
  const processId = electronProcess?.pid ?? launched.pid;
  const receipt = {
    schemaVersion: 1, testEmail, profileName, receiptPath, dryRun: false,
    persistent: options.persistent, profileReused: options.persistent && profileHadData, profileReset: false,
    workspaceRoot: root, executable: electronPath, profilePath, profileOwnedByHelper: true,
    importCodexAuth: options.importCodexAuth, codexAuthImported, codexAuthMissing,
    cdpEndpoint, mainInspectorEndpoint, clerkClaimUrl, clerkHandoffProcessId: relay.pid, logPaths,
    launchArguments, processId, startedAtUtc: startedAt.toISOString(),
    buildMainSha256: shaFile(mainPath), buildRendererSha256: shaFile(rendererPath),
    buildTreeSha256: hashTree(join(root, "dist")), cdpReady, processExited: !isAlive(processId),
  };
  if (!cdpReady) {
    stopProcess(launched.pid);
    stopProcess(relay.pid);
    console.log(JSON.stringify(receipt));
    process.exitCode = 2;
  } else {
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    const watcher = detached(process.execPath, [new URL(import.meta.url).pathname, "--watch-receipt", receiptPath]);
    watcher.unref();
    console.log(JSON.stringify(receipt));
  }
} catch (error) {
  if (launched) stopProcess(launched.pid);
  if (relay) stopProcess(relay.pid);
  throw error;
} finally {
  if (lock !== undefined) closeSync(lock);
  rmSync(`${receiptPath}.lock`, { force: true });
}

function parseArgs(argv) {
  const parsed = { persistent: false, profileName: "profile", profileParent: process.env.TEMP || process.env.TMP || "/tmp", importCodexAuth: false, dryRun: false, port: 0, clerkHandoffPort: 0, readinessTimeoutSeconds: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--persistent") parsed.persistent = true;
    else if (arg === "--import-codex-auth") parsed.importCodexAuth = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--profile-name") parsed.profileName = argv[++index];
    else if (arg === "--profile-parent") parsed.profileParent = argv[++index];
    else if (arg === "--port") parsed.port = Number(argv[++index]);
    else if (arg === "--clerk-handoff-port") parsed.clerkHandoffPort = Number(argv[++index]);
    else if (arg === "--readiness-timeout-seconds") parsed.readinessTimeoutSeconds = Number(argv[++index]);
    else fail(`Unknown argument: ${arg}`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(parsed.profileName) || ["runs", "codex-auth"].includes(parsed.profileName)) fail("--profile-name is invalid or reserved");
  for (const [name, value] of [["--port", parsed.port], ["--clerk-handoff-port", parsed.clerkHandoffPort]]) if (!Number.isInteger(value) || value < 0 || value > 65535) fail(`${name} must be 0-65535`);
  if (!Number.isInteger(parsed.readinessTimeoutSeconds) || parsed.readinessTimeoutSeconds < 1 || parsed.readinessTimeoutSeconds > 60) fail("--readiness-timeout-seconds must be 1-60");
  return parsed;
}

function detached(command, args, logs) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (env.HTTPS_PROXY || env.HTTP_PROXY) {
    env.NODE_USE_ENV_PROXY = "1";
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ""} --import=${proxySetupScript}`.trim();
  }
  const stdout = logs ? openLog(logs.stdoutPath) : "ignore";
  const stderr = logs ? openLog(logs.stderrPath) : "ignore";
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ["ignore", stdout, stderr], windowsHide: true, env });
  if (typeof stdout === "number") closeSync(stdout);
  if (typeof stderr === "number") closeSync(stderr);
  child.unref();
  return child;
}

function safeProxyServer(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password) fail("QA launcher cannot put a credentialed proxy in Electron arguments");
  return url.origin;
}

function openLog(path) {
  mkdirSync(dirname(path), { recursive: true });
  return openSync(path, "a", 0o600);
}

async function waitForHealth(url, expectedPid, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const body = await (await fetch(url, { signal: AbortSignal.timeout(1_000) })).json();
      if (body.ready && body.processId === expectedPid) return;
    } catch {}
    if (!isAlive(expectedPid)) break;
    await sleep(100);
  }
  throw new Error("The isolated Clerk handoff did not become ready.");
}

async function waitForCdp(endpoint, ownerPid, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const body = await (await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) })).json();
      if (body.webSocketDebuggerUrl) return true;
    } catch {}
    if (!isAlive(ownerPid)) return false;
    await sleep(200);
  }
  return false;
}

async function watchReceipt(path) {
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  while (isAlive(receipt.processId)) await sleep(500);
  writeFileSync(`${path}.exit-${receipt.processId}.json`, `${JSON.stringify({ processId: receipt.processId, profilePath: receipt.profilePath, exitedAtUtc: new Date().toISOString(), exitCode: null })}\n`);
  if (ownedRelay(receipt.clerkHandoffProcessId, receipt.clerkClaimUrl)) stopProcess(receipt.clerkHandoffProcessId);
  process.exit(0);
}

function processList() {
  if (process.platform === "win32") {
    const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) return [];
    const rows = JSON.parse(result.stdout || "[]");
    return (Array.isArray(rows) ? rows : [rows]).map(row => ({ pid: row.ProcessId, executable: row.ExecutablePath || "", command: row.CommandLine || "" }));
  }
  return readdirSync("/proc").filter(name => /^\d+$/.test(name)).flatMap(name => {
    try { return [{ pid: Number(name), executable: readlinkSync(`/proc/${name}/exe`), command: readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ") }]; }
    catch { return []; }
  });
}

function findProfileProcess(path) {
  const expected = process.platform === "win32" ? electronPath.toLowerCase() : electronPath;
  return processList().find(item => (process.platform === "win32" ? item.executable.toLowerCase() : item.executable) === expected && item.command.includes(`--user-data-dir=${path}`));
}

function ownedRelay(pid, claimUrl) {
  const port = new URL(claimUrl).port;
  return processList().some(item => item.pid === pid && item.command.includes("clerk-qa-handoff.mjs") && item.command.includes(port));
}

function qaEmail(name) {
  const digest = createHash("sha256").update(`${root.toLowerCase()}|${name.toLowerCase()}`).digest("hex").slice(0, 12);
  return `studi.qa.${digest}+clerk_test@example.com`;
}

function shaFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function hashTree(directory) {
  const files = walk(directory).sort();
  const manifest = files.map(path => `${relative(directory, path).split(sep).join("/")} ${shaFile(path)}`).join("\n");
  return createHash("sha256").update(manifest).digest("hex");
}
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
}
function isAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function stopProcess(pid) { try { process.kill(pid, "SIGTERM"); } catch {} }
function sleep(ms) { return new Promise(resolveSleep => setTimeout(resolveSleep, ms)); }
function portAvailable(port) { return new Promise(resolveAvailable => { const server = createServer(); server.once("error", () => resolveAvailable(false)); server.listen(port, "127.0.0.1", () => server.close(() => resolveAvailable(true))); }); }
function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(error => error ? reject(error) : resolvePort(address.port)); }); }); }
async function distinctFreePort(excluded) { let port; do { port = await freePort(); } while (excluded.includes(port)); return port; }
function fail(message) { console.error(message); process.exit(2); }
