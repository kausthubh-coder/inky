"use client";

import { useEffect, useState } from "react";
import { InkyMascot } from "./inky-mascot";
import { WaitlistForm } from "./waitlist-form";
import type { InkyState } from "../lib/inky";

const ESSAY =
  "The wartime alliance did not survive the peace. By 1946, two occupation zones and two stories about who won were already hardening into policy.";

const FAQ = {
  quizzes: { q: "Quizzes?", say: "Quizzes stay yours.", text: "I will not start them or click through them. Study guides, yes. The test itself, no." },
  passwords: { q: "Passwords?", say: "Not in Studi.", text: "You log in inside the school browser. Those credentials never leave that window." },
  submit: { q: "Will it submit?", say: "Not unless you say so.", text: "Default is I attempt the work, you hit submit. Auto-submit is a switch you turn on." },
} as const;

type Beat = {
  id: string;
  inky: InkyState;
  pill: string;
  desk: boolean;
  hold: number;
  say: string;
  text: string;
  url?: string;
  badge?: string;
  page?: "essay" | "login";
  replies: readonly { label: string; go: number; ghost: boolean }[];
};

const BEATS: readonly Beat[] = [
  {
    id: "hi",
    inky: "idle",
    pill: "talking",
    desk: false,
    hold: 0,
    say: "It does your homework for you.",
    text: "I’m Inky. I’ll do it in a school browser you can watch. Click around. Scroll when you want the rest.",
    replies: [{ label: "Show me", go: 1, ghost: false }],
  },
  {
    id: "work",
    inky: "working",
    pill: "on it",
    desk: true,
    hold: 5200,
    say: "Watch.",
    text: "One browser. One assignment. Maya’s Cold War essay. Stop me whenever.",
    url: "canvas.university.edu / HIST 210 / essay",
    badge: "working",
    page: "essay",
    replies: [{ label: "Keep watching", go: 2, ghost: false }],
  },
  {
    id: "need",
    inky: "needs",
    pill: "needs you",
    desk: true,
    hold: 0,
    say: "Your turn.",
    text: "WebAssign wants a login. I don’t type school passwords. Quizzes I leave alone.",
    url: "webassign.net / calc1 / login",
    badge: "needs",
    page: "login",
    replies: [{ label: "That’s the idea", go: 0, ghost: true }],
  },
] as const;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function ease(t: number) {
  return 1 - (1 - t) ** 3;
}

