import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadItem, Event, Session, WebContents } from "electron";
import type { HomeworkFiles } from "../files/homework-files.js";

const MAX_BYTES = 50_000_000;

// Native clicks, POST responses and blob downloads must keep their original
// browser request. Stage privately, then use the same material importer as the
// file picker. Never let Electron choose the system Downloads directory.
export function installSchoolDownloads(session: Session, options: {
  stagingRoot: string;
  destination(contents: WebContents): Promise<HomeworkFiles>;
  onError(error: Error): void;
  onSaved?(path: string): void;
}): () => void {
  const pending = new Set<() => void>();
  const download = (event: Event, item: DownloadItem, contents: WebContents) => {
    let directory = "";
    let source: string;
    try {
      if (item.getTotalBytes() > MAX_BYTES) throw new Error("School files must be smaller than 50 MB.");
      mkdirSync(options.stagingRoot, { recursive: true });
      directory = mkdtempSync(join(options.stagingRoot, "download-"));
      let name = item.getFilename().normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 160);
      if (!name || name.startsWith(".") || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = "school-file.bin";
      source = join(directory, name);
      item.setSavePath(source);
    } catch (cause) {
      event.preventDefault();
      if (directory) void rm(directory, {recursive:true, force:true}).catch(() => {});
      options.onError(asError(cause));
      return;
    }
    let failure: Error | undefined;
    let disposed = false;
    let finished = false;
    const cancel = () => { disposed = true; if (!finished) item.cancel(); };
    pending.add(cancel);
    const destination = options.destination(contents).then(
      files => files,
      cause => { failure = asError(cause); if (!finished) item.cancel(); return null; },
    );
    const timer = setTimeout(() => {
      failure = new Error("The school download took too long. Try again.");
      item.cancel();
    }, 120_000);
    item.on("updated", () => {
      if (item.getReceivedBytes() > MAX_BYTES) {
        failure = new Error("School files must be smaller than 50 MB.");
        item.cancel();
      }
    });
    item.once("done", (_event, state) => {
      finished = true;
      clearTimeout(timer);
      void (async () => {
        try {
          const files = await destination;
          if (disposed) return;
          if (failure) throw failure;
          if (state !== "completed" || !files) throw new Error("The school download was interrupted. Try again.");
          const path = await files.importFile(source);
          options.onSaved?.(path);
        } catch (cause) {
          options.onError(asError(cause));
        } finally {
          pending.delete(cancel);
          await rm(directory, { recursive: true, force: true });
        }
      })().catch(cause => options.onError(asError(cause)));
    });
  };
  session.on("will-download", download);
  return () => {
    session.removeListener("will-download", download);
    for (const cancel of pending) cancel();
  };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
