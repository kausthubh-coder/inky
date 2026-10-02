import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireHomeworkWorkspace, safeSegment } from "./workspace.js";

/**
 * One folder per Learn goal, like a study folder a student keeps by hand:
 * PROGRESS.md (what they showed, what's missing, what's next), CHEATSHEET.md and the study pages Chalky made.
 * The database stays the authority for levels; these files are readable notes the tutor reads back next time.
 */
export interface GoalFolderInput { title: string; classLabel: string | null }

const NOTE_BUDGET = 4_000;

export async function goalFolder(homeworkRoot: string, goal: GoalFolderInput, create = true): Promise<string> {
  const root = await requireHomeworkWorkspace(homeworkRoot);
  const name = safeSegment([goal.classLabel?.split(" ").slice(0, 2).join(" "), goal.title].filter(Boolean).join(" "), "Goal");
  const directory = join(root, "Learn", name);
  if (create) await mkdir(join(directory, "pages"), { recursive: true });
  return directory;
}

async function readTail(path: string): Promise<string> {
  try {
    const text = await readFile(path, "utf8");
    return text.length > NOTE_BUDGET ? `…${text.slice(-NOTE_BUDGET)}` : text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** The newest notes matter most, so long files are read from the end. */
export async function readGoalNotes(directory: string): Promise<{ progress: string; cheatsheet: string }> {
  return { progress: await readTail(join(directory, "PROGRESS.md")), cheatsheet: await readTail(join(directory, "CHEATSHEET.md")) };
}

/** Full student notes, rather than the tutor's bounded context tail. */
export async function getLearnNotes(directory: string) {
  let cheatsheet = "", names: string[] = [];
  try { cheatsheet = await readFile(join(directory, "CHEATSHEET.md"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { names = (await readdir(join(directory, "pages"), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const pages = await Promise.all(names.flatMap(name => {
    const match = /^(\d{4}-\d{2}-\d{2}) (.+)\.html$/.exec(name);
    return match ? [stat(join(directory, "pages", name)).then(file => ({ name, title: match[2]!, date: match[1]!, savedAt: file.mtimeMs }))] : [];
  }));
  pages.sort((a, b) => b.savedAt - a.savedAt || b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return { cheatsheet: cheatsheet.split(/\r?\n/).filter(line => /^\s*[-*+] /.test(line)).map(line => line.replace(/^\s*[-*+] /, "")),
    pages: pages.map(({ savedAt: _savedAt, ...page }) => page) };
}

export async function readLearnPage(directory: string, name: string): Promise<string> {
  if (!(await getLearnNotes(directory)).pages.some(page => page.name === name)) throw new Error("Study page not found for this goal");
  return readFile(join(directory, "pages", name), "utf8");
}

export interface SessionNote {
  date: string; topic: string; summary: string;
  levelBefore: string | null; levelAfter: string | null; missing: readonly string[]; next: string;
}

export async function recordSessionNote(directory: string, note: SessionNote): Promise<void> {
  const level = note.levelAfter === null ? "Level not set yet"
    : note.levelBefore === note.levelAfter ? `Still ${note.levelAfter}` : `${note.levelBefore ?? "Not checked"} → ${note.levelAfter}`;
  const lines = [`## ${note.date} · ${note.topic}`, "", note.summary, "", `- ${level}`,
    ...note.missing.map(item => `- Still to practise: ${item}`), `- Next: ${note.next}`, "", ""];
  await appendFile(join(directory, "PROGRESS.md"), lines.join("\n"), "utf8");
}

export async function addCheatsheetLines(directory: string, lines: readonly string[]): Promise<void> {
  if (!lines.length) return;
  let existing = "";
  try { existing = await readFile(join(directory, "CHEATSHEET.md"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const saved = new Set(existing.split(/\r?\n/).filter(line => line.startsWith("- ")).map(line => line.slice(2)));
  const fresh = [...new Set(lines)].filter(line => !saved.has(line));
  if (fresh.length) await appendFile(join(directory, "CHEATSHEET.md"), fresh.map(line => `- ${line}\n`).join(""), "utf8");
}

/** Saved so the student can reopen a page after the session. Returns the file name. */
export async function saveStudyPage(directory: string, date: string, title: string, html: string): Promise<string> {
  const name = `${date} ${safeSegment(title, "Study page")}.html`;
  await writeFile(join(directory, "pages", name), html, "utf8");
  return name;
}
