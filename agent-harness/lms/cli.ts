import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { startLms } from "./server.js";
import { importPrivateAssets } from "./assets.js";
import { createScenario, SCENARIO_IDS } from "./scenarios.js";
import { exportTelemetry } from "./telemetry.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: "string", default: "semester" },
    seed: { type: "string", default: "42" },
    run: { type: "string" },
    port: { type: "string", default: "0" },
    manifest: { type: "string" },
    library: { type: "string" },
  },
});
const command = positionals[0] ?? "start";
if (command === "list")
  console.log(JSON.stringify({ scenarios: SCENARIO_IDS }));
else if (command === "validate") {
  const state = createScenario(values.scenario, Number(values.seed));
  console.log(
    JSON.stringify({
      valid: true,
      scenarioId: state.scenarioId,
      courses: state.courses.length,
      activities: state.activities.length,
      assets: state.assets.length,
    }),
  );
} else if (command === "import") {
  if (!values.manifest || !values.library)
    throw new Error(
      "Import requires --manifest and --library outside the repository.",
    );
  const library = resolve(values.library),
    project = resolve(".");
  if (
    library === project ||
    library.startsWith(project + "\\") ||
    library.startsWith(project + "/")
  )
    throw new Error("Private imports must be outside the repository.");
  const pack = await importPrivateAssets(resolve(values.manifest), library);
  console.log(
    JSON.stringify({ imported: pack.assets.length, library, private: true }),
  );
} else if (command === "start" || command === "resume") {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port");
  if (command === "resume" && !values.run)
    throw new Error("Resume requires --run <directory>");
  const runDirectory = resolve(
    values.run ?? join(".studi-lms", "runs", randomUUID()),
  );
  const server = await startLms({
    scenarioId: values.scenario,
    seed: Number(values.seed),
    runDirectory,
    port,
    resume: command === "resume",
    ...(values.library ? { privateLibrary: resolve(values.library) } : {}),
  });
  console.log(
    JSON.stringify({
      type: "ready",
      runId: server.runId,
      scenarioId: server.scenarioId,
      url: server.url,
      origins: server.origins,
      runDirectory,
      statePath: server.statePath,
    }),
  );
  const input = createInterface({ input: process.stdin });
  let commands = Promise.resolve();
  input.on("line", (line) => {
    commands = commands.then(async () => {
      try {
        const action = JSON.parse(line);
        if (action.command === "inspect")
          console.log(
            JSON.stringify({ type: "inspection", ...server.inspect() }),
          );
        else if (action.command === "export-telemetry") {
          const snapshot = server.inspect();
          const result = await exportTelemetry(
            {
              runId: server.runId,
              scenarioId: server.scenarioId,
              scenarioVersion: snapshot.state.scenarioVersion,
              events: snapshot.effects,
            },
            {
              developmentProjectToken:
                process.env.POSTHOG_LMS_PROJECT_TOKEN ?? "",
              ...(process.env.POSTHOG_LMS_HOST
                ? { host: process.env.POSTHOG_LMS_HOST }
                : {}),
            },
          );
          console.log(
            JSON.stringify({ type: "telemetry-exported", ...result }),
          );
        } else if (action.command === "advance") {
          server.advance(String(action.event));
          console.log(
            JSON.stringify({ type: "advanced", event: action.event }),
          );
        } else if (action.command === "stop") {
          await server.close();
          input.close();
        } else throw new Error("Unknown command");
      } catch (error) {
        console.log(
          JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Command failed",
          }),
        );
      }
    });
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void server.close().then(() => {
        input.close();
        process.exit(0);
      });
    });
} else if (command === "receipt") {
  if (!values.run) throw new Error("Receipt requires --run");
  console.log(
    await readFile(join(resolve(values.run), "receipt.json"), "utf8"),
  );
} else
  throw new Error(
    "Usage: lms start|resume|validate|list|import|receipt [--scenario name] [--run directory]",
  );
