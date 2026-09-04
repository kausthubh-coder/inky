import { type FormEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  classifyAgentRuntimeAttention,
  isLivePhase,
  type Assignment,
  type LifecycleState,
  type SchoolOnboardingState,
  type SchoolPageBounds,
  type StudiWorkspaceState,
  type TaskDetail,
  type TaskSummary,
} from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { PreviewSchoolPage } from "./PreviewSchoolPage.js";
import { Field, PaperCard, RuntimeAttentionBanner, StatusPill, executionLabel, formatDateTime, formatDue } from "./Ui.js";

export type DeskPanel =
  | { kind: "closed" }
  | { kind: "assignment"; assignmentId: string }
  | { kind: "desk" };

export function viewingLiveDesk(
  panel: DeskPanel,
  execution: LifecycleState["execution"] | null | undefined,
): boolean {
  return Boolean(
    execution &&
      isLivePhase(execution.phase) &&
      (panel.kind === "desk" || (panel.kind === "assignment" && panel.assignmentId === execution.assignmentId)),
  );
}

export function openAssignmentId(
  panel: DeskPanel,
  execution: LifecycleState["execution"] | null | undefined,
): string | null {
  if (panel.kind === "assignment") return panel.assignmentId;
  if (panel.kind === "desk") return execution?.assignmentId ?? null;
  return null;
}

export function talkKeyForPanel(
  panel: DeskPanel,
  execution: LifecycleState["execution"] | null | undefined,
): string | null {
  const openId = openAssignmentId(panel, execution);
  if (openId) return openId;
  return panel.kind === "desk" ? "desk" : null;
}

export function deskInkyState({
  execution,
  driver,
  scanState,
  runtimeAttention,
}: {
  execution?: LifecycleState["execution"];
  driver?: StudiWorkspaceState["browser"]["driver"];
  scanState?: NonNullable<SchoolOnboardingState["scan"]>["state"];
  runtimeAttention: ReturnType<typeof classifyAgentRuntimeAttention>;
}): InkyState {
  if (execution && isLivePhase(execution.phase)) {
    if (driver === "inky") return "steering";
    if (runtimeAttention !== "none" || execution.phase === "needs_user") return "needs";
    if (execution.phase === "working" || execution.phase === "submitting") return "working";
    if (execution.phase === "ready_review") return "waiting";
  }
  if (runtimeAttention !== "none" || scanState === "partial" || scanState === "failed" || scanState === "needs_user") return "needs";
  if (scanState === "running") return "scanning";
  if (scanState === "succeeded") return "done";
  return "idle";
}

