import "./tour.css";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Character } from "../Character.js";
import type { ChalkyState, DotState } from "../../../shared/characters/states.js";
import type { AppScreen } from "../Ui.js";
import { PRACTICE } from "./practice.js";

type Who = "dot" | "chalky";
type Step = {
  who: Who;
  state: DotState | ChalkyState;
  title: string;
  body: string;
  /** What to point at. */
  target: () => Element | null;
  /** A click here moves the tour on. The click still reaches the app, which does the real thing. */
  advance?: (clicked: Element) => boolean;
  /** Moves on by itself once this is true. */
  until?: () => boolean;
  /** Speak from inside this area (Chalky's own panel in a lesson) rather than beside the target. */
  dock?: () => Element | null;
  /** Runs when the step opens. */
  enter?: (go: { screen: (next: AppScreen) => void }) => void;
};

const button = (pattern: RegExp) => [...document.querySelectorAll("button")].find(item => pattern.test(item.textContent?.trim() ?? "")) ?? null;
const inside = (find: () => Element | null) => (clicked: Element) => { const target = find(); return !!target && target.contains(clicked); };
const practiceCard = () => [...document.querySelectorAll(".hw-card")].find(card => card.textContent?.includes(PRACTICE.title)) ?? null;
const startButton = () => button(/^Start( now)?$/);
const handIn = () => button(/^Hand it in$/);
const quizRow = () => [...document.querySelectorAll(".lr-row")].find(row => row.textContent?.includes(PRACTICE.quiz)) ?? null;
const quizStart = () => [...(quizRow()?.parentElement?.querySelectorAll(".lr-detail button.rd-button") ?? [])].find(item => /^Start/.test(item.textContent?.trim() ?? "")) ?? null;

const STEPS: Step[] = [
  { who: "dot", state: "hello", title: "Let's try one together.", body: "I added a practice class, Studi 101, so nothing real gets touched. Open the practice homework.", target: practiceCard, advance: inside(practiceCard) },
  { who: "dot", state: "idle", title: "This is an assignment.", body: "What it asks is on the right. I start when you press Start, never before.", target: () => startButton()?.closest(".ag-move") ?? startButton(), advance: inside(startButton) },
  { who: "dot", state: "working", title: "I'm on it.", body: "You can watch me on the school page. Want the wheel? Press Take over any time. Give me a few seconds.", target: () => document.querySelector(".ag-view"), until: () => !!handIn() },
  { who: "dot", state: "review", title: "Done. Your turn to check.", body: "I flag anything I wasn't sure of. Mark it, then press Hand it in. That button is always yours.", target: () => handIn()?.closest(".ag-move") ?? null, advance: inside(handIn) },
  { who: "dot", state: "done", title: "Handed in!", body: "It was practice, so nothing was sent. For real homework, this is the school's own receipt.", target: () => document.querySelector(".ag-stamp") },
  { who: "dot", state: "idle", title: "Ask me anything here.", body: "“What's due Friday?”, “Check my email for anything from my teachers”, or paste a homework link.", target: () => document.querySelector(".inky-composer"), enter: go => go.screen("week") },
  { who: "dot", state: "hello", title: "Now meet Chalky.", body: "Chalky helps you study for tests. Open Learn.", target: () => button(/^Learn$/), advance: inside(() => button(/^Learn$/)) },
  { who: "chalky", state: "hello", title: "Hi! I'm Chalky.", body: "Every test Dot finds gets a plan here. Here's a practice one. Open it.", target: quizRow, advance: inside(quizRow) },
  { who: "chalky", state: "explaining", title: "First, a quick check.", body: "A few questions so I don't teach you what you already know. Start it.", target: quizStart, advance: inside(quizStart) },
  { who: "chalky", state: "quiz", title: "Lessons are short.", body: "One idea at a time. Pick an answer, then press Check.", target: () => document.querySelector(".tu-opts")?.closest(".tu-col") ?? document.querySelector(".tu-opts"), advance: inside(() => button(/^Check$/)), dock: () => document.querySelector(".tu-side") },
  { who: "chalky", state: "proud", title: "That's a lesson.", body: "I ask, you try, I explain. Ask me anything on the left while you work.", target: () => document.querySelector(".tu-col"), dock: () => document.querySelector(".tu-side") },
];

type Box = { x: number; y: number; w: number; h: number };
type Spot = { x: number; y: number; who: Who };

