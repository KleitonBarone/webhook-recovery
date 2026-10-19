import cookie from "@fastify/cookie";
import { type } from "arktype";
import { and, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { State } from "./contract.js";
import { type Database, hash } from "./database.js";
import { RequestError } from "./errors.js";
import { ReplayInput, replayEvent } from "./replay.js";
import {
  attempts,
  completions,
  inbox,
  processingReceipts,
  refunds,
  replayRequests,
  sessions,
  sources,
} from "./schema.js";

const Login = type({ token: "24 <= string <= 256", "+": "reject" });
const ListQuery = type({
  "state?": State,
  "limit?": /^(?:[1-9]|[1-9][0-9]|100)$/,
  "offset?": /^(?:0|[1-9][0-9]{0,3}|10000)$/,
  "+": "reject",
});
const UUID = type("string.uuid");

// Every cookie-authenticated mutation must originate from the same local origin.
export function requireOrigin(request: FastifyRequest) {
  try {
    const origin = new URL(request.headers.origin ?? "");
    if (
      origin.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
      origin.host === request.headers.host
    )
      return;
  } catch {
    /* Missing or malformed origin is denied below. */
  }
  throw new RequestError(403, "A matching local Origin is required");
}
async function sessionForToken(connection: Database, token: string | undefined) {
  if (!token || token.length > 256) throw new RequestError(401, "Operator session required");
  const [found] = await connection.db
    .select({ session: sessions })
    .from(sessions)
    .innerJoin(sources, eq(sessions.sourceId, sources.id))
    .where(
      and(
        eq(sessions.tokenHash, hash(token)),
        gt(sessions.expiresAt, new Date()),
        eq(sources.enabled, true),
      ),
    )
    .limit(1);
  if (!found) throw new RequestError(401, "Operator session required");
  return found.session;
}
export function authenticate(connection: Database, request: FastifyRequest) {
  const bearer = request.headers.authorization;
  return sessionForToken(
    connection,
    request.cookies.recovery_session ??
      (bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined),
  );
}
export async function requireOperator(connection: Database, request: FastifyRequest) {
  const session = await authenticate(connection, request);
  if (session.role !== "operator") throw new RequestError(403, "Operator permission required");
  return session;
}
export async function eventForOperator(connection: Database, sourceId: string, id: string) {
  if (!UUID.allows(id)) throw new RequestError(400, "Invalid event ID");
  const [event] = await connection.db
    .select()
    .from(inbox)
    .where(and(eq(inbox.id, id), eq(inbox.sourceId, sourceId)))
    .limit(1);
  if (!event) throw new RequestError(404, "Event not found");
  return event;
}

export function operatorRoutes(app: FastifyInstance, connection: Database) {
  app.register(cookie);
  app.post("/api/session", { bodyLimit: 512 }, async (request, reply) => {
    requireOrigin(request);
    const input = Login(request.body);
    if (input instanceof type.errors) throw new RequestError(400, "Invalid session input");
    const session = await sessionForToken(connection, input.token);
    reply.setCookie("recovery_session", input.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/api",
      maxAge: 86400,
    });
    return { role: session.role, sourceId: session.sourceId };
  });
  app.get("/api/session", async (request) => {
    const session = await authenticate(connection, request);
    return { role: session.role, sourceId: session.sourceId };
  });
  app.delete("/api/session", async (request, reply) => {
    requireOrigin(request);
    reply.clearCookie("recovery_session", { path: "/api" });
    return { signedOut: true };
  });
  app.get("/api/events", async (request) => {
    const session = await authenticate(connection, request);
    const query = ListQuery(request.query);
    if (query instanceof type.errors) throw new RequestError(400, "Invalid list filters");
    const limit = Number(query.limit ?? 50);
    const offset = Number(query.offset ?? 0);
    const items = await connection.db
      .select({
        id: inbox.id,
        eventId: inbox.eventId,
        acceptedAt: inbox.acceptedAt,
        state: inbox.state,
        payload: inbox.payload,
      })
      .from(inbox)
      .where(
        and(
          eq(inbox.sourceId, session.sourceId),
          query.state ? eq(inbox.state, query.state) : undefined,
        ),
      )
      .orderBy(desc(inbox.acceptedAt), desc(inbox.id))
      .limit(limit)
      .offset(offset);
    return {
      items,
      limit,
      offset,
      nextOffset: items.length === limit && offset + limit <= 10000 ? offset + limit : null,
    };
  });
  app.get<{ Params: { id: string } }>("/api/events/:id", async (request) => {
    const session = await authenticate(connection, request);
    const event = await eventForOperator(connection, session.sourceId, request.params.id);
    const history = await connection.db
      .select()
      .from(attempts)
      .where(eq(attempts.inboxId, event.id))
      .orderBy(desc(attempts.number))
      .limit(51);
    const [receipt] = await connection.db
      .select()
      .from(processingReceipts)
      .where(eq(processingReceipts.inboxId, event.id))
      .limit(1);
    const [projection] = await connection.db
      .select()
      .from(refunds)
      .where(
        and(eq(refunds.sourceId, session.sourceId), eq(refunds.refundId, event.payload.refundId)),
      )
      .limit(1);
    const ledger = await connection.db
      .select()
      .from(completions)
      .where(
        and(
          eq(completions.sourceId, session.sourceId),
          eq(completions.refundId, event.payload.refundId),
        ),
      )
      .limit(1);
    const replays = await connection.db
      .select()
      .from(replayRequests)
      .where(eq(replayRequests.inboxId, event.id))
      .orderBy(desc(replayRequests.cycleNumber))
      .limit(51);
    return {
      event,
      attempts: history.slice(0, 50).reverse(),
      attemptsNextOffset: history.length > 50 ? 50 : null,
      receipt: receipt ?? null,
      projection: projection ?? null,
      completions: ledger,
      replays: replays.slice(0, 50).reverse(),
      replaysNextOffset: replays.length > 50 ? 50 : null,
    };
  });
  app.post<{ Params: { id: string } }>(
    "/api/events/:id/replay",
    { bodyLimit: 4096 },
    async (request, reply) => {
      requireOrigin(request);
      const session = await requireOperator(connection, request);
      const input = ReplayInput(request.body);
      if (input instanceof type.errors) throw new RequestError(400, "Invalid replay request");
      const replay = await replayEvent(
        connection,
        { sourceId: session.sourceId, operatorId: hash(session.tokenHash) },
        request.params.id,
        input,
      );
      reply.code(202);
      return { replay };
    },
  );
  app.get<{ Params: { id: string } }>("/api/events/:id/replays", async (request) => {
    const session = await authenticate(connection, request);
    const event = await eventForOperator(connection, session.sourceId, request.params.id);
    const query = ListQuery.omit("state")(request.query);
    if (query instanceof type.errors) throw new RequestError(400, "Invalid replay pagination");
    const limit = Number(query.limit ?? 50);
    const offset = Number(query.offset ?? 0);
    const items = await connection.db
      .select()
      .from(replayRequests)
      .where(eq(replayRequests.inboxId, event.id))
      .orderBy(desc(replayRequests.cycleNumber))
      .limit(limit)
      .offset(offset);
    return {
      items,
      nextOffset: items.length === limit && offset + limit <= 10000 ? offset + limit : null,
    };
  });
  app.get<{ Params: { id: string } }>("/api/events/:id/attempts", async (request) => {
    const session = await authenticate(connection, request);
    const event = await eventForOperator(connection, session.sourceId, request.params.id);
    const query = ListQuery.omit("state")(request.query);
    if (query instanceof type.errors) throw new RequestError(400, "Invalid history pagination");
    const limit = Number(query.limit ?? 50);
    const offset = Number(query.offset ?? 0);
    const items = await connection.db
      .select()
      .from(attempts)
      .where(eq(attempts.inboxId, event.id))
      .orderBy(desc(attempts.number))
      .limit(limit)
      .offset(offset);
    return {
      items,
      nextOffset: items.length === limit && offset + limit <= 10000 ? offset + limit : null,
    };
  });
  app.get<{ Params: { id: string } }>("/api/events/:id/receipt", async (request) => {
    const session = await authenticate(connection, request);
    const event = await eventForOperator(connection, session.sourceId, request.params.id);
    return { id: event.id, eventId: event.eventId, acceptedAt: event.acceptedAt.toISOString() };
  });
}