function formatClock(date: Date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let hour = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const am = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${days[date.getDay()]}  ${hour}:${minutes} ${am}`;
}

export function LandingPage() {
  const [beat, setBeat] = useState(0);
  const [faq, setFaq] = useState<keyof typeof FAQ | null>(null);
  const [typed, setTyped] = useState("");
  const [clock, setClock] = useState("");
  const [turning, setTurning] = useState(false);

  const current = BEATS[beat] ?? BEATS[0];

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pin = document.getElementById("pin");
    const root = document.documentElement;

    function applyScroll() {
      if (!pin) return;
      if (reduce) {
        root.style.setProperty("--nav-o", "1");
        root.classList.add("is-min");
        return;
      }
      const range = Math.max(1, pin.offsetHeight - window.innerHeight);
      const t = ease(clamp(window.scrollY / range, 0, 1));
      const mobile = window.innerWidth < 860;
      root.style.setProperty("--nav-o", String(t));
      root.style.setProperty("--inset-t", `${lerp(0, mobile ? 58 : 62, t)}px`);
      root.style.setProperty("--inset-x", `${lerp(0, mobile ? 12 : 28, t)}px`);
      root.style.setProperty("--inset-b", `${lerp(0, mobile ? 10 : 16, t)}px`);
      root.style.setProperty("--radius", `${lerp(0, 22, t)}px`);
      root.style.setProperty("--win-w", `${lerp(mobile ? 88 : 68, 92, t)}%`);
      root.style.setProperty("--win-h", `${lerp(mobile ? 68 : 64, 82, t)}%`);
      root.style.setProperty("--hint-o", String(Math.max(0, 1 - t * 1.4)));
      root.classList.toggle("is-min", t > 0.55);
    }

    let raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyScroll();
      });
    }

    applyScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", applyScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", applyScroll);
    };
  }, []);

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (current.page !== "essay") {
      setTyped("");
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setTyped(ESSAY);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(ESSAY.slice(0, i));
      if (i >= ESSAY.length) window.clearInterval(id);
    }, 22);
    return () => window.clearInterval(id);
  }, [current.page, beat]);

  useEffect(() => {
    if (!current.hold) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setTimeout(() => go(beat + 1), current.hold);
    return () => window.clearTimeout(id);
  }, [beat, current.hold]);

  function go(next: number) {
    if (turning || next === beat || next < 0 || next >= BEATS.length) return;
    setTurning(true);
    setFaq(null);
    window.setTimeout(() => {
      setBeat(next);
      window.setTimeout(() => setTurning(false), 280);
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
  }

  const faqItem = faq ? FAQ[faq] : null;

  return (
    <>
      <header className="site-nav" id="site-nav">
        <a className="wordmark" href="#">studi <span className="pencil">✎</span></a>
        <div className="links">
          <a href="#how">How it works</a>
          <a href="#week">This week</a>
          <a href="#rules">Rules</a>
          <a href="#faq">FAQ</a>
        </div>
        <a className="btn primary cta" href="#wait">Join waitlist</a>
      </header>

      <div className="pin" id="pin">
        <div className="sticky">
          <div className="scene" id="scene">
            <div className="wallpaper" aria-hidden="true">
              <div className="stars" />
              <div className="moon" />
              <div className="hill a" />
              <div className="hill b" />
              <div className="hill c" />
            </div>
            <div className="desk-icons" aria-hidden="true">
              <div className="desk-icon"><span className="pic notes" />Notes</div>
              <div className="desk-icon"><span className="pic folder" />School</div>
            </div>
            <div className="desk">
              <div className="os-bar">
                <span className="apple" aria-hidden="true" />
                <span className="app-name">Studi</span>
                <div className="menus"><span>File</span><span>Edit</span><span>View</span><span>Window</span></div>
                <div className="spacer" />
                <span className="clock">{clock}</span>
              </div>
              <div className="stage-area">
                <div className="window" role="application" aria-label="Studi demo">
                  <header className="titlebar">
                    <div className="traffic" aria-hidden="true">
                      <span className="tl close" />
                      <span className="tl min" />
                      <span className="tl max" />
                    </div>
                    <a className="logo" href="#wait">studi <span className="pencil">✎</span></a>
                    <span className="badge soft">{current.pill}</span>
                    <div className="spacer" />
                    <span className="badge">private beta</span>
                    <div className="user"><div className="avatar">M</div> Maya</div>
                  </header>
                  <div className={`stage${current.desk ? " with-browser" : ""}`}>
                    <section className="talk">
                      <div className="inky-wrap">
                        <InkyMascot state={current.inky} size={200} />
                      </div>
                      <div className={`copy${turning ? " turning" : ""}`}>
                        <div className="who-row">talking to Inky</div>
                        <div className="bubbles">
                          <div className="speech">
                            <span className="tail" aria-hidden="true" />
                            <div className="line">{current.say}</div>
                            <div>{current.text}</div>
                          </div>
                          {faqItem ? (
                            <div className="speech faq-ans">
                              <span className="tail" aria-hidden="true" />
                              <div className="line">{faqItem.say}</div>
                              <div>{faqItem.text}</div>
                            </div>
                          ) : null}
                        </div>
                        <div className="replies">
                          {current.replies.map((reply) => (
                            <button
                              key={reply.label}
                              type="button"
                              className={reply.ghost ? "btn" : "btn primary"}
                              onClick={() => go(reply.go)}
                            >
                              {reply.label}
                            </button>
                          ))}
                        </div>
                        {current.desk && beat === 2 ? (
                          <div className="asks on">
                            {Object.entries(FAQ).map(([key, value]) => (
                              <button
                                key={key}
                                type="button"
                                className={faq === key ? "on" : ""}
                                onClick={() => setFaq((currentFaq) => (currentFaq === key ? null : key as keyof typeof FAQ))}
                              >
                                {value.q}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </section>
                    <aside className="school" aria-label="School browser">
                      <div className="school-label">
                        <span>school browser · you sign in here</span>
                        <span className={`badge ${current.badge ?? "waiting"}`}>{current.badge ?? current.pill}</span>
                      </div>
                      <div className="browser">
                        <div className="bar">
                          <span className="b-dot" />
                          <span className="b-dot" />
                          <span className="b-dot" />
                          <span className="url">{current.url ?? "waiting for a school link"}</span>
                        </div>
                        <div className="page">
                          {current.page === "essay" ? (
                            <>
                              <div className="lms-top">✎ University Canvas</div>
                              <div className="essay-meta">ASSIGNMENT · 1,200 WORDS · HIST 210</div>
                              <h3 className="essay-title">Causes of the Cold War</h3>
                              <p className={`typed${typed === ESSAY ? " done" : ""}`}>{typed}</p>
                            </>
                          ) : current.page === "login" ? (
                            <>
                              <div className="lms-top">WebAssign · Cengage</div>
                              <div className="login-card card">
                                <h3>CALC 1 login</h3>
                                <div className="sub">This is the school page. Not a Studi form.</div>
                                <label>Username <input value="maya.r" readOnly autoComplete="off" /></label>
                                <label>Password <input type="password" value="not-in-studi" readOnly autoComplete="off" /></label>
                              </div>
                            </>
                          ) : (
                            <p style={{ color: "var(--ink-faint)", fontWeight: 700 }}>School isn’t open yet.</p>
                          )}
                        </div>
                      </div>
                    </aside>
                  </div>
                </div>
              </div>
              <div className="dock" aria-hidden="true">
                <div className="dock-inner">
                  <span className="dock-ico notes" />
                  <span className="dock-ico folder" />
                  <span className="dock-ico inky on" />
                </div>
              </div>
              <div className="scroll-hint">scroll</div>
            </div>
          </div>
          <div className="lede-hero">
            <h1 className="display">It does your homework for you.</h1>
            <p>A Windows app. One school browser you can watch. You keep logins and submit.</p>
          </div>
        </div>
      </div>

      <main className="page-rest">
        <div className="wrap">
          <section className="block" id="how">
            <p className="kicker">How it works</p>
            <h2>Open Studi. Watch it work. Submit when you’re ready.</h2>
            <p className="lead">A Windows app with one school browser you can see. It finds what’s due, attempts the homework, and waits for you. Nothing happens in a tab you can’t watch.</p>
            <div className="feats">
              <article className="feat card">
                <div className="n">01</div>
                <h3>It finds the week</h3>
                <p>Point it at Canvas, Moodle, Classroom, WebAssign — anything that loads in a browser. It scans while you watch and puts the week on a board. Incomplete scans stay incomplete. No fake checkmarks.</p>
              </article>
              <article className="feat card">
                <div className="n">02</div>
                <h3>It does one assignment</h3>
                <p>It opens the real school page and types in the real box. One task at a time. You can stop it. There is no second hidden agent somewhere else.</p>
              </article>
              <article className="feat card">
                <div className="n">03</div>
                <h3>You hit submit</h3>
                <p>Default is it attempts the work. You review. File uploads stay yours. Auto-submit exists — it’s a switch, and it’s off.</p>
              </article>
            </div>
          </section>

          <section className="block" id="week">
            <p className="kicker">This week</p>
            <h2>Homework on the board. Quizzes sitting there looking ignored.</h2>
            <p className="lead">Studi is a week board plus one school browser. Essays get written. Problem sets get attempted. Quizzes and exams stay on the board so you don’t forget them — Studi will not open them.</p>
            <div className="week-mock" aria-hidden="true">
              <div className="day-col today">
                <div className="dh"><span>Mon</span><span className="n">today</span></div>
                <div className="assn card">
                  <div className="top"><span className="dot hist" /> HIST 210 <span className="badge working" style={{ marginLeft: "auto" }}>on it</span></div>
                  <div className="title">Essay: Causes of the Cold War</div>
                  <div className="bottom">typing in Canvas · due tonight</div>
                </div>
                <div className="assn card">
                  <div className="top"><span className="dot calc" /> CALC 1</div>
                  <div className="title">Problem set 4</div>
                  <div className="bottom">queued behind the essay</div>
                </div>
              </div>
              <div className="day-col">
                <div className="dh"><span>Tue</span><span className="n">Oct 7</span></div>
                <div className="assn card">
                  <div className="top"><span className="dot bio" /> BIO 150 <span className="badge needs" style={{ marginLeft: "auto" }}>needs you</span></div>
                  <div className="title">Lab report: Osmosis</div>
                  <div className="bottom">file upload is yours</div>
                </div>
              </div>
              <div className="day-col">
                <div className="dh"><span>Wed</span><span className="n">Oct 8</span></div>
                <div className="assn card">
                  <div className="top"><span className="dot psy" /> PSY 101 <span className="badge soft" style={{ marginLeft: "auto" }}>yours</span></div>
                  <div className="title">Reading quiz: Ch. 6</div>
                  <div className="bottom">Studi will not start this</div>
                </div>
                <div className="assn card">
                  <div className="top"><span className="dot eng" /> ENG 102</div>
                  <div className="title">Peer review draft</div>
                  <div className="bottom">due 11:59</div>
                </div>
              </div>
              <div className="day-col">
                <div className="dh"><span>Thu</span><span className="n">Oct 9</span></div>
                <div className="day-empty">nothing due —<br />good study day ✎</div>
              </div>
              <div className="day-col">
                <div className="dh"><span>Fri</span><span className="n">Oct 10</span></div>
                <div className="assn card">
                  <div className="top"><span className="dot psy" /> PSY 101</div>
                  <div className="title">Midterm exam</div>
                  <div className="bottom">in class · study guide, yes</div>
                </div>
              </div>
            </div>
          </section>

          <section className="block" id="does">
            <p className="kicker">What it will and won’t</p>
            <h2>Homework, yes. The test, no.</h2>
            <p className="lead">It works wherever the assignment lives in a browser. It does not take over your whole education. You still sit the exam.</p>
            <div className="do-grid">
              <article className="do-col yes card">
                <h3>It will attempt</h3>
                <ul>
                  <li><span className="mark">✓</span> Essays and discussion posts</li>
                  <li><span className="mark">✓</span> Problem sets and worksheets</li>
                  <li><span className="mark">✓</span> Lab write-ups, until a file picker</li>
                  <li><span className="mark">✓</span> Study guides for quizzes you take yourself</li>
                  <li><span className="mark">✓</span> Anything else it can do on a page you can see</li>
                </ul>
              </article>
              <article className="do-col no card">
                <h3>It will not</h3>
                <ul>
                  <li><span className="mark">×</span> Start or click through quizzes, tests, exams</li>
                  <li><span className="mark">×</span> Type a school password</li>
                  <li><span className="mark">×</span> Solve a CAPTCHA</li>
                  <li><span className="mark">×</span> Upload your files for you</li>
                  <li><span className="mark">×</span> Hide. There is no stealth mode</li>
                </ul>
              </article>
            </div>
          </section>

          <section className="block" id="rules">
            <p className="kicker">The leash</p>
            <h2>You decide how far it goes.</h2>
            <p className="lead">Set a default for everything, then override a course, a repeating pattern, or one assignment. The most specific rule wins.</p>
            <div className="modes">
              <article className="mode card">
                <span className="badge soft">leave it</span>
                <h3>Don’t attempt</h3>
                <p>It finds the work and leaves it alone. Useful for a class you actually want to do, or a professor who said no.</p>
              </article>
              <article className="mode card default">
                <span className="badge">default</span>
                <h3>Attempt, you submit</h3>
                <p>It writes. It stops. You read it on the school page and hit submit. This is how Studi ships.</p>
              </article>
              <article className="mode card">
                <span className="badge soft">a switch</span>
                <h3>Auto-submit</h3>
                <p>It can click submit if you turn that on for that work. It re-checks the rule before it does. Still never a quiz.</p>
              </article>
            </div>
          </section>

          <section className="block" id="stops">
            <p className="kicker">Honest stops</p>
            <h2>When it doesn’t know, it taps you.</h2>
            <p className="lead">Inky doesn’t guess a login or a robot check. The school browser stays open. You do the human part. It picks up after.</p>
            <div className="stops">
              <article className="stop card">
                <h3>Logins</h3>
                <p>School passwords live in that browser. Studi never asks for them and doesn’t store them.</p>
              </article>
              <article className="stop card">
                <h3>CAPTCHA</h3>
                <p>If the site wants a human, you are the human. Same for “are you a robot.”</p>
              </article>
              <article className="stop card">
                <h3>Files</h3>
                <p>Uploads stay yours. It can draft the report. You attach the PDF.</p>
              </article>
              <article className="stop card">
                <h3>Quizzes</h3>
                <p>It will not start them. Study guides, yes. The test itself, no.</p>
              </article>
            </div>
          </section>

          <section className="block" id="sites">
            <p className="kicker">School sites</p>
            <h2>If it loads in a browser, that’s the school site.</h2>
            <p className="lead">One visible browser. Canvas today, WebAssign tomorrow, a department portal next week. Linked tools get found during the scan, then you sign into those too.</p>
            <div className="sites">
              {["Canvas", "Moodle", "Google Classroom", "Blackboard", "WebAssign", "Pearson", "Gradescope", "McGraw Hill", "zyBooks"].map((site) => (
                <span key={site} className="site-chip">{site}</span>
              ))}
              <span className="site-chip muted">anything in a browser</span>
            </div>
          </section>

          <section className="block" id="local">
            <p className="kicker">On the computer</p>
            <h2>School stays here. The cloud gets an email.</h2>
            <div className="local">
              <article className="card">
                <h3>Local-first, on purpose</h3>
                <p>Assignments, drafts, the school browser, memories — those live on the Windows machine. Closing the window keeps Studi in the tray so scheduled scans still run. Quit it when you want it actually off.</p>
              </article>
              <article className="card note">
                <h3>What we store</h3>
                <p>Account, waitlist, credits. Not your Canvas cookies. Not the essay.</p>
              </article>
            </div>
          </section>
        </div>

        <section className="wait-block card" id="wait">
          <p className="kicker">Seats</p>
          <h2>Private beta</h2>
          <p className="sub">Campus email. We’ll send a seat. Nothing from school gets uploaded to join.</p>
          <WaitlistForm />
        </section>

        <section className="faq" id="faq">
          <h2>The obvious questions</h2>
          <p className="lead">Short answers. If a class bans this, don’t run it there.</p>
          {[
            ["Is this cheating?", "That’s your syllabus. It does the homework in a browser you can watch. There is no hide button. If a class bans this, don’t run it there."],
            ["Will it take my quiz?", "No. Quizzes, tests, exams — it will not start them or click through them. Study guides, yes. You still sit the test."],
            ["Where do school passwords go?", "Only in the school browser. Studi never asks for them and doesn’t store them. Linked tools like WebAssign work the same way: you sign in there, it never gets a copy."],
            ["Does it auto-submit?", "Not unless you turn that on. Default is it writes, you submit. File uploads stay yours too. Auto-submit still refuses quizzes."],
            ["What computer do I need?", "Windows desktop. One computer, one school browser profile. It is not a website you leave open in Chrome, and it is not on your phone."],
            ["Can my professor tell?", "It works in the same school site you’d use yourself. Typed text looks like typed text. There is no stealth mode and no “undetectable” claim. Don’t use it where it isn’t allowed."],
            ["What if I close the window?", "Studi stays in the tray. Scheduled scans and queued work keep going until you quit. If a review timer runs out, answers get saved as a local Markdown file so they aren’t just gone."],
            ["How do I get in?", "Waitlist with a campus email. When you have a seat, you sign in with Clerk. We don’t need your name again — the account already has it."],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </section>

        <div className="wrap">
          <section className="end-band block">
            <h2>It does your homework for you.</h2>
            <a className="btn primary" href="#wait">Join the waitlist</a>
          </section>
        </div>

        <p className="foot">Windows desktop · local-first · waitlist is an email</p>
      </main>
    </>
  );
}