export function Tour({ onScreen, onDone }: { onScreen: (next: AppScreen) => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [layer, setLayer] = useState<Element>(document.body);
  const last = useRef<Spot | null>(null);
  const current = STEPS[step];
  const next = () => setStep(value => value + 1);

  const screen = useRef(onScreen);
  screen.current = onScreen;
  useEffect(() => { current?.enter?.({ screen: next => screen.current(next) }); }, [current]);

  // Follow the target as screens open and settle; a modal dialog sits in the top layer, so the tour joins it.
  useEffect(() => {
    if (!current) return undefined;
    setBox(null);
    const measure = () => {
      const top = document.querySelector("dialog[open]") ?? document.body;
      setLayer(old => old === top ? old : top);
      if (current.until?.()) { next(); return; }
      const rect = current.target()?.getBoundingClientRect();
      if (!rect || rect.width < 1) return;
      setBox(old => old && Math.abs(old.x - rect.left) + Math.abs(old.y - rect.top) + Math.abs(old.w - rect.width) + Math.abs(old.h - rect.height) < 1 ? old : { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    };
    measure();
    const timer = window.setInterval(measure, 200);
    return () => window.clearInterval(timer);
  }, [current]);

  // Clicks inside the spotlight reach the app. The right one moves on; clicks elsewhere are held so the tour can't get lost.
  useEffect(() => {
    if (!current) return undefined;
    const onClick = (event: MouseEvent) => {
      const clicked = event.target as Element;
      if (clicked.closest(".tour-guide, .tour-finale")) return;
      if (current.advance?.(clicked)) { window.setTimeout(next, 0); return; }
      const inSpot = box && event.clientX >= box.x - 8 && event.clientX <= box.x + box.w + 8 && event.clientY >= box.y - 8 && event.clientY <= box.y + box.h + 8;
      if (!inSpot) { event.preventDefault(); event.stopPropagation(); }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onDone(); } };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey, true); };
  }, [current, box, onDone]);

  if (!current) return createPortal(<Finale onDone={onDone} />, layer);
  return createPortal(<>
    <div className={`tour-dim ${box ? "" : "is-full"}`} style={box ? { left: box.x - 8, top: box.y - 8, width: box.w + 16, height: box.h + 16 } : undefined} />
    {box && <div className={`tour-ring is-${current.who}`} style={{ left: box.x - 8, top: box.y - 8, width: box.w + 16, height: box.h + 16 }} />}
    {box && <Guide key={step} step={step} current={current} box={box} last={last} onNext={current.advance || current.until ? null : next} onSkip={onDone} />}
  </>, layer);
}

function Guide({ step, current, box, last, onNext, onSkip }: { step: number; current: Step; box: Box; last: MutableRefObject<Spot | null>; onNext: (() => void) | null; onSkip: () => void }) {
  const dock = current.dock?.()?.getBoundingClientRect();
  const width = dock ? Math.min(330, dock.width - 16) : 330, height = 180, gap = 22;
  const room = { right: innerWidth - (box.x + box.w), left: box.x, below: innerHeight - (box.y + box.h) };
  const side = room.right > width + 110 ? "right" : room.left > width + 110 ? "left" : room.below > height + 40 ? "below" : "above";
  const clampY = (y: number) => Math.max(16, Math.min(innerHeight - height - 16, y));
  const clampX = (x: number) => Math.max(16, Math.min(innerWidth - width - 100, x));
  const at = dock ? { x: dock.x + 8, y: Math.max(16, Math.min(innerHeight - height - 16, dock.y + 130)) }
    : side === "right" ? { x: box.x + box.w + gap, y: clampY(box.y + box.h / 2 - height / 2) }
    : side === "left" ? { x: box.x - gap - width - 84, y: clampY(box.y + box.h / 2 - height / 2) }
    : side === "below" ? { x: clampX(box.x + box.w / 2 - width / 2), y: Math.min(innerHeight - height - 16, box.y + box.h + gap) }
    : { x: clampX(box.x + box.w / 2 - width / 2), y: Math.max(16, box.y - gap - height) };
  const previous = last.current;
  const swapping = previous && previous.who !== current.who;
  const [pos, setPos] = useState(previous && !swapping ? { x: previous.x, y: previous.y } : at);
  const [hop, setHop] = useState(false);
  const [leaving, setLeaving] = useState<Who | null>(swapping ? previous.who : null);
  useLayoutEffect(() => {
    last.current = { ...at, who: current.who };
    if (pos.x === at.x && pos.y === at.y) return undefined;
    const frame = requestAnimationFrame(() => { setHop(true); setPos(at); });
    const timer = window.setTimeout(() => setHop(false), 700);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [at.x, at.y]);
  useEffect(() => { if (!leaving) return undefined; const timer = window.setTimeout(() => setLeaving(null), 650); return () => window.clearTimeout(timer); }, [leaving]);
  return (
    <div className={`tour-guide side-${side} ${side === "left" ? "is-flipped" : ""}`} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} role="dialog" aria-label="Tour" aria-describedby="tour-body">
      {!dock && <div className={`tour-who ${hop ? "is-hopping" : ""}`} aria-hidden="true">
        {leaving && <span className="tour-leaving"><Character state="hello" size={70} /></span>}
        <span className={leaving ? "tour-arriving" : ""}>{current.who === "dot" ? <Character state={current.state as DotState} size={70} /> : <Character kind="chalky" state={current.state as ChalkyState} size={70} />}</span>
      </div>}
      <article className={`tour-bubble is-${current.who} ${dock ? "is-docked" : ""}`} style={dock ? { width } : undefined}>
        <h2>{current.title}</h2>
        <p id="tour-body">{current.body}</p>
        <footer>
          <button className="tour-skip" onClick={onSkip}>Skip tour</button>
          <span>{step + 1} of {STEPS.length}</span>
          {onNext && <button className={`fable-button primary ${current.who === "chalky" ? "is-chalky" : ""}`} onClick={onNext} autoFocus>Next</button>}
        </footer>
      </article>
    </div>
  );
}

function Finale({ onDone }: { onDone: () => void }) {
  return <>
    <div className="tour-dim is-full" />
    <div className="tour-finale" role="dialog" aria-label="Tour finished">
      <div className="tour-pair" aria-hidden="true"><Character state="done" size={120} /><Character kind="chalky" state="proud" size={110} /></div>
      <article className="fable-speech"><span className="fable-tail" aria-hidden="true" /><h1>That's the tour!</h1><p>I've put the practice class away. Ask either of us anything, and take the tour again any time from Settings, under Help.</p></article>
      <div className="fable-replies"><button className="fable-button primary" onClick={onDone} autoFocus>Let's go</button></div>
    </div>
  </>;
}
