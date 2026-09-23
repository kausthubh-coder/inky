import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Origins } from "./web.js";
import type { Surface } from "./school-theme.js";

interface RecordedPage {
  surface: Surface;
  method: "GET";
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}
export async function loadRecording(directory: string) {
  const data = JSON.parse(
    await readFile(join(directory, "recording.json"), "utf8"),
  ) as { schemaVersion: number; entries: RecordedPage[] };
  const surfaces = [
    "school",
    "unity",
    "university",
    "statistics",
    "feedback",
    "builds",
  ];
  const seen = new Set<string>();
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.entries) ||
    !data.entries.length
  )
    throw new Error("Invalid recording");
  for (const e of data.entries) {
    const key = `${e.surface}:${e.path}`;
    if (
      !surfaces.includes(e.surface) ||
      e.method !== "GET" ||
      !e.path.startsWith("/") ||
      e.path.startsWith("//") ||
      !Number.isInteger(e.status) ||
      e.status < 200 ||
      e.status > 599 ||
      typeof e.body !== "string" ||
      seen.has(key)
    )
      throw new Error("Invalid or duplicate recorded page");
    if (
      !e.headers ||
      Object.keys(e.headers).some(
        (h) => !["content-type", "location"].includes(h),
      )
    )
      throw new Error("Unsafe recorded headers");
    seen.add(key);
  }
  return (
    surface: Surface,
    method: string,
    path: string,
    response: ServerResponse,
    origins: Origins,
  ) => {
    const page = data.entries.find(
      (e) =>
        e.surface === surface &&
        e.path === path &&
        (method === "GET" || method === "HEAD"),
    );
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-src 'self'; form-action 'none'; base-uri 'none'",
    );
    if (!page) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("No recording for this request.");
      return;
    }
    const expand = (text: string) =>
      text.replace(
        /\{\{(school|unity|university|statistics|feedback|builds)\}\}/g,
        (_, key: Surface) => origins[key] ?? "about:blank",
      );
    // Replay stays offline: recorded scripts never run and redirects stay local.
    const headers = Object.fromEntries(
      Object.entries(page.headers).map(([k, v]) => [k, expand(v)]),
    );
    if (
      headers.location &&
      !Object.values(origins).some((origin) => {
        try {
          return new URL(headers.location!).origin === origin;
        } catch {
          return false;
        }
      })
    )
      throw new Error("Recorded redirect leaves fixture");
    response.writeHead(page.status, headers);
    response.end(method === "HEAD" ? undefined : expand(page.body));
  };
}
