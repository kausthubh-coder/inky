import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, basename } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { createScenario } from "./scenarios.js";
import { startLms } from "./server.js";
const schema = z.object({
  school: z.object({ label: z.string(), entryUrl: z.string() }),
  courses: z.array(z.object({ id: z.string(), title: z.string() })),
  assignments: z.array(
    z.object({
      id: z.string(),
      courseId: z.string(),
      title: z.string(),
      dueAt: z.string(),
    }),
  ),
});
const fixture = schema.parse(parse(await readFile(process.argv[2]!, "utf8")));
const state = createScenario("smoke"),
  template = state.activities[0]!;
state.courses = fixture.courses.map((course) => ({
  ...course,
  code: course.id,
  aliases: [],
}));
state.activities = fixture.assignments.map((assignment) => ({
  ...template,
  ...assignment,
  attachments: [],
  dueText: assignment.dueAt,
}));
const runDirectory = await mkdtemp(join(tmpdir(), "studi-harness-lms-"));
const server = await startLms({
  initialState: state,
  runDirectory,
  port: Number(process.argv[3] ?? "0"),
});
console.log(JSON.stringify({ url: server.url, fixture }));
process.stdin.resume();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  void server.close().then(async () => {
    const target = resolve(runDirectory),
      child = relative(resolve(tmpdir()), target);
    if (
      !child.startsWith("..") &&
      !isAbsolute(child) &&
      basename(target).startsWith("studi-harness-lms-")
    )
      await rm(target, { recursive: true, force: true });
    process.exit(0);
  });
}
process.stdin.once("data", stop);
process.stdin.once("end", stop);
process.once("SIGTERM", stop);
