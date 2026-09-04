import { resolve } from "node:path";

import { AgentJobHost } from "../desktop/agent-system/index.js";
import { ScriptedAgentDriver } from "./drivers/scripted.js";
import { FileAgentJobStore } from "./file-store.js";
import { runFoundationSuite } from "./foundation-suite.js";
import { runFilesSuite } from "./files-suite.js";
import { runRoutingSuite } from "./routing-suite.js";
import { runTraceSuite } from "./trace-suite.js";
import { runStdioSession } from "./stdio-session.js";

const cwd = process.cwd();
const args = process.argv.slice(2);
const mode = args[0];
const runsRoot = resolve(cwd, process.env.STUDI_HARNESS_RUNS_DIR ?? ".studi-harness/runs");

if (mode === "run") {
  const suite = flag("--suite") ?? "foundation";
  const driver = flag("--driver") ?? "scripted";
  if (suite !== "foundation" && suite !== "routing" && suite !== "trace" && suite !== "files") fail(`Unknown suite: ${suite}`);
  if (driver !== "scripted") fail(`Driver ${driver} is not available yet`);
  const result = suite === "foundation"
    ? await runFoundationSuite({ cwd, runsRoot })
    : suite === "routing"
      ? await runRoutingSuite({ cwd, runsRoot })
      : suite === "trace"
        ? await runTraceSuite({ cwd, runsRoot })
        : await runFilesSuite({ cwd, runsRoot });
  process.stdout.write(`${JSON.stringify({ ...result.record, runRecordPath: result.path }, null, args.includes("--json") ? 0 : 2)}\n`);
  process.exitCode = result.record.outcome === "passed" ? 0 : 1;
} else if (mode === "interact") {
  const fixture = flag("--fixture") ?? "assignment-basic";
  const driver = flag("--driver") ?? "scripted";
  if (driver !== "scripted") fail(`Driver ${driver} is not available yet`);
  const store = new FileAgentJobStore(resolve(runsRoot, `interactive-${safeName(fixture)}.json`));
  const host = await AgentJobHost.create({ driver: new ScriptedAgentDriver(), store });
  await runStdioSession(host);
} else {
  fail("Usage: bun run agent:harness -- run --suite foundation|routing|trace|files --driver scripted --json | interact --fixture assignment-basic --driver scripted --jsonl");
}

function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function safeName(value: string): string {
  if (!/^[a-z0-9-]+$/i.test(value)) fail(`Invalid fixture name: ${value}`);
  return value;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
