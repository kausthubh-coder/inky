import { useEffect, useRef, useState } from "react";
import type { NotificationIntent, UpdateState } from "../../shared/index.js";
import { Inky } from "./Inky.js";
import { Icon } from "./Icon.js";

const notificationKinds = {
  handoff: { icon: "hand", label: "Needs you" },
  review_ready: { icon: "check", label: "Ready to review" },
  scan_result: { icon: "search", label: "School scan" },
  failure: { icon: "warning", label: "Needs attention" },
} as const;

export function UpdateControls({
  onNotification,
}: {
  onNotification: (target: NotificationIntent["target"]) => void;
}) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [notes, setNotes] = useState<NotificationIntent[]>([]);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const update = useRef<HTMLDialogElement>(null);
  const notifications = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let mounted = true;
    const read = async () => {
      if (!window.studi) return;
      try {
        const [next, items] = await Promise.all([
          window.studi.getUpdateState(),
          window.studi.getNotifications(),
        ]);
        if (mounted) {
          setState(next);
          setNotes(items);
        }
      } catch {
        /* Keep the last snapshot; explicit actions report failure. */
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2500);
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
    if (!window.studi) return;
    setError("");
    try {
      const next = await (ready ? window.studi.installUpdate() : window.studi.checkForUpdates());
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
  const unread = notes.filter((note) => !note.clickedAt).length;
  return (
    <>
      <button
        className={`update-entry ${ready ? "is-ready" : ""}`}
        onClick={() => update.current?.showModal()}
      >
        {ready ? "App update ready" : "App updates"}
      </button>
      <button
        className="notification-toggle"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => notifications.current?.showModal()}
      >
        <Icon name="bell" />
        <span>Notifications</span>
        {unread > 0 && <b aria-hidden="true">{unread}</b>}
      </button>
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
        <Inky
          state={
            pending ? "thinking" : error || state?.error ? "needs" : "idle"
          }
          size={76}
          label="Inky"
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
              <span>→</span> <strong>{state.targetVersion}</strong>
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
          className="quiet-button"
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
      <dialog
        ref={notifications}
        className="studi-notifications"
        aria-labelledby="notifications-title"
      >
        <header>
          <div>
            <h2 id="notifications-title">Notifications</h2>
            <small>{unread ? `${unread} new` : "All caught up"}</small>
          </div>
          <button
            className="chat-icon"
            aria-label="Close notifications"
            onClick={() => notifications.current?.close()}
          >
            ×
          </button>
        </header>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
        {notes.length === 0 && (
          <p className="notification-empty">
            When there’s news about your work, it’ll be here.
          </p>
        )}
        {notes.map((note) => (
          <button
            key={note.notificationId}
            className={`notification-item ${note.clickedAt ? "is-read" : ""}`}
            onClick={() => {
              void window.studi
                ?.readNotification({ notificationId: note.notificationId })
                .then((items) => {
                  setNotes(items);
                  notifications.current?.close();
                  onNotification(note.target);
                })
                .catch(() =>
                  setError("Couldn’t mark that notification as read."),
                );
            }}
          >
            <span className={`notification-kind notification-kind--${note.kind}`}><Icon name={notificationKinds[note.kind].icon} size={18} />{notificationKinds[note.kind].label}</span>
            <strong>{note.title}</strong>
            <span>{note.body}</span>
            <time>{new Date(note.createdAt).toLocaleString()}</time>
          </button>
        ))}
      </dialog>
    </>
  );
}
