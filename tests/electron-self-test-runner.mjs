import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import electronPath from "electron";
import WebSocket from "ws";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = resolve(tmpdir());
const positiveOnly = process.argv.includes("--positive-only");
const nonce = `${process.pid}-${Date.now()}`;
const cleanupDirectories = new Set();
const buildSha = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
}).stdout.trim() || "unknown";
const worktreeDirty = Boolean(spawnSync("git", ["status", "--porcelain"], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
}).stdout.trim());
async function main() {
try {
  const onboardingWelcome = await runControlledScenario("onboarding-welcome", {}, advanceToConnectedApps);
  assert.equal(onboardingWelcome.observation.marker, true);
  assert.equal(onboardingWelcome.observation.onboarding.connectedAppStepObserved, true);
  assert.equal(onboardingWelcome.observation.onboarding.githubConnectActionObserved, true);
  assert.equal(onboardingWelcome.observation.onboarding.homeworkFolderStep, true);
  assert.equal(onboardingWelcome.observation.onboarding.passwordFieldCount, 0);
  emitReceipt(onboardingWelcome);

  const onboarding = await runControlledScenario("onboarding-ready");
  assert.equal(onboarding.observation.marker, true);
  assert.equal(onboarding.observation.contractVersion, "15");
  assert.equal(onboarding.observation.runtime.electron, "37.10.3");
  assert.equal(onboarding.observation.runtime.node, "22.21.1");
  assert.deepEqual(onboarding.observation.onboarding, {
    fableConversation: true,
    browserHandoff: true,
    scanAction: true,
    connectedAppStep: false,
    githubConnectAction: false,
    connectedAppStepObserved: false,
    githubConnectActionObserved: false,
    homeworkFolderStep: false,
    passwordFieldCount: 0,
  });
  assert.equal(onboarding.observation.ui.mainLandmarkCount, 1);
  assert.ok(onboarding.observation.ui.interactiveCount >= 2);
  assert.equal(onboarding.observation.ui.focusMoved, true);
  assert.equal(onboarding.observation.connectedApps.configured, true);
  assert.equal(onboarding.observation.connectedApps.toolkits.length, 13);
  assert.ok(onboarding.observation.connectedApps.toolkits.includes("github"));
  assert.ok(onboarding.observation.connectedApps.toolkits.includes("gmail"));
  assert.ok(onboarding.observation.connectedApps.toolkits.includes("canvas"));
  assertComposition(onboarding.composition);
  emitReceipt(onboarding);

  const weekBoard = await runControlledScenario("partial-dashboard");
  assert.equal(weekBoard.observation.marker, true);
  assert.equal(weekBoard.observation.weekBoard.visible, true);
  assert.equal(weekBoard.observation.weekBoard.hasCourse, true);
  assert.equal(weekBoard.observation.weekBoard.hasAssignment, true);
  assert.equal(weekBoard.observation.onboarding.passwordFieldCount, 0);
  assertComposition(weekBoard.composition);
  emitReceipt(weekBoard);

  const expandedBrowser = await runControlledScenario("desk-handoff", {}, exerciseExpandedBrowser);
  assert.equal(expandedBrowser.observation.deskBrowser.activityCardRemoved, true);
  assert.equal(expandedBrowser.observation.deskBrowser.expanded, true);
  assert.equal(expandedBrowser.observation.deskBrowser.closedCleanly, true);
  emitReceipt(expandedBrowser);

  if (!positiveOnly) {
    await testInvalidProfile();
    await testRendererLoadFailure();
    await testMalformedPublicReply("STUDI_SELF_TEST_MALFORMED_MANIFEST_RESULT", "getContractManifest");
    await testMalformedPublicReply("STUDI_SELF_TEST_MALFORMED_RUNTIME_RESULT", "getRuntimeInfo");
  }
} finally {
  for (const directory of cleanupDirectories) {
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.equal(existsSync(directory), false, `temporary Electron path was not removed: ${directory}`);
  }
  process.stdout.write("STUDI_SELF_TEST_CLEANUP removed=true\n");
}
}

