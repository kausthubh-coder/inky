import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseDocument, stringify } from "yaml";

import {
  ArtifactDocumentSchema,
  ArtifactFrontmatterSchema,
  ArtifactKindSchema,
  type ArtifactDocument,
  type ArtifactKind,
} from "../../shared/index.js";
import type { StudiSqliteDatabase } from "./database.js";
import { StorageError, errorMessage, isStorageError } from "./errors.js";

const artifactDirectories = {
  preference: "preferences",
  memory: "memories",
  workflow: "workflows",
  answer: "answers",
} as const satisfies Record<ArtifactKind, string>;

const safeArtifactId = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

export async function assertPlainArtifactTree(rootDirectoryValue: string): Promise<void> {
  const rootDirectory = resolve(rootDirectoryValue);
  let rootEntries;
  try {
    const rootMetadata = await lstat(rootDirectory);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw invalidArtifactTree("Artifact root must be a plain directory", rootDirectory);
    }
    rootEntries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  const expectedDirectories = new Set(Object.values(artifactDirectories));
  for (const entry of rootEntries) {
    const directory = join(rootDirectory, entry.name);
    const metadata = await lstat(directory);
    if (
      !expectedDirectories.has(entry.name as (typeof artifactDirectories)[ArtifactKind]) ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    ) {
      throw invalidArtifactTree("Artifact root contains an unexpected or linked entry", directory);
    }

    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const path = join(directory, child.name);
      const childMetadata = await lstat(path);
      if (
        !child.name.endsWith(".md") ||
        !childMetadata.isFile() ||
        childMetadata.isSymbolicLink()
      ) {
        throw invalidArtifactTree("Artifact directory contains a non-plain Markdown file", path);
      }
    }
  }
}

export class ArtifactStore {
  readonly rootDirectory: string;

  constructor(
    rootDirectory: string,
    private readonly database: StudiSqliteDatabase,
  ) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async write(value: unknown): Promise<ArtifactDocument> {
    let document: ArtifactDocument;
    try {
      document = ArtifactDocumentSchema.parse(value);
    } catch (error) {
      throw new StorageError(
        "record_validation_failed",
        `Invalid artifact document: ${errorMessage(error)}`,
        {},
        { cause: error },
      );
    }
    const target = this.resolveArtifactPath(document.frontmatter.kind, document.frontmatter.artifactId);
    await mkdir(resolve(target, ".."), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(serializeArtifact(document), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      this.database.injectFailure("artifact_before_rename");
      const { rename } = await import("node:fs/promises");
      await rename(temporary, target);
      return document;
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Cleanup below is best effort and must not mask the write failure.
      }
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          // The failure diagnostic retains the owned temporary path for manual cleanup.
        }
      }
      if (isStorageError(error)) {
        throw error;
      }
      throw new StorageError(
        "artifact_write_failed",
        `Atomic artifact write failed; the prior target was left in place: ${errorMessage(error)}`,
        { target, temporary },
        { cause: error },
      );
    }
  }

  async read(kindValue: unknown, artifactId: string): Promise<ArtifactDocument | null> {
    const kind = ArtifactKindSchema.parse(kindValue);
    const target = this.resolveArtifactPath(kind, artifactId);
    let source: string;
    try {
      source = await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    return parseArtifact(source, target, kind, artifactId);
  }

  async validateAll(): Promise<number> {
    await assertPlainArtifactTree(this.rootDirectory);
    let count = 0;
    for (const kind of ArtifactKindSchema.options) {
      const directory = join(this.rootDirectory, artifactDirectories[kind]);
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          throw new StorageError("backup_invalid", "Artifact backup contains an unexpected entry", {
            directory,
            entry: entry.name,
          });
        }
        const path = join(directory, entry.name);
        const artifactId = entry.name.slice(0, -3);
        const source = await readFile(path, "utf8");
        parseArtifact(source, path, kind, artifactId);
        count += 1;
      }
    }
    return count;
  }

  async exists(kind: ArtifactKind, artifactId: string): Promise<boolean> {
    const target = this.resolveArtifactPath(kind, artifactId);
    try {
      await access(target, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  path(kind: ArtifactKind, artifactId: string): string {
    return this.resolveArtifactPath(kind, artifactId);
  }

  async list(kindValue: unknown): Promise<ArtifactDocument[]> {
    const kind = ArtifactKindSchema.parse(kindValue);
    const directory = join(this.rootDirectory, artifactDirectories[kind]);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const documents: ArtifactDocument[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        throw invalidArtifactTree("Artifact directory contains a non-Markdown entry", join(directory, entry.name));
      }
      const artifactId = entry.name.slice(0, -3);
      const source = await readFile(join(directory, entry.name), "utf8");
      documents.push(parseArtifact(source, join(directory, entry.name), kind, artifactId));
    }
    return documents;
  }

  private resolveArtifactPath(kind: ArtifactKind, artifactId: string): string {
    if (!safeArtifactId.test(artifactId) || artifactId === "." || artifactId === "..") {
      throw new StorageError(
        "invalid_artifact_path",
        `Artifact ID is not a safe path segment: ${artifactId}`,
        { artifactId, kind },
      );
    }
    const directory = join(this.rootDirectory, artifactDirectories[kind]);
    const target = resolve(directory, `${artifactId}.md`);
    if (resolve(target, "..") !== resolve(directory)) {
      throw new StorageError("invalid_artifact_path", "Artifact path escaped its owned directory", {
        artifactId,
        kind,
      });
    }
    return target;
  }
}

function invalidArtifactTree(message: string, path: string): StorageError {
  return new StorageError("backup_invalid", message, { path });
}

function serializeArtifact(document: ArtifactDocument): string {
  const frontmatter = stringify(document.frontmatter, { lineWidth: 0 });
  return `---\n${frontmatter}---\n${document.content}`;
}

function parseArtifact(
  source: string,
  path: string,
  expectedKind: ArtifactKind,
  expectedArtifactId: string,
): ArtifactDocument {
  try {
    if (!source.startsWith("---\n")) {
      throw new Error("Missing opening frontmatter delimiter");
    }
    const closingOffset = source.indexOf("\n---\n", 4);
    if (closingOffset === -1) {
      throw new Error("Missing closing frontmatter delimiter");
    }
    const yamlSource = source.slice(4, closingOffset);
    const parsed = parseDocument(yamlSource, {
      schema: "core",
      uniqueKeys: true,
    });
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map((error) => error.message).join("; "));
    }
    const frontmatter = ArtifactFrontmatterSchema.parse(parsed.toJS({ maxAliasCount: 0 }));
    if (frontmatter.kind !== expectedKind || frontmatter.artifactId !== expectedArtifactId) {
      throw new Error("Frontmatter identity does not match the artifact path");
    }
    return ArtifactDocumentSchema.parse({
      frontmatter,
      content: source.slice(closingOffset + 5),
    });
  } catch (error) {
    throw new StorageError(
      "malformed_frontmatter",
      `Malformed artifact frontmatter in ${path}: ${errorMessage(error)}`,
      { path, expectedKind, expectedArtifactId },
      { cause: error },
    );
  }
}
