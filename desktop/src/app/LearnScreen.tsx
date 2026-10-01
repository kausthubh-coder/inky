import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SchoolOnboardingState } from "../../shared/index.js";
import type { LearnState } from "../../shared/learn-state.js";
import { computeReadiness, orderGoals, planLearn, type Exam, type LearnPlan, type LearnTopic } from "../../shared/learn.js";
import type { PublicTutorSession, TutorSessionSummary, TutorStartInput } from "../../shared/tutor.js";
import { AppChrome } from "./Ui.js";
import type { ChromeProps } from "./WorkspaceScreens.js";
import { Character } from "./Character.js";
import type { ChalkyState } from "../../shared/characters/states.js";
import { courseTone } from "./assignmentPresentation.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { Icon } from "./Icon.js";
import { LearnConversation } from "./LearnConversation.js";
import { TutorScreen } from "./TutorScreen.js";
import "./learn.css";

const LEVELS = ["Not yet", "Shaky", "Getting there", "Good", "Solid"];
const COUNT = ["", "one quick one", "two quick ones", "three quick ones"];
/** The open row: a goal, or one of the two add forms. */
type Open = null | { examId: string; changing: boolean } | "add-test" | "new";

const DAY = 86_400_000;
const localToday = () => new Date().toLocaleDateString("en-CA");
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00") - Date.parse(from + "T00:00:00")) / DAY);
const daysUntil = (date: string) => daysBetween(localToday(), date);
const shortDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const weekday = (date: string) => new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "long" });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/** Brings a row that has just opened into view. */
const reveal = (node: HTMLElement | null) => node?.scrollIntoView({ block: "nearest" });
const firstLine = (text: string) => text.trim().split("\n")[0]!.slice(0, 120);
/** "today", "tomorrow", "on Thursday", then a date. */
const dayWord = (date: string) => {
  const days = daysUntil(date);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? `on ${weekday(date)}` : `on ${shortDate(date)}`;
};
const lastTime = (iso: string) => {
  const date = new Date(iso).toLocaleDateString("en-CA"), days = -daysUntil(date);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 7 ? `last ${weekday(date)}` : shortDate(date);
};

/** Everything one row and its open sheet need, worked out once per goal. */
interface GoalView {
  goal: Exam; name: string; course: string | null; tone: number | null; topics: LearnTopic[]; plan: LearnPlan;
  levels: Map<string, number>; open: TutorSessionSummary | undefined; done: TutorSessionSummary[];
}
function viewGoals(state: LearnState, courses: SchoolOnboardingState["courses"]): GoalView[] {
  const today = localToday(), goals = orderGoals(state.exams, today);
  const levels = new Map(state.mastery.map(record => [record.topicId, record.level]));
  return goals.map(goal => {
    const topics = state.topics.filter(topic => topic.examId === goal.examId && topic.origin !== "homework_hint").sort((a, b) => a.chapter - b.chapter);
    const mine = (session: TutorSessionSummary) => topics.some(topic => topic.topicId === session.topicId);
    const course = courses.find(item => item.courseId === goal.courseId)?.label.split(" ").slice(0, 2).join(" ") ?? null;
    const shared = goals.some(other => other !== goal && other.title === goal.title);
    return {
      goal, course, topics, levels, tone: goal.kind === "exam" ? courseTone(goal.courseId ?? goal.title, courses) : null, name: shared && course ? `${course} ${goal.title}` : goal.title,
      plan: planLearn({ exams: state.exams, topics: state.topics, mastery: state.mastery, sessions: state.sessions, today, selectedExamId: goal.examId }),
      open: state.sessions.find(session => ["active", "paused", "failed"].includes(session.status) && mine(session)),
      done: state.sessions.filter(session => session.status === "completed" && mine(session)),
    };
  });
}
function paceLine(view: GoalView): string {
  const left = view.plan.topicsLeft, date = view.goal.date, readiness = view.plan.readiness;
  if (!left) return readiness.status === "known" ? `About ${readiness.percent}% ready.` : "Every topic is Good or better.";
  if (!date) return `${plural(left, "topic")} to go.`;
  const days = daysUntil(date);
  if (days <= 0) return `${plural(left, "topic")} to go, and it's today.`;
  if (left > days) return `${plural(left, "topic")} to go in ${plural(days, "day")}: ${Math.ceil(left / days)} a day.`;
  return `${plural(left, "topic")} to go. ${left === days ? "One a day gets you there." : `One a day leaves you ${plural(days - left, "day")} spare.`}`;
}

