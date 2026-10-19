import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AttemptPage,
  Detail,
  InboxPage,
  ReplayPage,
  Session,
  State,
  states,
} from "../../src/messages.ts";
import { DemoTools, EventActions } from "./Actions.tsx";
import { api, HttpError, json } from "./http.ts";

export const stateLabels: Record<State, string> = {
  received: "Queued",
  processing: "Processing",
  retry_scheduled: "Retry scheduled",
  processed: "Processed",
  ignored_stale: "Older snapshot",
  dead_lettered: "Needs attention",
};
const time = (value: string) =>
  `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value))} UTC`;
const reasonLabels: Record<string, string> = {
  synthetic_permanent_failure: "The sample handler is set to fail until its cause is repaired.",
  synthetic_unavailable: "A temporary handler failure is waiting for another attempt.",
  retry_budget_exhausted: "This processing cycle used its automatic attempt budget.",
  equal_version_conflict: "Another snapshot has different content at the same version.",
  older_snapshot: "A newer refund snapshot is already applied.",
  same_version_noop: "This refund version was already applied. No second action was needed.",
  snapshot_applied: "The refund snapshot and processing receipt committed together.",
};
function Badge({ state }: { state: State }) {
  return <span className={`status status-${state}`}>{stateLabels[state]}</span>;
}
function Failure({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <p>{error.message}</p>
      {retry && (
        <button className="quiet-button" type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 8v15h17" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="7" cy="8" r="4" fill="currentColor" />
        <circle cx="7" cy="23" r="4" fill="currentColor" />
        <circle cx="24" cy="23" r="4" fill="currentColor" />
      </svg>
      <span>Webhook recovery</span>
    </div>
  );
}
function SignIn() {
  const client = useQueryClient();
  const [token, setToken] = useState("");
  const login = useMutation({
    mutationFn: () => api("/session", Session, json({ token })),
    onSuccess(session) {
      setToken("");
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      client.setQueryData(["session"], session);
    },
  });
  return (
    <main className="entry">
      <Brand />
      <div className="entry-content">
        <p className="subtle">Local investigation console</p>
        <h1>
          Follow an event.
          <br />
          Recover its processing.
        </h1>
        <p>
          Sign in to inspect acceptance receipts, processing attempts, and refund outcomes for your
          source.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <label htmlFor="session-token">Operator or viewer credential</label>
          <input
            id="session-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            minLength={24}
            maxLength={256}
            required
          />
          <p className="help">
            Use the credential from your local environment. Viewer access is read only.
          </p>
          <button className="primary" type="submit" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
          {login.error && <Failure error={login.error} />}
        </form>
      </div>
      <p className="entry-foot">Durable acceptance. Visible processing. Audited recovery.</p>
    </main>
  );
}
export function App() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api("/session", Session),
    refetchInterval: 30000,
  });
  if (session.isPending)
    return (
      <main className="entry">
        <Brand />
        <p role="status">Checking your session…</p>
      </main>
    );
  if (session.error instanceof HttpError && session.error.status === 401) return <SignIn />;
  if (session.error)
    return (
      <main className="entry">
        <Brand />
        <Failure error={session.error} retry={() => void session.refetch()} />
      </main>
    );
  return <Workbench session={session.data} />;
}
function Workbench({ session }: { session: Session }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("event"),
  );
  const [filter, setFilter] = useState<State | "all">("all");
  const [offset, setOffset] = useState(0);
  const events = useQuery({
    queryKey: ["events", filter, offset],
    queryFn: () =>
      api(
        `/events?limit=20&offset=${offset}${filter === "all" ? "" : `&state=${filter}`}`,
        InboxPage,
      ),
    refetchInterval: 2000,
  });
  const logout = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/session", {
        method: "DELETE",
        credentials: "same-origin",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
    },
    onSuccess() {
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      void client.resetQueries({ queryKey: ["session"] });
    },
  });
  function select(id: string | null) {
    setSelected(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set("event", id);
    else url.searchParams.delete("event");
    history.replaceState(null, "", url);
  }
  return (
    <>
      <header className="topbar">
        <Brand />
        <div className="session-info">
          <span className="source">{session.sourceId}</span>
          <span className="role">{session.role === "viewer" ? "Viewer" : "Operator"}</span>
          {session.demo && <span className="local-mode">Local demo</span>}
          <button
            className="quiet-button"
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className={`workspace ${selected ? "has-selection" : ""}`}>
        <section className="inbox-pane" aria-label="Inbox">
          {session.demo && session.role === "operator" && <DemoTools select={select} />}
          <div className="pane-heading">
            <div>
              <h1>Inbox</h1>
              <p className="subtle">Accepted events, newest first</p>
            </div>
            <button
              className="quiet-button"
              type="button"
              aria-label="Refresh inbox"
              onClick={() => void events.refetch()}
            >
              Refresh
            </button>
          </div>
          <label className="filter-label" htmlFor="state-filter">
            Processing state
          </label>
          <select
            id="state-filter"
            value={filter}
            onChange={(event) => {
              setFilter(State.allows(event.target.value) ? event.target.value : "all");
              setOffset(0);
            }}
          >
            <option value="all">All states</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {stateLabels[state]}
              </option>
            ))}
          </select>
          {events.isPending ? (
            <p className="pane-message" role="status">
              Loading events…
            </p>
          ) : events.error ? (
            <Failure error={events.error} retry={() => void events.refetch()} />
          ) : events.data.items.length === 0 ? (
            <div className="empty-list">
              <h2>No events in this view</h2>
              <p>Send a signed sample from the local sender, or choose another state.</p>
            </div>
          ) : (
            <ul className="event-list">
              {events.data.items.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    className={`event-row ${selected === event.id ? "selected" : ""}`}
                    aria-pressed={selected === event.id}
                    onClick={() => select(event.id)}
                  >
                    <div className="event-row-top">
                      <Badge state={event.state} />
                      <span className="version">v{event.payload.version}</span>
                    </div>
                    <span className="refund-id">{event.payload.refundId}</span>
                    <span className="row-meta">{event.payload.status} snapshot</span>
                    <time dateTime={event.acceptedAt}>{time(event.acceptedAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pagination">
            <button
              type="button"
              className="quiet-button"
              disabled={offset === 0 || events.isFetching}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Newer
            </button>
            <span>Page {offset / 20 + 1}</span>
            <button
              type="button"
              className="quiet-button"
              disabled={events.data?.nextOffset == null || events.isFetching}
              onClick={() => {
                if (events.data?.nextOffset != null) setOffset(events.data.nextOffset);
              }}
            >
              Older
            </button>
          </div>
        </section>
        <section className="detail-pane" aria-label="Event investigation">
          {selected ? (
            <EventView key={selected} id={selected} session={session} back={() => select(null)} />
          ) : (
            <div className="welcome">
              <div className="receipt-mark" aria-hidden="true">
                ✓
              </div>
              <h2>Acceptance is the beginning.</h2>
              <p>
                Select an event to follow its processing attempts and inspect the committed refund
                outcome.
              </p>
              <div className="fact-pair">
                <div>
                  <strong>Accepted</strong>
                  <p>The original event is durable.</p>
                </div>
                <div>
                  <strong>Processed</strong>
                  <p>Its local outcome committed.</p>
                </div>
              </div>
              {session.role === "viewer" && (
                <p className="help">Viewer access lets you inspect this source.</p>
              )}
            </div>
          )}
        </section>
      </main>
      {logout.error && (
        <div className="floating-error">
          <Failure error={logout.error} />
        </div>
      )}
    </>
  );
}
function EventView({ id, session, back }: { id: string; session: Session; back: () => void }) {
  const detail = useQuery({
    queryKey: ["event", id],
    queryFn: () => api(`/events/${id}`, Detail),
    refetchInterval: 2000,
  });
  const [attemptOffset, setAttemptOffset] = useState<number | null>(null);
  const [replayOffset, setReplayOffset] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const olderAttempts = useQuery({
    queryKey: ["attempts", id, attemptOffset],
    queryFn: () => api(`/events/${id}/attempts?limit=50&offset=${attemptOffset ?? 0}`, AttemptPage),
    enabled: attemptOffset !== null,
  });
  const olderReplays = useQuery({
    queryKey: ["replays", id, replayOffset],
    queryFn: () => api(`/events/${id}/replays?limit=50&offset=${replayOffset ?? 0}`, ReplayPage),
    enabled: replayOffset !== null,
  });
  if (detail.isPending)
    return (
      <div className="detail-content">
        <button className="back-button" type="button" onClick={back}>
          Back to inbox
        </button>
        <p role="status">Loading event…</p>
      </div>
    );
  if (detail.error)
    return (
      <div className="detail-content">
        <button className="back-button" type="button" onClick={back}>
          Back to inbox
        </button>
        <Failure error={detail.error} retry={() => void detail.refetch()} />
      </div>
    );
  const value = detail.data;
  const attemptItems =
    attemptOffset === null ? value.attempts : [...(olderAttempts.data?.items ?? [])].reverse();
  const replayItems =
    replayOffset === null ? value.replays : [...(olderReplays.data?.items ?? [])].reverse();
  return (
    <div className="detail-content">
      <button className="back-button" type="button" onClick={back}>
        Back to inbox
      </button>
      <div className="detail-title">
        <div>
          <p className="subtle">Refund status changed</p>
          <h2>{value.event.payload.refundId}</h2>
        </div>
        <Badge state={value.event.state} />
      </div>
      <div className="acceptance">
        <span className="acceptance-check" aria-hidden="true">
          ✓
        </span>
        <div>
          <strong>Accepted</strong>
          <time dateTime={value.event.acceptedAt}>{time(value.event.acceptedAt)}</time>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(id)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Receipt ID copied" : "Copy receipt ID"}
        </button>
      </div>
      <p className="identifier">{id}</p>
      <div className={`outcome outcome-${value.event.state}`}>
        <h3>{stateLabels[value.event.state]}</h3>
        <p>
          {value.event.reason
            ? (reasonLabels[value.event.reason] ?? "Inspect the attempt history for this outcome.")
            : value.event.state === "received"
              ? "The event is durable and waiting for a worker."
              : "A worker owns this attempt. Its outcome has not committed yet."}
        </p>
        {value.event.nextAttemptAt && (
          <p>
            Next attempt <strong>{time(value.event.nextAttemptAt)}</strong>
          </p>
        )}
        {value.event.leaseUntil && (
          <p className="help">Current lease expires {time(value.event.leaseUntil)}</p>
        )}
        <span className="help">
          Cycle {value.event.cycleNumber}, attempt {value.event.cycleAttempt}
        </span>
      </div>
      <EventActions key={value.event.cycleNumber} detail={value} session={session} />
      <div className="evidence">
        <section>
          <h3>Current refund snapshot</h3>
          {value.projection ? (
            <>
              <strong className="evidence-value">{value.projection.status}</strong>
              <p>Version {value.projection.version}</p>
              <p className="help">{time(value.projection.updatedAt)}</p>
            </>
          ) : (
            <p>No snapshot has committed for this refund.</p>
          )}
        </section>
        <section>
          <h3>Completion action</h3>
          <strong className="evidence-value">
            {value.completions.length} {value.completions.length === 1 ? "entry" : "entries"}
          </strong>
          <p>
            {value.completions.length
              ? "The refund completion is recorded once."
              : "No completion has been recorded."}
          </p>
          {value.receipt && (
            <p className="help">
              Processing receipt: {value.receipt.decision.replaceAll("_", " ")}
            </p>
          )}
        </section>
      </div>
      <section className="history-section">
        <div className="section-heading">
          <h3>Processing attempts</h3>
          {attemptOffset !== null && (
            <button type="button" className="quiet-button" onClick={() => setAttemptOffset(null)}>
              Latest attempts
            </button>
          )}
        </div>
        {olderAttempts.error && <Failure error={olderAttempts.error} />}
        {attemptOffset !== null && olderAttempts.isPending && (
          <p role="status">Loading older attempts…</p>
        )}
        <ol className="attempts">
          {attemptItems.map((attempt) => (
            <li key={attempt.id}>
              <span className={`attempt-dot attempt-${attempt.outcome}`}>{attempt.number}</span>
              <div>
                <div className="attempt-heading">
                  <strong>{attempt.outcome.replaceAll("_", " ")}</strong>
                  <span>
                    Cycle {attempt.cycleNumber}, attempt {attempt.cycleAttempt}
                  </span>
                </div>
                <time dateTime={attempt.startedAt}>{time(attempt.startedAt)}</time>
                {attempt.reason && (
                  <p>{reasonLabels[attempt.reason] ?? attempt.reason.replaceAll("_", " ")}</p>
                )}
                {attempt.failureCode && <code>{attempt.failureCode}</code>}
                {attempt.retryAt && <p className="help">Scheduled retry {time(attempt.retryAt)}</p>}
              </div>
            </li>
          ))}
        </ol>
        {attemptOffset === null && attemptItems.length === 0 && (
          <p className="subtle">No processing attempt yet.</p>
        )}
        {(attemptOffset === null ? value.attemptsNextOffset : olderAttempts.data?.nextOffset) !=
          null && (
          <button
            className="quiet-button"
            type="button"
            disabled={olderAttempts.isFetching}
            onClick={() =>
              setAttemptOffset(
                attemptOffset === null
                  ? value.attemptsNextOffset
                  : (olderAttempts.data?.nextOffset ?? null),
              )
            }
          >
            Load older attempts
          </button>
        )}
      </section>
      <section className="history-section">
        <div className="section-heading">
          <h3>Replay audit</h3>
          {replayOffset !== null && (
            <button type="button" className="quiet-button" onClick={() => setReplayOffset(null)}>
              Latest replay requests
            </button>
          )}
        </div>
        {olderReplays.error && <Failure error={olderReplays.error} />}
        {replayOffset !== null && olderReplays.isPending && (
          <p role="status">Loading older replay requests…</p>
        )}
        <ul className="replay-audit">
          {replayItems.map((replay) => (
            <li key={replay.id}>
              <strong>Cycle {replay.cycleNumber}</strong>
              <p>{replay.reason}</p>
              <time dateTime={replay.requestedAt}>{time(replay.requestedAt)}</time>
              <p className="help">Operator {replay.operatorId.slice(0, 12)}</p>
            </li>
          ))}
        </ul>
        {replayOffset === null && replayItems.length === 0 && (
          <p className="subtle">No manual replay has been requested.</p>
        )}
        {(replayOffset === null ? value.replaysNextOffset : olderReplays.data?.nextOffset) !=
          null && (
          <button
            className="quiet-button"
            type="button"
            disabled={olderReplays.isFetching}
            onClick={() =>
              setReplayOffset(
                replayOffset === null
                  ? value.replaysNextOffset
                  : (olderReplays.data?.nextOffset ?? null),
              )
            }
          >
            Load older replay requests
          </button>
        )}
      </section>
      <details className="payload">
        <summary>Original event and receipt details</summary>
        <dl>
          <dt>Sender event ID</dt>
          <dd>{value.event.eventId}</dd>
          <dt>Body hash</dt>
          <dd>{value.event.bodyHash}</dd>
          <dt>Source</dt>
          <dd>{session.sourceId}</dd>
        </dl>
        <pre>{value.event.raw}</pre>
      </details>
    </div>
  );
}
