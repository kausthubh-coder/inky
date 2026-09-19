import { useEffect, useState, type ReactNode } from "react";
import type {
  Assignment,
  LifecycleState,
  SchoolOnboardingState,
  TaskSummary,
  TaskDetail,
} from "../../shared/index.js";
import { assignmentState, taskStatusCopy } from "./assignmentPresentation.js";
import { assignmentActivity } from "./assignmentActivity.js";
import { AssignmentSummary } from "./AssignmentSummary.js";
import { AssignmentWork } from "./AssignmentWork.js";
import { HomeworkFiles } from "./HomeworkFiles.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Inky } from "./Inky.js";
import "./assignment-workspace.css";

export function AssignmentWorkspace({
  assignment,
  task,
  execution,
  lifecycle,
  onboarding,
  busy,
  conversation,
  composer,
  browser,
  error,
  onClose,
  onBrowser,
  onCloseBrowser,
  onStart,
  onCheckAssignment,
  onResume,
  onPause,
  onCancel,
  onOpenWork,
  onOpenSchoolCheck,
  onOpenRules,
  onOpenArtifact,
  onVerifySubmission,
}: {
  assignment: Assignment;
  task: TaskSummary | null;
  execution: LifecycleState["execution"];
  lifecycle: LifecycleState;
  onboarding: SchoolOnboardingState;
  busy: string | null;
  conversation: ReactNode;
  composer: ReactNode;
  browser: ReactNode;
  error: ReactNode;
  onClose: () => void;
  onBrowser: () => void;
  onCloseBrowser: () => void;
  onStart: (id: string) => void;
  onResume: (id: string) => void;
  onPause: (id: string) => void;
  onCheckAssignment: (assignmentId: string) => void;
  onCancel: (id: string) => void;
  onOpenWork: () => void;
  onOpenSchoolCheck: () => void;
  onOpenRules: () => void;
  onOpenArtifact: (id: string) => void;
  onVerifySubmission: (id: string, text: string) => void;
}) {
  const [pane, setPane] = useState<"page" | "files">("page");
  const [fileCount, setFileCount] = useState(0);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [fileError, setFileError] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let alive = true,
      reading = false;
    const read = async () => {
      if (!task || reading) return;
      reading = true;
      try {
        const next = await window.studi!.getTaskDetail({
          taskId: task.task.taskId,
        });
        if (alive) setDetail(next);
      } catch (cause) {
        if (alive)
          setFileError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [task?.task.taskId]);
  const state = assignmentState(task, execution);
  const status = taskStatusCopy(state ?? "unknown", assignment);
  const receipt =
    detail?.submissionReceipt ??
    (lifecycle.submissionReceipt?.taskId === task?.task.taskId
      ? lifecycle.submissionReceipt
      : null);
  const activity = execution?.actions?.length
    ? execution.actions.map((line) => ({
        key: line.actionId,
        text: line.label,
        kind:
          line.kind === "text"
            ? "voice"
            : line.kind === "retry"
              ? "retry"
              : "action",
      }))
    : assignmentActivity(detail?.activity ?? execution?.activity ?? []);
  const phase = execution?.phase;
  const headline =
    phase === "working"
      ? "I’m on it."
      : phase === "needs_user"
        ? "I need a hand."
        : phase === "ready_review"
          ? "Ready for your eyes."
          : phase === "submitting"
            ? "Handing it in."
            : phase === "submitted"
              ? "Handed in."
              : phase === "failed"
                ? "I got stuck."
                : phase === "preserved"
                  ? "Your work is saved."
                  : "Let’s get this done.";
  const select = (next: "page" | "files") => {
    setPane(next);
    if (next === "files") onCloseBrowser();
    else onBrowser();
  };
  const addFiles = async () => {
    if (adding) return;
    setAdding(true);
    setFileError("");
    try {
      const result = await window.studi!.importAssignmentFiles({
        assignmentId: assignment.assignmentId,
      });
      setFileError(
        result.errors.map((item) => item.name + ": " + item.message).join("\n"),
      );
      if (result.imported.length) select("files");
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(false);
    }
  };
  const deadline = execution?.handoffDeadline ?? execution?.reviewDeadline;
  return (
    <section className="rd-workspace" aria-label="Assignment workspace">
      <header className="rd-work-heading">
        <button className="rd-link" onClick={onClose}>
          ← Back
        </button>
        <strong>{assignment.title}</strong>
        <span className={"rd-work-status progress-" + status.tone}>
          {status.label}
        </span>
      </header>
      <div className="rd-work-body">
        <aside className="rd-work-side" aria-label="Inky’s progress">
          <div className="rd-work-side-scroll">
            <div className="rd-work-voice">
              <Inky
                size={50}
                state={
                  phase === "working" || phase === "submitting"
                    ? "thinking"
                    : "idle"
                }
              />
              <h1>{headline}</h1>
            </div>
            {execution?.lastError && (
              <p className="rd-error" role="alert">
                {execution.lastError}
              </p>
            )}
            {phase === "working" && execution && (
              <div className="rd-actions">
                <button
                  className="rd-link"
                  disabled={busy !== null}
                  onClick={() => onPause(execution.taskId)}
                >
                  Pause
                </button>
                <button
                  className="rd-link danger"
                  disabled={busy !== null}
                  onClick={() => onCancel(execution.taskId)}
                >
                  Stop work
                </button>
              </div>
            )}
            {phase === "needs_user" && execution && (
              <>
                <p>
                  {execution.returnPredicate ??
                    "Take over on the school page, then let me know when you’re ready."}
                </p>
                <div className="rd-file-drop">
                  <span>Notes, a rubric, or a file I need?</span>
                  <button
                    className="rd-button"
                    disabled={adding}
                    onClick={() => void addFiles()}
                  >
                    {adding ? "Adding…" : "Choose files"}
                  </button>
                </div>
                <button
                  className="rd-button primary"
                  disabled={busy !== null}
                  onClick={() => onResume(execution.taskId)}
                >
                  {/sign.?in|log.?in/i.test(execution.returnPredicate ?? "")
                    ? "I’ve signed in. Continue"
                    : "I’m ready. Continue"}
                </button>
              </>
            )}
            {phase === "ready_review" && execution && (
              <>
                {execution.doubts?.length ? (
                  <section className="rd-doubts">
                    <h2>A few things to look at</h2>
                    {execution.doubts.map((doubt, index) => (
                      <p key={index}>
                        <strong>{doubt.where}</strong>
                        <br />
                        {doubt.why}
                      </p>
                    ))}
                  </section>
                ) : (
                  <p>
                    I’ve finished the work. Have a look before handing it in.
                  </p>
                )}
                <details>
                  <summary>What I checked</summary>
                  {execution.completionChecklist?.map((item, index) => (
                    <p key={index}>
                      ✓ <strong>{item.requirement}</strong>
                      <br />
                      {item.evidence}
                    </p>
                  ))}
                </details>
                <details>
                  <summary>Your answers</summary>
                  <ChatMarkdown
                    text={
                      execution.answerSnapshot ??
                      "Your answers are on the school page."
                    }
                  />
                </details>
                <div className="rd-review-answer">
                  <AssignmentWork
                    execution={execution}
                    state={state}
                    busy={busy}
                    onBrowser={onBrowser}
                    onOpenArtifact={onOpenArtifact}
                    onVerifySubmission={onVerifySubmission}
                  />
                </div>
                {task?.permission.maySubmit && (
                  <button
                    className="rd-button primary"
                    disabled={busy !== null || adding}
                    onClick={() => {
                      setAdding(true);
                      void window
                        .studi!.submitAssignmentByRule({
                          taskId: execution.taskId,
                        })
                        .catch((cause) => setFileError(String(cause)))
                        .finally(() => setAdding(false));
                    }}
                  >
                    Submit by rule
                  </button>
                )}
                <div className="rd-actions">
                  <button
                    className="rd-link"
                    disabled={busy !== null}
                    onClick={() => onPause(execution.taskId)}
                  >
                    Let me edit
                  </button>
                  <button
                    className="rd-link danger"
                    disabled={busy !== null}
                    onClick={() => onCancel(execution.taskId)}
                  >
                    Discard
                  </button>
                </div>
              </>
            )}
            {phase === "submitting" && (
              <ol className="rd-checkpoints">
                <li>✓ Answers saved</li>
                <li>
                  {receipt
                    ? "✓ Submission confirmed"
                    : "Checking the school’s confirmation…"}
                </li>
              </ol>
            )}
            {phase === "submitted" && (
              <>
                <p>{receipt?.verifiedStatus ?? "Submission confirmed."}</p>
                <button className="rd-button primary" onClick={onClose}>
                  Back to Today
                </button>
              </>
            )}
            {(phase === "failed" || phase === "preserved") && (
              <>
                <p>
                  {execution?.answerArtifactId
                    ? "Your answer file is saved."
                    : "I haven’t confirmed a submission."}
                </p>
                {execution?.answerArtifactId && (
                  <button
                    className="rd-link"
                    onClick={() => onOpenArtifact(execution.taskId)}
                  >
                    Open saved work ↗
                  </button>
                )}
                <button
                  className="rd-button primary"
                  disabled={busy !== null}
                  onClick={() =>
                    onStart(task?.task.taskId ?? assignment.assignmentId)
                  }
                >
                  Try again
                </button>
              </>
            )}
            {!execution && (
              <AssignmentSummary
                assignment={assignment}
                task={task}
                execution={execution}
                lifecycle={lifecycle}
                onboarding={onboarding}
                busy={busy}
                onStart={onStart}
                onCheckAssignment={onCheckAssignment}
                onResume={onResume}
                onPause={onPause}
                onBrowser={onBrowser}
                onAnswer={onOpenWork}
                onOpenWork={onOpenWork}
                onOpenSchoolCheck={onOpenSchoolCheck}
                onOpenRules={onOpenRules}
              />
            )}
            {deadline && (
              <p className="rd-deadline">
                I’ll wait until{" "}
                {new Date(deadline).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                . Your saved work stays here.
              </p>
            )}
            {activity.length > 0 && (
              <details className="rd-activity" open={phase === "working"}>
                <summary>What I’m doing</summary>
                <ol>
                  {activity.map((line) => (
                    <li key={line.key} className={line.kind}>
                      <ChatMarkdown text={line.text} />
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {fileError && (
              <p className="rd-error" role="alert">
                {fileError}
              </p>
            )}
            {error}
            <div className="rd-side-conversation">{conversation}</div>
          </div>
          {composer}
        </aside>
        <div className="rd-work-stage">
          {phase === "submitted" && receipt ? (
            <article className="rd-receipt">
              <Inky size={64} state="idle" />
              <h1>Handed in.</h1>
              <p>{receipt.verifiedStatus}</p>
              <time>{new Date(receipt.submittedAt).toLocaleString()}</time>
              <div className="rd-receipt-pair">
                <section>
                  <h2>Before</h2>
                  <p>{receipt.preSubmit.title}</p>
                  <pre>{receipt.preSubmit.summary}</pre>
                </section>
                <section>
                  <h2>After</h2>
                  <p>{receipt.postSubmit.title}</p>
                  <pre>{receipt.postSubmit.summary}</pre>
                </section>
              </div>
              <button className="rd-link" onClick={onBrowser}>
                View school page ↗
              </button>
            </article>
          ) : (
            <>
              {fileCount > 0 && (
                <nav className="rd-work-tabs" aria-label="Assignment view">
                  <button
                    aria-pressed={pane === "page"}
                    onClick={() => select("page")}
                  >
                    School page
                  </button>
                  <button
                    aria-pressed={pane === "files"}
                    onClick={() => select("files")}
                  >
                    Files <span>{fileCount}</span>
                  </button>
                </nav>
              )}
              <div className="rd-stage-page" hidden={pane !== "page"}>
                {browser || (
                  <div className="rd-brief">
                    <h2>{assignment.title}</h2>
                    <ChatMarkdown
                      text={
                        assignment.instructions ??
                        "Open the school page to see this assignment."
                      }
                    />
                    <button className="rd-button" onClick={onBrowser}>
                      Open school page ↗
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <div
            className="rd-stage-files"
            hidden={pane !== "files" || phase === "submitted"}
          >
            <HomeworkFiles
              assignmentId={assignment.assignmentId}
              active
              onCount={setFileCount}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
