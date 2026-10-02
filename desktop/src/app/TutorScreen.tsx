import "./composer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exam } from "../../shared/learn.js";
import { TUTOR_PHASES, boardView, type PublicTutorSession, type TutorBlockAnswer, type TutorBoardView, type TutorNote, type TutorPhase, type TutorQuestion, type TutorStartInput, type TutorVisual } from "../../shared/tutor.js";
import type { ChalkyState } from "../../shared/characters/states.js";
import { TutorModel } from "./TutorModels.js";
import { StudyPage } from "./StudyPage.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { Icon } from "./Icon.js";
import { Character } from "./Character.js";

const PHASE_NAMES: Record<TutorPhase, string> = { check: "Check", learn: "Learn", practice: "Practise", independent: "On your own", wrap: "Wrap up" };
const LEVELS = ["Not yet", "Shaky", "Getting there", "Good", "Solid"];
const HINTS = ["Hint", "Show one step", "Walk me through it"];
const DAY = 86_400_000;

/** Chalky's marks, drawn the way a pen would. */
const Tick = ({ size = 30 }: { size?: number }) => <svg className="tu-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13.5c2 1.4 3.8 3.6 5.2 6C12 13.5 16 8 21 4.5" /></svg>;
const Dash = ({ size = 20 }: { size?: number }) => <svg className="tu-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 12.5c4-.6 8-.6 12 0" /></svg>;

function daysFrom(date: string): number {
  return Math.round((Date.parse(date + "T00:00:00") - Date.parse(new Date().toLocaleDateString("en-CA") + "T00:00:00")) / DAY);
}
const weekday = (date: string) => new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "long" });

/** Working in plain type. One top-level " / " is drawn as a stacked fraction. */
function Maths({ text }: { text: string }) {
  let depth = 0, slash = -1;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")") depth--;
    else if (!depth && text.startsWith(" / ", index)) { if (slash >= 0 || text.includes("=")) return <>{text}</>; slash = index; }
  }
  if (slash < 0) return <>{text}</>;
  // "(a + b)" loses its brackets only when they wrap the whole part.
  const bare = (part: string) => {
    if (!part.startsWith("(") || !part.endsWith(")")) return part;
    let open = 0;
    for (let index = 0; index < part.length - 1; index++) { open += part[index] === "(" ? 1 : part[index] === ")" ? -1 : 0; if (!open) return part; }
    return part.slice(1, -1);
  };
  return <span className="tu-frac"><span>{bare(text.slice(0, slash))}</span><span>{bare(text.slice(slash + 3))}</span></span>;
}
/** Worked steps: "what this step does: the working". */
function Steps({ steps }: { steps: string[] }) {
  return <ol className="tu-work">{steps.map((step, index) => {
    const cut = step.indexOf(": ");
    return <li key={index}>{cut > 0 && <span>{step.slice(0, cut)}</span>}<b><Maths text={cut > 0 ? step.slice(cut + 2) : step} /></b></li>;
  })}</ol>;
}
function Note({ note, newest }: { note: TutorNote; newest: string | null }) {
  return <div className={`tu-w${newest === note.blockId ? " is-new" : ""}`}><ChatMarkdown text={note.args.text} />{note.args.steps && <Steps steps={note.args.steps} />}</div>;
}
function Visual({ block, newest, disabled, onExplore }: { block: TutorVisual; newest: string | null; disabled: boolean; onExplore: (action: string) => void }) {
  return <div className={`tu-visual${newest === block.blockId ? " is-new" : ""}`}>
    {block.tool === "tutor_show_page" ? <StudyPage title={block.args.title} html={block.args.html} onExplore={onExplore} /> : <TutorModel model={block.args} onExplore={onExplore} disabled={disabled} />}
  </div>;
}

