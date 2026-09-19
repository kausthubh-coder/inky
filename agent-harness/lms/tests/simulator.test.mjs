import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLms } from "../../../.studi-lms/build/server.mjs";
import { gradeWork } from "../grade-work.mjs";
import {
  importPrivateAssets,
  readPrivateAsset,
} from "../../../.studi-lms/build/assets.mjs";

async function school(t, scenarioId = "smoke") {
  const runDirectory = await mkdtemp(join(tmpdir(), "studi-lms-test-"));
  const server = await startLms({ runDirectory, scenarioId });
  t.after(() => server.close());
  return { server, runDirectory };
}
async function fields(url) {
  const response = await fetch(url),
    html = await response.text();
  const values = {};
  for (const input of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(input[0])?.[1],
      value = /value="([^"]*)"/.exec(input[0])?.[1];
    if (name) values[name] = value;
  }
  return { values, html, status: response.status };
}
async function post(url, values, files = []) {
  const body = new FormData();
  for (const [key, value] of Object.entries(values))
    body.append(key, String(value));
  for (const file of files)
    body.append(
      "files",
      new Blob([file.text], { type: file.mime ?? "text/plain" }),
      file.name,
    );
  return fetch(url, { method: "POST", body, redirect: "manual" });
}

test("multi-file coding work rejects a missing named source, preserves drafts and survives restart", async (t) => {
  const { server, runDirectory } = await school(t, "coding-multifile");
  const url = `${server.url}/assignments/rainfall-project`;
  const initial = await fields(url);
  assert.match(initial.html, /stats\.c/);
  assert.match(await (await fetch(`${server.url}/files/stats-header`)).text(), /double mean/);
  const files = ['main.c', 'stats.h', 'README.md'].map(name => ({ name, text: `synthetic ${name}` }));
  assert.equal((await post(url, { ...initial.values, action: 'submit', answer: 'My project' }, files)).status, 400);
  assert.equal(server.inspect().state.submissions.length, 0);
  assert.equal(server.inspect().state.drafts['rainfall-project'].files.length, 3);
  await server.close();
  const resumed = await startLms({ runDirectory, resume: true });
  t.after(() => resumed.close());
  const resumedUrl = `${resumed.url}/assignments/rainfall-project`;
  const saved = await fields(resumedUrl);
  assert.equal((await post(resumedUrl, { ...saved.values, action: 'submit', answer: 'My project' }, [{ name: 'stats.c', text: 'synthetic source' }])).status, 303);
  const result = gradeWork(resumed.inspect(), 'rainfall-project');
  assert.deepEqual(result.missing, []);
  assert.equal(result.draftBeforeSubmit, true);
  assert.equal(result.outcome, 'incomplete'); // Delivery cannot establish code correctness.
});

test("quiz grades committed answers independently; wrong work and exhausted attempts cannot pass", async (t) => {
  const { server } = await school(t, 'quiz');
  const url = `${server.url}/assignments/structures-quiz`;
  const initial = await fields(url);
  assert.doesNotMatch(initial.html, /expectedAnswers|answerKey|correctAnswers/);
  assert.equal(gradeWork(server.inspect(), 'structures-quiz').outcome, 'failed');
  const wrong = 'Q1: A\nQ2: B\nQ3: O(1)';
  await post(url, { ...initial.values, action: 'save', answer: wrong });
  assert.equal(server.inspect().state.submissions.length, 0);
  let form = (await fields(url)).values;
  assert.equal((await post(url, { ...form, action: 'submit', answer: wrong })).status, 303);
  assert.equal(gradeWork(server.inspect(), 'structures-quiz').correct, 0);
  form = (await fields(url)).values;
  const answer = 'Q1: B\nQ2: A\nQ3: O(n)';
  assert.equal((await post(url, { ...form, action: 'submit', answer })).status, 303);
  const result = gradeWork(server.inspect(), 'structures-quiz');
  assert.equal(result.outcome, 'passed');
  assert.equal(result.correct, 3);
  // Same idempotency key replays; a new third attempt is blocked.
  assert.equal((await post(url, { ...form, action: 'submit', answer })).status, 303);
  assert.equal((await post(url, { ...form, key: 'third-attempt', revision: '3', action: 'submit', answer })).status, 409);
  assert.equal(server.inspect().state.submissions.length, 2);
});

