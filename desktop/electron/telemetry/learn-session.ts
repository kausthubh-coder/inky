import { EVIDENCE_PHASES, type PublicTutorSession } from "../../shared/tutor.js";

/** Numeric lesson outcomes only; never copy student or tutor content. */
export function learnSessionMetrics(session: PublicTutorSession) {
  const questions = session.blocks.filter(block => block.tool.startsWith("tutor_ask_"));
  const unaided = questions.filter(block => (block.tool === "tutor_ask_typed" || block.tool === "tutor_ask_explain")
    && EVIDENCE_PHASES.includes(block.phase) && block.hintsUsed === 0 && block.attempts.length <= 1);
  const returning = unaided.filter(block => "topicId" in block.args && block.args.topicId && block.args.topicId !== session.topicId
    && session.initialLevels[block.args.topicId] != null);
  const waits = session.blocks.flatMap(block => {
    const next = block.answeredAt && session.blocks.find(item => item.sequence > block.sequence && item.createdAt >= block.answeredAt!);
    return next && block.answeredAt ? [Math.max(0, (Date.parse(next.createdAt) - Date.parse(block.answeredAt)) / 1000)] : [];
  }).sort((a, b) => a - b);
  const middle = Math.floor(waits.length / 2);
  const marked = questions.filter(block => typeof block.result?.correct === "boolean");
  return {
    mode: session.mode, outcome: session.status as "completed" | "expired" | "cancelled", minutes: session.elapsedSeconds / 60,
    questions: questions.length, unaided_asked: unaided.length, unaided_right: unaided.filter(block => block.result?.correct === true).length,
    came_back_asked: returning.length, came_back_right: returning.filter(block => block.result?.correct === true).length,
    clicked: session.result?.clicked.length ?? 0, chat_messages: session.messages.length,
    chat_replies: session.blocks.filter(block => block.tool === "tutor_reply").length,
    second_tries: questions.filter(block => block.attempts.length > 1).length,
    level_before: session.initialLevel, level_after: session.result?.level ?? session.initialLevel,
    wait_median_s: waits.length ? (waits[middle]! + waits[Math.floor((waits.length - 1) / 2)]!) / 2 : null,
    ...(session.mode === "mock_exam" ? { score_share: marked.length ? marked.filter(block => block.result?.correct === true).length / marked.length : null } : {}),
  };
}

/** Each coordinator owns its observer, so accounts cannot share session IDs. */
export function learnSessionObserver(capture: (metrics: ReturnType<typeof learnSessionMetrics>) => void, alreadyFinished: readonly string[] = []) {
  const finished = new Set(alreadyFinished);
  return (session: PublicTutorSession) => {
    if (!["completed", "expired", "cancelled"].includes(session.status) || finished.has(session.sessionId)) return;
    finished.add(session.sessionId);
    capture(learnSessionMetrics(session));
  };
}
