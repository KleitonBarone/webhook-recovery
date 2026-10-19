import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { decodeEvent, signature, verifySignature } from "../src/contract.js";

const secret = "synthetic-source-secret-for-test";
const timestamp = 1792414800;
const body = Buffer.from('{ "signed": true }');
test("HMAC covers timestamp and exact bytes with bounded timestamp tolerance", () => {
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
    .digest("hex");
  assert.equal(signature(body, secret, timestamp), `t=${timestamp},v1=${expected}`);
  const valid = signature(body, secret, timestamp);
  assert.ok(verifySignature(body, valid, secret, timestamp * 1000));
  assert.ok(!verifySignature(Buffer.from('{"signed":true}'), valid, secret, timestamp * 1000));
  assert.ok(!verifySignature(body, valid, "different-secret", timestamp * 1000));
  for (const seconds of [-301, 301])
    assert.ok(!verifySignature(body, valid, secret, (timestamp + seconds) * 1000));
  for (const invalid of [undefined, [], "t=abc,v1=00", `t=${timestamp},v1=00`])
    assert.ok(!verifySignature(body, invalid, secret, timestamp * 1000));
});
test("event validation rejects malformed UTF-8, unsupported contracts and versions", () => {
  const payload = {
    schemaVersion: 1,
    type: "refund.status_changed",
    eventId: randomUUID(),
    refundId: "refund_1",
    version: 1,
    status: "completed",
  };
  assert.equal(decodeEvent(Buffer.from(JSON.stringify(payload))).payload.refundId, "refund_1");
  for (const change of [
    { schemaVersion: 2 },
    { version: 0 },
    { version: 1.5 },
    { version: 2147483648 },
    { refundId: "../other" },
    { sourceId: "other" },
  ]) {
    assert.throws(() => decodeEvent(Buffer.from(JSON.stringify({ ...payload, ...change }))));
  }
  assert.throws(() => decodeEvent(Buffer.from([0xff])));
});