test('corrected coding files replace draft versions instead of making submission unrecoverable', async (t) => {
  const { server } = await school(t, 'coding-multifile');
  const url = `${server.url}/assignments/rainfall-project`;
  const initial = await fields(url);
  const files = ['main.c', 'stats.c', 'stats.h', 'README.md'].map(name => ({ name, text: 'first draft' }));
  assert.equal((await post(url, { ...initial.values, action: 'save', answer: 'Draft' }, files)).status, 303);
  const form = (await fields(url)).values;
  assert.equal((await post(url, { ...form, action: 'submit', answer: 'Corrected' }, [{ name: 'stats.c', text: 'corrected draft' }])).status, 303);
  const submission = server.inspect().state.submissions[0];
  assert.equal(submission.files.length, 4);
  const source = submission.files.find(file => file.name === 'stats.c');
  assert.equal(await (await fetch(`${server.url}/uploads/rainfall-project/${source.hash}`)).text(), 'corrected draft');
});

test("draft, response, upload and receipt survive server restart; replay submits once", async (t) => {
  const { server, runDirectory } = await school(t);
  let url = `${server.url}/assignments/observation`;
  const initial = await fields(url);
  assert.equal(
    (
      await post(
        url,
        {
          ...initial.values,
          action: "save",
          answer: "Rain tapped the blue window.",
        },
        [{ name: "notes.txt", text: "Draft evidence" }],
      )
    ).status,
    303,
  );
  assert.equal(server.inspect().state.submissions.length, 0);
  await server.close();
  const resumed = await startLms({ runDirectory, resume: true });
  t.after(() => resumed.close());
  url = `${resumed.url}/assignments/observation`;
  const saved = await fields(url);
  assert.match(saved.html, /Rain tapped the blue window/);
  assert.match(saved.html, /notes.txt/);
  const form = {
    ...saved.values,
    action: "submit",
    answer:
      "Rain tapped the blue window. Water rattled outside. Clouds covered the sky.",
  };
  assert.equal((await post(url, form)).status, 303);
  assert.equal((await post(url, form)).status, 303);
  const state = resumed.inspect().state;
  assert.equal(state.submissions.length, 1);
  assert.equal(state.submissions[0].files.length, 1);
  assert.match((await fields(url)).html, new RegExp(state.submissions[0].id));
  assert.equal((await post(url, { ...form, answer: "changed" })).status, 409);
});

test("lost response happens after commit and retry returns the same receipt", async (t) => {
  const { server } = await school(t, "lost-submit-response");
  const url = `${server.url}/assignments/observation`,
    { values } = await fields(url);
  const form = { ...values, action: "submit", answer: "A sound and a color." };
  assert.equal((await post(url, form)).status, 503);
  const receipt = server.inspect().state.submissions[0].id;
  assert.equal((await post(url, form)).status, 303);
  assert.equal(server.inspect().state.submissions.length, 1);
  assert.equal(server.inspect().state.submissions[0].id, receipt);
});

