"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import wallpaper from "../designs/wallpaper.png";
import { track } from "../lib/analytics";
import type { InkyState } from "../lib/inky";
import { InkyMascot } from "./inky-mascot";
import { SiteNav } from "./site-nav";
import { WaitlistForm } from "./waitlist-form";

// Three related-rates problems with correct answers, so anyone checking the demo finds real math.
const PROBLEMS = [
  {
    prompt:
      "A 10 ft ladder leans against a wall. Its base slides away at 2 ft/s. How fast is the top sliding down when the base is 6 ft from the wall?",
    work: "x² + y² = 100  →  2x·x′ + 2y·y′ = 0  →  6(2) + 8·y′ = 0",
    answer: "y′ = −1.5 ft/s",
  },
  {
    prompt:
      "Air is pumped into a spherical balloon at 100 cm³/s. How fast is the radius growing when r = 25 cm?",
    work: "V = (4/3)πr³  →  V′ = 4πr²·r′  →  100 = 4π(25)²·r′",
    answer: "r′ = 1/(25π) ≈ 0.0127 cm/s",
  },
  {
    prompt:
      "A conical tank (radius 2 m, height 4 m) fills at 2 m³/min. How fast is the water level rising when the depth is 3 m?",
    work: "r = h/2  →  V = πh³/12  →  V′ = (πh²/4)·h′  →  2 = (9π/4)·h′",
    answer: "h′ = 8/(9π) ≈ 0.283 m/min",
  },
] as const;

// Typing runs through work then answer for each problem, in order.
const SOLVE_SCRIPT = PROBLEMS.flatMap((p) => [p.work, p.answer]);
const SOLVE_TOTAL = SOLVE_SCRIPT.reduce((sum, s) => sum + s.length, 0);

function currentProblem(typedCount: number): number {
  let remaining = typedCount;
  for (let index = 0; index < SOLVE_SCRIPT.length; index += 1) {
    const segment = SOLVE_SCRIPT[index] ?? "";
    if (remaining < segment.length) return Math.floor(index / 2) + 1;
    remaining -= segment.length;
  }
  return PROBLEMS.length;
}

type PageState = "solving" | "ready" | "submitted";
type Decision = "auto" | "manual";

type DemoBeat = {
  view: "is-hello" | "is-scan" | "is-week" | "is-desk";
  inky: InkyState;
  page?: PageState;
  driving?: boolean;
  say: string;
  text: string;
  replies: readonly {
    label: string;
    beat?: number;
    decide?: Decision;
    focus?: string;
    secondary?: boolean;
  }[];
};

const DEMO_BEATS: readonly DemoBeat[] = [
  {
    view: "is-hello",
    inky: "hello",
    say: "Hi, I’m Inky.",
    text: "I do your homework before you even know it exists.",
    replies: [{ label: "Okay, show me", beat: 1 }],
  },
  {
    view: "is-scan",
    inky: "idle",
    say: "I scan all your schoolwork in the background.",
    text: "Every day, or whenever you want me to. I find what’s due before it can surprise you.",
    replies: [{ label: "Show me what you found", beat: 2 }],
  },
  {
    view: "is-week",
    inky: "idle",
    say: "Then I put the work in a queue.",
    text: "I do each assignment, save the answers, and let you know when everything is ready to submit.",
    replies: [{ label: "Watch you work", beat: 3 }],
  },
  {
    view: "is-desk",
    inky: "working",
    page: "solving",
    driving: true,
    say: "I’m working on it now.",
    text: "I solve the assignment on the real school page while you watch. Take it back whenever you like.",
    replies: [{ label: "Show me when it’s ready", beat: 4 }],
  },
  {
    view: "is-desk",
    inky: "waiting",
    page: "ready",
    say: "Ready to submit.",
    text: "I filled every answer and checked them twice. You can submit it, or tell me to.",
    replies: [
      { label: "I’ll submit", decide: "manual" },
      { label: "Submit it for me", decide: "auto", secondary: true },
    ],
  },
  {
    view: "is-desk",
    inky: "done",
    page: "ready",
    say: "",
    text: "",
    replies: [
      { label: "Join the waitlist", focus: "wait-email" },
      { label: "Play again", beat: 0, secondary: true },
    ],
  },
] as const;

const OUTCOME: Record<Decision, { say: string; text: string; page: PageState }> = {
  auto: {
    say: "Submitted.",
    text: "You told me I could, so I did. Every answer is still right there for you to see.",
    page: "submitted",
  },
  manual: {
    say: "It’s waiting on the page.",
    text: "Every answer is filled in. The Submit button is yours, whenever you’re ready.",
    page: "ready",
  },
};

