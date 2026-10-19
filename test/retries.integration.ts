import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { claim } from "../src/claims.js";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database } from "../src/database.js";
import { processClaim } from "../src/processing.js";
import { attempts, completions, inbox, syntheticFaults } from "../src/schema.js";
import { fixture, send } from "../src/sender.js";

export async function verifyRetries(base: string, config: Configuration) {
  const connection = database(config);
  const entry = async (id: string) =>
    (await connection.db.select().from(inbox).where(eq(inbox.id, id)))[0];
  const history = (id: string) =>
    connection.db.select().from(attempts).where(eq(attempts.inboxId, id)).orderBy(attempts.number);
  const advance = (id: string) =>
    connection.db
      .update(inbox)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(inbox.id, id));
  async function acceptFault(kind: "transient" | "permanent", failForAttempts = 1) {
    const payload = fixture();
    await connection.db
      .insert(syntheticFaults)
      .values({ sourceId: "demo", refundId: payload.refundId, kind, failForAttempts });
    const response = await send(base, config.sourceSecret, JSON.stringify(payload));
    assert.equal(response.status, 202);
    return Receipt.assert(await response.json());
  }
  async function take(id: string) {
    const owned = await claim(connection, "retry-verifier", 60000, config.maxAttempts);
    assert.ok(owned);
    assert.equal(owned.event.id, id);
    return owned;
  }
  try {
    const transient = await acceptFault("transient");
    const first = await take(transient.id);
    const scheduled = await processClaim(
      connection,
      first,
      { ...config, retryBaseMs: 60000 },
      () => 0.5,
    );
    assert.ok(scheduled.state === "retry_scheduled");
    assert.equal(
      (await entry(transient.id))?.nextAttemptAt?.getTime(),
      scheduled.nextAttemptAt.getTime(),
    );
    assert.equal(
      (await history(transient.id))[0]?.retryAt?.getTime(),
      scheduled.nextAttemptAt.getTime(),
    );
    assert.equal(await claim(connection, "too-early", 60000), null);
    // A fresh database connection observes the committed schedule, not process memory.
    const reopened = database(config);
    try {
      assert.equal(
        (await reopened.db.select().from(inbox).where(eq(inbox.id, transient.id)))[0]?.state,
        "retry_scheduled",
      );
    } finally {
      await reopened.client.end();
    }
    await advance(transient.id);
    assert.equal(
      (await processClaim(connection, await take(transient.id), config)).state,
      "processed",
    );
    assert.deepEqual(
      (await history(transient.id)).map((attempt) => attempt.outcome),
      ["retry_scheduled", "processed"],
    );

    const exhausted = await acceptFault("transient", 100);
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      const owned = await take(exhausted.id);
      assert.equal(owned.event.cycleAttempt, attempt);
      const outcome = await processClaim(connection, owned, config, () => 0.5);
      assert.equal(
        outcome.state,
        attempt === config.maxAttempts ? "dead_lettered" : "retry_scheduled",
      );
      if (outcome.state === "retry_scheduled") await advance(exhausted.id);
    }
    assert.equal((await entry(exhausted.id))?.reason, "retry_budget_exhausted");
    assert.equal((await entry(exhausted.id))?.nextAttemptAt, null);
    assert.equal((await history(exhausted.id)).at(-1)?.failureCode, "synthetic_unavailable");
    assert.equal(await claim(connection, "after-budget", 60000), null);

    const permanent = await acceptFault("permanent");
    assert.equal(
      (await processClaim(connection, await take(permanent.id), config)).state,
      "dead_lettered",
    );
    assert.equal((await history(permanent.id)).length, 1);

    const disabled = await acceptFault("permanent");
    const ignoredFault = await take(disabled.id);
    assert.equal(
      (await processClaim(connection, ignoredFault, { ...config, demo: false })).state,
      "processed",
    );
    assert.equal(
      (
        await connection.db
          .select()
          .from(completions)
          .where(and(eq(completions.sourceId, "demo"), eq(completions.inboxId, disabled.id)))
      ).length,
      1,
    );

    const crashed = await acceptFault("transient");
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      const owned = await take(crashed.id);
      assert.equal(owned.event.cycleAttempt, attempt);
      await connection.db
        .update(inbox)
        .set({ leaseUntil: new Date(0) })
        .where(eq(inbox.id, crashed.id));
    }
    assert.equal(await claim(connection, "exhausted-owner", 60000), null);
    assert.equal((await entry(crashed.id))?.state, "dead_lettered");
    assert.deepEqual(
      (await history(crashed.id)).map((attempt) => attempt.outcome),
      Array.from({ length: config.maxAttempts }, () => "abandoned"),
    );
  } finally {
    await connection.client.end();
  }
}
