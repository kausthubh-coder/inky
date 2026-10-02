// Onboarding mockups: each one is the real preview screen with the proposed change applied on top.
// Run from the repo root with `bun run preview:ui --no-open` already serving on 4174:
//   node docs/redesign/onboarding/shoot.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const dir = "docs/redesign/onboarding/shots";
mkdirSync(dir, { recursive: true });
const base = process.env.PREVIEW_URL ?? "http://127.0.0.1:4174";

const CSS = `
.mk-name{text-decoration:underline dashed 2px var(--muted);text-underline-offset:6px;cursor:text}
.chat-markdown .mk-how{display:grid;gap:7px;margin:12px 0 12px;padding:0;list-style:none;counter-reset:how}
.mk-how li{display:flex;align-items:center;gap:10px;counter-increment:how;font-size:15.5px}
.mk-how li::before{content:counter(how);display:grid;width:24px;height:24px;flex:0 0 24px;place-items:center;border:2px solid var(--ink);border-radius:52% 48% 50% 46%;background:var(--yellow);font:700 13px/1 "Shantell Sans",cursive}
.mk-then{color:var(--muted);font-size:14.5px}
.mk-peek{position:absolute;display:flex;align-items:flex-end;gap:8px;pointer-events:none}
.mk-peek-say{margin-bottom:34px;padding:8px 12px;border:2px solid var(--ink);border-radius:18px 18px 18px 4px;background:#efe8fb;font:600 14px/1.35 "Shantell Sans",cursive;width:170px;box-shadow:2px 3px 0 rgb(59 52 44/10%)}
.mk-apps{display:grid;gap:6px;margin-top:12px}
.mk-app{display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:12px;padding:6px 8px 6px 12px;border:2px solid #e3d9c8;border-radius:14px 16px 15px 13px;background:#fff}
.mk-app img{width:24px;height:24px}
.mk-app strong{display:block;font-size:14px}.mk-app small{display:block;color:var(--muted);font-size:12.5px;font-weight:600}
.mk-ok{color:#3d7a57;font-size:13px;font-weight:800;padding-right:6px}
.mk-trust{margin-top:10px;color:var(--muted);font-size:12.5px;font-weight:700}
.mk-folder{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:12px;padding:10px 10px 10px 12px;border:2px solid var(--ink);border-radius:14px 16px 15px 13px;background:#fff}
.mk-folder strong{display:block;font-size:14px;overflow-wrap:anywhere}.mk-folder small{display:block;color:var(--muted);font-size:12px;font-weight:700}
.mk-skip{margin-top:10px;padding:0;border:0;background:none;color:var(--muted);font-size:12.5px;font-weight:800;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.with-browser .fable-bubbles.mk-now{flex:0 0 auto;overflow:visible}
.with-browser .mk-now .fable-speech{max-width:100%;width:100%;padding:16px 18px 15px;border-radius:24px 28px 26px 22px;font-size:15px}
.with-browser .mk-now .fable-speech h1{margin-bottom:6px;font-size:20px}
.with-browser .fable-replies.mk-replies{border-top:0;padding-top:0;margin-top:10px}
.mk-told{margin-top:40px;padding:0 4px}
.mk-told h2{margin:0 0 6px;color:var(--muted);font-size:12.5px;font-weight:800}
.mk-told dl{display:grid;grid-template-columns:auto 1fr;margin:0}
.mk-told dt,.mk-told dd{margin:0;padding:6px 0;border-top:1px solid #e6dccb;font-size:13px}
.mk-told dt{padding-right:16px;color:var(--muted);font-weight:700}.mk-told dd{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-told dd.mk-hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.mk-found{display:grid;gap:5px;margin:12px 0 0;padding:0;list-style:none}
.mk-found li{display:flex;gap:9px;align-items:baseline;font-size:14.5px}
.mk-found li b{font-weight:800}.mk-found li span{color:var(--muted);font-weight:600}
.mk-found li i{width:16px;flex:0 0 16px;color:#3d7a57;font-style:normal;font-weight:900}
.mk-found li.mk-wait{color:var(--muted)}.mk-found li.mk-wait i{color:var(--muted)}
.mk-live{margin-top:10px;color:var(--muted);font-size:13px;font-weight:700}
.mk-due{display:grid;gap:4px;margin:10px 0 12px;padding:0;list-style:none}
.mk-due li{display:grid;grid-template-columns:1fr auto;gap:12px;padding:6px 0;border-top:1px solid #e6dccb;font-size:14px}
.mk-due li span{color:var(--muted);font-weight:700}
.mk-map{display:grid;gap:9px;margin:14px 0 2px;padding:12px 0 0;border-top:2px dashed #d8cdbb;list-style:none}
.mk-map li{display:grid;grid-template-columns:30px 1fr;align-items:center;gap:10px;font-size:14px}
.mk-map li b{font-weight:800}
.mk-map .mk-ico{display:grid;width:30px;height:30px;place-items:center}
.mk-map .mk-ico .character{width:30px!important;height:30px!important}
.mk-map .mk-box{width:30px;height:20px;border:2px solid var(--ink);border-radius:9px;background:var(--panel);position:relative}
.mk-map .mk-box::after{content:"";position:absolute;right:3px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--yellow);border:1.5px solid var(--ink)}
.mk-hint{margin-top:8px;color:var(--muted);font-size:12.5px;font-weight:700}
`;