export function LearnScreen({ chrome, onboarding, requestedSession, onSessionOpened }: {
  chrome: ChromeProps; onboarding: SchoolOnboardingState; requestedSession: string | null; onSessionOpened: () => void;
}) {
  const [state, setState] = useState<LearnState | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [session, setSession] = useState<PublicTutorSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false), mounted = useRef(true), previewOpened = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const read = async () => {
      if (reading || lock.current) return;
      reading = true;
      try {
        const next = await window.studi!.getLearnState();
        if (!mounted.current) return;
        setState(next);
        setError(current => current === "load" ? "" : current);
        if (!previewOpened.current && readDevPreviewConfig()?.id.startsWith("tutor-") && next.sessions[0]) {
          previewOpened.current = true;
          void openSession(next.sessions[0].sessionId);
        }
      } catch {
        if (mounted.current) setError("load");
      } finally { reading = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 2500);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!requestedSession) return;
    let alive = true;
    void window.studi!.getTutorSession({ sessionId: requestedSession })
      .then(next => { if (alive) setSession(next); })
      .catch(cause => { if (alive) setError(String(cause)); })
      .finally(onSessionOpened);
    return () => { alive = false; };
  }, [requestedSession]);

  /** One action at a time. */
  const run = async (action: () => Promise<LearnState>) => {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await action();
      if (mounted.current) setState(next);
      return next;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const openSession = async (sessionId: string) => {
    try { setSession(await window.studi!.getTutorSession({ sessionId })); } catch (cause) { setError(String(cause)); }
  };
  const start = async (input: TutorStartInput) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { setSession(await window.studi!.startTutorSession(input)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  };

  if (session) return <TutorScreen key={session.sessionId} initial={session} onOpenContext={chrome.onOpenContext}
    goal={state?.exams.find(exam => exam.examId === session.examId) ?? null}
    courseLabel={courseId => onboarding.courses.find(course => course.courseId === courseId)?.label ?? null}
    topicTitle={topicId => state?.topics.find(topic => topic.topicId === topicId)?.title ?? session.goal}
    onStart={input => void start(input)}
    onLeave={() => { setSession(null); setRefresh(value => value + 1); }} />;

  const views = state ? viewGoals(state, onboarding.courses) : [];
  const tests = views.filter(view => view.goal.kind === "exam"), own = views.filter(view => view.goal.kind === "topic");
  const reading = state?.sources.filter(source => source.status === "pending" || source.status === "reading") ?? [];
  const failed = state?.sources.filter(source => source.status === "failed") ?? [];
  const scanning = onboarding.scan?.state === "running";
  const hello = helloFor(state, views);
  /** The created goal comes back as the lead exam, because main selects it. */
  const startNew = async (title: string, note: string, begin: boolean) => {
    const next = await run(() => window.studi!.setLearnExam({ kind: "topic", courseId: null, title, date: null, scopeNote: note || null }));
    if (!next) return;
    setOpen(null);
    const topic = next.plan.todayTopic;
    if (begin && topic) await start({ topicId: topic.topicId, minutes: 5, goal: `A quick check on ${title}` });
  };
  const addText = (text: string) => run(() => window.studi!.importLearnSource({ courseId: null, examId: null, title: firstLine(text), text }));

  const rows = (list: GoalView[]) => list.map(view => {
    const openHere = typeof open === "object" && open?.examId === view.goal.examId ? open : null;
    const row = <GoalRow key={view.goal.examId} view={view} expanded={!!openHere}
      onToggle={() => setOpen(openHere ? null : { examId: view.goal.examId, changing: false })} />;
    if (!openHere) return row;
    const { goal } = view;
    return <div key={goal.examId} className="lr-open" ref={reveal}>
      {row}
      {openHere.changing
        ? <ExamForm goal={goal} busy={busy} courses={onboarding.courses} topics={view.topics} scanning={scanning}
            onCancel={() => setOpen({ examId: goal.examId, changing: false })}
            onRemoveTopic={topicId => void run(() => window.studi!.removeLearnTopic({ topicId }))}
            onAddTopic={title => void run(() => window.studi!.addLearnTopic({ examId: goal.examId, title }))}
            onFind={goal.courseId ? () => void run(() => window.studi!.findLearnSyllabus({ courseId: goal.courseId! })) : undefined}
            onRemove={() => void run(() => window.studi!.removeLearnGoal({ examId: goal.examId })).then(next => { if (next) setOpen(null); })}
            onSave={async input => { if (await run(() => window.studi!.setLearnExam({ ...input, examId: goal.examId }))) setOpen({ examId: goal.examId, changing: false }); }} />
        : <GoalDetail view={view} state={state!} busy={busy} scanning={scanning}
            onStart={input => void start(input)} onOpenSession={sessionId => void openSession(sessionId)}
            onChange={() => setOpen({ examId: goal.examId, changing: true })}
            onFind={() => void run(() => goal.courseId ? window.studi!.findLearnSyllabus({ courseId: goal.courseId }) : window.studi!.findLearnSyllabus())}
            onText={text => run(() => window.studi!.importLearnSource({ courseId: goal.courseId, examId: goal.examId, title: firstLine(text), text }))}
            onFile={() => void run(() => window.studi!.importLearnFile({ courseId: goal.courseId, examId: goal.examId }))} />}
    </div>;
  });

  return (
    <main className="app-shell rd-learn" data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="rd-learn-scroll">
        <div className="rd-column lr-column">
          <header className="lr-hello">
            <Character kind="chalky" size={64} state={busy || reading.length || scanning ? "thinking" : hello.chalky} />
            <div><h1>{hello.title}</h1>{hello.body && <p>{hello.body}</p>}</div>
            {hello.action && <button className="rd-button rd-primary lr-go" disabled={busy} onClick={() => hello.action!.run({ start: input => void start(input), open: id => void openSession(id) })}>{hello.action.label}</button>}
          </header>

          {error && <p className="rd-error" role="alert">
            {error === "load" ? "I couldn't open your learning plan." : error}
            {error === "load" && <button className="rd-link" onClick={() => setRefresh(value => value + 1)}>Try again</button>}
          </p>}
          {!state && !error && <p className="lr-muted" role="status">Opening your learning plan…</p>}
          {(scanning || reading.length > 0) && <p className="lr-status" role="status">
            {scanning ? "Looking through your classes for tests and study guides. Read-only; keep going." : `Reading ${reading.map(source => source.title).join(", ")}…`}
          </p>}
          {failed.map(source => <p key={source.sourceId} className="lr-status is-bad" role="alert">
            <span>I couldn't read <b>{source.title}</b>. {source.error}</span>
            <button className="rd-quiet" disabled={busy} onClick={() => void run(() => window.studi!.retryLearnSource({ sourceId: source.sourceId }))}>Try again</button>
          </p>)}

          {state && !views.length && <div className="lr-doors">
            <section className="lr-door">
              <h2>A test that's coming up</h2>
              <p>Give me anything about it. I'll work out what's on it and a plan.</p>
              <Intake busy={busy} placeholder="Drop a syllabus or study guide, or type “stats midterm next Friday, chapters 1 to 5”" onText={addText}
                lead={<button className="rd-button rd-primary" disabled={busy || scanning} onClick={() => void run(() => window.studi!.findLearnSyllabus())}>Find my tests</button>}
                onFile={() => void run(() => window.studi!.importLearnFile({ courseId: null, examId: null }))} />
            </section>
            <section className="lr-door">
              <h2>Something for yourself</h2>
              <p>No class, no deadline. Anything you're curious about.</p>
              <NewGoal busy={busy} bare onStart={startNew} />
            </section>
          </div>}

          {views.length > 0 && <>
            <section className="lr-group" aria-label="Tests">
              <div className="lr-bar-head"><h2>Tests</h2></div>
              {rows(tests)}
              {open === "add-test"
                ? <div className="lr-open" ref={reveal}>
                    <div className="lr-sheet-head"><h3>Add a test</h3><button className="rd-quiet lr-plain" onClick={() => setOpen(null)}>Cancel</button></div>
                    <AddTest busy={busy} scanning={scanning} courses={onboarding.courses}
                      onText={async text => { if (await addText(text)) setOpen(null); }}
                      onFile={() => void run(() => window.studi!.importLearnFile({ courseId: null, examId: null })).then(next => { if (next) setOpen(null); })}
                      onFind={() => void run(() => window.studi!.findLearnSyllabus()).then(next => { if (next) setOpen(null); })}
                      onSave={async (input, text) => {
                        const next = await run(() => window.studi!.setLearnExam({ ...input, kind: "exam" }));
                        const examId = next?.plan.leadExam?.examId;
                        if (next && examId && text) await run(() => window.studi!.importLearnSource({ courseId: input.courseId, examId, title: `${input.title} notes`, text }));
                        if (next) setOpen(examId ? { examId, changing: false } : null);
                      }} />
                  </div>
                : <button className="lr-addrow" onClick={() => setOpen("add-test")}>+ Add a test</button>}
            </section>
            <section className="lr-group" aria-label="For yourself">
              <div className="lr-bar-head"><h2>For yourself</h2><span>No test, no deadline.</span></div>
              {rows(own)}
              {open === "new"
                ? <div className="lr-open" ref={reveal}>
                    <div className="lr-sheet-head"><h3>What do you want to learn?</h3><button className="rd-quiet lr-plain" onClick={() => setOpen(null)}>Cancel</button></div>
                    <NewGoal busy={busy} onStart={startNew} />
                  </div>
                : <button className="lr-addrow" onClick={() => setOpen("new")}>+ Learn something new</button>}
            </section>
          </>}
        </div>
      </div>
      <LearnConversation onOpenContext={chrome.onOpenContext} storageKey={chrome.storageKey ?? chrome.studentName} />
    </main>
  );
}

interface Hello {
  title: string; body: ReactNode; chalky: ChalkyState;
  action?: { label: string; run: (act: { start: (input: TutorStartInput) => void; open: (sessionId: string) => void }) => void };
}
/** One suggestion across every goal: the nearest goal that has something to do. */
function helloFor(state: LearnState | null, views: GoalView[]): Hello {
  if (!state || !views.length) return { title: "What do you want to learn?", body: "I'm Chalky. Short lessons, one idea at a time, and I remember where you got to.", chalky: "hello" };
  const view = views.find(item => item.open || item.plan.todayTopic || item.plan.comingBack.length);
  if (!view) {
    const dueOn = new Map(state.mastery.flatMap(record => record.review ? [[record.topicId, record.review.dueOn] as const] : []));
    const next = views.flatMap(item => item.topics.map(topic => ({ item, topic, due: dueOn.get(topic.topicId) }))).filter(entry => entry.due).sort((a, b) => a.due!.localeCompare(b.due!))[0];
    return { title: "Nothing to do today.", chalky: "idle", body: next ? <>Next is <b>{next.topic.title}</b> in {next.item.name}, {dayWord(next.due!)}.</> : null };
  }
  const { goal, plan, name } = view, days = goal.date ? daysUntil(goal.date) : null;
  const title = days === null || goal.kind === "topic" ? `${name}.` : days <= 0 ? `${name} is today.` : days === 1 ? `${name} is tomorrow.` : `${name} is in ${days} days.`;
  const chalky: ChalkyState = days !== null && days <= 2 ? "explaining" : "idle";
  if (view.open) return { title, chalky, body: <>You're partway through <b>{view.open.goal}</b>. Your answers are saved.</>, action: { label: "Continue", run: act => act.open(view.open!.sessionId) } };
  const topic = plan.todayTopic;
  if (topic) {
    const earlier = Math.min(3, plan.comingBack.filter(item => item.topicId !== topic.topicId).length);
    const why = goal.kind === "topic" || days === null ? "" : view.levels.has(topic.topicId) ? ", your biggest gap" : ", not checked yet";
    return { title, chalky, body: <>Next up is <b>{topic.title}</b>{why}.{earlier ? ` We'll start with ${COUNT[earlier]} from earlier.` : ""}</>,
      action: { label: "Start · 15 min", run: act => act.start({ topicId: topic.topicId, minutes: 15 }) } };
  }
  const first = plan.comingBack[0]!;
  return { title, chalky, body: `Nothing new today. ${plural(plan.comingBack.length, "topic")} ${plan.comingBack.length === 1 ? "is" : "are"} coming back for a quick check.`,
    action: { label: "Start · 5 min", run: act => act.start({ topicId: first.topicId, mode: "recap", minutes: 5 }) } };
}

/** One mark per topic, darker as the topic gets stronger, hollow when it hasn't been checked. */
function Strip({ view }: { view: GoalView }) {
  if (!view.topics.length) return <span />;
  const good = view.topics.filter(topic => (view.levels.get(topic.topicId) ?? 0) >= 3).length;
  return <span className="lr-strip" role="img" aria-label={`${good} of ${plural(view.topics.length, "topic")} Good or better`}>
    {view.topics.map(topic => <i key={topic.topicId} data-level={view.levels.get(topic.topicId) ?? "none"} />)}
  </span>;
}

function GoalRow({ view, expanded, onToggle }: { view: GoalView; expanded: boolean; onToggle: () => void }) {
  const { goal, plan, topics, done } = view, exam = goal.kind === "exam";
  const next = plan.todayTopic ?? plan.comingBack[0] ?? null;
  const days = goal.date ? daysUntil(goal.date) : null;
  const under = expanded
    ? exam ? view.course ?? "Not for a class" : goal.scopeNote ?? "For yourself"
    : <>{exam && view.course ? `${view.course} · ` : ""}{!topics.length ? exam ? "Tell me what's on it" : "Starts with a 5 minute check" : next ? <>Next: <b>{next.title}</b></> : "Nothing due today"}</>;
  return (
    <button className={`lr-row${view.tone === null ? "" : ` course-accent-${view.tone}`}`} aria-expanded={expanded} onClick={onToggle}>
      <span className="lr-row-name"><strong>{goal.title}</strong><small>{under}</small></span>
      <Strip view={view} />
      <span className="lr-when">
        {exam
          ? <><b>{days === null ? "No date" : days <= 0 ? "Today" : days === 1 ? "Tomorrow" : plural(days, "day")}</b>{goal.date && <small>{shortDate(goal.date)}</small>}</>
          : <><b>{done.length ? plural(done.length, "session") : "New"}</b>{done[0]?.finishedAt && <small>{lastTime(done[0].finishedAt)}</small>}</>}
      </span>
    </button>
  );
}

function GoalDetail({ view, state, busy, scanning, onStart, onOpenSession, onChange, onFind, onText, onFile }: {
  view: GoalView; state: LearnState; busy: boolean; scanning: boolean;
  onStart: (input: TutorStartInput) => void; onOpenSession: (sessionId: string) => void; onChange: () => void; onFind: () => void;
  onText: (text: string) => Promise<unknown>; onFile: () => void;
}) {
  const { goal, topics, plan, levels } = view, exam = goal.kind === "exam";
  const weightSum = topics.length && topics.every(topic => topic.weight) ? topics.reduce((sum, topic) => sum + topic.weight!, 0) : 0;
  const reviews = new Map(state.mastery.map(record => [record.topicId, record.review]));
  const hints = state.topics.filter(topic => topic.origin === "homework_hint" && goal.courseId && topic.courseId === goal.courseId).slice(0, 2);
  const sources = state.sources.filter(source => source.status === "ready" && (source.examId === goal.examId || (!source.examId && !!goal.courseId && source.courseId === goal.courseId)));
  const nextId = view.open?.topicId ?? plan.todayTopic?.topicId ?? plan.comingBack[0]?.topicId;

  if (!topics.length) return (
    <div className="lr-detail">
      <div className="lr-pace"><span>{exam ? "Tell me what's on it: drop the syllabus or study guide, or type the chapters." : "Start with a short check and I'll suggest an outline."}</span>
        <button className="rd-quiet" onClick={onChange}>Change</button></div>
      {exam && <Intake busy={busy} placeholder="“Chapters 6 to 11”, or paste the study guide" onText={onText} onFile={onFile}
        lead={goal.courseId ? <button className="rd-button" disabled={busy || scanning} onClick={onFind}>Look in {view.course ?? "the class"}</button> : undefined} />}
    </div>
  );
  return (
    <div className="lr-detail">
      <div className="lr-pace"><span>{exam ? paceLine(view) : "Your outline. Chalky suggested it after your first check; change it any time."}</span>
        <button className="rd-quiet" onClick={onChange}>Change</button></div>
      <ul className="lr-topics">
        {topics.map(topic => {
          const level = levels.get(topic.topicId), review = reviews.get(topic.topicId), isNext = topic.topicId === nextId;
          const back = review && level !== undefined && level >= 3 && daysUntil(review.dueOn) <= 1
            ? `${review.lastRightOn ? `Last right ${daysBetween(review.lastRightOn, localToday()) === 0 ? "today" : `${plural(daysBetween(review.lastRightOn, localToday()), "day")} ago`}. ` : ""}Coming back ${dayWord(review.dueOn)}.` : null;
          return <li key={topic.topicId} className={isNext ? "is-next" : undefined}>
            <span className="lr-topic-name"><b>{topic.title}</b>{weightSum > 0 && <i>{Math.round(topic.weight! / weightSum * 100)}%</i>}{back && <small>{back}</small>}</span>
            <span className="lr-level" role="img" aria-label={level === undefined ? "Not checked" : `Level ${level} of 4`}>{[0, 1, 2, 3].map(i => <i key={i} className={level !== undefined && i < level ? "on" : level === undefined ? "none" : ""} />)}</span>
            <span className="lr-level-word">{level === undefined ? "Not checked" : LEVELS[level]}</span>
            {isNext
              ? view.open
                ? <button className="rd-button" disabled={busy} onClick={() => onOpenSession(view.open!.sessionId)}>Continue</button>
                : <button className="rd-button" disabled={busy} onClick={() => onStart({ topicId: topic.topicId, minutes: 15 })}>Start · 15 min</button>
              : <button className="rd-quiet lr-practise" disabled={busy} onClick={() => onStart({ topicId: topic.topicId, minutes: 15 })} aria-label={`Practise ${topic.title}`}>Practise</button>}
          </li>;
        })}
      </ul>
      {exam && topics.length <= 30 && <button className="lr-more" disabled={busy} onClick={() => onStart({ mode: "mock_exam", examId: goal.examId, minutes: 10 })}>
        <b>Test yourself</b><span>10 minutes of questions like your teacher's, no teaching</span><Icon name="forward" size={16} />
      </button>}
      {hints.map(topic => <button key={topic.topicId} className="lr-more" disabled={busy} onClick={() => onStart({ topicId: topic.topicId, minutes: 10 })}>
        <b>From homework</b><span>{topic.title}: learn it in 10 minutes</span><Icon name="forward" size={16} />
      </button>)}
      {exam && <div className="lr-more">
        <b>Studying from</b>
        <span>{sources.length ? `${sources.slice(0, 2).map(source => source.title).join(", ")}${sources.length > 2 ? ` and ${sources.length - 2} more` : ""}` : "The topics you typed"}</span>
        <button className="rd-quiet" disabled={busy} onClick={onFile}>Add a file</button>
      </div>}
    </div>
  );
}

function Intake({ busy, placeholder, lead, onText, onFile }: {
  busy: boolean; placeholder: string; lead?: ReactNode | undefined; onText: (text: string) => Promise<unknown>; onFile: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <form className="lr-intake" onSubmit={event => { event.preventDefault(); if (text.trim()) void onText(text.trim()).then(next => { if (next) setText(""); }); }}>
      <textarea className="lr-drop" aria-label="Syllabus, study guide or test details" rows={2} maxLength={200_000} placeholder={placeholder} value={text} onChange={event => setText(event.target.value)} />
      <div className="lr-ways">
        {text.trim() ? <button className="rd-button" disabled={busy}>Use this</button> : lead}
        <button type="button" className="rd-quiet" disabled={busy} onClick={onFile}>Choose a file</button>
      </div>
    </form>
  );
}

type ExamInput = { courseId: string | null; title: string; date: string | null; scopeNote?: string | null };

/** Adding a test: hand Chalky anything about it, or fill in the name and date yourself. */
function AddTest({ busy, scanning, courses, onText, onFile, onFind, onSave }: {
  busy: boolean; scanning: boolean; courses: SchoolOnboardingState["courses"];
  onText: (text: string) => Promise<unknown>; onFile: () => void; onFind: () => void; onSave: (input: ExamInput, text: string) => Promise<void>;
}) {
  const [manual, setManual] = useState(false);
  if (manual) return <ExamForm busy={busy} courses={courses} onCancel={() => setManual(false)} onSave={onSave} />;
  return (
    <div className="lr-detail">
      <Intake busy={busy} placeholder="Drop a syllabus or study guide, or type “stats midterm next Friday, chapters 1 to 5”" onText={onText} onFile={onFile}
        lead={<button className="rd-button" disabled={busy || scanning} onClick={onFind}>Find my tests</button>} />
      <button className="rd-link lr-own" onClick={() => setManual(true)}>Enter the name and date myself</button>
    </div>
  );
}

function ExamForm({ goal, topics, busy, scanning, courses, onSave, onCancel, onRemove, onAddTopic, onRemoveTopic, onFind }: {
  goal?: Exam; topics?: LearnTopic[]; busy: boolean; scanning?: boolean; courses: SchoolOnboardingState["courses"];
  onSave: (input: ExamInput, text: string) => Promise<void> | void;
  onCancel: () => void; onRemove?: () => void; onAddTopic?: (title: string) => void; onRemoveTopic?: (topicId: string) => void; onFind?: (() => void) | undefined;
}) {
  const [name, setName] = useState(goal?.title ?? ""), [date, setDate] = useState(goal?.date ?? ""),
    [courseId, setCourseId] = useState(goal ? goal.courseId ?? "" : courses[0]?.courseId ?? ""),
    [note, setNote] = useState(goal?.scopeNote ?? ""), [text, setText] = useState(""), [topic, setTopic] = useState("");
  const own = goal?.kind === "topic";
  return (
    <form className="lr-detail lr-form" onSubmit={event => { event.preventDefault(); void onSave({ courseId: own ? null : courseId || null, title: name.trim(), date: own ? null : date || null, ...(goal ? { scopeNote: note.trim() || null } : {}) }, text.trim()); }}>
      <div className="lr-fields">
        <label>Name<input required maxLength={500} value={name} placeholder="Midterm 2" onChange={event => setName(event.target.value)} /></label>
        {!own && <label>Class<select value={courseId} onChange={event => setCourseId(event.target.value)}>
          <option value="">Not for a class</option>
          {courses.map(course => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}
        </select></label>}
        {!own && <label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>}
      </div>
      {goal ? <label className="lr-wide">{own ? "Why, or how far" : "What it covers, in your words"}<textarea rows={2} maxLength={2000} value={note} placeholder={own ? "For a summer internship. I know a little JavaScript." : "Only chapters 6 to 9. The professor said no proofs."} onChange={event => setNote(event.target.value)} /></label>
        : <label className="lr-wide">What's on it, if you know<textarea rows={3} maxLength={200_000} value={text} placeholder="Paste the study guide, or type the chapters" onChange={event => setText(event.target.value)} /></label>}
      {topics && onRemoveTopic && <div className="lr-edit-topics">
        <p className="lr-label">Topics</p>
        {topics.map(item => <span key={item.topicId} className="lr-edit-topic">{item.title}<button type="button" aria-label={`Take ${item.title} off`} disabled={busy} onClick={() => onRemoveTopic(item.topicId)}>×</button></span>)}
        {onAddTopic && <span className="lr-add-topic"><input aria-label="New topic" placeholder="Add a topic" maxLength={500} value={topic} onChange={event => setTopic(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (topic.trim()) { onAddTopic(topic.trim()); setTopic(""); } } }} /></span>}
      </div>}
      <div className="lr-ways">
        <button className="rd-button" disabled={busy || !name.trim()}>{goal ? "Save" : "Add this test"}</button>
        <button type="button" className="rd-quiet" onClick={onCancel}>Cancel</button>
        {onFind && <button type="button" className="rd-quiet" disabled={busy || scanning} onClick={onFind}>Find more in class</button>}
        <span className="lr-grow" />
        {onRemove && <button type="button" className="rd-quiet lr-danger" disabled={busy} onClick={onRemove}>Remove {own ? "this goal" : "this test"}</button>}
      </div>
    </form>
  );
}

/** Something to learn that isn't for a test. `bare` is the first-run door, which has no steps beside it. */
function NewGoal({ busy, bare, onStart }: { busy: boolean; bare?: boolean; onStart: (title: string, note: string, begin: boolean) => Promise<void> }) {
  const [title, setTitle] = useState(""), [note, setNote] = useState("");
  const fields = <>
    {bare
      ? <textarea className="lr-drop" aria-label="What do you want to learn?" rows={2} maxLength={500} value={title} placeholder="Python basics, how mortgages work, reading sheet music…" onChange={event => setTitle(event.target.value)} />
      : <label className="lr-wide">The thing<input required maxLength={500} autoFocus value={title} placeholder="Python basics, how mortgages work, anything" onChange={event => setTitle(event.target.value)} /></label>}
    {!bare && <label className="lr-wide">Why, or how far, if you like<input maxLength={2000} value={note} placeholder="For a summer internship. I know a little JavaScript." onChange={event => setNote(event.target.value)} /></label>}
    <div className="lr-ways">
      <button className="rd-button" disabled={busy || !title.trim()}>Start with a 5 minute check</button>
      {!bare && <button type="button" className="rd-quiet" disabled={busy || !title.trim()} onClick={() => void onStart(title.trim(), note.trim(), false)}>Just add it for later</button>}
    </div>
  </>;
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (title.trim()) void onStart(title.trim(), note.trim(), true); };
  if (bare) return <form className="lr-intake" onSubmit={submit}>{fields}</form>;
  return (
    <form className="lr-detail lr-form lr-new" onSubmit={submit}>
      <div>{fields}</div>
      <div><p className="lr-label">What happens</p>
        <ol className="lr-steps">
          <li>A few questions, so I don't teach you what you know.</li>
          <li>I suggest a short outline. You can change it.</li>
          <li>One piece at a time, whenever you like.</li>
        </ol></div>
    </form>
  );
}
