import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SchoolOnboardingState } from "../../shared/index.js";
import type { LearnState } from "../../shared/learn-state.js";
import { computeReadiness, orderGoals, type Exam } from "../../shared/learn.js";
import type { PublicTutorSession, TutorStartInput } from "../../shared/tutor.js";
import { AppChrome } from "./Ui.js";
import type { ChromeProps } from "./WorkspaceScreens.js";
import { Inky, type InkyState } from "./Inky.js";
import { courseTone } from "./assignmentPresentation.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { LearnConversation } from "./LearnConversation.js";
import { TutorScreen } from "./TutorScreen.js";
import "./learn.css";

const LEVELS = ["Not yet", "Shaky", "Getting there", "Good", "Solid"];
type Panel = null | "add-exam" | "else" | "change";

const localToday = () => new Date().toLocaleDateString("en-CA");
const daysUntil = (date: string) => Math.round((Date.parse(date + "T00:00:00") - Date.parse(localToday() + "T00:00:00")) / 86_400_000);
const shortDate = (date: string) => new Date(date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const firstLine = (text: string) => text.trim().split("\n")[0]!.slice(0, 120);

export function LearnScreen({ chrome, onboarding, requestedSession, onSessionOpened }: {
  chrome: ChromeProps; onboarding: SchoolOnboardingState; requestedSession: string | null; onSessionOpened: () => void;
}) {
  const [state, setState] = useState<LearnState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
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
        const next = await window.studi!.getLearnState({ selectedExamId: selected });
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
  }, [selected, refresh]);

  useEffect(() => {
    if (!requestedSession) return;
    let alive = true;
    void window.studi!.getTutorSession({ sessionId: requestedSession })
      .then(next => { if (alive) setSession(next); })
      .catch(cause => { if (alive) setError(String(cause)); })
      .finally(onSessionOpened);
    return () => { alive = false; };
  }, [requestedSession]);

  /** One action at a time. Main answers with the selected goal still selected. */
  const run = async (action: () => Promise<LearnState>) => {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await action();
      if (mounted.current) { setState(next); setSelected(next.plan.leadExam?.examId ?? null); }
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

  const courseLabel = (courseId: string | null) => courseId ? onboarding.courses.find(course => course.courseId === courseId)?.label ?? null : null;
  const goals = state ? orderGoals(state.exams, localToday()) : [];
  const goal = state?.plan.leadExam ?? null;
  const reading = state?.sources.filter(source => source.status === "pending" || source.status === "reading") ?? [];
  const failed = state?.sources.filter(source => source.status === "failed") ?? [];
  const scanning = onboarding.scan?.state === "running";
  const findExams = () => void run(() => window.studi!.findLearnSyllabus());
  const hello = helloFor(state, goal, courseLabel);

  return (
    <main className="app-shell rd-learn" data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="rd-learn-scroll">
        <div className="rd-column lr-column">
          <header className="rd-hello">
            <Inky size={64} state={busy || reading.length || scanning ? "thinking" : hello.inky} />
            <div><h1>{hello.title}</h1><p>{hello.body}</p></div>
          </header>

          {error && <p className="rd-error" role="alert">
            {error === "load" ? "I couldn't open your learning plan." : error}
            {error === "load" && <button className="rd-link" onClick={() => setRefresh(value => value + 1)}>Try again</button>}
          </p>}
          {!state && !error && <p className="lr-muted" role="status">Opening your learning plan…</p>}

          {(scanning || reading.length > 0) && <p className="lr-status" role="status">
            <Inky size={26} state="scanning" />
            {scanning ? "Looking through your classes for exams and study guides. Read-only; keep going." : `Reading ${reading.map(source => source.title).join(", ")}…`}
          </p>}
          {failed.map(source => <p key={source.sourceId} className="lr-status is-bad" role="alert">
            <span>I couldn't read <b>{source.title}</b>. {source.error}</span>
            <button className="rd-quiet" disabled={busy} onClick={() => void run(() => window.studi!.retryLearnSource({ sourceId: source.sourceId }))}>Try again</button>
          </p>)}

          {state && !goals.length && panel === null && <>
            <Intake busy={busy} placeholder="Drop a syllabus or study guide, or type “stats midterm next Friday, chapters 1 to 5”"
              onText={text => run(() => window.studi!.importLearnSource({ courseId: null, examId: null, title: firstLine(text), text }))}
              lead={<button className="rd-button rd-primary" disabled={busy || scanning} onClick={findExams}>Find my exams</button>}
              onFile={() => void run(() => window.studi!.importLearnFile({ courseId: null, examId: null }))} hint="PDF or text" />
            <div className="lr-adds"><button className="lr-dash" onClick={() => setPanel("else")}>+ Learn something that isn't for a class</button></div>
          </>}

          {goals.length > 0 && <GoalList goals={goals} state={state!} selected={goal?.examId ?? null} courseLabel={courseLabel}
            onSelect={examId => { setPanel(null); void run(() => window.studi!.getLearnState({ selectedExamId: examId })); }} />}

          {goals.length > 0 && panel === null && goal && state && <GoalCard state={state} goal={goal} busy={busy} scanning={scanning}
            courseLabel={courseLabel} onStart={input => void start(input)} onOpenSession={sessionId => void openSession(sessionId)}
            onChange={() => setPanel("change")} onFind={findExams}
            onText={text => run(() => window.studi!.importLearnSource({ courseId: goal.courseId, examId: goal.examId, title: firstLine(text), text }))}
            onFile={() => void run(() => window.studi!.importLearnFile({ courseId: goal.courseId, examId: goal.examId }))}
            onRemove={() => void run(() => window.studi!.removeLearnGoal({ examId: goal.examId }))} />}

          {goals.length > 0 && panel === null && <div className="lr-adds">
            <button className="lr-dash" onClick={() => setPanel("add-exam")}>+ Add an exam</button>
            <button className="lr-dash" onClick={() => setPanel("else")}>+ Learn something else</button>
          </div>}

          {panel === "add-exam" && <ExamForm title="Add an exam" busy={busy} courses={onboarding.courses} onCancel={() => setPanel(null)}
            onSave={async (input, text) => {
              const next = await run(() => window.studi!.setLearnExam({ ...input, kind: "exam" }));
              const examId = next?.plan.leadExam?.examId;
              if (next && examId && text) await run(() => window.studi!.importLearnSource({ courseId: input.courseId, examId, title: `${input.title} notes`, text }));
              if (next) setPanel(null);
            }} />}
          {panel === "change" && goal && <ExamForm title={`Change ${goal.title}`} goal={goal} busy={busy} courses={onboarding.courses}
            topics={state!.topics.filter(topic => topic.examId === goal.examId && topic.origin !== "homework_hint")}
            onCancel={() => setPanel(null)}
            onRemoveTopic={topicId => void run(() => window.studi!.removeLearnTopic({ topicId }))}
            onAddTopic={title => void run(() => window.studi!.addLearnTopic({ examId: goal.examId, title }))}
            onRemove={() => void run(() => window.studi!.removeLearnGoal({ examId: goal.examId })).then(next => { if (next) setPanel(null); })}
            onSave={async input => { if (await run(() => window.studi!.setLearnExam({ ...input, examId: goal.examId }))) setPanel(null); }} />}
          {panel === "else" && <SomethingElse busy={busy} onCancel={() => setPanel(null)} onStart={async (title, note) => {
            const next = await run(() => window.studi!.setLearnExam({ kind: "topic", courseId: null, title, date: null, scopeNote: note || null }));
            const topic = next?.plan.todayTopic;
            if (topic) { setPanel(null); await start({ topicId: topic.topicId, minutes: 5, goal: `A quick check on ${title}` }); }
          }} />}
        </div>
      </div>
      <LearnConversation onOpenContext={chrome.onOpenContext} storageKey={chrome.storageKey ?? chrome.studentName} />
    </main>
  );
}

