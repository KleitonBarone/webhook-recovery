import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { decodeEvent, verifySignature } from "./contract.js";
import { type Database, hash } from "./database.js";
import { RequestError } from "./errors.js";
import { observe } from "./observability.js";
import { inbox, sources } from "./schema.js";

export async function accept(
  connection: Database,
  sourceId: string,
  body: Buffer,
  signed: unknown,
) {
  const [source] = await connection.db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.enabled, true)))
    .limit(1);
  if (!source || !verifySignature(body, signed, source.secret))
    throw new RequestError(401, "Invalid signature");
  const { payload, raw } = decodeEvent(body);
  const digest = hash(raw);
  // PostgreSQL's unique constraint waits for competing inserts. The statement commits
  // before a receipt is returned; a duplicate reads the winner in a fresh snapshot.
  const [inserted] = await connection.db
    .insert(inbox)
    .values({
      id: randomUUID(),
      sourceId,
      eventId: payload.eventId,
      raw,
      bodyHash: digest,
      payload,
    })
    .onConflictDoNothing({ target: [inbox.sourceId, inbox.eventId] })
    .returning();
  const existing =
    inserted ??
    (
      await connection.db
        .select()
        .from(inbox)
        .where(and(eq(inbox.sourceId, sourceId), eq(inbox.eventId, payload.eventId)))
        .limit(1)
    )[0];
  if (!existing) throw new Error("Accepted event disappeared");
  if (existing.bodyHash !== digest || existing.raw !== raw) {
    observe("conflicting", { sourceId, inboxId: existing.id, eventId: existing.eventId });
    throw new RequestError(409, "Event identity already has different bytes");
  }
  observe(inserted ? "accepted" : "duplicate", {
    sourceId,
    inboxId: existing.id,
    eventId: existing.eventId,
  });
  return {
    receipt: {
      id: existing.id,
      eventId: existing.eventId,
      acceptedAt: existing.acceptedAt.toISOString(),
    },
    duplicate: !inserted,
  };
}

export function intakeRoutes(app: FastifyInstance, connection: Database) {
  app.register(async (webhooks) => {
    webhooks.removeContentTypeParser("application/json");
    webhooks.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
    webhooks.post<{ Params: { sourceId: string }; Body: Buffer }>(
      "/webhooks/:sourceId",
      async (request, reply) => {
        if (
          request.headers["content-encoding"] &&
          request.headers["content-encoding"] !== "identity"
        )
          throw new RequestError(415, "Only identity encoding is supported");
        const result = await accept(
          connection,
          request.params.sourceId,
          request.body,
          request.headers["x-recovery-signature"],
        );
        return reply.code(202).send(result.receipt);
      },
    );
  });
}
