import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database, otherSecret } from "../src/database.js";
import { inbox } from "../src/schema.js";
import { fixture, send } from "../src/sender.js";

export async function verifyIntake(
  base: string,
  config: Configuration,
  restart: () => Promise<void>,
) {
  const connection = database(config);
  try {
    const payload = fixture();
    const body = JSON.stringify(payload);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => send(base, config.sourceSecret, body)),
    );
    assert.ok(responses.every((response) => response.status === 202));
    const receipts = await Promise.all(
      responses.map(async (response) => Receipt.assert(await response.json())),
    );
    const [first] = receipts;
    assert.ok(first);
    for (const receipt of receipts) assert.deepEqual(receipt, first);
    assert.equal(
      (await connection.db.select().from(inbox).where(eq(inbox.eventId, payload.eventId))).length,
      1,
    );
    await restart();
    const retried = await send(base, config.sourceSecret, body);
    assert.equal(retried.status, 202);
    assert.deepEqual(Receipt.assert(await retried.json()), first);
    assert.equal(
      (await send(base, config.sourceSecret, JSON.stringify({ ...payload, version: 2 }))).status,
      409,
    );
    assert.equal((await send(base, config.sourceSecret, ` ${body}`)).status, 409);
    const racing = fixture();
    const conflicts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        send(base, config.sourceSecret, JSON.stringify({ ...racing, version: index + 1 })),
      ),
    );
    assert.equal(conflicts.filter((response) => response.status === 202).length, 1);
    assert.equal(conflicts.filter((response) => response.status === 409).length, 9);
    assert.equal(
      (await connection.db.select().from(inbox).where(eq(inbox.eventId, racing.eventId))).length,
      1,
    );
    const other = await send(base, otherSecret(config.sourceSecret), body, "other");
    assert.equal(other.status, 202);
    assert.notEqual(Receipt.assert(await other.json()).id, first.id);

    const count = (await connection.db.select().from(inbox)).length;
    assert.equal((await send(base, "wrong-source-secret", JSON.stringify(fixture()))).status, 401);
    assert.equal(
      (await send(base, config.sourceSecret, JSON.stringify(fixture()), "unknown")).status,
      401,
    );
    for (const skew of [-301, 301])
      assert.equal(
        (await send(base, config.sourceSecret, body, "demo", Math.floor(Date.now() / 1000) + skew))
          .status,
        401,
      );
    assert.equal((await send(base, config.sourceSecret, '{"broken":true}')).status, 400);
    assert.equal((await send(base, config.sourceSecret, " ".repeat(65537))).status, 413);
    const encoded = await fetch(`${base}/webhooks/demo`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
    });
    assert.equal(encoded.status, 415);
    assert.equal((await connection.db.select().from(inbox)).length, count);

    // Force a real PostgreSQL insertion failure in this disposable database.
    await connection.client`alter table inbox add constraint test_failure check (payload->>'refundId' <> 'db_failure')`;
    try {
      const failed = await send(
        base,
        config.sourceSecret,
        JSON.stringify({ ...fixture(), eventId: randomUUID(), refundId: "db_failure" }),
      );
      assert.equal(failed.status, 500);
      assert.equal((await connection.db.select().from(inbox)).length, count);
    } finally {
      await connection.client`alter table inbox drop constraint test_failure`;
    }
    return {
      first,
      otherId: Receipt.assert(
        await (await send(base, otherSecret(config.sourceSecret), body, "other")).json(),
      ).id,
    };
  } finally {
    await connection.client.end();
  }
}
