import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Character } from "../../../../desktop/src/app/Character.js";

// The guided tour runs on the real screens (preview fixtures) with a practice class laid over them.
type Who = "dot" | "chalky";
type TourStep = {
  route: string;
  who: Who;
  title: string;
  body: string;
  /** What to point at. */
  target?: () => Element | null;
  /** Clicking this moves on. Without it, the bubble has a Next button. */
  advanceOn?: (element: Element) => boolean;
  /** Let the moving-on click reach the app too (it stays on the same screen). */
  pass?: boolean;
  state?: string;
};

const byText = (selector: string, text: string) => () => [...document.querySelectorAll(selector)].find(element => element.textContent?.trim().startsWith(text)) ?? null;
const within = (find: () => Element | null) => (element: Element) => { const target = find(); return !!target && target.contains(element); };
const practiceCard = () => [...document.querySelectorAll(".hw-card")].find(card => card.textContent?.includes(PRACTICE)) ?? null;
const practiceTest = () => [...document.querySelectorAll(".lr-row")].find(row => row.textContent?.includes("Practice quiz")) ?? null;
const PRACTICE = "Practice: sort five numbers";

const STEPS: TourStep[] = [
  { route: "week", who: "dot", state: "hello", title: "Let's try one together.", body: "I added a practice class, Studi 101, so nothing real gets touched. Click the practice homework.", target: practiceCard, advanceOn: within(practiceCard) },
  { route: "assignment", who: "dot", state: "idle", title: "This is an assignment.", body: "What it asks is on the right. I start when you press Start, never before.", target: () => byText(".ag-dock-card button", "Start")()?.closest("section") ?? null, advanceOn: within(byText(".ag-dock-card button", "Start")) },
  { route: "desk-working", who: "dot", state: "working", title: "I'm on it.", body: "Watch me work on the school page. Want the wheel? Press Take over any time.", target: () => document.querySelector(".ag-view") },
  { route: "desk-review", who: "dot", state: "review", title: "Done. Your turn to check.", body: "I flag anything I wasn't sure of. Mark both, then press Hand it in. That button is always yours.", target: () => document.querySelector(".ag-move"), advanceOn: element => !!element.closest(".ag-acts .rd-primary") },
  { route: "desk-submitted", who: "dot", state: "done", title: "Handed in!", body: "It was practice, so nothing was sent. For real homework, this is the school's own receipt.", target: () => document.querySelector(".ag-stamp") },
  { route: "week", who: "dot", state: "idle", title: "Ask me anything here.", body: "“What's due Friday?”, “Check my email for teachers”, or paste a homework link.", target: () => document.querySelector(".inky-composer") },
  { route: "week", who: "dot", state: "hello", title: "Now meet Chalky.", body: "Chalky helps you study for tests. Click Learn.", target: byText(".rd-mode-switch button", "Learn"), advanceOn: within(byText(".rd-mode-switch button", "Learn")) },
  { route: "learn", who: "chalky", state: "hello", title: "Hi! I'm Chalky.", body: "Every test Dot finds gets a plan here. Here's a practice one. Click it.", target: practiceTest, advanceOn: within(practiceTest) },
  { route: "tutor-choice", who: "chalky", state: "quiz", title: "Lessons are short.", body: "One idea at a time. Pick an answer.", target: () => document.querySelector(".tu-opts"), advanceOn: element => !!element.closest(".tu-opts button"), pass: true },
  { route: "tutor-choice", who: "chalky", state: "proud", title: "Right! You always press Submit.", body: "That's a lesson: I ask, you try, I explain. Ten minutes a day goes a long way.", target: () => document.querySelector(".tu-opts") },
];

