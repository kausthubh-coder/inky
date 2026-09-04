import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, glob, lstat, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

const SHELL_TIMEOUT_MS = 120_000;
const BLOCKED_SHELL = [
  /(?:^|[;&|])\s*(?:sudo|su|runas|cmd|powershell|pwsh|bash|sh|zsh|ssh|scp|curl|wget)\b/i,
  /\b(?:start-process|invoke-webrequest|invoke-restmethod|reg(?:\.exe)?|schtasks|takeown|icacls|mount|diskpart)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b[^\r\n]*(?:--global|-g)\b/i,
  /(?:^|[\s"'])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|etc|var|opt|root|Library|Applications)(?:[\\/]|$))/i,
  /(?:^|[\\/])\.\.(?:[\\/]|$)/,
  /(?:\$HOME|\$env:(?:USERPROFILE|HOME)|%USERPROFILE%|%HOME%|~[\\/])/i,
];

export function createWorkspaceCodingTools(workspaceDirectory: string): ToolDefinition[] {
  const boundary = new WorkspaceBoundary(workspaceDirectory);
  const read = createReadToolDefinition(boundary.root, {
    autoResizeImages: true,
    operations: {
      access: (path) => boundary.assertReadableFile(path),
      readFile: (path) => boundary.read(path),
      detectImageMimeType: async (path) => boundary.imageMimeType(path),
    },
  });
  const write = createWriteToolDefinition(boundary.root, {
    operations: {
      mkdir: (path) => boundary.mkdir(path),
      writeFile: (path, content) => boundary.write(path, content),
    },
  });
  const edit = createEditToolDefinition(boundary.root, {
    operations: {
      access: (path) => boundary.assertReadableFile(path),
      readFile: (path) => boundary.read(path),
      writeFile: (path, content) => boundary.write(path, content),
    },
  });
  const ls = createLsToolDefinition(boundary.root, {
    operations: {
      exists: (path) => boundary.exists(path),
      stat: (path) => boundary.stat(path),
      readdir: (path) => boundary.readdir(path),
    },
  });
  const grep = createGrepToolDefinition(boundary.root, {
    operations: {
      isDirectory: async (path) => (await boundary.stat(path)).isDirectory(),
      readFile: async (path) => (await boundary.read(path)).toString("utf8"),
    },
  });
  const find = createFindToolDefinition(boundary.root, {
    operations: {
      exists: (path) => boundary.exists(path),
      glob: (pattern, cwd, options) => boundary.glob(pattern, cwd, options.ignore, options.limit),
    },
  });
  const shellOptions = { operations: restrictedShell(boundary.root), exposeSessionEnvironment: false };
  const shell = process.platform === "win32"
    ? createPowerShellToolDefinition(boundary.root, shellOptions)
    : createBashToolDefinition(boundary.root, shellOptions);
  return [read, write, edit, grep, find, ls, shell] as unknown as ToolDefinition[];
}

class WorkspaceBoundary {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async assertReadableFile(path: string): Promise<void> {
    const target = await this.existing(path);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new TypeError("The workspace path is not a regular file");
    await access(target);
  }

  async read(path: string): Promise<Buffer> {
    const target = await this.existing(path);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new TypeError("The workspace path is not a regular file");
    return readFile(target);
  }

  async write(path: string, content: string): Promise<void> {
    const target = this.inside(path);
    await this.assertNoLinks(dirname(target));
    await mkdir(dirname(target), { recursive: true });
    await this.assertNoLinks(dirname(target));
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError("Workspace writes may replace only regular files");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      try {
        await rename(temporary, target);
      } catch (error) {
        if (![
          "EEXIST",
          "EPERM",
        ].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await unlink(target);
        await rename(temporary, target);
      }
    } catch (error) {
      try { await unlink(temporary); } catch { /* best effort */ }
      throw error;
    }
  }

  async mkdir(path: string): Promise<void> {
    const target = this.inside(path);
    await this.assertNoLinks(dirname(target));
    await mkdir(target, { recursive: true });
    await this.assertNoLinks(target);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.existing(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async stat(path: string): Promise<Awaited<ReturnType<typeof stat>>> {
    return stat(await this.existing(path));
  }

  async readdir(path: string): Promise<string[]> {
    const target = await this.existing(path);
    if (!(await stat(target)).isDirectory()) throw new TypeError("The workspace path is not a directory");
    return readdir(target);
  }

  async glob(pattern: string, cwd: string, ignore: string[], limit: number): Promise<string[]> {
    const searchRoot = await this.existing(cwd);
    if (!(await stat(searchRoot)).isDirectory()) throw new TypeError("The workspace search path is not a directory");
    const matches: string[] = [];
    for await (const match of glob(pattern, { cwd: searchRoot, exclude: ignore })) {
      const target = await this.existing(resolve(searchRoot, match));
      matches.push(target);
      if (matches.length >= limit) break;
    }
    return matches;
  }

  imageMimeType(path: string): string | null {
    const mime = new Map([
      [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
      [".gif", "image/gif"], [".webp", "image/webp"],
    ]).get(extname(path).toLowerCase());
    return mime ?? null;
  }

  private async existing(path: string): Promise<string> {
    const target = this.inside(path);
    await this.assertNoLinks(target);
    return target;
  }

  private inside(path: string): string {
    const target = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    const relativePath = relative(this.root, target);
    if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
      return target;
    }
    throw new TypeError("Workspace path escaped the active assignment folder");
  }

  private async assertNoLinks(path: string): Promise<void> {
    const target = this.inside(path);
    const relativePath = relative(this.root, target);
    let cursor = this.root;
    for (const segment of relativePath.split(sep).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new TypeError("Symbolic links are not allowed in assignment workspaces");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
  }
}

function restrictedShell(workspaceDirectory: string): BashOperations {
  return {
    exec: async (command, _cwd, options) => {
      validateShellCommand(command);
      const timeout = Math.min(Math.max(options.timeout ?? SHELL_TIMEOUT_MS, 1_000), SHELL_TIMEOUT_MS);
      const executable = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
      const args = process.platform === "win32"
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
        : ["--noprofile", "--norc", "-c", command];
      const env = restrictedEnvironment(options.env);
      return new Promise<{ exitCode: number | null }>((resolvePromise, reject) => {
        const child = spawn(executable, args, {
          cwd: workspaceDirectory,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        const onAbort = () => child.kill();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => child.kill(), timeout);
        child.stdout?.on("data", options.onData);
        child.stderr?.on("data", options.onData);
        child.once("error", (error) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
        child.once("close", (exitCode) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          resolvePromise({ exitCode });
        });
      });
    },
  };
}

function validateShellCommand(command: string): void {
  const normalized = command.trim();
  if (!normalized || normalized.length > 20_000) throw new TypeError("Workspace shell commands must contain 1 to 20,000 characters");
  for (const blocked of BLOCKED_SHELL) {
    if (blocked.test(normalized)) {
      throw new TypeError("That command is outside this assignment's private workspace boundary");
    }
  }
  if (/\bpip(?:3|\.exe)?\s+install\b/i.test(normalized) && !/(?:^|[\\/])\.venv[\\/]/i.test(normalized)) {
    throw new TypeError("Install Python packages through this assignment's .venv, never globally");
  }
}

function restrictedEnvironment(source: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "COMSPEC", "TMP", "TEMP", "LANG", "LC_ALL"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = source?.[key] ?? process.env[key];
    if (value) env[key] = value;
  }
  env.STUDI_ASSIGNMENT_WORKSPACE = "1";
  return env;
}