test("stale drafts cannot overwrite newer work; missing deliverables preserve input", async (t) => {
  const { server } = await school(t, "semester");
  const url = `${server.url}/assignments/final-game`,
    { values } = await fields(url);
  const response = await post(
    url,
    { ...values, answer: "My completed game", action: "submit" },
    [{ name: "game.html", text: "<h1>Local game</h1>" }],
  );
  assert.equal(response.status, 400);
  assert.equal(server.inspect().state.submissions.length, 0);
  assert.equal(
    server.inspect().state.drafts["final-game"].answer,
    "My completed game",
  );
  assert.equal(server.inspect().state.drafts["final-game"].files.length, 1);
  assert.equal(
    (await post(url, { ...values, answer: "stale", action: "save" })).status,
    409,
  );
  const current = await fields(url);
  assert.equal(
    (
      await post(
        url,
        { ...current.values, answer: "My completed game", action: "submit" },
        [
          {
            name: "README.pdf",
            mime: "application/pdf",
            text: "%PDF-1.4 simulated upload",
          },
        ],
      )
    ).status,
    303,
  );
  const file = server
    .inspect()
    .state.submissions[0].files.find((item) => item.name === "game.html");
  const download = await fetch(`${server.url}/uploads/final-game/${file.hash}`);
  assert.equal(
    download.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.match(download.headers.get("content-disposition"), /attachment/);
});

test("source cases expose statuses, requirements, date-only dates, late rules and aliases", async (t) => {
  const { server } = await school(t, "scan-regression");
  assert.equal(server.inspect().state.activities.length, 9);
  assert.match(
    (await fields(`${server.url}/assignments/exercise-06`)).html,
    /Submitted; not yet graded/,
  );
  assert.doesNotMatch(
    (await fields(`${server.url}/assignments/exercise-06`)).html,
    /name="answer"/,
  );
  assert.match(
    (await fields(`${server.url}/assignments/exercise-07`)).html,
    /Graded: 92/,
  );
  assert.match(
    (await fields(`${server.url}/assignments/closed-exercise`)).html,
    /Late submissions are not accepted/,
  );
  assert.match(
    (await fields(`${server.url}/assignments/late-exercise`)).html,
    /Late submissions are accepted until/,
  );
  const dateOnly = await fields(`${server.origins.statistics}/assignments/hw8`);
  assert.match(dateOnly.html, /exact time unavailable/);
  const dueField = /<p><strong>Due:<\/strong>[\s\S]*?<\/p>/.exec(dateOnly.html)?.[0];
  assert.ok(dueField, "The assignment must expose its due-date field");
  assert.doesNotMatch(dueField, /<time/);
  const extended = await fields(`${server.origins.statistics}/assignments/hw5`);
  assert.match(extended.html, /<p><strong>Due:<\/strong>\s*<time dateTime="2026-09-17T03:59:00.000Z"/);
  assert.match(extended.html, /personal extension/);
  assert.match(extended.html, /One extension has now been used/);
  assert.match(
    (await fields(`${server.url}/assignments/final-game`)).html,
    /README PDF with instructions and an all-level walkthrough/,
  );
  const alias = await fetch(`${server.url}/course/view.php?id=programming`);
  assert.equal(alias.url, `${server.url}/courses/programming`);
});

test("vendor sign-in and runs are independent; public pages cannot inspect control data", async (t) => {
  const a = await school(t, "partial-login"),
    b = await school(t, "smoke");
  assert.equal(new Set(Object.values(a.server.origins)).size, 4);
  assert.match(
    (await fields(`${a.server.origins.statistics}/assignments/hw5`)).html,
    /Sign in to your course site/,
  );
  assert.equal((await fields(`${a.server.url}/courses`)).status, 200);
  const login = await fields(`${a.server.origins.statistics}/login`);
  assert.equal(
    (await post(`${a.server.origins.statistics}/login`, login.values)).status,
    303,
  );
  assert.equal(a.server.inspect().state.sessions.statistics, true);
  assert.equal(a.server.inspect().state.sessions.feedback, false);
  const fullAnnouncements = await fields(`${a.server.url}/announcements`),
    smokeAnnouncements = await fields(`${b.server.url}/announcements`),
    emptyVendor = await fields(b.server.origins.statistics);
  assert.match(fullAnnouncements.html, /href="\/assignments\/partners"/);
  assert.doesNotMatch(smokeAnnouncements.html, /\/assignments\/partners/);
  assert.match(emptyVendor.html, /data-assignment-list/);
  assert.match(emptyVendor.html, /No assignments are published on this site/);
  const logout = await fields(`${a.server.url}/account`);
  await post(`${a.server.url}/logout`, logout.values);
  assert.equal(a.server.inspect().state.sessions.school, false);
  assert.equal(b.server.inspect().state.sessions.school, true);
  for (const path of [
    "/truth",
    "/inspect",
    "/control/reset",
    "/state",
    "/manifest",
    "/_control",
  ])
    assert.equal((await fetch(`${b.server.url}${path}`)).status, 404);
  const html = (await fields(b.server.url)).html;
  assert.doesNotMatch(
    html,
    /expectedActionableIds|school\.sqlite|runDirectory|idempotencyKey/,
  );
});

test("prerequisites gate direct actions and unlock after saved completion", async (t) => {
  const { server } = await school(t, "workshop-unlock");
  const review = `${server.url}/assignments/stack-review`;
  assert.match((await fields(review)).html, /Locked: prerequisites incomplete/);
  const lesson = await fields(`${server.url}/assignments/stack-lesson`);
  assert.equal(
    (
      await post(
        `${server.url}/assignments/stack-lesson/complete`,
        lesson.values,
      )
    ).status,
    303,
  );
  const unlocked = await fields(review);
  assert.doesNotMatch(unlocked.html, /Locked: prerequisites incomplete/);
  assert.equal(
    (
      await post(review, {
        ...unlocked.values,
        action: "submit",
        answer: "A stack is last in first out; a queue is first in first out.",
      })
    ).status,
    303,
  );
  assert.doesNotMatch(
    (await fields(`${server.url}/assignments/workshop-3`)).html,
    /Locked: prerequisites incomplete/,
  );
});

test("interrupted scan retries once and saved event/clock changes survive restart", async (t) => {
  const { server, runDirectory } = await school(t, "interrupted-scan");
  assert.equal((await fetch(`${server.url}/courses/structures`)).status, 503);
  assert.equal((await fetch(`${server.url}/courses/structures`)).status, 200);
  server.advance("next-week");
  const before = server.inspect();
  assert.equal(
    before.state.activities.some((item) => item.id === "closed-exercise"),
    false,
  );
  assert.equal(
    before.state.activities.some((item) => item.id === "exercise-08"),
    true,
  );
  await server.close();
  const resumed = await startLms({ runDirectory, resume: true });
  t.after(() => resumed.close());
  assert.deepEqual(resumed.inspect(), before);
  assert.deepEqual(
    before.effects.map((item) => item.sequence),
    before.effects.map((_, index) => index + 1),
  );
});

test("synthetic PDF downloads support byte ranges and private import validates hashes", async (t) => {
  const { server } = await school(t);
  const full = await fetch(`${server.url}/files/writing-guide`);
  assert.equal(full.headers.get("content-type"), "application/pdf");
  assert.match(await full.text(), /^%PDF-1\.4/);
  const range = await fetch(`${server.url}/files/writing-guide`, {
    headers: { Range: "bytes=0-7" },
  });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "%PDF-1.4");
  assert.equal(
    (
      await fetch(`${server.url}/files/writing-guide`, {
        headers: { Range: "bytes=999999-" },
      })
    ).status,
    416,
  );
  const root = await mkdtemp(join(tmpdir(), "studi-private-assets-"));
  await writeFile(join(root, "worksheet.txt"), "Private local worksheet");
  const manifest = join(root, "manifest.json"),
    library = join(root, "library");
  await writeFile(
    manifest,
    JSON.stringify({
      assets: [
        { id: "writing-guide", path: "worksheet.txt", mime: "text/plain" },
      ],
    }),
  );
  const pack = await importPrivateAssets(manifest, library);
  assert.equal(
    (await readPrivateAsset(library, pack.assets[0])).toString(),
    "Private local worksheet",
  );
  await writeFile(join(library, pack.assets[0].relativePath), "tampered");
  await assert.rejects(
    readPrivateAsset(library, pack.assets[0]),
    /hash mismatch/,
  );
  await writeFile(
    manifest,
    JSON.stringify({
      assets: [
        { id: "bad", path: "worksheet.txt", mime: "text/plain", sha256: "bad" },
      ],
    }),
  );
  await assert.rejects(importPrivateAssets(manifest, library), /hash mismatch/);
});

test("same seed reproduces initial state; unsafe origin and fabricated success are rejected", async (t) => {
  const a = await school(t),
    b = await school(t);
  assert.deepEqual(a.server.inspect().state, b.server.inspect().state);
  const url = `${a.server.url}/assignments/observation`,
    { values } = await fields(url);
  const body = new URLSearchParams({
    ...values,
    action: "submit",
    answer: "Unsafe origin",
  });
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        body,
        headers: { Origin: "https://unrelated.example" },
      })
    ).status,
    403,
  );
  assert.doesNotMatch(
    (await fields(`${url}?saved=submit`)).html,
    /Submission received/,
  );
  assert.equal(a.server.inspect().state.submissions.length, 0);
});
