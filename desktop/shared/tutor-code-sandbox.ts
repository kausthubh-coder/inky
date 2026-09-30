/**
 * Mount as iframe srcDoc with sandbox="allow-scripts" (NEVER allow-same-origin).
 * Parent posts {channel:'studi-tutor-code',runId,code,timeoutMs}; verify event.source
 * equals that iframe.contentWindow before accepting its result. Execution happens
 * only in a disposable browser Worker. CSP denies external resources and network.
 */
export const TUTOR_CODE_SANDBOX_HTML = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
<script>
let active = null;
const workerSource = \`
for (const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','BroadcastChannel','indexedDB','caches']) {
  Object.defineProperty(self,name,{value:undefined,writable:false,configurable:false});
}
self.onmessage = async event => {
  const logs = [];
  const record = (...values) => {
    if (logs.length < 50) logs.push(values.map(value => {
      try { return typeof value === 'string' ? value.slice(0,2000) : String(JSON.stringify(value)).slice(0,2000); }
      catch { return '[unprintable]'; }
    }).join(' ').slice(0,2000));
  };
  Object.defineProperty(self,'console',{value:Object.freeze({log:record,warn:record,error:record,info:record}),writable:false});
  try {
    const result = await new Function('"use strict";' + event.data.code)();
    if (result !== undefined) record(result);
    self.postMessage({outcome:'completed',logs});
  } catch (error) { self.postMessage({outcome:'failed',logs,error:String(error && error.message || error).slice(0,2000)}); }
};
\`;
addEventListener('message', event => {
  if (event.source !== parent || !event.data || event.data.channel !== 'studi-tutor-code') return;
  const {runId,code,timeoutMs} = event.data;
  if (typeof runId !== 'string' || runId.length > 100 || typeof code !== 'string' || code.length > 12000) return;
  if (active) active();
  const url = URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  let done = false;
  const finish = result => {
    if (done) return; done = true; clearTimeout(timer); worker.terminate(); active = null;
    parent.postMessage({channel:'studi-tutor-code',runId,...result},'*');
  };
  const timer = setTimeout(() => finish({outcome:'timed_out',logs:[],error:'The code exceeded its time limit.'}),Math.max(50,Math.min(1000,Number(timeoutMs)||1000)));
  active = () => finish({outcome:'cancelled',logs:[]});
  worker.onmessage = message => {
    const value = message.data;
    if (!value || !['completed','failed'].includes(value.outcome)) return;
    finish({outcome:value.outcome,logs:Array.isArray(value.logs)?value.logs.slice(0,50).map(line=>String(line).slice(0,2000)):[],error:typeof value.error==='string'?value.error.slice(0,2000):null});
  };
  worker.onerror = () => finish({outcome:'failed',logs:[],error:'The code could not run.'});
  worker.postMessage({code});
});
</script>`;
