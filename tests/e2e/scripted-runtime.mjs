import { readFile } from "node:fs/promises";
import { createBrowserTools } from "../../dist/electron/browser/tools.js";

const schemaVersion = 1;

export async function createE2eRuntime(browser) {
  const path = process.env.STUDI_E2E_SCRIPT_PATH;
  if (!path) throw new Error("STUDI_E2E_SCRIPT_PATH is required by the scripted runtime");
  return new ScriptedRuntime(JSON.parse(await readFile(path, "utf8")), browser);
}

class ScriptedRuntime {
  selectedProviderId = "openai-codex";
  selectedModelId = "gpt-6-sol";
  selectedReasoningEffort = "high";
  #script;
  #browser;
  #counts = new Map();

  constructor(script, browser) { this.#script = script; this.#browser = browser; }

  createSession() { return this.#session("home", []); }
  createWorkerSession() { return this.#session("home", []); }
  createLearningSession(tools) { return this.#session(tools.some(tool => tool.name === "learn_record_source") ? "extraction" : "learning", tools); }
  createJobSession(target, tools) { return this.#session(target.kind, tools); }
  createScanSession(tools) { return this.#session("scan", [...createBrowserTools(this.#browser.scanBrowserController, { readOnly: true }), ...tools]); }
  createAssignmentSession(tools, target) {
    const controller = this.#browser.assignmentBrowser(target.assignmentId);
    return this.#session("assignment", [...createBrowserTools(controller, { includeSubmit: false }), ...tools]);
  }

  async getProviderStatus() {
    return { schemaVersion, providerId: "openai-codex", providerName: "ChatGPT", state: "ready", loginMethods: [], reason: "The isolated scripted runtime is ready." };
  }

  getProviderModels(providerId) { return providerId === "openai-codex" ? [{ providerId, id: "gpt-6-sol", name: "GPT-6 Sol" }] : []; }
  selectProvider(providerId) { this.selectedProviderId = providerId; }
  async selectModel() { return undefined; }
  setReasoningEffort(effort) { this.selectedReasoningEffort = effort; }
  takeLastUsage() { return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, toolCalls: 0 }; }
  async loginProvider() { return undefined; }
  async logoutProvider() { return undefined; }

  #session(kind, tools) {
    const index = this.#counts.get(kind) ?? 0;
    this.#counts.set(kind, index + 1);
    const turns = this.#script[kind] ?? [];
    const steps = kind === "assignment" ? turns.slice(index) : turns[index] ?? turns.at(-1) ?? [];
    return new ScriptedSession(`${kind}-${index + 1}`, tools, steps, kind === "scan" ? this.#script.details : undefined, kind === "assignment");
  }
}

class ScriptedSession {
  sessionId;
  sessionPath;
  toolNames;
  #listeners = new Set();
  #tools;
  #steps;
  #details;
  #turnsMode;
  #promptCount = 0;
  #aborted = false;
  #abortWaiters = new Set();
  #tutorTopicId = null;
  #tutorEvidence = [];

  constructor(id, tools, steps, details, turnsMode = false) {
    this.sessionId = `e2e-${id}`;
    this.sessionPath = `e2e-${id}.jsonl`;
    this.toolNames = tools.map((tool) => tool.name);
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.#steps = steps;
    this.#details = details;
    this.#turnsMode = turnsMode;
  }

  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  async prompt(promptText = "") {
    try {
      if (promptText.startsWith("Lesson context (data):")) {
        this.#tutorTopicId = JSON.parse(promptText.split("Saved tutor state (data):\n")[1].split("\n\nContinue")[0]).topicId;
      }
      if (this.#details && promptText.startsWith("Check only this selected assignment: ")) {
        await this.#checkAssignmentDetails(promptText);
      } else {
      const steps = this.#turnsMode ? this.#steps[this.#promptCount++] ?? this.#steps.at(-1) ?? [] : this.#steps;
      for (const step of steps) {
        if (this.#aborted) break;
        await this.#step(step);
      }
      }
      this.#emit({ schemaVersion, type: "terminal", outcome: this.#aborted ? "aborted" : "completed" });
    } catch (error) {
      this.#emit({ schemaVersion, type: "terminal", outcome: "failed", reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async steer(text) { this.#emit({ schemaVersion, type: "text", delta: text }); }

  async abort() {
    if (this.#aborted) return;
    this.#aborted = true;
    for (const resolve of this.#abortWaiters) resolve();
    this.#abortWaiters.clear();
    this.#emit({ schemaVersion, type: "aborted" });
  }

  async replace(target = {}) {
    this.sessionId = `${this.sessionId}-replacement`;
    this.sessionPath = target.resumeSessionPath ?? `${this.sessionId}.jsonl`;
  }

  async compact() { return undefined; }
  dispose() { this.#listeners.clear(); this.#aborted = true; }

  async #checkAssignmentDetails(promptText) {
    const prefix = "Check only this selected assignment: ";
    const firstLine = promptText.split("\n", 1)[0].trimEnd();
    const assignment = JSON.parse(firstLine.slice(prefix.length, -1));
    let snapshot = await this.#call("browser_snapshot", {});
    if (snapshot.url !== assignment.sourceTarget) {
      await this.#call("browser_click", { ref: findRef(snapshot, assignment.title) });
      snapshot = await this.#call("browser_snapshot", {});
    }
    await this.#call("scan_record_assignment", {
      courseId: assignment.courseId,
      title: assignment.title,
      instructions: this.#details.instructions,
      requirementExcerpts: this.#details.requirements.map((text) => ({ text })),
      requirementsComplete: true,
      missingRequirements: [],
      dueText: this.#details.dueText,
      schoolStatus: { state: "not_submitted", text: "Not submitted" },
    });
  }

  async #step(step) {
    if (step.op === "recordCurrentSource") {
      const snapshot = await this.#call("browser_snapshot", {});
      await this.#call("scan_record_source", { courseKey: step.courseKey, title: step.title, url: snapshot.url, text: snapshot.text.slice(0, 20_000) });
      return;
    }
    if (step.op === "finishTutor") {
      await this.#call("tutor_finish", { topic: this.#tutorTopicId, level: 1, evidence: this.#tutorEvidence,
        missing: [], next: "Try a harder stack trace", summary: "You traced the stack and corrected the first guess.",
        cheatsheet: ["A stack pops the most recently pushed item."] });
      return;
    }
    if (step.op === "text") { this.#emit({ schemaVersion, type: "text", delta: step.text }); return; }
    if (step.op === "delay") { await new Promise((resolve) => setTimeout(resolve, step.ms)); return; }
    if (step.op === "waitForAbort") {
      if (!this.#aborted) await new Promise((resolve) => this.#abortWaiters.add(resolve));
      return;
    }
    if (step.op === "tool") { await this.#call(step.name, step.input ?? {}); return; }
    if (["typeByName", "clickByName", "uploadByName", "submitByName"].includes(step.op)) {
      // Long pages exceed one snapshot; search narrows it to the named control, as the agent would.
      const snapshot = await this.#call("browser_snapshot", step.search ? { search: step.name } : {});
      const ref = findRef(snapshot, step.name);
      if (step.op === "typeByName") await this.#call("browser_type", { ref, text: step.text });
      if (step.op === "clickByName") await this.#call("browser_click", { ref });
      if (step.op === "uploadByName") await this.#call("browser_upload", { ref, paths: step.paths });
      if (step.op === "submitByName") await this.#call("browser_submit", { ref, confirmation: "SUBMIT", expectedConfirmationText: step.expectedConfirmationText });
      return;
    }
    throw new Error(`Unknown scripted e2e operation: ${step.op}`);
  }

  async #call(name, input) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`The authentic ${name} tool was not supplied. Available: ${[...this.#tools.keys()].join(", ")}`);
    const toolCallId = `e2e-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const startedAt = Date.now();
    this.#emit({ schemaVersion, type: "tool_started", toolCallId, toolName: name, arguments: input });
    try {
      const result = await tool.execute(toolCallId, input);
      this.#emit({ schemaVersion, type: "tool_finished", toolCallId, toolName: name, outcome: "succeeded", durationMs: Date.now() - startedAt });
      const details = result?.details ?? result;
      if (name === "tutor_ask_typed" && details?.blockId && details.correct !== null) {
        this.#tutorEvidence.push({ blockId: details.blockId, correct: details.correct, rationale: "The student answered this unaided." });
      }
      return details;
    } catch (error) {
      this.#emit({ schemaVersion, type: "tool_finished", toolCallId, toolName: name, outcome: "failed", durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  #emit(event) { for (const listener of this.#listeners) listener(event); }
}

function findRef(snapshot, name) {
  const target = name.trim().toLowerCase();
  const elements = snapshot?.elements ?? [];
  const exact = elements.find((element) => element.name?.trim().toLowerCase() === target);
  const partial = elements.find((element) => element.name?.trim().toLowerCase().includes(target));
  const ref = (exact ?? partial)?.ref;
  if (!ref) throw new Error(`No visible school control matched ${JSON.stringify(name)} on ${snapshot?.url}: ${elements.map((element) => element.name).slice(0, 12).join(" / ")}`);
  return ref;
}
