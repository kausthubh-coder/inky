import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";

/** `studi-file://<assignmentId>/<path>` serves a file from that assignment's folder, so the app can show PDFs and images in place. */
export const FILE_SCHEME = "studi-file";

export function registerFileSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

export function serveAssignmentFiles(resolveFile: (assignmentId: string, path: string) => Promise<string>): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const absolute = await resolveFile(url.hostname, path);
      return net.fetch(pathToFileURL(absolute).href);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
