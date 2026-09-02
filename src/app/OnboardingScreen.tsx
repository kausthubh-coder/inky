import { useEffect, useMemo, useRef, useState } from "react";

import type { PermissionMode, SchoolOnboardingState, StudiWorkspaceState } from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";

type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type ScanState = NonNullable<SchoolOnboardingState["scan"]>["state"];

const STEP_COPY: Record<OnboardingStep, { inky: InkyState; pill: string; title: string; body: string; me?: string }> = {
  0: { inky: "hello", pill: "saying hi", title: "Hey", body: "I'm Inky. I'll do the homework in a school browser you can watch. You stay in charge of logins and submit." },
  1: { inky: "working", pill: "connecting a brain", title: "One thing first.", body: "I need Codex from ChatGPT to actually type in that browser. Open the page, enter this code. I never see your ChatGPT password." },
  2: { inky: "idle", pill: "where's school", title: "Where does school live?", body: "Clerk already knows you. Paste the site you actually use. Anything in a browser works." },
  3: { inky: "thinking", pill: "the default", title: "When I find homework…", body: "This is the default. You can override it for one class or one assignment later." },
  4: { inky: "idle", pill: "how often", title: "How often should I check?", body: "I'll look even if the window is closed." },
  5: { inky: "waiting", pill: "your turn", title: "Sign in over there.", body: "That's the real school site. Passwords stay in that window. Come back when you're in.", me: "Opening school." },
  6: { inky: "scanning", pill: "looking around", title: "Scanning what I can see.", body: "Courses, assignments, linked tools. I only count what the page actually shows.", me: "I'm signed in. Scan it." },
  7: { inky: "needs", pill: "needs you", title: "Another school site wants a login.", body: "I don't type school passwords. Log in on the right, then tell me to continue." },
  8: { inky: "done", pill: "ready", title: "Your week is on the board.", body: "I won't take quizzes. Default is I do the work, you hit submit." },
};

const PERMISSIONS: Array<{ value: PermissionMode; title: string; detail: string; recommended?: boolean }> = [
  { value: "do_not_attempt", title: "Don't try it", detail: "It stays on the board. I won't open it." },
  { value: "attempt", title: "Do the work, leave submit to me", detail: "I'll attempt it. You review and submit.", recommended: true },
  { value: "auto_submit", title: "Do the work and submit", detail: "Only if you really want that." },
];

const CADENCES: Array<{ value: "manual" | "daily" | "weekly"; title: string }> = [
  { value: "daily", title: "Every morning" },
  { value: "weekly", title: "Once a week" },
  { value: "manual", title: "Only when I ask" },
];

