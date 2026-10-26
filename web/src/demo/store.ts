import { type DemoScenario, type Detail, Event, type State } from "../../../src/messages.js";
import { HttpError } from "../errors.js";

type Record = {
  detail: Detail;
  scenario: DemoScenario;
  repaired: boolean;
  due: number | null;
  phase: "start" | "finish";
};

// Browser-only illustration of the recovery workflow. No durable storage or worker.
// Advancing the clock on reads keeps progress deterministic without background timers.
export async function createDemoStore(now = Date.now) {
  const records = new Map<string, Record>();
  const keys = new Map<
    string,
    { inboxId: string; reason: string; replay: Detail["replays"][number] }
  >();
  let sequence = 1043;
  const iso = (time: number) => new Date(time).toISOString();

  async function insert(scenario: DemoScenario, refundId: string, accepted: number) {
    const payload = Event.assert({
      schemaVersion: 1,
      type: "refund.status_changed",
      eventId: crypto.randomUUID(),
      refundId,
      version: 1,
      status: "completed",
    });
    const raw = JSON.stringify(payload);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const record: Record = {
      scenario,
      repaired: false,
      due: accepted + 200,
      phase: "start",
      detail: {
        event: {
          id: crypto.randomUUID(),
          eventId: payload.eventId,
          acceptedAt: iso(accepted),
          state: "received",
          payload,
          raw,
          bodyHash: [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(""),
          reason: null,
          leaseUntil: null,
          nextAttemptAt: null,
          cycleNumber: 1,
          cycleAttempt: 0,
        },
        attempts: [],
        attemptsNextOffset: null,
        replays: [],
        replaysNextOffset: null,
        receipt: null,
        projection: null,
        completions: [],
      },
    };
    records.set(record.detail.event.id, record);
    return record;
  }

  function advance() {
    const current = now();
    for (const record of records.values()) {
      const { detail } = record;
      const event = detail.event;
      while (record.due !== null && record.due <= current) {
        const time = record.due;
        if (record.phase === "start") {
          event.cycleAttempt++;
          event.state = "processing";
          event.reason = null;
          event.nextAttemptAt = null;
          event.leaseUntil = iso(time + 30000);
          detail.attempts.push({
            id: crypto.randomUUID(),
            number: detail.attempts.length + 1,
            cycleNumber: event.cycleNumber,
            cycleAttempt: event.cycleAttempt,
            startedAt: iso(time),
            finishedAt: null,
            outcome: "running",
            reason: null,
            failureCode: null,
            retryAt: null,
            replayId: detail.replays.at(-1)?.id ?? null,
          });
          record.phase = "finish";
          record.due = time + 450;
          continue;
        }
        const attempt = detail.attempts.at(-1);
        if (!attempt) throw new Error("Missing simulated attempt");
        const failed =
          !record.repaired &&
          record.scenario !== "success" &&
          (record.scenario !== "transient" || event.cycleAttempt === 1);
        const terminal = record.scenario === "permanent" || event.cycleAttempt >= 3;
        const reason = failed
          ? record.scenario === "permanent"
            ? "synthetic_permanent_failure"
            : terminal
              ? "retry_budget_exhausted"
              : "synthetic_unavailable"
          : "snapshot_applied";
        event.state = failed ? (terminal ? "dead_lettered" : "retry_scheduled") : "processed";
        event.reason = reason;
        event.leaseUntil = null;
        event.nextAttemptAt = failed && !terminal ? iso(time + 600) : null;
        attempt.outcome = event.state;
        attempt.reason = reason;
        attempt.finishedAt = iso(time);
        attempt.failureCode = failed
          ? record.scenario === "permanent"
            ? "synthetic_permanent_failure"
            : "synthetic_unavailable"
          : null;
        attempt.retryAt = event.nextAttemptAt;
        if (!failed) {
          detail.receipt = { decision: "applied", createdAt: iso(time) };
          detail.projection = { version: 1, status: "completed", updatedAt: iso(time) };
          if (!detail.completions.length)
            detail.completions.push({
              id: crypto.randomUUID(),
              action: "completion",
              createdAt: iso(time),
            });
        }
        record.phase = "start";
        record.due = failed && !terminal ? time + 600 : null;
      }
    }
  }

  function find(id: string) {
    advance();
    const record = records.get(id.toLowerCase());
    if (!record)
      throw new HttpError("This event is not in this demo session. Reset to start again.", 404);
    return record;
  }
  function receipt(id: string) {
    const { event } = find(id).detail;
    return { id: event.id, eventId: event.eventId, acceptedAt: event.acceptedAt };
  }

  const seededAt = now();
  await insert("success", "refund_demo_1039", seededAt - 180000);
  const stale = await insert("success", "refund_demo_1040", seededAt - 120000);
  await insert("permanent", "refund_demo_1041", seededAt - 90000);
  await insert("exhausted", "refund_demo_1042", seededAt - 60000);
  advance();
  stale.detail.event.state = "ignored_stale";
  stale.detail.event.reason = "older_snapshot";
  const staleAttempt = stale.detail.attempts[0];
  if (!staleAttempt || !stale.detail.projection || !stale.detail.receipt)
    throw new Error("Missing simulated snapshot");
  staleAttempt.outcome = "ignored_stale";
  staleAttempt.reason = "older_snapshot";
  stale.detail.projection.version = 3;
  stale.detail.receipt.decision = "stale";

  return {
    list(state?: State, limit = 20, offset = 0) {
      advance();
      const events = [...records.values()]
        .map((record) => record.detail.event)
        .filter((event) => !state || event.state === state)
        .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt));
      return structuredClone({
        items: events.slice(offset, offset + limit).map((event) => ({
          id: event.id,
          eventId: event.eventId,
          acceptedAt: event.acceptedAt,
          state: event.state,
          payload: event.payload,
        })),
        nextOffset: offset + limit < events.length ? offset + limit : null,
      });
    },
    detail(id: string) {
      const detail = find(id).detail;
      return structuredClone({
        ...detail,
        attempts: detail.attempts.slice(-50),
        attemptsNextOffset: detail.attempts.length > 50 ? 50 : null,
        replays: detail.replays.slice(-50),
        replaysNextOffset: detail.replays.length > 50 ? 50 : null,
      });
    },
    history(id: string, kind: "attempts" | "replays", limit: number, offset: number) {
      const items = [...find(id).detail[kind]].reverse();
      return structuredClone({
        items: items.slice(offset, offset + limit),
        nextOffset: offset + limit < items.length ? offset + limit : null,
      });
    },
    async sample(scenario: DemoScenario) {
      if (records.size >= 50)
        throw new HttpError("This demo has 50 events. Reset demo to start fresh.", 409);
      const record = await insert(scenario, `refund_demo_${sequence++}`, now());
      return { receipt: receipt(record.detail.event.id) };
    },
    redeliver(id: string) {
      return { receipt: receipt(id) };
    },
    receipt,
    repair(id: string) {
      const record = find(id);
      const repaired = !record.repaired && record.scenario !== "success";
      record.repaired = true;
      return { repaired, refundId: record.detail.event.payload.refundId };
    },
    replay(id: string, input: { idempotencyKey: string; reason: string }) {
      const record = find(id);
      const { event } = record.detail;
      const reason = input.reason.trim();
      if (!reason || reason.length > 500)
        throw new HttpError("Enter a replay reason of 1 to 500 characters.", 400);
      const key = input.idempotencyKey.toLowerCase();
      const existing = keys.get(key);
      if (existing) {
        if (existing.inboxId !== event.id || existing.reason !== reason)
          throw new HttpError("Replay key already used with different content", 409);
        return { replay: structuredClone(existing.replay) };
      }
      if (event.state !== "dead_lettered")
        throw new HttpError("Only terminal failures can be replayed", 409);
      if (event.cycleNumber >= 50)
        throw new HttpError("This event has 50 cycles. Reset demo to start fresh.", 409);
      const replay = {
        id: crypto.randomUUID(),
        cycleNumber: event.cycleNumber + 1,
        reason,
        operatorId: "browser-demo-operator",
        requestedAt: iso(now()),
      };
      keys.set(key, { inboxId: event.id, reason, replay });
      record.detail.replays.push(replay);
      event.cycleNumber++;
      event.cycleAttempt = 0;
      event.state = "received";
      event.reason = null;
      event.nextAttemptAt = null;
      record.phase = "start";
      record.due = now() + 200;
      return { replay: structuredClone(replay) };
    },
  };
}