export function TutorScreen({ initial, goal, courseLabel, topicTitle, lastRight, onStart, onLeave }: {
  initial: PublicTutorSession; goal: Exam | null; courseLabel: (courseId: string) => string | null; topicTitle: (topicId: string) => string;
  /** The day the student last got this topic right, when they have. */
  lastRight: (topicId: string) => string | null;
  onStart: (input: TutorStartInput) => void; onLeave: () => void;
}) {
  const [session, setSession] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(""), [clock, setClock] = useState(Date.now());
  const [message, setMessage] = useState(() => localStorage.getItem("studi-tutor-message:" + initial.sessionId) ?? "");
  // Chalky can be a question ahead. The board stays on `at` until the student moves.
  const [at, setAt] = useState<string | null>(null), [wrapUp, setWrapUp] = useState(!["active", "paused"].includes(initial.status)), [allDone, setAllDone] = useState(false);
  const [explored, setExplored] = useState<string[]>([]);
  const explore = useCallback((action: string) => setExplored(previous => [...previous.filter(item => item !== action), action].slice(-50)), []);
  const lock = useRef(false), mounted = useRef(true), revision = useRef(initial.updatedAt), messageId = useRef<string | null>(null);
  const column = useRef<HTMLDivElement>(null), end = useRef<HTMLSpanElement>(null), talk = useRef<HTMLDivElement>(null);
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

  const view = boardView(session, at), question = view.question;
  const closed = !["active", "paused"].includes(session.status), paused = session.status === "paused";
  // A lesson that ended mid-question goes straight to the wrap-up; after an answer, the student reads the reply first.
  const wrapped = closed && (wrapUp || !question?.result);
  const disabled = busy || session.status !== "active" || !!session.wrapStartedAt;
  const waiting = view.visuals.flatMap(group => [group.block, ...group.children]).find(block => block.blockId === view.at);

  // Stay on this stop; a visual that has been tried has nothing left to read, so move on from it.
  useEffect(() => { setAt(!question && view.following ? view.following : view.at); }, [view.at, view.following, !question]);
  // A new stop starts at the top, with its answer row in view.
  useEffect(() => {
    setExplored([]); setAllDone(false);
    column.current?.scrollTo({ top: 0 });
    column.current?.querySelector(".tu-ans")?.scrollIntoView({ block: "nearest" });
  }, [view.at]);
  // Bring what was just added into view, but never while a control on a visual is being dragged.
  const added = `${view.feedback.length}:${view.visuals.length}:${view.tries.length}:${question?.hintsUsed ?? 0}:${question?.result ? 1 : 0}`;
  const shown = useRef({ at: view.at, added });
  useEffect(() => {
    // Only what is added to a stop after it is shown is scrolled to.
    const before = shown.current;
    shown.current = { at: view.at, added };
    if (before.at !== view.at || before.added === added) return;
    if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.type === "range")) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [added, view.at]);
  useEffect(() => { talk.current?.scrollTo({ top: talk.current.scrollHeight }); }, [view.chat.length]);

  const pause = () => run(() => window.studi!.pauseTutorSession({ sessionId: session.sessionId }));
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
  const answer = (blockId: string, value: TutorBlockAnswer) => run(() => window.studi!.answerTutorBlock({ sessionId: session.sessionId, blockId,
    answer: value.kind !== "model" && explored.length ? { ...value, explored } : value }));
  const move = () => { if (view.following) setAt(view.following); else setWrapUp(true); };

  const remaining = Math.max(0, session.budgetSeconds - session.elapsedSeconds - (session.activeSince ? Math.max(0, (clock - Date.parse(session.activeSince)) / 1000) : 0));
  const days = goal?.date ? daysFrom(goal.date) : null;
  const goalLine = goal && [goal.courseId && courseLabel(goal.courseId)?.split(" ").slice(0, 2).join(" "), goal.title, days === null || days < 0 ? null : days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : "today"].filter(Boolean).join(" ");
  const title = session.mode === "mock_exam" ? "Test yourself" : topicTitle(session.topicId);
  const step = TUTOR_PHASES.indexOf(session.phase);
  const unanswered = view.chat.at(-1)?.kind === "student" && session.status === "active";
  const lastAsked = view.chat.map(item => item.kind).lastIndexOf("student");
  const chalky: ChalkyState = wrapped ? session.status === "completed" ? "proud" : "idle" : paused ? "sleep" : message.trim() ? "listening"
    : question?.result?.correct && question.status !== "open" ? "proud" : view.move === "wait" || unanswered ? "thinking"
    : view.move === "check" ? view.tries.length || question?.hintsUsed ? "hint" : "quiz" : view.move === "tried" ? "explaining" : "idle";
  // A question from another topic says where it comes from.
  const other = question?.args.topicId && question.args.topicId !== session.topicId ? question.args.topicId : null;
  const since = other && session.mode === "topic" ? lastRight(other) : null;
  const origin = [other && topicTitle(other), since && `you last got this right ${-daysFrom(since) <= 0 ? "today" : -daysFrom(since) === 1 ? "yesterday" : `${-daysFrom(since)} days ago`}`, question?.args.source].filter(Boolean).join(" · ");
  const done = allDone ? view.done : view.done.slice(-2);

  return (
    <main className="app-shell rd-learn tu-lesson" data-studi-app-ready="true">
      <header className="rd-tutor-heading tu-top">
        <button className="rd-quiet" disabled={busy} onClick={() => void leave()}><Icon name="back" size={14} /> Lessons</button>
        <strong>{title}{goalLine && <span> · {goalLine}</span>}</strong>
        <div className="tu-end">
          {session.mode === "topic" && <div className="tu-steps" role="img" aria-label={wrapped ? "Lesson finished" : `Step ${step + 1} of 5, ${PHASE_NAMES[session.phase]}`}>
            {TUTOR_PHASES.map((phase, index) => <i key={phase} className={wrapped || index < step ? "done" : index === step ? "now" : ""} />)}
            <span>{wrapped ? "Done" : `Step ${step + 1} of 5 · ${PHASE_NAMES[session.phase]}`}</span>
          </div>}
          {!closed && <span className="tu-time">{session.wrapStartedAt ? "Wrapping up…" : `${Math.ceil(remaining / 60)} min left`}</span>}
          {session.status === "active" && <button className="rd-quiet" disabled={busy} onClick={() => void pause()}>Pause</button>}
        </div>
      </header>
      <div className="tu-wrap">
        <aside className="tu-side" aria-label="You and Chalky">
          <div className="tu-who"><Character kind="chalky" size={112} state={chalky} /><div><b>Chalky</b><small>your tutor</small></div></div>
          <div className="tu-talk" ref={talk} role="log" aria-live="polite">
            {!view.chat.length && <p className="tu-empty">Ask me anything while you work.</p>}
            {view.chat.map((item, index) => <p key={item.id} className={`${item.kind === "student" ? "tu-you" : "tu-them"}${index < lastAsked ? " is-old" : ""}`}>{item.text}</p>)}
            {unanswered && <p className="tu-empty" role="status">Chalky is thinking…</p>}
          </div>
          <form className="rd-composer inky-composer tu-say" onSubmit={event => { event.preventDefault(); void send(); }}>
            <div className="inky-composer-line">
              <textarea rows={1} aria-label="Say something to Chalky" maxLength={10000} value={message} disabled={closed} placeholder={closed ? "This lesson has ended" : "Say something to Chalky…"}
                onChange={event => { setMessage(event.target.value); messageId.current = null; localStorage.setItem("studi-tutor-message:" + session.sessionId, event.target.value); }}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
              <button className="chat-send" disabled={busy || closed || !message.trim()} aria-label="Send message"><Icon name="send" size={17} /></button>
            </div>
          </form>
        </aside>
        <section className="tu-board" aria-label="The board">
          <div className="tu-col" ref={column}>
            {wrapped ? <WrapUp session={session} goal={goal} topicTitle={topicTitle} onStart={onStart} onLeave={onLeave} />
              : paused ? <>
                <h1 className="tu-q">Right where we left off.</h1>
                <p className="tu-plain">{session.error ?? "Your answers and drafts are saved."}</p>
                <div className="tu-ans">
                  <button className="tu-btn" disabled={busy} onClick={() => void run(() => window.studi!.resumeTutorSession({ sessionId: session.sessionId }))}>Resume</button>
                  <button className="rd-quiet" disabled={busy} onClick={() => void run(() => window.studi!.cancelTutorSession({ sessionId: session.sessionId }))}>End the lesson</button>
                </div>
              </> : <>
                {view.done.length > done.length && <button className="tu-done" onClick={() => setAllDone(true)}><span>{view.done.length - done.length} earlier {view.done.length - done.length === 1 ? "question" : "questions"}</span><span className="tu-more">Show</span></button>}
                {done.map(item => <button key={item.blockId} className="tu-done" onClick={() => setAt(item.blockId)}>
                  {item.correct ? <Tick size={18} /> : <Dash size={18} />}<span>{item.question}</span>{item.answer && <b>{item.answer}</b>}<span className="tu-more">Show</span>
                </button>)}
                <div className="tu-lead" aria-live="polite">{view.lead.map(note => <Note key={note.blockId} note={note} newest={view.newest} />)}</div>
                {!view.at && !view.lead.length && <p className="tu-lab" role="status">Chalky is getting the lesson ready…</p>}
                {question && <h1 className={`tu-q${view.newest === question.blockId ? " is-new" : ""}`}><span>{question.tool === "tutor_ask_explain" ? question.args.prompt : question.args.question}</span></h1>}
                {view.note && <p className="tu-w">{view.note}</p>}
                {origin && <p className="tu-lab">{origin}</p>}
                {question && question.tool !== "tutor_ask_choice" && question.args.steps && <Steps steps={question.args.steps} />}
                {view.visuals.length > 0 && <div className="tu-visuals" data-count={view.visuals.length}>
                  {view.visuals.map(({ block, children }) => <div key={block.blockId} className="tu-group">
                    {[block, ...children].map(item => <Visual key={item.blockId} block={item} newest={view.newest} disabled={disabled} onExplore={explore} />)}
                  </div>)}
                </div>}
                {question
                  ? <Answer key={`${question.blockId}:${question.attempts.length}:${question.status}`} view={view} question={question} sessionId={session.sessionId} disabled={disabled}
                      onAnswer={value => answer(question.blockId, value)} onMove={move} onError={setError} registerFlush={registerFlush}
                      onHint={() => void run(() => window.studi!.hintTutorBlock({ sessionId: session.sessionId, blockId: question.blockId }))} />
                  : view.at && <div className="tu-ans">
                    <button className="tu-btn" disabled={disabled || view.move !== "tried" || !explored.length} onClick={() => void answer(view.at!, { kind: "model", explored })}>I've tried it</button>
                    <span className="tu-lab" role="status">{view.move !== "tried" ? "Chalky is writing…" : !explored.length ? waiting?.tool === "tutor_show_page" ? "Try the page first." : "Try it first." : ""}</span>
                  </div>}
                <div className="tu-feedback" aria-live="polite">{view.feedback.map(note => <Note key={note.blockId} note={note} newest={view.newest} />)}</div>
              </>}
            {error && <p className="rd-error" role="alert">{error}</p>}
            <span ref={end} />
          </div>
        </section>
      </div>
    </main>
  );
}

