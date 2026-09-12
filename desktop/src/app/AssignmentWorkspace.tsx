import { useState, type ReactNode } from "react";
import type { Assignment, LifecycleState, SchoolOnboardingState, TaskSummary } from "../../shared/index.js";
import { assignmentState, courseTone, taskStatusCopy } from "./assignmentPresentation.js";
import { AssignmentSummary } from "./AssignmentSummary.js";
import { AssignmentWork } from "./AssignmentWork.js";
import { HomeworkFiles } from "./HomeworkFiles.js";
import { Icon } from "./Icon.js";
import "./assignment-workspace.css";

type Tab = "assignment" | "files" | "work";
const tabs = [{ id: "assignment", label: "Assignment" }, { id: "files", label: "Files" }, { id: "work", label: "Inky’s work" }] as const;

export function AssignmentWorkspace({ assignment, task, execution, lifecycle, onboarding, busy, conversation, composer, browser, error, onClose, onBrowser, onCloseBrowser, onStart, onResume, onPause, onCancel, onOpenWork, onOpenSchoolCheck, onOpenRules, onOpenArtifact, onVerifySubmission }: {
  assignment: Assignment; task: TaskSummary | null; execution: LifecycleState["execution"];
  lifecycle: LifecycleState; onboarding: SchoolOnboardingState; busy: string | null;
  conversation: ReactNode; composer: ReactNode; browser: ReactNode; error: ReactNode;
  onClose: () => void; onBrowser: () => void; onCloseBrowser: () => void;
  onStart: (id: string) => void; onResume: (id: string) => void; onPause: (id: string) => void;
  onCancel: (id: string) => void; onOpenWork: () => void; onOpenSchoolCheck: () => void;
  onOpenRules: () => void; onOpenArtifact: (id: string) => void;
  onVerifySubmission: (id: string, text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("assignment");
  const [fileCount, setFileCount] = useState<number | null>(null);
  const course = onboarding.courses.find(course => course.courseId === assignment.courseId)?.label ?? assignment.courseId;
  const state = assignmentState(task, execution);
  const status = taskStatusCopy(state ?? "unknown");
  const due = assignment.dueAt ? new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(assignment.dueAt)) : assignment.dueText ?? "No due date listed";
  const selectTab = (next: Tab) => { onCloseBrowser(); setTab(next); };

  return <section className={`assignment-workspace course-accent-${courseTone(course)}`} aria-label="Assignment workspace">
    <header className="assignment-heading">
      <div className="assignment-course"><span className="course-dot" aria-hidden="true" />{course}</div>
      <h1>{assignment.title}</h1>
      <button className="chat-icon assignment-close" aria-label="Close assignment" onClick={onClose}><Icon name="close" /></button>
      <div className="assignment-meta">
        <span className="assignment-due"><Icon name="calendar" size={14} />{assignment.dueAt || assignment.dueText ? "Due " : ""}<time dateTime={assignment.dueAt}>{due}</time></span>
        <span className={`assignment-progress progress-${status.tone}`} role="status"><span aria-hidden="true">{state === "submitted" ? "✓" : "—"}</span>{status.label}</span>
        <button className="assignment-text-action" onClick={onBrowser} aria-expanded={Boolean(browser)}>Open school page ↗</button>
      </div>
    </header>
    <div className="assignment-body">
      <div className="assignment-page">
        <div className="assignment-tabs" role="tablist" aria-label="Assignment sections">
          {tabs.map(({ id, label }, index) => <button key={id} role="tab" id={`assignment-tab-${id}`}
            aria-controls={`assignment-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)} onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              selectTab(tabs[next]!.id);
              document.getElementById(`assignment-tab-${tabs[next]!.id}`)?.focus();
            }}>{label}{id === "files" && fileCount !== null && <span>{fileCount}</span>}</button>)}
        </div>
        {browser && <div className="assignment-school">{browser}</div>}
        <section className="assignment-page-scroll assignment-brief" role="tabpanel" id="assignment-panel-assignment" aria-labelledby="assignment-tab-assignment" hidden={Boolean(browser) || tab !== "assignment"} tabIndex={0}>
          <h2>Assignment instructions</h2>
          <p>{assignment.instructions ?? "No instructions saved yet. Open the school page for the full requirements."}</p>
          <button className="assignment-material-link" onClick={() => selectTab("files")}><Icon name="note" />Files for this assignment{fileCount !== null && <span>{fileCount}</span>}<Icon name="right" /></button>
        </section>
        <section className="assignment-page-scroll" role="tabpanel" id="assignment-panel-files" aria-labelledby="assignment-tab-files" hidden={Boolean(browser) || tab !== "files"} tabIndex={0}>
          <HomeworkFiles assignmentId={assignment.assignmentId} active={!browser && tab === "files"} onCount={setFileCount} />
        </section>
        <section className="assignment-page-scroll" role="tabpanel" id="assignment-panel-work" aria-labelledby="assignment-tab-work" hidden={Boolean(browser) || tab !== "work"} tabIndex={0}>
          <AssignmentWork execution={execution} state={state} busy={busy} onBrowser={onBrowser} onOpenArtifact={onOpenArtifact} onVerifySubmission={onVerifySubmission} />
        </section>
      </div>
      <aside className="assignment-inky" aria-label="Inky">
        <div className="assignment-inky-scroll">
          <AssignmentSummary assignment={assignment} task={task} execution={execution} lifecycle={lifecycle} onboarding={onboarding} busy={busy}
            onStart={onStart} onResume={onResume} onPause={onPause} onBrowser={state === "ready_review" ? () => selectTab("work") : onBrowser}
            onAnswer={() => selectTab("work")} onOpenWork={onOpenWork} onOpenSchoolCheck={onOpenSchoolCheck} onOpenRules={onOpenRules} />
          {execution && ["working", "needs_user", "ready_review"].includes(execution.phase) && <button className="assignment-text-action assignment-stop" disabled={busy !== null && !(busy === "assignment" && execution.phase === "working")} onClick={() => onCancel(execution.taskId)}>Stop work</button>}
          {error}
          {conversation}
        </div>
        {composer}
      </aside>
    </div>
  </section>;
}
