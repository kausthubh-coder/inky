// Dot and Chalky, from .agent/plans/characters-and-icon.html (the characters plan).

const INK = "#3b342c";
const BODY = "M60 15 C86 11 105 31 104 58 C103 88 87 107 60 106 C33 105 16 88 16 58 C16 31 34 19 60 15 Z";
const SKIN = { dot: "#f7c948", chalky: "#b7a3dd" };
const MOVES = {
  dot: [["idle", "hanging out"], ["hello", "hi!"], ["scanning", "finding homework"], ["steering", "in your school site"], ["working", "doing the work"], ["needs", "needs you"], ["review", "check this?"], ["done", "done!"], ["sleep", "sleeping"]],
  chalky: [["idle", "hanging out"], ["hello", "hi!"], ["explaining", "explaining"], ["listening", "listening to you"], ["thinking", "thinking"], ["hint", "here's a hint"], ["quiz", "your turn"], ["proud", "you got it!"], ["sleep", "sleeping"]],
};
const S = `stroke="${INK}" stroke-linecap="round" stroke-linejoin="round"`;
const piv = (x, y, cls, c) => `<g transform="translate(${x} ${y})"><g class="${cls}"><g transform="translate(${-x} ${-y})">${c}</g></g></g>`;
const spark = (x, y, r, fill) => `<path d="M${x} ${y - r}Q${x + 1} ${y - 1} ${x + r} ${y}Q${x + 1} ${y + 1} ${x} ${y + r}Q${x - 1} ${y + 1} ${x - r} ${y}Q${x - 1} ${y - 1} ${x} ${y - r}Z" fill="${fill}" ${S} stroke-width="1.8"/>`;

