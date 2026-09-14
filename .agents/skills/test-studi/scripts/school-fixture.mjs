import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export async function schoolFixture({
  port = 0,
  runDirectory,
  resume = false,
} = {}) {
  const entry = join(root, ".studi-lms", "build", "server.mjs");
  if (!existsSync(entry)) {
    const result = spawnSync("bun", ["run", "build:lms"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0)
      throw new Error(`Shared school build failed: ${result.stderr}`);
  }
  const { startLms } = await import(pathToFileURL(entry).href);
  return startLms({
    scenarioId: "smoke",
    port,
    resume,
    runDirectory:
      runDirectory ?? (await mkdtemp(join(tmpdir(), "studi-qa-school-"))),
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { port: { type: "string", default: "0" } },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid port");
  const server = await schoolFixture({ port });
  console.log(
    JSON.stringify({
      schoolUrl: server.url,
      processId: process.pid,
      simulated: true,
    }),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void server.close().then(() => process.exit(0));
    });
}
