import "./composer.css";
import type { TimelineContext } from "../../shared/conversation-timeline.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exam } from "../../shared/learn.js";
import { TUTOR_PHASES, type PublicTutorBlock, type PublicTutorSession, type TutorBlockAnswer, type TutorPhase, type TutorStartInput } from "../../shared/tutor.js";
import { TutorModel } from "./TutorModels.js";
import { StudyPage } from "./StudyPage.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Icon } from "./Icon.js";
import { Character } from "./Character.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { WorkspaceDialog } from "./WorkspaceDialog.js";

const PHASE_NAMES: Record<TutorPhase, string> = { check: "Check", learn: "Learn", practice: "Practise", independent: "On your own", wrap: "Wrap up" };
const LEVELS = ["Not yet", "Shaky", "Getting there", "Good", "Solid"];
type Asked = Exclude<PublicTutorBlock, { tool: "tutor_say" | "tutor_finish" }>;

const prompt = (block: Asked) => block.tool === "tutor_ask_explain" ? block.args.prompt : block.tool === "tutor_show_model" ? `Explored a ${block.args.model.replaceAll("_", " ")}` : block.tool === "tutor_show_page" ? `Tried “${block.args.title}”` : block.args.question;
function outcome(block: Asked): string {
  const result = block.result;
  if (!result) return block.status === "cancelled" ? "skipped" : "";
  const answer = result.answer;
  const said = answer.kind === "typed" ? `“${answer.answer}”` : answer.kind === "choice" && block.tool === "tutor_ask_choice" ? `“${block.args.options[answer.picked]}”` : answer.kind === "explain" ? "explained" : "explored";
  return result.correct === true ? `right${result.hintsUsed ? ` with ${result.hintsUsed} hint${result.hintsUsed > 1 ? "s" : ""}` : `, ${Math.round(result.seconds)} s`}` : result.correct === false ? `you said ${said}` : said;
}

function whenFrom(date: string): string | null {
  const days = Math.round((Date.parse(date + "T00:00:00") - Date.parse(new Date().toLocaleDateString("en-CA") + "T00:00:00")) / 86_400_000);
  return days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : null;
}

