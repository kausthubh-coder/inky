import { CHARACTER_CSS } from "../../shared/characters/style.js";

// Each state shows for at least DWELL_MS and the latest request wins, so fast agent flips don't twitch.
// On a change, every looping part blends from where it is into the next loop's first frame.
const DWELL_MS = 600;
const BLEND_MS = 250;
const LOOPING_PARTS = ".hop, .body, .hair, .face, .shadow, .arm-anim, .arm-anim-l, .badge-anim";
const SOFT = "cubic-bezier(.45, 0, .25, 1)";
const POP: Keyframe[] = [{ transform: "scale(1.07, .93)" }, { transform: "scale(.97, 1.03)", offset: 0.45 }, { transform: "none" }];

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const visible = new Set<HTMLElement>();
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const element = entry.target as HTMLElement;
    element.classList.toggle("is-offscreen", !entry.isIntersecting);
    if (entry.isIntersecting) visible.add(element);
    else visible.delete(element);
  }
});

let pointer: [number, number] | null = null;
let frame = 0;
// One listener moves the eyes of every visible character toward the pointer.
addEventListener("pointermove", (event) => {
  pointer = [event.clientX, event.clientY];
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    if (!pointer) return;
    for (const element of visible) {
      const box = element.getBoundingClientRect();
      const dx = pointer[0] - (box.left + box.width / 2);
      const dy = pointer[1] - (box.top + box.height * 0.45);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / 260);
      element.style.setProperty("--mx", ((dx / distance) * 3.2 * reach).toFixed(2));
      element.style.setProperty("--my", ((dy / distance) * 2.6 * reach).toFixed(2));
    }
  });
}, { passive: true });

let styled = false;
function installStyle() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.character = "";
  style.textContent = CHARACTER_CSS;
  document.head.append(style);
}

export class CharacterMotion {
  readonly #element: HTMLElement;
  #changedAt = performance.now();
  #pending: ReturnType<typeof setTimeout> | undefined;
  #settle: ReturnType<typeof setTimeout> | undefined;
  #blends: Animation[] = [];

  constructor(element: HTMLElement, state: string) {
    installStyle();
    this.#element = element;
    element.dataset.state = state;
    // Offset idle loops so characters on the same screen don't breathe in step.
    element.style.setProperty("--d", `${(-Math.random() * 3).toFixed(2)}s`);
    observer.observe(element);
  }

  request(state: string) {
    clearTimeout(this.#pending);
    if (state === this.#element.dataset.state) return;
    const wait = this.#changedAt + DWELL_MS - performance.now();
    if (wait > 0) this.#pending = setTimeout(() => this.#show(state), wait);
    else this.#show(state);
  }

  dispose() {
    clearTimeout(this.#pending);
    clearTimeout(this.#settle);
    observer.unobserve(this.#element);
    visible.delete(this.#element);
  }

  #show(state: string) {
    const element = this.#element;
    this.#changedAt = performance.now();
    if (reducedMotion.matches) {
      element.dataset.state = state;
      element.firstElementChild?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
      return;
    }
    const parts = [...element.querySelectorAll<SVGGElement>(LOOPING_PARTS)];
    const from = parts.map((part) => getComputedStyle(part).transform);
    for (const blend of this.#blends) blend.cancel();
    element.dataset.state = state;
    element.classList.add("is-blending");
    this.#blends = parts.flatMap((part, index) => {
      const to = getComputedStyle(part).transform;
      return from[index] === to ? [] : [part.animate([{ transform: from[index]! }, { transform: to }], { duration: BLEND_MS, easing: SOFT })];
    });
    element.querySelector(".pop")?.animate(POP, { duration: 450, easing: SOFT });
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => element.classList.remove("is-blending"), BLEND_MS);
  }
}
