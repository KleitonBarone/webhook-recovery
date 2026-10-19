import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { Receipt } from "./contract.js";
import type { Database } from "./database.js";
import { RequestError } from "./errors.js";
import { eventForOperator, requireOperator, requireOrigin } from "./operator.js";
import { sources, syntheticFaults } from "./schema.js";
import { fixture, send } from "./sender.js";

const FixtureInput = type({ scenario: "'success' | 'transient' | 'permanent'", "+": "reject" });
const Empty = type({ "+": "reject" });

// These routes are registered only in explicit local demo mode.
export function demoRoutes(app: FastifyInstance, connection: Database) {
  async function deliver(sourceId: string, raw: string) {
    const [source] = await connection.db
      .select()
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1);
    if (!source) throw new RequestError(404, "Source not found");
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Local API is not listening");
    const response = await send(`http://127.0.0.1:${address.port}`, source.secret, raw, source.id);
    if (response.status !== 202) throw new RequestError(502, "Local signed delivery failed");
    return Receipt.assert(await response.json());
  }
  app.post("/api/demo/fixtures", { bodyLimit: 512 }, async (request, reply) => {
    requireOrigin(request);
    const session = await requireOperator(connection, request);
    const input = FixtureInput(request.body);
    if (input instanceof type.errors) throw new RequestError(400, "Invalid demo scenario");
    const payload = fixture();
    if (input.scenario !== "success")
      await connection.db
        .insert(syntheticFaults)
        .values({ sourceId: session.sourceId, refundId: payload.refundId, kind: input.scenario });
    const receipt = await deliver(session.sourceId, JSON.stringify(payload));
    reply.code(202);
    return { receipt };
  });
  app.post<{ Params: { id: string } }>(
    "/api/demo/events/:id/redeliver",
    { bodyLimit: 512 },
    async (request, reply) => {
      requireOrigin(request);
      const session = await requireOperator(connection, request);
      if (!Empty.allows(request.body ?? {}))
        throw new RequestError(400, "This action takes no payload");
      const event = await eventForOperator(connection, session.sourceId, request.params.id);
      const receipt = await deliver(session.sourceId, event.raw);
      reply.code(202);
      return { receipt };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/demo/events/:id/repair",
    { bodyLimit: 512 },
    async (request) => {
      requireOrigin(request);
      const session = await requireOperator(connection, request);
      if (!Empty.allows(request.body ?? {}))
        throw new RequestError(400, "This action takes no payload");
      const event = await eventForOperator(connection, session.sourceId, request.params.id);
      await connection.db
        .delete(syntheticFaults)
        .where(
          and(
            eq(syntheticFaults.sourceId, session.sourceId),
            eq(syntheticFaults.refundId, event.payload.refundId),
          ),
        );
      return { repaired: true, refundId: event.payload.refundId };
    },
  );
}