export function OnboardingScreen({
  workspace, onboarding, studentName, schoolUrl, scanCadence, defaultPermission, busy, error,
  onSchoolUrl, onCadence, onDefaultPermission, onConnectRuntime, onCancelRuntimeLogin,
  onSaveProfile, onStartScan, onResumeScan, onFinish,
}: {
  workspace: StudiWorkspaceState | null;
  onboarding: SchoolOnboardingState | null;
  studentName: string;
  schoolUrl: string;
  scanCadence: "manual" | "daily" | "weekly";
  defaultPermission: PermissionMode;
  busy: string | null;
  error: string | null;
  onStudentName: (value: string) => void;
  onSchoolUrl: (value: string) => void;
  onCadence: (value: "manual" | "daily" | "weekly") => void;
  onDefaultPermission: (value: PermissionMode) => void;
  onConnectRuntime: () => void;
  onCancelRuntimeLogin: () => void;
  onSelectModel: (modelId: string) => void;
  onSaveProfile: () => void;
  onOpenSchool: () => void;
  onStartScan: () => void;
  onResumeScan: () => void;
  onReplayScan: () => void;
  onFinish: () => void;
}) {
  const providerReady = workspace?.provider.state === "ready";
  const providerLogin = workspace?.providerLogin;
  const providerLoginActive = providerLogin?.phase === "starting" || providerLogin?.phase === "waiting";
  const profile = onboarding?.profile;
  const scan = onboarding?.scan;
  const [step, setStep] = useState<OnboardingStep>(() => profile ? scanStep(scan?.state) : 0);
  const [platform, setPlatform] = useState("Moodle");
  const runtimeLoginRequested = useRef(false);

  useEffect(() => {
    if (profile) setStep(scanStep(scan?.state));
  }, [profile, scan?.state]);

  useEffect(() => {
    if (step !== 1) {
      runtimeLoginRequested.current = false;
      return;
    }
    if (providerReady || providerLogin || runtimeLoginRequested.current) return;
    runtimeLoginRequested.current = true;
    onConnectRuntime();
  }, [onConnectRuntime, providerLogin, providerReady, step]);

  const current = STEP_COPY[step];
  const inkyDriving = workspace?.browser.driver === "inky";
  const inkyState = inkyDriving ? "steering" : current.inky;
  const browserStage = step >= 5;
  const displayName = studentName.trim() || "Student";
  const firstName = displayName.split(/\s+/)[0] || "Student";
  const title = step === 0 ? `Hey ${firstName}.` : current.title;
  const chat = useMemo(() => Array.from({ length: step + 1 }, (_, index) => STEP_COPY[index as OnboardingStep]), [step]);

  const choosePlatform = (name: string, suggestedUrl: string) => {
    setPlatform(name);
    if (!schoolUrl.trim() || ["https://moodle.university.edu", "https://canvas.university.edu", "https://classroom.google.com"].includes(schoolUrl.trim())) onSchoolUrl(suggestedUrl);
  };

  const advanceFromRuntime = () => {
    if (!providerReady) {
      if (!providerLoginActive) onConnectRuntime();
      return;
    }
    setStep(2);
  };

  return (
    <main className="fable-onboarding" data-studi-app-ready="true">
      <section className="fable-window" role="application" aria-label="Talking to Inky">
        <header className="fable-titlebar">
          <strong>studi <span className="brand-pencil" aria-hidden="true">✎</span></strong>
          <span className="fable-badge fable-badge--soft">{current.pill}</span>
          <span className="fable-title-spacer" />
          <span className="fable-badge fable-badge--done">beta · {firstName}</span>
          <span className="fable-user"><i aria-hidden="true">{firstName.slice(0, 1).toUpperCase()}</i>{firstName}</span>
        </header>

        <div className={`fable-stage ${browserStage ? "with-browser" : ""}`}>
          <section className="fable-talk">
            <div className="fable-inky-wrap"><Inky state={inkyState} size={browserStage ? 84 : 200} label={`Inky is ${inkyState}`} /></div>
            <div className="fable-copy">
              <div className="fable-who">talking to Inky</div>
              <div className="fable-bubbles" aria-live="polite">
                {(browserStage ? chat : [current]).map((message, index) => (
                  <div className="fable-message" key={`${index}-${message.pill}`}>
                    {message.me && <div className="fable-speech fable-speech--me">{message.me}</div>}
                    <article className="fable-speech">
                      <span className="fable-tail" aria-hidden="true" />
                      <h1>{index === step || !browserStage ? title : message.title}</h1>
                      <p>{index === step && step === 7 && scan?.handoff?.reason ? scan.handoff.reason : message.body}</p>
                      {(!browserStage || index === step) && <StepExtra step={step} workspace={workspace} providerReady={providerReady} platform={platform} schoolUrl={schoolUrl} cadence={scanCadence} permission={defaultPermission} busy={busy} onPlatform={choosePlatform} onSchoolUrl={onSchoolUrl} onCadence={onCadence} onPermission={onDefaultPermission} onConnect={onConnectRuntime} onCancelConnect={onCancelRuntimeLogin} />}
                    </article>
                  </div>
                ))}
              </div>

              <div className="fable-replies">
                {step === 0 && <button className="fable-button primary" onClick={() => setStep(1)}>Hi Inky</button>}
                {step === 1 && <><button className="fable-button primary" onClick={advanceFromRuntime} disabled={busy !== null || (providerLoginActive && !providerReady)}>{providerReady ? "Codex is ready" : providerLoginActive ? "Waiting for Codex…" : "Connect Codex"}</button><button className="fable-button" onClick={() => setStep(0)}>Back</button></>}
                {step === 2 && <><button className="fable-button primary" onClick={() => setStep(3)} disabled={!schoolUrl.trim()}>That's the one</button><button className="fable-button" onClick={() => setStep(1)}>Back</button></>}
                {step === 3 && <><button className="fable-button primary" onClick={() => setStep(4)}>Use this default</button><button className="fable-button" onClick={() => setStep(2)}>Back</button></>}
                {step === 4 && <><button className="fable-button primary" onClick={onSaveProfile} disabled={busy !== null || !schoolUrl.trim() || !studentName.trim()}>{busy === "profile" ? "Opening school…" : "Sounds good. Open school."}</button><button className="fable-button" onClick={() => setStep(3)}>Back</button></>}
                {step === 5 && <><button className="fable-button primary" data-app-control="start-scan" onClick={onStartScan} disabled={!providerReady || busy !== null}>{busy === "scan" ? "Starting scan…" : "I'm signed in. Scan it."}</button><button className="fable-button" onClick={() => setStep(4)}>Back</button></>}
                {step === 6 && <button className="fable-button primary" disabled>Scanning…</button>}
                {step === 7 && <button className="fable-button primary" onClick={onResumeScan} disabled={busy !== null}>{busy === "resume" ? "Checking…" : "I'm signed in. Continue"}</button>}
                {step === 8 && <button className="fable-button primary" onClick={onFinish}>Open my week</button>}
              </div>
              {error && <p className="fable-error" role="alert">{error}</p>}
            </div>
          </section>

          <aside className="fable-school" aria-label="School browser">
            <div className="fable-school-label"><span>{inkyDriving ? "school browser · Inky's driving" : "school browser · you sign in here"}</span><span className="fable-badge fable-badge--waiting">{current.pill}</span></div>
            <div className="fable-browser-frame" aria-hidden="true"><div className="fable-browser-bar"><i /><i /><i /><span>{workspace?.browser.url || schoolUrl || "waiting for a school link"}</span></div></div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function StepExtra({ step, workspace, providerReady, platform, schoolUrl, cadence, permission, busy, onPlatform, onSchoolUrl, onCadence, onPermission, onConnect, onCancelConnect }: {
  step: OnboardingStep; workspace: StudiWorkspaceState | null; providerReady: boolean; platform: string; schoolUrl: string; cadence: "manual" | "daily" | "weekly"; permission: PermissionMode; busy: string | null;
  onPlatform: (name: string, url: string) => void; onSchoolUrl: (value: string) => void; onCadence: (value: "manual" | "daily" | "weekly") => void; onPermission: (value: PermissionMode) => void; onConnect: () => void; onCancelConnect: () => void;
}) {
  const login = workspace?.providerLogin;
  if (step === 1) return <div className="fable-codebox">{providerReady ? <div><strong>Already connected</strong><small>{workspace?.provider.providerName} is ready on this computer</small></div> : login?.phase === "waiting" ? <div><strong>{login.userCode}</strong><small>Enter this at {login.verificationUri}</small></div> : login?.phase === "failed" || login?.phase === "expired" ? <div><strong>{login.phase === "expired" ? "Code expired" : "Couldn't get a code"}</strong><small>Try once more to create a fresh code</small></div> : <div><strong>Getting your code…</strong><small>Uses your existing ChatGPT subscription</small></div>} {!providerReady && login?.phase === "waiting" ? <button type="button" className="fable-button" onClick={onCancelConnect}>Cancel</button> : !providerReady && (login?.phase === "failed" || login?.phase === "expired") ? <button type="button" className="fable-button" onClick={onConnect} disabled={busy !== null}>Try again</button> : null}</div>;
  if (step === 2) return <div className="fable-form-block"><div className="fable-chips">{([ ["Moodle", "https://moodle.university.edu"], ["Canvas", "https://canvas.university.edu"], ["Classroom", "https://classroom.google.com"] ] as const).map(([name, url]) => <button type="button" className={`fable-chip ${platform === name ? "selected" : ""}`} onClick={() => onPlatform(name, url)} key={name}>{name}</button>)}</div><label>School site<input type="url" value={schoolUrl} onChange={(event) => onSchoolUrl(event.target.value)} placeholder="https://school.example.edu" spellCheck={false} /></label></div>;
  if (step === 3) return <div className="fable-picks">{PERMISSIONS.map((item) => <button type="button" className={`fable-pick ${permission === item.value ? "selected" : ""}`} onClick={() => onPermission(item.value)} key={item.value}><strong>{item.title}{item.recommended && <small> · default</small>}</strong><span>{item.detail}</span></button>)}</div>;
  if (step === 4) return <div className="fable-picks">{CADENCES.map((item) => <button type="button" className={`fable-pick ${cadence === item.value ? "selected" : ""}`} onClick={() => onCadence(item.value)} key={item.value}><strong>{item.title}</strong></button>)}</div>;
  return null;
}

function scanStep(state?: ScanState): OnboardingStep {
  if (state === "running") return 6;
  if (state === "needs_user" || state === "failed" || state === "partial") return 7;
  if (state === "succeeded") return 8;
  return 5;
}
