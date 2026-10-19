import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { Database } from "./database.js";
import { attempts, inbox } from "./schema.js";

type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
export type Outcome = (
  | { state: "processed" | "ignored_stale" | "dead_lettered"; reason: string }
  | { state: "retry_scheduled"; reason: string; nextAttemptAt: Date }
) & { failureCode?: string };
class LeaseLost extends Error {}

// The row lock, attempt insertion, and durable lease commit as one short transaction.
export async function claim(
  connection: Database,
  workerId: string,
  leaseMs: number,
  maxAttempts = 3,
) {
  if (
    !Number.isInteger(leaseMs) ||
    leaseMs < 100 ||
    leaseMs > 60000 ||
    !workerId ||
    workerId.length > 128 ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10
  )
    throw new Error("Invalid claim settings");
  return connection.db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(inbox)
      .where(
        or(
          eq(inbox.state, "received"),
          and(eq(inbox.state, "retry_scheduled"), lte(inbox.nextAttemptAt, sql`clock_timestamp()`)),
          and(eq(inbox.state, "processing"), lte(inbox.leaseUntil, sql`clock_timestamp()`)),
        ),
      )
      .orderBy(asc(inbox.acceptedAt), asc(inbox.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!event) return null;
    if (event.leaseToken) {
      const abandoned = await tx
        .update(attempts)
        .set({ outcome: "abandoned", reason: "lease_expired", finishedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(attempts.id, event.leaseToken),
            eq(attempts.inboxId, event.id),
            eq(attempts.outcome, "running"),
          ),
        )
        .returning({ id: attempts.id });
      if (abandoned.length !== 1) throw new Error("Claim has no running attempt");
    }
    if (event.cycleAttempt >= maxAttempts) {
      await tx
        .update(inbox)
        .set({
          state: "dead_lettered",
          reason: "retry_budget_exhausted",
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: null,
        })
        .where(eq(inbox.id, event.id));
      return null;
    }
    const attemptId = randomUUID();
    const number = event.attemptNumber + 1;
    const cycleAttempt = event.cycleAttempt + 1;
    await tx.insert(attempts).values({
      id: attemptId,
      inboxId: event.id,
      number,
      workerId,
      cycleNumber: event.cycleNumber,
      cycleAttempt,
      replayId: event.currentReplayId,
    });
    const [owned] = await tx
      .update(inbox)
      .set({
        state: "processing",
        leaseToken: attemptId,
        leaseUntil: sql`clock_timestamp() + ${leaseMs} * interval '1 millisecond'`,
        attemptNumber: number,
        reason: null,
        cycleAttempt,
        nextAttemptAt: null,
      })
      .where(eq(inbox.id, event.id))
      .returning();
    if (!owned) throw new Error("Claimed event disappeared");
    return { event: owned, attemptId };
  });
}
export type Claim = NonNullable<Awaited<ReturnType<typeof claim>>>;

// The callback performs database-local work only. Losing the lease rolls back every
// callback write together with attempt and event completion.
export async function withOwnedClaim(
  connection: Database,
  owned: Claim,
  handle: (tx: Transaction, event: typeof inbox.$inferSelect) => Promise<Outcome>,
) {
  try {
    return await connection.db.transaction(async (tx) => {
      const fence = and(
        eq(inbox.id, owned.event.id),
        eq(inbox.state, "processing"),
        eq(inbox.leaseToken, owned.attemptId),
        gt(inbox.leaseUntil, sql`clock_timestamp()`),
      );
      const [event] = await tx.select().from(inbox).where(fence).for("update");
      if (!event) throw new LeaseLost();
      const result = await handle(tx, event);
      const finished = await tx
        .update(inbox)
        .set({
          state: result.state,
          reason: result.reason,
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: result.state === "retry_scheduled" ? result.nextAttemptAt : null,
        })
        .where(fence)
        .returning({ id: inbox.id });
      if (finished.length !== 1) throw new LeaseLost();
      const attempt = await tx
        .update(attempts)
        .set({
          outcome: result.state,
          reason: result.reason,
          finishedAt: sql`clock_timestamp()`,
          retryAt: result.state === "retry_scheduled" ? result.nextAttemptAt : null,
          failureCode: result.failureCode ?? null,
        })
        .where(
          and(
            eq(attempts.id, owned.attemptId),
            eq(attempts.inboxId, event.id),
            eq(attempts.outcome, "running"),
          ),
        )
        .returning({ id: attempts.id });
      if (attempt.length !== 1) throw new Error("Attempt completion invariant failed");
      return result;
    });
  } catch (error) {
    if (error instanceof LeaseLost)
      return { state: "lost_lease", reason: "claim_no_longer_owned" } as const;
    throw error;
  }
}
