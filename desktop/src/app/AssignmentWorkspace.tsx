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
import { groupSteps, onceOnly, planFor, threadSteps, tipsFor, workTabName, workedFor, type ThreadBlock } from "./assignmentThread.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { onEngineChange } from "./engineChanges.js";
import { plainError, shortCourse } from "./homeworkText.js";
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
  const [handing, setHanding] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [settled, setSettled] = useState<number[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const split = useSplit();
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(160);
  useEffect(() => {
    const node = dock.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => setDockHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
        if (alive) setProblem(plainError(cause));
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
    try { await operation(); } catch (cause) { setProblem(plainError(cause)); } finally { setPending(false); }
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
      <div className={`ag-body${split.dragging ? " is-dragging" : ""}`} ref={split.body} style={{ gridTemplateColumns: `${split.width}px 12px minmax(0, 1fr)` }}>
        <section className="ag-convo" aria-label="Dot's work on this assignment" style={{ ["--ag-dock-h" as string]: `${dockHeight}px` }}>
          <div className="ag-thread" ref={thread} role="log" aria-live="polite">{threadView()}</div>
          {/* Like T3 Code: the decision and the chat box float over the bottom of the thread, stacked. */}
          <div className="ag-dock" ref={dock}>
            {problem && <p className="rd-error" role="alert">{problem}</p>}
            {error}
            <div className="ag-dock-card">
              {move && (
                <section className="ag-move" aria-label="Your move">
                  <h2>{move.title}</h2>
                  {move.body && <p>{move.body}</p>}
                  {move.extra}
                  {move.actions && <div className="ag-acts">{move.actions}</div>}
                </section>
              )}
              {composer}
            </div>
          </div>
        </section>
        <div className="ag-split" role="separator" aria-orientation="vertical" aria-label="Resize the chat" tabIndex={0}
          aria-valuenow={Math.round(split.width)} onPointerDown={split.onPointerDown} onKeyDown={split.onKeyDown} onDoubleClick={split.reset} />
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
            {tab === "site" && <SitePane onSlot={onSchoolSlot} hidden={split.dragging} />}
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
    // Dot's words reach the thread from the run, the chat and the run's state; each is shown once.
    const say = onceOnly();
    const talk = (list: readonly AgentMessage[]) => list.forEach((message) => {
      if (message.role === "user") out.push({ key: message.messageId, node: <div className="ag-you">{message.text}</div> });
      else {
        const text = say(message.text);
        if (!text && !message.memories?.length && message.recovery !== "failed") return;
        dot(message.messageId, <>
          {text && <div className="ag-text"><ChatMarkdown text={text} /></div>}
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
      const lead = state === "left_to_you" ? "Your rule leaves this one to you." : state === "scheduled" ? `I'll start ${!entry?.startRequestedAt && entry?.scheduledStartAt ? whenText(entry.scheduledStartAt) : "as soon as I'm free"}.` : "Ready when you are.";
      dot("hello", <p>{lead} {planFor(assignment.kind)}</p>, "hello");
    }
    talk(before);
    if (!started && !before.length && ["not_started", "scheduled"].includes(state)) {
      out.push({ key: "tips", node: <div className="ag-tips">{tipsFor(assignment.kind).map((tip) => <button key={tip} onClick={() => onSuggest(tip)}><Icon name="right" size={14} />{tip}</button>)}</div> });
    }
    if (started && run) {
      const blocks = groupSteps(threadSteps(run.actions ?? [])).flatMap((block): ThreadBlock[] => {
        if (block.kind !== "text") return [block];
        const text = say(block.text);
        return text ? [{ ...block, text }] : [];
      });
      const working = run.phase === "working" || run.phase === "submitting";
      if (startedAt) out.push({ key: "started", node: <div className="ag-sys">Started · {clock(startedAt)}</div> });
      dot("run", <>{blocks.map((block, index) => block.kind === "text"
          ? <div key={block.key} className="ag-text"><ChatMarkdown text={block.text} /></div>
          : block.kind === "memory" ? <MemorySaved key={block.key} title={block.title} />
          : <WorkGroup key={block.key} group={block} live={working && index === blocks.length - 1} />)}</>,
        working ? (driving ? "steering" : "working") : "idle", startedAt ? clock(startedAt) : undefined);
      const took = workedFor(run);
      if (!working && took) out.push({ key: "worked", node: <div className="ag-sys">Worked for {took}</div> });
    }
    talk(after);
    // Heads-ups are news from the run: shown in the thread while working and after, never as a checklist.
    if (run && ["working", "ready_review", "submitting", "submitted"].includes(run.phase)) (run.notices ?? []).filter(say).forEach((notice, index) => dot(`notice-${index}`, <p><strong>Heads-up:</strong> {notice}</p>, run.phase === "working" ? "working" : "idle"));
    if (state === "waiting") {
      const text = run?.returnPredicate ?? run?.lastError ?? { sign_in: "The school wants you to sign in. I've kept my place.", files: "I need a file to carry on.", answer: "I have a question before I go on.", browser: "I need you on the page for a moment." }[record.needs ?? "browser"];
      if (say(text)) dot("waiting", <div className="ag-text"><ChatMarkdown text={text} /></div>, "needs");
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
    const next = (id: string) => primary("Do this next", () => void act(() => window.studi!.queueAssignmentNext({ taskId: id })));
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
          title: entry?.startRequestedAt ? (otherLive ? "Dot does this next." : "Dot starts this soon.") : entry?.scheduledStartAt ? `Dot starts ${whenText(entry.scheduledStartAt)}.` : otherLive ? "Dot does this next." : "Dot starts this soon.",
          body: entry?.startRequestedAt ? "You asked for it. It starts when Dot is free, and you'll get a notification." : "Your rules let Dot start by itself. You'll get a notification.",
          actions: task ? <>{!otherLive && primary("Start now", () => onStart(task.task.taskId))}{quiet("Take it out of the queue", () => void act(() => window.studi!.cancelAssignment({ taskId: task.task.taskId })))}{otherLive && quiet("See what Dot is on", onOpenWork)}</> : undefined,
        };
      case "waiting":
        if (!run) return null;
        if (record.needs === "sign_in") return { title: "Sign in on the school page.", body: "It's open on the right. Tick “remember this device” if it asks. Dot carries on once you're in.", actions: <>{primary("I've signed in", () => onResume(run.taskId))}{stop}</> };
        if (record.needs === "answer") return { title: "Answer Dot's question.", body: "Type your answer in the box below.", actions: stop };
        if (record.needs === "files") return { title: "Dot needs a file.", body: run.returnPredicate ?? "Add the file and Dot carries on.", actions: <>{primary(pending ? "Adding…" : "Choose file", addFiles)}{stop}</> };
        return { title: "Dot needs you on the page.", body: run.returnPredicate ?? "Do what's needed on the right, then let Dot carry on.", actions: <>{primary("I'm done, carry on", () => onResume(run.taskId))}{stop}</> };
      case "ready": {
        if (!run) return null;
        // Doubts are Dot's judgement calls; the student marks each one fine or asks for a change.
        const checks = doubts.length > 0 && (
          <div className="ag-checks">
            {doubts.map((doubt, index) => settled.includes(index)
              ? <div className="ag-check is-ok" key={index}><Icon name="check" size={14} /><b>{doubt.where}</b></div>
              : <div className="ag-check" key={index}><b>{doubt.where}</b><small>{doubt.why}</small>
                  <div className="ag-opts"><button className="rd-button" onClick={() => settle(index)}>Looks fine</button><button className="rd-quiet" onClick={() => onSuggest(`Change ${doubt.where}: `)}>Change it</button></div></div>)}
          </div>
        );
        const calls = open ? `Dot made ${open === 1 ? "a call" : `${open} calls`} you might want to change.` : null;
        const handIn = primary(pending ? "Handing in…" : "Hand it in", () => void act(() => window.studi!.submitReviewedAssignment({ taskId: run.taskId })), open > 0);
        if (handing) return { title: "Press Submit on the school page.", body: "It's on the right. Dot sees it when the school confirms, and saves the receipt.", actions: quiet("Back to my work", () => setHanding(false)) };
        if (task?.permission.maySubmit) {
          const deadline = run.reviewDeadline && !run.reviewSubmissionRequestedAt && lifecycle.schedule?.state !== "paused" ? clock(run.reviewDeadline) : null;
          return {
            title: calls ?? "Ready to hand in.",
            body: open ? "Mark each one, then it goes in." : run.notices?.length ? "Dot left you a heads-up, so it won't hand this in by itself. Hand it in once you've read it." : deadline && !doubts.length ? `Dot hands it in at ${deadline} if Studi is open, or now if you say so.` : "Dot hands it in when you say so.",
            extra: checks,
            actions: <>{handIn}{quiet("Edit it myself", () => onPause(run.taskId))}</>,
          };
        }
        // "Do it, I'll hand it in": Dot never hands in by itself, but does when the student asks.
        return {
          title: calls ?? "Ready for you to hand in.",
          body: open ? "Mark each one, then hand it in." : "Dot can hand it in now, or you can submit it on the school page yourself.",
          extra: checks,
          actions: <>{handIn}{quiet("I'll submit it on the page", () => void act(async () => { await window.studi!.watchHandIn({ taskId: run.taskId }); setHanding(true); }))}{quiet("Edit it myself", () => onPause(run.taskId))}</>,
        };
      }
      case "stopped":
        return { title: "Stopped. Nothing was handed in.", body: "Dot can carry on from where it stopped.", actions: <>{taskId && (otherLive ? next(taskId) : primary("Carry on", () => onStart(taskId)))}{quiet("I'll do it myself", () => setOwner("student"))}</> };
      case "stuck":
        return { title: "Dot got stuck.", body: "Try again, or do this one yourself. Everything so far is saved.", actions: <>{taskId && (otherLive ? next(taskId) : primary("Try again", () => onStart(taskId)))}{quiet("I'll do it myself", () => setOwner("student"))}</> };
      case "yours":
        return { title: "You're doing this one.", body: "Dot won't touch it. Ask it anything about the assignment.", actions: <button className="rd-button" disabled={disabled} onClick={() => setOwner("inky")}>Give it to Dot</button> };
      default:
        return null;
    }
  }

  function workPane(): ReactNode {
    const answers = run?.answerSnapshot;
    const checklist = state === "ready" || state === "handed_in" ? run?.completionChecklist ?? [] : [];
    const commands = new Map((run?.actions ?? []).filter((action) => action.toolCallId && action.target && (action.tool === "powershell" || action.tool === "bash")).map((action) => [action.toolCallId!, action.target!]));
    return (
      <div className="ag-work-pane">
        {state === "waiting" && record.needs === "files" && (
          <button className="ag-drop" disabled={disabled} onClick={addFiles}><b>Choose the file Dot needs</b>{run?.returnPredicate ?? "It goes into this assignment's folder."}</button>
        )}
        {(answers || checklist.length > 0) && (
          <header className="ag-summary">
            {answers && <div className={`ag-summary-text${summaryOpen ? " is-open" : ""}`}><ChatMarkdown text={answers} /></div>}
            <div className="ag-summary-actions">
              {answers && <button className="wf-link" onClick={() => setSummaryOpen(!summaryOpen)}>{summaryOpen ? "Less" : "More"}</button>}
              {checklist.length > 0 && (
                <button className="ag-req-chip" aria-expanded={requirementsOpen} onClick={() => setRequirementsOpen(!requirementsOpen)}>
                  <Icon name="done" size={14} />{checklist.length} of {checklist.length} requirements met
                </button>
              )}
              {run?.answerArtifactId && <button className="wf-link" onClick={() => onOpenArtifact(run.taskId)}>Saved answers <Icon name="external" size={12} /></button>}
            </div>
            {requirementsOpen && (
              <div className="ag-req-list">
                {checklist.map((item, index) => <div className="ag-req" key={index}><Icon name="done" size={16} /><div><b>{item.requirement}</b><small>{item.evidence}</small></div></div>)}
              </div>
            )}
          </header>
        )}
        <HomeworkFiles key={assignment.assignmentId} assignmentId={assignment.assignmentId} active commandOutputs={detail?.execution?.commandOutputs ?? run?.commandOutputs ?? []} commands={commands} />
      </div>
    );
  }

  function detailsPane(): ReactNode {
    const school = assignment.schoolStatus;
    const late = assignment.latePolicy;
    const mode = task?.permission.mode;
    const done = ["handed_in", "handed_in_at_school", "ignored"].includes(state);
    const dueMs = Date.parse(assignment.dueAt ?? "");
    const overdue = dueMs < Date.now() && !done;
    const requirements = (assignment.requirementEvidence ?? []).map((item) => ({ text: tidy(item.text), from: item.evidence.sourceTarget }));
    const sources = [...new Set([assignment.sourceTarget, ...requirements.map((item) => item.from)].filter((url): url is string => Boolean(url)))];
    const checked = [school?.evidence.capturedAt, late?.evidence.capturedAt, assignment.deadlineEvidence?.capturedAt].filter((iso): iso is string => Boolean(iso)).sort().at(-1);
    const day = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const fact = (label: string, main: ReactNode, note?: ReactNode, tone = "") => (
      <div className={`ag-fact${tone}`}><dt>{label}</dt><dd><b>{main}</b>{note && <span>{note}</span>}</dd></div>
    );
    return (
      <div className="ag-pad ag-details">
        <dl className="ag-facts">
          {fact("Due",
            Number.isFinite(dueMs) ? new Date(dueMs).toLocaleString([], { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : assignment.dueText ?? "No date given",
            Number.isFinite(dueMs) ? (overdue ? "Past due" : done ? undefined : leftText(assignment.dueAt!)) : undefined, overdue ? " is-late" : "")}
          {fact("At school",
            school ? { unknown: "Not sure yet", not_submitted: "Not handed in", submitted: "Handed in", graded: "Graded", locked: "Closed" }[school.state] : "Not checked yet",
            <>{school && school.text.trim() !== "" && gistOf(school.text) !== gistOf(school.state) && <span className="ag-fact-evidence">{tidy(school.text)}</span>}{assignment.sourceTarget && <button className="wf-link" onClick={() => choose("site")}>Open the page<Icon name="external" size={13} /></button>}</>)}
          {fact("Late work", late ? { accepted: late.until ? `Accepted until ${day(late.until)}` : "Accepted", not_accepted: "Not accepted", unknown: "Not stated" }[late.state] : "Not stated", late?.text ? tidy(late.text) : undefined)}
          {fact("Your rule", mode ? RULE_LABELS[mode] : "No rule yet", <>{task && <span className="ag-fact-evidence">{ruleSource(task.permission.rationale).replace(/^\w/, (c) => c.toUpperCase())}</span>}<button className="wf-link" onClick={openRules}>Change</button></>)}
        </dl>

        <section className="ag-doc">
          <h2>What it asks</h2>
          {requirements.length ? (
            <ul className="ag-asks-list">{requirements.map((item, index) => <li key={index}>{item.text}</li>)}</ul>
          ) : assignment.instructions ? (
            <div className="ag-asks"><ChatMarkdown text={tidy(assignment.instructions)} /></div>
          ) : (
            <p className="ag-asks ag-muted">Dot reads the instructions from the school page when it starts.{assignment.sourceTarget && <> <button className="wf-link" onClick={() => choose("site")}>Open the page</button></>}</p>
          )}
          {assignment.missingRequirements?.length ? (
            <div className="ag-unclear">
              <b>Dot couldn't find</b>
              <ul>{assignment.missingRequirements.map((item) => <li key={item}>{tidy(item)}</li>)}</ul>
            </div>
          ) : null}
          {sources.length > 0 && (
            <div className="ag-sources">
              <b>From</b>
              {sources.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><Icon name={/\.pdf($|\?)/i.test(url) ? "file" : "globe"} size={14} /><span>{sourceName(url)}</span><Icon name="external" size={13} /></a>)}
            </div>
          )}
          <p className="ag-found">Found {day(assignment.discoveredAt)}{checked && checked !== assignment.discoveredAt ? ` · checked ${day(checked)}` : ""}{assignment.origin === "manual" ? " · added by you" : ""}</p>
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

function SitePane({ onSlot, hidden }: { onSlot: (bounds: SchoolPageBounds | null) => void; hidden: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  // The live page is a native layer that would swallow the drag, so it steps aside while resizing.
  useSchoolSlot(slot, onSlot, !hidden);
  return <div className="ag-slot" ref={slot} data-school-slot="true" aria-label="Live school page">{readDevPreviewConfig() && <PreviewSchoolPage mode="assignment" />}</div>;
}

// One row per run of tool calls. Done: a summary that expands. Working: the step Dot is on, live.
function WorkGroup({ group, live }: { group: Extract<ThreadBlock, { kind: "group" }>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = [...group.calls].reverse().find((call) => call.running) ?? group.calls.at(-1)!;
  return (
    <div className={`ag-work${open ? " is-open" : ""}${group.failed ? " is-failed" : ""}`}>
      <button className={`ag-work-row${live ? " is-live" : ""}`} aria-expanded={open} onPointerDown={(event) => event.currentTarget.blur()} onClick={() => setOpen(!open)}>
        <Icon name={live ? latest.icon : group.icon} size={15} />
        <span className="ag-work-label">{live ? <><b>{latest.verb}</b>{latest.target && <code>{latest.target}</code>}</> : group.summary}</span>
        {group.failed && !live && <em>{group.calls.filter((call) => call.failed).length} failed</em>}
        {group.calls.length > 1 && <small>{live ? `${group.calls.length} steps` : clock(group.calls[0]!.at)}</small>}
        <span className="ag-work-caret" aria-hidden="true"><Icon name="down" size={13} /></span>
      </button>
      {open && (
        <div className="ag-work-list">
          {group.calls.map((call) => (
            <div key={call.key} className={`ag-call${call.running ? " is-running" : ""}${call.failed ? " is-failed" : ""}`}>
              <Icon name={call.icon} size={14} /><b>{call.verb}</b>{call.target ? <code>{call.target}</code> : <span />}<small>{call.running ? "" : call.result ?? ""}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
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

// The chat column and the work panel share the window. The chat's share is remembered as a fraction,
// so it grows with a big monitor; the student can drag the handle, use the arrow keys, or double-click to reset.
const SPLIT_KEY = "studi-assignment-split";
const DEFAULT_SPLIT = 0.38;

function useSplit() {
  const body = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(1200);
  const [ratio, setRatio] = useState(() => {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(saved) && saved > 0.15 && saved < 0.85 ? saved : DEFAULT_SPLIT;
  });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const node = body.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => setBodyWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const clampWidth = (value: number) => Math.min(Math.max(value, 340), Math.max(340, bodyWidth - 420));
  const width = clampWidth(ratio * bodyWidth);
  const save = (next: number) => { setRatio(next); localStorage.setItem(SPLIT_KEY, String(next)); };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = body.current;
    if (!node) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const left = node.getBoundingClientRect().left;
    const move = (e: PointerEvent) => setRatio(clampWidth(e.clientX - left) / node.clientWidth);
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      save(clampWidth(e.clientX - left) / node.clientWidth);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    save(clampWidth(width + (event.key === "ArrowLeft" ? -32 : 32)) / bodyWidth);
  };
  return { body, width, dragging, onPointerDown, onKeyDown, reset: () => save(DEFAULT_SPLIT) };
}

const gistOf = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/** School text often carries doubled spaces and stuttered words ("If you can't If you can't"). */
function tidy(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\b(\w+(?: \S+){0,3}) \1\b/g, "$1").trim();
}

function sourceName(url: string): string {
  try {
    const parsed = new URL(url);
    const file = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
    return /\.\w{2,4}$/.test(file) ? `${file} · ${parsed.host.replace(/^www\./, "")}` : parsed.host.replace(/^www\./, "") + (parsed.pathname.length > 1 ? parsed.pathname.slice(0, 40) : "");
  } catch { return url; }
}

