import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  type DemoScenario,
  type Detail,
  FixtureResponse,
  RepairResponse,
  ReplayResponse,
  type Session,
} from "../../src/messages.ts";
import { api, HttpError, json } from "./http.ts";
import { browserDemo } from "./mode.ts";

function useRefresh() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["events"] }),
      client.invalidateQueries({ queryKey: ["event"] }),
    ]);
}
function ActionError({ error }: { error: Error | null }) {
  const client = useQueryClient();
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <p>{error.message}</p>
      {error instanceof HttpError && error.status === 401 && (
        <button
          type="button"
          className="quiet-button"
          onClick={() => void client.resetQueries({ queryKey: ["session"] })}
        >
          Sign in again
        </button>
      )}
    </div>
  );
}
const samples: { scenario: DemoScenario; label: string }[] = [
  { scenario: "success", label: "Successful event" },
  { scenario: "transient", label: "Temporary failure" },
  { scenario: "permanent", label: "Permanent failure" },
  { scenario: "exhausted", label: "Exhaust retries" },
];
export function DemoTools({ select }: { select: (id: string) => void }) {
  const refresh = useRefresh();
  const send = useMutation({
    mutationFn: (scenario: DemoScenario) =>
      api("/demo/fixtures", FixtureResponse, json({ scenario })),
    onSuccess(value) {
      select(value.receipt.id);
      void refresh();
    },
  });
  return (
    <section className="demo-tools" aria-label={browserDemo ? "Demo samples" : "Local simulator"}>
      <h2>Send a sample</h2>
      <p className="help">
        {browserDemo
          ? "Fictional events with simulated processing."
          : "Signed fictional events for this local source."}
      </p>
      <div className="sample-buttons">
        {samples.map((sample) => (
          <button
            key={sample.scenario}
            type="button"
            className="quiet-button"
            disabled={send.isPending}
            onClick={() => send.mutate(sample.scenario)}
          >
            {sample.label}
          </button>
        ))}
      </div>
      {send.isPending && <p role="status">Sending sample…</p>}
      <ActionError error={send.error} />
    </section>
  );
}
export function EventActions({ detail, session }: { detail: Detail; session: Session }) {
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const request = useRef<{ reason: string; key: string } | null>(null);
  const id = detail.event.id;
  const dead = detail.event.state === "dead_lettered";
  const redeliver = useMutation({
    mutationFn: async () => {
      const value = await api(`/demo/events/${id}/redeliver`, FixtureResponse, json({}));
      if (value.receipt.id !== id)
        throw new Error("Redelivery returned a different receipt. Refresh to investigate.");
      return value;
    },
    onSuccess: () => {
      void refresh();
    },
  });
  const repair = useMutation({
    mutationFn: () => api(`/demo/events/${id}/repair`, RepairResponse, json({})),
    onSuccess: () => {
      void refresh();
    },
  });
  const replay = useMutation({
    mutationFn: () => {
      const normalized = reason.trim();
      // Retain the key after an uncertain response so retry cannot create a second cycle.
      if (!request.current || request.current.reason !== normalized)
        request.current = { reason: normalized, key: crypto.randomUUID() };
      return api(
        `/events/${id}/replay`,
        ReplayResponse,
        json({
          reason: normalized,
          idempotencyKey: request.current.key,
        }),
      );
    },
    onSuccess: () => {
      void refresh();
    },
  });
  const busy = replay.isPending || repair.isPending || redeliver.isPending;
  if (session.role === "viewer")
    return (
      <p className="permission-note">
        Viewer access is read only. An operator can repair demo failures and request replay.
      </p>
    );
  return (
    <section className="recovery-actions" aria-label="Recovery actions">
      <h3>Next action</h3>
      {session.demo && (
        <div className="action-buttons">
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => redeliver.mutate()}
          >
            Redeliver original
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy || !dead || detail.event.reason === "equal_version_conflict"}
            onClick={() => repair.mutate()}
          >
            Repair demo cause
          </button>
        </div>
      )}
      {redeliver.isSuccess && (
        <p role="status" className="help">
          Redelivery returned the same acceptance receipt.
        </p>
      )}
      {repair.isSuccess && (
        <p role="status" className="help">
          {repair.data?.repaired
            ? "Demo cause repaired. Request replay to start a new cycle."
            : "No synthetic fault was found. Inspect the failure reason before requesting replay."}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          replay.mutate();
        }}
      >
        <label htmlFor="replay-reason">Replay reason</label>
        <textarea
          id="replay-reason"
          value={reason}
          maxLength={500}
          rows={2}
          required
          disabled={busy || !dead || replay.isSuccess}
          onChange={(event) => {
            setReason(event.target.value);
            request.current = null;
            replay.reset();
          }}
          placeholder="Describe what changed before replaying"
        />
        <button
          type="submit"
          className="primary"
          disabled={busy || !dead || !reason.trim() || replay.isSuccess}
        >
          {replay.isPending ? "Requesting replay…" : "Request replay"}
        </button>
      </form>
      {replay.isSuccess ? (
        <p role="status" className="help">
          Replay requested. Earlier attempts and original event bytes are preserved.
        </p>
      ) : (
        !dead && (
          <p className="help">
            Replay is available only when processing needs attention. Queued work, active attempts,
            and completed outcomes cannot be replayed.
          </p>
        )
      )}
      <ActionError error={redeliver.error ?? repair.error ?? replay.error} />
    </section>
  );
}
