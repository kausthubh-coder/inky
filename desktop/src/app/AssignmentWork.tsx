import { useEffect, useState } from "react";
import type { LifecycleState } from "../../shared/index.js";
import { Icon } from "./Icon.js";

export function AssignmentWork({ execution, state, busy, onBrowser, onOpenArtifact, onVerifySubmission }: {
  execution: LifecycleState["execution"]; state: string | undefined; busy: string | null;
  onBrowser: () => void; onOpenArtifact: (id: string) => void;
  onVerifySubmission: (id: string, text: string) => void;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const artifactId = execution?.answerArtifactId;
  useEffect(() => {
    let current = true;
    setAnswer(null);
    setError("");
    setLoading(Boolean(artifactId));
    if (artifactId) void window.studi?.readArtifact({ kind: "answer", artifactId }).then(document => {
      if (!document) throw new Error("This saved answer is no longer available.");
      if (current) setAnswer(document.content);
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [artifactId, retry]);

  return <div className="assignment-work">
    <div className="assignment-section-heading"><h2>Inky’s work</h2>{artifactId && execution && <button className="assignment-text-action" onClick={() => onOpenArtifact(execution.taskId)}>Open saved file ↗</button>}</div>
    {loading && <p role="status">Loading your saved answer…</p>}
    {error && <div className="assignment-file-error" role="alert"><p>{error}</p><button className="assignment-text-action" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
    {answer !== null && <article className="assignment-document" aria-label="Saved answer"><h3>Saved answer</h3><pre>{answer}</pre></article>}
    {!artifactId && <p className="assignment-empty-copy">{state === "discovered" || state === "queued" || !state ? "Nothing here yet. Start the assignment and I’ll keep your work here."
      : state === "working" ? "I’m working on your assignment. Saved answers will appear here."
        : state === "ready_review" ? "Your answer is on the school page, ready for you to review."
          : "There’s no saved answer file for this assignment. You can check the school page for your work."}</p>}
    {Boolean(execution?.completionChecklist?.length) && <section className="assignment-checklist" aria-label="Completed requirements"><h3>What I checked</h3>{execution?.completionChecklist?.map((item, index) => <div key={index}><Icon name="check" size={15} /><span><strong>{item.requirement}</strong><p>{item.evidence}</p></span></div>)}</section>}
    {state === "preserved" && <p className="assignment-empty-copy">Your answers are saved. Submission hasn’t been confirmed.</p>}
    {state === "submitted" && <p className="assignment-submitted"><Icon name="check" />Submission confirmed on the school page.</p>}
    {execution && <button className="assignment-text-action" onClick={onBrowser}>{state === "submitted" ? "View submission" : "Review on school page"} ↗</button>}
    {state === "ready_review" && execution && <form className="assignment-review" onSubmit={event => {
      event.preventDefault();
      if (confirmation.trim() && busy === null) onVerifySubmission(execution.taskId, confirmation.trim());
    }}>
      <h3>After you hand it in</h3>
      <p>Submit on the school page, then tell me the confirmation you see.</p>
      <label>Words shown after submission<input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="For example: Submitted successfully" maxLength={500} /></label>
      <button className="button" disabled={!confirmation.trim() || busy !== null}>I submitted it — check</button>
    </form>}
  </div>;
}
