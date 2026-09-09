import type { BrowserSnapshot } from "../../shared/index.js";
import { SafeSourceTargetSchema } from "../../shared/index.js";

// The Moodle module id belongs to the installation (including its path prefix),
// not to a course label, scan, or model-generated key.
export function schoolIdentity(target: string, kind: "course" | "assignment"): string | null {
  const url = new URL(target);
  const pattern = kind === "course"
    ? /^(.*)\/(?:course\/view|mod\/assign\/index)\.php$/
    : /^(.*)\/mod\/(assign|quiz)\/view\.php$/;
  const match = url.pathname.match(pattern);
  const id = url.searchParams.get("id");
  if (match && id && url.searchParams.getAll("id").length === 1 && /^\d+$/.test(id)) {
    return `${url.origin}${match[1]}|moodle|${kind === "course" ? "course" : match[2]}|${id}`;
  }
  return null;
}

export function exactTarget(target: string): string {
  const url = new URL(target);
  // Unknown sites can route assignments in the fragment (#/assignments/123).
  // Moodle's known identity rules above can ignore view anchors safely.
  url.searchParams.sort();
  return url.href;
}

export function assignmentIdentity(target: string): string {
  return schoolIdentity(target, "assignment") ?? `url|${exactTarget(target)}`;
}

export function isMoodleIndex(target: string): boolean {
  return /\/mod\/assign\/index\.php$/.test(new URL(target).pathname);
}

// Only a fresh matching link, or the currently open detail page, can name a
// destination. A suggested key or an arbitrary URL supplied by the model cannot.
export function observedTarget(snapshot: BrowserSnapshot, label: string, ref?: string): string {
  const matches = snapshot.elements.filter(element => element.role === "link" && element.href &&
    (normalize(element.name) === normalize(label) ||
      (element.ref === ref && normalize(element.name).includes(normalize(label)))));
  const selected = matches.find(element => element.ref === ref);
  const targets = [...new Set((selected ? [selected] : matches).map(element => element.href!))];
  if (targets.length > 1) throw new Error(`Several links match ${label}; open its detail page before recording it`);
  return SafeSourceTargetSchema.parse(targets[0] ?? snapshot.url);
}

export function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