const TEXT: [string | RegExp, string][] = [
  ["IBM Sorting Machine", PRACTICE], ["Bayes' theorem", "How Studi works"], ["ST 370 Midterm 1 in 6 days", "Studi 101 · Practice quiz"],
  ["P(A | B) means the chance of A...", "Who presses Submit on your homework?"], ["P(A | B) means the chance of A…", "Who presses Submit on your homework?"],
  ["when B already happened", "You do"], ["and B both happen", "Dot does"], ["or B, either one", "Chalky does"], ["Quick check first. Go with your gut.", "Practice question. Go with your gut."],
  ["Midterm 1", "Practice quiz"],
];
// Only next to the practice items.
const NEAR: [string | RegExp, string][] = [["CSC 316", "Studi 101"], ["ST 370", "Studi 101"], [/Overdue · ?/, ""], [/was due .*$/, "due Friday"], [/Due Mon, Sep 28, 7:59 PM/, "Due Friday"], ["Distributions", "How Studi works"]];

function practicify() {
  const walker = document.createTreeWalker(document.getElementById("root")!, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let text = node.nodeValue ?? "";
    for (const [from, to] of TEXT) text = text.replace(from, to);
    let parent: Element | null = node.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
      if (/Practice: sort|Practice quiz/.test(parent.textContent ?? "")) { for (const [from, to] of NEAR) text = text.replace(from, to); break; }
    }
    if (text !== node.nodeValue) node.nodeValue = text;
  }
}

type Box = { x: number; y: number; w: number; h: number };