function helloFor(state: LearnState | null, goal: Exam | null, courseLabel: (courseId: string | null) => string | null): { title: string; body: string; inky: InkyState } {
  if (!state || !goal) return { title: "What are you getting ready for?", body: "Give me anything about it. I'll work out the exams, the topics and a plan.", inky: "hello" };
  const topics = state.topics.filter(topic => topic.examId === goal.examId && topic.origin !== "homework_hint");
  const next = state.plan.todayTopic ? ` Next up: ${state.plan.todayTopic.title}.` : "";
  if (goal.kind === "topic") {
    const count = state.sessions.filter(item => topics.some(topic => topic.topicId === item.topicId) && item.status === "completed").length;
    return { title: `${goal.title}.`, body: `${count ? `${plural(count, "session")} so far.` : "Not started yet."}${next}`, inky: "idle" };
  }
  const readiness = state.plan.readiness;
  const checked = topics.filter(topic => state.mastery.some(record => record.topicId === topic.topicId)).length;
  const body = !topics.length ? `I know this exam exists, but not what's on it${goal.courseId ? ` for ${courseLabel(goal.courseId) ?? "the class"}` : ""}.`
    : readiness.status === "known" ? `About ${readiness.percent}% ready.${next}`
    : checked ? `${checked} of ${plural(topics.length, "topic")} checked.${next}`
    : `${plural(topics.length, "topic")} to cover. Nothing checked yet.${next}`;
  if (!goal.date) return { title: `${goal.title}, no date yet.`, body, inky: "idle" };
  const days = daysUntil(goal.date);
  const title = days < 0 ? `${goal.title} was on ${shortDate(goal.date)}.` : days === 0 ? `${goal.title} is today.` : days === 1 ? `${goal.title} is tomorrow.` : `${goal.title} in ${days} days.`;
  return { title, body, inky: days >= 0 && days <= 2 ? "working" : "idle" };
}

