import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// Import an explicitly supplied HAR. Never attaches to a student's browser.
// Names/IDs are supplied by the operator; cookies, auth and form bodies are dropped.
export function sanitizeHar(har, { origins, replacements }) {
  const surfaces = new Set([
    "school",
    "unity",
    "university",
    "statistics",
    "feedback",
    "builds",
  ]);
  if (
    !origins ||
    !replacements ||
    Object.values(origins).some((s) => !surfaces.has(s))
  )
    throw new Error(
      "Provide an origin-to-surface map and explicit name/ID replacements.",
    );
  if (new Set(Object.values(origins)).size !== Object.keys(origins).length)
    throw new Error("Each recorded origin needs a distinct surface.");
  const scrub = (value) => {
    let text = String(value);
    for (const [from, to] of Object.entries(replacements).sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      if (!from) throw new Error("Empty replacement");
      text = text.replaceAll(from, String(to));
    }
    for (const [origin, surface] of Object.entries(origins))
      text = text.replaceAll(origin, `{{${surface}}}`);
    return text
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        "student@example.invalid",
      )
      .replace(
        /((?:sesskey|access_token|refresh_token|csrf|authorization)["']?\s*[:=]\s*["']?)[^\s"'&<>;,}]+/gi,
        "$1REDACTED",
      )
      .replace(/<input\b[^>]*>/gi, (tag) =>
        /\btype\s*=\s*["']?(hidden|password)\b/i.test(tag)
          ? tag.replace(/(\bvalue\s*=\s*)(["'])(.*?)\2/gi, "$1$2REDACTED$2").replace(/(\bvalue\s*=\s*)(?!["'])[^\s>]+/gi,"$1REDACTED")
          : tag,
      );
  };
  const entries = [];
  for (const entry of har?.log?.entries ?? []) {
    const request = entry.request,
      response = entry.response,
      url = new URL(request.url),
      surface = origins[url.origin];
    if (!surface || request.method !== "GET") continue; // No credential-bearing POST replays.
    if (response.content?.encoding === "base64")
      throw new Error(
        "Binary HAR bodies need manual sanitization; import text pages only.",
      );
    if (!/^(text\/|application\/json)/i.test(response.content?.mimeType ?? ""))
      continue;
    const headers = { "content-type": response.content.mimeType };
    const location = response.headers?.find(
      (h) => h.name.toLowerCase() === "location",
    )?.value;
    if (location) {
      const target = new URL(location, url);
      if (!origins[target.origin]) continue;
      headers.location = scrub(target.href);
    }
    for (const key of [...url.searchParams.keys()])
      if (/token|auth|session|sesskey|csrf|code/i.test(key))
        url.searchParams.delete(key);
    entries.push({
      surface,
      method: "GET",
      path: scrub(url.pathname + url.search),
      status: response.status,
      headers,
      body: scrub(response.content.text ?? ""),
    });
  }
  if (!entries.length) throw new Error("No eligible text pages in HAR");
  return {
    schemaVersion: 1,
    provenance:
      "Operator-supplied HAR; explicit name/ID replacement; no request headers, cookies or POST bodies",
    entries,
  };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const [input, redactions, out] = process.argv.slice(2);
  if (!input || !redactions || !out)
    throw new Error(
      "Usage: node agent-harness/lms/record.mjs capture.har redactions.json output-directory",
    );
  const result = sanitizeHar(
    JSON.parse(await readFile(input, "utf8")),
    JSON.parse(await readFile(redactions, "utf8")),
  );
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "recording.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      pages: result.entries.length,
      path: join(out, "recording.json"),
      reviewRequired: true,
    }),
  );
}
