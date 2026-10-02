import "./onboarding.css";
import { ConnectedAppRow } from "./ConnectedAppRow.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import type { ConnectionFeedbackMap } from "./useConnectedApps.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_PROVIDER_ID,
  agentProvider,
  agentProviderName,
  connectedAppCatalogEntry,
  connectedAppIsActive,
  presentSchoolOnboardingScan,
  providerLoginActive,
  selectedProvider,
  type AgentProviderId,
  type ConnectedAppConnection,
  type ConnectedAppsState,
  type PermissionMode,
  type SchoolOnboardingScanPresentation,
  type SchoolOnboardingState,
  type SchoolPageBounds,
  type StudiWorkspaceState,
} from "../../shared/index.js";
import type { Exam } from "../../shared/learn.js";
import { Character } from "./Character.js";
import type { DotState } from "../../shared/characters/states.js";
import { readDevPreviewConfig } from "./devPreview.js";
import { PreviewSchoolPage } from "./PreviewSchoolPage.js";
import { ProviderLoginHandoffView } from "./Ui.js";
import { courseTone } from "./assignmentPresentation.js";
import { useSchoolSlot } from "./schoolSlot.js";
import { onEngineChange } from "./engineChanges.js";
import { studiApi } from "./studiApi.js";

export type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const STEP_COPY: Record<OnboardingStep, { inky: DotState; title: string; body: string }> = {
  0: { inky: "hello", title: "Hey", body: "" },
  1: { inky: "idle", title: "Which one do you have?", body: "ChatGPT or Claude. Pick the one you pay for and I'll do the work with it." },
  2: { inky: "idle", title: "Bring your school apps?", body: "Connect where your notes, files and messages live." },
  3: { inky: "idle", title: "Give me one empty folder.", body: "I keep every class's work in it: your files, my drafts, anything I download. I can't open anything outside it." },
  4: { inky: "idle", title: "Where's class?", body: "Paste the link you open for homework." },
  5: { inky: "thinking", title: "When I find homework…", body: "What should I do?" },
  6: { inky: "idle", title: "How often should I check?", body: "I'll look even if you close Studi." },
  7: { inky: "waiting", title: "Your turn.", body: "Sign in on the right. I can't see your password. If your school asks, tick “remember this device” so I stay signed in." },
  8: { inky: "scanning", title: "Looking around.", body: "Your week fills up on the right as I go. Big school sites take 10 to 20 minutes, so you don't have to watch." },
  9: { inky: "needs", title: "Another site wants you to sign in.", body: "Do that on the right, then tell me." },
  10: { inky: "done", title: "Your week is ready.", body: "" },
};

// The default is the first one: Dot lists homework and works on it when the student asks.
const PERMISSIONS: Array<{ value: PermissionMode; title: string; detail: string }> = [
  { value: "do_not_attempt", title: "Just tell me about it", detail: "I'll list it and remind you. When you ask, I'll do it." },
  { value: "attempt", title: "Do it, I'll hand it in", detail: "I do the work and show you. You press Submit." },
  { value: "auto_submit", title: "Do it and hand it in", detail: "I submit it for you. Only if you really want that." },
];

const CADENCES: Array<{ value: "manual" | "daily" | "weekly"; title: string }> = [
  { value: "daily", title: "Every morning" },
  { value: "weekly", title: "Once a week" },
  { value: "manual", title: "Only when I ask" },
];

