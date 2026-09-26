import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHOOL_WRITES = new Set([
  "draft_saved",
  "submitted",
  "submission_requested",
  "submission_committed",
  "submission_replayed",
  "lesson_completed",
]);
const known = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const normalized = (s) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const ratio = (n, d) => (d ? n / d : 0);
export async function loadExpected(scenario) {
  if (!/^[a-z0-9-]+$/.test(scenario)) throw new Error("Invalid scenario");
  const data = JSON.parse(
    await readFile(
      new URL(`./expected/${scenario}.json`, import.meta.url),
      "utf8",
    ),
  );
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.assignments) ||
    !data.assignments.length
  )
    throw new Error("Invalid expected scan inventory");
  return data;
}

// Only authored source URLs from this run identify a row. Titles alone cannot
// accidentally match a different class, an external page, or an invented row.
export function evaluateScan({
  expected,
  observation,
  effects,
  origins,
  trace = [],
  previous = null,
  slo = null,
}) {
  const actual = observation.assignments ?? [],
    courses = observation.courses ?? [];
  function identity(row) {
    try {
      const url = new URL(row.sourceTarget ?? row.href),
        surface = Object.keys(origins).find(
          (key) => origins[key] === url.origin,
        );
      return surface ? `${surface}:${url.pathname}${url.search}` : null;
    } catch {
      return null;
    }
  }
  const key = (row) => identity(row);
  const matches = expected.assignments.map((row) =>
    actual.filter((a) => [row.href, ...(row.aliases ?? [])].includes(key(a))),
  );
  const recognized = actual.filter((a) =>
    expected.assignments.some((e) =>
      [e.href, ...(e.aliases ?? [])].includes(key(a)),
    ),
  );
  const matched = matches.filter((rows) => rows.length).length;
  let correctDates = 0,
    inventedDates = 0,
    correctTitles = 0,
    correctCourses = 0,
    wrongStatuses = [],
    duplicates = 0;
  expected.assignments.forEach((row, i) => {
    const found = matches[i],
      first = found[0];
    duplicates += Math.max(0, found.length - 1);
    if (!first) return;
    if (normalized(first.title) === normalized(row.title)) correctTitles++;
    const course = courses.find((c) => c.courseId === first.courseId);
    if (
      normalized(first.course ?? course?.label).includes(normalized(row.course))
    )
      correctCourses++;
    // Exact instant equivalence allows Z vs an explicit local offset. Date-only
    // sources must remain null; guessing midnight is an invented deadline.
    if (
      row.dueAt === null
        ? !first.dueAt
        : known(Date.parse(first.dueAt)) &&
          Date.parse(first.dueAt) === Date.parse(row.dueAt)
    )
      correctDates++;
    if (row.dueAt === null)
      inventedDates += found.filter((a) => a.dueAt).length;
    // Finished work must read as finished, not as new or overdue homework.
    if (row.status && first.schoolStatus?.state !== row.status)
      wrongStatuses.push(row.title);
  });
  inventedDates += actual.filter(
    (a) => a.dueAt && !recognized.includes(a),
  ).length;
  const generations = trace
    .filter((e) => e.diagnostic?.kind === "generation")
    .map((e) => e.diagnostic.payload);
  const inputs = generations.map((g) =>
      [
        g.$ai_input_tokens,
        g.$ai_cache_read_input_tokens,
        g.$ai_cache_creation_input_tokens,
      ].every(known)
        ? g.$ai_input_tokens +
          g.$ai_cache_read_input_tokens +
          g.$ai_cache_creation_input_tokens
        : null,
    ),
    outputs = generations.map((g) => g.$ai_output_tokens);
  const usage = observation.metrics?.usage;
  const complete =
    observation.status === "completed" && observation.scanState === "succeeded";
  const usageFields = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ];
  const tokens = known(observation.metrics?.tokenEstimate?.totalTokens)
    ? observation.metrics.tokenEstimate.totalTokens
    : usage && usageFields.every((field) => known(usage[field]))
      ? usageFields.reduce((sum, field) => sum + usage[field], 0)
      : null;
  const measuredGenerations =
    inputs.length > 0 && inputs.every(known) && outputs.every(known);
  const promptSizes = trace
    .filter(
      (e) =>
        e.diagnostic?.kind === "provider_request" &&
        e.diagnostic.payload?.request,
    )
    .map((e) => JSON.stringify(e.diagnostic.payload.request).length);
  const metrics = {
    recall: ratio(matched, expected.assignments.length),
    precision: ratio(matched, actual.length),
    dueDateExact: ratio(correctDates, expected.assignments.length),
    titleAccuracy: ratio(correctTitles, expected.assignments.length),
    courseAccuracy: ratio(correctCourses, expected.assignments.length),
    duplicates,
    wrongStatuses: wrongStatuses.length,
    junkRows: actual.length - recognized.length,
    inventedDates,
    schoolWrites: Array.isArray(effects)
      ? effects.filter((e) => SCHOOL_WRITES.has(e.type)).length
      : null,
    minutes: known(observation.metrics?.durationMs)
      ? observation.metrics.durationMs / 60000
      : null,
    toolCalls: known(observation.metrics?.toolCalls)
      ? observation.metrics.toolCalls
      : null,
    tokens,
    tokenEstimate: observation.metrics?.tokenEstimate ?? null,
    completedGenerationTokens: measuredGenerations
      ? inputs.reduce((a, b) => a + b, 0) + outputs.reduce((a, b) => a + b, 0)
      : null,
    peakPromptTokens:
      inputs.length && inputs.every(known) ? Math.max(...inputs) : null,
    peakPromptChars: promptSizes.length ? Math.max(...promptSizes) : null,
  };
  const checks = [
    { name: "scan completes", passed: complete },
    { name: "recall", passed: metrics.recall >= 0.98 },
    { name: "precision", passed: metrics.precision >= 0.98 },
    { name: "due-date exact", passed: metrics.dueDateExact >= 0.98 },
    {
      name: "titles and courses",
      passed: metrics.titleAccuracy >= 0.98 && metrics.courseAccuracy >= 0.98,
    },
    { name: "submitted and graded status", passed: wrongStatuses.length === 0 },
    {
      name: "zero duplicates, junk and invented dates",
      passed: duplicates === 0 && metrics.junkRows === 0 && inventedDates === 0,
    },
    { name: "zero school writes", passed: metrics.schoolWrites === 0 },
    {
      name: "no out-of-school requests",
      passed: (observation.policyViolations ?? []).length === 0,
    },
  ];
  if (slo)
    for (const [field, max] of Object.entries(slo))
      checks.push({
        name: `${field} <= ${max}`,
        passed: known(metrics[field]) && metrics[field] <= max,
      });
  const regressions = [];
  if (previous)
    for (const [field, value] of Object.entries(metrics)) {
      const before = previous.metrics?.[field];
      if (!known(before) || !known(value)) continue;
      const higherBetter = [
        "recall",
        "precision",
        "dueDateExact",
        "titleAccuracy",
        "courseAccuracy",
      ].includes(field);
      if (
        higherBetter
          ? before > 0 && value <= before * 0.75
          : value > before && (before === 0 || value >= before * 1.25)
      )
        regressions.push({ field, before, after: value });
    }
  return {
    schemaVersion: 1,
    scenarioId: expected.scenarioId,
    passed: checks.every((c) => c.passed) && regressions.length === 0,
    checks,
    metrics,
    regressions,
    expected: expected.assignments.length,
    discovered: matched,
    missing: expected.assignments
      .filter((_, i) => !matches[i].length)
      .map((a) => a.title),
    junk: actual
      .filter((a) => !recognized.includes(a))
      .map((a) => ({ title: a.title, href: a.sourceTarget ?? a.href })),
    usageNote: observation.metrics?.tokenEstimate?.estimated
      ? "Total tokens include an estimated in-flight provider call; completed-call usage is measured. An incomplete run fails the gate."
      : "Usage from completed provider diagnostics; missing metrics fail the gate.",
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [resultPath, previousPath] = process.argv.slice(2);
  if (!resultPath)
    throw new Error(
      "Usage: node agent-harness/lms/evaluate-scan.mjs <result.json> [previous-evaluation.json]",
    );
  const record = JSON.parse(await readFile(resultPath, "utf8")),
    root = dirname(resolve(resultPath));
  const expected = await loadExpected(record.fixture.scenarioId);
  const inspection = JSON.parse(
    await readFile(join(root, "final-school.json"), "utf8"),
  );
  const receipt = JSON.parse(
    await readFile(join(root, "school/receipt.json"), "utf8"),
  );
  let trace = [];
  try {
    trace = (await readFile(join(root, "trace.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lastPath = join(
    dirname(root),
    `last-scan-${record.fixture.scenarioId}.json`,
  );
  let previous = null;
  try {
    previous = JSON.parse(await readFile(previousPath ?? lastPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" || previousPath) throw error;
  }
  if (previous && previous.scenarioId !== expected.scenarioId)
    throw new Error("Previous run must use the same scenario");
  const comparisonKey = JSON.stringify({
    fixture: record.fixture,
    config: record.config,
    expected,
  });
  const comparisonNote =
    previous && previous.comparisonKey !== comparisonKey
      ? "Previous run used different fixture/configuration; no regression verdict."
      : null;
  if (comparisonNote) previous = null;
  const targets = JSON.parse(
    await readFile(new URL("../benchmark/slo.json", import.meta.url), "utf8"),
  );
  const result = evaluateScan({
    expected,
    observation: record.phases[0],
    effects: inspection.effects,
    origins: receipt.origins,
    trace,
    previous,
    slo: targets.scenarios[expected.scenarioId],
  });
  result.comparisonKey = comparisonKey;
  result.comparisonNote = comparisonNote;
  await writeFile(
    join(root, "scan-evaluation.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(lastPath, JSON.stringify(result, null, 2) + "\n");
  const { comparisonKey: _, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
