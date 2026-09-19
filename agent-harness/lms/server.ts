import { randomUUID, createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SchoolError,
  activityById,
  type Service,
  type SchoolState,
} from "./domain.js";
import {
  assetBytes,
  readPrivateAsset,
  storeUpload,
  type PrivatePack,
} from "./assets.js";
import { SchoolStore, type AdvanceOptions } from "./store.js";
import { renderPublic, activityUrl, type Origins } from "./web.js";

export interface StartLmsOptions {
  scenarioId?: string;
  seed?: number;
  runDirectory: string;
  port?: number;
  resume?: boolean;
  privateLibrary?: string;
  initialState?: SchoolState;
}
const services: Service[] = ["school", "statistics", "builds", "feedback"];
export async function startLms(options: StartLmsOptions) {
  const store = new SchoolStore(
    options.runDirectory,
    options.scenarioId ?? "semester",
    options.seed ?? 42,
    options.resume,
    options.initialState,
  );
  const origins: Origins = {
    school: "",
    statistics: "",
    builds: "",
    feedback: "",
  };
  const servers: Server[] = [];
  const csrf = Object.fromEntries(
    services.map((service) => [service, randomUUID()]),
  ) as Record<Service, string>;
  let privatePack: PrivatePack | undefined;
  if (options.privateLibrary) {
    try {
      privatePack = JSON.parse(
        await readFile(join(options.privateLibrary, "pack.json"), "utf8"),
      );
      if (
        privatePack?.schemaVersion !== 1 ||
        !Array.isArray(privatePack.assets)
      )
        throw new Error("Invalid private pack");
      const ids = new Set<string>();
      for (const asset of privatePack.assets) {
        if (
          ids.has(asset.id) ||
          !store.read().assets.some((item) => item.id === asset.id)
        )
          throw new Error(
            "Private asset ID must replace one known school attachment.",
          );
        ids.add(asset.id);
        await readPrivateAsset(options.privateLibrary, asset);
      }
    } catch (error) {
      store.close();
      throw error;
    }
  }
  const contentManifest = store
    .read()
    .assets.map((asset) => ({
      id: asset.id,
      privateSource: privatePack?.assets.some((item) => item.id === asset.id) ?? false,
      sha256:
        privatePack?.assets.find((item) => item.id === asset.id)?.sha256 ??
        createHash("sha256").update(assetBytes(asset)).digest("hex"),
    }));
  const contentHash = createHash("sha256")
    .update(JSON.stringify(contentManifest))
    .digest("hex");
  if (options.resume) {
    try {
      const previous = JSON.parse(
        await readFile(join(options.runDirectory, "receipt.json"), "utf8"),
      );
      const mutableAssets = new Set(store.read().syllabi?.map((item) => item.assetId) ?? []);
      const immutableManifest = (manifest: typeof contentManifest) =>
        manifest.filter((item) => !mutableAssets.has(item.id) || item.privateSource || privatePack?.assets.some((asset) => asset.id === item.id))
          .map(({ id, sha256 }) => ({ id, sha256 }));
      if (previous.contentManifest && JSON.stringify(immutableManifest(previous.contentManifest)) !== JSON.stringify(immutableManifest(contentManifest)))
        throw new Error(
          "Resume requires the same source material hashes as the original run.",
        );
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        store.close();
        throw error;
      }
    }
  }
  async function handle(
    service: Service,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", origins[service]);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors ${Object.values(origins).join(" ")}; base-uri 'none'`,
    );
    const state = store.read();
    const sendHtml = (status: number, body: string) => {
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(body);
    };
    const redirect = (location: string) => {
      response.writeHead(303, { location });
      response.end();
    };
    try {
      if (request.headers.host !== new URL(origins[service]).host)
        throw new SchoolError(400, "Invalid school host.");
      if (!["GET", "HEAD", "POST"].includes(request.method ?? "GET"))
        throw new SchoolError(405, "Method not allowed.");
      if (
        /^\/(?:_control|control|inspect|truth|state|manifest)(?:\/|$)/.test(
          url.pathname,
        )
      )
        throw new SchoolError(404, "Page not found.");
      const activityMatch = /^\/assignments\/([^/]+)(?:\/(complete))?$/.exec(
        url.pathname,
      );
      if (activityMatch) {
        const item = activityById(state, decodeURIComponent(activityMatch[1]!));
        if (item.service !== service) {
          redirect(activityUrl(item, origins));
          return;
        }
      }
      if (!state.sessions[service] && url.pathname !== "/login") {
        redirect("/login");
        return;
      }
      if (request.method === "POST") {
        if (
          request.headers.origin &&
          request.headers.origin !== origins[service]
        ) {
          store.record("origin_rejected", {
            actualOrigin: request.headers.origin,
            expectedOrigin: origins[service],
            service,
          });
          throw new SchoolError(403, "Submit this form from its school page.");
        }
        const body = await readBody(request);
        const form = await new Request(url, {
          method: "POST",
          headers: {
            "content-type":
              request.headers["content-type"] ??
              "application/x-www-form-urlencoded",
          },
          body: new Uint8Array(body),
        }).formData();
        if (form.get("csrf") !== csrf[service])
          throw new SchoolError(
            403,
            "This form expired. Reload the page and try again.",
          );
        if (!store.read().sessions[service] && url.pathname !== "/login") {
          redirect("/login");
          return;
        }
        if (url.pathname === "/login" || url.pathname === "/logout") {
          const signedIn = url.pathname === "/login";
          store.change("session_changed", { service, signedIn }, (current) => {
            current.sessions[service] = signedIn;
          });
          response.setHeader(
            "Set-Cookie",
            `cedar_${service}_${store.runId.slice(0, 8)}=${signedIn ? "signed-in" : "signed-out"}; Path=/; HttpOnly; SameSite=Lax`,
          );
          redirect(signedIn ? "/" : "/login");
          return;
        }
        if (!activityMatch) throw new SchoolError(404, "Action not found.");
        const id = decodeURIComponent(activityMatch[1]!);
        if (activityMatch[2] === "complete") {
          store.complete(id);
          redirect(`/assignments/${id}?saved=lesson`);
          return;
        }
        const action = form.get("action");
        if (action !== "save" && action !== "submit")
          throw new SchoolError(400, "Choose save or submit.");
        const answer = String(form.get("answer") ?? ""),
          revision = Number(form.get("revision"));
        if (
          answer.length > 100_000 ||
          !Number.isSafeInteger(revision) ||
          revision < 0
        )
          throw new SchoolError(400, "Invalid response or draft revision.");
        const files = [];
        for (const file of form.getAll("files"))
          if (typeof file !== "string" && file.name && file.size)
            files.push(await storeUpload(options.runDirectory, file));
        if (!store.read().sessions[service] || form.get("csrf") !== csrf[service])
          throw new SchoolError(403, "Your session changed while uploading. Sign in and reload the current draft.");
        if (action === "save") store.save(id, answer, files, revision);
        else {
          const key = String(form.get("key") ?? "");
          const replay = store.read().submissions.some((item) => item.activityId === id && item.idempotencyKey === key);
          if (!replay && (store.read().faults.assignmentTimeoutsRemaining ?? 0) > 0) {
            store.save(id, answer, files, revision, true);
            throw new SchoolError(504, "The submission service timed out. Your response and files were saved as a draft. Reload before trying again.");
          }
          let result;
          try {
            result = store.submit(
              id,
              answer,
              files,
              revision,
              key,
            );
          } catch (error) {
            if (error instanceof SchoolError && error.status === 400) {
              store.save(id, answer, files, revision);
              throw new SchoolError(
                400,
                `${error.message} Your response and files were saved as a draft.`,
              );
            }
            throw error;
          }
          if (
            !result.repeated &&
            store.read().faults.lostSubmitResponsePending
          ) {
            store.change(
              "fault_triggered",
              { fault: "lost-submit-response" },
              (current) => {
                current.faults.lostSubmitResponsePending = false;
              },
            );
            throw new SchoolError(
              503,
              "The response was interrupted. Reload the activity to check whether the submission was received.",
            );
          }
        }
        redirect(`/assignments/${id}?saved=${action}`);
        return;
      }
      if (url.pathname === "/course/view.php") {
        redirect(
          `/courses/${encodeURIComponent(url.searchParams.get("id") ?? "")}`,
        );
        return;
      }
      if (
        url.pathname === "/courses/structures" &&
        state.faults.courseFailurePending
      ) {
        store.change(
          "fault_triggered",
          { fault: "course-load-interrupted" },
          (current) => {
            current.faults.courseFailurePending = false;
          },
        );
        throw new SchoolError(
          503,
          "The course could not load. Refresh to retry; other courses remain available.",
        );
      }
      const fileMatch = /^\/files\/([a-z0-9-]+)$/.exec(url.pathname);
      if (fileMatch) {
        const assetId = fileMatch[1]!;
        const owners = state.activities.filter(
          (item) =>
            item.service === service && item.attachments.includes(assetId),
        );
        const syllabusFile = service === "school" && state.syllabi?.some((item) => item.assetId === assetId);
        if (
          !syllabusFile && !owners.some((item) =>
            item.prerequisites.every((id) => state.completed.includes(id)),
          )
        )
          throw new SchoolError(404, "Course file not available.");
        const asset = state.assets.find((item) => item.id === assetId);
        if (!asset) throw new SchoolError(404, "File not found.");
        const imported = privatePack?.assets.find(
          (item) => item.id === assetId,
        );
        const bytes =
          imported && options.privateLibrary
            ? await readPrivateAsset(options.privateLibrary, imported)
            : assetBytes(asset);
        store.record("file_downloaded", {
          assetId,
          bytes: bytes.length,
          service,
        });
        sendFile(
          response,
          request,
          bytes,
          imported?.mime ?? asset.mime,
          imported?.name ?? asset.name,
        );
        return;
      }
      const uploadMatch = /^\/uploads\/([a-z0-9-]+)\/([a-f0-9]{64})$/.exec(
        url.pathname,
      );
      if (uploadMatch) {
        const item = activityById(state, uploadMatch[1]!);
        if (item.service !== service)
          throw new SchoolError(404, "File not found.");
        const file = state.drafts[item.id]?.files.find(
          (upload) => upload.hash === uploadMatch[2],
        );
        if (!file) throw new SchoolError(404, "File not found.");
        sendFile(
          response,
          request,
          await readFile(join(options.runDirectory, "uploads", file.hash)),
          "application/octet-stream",
          file.name,
        );
        return;
      }
      store.record("page_viewed", { service, path: url.pathname });
      const known =
        [
          "/",
          "/courses",
          "/calendar",
          "/exams",
          "/announcements",
          "/grades",
          "/account",
          "/login",
        ].includes(url.pathname) ||
        /^\/courses\/[^/]+(?:\/syllabus)?$/.test(url.pathname) ||
        !!activityMatch;
      const saved = url.searchParams.get("saved");
      const current = store.read(),
        id = activityMatch ? decodeURIComponent(activityMatch[1]!) : "";
      const message =
        saved === "save" &&
        current.drafts[id] &&
        !current.submissions.some((item) => item.activityId === id)
          ? "Draft saved. Your work has not been submitted."
          : saved === "submit" &&
              current.submissions.some((item) => item.activityId === id)
            ? "Submission received. See the receipt below."
            : saved === "lesson" && current.completed.includes(id)
              ? "Lesson completed."
              : undefined;
      const renderState = store.read();
      if (
        url.pathname === "/courses" &&
        url.searchParams.get("state") === "empty"
      )
        renderState.courses = [];
      sendHtml(
        known ? 200 : 404,
        renderPublic(
          renderState,
          origins,
          service,
          url,
          csrf[service],
          message,
        ),
      );
    } catch (error) {
      const status = error instanceof SchoolError ? error.status : 500;
      const message =
        error instanceof SchoolError
          ? error.message
          : "The school could not complete this request. Your last saved work is preserved.";
      store.record("request_rejected", { service, status, path: url.pathname });
      sendHtml(status, errorPage(message, url.pathname));
    }
  }
  try {
    for (const service of services) {
      const server = createServer((request, response) => {
        void handle(service, request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end("School service unavailable.");
        });
      });
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(
          service === "school" ? (options.port ?? 0) : 0,
          "127.0.0.1",
          () => {
            server.off("error", reject);
            resolve();
          },
        );
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("School did not bind a TCP port");
      origins[service] = `http://127.0.0.1:${address.port}`;
    }
  } catch (error) {
    await Promise.all(servers.map((server) => closeServer(server)));
    store.close();
    throw error;
  }
  const receipt = {
    contentHash,
    contentManifest,
    schemaVersion: 1,
    runId: store.runId,
    scenarioId: store.read().scenarioId,
    url: origins.school,
    origins,
    statePath: join(options.runDirectory, "school.sqlite"),
  };
  await writeFile(
    join(options.runDirectory, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  let closed = false;
  return {
    ...receipt,
    inspect: () => ({
      state: store.read(),
      effects: store.effects(),
      truth: scenarioTruth(store.read()),
    }),
    advance: (event: string, details: AdvanceOptions = {}) => {
      store.advance(event, details);
      if (event === "expire-session") csrf[details.service ?? "school"] = randomUUID();
      return { clock: store.read().clock, revision: store.read().revision };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all(servers.map(closeServer));
      store.close();
    },
  };
}
export function scenarioTruth(state: SchoolState) {
  // Authored source expectations, deliberately independent of Studi eligibility code.
  const actionable = [
    "exercise-05",
    "late-exercise",
    "stack-lesson",
    "hw5",
    "hw7",
    "hw8",
    "game-pitch",
    "final-game",
    "lab2",
    "observation",
    "reading",
    "rainfall-project",
    "structures-quiz",
    "personal-data-project",
    "undated-reflection",
    "announcement-response",
    "late-essay",
  ];
  const blocked = [
    "stack-review",
    "workshop-3",
    "workshop-4",
    "closed-exercise",
  ];
  const informationalIds = ["partners", "build-check"];
  const readingIds = state.activities
    .filter((item) => item.id.includes("-reading-"))
    .map((item) => item.id);
  const expectedExcludedIds = [...informationalIds, ...readingIds].filter(
    (id) => state.activities.some((item) => item.id === id),
  );
  const expectedAssignmentIds = state.activities
    .filter((item) => !expectedExcludedIds.includes(item.id))
    .map((item) => item.id);
  const forbiddenQueueIds = [
    "exercise-06",
    "exercise-07",
    "homework-1",
    "closed-exercise",
    "stack-review",
    "workshop-3",
    "workshop-4",
    "build-check",
    "hidden-feedback",
    "hw6",
    "hw8",
    "partners",
    "project-proposal",
    "reflection",
    "lab1",
    "lab-demo",
    "grade-zero",
    "undated-reflection",
    "announcement-response",
    ...readingIds,
  ];
  return {
    expectedExams: (state.exams ?? []).map(({ topics, ...exam }) => ({ ...exam, sourcePath: `/courses/${exam.courseId}/syllabus` })),
    expectedTopics: (state.exams ?? []).flatMap((exam) => exam.topics.map((topic) => ({ ...topic, examId: exam.id, courseId: exam.courseId }))),
    expectedSyllabi: (state.syllabi ?? []).map((item) => ({ ...item, pagePath: `/courses/${item.courseId}/syllabus`, filePath: `/files/${item.assetId}` })),
    expectedKinds: Object.fromEntries(state.activities.map((item) => [item.id, item.workKind ?? item.kind])),
    expectedStudentFiles: Object.fromEntries(state.activities.filter((item) => item.requiredStudentFiles?.length).map((item) => [item.id, item.requiredStudentFiles])),
    expectedUndatedIds: state.activities.filter((item) => item.dueText === "No due date published").map((item) => item.id),
    expectedAnnouncementOnlyIds: state.activities.filter((item) => item.visibility === "announcement_only").map((item) => item.id),
    expectedRubrics: Object.fromEntries(state.activities.filter((item) => item.rubric?.length).map((item) => [item.id, item.rubric])),
    expectedLatePenalties: Object.fromEntries(state.activities.filter((item) => item.latePenalty).map((item) => [item.id, item.latePenalty])),
    expectedAssignmentIds,
    expectedExcludedIds,
    informationalIds: informationalIds.filter((id) =>
      expectedExcludedIds.includes(id),
    ),
    completedReadingIds: readingIds,
    expectedSchoolActionableIds: actionable.filter((id) =>
      state.activities.some((item) => item.id === id),
    ),
    expectedActionableIds: actionable.filter(
      (id) => !["hw8", "undated-reflection", "announcement-response"].includes(id) && state.activities.some((item) => item.id === id),
    ),
    expectedForbiddenQueueIds: forbiddenQueueIds.filter((id) =>
      state.activities.some((item) => item.id === id),
    ),
    expectedBlockedIds: blocked.filter((id) =>
      state.activities.some((item) => item.id === id),
    ),
    notes: [
      "Initial-state task eligibility only; modified school states need a fresh expected-state manifest.",
      "No submission is accepted for repository/in-person/informational activities.",
      "Date-only deadlines remain date-only; no midnight timestamp is inferred.",
      "Submitted/graded work is not new homework.",
      "Service access can make an otherwise actionable activity unverified.",
    ],
  };
}
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 20 * 1024 * 1024)
      throw new SchoolError(413, "The form exceeds 20 MB.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function sendFile(
  response: ServerResponse,
  request: IncomingMessage,
  bytes: Buffer,
  mime: string,
  name: string,
): void {
  response.setHeader("content-type", mime);
  response.setHeader(
    "content-disposition",
    `${mime === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  response.setHeader("accept-ranges", "bytes");
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : -1,
      end = match?.[2]
        ? Math.min(Number(match[2]), bytes.length - 1)
        : bytes.length - 1;
    if (!match || start < 0 || start >= bytes.length || end < start) {
      response.writeHead(416, { "content-range": `bytes */${bytes.length}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
      "content-length": end - start + 1,
    });
    response.end(
      request.method === "HEAD" ? undefined : bytes.subarray(start, end + 1),
    );
    return;
  }
  response.writeHead(200, { "content-length": bytes.length });
  response.end(request.method === "HEAD" ? undefined : bytes);
}
function errorPage(message: string, path: string): string {
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]!,
    );
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Check your work | Cedar Learning</title><main style="max-width:700px;margin:60px auto;font:18px/1.6 system-ui"><h1>The action could not be confirmed</h1><p role="alert">${escape(message)}</p><p><a href="${escape(path)}">Return to the activity and check its current state</a></p><a href="/">Dashboard</a></main></html>`;
}
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
