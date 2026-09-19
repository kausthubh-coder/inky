import assert from 'node:assert/strict';
import test from 'node:test';
import { projectConversationTimeline } from '../../dist/electron/agent/conversation-timeline.js';
import { ConversationTimelineSchema } from '../../dist/shared/conversation-timeline.js';

const at = minute => `2026-09-19T13:${String(minute).padStart(2, '0')}:00.000Z`;
const message = (messageId, minute) => ({ messageId, role: 'assistant', text: messageId, createdAt: at(minute) });
const base = { jobs: [], scans: [], events: [], assignments: [{ assignmentId: 'assignment-1', title: 'Essay' }], ownerSubject: 'student-1' };

test('one timeline preserves contexts and ordering without duplicating scan messages', () => {
  const scanMessage = message('scan-reply', 3);
  const timeline = projectConversationTimeline({ ...base,
    jobs: [
      { ownerSubject: 'student-1', target: { kind: 'home' }, messages: [message('home', 1)] },
      { ownerSubject: 'student-1', target: { kind: 'assignment', assignmentId: 'assignment-1' }, messages: [message('work', 2)] },
      { ownerSubject: 'student-1', target: { kind: 'scan', scanId: 'scan-1' }, messages: [scanMessage] },
    ],
    scans: [{ ownerSubject: 'student-1', scanId: 'scan-1', state: 'partial', messages: [scanMessage], completedAt: at(4) }],
    events: [{ type: 'task_state_changed', eventId: 'review', occurredAt: at(5), payload: { assignmentId: 'assignment-1', to: 'ready_review' } }],
  });
  ConversationTimelineSchema.parse(timeline);
  assert.deepEqual(timeline.entries.map(entry => entry.context.kind), ['home', 'assignment', 'scan', 'scan', 'assignment']);
  assert.equal(timeline.entries[1].title, 'Essay');
  assert.match(timeline.entries[3].text, /Some details still need checking/);
  assert.equal(timeline.entries[4].event, 'ready_review');
});

test('other accounts and unowned legacy home messages stay out of the timeline', () => {
  const result = projectConversationTimeline({ ...base,
    jobs: [
      { ownerSubject: 'student-2', target: { kind: 'home' }, messages: [message('private', 1)] },
      { target: { kind: 'home' }, messages: [message('legacy-unowned', 1)] },
      { ownerSubject: 'student-2', target: { kind: 'assignment', assignmentId: 'assignment-1' }, messages: [message('private-work', 1)] },
      { target: { kind: 'assignment', assignmentId: 'assignment-1' }, messages: [message('unknown-work', 1)] },
      { ownerSubject: 'student-1', target: { kind: 'home' }, messages: [message('mine', 2)] },
    ],
    scans: [{ ownerSubject: 'student-2', scanId: 'private-scan', state: 'partial', messages: [message('private-scan', 1)], completedAt: at(4) }],
    notes: [
      { about: 'preference', scope: 'student', subjectId: 'student-2', noteId: 'private', revision: 1, updatedAt: at(3), title: 'Private' },
      { about: 'preference', scope: 'course', subjectId: 'unowned-course', noteId: 'scoped', revision: 1, updatedAt: at(3), title: 'Unknown ownership' },
      { about: 'preference', scope: 'student', subjectId: 'student-1', noteId: 'mine', revision: 1, updatedAt: at(3), title: 'My preference' },
    ],
  });
  assert.deepEqual(result.entries.map(entry => entry.id), ['message:mine', 'note:mine:1']);
});

test('bounded history returns the latest records and a truthful truncation flag', () => {
  const input = { ...base, jobs: [{ ownerSubject: 'student-1', target: { kind: 'home' }, messages: [message('first', 1), message('second', 2)] }] };
  assert.equal(projectConversationTimeline(input).hasMore, false);
  const limited = projectConversationTimeline({ ...input, limit: 1 });
  assert.equal(limited.hasMore, true);
  assert.deepEqual(limited.entries.map(entry => entry.id), ['message:second']);
});
