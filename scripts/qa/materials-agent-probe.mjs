// Bounded live-provider check using the production assignment coordinator and local fixture only.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PiAgentRuntime } from '../../dist/electron/agent/runtime.js';
import { ManagerCoordinator } from '../../dist/electron/manager/coordinator.js';
import { AssignmentExecutionCoordinator } from '../../dist/electron/assignment/coordinator.js';
import { openLocalStore } from '../../dist/electron/storage/index.js';
import { initializeHomeworkWorkspace } from '../../dist/electron/files/workspace.js';

export async function runMaterialsAgentProbe(browser, origin, root, evidence) {
  const store = await openLocalStore(join(root, 'live-store'));
  const homeworkRoot = join(root, 'live-homework');
  await mkdir(homeworkRoot);
  await initializeHomeworkWorkspace(homeworkRoot);
  const now = new Date().toISOString();
  await store.productPreferences.put({ ...await store.productPreferences.get(), homeworkRoot, updatedAt: now });
  store.permissionRules.put({ schemaVersion: 1, ruleId: 'qa-attempt', scope: 'global', mode: 'attempt', updatedAt: now });
  const trace = [];
  const runtime = await PiAgentRuntime.create({
    cwd: root,
    agentDir: resolve('.agents/studi-qa/materials/live-profile/studi-data/pi'),
    browserController: browser,
    onDiagnostic(event) {
      if (event.kind === 'session_created') trace.push({ kind: event.kind, model: event.payload.model, reasoning: event.payload.reasoning_effort, tools: event.payload.tools.map(t => t.name) });
      if (event.kind === 'tool_execution_start') { trace.push({ kind: event.kind, name: event.payload.toolName }); console.log(`Agent tool: ${event.payload.toolName}`); }
      if (event.kind === 'tool_execution_end') trace.push({ kind: event.kind, name: event.payload.toolName, isError: event.payload.isError });
      if (event.kind === 'generation' && event.payload.$ai_is_error) trace.push({ kind: 'provider_error', error: event.payload.$ai_error });
    },
  });
  const provider = await runtime.getProviderStatus('openai-codex');
  if (provider.state !== 'ready') {
    await writeFile(join(evidence, 'agent.json'), JSON.stringify({ status: 'blocked', provider: provider.state }, null, 2));
    store.close();
    console.log(`Live agent unavailable: ${provider.state}`);
    return;
  }
  const assignmentId = 'qa-pdf'; const taskId = 'qa-pdf-task';
  store.assignments.put({ schemaVersion: 1, assignmentId, courseId: 'qa-course', title: 'Exercise 6', sourceTarget: origin, discoveredAt: now, evidence: [] });
  const task = { schemaVersion: 1, taskId, assignmentId, state: 'discovered', revision: 0, createdAt: now, updatedAt: now };
  const { schemaVersion, ...payload } = task;
  store.tasks.append({ expectedRevision: null, projection: task, event: { schemaVersion: 1, eventId: 'qa-create', aggregateType: 'task', aggregateId: taskId, runId: 'qa-run', sequence: 0, occurredAt: now, type: 'task_created', payload } });
  const manager = await ManagerCoordinator.create(store, runtime);
  manager.enqueue({ taskId });
  const coordinator = await AssignmentExecutionCoordinator.create(store, manager, browser);
  const timeout = setTimeout(() => { void manager.pauseForStudent(taskId, 'QA time limit').catch(() => {}); }, 120_000);
  let result;
  try {
    await browser.navigate(origin);
    const execution = await coordinator.startNext();
    const answer = await coordinator.readAssignmentFile(assignmentId, 'answer.txt');
    const materials = await coordinator.assignmentFiles(assignmentId);
    assert.match(answer.content, /5/);
    assert.equal(execution.phase, 'ready_review');
    assert.ok(materials.some(f => f.path.endsWith('.pdf')));
    assert.ok(trace.some(e => e.name === 'file_read_pdf'));
    result = { status: 'passed', mode: 'live provider, production coordinator, controlled local school', phase: execution.phase, answer: answer.content, materials: materials.map(f => f.path), trace };
    console.log(`Live agent finished: ${execution.phase}; answer=${answer.content.trim()}`);
  } catch (error) {
    result = { status: 'failed', error: error.message, phase: coordinator.state(false).execution?.phase, blocker: coordinator.state(false).execution?.lastError, trace };
    console.log(`Live agent check: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    await writeFile(join(evidence, 'agent.json'), JSON.stringify(result, null, 2));
    try { manager.cancel(taskId); } catch { /* A failed task has already released its worker. */ }
    coordinator.dispose();
    store.close();
  }
}