export function Tour({ step: initial }: { step: number }) {
  const [step, setStep] = useState(initial);
  const [box, setBox] = useState<Box | null>(null);
  const [layer, setLayer] = useState<Element>(document.body);
  const current = step >= 0 && step < STEPS.length ? STEPS[step]! : null;
  const finale = step === STEPS.length;
  const previous = useRef(JSON.parse(sessionStorage.getItem("tour-guide") ?? "null") as { x: number; y: number; who: Who } | null);

  const go = (next: number) => {
    const route = next >= STEPS.length ? "week" : STEPS[next]?.route;
    if (next < 0) { sessionStorage.removeItem("tour-guide"); location.search = "?preview=week&tour=-1"; return; }
    if (route === STEPS[step]?.route) { setStep(next); history.replaceState(null, "", `?preview=${route}&tour=${next}`); return; }
    location.search = `?preview=${route}&tour=${next}`;
  };

  // Keep the practice names on screen while the app re-renders.
  useEffect(() => {
    if (step < 0) return;
    practicify();
    const observer = new MutationObserver(() => practicify());
    observer.observe(document.getElementById("root")!, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [step]);

  // Follow the target as the layout settles.
  useEffect(() => {
    if (!current?.target) { setBox(null); return; }
    setBox(null);
    const measure = () => {
      const top = document.querySelector("dialog[open]") ?? document.body;
      setLayer(old => old === top ? old : top);
      const element = current.target!();
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setBox(old => old && Math.abs(old.x - rect.left) + Math.abs(old.y - rect.top) + Math.abs(old.w - rect.width) + Math.abs(old.h - rect.height) < 1 ? old : { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    };
    measure();
    const timer = setInterval(measure, 200);
    return () => clearInterval(timer);
  }, [current]);

  // Clicks inside the spotlight reach the app; the right one moves the tour on. Clicks elsewhere are held.
  useEffect(() => {
    if (!current) return;
    const onClick = (event: MouseEvent) => {
      const element = event.target as Element;
      if (element.closest(".tour-guide")) return;
      if (current.advanceOn?.(element)) { if (!current.pass) { event.preventDefault(); event.stopPropagation(); } go(step + 1); return; }
      const inside = box && event.clientX >= box.x - 8 && event.clientX <= box.x + box.w + 8 && event.clientY >= box.y - 8 && event.clientY <= box.y + box.h + 8;
      if (!inside) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  });

  if (step < 0) return null;
  if (finale) return createPortal(<Finale onDone={() => go(-1)} />, layer);
  if (!current) return null;
  return createPortal(<>
    <div className={`tour-dim ${box ? "" : "is-full"}`} style={box ? { left: box.x - 8, top: box.y - 8, width: box.w + 16, height: box.h + 16 } : undefined} />
    {box && <div className={`tour-ring is-${current.who}`} style={{ left: box.x - 8, top: box.y - 8, width: box.w + 16, height: box.h + 16 }} />}
    {box && <Guide key={step} step={step} current={current} box={box} previous={previous.current} onNext={() => go(step + 1)} onSkip={() => go(-1)} />}
  </>, layer);
}

function Guide({ step, current, box, previous, onNext, onSkip }: { step: number; current: TourStep; box: Box; previous: { x: number; y: number; who: Who } | null; onNext: () => void; onSkip: () => void }) {
  const width = 330, height = 170, gap = 22;
  const room = { right: innerWidth - (box.x + box.w), left: box.x, below: innerHeight - (box.y + box.h), above: box.y };
  const side = room.right > width + 110 ? "right" : room.left > width + 110 ? "left" : room.below > height + 40 ? "below" : "above";
  const clampY = (y: number) => Math.max(16, Math.min(innerHeight - height - 16, y));
  const clampX = (x: number) => Math.max(16, Math.min(innerWidth - width - 100, x));
  const at = side === "right" ? { x: box.x + box.w + gap, y: clampY(box.y + box.h / 2 - height / 2) }
    : side === "left" ? { x: box.x - gap - width - 84, y: clampY(box.y + box.h / 2 - height / 2) }
    : side === "below" ? { x: clampX(box.x + box.w / 2 - width / 2), y: box.y + box.h + gap }
    : { x: clampX(box.x + box.w / 2 - width / 2), y: box.y - gap - height };
  const swapping = previous && previous.who !== current.who;
  const [pos, setPos] = useState(previous && !swapping ? { x: previous.x, y: previous.y } : at);
  const [hop, setHop] = useState(false);
  const [leaving, setLeaving] = useState<Who | null>(swapping ? previous.who : null);
  useLayoutEffect(() => {
    sessionStorage.setItem("tour-guide", JSON.stringify({ ...at, who: current.who }));
    if (pos.x === at.x && pos.y === at.y) return;
    const frame = requestAnimationFrame(() => { setHop(true); setPos(at); });
    const timer = setTimeout(() => setHop(false), 700);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [at.x, at.y]);
  useEffect(() => { if (!leaving) return; const timer = setTimeout(() => setLeaving(null), 650); return () => clearTimeout(timer); }, [leaving]);
  const faceLeft = side === "left";
  return (
    <div className={`tour-guide side-${side} ${faceLeft ? "is-flipped" : ""}`} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <div className={`tour-who ${hop ? "is-hopping" : ""}`}>
        {leaving && <span className="tour-leaving"><Character kind={leaving as "dot"} state="hello" size={70} label="" /></span>}
        <span className={leaving ? "tour-arriving" : ""}>
          {current.who === "dot" ? <Character state={current.state as never} size={70} label="Dot" /> : <Character kind="chalky" state={current.state as never} size={70} label="Chalky" />}
        </span>
      </div>
      <article className={`tour-bubble is-${current.who}`}>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <footer>
          <button className="ob-quiet" onClick={onSkip}>Skip tour</button>
          <span>{step + 1} of {STEPS.length}</span>
          {!current.advanceOn && <button className={`fable-button primary ${current.who === "chalky" ? "is-chalky" : ""}`} onClick={onNext}>Next</button>}
        </footer>
      </article>
    </div>
  );
}

function Finale({ onDone }: { onDone: () => void }) {
  // The tour can start while the school check is still running.
  const [scanning] = useState(() => sessionStorage.getItem("tour-scanning") === "1");
  useEffect(() => { sessionStorage.removeItem("tour-guide"); sessionStorage.removeItem("tour-scanning"); }, []);
  return <>
    <div className="tour-dim is-full" />
    <div className="tour-finale">
      <div className="tour-pair"><Character state={scanning ? "scanning" : "done"} size={120} label="Dot" /><Character kind="chalky" state="proud" size={110} label="Chalky" /></div>
      <article className="fable-speech"><span className="fable-tail" aria-hidden="true" /><h1>That's the tour!</h1><p>{scanning
        ? "I've put the practice class away. I'm still reading your school, and your week fills in as I go. I'll tell you when it's done."
        : "I've put the practice class away. Your real week is ready, and Chalky has plans for all your tests."}</p></article>
      <div className="fable-replies"><button className="fable-button primary" onClick={onDone}>Let's go</button></div>
      <p className="ob-hint">You can take the tour again from Settings, under Help.</p>
    </div>
  </>;
}
