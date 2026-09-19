import assert from "node:assert/strict";

export async function verifyQueueNext(page, base) {
  await page.goto(`${base}/?preview=today-working`);
  await page.getByRole("button", { name: /^HW 3 CSC/ }).click();
  const before = await page.evaluate(async () => ({
    execution: (await window.studi.getLifecycleState()).execution,
    queue: (await window.studi.getManagerState()).entries,
  }));
  assert.equal(before.queue.some(entry => entry.assignmentId === "assignment-hw3"), false);
  await page.getByRole("button", { name: "Do this next", exact: true }).click();
  await page.getByText("Inky starts next", { exact: true }).waitFor();
  const after = await page.evaluate(async () => ({
    execution: (await window.studi.getLifecycleState()).execution,
    queue: (await window.studi.getManagerState()).entries,
  }));
  assert.equal(after.queue[0].assignmentId, "assignment-hw3");
  assert.deepEqual(after.execution, before.execution);
  return "Discovered homework queues next through its row; the current worker stays unchanged.";
}
