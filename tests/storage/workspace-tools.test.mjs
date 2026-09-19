import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspaceCodingTools } from "../../dist/electron/files/workspace-tools.js";

function tool(tools, name) {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found, `missing ${name} tool`);
  return found;
}

async function execute(definition, input) {
  return definition.execute(`workspace-${definition.name}`, input, undefined, undefined, {});
}

test("workspace coding tools create, edit, search, list, and run inside one assignment", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "studi-assignment-tools-"));
  try {
    const tools = createWorkspaceCodingTools(root);
    await execute(tool(tools, "write"), { path: "notes/answer.txt", content: "first answer\n" });
    await execute(tool(tools, "edit"), {
      path: "notes/answer.txt",
      edits: [{ oldText: "first", newText: "checked" }],
    });
    assert.equal(await readFile(join(root, "notes", "answer.txt"), "utf8"), "checked answer\n");

    const read = await execute(tool(tools, "read"), { path: "notes/answer.txt" });
    assert.match(read.content[0].text, /checked answer/);
    const grep = await execute(tool(tools, "grep"), { pattern: "checked", path: "." });
    assert.match(grep.content[0].text, /notes[\\/]answer\.txt|notes\/answer\.txt/);
    const find = await execute(tool(tools, "find"), { pattern: "**/*.txt", path: "." });
    assert.match(find.content[0].text, /answer\.txt/);
    const list = await execute(tool(tools, "ls"), { path: "." });
    assert.match(list.content[0].text, /notes/);

    const shellName = process.platform === "win32" ? "powershell" : "bash";
    const command = process.platform === "win32"
      ? "Write-Output 'shell started'; Start-Sleep -Milliseconds 1500; Write-Output 'sleep completed'; Set-Content -LiteralPath shell-result.txt -Value 'inside'; Write-Output 'file written'"
      : "sleep 1.5; printf 'inside\\n' > shell-result.txt";
    // The deliberate 1.5s command catches seconds accidentally treated as ms.
    // Fixed phase markers identify runner hangs without logging its environment.
    let progress;
    try {
      await tool(tools, shellName).execute("workspace-shell", { command, timeout: 60 }, undefined,
        update => { progress = update.content; }, {});
    } catch (error) {
      t.diagnostic(`Shell progress: ${JSON.stringify(progress ?? [])}`);
      throw error;
    }
    assert.match(await readFile(join(root, "shell-result.txt"), "utf8"), /inside/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace shell reports timeout and can run the next command", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-assignment-timeout-"));
  try {
    const shellName = process.platform === "win32" ? "powershell" : "bash";
    const shell = tool(createWorkspaceCodingTools(root), shellName);
    const command = process.platform === "win32" ? "Start-Sleep -Seconds 3" : "sleep 3";
    await assert.rejects(execute(shell, { command, timeout: 0.1 }), /timed out after 0.1 seconds/);
    const next = await execute(shell, { command: "echo recovered", timeout: 60 });
    assert.match(next.content[0].text, /recovered/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace coding tools reject traversal, links, elevation, and global installs", async () => {
  const root = await mkdtemp(join(tmpdir(), "studi-assignment-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "studi-assignment-outside-"));
  try {
    const tools = createWorkspaceCodingTools(root);
    await writeFile(join(outside, "private.txt"), "outside");
    await assert.rejects(
      execute(tool(tools, "read"), { path: join(outside, "private.txt") }),
      /escaped the active assignment folder/,
    );
    await assert.rejects(
      execute(tool(tools, "write"), { path: "../escaped.txt", content: "no" }),
      /escaped the active assignment folder/,
    );

    const shellName = process.platform === "win32" ? "powershell" : "bash";
    for (const command of ["sudo whoami", "bun add -g left-pad", "python -m pip install requests"]) {
      await assert.rejects(execute(tool(tools, shellName), { command, timeout: 10 }), /private workspace boundary|\.venv/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
