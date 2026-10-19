import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { claim, withOwnedClaim } from "../src/claims.js";
import type { Configuration } from "../src/config.js";
import { database } from "../src/database.js";
import { attempts, inbox, sources } from "../src/schema.js";
import { fixture, send } from "../src/sender.js";

export async function verifyClaims(base: string, config: Configuration) {
  const connection = database(config);
  try {
    for (let index = 0; index < 2; index++)
      assert.equal((await send(base, config.sourceSecret, JSON.stringify(fixture()))).status, 202);
    await connection.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(inbox)
        .where(eq(inbox.state, "received"))
        .orderBy(asc(inbox.acceptedAt), asc(inbox.id))
        .limit(1)
        .for("update");
      assert.ok(locked);
      const other = await claim(connection, "worker-b", 60000);
      assert.ok(other);
      assert.notEqual(other.event.id, locked.id, "Another worker must skip the locked row");
      assert.equal(
        (
          await withOwnedClaim(connection, other, async () => ({
            state: "dead_lettered",
            reason: "synthetic_claim_test",
          }))
        ).state,
        "dead_lettered",
      );
    });
    const original = await claim(connection, "worker-a", 60000);
    assert.ok(original);
    await assert.rejects(
      withOwnedClaim(connection, original, async (tx) => {
        await tx
          .insert(sources)
          .values({ id: "rollback_probe", secret: "synthetic-rollback-probe-secret" });
        throw new Error("Injected transaction failure");
      }),
      /Injected transaction failure/,
    );
    assert.equal(
      (await connection.db.select().from(sources).where(eq(sources.id, "rollback_probe"))).length,
      0,
    );
    const midflight = await withOwnedClaim(connection, original, async (tx) => {
      await tx
        .insert(sources)
        .values({ id: "fence_probe", secret: "synthetic-fencing-probe-secret" });
      await tx
        .update(inbox)
        .set({ leaseUntil: new Date(0) })
        .where(eq(inbox.id, original.event.id));
      return { state: "processed", reason: "should_rollback" };
    });
    assert.equal(midflight.state, "lost_lease");
    assert.equal(
      (await connection.db.select().from(sources).where(eq(sources.id, "fence_probe"))).length,
      0,
    );
    await connection.db
      .update(inbox)
      .set({ leaseUntil: new Date(0) })
      .where(eq(inbox.id, original.event.id));
    const reclaimed = await claim(connection, "worker-c", 60000);
    assert.ok(reclaimed);
    assert.equal(reclaimed.event.id, original.event.id);
    assert.equal(reclaimed.event.attemptNumber, original.event.attemptNumber + 1);
    assert.notEqual(reclaimed.attemptId, original.attemptId);
    let entered = false;
    assert.equal(
      (
        await withOwnedClaim(connection, original, async () => {
          entered = true;
          return { state: "processed", reason: "stale" };
        })
      ).state,
      "lost_lease",
    );
    assert.equal(entered, false);
    const history = await connection.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.inboxId, original.event.id), eq(attempts.id, original.attemptId)));
    assert.equal(history[0]?.outcome, "abandoned");
    await withOwnedClaim(connection, reclaimed, async () => ({
      state: "dead_lettered",
      reason: "synthetic_claim_test",
    }));
  } finally {
    await connection.client.end();
  }
}