function assertComposition(composition) {
  assert.deepEqual(composition.window, { menuBarVisible: false });
  assert.equal(composition.storage.driver, "node:sqlite");
  assert.equal(composition.storage.schemaVersion, 6);
  assert.equal(composition.storage.fileBacked, true);
  assert.equal(composition.storage.reopened, true);
  assert.equal(composition.storage.backupValidated, true);
  assert.equal(composition.agent.runtime, "pi-agent-session");
  assert.equal(composition.agent.sessionPersisted, true);
  assert.equal(composition.agent.sessionResumed, true);
  assert.equal(composition.agent.probeCompleted, true);
  assert.deepEqual(composition.agent.activeTools, ["studi_probe"]);
}

function emitReceipt(run) {
  process.stdout.write(`STUDI_EXTERNAL_ELECTRON ${JSON.stringify({
    buildSha,
    worktreeDirty,
    scenario: run.scenario,
    durationMs: run.durationMs,
    observations: {
      marker: run.observation.marker,
      contractVersion: run.observation.contractVersion,
      mainLandmarkCount: run.observation.ui.mainLandmarkCount,
      passwordFieldCount: run.observation.onboarding.passwordFieldCount,
      connectedAppsConfigured: run.observation.connectedApps.configured,
      weekBoardVisible: run.observation.weekBoard.visible,
    },
    cleanup: "process-stop-and-profile-finally",
  })}\n`);
}

async function runControlledScenario(scenario, extraEnvironment = {}, prepare) {
  const directory = ownedDirectory(`studi-wp00-self-test-${scenario}-${nonce}`);
  cleanupDirectories.add(directory);
  const port = await reservePort();
  const startedAt = Date.now();
  const child = launchElectron(directory, port, { STUDI_UI_SCENARIO: scenario, ...extraEnvironment });
  try {
    const ready = await waitForReady(child, 25_000);
    const composition = JSON.parse(ready.slice(ready.indexOf("{")));
    const client = await connectToRenderer(port, 10_000);
    try {
      await waitForAppMarker(client, 8_000);
      await prepare?.(client);
      const observation = await inspectPublicApp(client);
      return { scenario, observation, composition, durationMs: Date.now() - startedAt };
    } finally {
      client.close();
    }
  } finally {
    await stopChild(child);
  }
}

async function inspectPublicApp(client) {
  return client.evaluate(`(async () => {
    const marker = document.querySelector('[data-studi-app-ready="true"]');
    const [runtime, manifest, connectedApps, library] = await Promise.all([
      window.studi.getRuntimeInfo(),
      window.studi.getContractManifest(),
      window.studi.getConnectedApps(),
      window.studi.getLibraryState(),
    ]);
    const focusTarget = document.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
    const text = document.body.innerText;
    return {
      marker: Boolean(marker),
      runtime,
      contractVersion: manifest.contractVersion,
      onboarding: {
        fableConversation: Boolean(document.querySelector('.fable-window .fable-speech')),
        browserHandoff: Boolean(document.querySelector('.fable-stage.with-browser')),
        scanAction: Boolean(document.querySelector('[data-app-control="start-scan"]')),
        connectedAppStep: Boolean(document.querySelector('[data-onboarding-connected-apps="true"]')),
        githubConnectAction: Boolean(document.querySelector('[data-onboarding-connected-apps="true"] [data-connected-app="github"] button')),
        connectedAppStepObserved: document.body.dataset.connectedAppStepObserved === 'true',
        githubConnectActionObserved: document.body.dataset.githubConnectActionObserved === 'true',
        homeworkFolderStep: Boolean(document.querySelector('[data-onboarding-homework-folder="true"]')),
        passwordFieldCount: document.querySelectorAll('input[type="password"]').length,
      },
      ui: {
        mainLandmarkCount: document.querySelectorAll('main').length,
        interactiveCount: document.querySelectorAll('button, input, select, textarea, a[href]').length,
        focusMoved: focusTarget instanceof HTMLElement && document.activeElement === focusTarget,
      },
      connectedApps: {
        configured: connectedApps.configured,
        toolkits: connectedApps.toolkits.map((item) => item.toolkit),
      },
      weekBoard: {
        visible: Boolean(document.querySelector('[data-studi-week-board="true"]')),
        hasCourse: library.tasks.some((item) => item.assignment.courseId === 'course-calculus'),
        hasAssignment: library.tasks.some((item) => item.assignment.title === 'Problem set 4'),
      },
      deskBrowser: {
        activityCardRemoved: document.body.dataset.activityCardRemoved === 'true',
        expanded: document.body.dataset.browserExpanded === 'true',
        closedCleanly: document.body.dataset.browserClosedCleanly === 'true',
      },
    };
  })()`);
}

