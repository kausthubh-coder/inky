import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { AgentJobHost, type AgentDriver, type BuiltAgentTurn } from "../desktop/agent-system/index.js";
import { FileAgentJobStore } from "./file-store.js";
import { currentGitSha, writeRunRecord, type HarnessRunRecord } from "./run-record.js";

class TraceDriver implements AgentDriver {
  readonly id = "trace-fixture";
  #turn = 0;

  async run(turn: BuiltAgentTurn) {
    this.#turn += 1;
    const userMessage = turn.prompt.split("# Student message\n\n").at(-1)?.trim() ?? "";
    return {
      text: `Full reply ${this.#turn}: ${userMessage}`,
      outcome: "completed" as const,
      usage: { inputTokens: 100 * this.#turn, outputTokens: 20, totalTokens: 100 * this.#turn + 20, costUsd: 0.001 * this.#turn },
      toolCalls: [{ name: "note_search", arguments: { query: userMessage }, result: { matches: [`result-${this.#turn}`] }, durationMs: this.#turn }],
    };
  }
}

export async function runTraceSuite(options: { readonly cwd: string; readonly runsRoot: string }) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const host = await AgentJobHost.create({ driver: new TraceDriver(), store: new FileAgentJobStore(join(options.runsRoot, runId, "state.json")) });
  await host.execute({ command: "send", target: { kind: "home" }, text: "ordinary content alpha" });
  await host.execute({ command: "restart" });
  await host.execute({ command: "send", target: { kind: "home" }, text: "ordinary content beta" });
  const events = host.traceEvents();
  const finishes = events.filter((event) => event.type === "model_finished");
  const tools = events.filter((event) => event.type === "tool_finished");
  const serialized = JSON.stringify(events);
  const assertions = [
    check("full messages and replies survive the trace", serialized.includes("ordinary content alpha") && serialized.includes("Full reply 2: ordinary content beta")),
    check("tool arguments and results are exact", serialized.includes('"query":"ordinary content beta"') && serialized.includes('"result-2"')),
    check("each model finish has timing and usage", finishes.length === 2 && finishes.every((event) => typeof event.payload.totalDurationMs === "number" && event.payload.usage)),
    check("cumulative usage reaches the second turn", finishes.at(-1)?.payload.cumulativeUsage && JSON.stringify(finishes.at(-1)?.payload.cumulativeUsage).includes('"inputTokens":300')),
    check("tool timing is retained", tools.length === 2 && tools.at(-1)?.payload.durationMs === 2),
    check("trace stays ordered across restart", events.every((event, index) => event.sequence === index) && events.some((event) => event.type === "restart")),
  ];
  const record: HarnessRunRecord = {
    schemaVersion: 1,
    runId,
    suite: "trace",
    driver: "trace-fixture",
    gitSha: await currentGitSha(options.cwd),
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    outcome: assertions.every((item) => item.passed) ? "passed" : "failed",
    state: host.snapshot(),
    events,
    assertions,
  };
  return { record, path: await writeRunRecord(options.runsRoot, record) };
}

function check(name: string, value: unknown) {
  return { name, passed: value === true, detail: value === true ? "passed" : "condition was false" };
}