function GoalList({ goals, state, selected, courseLabel, onSelect }: {
  goals: Exam[]; state: LearnState; selected: string | null; courseLabel: (courseId: string | null) => string | null; onSelect: (examId: string) => void;
}) {
  const row = (goal: Exam) => {
    const topics = state.topics.filter(topic => topic.examId === goal.examId && topic.origin !== "homework_hint");
    const label = courseLabel(goal.courseId);
    const sources = state.sources.filter(source => source.status === "ready" && (source.examId === goal.examId || (!source.examId && !!goal.courseId && source.courseId === goal.courseId))).length;
    const levels = new Map(state.mastery.map(record => [record.topicId, record.level]));
    const progress = topics.length ? topics.reduce((sum, topic) => sum + (levels.get(topic.topicId) ?? 0), 0) / (topics.length * 4) : 0;
    const readiness = computeReadiness(topics, state.mastery);
    const sessions = state.sessions.filter(item => item.status === "completed" && topics.some(topic => topic.topicId === item.topicId)).length;
    const meta = goal.kind === "topic" ? "Not for a class" : [label?.split(" ").slice(0, 2).join(" "), sources ? plural(sources, "source") : "nothing to study from yet"].filter(Boolean).join(" · ");
    return (
      <button key={goal.examId} className={`lr-goal course-accent-${goal.kind === "topic" ? "none" : courseTone(label ?? goal.title)}`} aria-pressed={goal.examId === selected} onClick={() => onSelect(goal.examId)}>
        <span className="lr-goal-name"><b>{goal.title}</b><small>{meta}</small></span>
        {goal.kind === "exam" && topics.length > 0 && <span className="lr-bar" role="img" aria-label={readiness.percent !== null ? `About ${readiness.percent}% ready` : "Readiness not known yet"}><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
        <span className="lr-goal-when">{goal.kind === "topic" ? <b>{sessions ? plural(sessions, "session") : "New"}</b>
          : goal.date ? <><b>{daysUntil(goal.date) < 0 ? "Done" : daysUntil(goal.date) === 0 ? "Today" : plural(daysUntil(goal.date), "day")}</b><small>{shortDate(goal.date)}</small></> : <b>No date</b>}</span>
      </button>
    );
  };
  const exams = goals.filter(goal => goal.kind === "exam"), other = goals.filter(goal => goal.kind === "topic");
  return (
    <nav className="lr-goals" aria-label="What you're learning for">
      {exams.map(row)}
      {other.length > 0 && <><p className="lr-label">Not for a test</p>{other.map(row)}</>}
    </nav>
  );
}

function GoalCard({ state, goal, busy, scanning, courseLabel, onStart, onOpenSession, onChange, onFind, onText, onFile, onRemove }: {
  state: LearnState; goal: Exam; busy: boolean; scanning: boolean; courseLabel: (courseId: string | null) => string | null;
  onStart: (input: TutorStartInput) => void; onOpenSession: (sessionId: string) => void; onChange: () => void; onFind: () => void;
  onText: (text: string) => Promise<unknown>; onFile: () => void; onRemove: () => void;
}) {
  const topics = state.topics.filter(topic => topic.examId === goal.examId && topic.origin !== "homework_hint").sort((a, b) => a.chapter - b.chapter);
  const levels = new Map(state.mastery.map(record => [record.topicId, record.level]));
  const weightSum = topics.every(topic => topic.weight) ? topics.reduce((sum, topic) => sum + topic.weight!, 0) : 0;
  const open = state.sessions.find(item => ["active", "paused", "failed"].includes(item.status) && topics.some(topic => topic.topicId === item.topicId));
  const { todayTopic, recapDue, recapTopic, readiness } = state.plan;
  const hints = state.topics.filter(topic => topic.origin === "homework_hint" && goal.courseId && topic.courseId === goal.courseId).slice(0, 2);
  const sources = state.sources.filter(source => source.status === "ready" && (source.examId === goal.examId || (!source.examId && !!goal.courseId && source.courseId === goal.courseId)));
  const course = courseLabel(goal.courseId);

  if (!topics.length) return (
    <section className="lr-card">
      <p className="lr-voice">{goal.kind === "topic" ? "Start with a short check and I'll propose an outline." : "Tell me what's on it: drop the syllabus or study guide, or type the chapters."}</p>
      {goal.kind === "exam" && <Intake busy={busy} placeholder="“Chapters 6 to 11”, or paste the study guide" onText={onText} onFile={onFile}
        lead={goal.courseId ? <button className="rd-button rd-primary" disabled={busy || scanning} onClick={onFind}>Look in {course?.split(" ").slice(0, 2).join(" ") ?? "the class"}</button> : undefined} />}
      <div className="lr-card-foot"><button className="rd-quiet" onClick={onChange}>Change</button><button className="rd-quiet lr-danger" disabled={busy} onClick={onRemove}>Remove this {goal.kind === "topic" ? "goal" : "exam"}</button></div>
    </section>
  );

  const lead = open ? { title: `Continue: ${open.goal}`, meta: open.status === "paused" ? "Right where you left off." : open.status === "failed" ? "It stopped early. Your answers are saved." : "In progress.", action: () => onOpenSession(open.sessionId), label: "Continue" }
    : recapDue && recapTopic ? { title: `Quick recap: ${recapTopic.title}`, meta: "Bring it back while it's still fresh · 5 min", action: () => onStart({ topicId: recapTopic.topicId, mode: "recap", minutes: 5 }), label: "Start" }
    : todayTopic ? { title: `${goal.kind === "topic" ? "Next" : "Today"}: ${todayTopic.title}`,
        meta: `${levels.has(todayTopic.topicId) ? "Your biggest gap" : "Not checked yet"}${weightSum ? " for its share of the exam" : ""} · 15 min`,
        action: () => onStart({ topicId: todayTopic.topicId, minutes: 15 }), label: "Start" } : null;
  return (
    <section className="lr-card">
      {lead && <div className="lr-lead">
        <div><b>{lead.title}</b><small>{lead.meta}</small></div>
        <button className="rd-button rd-primary lr-start" disabled={busy} onClick={lead.action}>{lead.label}</button>
      </div>}
      <div className="lr-head"><h2>{goal.kind === "topic" ? "Your outline" : "What's on it"}</h2>
        <span>{goal.kind === "topic" ? "Change it any time." : readiness.status === "known" ? `About ${readiness.percent}% ready` : levels.size ? "From your sessions only" : "Nothing checked yet"}</span></div>
      <ul className="lr-topics">
        {topics.map(topic => {
          const level = levels.get(topic.topicId);
          return <li key={topic.topicId}>
            <span className="lr-topic-name">{topic.title}{weightSum > 0 && <small>{Math.round(topic.weight! / weightSum * 100)}%</small>}</span>
            <span className="lr-level" role="img" aria-label={level === undefined ? "Not checked" : `Level ${level} of 4`}>{[0, 1, 2, 3].map(i => <i key={i} className={level !== undefined && i < level ? "on" : level === undefined ? "none" : ""} />)}</span>
            <span className="lr-level-word">{level === undefined ? "Not checked" : LEVELS[level]}</span>
            <button className="rd-quiet lr-practise" disabled={busy} onClick={() => onStart({ topicId: topic.topicId, minutes: 15 })} aria-label={`Practise ${topic.title}`}>Practise</button>
          </li>;
        })}
      </ul>
      {goal.kind === "exam" && topics.length <= 30 && <div className="lr-lead lr-quiz">
        <div><b>Test yourself</b><small>No teaching. Questions like your teacher's, then a score by topic.</small></div>
        <button className="rd-quiet" disabled={busy} onClick={() => onStart({ mode: "mock_exam", examId: goal.examId, minutes: 10 })}>10 minute quiz</button>
      </div>}
      {hints.length > 0 && <div className="lr-hints">
        <p className="lr-label">From homework I did</p>
        {hints.map(topic => <div key={topic.topicId} className="lr-hint"><span>{topic.title}</span>
          <button className="rd-quiet" disabled={busy} onClick={() => onStart({ topicId: topic.topicId, minutes: 10 })}>Learn it in 10 min</button></div>)}
      </div>}
      <div className="lr-card-foot">
        <span className="lr-muted">{sources.length ? `From ${sources.slice(0, 2).map(source => source.title).join(", ")}${sources.length > 2 ? ` and ${sources.length - 2} more` : ""}` : goal.kind === "topic" ? "Your outline came from your first check." : "Topics you typed."}</span>
        <button className="rd-quiet" disabled={busy} onClick={onFile}>Add a file</button>
        <button className="rd-quiet" onClick={onChange}>Change</button>
      </div>
    </section>
  );
}

function Intake({ busy, placeholder, lead, hint, onText, onFile }: {
  busy: boolean; placeholder: string; lead?: ReactNode | undefined; hint?: string; onText: (text: string) => Promise<unknown>; onFile: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <form className="lr-intake" onSubmit={event => { event.preventDefault(); if (text.trim()) void onText(text.trim()).then(next => { if (next) setText(""); }); }}>
      <textarea aria-label="Syllabus, study guide or exam details" rows={2} maxLength={200_000} placeholder={placeholder} value={text} onChange={event => setText(event.target.value)} />
      <div className="lr-ways">
        {text.trim() ? <button className="rd-button rd-primary" disabled={busy}>Use this</button> : lead}
        <button type="button" className="rd-quiet" disabled={busy} onClick={onFile}>Choose a file</button>
        {hint && <span className="lr-muted">{hint}</span>}
      </div>
    </form>
  );
}

function ExamForm({ title, goal, topics, busy, courses, onSave, onCancel, onRemove, onAddTopic, onRemoveTopic }: {
  title: string; goal?: Exam; topics?: LearnState["topics"]; busy: boolean; courses: SchoolOnboardingState["courses"];
  onSave: (input: { courseId: string | null; title: string; date: string | null; scopeNote?: string | null }, text: string) => Promise<void> | void;
  onCancel: () => void; onRemove?: () => void; onAddTopic?: (title: string) => void; onRemoveTopic?: (topicId: string) => void;
}) {
  const [name, setName] = useState(goal?.title ?? ""), [date, setDate] = useState(goal?.date ?? ""),
    [courseId, setCourseId] = useState(goal ? goal.courseId ?? "" : courses[0]?.courseId ?? ""),
    [note, setNote] = useState(goal?.scopeNote ?? ""), [text, setText] = useState(""), [topic, setTopic] = useState("");
  const isTopic = goal?.kind === "topic";
  return (
    <form className="lr-card lr-form" onSubmit={event => { event.preventDefault(); void onSave({ courseId: isTopic ? null : courseId || null, title: name.trim(), date: isTopic ? null : date || null, ...(goal ? { scopeNote: note.trim() || null } : {}) }, text.trim()); }}>
      <h2>{title}</h2>
      <div className="lr-fields">
        <label>Name<input required maxLength={500} value={name} placeholder="Midterm 2" onChange={event => setName(event.target.value)} /></label>
        {!isTopic && <label>Class<select value={courseId} onChange={event => setCourseId(event.target.value)}>
          <option value="">Not for a class</option>
          {courses.map(course => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}
        </select></label>}
        {!isTopic && <label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>}
      </div>
      {goal ? <label className="lr-wide">What it covers, in your words<textarea rows={2} maxLength={2000} value={note} placeholder="Only chapters 6 to 9. The professor said no proofs." onChange={event => setNote(event.target.value)} /></label>
        : <label className="lr-wide">What's on it, if you know<textarea rows={3} maxLength={200_000} value={text} placeholder="Paste the study guide, or type the chapters" onChange={event => setText(event.target.value)} /></label>}
      {topics && onRemoveTopic && <div className="lr-edit-topics">
        <p className="lr-label">Topics</p>
        {topics.map(item => <span key={item.topicId} className="lr-edit-topic">{item.title}<button type="button" aria-label={`Take ${item.title} off`} disabled={busy} onClick={() => onRemoveTopic(item.topicId)}>×</button></span>)}
        {onAddTopic && <span className="lr-add-topic"><input aria-label="New topic" placeholder="Add a topic" maxLength={500} value={topic} onChange={event => setTopic(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (topic.trim()) { onAddTopic(topic.trim()); setTopic(""); } } }} /></span>}
      </div>}
      <div className="lr-ways">
        <button className="rd-button rd-primary" disabled={busy || !name.trim()}>{goal ? "Save" : "Add this exam"}</button>
        <button type="button" className="rd-quiet" onClick={onCancel}>Cancel</button>
        <span className="lr-grow" />
        {onRemove && <button type="button" className="rd-quiet lr-danger" disabled={busy} onClick={onRemove}>Remove {isTopic ? "this goal" : "this exam"}</button>}
      </div>
    </form>
  );
}

function SomethingElse({ busy, onStart, onCancel }: { busy: boolean; onStart: (title: string, note: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(""), [note, setNote] = useState("");
  return (
    <form className="lr-card lr-form" onSubmit={event => { event.preventDefault(); if (title.trim()) void onStart(title.trim(), note.trim()); }}>
      <h2>Learn something that isn't for a class</h2>
      <label className="lr-wide">What do you want to learn?<input required maxLength={500} autoFocus value={title} placeholder="Python basics, how to read a balance sheet, anything" onChange={event => setTitle(event.target.value)} /></label>
      <label className="lr-wide">Why, or how far, if you like<input maxLength={2000} value={note} placeholder="For a summer internship. I know a little JavaScript." onChange={event => setNote(event.target.value)} /></label>
      <ol className="lr-steps">
        <li>A few questions, so I don't teach you what you know.</li>
        <li>I propose a short outline. You can change it.</li>
        <li>It shows up here, and we go one piece at a time.</li>
      </ol>
      <div className="lr-ways">
        <button className="rd-button rd-primary" disabled={busy || !title.trim()}>Start with a 5 minute check</button>
        <button type="button" className="rd-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
