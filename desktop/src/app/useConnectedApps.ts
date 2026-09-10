import { useEffect, useRef, useState } from "react";
import type { ConnectedAppConnection, ConnectedAppsState } from "../../shared/index.js";
import { waitForAppConnection } from "./waitForAppConnection.js";

export type ConnectionFeedback = {
  phase: "checking" | "connecting" | "checked" | "idle" | "error";
  operation: "check" | "connect";
};
export type ConnectionFeedbackMap = Readonly<Record<string, ConnectionFeedback>>;

export function useConnectedApps(approved: boolean) {
  const [connectedApps, setConnectedApps] = useState<ConnectedAppsState | null>(null);
  const [appConnections, setAppConnections] = useState<Record<string, ConnectedAppConnection | null>>({});
  const [appConnectionFeedback, setFeedback] = useState<ConnectionFeedbackMap>({});
  const requests = useRef(new Set<string>());
  const lifetime = useRef(new AbortController());

  useEffect(() => {
    const studi = window.studi;
    const pending = new Set<string>();
    requests.current = pending;
    const controller = new AbortController();
    lifetime.current = controller;
    let cancelled = false;
    setConnectedApps(null);
    setAppConnections({});
    setFeedback({});
    if (!studi || !approved) return;
    void studi.getConnectedApps().then(state => {
      if (cancelled) return;
      setConnectedApps(state);
      if (!state.configured) return;
      for (const { toolkit } of state.toolkits) {
        pending.add(toolkit);
        setFeedback(current => ({ ...current, [toolkit]: { phase: "checking", operation: "check" } }));
        void studi.refreshConnectedApp({ toolkit }).then(connection => {
          if (cancelled) return;
          setAppConnections(current => ({ ...current, [toolkit]: connection }));
          setFeedback(current => ({ ...current, [toolkit]: { phase: "idle", operation: "check" } }));
        }).catch(() => {
          if (!cancelled) setFeedback(current => ({ ...current, [toolkit]: { phase: "error", operation: "check" } }));
        }).finally(() => pending.delete(toolkit));
      }
    }).catch(() => { /* The page explains that an online account is needed. */ });
    return () => { cancelled = true; controller.abort(); requests.current = new Set(); };
  }, [approved]);

  async function run(toolkit: string, operation: "check" | "connect", autoCheck = false) {
    const studi = window.studi;
    const pending = requests.current;
    const signal = lifetime.current.signal;
    if (!studi || !approved || pending.has(toolkit)) return;
    pending.add(toolkit);
    setFeedback(current => ({ ...current, [toolkit]: { phase: operation === "check" ? "checking" : "connecting", operation } }));
    try {
      const request = operation === "check" ? studi.refreshConnectedApp({ toolkit }) : studi.connectApp({ toolkit });
      const connection = autoCheck
        ? await waitForAppConnection({ initial: request, read: () => studi.refreshConnectedApp({ toolkit }), signal })
        : await request;
      if (requests.current !== pending) return;
      setAppConnections(current => ({ ...current, [toolkit]: connection }));
      setFeedback(current => ({ ...current, [toolkit]: { phase: "checked", operation } }));
    } catch {
      if (requests.current === pending) setFeedback(current => ({ ...current, [toolkit]: { phase: "error", operation } }));
    } finally {
      pending.delete(toolkit);
    }
  }

  return { connectedApps, appConnections, appConnectionFeedback, connectApp: (toolkit: string, autoCheck = false) => run(toolkit, "connect", autoCheck), refreshConnectedApp: (toolkit: string) => run(toolkit, "check") };
}
