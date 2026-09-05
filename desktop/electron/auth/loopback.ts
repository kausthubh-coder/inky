import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface LoopbackCallback {
  readonly redirectUri: string;
  readonly tokenRedirectUri: string;
  readonly code: Promise<string>;
  close(): Promise<void>;
}

export async function openLoopbackCallback(
  expectedState: string,
  timeoutMs = 5 * 60_000,
): Promise<LoopbackCallback> {
  let consumed = false;
  let settled = false;
  let callbackPort = 0;
  let tokenRedirectUri = "";
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  void code.catch(() => undefined);
  const server = createServer((request, response) => {
    const callbackOrigin = trustedCallbackOrigin(request.headers.host, callbackPort);
    if (!callbackOrigin) {
      respond(response, 400, "Studi could not verify this sign-in address. Return to the app and try again.", () => {
        settleReject(new Error("OAuth callback host validation failed"));
      });
      return;
    }
    const requestUrl = new URL(request.url ?? "/", callbackOrigin);
    if (requestUrl.pathname !== "/callback") {
      respond(response, 404, "This address is only for Studi sign-in.");
      return;
    }
    if (consumed) {
      respond(response, 410, "This Studi sign-in response was already used.");
      return;
    }
    consumed = true;
    const error = requestUrl.searchParams.get("error");
    const state = requestUrl.searchParams.get("state");
    const authorizationCode = requestUrl.searchParams.get("code");
    if (error || state !== expectedState || !authorizationCode) {
      respond(response, 400, "Studi could not verify this sign-in response. Return to the app and try again.", () => {
        settleReject(new Error(error ? "Authorization was not completed" : "OAuth callback validation failed"));
      });
      return;
    }
    tokenRedirectUri = `${callbackOrigin}/callback`;
    respond(response, 200, "Got it. Return to Studi while I finish signing you in.", () => {
      settleResolve(authorizationCode);
    });
  });
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  callbackPort = address.port;
  tokenRedirectUri = `http://127.0.0.1:${callbackPort}/callback`;
  const timer = setTimeout(() => {
    settleReject(new Error("Studi sign-in timed out"));
    void closeServer(server);
  }, timeoutMs);
  timer.unref();

  const settleResolve = (authorizationCode: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveCode(authorizationCode);
    setImmediate(() => void closeServer(server));
  };
  const settleReject = (error: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectCode(error);
    setImmediate(() => void closeServer(server));
  };

  return {
    redirectUri: `http://127.0.0.1:${callbackPort}/callback`,
    get tokenRedirectUri() {
      return tokenRedirectUri;
    },
    code,
    close: async () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        rejectCode(new Error("Studi sign-in was cancelled"));
      }
      await closeServer(server);
    },
  };
}

function trustedCallbackOrigin(hostHeader: string | undefined, expectedPort: number): string | null {
  const match = /^(127\.0\.0\.1|localhost):(\d{1,5})$/i.exec(hostHeader ?? "");
  if (!match || Number(match[2]) !== expectedPort) return null;
  const hostname = match[1]!.toLowerCase();
  return `http://${hostname}:${expectedPort}`;
}

function respond(
  response: import("node:http").ServerResponse,
  status: number,
  message: string,
  complete?: () => void,
): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>Studi sign-in</title><body style="font-family:system-ui;padding:40px;background:#fbf7ec;color:#29251f"><h1>${escapeHtml(message)}</h1></body>`, complete);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
