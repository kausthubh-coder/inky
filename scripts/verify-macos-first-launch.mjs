// Native CI only. Starts the exact app on the read-only DMG with a fresh profile.
// This proves packaged startup/renderer/preload IPC, not authentication or a journey.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, release } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export function assertNativeRunner(env = process.env, platform = process.platform) {
  if (platform !== 'darwin' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')) {
    throw new Error('Native launch requires a disposable GitHub-hosted macOS runner and source/run identity');
  }
}

export function assertStartup(state, expectedUrl) {
  if (!state || state.url !== expectedUrl || state.ready !== 'complete' || !state.rootRendered
    || !state.preload || !state.authResponded) throw new Error('Packaged renderer or preload/auth IPC is not ready');
}

export async function connect(url) {
  const socket = new WebSocket(url), pending = new Map();
  let id = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), call = pending.get(message.id);
    if (call) {
      pending.delete(message.id); clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
    }
  });
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
  });
  return {
    call(method, params = {}) {
      return new Promise((resolveCall, reject) => {
        const callId = ++id;
        const timer = setTimeout(() => { pending.delete(callId); reject(new Error('CDP timeout: ' + method)); }, 5000);
        pending.set(callId, { resolve: resolveCall, reject, timer });
        socket.send(JSON.stringify({ id: callId, method, params }));
      });
    },
    close() {
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('CDP closed')); }
      pending.clear(); socket.close();
    },
  };
}

async function main() {
  assertNativeRunner();
  const [appArg, imageArg, outputArg] = process.argv.slice(2);
  if (!appArg || !imageArg || !outputArg) throw new Error('Supply mounted app, staged DMG and receipt directory');
  const app = resolve(appArg), image = resolve(imageArg), output = resolve(outputArg);
  const expectedUrl = pathToFileURL(join(app, 'Contents/Resources/app.asar/dist/client/index.html')).href;
  const profile = await mkdtemp(join(tmpdir(), 'studi-native-macos-'));
  await mkdir(output, { recursive: true });
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(image)) digest.update(chunk);
  const receipt = {
    checkId: 'macos-package-smoke', status: 'failed', sourceRevision: process.env.GITHUB_SHA,
    artifactRunId: Number(process.env.GITHUB_RUN_ID), runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    assets: [{ name: 'Studi-macOS.dmg', sha256: digest.digest('hex') }],
    host: { platform: process.platform, architecture: process.arch, osRelease: release() },
    observations: [], limits: { liveAuth: 'not_run', fullNativeJourney: 'not_run',
      otherArchitectureExecution: 'not_run', gatekeeperAndNotarization: 'not_run' },
  };
  const child = spawn(join(app, 'Contents/MacOS/Studi'), [
    '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  ], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  let launchError;
  child.on('error', error => { launchError = error; });
  let cdp;
  try {
    const deadline = Date.now() + 60000;
    let state;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Packaged app exited before first-launch proof');
      try {
        if (!cdp) {
          const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing debug port');
          const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2000) });
          const target = (await response.json()).find(page => page.type === 'page' && page.url === expectedUrl);
          if (!target) throw new Error('Packaged renderer not loaded');
          const socketUrl = new URL(target.webSocketDebuggerUrl);
          if (socketUrl.hostname !== '127.0.0.1' || Number(socketUrl.port) !== port) throw new Error('Unexpected debug target');
          cdp = await connect(socketUrl.href);
        }
        const result = await cdp.call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
          (async () => ({ url: location.href, ready: document.readyState,
            rootRendered: !!document.querySelector('#root')?.innerText.trim(),
            preload: typeof window.studi?.getAuthState === 'function',
            authResponded: !!(await window.studi?.getAuthState()) }))()` });
        state = result.result?.value;
        assertStartup(state, expectedUrl);
        break;
      } catch { await delay(300); }
    }
    assertStartup(state, expectedUrl);
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, 'first-launch.png'), Buffer.from(screenshot.data, 'base64'));
    receipt.observations.push(
      { status: 'passed', expected: 'Read-only DMG contains the built universal app and matching archive/native modules',
        observed: 'verify-macos-dmg.sh verified image, mounted read-only, checked x86_64/arm64 and compared packaged bytes before this launch' },
      { status: 'passed', expected: 'Native packaged renderer renders and production preload answers auth-state IPC in a fresh profile',
        observed: 'Exact DMG app renderer loaded with nonempty React root; auth-state IPC responded; first-launch.png captured. No login attempted.' },
    );
    receipt.status = 'passed';
  } catch (error) {
    receipt.failure = error.message;
    throw error;
  } finally {
    cdp?.close();
    // Only the child launched here; no name-based kill and no everyday profile.
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await writeFile(join(output, 'macos-package-smoke.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
