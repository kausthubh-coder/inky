/* Shared Inky renderer. <inky-mascot data-state="idle" data-size="96"></inky-mascot> */
(function () {
  const STATES = new Set(["idle", "hello", "working", "thinking", "scanning", "steering", "needs", "waiting", "sleep", "done"]);

  function svg(state, size) {
    const extras = {
      idle: "",
      hello: `<text class="inky-hand" x="8" y="60" text-anchor="middle" dominant-baseline="middle" font-size="30">🤚</text>`,
      working: `<g class="extra pen">
        <g transform="rotate(-48 86 78)">
          <rect x="83" y="62" width="6" height="22" rx="2" fill="#f7c948" stroke="#3b342c" stroke-width="2.4"/>
          <rect x="83" y="62" width="6" height="3.5" rx="1.2" fill="#f28b6f" stroke="#3b342c" stroke-width="2.2"/>
          <path d="M83 84 L89 84 L86 93 Z" fill="#3b342c"/>
        </g>
      </g>`,
      thinking: `<g class="extra think">
        <g class="spark a"><path d="M76 8 l1.4 3.4 3.6 1.4 -3.6 1.4 -1.4 3.4 -1.4 -3.4 -3.6 -1.4 3.6 -1.4 z" fill="#f7c948" stroke="#3b342c" stroke-width="1.2" stroke-linejoin="round"/></g>
        <g class="spark b"><path d="M124 14 l1.1 2.8 3 1.1 -3 1.1 -1.1 2.8 -1.1 -2.8 -3 -1.1 3 -1.1 z" fill="#f2a8c4" stroke="#3b342c" stroke-width="1.2" stroke-linejoin="round"/></g>
        <g class="puff"><circle cx="84" cy="44" r="5" fill="#fff" stroke="#3b342c" stroke-width="2.4"/></g>
        <g class="bubble">
          <path d="M90 32 C88 16 100 6 112 8 C124 10 132 20 128 32 C136 34 138 46 128 50 C124 60 108 60 100 52 C88 56 80 46 84 36 C86 34 88 33 90 32 Z" fill="#fff" stroke="#3b342c" stroke-width="2.6" stroke-linejoin="round"/>
          <text class="q" x="110" y="40" text-anchor="middle" font-family="Shantell Sans, Patrick Hand, cursive" font-weight="800" font-size="22" fill="#3b342c">?</text>
        </g>
      </g>`,
      scanning: `<g class="extra glass"><circle cx="45" cy="56" r="13" fill="none" stroke="#3b342c" stroke-width="3"/><circle cx="75" cy="56" r="13" fill="none" stroke="#3b342c" stroke-width="3"/><line x1="58" y1="56" x2="62" y2="56" stroke="#3b342c" stroke-width="3"/></g>`,
      steering: `<g class="extra pointer"><path d="M86 64 L86 102 L95 93 L101 108 L108 105 L102 90 L114 88 Z" fill="#fff" stroke="#3b342c" stroke-width="2.8" stroke-linejoin="round"/><path d="M88 68 L88 94 L94 88 L99 100 L103 98 L98 86 L108 84 Z" fill="#f7c948" opacity="0.35"/></g>`,
      needs: `<g class="extra badge"><circle cx="102" cy="24" r="14" fill="#f7c948" stroke="#3b342c" stroke-width="3"/><text x="102" y="31" text-anchor="middle" font-family="Nunito,sans-serif" font-weight="800" font-size="19" fill="#3b342c">!</text></g>`,
      waiting: `<g class="extra"><rect x="86" y="18" width="26" height="18" rx="6" fill="#fff" stroke="#3b342c" stroke-width="2.5"/><text x="99" y="31" text-anchor="middle" font-family="Nunito,sans-serif" font-weight="800" font-size="11" fill="#3b342c">…</text></g>`,
      sleep: `<g class="extra zzz"><text x="100" y="28" font-family="Shantell Sans,cursive" font-weight="800" font-size="16" fill="#3b342c">z</text><text x="112" y="16" font-family="Shantell Sans,cursive" font-weight="800" font-size="12" fill="#3b342c">z</text></g>`,
      done: `<g class="extra confetti"><rect x="14" y="18" width="7" height="7" rx="1" fill="#f28b6f" transform="rotate(20 17 21)"/><rect x="99" y="12" width="6" height="6" rx="3" fill="#8fcbaa"/><rect x="20" y="94" width="6" height="6" rx="3" fill="#f7c948"/><rect x="98" y="92" width="7" height="7" rx="1" fill="#b7a3dd" transform="rotate(-15 101 95)"/></g>`,
    };

    const faces = {
      idle: `<g class="eyes blink"><ellipse cx="45" cy="56" rx="5" ry="7" fill="#3b342c"/><ellipse cx="75" cy="56" rx="5" ry="7" fill="#3b342c"/><circle cx="47" cy="53" r="1.8" fill="#fff"/><circle cx="77" cy="53" r="1.8" fill="#fff"/></g><path class="mouth" d="M52 73 Q60 80 68 73" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="33" cy="68" rx="6" ry="4" fill="#f2a8c4" opacity="0.7"/><ellipse cx="87" cy="68" rx="6" ry="4" fill="#f2a8c4" opacity="0.7"/>`,
      hello: `<g class="eyes blink"><ellipse cx="45" cy="56" rx="5" ry="7" fill="#3b342c"/><ellipse cx="75" cy="56" rx="5" ry="7" fill="#3b342c"/><circle cx="47" cy="53" r="1.8" fill="#fff"/><circle cx="77" cy="53" r="1.8" fill="#fff"/></g><path class="mouth" d="M48 72 Q60 86 72 72" stroke="#3b342c" stroke-width="3" fill="#fff" stroke-linecap="round"/><ellipse cx="33" cy="66" rx="6" ry="4" fill="#f2a8c4" opacity="0.8"/><ellipse cx="87" cy="66" rx="6" ry="4" fill="#f2a8c4" opacity="0.8"/>`,
      working: `<circle cx="45" cy="56" r="11" fill="#fff" stroke="#3b342c" stroke-width="3"/><circle cx="75" cy="56" r="11" fill="#fff" stroke="#3b342c" stroke-width="3"/><line x1="56" y1="56" x2="64" y2="56" stroke="#3b342c" stroke-width="3"/><circle cx="45" cy="56" r="3.5" fill="#3b342c"/><circle cx="75" cy="56" r="3.5" fill="#3b342c"/><path class="mouth" d="M53 76 Q60 80 67 76" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      thinking: `<g class="eyes blink"><ellipse cx="46" cy="50" rx="5" ry="6" fill="#3b342c"/><ellipse cx="76" cy="48" rx="5" ry="6" fill="#3b342c"/><circle cx="48" cy="47" r="1.6" fill="#fff"/><circle cx="78" cy="45" r="1.6" fill="#fff"/></g><path class="mouth" d="M54 76 Q60 72 67 78" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      scanning: `<g class="eyes blink"><ellipse cx="45" cy="56" rx="4.5" ry="6" fill="#3b342c"/><ellipse cx="75" cy="56" rx="4.5" ry="6" fill="#3b342c"/><circle cx="47" cy="53" r="1.5" fill="#fff"/><circle cx="77" cy="53" r="1.5" fill="#fff"/></g><path class="mouth" d="M54 74 Q60 78 66 74" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      steering: `<g class="eyes blink"><ellipse cx="45" cy="56" rx="5" ry="7" fill="#3b342c"/><ellipse cx="75" cy="56" rx="5" ry="7" fill="#3b342c"/><circle cx="47" cy="53" r="1.8" fill="#fff"/><circle cx="77" cy="53" r="1.8" fill="#fff"/></g><path class="mouth" d="M53 75 Q60 80 67 75" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="33" cy="68" rx="6" ry="4" fill="#f2a8c4" opacity="0.55"/><ellipse cx="87" cy="68" rx="6" ry="4" fill="#f2a8c4" opacity="0.55"/>`,
      needs: `<ellipse cx="45" cy="56" rx="6" ry="8" fill="#3b342c"/><ellipse cx="75" cy="56" rx="6" ry="8" fill="#3b342c"/><circle cx="47" cy="53" r="2" fill="#fff"/><circle cx="77" cy="53" r="2" fill="#fff"/><ellipse class="mouth" cx="60" cy="77" rx="6" ry="8" fill="#3b342c"/>`,
      waiting: `<path d="M38 56 Q45 50 52 56 M68 56 Q75 50 82 56" stroke="#3b342c" stroke-width="3.5" fill="none" stroke-linecap="round"/><path class="mouth" d="M52 76 Q60 80 68 76" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      sleep: `<path d="M38 56 Q45 50 52 56 M68 56 Q75 50 82 56" stroke="#3b342c" stroke-width="3.5" fill="none" stroke-linecap="round"/><path class="mouth" d="M54 76 Q60 78 66 76" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      done: `<g class="eyes blink"><ellipse cx="45" cy="56" rx="5" ry="7" fill="#3b342c"/><ellipse cx="75" cy="56" rx="5" ry="7" fill="#3b342c"/><circle cx="47" cy="53" r="1.8" fill="#fff"/><circle cx="77" cy="53" r="1.8" fill="#fff"/></g><path class="mouth" d="M48 72 Q60 84 72 72" stroke="#3b342c" stroke-width="3" fill="#fff" stroke-linecap="round"/><ellipse cx="33" cy="66" rx="6" ry="4" fill="#f2a8c4" opacity="0.8"/><ellipse cx="87" cy="66" rx="6" ry="4" fill="#f2a8c4" opacity="0.8"/>`,
    };

    const attached = state === "hello" || state === "working" || state === "scanning" || state === "steering";
    const extra = extras[state] || "";

    return `<svg width="${size}" height="${size}" viewBox="${state === "hello" ? "-16 0 136 120" : "0 0 120 120"}" aria-hidden="true">
      <ellipse cx="60" cy="111" rx="26" ry="5" fill="#3b342c" opacity="0.1"/>
      <g class="body">
        <path d="M60 15 C86 11 105 31 104 58 C103 88 87 107 60 106 C33 105 16 88 16 58 C16 31 34 19 60 15 Z" fill="#8ab8e8" stroke="#3b342c" stroke-width="3.5" stroke-linejoin="round"/>
        <path class="hair" d="M60 15 Q57 5 66 3" stroke="#3b342c" stroke-width="3" fill="none" stroke-linecap="round"/>
        ${faces[state] || faces.idle}
        ${attached ? extra : ""}
      </g>
      ${attached ? "" : extra}
    </svg>`;
  }

  function mount(el) {
    const state = STATES.has(el.dataset.state) ? el.dataset.state : "idle";
    const size = Number(el.dataset.size) || 96;
    el.setAttribute("data-state", state);
    el.style.setProperty("--inky", size + "px");
    el.innerHTML = svg(state, size);
  }

  function upgrade() {
    document.querySelectorAll("inky-mascot").forEach(mount);
  }

  window.Inky = { mount, upgrade, svg };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", upgrade);
  else upgrade();
})();