const RAIL = ["Hi", "Scan", "Queue", "Work", "Ready"] as const;

const TRUST = [
  {
    label: "submit",
    title: "Submit is your call.",
    copy: "By default I stop at the Submit button and wait for you. Turn auto-submit on for a class or one assignment and I’ll finish the job. I never do it for quizzes or tests.",
  },
  {
    label: "tests",
    title: "Not mine to take.",
    copy: "Quizzes, midterms, anything with a timer. I sit there looking helpful and refuse. That part is yours, and it should be.",
  },
  {
    label: "passwords",
    title: "I’ve never seen one.",
    copy: "You sign in to your school yourself. I look away, and I don’t keep anything you type there. I’d be a terrible vault and I know that about myself.",
  },
  {
    label: "the page",
    title: "You can take it back any time.",
    copy: "I work on the real assignment page while you watch. Click Takeover and I stop mid-sentence. Click keep going and I pick up where I left off.",
  },
  {
    label: "your stuff",
    title: "It stays with you.",
    copy: "Your classes, drafts, and school pages live on your computer. The cloud gets your account and this email address. That’s it.",
  },
  {
    label: "honesty",
    title: "I’m new. I’ll say so.",
    copy: "This is a small private beta. Sometimes I’ll get stuck, and when I do I’ll stop and tell you instead of pretending I finished.",
  },
] as const;

const FAQ = [
  [
    "Is this cheating?",
    "That depends on your syllabus, and I mean that. I don’t hide. Everything I do happens where you can watch it. If a class bans this kind of help, don’t run me there.",
  ],
  [
    "Will you submit for me?",
    "Only if you tell me to. By default I finish the work and stop at the Submit button. You can turn auto-submit on for a class or a single assignment. Quizzes and tests are never included.",
  ],
  [
    "Will you take my quiz?",
    "No. Quizzes, tests, and exams stay yours. Problem sets, essays, reports, the stuff with a due date and no timer, those I’ll take a swing at.",
  ],
  [
    "Do you see my password?",
    "No. You sign in to your school yourself. I look away, and I don’t keep anything you type there.",
  ],
  [
    "What if you get something wrong?",
    "Then you’ll see it, because it’s right there on the page before anything is submitted. Fix it, or tell me what to fix. I check my work, but you get the final look.",
  ],
  [
    "Can my professor tell?",
    "I don’t have a stealth mode and I won’t pretend I do. Typed answers are typed answers. Use me where you’re allowed, and read what I did before you send it.",
  ],
  [
    "Do I need a school email?",
    "No. Any email works. I only use it to tell you your seat is ready.",
  ],
  [
    "When do I get in?",
    "Seats open in small batches so I can keep up. I’ll confirm your place, then email you again when yours is ready.",
  ],
] as const;

const SITES = [
  "Canvas",
  "Moodle",
  "Google Classroom",
  "Blackboard",
  "WebAssign",
  "Pearson",
  "Gradescope",
  "McGraw Hill",
  "zyBooks",
] as const;

