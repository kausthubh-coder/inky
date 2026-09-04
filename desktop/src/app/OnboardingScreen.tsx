import { useEffect, useMemo, useRef, useState } from "react";

import {
  connectedAppIsActive,
  presentSchoolOnboardingScan,
  type ConnectedAppConnection,
  type ConnectedAppsState,
  type PermissionMode,
  type SchoolOnboardingScanPresentation,
  type SchoolOnboardingState,
  type StudiWorkspaceState,
} from "../../shared/index.js";
import { Inky, type InkyState } from "./Inky.js";

type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const CHATGPT_DEVICE = "https://chatgpt.com/auth/device";

const STEP_COPY: Record<OnboardingStep, { inky: InkyState; pill: string; title: string; body: string; me?: string }> = {
  0: { inky: "hello", pill: "saying hi", title: "Hey", body: "Nice. Now I need ChatGPT so I can do the work." },
  1: { inky: "working", pill: "chatgpt", title: "I need ChatGPT.", body: "Type this code on the page that opened." },
  2: { inky: "idle", pill: "connected apps", title: "Bring your school apps?", body: "Connect the places where notes, files, and messages live. You can add more later." },
  3: { inky: "idle", pill: "homework folder", title: "Where should I keep your work?", body: "Pick one folder. I can only use files inside it." },
  4: { inky: "idle", pill: "class link", title: "Where's class?", body: "Paste the link you open for homework. Moodle, Canvas, Classroom, or whatever yours is." },
  5: { inky: "thinking", pill: "the default", title: "When I find homework…", body: "What should I do? You can change this later." },
  6: { inky: "idle", pill: "how often", title: "How often should I check?", body: "I'll look even if you close Studi." },
  7: { inky: "waiting", pill: "your turn", title: "Your turn.", body: "Sign in on the right. I can't see your password.", me: "Opening school." },
  8: { inky: "scanning", pill: "looking around", title: "Looking around.", body: "Classes and homework. I only count what I can see.", me: "I'm signed in. Look around." },
  9: { inky: "needs", pill: "needs you", title: "Another site wants you to sign in.", body: "Do that on the right, then tell me." },
  10: { inky: "done", pill: "ready", title: "Your week is ready.", body: "If you told me to try assignments, I'll start the first one when you open your week. You still submit it." },
};

const PERMISSIONS: Array<{ value: PermissionMode; title: string; detail: string; recommended?: boolean }> = [
  { value: "do_not_attempt", title: "Don't try it", detail: "I'll leave it alone." },
  { value: "attempt", title: "Do it, I'll submit", detail: "I do the work. You hit submit.", recommended: true },
  { value: "auto_submit", title: "Do it and submit", detail: "Only if you really want that." },
];

const CADENCES: Array<{ value: "manual" | "daily" | "weekly"; title: string }> = [
  { value: "daily", title: "Every morning" },
  { value: "weekly", title: "Once a week" },
  { value: "manual", title: "Only when I ask" },
];

