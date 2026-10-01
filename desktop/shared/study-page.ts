/**
 * Wraps a tutor-written study page so it can't reach the network, load other files or leave the frame.
 * The page reports what the student tried with studi.explore("label"); the app turns that into the tool result.
 * Used for the sandboxed iframe (sandbox="allow-scripts", no same-origin) and for the copy saved to the goal folder.
 */
export const STUDY_PAGE_MESSAGE = "studi-study-page";

const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

// explore() reports what the student tried; the height report lets the frame fit its content (the parent can't measure an opaque-origin page).
const BRIDGE = `<script>(function(){var t=${JSON.stringify(STUDY_PAGE_MESSAGE)};function send(m){try{parent.postMessage(Object.assign({type:t},m),"*")}catch(e){}}window.studi={explore:function(label){send({label:String(label).slice(0,200)})}};function size(){send({height:document.documentElement.scrollHeight})}addEventListener("load",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body)})})();</script>`;

const BASE_STYLE = `<style>:root{color-scheme:light;--board-font:"Nunito Sans",system-ui,sans-serif;--page:#fff;--paper:#fff;--pencil:#2b2621;--graphite:#746b60;--rule:#e8dfcf;--chalky:#6246a2;--learn-accent:var(--chalky);--highlighter:#ffe08a}body{margin:0;padding:16px;font:15px/1.5 var(--board-font);color:var(--pencil);background:var(--paper)}svg text,table,input,button,output{font:inherit}svg{color:var(--pencil)}table{border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:6px 10px;text-align:left}th{border-bottom:1px solid var(--rule)}button{color:inherit;padding:6px 14px;border:1px solid var(--rule);border-radius:10px;background:var(--paper);cursor:pointer}button:hover{background:#f4f0f9}button:focus-visible,input:focus-visible{outline:2px solid var(--chalky);outline-offset:2px}input[type=range]{accent-color:var(--chalky)}</style>`;

export function studyPageDocument(html: string): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">${BRIDGE}${BASE_STYLE}`;
  // The policy must come before anything the page supplies, so it's placed ahead of the page's own markup.
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