export function DeskDrawer({
  panel,
  onboarding,
  workspace,
  lifecycle,
  detail,
  assignment,
  task,
  showingLiveDesk,
  busy,
  error,
  talk,
  onClose,
  onStart,
  onTalk,
  onTakeover,
  onResume,
  onCancel,
  onVerifySubmission,
  onOpenArtifact,
  onConnectRuntime,
  onSchoolSlot,
}: {
  panel: Exclude<DeskPanel, { kind: "closed" }>;
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  lifecycle: LifecycleState;
  detail: TaskDetail | null;
  assignment: Assignment | null;
  task: TaskSummary | null;
  showingLiveDesk: boolean;
  busy: string | null;
  error: string | null;
  talk: readonly { who: "you" | "inky"; text: string }[];
  onClose: () => void;
  onStart: (taskId: string) => void;
  onTalk: (prompt: string) => void;
  onTakeover: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onVerifySubmission: (taskId: string, confirmation: string) => void;
  onOpenArtifact: (taskId: string) => void;
  onConnectRuntime: () => void;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const slotRef = useRef<HTMLDivElement>(null);
  const execution = lifecycle.execution && (
    panel.kind === "desk" || lifecycle.execution.assignmentId === assignment?.assignmentId
  ) ? lifecycle.execution : null;
  const live = Boolean(execution && isLivePhase(execution.phase));
  const anyLive = Boolean(lifecycle.execution && isLivePhase(lifecycle.execution.phase));
  const desk = showingLiveDesk;
  const course = onboarding.courses.find((item) => item.courseId === assignment?.courseId);
  const runtimeAttention = classifyAgentRuntimeAttention(workspace?.provider, execution?.lastError ?? (onboarding.scan?.state === "failed" ? onboarding.scan.failures[0] : null));
  const inkyState = deskInkyState({
    ...(execution ? { execution } : {}),
    ...(workspace ? { driver: workspace.browser.driver } : {}),
    ...(onboarding.scan ? { scanState: onboarding.scan.state } : {}),
    runtimeAttention,
  });
  const currentTool = useMemo(() => currentToolName(detail), [detail]);
  const done = task && ["submitted", "preserved"].includes(task.task.state);
  const canStart = Boolean(task && ["discovered", "queued"].includes(task.task.state) && task.permission.mayAttempt && !anyLive);
  const title = assignment?.title ?? (desk ? "Inky’s desk" : "Assignment");
  const visibleDetail = detail && assignment && detail.assignment.assignmentId === assignment.assignmentId
    ? detail
    : detail && desk && !assignment && detail.assignment.assignmentId === execution?.assignmentId
      ? detail
      : null;

  useLayoutEffect(() => {
    if (!showingLiveDesk) {
      onSchoolSlot(null);
      return;
    }
    const node = slotRef.current;
    if (!node) {
      onSchoolSlot(null);
      return;
    }
    const report = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        onSchoolSlot(null);
        return;
      }
      onSchoolSlot({
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      onSchoolSlot(null);
    };
  }, [showingLiveDesk, onSchoolSlot]);

  const sendTalk = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    onTalk(prompt.trim());
    setPrompt("");
  };

  return (
    <aside className={`workspace-drawer ${desk ? "is-desk" : "is-peek"}`} aria-label={desk ? "Inky’s desk" : title}>
      <header className="drawer-head">
        <div className="drawer-who">
          <Inky state={inkyState} size={42} label={`Inky is ${inkyState}`} />
          <div>
            <p className="eyebrow">{desk ? "Inky’s desk" : course?.label ?? "Assignment"}</p>
            <strong>{desk ? (live ? executionLabel(execution!.phase) : "Ready when you are") : "Assignment"}</strong>
          </div>
        </div>
        <button className="quiet-button" type="button" onClick={onClose}>Close</button>
      </header>

      <section className="drawer-meta">
        <div>
          <p className="eyebrow">{course?.label ?? "Verified from school"}</p>
          <h2>{title}</h2>
          <p>{assignment ? formatDue(assignment.dueAt) : "Pick a week card, or start the next queued task."}</p>
        </div>
        {task && <StatusPill tone={done ? "mint" : live ? "yellow" : "plain"}>{task.task.state.replaceAll("_", " ")}</StatusPill>}
      </section>

      {live && execution && (
        <div className="drawer-actions">
          {execution.phase === "working" && <button className="button button--coral" type="button" onClick={() => onTakeover(execution.taskId)} disabled={busy !== null}>I’ll take over</button>}
          {execution.phase === "needs_user" && <button className="button button--yellow" type="button" onClick={() => onResume(execution.taskId)} disabled={busy !== null}>Inky, keep going</button>}
          <button className="button button--paper" type="button" onClick={() => onCancel(execution.taskId)} disabled={busy !== null || execution.phase === "submitting"}>Stop this</button>
        </div>
      )}

      {!live && canStart && task && (
        <button className="button button--yellow drawer-start" type="button" onClick={() => onStart(task.task.taskId)} disabled={busy !== null}>
          {busy === "assignment" ? "Inky is starting…" : "Make Inky do this"}
        </button>
      )}
      {!live && task && ["discovered", "queued"].includes(task.task.state) && task.permission.mayAttempt && anyLive && (
        <p className="drawer-note">Inky is already on another page.</p>
      )}
      {!live && task && !task.permission.mayAttempt && (
        <p className="drawer-note">Inky isn’t allowed to try this yet. Change that in Settings.</p>
      )}
      {!live && !task && assignment && (
        <p className="drawer-note">This page was checked, but Inky doesn’t have a task for it yet. Tell Inky below if something’s missing.</p>
      )}
      {!assignment && !live && (
        <p className="drawer-note">Nothing is on the desk. Open a week card, or tell Inky what to start.</p>
      )}

      <RuntimeAttentionBanner attention={runtimeAttention} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
      {execution?.returnPredicate && runtimeAttention === "none" && (
        <div className="truth-banner truth-banner--partial"><strong>Inky is waiting for you.</strong><span>{execution.lastError ?? execution.returnPredicate}</span></div>
      )}

      {showingLiveDesk && (
        <div className="drawer-school-pane">
          <div className="live-chip">
            <span className={execution?.phase === "working" ? "live-dot" : "live-dot is-paused"} />
            <strong>{currentTool ? `Using ${currentTool}` : executionLabel(execution?.phase ?? "working")}</strong>
            <small>Same school page Inky is on</small>
          </div>
          <div ref={slotRef} className="drawer-school-slot" data-school-slot="true" aria-label="Live school page">{readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}</div>
        </div>
      )}

      <div className="drawer-scroll">
        {visibleDetail && (done || (visibleDetail.attempts.length > 0 && !live)) && (
          <PaperCard tone="mint" className="drawer-card">
            <p className="eyebrow">Inky already worked on this</p>
            <h3>{visibleDetail.submissionReceipt?.verifiedStatus ?? `${visibleDetail.attempts.length} saved checkpoint${visibleDetail.attempts.length === 1 ? "" : "s"}`}</h3>
            {visibleDetail.submissionReceipt && <p>Checked on the page at {formatDateTime(visibleDetail.submissionReceipt.submittedAt)}.</p>}
            {visibleDetail.attempts.slice(-2).map((attempt) => (
              <p key={attempt.ordinal}><strong>{attempt.plan}</strong> {attempt.result}</p>
            ))}
            {visibleDetail.execution?.answerArtifactId && <button className="button button--mint" type="button" onClick={() => onOpenArtifact(visibleDetail.task.taskId)}>Open saved answers</button>}
          </PaperCard>
        )}

        {assignment && (
          <PaperCard className="drawer-card">
            <p className="eyebrow">From the school page</p>
            <dl className="detail-grid">
              <div><dt>Due</dt><dd>{formatDue(assignment.dueAt)}</dd></div>
              <div><dt>Checked</dt><dd>{assignment.evidence.length} page note{assignment.evidence.length === 1 ? "" : "s"}</dd></div>
              {task && <div><dt>Inky may</dt><dd>{task.permission.mode.replaceAll("_", " ")}</dd></div>}
            </dl>
            {task && <p>{task.permission.rationale}</p>}
          </PaperCard>
        )}

        {live && visibleDetail && (
          <PaperCard tone="paper" className="drawer-card">
            <p className="eyebrow">What Inky has done</p>
            <div className="activity-feed">
              {(visibleDetail.activity.length === 0) && <p>No live step yet.</p>}
              {visibleDetail.activity.map((event, index) => <ActivityRow key={`${event.type}-${index}`} event={event} />)}
            </div>
          </PaperCard>
        )}

        {execution?.phase === "ready_review" && (
          <PaperCard tone="coral" className="drawer-card">
            <p className="eyebrow">Your turn</p>
            <h3>The answers are still on the page.</h3>
            <p>{execution.reviewDeadline ? `Look before ${formatDateTime(execution.reviewDeadline)}.` : "Look over the page before you submit."}</p>
            {execution.completionChecklist && (
              <div className="completion-checklist" data-completion-checklist="true">
                {execution.completionChecklist.map((item, index) => (
                  <div key={`${item.requirement}-${index}`}>
                    <strong>{item.requirement}</strong>
                    <small>{item.evidence}</small>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={(event) => { event.preventDefault(); if (confirmation.trim()) onVerifySubmission(execution.taskId, confirmation.trim()); }}>
              <Field label="Words you see after you submit"><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Submitted" /></Field>
              <button className="button button--mint" disabled={!confirmation.trim() || busy !== null}>I submitted it</button>
            </form>
          </PaperCard>
        )}

        {talk.length > 0 && (
          <div className="drawer-talk-log" aria-live="polite">
            {talk.map((line, index) => (
              <p className={`drawer-bubble drawer-bubble--${line.who}`} key={`${line.who}-${index}`}>{line.text}</p>
            ))}
          </div>
        )}
      </div>

      <form className="drawer-talk" onSubmit={sendTalk}>
        <input
          aria-label={assignment ? `Talk to Inky about ${assignment.title}` : "Talk to Inky"}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={assignment ? "Ask Inky about this…" : "Tell Inky what to do…"}
          maxLength={20_000}
        />
        <button className="manager-send" disabled={busy !== null || !prompt.trim()}>{busy === "manager" ? "…" : "enter ↵"}</button>
      </form>
      {error && <p className="error-note" role="alert">{error}</p>}
    </aside>
  );
}

function currentToolName(detail: TaskDetail | null): string | null {
  if (!detail) return null;
  const open = new Set<string>();
  for (const event of detail.activity) {
    if (event.type === "tool_started") open.add(event.toolCallId);
    if (event.type === "tool_finished") open.delete(event.toolCallId);
  }
  const id = [...open].at(-1);
  if (!id) return null;
  for (let index = detail.activity.length - 1; index >= 0; index -= 1) {
    const event = detail.activity[index];
    if (event?.type === "tool_started" && event.toolCallId === id) return event.toolName;
  }
  return null;
}

function ActivityRow({ event }: { event: TaskDetail["activity"][number] }) {
  if (event.type === "text") return <div className="activity-row"><span>Inky</span><p>{event.delta}</p></div>;
  if (event.type === "tool_started") return <div className="activity-row activity-row--tool"><span>tool</span><p>Started {event.toolName}</p></div>;
  if (event.type === "tool_finished") return <div className="activity-row activity-row--tool"><span>tool</span><p>{event.toolName} {event.outcome}</p></div>;
  if (event.type === "terminal") return <div className="activity-row activity-row--state"><span>run</span><p>{event.outcome}{event.reason ? ` · ${event.reason}` : ""}</p></div>;
  return <div className="activity-row activity-row--state"><span>run</span><p>{event.type.replace("_", " ")}</p></div>;
}
