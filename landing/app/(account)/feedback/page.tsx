"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../../../convex/_generated/api";
import { track } from "../../../lib/analytics";

export default function FeedbackPage() {
  const submitFeedback = useMutation(api.feedback.submitWeb);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitFeedback({ feedbackId: crypto.randomUUID(), message: message.trim() });
      track("feedback_sent", { placement: "account" });
      setMessage("");
      setSent(true);
    } catch {
      setError("I couldn’t send that note. Give it another try in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-card feedback-card">
      <p className="eyebrow">A note for us</p>
      <h1>Tell Inky what felt weird.</h1>
      <p>Missing homework, confusing words, a button that did nothing—send the messy version. It goes straight to the private beta team.</p>
      <form className="account-feedback-form" onSubmit={onSubmit}>
        <label htmlFor="feedback-message">What happened?</label>
        <textarea
          id="feedback-message"
          rows={7}
          maxLength={1_000}
          required
          placeholder="I expected… but instead…"
          value={message}
          onChange={(event) => { setMessage(event.target.value); setSent(false); }}
          disabled={busy}
        />
        <div className="dashboard-actions">
          <button className="btn primary" disabled={busy || !message.trim()}>
            {busy ? "Sending…" : "Send note"}
          </button>
          {sent ? <span className="feedback-sent" role="status">Got it. Thank you ♡</span> : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
