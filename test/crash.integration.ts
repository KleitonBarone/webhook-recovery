import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { until } from "../scripts/runtime.js";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database } from "../src/database.js";
import { attempts, completions, inbox, processingReceipts, refunds } from "../src/schema.js";
import { fixture, send } from "../src/sender.js";
import type { Boundary } from "../src/worker-pause.js";

export type CrashHarness = {
  start(name: string, pause?: { inboxId: string; boundary: Boundary }): Promise<ChildProcess>;
  stop(worker: ChildProcess, force?: boolean): Promise<void>;
  resume(worker: ChildProcess, inboxId: string): Promise<void>;
  log(name: string): Promise<string>;
};
const Paused = type({
  event: "'worker_paused'",
  boundary: "string",
  inboxId: "string",
  attemptId: "string",
  pid: "number",
});
const Finished = type({
  event: "'processing_finished'",
  inboxId: "string",
  attemptId: "string",
  state: "string",
});

export async function verifyCrashes(base: string, config: Configuration, harness: CrashHarness) {
  const connection = database(config);
  const leaseMs = 2000;
  async function accepted() {
    const payload = fixture();
    const response = await send(base, config.sourceSecret, JSON.stringify(payload));
    assert.equal(response.status, 202);
    return { payload, receipt: Receipt.assert(await response.json()) };
  }
  async function snapshot(id: string) {
    const [event] = await connection.db.select().from(inbox).where(eq(inbox.id, id));
    assert.ok(event);
    const history = await connection.db
      .select()
      .from(attempts)
      .where(eq(attempts.inboxId, id))
      .orderBy(attempts.number);
    const ledger = await connection.db
      .select()
      .from(completions)
      .where(
        and(
          eq(completions.sourceId, event.sourceId),
          eq(completions.refundId, event.payload.refundId),
        ),
      );
    const receipts = await connection.db
      .select()
      .from(processingReceipts)
      .where(eq(processingReceipts.inboxId, id));
    const projection = await connection.db
      .select()
      .from(refunds)
      .where(
        and(eq(refunds.sourceId, event.sourceId), eq(refunds.refundId, event.payload.refundId)),
      );
    return {
      state: event.state,
      leaseUntil: event.leaseUntil,
      attempts: history.map((attempt) => ({
        id: attempt.id,
        number: attempt.number,
        outcome: attempt.outcome,
        workerId: attempt.workerId,
      })),
      completionCount: ledger.length,
      receiptCount: receipts.length,
      projectionVersion: projection[0]?.version ?? null,
    };
  }
  async function barrier(name: string, id: string, boundary: Boundary) {
    let observed: typeof Paused.infer | undefined;
    await until(async () => {
      const messages = (await harness.log(name))
        .split("\n")
        .slice(0, -1)
        .filter(Boolean)
        .map((line): unknown => JSON.parse(line));
      observed = messages.find(
        (message): message is typeof Paused.infer =>
          Paused.allows(message) && message.inboxId === id && message.boundary === boundary,
      );
      return observed !== undefined;
    });
    assert.ok(observed);
    return observed;
  }
  async function processed(id: string) {
    await until(async () => (await snapshot(id)).state === "processed");
    const result = await snapshot(id);
    assert.equal(result.completionCount, 1);
    assert.equal(result.receiptCount, 1);
    assert.equal(result.projectionVersion, 1);
    return result;
  }
  try {
    const before = await accepted();
    const preWorker = await harness.start("pre-commit", {
      inboxId: before.receipt.id,
      boundary: "before_commit",
    });
    const preBarrier = await barrier("pre-commit", before.receipt.id, "before_commit");
    assert.equal(preBarrier.pid, preWorker.pid);
    const uncommitted = await snapshot(before.receipt.id);
    assert.equal(uncommitted.state, "processing");
    assert.equal(uncommitted.completionCount, 0);
    assert.equal(uncommitted.receiptCount, 0);
    assert.equal(uncommitted.projectionVersion, null);
    await harness.stop(preWorker, true);
    const preRecoveryWorker = await harness.start("pre-recovery");
    const recoveredBefore = await processed(before.receipt.id);
    assert.deepEqual(
      recoveredBefore.attempts.map((attempt) => attempt.outcome),
      ["abandoned", "processed"],
    );
    assert.deepEqual(
      Receipt.assert(
        await (await send(base, config.sourceSecret, JSON.stringify(before.payload))).json(),
      ),
      before.receipt,
    );
    await harness.stop(preRecoveryWorker);

    const after = await accepted();
    const postWorker = await harness.start("post-commit", {
      inboxId: after.receipt.id,
      boundary: "after_commit",
    });
    const postBarrier = await barrier("post-commit", after.receipt.id, "after_commit");
    assert.equal(postBarrier.pid, postWorker.pid);
    const committed = await processed(after.receipt.id);
    assert.equal(committed.attempts.length, 1);
    await harness.stop(postWorker, true);
    const postRecoveryWorker = await harness.start("post-recovery");
    const probe = await accepted();
    await processed(probe.receipt.id);
    const recoveredAfter = await processed(after.receipt.id);
    assert.deepEqual(recoveredAfter, committed);
    await harness.stop(postRecoveryWorker);

    const takeover = await accepted();
    const oldWorker = await harness.start("old-owner", {
      inboxId: takeover.receipt.id,
      boundary: "claimed",
    });
    const ownerBarrier = await barrier("old-owner", takeover.receipt.id, "claimed");
    assert.equal(ownerBarrier.pid, oldWorker.pid);
    const newWorker = await harness.start("new-owner");
    const winner = await processed(takeover.receipt.id);
    assert.deepEqual(
      winner.attempts.map((attempt) => attempt.outcome),
      ["abandoned", "processed"],
    );
    assert.equal(winner.attempts[0]?.id, ownerBarrier.attemptId);
    await harness.resume(oldWorker, takeover.receipt.id);
    await until(async () =>
      (await harness.log("old-owner"))
        .split("\n")
        .slice(0, -1)
        .filter(Boolean)
        .map((line): unknown => JSON.parse(line))
        .some(
          (message) =>
            Finished.allows(message) &&
            message.inboxId === takeover.receipt.id &&
            message.attemptId === ownerBarrier.attemptId &&
            message.state === "lost_lease",
        ),
    );
    const fenced = await processed(takeover.receipt.id);
    assert.deepEqual(fenced, winner);
    await harness.stop(oldWorker);
    await harness.stop(newWorker);
    return [
      {
        scenario: "termination_before_commit",
        kind: "actual_process_termination",
        signal: "SIGKILL",
        leaseMs,
        receipt: before.receipt,
        barrier: preBarrier,
        before: uncommitted,
        after: recoveredBefore,
      },
      {
        scenario: "termination_after_commit",
        kind: "actual_process_termination",
        signal: "SIGKILL",
        leaseMs,
        receipt: after.receipt,
        barrier: postBarrier,
        before: committed,
        after: recoveredAfter,
      },
      {
        scenario: "expired_owner_resumes",
        kind: "paused_process_takeover",
        leaseMs,
        receipt: takeover.receipt,
        barrier: ownerBarrier,
        before: winner,
        after: fenced,
      },
    ];
  } finally {
    await connection.client.end();
  }
}
