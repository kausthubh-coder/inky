import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { BrowserController } from '../../dist/electron/browser/controller.js';
import { createBrowserDownloadTool } from '../../dist/electron/browser/downloads.js';
import { createBrowserTools } from '../../dist/electron/browser/tools.js';
import { HomeworkFiles } from '../../dist/electron/files/homework-files.js';
import { createPdfReadTool } from '../../dist/electron/files/pdf-tool.js';
import { schoolPdf } from './school-pdf.mjs';

const root = process.env.STUDI_MATERIALS_QA_ROOT;
assert.ok(root, 'Run this fixture through school-materials-native.cjs');
const evidence = resolve('.agents/studi-qa/materials');
await mkdir(evidence, { recursive: true });
const server = createServer((request, response) => {
  if (request.url === '/' || request.url === '/work') {
    response.setHeader('content-type', 'text/html');
    response.end('<h1>Exercise 6</h1><p>Read the description and save answer.txt in your assignment folder. Keep the source files for review. No upload is required.</p><a href="/redirect">Exercise 6 Description PDF</a><a href="/starter.txt">Starter file</a>' + (request.url === '/' ? '<a href="/login">Unavailable attachment</a>' : ''));
    return;
  }
  if (!request.headers.cookie?.includes('qa_school=allowed') || request.url === '/login') {
    response.setHeader('content-type', 'text/html'); response.end('<h1>Please sign in</h1>'); return;
  }
  if (request.url === '/redirect') { response.writeHead(302, { location: '/exercise.pdf' }); response.end(); return; }
  if (request.url === '/exercise.pdf') {
    response.setHeader('content-type', 'application/pdf');
    response.setHeader('content-disposition', 'inline; filename="Exercise 6.pdf"');
    response.end(schoolPdf()); return;
  }
  response.setHeader('content-type', 'text/plain'); response.end('starter = 2 + 3');
});
let window;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await app.whenReady();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const school = session.fromPartition('qa-school-materials');
  await school.cookies.set({ url: origin, name: 'qa_school', value: 'allowed', httpOnly: true });
  window = new BrowserWindow({ show: false, width: 900, height: 850, webPreferences: { session: school, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const browser = new BrowserController(window.webContents);
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) browser.pageChanged(); });
  await mkdir(join(root, 'homework'));
  const files = await HomeworkFiles.open(join(root, 'homework'));
  const download = createBrowserDownloadTool(browser, files);
  let snapshot = await browser.navigate(origin);
  const ref = snapshot.elements.find(e => e.name === 'Exercise 6 Description PDF').ref;
  const result = await download.execute('download', { ref });
  console.log('Native: authenticated redirect download passed');
  assert.equal(result.details.path, 'materials/Exercise 6.pdf');
  const reader = createPdfReadTool(files);
  const textPage = await reader.execute('text', { path: result.details.path });
  assert.match(textPage.content[0].text, /Add 2 and 3/);
  const imagePage = await reader.execute('scan', { path: result.details.path, page: 2 });
  assert.match(imagePage.content[0].text, /No extractable text/);
  for (const [label, result] of [['text-page', textPage], ['image-page', imagePage]]) {
    await writeFile(join(evidence, `${label}.png`), Buffer.from(result.content.find(c => c.type === 'image').data, 'base64'));
  }
  snapshot = await browser.snapshot();
  const starter = await download.execute('starter', { ref: snapshot.elements.find(e => e.name === 'Starter file').ref });
  console.log('Native: PDF rendering and starter download passed');
  assert.equal((await files.read(starter.details.path)).content, 'starter = 2 + 3');
  snapshot = await browser.snapshot();
  await assert.rejects(download.execute('login', { ref: snapshot.elements.find(e => e.name === 'Unavailable attachment').ref }), /web page/);
  await assert.rejects(download.execute('stale', { ref }), /Stale/);
  const { createScanMaterialReader } = await import('../../dist/electron/scan/materials.js');
  const { openLocalStore } = await import('../../dist/electron/storage/index.js');
  const { initializeHomeworkWorkspace } = await import('../../dist/electron/files/workspace.js');
  const scanStore = await openLocalStore(join(root, 'scan-store'));
  try {
    const homeworkRoot = join(root, 'scan-homework');
    await mkdir(homeworkRoot);
    await initializeHomeworkWorkspace(homeworkRoot);
    await scanStore.productPreferences.put({ ...await scanStore.productPreferences.get(), homeworkRoot });
    const capturedAt = new Date().toISOString();
    const assignment = { schemaVersion: 1, assignmentId: 'scan-assignment', courseId: 'scan-course', title: 'Exercise 6', sourceTarget: `${origin}/work`, discoveredAt: capturedAt, evidence: [] };
    scanStore.assignments.put(assignment);
    let active = true;
    const scanPdf = createScanMaterialReader({ store: scanStore, browser, now: () => capturedAt, observe: () => browser.snapshot(), scan: () => {
      if (!active) throw new Error('Scan stopped');
      return { scanId: 'native-pdf', observedAssignmentIds: [assignment.assignmentId] };
    } });
    const linked = await browser.navigate(`${origin}/work`);
    const first = await scanPdf.tool.execute('scan-pdf', { assignmentId: assignment.assignmentId, ref: linked.elements.find(e => e.name === 'Exercise 6 Description PDF').ref });
    assert.match(first.content[0].text, /Add 2 and 3/);
    assert.equal(browser.state.url, `${origin}/work`, 'reading preserves the assignment page');
    const evidence = scanPdf.resolveExcerpt(first.details.sourceRef, assignment.assignmentId, 'Add 2 and 3');
    assert.equal(evidence.kind, 'document');
    assert.match(evidence.digest, /^sha256:/);
    assert.throws(() => scanPdf.resolveExcerpt(first.details.sourceRef, assignment.assignmentId, 'invented instruction'), /Quote the attachment/);
    assert.throws(() => scanPdf.resolveExcerpt(first.details.sourceRef, 'other-assignment', 'Add 2 and 3'), /this assignment/);
    const second = await scanPdf.tool.execute('scan-page-two', { assignmentId: assignment.assignmentId, documentId: first.details.documentId, page: 2, image: true });
    assert.equal(second.details.pages, 2);
    assert.ok(second.content.some(item => item.type === 'image'));
    assert.match(scanPdf.resolveExcerpt(second.details.sourceRef, assignment.assignmentId, 'Transcribed image text').summary, /Visual transcription/);
    const textLink = await browser.snapshot();
    const plain = await scanPdf.tool.execute('scan-text', { assignmentId: assignment.assignmentId, ref: textLink.elements.find(e => e.name === 'Starter file').ref });
    assert.match(plain.content[0].text, /starter = 2 \+ 3/);
    assert.equal(scanPdf.resolveExcerpt(plain.details.sourceRef, assignment.assignmentId, 'starter = 2 + 3').kind, 'document');
    active = false;
    await assert.rejects(scanPdf.tool.execute('stopped', { assignmentId: assignment.assignmentId, documentId: first.details.documentId }), /Scan stopped/);
    console.log('Native: scan PDF provenance, images, scope, page reuse and cancellation passed');
  } finally { scanStore.close(); }
  console.log('Native: login and stale-link recovery passed; opening original PDF viewer');
  let viewerNavigation = 'loaded';
  try { await browser.navigate(`${origin}/exercise.pdf`); }
  catch (error) {
    assert.match(error.message, /did not finish|timed out/);
    viewerNavigation = error.message;
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
  let viewerCapture = 'captured; inspect browser-pdf.jpg for readability';
  try {
    const screenshot = await createBrowserTools(browser).find(t => t.name === 'browser_screenshot').execute('viewer', {});
    await writeFile(join(evidence, 'browser-pdf.jpg'), Buffer.from(screenshot.content[0].data, 'base64'));
  } catch (error) {
    assert.match(error.message, /timed out|unavailable/);
    viewerCapture = error.message;
  }
  console.log(`Native viewer: ${viewerCapture}`);
  const current = await download.execute('current', {});
  assert.equal(current.details.path, 'materials/Exercise 6 (1).pdf');
  await school.clearStorageData();
  await assert.rejects(download.execute('signed-out', {}), /web page/);
  const receipt = { mode: 'controlled native Electron', electron: process.versions.electron, node: process.versions.node, profile: root, viewerNavigation, viewerCapture, passed: ['signed-in download from observed link', 'redirect with session cookie', 'duplicate preservation', 'starter file', 'PDF text and image-only page', 'stale link rejection', 'HTML/login rejection', 'current-document download', 'scan PDF/text provenance and assignment isolation', 'scan image-page transcription and cancellation'], notRun: ['real Moodle', 'macOS package'] };
  await writeFile(join(evidence, 'native.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  if (process.argv.includes('--live-agent')) {
    await school.cookies.set({ url: origin, name: 'qa_school', value: 'allowed', httpOnly: true });
    const { runMaterialsAgentProbe } = await import('./materials-agent-probe.mjs');
    await runMaterialsAgentProbe(browser, `${origin}/work`, root, evidence);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  window?.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  app.exit(process.exitCode ?? 0);
}
