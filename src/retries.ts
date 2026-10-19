import type { Outcome } from "./claims.js";
import type { Configuration } from "./config.js";

export type RetryPolicy = Pick<Configuration, "maxAttempts" | "retryBaseMs" | "demo">;
export const defaultRetryPolicy: RetryPolicy = { maxAttempts: 3, retryBaseMs: 1000, demo: false };

// Explicit clock and jitter inputs make policy checks independent of wall-clock waits.
export function failureOutcome(
  failure: { kind: "transient" | "permanent"; reason: string },
  cycleAttempt: number,
  policy: RetryPolicy,
  clock: { now: number; jitter: number },
): Outcome {
  if (failure.kind === "permanent")
    return { state: "dead_lettered", reason: failure.reason, failureCode: failure.reason };
  if (cycleAttempt >= policy.maxAttempts)
    return {
      state: "dead_lettered",
      reason: "retry_budget_exhausted",
      failureCode: failure.reason,
    };
  const exponential = Math.min(60000, policy.retryBaseMs * 2 ** (cycleAttempt - 1));
  const delay = Math.min(60000, Math.round(exponential * (0.8 + 0.4 * clock.jitter)));
  return {
    state: "retry_scheduled",
    reason: failure.reason,
    nextAttemptAt: new Date(clock.now + delay),
    failureCode: failure.reason,
  };
}
