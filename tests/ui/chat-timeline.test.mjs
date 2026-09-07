import assert from "node:assert/strict";
import test from "node:test";
import { chatTimeline } from "../../desktop/src/app/chatTimeline.ts";

test("handoff cards stay between the earlier conversation and the student's later replies", () => {
  const messages = [
    { messageId: "before", createdAt: "2026-09-07T06:07:00Z", role: "user", text: "Scan my school", turnIndex: 0 },
    { messageId: "after", createdAt: "2026-09-07T06:09:00Z", role: "user", text: "I'm signed in", turnIndex: 1 },
    { messageId: "reply", createdAt: "2026-09-07T06:09:01Z", role: "assistant", text: "Checking", turnIndex: 1 },
  ];
  const cards = [{ kind: "scan_handoff", key: "handoff", createdAt: "2026-09-07T06:08:00Z" }];
  const timeline = chatTimeline(messages, cards);
  assert.deepEqual(timeline.map(entry => entry.key), ["before", "handoff", "after", "reply"]);
  assert.equal(timeline.at(-1).index, 2, "retry still points at the original conversation index");
  assert.deepEqual(chatTimeline(messages, cards), timeline, "polling does not move the card below later replies");
  assert.equal(messages.length, 3);
  assert.equal(cards.length, 1);
});

test("assignment and review cards share the same chronological transcript", () => {
  const cards = [
    { kind: "review", key: "review", createdAt: "2026-09-07T06:10:00Z" },
    { kind: "assignment", key: "assignment", createdAt: "2026-09-07T06:08:00Z" },
  ];
  const messages = [{ messageId: "question", createdAt: "2026-09-07T06:09:00Z", role: "user", text: "How is it going?", turnIndex: 0 }];
  assert.deepEqual(chatTimeline(messages, cards).map(entry => entry.key), ["assignment", "question", "review"]);
});
