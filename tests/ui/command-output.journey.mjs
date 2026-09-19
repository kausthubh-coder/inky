import assert from "node:assert/strict";
import { join } from "node:path";

export async function verifyCommandOutput(page, base, evidenceDirectory) {
  await page.setViewportSize({ width: 1120, height: 760 });
  await page.goto(`${base}/?preview=desk-working&desktop=win32`);
  await page.getByRole("button", { name: /^Files 1$/ }).click();
  const output = page.getByRole("region", { name: "Command output", exact: true });
  await output.waitFor();
  assert.match(await output.innerText(), /3 checks passed/);
  await page.evaluate(async () => {
    const getDetail = window.studi.getTaskDetail;
    window.studi.getTaskDetail = async input => {
      const detail = structuredClone(await getDetail(input));
      detail.execution.commandOutputs.push({ toolCallId: "failed-test", shell: "powershell", outcome: "failed", text: "<script>window.commandExecuted = true</script>\nExpected 4, got 5", truncated: false, recordedAt: new Date().toISOString() });
      return detail;
    };
  });
  await output.getByText(/Expected 4, got 5/).waitFor();
  assert.equal(await page.evaluate(() => window.commandExecuted), undefined);
  await page.getByRole("button", { name: "School page", exact: true }).click();
  assert.equal(await output.isVisible(), false);
  await page.getByRole("button", { name: /^Files 1$/ }).click();
  await output.getByText(/Expected 4, got 5/).waitFor();
  if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, "assignment-command-output.png") });
  return "Saved shell result and later failure appear in Files; content is text, and tab switching retains history.";
}
