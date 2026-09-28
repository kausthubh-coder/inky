import "./assignment-workspace.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  assignmentWorkEligibility,
  homeworkRecord,
  isLivePhase,
  type AgentMessage,
  type Assignment,
  type HomeworkRecord,
  type LifecycleState,
  type SchoolOnboardingState,
  type SchoolPageBounds,
  type StudiWorkspaceState,
  type TaskDetail,
  type TaskSummary,
} from "../../shared/index.js";
import type { DotState } from "../../shared/characters/states.js";
import { Character } from "./Character.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { HomeworkFiles } from "./HomeworkFiles.js";
import { HomeworkMenu } from "./HomeworkMenu.js";
import { MemorySaved } from "./MemorySaved.js";
import { RULE_LABELS } from "./HomeworkHome.js";
import { focusRulesOn } from "./HomeworkRules.js";
import { Icon, type IconName } from "./Icon.js";
import { PreviewSchoolPage } from "./PreviewSchoolPage.js";
import { courseLabel, courseTone } from "./assignmentPresentation.js";
import { planFor, threadSteps, tipsFor, workTabName, workedFor, type ThreadStep } from "./assignmentThread.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { onEngineChange } from "./engineChanges.js";
import { shortCourse } from "./homeworkText.js";
import { useSchoolSlot } from "./schoolSlot.js";

type Tab = "receipt" | "site" | "work" | "details";

/** What the chat box says, from where the assignment is. */
export function composerPlaceholder(state: HomeworkRecord["state"] | undefined, needs?: string): string {
  if (state === "not_started" || state === "scheduled" || state === "left_to_you") return "Tell Dot how you want it done…";
  if (state === "working") return "Steer Dot as it works…";
  if (state === "waiting" && needs === "answer") return "Type your answer…";
  if (state === "ready") return "Ask for a change…";
  return "Ask Dot about this…";
}

