"use client";

import { useEffect, useRef, useState } from "react";
import wallpaper from "../designs/wallpaper.png";
import type { InkyState } from "../lib/inky";
import { InkyMascot } from "./inky-mascot";
import { WaitlistForm } from "./waitlist-form";

const ESSAY_OPENING =
  "The wartime alliance did not survive the peace. By 1946, two occupation zones and two stories about who won were already hardening into policy.";
const ESSAY_ENDING =
  "The question is not who started the Cold War. It is how two winners talked themselves into being enemies, and how quickly each decided the other had planned it all along.";

type DemoBeat = {
  view: "is-hello" | "is-week" | "is-desk";
  inky: InkyState;
  hold: number;
  page?: "essay" | "review";
  driving?: boolean;
  say: string;
  text: string;
  replies: readonly {
    label: string;
    beat?: number;
    href?: string;
    secondary?: boolean;
  }[];
};

const DEMO_BEATS: readonly DemoBeat[] = [
  {
    view: "is-hello",
    inky: "hello",
    hold: 3400,
    say: "Hi. I’m Inky.",
    text: "I do your homework. The 11:59 kind. The one you’ve been staring at since Tuesday.",
    replies: [{ label: "okay, show me", beat: 1 }],
  },
  {
    view: "is-week",
    inky: "idle",
    hold: 4200,
    say: "That essay is staring at you.",
    text: "Want me to take it? Not the quiz. Cute try though.",
    replies: [{ label: "Make Inky do this", beat: 2 }],
  },
  {
    view: "is-desk",
    inky: "working",
    hold: 8200,
    page: "essay",
    driving: true,
    say: "Don’t mind me.",
    text: "I’m in the box. Take the page back whenever you like.",
    replies: [{ label: "skip ahead", beat: 3, secondary: true }],
  },
  {
    view: "is-desk",
    inky: "waiting",
    hold: 0,
    page: "review",
    say: "Wrote it.",
    text: "I’m not clicking Submit. That’s your whole personality.",
    replies: [
      { label: "Save me a seat", href: "#wait" },
      { label: "play again", beat: 0, secondary: true },
    ],
  },
] as const;

