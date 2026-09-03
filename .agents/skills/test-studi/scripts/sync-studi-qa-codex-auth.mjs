import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ENV_NAME = "STUDI_QA_CODEX_AUTH";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..", "..", "..", "..");
const qaRoot = join(workspaceRoot, ".agents", "studi-qa");

const args = parseArgs(process.argv.slice(2));
if (!args.import && !args.export) {
  fail("usage: sync-studi-qa-codex-auth.mjs --import|--export [--profile <path>] [--cache <path>] [--copy-secret]");
}

const profilePath = resolve(args.profile ?? join(qaRoot, "profile"));
const cachePath = resolve(args.cache ?? join(qaRoot, "codex-auth", "auth.json"));
const profileAuthPath = join(profilePath, "studi-data", "pi", "auth.json");

if (args.import) {
  const hydrated = await hydrateCacheFromEnv(cachePath);
  const source = await fileInfo(cachePath);
  if (!source.usable) {
    writeReceipt({
      schemaVersion: 1,
      action: "import",
      ok: false,
      reason: "source_missing_or_empty",
      source: hydrated.source,
      sourcePath: cachePath,
      destinationPath: profileAuthPath,
      sourceBytes: source.bytes,
    });
    process.exit(2);
  }
  await copyAuth(cachePath, profileAuthPath);
  const destination = await fileInfo(profileAuthPath);
  writeReceipt({
    schemaVersion: 1,
    action: "import",
    ok: destination.usable,
    source: hydrated.source,
    sourcePath: cachePath,
    destinationPath: profileAuthPath,
    bytes: destination.bytes,
  });
  process.exit(destination.usable ? 0 : 2);
}

const source = await fileInfo(profileAuthPath);
if (!source.usable) {
  writeReceipt({
    schemaVersion: 1,
    action: "export",
    ok: false,
    reason: "source_missing_or_empty",
    sourcePath: profileAuthPath,
    destinationPath: cachePath,
    sourceBytes: source.bytes,
  });
  process.exit(2);
}

await copyAuth(profileAuthPath, cachePath);
const destination = await fileInfo(cachePath);
const copied = args.copySecret ? await copySecretToClipboard(cachePath) : { copied: false, reason: "not_requested" };
writeReceipt({
  schemaVersion: 1,
  action: "export",
  ok: destination.usable,
  sourcePath: profileAuthPath,
  destinationPath: cachePath,
  bytes: destination.bytes,
  secretName: ENV_NAME,
  secretCopied: copied.copied,
  secretCopyReason: copied.reason,
});
process.exit(destination.usable ? 0 : 2);

function parseArgs(argv) {
  const parsed = { import: false, export: false, copySecret: false, profile: null, cache: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--import") parsed.import = true;
    else if (value === "--export") parsed.export = true;
    else if (value === "--copy-secret") parsed.copySecret = true;
    else if (value === "--profile") parsed.profile = argv[++index] ?? null;
    else if (value === "--cache") parsed.cache = argv[++index] ?? null;
    else fail(`unknown argument: ${value}`);
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function writeReceipt(receipt) {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

async function fileInfo(path) {
  try {
    const bytes = await readFile(path);
    const parsed = JSON.parse(bytes.toString("utf8"));
    const credential = parsed?.["openai-codex"];
    const usable = credential?.type === "oauth"
      && typeof credential.access === "string" && credential.access.length > 0
      && typeof credential.refresh === "string" && credential.refresh.length > 0
      && typeof credential.expires === "number" && Number.isFinite(credential.expires);
    return { exists: true, bytes: bytes.length, usable };
  } catch {
    return { exists: false, bytes: 0, usable: false };
  }
}

async function copyAuth(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function hydrateCacheFromEnv(path) {
  const raw = process.env[ENV_NAME];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { source: "file" };
  }
  const bytes = decodeSecret(raw);
  if (!bytes) {
    return { source: "env_invalid" };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { source: "env" };
}

function decodeSecret(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return Buffer.byteLength(trimmed) > 2 ? Buffer.from(trimmed, "utf8") : null;
  }
  try {
    const decoded = Buffer.from(trimmed, "base64");
    const head = decoded.subarray(0, 1).toString("utf8");
    if (decoded.length <= 2 || (head !== "{" && head !== "[")) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function copySecretToClipboard(path) {
  if (process.platform !== "win32") {
    return { copied: false, reason: "clipboard_windows_only" };
  }
  const encoded = (await readFile(path)).toString("base64");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Set-Clipboard -Value $input",
  ], { input: encoded, encoding: "utf8" });
  if (result.status !== 0) {
    return { copied: false, reason: "clipboard_failed" };
  }
  return { copied: true, reason: "clipboard" };
}
