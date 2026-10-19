import assert from "node:assert/strict";
import test from "node:test";
import { defaultRetryPolicy, failureOutcome } from "../src/retries.js";

test("retry policy bounds attempts, exponential delay, jitter, and terminal classification", () => {
  const transient = { kind: "transient", reason: "unavailable" } as const;
  for (const [attempt, jitter, delay] of [
    [1, 0, 800],
    [1, 1, 1200],
    [2, 0.5, 2000],
  ] as const) {
    const outcome = failureOutcome(transient, attempt, defaultRetryPolicy, { now: 10000, jitter });
    assert.equal(outcome.state, "retry_scheduled");
    assert.ok(outcome.state === "retry_scheduled");
    assert.equal(outcome.nextAttemptAt.getTime(), 10000 + delay);
  }
  assert.deepEqual(failureOutcome(transient, 3, defaultRetryPolicy, { now: 0, jitter: 0 }), {
    state: "dead_lettered",
    reason: "retry_budget_exhausted",
    failureCode: "unavailable",
  });
  assert.deepEqual(
    failureOutcome({ kind: "permanent", reason: "invalid_business_state" }, 1, defaultRetryPolicy, {
      now: 0,
      jitter: 0,
    }),
    {
      state: "dead_lettered",
      reason: "invalid_business_state",
      failureCode: "invalid_business_state",
    },
  );
  const capped = failureOutcome(
    transient,
    9,
    { ...defaultRetryPolicy, maxAttempts: 10, retryBaseMs: 60000 },
    { now: 0, jitter: 1 },
  );
  assert.ok(capped.state === "retry_scheduled");
  assert.equal(capped.nextAttemptAt.getTime(), 60000);
});
