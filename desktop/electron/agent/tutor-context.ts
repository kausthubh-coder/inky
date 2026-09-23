import type { LearnRepository } from "../storage/learn-records.js";
import type { TutorSession } from "../../shared/tutor.js";

/** Homework Inky already did in the goal's class, as main knows it. */
export interface WorkedHomework { courseId: string; title: string; instructions?: string | undefined; requirements: string[] }
export interface TutorContextSources {
  courseLabel(courseId: string): string | null;
  workedHomework(courseId: string): WorkedHomework[];
  today(): string;
}

const STOP = new Set("the and for with that this from what when your you are was were have has into over under about which their there then than each also only such not but can will how why".split(" "));
const words = (text: string) => text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{3,}/gu)?.filter(word => !STOP.has(word)) ?? [];

/** Paragraph chunks of the source that share the most words with the query, in source order, within a character budget. */
export function pickExcerpts(text: string, query: string, budget = 3000, chunkSize = 900): string[] {
  const terms = new Set(words(query));
  if (!terms.size || !text.trim()) return [];
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/).map(part => part.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    for (let start = 0; start < paragraph.length; start += chunkSize) {
      const piece = paragraph.slice(start, start + chunkSize), last = chunks.at(-1);
      if (last && last.length + piece.length < chunkSize) chunks[chunks.length - 1] = `${last} ${piece}`;
      else chunks.push(piece);
    }
  }
  const scored = chunks.map((chunk, index) => ({ index, chunk, score: new Set(words(chunk).filter(word => terms.has(word))).size }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: typeof scored = [];
  let used = 0;
  for (const item of scored) {
    if (used + item.chunk.length > budget) continue;
    picked.push(item); used += item.chunk.length;
  }
  return picked.sort((a, b) => a.index - b.index).map(item => item.chunk);
}

/** What the tutor needs to teach this student for this goal: the goal, the student's level, and their real class material. */
export function buildTutorContext(repository: LearnRepository, session: TutorSession, sources: TutorContextSources) {
  const goal = session.examId ? repository.exams().find(exam => exam.examId === session.examId) ?? null : null;
  const topics = session.topicIds.map(topicId => repository.topic(topicId));
  const mastery = new Map(repository.mastery().map(item => [item.topicId, item]));
  const query = [goal?.title, goal?.scopeNote, ...topics.map(topic => topic.title)].filter(Boolean).join(" ");
  const terms = new Set(words(query));
  const courseId = goal?.courseId ?? topics[0]?.courseId ?? null;
  const material = repository.sources()
    .filter(source => source.status === "ready" && (source.examId ? source.examId === goal?.examId : !!courseId && source.courseId === courseId))
    .map(source => ({ title: source.title, excerpts: pickExcerpts(source.text, query, 2500) }))
    .filter(source => source.excerpts.length).slice(0, 4);
  const homework = courseId ? sources.workedHomework(courseId)
    .map(item => ({ ...item, score: new Set(words(`${item.title} ${item.instructions ?? ""}`).filter(word => terms.has(word))).size }))
    .sort((a, b) => b.score - a.score).slice(0, 3)
    .map(({ title, instructions, requirements }) => ({ title, instructions: instructions?.slice(0, 1200) ?? null, requirements: requirements.slice(0, 6).map(text => text.slice(0, 300)) })) : [];
  const daysLeft = goal?.date ? Math.ceil((Date.parse(`${goal.date}T00:00:00Z`) - Date.parse(`${sources.today()}T00:00:00Z`)) / 86_400_000) : null;
  return {
    goal: goal ? { title: goal.title, kind: goal.kind, class: goal.courseId ? sources.courseLabel(goal.courseId) : null, date: goal.date, daysLeft, scopeNote: goal.scopeNote } : null,
    topics: topics.map(topic => {
      const record = mastery.get(topic.topicId);
      return { topicId: topic.topicId, title: topic.title, level: record?.level ?? null,
        lastEvidence: record?.evidence.slice(-3).map(item => ({ correct: item.correct, rationale: item.rationale })) ?? [] };
    }),
    material, homework,
  };
}
