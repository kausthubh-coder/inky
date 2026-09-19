import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { OpaqueIdSchema } from "../../shared/ids.js";
import { IsoTimestampSchema } from "../../shared/schema-version.js";
import { ExamSchema, LearnExamInputSchema, LearnExtractionSchema, LearnSourceInputSchema, LearnSourceSchema, LearnTopicSchema, TopicMasterySchema, TopicMasterySummarySchema, planLearn,
  type Exam, type LearnExtraction, type LearnSource, type LearnTopic, type MasteryEvidence, type TopicMastery } from "../../shared/learn.js";
import { TutorBlockAnswerSchema, TutorBlockSchema, TutorCallSchema, TutorFinishInputSchema, TutorMessageSchema, TutorSessionSchema, TutorSessionSummarySchema,
  normalizeTutorAnswer, tutorTimeLeft, type TutorBlock, type TutorSession, type TutorSessionSummary } from "../../shared/tutor.js";
import type { StudiSqliteDatabase } from "./database.js";

type Table = "learn_sources" | "learn_exams" | "learn_topics" | "learn_mastery" | "learn_sessions";
const sessionRecord = TutorSessionSchema.omit({ blocks: true });
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const stableId = (prefix: string, sourceId: string, key: string) => `${prefix}-${hash(`${sourceId}:${key}`).slice(0, 32)}`;
const normalizeQuote = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

