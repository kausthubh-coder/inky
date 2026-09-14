import { aggregateMetrics } from "./metrics.mjs";

const CLASSES = new Set(["controlled-production-replay", "live-production-runtime"]);
const FIXTURE_FIELDS = ["scenarioId", "version", "seed", "clock", "contentHash"];
const CONFIG_FIELDS = ["model", "provider", "effort", "budgetMs", "maxToolCalls", "phases"];
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const phaseNamesValid = names => Array.isArray(names) && names.length > 0
  && names.every(nonempty) && new Set(names).size === names.length;

// Compare paired scan runs with identical fixture/configuration. Revisions may
// differ. config.phases is the ordered list of required, unique phase names.
// Mismatches return reasons and no deltas. Failed runs stay visible and measured;
// negative deltas are merely differences, not a quality or efficiency verdict.
export function compareRuns(baseline, candidate) {
  const reasons = [...validateRecord(baseline, "baseline"), ...validateRecord(candidate, "candidate")];
  for (const field of FIXTURE_FIELDS) {
    if (!equal(baseline?.fixture?.[field], candidate?.fixture?.[field])) reasons.push(`fixture.${field} differs`);
  }
  for (const field of CONFIG_FIELDS) {
    if (!equal(baseline?.config?.[field], candidate?.config?.[field])) reasons.push(`config.${field} differs`);
  }
  if (baseline?.evidenceClass !== candidate?.evidenceClass) reasons.push("evidenceClass differs");
  const before = summarize(baseline), after = summarize(candidate);
  return {
    comparable: reasons.length === 0,
    reasons,
    baseline: before,
    candidate: after,
    deltas: reasons.length ? null : metricDeltas(before.metrics, after.metrics),
  };
}

function validateRecord(record, label) {
  const issues = [];
  const require = (condition, field) => { if (!condition) issues.push(`${label}: invalid ${field}`); };
  require(record?.schemaVersion === 1, "schemaVersion");
  require(nonempty(record?.runId), "runId");
  require(CLASSES.has(record?.evidenceClass), "evidenceClass (controlled comparison required)");
  const fixture = record?.fixture;
  require(nonempty(fixture?.scenarioId), "fixture.scenarioId");
  require(nonempty(fixture?.version) || positiveInteger(fixture?.version), "fixture.version");
  require(Number.isSafeInteger(fixture?.seed), "fixture.seed");
  require(nonempty(fixture?.clock) && Number.isFinite(Date.parse(fixture.clock)), "fixture.clock");
  require(nonempty(fixture?.contentHash), "fixture.contentHash");
  for (const field of ["model", "provider", "effort"]) {
    require(nonempty(record?.config?.[field])
      || (record?.evidenceClass === "controlled-production-replay" && record?.config?.[field] === null), `config.${field}`);
  }
  require(positiveInteger(record?.config?.budgetMs), "config.budgetMs");
  require(positiveInteger(record?.config?.maxToolCalls), "config.maxToolCalls");
  require(phaseNamesValid(record?.config?.phases), "config.phases");
  require(Array.isArray(record?.phases), "phases");
  for (const field of ["gitSha", "buildTreeSha256", "harnessTreeSha256"]) {
    require(nonempty(record?.revision?.[field]), `revision.${field}`);
  }
  // Unrecognized options may change a run's behavior. Refuse to silently compare
  // them until the schema explicitly defines which differences are permitted.
  for (const field of Object.keys(record?.config ?? {})) {
    require(CONFIG_FIELDS.includes(field), `config.${field} (unsupported option)`);
  }
  for (const field of Object.keys(fixture ?? {})) {
    require(FIXTURE_FIELDS.includes(field), `fixture.${field} (unsupported option)`);
  }
  return issues;
}

function summarize(record) {
  const phases = Array.isArray(record?.phases) ? record.phases : [];
  const issues = validateRecord(record, "run");
  if (!phases.length) issues.push("No phases were attempted");
  if (!equal(phases.map(phase => phase?.name), record?.config?.phases)) {
    issues.push("Actual phases do not match the required names and order");
  }
  for (const [index, phase] of phases.entries()) {
    const label = nonempty(phase?.name) ? phase.name : `phase ${index + 1}`;
    if (!["completed", "succeeded"].includes(phase?.status)) issues.push(`${label}: not completed`);
    if (phase?.scanState !== "succeeded") issues.push(`${label}: scan coverage incomplete`);
    if (phase?.grade?.passed !== true || !Array.isArray(phase?.grade?.checks)
      || !phase.grade.checks.length || phase.grade.checks.some(check => check?.passed !== true)) {
      issues.push(`${label}: independent checks did not pass`);
    }
  }
  const metrics = aggregateMetrics(phases);
  if (metrics.durationMs !== null && metrics.durationMs > record?.config?.budgetMs) issues.push("Run exceeded its wall-time budget");
  if (metrics.toolCalls !== null && metrics.toolCalls > record?.config?.maxToolCalls) issues.push("Run exceeded its tool-call budget");
  return { runId: record?.runId ?? null, revision: record?.revision ?? null,
    passed: issues.length === 0, issues, metrics, phases };
}

function equal(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, index) => value === b[index])
    : a === b;
}

function metricDeltas(before, after) {
  const difference = (a, b) => a === null || b === null ? null : b - a;
  return {
    durationMs: difference(before.durationMs, after.durationMs),
    toolCalls: difference(before.toolCalls, after.toolCalls),
    modelCalls: difference(before.modelCalls, after.modelCalls),
    usage: before.usage === null || after.usage === null ? null
      : Object.fromEntries(Object.keys(before.usage).map(field => [field, difference(before.usage[field], after.usage[field])])),
  };
}
