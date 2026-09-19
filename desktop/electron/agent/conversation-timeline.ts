import type { AgentJob } from '../../shared/agent-job.js';
import type { Assignment } from '../../shared/assignment.js';
import type { SchoolScan } from '../../shared/school-scan.js';
import type { TaskEvent } from '../../shared/task.js';
import type { NoteIndexEntry } from '../../shared/note.js';
import type { ConversationTimeline, TimelineEntry } from '../../shared/conversation-timeline.js';

const transitions = {
  working: ['started', 'I started working on this.'],
  needs_user: ['needs_user', 'I need your help with this.'],
  ready_review: ['ready_review', 'Your work is ready to review.'],
  submitted: ['submitted', 'Handed in. Open it to see the receipt.'],
  failed: ['failed', 'I couldn’t finish this. Your saved work is still available.'],
} as const;

/** One presentation of existing durable records; worker sessions remain separate. */
export function projectConversationTimeline(input: {
  jobs: readonly AgentJob[];
  scans: readonly SchoolScan[];
  events: readonly TaskEvent[];
  assignments: readonly Assignment[];
  notes?: readonly NoteIndexEntry[];
  tutorEntries?: readonly TimelineEntry[];
  ownerSubject?: string;
  limit?: number;
}): ConversationTimeline {
  const entries: TimelineEntry[] = [];
  const assignments = new Map(input.assignments.map(assignment => [assignment.assignmentId, assignment]));
  for (const job of input.jobs) {
    if (!input.ownerSubject || job.ownerSubject !== input.ownerSubject) continue;
    if (job.target.kind === 'tutor') continue; // Tutor sessions supply their own saved blocks/messages.
    const title = job.target.kind === 'assignment' ? assignments.get(job.target.assignmentId)?.title
      : job.target.kind === 'scan' ? 'School check' : job.target.kind === 'learn' ? 'Learn with Inky' : 'You and Inky';
    for (const message of job.messages) entries.push({
      id: `message:${message.messageId}`, kind: 'message', context: job.target,
      title, createdAt: message.createdAt, text: message.text, role: message.role,
    });
  }
  for (const scan of input.scans) {
    if (!input.ownerSubject || scan.ownerSubject !== input.ownerSubject) continue;
    const context = { kind: 'scan', scanId: scan.scanId } as const;
    for (const message of scan.messages) entries.push({
      id: `message:${message.messageId}`, kind: 'message', context, title: 'School check',
      createdAt: message.createdAt, text: message.text, role: message.role,
    });
    if (scan.completedAt) entries.push({
      id: `scan:${scan.scanId}:finished`, kind: 'event', event: 'scan_finished', context,
      title: 'School check', createdAt: scan.completedAt,
      text: scan.state === 'succeeded' ? 'I finished checking school.'
        : scan.state === 'partial' ? 'School check saved. Some details still need checking.'
          : 'I couldn’t finish checking school.',
    });
  }
  for (const event of input.events) {
    if (event.type !== 'task_state_changed') continue;
    const transition = transitions[event.payload.to as keyof typeof transitions];
    if (!transition) continue;
    entries.push({
      id: `task-event:${event.eventId}`, kind: 'event', event: transition[0],
      context: { kind: 'assignment', assignmentId: event.payload.assignmentId },
      title: assignments.get(event.payload.assignmentId)?.title ?? 'Assignment',
      createdAt: event.occurredAt, text: transition[1],
    });
  }
  for (const note of input.notes ?? []) {
    if (note.about !== 'preference' || note.scope !== 'student' || note.subjectId !== input.ownerSubject) continue;
    entries.push({ id: `note:${note.noteId}:${note.revision}`, kind: 'event', event: 'memory_saved',
      context: { kind: 'home' }, title: note.title, createdAt: note.updatedAt, text: 'I saved this preference.' });
  }
  entries.push(...(input.tutorEntries ?? []));
  const ordered = [...new Map(entries.map(entry => [entry.id, entry])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(500, input.limit ?? 200));
  return { entries: ordered.slice(-limit), hasMore: ordered.length > limit };
}
