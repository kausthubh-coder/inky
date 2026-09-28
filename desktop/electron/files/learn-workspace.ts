import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireHomeworkWorkspace, safeSegment } from "./workspace.js";

/**
 * One folder per Learn goal, like a study folder a student keeps by hand:
 * PROGRESS.md (what they showed, what's missing, what's next), CHEATSHEET.md and the study pages Chalky made.
 * The database stays the authority for levels; these files are readable notes the tutor reads back next time.
 */
export interface GoalFolderInput { title: string; classLabel: string | null }

const NOTE_BUDGET = 4_000;

export async function goalFolder(homeworkRoot: string, goal: GoalFolderInput): Promise<string> {
  const root = await requireHomeworkWorkspace(homeworkRoot);
  const name = safeSegment([goal.classLabel?.split(" ").slice(0, 2).join(" "), goal.title].filter(Boolean).join(" "), "Goal");
  const directory = join(root, "Learn", name);
  await mkdir(join(directory, "pages"), { recursive: true });
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
