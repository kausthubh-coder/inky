// Dot and Chalky share one body. Every prop and effect for every state is drawn once and hidden;
// the character's data-state (see style.ts) decides what shows and how it moves.
// Moving parts sit inside pivot wrappers so squashes and swings happen from the right spot.

export type CharacterKind = "dot" | "chalky";

const INK = "#3b342c";
const BODY = "M60 15 C86 11 105 31 104 58 C103 88 87 107 60 106 C33 105 16 88 16 58 C16 31 34 19 60 15 Z";
const SKIN: Record<CharacterKind, string> = { dot: "#f7c948", chalky: "#b7a3dd" };
const S = `stroke="${INK}" stroke-linecap="round" stroke-linejoin="round"`;

let clipCount = 0;

const pivot = (x: number, y: number, cls: string, content: string) =>
  `<g transform="translate(${x} ${y})"><g class="${cls}"><g transform="translate(${-x} ${-y})">${content}</g></g></g>`;

const spark = (x: number, y: number, r: number, fill: string) =>
  `<path d="M${x} ${y - r}Q${x + 1} ${y - 1} ${x + r} ${y}Q${x + 1} ${y + 1} ${x} ${y + r}Q${x - 1} ${y + 1} ${x - r} ${y}Q${x - 1} ${y - 1} ${x} ${y - r}Z" fill="${fill}" ${S} stroke-width="1.8"/>`;

// Props, drawn with the hand at 0,0.
const TOOLS = {
  pen: `<rect x="-3" y="-16" width="6" height="20" rx="2" fill="#fffdf6" ${S} stroke-width="2.4"/><rect x="-3" y="-16" width="6" height="4" rx="1.2" fill="#f28b6f" ${S} stroke-width="2"/><path d="M-3 4 L3 4 L0 11 Z" fill="${INK}"/>`,
  pointer: `<path d="M0 5 L0 -36" stroke="#c99a6b" stroke-width="4.5" stroke-linecap="round"/><circle cx="0" cy="-38" r="3.6" fill="#f28b6f" ${S} stroke-width="2"/>`,
  glass: `<path d="M0 0 L-12 -14" stroke="#8a6a4a" stroke-width="5.5" stroke-linecap="round"/><circle cx="-22" cy="-27" r="14" fill="#fff" ${S} stroke-width="3.4"/><g class="big-eye"><ellipse cx="-21" cy="-26" rx="7" ry="9" fill="${INK}"/><circle cx="-18" cy="-30" r="2.6" fill="#fff"/></g><circle cx="-22" cy="-27" r="14" fill="#bfe0ff" opacity=".22"/><path d="M-32 -30 Q-30 -37 -23 -39" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  cursor: `<circle class="ripple" cx="11" cy="-25" r="9" fill="none" stroke="#f28b6f" stroke-width="2.5"/><path d="M11 -25 L11 -2 L5.5 -7.5 L2 1.5 L-2 -.5 L1.5 -9 L-6 -10 Z" fill="#fff" ${S} stroke-width="2.6"/>`,
  paper: `<rect x="-8" y="-34" width="24" height="30" rx="2.5" fill="#fffdf6" ${S} stroke-width="2.6"/><path d="M-3 -27 H11 M-3 -21 H11 M-3 -15 H6" stroke="#b3a99c" stroke-width="2" stroke-linecap="round"/><path d="M4 -11 L7 -7 L14 -15" fill="none" stroke="#5aa77a" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  card: `<rect x="-8" y="-32" width="28" height="24" rx="3" fill="#fffdf6" ${S} stroke-width="2.6"/><text x="6" y="-13" text-anchor="middle" font-family="Shantell Sans, cursive" font-weight="800" font-size="18" fill="#8a6fcf">?</text>`,
  star: `<path d="M0 -24 L3.5 -16 L12 -15 L5.5 -9.5 L7.5 -1 L0 -5.5 L-7.5 -1 L-5.5 -9.5 L-12 -15 L-3.5 -16 Z" fill="#f7c948" ${S} stroke-width="2.4"/>`,
};
const TOOL_LAYER = Object.entries(TOOLS).map(([name, svg]) => `<g class="tool ${name}">${svg}</g>`).join("");

