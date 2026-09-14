// Live candidate process. It receives public school URLs and configuration only;
// no scenarios, grader, hidden truth, shell or file tools are exposed to the model.
import { app, BrowserWindow } from "electron";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const moduleAt = path => import(pathToFileURL(join(config.buildRoot, path)).href);
const { BrowserController } = await moduleAt("electron/browser/controller.js");
const { PiAgentRuntime } = await moduleAt("electron/agent/runtime.js");
const { SchoolScanCoordinator } = await moduleAt("electron/scan/coordinator.js");
const { ManagerCoordinator } = await moduleAt("electron/manager/coordinator.js");
const { openLocalStore } = await moduleAt("electron/storage/index.js");
const { ProductPreferencesSchema } = await moduleAt("shared/index.js");
const { stripSecrets } = await moduleAt("electron/telemetry/service.js");
app.setPath("userData", join(config.runRoot, "electron"));
const allowedOrigins = new Set(config.origins.map(url => new URL(url).origin));
let window, store, manager, coordinator, activeSession, runtime, calls = 0, phaseCalls = 0, modelCalls = 0;
let exhausted = false, phaseEvents = [], phaseName = "setup", sequence = 0;
let traceWrites = Promise.resolve();
const violations = [];
const trace = event => {
  const safe = JSON.parse(stripSecrets(JSON.stringify({ sequence: ++sequence, phase: phaseName, ...event })));
  phaseEvents.push(safe);
  traceWrites = traceWrites.then(() => appendFile(join(config.runRoot, "trace.jsonl"), JSON.stringify(safe) + "\n"));
};
function assertBudget() { if (exhausted || calls > config.maxToolCalls) throw new Error("Run-wide tool-call budget exceeded"); }
function allowed(url) { try { return url === "about:blank" || allowedOrigins.has(new URL(url).origin); } catch { return false; } }

async function initialize() {
  await app.whenReady();
  window = new BrowserWindow({ show: config.show === true, width: 1200, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: !config.show, partition: `benchmark-${config.runId}` } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.on("will-download", event => event.preventDefault());
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (!allowed(details.url)) { violations.push("Attempted navigation outside the fixture"); trace({ kind: "forbidden_navigation", url: details.url }); }
    callback({ cancel: !allowed(details.url) });
  });
  const browser = new BrowserController({ debugger: window.webContents.debugger,
    getURL: () => window.webContents.getURL(), getTitle: () => window.webContents.getTitle(),
    loadURL: async url => { if (!allowed(url)) { violations.push("Attempted navigation outside the fixture"); trace({ kind: "forbidden_navigation", url }); throw new Error("Only this run's fake school is allowed"); } await window.loadURL(url); },
  });
  // Hidden native windows can lack a compositor frame. Preserve the production
  // screenshot operation, but make an unavailable frame a recoverable tool error.
  const capture = browser.screenshot.bind(browser);
  browser.screenshot = async () => {
    let timer;
    try { return await Promise.race([capture(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Screenshot unavailable in the benchmark window; use the accessibility snapshot.")), 5000); })]); }
    finally { clearTimeout(timer); }
  };
  window.webContents.on("did-navigate", () => browser.pageChanged());
  window.webContents.on("did-navigate-in-page", () => browser.pageChanged());
  runtime = await PiAgentRuntime.create({ cwd: config.agentWorkspace, agentDir: config.agentDir, browserController: browser,
    onDiagnostic: diagnostic => {
      trace({ kind: "diagnostic", diagnostic });
      if (diagnostic.kind === "provider_request") modelCalls++;
      if (diagnostic.kind === "tool_execution_start") {
        calls++; phaseCalls++;
        if (calls > config.maxToolCalls) { exhausted = true; void activeSession?.abort(); }
      }
    },
  });
  runtime.selectModel(config.provider, config.model);
  runtime.setReasoningEffort(config.effort);
  const provider = await runtime.getProviderStatus(config.provider);
  if (provider.state !== "ready") throw new Error(`Provider preflight: ${provider.state}`);
  store = await openLocalStore(join(config.runRoot, "store"));
  if ("workStartMode" in ProductPreferencesSchema.shape) await store.productPreferences.put({ ...await store.productPreferences.get(), workStartMode: "automatic" });
  manager = await ManagerCoordinator.create(store, runtime, { now: () => config.clock });
  const scanRuntime = { createScanSession: async (tools, target, control) => {
    activeSession = await runtime.createScanSession(tools, target, { assertActive: () => { assertBudget(); control?.assertActive(); } });
    trace({ kind: "effective_session", model: runtime.selectedModelId, effort: runtime.selectedReasoningEffort, toolNames: activeSession.toolNames });
    return activeSession;
  } };
  coordinator = new SchoolScanCoordinator(store, scanRuntime, browser, { manager, now: () => config.clock, onError: error => trace({ kind: "scan_error", error: error.message }) });
  await coordinator.saveProfile({ studentName: "Synthetic student", schoolRoot: config.schoolUrl, defaultPermission: "attempt", scanCadence: "manual" });
  process.send?.({ type: "ready", model: runtime.selectedModelId, effort: runtime.selectedReasoningEffort, sdkVersion: PiAgentRuntime.sdkVersion });
}

async function runPhase(name) {
  phaseName = name; phaseCalls = 0; modelCalls = 0; phaseEvents = [];
  const started = performance.now();
  let error = null, state;
  try {
    assertBudget();
    state = name === "cold" ? await coordinator.startScan() : name === "resume" ? await coordinator.resume() : await coordinator.replay();
  } catch (caught) { error = caught.message; state = await coordinator.state(); }
  const generations = phaseEvents.filter(event => event.kind === "diagnostic" && event.diagnostic.kind === "generation");
  const total = key => generations.every(event => typeof event.diagnostic.payload[key] === "number") ? generations.reduce((sum, event) => sum + event.diagnostic.payload[key], 0) : null;
  const usage = generations.length ? { inputTokens: total("$ai_input_tokens"), outputTokens: total("$ai_output_tokens"), cacheReadTokens: total("$ai_cache_read_input_tokens"), cacheWriteTokens: total("$ai_cache_creation_input_tokens") } : null;
  const result = { name, status: error ? exhausted ? "budget_exceeded" : "failed" : "completed", error, scanState: state.scan?.state ?? null,
    assignments: state.assignments, courses: state.courses, scan: state.scan,
    queue: manager.state().entries.map(entry => ({ ...entry, assignmentId: store.tasks.get(entry.taskId)?.assignmentId, state: store.tasks.get(entry.taskId)?.state })), policyViolations: [...violations],
    metrics: { durationMs: performance.now() - started, toolCalls: phaseCalls, modelCalls, usage },
  };
  await traceWrites;
  await writeFile(join(config.runRoot, `${name}.json`), JSON.stringify(result, null, 2));
  process.send?.({ type: "result", result });
}
async function close() { coordinator?.dispose(); manager?.dispose(); activeSession?.dispose(); store?.close(); window?.destroy(); await traceWrites; app.quit(); }
let chain = Promise.resolve();
process.on("message", message => {
  chain = chain.then(() => message.command === "run" ? runPhase(message.phase) : message.command === "close" ? close() : undefined)
    .catch(async error => { await traceWrites.catch(() => {}); process.send?.({ type: "error", error: stripSecrets(error.message) }); app.exit(1); });
});
process.on("disconnect", () => app.exit(0));
await mkdir(config.agentWorkspace, { recursive: true });
initialize().catch(error => { process.send?.({ type: "error", error: stripSecrets(error.message) }); app.exit(1); });
