import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { publicState, completeOnboarding, withLmsApp } from "./harness.mjs";

test("study page in Electron cannot reach network, app origin, navigation, forms or popups", async () => {
  const requests = [];
  const server = createServer((request, response) => { requests.push(request.url); response.writeHead(200); response.end("ok"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const html = `<img src="${endpoint}/image"><script src="${endpoint}/external"></script>
      <form action="${endpoint}/form" method="POST"><button>Submit</button></form>
      <div id="size" style="height:410px"></div>
      <button id="explore" onclick="studi.explore('x');document.querySelector('#size').style.height='900px'">Explore</button>
      <script>
        window.proof={};
        fetch('${endpoint}/fetch').then(()=>proof.fetch='resolved',()=>proof.fetch='blocked');
        try {var xhr=new XMLHttpRequest();xhr.open('GET','${endpoint}/xhr');xhr.send();proof.xhr='sent'} catch(e){proof.xhr='blocked'}
        try {top.location='${endpoint}/top';proof.top='assigned'} catch(e){proof.top='blocked'}
        try {parent.location='${endpoint}/parent';proof.parent='assigned'} catch(e){proof.parent='blocked'}
        try {proof.storage=localStorage.getItem('studi-sandbox-secret')} catch(e){proof.storage='blocked'}
        try {proof.cookie=document.cookie} catch(e){proof.cookie='blocked'}
        try {document.querySelector('form').submit();proof.form='called'} catch(e){proof.form='blocked'}
        try {proof.popup=window.open('${endpoint}/popup') ? 'opened':'blocked'} catch(e){proof.popup='blocked'}
      </script>`;
    await withLmsApp({ scenario: "learn", script: { scan: [[
      { op: "tool", name: "browser_snapshot" },
      { op: "tool", name: "scan_record_course", input: { label: "Data Structures" } },
    ]], learning: [[
      { op: "tool", name: "tutor_advance", input: { phase: "learn" } },
      { op: "tool", name: "tutor_show_page", input: { title: "Sandbox proof", purpose: "Check the study page boundary", html } },
    ]] } }, async ({ page, school }) => {
      await completeOnboarding(page, school.url);
      await page.evaluate(() => localStorage.setItem("studi-sandbox-secret", "app-private-value"));
      await page.getByRole("button", { name: "Learn", exact: true }).click();
      const goal = await publicState(page, "setLearnExam", { courseId: null, title: "Sandbox proof", date: null, kind: "topic" });
      const topic = goal.plan.todayTopic;
      assert.ok(topic);
      await page.getByRole("button", { name: "Homework", exact: true }).click();
      await page.getByRole("button", { name: "Learn", exact: true }).click();
      const session = await publicState(page, "startTutorSession", { topicId: topic.topicId, minutes: 2 });
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const frame = page.frameLocator('iframe[title="Sandbox proof"]');
      await frame.locator("#explore").waitFor();
      const appUrl = page.url();
      const initialHeight = await page.locator('iframe[title="Sandbox proof"]').evaluate(node => node.getBoundingClientRect().height);
      assert.ok(initialHeight >= 420 && initialHeight < 640, `Initial frame height ${initialHeight}`);
      await frame.locator("#explore").click();
      await page.waitForFunction(() => document.querySelector('iframe[title="Sandbox proof"]').getBoundingClientRect().height === 640);
      const proof = await frame.locator("body").evaluate(() => window.proof);
      assert.equal(proof.fetch, "blocked");
      assert.equal(proof.storage, "blocked");
      assert.notEqual(proof.cookie, "app-private-value");
      assert.equal(proof.popup, "blocked");
      assert.equal(page.url(), appUrl);
      await page.getByRole("button", { name: "I've tried it" }).click();
      const saved = await publicState(page, "getTutorSession", { sessionId: session.sessionId });
      assert.deepEqual(saved.blocks.find(block => block.tool === "tutor_show_page").result.answer.explored, ["x"]);
      await page.waitForTimeout(300);
      assert.deepEqual(requests, []);
      assert.equal(page.context().pages().filter(other => other.url().startsWith(endpoint)).length, 0);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
