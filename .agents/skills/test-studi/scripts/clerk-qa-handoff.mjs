import { createServer } from "node:http";

const options = parseArgs(process.argv.slice(2));
const host = "127.0.0.1";
let authorizationUrl = null;

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${options.port}`);
  if (request.method === "GET" && requestUrl.pathname === "/health") {
    return json(response, 200, { ready: true, authorizationPending: authorizationUrl !== null });
  }
  if (request.method === "POST" && requestUrl.pathname === "/publish") {
    try {
      const body = await readBody(request);
      authorizationUrl = validateAuthorizationUrl(body, options.clerkHost);
      return json(response, 202, { accepted: true });
    } catch (error) {
      return json(response, 400, { accepted: false, error: formatError(error) });
    }
  }
  if (request.method === "GET" && requestUrl.pathname === "/claim") {
    if (!authorizationUrl) return json(response, 425, { ready: false });
    const claimed = authorizationUrl;
    authorizationUrl = null;
    response.writeHead(302, { location: claimed, "cache-control": "no-store" });
    response.end();
    setTimeout(() => server.close(), 1_000).unref();
    return;
  }
  return json(response, 404, { error: "not_found" });
});

server.listen(options.port, host, () => {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ready: true, claimUrl: `http://${host}:${options.port}/claim` })}\n`);
});
setTimeout(() => server.close(), 15 * 60_000).unref();

function parseArgs(argv) {
  const parsed = { port: 0, clerkHost: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--port") parsed.port = Number(argv[++index]);
    else if (argv[index] === "--clerk-host") parsed.clerkHost = argv[++index] ?? "";
    else fail(`unknown argument: ${argv[index]}`);
  }
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) fail("--port must be 1-65535");
  if (!/^[a-z0-9.-]+$/i.test(parsed.clerkHost)) fail("--clerk-host is invalid");
  return parsed;
}

function validateAuthorizationUrl(value, expectedHost) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.hostname !== expectedHost || url.pathname !== "/oauth/authorize") {
    throw new Error("unexpected Clerk authorization endpoint");
  }
  const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
  if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || callback.pathname !== "/callback") {
    throw new Error("callback must be an ephemeral loopback URL");
  }
  if (url.searchParams.get("code_challenge_method") !== "S256") throw new Error("PKCE S256 is required");
  for (const name of ["state", "nonce", "code_challenge"]) {
    if (!url.searchParams.get(name)) throw new Error(`missing ${name}`);
  }
  return url.toString();
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