export function OnboardingScreen({
  workspace, onboarding, connectedApps, appConnections, studentName, schoolUrl, homeworkRoot, scanCadence, defaultPermission, busy, error,
  onSchoolUrl, onCadence, onDefaultPermission, onConnectRuntime, onCancelRuntimeLogin,
  onConnectApp, onRefreshConnectedApp, onSelectHomeworkRoot, onSaveProfile, onStartScan, onResumeScan, onFinish,
}: {
  workspace: StudiWorkspaceState | null;
  onboarding: SchoolOnboardingState | null;
  connectedApps: ConnectedAppsState | null;
  appConnections: Readonly<Record<string, ConnectedAppConnection | null>>;
  studentName: string;
  schoolUrl: string;
  homeworkRoot: string | null;
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
  onConnectApp: (toolkit: string) => void;
  onRefreshConnectedApp: (toolkit: string) => void;
  onSelectHomeworkRoot: () => void;
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
  const presentation = presentSchoolOnboardingScan(onboarding, workspace?.provider);
  const [step, setStep] = useState<OnboardingStep>(() => profile ? onboardingStepFor(presentation.step) : 0);
  const runtimeLoginRequested = useRef(false);

  useEffect(() => {
    if (profile) setStep(onboardingStepFor(presentation.step));
  }, [presentation.step, profile]);

  useEffect(() => {
    if (step !== 1) {
      runtimeLoginRequested.current = false;
      return;
    }
    if (providerReady || providerLogin || runtimeLoginRequested.current) return;
    runtimeLoginRequested.current = true;
    onConnectRuntime();
  }, [onConnectRuntime, providerLogin, providerReady, step]);

  const displayName = studentName.trim() || "Student";
  const firstName = displayName.split(/\s+/)[0] || "Student";
  const current = stepCopy(step, presentation, onboarding, firstName);
  const inkyDriving = workspace?.browser.driver === "inky";
  const inkyState = inkyDriving ? "steering" : current.inky;
  const browserStage = step >= 7;
  const title = current.title;
  const chat = useMemo(() => {
    const ids: OnboardingStep[] = [];
    for (let index = 0; index <= step; index += 1) {
      const id = index as OnboardingStep;
      if (id === 9 && presentation.kind === "ready") continue;
      ids.push(id);
    }
    return ids.map((id) => ({ id, ...stepCopy(id, presentation, onboarding, firstName) }));
  }, [firstName, onboarding, presentation, step]);

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
        <div className={`fable-stage ${browserStage ? "with-browser" : ""}`}>
          <section className="fable-talk">
            <div className="fable-inky-wrap"><Inky state={inkyState} size={browserStage ? 84 : 200} label={`Inky is ${inkyState}`} /></div>
            <div className="fable-copy">
              <div className="fable-who">talking to Inky</div>
              <div className="fable-bubbles" aria-live="polite">
                {(browserStage ? chat : [{ id: step, ...current }]).map((message) => (
                  <div className="fable-message" key={`${message.id}-${message.pill}`}>
                    {message.me && <div className="fable-speech fable-speech--me">{message.me}</div>}
                    <article className="fable-speech">
                      <span className="fable-tail" aria-hidden="true" />
                      <h1>{message.id === step || !browserStage ? title : message.title}</h1>
                      <p>{message.body}</p>
                      {(!browserStage || message.id === step) && <StepExtra step={step} workspace={workspace} connectedApps={connectedApps} appConnections={appConnections} providerReady={providerReady} schoolUrl={schoolUrl} homeworkRoot={homeworkRoot} cadence={scanCadence} permission={defaultPermission} busy={busy} onSchoolUrl={onSchoolUrl} onCadence={onCadence} onPermission={onDefaultPermission} onConnect={onConnectRuntime} onCancelConnect={onCancelRuntimeLogin} onConnectApp={onConnectApp} onRefreshConnectedApp={onRefreshConnectedApp} onSelectHomeworkRoot={onSelectHomeworkRoot} />}
                    </article>
                  </div>
                ))}
              </div>

              <div className="fable-replies">
                {step === 0 && <button className="fable-button primary" onClick={() => setStep(1)}>Let's do it</button>}
                {step === 1 && <><button className="fable-button primary" onClick={advanceFromRuntime} disabled={busy !== null || (providerLoginActive && !providerReady)}>{providerReady ? "Let's go" : providerLoginActive ? "Waiting…" : presentation.kind === "runtime_login" ? "Try again" : "Get a code"}</button>{presentation.kind !== "runtime_login" && <button className="fable-button" onClick={() => setStep(0)}>Back</button>}</>}
                {step === 2 && <><button className="fable-button primary" onClick={() => setStep(3)}>Continue</button><button className="fable-button" onClick={() => setStep(1)}>Back</button></>}
                {step === 3 && <><button className="fable-button primary" onClick={() => setStep(4)}>{homeworkRoot ? "Use this folder" : "Skip for now"}</button><button className="fable-button" onClick={() => setStep(2)}>Back</button></>}
                {step === 4 && <><button className="fable-button primary" onClick={() => setStep(5)} disabled={!schoolUrl.trim()}>That's the one</button><button className="fable-button" onClick={() => setStep(3)}>Back</button></>}
                {step === 5 && <><button className="fable-button primary" onClick={() => setStep(6)}>Use this</button><button className="fable-button" onClick={() => setStep(4)}>Back</button></>}
                {step === 6 && <><button className="fable-button primary" onClick={onSaveProfile} disabled={busy !== null || !schoolUrl.trim() || !studentName.trim()}>{busy === "profile" ? "Opening school…" : "Sounds good. Open school."}</button><button className="fable-button" onClick={() => setStep(5)}>Back</button></>}
                {step === 7 && <><button className="fable-button primary" data-app-control="start-scan" onClick={onStartScan} disabled={!providerReady || busy !== null}>{busy === "scan" ? "Looking…" : "I'm signed in. Look around."}</button><button className="fable-button" onClick={() => setStep(6)}>Back</button></>}
                {step === 8 && <button className="fable-button primary" disabled>Looking…</button>}
                {step === 9 && presentation.kind === "handoff" && <button className="fable-button primary" onClick={onResumeScan} disabled={busy !== null}>{busy === "resume" ? "Checking…" : onboarding?.scan?.handoff?.kind === "student_takeover" ? "Keep looking" : "I'm signed in. Continue"}</button>}
                {step === 9 && (presentation.kind === "runtime_usage" || presentation.kind === "runtime_unavailable") && <button className="fable-button primary" onClick={onConnectRuntime} disabled={busy !== null}>{presentation.kind === "runtime_usage" ? "Connect another ChatGPT" : "Try again"}</button>}
                {step === 9 && presentation.kind === "retry" && <button className="fable-button primary" onClick={onStartScan} disabled={!providerReady || busy !== null}>{busy === "scan" ? "Looking…" : "Try again"}</button>}
                {step === 10 && <button className="fable-button primary" onClick={onFinish}>{defaultPermission === "do_not_attempt" ? "Open my week" : "Open my week and start"}</button>}
              </div>
              {error && <p className="fable-error" role="alert">{error}</p>}
            </div>
          </section>

          <aside className="fable-school" aria-label="School browser">
            <div className="fable-browser-frame" aria-hidden="true" />
          </aside>
        </div>
      </section>
    </main>
  );
}

function StepExtra({ step, workspace, connectedApps, appConnections, providerReady, schoolUrl, homeworkRoot, cadence, permission, busy, onSchoolUrl, onCadence, onPermission, onConnect, onCancelConnect, onConnectApp, onRefreshConnectedApp, onSelectHomeworkRoot }: {
  step: OnboardingStep; workspace: StudiWorkspaceState | null; connectedApps: ConnectedAppsState | null; appConnections: Readonly<Record<string, ConnectedAppConnection | null>>; providerReady: boolean; schoolUrl: string; homeworkRoot: string | null; cadence: "manual" | "daily" | "weekly"; permission: PermissionMode; busy: string | null;
  onSchoolUrl: (value: string) => void; onCadence: (value: "manual" | "daily" | "weekly") => void; onPermission: (value: PermissionMode) => void; onConnect: () => void; onCancelConnect: () => void; onConnectApp: (toolkit: string) => void; onRefreshConnectedApp: (toolkit: string) => void; onSelectHomeworkRoot: () => void;
}) {
  const login = workspace?.providerLogin;
  const [copied, setCopied] = useState(false);
  if (step === 1) {
    const code = login?.phase === "waiting" ? login.userCode : null;
    const link = login?.phase === "waiting" ? login.verificationUri : CHATGPT_DEVICE;
    const copyCode = async () => {
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch { /* The student can still read the code. */ }
    };
    return (
      <div className="fable-codebox">
        {providerReady ? (
          <div><strong>Already connected</strong><small>ChatGPT is ready.</small></div>
        ) : login?.phase === "waiting" && code ? (
          <div>
            <strong>{code}</strong>
            <span className="fable-fallback">If the page didn't open, <a href={link} target="_blank" rel="noreferrer">click this link</a>.</span>
          </div>
        ) : login?.phase === "failed" || login?.phase === "expired" ? (
          <div><strong>{login.phase === "expired" ? "That code expired" : "Couldn't get a code"}</strong><small>Try once more.</small></div>
        ) : (
          <div><strong>Getting your code…</strong></div>
        )}
        {!providerReady && (code || login?.phase === "failed" || login?.phase === "expired") ? (
          <div className="fable-codebox-actions">
            {code ? <button type="button" className="fable-button" onClick={() => void copyCode()}>{copied ? "Copied" : "Copy"}</button> : null}
            {login?.phase === "waiting" ? <button type="button" className="fable-button" onClick={onCancelConnect}>Cancel</button> : null}
            {login?.phase === "failed" || login?.phase === "expired" ? <button type="button" className="fable-button" onClick={onConnect} disabled={busy !== null}>Try again</button> : null}
          </div>
        ) : null}
      </div>
    );
  }
  if (step === 2) {
    if (!connectedApps) return <p className="fable-hint">Checking which apps are available…</p>;
    if (!connectedApps.configured) return <p className="fable-hint">Connected apps are not available on this Studi server yet.</p>;
    return (
      <div className="fable-picks" data-onboarding-connected-apps="true">
        {connectedApps.toolkits.map(({ toolkit, tools }) => {
          const connection = appConnections[toolkit] ?? null;
          const active = connectedAppIsActive(connection);
          const waiting = connection?.status === "INITIATED";
          return (
            <div className="fable-pick fable-connected-app" data-connected-app={toolkit} key={toolkit}>
              <span><strong>{connectedAppLabel(toolkit)}</strong><small>{active ? "Connected" : waiting ? "Waiting for browser sign-in" : "Not connected"} · {tools.length} thing{tools.length === 1 ? "" : "s"} I can do</small></span>
              <button type="button" className="fable-button" disabled={busy !== null} onClick={() => active || waiting ? onRefreshConnectedApp(toolkit) : onConnectApp(toolkit)}>{active ? "Check" : waiting ? "I finished" : "Connect"}</button>
            </div>
          );
        })}
      </div>
    );
  }
  if (step === 3) {
    return (
      <div className="fable-folder" data-onboarding-homework-folder="true">
        <button type="button" className="fable-button" onClick={onSelectHomeworkRoot} disabled={busy !== null}>{homeworkRoot ? "Choose another folder" : "Choose folder"}</button>
        <small>{homeworkRoot ?? "No folder selected. You can still continue."}</small>
      </div>
    );
  }
  if (step === 4) {
    return (
      <div className="fable-form-block">
        <label>Class link<input type="url" value={schoolUrl} onChange={(event) => onSchoolUrl(event.target.value)} placeholder="https://" spellCheck={false} /></label>
        <p className="fable-hint">Any class site works. Those names are just examples.</p>
      </div>
    );
  }
  if (step === 5) return <div className="fable-picks">{PERMISSIONS.map((item) => <button type="button" className={`fable-pick ${permission === item.value ? "selected" : ""}`} onClick={() => onPermission(item.value)} key={item.value}><strong>{item.title}{item.recommended && <small> · default</small>}</strong><span>{item.detail}</span></button>)}</div>;
  if (step === 6) return <div className="fable-picks">{CADENCES.map((item) => <button type="button" className={`fable-pick ${cadence === item.value ? "selected" : ""}`} onClick={() => onCadence(item.value)} key={item.value}><strong>{item.title}</strong></button>)}</div>;
  return null;
}

function stepCopy(
  id: OnboardingStep,
  presentation: SchoolOnboardingScanPresentation,
  onboarding: SchoolOnboardingState | null,
  firstName: string,
): (typeof STEP_COPY)[OnboardingStep] {
  const base = STEP_COPY[id];
  const scan = onboarding?.scan;
  if (id === 0) return { ...base, title: `Hey ${firstName}.` };
  if (id === 1 && presentation.kind === "runtime_login") {
    return { ...base, inky: "needs", pill: "chatgpt again", title: "I need ChatGPT again.", body: "Type this code on the page that opened." };
  }
  if (id === 9 && (presentation.kind === "runtime_usage" || presentation.kind === "runtime_unavailable")) {
    if (presentation.kind === "runtime_usage") {
      return { ...base, title: "ChatGPT ran out.", body: "I can't do the work until that plan has usage again." };
    }
    return { ...base, title: "ChatGPT isn't working.", body: "Try again in a bit." };
  }
  if (id === 10 && scan?.state === "partial") {
    return { ...base, body: "I found some of it. I'll keep what's missing empty." };
  }
  if (id === 9 && presentation.kind === "retry") {
    return {
      ...base,
      title: "That didn't finish.",
      body: scan?.failures[0] ?? scan?.currentStep ?? "I only count what I can see. Try again when class looks ready.",
    };
  }
  if (id === 9 && presentation.kind === "handoff") {
    if (scan?.handoff?.kind === "student_takeover") {
      return { ...base, title: "The page is yours.", body: "Do what you need, then tell me to keep looking." };
    }
    const linked = scan?.handoff?.linkedSystemId
      ? onboarding?.linkedSystems.find((item) => item.linkedSystemId === scan.handoff?.linkedSystemId)
      : undefined;
    return {
      ...base,
      title: scan?.handoff?.kind === "school_sign_in"
        ? "Your turn."
        : linked
          ? `${linked.label} wants you to sign in.`
          : base.title,
      body: scan?.handoff?.reason ?? base.body,
    };
  }
  return base;
}

function onboardingStepFor(step: SchoolOnboardingScanPresentation["step"]): OnboardingStep {
  return step === 1 ? 1 : (step + 2) as OnboardingStep;
}

function connectedAppLabel(toolkit: string): string {
  const labels: Record<string, string> = {
    github: "GitHub",
    gmail: "Gmail",
    googledrive: "Google Drive",
    googledocs: "Google Docs",
    notion: "Notion",
  };
  return labels[toolkit] ?? toolkit.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
