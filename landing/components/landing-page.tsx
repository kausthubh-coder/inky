"use client";

import { useEffect, useRef, useState } from "react";
import wallpaper from "../designs/wallpaper.png";
import { track } from "../lib/analytics";
import type { InkyState } from "../lib/inky";
import { InkyMascot } from "./inky-mascot";
import { SiteNav } from "./site-nav";
import { WaitlistForm } from "./waitlist-form";
import { useLandingAnalytics } from "./use-landing-analytics";
import styles from "./landing-page.module.css";

const STEPS: readonly {
  label: string;
  title: string;
  next: string;
  inky: InkyState;
}[] = [
  {
    label: "Hello",
    title: "Hi, I’m Studi.\nI do your homework.",
    next: "Show me how",
    inky: "hello",
  },
  {
    label: "Find",
    title: "I find what’s due.",
    next: "See my week",
    inky: "scanning",
  },
  {
    label: "Plan",
    title: "Tonight’s homework goes first.",
    next: "Watch Inky work",
    inky: "idle",
  },
  {
    label: "Do",
    title: "I do the work. Right on the page.",
    next: "See the finished work",
    inky: "working",
  },
  {
    label: "Your turn",
    title: "All done. Go enjoy your evening.",
    next: "",
    inky: "done",
  },
];

const ASSIGNMENTS = [
  {
    course: "CALC 1",
    title: "Related rates",
    due: "Tonight · 11:59 pm",
    color: "blue",
  },
  {
    course: "HIST 210",
    title: "Cold War essay",
    due: "Tomorrow · 5 pm",
    color: "purple",
  },
  {
    course: "BIO 150",
    title: "Osmosis lab report",
    due: "Wednesday · 11:59 pm",
    color: "green",
  },
] as const;

const FAQ = [
  [
    "What is Studi?",
    "Studi is a desktop app for schoolwork. Inky is the little person inside: he finds your assignments, organizes your week, and works through your homework on the school page.",
  ],
  [
    "How do I get started?",
    "Join the waitlist. When your invite arrives, download Studi, connect your school, and meet Inky.",
  ],
  [
    "Do I need a school email?",
    "Any email works. Use the one you actually check so you don’t miss your invite.",
  ],
  [
    "When can I try it?",
    "Studi is in private beta. Invites go out in small batches, and we’ll email you when your place opens.",
  ],
] as const;