/** The question's answer: what was tried, the field, and the board's one button. */
function Answer({ view, question, sessionId, disabled, onAnswer, onHint, onMove, onError, registerFlush }: {
  view: TutorBoardView; question: TutorQuestion; sessionId: string; disabled: boolean;
  onAnswer: (answer: TutorBlockAnswer) => Promise<unknown>; onHint: () => void; onMove: () => void;
  onError: (message: string) => void; registerFlush: (flush: () => Promise<void>) => () => void;
}) {
  // Each try has its own draft, so a fresh try starts empty.
  const draftKey = `studi-tutor-draft:${sessionId}:${question.blockId}:${question.attempts.length}`;
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) ?? question.draft);
  const [picked, setPicked] = useState<number | null>(null);
  const button = useRef<HTMLButtonElement>(null), field = useRef<HTMLInputElement>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const saved = useRef(question.draft), saving = useRef<Promise<void>>(Promise.resolve());
  const open = view.move === "check";
  const flush = useCallback(() => {
    const value = latest.current;
    saving.current = saving.current.catch(() => {}).then(async () => {
      if (saved.current === value) return;
      await window.studi!.saveTutorDraft({ sessionId, blockId: question.blockId, draft: value });
      saved.current = value;
    });
    return saving.current;
  }, [sessionId, question.blockId]);
  useEffect(() => open ? registerFlush(flush) : undefined, [open, registerFlush, flush]);
  useEffect(() => {
    if (!open || draft === saved.current) return;
    const timer = setTimeout(() => { void flush().catch(cause => onError("Your draft is saved on this device. " + String(cause))); }, 500);
    return () => clearTimeout(timer);
  }, [open, draft, flush]);
  const edit = (value: string) => {
    latest.current = value; setDraft(value);
    try { localStorage.setItem(draftKey, value); } catch { onError("Your draft could not be saved. Keep this window open."); }
  };

  // The newest try is the result, unless the question is open again for another.
  const result = open ? null : question.result;
  const struck = new Set(view.tries.flatMap(item => item.answer.kind === "choice" ? [item.answer.picked] : []));
  const options = question.tool === "tutor_ask_choice" ? question.args.options : [];
  // A typed answer the app couldn't match may still be right: it isn't struck until Chalky has answered.
  const reading = !!result && (result.correct === null || (question.tool === "tutor_ask_typed" && !result.correct && result.matched === false && !view.feedback.length && view.move === "wait"));
  const ready = question.tool === "tutor_ask_choice" ? picked !== null : !!draft.trim();
  const going = view.move === "next" || view.move === "finish";
  const submit = async () => {
    if (going) return onMove();
    if (!open || !ready || disabled) return;
    const value: TutorBlockAnswer = question.tool === "tutor_ask_choice" ? { kind: "choice", picked: picked! } : question.tool === "tutor_ask_typed" ? { kind: "typed", answer: draft } : { kind: "explain", text: draft };
    if (await onAnswer(value)) localStorage.removeItem(draftKey);
  };
  // Pressing an option's letter picks it.
  useEffect(() => {
    if (!open || !options.length) return;
    const press = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.matches("input, textarea, select"))) return;
      const index = event.key.length === 1 ? event.key.toUpperCase().charCodeAt(0) - 65 : -1;
      if (index >= 0 && index < options.length && !struck.has(index)) setPicked(index);
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [open, options.length, view.tries.length]);
  // Once there is somewhere to go, Enter goes there, unless the student is writing to Chalky.
  useEffect(() => { if (going && !document.activeElement?.closest(".tu-side")) button.current?.focus({ preventScroll: true }); }, [going]);

  const hints = question.tool === "tutor_ask_typed" ? question.args.hints : [];
  const canHint = question.tool === "tutor_ask_typed" && open && question.args.hasMoreHints;
  const needsTry = canHint && question.hintsUsed > 0 && !draft.trim();
  const given = result && (result.answer.kind === "typed" ? result.answer.answer : result.answer.kind === "explain" ? result.answer.text : null);
  const beside = reading ? "Chalky is reading it…" : view.move === "wait" ? "Chalky is writing…" : "";
  const action = <>
    <button ref={button} className="tu-btn" disabled={going ? false : disabled || !open || !ready}>
      {view.move === "finish" ? "See how you did" : going || result ? "Next" : "Check"}{going && <Icon name="forward" size={18} />}
    </button>
    {beside && <span className="tu-lab" role="status">{beside}</span>}
  </>;
  return (
    <form className="tu-answer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {question.tool === "tutor_ask_choice" && <>
        <div className="tu-opts" role="radiogroup" aria-label="Options">
          {options.map((option, index) => {
            const chosen = result?.answer.kind === "choice" ? result.answer.picked === index : picked === index;
            const wrong = struck.has(index) || (chosen && result?.correct === false);
            return <button key={index} type="button" role="radio" aria-checked={chosen} className={`${chosen ? "is-on" : ""}${wrong ? " is-wrong" : ""}`} disabled={!open || disabled || struck.has(index)} onClick={() => setPicked(index)}>
              <i>{String.fromCharCode(65 + index)}</i><span>{option}</span>{chosen && result?.correct && <Tick size={24} />}
            </button>;
          })}
        </div>
        <div className="tu-ans">{action}</div>
      </>}
      {question.tool === "tutor_ask_typed" && <div className="tu-ans">
        <span className="tu-lab">Your answer</span>
        {view.tries.map((item, index) => item.answer.kind === "typed" && <s key={index} className="tu-was">{item.answer.answer}</s>)}
        {open ? <input ref={field} className="tu-field" autoFocus autoComplete="off" aria-label="Your answer" value={draft} maxLength={10000} disabled={disabled} onChange={event => edit(event.target.value)} />
          : result?.correct ? <><span className="tu-right">{given}</span><Tick /></>
          : reading ? <span className="tu-given">{given}</span> : <s className="tu-was">{given}</s>}
        {action}
        {canHint && <button type="button" className="tu-hint" disabled={disabled || needsTry} onClick={() => { onHint(); field.current?.focus(); }}>{HINTS[Math.min(question.hintsUsed, 2)]}</button>}
      </div>}
      {question.tool === "tutor_ask_explain" && <>
        {view.tries.map((item, index) => item.answer.kind === "explain" && <p key={index} className="tu-area is-sent is-was">{item.answer.text}</p>)}
        {open ? <textarea className="tu-area" autoFocus aria-label="Your answer" value={draft} maxLength={10000} disabled={disabled} placeholder="Type it the way you'd say it out loud. Messy is fine." onChange={event => edit(event.target.value)} />
          : <p className="tu-area is-sent">{given}</p>}
        {question.args.points && <ul className="tu-points">{question.args.points.map((point, index) => <li key={index} className={point.met ? "" : "is-off"}>{point.met ? <Tick size={20} /> : <Dash />}{point.text}</li>)}</ul>}
        <div className="tu-ans">{action}</div>
      </>}
      {needsTry && <p className="tu-lab">Type your best try first.</p>}
      {hints.length > 0 && <ol className="tu-hints">{hints.map((hint, index) => <li key={index} className="tu-w"><ChatMarkdown text={hint} /></li>)}</ol>}
    </form>
  );
}

