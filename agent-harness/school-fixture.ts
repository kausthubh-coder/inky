import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const FixtureSchema = z.strictObject({
  school: z.strictObject({ label: z.string().min(1), entryUrl: z.url() }),
  courses: z.array(z.strictObject({ id: z.string().min(1), title: z.string().min(1) })),
  assignments: z.array(z.strictObject({
    id: z.string().min(1),
    courseId: z.string().min(1),
    title: z.string().min(1),
    dueAt: z.iso.datetime(),
  })),
});

export type SchoolFixture = z.infer<typeof FixtureSchema>;

export async function loadSchoolFixture(path: string): Promise<SchoolFixture> {
  const fixture = FixtureSchema.parse(parse(await readFile(path, "utf8")));
  const courseIds = new Set(fixture.courses.map((course) => course.id));
  for (const assignment of fixture.assignments) {
    if (!courseIds.has(assignment.courseId)) {
      throw new Error(`Fixture assignment ${assignment.id} refers to missing course ${assignment.courseId}`);
    }
  }
  return fixture;
}

export async function startSchoolFixture(options: {
  readonly fixturePath: string;
  readonly port?: number;
}): Promise<{ readonly url: string; readonly fixture: SchoolFixture; close(): Promise<void> }> {
  const fixture = await loadSchoolFixture(options.fixturePath);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    if (request.method !== "GET") return send(response, 405, page("Method not allowed", "Only fixture reads are supported."));
    if (url.searchParams.get("state") === "signed-out") {
      return send(response, 200, page(fixture.school.label, '<a href="/courses">Sign in to the fixture school</a>'));
    }
    if (url.pathname === "/") {
      return send(response, 200, page(fixture.school.label, '<nav><a href="/courses">Courses</a><a href="/linked-system">Linked system</a></nav>'));
    }
    if (url.pathname === "/linked-system") {
      return send(response, 200, page("Linked system", '<p>Return to the fixture school after this handoff.</p><a href="/courses">Continue</a>'));
    }
    if (url.pathname === "/courses") {
      const courses = url.searchParams.get("state") === "empty" ? [] : fixture.courses;
      return send(response, 200, page("Courses", courses.length
        ? `<ul>${courses.map((course) => `<li><a href="/courses/${segment(course.id)}">${html(course.title)}</a></li>`).join("")}</ul>`
        : "<p>No courses found.</p>"));
    }
    const courseMatch = /^\/courses\/([^/]+)$/.exec(url.pathname);
    if (courseMatch) {
      const courseId = decodeURIComponent(courseMatch[1]!);
      const course = fixture.courses.find((item) => item.id === courseId);
      if (!course) return send(response, 404, page("Not found", "Course not found."));
      const all = fixture.assignments.filter((assignment) => assignment.courseId === courseId);
      const assignments = url.searchParams.get("state") === "partial" ? all.slice(0, 1) : all;
      return send(response, 200, page(course.title, assignments.length
        ? `<ul>${assignments.map((assignment) => `<li><a href="/assignments/${segment(assignment.id)}">${html(assignment.title)}</a><time datetime="${html(assignment.dueAt)}">${html(assignment.dueAt)}</time></li>`).join("")}</ul>`
        : "<p>No assignments found.</p>"));
    }
    const assignmentMatch = /^\/assignments\/([^/]+)$/.exec(url.pathname);
    if (assignmentMatch) {
      const assignment = fixture.assignments.find((item) => item.id === decodeURIComponent(assignmentMatch[1]!));
      if (!assignment) return send(response, 404, page("Not found", "Assignment not found."));
      return send(response, 200, page(assignment.title, `<p>Course: ${html(assignment.courseId)}</p><p>Due <time datetime="${html(assignment.dueAt)}">${html(assignment.dueAt)}</time></p><label>Answer <textarea name="answer"></textarea></label><button type="button">Save answer</button>`));
    }
    return send(response, 404, page("Not found", "Fixture page not found."));
  });
  await listen(server, options.port ?? 0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    fixture,
    close: () => close(server),
  };
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(title)}</title></head><body data-studi-fixture="school"><main><h1>${html(title)}</h1>${body}</main></body></html>`;
}

function send(response: Parameters<Parameters<typeof createServer>[0]>[1], status: number, body: string): void {
  response.statusCode = status;
  response.end(body);
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
