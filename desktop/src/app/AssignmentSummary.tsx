import type { Assignment, LifecycleState, SchoolOnboardingState, TaskSummary } from "../../shared/index.js";
import { assignmentState } from "./assignmentPresentation.js";
import { Icon } from "./Icon.js";
import { Inky } from "./Inky.js";

export function AssignmentSummary({ assignment, task, execution, lifecycle, onboarding, busy, onStart, onResume, onPause, onBrowser, onAnswer, onOpenWork, onOpenSchoolCheck, onOpenRules }: {
  assignment: Assignment;
  task: TaskSummary | null;
  execution: LifecycleState["execution"];
  lifecycle: LifecycleState;
  onboarding: SchoolOnboardingState;
  busy: string | null;
  onStart: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onPause: (taskId: string) => void;
  onBrowser: () => void;
  onAnswer: () => void;
  onOpenWork: () => void;
  onOpenSchoolCheck: () => void;
  onOpenRules: () => void;
}) {
  // Cancellation leaves a failed execution checkpoint alongside the cancelled task.
  const state = assignmentState(task, execution);
  const taskId = execution?.taskId ?? task?.task.taskId;
  const canStart = state !== undefined && ["discovered", "queued", "failed", "cancelled"].includes(state);
  const otherWork = (lifecycle.manager.lease && lifecycle.manager.lease.taskId !== task?.task.taskId)
    || (lifecycle.execution && lifecycle.execution.assignmentId !== assignment.assignmentId
      && ["working", "needs_user", "ready_review", "submitting"].includes(lifecycle.execution.phase));
  const scanActive = onboarding.scan?.state === "running" || onboarding.scan?.state === "needs_user";
  const blocked = (canStart || state === "needs_user") && task
    ? !task.permission.mayAttempt ? "Inky isn’t allowed to attempt this assignment."
        : otherWork ? "Inky has another assignment open. Finish or stop that work first."
          : scanActive ? "Finish the school check before Inky can work on this assignment."
            : null
    : null;
  let note = "I haven’t attempted this assignment yet.";
  let label = "Start assignment";
  let action = () => { if (task) onStart(task.task.taskId); };
  switch (state) {
    case "queued": note = "This assignment is waiting to start."; break;
    case "working":
      note = "I’m working on this assignment. You can pause me any time.";
      label = "Pause assignment";
      action = () => { if (taskId) onPause(taskId); };
      break;
    case "needs_user":
      note = execution?.lastError ?? execution?.returnPredicate ?? "I’ve paused here. Tell me when you’re ready to keep going.";
      label = "Resume assignment";
      action = () => { if (taskId) onResume(taskId); };
      break;
    case "ready_review":
      note = "Your work is ready to review on the school page.";
      label = "Review assignment";
      action = onBrowser;
      break;
    case "submitting":
      note = "I’m checking whether the school received your work.";
      label = "Checking submission…";
      break;
    case "submitted":
      note = "Submission confirmed on the school page.";
      label = "View submitted assignment";
      action = onBrowser;
      break;
    case "preserved":
      note = "Your answers are saved. Submission hasn’t been confirmed.";
      label = execution?.answerArtifactId ? "Review saved answers" : "View assignment source";
      action = execution?.answerArtifactId ? onAnswer : onBrowser;
      break;
    case "failed":
      note = execution?.lastError ?? "I couldn’t finish this assignment. You can try again.";
      label = "Try assignment again";
      break;
    case "cancelled":
      note = "Work on this assignment was stopped.";
      label = "Try assignment again";
      break;
    case "ignored":
      note = "This assignment is set to be left alone.";
      label = "View assignment source";
      action = onBrowser;
      break;
    case undefined:
      note = "I couldn’t load the work status. You can still open the school page.";
      label = "View assignment source";
      action = onBrowser;
  }
  const pending = otherWork ? null : busy === "assignment" ? (state === "needs_user" ? "Resuming…" : state === "ready_review" ? "Checking submission…" : canStart ? "Starting…" : null)
    : busy === "takeover" ? "Pausing…" : busy === "cancel" ? "Stopping…" : null;
  const heading = state === "working" ? "I’m on it." : state === "needs_user" ? "I’ve kept your place."
    : state === "ready_review" || state === "preserved" ? "Your work is ready."
      : state === "submitted" ? "All handed in." : state === "failed" ? "I hit a snag."
        : state === "cancelled" ? "We can start again." : state === "submitting" ? "Checking with your school."
          : state === "ignored" || blocked ? "Here when you need me." : "Ready when you are.";

  return <section className="assignment-summary" aria-label="Inky’s assignment progress">
      <div className="assignment-inky-intro"><Inky size={72} state={state === "working" || state === "submitting" ? "thinking" : "idle"} /><span>Inky</span></div>
      <h2 aria-live="polite">{heading}</h2>
      <p id="assignment-action-note" className={blocked ? "assignment-blocked" : ""}>{blocked ?? note}</p>
      <button className="button button--yellow assignment-primary" autoFocus onClick={action}
        disabled={(busy !== null && !(state === "working" && busy === "assignment")) || Boolean(blocked) || state === "submitting"}
        aria-describedby="assignment-action-note">
        <Icon name={state === "working" ? "hand" : state === "ready_review" || state === "preserved" || state === "submitted" ? "check" : "right"} />
        {pending ?? label}
      </button>
    {canStart && !blocked && task && <small className="assignment-permission">{task.permission.maySubmit ? "Can attempt and submit · your saved rule" : "Stops before submission · you review first"}</small>}
    {blocked && (!task?.permission.mayAttempt
      ? <button className="quiet-button" onClick={onOpenRules}>Homework rules <span aria-hidden="true">↗</span></button>
      : otherWork ? <button className="quiet-button" onClick={onOpenWork}>Go to current assignment <span aria-hidden="true">↗</span></button>
        : scanActive && <button className="quiet-button" onClick={onOpenSchoolCheck}>Open school check <span aria-hidden="true">↗</span></button>)}
  </section>;
}
