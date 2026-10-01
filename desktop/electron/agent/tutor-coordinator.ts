import { randomUUID } from "node:crypto";
import { TutorStartInputSchema, publicTutorSession, normalizeTutorAnswer, tutorTimeLeft, tutorExpiryTimeLeft, TUTOR_TIME_UP, type PublicTutorSession, type TutorBlock, type TutorCall, type TutorSession } from "../../shared/tutor.js";
import type { LearnRepository } from "../storage/learn-records.js";
import type { AgentRuntime, AgentSession } from "./runtime.js";
import { buildTutorContext, type TutorContextSources } from "./tutor-context.js";
import { createTutorTools, TUTOR_SYSTEM_PROMPT } from "./tutor-tools.js";
import { localDay, planLearn } from "../../shared/learn.js";

export type LearningRuntime = Pick<AgentRuntime, "createLearningSession">;
/** The goal's study folder. Optional: without a homework folder the tutor still works from the database. */
export interface TutorFiles {
  read(session: TutorSession): Promise<{ progress: string; cheatsheet: string; classNote?: string } | null>;
  savePage(session: TutorSession, title: string, html: string): Promise<void>;
  recordFinish(session: TutorSession): Promise<void>;
}
type Running = { stopped: boolean; agent: AgentSession | null; done: Promise<void>; timer: ReturnType<typeof setTimeout> | null; wake: (() => void) | null };

