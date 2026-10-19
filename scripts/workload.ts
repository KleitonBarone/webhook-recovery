import { createHash } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Configuration } from "../src/config.js";
import { Event, Receipt } from "../src/contract.js";
import { database, hash } from "../src/database.js";
import { diagnostic } from "../src/observability.js";
import { attempts, completions, inbox, processingReceipts, refunds } from "../src/schema.js";
import { send } from "../src/sender.js";
import { until } from "./runtime.js";

const uniqueEvents = 500;
const duplicateDeliveries = 100;
const concurrency = 8;
const warmupEvents = 10;
export function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}
function sample(run: string, index: number, warmup = false) {
  const digest = hash(`${run}:${warmup}:${index}`);
  return Event.assert({
    schemaVersion: 1,
    type: "refund.status_changed",
    eventId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    refundId: `${warmup ? "warm" : "load"}_${run}_${index}`,
    version: 1,
    status: "completed",
  });
}

// One finite workload uses the same owned stack as correctness verification.
export async function measureWorkload(
  base: string,
  config: Configuration,
  run: string,
  signal: AbortSignal,
) {
  const connection = database(config);
  const fixtures = Array.from({ length: uniqueEvents }, (_, index) => sample(run, index));
  const bodies = fixtures.map((event) => JSON.stringify(event));
  const ids = fixtures.map((event) => event.eventId);
  const refundIds = fixtures.map((event) => event.refundId);
  type Delivery = {
    index: number;
    fixture: number;
    duplicate: boolean;
    startMs: number;
    durationMs: number;
    status: number | null;
    receipt: typeof Receipt.infer | null;
    failure: string | null;
  };
  const deliveries: Delivery[] = [];
  try {
    const warm = Array.from({ length: warmupEvents }, (_, index) => sample(run, index, true));
    for (const event of warm) {
      signal.throwIfAborted();
      const response = await send(base, config.sourceSecret, JSON.stringify(event));
      if (response.status !== 202) throw new Error("Warm-up acceptance failed");
      Receipt.assert(await response.json());
    }
    await until(async () => {
      signal.throwIfAborted();
      const [value] = await connection.db
        .select({ value: count() })
        .from(inbox)
        .where(
          and(
            eq(inbox.sourceId, "demo"),
            inArray(
              inbox.eventId,
              warm.map((event) => event.eventId),
            ),
            eq(inbox.state, "processed"),
          ),
        );
      return value?.value === warmupEvents;
    }, 60000);
    const started = performance.now();
    let cursor = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        for (;;) {
          const index = cursor++;
          if (index >= uniqueEvents + duplicateDeliveries) return;
          const fixture = index % uniqueEvents;
          const body = bodies[fixture];
          if (!body) throw new Error("Missing workload fixture");
          signal.throwIfAborted();
          const begin = performance.now();
          const row: Delivery = {
            index,
            fixture,
            duplicate: index >= uniqueEvents,
            startMs: begin - started,
            durationMs: 0,
            status: null,
            receipt: null,
            failure: null,
          };
          try {
            const response = await send(base, config.sourceSecret, body);
            row.status = response.status;
            if (response.status === 202) row.receipt = Receipt.assert(await response.json());
            else row.failure = "http_status";
          } catch (error) {
            row.failure =
              error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
                ? "timeout"
                : diagnostic(error);
          }
          row.durationMs = performance.now() - begin;
          deliveries.push(row);
        }
      }),
    );
    const acceptanceWindowMs = performance.now() - started;
    let drainFailure: string | null = null;
    try {
      await until(async () => {
        signal.throwIfAborted();
        const [value] = await connection.db
          .select({ value: count() })
          .from(inbox)
          .where(
            and(
              eq(inbox.sourceId, "demo"),
              inArray(inbox.eventId, ids),
              eq(inbox.state, "processed"),
            ),
          );
        return value?.value === uniqueEvents;
      }, 60000);
    } catch (error) {
      drainFailure = diagnostic(error);
    }
    const processingObservedElapsedMs = performance.now() - started;
    const [events, history, receipts, projections, ledger] = await Promise.all([
      connection.db
        .select()
        .from(inbox)
        .where(and(eq(inbox.sourceId, "demo"), inArray(inbox.eventId, ids))),
      connection.db
        .select({ inboxId: attempts.inboxId, outcome: attempts.outcome })
        .from(attempts)
        .innerJoin(inbox, eq(attempts.inboxId, inbox.id))
        .where(and(eq(inbox.sourceId, "demo"), inArray(inbox.eventId, ids))),
      connection.db
        .select({ inboxId: processingReceipts.inboxId })
        .from(processingReceipts)
        .innerJoin(inbox, eq(processingReceipts.inboxId, inbox.id))
        .where(and(eq(inbox.sourceId, "demo"), inArray(inbox.eventId, ids))),
      connection.db
        .select()
        .from(refunds)
        .where(and(eq(refunds.sourceId, "demo"), inArray(refunds.refundId, refundIds))),
      connection.db
        .select()
        .from(completions)
        .where(and(eq(completions.sourceId, "demo"), inArray(completions.refundId, refundIds))),
    ]);
    const successful = deliveries.filter(
      (row) => row.status === 202 && row.receipt && !row.failure,
    );
    const stableReceipts = fixtures.every((event, index) => {
      const values = deliveries.filter((row) => row.fixture === index);
      const first = values[0]?.receipt;
      return (
        first &&
        first.eventId === event.eventId &&
        values.every(
          (row) => row.receipt?.id === first.id && row.receipt.acceptedAt === first.acceptedAt,
        )
      );
    });
    const invariants = {
      allDeliveriesAccepted: successful.length === uniqueEvents + duplicateDeliveries,
      stableReceipts: !!stableReceipts,
      immutableBytes:
        events.length === uniqueEvents &&
        events.every((event) => {
          const index = ids.indexOf(event.eventId);
          return event.raw === bodies[index] && event.bodyHash === hash(event.raw);
        }),
      allProcessed:
        events.length === uniqueEvents && events.every((event) => event.state === "processed"),
      oneAttemptPerEvent:
        history.length === uniqueEvents &&
        new Set(history.map((row) => row.inboxId)).size === uniqueEvents &&
        history.every((row) => row.outcome === "processed"),
      oneReceiptPerEvent:
        receipts.length === uniqueEvents &&
        new Set(receipts.map((row) => row.inboxId)).size === uniqueEvents,
      correctProjections:
        projections.length === uniqueEvents &&
        projections.every((row) => row.version === 1 && row.status === "completed"),
      oneCompletionPerRefund:
        ledger.length === uniqueEvents &&
        new Set(ledger.map((row) => row.refundId)).size === uniqueEvents,
    };
    const passed = !drainFailure && Object.values(invariants).every(Boolean);
    const latencies = successful.map((row) => row.durationMs);
    return {
      profile: "finite-local-acceptance-and-drain",
      passed,
      invariants,
      settings: {
        uniqueEvents,
        duplicateDeliveries,
        deliveries: uniqueEvents + duplicateDeliveries,
        concurrency,
        warmupEvents,
        warmupConcurrency: 1,
        warmupDrainedBeforeTiming: true,
        fixtureSeed: run,
        fixtureSha256: createHash("sha256").update(bodies.join("\n")).digest("hex"),
        requestTimeoutMs: 15000,
        drainTimeoutMs: 60000,
        drainPollMs: 100,
        postgresMemoryBytes: 512 * 1024 * 1024,
        postgresCpus: 1,
        workers: 1,
      },
      timings: {
        acceptanceWindowMs,
        processingObservedElapsedMs,
        drainAfterLastResponseMs: processingObservedElapsedMs - acceptanceWindowMs,
        validatedResponsesPerSecond: successful.length / (acceptanceWindowMs / 1000),
        uniqueEventsPerObservedSecond:
          events.filter((event) => event.state === "processed").length /
          (processingObservedElapsedMs / 1000),
        receiptLatencyMs: {
          min: latencies.length ? Math.min(...latencies) : null,
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
          p99: percentile(latencies, 0.99),
          max: latencies.length ? Math.max(...latencies) : null,
        },
      },
      accounting: {
        accepted: successful.length,
        failures: deliveries.length - successful.length,
        timeouts: deliveries.filter((row) => row.failure === "timeout").length,
        drainFailure,
        inbox: events.length,
        attempts: history.length,
        processingReceipts: receipts.length,
        projections: projections.length,
        completions: ledger.length,
      },
      deliveries: deliveries.sort((a, b) => a.index - b.index),
    };
  } finally {
    await connection.client.end();
  }
}