export function AssignmentWorkspace({
  assignment, task, execution, lifecycle, onboarding, workspace, busy, messages, thinking, composer, error,
  onClose, onBrowser, onSchoolSlot, onStart, onResume, onPause, onCancel, onOpenWork, onOpenRules, onOpenArtifact, onRetry, onSuggest,
}: {
  assignment: Assignment;
  task: TaskSummary | null;
  execution: LifecycleState["execution"];
  lifecycle: LifecycleState;
  onboarding: SchoolOnboardingState;
  workspace: StudiWorkspaceState | null;
  busy: string | null;
  messages: readonly AgentMessage[];
  thinking: boolean;
  composer: ReactNode;
  error: ReactNode;
  onClose: () => void;
  onBrowser: () => void;
  onSchoolSlot: (bounds: SchoolPageBounds | null) => void;
  onStart: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onPause: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onOpenWork: () => void;
  onOpenRules: () => void;
  onOpenArtifact: (taskId: string) => void;
  onRetry: (message: AgentMessage) => void;
  onSuggest: (text: string) => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [picked, setPicked] = useState<{ state: string; tab: Tab } | null>(null);
  const [steps, setSteps] = useState(false);
  const [handing, setHanding] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [settled, setSettled] = useState<number[]>([]);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let reading = false;
    const read = async () => {
      if (!task || reading) return;
      reading = true;
      try {
        const next = await window.studi!.getTaskDetail({ taskId: task.task.taskId });
        if (alive) setDetail(next);
      } catch (cause) {
        if (alive) setProblem(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const stop = onEngineChange(["homework"], () => void read());
    return () => { alive = false; stop(); };
  }, [task?.task.taskId]);

  const run = execution ?? detail?.execution ?? null;
  const entry = lifecycle.manager.entries.find((item) => item.assignmentId === assignment.assignmentId);
  const base = homeworkRecord({ assignment, task: task?.task ?? null, execution: run, mayAttempt: task?.permission.mayAttempt ?? false });
  const record: HomeworkRecord = entry && base.state === "not_started" ? { state: "scheduled" } : base;
  const state = record.state;
  const receipt = detail?.submissionReceipt ?? (lifecycle.submissionReceipt?.taskId === task?.task.taskId ? lifecycle.submissionReceipt : null);
  const doubts = run?.phase === "ready_review" ? run.doubts ?? [] : [];
  const open = doubts.filter((_, index) => !settled.includes(index)).length;
  const course = courseLabel(assignment.courseId, onboarding.courses);
  const driving = workspace?.browser.driver === "inky" && run?.phase === "working";
  const otherLive = lifecycle.execution && lifecycle.execution.assignmentId !== assignment.assignmentId && isLivePhase(lifecycle.execution.phase);
  const taskId = run?.taskId ?? task?.task.taskId;

  // Settled doubts are remembered per run, so leaving the page doesn't undo them.
  const settleKey = run ? `studi-settled:${run.taskId}:${run.reviewCheckpoint?.revision ?? 0}` : null;
  useEffect(() => {
    try { setSettled(settleKey ? JSON.parse(localStorage.getItem(settleKey) ?? "[]") : []); } catch { setSettled([]); }
  }, [settleKey]);
  const settle = (index: number) => {
    const next = [...new Set([...settled, index])];
    setSettled(next);
    if (settleKey) localStorage.setItem(settleKey, JSON.stringify(next));
  };
  useEffect(() => { if (state !== "ready") setHanding(false); }, [state]);

  const auto: Tab = handing ? "site" : ({
    not_started: "details", left_to_you: "details", scheduled: "details", yours: "details", ignored: "details",
    working: "site", waiting: record.needs === "answer" || record.needs === "files" ? "work" : "site",
    ready: "work", handing_in: "site", handed_in: receipt ? "receipt" : "site", handed_in_at_school: "site", stopped: "work", stuck: "site",
  } as const)[state];
  const tabs: Tab[] = [...(receipt ? ["receipt" as const] : []), "site", "work", "details"];
  const tab = picked?.state === state && tabs.includes(picked.tab) ? picked.tab : auto;
  const choose = (next: Tab) => setPicked({ state, tab: next });

  useEffect(() => {
    if (tab === "site") onBrowser();
  }, [tab === "site"]);
  useEffect(() => {
    thread.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [messages.length, run?.actions?.length, state, thinking]);

  const act = async (operation: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setProblem("");
    try { await operation(); } catch (cause) { setProblem(cause instanceof Error ? cause.message : String(cause)); } finally { setPending(false); }
  };
  const disabled = busy !== null || pending;
  const openRules = () => { focusRulesOn(assignment.assignmentId); onOpenRules(); };
  const addFiles = () => void act(async () => {
    const result = await window.studi!.importAssignmentFiles({ assignmentId: assignment.assignmentId });
    if (result.errors.length) throw new Error(result.errors.map((item) => `${item.name}: ${item.message}`).join("\n"));
    if (result.imported.length && run?.phase === "needs_user") onResume(run.taskId);
  });
  const setOwner = (owner: "student" | "inky") => void act(() => window.studi!.setAssignmentOwner({ assignmentId: assignment.assignmentId, owner }));

  const move = yourMove();
  const siteHost = hostOf(workspace?.browser.url);
  const siteName = !siteHost || siteHost === hostOf(onboarding.profile?.schoolRoot) || siteHost === hostOf(assignment.sourceTarget) ? "School page" : siteHost;
  const tabName: Record<Tab, string> = { receipt: "Receipt", site: siteName, work: workTabName(assignment.kind), details: "Details" };
  const tabIcon: Record<Tab, IconName> = { receipt: "stamp", site: "globe", work: assignment.kind === "code" ? "code" : assignment.kind === "essay" ? "file" : "list", details: "info" };

  return (
    <section className="ag" aria-label="Assignment workspace">
      <header className="ag-head">
        <button className="rd-quiet ag-back" aria-label="Back to your week" onClick={onClose}><Icon name="back" size={16} /> Week</button>
        <span className={`hw-tone course-accent-${courseTone(course, onboarding.courses)}`} />
        <h1>{assignment.title}</h1>
        <span className="ag-meta">{shortCourse(course)} · {dueText(assignment, state)}</span>
        <HomeworkMenu assignment={assignment} done={["handed_in", "handed_in_at_school", "ignored"].includes(state)} busy={disabled} onChange={(operation) => void act(operation)} />
      </header>
      <div className="ag-body">
        <section className="ag-convo" aria-label="Dot's work on this assignment">
          <div className="ag-thread" ref={thread} role="log" aria-live="polite">{threadView()}</div>
          {problem && <p className="rd-error" role="alert">{problem}</p>}
          {error}
          {move && (
            <section className="ag-move" aria-label="Your move">
              <h2>{move.title}</h2>
              {move.body && <p>{move.body}</p>}
              {move.extra}
              {move.actions && <div className="ag-acts">{move.actions}</div>}
            </section>
          )}
          {composer}
        </section>
        <section className="ag-view" aria-label="What Dot is working on">
          <nav className="ag-tabs" aria-label="Assignment view">
            {tabs.map((name) => (
              <button key={name} aria-pressed={tab === name} onClick={() => choose(name)}>
                <Icon name={tabIcon[name]} size={16} />{tabName[name]}{name === "site" && driving && <i className="ag-live" aria-hidden="true" />}
              </button>
            ))}
          </nav>
          {tab === "site" && (
            <div className="ag-chrome">
              <span className="ag-url">{workspace?.browser.url && workspace.browser.url !== "about:blank" ? workspace.browser.url.replace(/^https?:\/\//, "") : assignment.sourceTarget?.replace(/^https?:\/\//, "") ?? "No page yet"}</span>
              {driving && <span className="ag-using"><i />Dot is using this page</span>}
              {driving && run && <button className="rd-button" disabled={disabled} onClick={() => onPause(run.taskId)}><Icon name="hand" size={14} /> Take over</button>}
            </div>
          )}
          <div className="ag-pane">
            {tab === "site" && <SitePane onSlot={onSchoolSlot} />}
            {tab === "work" && workPane()}
            {tab === "details" && detailsPane()}
            {tab === "receipt" && receipt && receiptPane(receipt)}
          </div>
        </section>
      </div>
    </section>
  );

  function threadView(): ReactNode[] {
    const out: { key: string; node: ReactNode; dot?: DotState }[] = [];
    const dot = (key: string, body: ReactNode, mood: DotState = "idle", time?: string) => out.push({ key, dot: mood, node: <><div className="ag-who"><Character state={mood} size={34} label="Dot" />Dot{time && <small>{time}</small>}</div>{body}</> });
    const talk = (list: readonly AgentMessage[]) => list.forEach((message) => {
      if (message.role === "user") out.push({ key: message.messageId, node: <div className="ag-you">{message.text}</div> });
      else {
        dot(message.messageId, <>
          <div className="ag-text"><ChatMarkdown text={message.text} /></div>
          {message.memories?.map((memory) => <MemorySaved key={memory.noteId} title={memory.title} noteId={memory.noteId} />)}
          {message.recovery === "failed" && <button className="rd-button ag-indent" disabled={thinking} onClick={() => onRetry(message)}>Try again</button>}
        </>, "idle", clock(message.createdAt));
      }
    });
    const startedAt = run?.startedAt ?? null;
    const before = startedAt ? messages.filter((message) => message.createdAt < startedAt) : messages;
    const after = startedAt ? messages.filter((message) => message.createdAt >= startedAt) : [];
    const started = Boolean(run) && !["not_started", "scheduled", "left_to_you", "yours", "handed_in_at_school", "ignored"].includes(state);

    if (state === "handed_in_at_school") dot("school", <p>The school already has this one, so I left it alone. Ask me anything about it.</p>);
    if (state === "yours") dot("yours", <p>This one's yours, so I won't touch it. I can still explain it or check your answers if you ask.</p>);
    if (state === "ignored") dot("ignored", <p>You marked this as {assignment.ignoredReason === "already_done" ? "done" : "not homework"}, so I left it alone.</p>);
    if (!started && ["not_started", "scheduled", "left_to_you"].includes(state)) {
      const lead = state === "left_to_you" ? "Your rule leaves this one to you." : state === "scheduled" ? `I'll start ${entry?.scheduledStartAt ? whenText(entry.scheduledStartAt) : "as soon as I'm free"}.` : "Ready when you are.";
      dot("hello", <p>{lead} {planFor(assignment.kind)}</p>, "hello");
    }
    talk(before);
    if (!started && !before.length && ["not_started", "scheduled"].includes(state)) {
      out.push({ key: "tips", node: <div className="ag-tips">{tipsFor(assignment.kind).map((tip) => <button key={tip} onClick={() => onSuggest(tip)}><Icon name="right" size={14} />{tip}</button>)}</div> });
    }
    if (started && run) {
      const allSteps = threadSteps(run.actions ?? []);
      const working = run.phase === "working" || run.phase === "submitting";
      const plan = allSteps.find((step) => step.kind === "text");
      const calls = allSteps.filter((step) => step.kind !== "text");
      if (startedAt) out.push({ key: "started", node: <div className="ag-sys">Started · {clock(startedAt)}</div> });
      const took = workedFor(run);
      dot("run", working || steps
        ? <>{allSteps.map((step) => <Step key={stepKey(step)} step={step} />)}
            {!working && <button className="ag-fold" onClick={() => setSteps(false)}>Hide steps <Icon name="down" size={14} /></button>}</>
        : <>{plan?.kind === "text" && <div className="ag-text"><ChatMarkdown text={plan.text} /></div>}
            {calls.length > 0 && <button className="ag-fold" onClick={() => setSteps(true)}><Icon name="check" size={14} />{took ? `Worked for ${took}` : "Worked"} · {calls.length} {calls.length === 1 ? "step" : "steps"} <Icon name="down" size={14} /></button>}</>,
        working ? (driving ? "steering" : "working") : "idle", startedAt ? clock(startedAt) : undefined);
    }
    talk(after);
    if (run?.phase === "working") (run.notices ?? []).forEach((notice, index) => dot(`notice-${index}`, <p><strong>Heads-up:</strong> {notice}</p>, "working"));
    if (state === "waiting") {
      const text = run?.returnPredicate ?? run?.lastError ?? { sign_in: "The school wants you to sign in. I've kept my place.", files: "I need a file to carry on.", answer: "I have a question before I go on.", browser: "I need you on the page for a moment." }[record.needs ?? "browser"];
      dot("waiting", <div className="ag-text"><ChatMarkdown text={text} /></div>, "needs");
    }
    if (state === "ready" && run) {
      const met = run.completionChecklist?.length ?? 0;
      dot("ready", <>
        <p>Done.{met ? ` ${met} of ${met} requirements pass, and` : ""} my work is on the right.</p>
        {doubts.length > 0 && <p>I made {doubts.length === 1 ? "one call" : `${doubts.length} calls`} I'd like you to check.</p>}
      </>, "review");
    }
    if (state === "handing_in") dot("handing", <p>Handing it in. I'll check the school's confirmation.</p>, "steering");
    if (state === "handed_in") {
      dot("handed", <p>Handed in.{receipt ? ` The school page says “${receipt.verifiedStatus}” · ${clock(receipt.submittedAt)}.` : ""}</p>, "done");
      out.push({ key: "walk", node: <div className="ag-tips">{["Walk me through it", "What would lose points?"].map((tip) => <button key={tip} onClick={() => onSuggest(tip)}><Icon name="right" size={14} />{tip}</button>)}</div> });
    }
    if (state === "stopped") dot("stopped", <p>Stopped. Everything I did is saved, and nothing was handed in.</p>);
    if (state === "stuck") dot("stuck", <div className="ag-text"><ChatMarkdown text={`I got stuck: ${record.reason ?? "something went wrong"} Everything I did is saved.`} /></div>, "needs");
    if (thinking) dot("thinking", <p className="ag-muted">Thinking…</p>, "thinking");

    // Back-to-back Dot turns share one header, like any agent thread. Only the newest face moves.
    const newest = out.map((item, index) => (item.dot ? index : -1)).filter((index) => index >= 0).pop();
    return out.map((item, index) => {
      if (!item.dot) return <div key={item.key}>{item.node}</div>;
      const cont = index > 0 && Boolean(out[index - 1]?.dot);
      return <div key={item.key} className={`ag-turn${cont ? " is-cont" : ""}${index !== newest ? " is-still" : ""}`}>{item.node}</div>;
    });
  }

  function yourMove(): { title: string; body?: string; actions?: ReactNode; extra?: ReactNode } | null {
    const primary = (label: string, onClick: () => void, off = false) => <button className="rd-button rd-primary" disabled={disabled || off} onClick={onClick}>{label}</button>;
    const quiet = (label: string, onClick: () => void) => <button className="rd-link ag-link" disabled={disabled} onClick={onClick}>{label}</button>;
    const stop = run && isLivePhase(run.phase) ? quiet("Stop", () => onCancel(run.taskId)) : null;
    const mode = task?.permission.mode ?? "do_not_attempt";
    switch (state) {
      case "not_started": {
        if (otherLive) return { title: "Dot is on another assignment.", body: "This one can go next.", actions: <>{task && primary("Do this next", () => void act(() => window.studi!.queueAssignmentNext({ taskId: task.task.taskId })))}{quiet("Go to it", onOpenWork)}</> };
        if (onboarding.scan?.state === "running" || onboarding.scan?.state === "needs_user") return { title: "Dot is reading your school.", body: "It can start this when the check finishes." };
        const eligibility = assignmentWorkEligibility(assignment, new Date().toISOString());
        if (!eligibility.eligible) return { title: "Dot can't start this one.", body: eligibility.reason };
        return {
          title: "Start when you're ready.",
          body: mode === "auto_submit" ? "Dot does it, checks it, and hands it in after your review time." : "Dot does it and checks it. Then you look it over and hand it in.",
          actions: <>{task && primary(busy === "assignment" ? "Starting…" : "Start", () => onStart(task.task.taskId))}{quiet("I'll do it myself", () => setOwner("student"))}</>,
        };
      }
      case "left_to_you":
        return {
          title: "This one's left to you.",
          body: `By ${task ? ruleSource(task.permission.rationale) : "your rules"}. Dot can still do it if you want.`,
          actions: <>{primary("Let Dot do this one", () => void act(() => window.studi!.savePermissionRule({ scope: "assignment", assignmentId: assignment.assignmentId, mode: "attempt" })))}{quiet("Change rules", openRules)}</>,
        };
      case "scheduled":
        return {
          title: entry?.scheduledStartAt ? `Dot starts ${whenText(entry.scheduledStartAt)}.` : otherLive ? "Dot starts this next." : "Dot starts this soon.",
          body: "Your rules let Dot start by itself. You'll get a notification.",
          actions: task ? primary("Start now", () => onStart(task.task.taskId), Boolean(otherLive)) : undefined,
        };
      case "waiting":
        if (!run) return null;
        if (record.needs === "sign_in") return { title: "Sign in on the school page.", body: "It's open on the right. Tick “remember this device” if it asks. Dot carries on once you're in.", actions: <>{primary("I've signed in", () => onResume(run.taskId))}{stop}</> };
        if (record.needs === "answer") return { title: "Answer Dot's question.", body: "Type your answer in the box below.", actions: stop };
        if (record.needs === "files") return { title: "Dot needs a file.", body: run.returnPredicate ?? "Add the file and Dot carries on.", actions: <>{primary(pending ? "Adding…" : "Choose file", addFiles)}{stop}</> };
        return { title: "Dot needs you on the page.", body: run.returnPredicate ?? "Do what's needed on the right, then let Dot carry on.", actions: <>{primary("I'm done, carry on", () => onResume(run.taskId))}{stop}</> };
      case "ready": {
        if (!run) return null;
        const checks = doubts.length > 0 && (
          <div className="ag-checks">
            {doubts.map((doubt, index) => settled.includes(index)
              ? <div className="ag-check is-ok" key={index}><Icon name="check" size={14} /><b>{doubt.where}</b></div>
              : <div className="ag-check" key={index}><b>{doubt.where}</b><small>{doubt.why}</small>
                  <div className="ag-opts"><button className="rd-button" onClick={() => settle(index)}>That's right</button><button className="rd-quiet" onClick={() => onSuggest(`Change ${doubt.where}: `)}>Change it</button></div></div>)}
          </div>
        );
        if (handing) return { title: "Press Submit on the school page.", body: "It's on the right. Dot sees it when the school confirms, and saves the receipt.", actions: quiet("Back to my work", () => setHanding(false)) };
        if (task?.permission.maySubmit) {
          const deadline = run.reviewDeadline && !run.reviewSubmissionRequestedAt && lifecycle.schedule?.state !== "paused" ? clock(run.reviewDeadline) : null;
          return {
            title: open ? `Check ${open === 1 ? "this" : "these"}, then it goes in.` : "Ready to hand in.",
            ...(open ? {} : { body: deadline && !doubts.length ? `Dot hands it in at ${deadline} if Studi is open, or now if you say so.` : "Dot hands it in when you say so." }),
            extra: checks,
            actions: <>{primary(pending ? "Handing in…" : "Hand it in now", () => void act(() => window.studi!.submitReviewedAssignment({ taskId: run.taskId })), open > 0)}{quiet("Edit it myself", () => onPause(run.taskId))}</>,
          };
        }
        return {
          title: open ? `Check ${open === 1 ? "this" : "these"}, then hand it in.` : "Ready for you to hand in.",
          ...(open ? {} : { body: "Dot opens the page and watches for the school's confirmation." }),
          extra: checks,
          actions: <>{primary("Go hand it in", () => void act(async () => { await window.studi!.watchHandIn({ taskId: run.taskId }); setHanding(true); }), open > 0)}{quiet("Edit it myself", () => onPause(run.taskId))}</>,
        };
      }
      case "stopped":
        return { title: "Stopped. Nothing was handed in.", body: "Dot can carry on from where it stopped.", actions: <>{taskId && primary("Carry on", () => onStart(taskId), Boolean(otherLive))}{quiet("I'll do it myself", () => setOwner("student"))}</> };
      case "stuck":
        return { title: "Dot got stuck.", body: "Try again, or do this one yourself. Everything so far is saved.", actions: <>{taskId && primary("Try again", () => onStart(taskId), Boolean(otherLive))}{quiet("I'll do it myself", () => setOwner("student"))}</> };
      case "yours":
        return { title: "You're doing this one.", body: "Dot won't touch it. Ask it anything about the assignment.", actions: <button className="rd-button" disabled={disabled} onClick={() => setOwner("inky")}>Give it to Dot</button> };
      default:
        return null;
    }
  }

  function workPane(): ReactNode {
    const answers = run?.answerSnapshot;
    const checklist = state === "ready" || state === "handed_in" ? run?.completionChecklist ?? [] : [];
    return (
      <div className="ag-pad">
        {state === "waiting" && record.needs === "files" && (
          <button className="ag-drop" disabled={disabled} onClick={addFiles}><b>Choose the file Dot needs</b>{run?.returnPredicate ?? "It goes into this assignment's folder."}</button>
        )}
        {answers && <section><p className="ag-label">{workTabName(assignment.kind) === "Draft" ? "Draft" : "Answers"}</p><div className="ag-answers"><ChatMarkdown text={answers} /></div></section>}
        {checklist.length > 0 && (
          <section className="ag-section">
            <div className="ag-req-head"><b>Requirements</b><span>{checklist.length} of {checklist.length} met</span></div>
            {checklist.map((item, index) => <div className="ag-req" key={index}><Icon name="done" size={17} /><div><b>{item.requirement}</b><small>{item.evidence}</small></div></div>)}
          </section>
        )}
        {run?.answerArtifactId && <button className="rd-link ag-section" onClick={() => onOpenArtifact(run.taskId)}>Open the saved answers <Icon name="external" size={14} /></button>}
        <div className="ag-section">
          <HomeworkFiles assignmentId={assignment.assignmentId} active commandOutputs={detail?.execution?.commandOutputs ?? run?.commandOutputs ?? []} onCount={() => {}} />
        </div>
        {!answers && !checklist.length && !run && <p className="ag-muted">Nothing yet. Dot's work shows here as it goes.</p>}
      </div>
    );
  }

  function detailsPane(): ReactNode {
    const school = assignment.schoolStatus;
    const mode = task?.permission.mode;
    const asks = assignment.instructions ?? assignment.requirementEvidence?.map((item) => item.text).join("\n\n");
    return (
      <div className="ag-pad">
        <dl className="ag-facts">
          <dt>Due</dt><dd>{dueText(assignment, state)}{assignment.dueAt && !["handed_in", "handed_in_at_school"].includes(state) && <small> · {leftText(assignment.dueAt)}</small>}</dd>
          <dt>Class</dt><dd>{course}</dd>
          <dt>The school says</dt><dd>{school?.text ?? "Nothing yet"}{assignment.sourceTarget && <> · <button className="rd-link" onClick={() => choose("site")}>Open</button></>}</dd>
          <dt>Rule</dt><dd>{mode ? RULE_LABELS[mode] : "No rule yet"}{task && <small> · {ruleSource(task.permission.rationale)}</small>} · <button className="rd-link" onClick={openRules}>Change</button></dd>
          <dt>Late work</dt><dd>{assignment.latePolicy?.text ?? "Not stated"}</dd>
          <dt>Found on</dt><dd>{assignment.sourceTarget ? hostOf(assignment.sourceTarget) : "Added by you"}</dd>
          {assignment.missingRequirements?.length ? <><dt>Still unclear</dt><dd><ul>{assignment.missingRequirements.map((item) => <li key={item}>{item}</li>)}</ul></dd></> : null}
        </dl>
        <section className="ag-section">
          <p className="ag-label">What it asks</p>
          <div className="ag-asks"><ChatMarkdown text={asks ?? "Open the school page to see the full instructions."} /></div>
        </section>
      </div>
    );
  }

  function receiptPane(value: NonNullable<typeof receipt>): ReactNode {
    return (
      <div className="ag-pad">
        <span className="ag-stamp">Handed in</span>
        <p className="ag-receipt-line">The school page says “{value.verifiedStatus}”.<br /><span className="ag-muted">{new Date(value.submittedAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></p>
        <div className="ag-ba">
          <div><b>Before</b>{value.preSubmit.summary}</div>
          <div><b>After</b>{value.postSubmit.summary}</div>
        </div>
        {run?.answerSnapshot && <section className="ag-section"><p className="ag-label">What was handed in</p><div className="ag-answers"><ChatMarkdown text={run.answerSnapshot} /></div></section>}
      </div>
    );
  }
}

function SitePane({ onSlot }: { onSlot: (bounds: SchoolPageBounds | null) => void }) {
  const slot = useRef<HTMLDivElement>(null);
  useSchoolSlot(slot, onSlot);
  return <div className="ag-slot" ref={slot} data-school-slot="true" aria-label="Live school page">{readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}</div>;
}

function Step({ step }: { step: ThreadStep }) {
  if (step.kind === "text") return <div className="ag-text"><ChatMarkdown text={step.text} /></div>;
  if (step.kind === "memory") return <MemorySaved title={step.title} />;
  const { call } = step;
  return (
    <div className={`ag-call${call.running ? " is-running" : ""}${call.failed ? " is-failed" : ""}`}>
      <Icon name={call.icon} size={14} /><b>{call.verb}</b>{call.target ? <code>{call.target}</code> : <span />}<small>{call.running ? "" : call.result ?? ""}</small>
    </div>
  );
}

const stepKey = (step: ThreadStep) => (step.kind === "call" ? step.call.key : step.key);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const whenText = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** Where a rule came from, in the student's words. */
function ruleSource(rationale: string): string {
  const scope = /^Matched (global|course|pattern|assignment) permission rule/.exec(rationale)?.[1];
  if (scope) return { global: "your rule for all homework", course: "your rule for this class", pattern: "your rule for this kind of work", assignment: "your choice for this assignment" }[scope]!;
  if (/^No permission rule matched/.test(rationale)) return "no rule yet";
  return rationale.replace(/\.$/, "");
}

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

function dueText(assignment: Assignment, state: HomeworkRecord["state"]): string {
  const due = Date.parse(assignment.dueAt ?? "");
  if (!Number.isFinite(due)) return assignment.dueText ?? "Whenever";
  const when = new Date(due).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (due < Date.now() && !["handed_in", "handed_in_at_school", "ignored"].includes(state)) return `Overdue · was due ${when}`;
  return `Due ${when}`;
}

function leftText(dueAt: string): string {
  const hours = (Date.parse(dueAt) - Date.now()) / 3_600_000;
  if (hours < 0) return "past due";
  if (hours < 1) return "under an hour left";
  if (hours < 24) return `${Math.round(hours)} hours left`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
