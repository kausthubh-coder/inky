import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { completeOnboarding, publicState, waitForPublicState, withLmsApp } from "./harness.mjs";

async function untilSession(page, sessionId, predicate) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const session = await publicState(page, "getTutorSession", { sessionId });
    if (predicate(session)) return session;
    await page.waitForTimeout(50);
  }
  assert.fail("Tutor session did not reach the expected state");
}

const studyHtml = `<h2>Stack top</h2><p>Push A, then B. Which leaves first?</p><button onclick="studi.explore('popped B')">Pop once</button>`;

test("J3: class material, five lesson phases, study page, files and restart", async () => {
  await withLmsApp({ scenario: "learn", script: {
    scan: [[
      { op: "tool", name: "browser_snapshot" },
      { op: "tool", name: "scan_record_course", input: { label: "Data Structures" } },
      { op: "tool", name: "scan_record_course", input: { label: "Writing and Society" } },
    ], [
      { op: "tool", name: "browser_snapshot" },
      { op: "tool", name: "scan_record_course", input: { label: "Data Structures" } },
      { op: "clickByName", name: "Course syllabus and exam topics" },
      { op: "recordCurrentSource", courseKey: "Data Structures", title: "CS 316 syllabus" },
    ]],
    extraction: [[{ op: "tool", name: "learn_record_source", input: {
      exams: [{ key: "cs316-midterm", title: "CS 316 midterm exam", date: "2026-09-21", quote: "CS 316 midterm exam" }],
      topics: [{ key: "stacks", examKey: "cs316-midterm", title: "Stacks and queues", chapter: 1, weight: 25, quote: "Stacks and queues" }],
    } }]],
    learning: [[
      { op: "tool", name: "tutor_ask_typed", input: { question: "Push A then B. What pops first?", source: "CS 316 review sheet, problem 1", accept: ["B"], hints: [] } },
      { op: "tool", name: "tutor_advance", input: { phase: "learn" } },
      { op: "tool", name: "tutor_show_page", input: { title: "Stack top", purpose: "See last in, first out", html: studyHtml, source: "CS 316 review sheet, problem 1" } },
      { op: "tool", name: "tutor_advance", input: { phase: "practice" } },
      { op: "tool", name: "tutor_ask_choice", input: { question: "Which item is at the top after pushing A, then B?", source: "CS 316 review sheet, problem 1", options: ["A", "B"], correct: 1 } },
      { op: "tool", name: "tutor_advance", input: { phase: "independent" } },
      { op: "tool", name: "tutor_ask_typed", input: { question: "Push X, Y, Z and pop once. Which item leaves?", source: "CS 316 review sheet, problem 1", accept: ["Z"], hints: [] } },
      { op: "finishTutor" },
    ]],
  } }, async ({ page, school, homeworkRoot, restart }) => {
    await completeOnboarding(page, school.url);
    const courses = (await publicState(page, "getSchoolOnboardingState")).courses;
    const course = courses.find(item => item.label.includes("Data Structures"));
    assert.ok(course);
    const created = await publicState(page, "setLearnExam", { courseId: course.courseId, title: "CS 316 midterm exam", date: null, kind: "exam" });
    await publicState(page, "addLearnTopic", { examId: created.plan.leadExam.examId, title: "Stacks and queues" });
    await page.getByRole("button", { name: "Learn", exact: true }).click();
    await page.getByRole("button", { name: /CS 316 midterm exam/ }).first().click();
    await page.getByRole("button", { name: "Find more in class" }).click();
    const material = await waitForPublicState(page, "getLearnState", state => state.sources.some(source => source.title === "CS 316 syllabus"), 20_000);
    assert.ok(material.sources.some(source => source.sourceTarget?.includes("/syllabus")));
    const ready = await waitForPublicState(page, "getLearnState", state => state.topics.some(topic => topic.title === "Stacks and queues"), 20_000);
    const topic = ready.topics.find(item => item.title === "Stacks and queues");
    assert.equal(ready.mastery.some(item => item.topicId === topic.topicId), false);
    await page.screenshot({ path: ".agents/audit/cp05/learn-goals.png" });
    const session = await publicState(page, "startTutorSession", { topicId: topic.topicId, minutes: 15 });
    // Open the new session through the Learn card, exercising the real TutorScreen.
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("textbox", { name: "Your answer" }).fill("B");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await page.locator('iframe[title="Stack top"]').waitFor();
    await page.screenshot({ path: ".agents/audit/cp05/tutor-study-page.png" });
    await page.frameLocator('iframe[title="Stack top"]').getByRole("button", { name: "Pop once" }).click();
    await page.getByRole("button", { name: "I've tried it" }).click();
    await page.getByRole("button", { name: "B", exact: true }).click();
    await page.getByRole("textbox", { name: "Your answer" }).fill("Z");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    const finished = await untilSession(page, session.sessionId, value => value.status === "completed");
    assert.equal(finished.result.level, 1);
    assert.deepEqual(finished.blocks.filter(block => block.tool === "tutor_show_page")[0].result.answer.explored, ["popped B"]);
    const learnDir = join(homeworkRoot, "Learn");
    const [folder] = await readdir(learnDir);
    assert.ok(folder.includes("CS 316"));
    const root = join(learnDir, folder);
    assert.match(await readFile(join(root, "PROGRESS.md"), "utf8"), /You traced the stack/);
    assert.match(await readFile(join(root, "CHEATSHEET.md"), "utf8"), /most recently pushed/);
    assert.equal((await readdir(join(root, "pages"))).length, 1);
    assert.ok((await stat(join(root, "pages", (await readdir(join(root, "pages")))[0]))).size > studyHtml.length);
    page = await restart();
    await page.getByRole("button", { name: "Learn", exact: true }).click();
    const after = await publicState(page, "getLearnState");
    assert.equal(after.mastery.find(item => item.topicId === topic.topicId)?.level, 1);
    assert.equal((await publicState(page, "getTutorSession", { sessionId: session.sessionId })).status, "completed");
    assert.ok(after.sessions.some(item => item.sessionId === session.sessionId));
  });
});
