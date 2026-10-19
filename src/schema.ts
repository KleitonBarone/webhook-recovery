import { boolean, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
