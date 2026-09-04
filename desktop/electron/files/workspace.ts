import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const MARKER_NAME = ".studi-workspace.json";
const SANDBOX_NAME = ".studi-sandbox";
const WORKSPACE_VERSION = 1;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

type WorkspaceMarker = Readonly<{
  kind: "studi-homework-workspace";
  version: 1;
}>;

export type AssignmentWorkspace = Readonly<{
  root: string;
  classDirectory: string;
  assignmentDirectory: string;
  sandboxDirectory: string;
}>;

const marker: WorkspaceMarker = { kind: "studi-homework-workspace", version: WORKSPACE_VERSION };

export async function initializeHomeworkWorkspace(rawRoot: string): Promise<string> {
  const root = await canonicalDirectory(rawRoot);
  const entries = await readdir(root);
  if (entries.length > 0) {
    const isManaged = entries.every((entry) => entry === MARKER_NAME || entry === SANDBOX_NAME);
    if (!isManaged || !(await hasValidMarker(root))) {
      throw new TypeError("Choose an empty folder made just for Studi. It must not contain other files or folders.");
    }
  }

  await mkdir(join(root, SANDBOX_NAME), { recursive: true });
  await writeMarker(root, MARKER_NAME, marker);
  return root;
}

export async function syncHomeworkClassFolders(
  rawRoot: string,
  classes: readonly { readonly courseId: string; readonly label: string }[],
): Promise<string[]> {
  const root = await requireHomeworkWorkspace(rawRoot);
  const directories: string[] = [];
  for (const course of classes) {
    const name = safeSegment(course.label, "Class");
    const directory = await classDirectoryFor(root, name, course.courseId);
    await assertInside(root, directory);
    await mkdir(directory, { recursive: true });
    await assertPlainDirectory(directory);
    await writeMarker(directory, ".studi-class.json", {
      kind: "studi-class",
      version: WORKSPACE_VERSION,
      courseId: course.courseId,
      label: course.label,
    });
    directories.push(directory);
  }
  return directories;
}

async function classDirectoryFor(root: string, preferredName: string, courseId: string): Promise<string> {
  const preferred = join(root, preferredName);
  try {
    const metadata = await lstat(preferred);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return preferred;
    const existing = await readClassMarker(preferred);
    if (!existing || existing.courseId === courseId) return preferred;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return preferred;
    throw error;
  }

  const suffix = createHash("sha256").update(courseId).digest("hex").slice(0, 6);
  return join(root, `${preferredName} [${suffix}]`);
}

async function readClassMarker(directory: string): Promise<{ readonly courseId: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(directory, ".studi-class.json"), "utf8")) as {
      readonly kind?: unknown;
      readonly courseId?: unknown;
    };
    return parsed.kind === "studi-class" && typeof parsed.courseId === "string"
      ? { courseId: parsed.courseId }
      : null;
  } catch {
    return null;
  }
}

export async function openAssignmentWorkspace(
  rawRoot: string,
  input: {
    readonly courseId: string;
    readonly courseLabel: string;
    readonly assignmentId: string;
    readonly assignmentTitle: string;
  },
): Promise<AssignmentWorkspace> {
  const root = await requireHomeworkWorkspace(rawRoot);
  const [classDirectory] = await syncHomeworkClassFolders(root, [{ courseId: input.courseId, label: input.courseLabel }]);
  if (!classDirectory) throw new Error("Studi could not create the class workspace");

  const shortId = createHash("sha256").update(input.assignmentId).digest("hex").slice(0, 6);
  const assignmentDirectory = join(classDirectory, `${safeSegment(input.assignmentTitle, "Assignment")} [${shortId}]`);
  const sandboxDirectory = join(root, SANDBOX_NAME, shortId);
  await assertInside(root, assignmentDirectory);
  await assertInside(root, sandboxDirectory);
  await mkdir(assignmentDirectory, { recursive: true });
  await mkdir(sandboxDirectory, { recursive: true });
  await assertPlainDirectory(assignmentDirectory);
  await assertPlainDirectory(sandboxDirectory);
  await writeMarker(assignmentDirectory, ".studi-assignment.json", {
    kind: "studi-assignment",
    version: WORKSPACE_VERSION,
    assignmentId: input.assignmentId,
    title: input.assignmentTitle,
  });
  return { root, classDirectory, assignmentDirectory, sandboxDirectory };
}

export async function requireHomeworkWorkspace(rawRoot: string): Promise<string> {
  const root = await canonicalDirectory(rawRoot);
  if (!(await hasValidMarker(root))) {
    throw new TypeError("This is not a Studi homework folder. Choose a new empty folder in Settings.");
  }
  await assertPlainDirectory(join(root, SANDBOX_NAME));
  return root;
}

export function relativeWorkspacePath(root: string, target: string): string {
  const value = relative(resolve(root), resolve(target));
  return value.split(sep).join("/") || ".";
}

async function canonicalDirectory(rawPath: string): Promise<string> {
  const absolute = resolve(rawPath);
  const metadata = await stat(absolute);
  if (!metadata.isDirectory()) throw new TypeError("The homework folder must be a directory");
  const canonical = await realpath(absolute);
  await assertPlainDirectory(canonical);
  return canonical;
}

async function hasValidMarker(root: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(join(root, MARKER_NAME), "utf8")) as Partial<WorkspaceMarker>;
    return parsed.kind === marker.kind && parsed.version === marker.version;
  } catch {
    return false;
  }
}

async function writeMarker(directory: string, name: string, value: object): Promise<void> {
  const target = join(directory, name);
  const temporary = join(directory, `.${basename(name)}.${process.pid}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (await readFile(target, "utf8") === content) return;
  } catch { /* Missing or stale markers are replaced below. */ }
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await unlink(target);
      await rename(temporary, target);
    }
  } catch (error) {
    try { await unlink(temporary); } catch { /* best effort */ }
    throw error;
  }
}

async function assertPlainDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError(`Studi workspace paths must be plain directories: ${path}`);
  }
}

async function assertInside(root: string, target: string): Promise<void> {
  const relativePath = relative(resolve(root), resolve(target));
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
    return;
  }
  throw new TypeError("Workspace path escaped the selected Studi folder");
}

function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 96);
  const candidate = cleaned || fallback;
  return WINDOWS_RESERVED_NAME.test(candidate) ? `_${candidate}` : candidate;
}
