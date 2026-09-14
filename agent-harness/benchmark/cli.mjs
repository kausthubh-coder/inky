import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { runReplay, writeJson } from "./runner.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  build: { type: "string" }, revision: { type: "string" }, output: { type: "string" },
  "budget-ms": { type: "string", default: "60000" }, "max-tool-calls": { type: "string", default: "120" },
  "lms-module": { type: "string" }, scenario: { type: "string", default: "smoke" }, seed: { type: "string", default: "42" },
  model: { type: "string", default: "gpt-6-astra" }, provider: { type: "string", default: "openai-codex" }, effort: { type: "string", default: "medium" },
  phases: { type: "string", default: "cold" }, show: { type: "boolean", default: false },
} });
if (positionals[0] === "live") {
  if (!values["lms-module"]) throw new Error("live requires --lms-module path/to/server.mjs");
  const { runLive } = await import("./live-runner.mjs");
  const { path, record } = await runLive({ lmsModule: values["lms-module"], buildRoot: values.build, gitSha: values.revision,
    scenarioId: values.scenario, seed: Number(values.seed), model: values.model, provider: values.provider, effort: values.effort,
    budgetMs: Number(values["budget-ms"]), maxToolCalls: Number(values["max-tool-calls"]), phases: values.phases.split(","), show: values.show });
  console.log(JSON.stringify({ path, error: record.error ?? null, phases: record.phases.map(phase => ({ name: phase.name, status: phase.status, scanState: phase.scanState, passed: phase.grade.passed, metrics: phase.metrics })) }));
  process.exitCode = record.phases.length === record.config.phases.length && record.phases.every(phase => phase.grade.passed) ? 0 : 1;
} else if (positionals[0] === "replay") {
  const { path, record } = await runReplay({ buildRoot: values.build, gitSha: values.revision, budgetMs: Number(values["budget-ms"]), maxToolCalls: Number(values["max-tool-calls"]) });
  const phase = record.phases[0];
  console.log(JSON.stringify({ path, status: phase.status, passed: phase.grade.passed, checks: phase.grade.checks.length, failed: phase.grade.checks.filter(item => !item.passed) }));
  process.exitCode = phase.grade.passed ? 0 : 1;
} else if (positionals[0] === "compare") {
  const { compareRuns } = await import("./comparison.mjs");
  const [baseline, candidate] = await Promise.all(positionals.slice(1, 3).map(async path => JSON.parse(await readFile(path, "utf8"))));
  if (!baseline || !candidate) throw new Error("compare requires baseline and candidate result.json paths");
  const comparison = compareRuns(baseline, candidate);
  if (values.output) await writeJson(values.output, comparison);
  console.log(JSON.stringify(comparison, null, 2));
  process.exitCode = comparison.comparable && comparison.candidate.passed ? 0 : 1;
} else throw new Error("Usage: bun run benchmark -- replay [--build dist] | compare baseline.json candidate.json [--output comparison.json]");
