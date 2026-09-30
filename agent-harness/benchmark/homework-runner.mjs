// Homework benchmark: the real app and model do every assignment in a fake school, then the
// operator grader checks each result. Needs `bun run build`, `bun run build:lms` and the QA ChatGPT cache.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./runner.mjs";
import { allAssignmentsScript, completeOnboarding, publicState, withLmsApp } from "../../tests/e2e/harness.mjs";
import { gradeHomework } from "../lms/grade-homework.mjs";
import { parseFaults } from "./faults.mjs";

const RULES = { attempt: "Do it, I'll hand it in", submit: "Do it and hand it in" };
const SETTLED = new Set(["ready_review", "submitted", "needs_user", "failed", "preserved"]);
const FINAL = new Set(["submitted", "needs_user", "failed", "preserved"]);
const REVIEW_WINDOW_MS = 5_000;

export async function runHomework({ scenario = "homework-mix", rule = "attempt", perAssignmentMs = 600_000, only, faults = [] } = {}) {
  if (!RULES[rule]) throw new Error(`Rule must be one of ${Object.keys(RULES).join(", ")}`);
  const revision = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).stdout.trim();
  const startedAt = new Date().toISOString();
  const runs = [];
  let usage = { modelCalls: 0, cost: 0 }, inspection;
  await withLmsApp({ scenario, live: true, reviewWindowMs: REVIEW_WINDOW_MS, script: allAssignmentsScript, faults: parseFaults(faults) }, async ({ page, school, profileRoot }) => {
    await completeOnboarding(page, school.url, RULES[rule]);
    const activities = school.inspect().state.activities.filter(activity => !only || only.includes(activity.id));
    for (const activity of activities) {
      const task = (await publicState(page, "getLibraryState")).tasks.find(item => item.assignment.title === activity.title);
      const run = { activityId: activity.id, title: activity.title, started: false, phase: null, needs: null, error: null, minutes: 0 };
      runs.push(run);
      if (!task) { run.error = "Not found in the week"; continue; }
      const began = Date.now();
      try {
        await publicState(page, "startAssignment", { taskId: task.task.taskId });
        run.started = true;
      } catch (error) {
        run.error = String(error.message ?? error).replace(/^Error invoking remote method '[^']+': /, "");
        continue;
      }
      const settle = async (done, limit) => {
        let current;
        while (Date.now() - began < limit) {
          current = (await publicState(page, "getLibraryState")).tasks.find(item => item.task.taskId === task.task.taskId);
          if (done(current)) break;
          await page.waitForTimeout(1_000);
        }
        return current;
      };
      let current = await settle(item => SETTLED.has(item?.execution?.phase), perAssignmentMs);
      // Under "Do it and hand it in", review ends with Dot handing it in by itself,
      // unless it has doubts: then it waits for the student, which is already the end.
      if (rule === "submit" && current?.execution?.phase === "ready_review" && !current.execution.doubts?.length) {
        current = await settle(item => FINAL.has(item?.execution?.phase) || Boolean(item?.execution?.doubts?.length), perAssignmentMs + 180_000);
      }
      run.minutes = +((Date.now() - began) / 60_000).toFixed(1);
      run.phase = current?.execution?.phase ?? current?.task.state ?? null;
      run.needs = current?.execution?.needs ?? null;
      run.error = current?.execution?.lastError ?? null;
      run.doubts = current?.execution?.doubts?.length ?? 0;
      if (!SETTLED.has(run.phase ?? "")) run.error = run.error ?? "Timed out";
      // Free the school page for the next assignment. The saved draft stays on the school site.
      if (["working", "needs_user", "ready_review", "submitting"].includes(current?.execution?.phase)) {
        await publicState(page, "cancelAssignment", { taskId: task.task.taskId }).catch(() => undefined);
      }
    }
    inspection = school.inspect();
    usage = await sessionUsage(join(profileRoot, "studi-data", "pi"));
  });
  // Dot never hands in by rule while it has doubts; holding that work for the student is the right call.
  const grades = runs.map(run => ({ ...run, ...gradeHomework(inspection, run.activityId, { mayHandIn: rule === "submit" && !run.doubts }) }));
  const doable = grades.filter(grade => grade.doable);
  const scorecard = {
    kind: "homework", scenario, rule, faults, revision, startedAt,
    summary: {
      correct: `${grades.filter(grade => grade.correct).length} of ${grades.length}`,
      handInRight: `${grades.filter(grade => grade.handInRight).length} of ${grades.length}`,
      wrongHandIns: grades.filter(grade => !grade.handInRight && grade.handedIn > 0).length,
      askedStudent: grades.filter(grade => grade.phase === "needs_user").length,
      stuck: grades.filter(grade => grade.phase === "failed" || grade.error === "Timed out").length,
      minutes: +grades.reduce((sum, grade) => sum + grade.minutes, 0).toFixed(1),
      doableMinutes: +doable.reduce((sum, grade) => sum + grade.minutes, 0).toFixed(1),
      modelCalls: usage.modelCalls,
      cost: +usage.cost.toFixed(2),
    },
    assignments: grades,
  };
  const dir = join(ROOT, ".studi-harness", "scorecards");
  await mkdir(dir, { recursive: true });
  const name = `homework-${scenario}-${rule}${faults.length ? "-faults" : ""}-`;
  const previous = await latestScorecard(dir, name);
  const path = join(dir, `${name}${revision}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(scorecard, null, 2));
  return { path, scorecard, previous };
}

async function sessionUsage(dir) {
  const total = { modelCalls: 0, cost: 0 };
  const files = await readdir(dir, { recursive: true }).catch(() => []);
  for (const name of files.filter(file => file.endsWith(".jsonl"))) {
    for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      const message = entry.message ?? entry;
      if (message.role !== "assistant" || !message.usage) continue;
      total.modelCalls += 1;
      total.cost += message.usage.cost?.total ?? 0;
    }
  }
  return total;
}

async function latestScorecard(dir, prefix) {
  const names = (await readdir(dir).catch(() => [])).filter(name => name.startsWith(prefix)).sort();
  return names.length ? JSON.parse(await readFile(join(dir, names.at(-1)), "utf8")) : null;
}

export function formatScorecard({ scorecard, previous }) {
  const rows = [["", "this build", "last run"]];
  for (const [key, label] of [["correct", "Work correct"], ["handInRight", "Handed in right"], ["wrongHandIns", "Wrong hand-ins"], ["askedStudent", "Asked the student"], ["stuck", "Stuck"], ["minutes", "Minutes"], ["modelCalls", "Model calls"], ["cost", "Cost ($)"]]) {
    rows.push([label, String(scorecard.summary[key]), previous ? String(previous.summary[key]) : "—"]);
  }
  const lines = rows.map(row => row.map((cell, i) => cell.padEnd([20, 14, 12][i])).join(""));
  const detail = scorecard.assignments.map(grade => `  ${grade.correct ? "✓" : "✗"} ${grade.title.padEnd(44)} ${String(grade.phase ?? "not started").padEnd(13)} ${grade.detail}${grade.error ? ` · ${grade.error}` : ""}`);
  return [`Homework scorecard · ${scorecard.scenario} · rule ${scorecard.rule}${scorecard.faults.length ? ` · faults ${scorecard.faults.join(", ")}` : ""} · ${scorecard.revision}`, ...lines, "", ...detail].join("\n");
}