const TRUST = [
  {
    label: "passwords",
    title: "I’ve never seen one.",
    copy: "You sign in to your school yourself. I look away, and I don’t keep anything you type there. I’d be a terrible vault and I know that about myself.",
  },
  {
    label: "tests",
    title: "Not mine to take.",
    copy: "Quizzes, midterms, anything with a timer. I sit there looking helpful and refuse. That part is yours, and it should be.",
  },
  {
    label: "submit",
    title: "The last click is yours.",
    copy: "I never hit submit. You read what I wrote, change what you want, and put your name on it. It is still your week.",
  },
  {
    label: "your stuff",
    title: "It stays with you.",
    copy: "Your classes, drafts, and school pages live on your computer. The cloud gets your account and this email address. That’s it.",
  },
  {
    label: "your syllabus",
    title: "It still wins.",
    copy: "If a class bans this kind of help, don’t run me there. I’m useful. I’m not your alibi.",
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
    "Will you take my quiz?",
    "No. Quizzes, tests, and exams stay yours. Essays, problem sets, reports, the stuff with a due date and no timer, those I’ll take a swing at.",
  ],
  [
    "Do you see my password?",
    "No. You sign in to your school yourself. I look away, and I don’t keep anything you type there.",
  ],
  [
    "Will you submit for me?",
    "No. I write and then I stop. You read it, change what you want, and hit submit yourself. The work waits on the page until you do.",
  ],
  [
    "Can my professor tell?",
    "I don’t have a stealth mode and I won’t pretend I do. Typed text is typed text. Use me where you’re allowed, and read what I wrote before you send it.",
  ],
  [
    "Where does my stuff live?",
    "Your classes, drafts, and school pages stay on your computer. The cloud holds your account and your email. That’s it.",
  ],
  [
    "When do I get in?",
    "Seats open in small batches so I can keep up. Your campus email gets you in line, and I email you once when yours is ready.",
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

  return (
    <>
      <header className="site-nav">
        <a className="wordmark" href="#top">
          studi <span className="pencil">✎</span>
        </a>
        <nav className="links" aria-label="Page">
          <a href="#what">Inky</a>
          <a href="#trust">Trust</a>
          <a href="/mission">Mission</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="cta" href="#wait">
          Get a seat
        </a>
      </header>

      <main id="top">
        <div className="wrap">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <h1 id="hero-title">Hi. I’m Inky. I do your homework.</h1>
              <p className="lead">
                Studi puts your whole week on one board and lets me take the
                assignment you’ve been avoiding, right where it lives, while
                you watch. <strong>I write. You read it. You hit submit.</strong>
              </p>
              <WaitlistForm
                emailId="hero-email"
                joined={joined}
                onJoined={() => setJoined(true)}
                finePrint={
                  <>
                    Private beta, small batches. <strong>One email</strong> when
                    your seat opens. I’ve never seen a password and tests stay
                    yours.
                  </>
                }
              />
            </div>
            <div className="hero-inky" aria-hidden="true">
              <div className="hero-inky-shadow">
                <InkyMascot state="hello" size={220} />
              </div>
              <div className="say">
                <span className="tail" />
                <div className="line">See the email box?</div>
                Campus email goes in it. I’ll save you a seat.
              </div>
            </div>
          </section>

          <Demo />

          <section className="block" id="what">
            <p className="kicker">Meet Inky</p>
            <h2>Three things. I’m good at them.</h2>
            <p className="lead">
              No dashboards to learn. No prompts to write. Your classes show up,
              you point at a card, and I get to work where you can see me.
            </p>
            <div className="features">
              <article className="feature card">
                <div className="n">your week</div>
                <h3>I find what’s due and put it on one board.</h3>
                <p>
                  Essays, problem sets, lab reports, the quiz you forgot
                  existed. Sorted by day, checked every morning, so it stops
                  living in your head.
                </p>
                <div className="feature-visual mini-stack" aria-hidden="true">
                  <div className="mini-assignment card">
                    <div className="assignment-top">
                      <span className="dot hist" /> HIST 210
                      <span className="badge due">tonight</span>
                    </div>
                    <strong>Essay: Causes of the Cold War</strong>
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
                <h3>I take the one you’re avoiding.</h3>
                <p>
                  Say “Make Inky do this” and watch me work, right on the
                  assignment page. Take it back whenever you want. I’m not
                  sneaky. I’m just in the box.
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
                <h3>You stay the student.</h3>
                <p>
                  I write, then I stop. You read it, fix what you’d fix, and
                  click the scary button yourself. Quizzes, tests, and exams
                  stay yours. Cute try though.
                </p>
                <div className="feature-visual" aria-hidden="true">
                  <div className="mini-submit">
                    <span>Submit Assignment</span>
                    <strong>← yours</strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section className="block trust" id="trust">
            <p className="kicker">Why this isn’t weird</p>
            <h2>You can see me. That’s the point.</h2>
            <p className="lead">
              No hidden tab. No stealth mode. No “trust me.” Everything I do
              happens in front of you, on your own computer, and a few things I
              simply won’t do.
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
        </div>

        <div className="wrap">
          <section className="wait-block card" id="wait">
            <p className="kicker">Seats</p>
            <h2>Get a seat.</h2>
            <p className="sub">
              Campus email. I’ll save you one and email you once when it opens.
              Then go do something that isn’t a lab report.
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
                <p>You drop your campus email here.</p>
              </div>
              <div className="step">
                <div className="k">2 · soon</div>
                <p>I email you once when a seat opens.</p>
              </div>
              <div className="step">
                <div className="k">3 · then</div>
                <p>You open Studi. I meet your week.</p>
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
          Hi. I’m Inky. <span>·</span> <a href="/mission">Mission</a>
          <span>·</span> <a href="#wait">Waitlist</a>
        </footer>
      </main>
    </>
  );
}

function Demo() {
  const [beatIndex, setBeatIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asking, setAsking] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [visible, setVisible] = useState(true);
  const [typed, setTyped] = useState("");
  const [toast, setToast] = useState("");
  const demoRef = useRef<HTMLElement>(null);
  const beat = DEMO_BEATS[beatIndex] ?? DEMO_BEATS[0];

  useEffect(() => {
    const requested = Number(
      new URLSearchParams(window.location.search).get("beat"),
    );
    if (Number.isInteger(requested) && requested > 0 && requested < DEMO_BEATS.length) {
      setBeatIndex(requested);
      setAutoplay(false);
    }
  }, []);

  useEffect(() => {
    const node = demoRef.current;
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
      setBeatIndex((current) => Math.min(current + 1, DEMO_BEATS.length - 1));
      setPaused(false);
      setAsking(false);
    }, beat.hold);
    return () => window.clearTimeout(timer);
  }, [autoplay, beat.driving, beat.hold, paused, visible]);

  useEffect(() => {
    if (beat.page !== "essay") {
      setTyped("");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(ESSAY_OPENING);
      return;
    }

    let index = 0;
    const timer = window.setInterval(() => {
      if (paused || !visible) return;
      index += 1;
      setTyped(ESSAY_OPENING.slice(0, index));
      if (index >= ESSAY_OPENING.length) window.clearInterval(timer);
    }, 22);
    return () => window.clearInterval(timer);
  }, [beat.page, beatIndex, paused, visible]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function go(next: number, userInitiated = true) {
    if (next < 0 || next >= DEMO_BEATS.length) return;
    if (userInitiated) setAutoplay(false);
    setBeatIndex(next);
    setPaused(false);
    setAsking(false);
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
    ? {
        say: "All yours.",
        text: "I’ll hover. Tap “keep going” when you want me back in the box.",
      }
    : beat;

  return (
    <section className="demo" aria-labelledby="demo-title" ref={demoRef}>
      <div className="demo-head">
        <div>
          <p className="kicker">Here’s me on a Monday</p>
          <h2 id="demo-title">Click around. I don’t bite.</h2>
          <p>
            A tour of Studi with pretend classes. Nothing here is real, except
            my personality.
          </p>
        </div>
        <div className="rail" aria-label="Demo steps">
          {["Hi", "Your week", "Inky’s desk", "You review"].map((label, index) => (
            <button
              type="button"
              className={`${index === beatIndex ? "on" : ""}${index < beatIndex ? " done" : ""}`}
              aria-pressed={index === beatIndex}
              onClick={() => go(index)}
              key={label}
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="scene"
        style={{ backgroundImage: `url(${wallpaper.src})` }}
      >
        <div className="window" role="application" aria-label="Studi demo">
          <header className="titlebar">
            <div className="traffic" aria-hidden="true">
              <span className="tl close" />
              <span className="tl min" />
              <span className="tl max" />
            </div>
            <span className="logo">
              studi <span className="pencil">✎</span>
            </span>
            <button
              type="button"
              className={`nav-link${beat.view === "is-week" ? " on" : ""}`}
              onClick={() => go(1)}
            >
              This week
            </button>
            <div className="spacer" />
            <button
              type="button"
              className={`desk-toggle${beat.view === "is-desk" ? " on" : ""}`}
              onClick={() => go(beatIndex >= 2 ? 1 : 2)}
            >
              <span
                className={`desk-dot${beat.driving && !paused ? " working" : beat.view === "is-desk" ? " needs" : ""}`}
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
                  <div className="speech">
                    <span className="tail" aria-hidden="true" />
                    <div className="line">{speech.say}</div>
                    <div>{speech.text}</div>
                  </div>
                </div>
                <div className="replies">
                  {paused ? (
                    <button type="button" className="btn primary" onClick={keepGoing}>
                      keep going
                    </button>
                  ) : (
                    beat.replies.map((reply) =>
                      reply.href ? (
                        <a className="btn primary" href={reply.href} key={reply.label}>
                          {reply.label}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className={`btn${reply.secondary ? "" : " primary"}`}
                          onClick={() => go(reply.beat ?? 0)}
                          key={reply.label}
                        >
                          {reply.label}
                        </button>
                      ),
                    )
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
                <div className="week-say">
                  <div className="speech">
                    <span className="tail" aria-hidden="true" />
                    <div className="line">{beat.say}</div>
                    <div>{beat.text}</div>
                  </div>
                  <div className="replies">
                    <button type="button" className="btn primary" onClick={() => go(2)}>
                      Make Inky do this
                    </button>
                  </div>
                </div>
              </div>
              <div className="command app-command">
                <div className="pen">✎</div>
                <input
                  type="text"
                  aria-label="Tell Inky what to do"
                  placeholder="Tell Inky what to do — “start my essay”…"
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
              {toast ? (
                <div className="ink-toast" role="status">
                  {toast}
                </div>
              ) : null}
            </section>

            <aside className="school" aria-label="School page">
              <div className="school-page">
                <LmsPage page={beat.page} typed={typed} />
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
    </section>
  );
}

function WeekBoard({
  onStart,
  onRefuse,
}: {
  onStart: () => void;
  onRefuse: (message: string) => void;
}) {
  return (
    <div className="app-week">
      <div className="app-day today">
        <div className="day-heading">
          <span>Mon</span>
          <small>today</small>
        </div>
        <button type="button" className="app-assignment card selected" onClick={onStart}>
          <div className="assignment-top">
            <span className="dot hist" /> HIST 210
            <span className="badge due">tonight</span>
          </div>
          <strong>Essay: Causes of the Cold War</strong>
          <small>
            due 11:59 <span className="chip">Make Inky do this</span>
          </small>
        </button>
        <div className="app-assignment card">
          <div className="assignment-top">
            <span className="dot calc" /> CALC 1
          </div>
          <strong>Problem set 4</strong>
          <small>queued</small>
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
        <button
          type="button"
          className="app-assignment card"
          onClick={() => onRefuse("Cute. That one’s a you problem.")}
        >
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
          nothing due —<br />good study day ✎
        </div>
      </div>
      <div className="app-day">
        <div className="day-heading">
          <span>Fri</span>
          <small>Oct 10</small>
        </div>
        <button
          type="button"
          className="app-assignment card"
          onClick={() => onRefuse("Cute. That one’s a you problem.")}
        >
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

function LmsPage({
  page,
  typed,
}: {
  page?: "essay" | "review";
  typed: string;
}) {
  const reviewed = page === "review";

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
      <div className="lms-course">HIST 210 · Europe since 1945 · Fall</div>
      <div className="lms-crumb">
        Courses / HIST 210 / Assignments / Causes of the Cold War
      </div>
      <h3>Causes of the Cold War</h3>
      <div className="lms-meta">
        <span>Due Oct 6 at 11:59pm</span>
        <span>100 pts</span>
        <span>Text entry</span>
        <span>Attempts: 1</span>
      </div>
      <div className="lms-body">
        <p>
          Write 1,200 words on the origins of the Cold War. Use at least two
          primary sources from lecture and cite them in Chicago style.
        </p>
        <div className="lms-editor">
          <div className="lms-tools">B &nbsp; I &nbsp; U &nbsp; · &nbsp; ¶ &nbsp; ≡ &nbsp; 🔗</div>
          <div className="lms-box">
            <p className={`typed${reviewed ? " done" : ""}`}>
              {reviewed ? ESSAY_OPENING : typed}
            </p>
            {reviewed ? <p className="typed done">{ESSAY_ENDING}</p> : null}
          </div>
        </div>
        <div className="lms-actions">
          <button type="button">Save draft</button>
          <button type="button" className="submit" disabled={!reviewed}>
            Submit Assignment
          </button>
        </div>
      </div>
    </div>
  );
}
