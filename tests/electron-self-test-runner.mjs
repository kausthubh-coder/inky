import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import electronPath from "electron";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryRoot = resolve(tmpdir());
const positiveOnly = process.argv.includes("--positive-only");
const nonce = `${process.pid}-${Date.now()}`;
const selfTestDirectory = ownedDirectory(`studi-wp00-self-test-${nonce}`);
const cleanupDirectories = new Set([selfTestDirectory]);

try {
  const positive = await runElectron(selfTestDirectory, { STUDI_UI_SCENARIO: "onboarding-ready" }, 25_000, true);
  assert.deepEqual(positive.exit, { code: 0, signal: null }, `Electron failed: ${positive.stderr}`);
  assert.match(positive.stdout, /^STUDI_SELF_TEST \{"marker":true,/m);
  assert.match(positive.stdout, /"contractVersion":"11"/);
  assert.match(positive.stdout, /"electron":"37\.10\.3"/);
  assert.match(positive.stdout, /"node":"22\.21\.1"/);
  assert.match(
    positive.stdout,
    /"onboardingUi":\{"fableConversation":true,"browserHandoff":true,"scanAction":true,"passwordFieldCount":0\}/,
  );
  assert.match(
    positive.stdout,
    /"uiQuality":\{"mainLandmarkCount":1,"interactiveCount":\d+,"focusMoved":true\}/,
  );
  assert.match(
    positive.stdout,
    /"storage":\{"driver":"node:sqlite","node":"22\.21\.1","schemaVersion":4,"fileBacked":true,"reopened":true,"artifactRoundTrip":true,"backupValidated":true,"backupArtifactCount":1\}/,
  );
  assert.match(
    positive.stdout,
    /"agent":\{"runtime":"pi-agent-session","sdkVersion":"0\.84\.4","sessionPersisted":true,"sessionResumed":true,"probeCompleted":true,"activeTools":\["studi_probe"\],"providerStatus":\{"schemaVersion":1,"providerId":"unknown","providerName":"Unknown provider","state":"unavailable","loginMethods":\[\],"reason":"This provider is not registered in the Pi runtime\."\}\}/,
  );
  assert.match(
    positive.stdout,
    /"browser":\{"view":"web-contents-view","source":"visible-school-browser","url":"about:blank","bounded":true,"revision":\d+,"telemetryIsolated":true\}/,
  );
  assert.match(
    positive.stdout,
    /"lifecycle":\{"singleInstanceLock":true,"closeHides":true,"trayOpenHandled":true\}/,
  );
  assert.match(
    positive.stdout,
    /"notifications":\{"persistedWhenMuted":true,"mutedShown":false,"mutedDelivered":false,"enabledShown":(?:true|false),"enabledDelivered":(?:true|false),"sound":"inky_nudge"\}/,
  );

  if (!positiveOnly) {
    await testInvalidProfile();
    await testRendererLoadFailure();
    await testMalformedManifestResult();
    await testMalformedRuntimeResult();
  }
} finally {
  for (const directory of cleanupDirectories) {
    if (existsSync(directory)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    assert.equal(existsSync(directory), false, `temporary Electron path was not removed: ${directory}`);
  }
  process.stdout.write("STUDI_SELF_TEST_CLEANUP removed=true\n");
}

async function testInvalidProfile() {
  const invalidParent = resolve(temporaryRoot, `studi-wp00-invalid-parent-${nonce}`);
  const invalidDirectory = resolve(invalidParent, "studi-wp00-self-test-invalid");
  assert.equal(dirname(invalidParent), temporaryRoot);
  assert.match(basename(invalidParent), /^studi-wp00-invalid-parent-\d+-\d+$/);
  cleanupDirectories.add(invalidParent);
  assert.equal(existsSync(invalidParent), false, "invalid profile parent fixture already exists");
  assert.equal(existsSync(invalidDirectory), false, "invalid profile fixture already exists");

  const invalidRun = await runElectron(invalidDirectory, {}, 8_000);
  assert.match(
    invalidRun.stderr,
    /Self-test userData must be an owned directory under the system temp folder/,
  );
  assert.equal(existsSync(invalidDirectory), false, "invalid profile path was created");
  assert.equal(existsSync(invalidParent), false, "invalid profile parent path was created");
  assert.equal(invalidRun.timedOut, false, "invalid self-test profile did not fail fast");
  assert.notEqual(invalidRun.exit.code, 0, "invalid self-test profile was accepted");
  process.stdout.write("STUDI_SELF_TEST_REJECTION invalid-profile=true parent-created=false\n");
}

async function testRendererLoadFailure() {
  const directory = ownedDirectory(`studi-wp00-self-test-renderer-failure-${nonce}`);
  cleanupDirectories.add(directory);
  const failedLoad = await runElectron(
    directory,
    { STUDI_SELF_TEST_RENDERER_FAILURE: "1" },
    8_000,
  );
  assert.equal(failedLoad.timedOut, false, "renderer load failure waited for the outer timeout");
  assert.notEqual(failedLoad.exit.code, 0, "renderer load failure exited successfully");
  assert.match(failedLoad.stderr, /STUDI_SELF_TEST_FAILED renderer load/);
  process.stdout.write("STUDI_SELF_TEST_REJECTION renderer-load=true timed-out=false\n");
}

async function testMalformedManifestResult() {
  const directory = ownedDirectory(`studi-wp00-self-test-malformed-manifest-${nonce}`);
  cleanupDirectories.add(directory);
  const malformedResult = await runElectron(
    directory,
    { STUDI_SELF_TEST_MALFORMED_MANIFEST_RESULT: "1" },
    8_000,
  );
  assert.equal(malformedResult.timedOut, false, "malformed manifest waited for the outer timeout");
  assert.notEqual(malformedResult.exit.code, 0, "malformed manifest was accepted");
  assert.match(malformedResult.stderr, /STUDI_SELF_TEST_FAILED/);
  process.stdout.write("STUDI_SELF_TEST_REJECTION malformed-manifest=true\n");
}

async function testMalformedRuntimeResult() {
  const directory = ownedDirectory(`studi-wp00-self-test-malformed-runtime-${nonce}`);
  cleanupDirectories.add(directory);
  const malformedResult = await runElectron(
    directory,
    { STUDI_SELF_TEST_MALFORMED_RUNTIME_RESULT: "1" },
    8_000,
  );
  assert.equal(malformedResult.timedOut, false, "malformed runtime waited for the outer timeout");
  assert.notEqual(malformedResult.exit.code, 0, "malformed runtime was accepted");
  assert.match(malformedResult.stderr, /STUDI_SELF_TEST_FAILED/);
  process.stdout.write("STUDI_SELF_TEST_REJECTION malformed-runtime=true\n");
}

function ownedDirectory(name) {
  const directory = resolve(temporaryRoot, name);
  assert.equal(dirname(directory), temporaryRoot);
  assert.match(basename(directory), /^studi-wp00-self-test-[a-z-]*\d+-\d+$/);
  return directory;
}

async function runElectron(userDataDirectory, extraEnvironment, timeoutMs, streamOutput = false) {
  const environment = { ...process.env };
  delete environment.VITE_DEV_SERVER_URL;
  delete environment.STUDI_DEVELOPMENT_MODE;
  const child = spawn(electronPath, [projectRoot], {
    cwd: projectRoot,
    env: {
      ...environment,
      STUDI_SELF_TEST: "1",
      STUDI_SELF_TEST_USER_DATA: userDataDirectory,
      ...extraEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    if (streamOutput) {
      process.stdout.write(text);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (streamOutput) {
      process.stderr.write(text);
    }
  });

  let timeout;
  let timedOut = false;
  const exit = await new Promise((resolveExit, rejectExit) => {
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  }).finally(() => clearTimeout(timeout));

  return { exit, stdout, stderr, timedOut };
}
