import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import { claim } from "../src/claims.js";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database } from "../src/database.js";
import { processClaim } from "../src/processing.js";
import { attempts, completions, inbox, replayRequests, syntheticFaults } from "../src/schema.js";
import { fixture, send } from "../src/sender.js";

export async function verifyReplay(base: string, config: Configuration) {
  const connection = database(config);
  const input = { idempotencyKey: randomUUID(), reason: "Synthetic cause repaired" };
  const payload = fixture();
  const ReplayResponse = type({
    replay: {
      id: "string.uuid",
      inboxId: "string.uuid",
      cycleNumber: "number",
      reason: "string",
      requestedAt: "string",
    },
  });
  try {
    await connection.db
      .insert(syntheticFaults)
      .values({ sourceId: "demo", refundId: payload.refundId, kind: "permanent" });
    const accepted = Receipt.assert(
      await (await send(base, config.sourceSecret, JSON.stringify(payload))).json(),
    );
    const owned = await claim(connection, "replay-setup", 60000);
    assert.ok(owned);
    assert.equal(owned.event.id, accepted.id);
    assert.equal((await processClaim(connection, owned, config)).state, "dead_lettered");
    async function replay(
      body = input,
      token: string | null = config.operatorToken,
      id = accepted.id,
    ) {
      return fetch(`${base}/api/events/${id}/replay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: base,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    }
    assert.equal((await replay(input, null)).status, 401);
    assert.equal((await replay(input, config.viewerToken)).status, 403);
    assert.equal((await connection.db.select().from(replayRequests)).length, 0);
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        replay(input, config.operatorToken, index % 2 ? accepted.id.toUpperCase() : accepted.id),
      ),
    );
    const receipts = await Promise.all(
      responses.map(async (response) => {
        assert.equal(response.status, 202);
        return ReplayResponse.assert(await response.json());
      }),
    );
    const first = receipts[0];
    assert.ok(first);
    for (const receipt of receipts) assert.deepEqual(receipt, first);
    assert.equal(first.replay.cycleNumber, 2);
    const [queued] = await connection.db.select().from(inbox).where(eq(inbox.id, accepted.id));
    assert.ok(queued);
    assert.equal(queued.state, "received");
    assert.equal(queued.cycleAttempt, 0);
    assert.equal(queued.currentReplayId, first.replay.id);
    assert.equal(queued.raw, owned.event.raw);
    assert.equal(queued.bodyHash, owned.event.bodyHash);
    assert.equal(queued.acceptedAt.getTime(), owned.event.acceptedAt.getTime());
    assert.equal((await connection.db.select().from(replayRequests)).length, 1);
    assert.equal((await replay({ ...input, reason: "Changed content" })).status, 409);
    assert.equal((await replay({ ...input, idempotencyKey: randomUUID() })).status, 409);
    await connection.db
      .delete(syntheticFaults)
      .where(eq(syntheticFaults.refundId, payload.refundId));
    const recovered = await claim(connection, "replay-worker", 60000);
    assert.ok(recovered);
    assert.equal(recovered.event.id, accepted.id);
    assert.equal(recovered.event.cycleAttempt, 1);
    assert.equal((await processClaim(connection, recovered, config)).state, "processed");
    const history = await connection.db
      .select()
      .from(attempts)
      .where(eq(attempts.inboxId, accepted.id))
      .orderBy(attempts.number);
    assert.deepEqual(
      history.map((attempt) => attempt.outcome),
      ["dead_lettered", "processed"],
    );
    assert.equal(history[0]?.replayId, null);
    assert.equal(history[1]?.replayId, first.replay.id);
    assert.equal(history[1]?.cycleNumber, 2);
    assert.equal(
      (await connection.db.select().from(completions).where(eq(completions.inboxId, accepted.id)))
        .length,
      1,
    );
    assert.deepEqual(ReplayResponse.assert(await (await replay()).json()), first);
    const uppercaseRetry = await replay(input, config.operatorToken, accepted.id.toUpperCase());
    assert.equal(uppercaseRetry.status, 202);
    assert.deepEqual(ReplayResponse.assert(await uppercaseRetry.json()), first);
    assert.equal((await replay({ ...input, idempotencyKey: randomUUID() })).status, 409);
    assert.deepEqual(
      Receipt.assert(await (await send(base, config.sourceSecret, JSON.stringify(payload))).json()),
      accepted,
    );
    assert.equal(
      (await connection.db.select().from(attempts).where(eq(attempts.inboxId, accepted.id))).length,
      2,
    );
    const detail = await fetch(`${base}/api/events/${accepted.id}`, {
      headers: { authorization: `Bearer ${config.viewerToken}` },
    });
    const inspected = type({ replays: "unknown[]", attempts: "unknown[]" }).assert(
      await detail.json(),
    );
    assert.equal(inspected.replays.length, 1);
    assert.equal(inspected.attempts.length, 2);
  } finally {
    await connection.client.end();
  }
}