function blob(kind) {
  const chalky = kind === "chalky", dot = kind === "dot", skin = SKIN[kind];
  const eye = x => `<ellipse class="pupil" cx="${x}" cy="56" rx="5" ry="7" fill="${INK}"/><circle class="glint" cx="${x + 2}" cy="53" r="1.8" fill="#fff"/>`;

  // props, drawn with the hand at 0,0
  const tools = {
    pen: `<rect x="-3" y="-16" width="6" height="20" rx="2" fill="#fffdf6" ${S} stroke-width="2.4"/><rect x="-3" y="-16" width="6" height="4" rx="1.2" fill="#f28b6f" ${S} stroke-width="2"/><path d="M-3 4 L3 4 L0 11 Z" fill="${INK}"/>`,
    pointer: `<path d="M0 5 L0 -36" stroke="#c99a6b" stroke-width="4.5" stroke-linecap="round"/><circle cx="0" cy="-38" r="3.6" fill="#f28b6f" ${S} stroke-width="2"/>`,
    glass: `<path d="M0 0 L-12 -14" stroke="#8a6a4a" stroke-width="5.5" stroke-linecap="round"/><circle cx="-22" cy="-27" r="14" fill="#fff" ${S} stroke-width="3.4"/><g class="big-eye"><ellipse cx="-21" cy="-26" rx="7" ry="9" fill="${INK}"/><circle cx="-18" cy="-30" r="2.6" fill="#fff"/></g><circle cx="-22" cy="-27" r="14" fill="#bfe0ff" opacity=".22"/><path d="M-32 -30 Q-30 -37 -23 -39" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    cursor: `<circle class="ripple" cx="11" cy="-25" r="9" fill="none" stroke="#f28b6f" stroke-width="2.5"/><path d="M11 -25 L11 -2 L5.5 -7.5 L2 1.5 L-2 -.5 L1.5 -9 L-6 -10 Z" fill="#fff" ${S} stroke-width="2.6"/>`,
    paper: `<rect x="-8" y="-34" width="24" height="30" rx="2.5" fill="#fffdf6" ${S} stroke-width="2.6"/><path d="M-3 -27 H11 M-3 -21 H11 M-3 -15 H6" stroke="#b3a99c" stroke-width="2" stroke-linecap="round"/><path d="M4 -11 L7 -7 L14 -15" fill="none" stroke="#5aa77a" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
    card: `<rect x="-8" y="-32" width="28" height="24" rx="3" fill="#fffdf6" ${S} stroke-width="2.6"/><text x="6" y="-13" text-anchor="middle" font-family="Shantell Sans, cursive" font-weight="800" font-size="18" fill="#8a6fcf">?</text>`,
    star: `<path d="M0 -24 L3.5 -16 L12 -15 L5.5 -9.5 L7.5 -1 L0 -5.5 L-7.5 -1 L-5.5 -9.5 L-12 -15 L-3.5 -16 Z" fill="#f7c948" ${S} stroke-width="2.4"/>`,
  };
  const toolLayer = Object.entries(tools).map(([k, v]) => `<g class="tool ${k}">${v}</g>`).join("");
  const armBack = piv(101, 72, "arm-r", piv(101, 72, "arm-anim", `<path class="limb" d="M101 76 Q106 80 106 86" fill="none" ${S} stroke-width="3.5"/>`));
  const armFront = piv(101, 72, "arm-r", piv(101, 72, "arm-anim", `${toolLayer}<circle class="hand" cx="106" cy="87" r="4.5" fill="${skin}" ${S} stroke-width="2.5"/>`));
  const armL = piv(19, 72, "arm-l", piv(19, 72, "arm-anim-l", `<path d="M19 70 Q7 64 6 50" fill="none" ${S} stroke-width="3.5"/><circle cx="6" cy="48" r="4.5" fill="${skin}" ${S} stroke-width="2.5"/>`));

  const hair = dot
    ? piv(99, 40, "hair", `<path d="M99 38 Q106 33 114 32 M99 43 Q106 46 111 53" fill="none" ${S} stroke-width="3.2"/>`)
    : piv(60, 15, "hair", `<path d="M60 15 Q50 4 41 10 M60 15 Q63 6 71 6" fill="none" ${S} stroke-width="3"/>`);
  const clip = "b" + Math.random().toString(36).slice(2, 8);
  const band = dot ? `<clipPath id="${clip}"><path d="${BODY}"/></clipPath><g clip-path="url(#${clip})"><path d="M10 37 Q60 25 110 37 L110 47 Q60 35 10 47 Z" fill="#f28b6f" ${S} stroke-width="3"/></g><path d="${BODY}" fill="none" ${S} stroke-width="3.5"/>` : "";
  const brows = dot ? `<path class="brow-l" d="M39 47 Q45 44 51 47" fill="none" ${S} stroke-width="3.2"/><path class="brow-r" d="M69 47 Q75 44 81 47" fill="none" ${S} stroke-width="3.2"/>` : "";
  const tie = chalky ? `<path d="M60 95 L49 89 Q47 95 49 101 Z M60 95 L71 89 Q73 95 71 101 Z" fill="#f28b6f" ${S} stroke-width="2.5"/><circle cx="60" cy="95" r="3.2" fill="#f28b6f" ${S} stroke-width="2.5"/>` : "";
  const specs = chalky ? `<circle cx="45" cy="56" r="11" fill="#fff" ${S} stroke-width="3"/><circle cx="75" cy="56" r="11" fill="#fff" ${S} stroke-width="3"/><path d="M56 56 H64" ${S} stroke-width="3"/>` : "";
  const face = `<g class="face"><ellipse class="cheek" cx="33" cy="68" rx="6" ry="4" fill="#f2a8c4"/><ellipse class="cheek" cx="87" cy="68" rx="6" ry="4" fill="#f2a8c4"/>${specs}${piv(60, 56, "blink", `<g class="look">${eye(45)}${eye(75)}</g>`)}${brows}<path class="lid" d="M38 57 Q45 51 52 57 M68 57 Q75 51 82 57" fill="none" ${S} stroke-width="3.5"/><path class="mouth" d="M52 73 Q60 80 68 73 Q60 80 52 73 Z" ${S} stroke-width="3"/></g>`;
  const body = `${armL}${armBack}<path d="${BODY}" fill="${skin}" ${S} stroke-width="3.5"/>${band}${hair}${tie}${face}${armFront}`;

  const confetti = [["#f28b6f", -34, -26], ["#8fcbaa", 30, -30], ["#f7c948", -16, -42], ["#b7a3dd", 40, -12], ["#f2a8c4", -44, -6], ["#8ab8e8", 12, -46]]
    .map(([c, dx, dy], i) => `<rect class="c" x="57" y="20" width="6" height="6" rx="${i % 2 ? 3 : 1}" fill="${c}" style="--dx:${dx}px;--dy:${dy}px"/>`).join("");
  const fx = `<g class="fx">
    <g class="think"><circle cx="86" cy="42" r="4.5" fill="#fff" ${S} stroke-width="2.4"/><path d="M94 30 C92 16 104 6 116 8 C128 10 136 20 132 32 C140 34 142 46 132 50 C128 60 112 60 104 52 C92 56 84 46 88 36 C90 34 92 33 94 30 Z" fill="#fff" ${S} stroke-width="2.6"/><text x="114" y="40" text-anchor="middle" font-family="Shantell Sans, cursive" font-weight="800" font-size="22" fill="${INK}">?</text></g>
    <g class="badge">${piv(104, 22, "badge-anim", `<circle cx="104" cy="22" r="13" fill="#f7c948" ${S} stroke-width="3"/><path d="M104 15 V24" ${S} stroke-width="3.5"/><circle cx="104" cy="30" r="2" fill="${INK}"/>`)}</g>
    <g class="zzz">${[14, 17, 20].map(s => `<text class="z" x="94" y="36" font-family="Shantell Sans, cursive" font-weight="800" font-size="${s}" fill="${INK}">z</text>`).join("")}</g>
    <g class="confetti">${confetti}</g>
    <g class="speed"><path d="M2 58 H11" ${S} stroke-width="3"/><path d="M-1 70 H9" ${S} stroke-width="3"/><path d="M3 82 H11" ${S} stroke-width="3"/></g>
    <g class="found">${spark(100, 30, 7, "#f7c948")}${spark(110, 44, 4.5, "#fff")}</g>
    <g class="typing"><path d="M-16 34 Q-16 24 -4 24 H8 Q20 24 20 34 Q20 44 8 44 H-2 L-10 50 L-8 43 Q-16 41 -16 34 Z" fill="#fff" ${S} stroke-width="2.4"/><circle cx="-6" cy="34" r="2.3" fill="${INK}"/><circle cx="2" cy="34" r="2.3" fill="${INK}"/><circle cx="10" cy="34" r="2.3" fill="${INK}"/></g>
    <g class="bulb">${piv(94, 10, "bulb-anim", `<g class="rays"><path d="M94 -12 V-17 M78 -5 L74 -9 M110 -5 L114 -9 M73 9 H68 M115 9 H120" stroke="#f7c948" stroke-width="3.5" stroke-linecap="round"/></g><path d="M94 -7 C103 -7 108 -1 108 5 C108 10 104 13 102 16 L102 19 H86 L86 16 C84 13 80 10 80 5 C80 -1 85 -7 94 -7 Z" fill="#fff2b5" ${S} stroke-width="2.8"/><rect x="87" y="19" width="14" height="7" rx="2" fill="#cfc4b4" ${S} stroke-width="2.4"/><path d="M90 12 Q94 5 98 12" fill="none" stroke="#f28b6f" stroke-width="2" stroke-linecap="round"/>`)}</g>
    <g class="shine">${spark(128, 22, 6, "#fff")}${spark(98, 20, 4.5, "#f7c948")}${spark(132, 46, 4, "#f7c948")}</g>
  </g>`;
  return `<svg viewBox="0 0 120 120" aria-hidden="true">${piv(60, 111, "shadow", `<ellipse cx="60" cy="111" rx="26" ry="5" fill="${INK}" opacity=".1"/>`)}<g class="hop">${piv(60, 106, "pop", piv(60, 106, "body", body))}</g>${fx}</svg>`;
}