/** Every read and write is scoped to the authenticated subject fixed at construction. */
export class LearnRepository {
  readonly ownerSubject: string;
  constructor(private readonly database: StudiSqliteDatabase, ownerSubject: string, private readonly clock = () => new Date().toISOString()) {
    this.ownerSubject = OpaqueIdSchema.parse(ownerSubject);
  }
  now(): string { return IsoTimestampSchema.parse(this.clock()); }
  #get<T>(table: Table, key: string, schema: z.ZodType<T>): T | null {
    const row = this.database.handle.prepare(`SELECT record_json FROM ${table} WHERE owner_subject = ? AND id = ?`).get(this.ownerSubject, key);
    return row ? schema.parse(JSON.parse(String(row.record_json))) : null;
  }
  #list<T>(table: Table, schema: z.ZodType<T>): T[] {
    return this.database.handle.prepare(`SELECT record_json FROM ${table} WHERE owner_subject = ? ORDER BY id`).all(this.ownerSubject)
      .map(row => schema.parse(JSON.parse(String(row.record_json))));
  }
  #put(table: Table, key: string, value: unknown): void {
    this.database.handle.prepare(`INSERT INTO ${table}(owner_subject,id,record_json) VALUES (?,?,?) ON CONFLICT(owner_subject,id) DO UPDATE SET record_json=excluded.record_json`)
      .run(this.ownerSubject, key, JSON.stringify(value));
  }
  sources(): LearnSource[] { return this.#list("learn_sources", LearnSourceSchema); }
  exams(): Exam[] { return this.#list("learn_exams", ExamSchema); }
  topics(): LearnTopic[] { return this.#list("learn_topics", LearnTopicSchema); }
  mastery(): TopicMastery[] { return this.#list("learn_mastery", TopicMasterySchema); }
  source(key: string): LearnSource { const value = this.#get("learn_sources", key, LearnSourceSchema); if (!value) throw new Error("Learn source not found"); return value; }
  topic(key: string): LearnTopic { const value = this.#get("learn_topics", key, LearnTopicSchema); if (!value) throw new Error("Learn topic not found"); return value; }
  sessions(): TutorSession[] { return this.#list("learn_sessions", sessionRecord).map(record => this.session(record.sessionId)); }
  /** Overview reads never load blocks or transfer saved messages/evidence out of SQLite. */
  sessionSummaries(): TutorSessionSummary[] {
    return this.database.handle.prepare(`SELECT json_object(
      'sessionId',id,'topicId',json_extract(record_json,'$.topicId'),'mode',json_extract(record_json,'$.mode'),
      'goal',json_extract(record_json,'$.goal'),'status',json_extract(record_json,'$.status'),
      'updatedAt',json_extract(record_json,'$.updatedAt'),'startedAt',json_extract(record_json,'$.startedAt'),
      'finishedAt',json_extract(record_json,'$.finishedAt'),
      'result',CASE WHEN json_type(record_json,'$.result')='object' THEN json_object(
        'summary',substr(json_extract(record_json,'$.result.summary'),1,500),
        'next',substr(json_extract(record_json,'$.result.next'),1,500),'level',json_extract(record_json,'$.result.level')) ELSE NULL END
      ) AS summary FROM learn_sessions WHERE owner_subject=? ORDER BY json_extract(record_json,'$.updatedAt') DESC,id`)
      .all(this.ownerSubject).map(row => TutorSessionSummarySchema.parse(JSON.parse(String(row.summary))));
  }
  masterySummaries() {
    return this.database.handle.prepare(`SELECT json_object('topicId',id,'level',json_extract(record_json,'$.level'),
      'updatedAt',json_extract(record_json,'$.updatedAt'),'evidenceCount',json_array_length(record_json,'$.evidence')) AS summary
      FROM learn_mastery WHERE owner_subject=? ORDER BY id`).all(this.ownerSubject)
      .map(row => TopicMasterySummarySchema.parse(JSON.parse(String(row.summary))));
  }
  session(key: string): TutorSession {
    const record = this.#get("learn_sessions", key, sessionRecord);
    if (!record) throw new Error("Tutor session not found");
    const blocks = this.database.handle.prepare("SELECT id,sequence,status,record_json FROM learn_blocks WHERE owner_subject=? AND session_id=? ORDER BY sequence").all(this.ownerSubject, key).map(row => {
      const block = TutorBlockSchema.parse(JSON.parse(String(row.record_json)));
      if (row.id !== block.blockId || row.sequence !== block.sequence || row.status !== block.status) throw new Error("Tutor block columns do not match saved contents");
      return block;
    });
    return TutorSessionSchema.parse({ ...record, blocks });
  }
  learnState(today: string, selectedExamId?: string) {
    const sources = this.database.handle.prepare("SELECT json_remove(record_json,'$.text') AS summary FROM learn_sources WHERE owner_subject=? ORDER BY id").all(this.ownerSubject)
      .map(row => LearnSourceSchema.omit({ text: true }).parse(JSON.parse(String(row.summary))));
    const exams = this.exams(), topics = this.topics(), mastery = this.masterySummaries(), sessions = this.sessionSummaries();
    return { sources, exams, topics, mastery, sessions, plan: planLearn({ exams, topics, mastery, sessions, today, ...(selectedExamId ? { selectedExamId } : {}) }) };
  }

  importSource(value: unknown): LearnSource {
    const input = LearnSourceInputSchema.parse(value), now = this.now(), contentHash = hash(input.text);
    return this.database.transaction(() => {
      const previous = input.sourceId ? this.source(input.sourceId) : this.sources().find(source => source.courseId === input.courseId &&
        (input.sourceTarget ? source.sourceTarget === input.sourceTarget : source.contentHash === contentHash && source.kind === input.kind));
      if (previous && previous.contentHash === contentHash) return previous;
      if (previous && previous.courseId !== input.courseId) throw new Error("A source cannot move between courses");
      const source = LearnSourceSchema.parse({ ...input, sourceId: previous?.sourceId ?? id("source"), contentHash,
        status: "pending", extractedAt: null, error: null, createdAt: previous?.createdAt ?? now, updatedAt: now });
      this.#put("learn_sources", source.sourceId, source);
      return source;
    });
  }
  markSource(sourceId: string, contentHash: string, status: "reading" | "failed", error: string | null = null): LearnSource {
    return this.database.transaction(() => {
      const source = this.source(sourceId);
      if (source.contentHash !== contentHash) throw new Error("The source changed; read the current version");
      const updated = LearnSourceSchema.parse({ ...source, status, error, updatedAt: this.now() });
      this.#put("learn_sources", sourceId, updated);
      return updated;
    });
  }
  applyExtraction(sourceId: string, contentHash: string, value: unknown): LearnSource {
    const extraction = LearnExtractionSchema.parse(value);
    return this.database.transaction(() => {
      const source = this.source(sourceId), now = this.now();
      if (source.contentHash !== contentHash) throw new Error("The source changed during extraction; retry it");
      this.#validateExtraction(source, extraction);
      const previousExams = this.exams().filter(exam => exam.sourceId === sourceId);
      const examIds = new Map(extraction.exams.map(exam => [exam.key,
        previousExams.find(previous => normalizeTutorAnswer(previous.title) === normalizeTutorAnswer(exam.title))?.examId
          ?? stableId("exam", sourceId, normalizeTutorAnswer(exam.title))]));
      const previousTopics = this.topics().filter(topic => topic.sourceId === sourceId);
      const topicKeyToId = new Map(extraction.topics.map(topic => {
        const examId = topic.examKey ? examIds.get(topic.examKey) ?? null : null;
        return [topic.key, previousTopics.find(previous => previous.examId === examId && normalizeTutorAnswer(previous.title) === normalizeTutorAnswer(topic.title))?.topicId
          ?? stableId("topic", sourceId, `${examId ?? "free"}:${normalizeTutorAnswer(topic.title)}`)];
      }));
      const topicIds = new Set(topicKeyToId.values());
      for (const record of this.exams().filter(exam => exam.sourceId === sourceId)) {
        if (![...examIds.values()].includes(record.examId) && record.dateOrigin !== "student") this.#delete("learn_exams", record.examId);
      }
      for (const record of this.topics().filter(topic => topic.sourceId === sourceId)) {
        // Preserve historical topic/session links, but remove obsolete topics from the exam plan.
        if (!topicIds.has(record.topicId)) this.#put("learn_topics", record.topicId, { ...record, examId: null, weight: null, updatedAt: now });
      }
      for (const extracted of extraction.exams) {
        const examId = examIds.get(extracted.key)!;
        const old = this.#get("learn_exams", examId, ExamSchema);
        this.#put("learn_exams", examId, ExamSchema.parse({ examId, courseId: source.courseId, title: extracted.title,
          date: old?.dateOrigin === "student" ? old.date : extracted.date, dateOrigin: old?.dateOrigin ?? "source", sourceId, updatedAt: now }));
      }
      for (const extracted of extraction.topics) {
        const topicId = topicKeyToId.get(extracted.key)!;
        this.#put("learn_topics", topicId, LearnTopicSchema.parse({ topicId, courseId: source.courseId,
          examId: extracted.examKey ? examIds.get(extracted.examKey) : null, title: extracted.title, chapter: extracted.chapter,
          weight: extracted.weight, sourceId, origin: "source", updatedAt: now }));
      }
      const ready = LearnSourceSchema.parse({ ...source, status: "ready", extractedAt: now, updatedAt: now, error: null });
      this.#put("learn_sources", sourceId, ready);
      return ready;
    });
  }
  #validateExtraction(source: LearnSource, extraction: LearnExtraction): void {
    if (new Set(extraction.exams.map(e => e.key)).size !== extraction.exams.length || new Set(extraction.topics.map(t => t.key)).size !== extraction.topics.length) throw new Error("Extraction keys must be unique");
    if (new Set(extraction.exams.map(exam => normalizeTutorAnswer(exam.title))).size !== extraction.exams.length) throw new Error("Give each exam a distinct source-supported title");
    if (new Set(extraction.topics.map(topic => `${topic.examKey}:${normalizeTutorAnswer(topic.title)}`)).size !== extraction.topics.length) throw new Error("Topic titles must be distinct within an exam");
    const text = normalizeQuote(source.text);
    for (const item of [...extraction.exams, ...extraction.topics]) if (!text.includes(normalizeQuote(item.quote))) throw new Error("Extraction must quote the supplied source");
    for (const topic of extraction.topics) if (topic.examKey && !extraction.exams.some(exam => exam.key === topic.examKey)) throw new Error("Topic references a missing exam");
  }
  setExam(value: unknown): Exam {
    const input = LearnExamInputSchema.parse(value);
    return this.database.transaction(() => {
      const old = input.examId ? this.#get("learn_exams", input.examId, ExamSchema) : null;
      if (input.examId && !old) throw new Error("Exam not found");
      if (old && old.courseId !== input.courseId) throw new Error("An exam cannot move between courses");
      const source = old ? this.source(old.sourceId) : this.importSource({ courseId: input.courseId, title: input.title, kind: "typed", sourceTarget: null, text: `${input.title}\n${input.date ?? "Date unknown"}` });
      const exam = ExamSchema.parse({ ...input, examId: old?.examId ?? id("exam"), sourceId: source.sourceId, dateOrigin: "student", updatedAt: this.now() });
      this.#put("learn_exams", exam.examId, exam);
      return exam;
    });
  }
  createFreeTopic(title: string): LearnTopic {
    const existing = this.topics().find(topic => topic.origin === "student" && topic.examId === null && topic.courseId === null && normalizeTutorAnswer(topic.title) === normalizeTutorAnswer(title));
    if (existing) return existing;
    const topic = LearnTopicSchema.parse({ topicId: id("topic"), examId: null, courseId: null, title, chapter: 0, weight: null, sourceId: null, origin: "student", updatedAt: this.now() });
    this.#put("learn_topics", topic.topicId, topic);
    return topic;
  }
  /** Main supplies verified homework Inky actually worked. Titles remain hints, never exam scope or mastery. */
  syncHomeworkHints(items: readonly { assignmentId: string; courseId: string; title: string }[]): void {
    this.database.transaction(() => {
      const active = new Set<string>();
      for (const item of items) {
        const title = item.title.trim().slice(0, 500);
        const topicId = stableId("homework-topic", this.ownerSubject, OpaqueIdSchema.parse(item.assignmentId));
        active.add(topicId);
        const existing = this.#get("learn_topics", topicId, LearnTopicSchema);
        if (existing?.title === title && existing.courseId === item.courseId) continue;
        const topic = LearnTopicSchema.parse({ topicId, courseId: item.courseId, title, examId: null,
          chapter: 0, weight: null, sourceId: null, origin: "homework_hint", updatedAt: this.now() });
        this.#put("learn_topics", topicId, topic);
      }
      for (const topic of this.topics()) if (topic.origin === "homework_hint" && !active.has(topic.topicId) && !this.sessions().some(session => session.topicIds.includes(topic.topicId))) this.#delete("learn_topics", topic.topicId);
    });
  }
  #delete(table: Table, key: string): void { this.database.handle.prepare(`DELETE FROM ${table} WHERE owner_subject=? AND id=?`).run(this.ownerSubject, key); }

  startSession(topicId: string, goal: string, minutes: number, options: { mode?: TutorSession["mode"]; examId?: string; topicIds?: string[] } = {}): TutorSession {
    this.topic(topicId);
    return this.database.transaction(() => {
      const mode = options.mode ?? "topic", topicIds = options.topicIds ?? [topicId];
      if (!topicIds.includes(topicId) || new Set(topicIds).size !== topicIds.length) throw new Error("Session topics must be unique and include the primary topic");
      for (const topic of topicIds) this.topic(topic);
      if (mode === "mock_exam") {
        const exam = this.exams().find(item => item.examId === options.examId);
        const expected = this.topics().filter(item => item.examId === exam?.examId && item.origin !== "homework_hint").map(item => item.topicId);
        if (!exam || expected.length !== topicIds.length || expected.some(key => !topicIds.includes(key))) throw new Error("A mock exam must cover its saved exam topics");
      } else if (topicIds.length !== 1) throw new Error("A topic session has exactly one topic");
      const existing = this.sessions().find(session => session.topicId === topicId && session.mode === mode && ["active", "paused", "failed"].includes(session.status));
      if (existing) return existing;
      const now = this.now();
      const levels = new Map(this.mastery().map(item => [item.topicId, item.level]));
      const session = TutorSessionSchema.parse({ sessionId: id("tutor"), topicId, goal, mode, topicIds, examId: options.examId ?? null,
        initialLevels: Object.fromEntries(topicIds.map(key => [key, levels.get(key) ?? null])), status: "active", startedAt: now, updatedAt: now, finishedAt: null,
        budgetSeconds: minutes * 60, elapsedSeconds: 0, activeSince: now, initialLevel: this.mastery().find(item => item.topicId === topicId)?.level ?? null,
        blocks: [], messages: [], result: null, error: null });
      this.#saveSession(session);
      return session;
    });
  }
  #saveSession(value: TutorSession): TutorSession {
    const session = TutorSessionSchema.parse(value), { blocks, ...record } = session;
    if (JSON.stringify(session).length > 250000) throw new Error("The session reached its saved content budget; shorten the next block or finish it");
    if (blocks.filter(block => block.status === "open").length > 1) throw new Error("Only one tutor block may be open");
    this.#put("learn_sessions", session.sessionId, record);
    for (const block of blocks) this.database.handle.prepare(`INSERT INTO learn_blocks(owner_subject,id,session_id,sequence,status,record_json) VALUES (?,?,?,?,?,?)
      ON CONFLICT(owner_subject,id) DO UPDATE SET status=excluded.status,record_json=excluded.record_json`)
      .run(this.ownerSubject, block.blockId, session.sessionId, block.sequence, block.status, JSON.stringify(block));
    return session;
  }
  state(sessionId: string): TutorSession {
    const session = this.session(sessionId);
    return session.status === "active" && tutorTimeLeft(session, this.now()) <= 0 ? this.transition(sessionId, "expired") : session;
  }
  #active(sessionId: string): TutorSession {
    const session = this.state(sessionId);
    if (session.status !== "active") throw new Error(`Tutor session is ${session.status}; resume it before continuing`);
    return session;
  }
  transition(sessionId: string, status: "paused" | "active" | "cancelled" | "expired" | "failed", error: string | null = null): TutorSession {
    return this.database.transaction(() => {
      const session = this.session(sessionId), now = this.now();
      if (["completed", "cancelled", "expired"].includes(session.status)) return session;
      const remaining = tutorTimeLeft(session, now);
      if (remaining <= 0) status = "expired";
      const terminal = ["cancelled", "expired"].includes(status);
      return this.#saveSession({ ...session, status, updatedAt: now, elapsedSeconds: session.budgetSeconds - remaining,
        activeSince: status === "active" ? now : null, finishedAt: terminal ? now : null, error,
        blocks: terminal ? session.blocks.map(block => block.status === "open" ? { ...block, status: "cancelled" } : block) : session.blocks });
    });
  }
  /** A restart charges only through the last persisted event, preserving the saved block. */
  recover(): void {
    for (const session of this.sessions()) if (session.status === "active") this.database.transaction(() => {
      const remaining = tutorTimeLeft(session, session.updatedAt);
      this.#saveSession({ ...session, status: "paused", elapsedSeconds: session.budgetSeconds - remaining, activeSince: null, error: null });
    });
  }
  openBlock(sessionId: string, toolCallId: string, value: unknown): TutorBlock {
    const call = TutorCallSchema.parse(value);
    if (call.tool === "tutor_finish") return this.finish(sessionId, toolCallId, call.args).blocks.at(-1)!;
    return this.database.transaction(() => {
      const session = this.#active(sessionId);
      if ("topicId" in call.args && call.args.topicId && !session.topicIds.includes(call.args.topicId)) throw new Error("Question topic is outside this session");
      if (session.mode === "mock_exam" && ["tutor_ask_choice", "tutor_ask_typed", "tutor_ask_explain"].includes(call.tool) && (!("topicId" in call.args) || !call.args.topicId)) throw new Error("Mock exam questions must name their topicId");
      if (call.tool === "tutor_show_model") {
        const model = call.args;
        if (model.model === "population_grid" && model.params.sampleSize > model.params.population) throw new Error("Sample cannot exceed the population");
        if (model.model === "number_line" && (model.params.min >= model.params.max || model.params.points.some(point => point < model.params.min || point > model.params.max))) throw new Error("Number line bounds must contain all points");
        if (model.model === "function_plot" && model.params.xMin >= model.params.xMax) throw new Error("Function plot needs increasing bounds");
      }
      const replay = session.blocks.find(block => block.toolCallId === toolCallId);
      if (replay) {
        if (JSON.stringify({ tool: replay.tool, args: replay.args }) !== JSON.stringify(call)) throw new Error("Tool call ID was reused with different contents");
        return replay;
      }
      if (session.blocks.length >= 119) throw new Error("Tutor block budget reached; finish the session");
      if (session.blocks.some(block => block.status === "open") && call.tool !== "tutor_say") throw new Error("Answer the open block before creating another");
      const now = this.now();
      const block = TutorBlockSchema.parse({ ...call, blockId: id("block"), toolCallId, sequence: session.blocks.length,
        status: call.tool === "tutor_say" ? "complete" : "open", createdAt: now, elapsedAtCreation: session.budgetSeconds - tutorTimeLeft(session, now), answeredAt: null, result: null, hintsUsed: 0, draft: "" });
      this.#saveSession({ ...session, blocks: [...session.blocks, block], updatedAt: now });
      return block;
    });
  }
  answerBlock(sessionId: string, blockId: string, value: unknown): TutorSession {
    const answer = TutorBlockAnswerSchema.parse(value);
    return this.database.transaction(() => {
      const session = this.#active(sessionId), block = session.blocks.find(b => b.blockId === blockId);
      if (!block) throw new Error("Tutor block not found in this session");
      if (block.result) {
        if (JSON.stringify(block.result.answer) !== JSON.stringify(answer)) throw new Error("This block already has an answer");
        return session;
      }
      if (block.status !== "open") throw new Error("This block is closed");
      let correct: boolean | null = null;
      if (block.tool === "tutor_ask_choice" && answer.kind === "choice") {
        if (answer.picked >= block.args.options.length) throw new Error("Choose an available option");
        correct = answer.picked === block.args.correct;
      } else if (block.tool === "tutor_ask_typed" && answer.kind === "typed") correct = block.args.accept.some(item => normalizeTutorAnswer(item) === normalizeTutorAnswer(answer.answer));
      else if (!(block.tool === "tutor_ask_explain" && answer.kind === "explain") && !(block.tool === "tutor_show_model" && answer.kind === "model")) throw new Error("Answer does not match the open block");
      const now = this.now();
      const answered: TutorBlock = { ...block, status: "answered", answeredAt: now, draft: "", result: { answer, correct, hintsUsed: block.hintsUsed, seconds: Math.max(0, session.budgetSeconds - tutorTimeLeft(session, now) - block.elapsedAtCreation) } };
      return this.#saveSession({ ...session, blocks: session.blocks.map(b => b.blockId === blockId ? answered : b), updatedAt: now });
    });
  }
  hint(sessionId: string, blockId: string): TutorSession {
    return this.#editOpenBlock(sessionId, blockId, block => {
      if (block.tool !== "tutor_ask_typed") throw new Error("This block has no hint ladder");
      return { ...block, hintsUsed: Math.min(block.hintsUsed + 1, block.args.hints.length) };
    });
  }
  saveDraft(sessionId: string, blockId: string, draft: string): TutorSession {
    return this.#editOpenBlock(sessionId, blockId, block => {
      if (!["tutor_ask_typed", "tutor_ask_explain"].includes(block.tool)) throw new Error("This block has no draft");
      return { ...block, draft: z.string().max(10000).parse(draft) };
    });
  }
  #editOpenBlock(sessionId: string, blockId: string, edit: (block: TutorBlock) => TutorBlock): TutorSession {
    return this.database.transaction(() => {
      const session = this.#active(sessionId), block = session.blocks.find(b => b.blockId === blockId && b.status === "open");
      if (!block) throw new Error("Open tutor block not found");
      return this.#saveSession({ ...session, blocks: session.blocks.map(b => b.blockId === blockId ? edit(b) : b), updatedAt: this.now() });
    });
  }
  appendMessage(sessionId: string, messageId: string, text: string): TutorSession {
    return this.database.transaction(() => {
      const session = this.#active(sessionId), previous = session.messages.find(message => message.messageId === messageId);
      if (previous) { if (previous.text !== text) throw new Error("Message ID reused"); return session; }
      const message = TutorMessageSchema.parse({ messageId, text, createdAt: this.now(), delivered: false });
      return this.#saveSession({ ...session, messages: [...session.messages, message], updatedAt: this.now() });
    });
  }
  markMessagesDelivered(sessionId: string, ids: readonly string[]): void {
    this.database.transaction(() => {
      const session = this.session(sessionId);
      this.#saveSession({ ...session, messages: session.messages.map(message => ids.includes(message.messageId) ? { ...message, delivered: true } : message), updatedAt: this.now() });
    });
  }
  finish(sessionId: string, toolCallId: string, value: unknown): TutorSession {
    const input = TutorFinishInputSchema.parse(value);
    return this.database.transaction(() => {
      const saved = this.session(sessionId);
      if (saved.status === "completed") return saved;
      const session = this.#active(sessionId), now = this.now();
      if (session.blocks.some(block => block.status === "open")) throw new Error("Answer the open block before finishing");
      const assessments = input.assessments?.length ? input.assessments : [input];
      if (new Set(assessments.map(item => item.topic)).size !== assessments.length || assessments.some(item => !session.topicIds.includes(item.topic))) throw new Error("Assess each session topic at most once");
      if (session.mode === "mock_exam" && session.topicIds.some(topic => !assessments.some(item => item.topic === topic && item.evidence.length > 0))) throw new Error("The mock exam needs typed or explanation evidence for every exam topic");
      const allEvidence: MasteryEvidence[] = [];
      const changes: { topicId: string; previousLevel: number | null; level: number | null }[] = [];
      for (const assessment of assessments) {
        if (new Set(assessment.evidence.map(item => item.blockId)).size !== assessment.evidence.length) throw new Error("Evidence blocks must be unique");
        const evidence: MasteryEvidence[] = assessment.evidence.map(item => {
          const block = session.blocks.find(b => b.blockId === item.blockId);
          if (!block?.result || !["tutor_ask_typed", "tutor_ask_explain"].includes(block.tool)) throw new Error("Mastery requires an answered typed or explanation block from this session");
          const blockTopic = "topicId" in block.args ? block.args.topicId ?? session.topicId : session.topicId;
          if (blockTopic !== assessment.topic) throw new Error("Evidence belongs to a different topic");
          const answer = block.result.answer;
          if (answer.kind !== "typed" && answer.kind !== "explain") throw new Error("Invalid mastery evidence");
          if (answer.kind === "typed" && item.correct !== block.result.correct) throw new Error("The app's typed answer verdict cannot be overridden");
          return { sessionId, blockId: block.blockId, kind: answer.kind, correct: item.correct, answer: answer.kind === "typed" ? answer.answer : answer.text,
            rationale: item.rationale, hintsUsed: block.hintsUsed, recordedAt: now };
        });
        const old = this.mastery().find(item => item.topicId === assessment.topic), previousLevel = old?.level ?? null;
        let level = previousLevel;
        if (evidence.length) {
          const base = previousLevel ?? 0;
          const positive = evidence.some(item => item.correct && item.hintsUsed === 0);
          const negative = evidence.some(item => !item.correct);
          level = base;
          if (assessment.level > base && positive) {
            const ceiling = Math.min(4, base + 1, (session.initialLevels[assessment.topic] ?? 0) + 1);
            level = Math.max(base, Math.min(assessment.level, ceiling));
          } else if (assessment.level < base && negative) level = Math.max(assessment.level, base - 1);
          const mastery = TopicMasterySchema.parse({ topicId: assessment.topic, level, evidence: [...(old?.evidence ?? []), ...evidence].slice(-1000), updatedAt: now });
          this.#put("learn_mastery", assessment.topic, mastery);
        }
        allEvidence.push(...evidence);
        changes.push({ topicId: assessment.topic, previousLevel, level });
      }
      const primary = changes.find(item => item.topicId === session.topicId);
      const result = { summary: input.summary, previousLevel: primary?.previousLevel ?? null, level: primary?.level ?? null, evidence: allEvidence, missing: input.missing, next: input.next, assessments: changes };
      const block = TutorBlockSchema.parse({ tool: "tutor_finish", args: input, blockId: id("block"), toolCallId, sequence: session.blocks.length, status: "complete", createdAt: now, answeredAt: null, hintsUsed: 0, draft: "", result: null });
      return this.#saveSession({ ...session, status: "completed", result, blocks: [...session.blocks, block], finishedAt: now, updatedAt: now,
        elapsedSeconds: session.budgetSeconds - tutorTimeLeft(session, now), activeSince: null });
    });
  }
}

export function validateLearnRecords(database: StudiSqliteDatabase): void {
  const owners = database.handle.prepare("SELECT DISTINCT owner_subject FROM learn_sources UNION SELECT owner_subject FROM learn_sessions UNION SELECT owner_subject FROM learn_topics UNION SELECT owner_subject FROM learn_exams UNION SELECT owner_subject FROM learn_mastery").all();
  for (const owner of owners) {
    const repository = new LearnRepository(database, String(owner.owner_subject));
    repository.sources(); repository.exams(); repository.topics(); repository.mastery(); repository.sessions();
  }
}
