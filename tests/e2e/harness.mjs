import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const mainSource = join(projectRoot, "desktop/electron/main.ts");
const mainEntry = join(projectRoot, "dist/electron/main.js");
const runtimeModule = join(projectRoot, "tests/e2e/scripted-runtime.mjs");
const liveRuntimeModule = join(projectRoot, "tests/e2e/live-runtime.mjs");

const REQUIRED_HOOKS = [
  {
    marker: "STUDI_E2E_RUNTIME_MODULE",
    need: "an unpackaged-only STUDI_E2E_RUNTIME_MODULE hook that calls createE2eRuntime() instead of constructing PiAgentRuntime",
  },
  {
    marker: "STUDI_E2E_HOMEWORK_ROOT",
    need: "an unpackaged-only STUDI_E2E_HOMEWORK_ROOT chooser override that still runs the normal empty-folder validation and workspace initialization",
  },
  {
    marker: "STUDI_E2E_REVIEW_WINDOW_MS",
    need: "an unpackaged-only STUDI_E2E_REVIEW_WINDOW_MS override passed to AssignmentExecutionCoordinator so auto-submit can be tested without a one-minute wall-clock wait",
  },
];

export async function checkpoint4HookStatus(markers = REQUIRED_HOOKS.map(({ marker }) => marker)) {
  const source = await readFile(mainSource, "utf8");
  return REQUIRED_HOOKS.filter(({ marker }) => markers.includes(marker) && !source.includes(marker)).map(({ need }) => need);
}

export async function requireCheckpoint4Hooks(_t, markers) {
  const missing = await checkpoint4HookStatus(markers);
  assert.deepEqual(missing, [], `Checkpoint 4 app hooks are missing: ${missing.join("; ")}`);
  return true;
}

async function loadPlaywright() {
  const configured = process.env.STUDI_PLAYWRIGHT_PATH;
  try {
    return configured ? require(configured) : await import("playwright");
  } catch (error) {
    throw new Error(
      "Playwright is required for Electron e2e. Install it or set STUDI_PLAYWRIGHT_PATH to the package used by the QA environment.",
      { cause: error },
    );
  }
}

export async function withLmsApp(options, run) {
  const { _electron } = await loadPlaywright();
  const electronPath = (await import("electron")).default;
  const { startLms } = await import(pathToFileURL(join(projectRoot, ".studi-lms/build/server.mjs")).href);
  const lmsRoot = await mkdtemp(join(tmpdir(), "studi-e2e-lms-"));
  const profileRoot = await mkdtemp(join(tmpdir(), "studi-wp00-self-test-e2e-"));
  const homeworkRoot = await mkdtemp(join(tmpdir(), "studi-e2e-homework-"));
  const scriptPath = join(profileRoot, "script.json");
  let school;
  let app;
  try {
    school = await startLms({
      scenarioId: options.scenario,
      seed: options.seed ?? 42,
      runDirectory: lmsRoot,
    });
    await writeFile(scriptPath, JSON.stringify(typeof options.script === "function" ? options.script(school) : options.script ?? {}, null, 2));
    if (options.live) {
      try {
        execFileSync(process.execPath, [join(projectRoot, ".agents/skills/test-studi/scripts/sync-studi-qa-codex-auth.mjs"), "--import", "--profile", profileRoot], { cwd: projectRoot, stdio: "pipe", windowsHide: true, timeout: 15_000 });
      } catch {
        throw new Error("The dedicated QA Codex provider cache is unavailable for live homework verification.");
      }
    }
    const launch = () => _electron.launch({
      executablePath: electronPath,
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...process.env,
        STUDI_SELF_TEST: "1",
        STUDI_SELF_TEST_USER_DATA: profileRoot,
        STUDI_E2E_RUNTIME_MODULE: options.live ? liveRuntimeModule : runtimeModule,
        STUDI_E2E_SCRIPT_PATH: scriptPath,
        STUDI_E2E_HOMEWORK_ROOT: homeworkRoot,
        STUDI_E2E_REVIEW_WINDOW_MS: String(options.reviewWindowMs ?? 150),
      },
    });
    const readyPage = async () => {
    await app.firstWindow();
    let page;
    const deadline = Date.now() + 20_000;
    while (!page && Date.now() < deadline) {
      for (const candidate of app.context().pages()) {
        if (await candidate.locator('[data-studi-app-ready="true"]').isVisible().catch(() => false)) {
          page = candidate;
          break;
        }
      }
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) {
      const surfaces = await Promise.all(app.context().pages().map(async candidate => ({
        url: candidate.url().startsWith("data:") ? "data: overlay" : candidate.url(),
        text: (await candidate.locator("body").innerText().catch(() => "<unavailable>")).slice(0, 300),
      })));
      throw new Error(`Studi did not reach its app screen: ${JSON.stringify(surfaces)}`);
    }
    await page.setViewportSize({ width: 1120, height: 760 });
    return page;
    };
    app = await launch();
    const page = await readyPage();
    await run({ app, page, school, homeworkRoot, profileRoot, restart: async () => {
      await app.close();
      app = await launch();
      return readyPage();
    } });
  } finally {
    await app?.close().catch(() => undefined);
    await school?.close().catch(() => undefined);
    await Promise.all([
      rm(lmsRoot, { recursive: true, force: true, maxRetries: 5 }),
      rm(profileRoot, { recursive: true, force: true, maxRetries: 5 }),
      rm(homeworkRoot, { recursive: true, force: true, maxRetries: 5 }),
    ]);
  }
}

