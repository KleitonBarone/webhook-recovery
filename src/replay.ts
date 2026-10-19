import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import type { Database } from "./database.js";
import { RequestError } from "./errors.js";
import { inbox, replayRequests } from "./schema.js";

export const ReplayInput = type({
  idempotencyKey: "string.uuid",
  reason: "1 <= string <= 500",
  "+": "reject",
});
const UUID = type("string.uuid");

// The caller supplies source and operator identities from an authenticated session.
export async function replayEvent(
  connection: Database,
  scope: { sourceId: string; operatorId: string },
  id: string,
  input: typeof ReplayInput.infer,
) {
  if (!UUID.allows(id)) throw new RequestError(400, "Invalid event ID");
  const reason = input.reason.trim();
  if (!reason) throw new RequestError(400, "A replay reason is required");
  return connection.db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(inbox)
      .where(and(eq(inbox.id, id), eq(inbox.sourceId, scope.sourceId)))
      .for("update");
    if (!event) throw new RequestError(404, "Event not found");
    const key = and(
      eq(replayRequests.sourceId, scope.sourceId),
      eq(replayRequests.operatorId, scope.operatorId),
      eq(replayRequests.idempotencyKey, input.idempotencyKey),
    );
    function original(found: typeof replayRequests.$inferSelect) {
      if (found.inboxId !== id || found.reason !== reason)
        throw new RequestError(409, "Replay key already used with different content");
      return found;
    }
    const [existing] = await tx.select().from(replayRequests).where(key).limit(1);
    if (existing) return original(existing);
    if (event.state !== "dead_lettered")
      throw new RequestError(409, "Only terminal failures can be replayed");
    const [created] = await tx
      .insert(replayRequests)
      .values({
        ...scope,
        inboxId: id,
        idempotencyKey: input.idempotencyKey,
        reason,
        cycleNumber: event.cycleNumber + 1,
      })
      .onConflictDoNothing({
        target: [replayRequests.sourceId, replayRequests.operatorId, replayRequests.idempotencyKey],
      })
      .returning();
    // A competing request can reuse this key while locking a different inbox row.
    if (!created) {
      const [winner] = await tx.select().from(replayRequests).where(key).limit(1);
      if (!winner) throw new Error("Replay key winner disappeared");
      return original(winner);
    }
    await tx
      .update(inbox)
      .set({
        state: "received",
        reason: null,
        nextAttemptAt: null,
        cycleNumber: created.cycleNumber,
        cycleAttempt: 0,
        currentReplayId: created.id,
      })
      .where(eq(inbox.id, id));
    return created;
  });
}