export function LandingPage() {
  const [joined, setJoined] = useState(false);
  const onJoined = () => setJoined(true);
  const { pageRef, expanded, toggleDesktop } = useDesktopIntro();
  useLandingAnalytics(pageRef);
  return (
    <div className={styles.page} ref={pageRef} data-expanded={expanded}>
      <SiteNav tour />
      <main id="top">
        <section className={styles.pin} id="pin" aria-labelledby="hero-title">
          <div className={styles.sticky}>
            <div className={styles.lede} id="lede">
              <h1 id="hero-title">
                Your homework. <span>Handled.</span>
              </h1>
              <p className={styles.intro}>
                Meet Inky. Your homework helper, right on your desktop.
              </p>
            </div>
            <Demo
              joined={joined}
              onJoined={onJoined}
              expanded={expanded}
              onToggleDesktop={toggleDesktop}
            />
          </div>
        </section>
        <section
          className={styles.benefits}
          id="what"
          aria-labelledby="benefits-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Less homework in your head</p>
            <h2 id="benefits-title">More room for the rest of your life.</h2>
          </div>
          <div className={styles.benefitGrid}>
            <article>
              <div className={styles.benefitVisual} aria-hidden="true">
                <span className={styles.dateTile}>
                  MON<strong>06</strong>
                </span>
                <span className={styles.miniNote}>
                  Calculus
                  <br />
                  <strong>Found it. On the list.</strong>
                </span>
              </div>
              <h3>Nothing to keep track of.</h3>
              <p>Inky checks your classes and puts what’s due in one place.</p>
            </article>
            <article>
              <div className={styles.benefitVisual} aria-hidden="true">
                <span className={styles.answerTile}>
                  Answer{" "}
                  <strong>
                    −1.5 ft/s <i>✓</i>
                  </strong>
                </span>
                <InkyMascot state="working" size={72} />
              </div>
              <h3>No copy-and-paste routine.</h3>
              <p>
                The work happens on the assignment page, right where it belongs.
              </p>
            </article>
            <article>
              <div className={styles.benefitVisual} aria-hidden="true">
                <span className={styles.doneTile}>
                  ✓ &nbsp; Related rates<strong>Ready for a look.</strong>
                </span>
              </div>
              <h3>Open it. See what’s done.</h3>
              <p>The answers and working are there for you to read through.</p>
            </article>
          </div>
        </section>
        <section
          className={styles.invitation}
          id="wait"
          aria-labelledby="wait-title"
        >
          <div>
            <p className={styles.eyebrow}>Studi private beta</p>
            <h2 id="wait-title">
              Put Inky on your list.
              <br />
              He’ll take care of yours.
            </h2>
            <p>
              Invites go out in small batches. Join the waitlist now to hear
              when your place opens.
            </p>
          </div>
          <div className={styles.invitationForm}>
            <div aria-hidden="true">
              <InkyMascot state="hello" size={88} />
            </div>
            <WaitlistForm
              emailId="wait-email"
              joined={joined}
              onJoined={onJoined}
              finePrint="Your invite will arrive by email."
            />
          </div>
        </section>
        <section
          className={styles.questions}
          id="faq"
          aria-labelledby="faq-title"
        >
          <h2 id="faq-title">A few things you might be wondering.</h2>
          <div>
            {FAQ.map(([question, answer]) => (
              <details key={question} onToggle={(event) => {
                if (event.currentTarget.open) track("faq_opened", { question });
              }}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <a href="#top" className={styles.footerLogo}>
          studi
        </a>
        <span>Made for life after homework.</span>
        <a href="/mission">Our mission</a>
        <small>© 2026 Studi</small>
      </footer>
    </div>
  );
}

function useDesktopIntro() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const page = pageRef.current;
    const pin = document.getElementById("pin");
    const lede = document.getElementById("lede");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    function apply() {
      frame = 0;
      const range = Math.max(1, (pin?.offsetHeight ?? 0) - window.innerHeight);
      const progress = reduced.matches
        ? 1
        : Math.min(1, Math.max(0, window.scrollY / range));
      const eased = 1 - (1 - progress) ** 3;
      page?.style.setProperty("--p", String(eased));
      page?.style.setProperty("--lede-h", `${lede?.scrollHeight ?? 110}px`);
      setExpanded(eased < 0.65);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(apply);
    }
    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  function toggleDesktop() {
    track("demo_display_toggled", { expanded: !expanded });
    const pin = document.getElementById("pin");
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: expanded
        ? Math.max(0, (pin?.offsetHeight ?? 0) - window.innerHeight)
        : 0,
      behavior: reduced ? "auto" : "smooth",
    });
  }
  return { pageRef, expanded, toggleDesktop };
}

