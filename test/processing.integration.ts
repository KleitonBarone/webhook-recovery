import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { until } from "../scripts/runtime.js";
import { claim } from "../src/claims.js";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database, otherSecret } from "../src/database.js";
import { processClaim } from "../src/processing.js";
import { attempts, completions, inbox, processingReceipts, refunds } from "../src/schema.js";
import { fixture, send } from "../src/sender.js";

export async function verifyProcessing(base: string, config: Configuration) {
  const connection = database(config);
  async function drain(workers = 1) {
    await Promise.all(
      Array.from({ length: workers }, async (_, index) => {
        for (let iteration = 0; iteration < 100; iteration++) {
          const owned = await claim(connection, `test-worker-${index}`, 60000);
          if (!owned) return;
          await processClaim(connection, owned);
        }
        throw new Error("Processing exceeded finite work budget");
      }),
    );
  }
  const accepted = async (payload: ReturnType<typeof fixture>, source = "demo") => {
    const response = await send(
      base,
      source === "demo" ? config.sourceSecret : otherSecret(config.sourceSecret),
      JSON.stringify(payload),
      source,
    );
    assert.equal(response.status, 202);
    return Receipt.assert(await response.json());
  };
  const entry = async (id: string) =>
    (await connection.db.select().from(inbox).where(eq(inbox.id, id)))[0];
  const ledger = (refundId: string, source = "demo") =>
    connection.db
      .select()
      .from(completions)
      .where(and(eq(completions.sourceId, source), eq(completions.refundId, refundId)));
  try {
    await drain();
    const newer = { ...fixture(), version: 2 };
    const receipt = await accepted(newer);
    await drain();
    const old = await accepted({ ...newer, eventId: randomUUID(), version: 1, status: "pending" });
    await drain();
    assert.equal((await entry(old.id))?.state, "ignored_stale");
    const same = await accepted({ ...newer, eventId: randomUUID() });
    await drain();
    assert.equal((await entry(same.id))?.reason, "same_version_noop");
    const conflict = await accepted({ ...newer, eventId: randomUUID(), status: "failed" });
    await drain();
    assert.equal((await entry(conflict.id))?.state, "dead_lettered");
    assert.equal((await entry(conflict.id))?.reason, "equal_version_conflict");
    assert.equal(
      (
        await connection.db
          .select()
          .from(processingReceipts)
          .where(eq(processingReceipts.inboxId, conflict.id))
      ).length,
      0,
    );
    await accepted({ ...newer, eventId: randomUUID(), version: 3, status: "pending" });
    await drain();
    await accepted({ ...newer, eventId: randomUUID(), version: 4 });
    await drain();
    assert.equal((await ledger(newer.refundId)).length, 1);
    assert.deepEqual(
      Receipt.assert(await (await send(base, config.sourceSecret, JSON.stringify(newer))).json()),
      receipt,
    );

    const racing = fixture();
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        accepted({ ...racing, eventId: randomUUID(), version: index + 1 }),
      ),
    );
    await drain(4);
    const [highest] = await connection.db
      .select()
      .from(refunds)
      .where(and(eq(refunds.sourceId, "demo"), eq(refunds.refundId, racing.refundId)));
    assert.equal(highest?.version, 10);
    assert.equal((await ledger(racing.refundId)).length, 1);
    await accepted({ ...racing, eventId: randomUUID(), version: 11 }, "other");
    await drain(2);
    assert.equal((await ledger(racing.refundId, "other")).length, 1);
    assert.equal(
      (
        await connection.db
          .select()
          .from(refunds)
          .where(and(eq(refunds.sourceId, "demo"), eq(refunds.refundId, racing.refundId)))
      )[0]?.version,
      10,
    );

    const broken = fixture();
    const failedReceipt = await accepted(broken);
    const owned = await claim(connection, "rollback-worker", 60000);
    assert.ok(owned);
    assert.equal(owned.event.id, failedReceipt.id);
    await connection.client`alter table processing_receipts add constraint test_receipt_failure check (false) not valid`;
    try {
      await assert.rejects(processClaim(connection, owned));
      assert.equal((await entry(failedReceipt.id))?.state, "processing");
      assert.equal((await ledger(broken.refundId)).length, 0);
      assert.equal(
        (
          await connection.db
            .select()
            .from(refunds)
            .where(and(eq(refunds.sourceId, "demo"), eq(refunds.refundId, broken.refundId)))
        ).length,
        0,
      );
      assert.equal(
        (
          await connection.db
            .select()
            .from(processingReceipts)
            .where(eq(processingReceipts.inboxId, failedReceipt.id))
        ).length,
        0,
      );
      assert.equal(
        (await connection.db.select().from(attempts).where(eq(attempts.id, owned.attemptId)))[0]
          ?.outcome,
        "running",
      );
    } finally {
      await connection.client`alter table processing_receipts drop constraint test_receipt_failure`;
    }
    assert.equal((await processClaim(connection, owned)).state, "processed");
    assert.equal((await ledger(broken.refundId)).length, 1);
    const detail = await fetch(`${base}/api/events/${failedReceipt.id}`, {
      headers: { authorization: `Bearer ${config.operatorToken}` },
    });
    const inspected = type({
      attempts: type({ outcome: "string" }).array(),
      receipt: { decision: "string" },
      completions: "unknown[]",
    }).assert(await detail.json());
    assert.equal(inspected.attempts[0]?.outcome, "processed");
    assert.equal(inspected.receipt.decision, "applied");
    assert.equal(inspected.completions.length, 1);
  } finally {
    await connection.client.end();
  }
}

export async function verifyWorkerProcess(base: string, config: Configuration) {
  const payload = fixture();
  // A second job proves the daemon continues claiming and shares the business fence.
  for (const version of [1, 2]) {
    const response = await send(
      base,
      config.sourceSecret,
      JSON.stringify({ ...payload, eventId: randomUUID(), version }),
    );
    assert.equal(response.status, 202);
    const receipt = Receipt.assert(await response.json());
    let observed = "not_observed";
    await until(async () => {
      const detail = await fetch(`${base}/api/events/${receipt.id}`, {
        headers: { authorization: `Bearer ${config.operatorToken}` },
      });
      if (!detail.ok) throw new Error(`Inspection returned HTTP ${detail.status}`);
      const value = type({ event: { state: "string" }, completions: "unknown[]" }).assert(
        await detail.json(),
      );
      observed = `${value.event.state}, completion entries=${value.completions.length}`;
      return value.event.state === "processed" && value.completions.length === 1;
    }).catch((error: unknown) => {
      throw new Error(
        `Worker did not complete accepted event: ${observed}; ${error instanceof Error ? error.message : "unexpected response"}`,
      );
    });
  }
}
