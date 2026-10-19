import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { until } from "../scripts/runtime.js";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database, otherSecret } from "../src/database.js";
import { createServer } from "../src/server.js";

const Detail = type({
  event: { state: "string" },
  attempts: type({ outcome: "string" }).array(),
  completions: "unknown[]",
  replays: "unknown[]",
});
export async function verifyDemo(base: string, config: Configuration) {
  const post = (
    path: string,
    body: unknown = {},
    token = config.operatorToken,
    origin: string | null = base,
  ) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  async function detail(id: string) {
    const response = await fetch(`${base}/api/events/${id}`, {
      headers: { authorization: `Bearer ${config.operatorToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    return Detail.assert(await response.json());
  }
  async function finished(id: string, state: string) {
    await until(async () => (await detail(id)).event.state === state);
    return detail(id);
  }
  async function sample(scenario: "success" | "transient" | "permanent") {
    const response = await post("/api/demo/fixtures", { scenario });
    assert.equal(response.status, 202);
    const value = type({ receipt: Receipt }).assert(await response.json());
    for (const secret of [config.sourceSecret, config.operatorToken, config.viewerToken])
      assert.equal(JSON.stringify(value).includes(secret), false);
    return value.receipt;
  }
  const connection = database(config);
  try {
    const disabled = createServer(connection, { demo: false });
    try {
      for (const url of [
        "/api/demo/fixtures",
        `/api/demo/events/${randomUUID()}/repair`,
        `/api/demo/events/${randomUUID()}/redeliver`,
      ]) {
        const response = await disabled.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${config.operatorToken}`, origin: base },
          payload: {},
        });
        assert.equal(response.statusCode, 404);
      }
    } finally {
      await disabled.close();
    }
    assert.equal(
      (await post("/api/demo/fixtures", { scenario: "permanent" }, config.viewerToken)).status,
      403,
    );
    assert.equal(
      (await post("/api/demo/fixtures", { scenario: "permanent" }, config.sourceSecret)).status,
      401,
    );
    assert.equal(
      (await post("/api/demo/fixtures", { scenario: "success" }, config.operatorToken, null))
        .status,
      403,
    );
    assert.equal((await post("/api/demo/fixtures", { scenario: "arbitrary" })).status, 400);
    assert.equal(
      (await post("/api/demo/fixtures", { scenario: "success", sourceId: "other" })).status,
      400,
    );
    const success = await sample("success");
    const succeeded = await finished(success.id, "processed");
    assert.equal(succeeded.completions.length, 1);
    const transient = await sample("transient");
    const retried = await finished(transient.id, "processed");
    assert.deepEqual(
      retried.attempts.map((attempt) => attempt.outcome),
      ["retry_scheduled", "processed"],
    );
    const permanent = await sample("permanent");
    const failed = await finished(permanent.id, "dead_lettered");
    assert.equal(failed.completions.length, 0);
    for (const action of ["repair", "redeliver"]) {
      assert.equal(
        (await post(`/api/demo/events/${permanent.id}/${action}`, {}, config.viewerToken)).status,
        403,
      );
      assert.equal(
        (
          await post(
            `/api/demo/events/${permanent.id}/${action}`,
            {},
            otherSecret(config.operatorToken),
          )
        ).status,
        404,
      );
    }
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () => post(`/api/demo/events/${permanent.id}/redeliver`)),
    );
    for (const duplicate of duplicates) {
      assert.equal(duplicate.status, 202);
      assert.deepEqual(
        type({ receipt: Receipt }).assert(await duplicate.json()).receipt,
        permanent,
      );
    }
    assert.equal((await detail(permanent.id)).attempts.length, 1);
    assert.equal((await post(`/api/demo/events/${permanent.id}/repair`)).status, 200);
    assert.equal((await detail(permanent.id)).event.state, "dead_lettered");
    const replay = await post(`/api/events/${permanent.id}/replay`, {
      idempotencyKey: randomUUID(),
      reason: "Repaired the demo cause",
    });
    assert.equal(replay.status, 202);
    const recovered = await finished(permanent.id, "processed");
    assert.deepEqual(
      recovered.attempts.map((attempt) => attempt.outcome),
      ["dead_lettered", "processed"],
    );
    assert.equal(recovered.completions.length, 1);
    assert.equal(recovered.replays.length, 1);
    return [
      {
        scenario: "demo_success",
        receipt: success,
        outcomes: succeeded.attempts.map((attempt) => attempt.outcome),
        completions: succeeded.completions.length,
      },
      {
        scenario: "demo_transient_recovery",
        receipt: transient,
        outcomes: retried.attempts.map((attempt) => attempt.outcome),
        completions: retried.completions.length,
      },
      {
        scenario: "demo_repair_and_replay",
        receipt: permanent,
        outcomes: recovered.attempts.map((attempt) => attempt.outcome),
        completions: recovered.completions.length,
        replays: recovered.replays.length,
      },
    ];
  } finally {
    await connection.client.end();
  }
}
