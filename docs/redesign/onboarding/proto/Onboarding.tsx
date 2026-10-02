import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Character } from "../../../../desktop/src/app/Character.js";
import { SchoolPage } from "../../../../desktop/src/preview/SchoolPage.js";
import type { DotState } from "../../../../desktop/shared/characters/states.js";

type Step = "gate" | "welcome" | "ai" | "apps" | "folder" | "link" | "permission" | "schedule" | "signin" | "scan" | "failed" | "ready" | "in";
const STEPS: Step[] = ["gate", "welcome", "ai", "apps", "folder", "link", "permission", "schedule", "signin", "scan", "failed", "ready", "in"];

const PERMISSIONS = [
  { title: "Just tell me about it", detail: "I'll list it and remind you. When you ask, I'll do it.", short: "Just tell me about it" },
  { title: "Do it, I'll hand it in", detail: "I do the work and show you. You press Submit.", short: "Do it, I'll hand it in" },
  { title: "Do it and hand it in", detail: "I submit it for you. Only if you really want that.", short: "Do it and hand it in" },
];
const CADENCES = ["Every morning", "Once a week", "Only when I ask"];
const APPS = [["gmail", "Gmail", "Emails from your teachers"], ["googledrive", "Google Drive", "Class files and handouts"], ["googledocs", "Google Docs", "Essays and assignment docs"], ["notion", "Notion", "Your class notes"], ["github", "GitHub", "Coding assignments"]] as const;
// A Canvas school: the connector lists every class and due date in seconds, then Dot reads each class for minutes.
const CLASSES = [
  { code: "CSC 316", color: "var(--course-coral)", reading: "Reading the CSC 316 assignment pages" },
  { code: "ST 370", color: "var(--course-mint)", reading: "Reading the ST 370 syllabus" },
  { code: "MA 241", color: "var(--course-sky)", reading: "Checking MA 241's WebAssign links" },
  { code: "ENG 101", color: "var(--course-yellow)", reading: "Reading the ENG 101 discussion board" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FOUND = [
  { title: "Sorting lab", course: 0, day: 0 }, { title: "HW 3", course: 0, day: 1 }, { title: "Lab 5", course: 1, day: 1 }, { title: "Reading quiz", course: 3, day: 1 },
  { title: "Quiz 2", course: 2, day: 2 }, { title: "Problem set 4", course: 1, day: 3 }, { title: "Discussion post", course: 3, day: 3 }, { title: "WebAssign 6", course: 2, day: 3 },
  { title: "Lab report", course: 1, day: 3 }, { title: "Reading notes", course: 0, day: 4 }, { title: "Essay draft", course: 3, day: 4 }, { title: "Quiz 3", course: 2, day: 4, test: true },
];
const TESTS = [
  { title: "Quiz 3", course: 2, when: "Fri, Oct 9" }, { title: "Midterm 1", course: 1, when: "Thu, Oct 15" },
  { title: "Midterm", course: 0, when: "Wed, Oct 21" }, { title: "Final", course: 2, when: "No date yet" },
];
const LATER = 14;
const FAIL_AT = 2;

type Scan = { listed: number; read: number };
/** Listing is fast, reading is slow. The prototype runs both quickly. */
function useScan(step: Step, failing: boolean, onFail: () => void, onDone: () => void): Scan {
  const [scan, setScan] = useState<Scan>({ listed: 0, read: 0 });
  useEffect(() => {
    if (step === "ready") { setScan({ listed: FOUND.length, read: CLASSES.length }); return; }
    if (step === "failed") { setScan({ listed: FOUND.length, read: FAIL_AT }); return; }
    if (step !== "scan") return;
    setScan({ listed: 0, read: 0 });
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      const listed = Math.min(tick, FOUND.length), read = Math.max(0, Math.floor((tick - FOUND.length) / 5));
      if (failing && read >= FAIL_AT) { clearInterval(timer); onFail(); return; }
      if (read > CLASSES.length) { clearInterval(timer); onDone(); return; }
      setScan({ listed, read: Math.min(read, CLASSES.length) });
    }, 280);
    return () => clearInterval(timer);
  }, [step, failing, onFail, onDone]);
  return scan;
}

