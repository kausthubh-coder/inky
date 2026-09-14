import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const FixtureSchema = z.strictObject({
  school: z.strictObject({ label: z.string().min(1), entryUrl: z.url() }),
  courses: z.array(
    z.strictObject({ id: z.string().min(1), title: z.string().min(1) }),
  ),
  assignments: z.array(
    z.strictObject({
      id: z.string().min(1),
      courseId: z.string().min(1),
      title: z.string().min(1),
      dueAt: z.iso.datetime(),
    }),
  ),
});

export type SchoolFixture = z.infer<typeof FixtureSchema>;

export async function loadSchoolFixture(path: string): Promise<SchoolFixture> {
  const fixture = FixtureSchema.parse(parse(await readFile(path, "utf8")));
  const courseIds = new Set(fixture.courses.map((course) => course.id));
  for (const assignment of fixture.assignments) {
    if (!courseIds.has(assignment.courseId)) {
      throw new Error(
        `Fixture assignment ${assignment.id} refers to missing course ${assignment.courseId}`,
      );
    }
  }
  return fixture;
}

export async function startSchoolFixture(options: {
  readonly fixturePath: string;
  readonly port?: number;
}): Promise<{
  readonly url: string;
  readonly fixture: SchoolFixture;
  close(): Promise<void>;
}> {
  const fixture = await loadSchoolFixture(options.fixturePath);
  const child = spawn(
    "node",
    [
      resolve(".studi-lms/build/compat.mjs"),
      options.fixturePath,
      String(options.port ?? 0),
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors = (errors + String(chunk)).slice(-8_192);
  });
  const url = await new Promise<string>((accept, reject) => {
    let output = "";
    const timer = setTimeout(
      () => fail(new Error("Shared school did not start within 15 seconds")),
      15_000,
    );
    function cleanup() {
      clearTimeout(timer);
      child.off("error", fail);
      child.off("exit", exited);
      child.stdout.off("data", received);
    }
    function fail(error: Error) {
      cleanup();
      child.kill();
      reject(error);
    }
    function exited(code: number | null) {
      fail(new Error(`Shared school exited (${code}): ${errors}`));
    }
    function received(chunk: Buffer) {
      output += String(chunk);
      if (output.length > 16_384) {
        fail(new Error("Shared school startup output exceeded its limit"));
        return;
      }
      if (!output.includes("\n")) return;
      try {
        const value: unknown = JSON.parse(output.split("\n")[0]!);
        if (
          !value ||
          typeof value !== "object" ||
          !("url" in value) ||
          typeof value.url !== "string"
        )
          throw new Error("Invalid shared school receipt");
        cleanup();
        accept(value.url);
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new Error("Invalid shared school receipt"),
        );
      }
    }
    child.once("error", fail);
    child.once("exit", exited);
    child.stdout.on("data", received);
  });
  return {
    url,
    fixture,
    close: () =>
      new Promise<void>((accept, reject) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          accept();
          return;
        }
        const killTimer = setTimeout(() => child.kill(), 3_000);
        const deadline = setTimeout(() => {
          cleanup();
          reject(new Error("Shared school did not stop after termination"));
        }, 6_000);
        function cleanup() {
          clearTimeout(killTimer);
          clearTimeout(deadline);
          child.off("exit", stopped);
          child.stdin.off("error", inputFailed);
        }
        function stopped() {
          cleanup();
          accept();
        }
        function inputFailed() {
          child.kill();
        }
        child.once("exit", stopped);
        child.stdin.once("error", inputFailed);
        child.stdin.end("stop\n");
      }),
  };
}