async function exerciseExpandedBrowser(client) {
  await client.evaluate(`(async () => {
    const deskButton = document.querySelector('[aria-label="Open Inky’s desk"]');
    if (!(deskButton instanceof HTMLButtonElement)) throw new Error('Missing Inky desk button');
    deskButton.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.body.dataset.activityCardRemoved = String(!document.body.innerText.includes("What I’ve done"));
    const expandButton = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Expand'));
    if (!(expandButton instanceof HTMLButtonElement)) throw new Error('Missing browser expand button');
    expandButton.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const modal = document.querySelector('[role="dialog"][aria-label="School browser"]');
    const expandedSlot = document.querySelector('[aria-label="Expanded live school page"]');
    document.body.dataset.browserExpanded = String(Boolean(modal && expandedSlot));
    const closeButton = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Back to Inky');
    if (!(closeButton instanceof HTMLButtonElement)) throw new Error('Missing browser close button');
    closeButton.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.body.dataset.browserClosedCleanly = String(!document.querySelector('[role="dialog"][aria-label="School browser"]') && Boolean(document.querySelector('[data-school-slot="true"]')));
  })()`);
}

async function advanceToConnectedApps(client) {
  await client.evaluate(`(async () => {
    const click = (label) => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      if (!(button instanceof HTMLButtonElement)) throw new Error('Missing onboarding action: ' + label);
      button.click();
    };
    click("Let's do it");
    await new Promise((resolve) => setTimeout(resolve, 50));
    click("Let's go");
    await new Promise((resolve) => setTimeout(resolve, 50));
    document.body.dataset.connectedAppStepObserved = String(Boolean(document.querySelector('[data-onboarding-connected-apps="true"]')));
    document.body.dataset.githubConnectActionObserved = String(Boolean(document.querySelector('[data-onboarding-connected-apps="true"] [data-connected-app="github"] button')));
    click("Continue");
    await new Promise((resolve) => setTimeout(resolve, 50));
  })()`);
}

async function testMalformedPublicReply(environmentName, method) {
  const run = await startControlledProcess({ [environmentName]: "1" });
  try {
    const client = await connectToRenderer(run.port, 10_000);
    try {
      await waitForAppMarker(client, 8_000);
      await assert.rejects(() => client.evaluate(`window.studi.${method}()`));
    } finally {
      client.close();
    }
  } finally {
    await stopChild(run.child);
  }
  process.stdout.write(`STUDI_SELF_TEST_REJECTION malformed-${method === "getContractManifest" ? "manifest" : "runtime"}=true\n`);
}

async function startControlledProcess(extraEnvironment = {}) {
  const directory = ownedDirectory(`studi-wp00-self-test-rejection-${Math.random().toString(16).slice(2)}-${nonce}`);
  cleanupDirectories.add(directory);
  const port = await reservePort();
  const child = launchElectron(directory, port, { STUDI_UI_SCENARIO: "onboarding-ready", ...extraEnvironment });
  await waitForReady(child, 25_000);
  return { child, port };
}

