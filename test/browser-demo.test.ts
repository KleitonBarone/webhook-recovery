import assert from "node:assert/strict";
import test from "node:test";
import { Detail, InboxPage } from "../src/messages.js";
import { createDemoStore } from "../web/src/demo/store.js";

const start = Date.parse("2026-10-26T12:00:00Z");

test("browser demo seeds schema-valid examples of success, failure, and stale processing", async () => {
  const store = await createDemoStore(() => start);
  const page = InboxPage.assert(store.list());
  assert.equal(page.items.length, 4);
  assert.deepEqual(
    page.items.map((event) => event.state),
    ["dead_lettered", "dead_lettered", "ignored_stale", "processed"],
  );
  for (const event of page.items) Detail.assert(store.detail(event.id));
  assert.equal(store.list("dead_lettered").items.length, 2);
  assert.equal(store.list(undefined, 2).nextOffset, 2);
  assert.equal(store.list(undefined, 2, 2).nextOffset, null);
});

test("browser recovery retains acceptance and failures while deduplicating replay and redelivery", async () => {
  let time = start;
  const store = await createDemoStore(() => time);
  const { receipt } = await store.sample("exhausted");
  assert.equal(store.detail(receipt.id).event.state, "received");
  time += 300;
  assert.equal(store.detail(receipt.id).event.state, "processing");
  time += 10000;
  const failed = store.detail(receipt.id);
  assert.equal(failed.event.state, "dead_lettered");
  assert.deepEqual(
    failed.attempts.map((attempt) => attempt.outcome),
    ["retry_scheduled", "retry_scheduled", "dead_lettered"],
  );
  assert.deepEqual(store.redeliver(receipt.id).receipt, receipt);
  assert.equal(store.detail(receipt.id).attempts.length, 3);
  assert.equal(store.repair(receipt.id).repaired, true);
  assert.equal(store.repair(receipt.id).repaired, false);
  const input = { idempotencyKey: crypto.randomUUID(), reason: "Repaired the simulated handler" };
  const replay = store.replay(receipt.id, input);
  assert.deepEqual(store.replay(receipt.id.toUpperCase(), input), replay);
  time += 1000;
  const recovered = Detail.assert(store.detail(receipt.id));
  assert.equal(recovered.event.state, "processed");
  assert.equal(recovered.event.raw, failed.event.raw);
  assert.equal(recovered.event.bodyHash, failed.event.bodyHash);
  assert.deepEqual(store.receipt(receipt.id), receipt);
  assert.deepEqual(recovered.attempts.slice(0, 3), failed.attempts);
  assert.equal(recovered.attempts.length, 4);
  assert.equal(recovered.attempts[3]?.replayId, replay.replay.id);
  assert.equal(recovered.completions.length, 1);
  assert.equal(recovered.replays.length, 1);
  assert.deepEqual(store.replay(receipt.id, input), replay);
  assert.throws(
    () => store.replay(receipt.id, { ...input, reason: "Different request" }),
    /different content/,
  );
  assert.throws(
    () => store.replay(receipt.id, { ...input, idempotencyKey: crypto.randomUUID() }),
    /terminal/,
  );
});

test("temporary browser-demo failures recover automatically while permanent failures require repair", async () => {
  let time = start;
  const store = await createDemoStore(() => time);
  const temporary = await store.sample("transient");
  const permanent = await store.sample("permanent");
  time += 1000;
  assert.equal(store.detail(temporary.receipt.id).event.state, "retry_scheduled");
  assert.equal(store.detail(permanent.receipt.id).event.state, "dead_lettered");
  time += 10000;
  assert.equal(store.detail(temporary.receipt.id).event.state, "processed");
  assert.equal(store.detail(temporary.receipt.id).attempts.length, 2);
  assert.equal(store.detail(permanent.receipt.id).attempts.length, 1);
});

test("new browser sessions reset mutations and returned data cannot mutate the store", async () => {
  const first = await createDemoStore(() => start);
  const second = await createDemoStore(() => start);
  const sample = await first.sample("success");
  assert.equal(first.list().items.length, 5);
  assert.equal(second.list().items.length, 4);
  assert.throws(() => second.detail(sample.receipt.id), /not in this demo session/);
  const detail = first.detail(sample.receipt.id);
  detail.event.raw = "Changed by a caller";
  assert.notEqual(first.detail(sample.receipt.id).event.raw, detail.event.raw);
  assert.equal((await createDemoStore(() => start)).list().items.length, 4);
});
