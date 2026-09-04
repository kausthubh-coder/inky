import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  classifyAgentRuntimeAttention,
  isLivePhase,
  type Assignment,
  type LifecycleState,
  type SchoolOnboardingState,
  type SchoolPageBounds,
  type StudiWorkspaceState,
  type TaskDetail,
  type TaskState,
  type TaskSummary,
} from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { PreviewSchoolPage } from "./PreviewSchoolPage.js";
import { Field, PaperCard, RuntimeAttentionBanner, StatusPill, formatDateTime } from "./Ui.js";

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
  const [browserExpanded, setBrowserExpanded] = useState(false);
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
  }, [showingLiveDesk, browserExpanded, onSchoolSlot]);

  useEffect(() => {
    if (!showingLiveDesk) setBrowserExpanded(false);
  }, [showingLiveDesk]);

  useEffect(() => {
    if (!browserExpanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrowserExpanded(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [browserExpanded]);

  const sendTalk = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    onTalk(prompt.trim());
    setPrompt("");
  };

  const status = task ? taskStatusCopy(task.task.state) : null;

  return (
    <aside className={`workspace-drawer ${desk ? "is-desk" : "is-peek"}`} aria-label={desk ? "Inky’s desk" : title}>
      <header className="drawer-head">
        <div className="drawer-who">
          <Inky state={inkyState} size={56} label={`Inky is ${inkyState}`} />
          <p className="drawer-speech">{inkyLine({ assignment, live, execution, currentTool, desk })}</p>
        </div>
        <button className="drawer-close" type="button" onClick={onClose} aria-label="Close">Close</button>
      </header>

      {assignment && (live || course) && (
        <p className="drawer-course">{live ? assignment.title : course?.label}</p>
      )}

      {assignment && (
        <div className="drawer-facts">
          <p>{dueSentence(assignment.dueAt)}</p>
          {task && <p>{permissionLine(task)}</p>}
          {!live && assignment.evidence.length > 0 && <p>I already looked at the page.</p>}
        </div>
      )}

      {status && (
        <div className="drawer-status">
          <StatusPill tone={live && execution?.phase === "ready_review" ? "coral" : live && execution?.phase === "needs_user" ? "coral" : live ? "yellow" : status.tone}>
            {live && execution?.phase === "ready_review" ? "Look this over" : live && execution?.phase === "needs_user" ? "Need you" : live ? "I’m on it" : status.label}
          </StatusPill>
        </div>
      )}

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
        <p className="drawer-note">I’m already on another page.</p>
      )}
      {!live && task && !task.permission.mayAttempt && (
        <p className="drawer-note">You haven’t let me try this yet. That’s in Settings.</p>
      )}
      {!live && !task && assignment && (
        <p className="drawer-note">I saw this page, but I don’t have a task for it yet. Tell me if something’s missing.</p>
      )}
      {!assignment && !live && (
        <p className="drawer-note">Nothing’s on the desk. Open a week card, or tell me what to start.</p>
      )}

      <RuntimeAttentionBanner attention={runtimeAttention} workspace={workspace} busy={busy !== null} onConnect={onConnectRuntime} />
      {execution?.returnPredicate && runtimeAttention === "none" && (
        <div className="truth-banner truth-banner--partial"><strong>I need you here.</strong><span>{execution.lastError ?? execution.returnPredicate}</span></div>
      )}

      {showingLiveDesk && !browserExpanded && (
        <div className="drawer-school-pane">
          <button
            className="live-chip live-chip--browser"
            type="button"
            aria-expanded="false"
            onClick={() => {
              setBrowserExpanded(true);
              if (execution?.phase === "working" && busy === null) onTakeover(execution.taskId);
            }}
          >
            <span className={execution?.phase === "working" ? "live-dot" : "live-dot is-paused"} />
            <span><strong>{liveChipLine(execution?.phase ?? "working", currentTool)}</strong><small>The page I’m on</small></span>
            <span className="live-chip__action">Expand ↗</span>
          </button>
          <div ref={slotRef} className="drawer-school-slot" data-school-slot="true" aria-label="Live school page">{readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}</div>
        </div>
      )}

      {showingLiveDesk && browserExpanded && createPortal(
        <div className="browser-modal-backdrop">
          <section className="browser-modal" role="dialog" aria-modal="true" aria-label="School browser">
            <header className="browser-modal__head">
              <div>
                <span className={execution?.phase === "working" || execution?.phase === "submitting" ? "live-dot" : "live-dot is-paused"} />
                <span>
                  <strong>{execution?.phase === "working" ? "Pausing Inky…" : "The browser is yours"}</strong>
                  <small>{assignment?.title ?? "School page"}</small>
                </span>
              </div>
              <button className="button button--paper" type="button" autoFocus onClick={() => setBrowserExpanded(false)}>Back to Inky</button>
            </header>
            <div ref={slotRef} className="browser-modal__slot" data-school-slot="true" aria-label="Expanded live school page">
              {readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}
            </div>
          </section>
        </div>,
        document.body,
      )}

      <div className="drawer-scroll">
        {visibleDetail && (done || (visibleDetail.attempts.length > 0 && !live)) && (
          <PaperCard className="drawer-card">
            <p className="eyebrow">Already did this</p>
            <h3>{visibleDetail.submissionReceipt?.verifiedStatus ?? (visibleDetail.attempts.length === 1 ? "I saved a checkpoint" : `I saved ${visibleDetail.attempts.length} checkpoints`)}</h3>
            {visibleDetail.submissionReceipt && <p>Checked on the page at {formatDateTime(visibleDetail.submissionReceipt.submittedAt)}.</p>}
            {visibleDetail.attempts.slice(-2).map((attempt) => (
              <p key={attempt.ordinal}><strong>{attempt.plan}</strong> {attempt.result}</p>
            ))}
            {visibleDetail.execution?.answerArtifactId && <button className="button button--mint" type="button" onClick={() => onOpenArtifact(visibleDetail.task.taskId)}>Open saved answers</button>}
          </PaperCard>
        )}

        {execution?.phase === "ready_review" && (
          <PaperCard className="drawer-card drawer-card--nudge">
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
          placeholder={assignment ? "I’m listening…" : "Tell me what to do…"}
          maxLength={20_000}
        />
        <button className="manager-send" disabled={busy !== null || !prompt.trim()}>{busy === "manager" ? "…" : "say it"}</button>
      </form>
      {error && <p className="error-note" role="alert">{error}</p>}
    </aside>
  );
}

export function taskStatusCopy(state: TaskState | string): { label: string; tone: "plain" | "mint" | "yellow" | "coral" } {
  if (state === "submitted" || state === "preserved") return { label: "Done", tone: "mint" };
  if (state === "working" || state === "submitting") return { label: "I’m on it", tone: "yellow" };
  if (state === "needs_user") return { label: "Need you", tone: "coral" };
  if (state === "ready_review") return { label: "Look this over", tone: "coral" };
  if (state === "failed" || state === "cancelled") return { label: "Stopped", tone: "coral" };
  if (state === "ignored") return { label: "Left alone", tone: "plain" };
  return { label: "Ready", tone: "plain" };
}

function inkyLine({
  assignment,
  live,
  execution,
  currentTool,
  desk,
}: {
  assignment: Assignment | null;
  live: boolean;
  execution: LifecycleState["execution"] | null;
  currentTool: string | null;
  desk: boolean;
}): string {
  if (live && execution) {
    if (execution.phase === "needs_user") return "I need you on this one.";
    if (execution.phase === "ready_review") return "Take a look when you can.";
    if (execution.phase === "submitting") return "Checking that it went in.";
    if (currentTool) return `I’m using ${currentTool} on the school page.`;
    return "I’m on the school page.";
  }
  if (assignment) return `Want me to do ${assignment.title}?`;
  if (desk) return "Ready when you are.";
  return "Pick a week card and I’ll sit with it.";
}

function dueSentence(dueAt?: string): string {
  if (!dueAt) return "No due date.";
  const due = new Date(dueAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const days = Math.round((dueDay - today) / 86_400_000);
  const hour = due.getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 20 ? "evening" : "night";
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(due);
  if (days === 0) return part === "night" || part === "evening" ? "Due tonight." : `Due this ${part}.`;
  if (days === 1) return `Due tomorrow ${part}.`;
  if (days > 1 && days < 7) return `Due ${weekday} ${part}.`;
  if (days < 0 && days > -7) return `Was due ${weekday}.`;
  const later = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due);
  if (days <= -7) return `Was due ${later}.`;
  return `Due ${later}.`;
}

function permissionLine(task: TaskSummary): string {
  if (!task.permission.mayAttempt) return "You haven’t let me try this yet.";
  if (task.permission.mode === "auto_submit") return "I can try this and submit if that’s allowed.";
  return "I can try this and stop before submit.";
}

function liveChipLine(phase: string, tool: string | null): string {
  if (tool) return `Using ${tool}`;
  if (phase === "needs_user") return "Waiting for you";
  if (phase === "ready_review") return "Ready for you";
  if (phase === "submitting") return "Checking submit";
  return "On the page";
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
