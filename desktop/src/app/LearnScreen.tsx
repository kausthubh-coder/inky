import { useEffect, useRef, useState } from "react";
import type { SchoolOnboardingState } from "../../shared/index.js";
import type { LearnState } from "../../shared/learn-state.js";
import type {
  PublicTutorSession,
  TutorStartInput,
} from "../../shared/tutor.js";
import { AppChrome } from "./Ui.js";
import type { ChromeProps } from "./WorkspaceScreens.js";
import { Inky } from "./Inky.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { LearnConversation } from "./LearnConversation.js";
import { TutorScreen } from "./TutorScreen.js";

const levels = ["New", "Shaky", "Getting there", "Good", "Solid"];
export function LearnScreen({
  chrome,
  onboarding,
  requestedSession,
  onSessionOpened,
}: {
  chrome: ChromeProps;
  onboarding: SchoolOnboardingState;
  requestedSession: string | null;
  onSessionOpened: () => void;
}) {
  const [state, setState] = useState<LearnState | null>(null),
    [selected, setSelected] = useState(""),
    [free, setFree] = useState(false),
    [topic, setTopic] = useState("");
  const [session, setSession] = useState<PublicTutorSession | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [paste, setPaste] = useState(false),
    [sourceTitle, setSourceTitle] = useState(""),
    [sourceText, setSourceText] = useState(""),
    [courseId, setCourseId] = useState(""),
    [examEditor, setExamEditor] = useState(false),
    [date, setDate] = useState(""),
    [examTitle, setExamTitle] = useState("");
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true),
    lock = useRef(false),
    previewOpened = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let reading = false;
    const read = async () => {
      if (reading || lock.current) return;
      reading = true;
      try {
        const next = await window.studi!.getLearnState(
          selected ? { selectedExamId: selected } : undefined,
        );
        if (mounted.current) {
          setState(next);
          setError("");
          if (
            !previewOpened.current &&
            readDevPreviewConfig()?.id.startsWith("tutor-") &&
            next.sessions[0]
          ) {
            previewOpened.current = true;
            void openSession(next.sessions[0].sessionId);
          }
        }
      } catch (cause) {
        if (mounted.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2500);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [selected, refresh]);
  useEffect(() => {
    if (!requestedSession) return;
    let alive = true;
    void window
      .studi!.getTutorSession({ sessionId: requestedSession })
      .then((next) => {
        if (alive) {
          setSession(next);
          onSessionOpened();
        }
      })
      .catch((cause) => {
        if (alive) {
          setError(String(cause));
          onSessionOpened();
        }
      });
    return () => {
      alive = false;
    };
  }, [requestedSession]);
  const run = async (action: () => Promise<LearnState>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await action();
      if (mounted.current) setState(next);
      return next;
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const openSession = async (sessionId: string) => {
    setError("");
    setBusy(true);
    try {
      setSession(await window.studi!.getTutorSession({ sessionId }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const start = async (input: TutorStartInput) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await window.studi!.startTutorSession(input);
      setSession(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  if (session)
    return (
      <TutorScreen
        key={session.sessionId}
        initial={session}
        onOpenContext={chrome.onOpenContext}
        onLeave={() => {
          setSession(null);
          setRefresh((value) => value + 1);
        }}
      />
    );
  const exam =
    state?.exams.find((item) => item.examId === selected) ??
    state?.plan.leadExam ??
    state?.exams[0];
  const topics =
    state?.topics.filter(
      (item) => item.examId === exam?.examId && item.origin !== "homework_hint",
    ) ?? [];
  const todayTopic = state?.plan.todayTopic;
  const days = exam?.date
    ? Math.ceil(
        (new Date(exam.date + "T00:00:00").getTime() -
          new Date(new Date().toDateString()).getTime()) /
          86400000,
      )
    : null;
  const readiness = state?.plan.readiness;
  const lead = free
    ? "What do you want to learn?"
    : !state?.sources.length
      ? "What are we getting ready for?"
      : exam
        ? days === null
          ? "When’s your exam?"
          : days === 0
            ? "Your exam is today."
            : days === 1
              ? "Exam tomorrow."
              : days < 0
                ? "What’s next?"
                : `${exam.title} in ${days} days.`
        : "Let’s find what’s on it.";
  const subtitle = free
    ? "It doesn’t have to be for a class."
    : !state?.sources.length
      ? "Give me a syllabus and I’ll work out what to practise."
      : readiness?.status === "known" && readiness.percent !== null
        ? `You’re about ${readiness.percent}% ready. We’ll work on what needs you most.`
        : readiness?.status === "partial"
          ? "We’ve checked some topics. A few more before I can estimate readiness."
          : "I haven’t checked what you know yet.";
  return (
    <main className="app-shell rd-learn" data-studi-app-ready="true">
      <AppChrome {...chrome} />
      <div className="rd-learn-scroll">
        <div className="rd-column">
          <div className="rd-hello">
            <Inky size={64} state={busy ? "thinking" : "idle"} />
            <div>
              <h1>{lead}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <nav className="rd-learn-targets" aria-label="Learning target">
            {state?.exams.map((item) => (
              <button
                key={item.examId}
                className="rd-chip"
                aria-pressed={!free && exam?.examId === item.examId}
                onClick={() => {
                  setFree(false);
                  setSelected(item.examId);
                }}
              >
                {item.title}
              </button>
            ))}
            <button
              className="rd-chip"
              aria-pressed={free}
              onClick={() => setFree(true)}
            >
              Something else
            </button>
          </nav>
          {error && (
            <p className="rd-error" role="alert">
              {error}
              <button
                className="rd-link"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Try again
              </button>
            </p>
          )}
          {!state && !error && <p role="status">Opening your learning plan…</p>}
          {free ? (
            <>
              <form
                className="rd-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (topic.trim())
                    void start({ topic: topic.trim(), minutes: 5 });
                }}
              >
                <input
                  aria-label="What you want to learn"
                  maxLength={500}
                  placeholder="Python basics, how to write a lab report, anything"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                />
                <button
                  className="rd-button primary"
                  disabled={busy || !topic.trim()}
                >
                  Start a 5 minute check
                </button>
              </form>
              <div className="rd-actions">
                {[
                  "Python basics",
                  "How to write a lab report",
                  "Linear algebra refresher",
                ].map((value) => (
                  <button
                    className="rd-link"
                    key={value}
                    onClick={() => setTopic(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {state?.sessions
                .filter((item) => ["active", "paused"].includes(item.status))
                .map((item) => (
                  <div className="rd-learn-row" key={item.sessionId}>
                    <div>
                      <strong>{item.goal}</strong>
                      <p>
                        {item.status === "paused"
                          ? "Right where you left off."
                          : "Your session is in progress."}
                      </p>
                    </div>
                    <button
                      className="rd-button"
                      disabled={busy}
                      onClick={() => void openSession(item.sessionId)}
                    >
                      Continue
                    </button>
                  </div>
                ))}
              {!!topics.length && (
                <>
                  <div className="rd-learn-row">
                    <div>
                      <strong>
                        {todayTopic
                          ? `Today: ${todayTopic.title}`
                          : "Start with a 5 minute check"}
                      </strong>
                      <p>
                        {todayTopic
                          ? "A short session on the topic that needs you most."
                          : "A few questions, then I’ll plan the days."}{" "}
                        · {todayTopic ? 15 : 5} min
                      </p>
                    </div>
                    <button
                      className="rd-button primary"
                      disabled={busy}
                      onClick={() =>
                        void start({
                          topicId: (todayTopic ?? topics[0])!.topicId,
                          minutes: todayTopic ? 15 : 5,
                        })
                      }
                    >
                      Start
                    </button>
                  </div>
                  {state?.plan.recapDue && state.plan.recapTopic && (
                    <div className="rd-learn-row">
                      <div>
                        <strong>
                          A quick recap: {state.plan.recapTopic.title}
                        </strong>
                        <p>Bring it back while it’s still fresh. · 5 min</p>
                      </div>
                      <button
                        className="rd-button"
                        disabled={busy}
                        onClick={() =>
                          void start({
                            topicId: state.plan.recapTopic!.topicId,
                            mode: "recap",
                            minutes: 5,
                          })
                        }
                      >
                        Recap
                      </button>
                    </div>
                  )}
                  {Boolean(state?.plan.path.length) && (
                    <section>
                      <div className="rd-section">
                        <h2>The path to {exam?.title}</h2>
                      </div>
                      <div className="rd-learn-path">
                        {state?.plan.path.map((item, index) => (
                          <div
                            key={item.date + item.kind + index}
                            className={index === 0 ? "on" : ""}
                          >
                            <time>
                              {new Date(
                                item.date + "T12:00:00",
                              ).toLocaleDateString([], {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}
                            </time>
                            <b>
                              {item.kind === "mock_exam"
                                ? "Mock exam"
                                : item.kind === "recap"
                                  ? "Recap"
                                  : (state.topics.find(
                                      (topic) => topic.topicId === item.topicId,
                                    )?.title ?? "Topic")}
                            </b>
                            <span>{item.minutes} min</span>
                            {item.kind === "mock_exam" && exam && (
                              <button
                                className="rd-link"
                                disabled={busy}
                                onClick={() =>
                                  void start({
                                    mode: "mock_exam",
                                    examId: exam.examId,
                                    minutes: item.minutes,
                                  })
                                }
                              >
                                Start
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  <div className="rd-section">
                    <h2>
                      {state?.mastery.length ? "What you know" : "What’s on it"}
                    </h2>
                    <span>From your sessions only</span>
                  </div>
                  {topics.map((item) => {
                    const mastery = state?.mastery.find(
                      (record) => record.topicId === item.topicId,
                    );
                    return (
                      <div className="rd-topic" key={item.topicId}>
                        <button
                          className="rd-link"
                          disabled={busy}
                          onClick={() =>
                            void start({ topicId: item.topicId, minutes: 15 })
                          }
                        >
                          {item.title}
                        </button>
                        <div
                          className="rd-level"
                          role="img"
                          aria-label={
                            mastery
                              ? `Level ${mastery.level} of 4`
                              : "Not checked"
                          }
                        >
                          {[0, 1, 2, 3].map((i) => (
                            <i
                              key={i}
                              className={
                                mastery && i < mastery.level ? "filled" : ""
                              }
                            />
                          ))}
                        </div>
                        <span>
                          {mastery ? levels[mastery.level] : "Not checked"}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
              {exam && (
                <div className="rd-source-note">
                  {exam.date ? (
                    <span>
                      {new Date(exam.date + "T12:00:00").toLocaleDateString(
                        [],
                        { month: "long", day: "numeric" },
                      )}{" "}
                      ·{" "}
                      {exam.dateOrigin === "student"
                        ? "Date you entered"
                        : "From your syllabus"}
                    </span>
                  ) : (
                    <span>No exam date found.</span>
                  )}
                  <button
                    className="rd-link danger"
                    onClick={() => {
                      setExamEditor(true);
                      setDate(exam.date ?? "");
                      setExamTitle(exam.title);
                    }}
                  >
                    Date wrong?
                  </button>
                </div>
              )}
              {examEditor && (
                <form
                  className="rd-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() =>
                      window.studi!.setLearnExam({
                        ...(exam ? { examId: exam.examId } : {}),
                        courseId: exam?.courseId ?? (courseId || null),
                        title: examTitle,
                        date: date || null,
                      }),
                    ).then((next) => {
                      if (next) setExamEditor(false);
                    });
                  }}
                >
                  <label>
                    Exam
                    <input
                      required
                      maxLength={500}
                      value={examTitle}
                      onChange={(event) => setExamTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    Date
                    <input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </label>
                  <button className="rd-button" disabled={busy}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="rd-link"
                    onClick={() => setExamEditor(false)}
                  >
                    Cancel
                  </button>
                </form>
              )}
              {state?.topics
                .filter((item) => item.origin === "homework_hint")
                .map((item) => (
                  <div className="rd-learn-row" key={item.topicId}>
                    <div>
                      <strong>{item.title}, while it’s fresh</strong>
                      <p>
                        From homework we worked on. Not counted toward exam
                        readiness.
                      </p>
                    </div>
                    <button
                      className="rd-link"
                      disabled={busy}
                      onClick={() =>
                        void start({ topicId: item.topicId, minutes: 10 })
                      }
                    >
                      Learn it in 10 min →
                    </button>
                  </div>
                ))}
              <section className="rd-learn-sources">
                <div className="rd-section">
                  <h2>
                    {state?.sources.length
                      ? "Your sources"
                      : "Start with a syllabus"}
                  </h2>
                  {!!state?.sources.length && (
                    <button
                      className="rd-link danger"
                      onClick={() => setPaste((value) => !value)}
                    >
                      Syllabus wrong?
                    </button>
                  )}
                </div>
                {state?.sources.map((source) => (
                  <div className="rd-learn-row" key={source.sourceId}>
                    <div>
                      <strong>{source.title}</strong>
                      <p>
                        {source.status === "reading" ||
                        source.status === "pending"
                          ? "Reading your syllabus…"
                          : (source.error ??
                            (source.extractedAt
                              ? "Read " +
                                new Date(
                                  source.extractedAt,
                                ).toLocaleDateString()
                              : "Not read yet"))}
                      </p>
                    </div>
                    {source.status === "failed" && (
                      <button
                        className="rd-link"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            window.studi!.retryLearnSource({
                              sourceId: source.sourceId,
                            }),
                          )
                        }
                      >
                        Try again
                      </button>
                    )}
                  </div>
                ))}
                <div className="rd-source-actions">
                  <label>
                    Class
                    <select
                      value={courseId}
                      onChange={(event) => setCourseId(event.target.value)}
                    >
                      <option value="">Not for a class</option>
                      {onboarding.courses.map((course) => (
                        <option key={course.courseId} value={course.courseId}>
                          {course.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="rd-button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => window.studi!.findLearnSyllabus())
                    }
                  >
                    Find my syllabus
                  </button>
                  <button
                    className="rd-button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.studi!.importLearnFile({
                          courseId: courseId || null,
                        }),
                      )
                    }
                  >
                    Upload a file
                  </button>
                  <button
                    className="rd-link"
                    onClick={() => setPaste((value) => !value)}
                  >
                    Paste it here
                  </button>
                  <button
                    className="rd-link"
                    onClick={() => {
                      setExamEditor(true);
                      setExamTitle("");
                      setDate("");
                    }}
                  >
                    Enter an exam
                  </button>
                </div>
                {paste && (
                  <form
                    className="rd-source-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(() =>
                        window.studi!.importLearnSource({
                          courseId: courseId || null,
                          title: sourceTitle,
                          text: sourceText,
                        }),
                      ).then((next) => {
                        if (next) {
                          setPaste(false);
                          setSourceTitle("");
                          setSourceText("");
                        }
                      });
                    }}
                  >
                    <label>
                      Source title
                      <input
                        required
                        maxLength={500}
                        value={sourceTitle}
                        onChange={(event) => setSourceTitle(event.target.value)}
                        placeholder="ST 370 syllabus"
                      />
                    </label>
                    <label>
                      Syllabus or exam topics
                      <textarea
                        required
                        maxLength={200000}
                        rows={6}
                        value={sourceText}
                        onChange={(event) => setSourceText(event.target.value)}
                      />
                    </label>
                    <button
                      className="rd-button primary"
                      disabled={
                        busy || !sourceTitle.trim() || !sourceText.trim()
                      }
                    >
                      {busy ? "Reading…" : "Use this syllabus"}
                    </button>
                  </form>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      <LearnConversation
        onOpenContext={chrome.onOpenContext}
        storageKey={chrome.storageKey ?? chrome.studentName}
      />
    </main>
  );
}
