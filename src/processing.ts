import { and, eq, sql } from "drizzle-orm";
import { type Claim, withOwnedClaim } from "./claims.js";
import type { Database } from "./database.js";
import { defaultRetryPolicy, failureOutcome, type RetryPolicy } from "./retries.js";
import { completions, processingReceipts, refunds, syntheticFaults } from "./schema.js";

export function processClaim(
  connection: Database,
  owned: Claim,
  policy: RetryPolicy = defaultRetryPolicy,
  jitter = Math.random,
  beforeFinish?: () => Promise<void>,
) {
  return withOwnedClaim(
    connection,
    owned,
    async (tx, event) => {
      const snapshot = event.payload;
      if (policy.demo) {
        const [fault] = await tx
          .select({
            kind: syntheticFaults.kind,
            failForAttempts: syntheticFaults.failForAttempts,
            now: sql`extract(epoch from clock_timestamp()) * 1000`.mapWith(Number),
          })
          .from(syntheticFaults)
          .where(
            and(
              eq(syntheticFaults.sourceId, event.sourceId),
              eq(syntheticFaults.refundId, snapshot.refundId),
            ),
          )
          .limit(1);
        if (fault && (fault.kind === "permanent" || event.cycleAttempt <= fault.failForAttempts)) {
          return failureOutcome(
            {
              kind: fault.kind,
              reason:
                fault.kind === "permanent"
                  ? "synthetic_permanent_failure"
                  : "synthetic_unavailable",
            },
            event.cycleAttempt,
            policy,
            { now: fault.now, jitter: jitter() },
          );
        }
      }
      // A transaction-scoped aggregate lock also serializes first-row creation.
      // A hash collision only adds contention; all data queries still use both IDs.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([event.sourceId, snapshot.refundId])}, 0))`,
      );
      const identity = and(
        eq(refunds.sourceId, event.sourceId),
        eq(refunds.refundId, snapshot.refundId),
      );
      const [current] = await tx.select().from(refunds).where(identity).limit(1);
      if (current && current.version > snapshot.version) {
        await tx
          .insert(processingReceipts)
          .values({ inboxId: event.id, attemptId: owned.attemptId, decision: "stale" });
        return { state: "ignored_stale", reason: "older_snapshot" };
      }
      if (current?.version === snapshot.version) {
        if (current.status !== snapshot.status)
          return { state: "dead_lettered", reason: "equal_version_conflict" };
        await tx
          .insert(processingReceipts)
          .values({ inboxId: event.id, attemptId: owned.attemptId, decision: "same_version" });
        return { state: "processed", reason: "same_version_noop" };
      }
      await tx
        .insert(refunds)
        .values({
          sourceId: event.sourceId,
          refundId: snapshot.refundId,
          version: snapshot.version,
          status: snapshot.status,
          lastInboxId: event.id,
        })
        .onConflictDoUpdate({
          target: [refunds.sourceId, refunds.refundId],
          set: {
            version: snapshot.version,
            status: snapshot.status,
            lastInboxId: event.id,
            updatedAt: sql`clock_timestamp()`,
          },
        });
      if (snapshot.status === "completed") {
        await tx
          .insert(completions)
          .values({ sourceId: event.sourceId, refundId: snapshot.refundId, inboxId: event.id })
          .onConflictDoNothing({
            target: [completions.sourceId, completions.refundId, completions.action],
          });
      }
      await tx
        .insert(processingReceipts)
        .values({ inboxId: event.id, attemptId: owned.attemptId, decision: "applied" });
      return { state: "processed", reason: "snapshot_applied" };
    },
    beforeFinish,
  );
}