const CONFETTI = ([["#f28b6f", -34, -26], ["#8fcbaa", 30, -30], ["#f7c948", -16, -42], ["#b7a3dd", 40, -12], ["#f2a8c4", -44, -6], ["#8ab8e8", 12, -46]] as const)
  .map(([color, dx, dy], i) => `<rect class="c" x="57" y="20" width="6" height="6" rx="${i % 2 ? 3 : 1}" fill="${color}" style="--dx:${dx}px;--dy:${dy}px"/>`)
  .join("");

const EFFECTS = `<g class="fx">
  <g class="think"><circle cx="86" cy="42" r="4.5" fill="#fff" ${S} stroke-width="2.4"/><path d="M94 30 C92 16 104 6 116 8 C128 10 136 20 132 32 C140 34 142 46 132 50 C128 60 112 60 104 52 C92 56 84 46 88 36 C90 34 92 33 94 30 Z" fill="#fff" ${S} stroke-width="2.6"/><text x="114" y="40" text-anchor="middle" font-family="Shantell Sans, cursive" font-weight="800" font-size="22" fill="${INK}">?</text></g>
  <g class="badge">${pivot(104, 22, "badge-anim", `<circle cx="104" cy="22" r="13" fill="#f7c948" ${S} stroke-width="3"/><path d="M104 15 V24" ${S} stroke-width="3.5"/><circle cx="104" cy="30" r="2" fill="${INK}"/>`)}</g>
  <g class="zzz">${[14, 17, 20].map((size) => `<text class="z" x="94" y="36" font-family="Shantell Sans, cursive" font-weight="800" font-size="${size}" fill="${INK}">z</text>`).join("")}</g>
  <g class="confetti">${CONFETTI}</g>
  <g class="speed"><path d="M2 58 H11" ${S} stroke-width="3"/><path d="M-1 70 H9" ${S} stroke-width="3"/><path d="M3 82 H11" ${S} stroke-width="3"/></g>
  <g class="found">${spark(100, 30, 7, "#f7c948")}${spark(110, 44, 4.5, "#fff")}</g>
  <g class="typing"><path d="M-16 34 Q-16 24 -4 24 H8 Q20 24 20 34 Q20 44 8 44 H-2 L-10 50 L-8 43 Q-16 41 -16 34 Z" fill="#fff" ${S} stroke-width="2.4"/><circle cx="-6" cy="34" r="2.3" fill="${INK}"/><circle cx="2" cy="34" r="2.3" fill="${INK}"/><circle cx="10" cy="34" r="2.3" fill="${INK}"/></g>
  <g class="bulb">${pivot(94, 10, "bulb-anim", `<g class="rays"><path d="M94 -12 V-17 M78 -5 L74 -9 M110 -5 L114 -9 M73 9 H68 M115 9 H120" stroke="#f7c948" stroke-width="3.5" stroke-linecap="round"/></g><path d="M94 -7 C103 -7 108 -1 108 5 C108 10 104 13 102 16 L102 19 H86 L86 16 C84 13 80 10 80 5 C80 -1 85 -7 94 -7 Z" fill="#fff2b5" ${S} stroke-width="2.8"/><rect x="87" y="19" width="14" height="7" rx="2" fill="#cfc4b4" ${S} stroke-width="2.4"/><path d="M90 12 Q94 5 98 12" fill="none" stroke="#f28b6f" stroke-width="2" stroke-linecap="round"/>`)}</g>
  <g class="shine">${spark(128, 22, 6, "#fff")}${spark(98, 20, 4.5, "#f7c948")}${spark(132, 46, 4, "#f7c948")}</g>
</g>`;