export async function completeOnboarding(page, schoolUrl, permission = "Do it, I'll submit") {
  await page.getByRole("button", { name: "Let's do it" }).click();
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Choose an empty folder", exact: true }).click();
  await page.getByRole("button", { name: "Use this Studi folder" }).click();
  await page.getByLabel("Class link").fill(schoolUrl);
  await page.getByRole("button", { name: "That's the one" }).click();
  await page.getByRole("button", { name: new RegExp(`^${permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await page.getByRole("button", { name: "Use this" }).click();
  await page.getByRole("button", { name: "Only when I ask" }).click();
  await page.getByRole("button", { name: "Sounds good. Open school." }).click();
  await page.getByRole("button", { name: "I'm signed in. Look around." }).click();
  try {
    await page.getByRole("button", { name: "Open my week" }).waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    const state = await publicState(page, "getSchoolOnboardingState").catch(() => null);
    const text = (await page.locator("body").innerText()).slice(0, 1500);
    throw new Error(`Onboarding did not finish: ${JSON.stringify({ scan: state?.scan, text })}`, { cause: error });
  }
  await page.getByRole("button", { name: "Open my week" }).click();
}

export async function publicState(page, method, argument) {
  return page.evaluate(async ({ method, argument }) => {
    const api = window.studi;
    if (!api || typeof api[method] !== "function") throw new Error(`Missing public renderer method ${method}`);
    return argument === undefined ? api[method]() : api[method](argument);
  }, { method, argument });
}

export async function waitForPublicState(page, method, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await publicState(page, method);
    if (predicate(last)) return last;
    await page.waitForTimeout(50);
  }
  assert.fail(`${method} did not reach the expected state: ${JSON.stringify(last)}`);
}

export function schoolPage(app, origin) {
  const page = app.context().pages().filter((candidate) => candidate.url().startsWith(origin)).at(-1);
  assert.ok(page, `Expected an Electron school page at ${origin}`);
  return page;
}

export async function expectedAssignments(name) {
  return JSON.parse(await readFile(join(projectRoot, "agent-harness/lms/expected", name), "utf8"));
}

export function normalizedExpected(expected, origins) {
  const originFor = { school: origins.school, statistics: origins.statistics, feedback: origins.feedback, university: origins.university };
  const expand = (target) => target.replace(/^(school|statistics|feedback|university):/, (_, key) => originFor[key]);
  return expected.assignments.map((item) => ({
    course: item.course,
    title: item.title,
    dueAt: item.dueAt,
    sourceTargets: [item.href, ...(item.aliases ?? [])].map(expand),
  }));
}

export function committedSubmissions(school) {
  return school.inspect().effects.filter((effect) => effect.type === "submission_committed");
}

export function singleAssignmentScript(school, assignmentTurns) {
  const state = school.inspect().state;
  assert.equal(state.courses.length, 1);
  assert.equal(state.activities.length, 1);
  const course = state.courses[0];
  const activity = state.activities[0];
  const href = `${school.origins[activity.service]}/assignments/${encodeURIComponent(activity.id)}`;
  return {
    scan: [[
      { op: "tool", name: "browser_snapshot" },
      { op: "tool", name: "scan_record_course", input: { label: course.title } },
      { op: "tool", name: "scan_record_rows", input: { courseKey: course.title, rows: [{
        title: activity.title, href, dueText: activity.dashboardDueText ?? activity.dueText,
        statusText: "Not submitted", kind: activity.kind === "quiz" ? "quiz" : "assignment",
      }] } },
    ]],
    details: { instructions: activity.instructions, requirements: activity.requirements, dueText: activity.dueText },
    assignment: assignmentTurns,
  };
}
