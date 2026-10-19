import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { until } from "../scripts/runtime.js";
import { claim } from "../src/claims.js";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database, hash, otherSecret, seedDatabase } from "../src/database.js";
import { processClaim } from "../src/processing.js";
import {
  attempts,
  completions,
  inbox,
  processingReceipts,
  replayRequests,
  sessions,
  syntheticFaults,
} from "../src/schema.js";
import { fixture, send } from "../src/sender.js";

export async function verifyRecovery(
  base: string,
  config: Configuration,
  restart: (withWorker: boolean) => Promise<void>,
) {
  const connection = database(config);
  const input = () => ({ idempotencyKey: randomUUID(), reason: "Verified synthetic repair" });
  const entry = async (id: string) =>
    (await connection.db.select().from(inbox).where(eq(inbox.id, id)))[0];
  const history = (id: string) =>
    connection.db.select().from(attempts).where(eq(attempts.inboxId, id)).orderBy(attempts.number);
  const audits = (id: string) =>
    connection.db.select().from(replayRequests).where(eq(replayRequests.inboxId, id));
  const post = (
    id: string,
    body: unknown,
    token = config.operatorToken,
    origin: string | null = base,
  ) =>
    fetch(`${base}/api/events/${id}/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  async function accept(payload: ReturnType<typeof fixture>) {
    const response = await send(base, config.sourceSecret, JSON.stringify(payload));
    assert.equal(response.status, 202);
    return Receipt.assert(await response.json());
  }
  async function finish(id: string) {
    const owned = await claim(connection, "recovery-verifier", 60000, config.maxAttempts);
    assert.ok(owned);
    assert.equal(owned.event.id, id);
    return processClaim(connection, owned, config, () => 0.5);
  }
  async function dead() {
    const payload = fixture();
    await connection.db
      .insert(syntheticFaults)
      .values({ sourceId: "demo", refundId: payload.refundId, kind: "permanent" });
    const receipt = await accept(payload);
    assert.equal((await finish(receipt.id)).state, "dead_lettered");
    return receipt;
  }
  try {
    const left = await dead();
    const right = await dead();
    const shared = input();
    const targets = Array.from({ length: 8 }, (_, i) => (i % 2 ? left.id : right.id));
    const responses = await Promise.all(targets.map((id) => post(id, shared)));
    const winners = await connection.db
      .select()
      .from(replayRequests)
      .where(eq(replayRequests.idempotencyKey, shared.idempotencyKey));
    assert.equal(winners.length, 1);
    const winner = winners[0];
    assert.ok(winner);
    for (const [index, response] of responses.entries())
      assert.equal(response.status, targets[index] === winner.inboxId ? 202 : 409);
    const loser = winner.inboxId === left.id ? right.id : left.id;
    assert.equal((await entry(loser))?.state, "dead_lettered");
    assert.equal((await entry(loser))?.cycleNumber, 1);
    assert.equal((await finish(winner.inboxId)).state, "dead_lettered");

    const competing = await Promise.all(
      Array.from({ length: 8 }, () => post(winner.inboxId, input())),
    );
    assert.equal(competing.filter((response) => response.status === 202).length, 1);
    assert.equal(competing.filter((response) => response.status === 409).length, 7);
    const active = await claim(connection, "active-replay-fence", 60000);
    assert.ok(active);
    assert.equal(active.event.id, winner.inboxId);
    assert.equal((await post(winner.inboxId, input())).status, 409);
    assert.equal((await processClaim(connection, active, config)).state, "dead_lettered");

    const secondToken = randomBytes(24).toString("hex");
    await connection.db.insert(sessions).values({
      tokenHash: hash(secondToken),
      sourceId: "demo",
      role: "operator",
      expiresAt: new Date(Date.now() + 60000),
    });
    assert.equal((await post(winner.inboxId, shared, secondToken)).status, 202);
    assert.equal((await finish(winner.inboxId)).state, "dead_lettered");
    const scoped = await audits(winner.inboxId);
    assert.equal(scoped.length, 3);
    assert.equal(new Set(scoped.map((audit) => audit.operatorId)).size, 2);
    assert.equal((await post(winner.inboxId, shared)).status, 202);

    const beforeDenied = (await audits(winner.inboxId)).length;
    assert.equal((await post(winner.inboxId, input(), config.operatorToken, null)).status, 403);
    assert.equal(
      (await post(winner.inboxId, input(), config.operatorToken, "http://127.0.0.1:1")).status,
      403,
    );
    assert.equal((await post(winner.inboxId, input(), config.sourceSecret)).status, 401);
    assert.equal(
      (await post(winner.inboxId, input(), otherSecret(config.operatorToken))).status,
      404,
    );
    assert.equal((await post(winner.inboxId, { ...input(), reason: "  " })).status, 400);
    assert.equal(
      (await post(winner.inboxId, { ...input(), operatorId: "caller-selected" })).status,
      400,
    );
    await connection.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.tokenHash, hash(config.operatorToken)));
    assert.equal((await post(winner.inboxId, input())).status, 401);
    await seedDatabase(connection, config);
    assert.equal(
      (
        await fetch(`${base}/api/session`, {
          headers: { authorization: `Bearer ${config.operatorToken}` },
        })
      ).status,
      200,
    );
    assert.equal((await audits(winner.inboxId)).length, beforeDenied);

    // Force the intent update to fail after its audit insertion; both must roll back.
    const beforeAtomic = await entry(winner.inboxId);
    await connection.client`alter table inbox add constraint test_replay_intent_failure check (state <> 'received') not valid`;
    try {
      assert.equal((await post(winner.inboxId, input())).status, 500);
      assert.equal((await audits(winner.inboxId)).length, beforeDenied);
      assert.equal((await entry(winner.inboxId))?.cycleNumber, beforeAtomic?.cycleNumber);
      assert.equal((await entry(winner.inboxId))?.state, "dead_lettered");
    } finally {
      await connection.client`alter table inbox drop constraint test_replay_intent_failure`;
    }
    const restartReplay = input();
    const replayBeforeRestart = await post(winner.inboxId, restartReplay);
    assert.equal(replayBeforeRestart.status, 202);
    const committedReplay = await replayBeforeRestart.json();
    await restart(false);
    assert.equal((await entry(winner.inboxId))?.state, "received");
    const replayAfterRestart = await post(winner.inboxId, restartReplay);
    assert.equal(replayAfterRestart.status, 202);
    assert.deepEqual(await replayAfterRestart.json(), committedReplay);
    assert.equal((await finish(winner.inboxId)).state, "dead_lettered");
    const headers = { authorization: `Bearer ${config.viewerToken}` };
    const page = type({ items: "unknown[]", nextOffset: "number" }).assert(
      await (
        await fetch(`${base}/api/events/${winner.inboxId}/replays?limit=1`, { headers })
      ).json(),
    );
    assert.equal(page.items.length, 1);
    assert.equal(page.nextOffset, 1);
    assert.equal(
      (await fetch(`${base}/api/events/${winner.inboxId}/replays?limit=101`, { headers })).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/api/events/${winner.inboxId}/replays`, {
          headers: { authorization: `Bearer ${otherSecret(config.operatorToken)}` },
        })
      ).status,
      404,
    );

    const failing = fixture();
    await connection.db.insert(syntheticFaults).values({
      sourceId: "demo",
      refundId: failing.refundId,
      kind: "transient",
      failForAttempts: 100,
    });
    const exhausted = await accept(failing);
    for (const cycle of [1, 2]) {
      if (cycle === 2) assert.equal((await post(exhausted.id, input())).status, 202);
      for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        const result = await finish(exhausted.id);
        if (attempt < config.maxAttempts) {
          assert.equal(result.state, "retry_scheduled");
          await connection.db
            .update(inbox)
            .set({ nextAttemptAt: new Date(0) })
            .where(eq(inbox.id, exhausted.id));
        } else assert.equal(result.state, "dead_lettered");
      }
    }
    const failedHistory = await history(exhausted.id);
    assert.deepEqual(
      failedHistory.map((attempt) => attempt.cycleAttempt),
      [1, 2, 3, 1, 2, 3],
    );
    assert.equal(failedHistory.filter((attempt) => attempt.replayId !== null).length, 3);
    await connection.db
      .delete(syntheticFaults)
      .where(
        and(eq(syntheticFaults.sourceId, "demo"), eq(syntheticFaults.refundId, failing.refundId)),
      );
    const duplicateCompletion = await accept({ ...failing, eventId: randomUUID() });
    assert.equal((await finish(duplicateCompletion.id)).state, "processed");
    assert.equal((await post(exhausted.id, input())).status, 202);
    assert.equal((await finish(exhausted.id)).state, "processed");
    assert.equal(
      (
        await connection.db
          .select()
          .from(completions)
          .where(and(eq(completions.sourceId, "demo"), eq(completions.refundId, failing.refundId)))
      ).length,
      1,
    );
    assert.equal(
      (
        await connection.db
          .select()
          .from(processingReceipts)
          .where(eq(processingReceipts.inboxId, exhausted.id))
      )[0]?.decision,
      "same_version",
    );

    const restartPayload = fixture();
    await connection.db
      .insert(syntheticFaults)
      .values({ sourceId: "demo", refundId: restartPayload.refundId, kind: "transient" });
    const restarting = await accept(restartPayload);
    await restart(true);
    await until(async () => (await entry(restarting.id))?.state === "retry_scheduled");
    const scheduled = await entry(restarting.id);
    assert.ok(scheduled?.nextAttemptAt);
    assert.equal((await post(restarting.id, input())).status, 409);
    await restart(true);
    assert.equal(
      (await entry(restarting.id))?.nextAttemptAt?.getTime(),
      scheduled.nextAttemptAt.getTime(),
    );
    assert.equal((await history(restarting.id)).length, 1);
    await connection.db
      .update(inbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(inbox.id, restarting.id));
    await until(async () => (await entry(restarting.id))?.state === "processed");
    const recoveredHistory = await history(restarting.id);
    assert.deepEqual(
      recoveredHistory.map((attempt) => attempt.outcome),
      ["retry_scheduled", "processed"],
    );
    assert.notEqual(recoveredHistory[0]?.workerId, recoveredHistory[1]?.workerId);
    for (const attempt of recoveredHistory) assert.match(attempt.workerId, /^worker-/);
    assert.equal(
      (await connection.db.select().from(completions).where(eq(completions.inboxId, restarting.id)))
        .length,
      1,
    );
    await restart(false);
  } finally {
    await connection.client.end();
  }
}
