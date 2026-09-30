import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startLms } from '../../../.studi-lms/build/server.mjs';
import { gradeWork } from '../grade-work.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STUDI_PLAYWRIGHT_PATH ?? 'playwright');
const evidence = resolve('.agents/studi-qa/lms-proof', `work-${randomUUID()}`);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.STUDI_CHROMIUM_PATH ? { executablePath: process.env.STUDI_CHROMIUM_PATH } : {}) });
const results = [];
try {
  for (const [scenarioId, activityId] of [['coding-multifile', 'rainfall-project'], ['quiz', 'structures-quiz']]) {
    const school = await startLms({ scenarioId, runDirectory: join(evidence, scenarioId) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${school.url}/assignments/${activityId}`);
      const answer = scenarioId === 'quiz' ? 'Q1: B\nQ2: A\nQ3: O(n)' : 'Synthetic delivery fixture: source correctness is not evaluated by this browser test.';
      await page.getByLabel('Your response').fill(answer);
      if (scenarioId === 'coding-multifile') await page.getByLabel('Attach files').setInputFiles(
        ['main.c', 'stats.c', 'stats.h', 'README.md'].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`Synthetic file: ${name}`) })),
      );
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Draft saved' }).waitFor();
      assert.equal(school.inspect().state.submissions.length, 0);
      await page.reload();
      assert.equal(await page.getByLabel('Your response').inputValue(), answer);
      await page.getByRole('button', { name: 'Submit assignment', exact: true }).click();
      await page.getByRole('heading', { name: 'Submission history', exact: true }).waitFor();
      const grade = gradeWork(school.inspect(), activityId);
      assert.equal(grade.outcome, scenarioId === 'quiz' ? 'passed' : 'incomplete');
      assert.equal(school.inspect().state.submissions.length, 1);
      await page.screenshot({ path: join(evidence, `${scenarioId}.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      results.push({ scenarioId, browserFlow: 'passed', grade });
    } finally { await context.close(); await school.close(); }
  }
} finally { await browser.close(); }
await writeFile(join(evidence, 'result.json'), JSON.stringify({ evidence: 'controlled-browser', results }, null, 2));
console.log(JSON.stringify({ evidence, results }));
