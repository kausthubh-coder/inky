import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMetrics } from "../../agent-harness/benchmark/metrics.mjs";
import { compareRuns } from "../../agent-harness/benchmark/comparison.mjs";

const phase = (name) => ({
  name,
  status: "completed",
  scanState: "succeeded",
  metrics: {
    durationMs: 50.5,
    toolCalls: 4,
    modelCalls: 2,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 0 },
  },
  grade: { passed: true, checks: [{ name: "independent facts", passed: true }] },
});
const run = () => ({
  schemaVersion: 1,
  runId: "test-run",
  evidenceClass: "live-production-runtime",
  fixture: {
    scenarioId: "school",
    version: 1,
    seed: 0,
    clock: "2026-09-14T12:00:00Z",
    contentHash: "content-a",
  },
  config: {
    model: "test-model",
    provider: "test-provider",
    effort: "medium",
    budgetMs: 1000,
    maxToolCalls: 20,
    phases: ["cold", "unchanged"],
  },
  revision: { gitSha: "revision-a", buildTreeSha256: "build-a", harnessTreeSha256: "harness-a" },
  phases: [phase("cold"), phase("unchanged")],
});

test("aggregate includes every phase and failure without changing its input", () => {
  const phases = run().phases;
  phases[1].status = "timed_out";
  const original = structuredClone(phases);
  assert.deepEqual(aggregateMetrics(phases), {
    durationMs: 101,
    toolCalls: 8,
    modelCalls: 4,
    usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 0 },
  });
  assert.deepEqual(phases, original);
});

test("empty and missing measurements stay unknown, including genuine partial usage", () => {
  assert.deepEqual(aggregateMetrics([]), {
    durationMs: null,
    toolCalls: null,
    modelCalls: null,
    usage: null,
  });
  assert.throws(() => aggregateMetrics(null), TypeError);
  const phases = run().phases;
  phases[1].metrics.usage = null;
  delete phases[1].metrics.modelCalls;
  assert.equal(aggregateMetrics(phases).usage, null);
  assert.equal(aggregateMetrics(phases).modelCalls, null);
  assert.equal(aggregateMetrics(phases).toolCalls, 8);
  phases[1] = phase("unchanged");
  delete phases[1].metrics.usage.cacheReadTokens;
  assert.deepEqual(aggregateMetrics(phases).usage, {
    inputTokens: 20,
    outputTokens: 10,
    cacheReadTokens: null,
    cacheWriteTokens: 0,
  });
});

test("invalid numbers cannot become zero or corrupt totals", () => {
  for (const invalid of [undefined, null, NaN, Infinity, -1, "4", 0.5, Number.MAX_SAFE_INTEGER]) {
    const phases = run().phases;
    phases[1].metrics.toolCalls = invalid;
    assert.equal(aggregateMetrics(phases).toolCalls, null, String(invalid));
  }
  const phases = run().phases;
  phases[0].metrics.durationMs = Number.MAX_VALUE;
  phases[1].metrics.durationMs = Number.MAX_VALUE;
  assert.equal(aggregateMetrics(phases).durationMs, null);
  assert.deepEqual(aggregateMetrics([{ metrics: { durationMs: 0, toolCalls: 0, modelCalls: 0 } }]), {
    durationMs: 0,
    toolCalls: 0,
    modelCalls: 0,
    usage: null,
  });
});

test("paired comparison permits candidate revision changes and returns signed deltas", () => {
  const before = run(),
    after = run();
  after.runId = "candidate";
  after.revision.gitSha = "revision-b";
  after.phases[1].metrics.durationMs = 20.5;
  after.phases[1].metrics.toolCalls = 2;
  after.phases[1].metrics.usage.inputTokens = 7;
  const result = compareRuns(before, after);
  assert.equal(result.comparable, true);
  assert.equal(result.baseline.passed, true);
  assert.equal(result.candidate.passed, true);
  assert.deepEqual(result.deltas, {
    durationMs: -30,
    toolCalls: -2,
    modelCalls: 0,
    usage: { inputTokens: -3, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  });
  assert.equal(result.candidate.revision.gitSha, "revision-b");
});

test("each changed fixture or configuration field refuses comparison", () => {
  for (const group of ["fixture", "config"]) {
    for (const field of Object.keys(run()[group])) {
      const after = run(),
        previous = after[group][field];
      after[group][field] = Array.isArray(previous)
        ? [...previous, "resumed"]
        : typeof previous === "number"
          ? previous + 1
          : `${previous}-changed`;
      const result = compareRuns(run(), after);
      assert.equal(result.comparable, false, `${group}.${field}`);
      assert.equal(result.deltas, null);
      assert.ok(result.reasons.includes(`${group}.${field} differs`));
    }
  }
});

test("changing the benchmark implementation cannot masquerade as a scanner improvement", () => {
  const candidate = run();
  candidate.revision.harnessTreeSha256 = "different-grader";
  const comparison = compareRuns(run(), candidate);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.deltas, null);
});

