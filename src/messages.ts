import { type } from "arktype";

export const Event = type({
  schemaVersion: "1",
  type: "'refund.status_changed'",
  eventId: "string.uuid",
  refundId: /^[a-zA-Z0-9_-]{1,64}$/,
  version: "number.integer >= 1 & number <= 2147483647",
  status: "'pending' | 'completed' | 'failed'",
  "+": "reject",
});
export type Event = typeof Event.infer;
export const Receipt = type({
  id: "string.uuid",
  eventId: "string.uuid",
  acceptedAt: "string.date.iso",
});
export const states = [
  "received",
  "processing",
  "retry_scheduled",
  "processed",
  "ignored_stale",
  "dead_lettered",
] as const;
export const State = type.enumerated(...states);
export type State = typeof State.infer;
export const Session = type({ role: "'viewer' | 'operator'", sourceId: "string", demo: "boolean" });
export type Session = typeof Session.infer;
export const InboxItem = type({
  id: "string.uuid",
  eventId: "string.uuid",
  acceptedAt: "string.date.iso",
  state: State,
  payload: Event,
});
export const InboxPage = type({ items: InboxItem.array(), nextOffset: "number | null" });
export const Attempt = type({
  id: "string.uuid",
  number: "number",
  cycleNumber: "number",
  cycleAttempt: "number",
  startedAt: "string.date.iso",
  finishedAt: "string.date.iso | null",
  outcome:
    "'running' | 'abandoned' | 'processed' | 'ignored_stale' | 'dead_lettered' | 'retry_scheduled'",
  reason: "string | null",
  failureCode: "string | null",
  retryAt: "string.date.iso | null",
  replayId: "string | null",
});
export const ReplayRecord = type({
  id: "string.uuid",
  cycleNumber: "number",
  reason: "string",
  operatorId: "string",
  requestedAt: "string.date.iso",
});
export const Detail = type({
  event: InboxItem.and({
    raw: "string",
    bodyHash: "string",
    reason: "string | null",
    leaseUntil: "string.date.iso | null",
    nextAttemptAt: "string.date.iso | null",
    cycleNumber: "number",
    cycleAttempt: "number",
  }),
  attempts: Attempt.array(),
  attemptsNextOffset: "number | null",
  replays: ReplayRecord.array(),
  replaysNextOffset: "number | null",
  receipt: type({
    decision: "'applied' | 'same_version' | 'stale'",
    createdAt: "string.date.iso",
  }).or("null"),
  projection: type({
    version: "number",
    status: "'pending' | 'completed' | 'failed'",
    updatedAt: "string.date.iso",
  }).or("null"),
  completions: type({ id: "string.uuid", action: "string", createdAt: "string.date.iso" }).array(),
});
export type Detail = typeof Detail.infer;
export const AttemptPage = type({ items: Attempt.array(), nextOffset: "number | null" });
export const ReplayPage = type({ items: ReplayRecord.array(), nextOffset: "number | null" });
export const FixtureResponse = type({ receipt: Receipt });
export const ReplayResponse = type({ replay: ReplayRecord });
