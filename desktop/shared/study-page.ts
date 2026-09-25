/**
 * Wraps a tutor-written study page so it can't reach the network, load other files or leave the frame.
 * The page reports what the student tried with studi.explore("label"); the app turns that into the tool result.
 * Used for the sandboxed iframe (sandbox="allow-scripts", no same-origin) and for the copy saved to the goal folder.
 */
export const STUDY_PAGE_MESSAGE = "studi-study-page";

const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";

// explore() reports what the student tried; the height report lets the frame fit its content (the parent can't measure an opaque-origin page).
const BRIDGE = `<script>(function(){var t=${JSON.stringify(STUDY_PAGE_MESSAGE)};function send(m){try{parent.postMessage(Object.assign({type:t},m),"*")}catch(e){}}window.studi={explore:function(label){send({label:String(label).slice(0,200)})}};function size(){send({height:document.documentElement.scrollHeight})}addEventListener("load",function(){size();if(window.ResizeObserver)new ResizeObserver(size).observe(document.body)})})();</script>`;

const BASE_STYLE = `<style>html{color-scheme:light}body{margin:0;padding:16px;font:15px/1.5 "Nunito Sans",system-ui,sans-serif;color:#2b2621;background:#fffdf8}button{font:inherit;color:inherit;padding:6px 14px;border:1px solid #2b2621;border-radius:10px;background:#efe6d8;cursor:pointer}button:hover{background:#e6dac8}</style>`;

export function studyPageDocument(html: string): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">${BRIDGE}${BASE_STYLE}`;
  // The policy must come before anything the page supplies, so it's placed ahead of the page's own markup.
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