export function Onboarding() {
  const [step, setStep] = useState<Step>(() => (new URLSearchParams(location.search).get("step") as Step) || "gate");
  const [name, setName] = useState("Kausthubh");
  const [ai, setAi] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>(["Gmail"]);
  const [link, setLink] = useState("");
  const [permission, setPermission] = useState(0);
  const [cadence, setCadence] = useState(0);
  const [failing, setFailing] = useState(false);
  const [skippedSchool, setSkippedSchool] = useState(false);
  const go = useCallback((next: Step) => { setStep(next); history.replaceState(null, "", `?step=${next}`); }, []);
  const scan = useScan(step, failing, useCallback(() => go("failed"), [go]), useCallback(() => go("ready"), [go]));

  const browser = step === "signin" || step === "scan" || step === "failed" || step === "ready";
  const dot: DotState = ({ gate: "hello", welcome: "hello", ai: "idle", apps: "idle", folder: "idle", link: "idle", permission: "thinking", schedule: "idle", signin: "waiting", scan: "scanning", failed: "needs", ready: "done", in: "hello" } as const)[step];
  const [scene, setScene] = useState<DotState | null>(null);

  const host = (() => { try { return new URL(link.includes("://") ? link : `https://${link}`).host; } catch { return link; } })();
  const told: [string, string, string][] = [
    ["Which one do you have?", "Pick the one you pay for and I'll do the work with it.", ai ?? "ChatGPT"],
    ["Bring your school apps?", "Connect where your notes, files and messages live.", apps.length ? apps.join(", ") : "Not now"],
    ["Give me one empty folder.", "I keep every class's work in it. I can't open anything outside it.", "Documents\\Studi"],
    ["Where's class?", "Paste the link you open for homework.", host || "canvas.ncsu.edu"],
    ["When I find homework…", "What should I do?", PERMISSIONS[permission]!.short],
    ["How often should I check?", "I'll look even if you close Studi.", CADENCES[cadence]!],
  ];

  return (
    <main className="fable-onboarding" data-studi-app-ready="true">
      <section className="fable-window" role="application" aria-label="Talking to Dot">
        <div className={`fable-stage ${browser ? "with-browser" : ""}`}>
          <section className="fable-talk">
            <div className="fable-inky-wrap ob-dot">
              <Character state={scene ?? dot} size={browser ? 84 : step === "welcome" ? 150 : 200} label="Dot" />
            </div>
            <div className="fable-copy">
              {!browser && <div className="fable-who">talking to Dot</div>}
              {step === "gate" && <Say title="Hey." body="I'm Dot. I'll help with your homework. First, sign into Studi." replies={<button className="fable-button primary" onClick={() => go("welcome")}>Hi Dot</button>} />}
              {step === "welcome" && <Welcome name={name} onName={setName} onScene={setScene} onDone={() => { setScene(null); go("ai"); }} />}
              {step === "ai" && <Say title="Which one do you have?" body="ChatGPT or Claude. Pick the one you pay for and I'll do the work with it."
                extra={ai ? <div className="provider-login"><div><strong>Connected</strong><small>{ai} is ready.</small></div></div>
                  : <div className="fable-picks">{["ChatGPT", "Claude"].map(item => <button key={item} className="fable-pick" onClick={() => setAi(item)}><strong>{item}</strong><span>{item === "ChatGPT" ? "Plus or Pro" : "Pro or Max"}</span></button>)}</div>}
                replies={<>{ai && <button className="fable-button primary" onClick={() => go("apps")}>Let's go</button>}<button className="fable-button" onClick={() => go("welcome")}>Back</button></>} />}
              {step === "apps" && <Say title="Bring your school apps?" body="Connect where your notes, files and messages live."
                extra={<><div className="ob-apps">{APPS.map(([key, label, use]) => <div className="ob-app" key={key}><img src={`https://logos.composio.dev/api/${key}`} alt="" /><span><strong>{label}</strong><small>{use}</small></span>
                  {apps.includes(label) ? <span className="ob-ok">✓ Connected</span> : <button className="fable-button" onClick={() => setApps([...apps, label])}>Connect</button>}</div>)}</div>
                  <p className="ob-hint">More apps, and disconnecting, are in Settings.</p></>}
                replies={<><button className="fable-button primary" onClick={() => go("folder")}>{apps.length ? "Continue" : "Skip for now"}</button><button className="fable-button" onClick={() => go("ai")}>Back</button></>} />}
              {step === "folder" && <Say title="Give me one empty folder." body="I keep every class's work in it: your files, my drafts, anything I download. I can't open anything outside it."
                extra={<div className="ob-folder"><span className="ob-folder-icon" aria-hidden="true" /><span><strong>C:\Users\kaust\Documents\Studi</strong><small>New. I'll make it.</small></span><button className="fable-button">Choose another</button></div>}
                replies={<><button className="fable-button primary" onClick={() => go("link")}>Use this folder</button><button className="fable-button" onClick={() => go("apps")}>Back</button></>} />}
              {step === "link" && <LinkStep link={link} onLink={setLink} onNext={() => { setSkippedSchool(false); go("permission"); }} onSkip={() => { setSkippedSchool(true); go("in"); }} onBack={() => go("folder")} />}
              {step === "permission" && <Say title="When I find homework…" body="What should I do?"
                extra={<><div className="fable-picks">{PERMISSIONS.map((item, index) => <button key={item.title} className={`fable-pick ${permission === index ? "selected" : ""}`} onClick={() => setPermission(index)}><strong>{item.title}{index === 0 && <small> · default</small>}</strong><span>{item.detail}</span></button>)}</div>
                  <p className="ob-hint">You can pick differently for any class later.</p></>}
                replies={<><button className="fable-button primary" onClick={() => go("schedule")}>Use this</button><button className="fable-button" onClick={() => go("link")}>Back</button></>} />}
              {step === "schedule" && <Say title="How often should I check?" body="I'll look even if you close Studi."
                extra={<div className="fable-picks">{CADENCES.map((item, index) => <button key={item} className={`fable-pick ${cadence === index ? "selected" : ""}`} onClick={() => setCadence(index)}><strong>{item}</strong></button>)}</div>}
                replies={<><button className="fable-button primary" onClick={() => go("signin")}>Sounds good. Open school.</button><button className="fable-button" onClick={() => go("permission")}>Back</button></>} />}
              {browser && <Chat told={told} step={step} permission={permission} scan={scan} onGo={go} />}
              {step === "in" && <Say title={`You're in, ${name}.`} body={skippedSchool ? "No class site yet, so your week starts empty. Paste a homework link in the chat any time, or add your class site in Settings. Chalky is ready now." : "Your week is ready."}
                replies={<><button className="fable-button primary" onClick={() => tour(0)}>Show me around</button><button className="ob-quiet" onClick={() => tour(-1)}>Skip the tour</button></>} />}
            </div>
          </section>
          <aside className="fable-school" aria-label="School browser">{step === "signin" ? <div className="fable-browser-frame"><SchoolPage mode="classes" /></div> : browser && <Board step={step} scan={scan} />}</aside>
        </div>
      </section>
      <DevBar step={step} onStep={go} failing={failing} onFailing={setFailing} />
    </main>
  );
}

function tour(step: number) { location.search = `?preview=week&tour=${step}`; }

function Say({ title, body, extra, replies }: { title: ReactNode; body: ReactNode; extra?: ReactNode; replies?: ReactNode }) {
  return <>
    <div className="fable-bubbles" aria-live="polite"><div className="fable-message"><article className="fable-speech"><span className="fable-tail" aria-hidden="true" /><h1>{title}</h1><p>{body}</p>{extra}</article></div></div>
    <div className="fable-replies">{replies}</div>
  </>;
}

/** Show, not tell: a tiny school week plays out, and the student hands in the work themselves. */
function Welcome({ name, onName, onScene, onDone }: { name: string; onName: (value: string) => void; onScene: (state: DotState | null) => void; onDone: () => void }) {
  const [beat, setBeat] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onScene((["hello", "scanning", "working", "waiting", "done", "done"] as DotState[])[beat]!);
    if (beat === 1) { const timer = setTimeout(() => setBeat(2), 2300); return () => clearTimeout(timer); }
    if (beat === 2) { const timer = setTimeout(() => setBeat(3), 2600); return () => clearTimeout(timer); }
    if (beat === 4) { const timer = setTimeout(() => setBeat(5), 1300); return () => clearTimeout(timer); }
  }, [beat, onScene]);
  const caption = ["Want to see how I help?", "I find your homework on your class site.", "Ask, and I do the work.", "Now you. Check it, then press Submit.", "You always hand it in. Unless you tell me otherwise.", "You always hand it in. Unless you tell me otherwise."][beat];
  return <>
    {beat === 5 && <div className="ob-chalky"><Character kind="chalky" state="hello" size={74} label="Chalky" /><p>And I'm Chalky! When a test is coming, I'll help you study.</p></div>}
    <div className="fable-bubbles"><div className="fable-message"><article className="fable-speech ob-welcome">
      <span className="fable-tail" aria-hidden="true" />
      <h1>Nice to meet you, {editing
        ? <input className="ob-name-input" autoFocus value={name} size={Math.max(4, name.length)} onChange={event => onName(event.target.value)} onBlur={() => setEditing(false)} onKeyDown={event => event.key === "Enter" && setEditing(false)} />
        : <button className="ob-name" title="Not your name? Click to change it." onClick={() => setEditing(true)}>{name}</button>}.</h1>
      <div className={`ob-scene beat-${beat}`}>
        <div className="ob-site" aria-hidden="true"><i /><b /><b /><b /></div>
        <div className="ob-week" aria-hidden="true">{["M", "T", "W", "T", "F"].map((day, index) => <span key={index}>{day}</span>)}</div>
        <div className="ob-slip s1" /><div className="ob-slip s2" /><div className="ob-slip s3" />
        <div className="ob-paper">
          <small>Essay draft</small>
          <svg viewBox="0 0 120 64" className="ob-lines"><path d="M4 8 H112 M4 22 H104 M4 36 H116 M4 50 H72" /></svg>
          <button className="ob-submit" tabIndex={beat === 3 ? 0 : -1} onClick={() => setBeat(4)}>Submit</button>
          <span className="ob-stamp">Handed in</span>
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

const PLATFORMS: [RegExp, string][] = [[/instructure|canvas/i, "Canvas"], [/moodle/i, "Moodle"], [/classroom\.google/i, "Google Classroom"], [/brightspace|d2l/i, "Brightspace"], [/blackboard/i, "Blackboard"], [/schoology/i, "Schoology"]];
const EXAMPLES = ["canvas.ncsu.edu", "moodle.school.edu", "classroom.google.com", "learn.yourschool.edu"];

function LinkStep({ link, onLink, onNext, onSkip, onBack }: { link: string; onLink: (value: string) => void; onNext: () => void; onSkip: () => void; onBack: () => void }) {
  const typed = useTyping(EXAMPLES, !link);
  const platform = PLATFORMS.find(([pattern]) => pattern.test(link))?.[1];
  const looksLikeLink = /\.[a-z]{2,}/i.test(link);
  return <Say title="Where's class?" body="Paste the link you open for homework."
    extra={<div className="ob-link">
      <label className="ob-bar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        <input aria-label="Class link" value={link} onChange={event => onLink(event.target.value)} spellCheck={false} />
        {!link && <span className="ob-typed" aria-hidden="true">{typed}<i /></span>}
      </label>
      <p className={`ob-found ${link ? "is-on" : ""}`} role="status">{platform ? <><b>✓ {platform}.</b> I know my way around it.</> : looksLikeLink ? <><b>✓ Got it.</b> I'll find my way around.</> : "Canvas, Moodle, Classroom, anything works."}</p>
    </div>}
    replies={<><button className="fable-button primary" disabled={!looksLikeLink} onClick={onNext}>That's the one</button><button className="fable-button" onClick={onBack}>Back</button><button className="ob-quiet" onClick={onSkip}>Skip</button></>} />;
}

function useTyping(words: string[], active: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active) return;
    let word = 0, at = 0, back = false;
    const timer = setInterval(() => {
      const full = words[word]!;
      if (!back) { at += 1; if (at > full.length + 8) back = true; }
      else { at -= 2; if (at <= 0) { back = false; at = 0; word = (word + 1) % words.length; } }
      setText(full.slice(0, Math.min(at, full.length)));
    }, 80);
    return () => clearInterval(timer);
  }, [active, words]);
  return text;
}

/** The browser stage keeps the conversation, newest at the bottom, scrolled into view. */
function Chat({ told, step, permission, scan, onGo }: { told: [string, string, string][]; step: Step; permission: number; scan: Scan; onGo: (step: Step) => void }) {
  const log = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [step]);
  const listing = scan.listed < FOUND.length;
  const current = {
    signin: { title: "Your turn.", body: <p>Sign in on the right. I can't see your password. If your school asks, tick “remember this device” so I stay signed in.</p> },
    scan: { title: "Looking around.", body: <>
      <p>Your week fills up on the right as I go. Big school sites take 10 to 20 minutes, so you don't have to watch.</p>
      <p className="ob-live"><span className="ob-dots"><i /><i /><i /></span>{listing ? "Listing your classes and due dates…" : `${CLASSES[Math.min(scan.read, CLASSES.length - 1)]!.reading}…`}</p>
    </> },
    failed: { title: "That didn't finish.", body: <p>Your class site stopped answering while I was reading {CLASSES[FAIL_AT]!.code}. Everything I found is on the right.</p> },
    ready: { title: "Your week is ready.", body: <>
      <p>{FOUND.length + LATER} assignments in {CLASSES.length} classes, and {TESTS.length} tests.</p>
      <p className="ob-next">{permission === 0 ? "I won't start anything on my own. Open one and press Start when you want me on it." : permission === 1 ? "I'll start on these once you're in. You still press Submit." : "I'll do these and hand them in. You'll see every receipt."}</p>
      <p className="ob-test"><Character kind="chalky" state="hello" size={26} label="Chalky" /><span>Chalky made plans for all {TESTS.length} tests. First up: <b>{TESTS[0]!.title}</b>, {TESTS[0]!.when}.</span></p>
    </> },
  }[step as "signin" | "scan" | "failed" | "ready"];

  return <>
    <div className="fable-bubbles ob-log" ref={log} aria-live="polite">
      {told.map(([question, body, answer]) => <div className="fable-message" key={question}><article className="fable-speech"><h1>{question}</h1><p>{body}</p></article><div className="fable-speech fable-speech--me">{answer}</div></div>)}
      {step !== "signin" && <div className="fable-message"><article className="fable-speech"><h1>Your turn.</h1><p>Sign in on the right. I can't see your password.</p></article><div className="fable-speech fable-speech--me">I'm signed in. Look around.</div></div>}
      <div className="fable-message"><article className="fable-speech ob-current" key={step}><h1>{current.title}</h1>{current.body}</article></div>
    </div>
    <div className="fable-replies">
      {step === "signin" && <><button className="fable-button primary" onClick={() => onGo("scan")}>I'm signed in. Look around.</button><button className="fable-button" onClick={() => onGo("schedule")}>Back</button></>}
      {step === "scan" && <><button className="fable-button primary" onClick={() => { sessionStorage.setItem("tour-scanning", "1"); tour(0); }}>Show me around while I look</button><p className="ob-hint ob-wide">I keep going in the background and tell you when your week is ready.</p></>}
      {step === "failed" && <><button className="fable-button primary" onClick={() => onGo("scan")}>Try again</button><button className="ob-quiet" onClick={() => onGo("ready")}>Skip for now</button><p className="ob-hint ob-wide">Skipping opens Studi with what I found. Learn works right away, and I'll try school again tomorrow morning.</p></>}
      {step === "ready" && <><button className="fable-button primary" onClick={() => { sessionStorage.removeItem("tour-scanning"); tour(0); }}>Show me around</button><button className="ob-quiet" onClick={() => tour(-1)}>Skip the tour</button></>}
    </div>
  </>;
}

/** During the check the right side is the student's week filling up, not a browser with nothing to show. */
function Board({ step, scan }: { step: Step; scan: Scan }) {
  const [tab, setTab] = useState<"week" | "school">("week");
  const items = FOUND.slice(0, scan.listed);
  const listing = scan.listed < FOUND.length;
  const tests = TESTS.filter((_, index) => index === 0 ? items.some(item => item.test) : !listing);
  const state = (index: number) => step === "failed" && index === FAIL_AT ? "failed"
    : index < scan.read ? "done"
    : step === "failed" ? "skipped"
    : index === scan.read && step === "scan" && !listing ? "reading" : "waiting";
  return <div className="ob-board">
    <nav className="ob-tabs">
      <button className={tab === "week" ? "is-on" : ""} onClick={() => setTab("week")}>Your week</button>
      <button className={tab === "school" ? "is-on" : ""} onClick={() => setTab("school")}>School page</button>
      {step === "scan" && <span className="ob-count">{items.length + (listing ? 0 : LATER)} found</span>}
    </nav>
    {tab === "school" ? <div className="ob-quiet-page">
      <img src="https://logos.composio.dev/api/canvas" alt="" />
      <p><b>I'm reading Canvas directly.</b> It's faster than clicking through it, so there's nothing to watch here. Your week fills up as I go.</p>
    </div> : <div className="ob-board-body">
      <h2 className="ob-board-title">This week <span>Oct 5 – 11</span></h2>
      <div className="ob-days">{DAYS.map((day, index) => {
        const due = items.filter(item => item.day === index);
        return <section key={day} className="ob-day"><header>{day}</header>
          {due.slice(0, 3).map(item => <b key={item.title} className={item.test ? "is-test" : ""} style={{ "--edge": CLASSES[item.course]!.color } as CSSProperties}>{item.title}<small>{item.test ? `Test · ${CLASSES[item.course]!.code}` : CLASSES[item.course]!.code}</small></b>)}
          {due.length > 3 && <span className="ob-more">+{due.length - 3} more</span>}
          {!due.length && !listing && <span className="ob-none-due">Nothing due</span>}
        </section>;
      })}</div>
      {!listing && <p className="ob-later">{LATER} more after this week.</p>}
      {tests.length > 0 && <section className="ob-tests">
        <h3><Character kind="chalky" state="hello" size={30} label="Chalky" />Tests for Chalky</h3>
        {tests.map(item => <p key={item.title + item.course}><b style={{ "--edge": CLASSES[item.course]!.color } as CSSProperties}>{item.title}</b><span>{CLASSES[item.course]!.code}</span><span>{item.when}</span></p>)}
      </section>}
      <section className="ob-reading">
        <h3>Classes</h3>
        {CLASSES.map((item, index) => {
          const now = state(index);
          return <p key={item.code} className={`is-${now}`}><b style={{ "--edge": item.color } as CSSProperties}>{item.code}</b>
            <em>{now === "done" ? "✓ Read" : now === "reading" ? <><span className="ob-dots"><i /><i /><i /></span>Reading</> : now === "failed" ? "Couldn't finish" : now === "skipped" ? "Not read yet" : listing ? "" : "Up next"}</em></p>;
        })}
      </section>
    </div>}
  </div>;
}

function DevBar({ step, onStep, failing, onFailing }: { step: Step; onStep: (step: Step) => void; failing: boolean; onFailing: (value: boolean) => void }) {
  return <div className="ob-dev">
    <span>Prototype</span>
    <select value={step} onChange={event => onStep(event.target.value as Step)}>{STEPS.map(item => <option key={item}>{item}</option>)}</select>
    <label><input type="checkbox" checked={failing} onChange={event => onFailing(event.target.checked)} /> check fails</label>
    <button onClick={() => tour(0)}>Tour</button>
  </div>;
}