function mascot(kind, state, extraClass = "") {
  const el = document.createElement("span");
  el.className = `ink2 ${kind} ${extraClass}`;
  el.dataset.state = state;
  el.style.setProperty("--d", `${-Math.random() * 3}s`);
  el.innerHTML = blob(kind);
  return el;
}
function setState(el, state) {
  if (el.dataset.state === state) return;
  el.dataset.state = state;
  const pop = el.querySelector(".pop");
  pop.classList.remove("bump"); void pop.getBBox(); pop.classList.add("bump");
}


const DOT_MOVES = [["idle", "hanging out"], ["hello", "hi!"], ["thinking", "thinking"], ["scanning", "finding homework"], ["steering", "in your school site"], ["working", "doing the work"], ["waiting", "your turn"], ["needs", "needs you"], ["review", "check this?"], ["done", "done!"], ["sleep", "sleeping"]];
MOVES.dot = DOT_MOVES;
// eyes follow the cursor
let raf = 0, mouse = null;
addEventListener("pointermove", e => {
  mouse = [e.clientX, e.clientY];
  raf ||= requestAnimationFrame(() => {
    raf = 0;
    for (const el of document.querySelectorAll(".ink2")) {
      const r = el.getBoundingClientRect();
      const dx = mouse[0] - (r.left + r.width / 2), dy = mouse[1] - (r.top + r.height * .45);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      el.style.setProperty("--mx", (dx / d * 3.2 * k).toFixed(2));
      el.style.setProperty("--my", (dy / d * 2.6 * k).toFixed(2));
    }
  });
});

const IK = "#1c1612";
const STUDI_ICON = `<rect x="6" y="6" width="116" height="116" rx="30" fill="#f7c948" stroke="${IK}" stroke-width="6"/><text x="64" y="90" text-anchor="middle" font-family="Shantell Sans" font-weight="800" font-size="76" fill="${IK}">S</text>`;
window.Characters = { mascot, setState, STUDI_ICON };
