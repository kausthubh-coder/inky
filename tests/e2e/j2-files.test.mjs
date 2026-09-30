import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";

import {
  committedSubmissions,
  completeOnboarding,
  publicState,
  requireCheckpoint4Hooks,
  singleAssignmentScript,
  waitForPublicState,
  withLmsApp,
} from "./harness.mjs";

test("J2 files: coding work stays in the homework folder and uploads the required files", async (t) => {
  if (!(await requireCheckpoint4Hooks(t, ["STUDI_E2E_RUNTIME_MODULE", "STUDI_E2E_HOMEWORK_ROOT"]))) return;
  const files = {
    "main.c": "int main(void) { return 0; }\n",
    "stats.c": "double mean(const double *xs, int n) { double s=0; for(int i=0;i<n;i++) s+=xs[i]; return n ? s/n : 0; }\n",
    "stats.h": "double mean(const double *xs, int n);\n",
    "README.md": "# Rainfall calculator\n",
  };
  const writeSteps = Object.entries(files).map(([path, content]) => ({ op: "tool", name: "write", input: { path, content } }));
  const work = [
    ...writeSteps,
    { op: "uploadByName", name: "files", paths: Object.keys(files) },
    { op: "clickByName", name: "Save draft" },
    { op: "tool", name: "assignment_start_review", input: {
      answers: "Four required project files created and uploaded.",
      completedRequirements: Object.keys(files).map((path) => ({ requirement: path, evidence: `${path} is present in the visible upload list.` })),
      summary: "All four required files are visible on the school page.",
    } },
  ];
  await withLmsApp({ scenario: "coding-multifile", script: (school) => singleAssignmentScript(school, [work]) }, async ({ page, school, homeworkRoot }) => {
    await completeOnboarding(page, school.url, "Do it, I'll hand it in");
    await page.getByText("Rainfall calculator: multi-file C project", { exact: true }).click();
    await page.getByRole("region", { name: "Your move" }).getByRole("button", { name: /^(Check and start|Start)$/ }).click();
    await waitForPublicState(page, "getLifecycleState", (state) => state.execution?.phase === "ready_review");
    assert.equal(committedSubmissions(school).length, 0);
    const created = (await readdir(homeworkRoot, { recursive: true })).map((name) => basename(name)).filter((name) => Object.hasOwn(files, name));
    assert.deepEqual(created.sort(), Object.keys(files).sort());
    const settings = await publicState(page, "getProductSettings");
    assert.equal(settings.preferences.homeworkRoot, homeworkRoot);
  });
});
