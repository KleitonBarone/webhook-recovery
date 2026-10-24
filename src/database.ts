import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, inArray, notInArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { Configuration } from "./config.js";
import * as schema from "./schema.js";

export function database(config: Pick<Configuration, "databaseUrl">) {
  const client = postgres(config.databaseUrl, {
    max: 8,
    connect_timeout: 5,
    connection: { statement_timeout: 10000, idle_in_transaction_session_timeout: 10000 },
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}
export type Database = ReturnType<typeof database>;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const otherSecret = (secret: string) =>
  createHmac("sha256", secret).update("other").digest("hex");

export async function migrateDatabase(connection: Database) {
  await migrate(connection.db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
}

// Demo credentials stay in the API/database. The browser receives only a session cookie.
export async function seedDatabase(connection: Database, config: Configuration) {
  if (!config.demo) throw new Error("Seeding requires explicit DEMO_MODE=true");
  const credentials = [
    {
      tokenHash: hash(config.operatorToken),
      sourceId: "demo",
      role: "operator" as const,
      expiresAt: new Date(Date.now() + 86400000),
    },
    {
      tokenHash: hash(config.viewerToken),
      sourceId: "demo",
      role: "viewer" as const,
      expiresAt: new Date(Date.now() + 86400000),
    },
    {
      tokenHash: hash(otherSecret(config.operatorToken)),
      sourceId: "other",
      role: "operator" as const,
      expiresAt: new Date(Date.now() + 86400000),
    },
  ];
  await connection.db.transaction(async (tx) => {
    await tx
      .insert(schema.sources)
      .values([
        { id: "demo", secret: config.sourceSecret },
        { id: "other", secret: otherSecret(config.sourceSecret) },
      ])
      .onConflictDoUpdate({
        target: schema.sources.id,
        set: { secret: sql`excluded.secret` },
      });
    await tx
      .update(schema.sessions)
      .set({ expiresAt: new Date(0) })
      .where(
        and(
          inArray(schema.sessions.sourceId, ["demo", "other"]),
          notInArray(
            schema.sessions.tokenHash,
            credentials.map((credential) => credential.tokenHash),
          ),
        ),
      );
    await tx
      .insert(schema.sessions)
      .values(credentials)
      .onConflictDoUpdate({
        target: schema.sessions.tokenHash,
        set: {
          sourceId: sql`excluded.source_id`,
          role: sql`excluded.role`,
          expiresAt: sql`excluded.expires_at`,
        },
      });
  });
}
