import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
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
  },
  (table) => [
    uniqueIndex("inbox_source_event").on(table.sourceId, table.eventId),
    index("inbox_source_accepted").on(table.sourceId, table.acceptedAt),
  ],
);
