import { type FormEvent, useMemo, useState } from "react";

import { classifyAgentRuntimeAttention, type LibraryState, type LifecycleState, type SchoolOnboardingState, type StudiWorkspaceState, type TaskDetail } from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";
import { Field, PaperCard, RuntimeAttentionBanner, StatusPill, executionLabel, formatDateTime, formatDue } from "./Ui.js";

export function DeskScreen({
  onboarding,
  workspace,
  lifecycle,
  library,
  detail,
  busy,
  error,
  onTakeover,
  onResume,
  onCancel,
  onVerifySubmission,
  onOpenArtifact,
  onConnectRuntime,
  onBack,
}: {
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  lifecycle: LifecycleState;
  library: LibraryState | null;
  detail: TaskDetail | null;
  busy: string | null;
  error: string | null;
  onTakeover: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onVerifySubmission: (taskId: string, confirmation: string) => void;
  onOpenArtifact: (taskId: string) => void;
  onConnectRuntime: () => void;
  onBack: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const execution = lifecycle.execution;
  const assignment = detail?.assignment ?? onboarding.assignments.find((item) => item.assignmentId === execution?.assignmentId);
  const course = onboarding.courses.find((item) => item.courseId === assignment?.courseId);
  const currentTool = useMemo(() => {
    const open = new Set<string>();
    for (const event of detail?.activity ?? []) {
      if (event.type === "tool_started") open.add(event.toolCallId);
      if (event.type === "tool_finished") open.delete(event.toolCallId);
    }
    const id = [...open].at(-1);
    if (!id) return null;
    for (let index = (detail?.activity.length ?? 0) - 1; index >= 0; index -= 1) {
      const event = detail?.activity[index];
      if (event?.type === "tool_started" && event.toolCallId === id) return event.toolName;
    }
    return null;
  }, [detail?.activity]);
  if (!execution) return null;
  const runtimeAttention = classifyAgentRuntimeAttention(workspace?.provider, execution.lastError);
  const inkyState: InkyState = workspace?.browser.driver === "inky"
    ? "steering"
    : runtimeAttention !== "none" || execution.phase === "needs_user" ? "needs" : execution.phase === "working" || execution.phase === "submitting" ? "working" : execution.phase === "ready_review" ? "waiting" : execution.phase === "submitted" || execution.phase === "preserved" ? "done" : "thinking";
  const submit = (event: FormEvent) => { event.preventDefault(); if (confirmation.trim()) onVerifySubmission(execution.taskId, confirmation.trim()); };

  return <main className="desk-shell" data-studi-app-ready="true"><header className="desk-chrome"><div className="brand-lockup"><Inky state={inkyState} size={52} label={`Inky is ${inkyState}`} /><div><strong>Studi’s desk</strong><small>{executionLabel(execution.phase)}</small></div></div><div className="desk-status"><StatusPill tone={execution.phase === "ready_review" ? "coral" : execution.phase === "needs_user" ? "yellow" : "mint"}>{execution.phase.replace("_", " ")}</StatusPill><button className="quiet-button" onClick={onBack}>Back to week</button></div></header><section className="desk-panel"><header className="task-hero"><div><p className="eyebrow">{course?.label ?? "Verified assignment"}</p><h1>{assignment?.title ?? execution.assignmentId}</h1><p>{formatDue(assignment?.dueAt)}</p></div><div className="live-chip"><span className={execution.phase === "working" ? "live-dot" : "live-dot is-paused"} /><strong>{currentTool ? `Using ${currentTool}` : executionLabel(execution.phase)}</strong><small>Browser revision {workspace?.browser.revision ?? "—"}</small></div></header><div className="desk-actions">{execution.phase === "working" && <button className="button button--coral" onClick={() => onTakeover(execution.taskId)} disabled={busy !== null}>Take over browser</button>}{execution.phase === "needs_user" && <button className="button button--yellow" onClick={() => onResume(execution.taskId)} disabled={busy !== null}>Resume Studi</button>}<button className="button button--paper" onClick={() => onCancel(execution.taskId)} disabled={busy !== null || execution.phase === "submitting"}>Cancel task</button></div><RuntimeAttentionBanner attention={runtimeAttention} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />{execution.returnPredicate && runtimeAttention === "none" && <div className="truth-banner truth-banner--partial"><strong>Studi is waiting for you.</strong><span>{execution.lastError ?? execution.returnPredicate}</span></div>}<div className="desk-grid"><PaperCard tone="yellow" className="desk-plan"><p className="eyebrow">Task plan</p><h2>{detail?.attempts.at(-1)?.plan ?? "Work from the current visible page, preserve evidence, and stop before an unapproved effect."}</h2><ol><li>Use the persistent school browser.</li><li>Record page evidence after meaningful actions.</li><li>{detail?.permission.maySubmit ? "Re-check permission before any submission." : "Leave completed work for your review."}</li></ol></PaperCard><PaperCard tone="lavender" className="queue-panel"><p className="eyebrow">Up next</p>{lifecycle.manager.entries.filter((item) => item.taskId !== execution.taskId).slice(0, 4).map((entry) => { const item = library?.tasks.find((task) => task.task.taskId === entry.taskId); return <div className="queue-item" key={entry.taskId}><strong>{item?.assignment.title ?? entry.assignmentId}</strong><small>{formatDue(entry.dueAt)}</small></div>; })}{lifecycle.manager.entries.filter((item) => item.taskId !== execution.taskId).length === 0 && <small>Nothing else is queued.</small>}</PaperCard><PaperCard tone="paper" className="activity-panel"><div className="card-heading"><div><p className="eyebrow">Live transcript and tools</p><h2>What Studi has actually done</h2></div><StatusPill tone={currentTool ? "sky" : "plain"}>{currentTool ?? "no tool active"}</StatusPill></div><div className="activity-feed">{(detail?.activity.length ?? 0) === 0 && <p>No live agent event has been recorded for this run yet.</p>}{detail?.activity.map((event, index) => <ActivityRow key={`${event.type}-${index}`} event={event} />)}{detail?.events.slice(-5).map((event) => <div className="activity-row activity-row--state" key={event.eventId}><span>state</span><p>{event.type === "task_created" ? "Task discovered" : `${event.payload.from} → ${event.payload.to}`}</p></div>)}</div></PaperCard><PaperCard tone="sky" className="evidence-panel"><p className="eyebrow">Retained evidence</p><h2>{detail?.attempts.length ?? 0} recovery checkpoint{detail?.attempts.length === 1 ? "" : "s"}</h2>{detail?.attempts.map((attempt) => <div className="evidence-row" key={attempt.ordinal}><span>{attempt.ordinal}</span><div><strong>{attempt.plan}</strong><p>{attempt.result}</p><small>{attempt.evidence.summary} · {formatDateTime(attempt.recordedAt)}</small></div></div>)}{detail?.execution?.reviewCheckpoint && <div className="evidence-row"><span>R</span><div><strong>Review checkpoint</strong><p>{detail.execution.reviewCheckpoint.summary}</p><small>{detail.execution.reviewCheckpoint.title}</small></div></div>}{(detail?.attempts.length ?? 0) === 0 && !detail?.execution?.reviewCheckpoint && <small>Evidence will appear after the worker records a recovery or review checkpoint.</small>}</PaperCard></div>{execution.phase === "ready_review" && <PaperCard tone="coral" className="review-panel"><div><p className="eyebrow">Human review</p><h2>The answers remain in the page.</h2><p>{execution.reviewDeadline ? `Review before ${formatDateTime(execution.reviewDeadline)}.` : "Review the visible school page before submitting."}{execution.handoffDeadline ? ` Studi keeps this browser handoff until ${formatDateTime(execution.handoffDeadline)}, then saves a local Markdown fallback and continues the queue.` : " If time expires, Studi saves a local Markdown fallback."}</p></div><form onSubmit={submit}><Field label="Text visible after you submit" hint="Studi verifies this exact text in the browser before recording a receipt."><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Submitted" /></Field><button className="button button--mint" disabled={!confirmation.trim() || busy !== null}>Verify my submission</button></form></PaperCard>}{detail?.submissionReceipt && <PaperCard tone="mint" className="receipt-panel"><p className="eyebrow">Verified receipt</p><h2>{detail.submissionReceipt.verifiedStatus}</h2><p>{formatDateTime(detail.submissionReceipt.submittedAt)}</p></PaperCard>}{execution.answerArtifactId && <button className="button button--mint" onClick={() => onOpenArtifact(execution.taskId)}>Open saved answer Markdown</button>}{error && <p className="error-note">{error}</p>}</section><aside className="native-browser-frame native-browser-frame--desk" aria-label="Live school browser"><div><span>Live school page</span><small>The same persistent browser remains visible during takeover</small></div></aside></main>;
}

function ActivityRow({ event }: { event: TaskDetail["activity"][number] }) {
  if (event.type === "text") return <div className="activity-row"><span>Studi</span><p>{event.delta}</p></div>;
  if (event.type === "tool_started") return <div className="activity-row activity-row--tool"><span>tool</span><p>Started {event.toolName}</p></div>;
  if (event.type === "tool_finished") return <div className="activity-row activity-row--tool"><span>tool</span><p>{event.toolName} {event.outcome}</p></div>;
  if (event.type === "terminal") return <div className="activity-row activity-row--state"><span>run</span><p>{event.outcome}{event.reason ? ` · ${event.reason}` : ""}</p></div>;
  return <div className="activity-row activity-row--state"><span>run</span><p>{event.type.replace("_", " ")}</p></div>;
}