export function characterSvg(kind: CharacterKind): string {
  const dot = kind === "dot";
  const skin = SKIN[kind];
  const eye = (x: number) => `<ellipse class="pupil" cx="${x}" cy="56" rx="5" ry="7" fill="${INK}"/><circle class="glint" cx="${x + 2}" cy="53" r="1.8" fill="#fff"/>`;

  const armBack = pivot(101, 72, "arm-r", pivot(101, 72, "arm-anim", `<path class="limb" d="M101 76 Q106 80 106 86" fill="none" ${S} stroke-width="3.5"/>`));
  const armFront = pivot(101, 72, "arm-r", pivot(101, 72, "arm-anim", `${TOOL_LAYER}<circle class="hand" cx="106" cy="87" r="4.5" fill="${skin}" ${S} stroke-width="2.5"/>`));
  const armLeft = pivot(19, 72, "arm-l", pivot(19, 72, "arm-anim-l", `<path d="M19 70 Q7 64 6 50" fill="none" ${S} stroke-width="3.5"/><circle cx="6" cy="48" r="4.5" fill="${skin}" ${S} stroke-width="2.5"/>`));

  // Dot: sweatband, eyebrows and a swept tuft. Chalky: glasses, bow tie and a two-strand tuft.
  const hair = dot
    ? pivot(99, 40, "hair", `<path d="M99 38 Q106 33 114 32 M99 43 Q106 46 111 53" fill="none" ${S} stroke-width="3.2"/>`)
    : pivot(60, 15, "hair", `<path d="M60 15 Q50 4 41 10 M60 15 Q63 6 71 6" fill="none" ${S} stroke-width="3"/>`);
  const clip = `character-clip-${++clipCount}`;
  const band = dot
    ? `<clipPath id="${clip}"><path d="${BODY}"/></clipPath><g clip-path="url(#${clip})"><path d="M10 37 Q60 25 110 37 L110 47 Q60 35 10 47 Z" fill="#f28b6f" ${S} stroke-width="3"/></g><path d="${BODY}" fill="none" ${S} stroke-width="3.5"/>`
    : "";
  const brows = dot
    ? `<path class="brow-l" d="M39 47 Q45 44 51 47" fill="none" ${S} stroke-width="3.2"/><path class="brow-r" d="M69 47 Q75 44 81 47" fill="none" ${S} stroke-width="3.2"/>`
    : "";
  const tie = dot
    ? ""
    : `<path d="M60 95 L49 89 Q47 95 49 101 Z M60 95 L71 89 Q73 95 71 101 Z" fill="#f28b6f" ${S} stroke-width="2.5"/><circle cx="60" cy="95" r="3.2" fill="#f28b6f" ${S} stroke-width="2.5"/>`;
  const specs = dot
    ? ""
    : `<circle cx="45" cy="56" r="11" fill="#fff" ${S} stroke-width="3"/><circle cx="75" cy="56" r="11" fill="#fff" ${S} stroke-width="3"/><path d="M56 56 H64" ${S} stroke-width="3"/>`;
  const face = `<g class="face"><ellipse class="cheek" cx="33" cy="68" rx="6" ry="4" fill="#f2a8c4"/><ellipse class="cheek" cx="87" cy="68" rx="6" ry="4" fill="#f2a8c4"/>${specs}${pivot(60, 56, "blink", `<g class="look">${eye(45)}${eye(75)}</g>`)}${brows}<path class="lid" d="M38 57 Q45 51 52 57 M68 57 Q75 51 82 57" fill="none" ${S} stroke-width="3.5"/><path class="mouth" d="M52 73 Q60 80 68 73 Q60 80 52 73 Z" ${S} stroke-width="3"/></g>`;
  const body = `${armLeft}${armBack}<path d="${BODY}" fill="${skin}" ${S} stroke-width="3.5"/>${band}${hair}${tie}${face}${armFront}`;

  return `<svg viewBox="0 0 120 120" focusable="false" aria-hidden="true">${pivot(60, 111, "shadow", `<ellipse cx="60" cy="111" rx="26" ry="5" fill="${INK}" opacity=".1"/>`)}<g class="hop">${pivot(60, 106, "pop", pivot(60, 106, "body", body))}</g>${EFFECTS}</svg>`;
}