const told = (hover = -1) => `<section class="mk-told"><h2>What you told me</h2><dl>${[
  ["Your AI", "ChatGPT"], ["Apps", "Gmail, Google Drive"], ["Folder", "Documents\\Studi"],
  ["Class site", "learn.northstar.edu"], ["Homework", "I do it, you hand it in"], ["Checks", "Every morning"],
].map(([k, v], i) => `<dt>${k}</dt><dd${i === hover ? ' class="mk-hover" title="Change"' : ""}>${v}</dd>`).join("")}</dl></section>`;

/** Replace the browser-stage chat with the current message only, its buttons, and the receipt. */
const browserStage = ({ h1, body, buttons, receipt = true, hover = -1 }) => {
  const copy = document.querySelector(".fable-copy");
  const bubbles = copy.querySelector(".fable-bubbles");
  bubbles.classList.add("mk-now");
  bubbles.innerHTML = `<div class="fable-message"><article class="fable-speech"><h1>${h1}</h1>${body}</article></div>`;
  const replies = copy.querySelector(".fable-replies");
  replies.classList.add("mk-replies");
  replies.innerHTML = buttons;
  copy.querySelector(".mk-told")?.remove();
  if (receipt) copy.insertAdjacentHTML("beforeend", window.__told(hover));
};

