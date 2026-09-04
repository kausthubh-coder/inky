"use client";

import { useEffect, useRef, useState } from "react";
import wallpaper from "../designs/wallpaper.png";
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
  view: "is-hello" | "is-week" | "is-desk";
  inky: InkyState;
  hold: number;
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
    hold: 7000,
    say: "Hi, I’m Inky.",
    text: "I finish all your homework before you know it even exists.",
    replies: [{ label: "Okay, show me", beat: 1 }],
  },
  {
    view: "is-week",
    inky: "idle",
    hold: 6800,
    say: "I scan all your schoolwork every day.",
    text: "Or whenever you ask. Then I can finish every assignment and save the answers for you to submit. Tell me to, and I can submit them too.",
    replies: [{ label: "Do this one", beat: 2 }],
  },
  {
    view: "is-desk",
    inky: "working",
    hold: 9600,
    page: "solving",
    driving: true,
    say: "Don’t mind me.",
    text: "Working the problems right on the page. Take it back whenever you like.",
    replies: [{ label: "skip ahead", beat: 3, secondary: true }],
  },
  {
    view: "is-desk",
    inky: "waiting",
    hold: 0,
    page: "ready",
    say: "Solved all three.",
    text: "Checked them twice. Your call: I can hit Submit, or leave it sitting there for you.",
    replies: [
      { label: "I’ll submit", decide: "manual" },
      { label: "Submit it for me", decide: "auto", secondary: true },
    ],
  },
  {
    view: "is-desk",
    inky: "done",
    hold: 0,
    page: "ready",
    say: "",
    text: "",
    replies: [
      { label: "Save my seat", focus: "hero-email" },
      { label: "play again", beat: 0, secondary: true },
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

const RAIL = ["Hi", "The scan", "The work", "Your call"] as const;

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

const FINE_PRINT = (
  <>
    Private beta, small batches. I’ll confirm your place, then email when your
    seat opens. No newsletter. <a href="/sign-in">Already have a seat? Sign in.</a>
  </>
);

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
                  Studi is the desktop app. I’m the one inside it. I put your
                  whole week on one board, then take the assignment you’ve been
                  avoiding, right where it lives, while you watch.{" "}
                  <strong>I do the work. You keep the final say.</strong>
                </p>
                <WaitlistForm
                  emailId="hero-email"
                  joined={joined}
                  onJoined={() => setJoined(true)}
                  finePrint={FINE_PRINT}
                />
              </div>
            </section>
            <Demo />
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

// Scroll to the end of the desktop shrink, where the hero form is fully visible.
function settleDesktop() {
  const pin = document.getElementById("pin");
  if (!pin) return 0;
  const end = Math.max(0, pin.offsetHeight - window.innerHeight);
  if (window.scrollY < end) window.scrollTo({ top: end, behavior: "smooth" });
  return end;
}

function focusField(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wasBelow = window.scrollY < settleDesktop();
  window.setTimeout(
    () => document.getElementById(id)?.focus({ preventScroll: true }),
    wasBelow && !reduce ? 500 : 0,
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

function Demo() {
  const [beatIndex, setBeatIndex] = useState(0);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [paused, setPaused] = useState(false);
  const [asking, setAsking] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [visible, setVisible] = useState(true);
  const [typedCount, setTypedCount] = useState(0);
  const [toast, setToast] = useState("");
  const sceneRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef(0);
  const beat = DEMO_BEATS[beatIndex] ?? DEMO_BEATS[0];
  const outcome = beatIndex === 4 && decision ? OUTCOME[decision] : null;

  useEffect(() => {
    const requested = Number(
      new URLSearchParams(window.location.search).get("beat"),
    );
    if (Number.isInteger(requested) && requested > 0 && requested < 4) {
      setBeatIndex(requested);
      setAutoplay(false);
    }
  }, []);

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

  useEffect(() => {
    if (!beat.hold || paused || !visible) return;
    if (!autoplay && !beat.driving) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setTimeout(() => {
      setBeatIndex((current) => Math.min(current + 1, 3));
      setPaused(false);
      setAsking(false);
    }, beat.hold);
    return () => window.clearTimeout(timer);
  }, [autoplay, beat.driving, beat.hold, paused, visible]);

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
    setAutoplay(false);
    setBeatIndex(next);
    setDecision(null);
    setPaused(false);
    setAsking(false);
  }

  function decide(choice: Decision) {
    setAutoplay(false);
    setDecision(choice);
    setBeatIndex(4);
  }

  function takeOver() {
    if (!beat.driving) return;
    setPaused(true);
    setAsking(false);
    setAutoplay(false);
  }

  function keepGoing() {
    if (!beat.driving) return;
    setPaused(false);
    setAsking(false);
  }

  const speech = paused
    ? { say: "All yours.", text: "I’ll hover. Tap “keep going” when you want me back in the box." }
    : outcome ?? beat;
  const page: PageState | undefined = outcome ? outcome.page : beat.page;
  const railIndex = Math.min(beatIndex, RAIL.length - 1);

  return (
    <div
      className="scene"
      ref={sceneRef}
      style={{ backgroundImage: `url(${wallpaper.src})` }}
      onPointerDown={() => setAutoplay(false)}
    >
      <div className="stage-area">
        <div className="window" role="application" aria-label="Studi demo">
          <header className="titlebar">
            <div className="traffic" aria-hidden="true">
              <span className="tl close" />
              <span className="tl min" />
              <span className="tl max" />
            </div>
            <span className="titlebar-icon" aria-hidden="true">
              <InkyMascot state="idle" size={30} />
            </span>
            <span className="logo">studi</span>
            <div className="spacer" />
            <button
              type="button"
              className={`desk-toggle${beat.view === "is-desk" ? " on" : ""}`}
              onClick={() => go(beatIndex >= 2 ? 1 : 2)}
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
                <div className="replies">
                  {paused ? (
                    <button type="button" className="btn primary" onClick={keepGoing}>
                      keep going
                    </button>
                  ) : (
                    beat.replies.map((reply) => (
                      <button
                        type="button"
                        className={`btn${reply.secondary ? "" : " primary"}`}
                        onClick={() => {
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
              <div className="app-hero">
                <InkyMascot state="idle" size={64} />
                <div className="hi">
                  <h3>Hey Maya — 2 things due tonight.</h3>
                  <div className="sync-bar">
                    <span>
                      <strong>✓ Classes checked</strong> · 2h ago
                    </span>
                    <span>every morning</span>
                  </div>
                </div>
                <div className={`week-say${toast ? " quiz-nudge" : ""}`}>
                  <div className="speech" key={`${beatIndex}-${toast}`} role={toast ? "status" : undefined}>
                    <span className="tail" aria-hidden="true" />
                    <div className="line">{toast ? toast : beat.say}</div>
                    <div>{toast ? "Quizzes and tests stay yours. I’ll sit here looking helpful." : beat.text}</div>
                  </div>
                  <div className="replies">
                    <button type="button" className="btn primary" onClick={() => go(2)}>
                      Do this one
                    </button>
                  </div>
                </div>
              </div>
              <div className="command app-command">
                <input
                  type="text"
                  aria-label="Tell Inky what to do"
                  placeholder="Type “start the problem set” and press enter…"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      go(2);
                    }
                  }}
                />
                <button type="button" className="send" onClick={() => go(2)}>
                  enter ↵
                </button>
              </div>
              <WeekBoard onStart={() => go(2)} onRefuse={setToast} />
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
    <div className="app-week">
      <div className="app-day today">
        <div className="day-heading">
          <span>Mon</span>
          <small>today</small>
        </div>
        <button type="button" className="app-assignment card selected" onClick={onStart}>
          <div className="assignment-top">
            <span className="dot calc" /> CALC 1
            <span className="badge due">tonight</span>
          </div>
          <strong>Problem set 4: Related rates</strong>
          <small>
            due 11:59 <span className="chip">Make Inky do this</span>
          </small>
        </button>
        <div className="app-assignment card">
          <div className="assignment-top">
            <span className="dot hist" /> HIST 210
          </div>
          <strong>Essay: Causes of the Cold War</strong>
          <small>after the problem set</small>
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