export function LandingPage() {
  const [joined, setJoined] = useState(false);
  useDesktopShrink();

  return (
    <>
      <SiteNav />

      <main id="top">
        <div className="pin" id="pin">
          <div className="sticky">
            <section className="lede" id="lede" aria-labelledby="hero-title">
              <h1 id="hero-title">Hi. I’m Inky. I do your homework.</h1>
              <div className="lede-row">
                <p className="lead">
                  Studi is the desktop app. I scan your classes, queue the work,
                  and fill the answers on the real school page while you watch.{" "}
                  <strong>You keep the final say.</strong>
                </p>
              </div>
            </section>
            <Demo joined={joined} onJoined={() => setJoined(true)} />
          </div>
        </div>

        <div className="wrap">
          <section className="block" id="what">
            <p className="kicker">Meet Inky</p>
            <h2>Three things. I’m good at them.</h2>
            <p className="lead">
              No dashboards to learn. No prompts to write. Your classes show up,
              you click a card, and I get to work where you can see me.
            </p>
            <div className="features">
              <article className="feature card">
                <div className="n">your week</div>
                <h3>Never get blindsided by a due date again.</h3>
                <p>
                  I check every class each morning and lay the week out on one
                  board. Problem sets, essays, labs, the quiz you forgot existed.
                </p>
                <div className="feature-visual mini-stack" aria-hidden="true">
                  <div className="mini-assignment card">
                    <div className="assignment-top">
                      <span className="dot calc" /> CALC 1
                      <span className="badge due">tonight</span>
                    </div>
                    <strong>Problem set 4: Related rates</strong>
                    <small>due 11:59</small>
                  </div>
                  <div className="mini-assignment card">
                    <div className="assignment-top">
                      <span className="dot bio" /> BIO 150
                      <span className="badge needs">needs you</span>
                    </div>
                    <strong>Lab report: Osmosis</strong>
                    <small>you attach the file</small>
                  </div>
                </div>
              </article>

              <article className="feature card">
                <div className="n">the assignment</div>
                <h3>The hard part gets done while you watch.</h3>
                <p>
                  Click a card, say “Make Inky do this,” and I work right on
                  the assignment page: the math, the writing, the answer boxes.
                  Take it back whenever you like.
                </p>
                <div className="feature-visual" aria-hidden="true">
                  <div className="mini-page">
                    <div className="bar" />
                    <div className="line" />
                    <div className="line short" />
                    <div className="line" />
                    <div className="line short" />
                    <div className="mini-fade" />
                    <div className="mini-driver">
                      <span>Takeover</span>
                      <InkyMascot state="steering" size={54} />
                    </div>
                  </div>
                </div>
              </article>

              <article className="feature card">
                <div className="n">you</div>
                <h3>You decide what gets submitted.</h3>
                <p>
                  I finish and stop at Submit. Read it, fix what you’d fix, click
                  it yourself, or tell me to submit for you. Quizzes and tests
                  stay yours either way.
                </p>
                <div className="feature-visual" aria-hidden="true">
                  <div className="mini-submit">
                    <span>Submit answers</span>
                    <strong>← your call</strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section className="block compare" id="compare">
            <p className="kicker">Not another chat box</p>
            <h2>You already tried pasting it into a chatbot.</h2>
            <p className="lead">
              That works right up until it doesn’t know what’s due, where the
              assignment lives, or what you already turned in. I do.
            </p>
            <div className="compare-grid">
              <article className="compare-card card them">
                <h3>Copy, paste, pray</h3>
                <ul>
                  <li>You copy the problem over. Every time.</li>
                  <li>It has no idea what’s due or when.</li>
                  <li>You retype the answers into the school page and hope you didn’t mistype one.</li>
                  <li>Six assignments a week, six little rituals.</li>
                </ul>
              </article>
              <article className="compare-card card me">
                <h3>Inky, in Studi</h3>
                <ul>
                  <li>I already see your week, every class, every due date.</li>
                  <li>I work on the assignment page itself, while you watch.</li>
                  <li>The answers land in the right boxes. You check them there.</li>
                  <li>You submit, or tell me to. Then go do literally anything else.</li>
                </ul>
              </article>
            </div>
          </section>

          <section className="block trust" id="trust">
            <p className="kicker">Why you can trust me with it</p>
            <h2>You can see me. That’s the point.</h2>
            <p className="lead">
              No hidden tab. No stealth mode. No “trust me.” Everything I do
              happens in front of you, on your own computer, and nothing gets
              submitted unless you want it to. Use me where your syllabus
              allows it. That part is on you, and I’ll say so plainly.
            </p>
            <div className="trust-grid">
              {TRUST.map((item) => (
                <article className="trust-card card" key={item.label}>
                  <div className="n">✓ {item.label}</div>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="block" id="sites">
            <p className="kicker">Your classes</p>
            <h2>Canvas. Moodle. The weird one.</h2>
            <p className="lead">
              If you can open it, I can try it. Including the extra login your
              TA forgot to mention.
            </p>
            <div className="sites">
              {SITES.map((site) => (
                <span className="site-chip" key={site}>
                  {site}
                </span>
              ))}
              <span className="site-chip muted">the weird one</span>
            </div>
          </section>

          <section className="wait-block card" id="wait">
            <div className="wait-inky" aria-hidden="true">
              <InkyMascot state="hello" size={120} />
            </div>
            <p className="kicker">Seats</p>
            <h2>Get a seat.</h2>
            <p className="sub">
              Leave your email. I’ll confirm your place, then write again when
              it opens. Then go do something that isn’t a problem set.
            </p>
            <WaitlistForm
              emailId="wait-email"
              joined={joined}
              onJoined={() => setJoined(true)}
              darkButton
              finePrint={<>No newsletter. No sharing. Just the invite.</>}
            />
            <div className="steps" aria-label="What happens next">
              <div className="step">
                <div className="k">1 · now</div>
                <p>You leave your email here.</p>
              </div>
              <div className="step">
                <div className="k">2 · soon</div>
                <p>I email you again when a seat opens.</p>
              </div>
              <div className="step">
                <div className="k">3 · then</div>
                <p>You open Studi. I read your week and get to work.</p>
              </div>
            </div>
          </section>

          <section className="faq" id="faq">
            <h2>The obvious questions</h2>
            <p className="lead">Short answers. Honest ones.</p>
            {FAQ.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </section>

          <section className="end-band block">
            <h2>Get a seat before the week starts.</h2>
            <p>Your homework isn’t going anywhere. I could be.</p>
            <a className="btn primary" href="#wait">
              Get a seat
            </a>
          </section>
        </div>

        <footer className="foot">
          © 2026 Studi <span>·</span> Private beta <span>·</span>{" "}
          <a href="/mission">Mission</a> <span>·</span> <a href="#wait">Waitlist</a>
        </footer>
      </main>
    </>
  );
}

function settleDesktop() {
  const pin = document.getElementById("pin");
  if (!pin) return 0;
  const end = Math.max(0, pin.offsetHeight - window.innerHeight);
  if (window.scrollY < end) window.scrollTo({ top: end, behavior: "smooth" });
  return end;
}

function focusField(id: string) {
  const field = document.getElementById(id);
  if (!field) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  field.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  window.setTimeout(
    () => field.focus({ preventScroll: true }),
    reduce ? 0 : 650,
  );
}

// Scroll progress 0→1 shrinks the full-screen desktop into the landing box.
// Native scrolling only: the pin is taller than the viewport and the scene is sticky.
function useDesktopShrink() {
  useEffect(() => {
    const root = document.documentElement;
    const pin = document.getElementById("pin");
    const lede = document.getElementById("lede");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    function apply() {
      raf = 0;
      const stacked = window.innerWidth < 860;
      const range = Math.max(1, (pin?.offsetHeight ?? 0) - window.innerHeight);
      const raw = stacked || reduce ? 1 : Math.min(1, Math.max(0, window.scrollY / range));
      const eased = 1 - (1 - raw) ** 3;
      root.style.setProperty("--p", eased.toFixed(4));
      if (lede) root.style.setProperty("--lede-h", `${lede.scrollHeight}px`);
      root.classList.toggle("desk-open", eased < 0.5);
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(apply);
    }

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

function Demo({ joined, onJoined }: { joined: boolean; onJoined: () => void }) {
  const [beatIndex, setBeatIndex] = useState(0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [paused, setPaused] = useState(false);
  const [asking, setAsking] = useState(false);
  const [mobileImmersive, setMobileImmersive] = useState(false);
  const [mobileExiting, setMobileExiting] = useState(false);
  const [mobileSettling, setMobileSettling] = useState(false);
  const [visible, setVisible] = useState(true);
  const [typedCount, setTypedCount] = useState(0);
  const [toast, setToast] = useState("");
  const sceneRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef(0);
  const lastTouchAtRef = useRef(0);
  const mobileImmersiveDismissedRef = useRef(false);
  const mobileExitTimerRef = useRef<number | null>(null);
  const mobileSettleTimerRef = useRef<number | null>(null);
  const beat = DEMO_BEATS[beatIndex] ?? DEMO_BEATS[0];
  const outcome = beatIndex === 5 && decision ? OUTCOME[decision] : null;

  useEffect(() => {
    const requested = Number(
      new URLSearchParams(window.location.search).get("beat"),
    );
    if (Number.isInteger(requested) && requested > 0 && requested < 5) {
      setBeatIndex(requested);
    }
  }, []);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 860px)");
    const sync = () => {
      if (!mobile.matches) {
        setMobileImmersive(false);
        return;
      }
      if (!mobileImmersiveDismissedRef.current && window.scrollY < 4) {
        setMobileImmersive(true);
      }
    };

    sync();
    mobile.addEventListener("change", sync);
    return () => mobile.removeEventListener("change", sync);
  }, []);

  useEffect(() => () => {
    if (mobileExitTimerRef.current !== null) window.clearTimeout(mobileExitTimerRef.current);
    if (mobileSettleTimerRef.current !== null) window.clearTimeout(mobileSettleTimerRef.current);
  }, []);

  useEffect(() => {
    if (!mobileImmersive) return;
    const startY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) > 2) dismissMobileImmersive();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobileImmersive]);

  useEffect(() => {
    const node = sceneRef.current;
    if (!node || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Typing progress lives in a ref so Takeover pauses mid-line and resumes there.
  useEffect(() => {
    typedRef.current = 0;
    setTypedCount(0);
  }, [beatIndex]);

  useEffect(() => {
    if (beat.page !== "solving") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTypedCount(SOLVE_TOTAL);
      return;
    }
    if (paused || !visible) return;

    const timer = window.setInterval(() => {
      typedRef.current += 1;
      setTypedCount(typedRef.current);
      if (typedRef.current >= SOLVE_TOTAL) window.clearInterval(timer);
    }, 30);
    return () => window.clearInterval(timer);
  }, [beat.page, beatIndex, paused, visible]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function go(next: number) {
    if (next < 0 || next >= DEMO_BEATS.length) return;
    setBeatIndex(next);
    setDecision(null);
    setPaused(false);
    setAsking(false);
  }

  function decide(choice: Decision) {
    setDecision(choice);
    setBeatIndex(5);
  }

  function takeOver() {
    if (!beat.driving) return;
    setPaused(true);
    setAsking(false);
  }

  function keepGoing() {
    if (!beat.driving) return;
    setPaused(false);
    setAsking(false);
  }

  function dismissMobileImmersive() {
    if (!mobileImmersive || mobileExitTimerRef.current !== null) return;
    mobileImmersiveDismissedRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMobileImmersive(false);
      return;
    }

    setMobileExiting(true);
    mobileExitTimerRef.current = window.setTimeout(() => {
      mobileExitTimerRef.current = null;
      setMobileImmersive(false);
      setMobileExiting(false);
      setMobileSettling(true);
      mobileSettleTimerRef.current = window.setTimeout(() => {
        mobileSettleTimerRef.current = null;
        setMobileSettling(false);
      }, 360);
    }, 440);
  }

  function handleScenePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!mobileImmersive || event.pointerType !== "touch") return;
    const now = performance.now();
    if (now - lastTouchAtRef.current < 360) {
      event.preventDefault();
      dismissMobileImmersive();
    }
    lastTouchAtRef.current = now;
  }

  const speech = paused
    ? { say: "All yours.", text: "I’ll hover. Tap “keep going” when you want me back in the box." }
    : outcome ?? beat;
  const page: PageState | undefined = outcome ? outcome.page : beat.page;
  const railIndex = Math.min(beatIndex, RAIL.length - 1);

  return (
    <div
      className={`scene${mobileImmersive ? " mobile-immersive" : ""}${mobileExiting ? " mobile-minimizing" : ""}${mobileSettling ? " mobile-settling" : ""}`}
      ref={sceneRef}
      style={{ backgroundImage: `url(${wallpaper.src})` }}
      onPointerUp={handleScenePointerUp}
      onDoubleClick={(event) => {
        if (!mobileImmersive) return;
        event.preventDefault();
        dismissMobileImmersive();
      }}
    >
      <div className="stage-area">
        <div className="window" role="application" aria-label="Studi demo">
          <header className="titlebar">
            <div className="traffic" aria-hidden="true">
              <span className="tl close" />
              <span className="tl min" />
              <span className="tl max" />
            </div>
            <span className="logo">studi</span>
            <div className="spacer" />
            <button
              type="button"
              className={`desk-toggle${beat.view === "is-desk" ? " on" : ""}`}
              onClick={() => go(beat.view === "is-desk" ? 2 : 3)}
            >
              <span
                className={`desk-dot${beat.driving && !paused ? " working" : beat.view === "is-desk" && beatIndex < 4 ? " needs" : ""}`}
              />
              Inky’s desk
            </button>
            <div className="user">
              <div className="avatar">M</div> Maya R.
            </div>
          </header>

          <div className={`stage ${beat.view}`}>
            <section className="talk">
              <div className="inky-wrap">
                <InkyMascot state={paused ? "waiting" : beat.inky} size={190} />
              </div>
              <div className="copy">
                <div className="who-row">Inky</div>
                <div className="bubbles">
                  <div className="speech" key={`${beatIndex}-${paused}-${decision ?? ""}`}>
                    <span className="tail" aria-hidden="true" />
                    <div className="line">{speech.say}</div>
                    <div>{speech.text}</div>
                  </div>
                  {beat.driving && !paused ? (
                    <div className="status" role="status">
                      <span className="desk-dot working" /> Problem {currentProblem(typedCount)} of {PROBLEMS.length}
                    </div>
                  ) : null}
                </div>
                <div className={`replies${outcome ? " has-waitlist" : ""}`}>
                  {outcome ? (
                    <div className="demo-waitlist">
                      <div className="demo-waitlist-heading">
                        <strong>Want me in your week?</strong>
                        <span>The private beta is free.</span>
                      </div>
                      <WaitlistForm
                        emailId="demo-email"
                        joined={joined}
                        onJoined={onJoined}
                        finePrint="One confirmation now. Your download arrives when your seat opens."
                      />
                      <button type="button" className="demo-replay" onClick={() => go(0)}>
                        Play again
                      </button>
                    </div>
                  ) : paused ? (
                    <button type="button" className="btn primary" onClick={keepGoing}>
                      keep going
                    </button>
                  ) : (
                    beat.replies.map((reply) => (
                      <button
                        type="button"
                        className={`btn${reply.secondary ? "" : " primary"}`}
                        onClick={() => {
                          if (beatIndex === 0 && reply.beat === 1) track("demo_started");
                          if (reply.focus) track("waitlist_cta_clicked", { placement: "demo" });
                          if (reply.focus) focusField(reply.focus);
                          else if (reply.decide) decide(reply.decide);
                          else go(reply.beat ?? 0);
                        }}
                        key={reply.label}
                      >
                        {reply.label}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="app-main">
              {beat.view === "is-scan" ? (
                <ScanBoard onContinue={() => go(2)} />
              ) : (
                <>
                  <div className="app-hero">
                    <InkyMascot state="idle" size={64} />
                    <div className="hi">
                      <h3>Inky’s work queue</h3>
                      <div className="sync-bar">
                        <span>
                          <strong>✓ 5 classes checked</strong> · just now
                        </span>
                        <span>3 assignments queued</span>
                      </div>
                    </div>
                    <div className={`week-say${toast ? " quiz-nudge" : ""}`}>
                      <div className="speech" key={`${beatIndex}-${toast}`} role={toast ? "status" : undefined}>
                        <span className="tail" aria-hidden="true" />
                        <div className="line">{toast ? toast : beat.say}</div>
                        <div>{toast ? "Quizzes and tests stay yours. I’ll sit here looking helpful." : beat.text}</div>
                      </div>
                      <div className="replies">
                        <button type="button" className="btn primary" onClick={() => go(3)}>
                          Watch you work
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="queue-strip" aria-label="Inky's queue status">
                    <span><i className="desk-dot working" /> Next: Related rates</span>
                    <span>2 more waiting</span>
                    <strong>I’ll tell you when each one is ready.</strong>
                  </div>
                  <WeekBoard onStart={() => go(3)} onRefuse={setToast} />
                </>
              )}
            </section>

            <aside className="school" aria-label="School page">
              <div className="school-page">
                <LmsPage page={page} typedCount={typedCount} />
                {beat.driving && !paused ? (
                  <>
                    <button
                      type="button"
                      className="drive-fade"
                      aria-label="Ask Inky to pause"
                      onClick={() => setAsking(true)}
                    />
                    <div className="drive-inky">
                      <button type="button" onClick={() => setAsking(true)}>
                        Takeover
                      </button>
                      <InkyMascot state="steering" size={72} />
                    </div>
                  </>
                ) : null}
                {asking ? (
                  <div className="drive-ask">
                    <div
                      className="ask-card"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="takeover-title"
                    >
                      <strong id="takeover-title">Want the page?</strong>
                      <p>I’ll pause so you can click.</p>
                      <div>
                        <button type="button" className="ask-go" onClick={takeOver}>
                          Takeover
                        </button>
                        <button type="button" className="ask-keep" onClick={() => setAsking(false)}>
                          Keep going
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </div>

      <div className="desk-foot">
        <div className="dock" aria-hidden="true">
          <span className="dock-ico notes" />
          <span className="dock-ico folder" />
          <span className="dock-ico inky on">
            <InkyMascot state="idle" size={34} />
          </span>
        </div>
        <button type="button" className="scroll-hint" onClick={settleDesktop}>
          Keep scrolling ↓
        </button>
        <div className="rail" aria-label="Demo steps">
          {RAIL.map((label, index) => (
            <button
              type="button"
              className={`${index === railIndex ? "on" : ""}${index < railIndex ? " done" : ""}`}
              aria-pressed={index === railIndex}
              onClick={() => go(index)}
              key={label}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="mobile-exit-hint"
        onClick={dismissMobileImmersive}
        aria-label="Exit the full-screen Studi demo"
      >
        {mobileExiting ? "Back to the page…" : "Scroll ↓ or double-tap to exit"}
      </button>
    </div>
  );
}

function ScanBoard({ onContinue }: { onContinue: () => void }) {
  const sources = [
    ["Canvas", "3 assignments found", "done"],
    ["Google Classroom", "1 assignment found", "done"],
    ["Pearson", "checking CALC 1…", "active"],
    ["Moodle", "up next", "waiting"],
  ] as const;

  return (
    <div className="scan-board">
      <div className="scan-heading">
        <InkyMascot state="working" size={88} />
        <div>
          <p className="scan-kicker">Background school scan</p>
          <h3>Looking through your classes…</h3>
          <p>Every morning · or whenever you ask</p>
        </div>
      </div>
      <div className="scan-layout">
        <div className="scan-list" aria-label="School sites being scanned">
          {sources.map(([name, result, state]) => (
            <div className={`scan-row ${state}`} key={name}>
              <span className="scan-check" aria-hidden="true">
                {state === "done" ? "✓" : state === "active" ? "•••" : ""}
              </span>
              <strong>{name}</strong>
              <small>{result}</small>
            </div>
          ))}
          <div className="scan-progress" aria-hidden="true"><span /></div>
        </div>
        <div className="scan-message">
          <div className="speech">
            <span className="tail" aria-hidden="true" />
            <div className="line">I scan in the background.</div>
            <div>Every day, or whenever you want me to. Nothing due gets to sneak up on you.</div>
          </div>
          <button type="button" className="btn primary" onClick={onContinue}>
            Show me what you found
          </button>
        </div>
      </div>
    </div>
  );
}

function WeekBoard({
  onStart,
  onRefuse,
}: {
  onStart: () => void;
  onRefuse: (message: string) => void;
}) {
  const refuse = () => onRefuse("Cute. That one’s a you problem.");
  return (
    <>
      <div className="app-week">
      <div className="app-day today">
        <div className="day-heading">
          <span>Mon</span>
          <small>today</small>
        </div>
        <button type="button" className="app-assignment card selected" onClick={onStart}>
          <div className="assignment-top">
            <span className="dot calc" /> CALC 1
            <span className="badge working">next</span>
          </div>
          <strong>Problem set 4: Related rates</strong>
          <small>
            due 11:59 <span className="chip">Watch Inky work</span>
          </small>
        </button>
        <div className="app-assignment card">
          <div className="assignment-top">
            <span className="dot hist" /> HIST 210
            <span className="badge queued">queued 2</span>
          </div>
          <strong>Essay: Causes of the Cold War</strong>
          <small>after related rates</small>
        </div>
      </div>
      <div className="app-day">
        <div className="day-heading">
          <span>Tue</span>
          <small>Oct 7</small>
        </div>
        <div className="app-assignment card">
          <div className="assignment-top">
            <span className="dot bio" /> BIO 150
            <span className="badge needs">needs you</span>
          </div>
          <strong>Lab report: Osmosis</strong>
          <small>you attach the file</small>
        </div>
      </div>
      <div className="app-day">
        <div className="day-heading">
          <span>Wed</span>
          <small>Oct 8</small>
        </div>
        <button type="button" className="app-assignment card" onClick={refuse}>
          <div className="assignment-top">
            <span className="dot psy" /> PSY 101
            <span className="badge soft">yours</span>
          </div>
          <strong>Reading quiz: Ch. 6</strong>
          <small>not touching it</small>
        </button>
        <div className="app-assignment card">
          <div className="assignment-top">
            <span className="dot eng" /> ENG 102
          </div>
          <strong>Peer review draft</strong>
          <small>due 11:59</small>
        </div>
      </div>
      <div className="app-day">
        <div className="day-heading">
          <span>Thu</span>
          <small>Oct 9</small>
        </div>
        <div className="app-empty">
          nothing due —<br />good study day
        </div>
      </div>
      <div className="app-day">
        <div className="day-heading">
          <span>Fri</span>
          <small>Oct 10</small>
        </div>
        <button type="button" className="app-assignment card" onClick={refuse}>
          <div className="assignment-top">
            <span className="dot psy" /> PSY 101
            <span className="badge soft">yours</span>
          </div>
          <strong>Midterm exam</strong>
          <small>that’s you</small>
        </button>
      </div>
      </div>
      <div className="mobile-week" aria-label="Your week in Inky's queue">
        <section className="mobile-day-block today">
          <header className="mobile-day-heading">
            <span>Today</span>
            <small>2 in Inky’s queue</small>
          </header>
          <button type="button" className="mobile-task active" onClick={onStart}>
            <span className="mobile-task-state">working next</span>
            <span className="mobile-task-course"><i className="dot calc" /> CALC 1 · due 11:59</span>
            <strong>Problem set 4: Related rates</strong>
            <span className="mobile-task-action">Watch Inky work →</span>
          </button>
          <div className="mobile-task queued">
            <span className="mobile-task-state">queued #2</span>
            <span className="mobile-task-course"><i className="dot hist" /> HIST 210</span>
            <strong>Essay: Causes of the Cold War</strong>
            <span className="mobile-task-action muted">after related rates</span>
          </div>
        </section>

        <section className="mobile-day-block">
          <header className="mobile-day-heading">
            <span>Tomorrow</span>
            <small>Tuesday, Oct 7</small>
          </header>
          <div className="mobile-task needs-you">
            <span className="mobile-task-state">needs you</span>
            <span className="mobile-task-course"><i className="dot bio" /> BIO 150</span>
            <strong>Lab report: Osmosis</strong>
            <span className="mobile-task-action muted">attach your lab file</span>
          </div>
        </section>

        <section className="mobile-day-block">
          <header className="mobile-day-heading">
            <span>Wednesday</span>
            <small>Oct 8</small>
          </header>
          <button type="button" className="mobile-task yours" onClick={refuse}>
            <span className="mobile-task-state">yours</span>
            <span className="mobile-task-course"><i className="dot psy" /> PSY 101</span>
            <strong>Reading quiz: Chapter 6</strong>
            <span className="mobile-task-action muted">Inky won’t take quizzes</span>
          </button>
          <div className="mobile-task">
            <span className="mobile-task-state">due 11:59</span>
            <span className="mobile-task-course"><i className="dot eng" /> ENG 102</span>
            <strong>Peer review draft</strong>
            <span className="mobile-task-action muted">waiting behind your queue</span>
          </div>
        </section>
      </div>
    </>
  );
}

function LmsPage({ page, typedCount }: { page?: PageState; typedCount: number }) {
  const finished = page === "ready" || page === "submitted";

  // Slice the typing script into per-problem work and answer text.
  let remaining = finished ? SOLVE_TOTAL : typedCount;
  const shown = SOLVE_SCRIPT.map((segment) => {
    const take = Math.max(0, Math.min(segment.length, remaining));
    remaining -= take;
    return segment.slice(0, take);
  });

  return (
    <div className="lms">
      <div className="lms-nav">
        <strong>Ridgeway</strong>
        <span>Dashboard</span>
        <span className="on">Courses</span>
        <span>Calendar</span>
        <span>Inbox</span>
        <i>MR</i>
      </div>
      <div className="lms-course">CALC 1 · Calculus I · Fall</div>
      <div className="lms-crumb">Courses / CALC 1 / Assignments / Problem Set 4</div>
      <h3>Problem Set 4: Related Rates</h3>
      <div className="lms-meta">
        <span>Due Oct 6 at 11:59pm</span>
        <span>30 pts</span>
        <span>3 questions</span>
        <span>Attempts: 1 of 2</span>
      </div>
      {page === "submitted" ? (
        <div className="lms-banner">✓ Submitted Oct 6 at 9:42pm · 3 of 3 answered</div>
      ) : null}
      <div className="lms-body">
        {PROBLEMS.map((problem, index) => {
          const work = shown[index * 2] ?? "";
          const answer = shown[index * 2 + 1] ?? "";
          const done = answer.length === problem.answer.length;
          const typing = !done && answer.length > 0;
          return (
            <div className={`q${done ? " done" : ""}`} key={index}>
              <div className="qn">{index + 1}.</div>
              <div className="qbody">
                <p>{problem.prompt}</p>
                <div className="ans">
                  <span className="ans-label">Answer</span>
                  <span className={`field${typing ? " typing" : ""}`}>{answer}</span>
                  {done ? <span className="ans-ok">✓</span> : null}
                </div>
                {work ? <div className="work">{work}</div> : null}
              </div>
            </div>
          );
        })}
        <div className="lms-actions">
          <button type="button">Save answers</button>
          <button type="button" className="submit" disabled={page !== "ready"}>
            {page === "submitted" ? "Submitted ✓" : "Submit answers"}
          </button>
        </div>
      </div>
    </div>
  );
}
