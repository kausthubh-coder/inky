// Called only by the disposable-runner installer rehearsal.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, assertStartup } from './verify-macos-first-launch.mjs';

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
  throw new Error('Installed launch proof requires a disposable GitHub-hosted Windows manual run');
}
const [exeArg, profileArg, expectedVersion, mode, outputArg] = process.argv.slice(2);
if (!exeArg || !profileArg || !expectedVersion || !['seed', 'verify'].includes(mode) || !outputArg) throw new Error('Missing native launch arguments');
const exe = resolve(exeArg), profile = resolve(profileArg), output = resolve(outputArg);
await mkdir(profile, { recursive: true });
await mkdir(output, { recursive: true });
await rm(join(profile, 'DevToolsActivePort'), { force: true });
const expectedUrl = pathToFileURL(join(exe, '..', 'resources/app.asar/dist/client/index.html')).href;
const child = spawn(exe, ['--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], {
  stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
});
let launchError, cdp;
child.on('error', error => { launchError = error; });
try {
  const deadline = Date.now() + 60000;
  let state;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error('Installed app exited before proof');
    try {
      if (!cdp) {
        const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing debug port');
        const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2000) })).json();
        const target = targets.find(page => page.type === 'page' && page.url.toLowerCase() === expectedUrl.toLowerCase());
        if (!target) throw new Error('Installed renderer not ready');
        const socketUrl = new URL(target.webSocketDebuggerUrl);
        if (socketUrl.hostname !== '127.0.0.1' || Number(socketUrl.port) !== port) throw new Error('Foreign debug endpoint');
        cdp = await connect(socketUrl.href);
      }
      const response = await cdp.call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => ({
        url: location.href.toLowerCase(), ready: document.readyState, rootRendered: !!document.querySelector('#root')?.innerText.trim(),
        preload: typeof window.studi?.getAuthState === 'function', authResponded: !!(await window.studi?.getAuthState()),
        version: (await window.studi.getRuntimeInfo()).app, preferences: await window.studi.getTelemetryState()
      }))()` });
      state = response.result?.value;
      assertStartup(state, expectedUrl.toLowerCase());
      break;
    } catch { await delay(300); }
  }
  assertStartup(state, expectedUrl.toLowerCase());
  if (state.version !== expectedVersion) throw new Error('Installed version mismatch: ' + state.version);
  if (mode === 'seed') {
    const seeded = await cdp.call('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
      expression: 'window.studi.setTelemetryPreferences({enabled:false,replayEnabled:false})' });
    if (seeded.result?.value?.enabled !== false || seeded.result?.value?.replayEnabled !== false) throw new Error('Failed to save preferences through app IPC');
  } else if (state.preferences.enabled !== false || state.preferences.replayEnabled !== false) {
    throw new Error('Installed upgrade lost the saved privacy preferences');
  }
  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, mode + '-' + expectedVersion + '.png'), Buffer.from(screenshot.data, 'base64'));
  await writeFile(join(output, mode + '-' + expectedVersion + '.json'), JSON.stringify({
    version: state.version, mode, status: 'passed', renderer: state.url, pid: child.pid,
    expected: mode === 'seed' ? 'Baseline saves disabled analytics/replay through production IPC' : 'Installed candidate reads the same disabled analytics/replay after upgrade',
    observed: 'Production renderer and auth IPC ready; application version and privacy preferences verified',
    limits: ['Signed-out native check; authenticated homework and credential migration require the separate live journey'],
  }, null, 2) + '\n');
} finally {
  cdp?.close();
  if (child.pid && child.exitCode === null) child.kill();
  for (let i = 0; i < 30 && child.exitCode === null; i++) await delay(100);
}