const SCREENS = [
  { id: "welcome", route: "onboarding-welcome", apply: ({ chalky }) => {
    const speech = document.querySelector(".fable-speech");
    speech.querySelector("h1").innerHTML = `Nice to meet you, <span class="mk-name" title="Click to change">Kausthubh</span>.`;
    speech.querySelector(".chat-markdown").innerHTML = `<p>Here's how we'll work:</p><ol class="mk-how"><li>I find your homework.</li><li>I do the work, then show you.</li><li>You check it and hand it in.</li></ol><p class="mk-then">First, I need the AI you already pay for.</p>`;
    const box = speech.getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", `<div class="mk-peek" style="left:${box.right - 34}px;top:${box.bottom - 96}px">${chalky.replace('style="', 'style="flex:0 0 auto;')}<div class="mk-peek-say">And I'm Chalky. I help you study for tests.</div></div>`);
    const peek = document.querySelector(".mk-peek .character");
    peek.style.width = peek.style.height = "64px";
    peek.setAttribute("data-state", "hello");
  } },
  { id: "apps", route: "onboarding-connections", apply: () => {
    const picks = document.querySelector("[data-onboarding-connected-apps]");
    const apps = [["gmail", "Gmail", "Emails from your teachers", true], ["googledrive", "Google Drive", "Class files and handouts", true], ["googledocs", "Google Docs", "Essays and assignment docs", false], ["notion", "Notion", "Your class notes", false], ["github", "GitHub", "Coding assignments", false]];
    document.querySelector(".fable-speech .chat-markdown").innerHTML = "<p>Connect where your notes, files and messages live.</p>";
    picks.outerHTML = `<div class="mk-apps">${apps.map(([key, name, use, on]) => `<div class="mk-app"><img src="https://logos.composio.dev/api/${key}" alt=""><span><strong>${name}</strong><small>${use}</small></span>${on ? `<span class="mk-ok">✓ Connected</span>` : `<button class="fable-button">Connect</button>`}</div>`).join("")}</div><p class="mk-trust">More apps, and disconnecting, are in Settings.</p>`;
  } },
  { id: "folder", route: "onboarding-folder", apply: () => {
    document.querySelector(".fable-speech .chat-markdown").innerHTML = `<p>I keep every class's work in it: your files, my drafts, anything I download. I can't open anything outside it.</p>`;
    document.querySelector("[data-onboarding-homework-folder]").outerHTML = `<div class="mk-folder"><span style="font-size:22px">📁</span><span><strong>C:\\Users\\kaust\\Documents\\Studi</strong><small>New. I'll make it.</small></span><button class="fable-button">Choose another</button></div>`;
    const replies = document.querySelector(".fable-replies");
    replies.querySelector(".primary").textContent = "Use this folder";
    replies.querySelector(".primary").disabled = false;
  } },
  { id: "school", route: "onboarding-school", apply: () => {
    const block = document.querySelector(".fable-form-block");
    block.querySelector("input").value = "https://learn.northstar.edu";
    block.querySelector(".fable-hint").outerHTML = `<button class="mk-skip">I don't have a class site</button>`;
    block.querySelector("input").style.color = "var(--ink)";
    block.querySelector(".mk-skip").style.alignSelf = "flex-start";
    document.querySelector(".fable-replies .primary").disabled = false;
  } },
  { id: "permission", route: "onboarding-permission", apply: () => {
    const picks = [...document.querySelectorAll(".fable-picks .fable-pick")];
    const copy = [["Just tell me about it", "I'll list it. You do the work."], ["Do it, I'll hand it in", "I do the work and show you. You press Submit."], ["Do it and hand it in", "I submit it for you. Only if you really want that."]];
    picks.forEach((pick, i) => {
      pick.classList.toggle("selected", i === 1);
      pick.innerHTML = `<strong>${copy[i][0]}${i === 1 ? ' <small>· recommended</small>' : ""}</strong><span>${copy[i][1]}</span>`;
    });
    document.querySelector(".fable-picks").insertAdjacentHTML("afterend", `<p class="mk-hint">You can pick differently for any class later.</p>`);
    document.querySelector(".fable-speech .chat-markdown").innerHTML = "<p>What should I do?</p>";
  } },
  { id: "signin", route: "onboarding-signin", apply: () => browserStage({
    h1: "Your turn.",
    body: `<p>Sign in on the right. I can't see your password. If your school asks, tick “remember this device” so I stay signed in.</p>`,
    buttons: `<button class="fable-button primary">I'm signed in. Look around.</button><button class="fable-button">Back</button>`,
    hover: 3,
  }) },
  { id: "scan", route: "onboarding-scan", apply: () => browserStage({
    h1: "Looking around.",
    body: `<p>Checking your classes, instructions and due dates. A few minutes. Watch me on the right.</p><ul class="mk-found"><li><i>✓</i><b>CSC 316</b><span>3 assignments</span></li><li><i>✓</i><b>ST 370</b><span>1 assignment</span></li><li class="mk-wait"><i>…</i><b>MA 241</b><span>reading the syllabus</span></li></ul>`,
    buttons: "",
  }) },
  { id: "scan-failed", route: "onboarding-scan", apply: () => { document.querySelector(".fable-inky-wrap").innerHTML = window.__needs; return browserStage({
    h1: "That didn't finish.",
    body: `<p>The class site stopped loading while I was reading MA 241. I kept what I found in the other two.</p>`,
    buttons: `<button class="fable-button primary">Try again</button><button class="fable-button">Skip for now</button><p class="mk-hint" style="flex-basis:100%;margin:2px 0 0">Skipping opens Studi with what I have. Learn works right away, and I'll try school again tomorrow morning.</p>`,
  }); } },
  { id: "ready", route: "onboarding-ready", apply: () => browserStage({
    h1: "Your week is ready.",
    body: `<p>I found 7 assignments in 3 classes. These are next:</p><ul class="mk-due"><li><b>IBM Sorting Machine</b><span>CSC 316 · Mon</span></li><li><b>HW 3</b><span>CSC 316 · Tue</span></li><li><b>Problem set 4</b><span>ST 370 · Thu</span></li></ul><p>I'll start on them once you're in. You still press Submit.</p><ul class="mk-map"><li><span class="mk-ico">${window.__dot}</span><span><b>Homework</b> is your week, and what I'm doing.</span></li><li><span class="mk-ico">${window.__chalky}</span><span><b>Learn</b> is Chalky. Tell it about a test.</span></li><li><span class="mk-ico"><span class="mk-box"></span></span><span><b>The box at the bottom</b> is me. Ask anything.</span></li></ul>`,
    buttons: `<button class="fable-button primary">Open my week</button>`,
    receipt: false,
  }) },
  { id: "week-first", route: "week", apply: () => {
    document.querySelector(".hw-hello-copy h1").textContent = "This is your week.";
    document.querySelector(".hw-hello-copy p").textContent = "I put homework here as I find it. Open one to see what I'll do, or ask me below.";
    document.querySelector(".inky-composer textarea").setAttribute("placeholder", "Ask me anything. Try “what can you do?”");
  } },
  { id: "learn-first", route: "learn-empty", apply: () => {
    document.querySelector(".lr-hello h1").textContent = "Hi, I'm Chalky.";
    document.querySelector(".lr-hello p").textContent = "Dot does homework. I help you learn it. Tell me about a test and I'll plan it, or try five minutes on anything.";
  } },
  { id: "chat-help", route: "chat-expanded", apply: () => {
    const log = document.querySelector(".hw-dock-log");
    const dot = log.querySelector(".ag-who").outerHTML;
    log.innerHTML = `<div class="hw-dock-entry"><div class="ag-you">What can you do?</div></div><div class="hw-dock-entry"><div class="ag-turn is-still">${dot}<div class="ag-text"><div class="chat-markdown">
      <p>Here's what I do:</p><ul>
      <li><strong>Homework.</strong> I check your class site every morning, do the work, and show you before you hand it in. Open anything on your week to see it.</li>
      <li><strong>Questions.</strong> Ask about an assignment, your email, or your class files.</li>
      <li><strong>Studying.</strong> Chalky plans for tests and runs short lessons. Switch to Learn at the top.</li>
      <li><strong>Changing things.</strong> The gear, top right: your AI, apps, rules and how often I check.</li></ul>
      </div></div></div><div class="ag-tips">${["What's due this week?", "Start IBM Sorting Machine", "Check my email for teachers"].map(t => `<button><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${t}</button>`).join("")}</div></div>`;
    document.querySelector(".inky-composer textarea").setAttribute("placeholder", "Ask me anything…");
  } },
];

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", error => console.log("pageerror", error.message));
await page.goto(`${base}/?preview=learn-empty`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const chalky = await page.evaluate(() => document.querySelector(".lr-hello .character").outerHTML);
await page.goto(`${base}/?preview=onboarding-handoff`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const needs = await page.evaluate(() => document.querySelector(".fable-inky-wrap").innerHTML);
await page.goto(`${base}/?preview=onboarding-welcome`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const dot = await page.evaluate(() => document.querySelector(".fable-inky-wrap .character").outerHTML);
for (const screen of SCREENS.filter(item => !only.length || only.includes(item.id))) {
  await page.goto(`${base}/?preview=${screen.route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(({ told, browserStage, extras }) => {
    window.__told = new Function(`return (${told})`)(); Object.assign(window, extras);
    window.__browserStage = new Function(`return (${browserStage})`)();
  }, { told: told.toString(), browserStage: browserStage.toString(), extras: { __chalky: chalky, __needs: needs, __dot: dot } });
  await page.evaluate(`(${screen.apply.toString().replace(/browserStage\(/g, "window.__browserStage(")})(${JSON.stringify({ chalky })})`);
  await page.evaluate(() => { document.querySelectorAll(".fable-speech").forEach(el => { el.style.animation = "none"; }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${screen.id}.png` });
  console.log("ok", screen.id);
}
await browser.close();
