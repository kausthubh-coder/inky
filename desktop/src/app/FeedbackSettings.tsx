import { useRef, useState } from "react";

export function FeedbackSettings({ busy, onFeedback }: {
  busy: boolean;
  onFeedback: (context: string, message: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const sending = useRef(false);
  return <div id="feedback-settings">
    <form className="settings-note" onSubmit={async event => {
      event.preventDefault();
      if (!note.trim() || busy || sending.current) return;
      sending.current = true; setStatus("sending");
      try {
        const accepted = await onFeedback("settings", note.trim());
        setStatus(accepted ? "sent" : "failed");
        if (accepted) setNote("");
      } catch { setStatus("failed"); }
      finally { sending.current = false; }
    }}>
      <label> Your note<textarea rows={4} value={note} disabled={status === "sending"} onChange={event => { setNote(event.target.value); setStatus("idle"); }} maxLength={1000} placeholder="I expected… but what happened was…" /></label>
      <small>Only this note is sent with your Studi account. No screenshot, chat, schoolwork, or diagnostics are attached.</small>
      <button className="st-outline" disabled={!note.trim() || busy || status === "sending"}>{status === "sending" ? "Sending…" : status === "failed" ? "Try sending again" : "Send feedback"}</button>
      <p role="status" aria-live="polite">{status === "sent" ? "Thanks — the Studi team received your note." : status === "failed" ? "Your note wasn’t confirmed as sent. It’s still here so you can try again." : ""}</p>
    </form>
  </div>;
}
