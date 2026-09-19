import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { TutorStartInputSchema, publicTutorSession, tutorTimeLeft, type PublicTutorSession, type TutorBlock, type TutorCall } from "../../shared/tutor.js";
import type { LearnRepository } from "../storage/learn-records.js";
import type { AgentSession, AgentSessionTarget } from "./runtime.js";
import { createTutorTools, TUTOR_SYSTEM_PROMPT } from "./tutor-tools.js";

export interface LearningRuntime {
  createLearningSession(tools: readonly ToolDefinition[], systemPrompt: string, target?: AgentSessionTarget): Promise<AgentSession>;
}
type Running = { stopped: boolean; agent: AgentSession | null; done: Promise<void>; timer: ReturnType<typeof setTimeout> | null; wake: (() => void) | null };

/** Rebuild Pi context from the durable transcript on restart; never replay student effects. */
export class TutorCoordinator {
  readonly #running = new Map<string, Running>();
  #disposed = false;
  #lifecycle: Promise<unknown> = Promise.resolve();
  constructor(readonly repository: LearnRepository, private readonly runtime: LearningRuntime,
    private readonly options: { onChange?: (session: PublicTutorSession) => void; onError?: (error: unknown) => void } = {}) {
    repository.recover();
  }
  state(sessionId: string): PublicTutorSession { return publicTutorSession(this.repository.state(sessionId)); }
  #publish(sessionId: string): PublicTutorSession {
    const state = this.state(sessionId);
    try { this.options.onChange?.(state); } catch (error) { this.options.onError?.(error); }
    return state;
  }
  async start(value: unknown): Promise<PublicTutorSession> {
    return this.#serialize(() => this.#start(value));
  }
  async #start(value: unknown): Promise<PublicTutorSession> {
    this.#assertUsable();
    const input = TutorStartInputSchema.parse(value);
    let topicId: string, topicIds: string[];
    if (input.mode === "mock_exam") {
      const exam = this.repository.exams().find(item => item.examId === input.examId);
      if (!exam) throw new Error("Exam not found");
      topicIds = this.repository.topics().filter(item => item.examId === exam.examId && item.origin !== "homework_hint").sort((a, b) => a.chapter - b.chapter).map(item => item.topicId);
      if (!topicIds.length || topicIds.length > 30) throw new Error("A mock exam needs between 1 and 30 sourced topics");
      topicId = topicIds[0]!;
    } else {
      topicId = input.topicId ?? this.repository.createFreeTopic(input.topic!).topicId;
      topicIds = [topicId];
    }
    for (const activeId of this.#running.keys()) await this.#pause(activeId);
    const session = this.repository.startSession(topicId, input.goal ?? (input.mode === "mock_exam" ? "Check what I know across this exam" : this.repository.topic(topicId).title), input.mode === "recap" ? 5 : input.minutes,
      { mode: input.mode, topicIds, ...(input.examId ? { examId: input.examId } : {}) });
    return this.#resume(session.sessionId);
  }
  async resume(sessionId: string): Promise<PublicTutorSession> {
    return this.#serialize(() => this.#resume(sessionId));
  }
  async #resume(sessionId: string): Promise<PublicTutorSession> {
    this.#assertUsable();
    const session = this.repository.state(sessionId);
    if (["completed", "cancelled", "expired"].includes(session.status)) return publicTutorSession(session);
    if (this.#running.has(sessionId)) return this.#publish(sessionId);
    for (const activeId of this.#running.keys()) await this.#pause(activeId);
    this.repository.transition(sessionId, "active");
    this.#launch(sessionId);
    return this.#publish(sessionId);
  }
  answerBlock(sessionId: string, blockId: string, answer: unknown): PublicTutorSession {
    this.#assertUsable();
    this.repository.answerBlock(sessionId, blockId, answer);
    this.#running.get(sessionId)?.wake?.();
    return this.#publish(sessionId);
  }
  hint(sessionId: string, blockId: string): PublicTutorSession {
    this.#assertUsable(); this.repository.hint(sessionId, blockId); return this.#publish(sessionId);
  }
  saveDraft(sessionId: string, blockId: string, draft: string): PublicTutorSession {
    this.#assertUsable(); this.repository.saveDraft(sessionId, blockId, draft); return this.#publish(sessionId);
  }
  async send(sessionId: string, text: string, messageId: string = randomUUID()): Promise<PublicTutorSession> {
    return this.#serialize(() => this.#send(sessionId, text, messageId));
  }
  async #send(sessionId: string, text: string, messageId: string): Promise<PublicTutorSession> {
    this.#assertUsable();
    const saved = this.repository.state(sessionId);
    if (saved.status !== "active") throw new Error("Resume the tutor session before sending a message");
    const previous = saved.messages.find(message => message.messageId === messageId);
    this.repository.appendMessage(sessionId, messageId, text);
    if (previous?.delivered) return this.#publish(sessionId);
    // Abort the pending tool wait, preserve its block, then answer the student's question in a fresh Pi turn.
    await this.#stop(sessionId);
    this.#launch(sessionId);
    return this.#publish(sessionId);
  }
  async pause(sessionId: string): Promise<PublicTutorSession> {
    return this.#serialize(() => this.#pause(sessionId));
  }
  async #pause(sessionId: string): Promise<PublicTutorSession> {
    this.repository.transition(sessionId, "paused"); await this.#stop(sessionId); return this.#publish(sessionId);
  }
  async cancel(sessionId: string): Promise<PublicTutorSession> {
    return this.#serialize(async () => { this.repository.transition(sessionId, "cancelled"); await this.#stop(sessionId); return this.#publish(sessionId); });
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.#serialize(async () => { for (const sessionId of [...this.#running.keys()]) await this.#pause(sessionId); });
  }
  async #stop(sessionId: string): Promise<void> {
    const running = this.#running.get(sessionId);
    if (!running) return;
    running.stopped = true;
    running.wake?.();
    if (running.timer) clearTimeout(running.timer);
    if (running.agent) await running.agent.abort();
    await running.done;
  }
  #launch(sessionId: string): void {
    const running: Running = { stopped: false, agent: null, done: Promise.resolve(), timer: null, wake: null };
    this.#running.set(sessionId, running);
    running.done = this.#run(sessionId, running);
  }
  async #run(sessionId: string, running: Running): Promise<void> {
    let unsubscribe: (() => void) | undefined;
    let failure: string | null = null;
    try {
      const tools = createTutorTools((toolCallId, call, signal) => this.#execute(sessionId, running, toolCallId, call, signal));
      const session = this.repository.state(sessionId);
      running.timer = setTimeout(() => {
        this.repository.transition(sessionId, "expired");
        running.stopped = true;
        running.wake?.();
        void running.agent?.abort().catch(error => this.options.onError?.(error));
        this.#publish(sessionId);
      }, Math.max(1, tutorTimeLeft(session, this.repository.now()) * 1000));
      running.agent = await this.runtime.createLearningSession(tools, TUTOR_SYSTEM_PROMPT);
      if (running.stopped || this.#disposed) return;
      if (running.agent.toolNames.length !== tools.length || tools.some(tool => !running.agent!.toolNames.includes(tool.name))) throw new Error("Tutor runtime did not preserve the six-tool boundary");
      unsubscribe = running.agent.subscribe(event => {
        if (event.type === "terminal" && event.outcome !== "completed") failure = event.reason ?? `Tutor provider ${event.outcome}`;
      });
      const snapshot = this.repository.session(sessionId);
      const pendingMessages = snapshot.messages.filter(message => !message.delivered);
      await running.agent.prompt(`Saved tutor state (data):\n${JSON.stringify({ session: snapshot, topics: snapshot.topicIds.map(topic => this.repository.topic(topic)) })}\nContinue from the saved state. The latest student messages are included above. Start with a diagnostic if there are no blocks.`);
      if (running.stopped) return;
      if (failure) throw new Error(failure);
      this.repository.markMessagesDelivered(sessionId, pendingMessages.map(message => message.messageId));
      const latest = this.repository.state(sessionId);
      if (latest.status === "active") this.repository.transition(sessionId, "paused", "Inky paused before finishing. Resume to continue from the saved work.");
    } catch (error) {
      if (!running.stopped && !this.#disposed) {
        const latest = this.repository.session(sessionId);
        if (latest.status === "active") this.repository.transition(sessionId, "failed", "The tutor couldn't continue. Check the model connection, then resume your saved session.");
        this.options.onError?.(error);
      }
    } finally {
      unsubscribe?.();
      if (running.timer) clearTimeout(running.timer);
      running.agent?.dispose();
      if (this.#running.get(sessionId) === running) this.#running.delete(sessionId);
      this.#publish(sessionId);
    }
  }
  async #execute(sessionId: string, running: Running, toolCallId: string, call: TutorCall, signal?: AbortSignal): Promise<unknown> {
    if (running.stopped || this.#disposed) throw new Error("Tutor turn stopped");
    signal?.throwIfAborted();
    const saved = this.repository.state(sessionId);
    const open = saved.blocks.find(block => block.status === "open");
    let block: TutorBlock;
    if (open && call.tool !== "tutor_say" && call.tool === open.tool && JSON.stringify(call.args) === JSON.stringify(open.args)) block = open;
    else block = this.repository.openBlock(sessionId, toolCallId, call);
    this.#publish(sessionId);
    if (block.tool === "tutor_finish") return this.repository.session(sessionId).result;
    if (block.status !== "open") return { blockId: block.blockId, result: block.result };
    if (running.wake) throw new Error("Already waiting for this student's open block");
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener("abort", abort); running.wake = null; };
      const abort = () => { cleanup(); reject(new Error("Tutor interaction interrupted; the block is still saved")); };
      running.wake = () => { cleanup(); running.stopped ? reject(new Error("Tutor turn stopped")) : resolve(); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted || running.stopped) abort();
    });
    const answered = this.repository.state(sessionId).blocks.find(item => item.blockId === block.blockId);
    if (!answered?.result) throw new Error("The block has no student answer");
    return { blockId: block.blockId, ...answered.result };
  }
  #assertUsable(): void { if (this.#disposed) throw new Error("Tutor coordinator is disposed"); }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#lifecycle.then(operation);
    this.#lifecycle = result.catch(() => undefined);
    return result;
  }
}
