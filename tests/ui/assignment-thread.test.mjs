import assert from "node:assert/strict";
import test from "node:test";
import { groupSteps, summarizeCalls, threadSteps } from "../../desktop/src/app/assignmentThread.ts";

const action = (tool, target, extra = {}) => ({ actionId: `${tool}-${target}`, occurredAt: "2026-09-28T18:21:00.000Z", kind: "tool", tool, target, label: tool, outcome: "succeeded", ...extra });

test("back-to-back tool calls fold into one group that says what they did; Dot's words split groups", () => {
  const steps = threadSteps([
    { actionId: "t1", occurredAt: "2026-09-28T18:21:00.000Z", kind: "text", label: "Reading the handout first." },
    action("browser_snapshot", undefined), action("file_read_pdf", "exercise11.pdf"), action("read", "sortList.c"),
    action("browser_download", "input-1.txt"), action("browser_download", "expected-1.txt"),
    { actionId: "t2", occurredAt: "2026-09-28T18:22:00.000Z", kind: "text", label: "Now writing the code." },
    action("write", "sortList.c"), action("powershell", "gcc sortList.c", { outcome: "failed" }),
  ]);
  const blocks = groupSteps(steps);
  assert.deepEqual(blocks.map((block) => block.kind), ["text", "group", "text", "group"]);
  assert.equal(blocks[1].summary, "Used the school page, read 2 files and downloaded 2 files");
  assert.equal(blocks[3].summary, "Changed 1 file and ran 1 command");
  assert.equal(blocks[3].failed, true);
  assert.equal(summarizeCalls(steps.filter((step) => step.kind === "call").slice(0, 1).map((step) => step.call)), "Used the school page");
});

test("unrecognized tools keep their label and use a neutral icon in steps and groups", () => {
  const steps = threadSteps([action("new_tool", "answer.md", { label: "Checked the answer" })]);
  assert.equal(steps[0].call.icon, "list");
  assert.equal(steps[0].call.verb, "Checked the answer");
  assert.equal(groupSteps(steps)[0].icon, "list");
});
