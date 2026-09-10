import type { ConnectedAppConnection } from "../../shared/composio.js";

// The browser sign-in can finish at any point. Only one status request runs at a time.
export async function waitForAppConnection({ initial, read, signal, intervalMs = 2_000, timeoutMs = 180_000 }: {
  initial: ConnectedAppConnection | null | Promise<ConnectedAppConnection | null>;
  read: () => Promise<ConnectedAppConnection | null>;
  signal: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<ConnectedAppConnection> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pause: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("Connection cancelled"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => reject(new Error("Connection timed out")), timeoutMs);
  });
  const poll = async () => {
    let connection = await initial;
    while (!stopped && !signal.aborted) {
      if (connection?.status.toUpperCase() === "ACTIVE") return connection;
      const status = connection?.status.toUpperCase();
      if (status && status !== "INITIATED" && status !== "INITIALIZING" && status !== "DISCONNECTED") throw new Error("Connection failed");
      await new Promise<void>(resolve => { pause = setTimeout(resolve, intervalMs); });
      if (stopped || signal.aborted) break;
      connection = await read();
    }
    throw new Error("Connection cancelled");
  };
  try {
    return await Promise.race([stop, poll()]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(pause);
    signal.removeEventListener("abort", onAbort);
  }
}
