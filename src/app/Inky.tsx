import { memo, type ReactNode } from "react";

export type InkyState = "idle" | "hello" | "working" | "thinking" | "scanning" | "needs" | "waiting" | "sleep" | "done";

const ATTACHED = new Set<InkyState>(["hello", "working", "scanning"]);

export const Inky = memo(function Inky({
  state = "idle",
  size = 96,
  label,
}: {
  state?: InkyState;
  size?: number;
  label?: string;
}) {
  const extra = extraFor(state);
  return (
    <span
      className="inky-mascot"
      data-state={state}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 120 120" focusable="false" overflow="visible" aria-hidden="true">
        <ellipse cx="60" cy="111" rx="26" ry="5" fill="#3b342c" opacity="0.1" />
        <g className="body">
          <path
            d="M60 15 C86 11 105 31 104 58 C103 88 87 107 60 106 C33 105 16 88 16 58 C16 31 34 19 60 15 Z"
            fill="#8ab8e8"
            stroke="#3b342c"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path className="hair" d="M60 15 Q57 5 66 3" stroke="#3b342c" strokeWidth="3" fill="none" strokeLinecap="round" />
          {faceFor(state)}
          {ATTACHED.has(state) ? extra : null}
        </g>
        {ATTACHED.has(state) ? null : extra}
      </svg>
    </span>
  );
});

function BlinkEyes({
  leftY = 56,
  rightY = 56,
  rx = 5,
  ry = 7,
  highlight = 1.8,
}: {
  leftY?: number;
  rightY?: number;
  rx?: number;
  ry?: number;
  highlight?: number;
}) {
  return (
    <g className="eyes blink">
      <ellipse cx="45" cy={leftY} rx={rx} ry={ry} fill="#3b342c" />
      <ellipse cx="75" cy={rightY} rx={rx} ry={ry} fill="#3b342c" />
      <circle cx="47" cy={leftY - 3} r={highlight} fill="#fff" />
      <circle cx="77" cy={rightY - 3} r={highlight} fill="#fff" />
    </g>
  );
}

function faceFor(state: InkyState): ReactNode {
  switch (state) {
    case "hello":
    case "done":
      return (
        <>
          <BlinkEyes />
          <path className="mouth" d="M48 72 Q60 86 72 72" stroke="#3b342c" strokeWidth="3" fill="#fff" strokeLinecap="round" />
          <ellipse cx="33" cy="66" rx="6" ry="4" fill="#f2a8c4" opacity="0.8" />
          <ellipse cx="87" cy="66" rx="6" ry="4" fill="#f2a8c4" opacity="0.8" />
        </>
      );
    case "working":
      return (
        <>
          <circle cx="45" cy="56" r="11" fill="#fff" stroke="#3b342c" strokeWidth="3" />
          <circle cx="75" cy="56" r="11" fill="#fff" stroke="#3b342c" strokeWidth="3" />
          <line x1="56" y1="56" x2="64" y2="56" stroke="#3b342c" strokeWidth="3" />
          <circle cx="45" cy="56" r="3.5" fill="#3b342c" />
          <circle cx="75" cy="56" r="3.5" fill="#3b342c" />
          <path className="mouth" d="M53 76 Q60 80 67 76" stroke="#3b342c" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      );
    case "thinking":
      return (
        <>
          <BlinkEyes leftY={58} rightY={54} ry={6} highlight={1.6} />
          <path className="mouth" d="M54 76 Q60 74 66 78" stroke="#3b342c" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      );
    case "scanning":
      return (
        <>
          <BlinkEyes rx={4.5} ry={6} highlight={1.5} />
          <path className="mouth" d="M54 74 Q60 78 66 74" stroke="#3b342c" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      );
    case "needs":
      return (
        <>
          <ellipse cx="45" cy="56" rx="6" ry="8" fill="#3b342c" />
          <ellipse cx="75" cy="56" rx="6" ry="8" fill="#3b342c" />
          <circle cx="47" cy="53" r="2" fill="#fff" />
          <circle cx="77" cy="53" r="2" fill="#fff" />
          <ellipse className="mouth" cx="60" cy="77" rx="6" ry="8" fill="#3b342c" />
        </>
      );
    case "waiting":
    case "sleep":
      return (
        <>
          <path d="M38 56 Q45 50 52 56 M68 56 Q75 50 82 56" stroke="#3b342c" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path
            className="mouth"
            d={state === "sleep" ? "M54 76 Q60 78 66 76" : "M52 76 Q60 80 68 76"}
            stroke="#3b342c"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </>
      );
    default:
      return (
        <>
          <BlinkEyes />
          <path className="mouth" d="M52 73 Q60 80 68 73" stroke="#3b342c" strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse cx="33" cy="68" rx="6" ry="4" fill="#f2a8c4" opacity="0.7" />
          <ellipse cx="87" cy="68" rx="6" ry="4" fill="#f2a8c4" opacity="0.7" />
        </>
      );
  }
}

