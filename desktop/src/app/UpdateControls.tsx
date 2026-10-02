import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "../../shared/index.js";
import { Character } from "./Character.js";
import { Icon } from "./Icon.js";
import { studiApi } from "./studiApi.js";


/** "Update ready" appears in the bar only when a new Studi is waiting. */
export function UpdateControls() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const update = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let mounted = true;
    const read = async () => {
      if (!studiApi()) return;
      try {
        const next = await studiApi()!.getUpdateState();
        if (mounted) setState(next);
      } catch {
        /* Keep the last snapshot; explicit actions report failure. */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 60_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  const ready = state?.phase === "ready";
  const pending =
    state &&
    ["checking", "downloading", "preparing_restart"].includes(state.phase);
  const act = async () => {
    if (!studiApi()) return;
    setError("");
    try {
      const next = await (ready ? studiApi()!.installUpdate() : studiApi()!.checkForUpdates());
      setState(next);
      if (ready && state?.capability === "manual" && !next.error) setDownloaded(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The update could not finish.",
      );
    }
  };
  const title = !state
    ? "Checking this version…"
    : state.capability === "unavailable"
      ? "You’re using a development build."
      : state.phase === "checking"
        ? "Looking for an update…"
        : state.phase === "downloading"
          ? "Getting things ready…"
          : state.phase === "preparing_restart"
            ? "Saving your place…"
            : ready
              ? "A new Studi is ready."
              : state.phase === "error"
                ? "Couldn’t check for updates."
                : "Keep Studi up to date.";
  return (
    <>
      {ready && (
        <button
          className="update-entry is-ready"
          onClick={() => update.current?.showModal()}
        >
          Update ready
        </button>
      )}
      <dialog
        className="studi-update-dialog"
        ref={update}
        aria-labelledby="update-title"
      >
        <button
          className="chat-icon dialog-close"
          aria-label="Close updates"
          onClick={() => update.current?.close()}
        >
          ×
        </button>
        <Character
          state={
            pending ? "thinking" : error || state?.error ? "needs" : "idle"
          }
          size={76}
          label="Dot"
        />
        <p className="update-kicker">STUDI UPDATES</p>
        <h2 id="update-title">{title}</h2>
        <p role="status">
          {state?.capability === "unavailable"
            ? "Install a packaged version of Studi to receive app updates."
            : ready && state?.capability === "manual"
              ? "Download the Mac app, then replace Studi in Applications."
              : ready
                ? "Restart to install the update. Your saved work stays here."
                : "You can keep using Studi while I check."}
        </p>
        <div className="update-version">
          Version {state?.installedVersion ?? "…"}
          {state?.targetVersion && (
            <>
              {" "}
              <span><Icon name="forward" size={14} /></span> <strong>{state.targetVersion}</strong>
            </>
          )}
        </div>
        {ready && state?.notes && (
          <div className="update-notes">
            <h3>What’s new</h3>
            <p>{state.notes}</p>
          </div>
        )}
        {(error || state?.error) && (
          <p className="chat-error" role="alert">
            {error || state?.error}
          </p>
        )}
        {ready && state?.restartBlock && (
          <p className="update-block">
            {state.capability === "manual"
              ? "You can download now. Finish your work before replacing the app."
              : state.restartBlock}
          </p>
        )}
        <button
          className="button button--yellow update-primary"
          disabled={
            !state ||
            Boolean(pending) ||
            state.capability === "unavailable" ||
            Boolean(
              ready && state.capability === "native" && state.restartBlock,
            )
          }
          onClick={() => void act()}
        >
          {pending
            ? "One moment…"
            : ready
              ? state?.capability === "manual"
                ? "Download for Mac"
                : "Restart & update"
              : "Check for updates"}
        </button>
        <button
          className="rd-quiet"
          onClick={() => update.current?.close()}
        >
          {ready ? "Later" : "Close"}
        </button>
        <small>
          {downloaded
            ? "Save your work, quit Studi, open the downloaded DMG, replace Studi in Applications, then reopen."
            : state?.capability === "manual"
              ? "Unsigned Mac build · download and replace"
              : "Your saved work stays with you."}
        </small>
      </dialog>
    </>
  );
}