async function testInvalidProfile() {
  const invalidParent = resolve(temporaryRoot, `studi-wp00-invalid-parent-${nonce}`);
  const invalidDirectory = resolve(invalidParent, "studi-wp00-self-test-invalid");
  cleanupDirectories.add(invalidParent);
  assert.equal(existsSync(invalidParent), false);
  const result = await runToExit(invalidDirectory, {}, 8_000);
  assert.match(result.stderr, /Self-test userData must be an owned directory under the system temp folder/);
  assert.notEqual(result.exit.code, 0);
  assert.equal(result.timedOut, false);
  process.stdout.write("STUDI_SELF_TEST_REJECTION invalid-profile=true parent-created=false\n");
}

async function testRendererLoadFailure() {
  const directory = ownedDirectory(`studi-wp00-self-test-renderer-failure-${nonce}`);
  cleanupDirectories.add(directory);
  const result = await runToExit(directory, { STUDI_SELF_TEST_RENDERER_FAILURE: "1" }, 8_000);
  assert.notEqual(result.exit.code, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /STUDI_SELF_TEST_FAILED renderer load/);
  process.stdout.write("STUDI_SELF_TEST_REJECTION renderer-load=true timed-out=false\n");
}

function launchElectron(userDataDirectory, port, extraEnvironment) {
  const environment = { ...process.env };
  delete environment.VITE_DEV_SERVER_URL;
  delete environment.STUDI_DEVELOPMENT_MODE;
  return spawn(electronPath, [projectRoot, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, "--remote-allow-origins=*"], {
    cwd: projectRoot,
    env: { ...environment, STUDI_SELF_TEST: "1", STUDI_SELF_TEST_USER_DATA: userDataDirectory, ...extraEnvironment },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function runToExit(userDataDirectory, extraEnvironment, timeoutMs) {
  const child = launchElectron(userDataDirectory, await reservePort(), extraEnvironment);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let timedOut = false;
  let timer;
  const exit = await new Promise((resolveExit, rejectExit) => {
    timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  }).finally(() => clearTimeout(timer));
  return { exit, stderr, timedOut };
}

function waitForReady(child, timeoutMs) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => rejectReady(new Error(`Electron readiness timed out: ${stderr}`)), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split(/\r?\n/).find((item) => item.startsWith("STUDI_SELF_TEST_READY "));
      if (line) { clearTimeout(timer); resolveReady(line); }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => { clearTimeout(timer); rejectReady(new Error(`Electron exited before readiness (${code}): ${stderr}`)); });
    child.once("error", (error) => { clearTimeout(timer); rejectReady(error); });
  });
}

async function connectToRenderer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];
  let lastError = "none";
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      lastTargets = targets.map(({ type, url, webSocketDebuggerUrl }) => ({ type, url, hasSocket: Boolean(webSocketDebuggerUrl) }));
      const target = targets.find((item) => item.type === "page" && item.url.endsWith("/dist/client/index.html"));
      if (target?.webSocketDebuggerUrl) return CdpClient.connect(target.webSocketDebuggerUrl);
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await delay(50);
  }
  throw new Error(`Electron renderer DevTools target did not appear (${lastError}): ${JSON.stringify(lastTargets)}`);
}

async function waitForAppMarker(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate("Boolean(document.querySelector('[data-studi-app-ready=\"true\"]'))")) return;
    await delay(50);
  }
  throw new Error("Renderer app-ready marker timed out");
}

class CdpClient {
  #socket;
  #nextId = 0;
  #pending = new Map();

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  send(method, params) {
    const id = ++this.#nextId;
    return new Promise((resolveResult, rejectResult) => {
      this.#pending.set(id, { resolve: resolveResult, reject: rejectResult });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.#socket.close(); }
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once("close", resolveExit)),
    delay(5_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

function ownedDirectory(name) {
  const directory = resolve(temporaryRoot, name);
  assert.equal(dirname(directory), temporaryRoot);
  assert.match(basename(directory), /^studi-wp00-self-test-[a-z0-9-]+$/);
  return directory;
}

function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      assert.ok(port);
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

await main();
