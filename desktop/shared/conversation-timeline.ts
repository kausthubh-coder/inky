import { z } from 'zod';
import { IsoTimestampSchema } from './schema-version.js';

export const TimelineContextSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('home') }),
  z.strictObject({ kind: z.literal('learn') }),
  z.strictObject({ kind: z.literal('assignment'), assignmentId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('scan'), scanId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('tutor'), sessionId: z.string().min(1) }),
]);
const common = {
  id: z.string().min(1), context: TimelineContextSchema,
  createdAt: IsoTimestampSchema, text: z.string().max(100_000), title: z.string().optional(),
};
export const TimelineEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('message'), role: z.enum(['user', 'assistant']) }),
  z.strictObject({ ...common, kind: z.literal('event'), event: z.enum([
    'started', 'needs_user', 'ready_review', 'submitted', 'failed', 'scan_finished', 'session_finished', 'memory_saved',
  ]) }),
]);
export const ConversationTimelineInputSchema = z.strictObject({ limit: z.number().int().min(1).max(500).optional() }).optional();
export const ConversationTimelineSchema = z.strictObject({ entries: z.array(TimelineEntrySchema), hasMore: z.boolean() });
export type TimelineContext = z.infer<typeof TimelineContextSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type ConversationTimeline = z.infer<typeof ConversationTimelineSchema>;