function extraFor(state: InkyState): ReactNode {
  switch (state) {
    case "hello":
      return (
        <g className="extra wave">
          <path
            d="M28 70 C20 66 16 56 16 48 C16 42 22 40 26 44 C29 48 32 58 32 66 C32 69 30 71 28 70 Z"
            fill="#8ab8e8"
            stroke="#3b342c"
            strokeWidth="3.2"
            strokeLinejoin="round"
          />
          <g className="paw">
            <ellipse cx="14" cy="36" rx="12" ry="11" fill="#8ab8e8" stroke="#3b342c" strokeWidth="3.2" />
            <ellipse cx="14" cy="39" rx="5.2" ry="4" fill="#f2a8c4" opacity="0.8" />
            <ellipse cx="7.5" cy="32" rx="2.1" ry="2.5" fill="#f2a8c4" opacity="0.88" />
            <ellipse cx="14" cy="29.5" rx="2.1" ry="2.5" fill="#f2a8c4" opacity="0.88" />
            <ellipse cx="20.5" cy="32" rx="2.1" ry="2.5" fill="#f2a8c4" opacity="0.88" />
          </g>
        </g>
      );
    case "working":
      return (
        <g className="extra pen">
          <rect x="90" y="70" width="9" height="30" rx="2" fill="#f7c948" stroke="#3b342c" strokeWidth="2.5" />
          <path d="M90 100 L99 100 L94.5 110 Z" fill="#3b342c" />
        </g>
      );
    case "thinking":
      return (
        <g className="extra dot">
          <circle cx="98" cy="28" r="3.5" fill="#3b342c" />
          <circle cx="108" cy="18" r="2.6" fill="#3b342c" />
          <circle cx="114" cy="8" r="2" fill="#3b342c" />
        </g>
      );
    case "scanning":
      return (
        <g className="extra glass">
          <circle cx="45" cy="56" r="13" fill="none" stroke="#3b342c" strokeWidth="3" />
          <circle cx="75" cy="56" r="13" fill="none" stroke="#3b342c" strokeWidth="3" />
          <line x1="58" y1="56" x2="62" y2="56" stroke="#3b342c" strokeWidth="3" />
        </g>
      );
    case "needs":
      return (
        <g className="extra badge">
          <circle cx="102" cy="24" r="14" fill="#f7c948" stroke="#3b342c" strokeWidth="3" />
          <text x="102" y="31" textAnchor="middle" fontFamily="Nunito Sans,sans-serif" fontWeight="800" fontSize="19" fill="#3b342c">
            !
          </text>
        </g>
      );
    case "waiting":
      return (
        <g className="extra">
          <rect x="86" y="18" width="26" height="18" rx="6" fill="#fff" stroke="#3b342c" strokeWidth="2.5" />
          <text x="99" y="31" textAnchor="middle" fontFamily="Nunito Sans,sans-serif" fontWeight="800" fontSize="11" fill="#3b342c">
            …
          </text>
        </g>
      );
    case "sleep":
      return (
        <g className="extra zzz">
          <text x="100" y="28" fontFamily="Shantell Sans,cursive" fontWeight="800" fontSize="16" fill="#3b342c">
            z
          </text>
          <text x="112" y="16" fontFamily="Shantell Sans,cursive" fontWeight="800" fontSize="12" fill="#3b342c">
            z
          </text>
        </g>
      );
    case "done":
      return (
        <g className="extra confetti">
          <rect x="14" y="18" width="7" height="7" rx="1" fill="#f28b6f" transform="rotate(20 17 21)" />
          <rect x="99" y="12" width="6" height="6" rx="3" fill="#8fcbaa" />
          <rect x="20" y="94" width="6" height="6" rx="3" fill="#f7c948" />
          <rect x="98" y="92" width="7" height="7" rx="1" fill="#b7a3dd" transform="rotate(-15 101 95)" />
        </g>
      );
    default:
      return null;
  }
}
