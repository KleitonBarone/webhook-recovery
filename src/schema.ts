import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { type Event, states } from "./contract.js";

export const operatorRole = pgEnum("operator_role", ["viewer", "operator"]);
export const sources = pgTable("sources", {
  id: text().primaryKey(),
  secret: text().notNull(),
  enabled: boolean().notNull().default(true),
});
export const sessions = pgTable("operator_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id),
  role: operatorRole().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const processingState = pgEnum("processing_state", states);
export const inbox = pgTable(
  "inbox",
  {
    id: uuid().primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    eventId: uuid("event_id").notNull(),
    raw: text().notNull(),
    bodyHash: text("body_hash").notNull(),
    payload: jsonb().$type<Event>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    state: processingState().notNull().default("received"),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attemptNumber: integer("attempt_number").notNull().default(0),
    reason: text(),
  },
  (table) => [
    uniqueIndex("inbox_source_event").on(table.sourceId, table.eventId),
    index("inbox_source_accepted").on(table.sourceId, table.acceptedAt),
    index("inbox_claim_due").on(table.state, table.leaseUntil, table.acceptedAt),
    check(
      "inbox_processing_lease",
      sql`(${table.state} = 'processing' and ${table.leaseToken} is not null and ${table.leaseUntil} is not null) or (${table.state} <> 'processing' and ${table.leaseToken} is null and ${table.leaseUntil} is null)`,
    ),
  ],
);
export const attemptOutcome = pgEnum("attempt_outcome", [
  "running",
  "abandoned",
  "processed",
  "ignored_stale",
  "dead_lettered",
  "retry_scheduled",
]);
export const attempts = pgTable(
  "processing_attempts",
  {
    id: uuid().primaryKey(),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inbox.id),
    number: integer().notNull(),
    workerId: text("worker_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: attemptOutcome().notNull().default("running"),
    reason: text(),
  },
  (table) => [uniqueIndex("attempt_event_number").on(table.inboxId, table.number)],
);
export const refundStatus = pgEnum("refund_status", ["pending", "completed", "failed"]);
export const refunds = pgTable(
  "refund_projections",
  {
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    refundId: text("refund_id").notNull(),
    version: integer().notNull(),
    status: refundStatus().notNull(),
    lastInboxId: uuid("last_inbox_id")
      .notNull()
      .references(() => inbox.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.refundId] })],
);
export const completions = pgTable(
  "completion_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    refundId: text("refund_id").notNull(),
    action: text().notNull().default("completion"),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => inbox.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("completion_business_identity").on(table.sourceId, table.refundId, table.action),
    check("completion_action", sql`${table.action} = 'completion'`),
  ],
);
export const receiptDecision = pgEnum("receipt_decision", ["applied", "same_version", "stale"]);
export const processingReceipts = pgTable("processing_receipts", {
  inboxId: uuid("inbox_id")
    .primaryKey()
    .references(() => inbox.id),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => attempts.id),
  decision: receiptDecision().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