/** Rebuild Pi context from the durable transcript on restart; never replay student effects. */
export class TutorCoordinator {
  readonly #running = new Map<string, Running>();
  #disposed = false;
  #lifecycle: Promise<unknown> = Promise.resolve();
  constructor(readonly repository: LearnRepository, private readonly runtime: LearningRuntime,
    private readonly options: { onChange?: (session: PublicTutorSession) => void; onError?: (error: unknown) => void; context?: TutorContextSources; files?: TutorFiles } = {}) {
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
      if (input.topicId) topicId = input.topicId;
      else {
        const existing = this.repository.exams().find(exam => exam.kind === "topic" && normalizeTutorAnswer(exam.title) === normalizeTutorAnswer(input.topic!));
        const goal = existing && !existing.hidden ? existing : this.repository.setExam({ ...(existing ? { examId: existing.examId } : {}), kind: "topic", title: input.topic!, courseId: null, date: null });
        topicId = this.repository.topics().filter(topic => topic.examId === goal.examId && !topic.hidden).sort((a, b) => a.chapter - b.chapter)[0]?.topicId
          ?? this.repository.addTopic(goal.examId, goal.title).topicId;
      }
      const goal = this.repository.topic(topicId).examId;
      const plan = planLearn({ exams: this.repository.exams(), topics: this.repository.topics().filter(topic => !topic.hidden), mastery: this.repository.masterySummaries(), sessions: [],
        today: this.options.context?.today() ?? localDay(this.repository.now()), ...(goal ? { selectedExamId: goal } : {}) });
      const returning = goal ? plan.comingBack.filter(topic => topic.topicId !== topicId).slice(0, input.mode === "recap" ? 5 : 3) : [];
      topicIds = [topicId, ...returning.map(topic => topic.topicId)];
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
      const expire = () => {
        this.repository.transition(sessionId, "expired");
        running.stopped = true;
        running.wake?.();
        void running.agent?.abort().catch(error => this.options.onError?.(error));
        this.#publish(sessionId);
      };
      const wrap = () => {
        const latest = this.repository.state(sessionId);
        running.wake?.();
        this.#publish(sessionId);
        running.timer = setTimeout(expire, Math.max(1, tutorExpiryTimeLeft(latest, this.repository.now()) * 1000));
      };
      running.timer = setTimeout(wrap, Math.max(1, tutorTimeLeft(session, this.repository.now()) * 1000));
      running.agent = await this.runtime.createLearningSession(tools, TUTOR_SYSTEM_PROMPT);
      if (running.stopped || this.#disposed) return;
      if (running.agent.toolNames.length !== tools.length || tools.some(tool => !running.agent!.toolNames.includes(tool.name))) throw new Error("Tutor runtime did not preserve the tutor tool boundary");
      unsubscribe = running.agent.subscribe(event => {
        if (event.type === "terminal" && event.outcome !== "completed") failure = event.reason ?? `Tutor provider ${event.outcome}`;
      });
      const snapshot = this.repository.session(sessionId);
      const pendingMessages = snapshot.messages.filter(message => !message.delivered);
      const notes = await this.#files(files => files.read(snapshot), null);
      const context = { ...buildTutorContext(this.repository, snapshot, this.options.context ?? { courseLabel: () => null, workedHomework: () => [], today: () => localDay(this.repository.now()) }), notes, secondsLeft: Math.floor(tutorTimeLeft(snapshot, this.repository.now())) };
      await running.agent.prompt(`Lesson context (data):\n${JSON.stringify(context)}\n\nSaved tutor state (data):\n${JSON.stringify(snapshot)}\n\nContinue from the saved state and its current phase. The latest student messages are included above. If there are no blocks, start the ${snapshot.mode === "topic" ? "Check" : "questions"}.`);
      if (running.stopped) return;
      if (failure) throw new Error(failure);
      this.repository.markMessagesDelivered(sessionId, pendingMessages.map(message => message.messageId));
      const latest = this.repository.state(sessionId);
      if (latest.status === "active") this.repository.transition(sessionId, "paused", "Chalky paused before finishing. Resume to continue from the saved work.");
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
    const secondsLeft = () => Math.floor(tutorTimeLeft(this.repository.state(sessionId), this.repository.now()));
    const timeUp = () => ({ timeUp: true, text: TUTOR_TIME_UP, secondsLeft: 0 });
    if (secondsLeft() === 0 && call.tool !== "tutor_finish" && call.tool !== "tutor_grade") return timeUp();
    if (call.tool === "tutor_grade") {
      const marked = this.repository.grade(sessionId, call.args).blocks.find(block => block.blockId === call.args.blockId)!;
      this.#publish(sessionId);
      return { blockId: marked.blockId, ...marked.result, secondsLeft: secondsLeft() };
    }
    if (call.tool === "tutor_advance") {
      const phase = this.repository.advance(sessionId, call.args.phase).phase;
      this.#publish(sessionId);
      return { phase, secondsLeft: secondsLeft() };
    }
    const saved = this.repository.state(sessionId);
    const open = saved.blocks.find(block => block.status === "open");
    let block: TutorBlock;
    if (open && call.tool !== "tutor_say" && call.tool === open.tool && JSON.stringify(call.args) === JSON.stringify(open.args)) block = open;
    else block = this.repository.openBlock(sessionId, toolCallId, call);
    this.#publish(sessionId);
    if (block.tool === "tutor_show_page" && block.status === "open") await this.#files(files => files.savePage(this.repository.session(sessionId), block.args.title, block.args.html), undefined);
    if (block.tool === "tutor_finish") {
      const finished = this.repository.session(sessionId);
      await this.#files(files => files.recordFinish(finished), undefined);
      return { ...finished.result, secondsLeft: secondsLeft() };
    }
    if (block.status !== "open") return { blockId: block.blockId, result: block.result, ...(block.tool === "tutor_ask_typed" ? { matched: block.result?.matched ?? false } : {}), secondsLeft: secondsLeft() };
    if (running.wake) throw new Error("Already waiting for this student's open block");
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener("abort", abort); running.wake = null; };
      const abort = () => { cleanup(); reject(new Error("Tutor interaction interrupted; the block is still saved")); };
      running.wake = () => { cleanup(); running.stopped ? reject(new Error("Tutor turn stopped")) : resolve(); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted || running.stopped) abort();
    });
    const answered = this.repository.state(sessionId).blocks.find(item => item.blockId === block.blockId);
    if (answered?.status === "cancelled" && secondsLeft() === 0) return timeUp();
    if (!answered?.result) throw new Error("The block has no student answer");
    return { blockId: block.blockId, ...answered.result, secondsLeft: secondsLeft() };
  }
  /** Study-folder problems are reported, never allowed to stop a lesson. */
  async #files<T>(action: (files: TutorFiles) => Promise<T>, fallback: T): Promise<T> {
    if (!this.options.files) return fallback;
    try { return await action(this.options.files); } catch (error) { this.options.onError?.(error); return fallback; }
  }
  #assertUsable(): void { if (this.#disposed) throw new Error("Tutor coordinator is disposed"); }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#lifecycle.then(operation);
    this.#lifecycle = result.catch(() => undefined);
    return result;
  }
}
