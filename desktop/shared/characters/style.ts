// Poses, morphs and loops for Dot and Chalky (see rig.ts). Shape changes are CSS transitions; loops are CSS
// animations that characterMotion.ts pauses and blends on each state change so nothing jumps.
// Kept as a string so the app and the school-site overlay use the same source.
export const CHARACTER_CSS = `
.character { --spring: cubic-bezier(.34, 1.5, .64, 1); --soft: cubic-bezier(.45, 0, .25, 1); }
.character { display: inline-block; line-height: 0; --mx: 0; --my: 0; --d: 0s; }
.character svg { display: block; width: 100%; height: 100%; overflow: visible; }

.character .mouth { d: path("M52 73 Q60 80 68 73 Q60 80 52 73 Z"); fill: #fff; fill-opacity: 0; transition: d .42s var(--spring), fill .2s, fill-opacity .25s; }
.character .pupil { rx: 5px; ry: 7px; opacity: 1; transition: rx .35s var(--spring), ry .35s var(--spring), opacity .15s; }
.character .glint { r: 1.8px; cy: 53px; opacity: 1; transition: r .3s, cy .3s, opacity .15s; }
.character.chalky .pupil { rx: 3.6px; ry: 4.4px; }
.character.chalky .glint { r: 1.3px; cy: 54px; }
.character .lid { opacity: 0; transition: opacity .2s; }
.character .cheek { opacity: .7; transition: opacity .3s; }
.character .brow-l { d: path("M39 47 Q45 44 51 47"); transition: d .35s var(--spring); }
.character .brow-r { d: path("M69 47 Q75 44 81 47"); transition: d .35s var(--spring); }
.character .look { transform: translate(calc(var(--mx) * 1px), calc(var(--my) * 1px)); transition: transform .3s var(--soft); }
.character .arm-r, .character .arm-l { opacity: 0; transform: scale(.2) rotate(-40deg); transition: transform .5s var(--spring), opacity .15s; }
.character .arm-l { transform: scale(.2) rotate(40deg); }
.character .limb { d: path("M101 76 Q106 80 106 86"); transition: d .45s var(--spring); }
.character .hand { cx: 106px; cy: 87px; transition: cx .45s var(--spring), cy .45s var(--spring); }
.character .tool { opacity: 0; transform: translate(106px, 87px) rotate(30deg) scale(.6); transition: transform .5s var(--spring), opacity .2s; }
.character .fx > g { opacity: 0; transition: opacity .25s; }
.character .blink { animation: ch-blink 5.6s linear infinite var(--d); }

/* idle */
.character[data-state="idle"] .body { animation: ch-breathe 3.4s var(--soft) infinite var(--d); }
.character[data-state="idle"] .hair { animation: ch-hair-sway 3.4s var(--soft) infinite calc(var(--d) + .18s); }
.character[data-state="idle"] .face { animation: ch-face-lag 3.4s var(--soft) infinite calc(var(--d) + .08s); }
.character[data-state="idle"] .shadow { animation: ch-shadow-breathe 3.4s var(--soft) infinite var(--d); }

/* hello */
.character[data-state="hello"] .mouth { d: path("M48 72 Q60 87 72 72 Q60 75 48 72 Z"); fill-opacity: 1; }
.character[data-state="hello"] .cheek { opacity: .9; }
.character[data-state="hello"] .arm-r { opacity: 1; transform: none; }
.character[data-state="hello"] .limb { d: path("M101 72 Q112 70 115 58"); }
.character[data-state="hello"] .hand { cx: 115px; cy: 56px; }
.character[data-state="hello"] .arm-anim { animation: ch-wave 1.9s var(--soft) infinite .25s; }
.character[data-state="hello"] .body { animation: ch-sway 1.9s var(--soft) infinite .25s; }
.character[data-state="hello"] .hair { animation: ch-hair-sway .95s var(--soft) infinite .35s; }
.character[data-state="hello"] .brow-l { d: path("M39 45 Q45 41 51 45"); }
.character[data-state="hello"] .brow-r { d: path("M69 45 Q75 41 81 45"); }

/* sleep */
.character[data-state="sleep"] .blink { animation: none; }
.character[data-state="sleep"] .pupil { ry: .5px; opacity: 0; }
.character[data-state="sleep"] .glint { opacity: 0; }
.character[data-state="sleep"] .lid { opacity: 1; }
.character[data-state="sleep"] .mouth { d: path("M55 76 Q60 79 65 76 Q60 79 55 76 Z"); }
.character[data-state="sleep"] .cheek { opacity: .45; }
.character[data-state="sleep"] .brow-l { d: path("M39 48 Q45 47 51 48"); }
.character[data-state="sleep"] .brow-r { d: path("M69 48 Q75 47 81 48"); }
.character[data-state="sleep"] .body { animation: ch-snooze 4s var(--soft) infinite; }
.character[data-state="sleep"] .shadow { animation: ch-shadow-breathe 4s var(--soft) infinite; }
.character[data-state="sleep"] .fx .zzz { opacity: 1; }

/* ---------- Dot: does the assignments ---------- */

/* scanning: magnifying glass up to one eye, sweeping the page */
.character[data-state="scanning"] .arm-r { opacity: 1; transform: none; }
.character[data-state="scanning"] .limb { d: path("M101 74 Q106 79 103 83"); }
.character[data-state="scanning"] .hand { cx: 103px; cy: 84px; }
.character[data-state="scanning"] .glass { opacity: 1; transform: translate(103px, 84px); }
.character[data-state="scanning"] .arm-anim { animation: ch-sweep 2.8s var(--soft) infinite; }
.character[data-state="scanning"] .big-eye { animation: ch-dart 2.8s var(--soft) infinite; }
.character[data-state="scanning"] .look { animation: ch-peek 2.8s var(--soft) infinite; }
.character[data-state="scanning"] .body { animation: ch-peer 2.8s var(--soft) infinite; }
.character[data-state="scanning"] .hair { animation: ch-hair-sway 1.4s var(--soft) infinite .2s; }
.character[data-state="scanning"] .mouth { d: path("M54 76 Q58 73 63 76 Q58 73 54 76 Z"); }
.character[data-state="scanning"] .brow-l { d: path("M39 43 Q45 40 51 44"); }
.character[data-state="scanning"] .fx .found { opacity: 1; }
.character .fx .found path { transform-box: fill-box; transform-origin: center; animation: ch-found 2.8s var(--soft) infinite; }
.character .fx .found path + path { animation-delay: .12s; }

/* steering: clicking around the school site */
.character[data-state="steering"] .arm-r { opacity: 1; transform: none; }
.character[data-state="steering"] .limb { d: path("M101 76 Q110 80 110 86"); }
.character[data-state="steering"] .hand { cx: 110px; cy: 87px; }
.character[data-state="steering"] .cursor { opacity: 1; transform: translate(110px, 87px) scale(1.3); }
.character[data-state="steering"] .arm-anim { animation: ch-click 1.6s var(--soft) infinite; }
.character[data-state="steering"] .ripple { animation: ch-ripple 1.6s ease-out infinite; }
.character[data-state="steering"] .look { transform: translate(3.5px, -1px); }
.character[data-state="steering"] .body { animation: ch-lean 2.2s var(--soft) infinite; }
.character[data-state="steering"] .mouth { d: path("M53 75 Q60 80 67 75 Q60 80 53 75 Z"); }
.character[data-state="steering"] .brow-l { d: path("M39 45 Q46 45 52 48"); }
.character[data-state="steering"] .brow-r { d: path("M68 48 Q74 45 81 45"); }

/* working: writing the answer */
.character[data-state="working"] .arm-r { opacity: 1; transform: none; }
.character[data-state="working"] .limb { d: path("M101 78 Q112 82 111 92"); }
.character[data-state="working"] .hand { cx: 111px; cy: 93px; }
.character[data-state="working"] .pen { opacity: 1; transform: translate(111px, 93px) rotate(28deg); }
.character[data-state="working"] .arm-anim { animation: ch-scribble .6s ease-in-out infinite; }
.character[data-state="working"] .body { animation: ch-lean 1.4s var(--soft) infinite; }
.character[data-state="working"] .hair { animation: ch-hair-sway .7s var(--soft) infinite; }
.character[data-state="working"] .look { transform: translate(3px, 3px); }
.character[data-state="working"] .mouth { d: path("M53 76 Q60 81 67 75 Q60 79 53 76 Z"); }
.character[data-state="working"] .cheek { opacity: .45; }
.character[data-state="working"] .brow-l { d: path("M39 44 Q46 45 52 49"); }
.character[data-state="working"] .brow-r { d: path("M68 49 Q74 45 81 44"); }
.character[data-state="working"] .fx .speed { opacity: 1; }

/* needs you: hand up */
.character[data-state="needs"] .pupil { rx: 6px; ry: 8px; }
.character[data-state="needs"] .glint { r: 2px; }
.character[data-state="needs"] .mouth { d: path("M55 77 Q60 90 65 77 Q60 65 55 77 Z"); fill: #3b342c; fill-opacity: 1; }
.character[data-state="needs"] .arm-r { opacity: 1; transform: none; }
.character[data-state="needs"] .limb { d: path("M101 72 Q112 70 115 58"); }
.character[data-state="needs"] .hand { cx: 115px; cy: 56px; }
.character[data-state="needs"] .arm-anim { animation: ch-waggle 1.6s var(--soft) infinite; }
.character[data-state="needs"] .body { animation: ch-boing 1.6s var(--soft) infinite; }
.character[data-state="needs"] .hair { animation: ch-hair-sway .8s var(--soft) infinite .1s; }
.character[data-state="needs"] .brow-l { d: path("M40 45 Q45 41 51 42"); }
.character[data-state="needs"] .brow-r { d: path("M69 42 Q75 41 80 45"); }
.character[data-state="needs"] .fx .badge { opacity: 1; }
.character[data-state="needs"] .badge-anim { animation: ch-badge 1.6s var(--soft) infinite; }

/* review: holds the finished paper up for you */
.character[data-state="review"] .arm-r { opacity: 1; transform: none; }
.character[data-state="review"] .limb { d: path("M101 72 Q112 70 115 58"); }
.character[data-state="review"] .hand { cx: 115px; cy: 56px; }
.character[data-state="review"] .paper { opacity: 1; transform: translate(115px, 56px) rotate(8deg); }
.character[data-state="review"] .arm-anim { animation: ch-present 2.4s var(--soft) infinite; }
.character[data-state="review"] .body { animation: ch-breathe 2.4s var(--soft) infinite; }
.character[data-state="review"] .mouth { d: path("M49 72 Q60 85 71 72 Q60 75 49 72 Z"); fill-opacity: 1; }
.character[data-state="review"] .cheek { opacity: .9; }
.character[data-state="review"] .brow-l { d: path("M39 45 Q45 41 51 45"); }
.character[data-state="review"] .brow-r { d: path("M69 45 Q75 41 81 45"); }

/* done + proud: anticipation, hop, landing squash */
.character[data-state="done"] .mouth, .character[data-state="proud"] .mouth { d: path("M47 71 Q60 89 73 71 Q60 74 47 71 Z"); fill-opacity: 1; }
.character[data-state="done"] .cheek, .character[data-state="proud"] .cheek { opacity: .95; }
.character[data-state="done"] .arm-r, .character[data-state="done"] .arm-l, .character[data-state="proud"] .arm-r, .character[data-state="proud"] .arm-l { opacity: 1; transform: none; }
.character[data-state="done"] .limb, .character[data-state="proud"] .limb { d: path("M101 70 Q113 64 114 50"); }
.character[data-state="done"] .hand, .character[data-state="proud"] .hand { cx: 114px; cy: 48px; }
.character[data-state="done"] .hop, .character[data-state="proud"] .hop { animation: ch-hop 1.3s infinite; }
.character[data-state="done"] .body, .character[data-state="proud"] .body { animation: ch-land 1.3s var(--soft) infinite; }
.character[data-state="done"] .hair, .character[data-state="proud"] .hair { animation: ch-hair-sway .65s var(--soft) infinite .1s; }
.character[data-state="done"] .shadow, .character[data-state="proud"] .shadow { animation: ch-shadow-hop 1.3s infinite; }
.character[data-state="done"] .arm-anim, .character[data-state="proud"] .arm-anim { animation: ch-cheer-r 1.3s var(--soft) infinite; }
.character[data-state="done"] .arm-anim-l, .character[data-state="proud"] .arm-anim-l { animation: ch-cheer-l 1.3s var(--soft) infinite; }
.character[data-state="done"] .brow-l { d: path("M39 45 Q45 41 51 45"); }
.character[data-state="done"] .brow-r { d: path("M69 45 Q75 41 81 45"); }
.character[data-state="done"] .fx .confetti { opacity: 1; }

/* ---------- Chalky: teaches ---------- */

/* explaining: pointer and a talking mouth */
.character[data-state="explaining"] .arm-r { opacity: 1; transform: none; }
.character[data-state="explaining"] .limb { d: path("M101 72 Q114 68 119 55"); }
.character[data-state="explaining"] .hand { cx: 119px; cy: 53px; }
.character[data-state="explaining"] .pointer { opacity: 1; transform: translate(119px, 53px) rotate(28deg); }
.character[data-state="explaining"] .look { transform: translate(3px, -2px); }
.character[data-state="explaining"] .arm-anim { animation: ch-tap 1.2s var(--soft) infinite; }
.character[data-state="explaining"] .mouth { fill: #3b342c; fill-opacity: 1; animation: ch-talk .42s ease-in-out infinite alternate; }
.character[data-state="explaining"] .body { animation: ch-sway 2.4s var(--soft) infinite; }
.character[data-state="explaining"] .hair { animation: ch-hair-sway 1.2s var(--soft) infinite .2s; }

/* listening: head tilted toward you, nodding while you type */
.character[data-state="listening"] .look { transform: translate(-3.5px, 1px); }
.character[data-state="listening"] .mouth { d: path("M54 75 Q60 79 66 75 Q60 79 54 75 Z"); }
.character[data-state="listening"] .body { animation: ch-nod 2.4s var(--soft) infinite; }
.character[data-state="listening"] .hair { animation: ch-hair-sway 1.2s var(--soft) infinite .15s; }
.character[data-state="listening"] .fx .typing { opacity: 1; }
.character .fx .typing circle { animation: ch-typing 1.2s var(--soft) infinite; }
.character .fx .typing circle:nth-of-type(2) { animation-delay: .15s; } .character .fx .typing circle:nth-of-type(3) { animation-delay: .3s; }

/* thinking */
.character[data-state="thinking"] .look { transform: translate(2.5px, -5px); }
.character[data-state="thinking"] .mouth { d: path("M54 77 Q60 73 67 78 Q60 73 54 77 Z"); }
.character[data-state="thinking"] .cheek { opacity: .4; }
.character[data-state="thinking"] .body { animation: ch-ponder 3.2s var(--soft) infinite; }
.character[data-state="thinking"] .hair { animation: ch-hair-sway 1.6s var(--soft) infinite .2s; }
.character[data-state="thinking"] .fx .think { opacity: 1; }
.character .fx .think { animation: ch-float 2.6s var(--soft) infinite; }

/* hint: a lightbulb pops on */
.character[data-state="hint"] .look { transform: translate(2.5px, -5px); }
.character[data-state="hint"] .mouth { d: path("M55 76 Q60 86 65 76 Q60 70 55 76 Z"); fill: #3b342c; fill-opacity: 1; }
.character[data-state="hint"] .cheek { opacity: .9; }
.character[data-state="hint"] .body { animation: ch-boing 2s var(--soft) infinite; }
.character[data-state="hint"] .hair { animation: ch-hair-sway .8s var(--soft) infinite; }
.character[data-state="hint"] .fx .bulb { opacity: 1; }
.character .bulb-anim { transform: scale(.2) translateY(10px); transition: transform .55s var(--spring); }
.character[data-state="hint"] .bulb-anim { transform: none; }
.character .rays { transform-box: fill-box; transform-origin: center; animation: ch-rays 1s var(--soft) infinite; }

/* quiz: holds up a question card */
.character[data-state="quiz"] .arm-r { opacity: 1; transform: none; }
.character[data-state="quiz"] .limb { d: path("M101 72 Q112 70 115 58"); }
.character[data-state="quiz"] .hand { cx: 115px; cy: 56px; }
.character[data-state="quiz"] .card { opacity: 1; transform: translate(115px, 56px) rotate(-6deg); }
.character[data-state="quiz"] .arm-anim { animation: ch-present 2.4s var(--soft) infinite; }
.character[data-state="quiz"] .body { animation: ch-sway 2.4s var(--soft) infinite; }
.character[data-state="quiz"] .mouth { d: path("M52 74 Q60 83 68 74 Q60 76 52 74 Z"); fill-opacity: 1; }

/* proud: gold star held high */
.character[data-state="proud"] .star { opacity: 1; transform: translate(114px, 48px); }
.character[data-state="proud"] .fx .shine { opacity: 1; }
.character .fx .shine path { transform-box: fill-box; transform-origin: center; animation: ch-twinkle 1.3s var(--soft) infinite; }
.character .fx .shine path:nth-child(2) { animation-delay: .4s; } .character .fx .shine path:nth-child(3) { animation-delay: .8s; }

.character .fx .z { transform-box: fill-box; animation: ch-z 3s ease-out infinite; }
.character .fx .z:nth-child(2) { animation-delay: 1s; } .character .fx .z:nth-child(3) { animation-delay: 2s; }
.character .fx .c { transform-box: fill-box; transform-origin: center; animation: ch-confetti 1.3s cubic-bezier(.2,.6,.4,1) infinite; }
.character .fx .speed path { animation: ch-speed .5s linear infinite; }
.character .fx .speed path:nth-child(2) { animation-delay: -.17s; } .character .fx .speed path:nth-child(3) { animation-delay: -.33s; }
.character .ripple { transform-box: fill-box; transform-origin: center; opacity: 0; }

@keyframes ch-breathe { 0%, 100% { transform: none; } 50% { transform: translateY(-2.5px) scale(.985, 1.03); } }
@keyframes ch-shadow-breathe { 0%, 100% { transform: none; } 50% { transform: scale(.93); } }
@keyframes ch-hair-sway { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(-9deg); } }
@keyframes ch-face-lag { 0%, 100% { transform: none; } 55% { transform: translateY(-1.2px); } }
@keyframes ch-blink { 0%, 43%, 47%, 86%, 89.5%, 93%, 100% { transform: none; } 45%, 88%, 91.5% { transform: scaleY(.08); } }
@keyframes ch-sway { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(-3deg) translateY(-1px); } 70% { transform: rotate(2.5deg); } }
@keyframes ch-wave { 0%, 56%, 100% { transform: rotate(0); } 8% { transform: rotate(-24deg); } 17% { transform: rotate(12deg); } 26% { transform: rotate(-22deg); } 35% { transform: rotate(10deg); } 45% { transform: rotate(-8deg); } }
@keyframes ch-lean { 0%, 100% { transform: rotate(2deg); } 50% { transform: rotate(3.5deg) translateY(1px) scale(1.01, .99); } }
@keyframes ch-scribble { 0%, 100% { transform: rotate(0); } 14% { transform: rotate(5deg); } 27% { transform: rotate(-2deg); } 41% { transform: rotate(4deg); } 55% { transform: rotate(-3deg); } 70% { transform: rotate(6deg); } 84% { transform: rotate(-1deg); } }
@keyframes ch-ponder { 0%, 100% { transform: rotate(-2.5deg); } 50% { transform: rotate(3deg) translateY(-2px); } }
@keyframes ch-sweep { 0%, 100% { transform: rotate(8deg); } 42%, 52% { transform: rotate(-16deg); } }
@keyframes ch-dart { 0%, 100% { transform: translate(2px, 1px); } 42%, 52% { transform: translate(-3px, -1px); } 60% { transform: translate(-1px, 0); } }
@keyframes ch-peek { 0%, 100% { transform: translate(2.5px, .5px); } 42%, 52% { transform: translate(-2.5px, -1px); } }
@keyframes ch-peer { 0%, 100% { transform: rotate(3deg); } 42%, 52% { transform: rotate(-3deg) translateY(-1px); } }
@keyframes ch-found { 0%, 50%, 80%, 100% { transform: scale(0); opacity: 0; } 58% { transform: scale(1.3) rotate(20deg); opacity: 1; } 70% { transform: scale(1) rotate(35deg); opacity: 1; } }
@keyframes ch-click { 0%, 18%, 50%, 68%, 100% { transform: none; } 24% { transform: rotate(4deg) translate(-1px, 2px); } 74% { transform: rotate(4deg) translate(-1px, 2px); } 36% { transform: rotate(-6deg); } }
@keyframes ch-ripple { 0%, 22% { transform: scale(.2); opacity: 0; } 26% { opacity: .9; } 48% { transform: scale(1.6); opacity: 0; } 72% { transform: scale(.2); opacity: 0; } 76% { opacity: .9; } 98%, 100% { transform: scale(1.6); opacity: 0; } }
@keyframes ch-present { 0%, 100% { transform: rotate(0); } 12% { transform: rotate(-8deg); } 24% { transform: rotate(5deg); } 34% { transform: rotate(-3deg); } 44% { transform: rotate(0); } }
@keyframes ch-nod { 0%, 100% { transform: rotate(-6deg); } 20% { transform: rotate(-6deg) scale(1.02, .97) translateY(1px); } 32% { transform: rotate(-6deg); } 62% { transform: rotate(-4deg) scale(1.02, .97) translateY(1px); } 74% { transform: rotate(-6deg); } }
@keyframes ch-typing { 0%, 60%, 100% { transform: translateY(0); } 25% { transform: translateY(-3px); } }
@keyframes ch-rays { 0%, 100% { transform: scale(1); opacity: .6; } 50% { transform: scale(1.15); opacity: 1; } }
@keyframes ch-twinkle { 0%, 100% { transform: scale(.3) rotate(0); opacity: 0; } 40% { transform: scale(1.1) rotate(30deg); opacity: 1; } 70% { transform: scale(.8) rotate(45deg); opacity: .8; } }
@keyframes ch-boing { 0%, 55%, 100% { transform: none; } 8% { transform: scale(1.06, .93); } 20% { transform: translateY(-7px) scale(.95, 1.06); } 32% { transform: scale(1.05, .95); } 42% { transform: scale(.99, 1.01); } }
@keyframes ch-waggle { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }
@keyframes ch-snooze { 0%, 100% { transform: scale(1.02, .975) translateY(.5px); } 50% { transform: none; } }
@keyframes ch-hop { 0%, 16% { transform: none; animation-timing-function: cubic-bezier(.2, .8, .35, 1); } 40% { transform: translateY(-15px); animation-timing-function: cubic-bezier(.65, 0, .85, .35); } 58%, 100% { transform: none; } }
@keyframes ch-land { 0%, 100% { transform: none; } 12% { transform: scale(1.09, .9); } 22% { transform: scale(.94, 1.08); } 42% { transform: scale(.98, 1.02); } 58% { transform: scale(1.1, .89); } 70% { transform: scale(.97, 1.03); } 82% { transform: none; } }
@keyframes ch-shadow-hop { 0%, 16%, 58%, 100% { transform: none; opacity: 1; } 40% { transform: scale(.65); opacity: .5; } }
@keyframes ch-cheer-r { 0%, 100% { transform: rotate(0); } 22%, 40% { transform: rotate(-14deg); } 58% { transform: rotate(6deg); } }
@keyframes ch-cheer-l { 0%, 100% { transform: rotate(0); } 22%, 40% { transform: rotate(14deg); } 58% { transform: rotate(-6deg); } }
@keyframes ch-tap { 0%, 100% { transform: rotate(0); } 20% { transform: rotate(-9deg); } 32% { transform: rotate(3deg); } 44% { transform: rotate(-7deg); } 56% { transform: rotate(2deg); } }
@keyframes ch-talk { from { d: path("M53 75 Q60 80 67 75 Q60 76 53 75 Z"); } to { d: path("M52 74 Q60 87 68 74 Q60 72 52 74 Z"); } }
@keyframes ch-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes ch-badge { 0%, 100% { transform: none; } 10% { transform: scale(1.2) rotate(-10deg); } 20% { transform: scale(.95) rotate(8deg); } 30% { transform: scale(1.05) rotate(-3deg); } 40% { transform: none; } }
@keyframes ch-z { 0% { transform: translate(0, 0) scale(.5); opacity: 0; } 20% { opacity: 1; } 100% { transform: translate(14px, -30px) scale(1.2); opacity: 0; } }
@keyframes ch-confetti { 0% { transform: translate(0, 0) scale(.3) rotate(0); opacity: 0; } 8% { opacity: 1; } 40% { transform: translate(var(--dx), var(--dy)) scale(1) rotate(200deg); opacity: 1; } 100% { transform: translate(calc(var(--dx) * 1.35), calc(var(--dy) + 46px)) rotate(420deg); opacity: 0; } }
@keyframes ch-speed { 0% { transform: translateX(4px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(-6px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .character * { animation: none !important; transition: none !important; } }

/* waiting: calm idle, eyes on the school pane */
.character[data-state="waiting"] .body { animation: ch-breathe 3.4s var(--soft) infinite var(--d); }
.character[data-state="waiting"] .hair { animation: ch-hair-sway 3.4s var(--soft) infinite calc(var(--d) + .18s); }
.character[data-state="waiting"] .look { transform: translate(3.5px, .5px); }

/* characterMotion.ts: loops hold still while a state change blends into them, and off-screen characters rest. */
.character.is-blending :is(.hop, .body, .hair, .face, .shadow, .arm-anim, .arm-anim-l, .look, .big-eye, .badge-anim),
.character.is-offscreen * { animation-play-state: paused !important; }
`;