export function OnboardingScreen({
  workspace, onboarding, connectedApps, appConnections, appConnectionFeedback, studentName, schoolUrl, homeworkRoot, suggestedHomeworkRoot, scanCadence, defaultPermission, busy, error,
  initialStep,
  onStudentName, onSchoolUrl, onCadence, onDefaultPermission, onConnectRuntime, onCompleteRuntimeLogin, onCancelRuntimeLogin,
  onConnectApp, onRefreshConnectedApp, onSelectHomeworkRoot, onUseSuggestedHomeworkRoot, onSaveProfile, onStartScan, onResumeScan, onFinish,
}: {
  workspace: StudiWorkspaceState | null;
  onboarding: SchoolOnboardingState | null;
  connectedApps: ConnectedAppsState | null;
  appConnections: Readonly<Record<string, ConnectedAppConnection | null>>; appConnectionFeedback: ConnectionFeedbackMap;
  studentName: string;
  schoolUrl: string;
  homeworkRoot: string | null;
  suggestedHomeworkRoot: string | null;
  scanCadence: "manual" | "daily" | "weekly";
  defaultPermission: PermissionMode;
  busy: string | null;
  error: string | null;
  initialStep?: OnboardingStep | undefined;
  onStudentName: (value: string) => void;
  onSchoolUrl: (value: string) => void;
  onCadence: (value: "manual" | "daily" | "weekly") => void;
  onDefaultPermission: (value: PermissionMode) => void;
  onConnectRuntime: (providerId?: AgentProviderId) => void;
  onCompleteRuntimeLogin: (code: string) => void;
  onCancelRuntimeLogin: () => void;
  onConnectApp: (toolkit: string) => void;
  onRefreshConnectedApp: (toolkit: string) => void;
  onSelectHomeworkRoot: () => void;
  onUseSuggestedHomeworkRoot: () => void;
  onSaveProfile: () => void;
  onStartScan: () => void;
  onResumeScan: () => void;
  /** Leave onboarding, with or without the tour. Works before the school check ends, and with no school at all. */
  onFinish: (tour: boolean) => void;
}) {
  const provider = workspace ? selectedProvider(workspace) : null;
  const presentation = presentSchoolOnboardingScan(onboarding, provider);
  // A lapsed sign-in can still look ready locally; the failed scan is the truth.
  const providerReady = provider?.state === "ready" && presentation.kind !== "runtime_login";
  const providerLogin = workspace?.providerLogin;
  const loginActive = providerLoginActive(providerLogin);
  const profile = onboarding?.profile;
  const [step, setStep] = useState<OnboardingStep>(() => initialStep ?? readDevPreviewConfig()?.onboardingStep ?? (profile ? onboardingStepFor(presentation.step) : 0));
  const [scene, setScene] = useState<DotState | null>(null);
  const [folderPending, setFolderPending] = useState(false);

  useEffect(() => {
    if (profile) setStep(onboardingStepFor(presentation.step));
  }, [presentation.step, profile]);
  // "Use this folder" makes the suggested folder, then moves on once it exists.
  useEffect(() => { if (folderPending && homeworkRoot) { setFolderPending(false); setStep(4); } }, [folderPending, homeworkRoot]);
  useEffect(() => { if (folderPending && error) setFolderPending(false); }, [folderPending, error]);

  const current = stepCopy(step, presentation, onboarding, workspace);
  const inkyState = workspace?.browser.driver === "inky" ? "steering" : scene ?? current.inky;
  const browserStage = step >= 7;
  // The live page only shows inside a measured slot; everywhere else it stays hidden.
  useEffect(() => { void studiApi()?.setBrowserLayout({ mode: "hidden" }).catch(() => undefined); }, []);

  const connectedLabels = connectedApps?.toolkits.map(({ toolkit }) => toolkit).filter(toolkit => connectedAppIsActive(appConnections[toolkit] ?? null)).map(toolkit => connectedAppCatalogEntry(toolkit).label) ?? [];
  const told: [string, string, string][] = [
    [STEP_COPY[1].title, "Pick the one you pay for and I'll do the work with it.", provider?.providerName ?? agentProviderName(DEFAULT_AGENT_PROVIDER_ID)],
    [STEP_COPY[2].title, STEP_COPY[2].body, connectedLabels.length ? connectedLabels.join(", ") : "Not now"],
    [STEP_COPY[3].title, "I keep every class's work in it. I can't open anything outside it.", shortPath(homeworkRoot) ?? "Chosen"],
    [STEP_COPY[4].title, STEP_COPY[4].body, hostOf(schoolUrl)],
    [STEP_COPY[5].title, STEP_COPY[5].body, PERMISSIONS.find(item => item.value === defaultPermission)?.title ?? ""],
    [STEP_COPY[6].title, STEP_COPY[6].body, CADENCES.find(item => item.value === scanCadence)?.title ?? ""],
  ];
  const handoff = step === 9 && presentation.kind === "handoff";

  return (
    <main className="fable-onboarding" data-studi-app-ready="true">
      <section className="fable-window" role="application" aria-label="Talking to Dot">
        <div className={`fable-stage ${browserStage ? "with-browser" : ""}`}>
          <section className="fable-talk">
            <div className="fable-inky-wrap"><Character state={inkyState} size={browserStage ? 84 : step === 0 ? 150 : 200} label={`Dot is ${inkyState}`} /></div>
            <div className="fable-copy">
              {!browserStage && <div className="fable-who">talking to Dot</div>}
              {step === 0 ? <Welcome name={studentName} onName={onStudentName} onScene={setScene} onDone={() => { setScene(null); setStep(1); }} />
                : browserStage ? <Transcript told={told} step={step} title={current.title} body={step === 10 ? <ReadyNote onboarding={onboarding} permission={defaultPermission} /> : <ChatMarkdown text={current.body} />}
                  extra={step === 8 && onboarding?.scan?.currentStep ? <div className="ob-live fable-scan-progress" role="status"><span className="ob-dots" aria-hidden="true"><i /><i /><i /></span><ChatMarkdown text={onboarding.scan.currentStep} /></div> : null} />
                : <div className="fable-bubbles" aria-live="polite">
                  <div className="fable-message"><article className="fable-speech">
                    <span className="fable-tail" aria-hidden="true" />
                    <h1>{current.title}</h1>
                    <ChatMarkdown text={current.body} />
                    <StepExtra step={step} workspace={workspace} connectedApps={connectedApps} appConnections={appConnections} appConnectionFeedback={appConnectionFeedback} providerReady={providerReady} schoolUrl={schoolUrl} homeworkRoot={homeworkRoot} suggestedHomeworkRoot={suggestedHomeworkRoot} cadence={scanCadence} permission={defaultPermission} busy={busy} onSchoolUrl={onSchoolUrl} onCadence={onCadence} onPermission={onDefaultPermission} onConnect={onConnectRuntime} onCompleteConnect={onCompleteRuntimeLogin} onCancelConnect={onCancelRuntimeLogin} onConnectApp={onConnectApp} onRefreshConnectedApp={onRefreshConnectedApp} onSelectHomeworkRoot={onSelectHomeworkRoot} />
                  </article></div>
                </div>}

              {step !== 0 && <div className="fable-replies">
                {step === 1 && <>{providerReady ? <button className="fable-button primary" onClick={() => setStep(2)} disabled={busy !== null}>Let's go</button> : loginActive ? <button className="fable-button primary" disabled>Waiting…</button> : null}{presentation.kind !== "runtime_login" && <button className="fable-button" onClick={() => setStep(0)}>Back</button>}</>}
                {step === 2 && <><button className="fable-button primary" onClick={() => setStep(3)}>{connectedLabels.length ? "Continue" : "Skip for now"}</button><button className="fable-button" onClick={() => setStep(1)}>Back</button></>}
                {step === 3 && <><button className="fable-button primary" disabled={busy !== null || folderPending || (!homeworkRoot && !suggestedHomeworkRoot)} onClick={() => { if (homeworkRoot) setStep(4); else { setFolderPending(true); onUseSuggestedHomeworkRoot(); } }}>{folderPending ? "Making it…" : "Use this folder"}</button><button className="fable-button" onClick={() => setStep(2)}>Back</button></>}
                {step === 4 && <><button className="fable-button primary" onClick={() => { onSchoolUrl(withProtocol(schoolUrl)); setStep(5); }} disabled={!looksLikeLink(schoolUrl)}>That's the one</button><button className="fable-button" onClick={() => setStep(3)}>Back</button><button className="ob-quiet" onClick={() => onFinish(false)} disabled={busy !== null}>Skip</button></>}
                {step === 5 && <><button className="fable-button primary" onClick={() => setStep(6)}>Use this</button><button className="fable-button" onClick={() => setStep(4)}>Back</button></>}
                {step === 6 && <><button className="fable-button primary" onClick={onSaveProfile} disabled={busy !== null || !schoolUrl.trim() || !studentName.trim()}>{busy === "profile" ? "Opening school…" : "Sounds good. Open school."}</button><button className="fable-button" onClick={() => setStep(5)}>Back</button></>}
                {step === 7 && <><button className="fable-button primary" data-app-control="start-scan" onClick={onStartScan} disabled={!providerReady || busy !== null}>{busy === "scan" ? "Looking…" : "I'm signed in. Look around."}</button><button className="fable-button" onClick={() => setStep(6)}>Back</button></>}
                {step === 8 && <><button className="fable-button primary" onClick={() => onFinish(true)} disabled={busy !== null}>Show me around while I look</button><p className="ob-hint ob-wide">I keep going in the background and tell you when your week is ready.</p></>}
                {handoff && <button className="fable-button primary" onClick={onResumeScan} disabled={busy !== null}>{busy === "resume" ? "Checking…" : onboarding?.scan?.handoff?.kind === "student_takeover" ? "Keep looking" : "I'm signed in. Continue"}</button>}
                {step === 9 && presentation.kind === "runtime_usage" && <button className="fable-button primary" onClick={() => setStep(1)} disabled={busy !== null}>Use another subscription</button>}
                {step === 9 && presentation.kind === "runtime_unavailable" && <button className="fable-button primary" onClick={() => onConnectRuntime()} disabled={busy !== null}>Try again</button>}
                {step === 9 && presentation.kind === "retry" && <><button className="fable-button primary" onClick={onStartScan} disabled={!providerReady || busy !== null}>{busy === "scan" ? "Looking…" : "Try again"}</button><button className="ob-quiet" onClick={() => onFinish(false)} disabled={busy !== null}>Skip for now</button><p className="ob-hint ob-wide">Skipping opens Studi with what I found. Learn works right away, and I'll try school again on the next check.</p></>}
                {step === 10 && <><button className="fable-button primary" onClick={() => onFinish(true)}>Show me around</button><button className="ob-quiet" onClick={() => onFinish(false)}>Skip the tour</button></>}
              </div>}
              {error && <p className="fable-error" role="alert">{error}</p>}
            </div>
          </section>

          <aside className="fable-school" aria-label="School">
            {browserStage && (step === 7 || handoff ? <SchoolSlot workspace={workspace} /> : <Board onboarding={onboarding} workspace={workspace} step={step} />)}
          </aside>
        </div>
      </section>
    </main>
  );
}

/** Show, not tell: a tiny school week plays out, and the student hands in the work themselves. */
function Welcome({ name, onName, onScene, onDone }: { name: string; onName: (value: string) => void; onScene: (state: DotState | null) => void; onDone: () => void }) {
  const [beat, setBeat] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onScene((["hello", "scanning", "working", "waiting", "done", "done"] as DotState[])[beat]!);
    const next = beat === 1 ? 2 : beat === 2 ? 3 : beat === 4 ? 5 : null;
    if (next === null) return undefined;
    const timer = window.setTimeout(() => setBeat(next), beat === 1 ? 2300 : beat === 2 ? 2600 : 1300);
    return () => window.clearTimeout(timer);
  }, [beat, onScene]);
  const caption = ["Want to see how I help?", "I find your homework on your class site.", "Ask, and I do the work.", "Now you. Check it, then press Submit.", "You always hand it in. Unless you tell me otherwise.", "You always hand it in. Unless you tell me otherwise."][beat];
  return <>
    {beat === 5 && <div className="ob-chalky"><Character kind="chalky" state="hello" size={74} label="Chalky" /><p>And I'm Chalky! When a test is coming, I'll help you study.</p></div>}
    <div className="fable-bubbles"><div className="fable-message"><article className="fable-speech ob-welcome">
      <span className="fable-tail" aria-hidden="true" />
      <h1>Nice to meet you, {editing
        ? <input className="ob-name-input" aria-label="Your name" autoFocus value={name} size={Math.max(4, name.length)} maxLength={100} onChange={event => onName(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={event => { if (event.key === "Enter") setEditing(false); }} />
        : <button className="ob-name" title="Not your name? Click to change it." onClick={() => setEditing(true)}>{name.trim() || "there"}</button>}.</h1>
      <div className={`ob-scene beat-${beat}`}>
        <div className="ob-site" aria-hidden="true"><i /><b /><b /><b /></div>
        <div className="ob-week" aria-hidden="true">{["M", "T", "W", "T", "F"].map((day, index) => <span key={index}>{day}</span>)}</div>
        <div className="ob-slip s1" /><div className="ob-slip s2" /><div className="ob-slip s3" />
        <div className="ob-paper">
          <small>Essay draft</small>
          <svg viewBox="0 0 120 64" className="ob-lines" aria-hidden="true"><path d="M4 8 H112 M4 22 H104 M4 36 H116 M4 50 H72" /></svg>
          <button className="ob-submit" tabIndex={beat === 3 ? 0 : -1} aria-hidden={beat !== 3} onClick={() => setBeat(4)}>Submit</button>
          <span className="ob-stamp" aria-hidden="true">Handed in</span>
        </div>
      </div>
      <p className="ob-caption" aria-live="polite">{caption}</p>
    </article></div></div>
    <div className="fable-replies">
      {beat === 0 && <><button className="fable-button primary" onClick={() => setBeat(1)}>Show me</button><button className="ob-quiet" onClick={onDone}>Skip</button></>}
      {beat === 5 && <><button className="fable-button primary" onClick={onDone}>Let's do it</button><button className="ob-quiet" onClick={() => setBeat(1)}>Watch again</button></>}
    </div>
  </>;
}

/** Once school opens the conversation stays a chat: Dot's questions, the student's answers, newest at the bottom. */
function Transcript({ told, step, title, body, extra }: { told: [string, string, string][]; step: OnboardingStep; title: string; body: ReactNode; extra: ReactNode }) {
  const log = useRef<HTMLDivElement>(null);
  // The newest message can grow after it appears (counts, tests), so the chat follows it.
  useLayoutEffect(() => {
    const element = log.current, newest = element?.lastElementChild;
    if (!element || !newest) return undefined;
    const follow = () => element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    const observer = new ResizeObserver(follow);
    observer.observe(newest);
    follow();
    return () => observer.disconnect();
  }, [step, title]);
  return (
    <div className="fable-bubbles ob-log" ref={log} aria-live="polite">
      {told.map(([question, said, answer]) => <div className="fable-message" key={question}><article className="fable-speech"><h1>{question}</h1><p>{said}</p></article><div className="fable-speech fable-speech--me">{answer}</div></div>)}
      {step > 7 && <div className="fable-message"><article className="fable-speech"><h1>{STEP_COPY[7].title}</h1><p>Sign in on the right. I can't see your password.</p></article><div className="fable-speech fable-speech--me">I'm signed in. Look around.</div></div>}
      <div className="fable-message"><article className="fable-speech ob-current" key={`${step}-${title}`}><h1>{title}</h1>{body}{extra}</article></div>
    </div>
  );
}

function ReadyNote({ onboarding, permission }: { onboarding: SchoolOnboardingState | null; permission: PermissionMode }) {
  const work = (onboarding?.assignments ?? []).filter(isWork).length;
  const classes = onboarding?.courses.length ?? 0;
  const exams = useExams();
  const first = exams.find(item => item.date) ?? exams[0];
  return <>
    <p>{work} {work === 1 ? "assignment" : "assignments"} in {classes} {classes === 1 ? "class" : "classes"}{exams.length ? `, and ${exams.length} ${exams.length === 1 ? "test" : "tests"}` : ""}.{onboarding?.scan?.state === "partial" ? " I'll check the rest next time." : ""}</p>
    <p className="ob-next">{permission === "do_not_attempt" ? "I won't start anything on my own. Open one and press Start when you want me on it." : permission === "attempt" ? "I'll start on these once you're in. You still press Submit." : "I'll do these and hand them in. You'll see every receipt."}</p>
    {first && <p className="ob-test"><Character kind="chalky" state="hello" size={26} label="Chalky" /><span>Chalky has {exams.length === 1 ? "your test" : `all ${exams.length} tests`}. First up: <b>{first.title}</b>{first.date ? `, ${formatDay(first.date)}` : ""}.</span></p>}
  </>;
}

/** Shows the live school page in a measured slot under whatever sits above it. */
function SchoolSlot({ workspace }: { workspace: StudiWorkspaceState | null }) {
  const slot = useRef<HTMLDivElement>(null);
  const preview = readDevPreviewConfig();
  const blank = !preview && (!workspace?.browser.url || workspace.browser.url === "about:blank");
  const report = useCallback((bounds: SchoolPageBounds | null) => {
    void studiApi()?.setBrowserLayout(bounds ? { mode: "desk", bounds } : { mode: "hidden" }).catch(() => undefined);
  }, []);
  useSchoolSlot(slot, report, !blank);
  if (blank) return <div className="ob-quiet-page"><p><b>Nothing to watch right now.</b> I'm reading your school directly, which is faster than clicking through it. Your week fills up as I go.</p></div>;
  return <div className="fable-browser-frame ob-slot" ref={slot}>{preview && <PreviewSchoolPage mode="classes" />}</div>;
}

/** During the check the right side is the student's week filling up, with the live page one tab away. */
function Board({ onboarding, workspace, step }: { onboarding: SchoolOnboardingState | null; workspace: StudiWorkspaceState | null; step: OnboardingStep }) {
  const [tab, setTab] = useState<"week" | "school">("week");
  const exams = useExams();
  const courses = onboarding?.courses ?? [];
  const scan = onboarding?.scan;
  const work = (onboarding?.assignments ?? []).filter(isWork);
  const start = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  const end = days[6]!.getTime() + 86_400_000;
  const later = work.filter(item => !item.dueAt || Date.parse(item.dueAt) >= end).length;
  const running = scan?.state === "running";
  const read = new Set(scan?.completedCourseIds ?? []);
  const label = (courseId: string | null) => courseCode(courses.find(item => item.courseId === courseId)?.label ?? "");
  const tone = (courseId: string | null) => ({ "--edge": `var(--course-${COURSE_COLORS[courseTone(courseId ?? "", courses)]})` }) as CSSProperties;
  return <div className="ob-board">
    <nav className="ob-tabs" aria-label="Show">
      <button className={tab === "week" ? "is-on" : ""} aria-pressed={tab === "week"} onClick={() => setTab("week")}>Your week</button>
      <button className={tab === "school" ? "is-on" : ""} aria-pressed={tab === "school"} onClick={() => setTab("school")}>School page</button>
      {running && <span className="ob-count">{work.length} found</span>}
    </nav>
    {tab === "school" ? <SchoolSlot workspace={workspace} /> : <div className="ob-board-body">
      <h2 className="ob-board-title">This week <span>{formatRange(days[0]!, days[6]!)}</span></h2>
      <div className="ob-days">{days.map((day, index) => {
        const due = work.filter(item => item.dueAt && sameDay(new Date(item.dueAt), day));
        const tests = exams.filter(item => item.date === localDate(day));
        const all = due.length + tests.length;
        return <section key={index} className="ob-day" aria-label={day.toLocaleDateString(undefined, { weekday: "long" })}><header>{day.toLocaleDateString(undefined, { weekday: "short" })}</header>
          {tests.slice(0, 3).map(item => <b key={item.examId} className="is-test" style={tone(item.courseId)}>{item.title}<small>Test · {label(item.courseId)}</small></b>)}
          {due.slice(0, Math.max(0, 3 - tests.length)).map(item => <b key={item.assignmentId} style={tone(item.courseId)}>{item.title}<small>{label(item.courseId)}</small></b>)}
          {all > 3 && <span className="ob-more">+{all - 3} more</span>}
          {!all && !running && <span className="ob-none-due">Nothing due</span>}
        </section>;
      })}</div>
      {later > 0 && <p className="ob-later">{later} more after this week.</p>}
      {exams.length > 0 && <section className="ob-tests">
        <h3><Character kind="chalky" state="hello" size={30} label="Chalky" />Tests for Chalky</h3>
        {exams.slice(0, 4).map(item => <p key={item.examId}><b style={tone(item.courseId)}>{item.title}</b><span>{label(item.courseId)}</span><span>{item.date ? formatDay(item.date) : "No date yet"}</span></p>)}
        {exams.length > 4 && <p className="ob-more-tests">+{exams.length - 4} more in Learn</p>}
      </section>}
      <section className="ob-reading">
        <h3>Classes</h3>
        {!courses.length && <p className="is-waiting"><span>{running ? "Looking for your classes…" : "No classes found yet."}</span></p>}
        {courses.map(course => {
          const done = read.has(course.courseId) || step === 10;
          return <p key={course.courseId} className={done ? "is-done" : running ? "is-reading" : "is-skipped"}><b style={tone(course.courseId)}>{course.label}</b>
            <em>{done ? "✓ Read" : running ? <><span className="ob-dots" aria-hidden="true"><i /><i /><i /></span>Reading</> : "Not read yet"}</em></p>;
        })}
      </section>
    </div>}
  </div>;
}

/** Tests the school check saved for Learn, soonest first. */
function useExams(): Exam[] {
  const [exams, setExams] = useState<Exam[]>([]);
  useEffect(() => {
    const read = () => void studiApi()?.getLearnState().then(state => setExams(state.exams.filter(item => item.kind === "exam" && !item.hidden)
      .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")))).catch(() => undefined);
    read();
    return onEngineChange(["school"], read, 5_000);
  }, []);
  return exams;
}

function StepExtra({ step, workspace, connectedApps, appConnections, appConnectionFeedback, providerReady, schoolUrl, homeworkRoot, suggestedHomeworkRoot, cadence, permission, busy, onSchoolUrl, onCadence, onPermission, onConnect, onCompleteConnect, onCancelConnect, onConnectApp, onRefreshConnectedApp, onSelectHomeworkRoot }: {
  step: OnboardingStep; workspace: StudiWorkspaceState | null; connectedApps: ConnectedAppsState | null; appConnections: Readonly<Record<string, ConnectedAppConnection | null>>; appConnectionFeedback: ConnectionFeedbackMap; providerReady: boolean; schoolUrl: string; homeworkRoot: string | null; suggestedHomeworkRoot: string | null; cadence: "manual" | "daily" | "weekly"; permission: PermissionMode; busy: string | null;
  onSchoolUrl: (value: string) => void; onCadence: (value: "manual" | "daily" | "weekly") => void; onPermission: (value: PermissionMode) => void; onConnect: (providerId?: AgentProviderId) => void; onCompleteConnect: (code: string) => void; onCancelConnect: () => void; onConnectApp: (toolkit: string) => void; onRefreshConnectedApp: (toolkit: string) => void; onSelectHomeworkRoot: () => void;
}) {
  const login = workspace?.providerLogin;
  if (step === 1) {
    if (providerReady && !login) {
      const name = workspace ? selectedProvider(workspace).providerName : agentProviderName(DEFAULT_AGENT_PROVIDER_ID);
      return <div className="provider-login"><div><strong>Already connected</strong><small>{name} is ready.</small></div></div>;
    }
    if (!login) {
      return (
        <div className="fable-picks" data-onboarding-providers="true">
          {AGENT_PROVIDERS.map((entry) => <button type="button" className="fable-pick" onClick={() => onConnect(entry.id)} disabled={busy !== null} key={entry.id}><strong>{entry.name}</strong><span>{entry.plan}</span></button>)}
        </div>
      );
    }
    return <ProviderLoginHandoffView login={login} busy={busy !== null} onCompleteLogin={onCompleteConnect} onCancelLogin={onCancelConnect} onRetryLogin={() => onConnect(login.providerId)} />;
  }
  if (step === 2) {
    if (!connectedApps) return <p className="fable-hint">Checking which apps are available…</p>;
    if (!connectedApps.configured) return <p className="fable-hint">Connected apps are not available on this Studi server yet.</p>;
    return (<>
      <div className="ob-apps" data-onboarding-connected-apps="true">
        {connectedApps.toolkits.filter(({ toolkit }) => connectedAppCatalogEntry(toolkit).onboarding).map(({ toolkit, access, tools }) => (
          <ConnectedAppRow key={toolkit} toolkit={toolkit} connection={appConnections[toolkit] ?? null} feedback={appConnectionFeedback[toolkit]} access={access === "all" ? "all actions" : `${tools?.length ?? 0} approved actions`} disabled={busy !== null} onboarding onConnect={onConnectApp} onCheck={onRefreshConnectedApp} />
        ))}
      </div>
      <p className="ob-hint">More apps, and disconnecting, are in Settings.</p>
    </>);
  }
  if (step === 3) {
    const shown = homeworkRoot ?? suggestedHomeworkRoot;
    if (!shown) return <div className="fable-folder" data-onboarding-homework-folder="true"><button type="button" className="fable-button" onClick={onSelectHomeworkRoot} disabled={busy !== null}>Choose an empty folder</button><small>It must be empty and used only for Studi.</small></div>;
    return (
      <div className="ob-folder" data-onboarding-homework-folder="true">
        <span className="ob-folder-icon" aria-hidden="true" />
        <span><strong>{shown}</strong><small>{homeworkRoot ? "Ready." : "New. I'll make it."}</small></span>
        <button type="button" className="fable-button" onClick={onSelectHomeworkRoot} disabled={busy !== null}>Choose another</button>
      </div>
    );
  }
  if (step === 4) return <LinkField value={schoolUrl} onChange={onSchoolUrl} />;
  if (step === 5) return <><div className="fable-picks">{PERMISSIONS.map((item, index) => <button type="button" className={`fable-pick ${permission === item.value ? "selected" : ""}`} onClick={() => onPermission(item.value)} key={item.value}><strong>{item.title}{index === 0 && <small> · default</small>}</strong><span>{item.detail}</span></button>)}</div><p className="ob-hint">You can pick differently for any class later.</p></>;
  if (step === 6) return <div className="fable-picks">{CADENCES.map((item) => <button type="button" className={`fable-pick ${cadence === item.value ? "selected" : ""}`} onClick={() => onCadence(item.value)} key={item.value}><strong>{item.title}</strong></button>)}</div>;
  return null;
}

const PLATFORMS: [RegExp, string][] = [[/instructure|canvas/i, "Canvas"], [/moodle/i, "Moodle"], [/classroom\.google/i, "Google Classroom"], [/brightspace|d2l/i, "Brightspace"], [/blackboard/i, "Blackboard"], [/schoology/i, "Schoology"]];
const EXAMPLES = ["canvas.yourschool.edu", "moodle.yourschool.edu", "classroom.google.com", "learn.yourschool.edu"];

/** An address bar that shows what it wants, and recognises the common class sites. */
function LinkField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const typed = useTyping(EXAMPLES, !value);
  const platform = PLATFORMS.find(([pattern]) => pattern.test(value))?.[1];
  return (
    <div className="ob-link">
      <label className="ob-bar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        <input aria-label="Class link" value={value} onChange={event => onChange(event.target.value)} spellCheck={false} autoComplete="url" />
        {!value && <span className="ob-typed" aria-hidden="true">{typed}<i /></span>}
      </label>
      <p className={`ob-found ${value ? "is-on" : ""}`} role="status">{platform ? <><b>✓ {platform}.</b> I know my way around it.</> : looksLikeLink(value) ? <><b>✓ Got it.</b> I'll find my way around.</> : "Canvas, Moodle, Classroom, anything works."}</p>
    </div>
  );
}

function useTyping(words: string[], active: boolean): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active) { setText(""); return undefined; }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setText(words[0]!); return undefined; }
    let word = 0, at = 0, back = false;
    const timer = window.setInterval(() => {
      const full = words[word]!;
      if (!back) { at += 1; if (at > full.length + 10) back = true; }
      else { at -= 2; if (at <= 0) { back = false; at = 0; word = (word + 1) % words.length; } }
      setText(full.slice(0, Math.min(at, full.length)));
    }, 85);
    return () => window.clearInterval(timer);
  }, [active, words]);
  return text;
}

function stepCopy(id: OnboardingStep, presentation: SchoolOnboardingScanPresentation, onboarding: SchoolOnboardingState | null, workspace: StudiWorkspaceState | null): (typeof STEP_COPY)[OnboardingStep] {
  const base = STEP_COPY[id];
  const scan = onboarding?.scan;
  const login = workspace?.providerLogin;
  const providerId = login?.providerId ?? workspace?.selectedProviderId ?? DEFAULT_AGENT_PROVIDER_ID;
  const name = agentProviderName(providerId);
  const signInBody = agentProvider(providerId).signIn === "device_code" ? "Type this code on the page that opened." : "Sign in on the page that opened. I'll notice when you're done.";
  if (id === 1 && presentation.kind === "runtime_login") return { ...base, inky: "needs", title: `I need ${name} again.`, body: login ? signInBody : "That sign-in stopped working. Pick it again, or use the other one." };
  if (id === 1 && login) return { ...base, title: `I need ${name}.`, body: signInBody };
  if (id === 9 && presentation.kind === "runtime_usage") return { ...base, title: `${name} ran out.`, body: "I can't do the work until that plan has usage again. Or switch to the other one." };
  if (id === 9 && presentation.kind === "runtime_unavailable") return { ...base, title: `${name} isn't working.`, body: "Try again in a bit." };
  if (id === 9 && presentation.kind === "retry") {
    if (scan?.runtimeLoginRecoveredAt) return { ...base, inky: "idle", title: "You're connected again.", body: "I saved where I stopped. Tell me to continue checking school." };
    return { ...base, title: "That didn't finish.", body: `${scan?.failures[0] ?? scan?.currentStep ?? "Your class site stopped answering."} Everything I found is on the right.` };
  }
  if (id === 9 && presentation.kind === "handoff") {
    if (scan?.handoff?.kind === "student_takeover") return { ...base, title: "The page is yours.", body: "Do what you need, then tell me to keep looking." };
    const linked = scan?.handoff?.linkedSystemId ? onboarding?.linkedSystems.find((item) => item.linkedSystemId === scan.handoff?.linkedSystemId) : undefined;
    return { ...base, title: scan?.handoff?.kind === "school_sign_in" ? "Your turn." : linked ? `${linked.label} wants you to sign in.` : base.title, body: scan?.handoff?.reason ?? base.body };
  }
  return base;
}

function onboardingStepFor(step: SchoolOnboardingScanPresentation["step"]): OnboardingStep {
  return step === 1 ? 1 : (step + 2) as OnboardingStep;
}

const COURSE_COLORS = ["yellow", "coral", "mint", "sky", "pink", "lavender"];
const isWork = (item: SchoolOnboardingState["assignments"][number]) => (item.category ?? "work") === "work" && !item.ignoredReason;
const looksLikeLink = (value: string) => /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+/i.test(value.trim());
const withProtocol = (value: string) => /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
const hostOf = (value: string) => { try { return new URL(withProtocol(value)).host; } catch { return value; } };
const shortPath = (path: string | null) => path ? path.split(/[\\/]/).filter(Boolean).slice(-2).join("\\") : null;
/** "CSC 316 Data Structures" reads as CSC 316 in a narrow column. */
const courseCode = (label: string) => /^[A-Z]{2,5}\s?-?\d{2,4}[A-Z]?/.exec(label)?.[0] ?? label;
const startOfWeek = (now: Date) => { const day = new Date(now); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (day.getDay() + 6) % 7); return day; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const localDate = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
const formatDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const formatRange = (from: Date, to: Date) => `${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${to.toLocaleDateString(undefined, from.getMonth() === to.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
