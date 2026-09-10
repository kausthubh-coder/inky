import { connectedAppIsPending, type ConnectedAppConnection } from "./composio.js";

/** Reconcile browser OAuth completion without overlapping requests or persisting its redirect URL. */
export function watchConnection(options: {
  refresh: () => Promise<ConnectedAppConnection>;
  onConnection: (connection: ConnectedAppConnection) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
  timeoutMs?: number;
}) {
  let disposed = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  const refresh = async () => {
    if (disposed || busy) return;
    busy = true;
    clearTimeout(timer);
    let pending = true;
    try {
      const connection = await options.refresh();
      if (disposed) return;
      // A new authorization may not be visible in the provider's account list yet.
      const propagating = connection.status.toUpperCase() === "DISCONNECTED" && Date.now() < deadline;
      if (!propagating) options.onConnection(connection);
      pending = propagating || connectedAppIsPending(connection);
      if (!pending) disposed = true;
    } catch (error) {
      if (!disposed) options.onError(error);
    } finally {
      busy = false;
      if (!disposed && pending && Date.now() < deadline) {
        timer = setTimeout(() => void refresh(), options.intervalMs ?? 5_000);
      }
    }
  };
  void refresh();
  return { refresh, dispose() { disposed = true; clearTimeout(timer); } };
}