test("missing equal metadata, unknown settings and exploratory evidence cannot silently compare", () => {
  for (const mutate of [
    (r) => delete r.fixture.contentHash,
    (r) => delete r.config.effort,
    (r) => {
      r.config.viewport = { width: 1200 };
    },
    (r) => {
      r.evidenceClass = "external-codex-exploratory";
    },
    (r) => {
      r.schemaVersion = 2;
    },
    (r) => delete r.revision.buildTreeSha256,
  ]) {
    const before = run(),
      after = run();
    mutate(before);
    mutate(after);
    assert.equal(compareRuns(before, after).comparable, false);
  }
  const after = run();
  after.evidenceClass = "controlled-production-replay";
  assert.ok(compareRuns(run(), after).reasons.includes("evidenceClass differs"));
  assert.equal(compareRuns(null, {}).comparable, false);
});

test("failed and incomplete attempts remain measured and cannot pass via a forged summary", () => {
  for (const mutate of [
    (r) => {
      r.phases = [];
    },
    (r) => {
      r.phases.pop();
    },
    (r) => {
      r.phases.reverse();
    },
    (r) => {
      r.phases[1].name = "cold";
    },
    (r) => {
      r.phases[1].status = "timed_out";
    },
    (r) => {
      r.phases[1].scanState = "partial";
    },
    (r) => {
      r.phases[1].grade.passed = false;
    },
    (r) => {
      r.phases[1].grade.checks[0].passed = false;
    },
    (r) => {
      r.phases[1].grade.checks = [];
    },
    (r) => {
      r.phases[1].grade.checks[0].passed = "true";
    },
    (r) => {
      r.phases[1].metrics.toolCalls = 18;
    },
    (r) => {
      r.phases[1].metrics.durationMs = 999;
    },
  ]) {
    const candidate = run();
    mutate(candidate);
    const result = compareRuns(run(), candidate);
    assert.equal(result.comparable, true);
    assert.equal(result.candidate.passed, false, JSON.stringify(candidate));
    assert.deepEqual(result.candidate.phases, candidate.phases);
    assert.deepEqual(result.candidate.metrics, aggregateMetrics(candidate.phases));
  }
});

test("usage deltas preserve unknowns without discarding measured call counts", () => {
  const candidate = run();
  candidate.phases[1].metrics.usage = null;
  let result = compareRuns(run(), candidate);
  assert.equal(result.comparable, true);
  assert.equal(result.deltas.usage, null);
  assert.equal(result.deltas.toolCalls, 0);
  candidate.phases[1] = phase("unchanged");
  delete candidate.phases[1].metrics.usage.outputTokens;
  result = compareRuns(run(), candidate);
  assert.equal(result.deltas.usage.outputTokens, null);
  assert.equal(result.deltas.usage.inputTokens, 0);
});

test("replay can explicitly have no model; required phases cannot be empty or duplicated", () => {
  const replay = run();
  replay.evidenceClass = "controlled-production-replay";
  replay.config.model = replay.config.provider = replay.config.effort = null;
  assert.equal(compareRuns(replay, structuredClone(replay)).comparable, true);
  for (const names of [[], ["cold", "cold"], [""]]) {
    replay.config.phases = names;
    const result = compareRuns(replay, structuredClone(replay));
    assert.equal(result.comparable, false);
    assert.equal(result.baseline.passed, false);
  }
});