/** The last board: what clicked, where each topic stands, and what was added to the cheat sheet. */
function WrapUp({ session, goal, topicTitle, onStart, onLeave }: {
  session: PublicTutorSession; goal: Exam | null; topicTitle: (topicId: string) => string; onStart: (input: TutorStartInput) => void; onLeave: () => void;
}) {
  const result = session.result;
  if (session.mode === "mock_exam") {
    const scores = session.topicIds.map(topicId => {
      const graded = session.blocks.filter(block => (block.tool === "tutor_ask_typed" || block.tool === "tutor_ask_explain" || block.tool === "tutor_ask_choice")
        && (block.args.topicId ?? session.topicId) === topicId && typeof block.result?.correct === "boolean");
      return { topicId, right: graded.filter(block => block.result!.correct).length, total: graded.length };
    }).filter(score => score.total);
    const right = scores.reduce((sum, score) => sum + score.right, 0), total = scores.reduce((sum, score) => sum + score.total, 0);
    const weakest = [...scores].sort((a, b) => a.right / a.total - b.right / b.total)[0];
    const study = weakest && weakest.right < weakest.total ? weakest : null;
    return <>
      <h1 className="tu-score">{total ? `${right} out of ${total}` : "Quiz stopped."}</h1>
      {(result?.summary ?? session.error) && <div className="tu-w"><ChatMarkdown text={result?.summary ?? session.error!} /></div>}
      {scores.length > 0 && <>
        <h2 className="tu-sec">{goal?.title ?? "Quiz"}, by topic</h2>
        <ul className="tu-bars">{scores.map(score => <li key={score.topicId} className={score === study ? "is-weak" : ""}>
          <span>{topicTitle(score.topicId)}</span><span className="lr-bar"><i style={{ width: `${Math.round(score.right / score.total * 100)}%` }} /></span><b>{score.right} / {score.total}</b>
        </li>)}</ul>
      </>}
      <div className="tu-ans">
        {study ? <button className="tu-btn" onClick={() => onStart({ topicId: study.topicId, minutes: 15 })}>Study {topicTitle(study.topicId)} · 15 min</button> : <button className="tu-btn" onClick={onLeave}>Back to Learn</button>}
        {study && <button className="rd-quiet" onClick={onLeave}>Back to Learn</button>}
      </div>
    </>;
  }
  const back = (date: string) => { const days = daysFrom(date); return days <= 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? `on ${weekday(date)}` : `next ${weekday(date)}`; };
  return <>
    <h1 className="tu-q">{session.status === "completed" ? "That's today's session." : session.status === "expired" ? "Time's up for today." : "We stopped here."}</h1>
    <div className="tu-plain"><ChatMarkdown text={result?.summary ?? session.error ?? "Your answers so far are saved."} /></div>
    {Boolean(result?.clicked.length) && <>
      <h2 className="tu-sec">What clicked</h2>
      {result!.clicked.map((item, index) => <dl key={index} className="tu-clicked"><dt>Before</dt><dd><s>{item.before}</s></dd><dt>Now</dt><dd><span>{item.after}</span></dd></dl>)}
    </>}
    {Boolean(result?.assessments.length) && <>
      <h2 className="tu-sec">Where you are</h2>
      <ul className="tu-lev">{result!.assessments.map(item => <li key={item.topicId}>
        <span>{topicTitle(item.topicId)}</span>
        <span className="lr-level" role="img" aria-label={item.level === null ? "No level yet" : `Level ${item.level} of 4`}>{[0, 1, 2, 3].map(index => <i key={index} className={item.level !== null && index < item.level ? "on" : ""} />)}</span>
        <span>{item.level === null ? "Not enough on-your-own answers to set a level yet."
          : <><b>{LEVELS[item.level]}</b>{item.previousLevel === null || item.previousLevel === item.level ? "." : `, ${item.level > item.previousLevel ? "up" : "down"} from ${LEVELS[item.previousLevel]}.`}{item.dueOn && ` Back ${back(item.dueOn)}.`}</>}</span>
      </li>)}</ul>
    </>}
    {Boolean(result?.cheatsheet.length) && <><h2 className="tu-sec">Added to your cheat sheet</h2><ul className="tu-list">{result!.cheatsheet.map((line, index) => <li key={index}>{line}</li>)}</ul></>}
    {Boolean(result?.missing.length) && <><h2 className="tu-sec">Still to practise</h2><ul className="tu-list">{result!.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
    <div className="tu-ans"><button className="tu-btn" onClick={onLeave}>Back to Learn</button></div>
  </>;
}
