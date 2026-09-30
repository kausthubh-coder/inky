import type { Assignment } from "../../shared/index.js";

export function assignmentDue(assignment: Pick<Assignment, "dueAt">): number | null {
  // School date text can omit the year or time; parsing it invents a deadline.
  const value = Date.parse(assignment.dueAt ?? "");
  return Number.isFinite(value) ? value : null;
}

/** "CSC 316 Data Structures" → "CSC 316". Schools don't give a short code, so it comes from the label. */
export function shortCourse(label: string): string {
  const code = /^([A-Z]{2,5})\s*-?\s*(\d{2,4}[A-Z]?)\b/.exec(label.trim());
  if (code) return `${code[1]} ${code[2]}`;
  const words = label.trim().split(/\s+/).slice(0, 2).join(" ");
  return words.length > 16 ? `${words.slice(0, 15)}…` : words;
}

/** An error in the student's words: no "Error: Error invoking remote method…", no network codes. "" when there is nothing to tell. */
export function plainError(cause: unknown): string {
  const text = (cause instanceof Error ? cause.message : String(cause ?? ""))
    .replace(/^(?:Error: )*(?:Error invoking remote method '[^']+': )?(?:Error: )*/, "").trim();
  const code = /\bERR_[A-Z_]+/.exec(text)?.[0];
  if (!code) return text;
  // The page moved on to another address before this one loaded; nothing went wrong.
  if (code === "ERR_ABORTED") return "";
  if (code === "ERR_TOO_MANY_REDIRECTS") return "The school page keeps looping between addresses. Open the school page, sign in if asked, then check again.";
  if (/INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(code)) return "The page didn't load. Check your internet, then try again.";
  if (/TIMED_OUT|CONNECTION/.test(code)) return "The school's site didn't answer. Try again in a moment.";
  return "The page didn't load. Try again.";
}

export function schoolScanFailure(reason: string | undefined) {
  const code = /\bERR_[A-Z_]+/.exec(reason ?? "")?.[0];
  return {
    title: code === "ERR_TOO_MANY_REDIRECTS" ? "The school page keeps looping"
      : code ? "The school page couldn't open" : "Dot couldn't finish this check",
    description: code === "ERR_TOO_MANY_REDIRECTS" ? "Open the school page and sign in if asked. Then check again. Your saved homework is still here."
      : plainError(reason) || "Check again to continue. Your saved homework is still here.",
    pageUnavailable: Boolean(code && code !== "ERR_ABORTED"),
  };
}