export function TutorScreen({ initial, goal, courseLabel, topicTitle, onStart, onLeave, onOpenContext }: {
  initial: PublicTutorSession; goal: Exam | null; courseLabel: (courseId: string) => string | null; topicTitle: (topicId: string) => string;
  onStart: (input: TutorStartInput) => void; onLeave: () => void; onOpenContext: (context: TimelineContext) => void;
}) {
  const [session, setSession] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(""),
    [clock, setClock] = useState(Date.now()), [sheet, setSheet] = useState(false);
  const [message, setMessage] = useState(() => localStorage.getItem("studi-tutor-message:" + initial.sessionId) ?? "");
  const lock = useRef(false), mounted = useRef(true), revision = useRef(initial.updatedAt), messageId = useRef<string | null>(null);
  const flushDraft = useRef<() => Promise<void>>(async () => {});
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushDraft.current = flush;
    return () => { if (flushDraft.current === flush) flushDraft.current = async () => {}; };
  }, []);
  const apply = useCallback((next: PublicTutorSession) => {
    if (next.updatedAt >= revision.current) { revision.current = next.updatedAt; setSession(next); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const read = async () => {
      if (reading || lock.current) return;
      reading = true;
      try { const next = await window.studi!.getTutorSession({ sessionId: initial.sessionId }); if (mounted.current) apply(next); }
      catch (cause) { if (mounted.current) setError(String(cause)); }
      finally { reading = false; }
    };
    const timer = setInterval(() => { setClock(Date.now()); void read(); }, 1200);
    void read();
    return () => { mounted.current = false; clearInterval(timer); };
  }, [initial.sessionId, apply]);
  const run = async (action: () => Promise<PublicTutorSession>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await flushDraft.current();
      const next = await action();
      if (mounted.current) apply(next);
      return next;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const pause = () => run(() => window.studi!.pauseTutorSession({ sessionId: session.sessionId }));
  const remaining = Math.max(0, session.budgetSeconds - session.elapsedSeconds - (session.activeSince ? Math.max(0, (clock - Date.parse(session.activeSince)) / 1000) : 0));
  const closed = !["active", "paused"].includes(session.status);

  // Chalky's lines belong to the question that follows them; answered questions collapse to one row each.
  const asked = session.blocks.filter((block): block is Asked => block.tool !== "tutor_say" && block.tool !== "tutor_finish");
  const active = asked.find(block => block.status === "open");
  const since = (active ? asked[asked.indexOf(active) - 1] : asked.at(-1))?.sequence ?? -1;
  const voice = session.blocks.flatMap(block => block.tool === "tutor_say" && block.sequence > since ? [block.args.text] : []).slice(-3);
  const past = asked.filter(block => block !== active);

  const leave = async () => {
    if (session.status === "active" && !(await pause())) return;
    onLeave();
  };
  const send = async () => {
    const text = message.trim();
    if (!text) return;
    const id = messageId.current ?? crypto.randomUUID();
    messageId.current = id;
    if (await run(() => window.studi!.sendTutorMessage({ sessionId: session.sessionId, text, messageId: id }))) {
      setMessage(""); messageId.current = null;
      localStorage.removeItem("studi-tutor-message:" + session.sessionId);
    }
  };
  const goalLine = goal && [goal.courseId && courseLabel(goal.courseId)?.split(" ").slice(0, 2).join(" "), goal.title, goal.date && whenFrom(goal.date)].filter(Boolean).join(" ");
  const title = session.mode === "mock_exam" ? "Test yourself" : topicTitle(session.topicId);
  const phases = session.mode === "topic" ? TUTOR_PHASES : (["independent", "wrap"] as const);

  const composer = (
    <form className="rd-composer inky-composer" onSubmit={event => { event.preventDefault(); void (message.trim() ? send() : pause()); }}>
      <button className="composer-mascot" type="button" aria-label="Open conversation" onClick={() => setSheet(true)}>
        <Icon name="note" size={20} />
      </button>
      <div className="inky-composer-line">
        <textarea rows={1} aria-label="Message Chalky about this session" maxLength={10000} value={message}
          placeholder={active ? "Stuck? Ask Chalky about this question" : "Ask Chalky anything about this topic"}
          onChange={event => { setMessage(event.target.value); messageId.current = null; localStorage.setItem("studi-tutor-message:" + session.sessionId, event.target.value); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <button className="chat-send" disabled={busy || closed || (!message.trim() && session.status !== "active")} aria-label={message.trim() ? "Send message" : "Pause session"}>
          {message.trim() ? <Icon name="send" size={17} /> : <Icon name="stop" size={15} />}
        </button>
      </div>
    </form>
  );
  return (
    <main className="app-shell rd-learn rd-tutor" data-studi-app-ready="true">
      <header className="rd-tutor-heading tu-heading">
        <button className="rd-quiet" disabled={busy} onClick={() => void leave()}>Leave</button>
        <div className="tu-title">
          <strong>{title}{goalLine && <span> · {goalLine}</span>}</strong>
          <ol className="tu-phases" aria-label="Lesson steps">
            {phases.map(phase => {
              const at = phases.indexOf(session.phase as never), index = phases.indexOf(phase as never);
              return <li key={phase} className={index < at || (closed && session.status === "completed") ? "done" : index === at ? "now" : ""} aria-current={index === at ? "step" : undefined}>{PHASE_NAMES[phase]}</li>;
            })}
          </ol>
        </div>
        <span className="tu-time">{closed ? "" : `${Math.ceil(remaining / 60)} min left`}</span>
        {session.status === "active" && <button className="rd-quiet" disabled={busy} onClick={() => void pause()}>Pause</button>}
      </header>
      <div className="rd-tutor-scroll">
        <div className="rd-tutor-column tu-column">
          {past.length > 0 && <ol className="tu-past">
            {past.map(block => <li key={block.blockId}>
              <span>{PHASE_NAMES[block.phase]}</span><span className="tu-past-q">{prompt(block)}</span>
              <span className={block.result?.correct === false ? "tu-miss" : ""}>{outcome(block)}</span>
            </li>)}
          </ol>}
          {session.status === "paused" && <div className="rd-session-notice">
            <Character kind="chalky" size={52} state="idle" />
            <div className="rd-session-notice-text"><h1>Right where we left off.</h1><p>{session.error ?? "Your answers and drafts are saved."}</p></div>
            <button className="rd-quiet" disabled={busy} onClick={() => void run(() => window.studi!.cancelTutorSession({ sessionId: session.sessionId }))}>End session</button>
            <button className="rd-button rd-primary" disabled={busy} onClick={() => void run(() => window.studi!.resumeTutorSession({ sessionId: session.sessionId }))}>Resume</button>
          </div>}
          {!closed && (voice.length > 0 || !active) && <div className="rd-tutor-says" role={active ? undefined : "status"}>
            <Character kind="chalky" size={52} state={active ? "idle" : "thinking"} />
            <div className="tu-voice">{voice.length ? voice.map((text, index) => <ChatMarkdown key={index} text={text} />) : <p>Thinking about what comes next…</p>}</div>
          </div>}
          {active && !closed && <TutorBlockView key={active.blockId} block={active} sessionId={session.sessionId} disabled={busy || session.status !== "active"}
            onAnswer={(block, answer) => run(() => window.studi!.answerTutorBlock({ sessionId: session.sessionId, blockId: block.blockId, answer }))}
            onHint={() => void run(() => window.studi!.hintTutorBlock({ sessionId: session.sessionId, blockId: active.blockId }))}
            onError={setError} registerFlush={registerFlush} />}
          {closed && <WrapUp session={session} asked={asked} goal={goal} topicTitle={topicTitle} onStart={onStart} onLeave={onLeave} />}
          {error && <p className="rd-error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="rd-tutor-composer">{composer}</div>
      {sheet && <WorkspaceDialog className="rd-sheet-dialog" label="You and Chalky" onClose={() => setSheet(false)}>
        <ConversationTimeline composer={composer} error={error} onClose={() => setSheet(false)} onOpenContext={context => {
          void (async () => {
            await flushDraft.current();
            if (session.status === "active" && !(await pause())) return;
            onOpenContext(context);
          })().catch(cause => setError(String(cause)));
        }} />
      </WorkspaceDialog>}
    </main>
  );
}

function WrapUp({ session, asked, goal, topicTitle, onStart, onLeave }: {
  session: PublicTutorSession; asked: Asked[]; goal: Exam | null; topicTitle: (topicId: string) => string;
  onStart: (input: TutorStartInput) => void; onLeave: () => void;
}) {
  const result = session.result;
  if (session.mode === "mock_exam") {
    const scores = session.topicIds.map(topicId => {
      const graded = asked.filter(block => (block.args.topicId ?? session.topicId) === topicId && typeof block.result?.correct === "boolean");
      return { topicId, right: graded.filter(block => block.result!.correct).length, total: graded.length };
    }).filter(score => score.total);
    const right = scores.reduce((sum, score) => sum + score.right, 0), total = scores.reduce((sum, score) => sum + score.total, 0);
    const weakest = [...scores].sort((a, b) => a.right / a.total - b.right / b.total)[0];
    return <section className="tu-wrap">
      <div className="rd-tutor-says"><Character kind="chalky" size={52} state="proud" /><div className="tu-voice"><p>{total ? `${right} out of ${total}.` : "Quiz stopped."} {result?.summary ?? ""}</p></div></div>
      {scores.length > 0 && <>
        <div className="lr-head"><h2>{goal?.title ?? "Quiz"} · by topic</h2></div>
        <ul className="tu-scores">{scores.map(score => <li key={score.topicId}><span>{topicTitle(score.topicId)}</span>
          <span className="lr-bar"><i style={{ width: `${Math.round(score.right / score.total * 100)}%` }} /></span><b>{score.right} / {score.total}</b></li>)}</ul>
      </>}
      <div className="lr-ways">
        {weakest && weakest.right < weakest.total && <button className="rd-button rd-primary" onClick={() => onStart({ topicId: weakest.topicId, minutes: 15 })}>Study {topicTitle(weakest.topicId)} · 15 min</button>}
        <button className="rd-quiet" onClick={onLeave}>Back to Learn</button>
      </div>
    </section>;
  }
  const changed = result && result.level !== null && result.level !== result.previousLevel;
  return <section className="tu-wrap">
    <div className="rd-tutor-says"><Character kind="chalky" size={52} state={session.status === "completed" ? "proud" : "idle"} />
      <h1>{session.status === "completed" ? "That's today's session." : session.status === "expired" ? "Time's up for today." : "We stopped here."}</h1></div>
    <ChatMarkdown text={result?.summary ?? session.error ?? "Your answers so far are saved."} />
    {result && <p className="tu-level">
      {changed ? <><b>{LEVELS[result.previousLevel ?? 0]}</b> <Icon name="forward" size={14} /> <b>{LEVELS[result.level!]}</b> on {topicTitle(session.topicId)}</>
        : result.level !== null ? <>Still <b>{LEVELS[result.level]}</b> on {topicTitle(session.topicId)}. One session moves it at most one step.</>
        : <>Not enough on-your-own answers to set a level yet.</>}
    </p>}
    {Boolean(result?.missing.length) && <><p className="lr-label">Still to practise</p><ul className="tu-missing">{result!.missing.map(item => <li key={item}>{item}</li>)}</ul></>}
    {result?.next && <p className="lr-muted">Next: {result.next}</p>}
    <div className="lr-ways"><button className="rd-button rd-primary" onClick={onLeave}>Back to Learn</button></div>
  </section>;
}

function TutorBlockView({ block, sessionId, disabled, onAnswer, onHint, onError, registerFlush }: {
  block: Asked; sessionId: string; disabled: boolean;
  onAnswer: (block: PublicTutorBlock, answer: TutorBlockAnswer) => Promise<unknown>;
  onHint: () => void; onError: (message: string) => void; registerFlush: (flush: () => Promise<void>) => () => void;
}) {
  const draftKey = "studi-tutor-draft:" + sessionId + ":" + block.blockId;
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? block.draft);
  const [explored, setExplored] = useState<string[]>([]);
  const explore = useCallback((action: string) => setExplored(previous => [...previous.filter(item => item !== action), action].slice(-50)), []);
  const latest = useRef(draft);
  latest.current = draft;
  const saved = useRef(block.draft), saving = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback(() => {
    const value = latest.current;
    saving.current = saving.current.catch(() => {}).then(async () => {
      if (saved.current === value) return;
      await window.studi!.saveTutorDraft({ sessionId, blockId: block.blockId, draft: value });
      saved.current = value;
    });
    return saving.current;
  }, [sessionId, block.blockId]);
  useEffect(() => registerFlush(flush), [registerFlush, flush]);
  useEffect(() => {
    if (draft === saved.current) return;
    const timer = setTimeout(() => { void flush().catch(cause => onError("Your draft is saved on this device. " + String(cause))); }, 500);
    return () => clearTimeout(timer);
  }, [draft, flush]);
  const edit = (value: string) => {
    latest.current = value; setDraft(value);
    try { localStorage.setItem(draftKey, value); } catch { onError("Your draft could not be saved. Keep this window open."); }
  };
  const submit = async (answer: TutorBlockAnswer) => { if (await onAnswer(block, answer)) localStorage.removeItem(draftKey); };
  const source = "source" in block.args ? block.args.source : undefined;
  return (
    <section className="rd-tutor-block" aria-label={PHASE_NAMES[block.phase]}>
      {block.tool === "tutor_ask_choice" && <>
        <h1>{block.args.question}</h1>
        <div className="rd-options">{block.args.options.map((option, index) =>
          <button key={index} className="rd-option" disabled={disabled} onClick={() => void submit({ kind: "choice", picked: index })}>{option}</button>)}</div>
      </>}
      {(block.tool === "tutor_ask_typed" || block.tool === "tutor_ask_explain") && <>
        <h1>{block.tool === "tutor_ask_typed" ? block.args.question : block.args.prompt}</h1>
        <form className={block.tool === "tutor_ask_typed" ? "rd-typed-form" : "rd-explain-form"} onSubmit={event => {
          event.preventDefault();
          if (draft.trim()) void submit(block.tool === "tutor_ask_typed" ? { kind: "typed", answer: draft } : { kind: "explain", text: draft });
        }}>
          {block.tool === "tutor_ask_typed"
            ? <input autoComplete="off" aria-label="Your answer" value={draft} maxLength={10000} disabled={disabled} onChange={event => edit(event.target.value)} placeholder="Your answer" />
            : <textarea aria-label="Your explanation" value={draft} maxLength={10000} disabled={disabled} onChange={event => edit(event.target.value)} placeholder="Type it the way you'd say it out loud. Messy is fine." />}
          <div className="lr-ways">
            <button className="rd-button rd-primary" disabled={disabled || !draft.trim()}>{block.tool === "tutor_ask_typed" ? "Check" : "Send"}</button>
            {block.tool === "tutor_ask_typed" && block.args.hasMoreHints && <button type="button" className="rd-quiet" disabled={disabled} onClick={onHint}>
              {block.hintsUsed === 0 ? "Hint" : block.hintsUsed === 1 ? "Show one step" : "Walk me through it"}
            </button>}
          </div>
        </form>
      </>}
      {source && <p className="tu-source">{source}</p>}
      {block.tool === "tutor_ask_typed" && block.args.hints.length > 0 && <ol className="tu-hints">{block.args.hints.map((hint, index) => <li key={index}><ChatMarkdown text={hint} /></li>)}</ol>}
      {block.tool === "tutor_show_page" && <>
        <StudyPage title={block.args.title} html={block.args.html} onExplore={explore} />
        <button className="rd-button rd-primary" disabled={disabled || !explored.length} onClick={() => void submit({ kind: "model", explored })}>I've tried it</button>
      </>}
      {block.tool === "tutor_show_model" && <>
        <TutorModel model={block.args} onExplore={explore} disabled={disabled} />
        <button className="rd-button rd-primary" disabled={disabled || !explored.length} onClick={() => void submit({ kind: "model", explored })}>I've tried it</button>
      </>}
    </section>
  );
}