function Demo({
  joined,
  onJoined,
  expanded,
  onToggleDesktop,
}: {
  joined: boolean;
  onJoined: () => void;
  expanded: boolean;
  onToggleDesktop: () => void;
}) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const completed = useRef(false);
  const tour = useRef<HTMLDivElement>(null);
  const viewed = useRef(false);
  const stepEnteredAt = useRef(0);
  const current = STEPS[step];

  useEffect(() => { stepEnteredAt.current = performance.now(); }, [step]);

  function markViewed() {
    if (viewed.current) return;
    viewed.current = true;
    track("demo_viewed");
    track("demo_step_viewed", { step: 1, label: STEPS[0].label, direction: "initial" });
  }

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        markViewed();
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    if (tour.current) observer.observe(tour.current);
    return () => observer.disconnect();
  }, []);

  function go(next: number) {
    if (next < 0 || next >= STEPS.length || next === step) return;
    markViewed();
    track("demo_step_left", {
      step: step + 1,
      label: current.label,
      next_step: next + 1,
      elapsed_ms: Math.round(performance.now() - stepEnteredAt.current),
    });
    if (step === STEPS.length - 1 && next === 0) track("demo_replayed");
    if (!started.current && next > 0) {
      started.current = true;
      track("demo_started");
    }
    track("demo_step_viewed", { step: next + 1, label: STEPS[next].label, direction: next > step ? "forward" : "back" });
    if (next === STEPS.length - 1 && !completed.current) {
      completed.current = true;
      track("demo_completed");
    }
    setStep(next);
    requestAnimationFrame(() => {
      body.current?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    });
  }

  return (
    <div id="tour" ref={tour} className={styles.tour}>
      <div
        className={styles.desktop}
        style={{ backgroundImage: `url(${wallpaper.src})` }}
      >
        <section className={styles.window} aria-label="Interactive Studi tour">
          <header className={styles.titlebar}>
            <span className={styles.traffic} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className={styles.logo}>studi</span>
            <span className={styles.demoBadge}>Interactive demo</span>
          </header>
          <div
            ref={body}
            className={`${styles.tourBody} ${step === 0 ? styles.hello : ""}`}
          >
            <div className={styles.guide}>
              <div className={styles.mascot} aria-hidden="true">
                <InkyMascot state={current.inky} size={144} />
              </div>
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  {current.title}
                </h2>
                {step === 0 ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => go(1)}
                  >
                    Show me how →
                  </button>
                ) : null}
              </div>
            </div>
            {step > 0 && (
              <div className={styles.preview}>
                {step === 1 ? <SchoolScan /> : null}
                {step === 2 ? <WeekBoard /> : null}
                {step === 3 ? <AssignmentPage /> : null}
                {step === 4 ? (
                  <div className={styles.waitlistCard}>
                    <span className={styles.betaBadge}>
                      <i /> Private beta
                    </span>
                    <h3>Want me on your desktop?</h3>
                    <p>Invites go out in small batches. Save your place.</p>
                    <WaitlistForm
                      emailId="demo-email"
                      joined={joined}
                      onJoined={onJoined}
                      finePrint="I’ll email when it’s your turn."
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <footer className={styles.tourControls}>
            <button
              type="button"
              className={styles.back}
              disabled={step === 0}
              onClick={() => go(step - 1)}
              aria-label="Previous tour step"
            >
              ← <span>Back</span>
            </button>
            <ol
              className={`${styles.progress} ${step === 0 ? styles.quietProgress : ""}`}
              aria-label="Tour progress"
            >
              {STEPS.map((item, index) => (
                <li
                  key={item.label}
                  className={
                    index === step
                      ? styles.activeStep
                      : index < step
                        ? styles.visitedStep
                        : ""
                  }
                >
                  <span aria-current={index === step ? "step" : undefined}>
                    <i aria-hidden="true">{index < step ? "✓" : index + 1}</i>
                    <span>{item.label}</span>
                  </span>
                </li>
              ))}
            </ol>
            <span className={styles.mobileProgress}>
              {step === 4 ? "✓ Tour complete" : `${step + 1} / ${STEPS.length}`}
            </span>
            {step > 0 && step < 4 ? (
              <button
                type="button"
                className={`btn primary ${styles.next}`}
                onClick={() => go(step + 1)}
              >
                <span className={styles.desktopLabel}>{current.next}</span>
                <span className={styles.mobileLabel}>Next</span>
                <span aria-hidden="true">→</span>
              </button>
            ) : step === 4 ? (
              <button
                type="button"
                className={styles.replay}
                onClick={() => go(0)}
              >
                <span className={styles.desktopLabel}>Replay tour</span>
                <span className={styles.mobileLabel}>Replay</span>{" "}
                <span aria-hidden="true">↻</span>
              </button>
            ) : null}
          </footer>
        </section>
        <div className={styles.desktopFoot}>
          <div className={styles.dock} aria-hidden="true">
            <span />
            <span />
            <span>
              <InkyMascot state="idle" size={32} />
            </span>
          </div>
          <button
            type="button"
            className={`btn ${styles.desktopToggle}`}
            onClick={onToggleDesktop}
          >
            {expanded ? "Scroll to explore ↓" : "Open desktop ↗"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SchoolScan() {
  return (
    <div className={styles.board}>
      <div className={styles.schoolSource}>
        <span>Canvas</span>
        <strong>✓ Connected</strong>
      </div>
      <div className={styles.scanArrow} aria-hidden="true">
        ↓
      </div>
      <div className={styles.scanList}>
        {ASSIGNMENTS.map((item) => (
          <div key={item.course}>
            <span className={`${styles.courseIcon} ${styles[item.color]}`}>
              {item.course.slice(0, 1)}
            </span>
            <span>
              <strong>{item.course}</strong>
              <small>{item.title}</small>
            </span>
            <span className={styles.check}>
              ✓<span className="visually-hidden"> Found</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekBoard() {
  return (
    <div className={styles.board}>
      <div className={styles.boardHeading}>
        <h3>This week</h3>
      </div>
      <div className={styles.assignmentList}>
        {ASSIGNMENTS.map((item, index) => (
          <article
            key={item.course}
            className={index === 0 ? styles.selectedAssignment : ""}
          >
            <div className={styles.assignmentDate}>
              {item.due}
              {index === 0 ? <span>Up next</span> : null}
            </div>
            <div className={styles.assignmentTitle}>
              <i className={styles[item.color]} />
              <div>
                <small>{item.course}</small>
                <h4>{item.title}</h4>
              </div>
              {index === 0 ? <span aria-hidden="true">→</span> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AssignmentPage() {
  const [answered, setAnswered] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnswered(3);
      return;
    }
    if (paused || answered === 3) return;
    const timer = window.setTimeout(
      () => setAnswered((value) => value + 1),
      1200,
    );
    return () => window.clearTimeout(timer);
  }, [answered, paused]);

  return (
    <div className={styles.schoolPage}>
      <div className={styles.schoolToolbar}>
        <strong>CALC 1</strong>
        <span>Assignment page</span>
      </div>
      <div className={styles.schoolContent}>
        <h3>Related rates</h3>
        <p className={styles.schoolMeta}>Due tonight · 3 questions</p>
        <div className={styles.problem}>
          <span>QUESTION 1</span>
          <p>
            A 10 ft ladder slides away from a wall at 2 ft/s. How fast is the
            top moving down when the base is 6 ft from the wall?
          </p>
          <div className={styles.working}>
            {answered > 0 ? "6(2) + 8y′ = 0" : "Working through the steps…"}
          </div>
          <div className={styles.answer}>
            <span>Answer</span>
            <strong>{answered > 0 ? "−1.5 ft/s" : "…"}</strong>
            {answered > 0 ? <i>✓</i> : null}
          </div>
        </div>
        <div className={styles.otherAnswer}>
          <span>2. Expanding balloon</span>
          <strong>{answered > 1 ? "0.0127 cm/s ✓" : "Up next"}</strong>
        </div>
        <div className={styles.otherAnswer}>
          <span>3. Filling a tank</span>
          <strong>{answered > 2 ? "0.283 m/min ✓" : "Up next"}</strong>
        </div>
      </div>
      <div className={styles.workStatus}>
        <span role="status">
          {answered === 3
            ? "✓ All 3 answers are ready"
            : paused
              ? "Paused. Take your time."
              : `Inky is working · ${answered} of 3 answered`}
        </span>
        {answered < 3 ? (
          <button type="button" onClick={() => setPaused(!paused)}>
            {paused ? "Resume" : "Pause"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
