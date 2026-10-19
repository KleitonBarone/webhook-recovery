import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { claim } from "./claims.js";
import { configuration } from "./config.js";
import { database } from "./database.js";
import { diagnostic, observe } from "./observability.js";
import { processClaim } from "./processing.js";
import { workerPause } from "./worker-pause.js";

const config = configuration();
const pause = workerPause(config.demo);
const connection = database(config);
const workerId = `worker-${randomUUID()}`;
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => stop.abort());
}
try {
  await connection.client`select 1`;
  console.log(JSON.stringify({ event: "worker_ready", workerId, pid: process.pid }));
  while (!stop.signal.aborted) {
    try {
      const owned = await claim(connection, workerId, config.leaseMs, config.maxAttempts);
      if (owned) {
        const correlation = {
          workerId,
          inboxId: owned.event.id,
          eventId: owned.event.eventId,
          sourceId: owned.event.sourceId,
          attemptId: owned.attemptId,
          replayId: owned.event.currentReplayId,
          cycleNumber: owned.event.cycleNumber,
          cycleAttempt: owned.event.cycleAttempt,
        };
        observe("attempt_claimed", correlation);
        await pause("claimed", owned);
        const result = await processClaim(connection, owned, config, Math.random, () =>
          pause("before_commit", owned),
        );
        await pause("after_commit", owned);
        observe(result.state, correlation);
        console.log(
          JSON.stringify({
            event: "processing_finished",
            workerId,
            inboxId: owned.event.id,
            attemptId: owned.attemptId,
            ...result,
          }),
        );
      } else await setTimeout(100, undefined, { signal: stop.signal }).catch(() => {});
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "processing_transaction_failed",
          workerId,
          failure: diagnostic(error),
        }),
      );
      await setTimeout(250, undefined, { signal: stop.signal }).catch(() => {});
    }
  }
} finally {
  await connection.client.end();
}
