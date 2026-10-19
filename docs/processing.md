# Processing and transaction boundaries

Each worker claims one event at a time. PostgreSQL selects received or expired
processing work with `FOR UPDATE SKIP LOCKED`, records an attempt, and sets a
durable lease token/deadline in the same short transaction. The worker defaults
to a 30-second lease. `WORKER_LEASE_MS` accepts 100 to 60,000 milliseconds for
explicit local experiments; verification reports distinguish test settings.

Processing locks the owned inbox row and checks both token and database-clock
deadline. A transaction-scoped advisory lock serializes the source/refund pair,
including the first projection insert. A hash collision only serializes unrelated
work; every query still uses the complete source/refund identity.

The handler applies these full-snapshot rules:

- A higher version updates the projection.
- A lower version finishes as `ignored_stale` with an `older_snapshot` reason.
- An equal version with matching status is `processed` as `same_version_noop`.
- An equal version with a contradictory status is `dead_lettered` with
  `equal_version_conflict`. It leaves the projection unchanged.
- A completed snapshot inserts at most one source/refund/completion ledger entry.
  Later snapshots can change the synthetic status, but cannot repeat that action.

The projection, completion entry, processing receipt, attempt outcome, and inbox
outcome commit together. The final update checks lease ownership again. A lost
lease or database error rolls back all handler writes. A takeover marks the old
running attempt abandoned and adds a new attempt; it retains the prior history.
Receipt identity, original bytes, and original acceptance time never change.

The worker announces database readiness before verification sends its final
end-to-end fixture. Startup and transaction failures have bounded, sanitized
diagnostics. PostgreSQL statements and idle transactions have 10-second timeouts;
there is no heartbeat or external call inside a business transaction. This is a
database-local lab, with no exactly-once promise across external services.

`GET /api/events/:id` includes the latest 50 attempts in chronological order,
the processing receipt, current refund projection, and completion entry.
`attemptsNextOffset` indicates older history. `GET /api/events/:id/attempts`
uses the same limit/offset bounds as the event list and returns descending attempt
numbers. Both endpoints enforce the operator session's source permissions.

`pnpm verify` exercises actual row-lock contention, lease takeover and fencing,
concurrent first-row/version updates, stale snapshots, distinct completion events,
source isolation, and rollback after a database-enforced processing receipt
failure. It also sends a signed HTTP event through a separate worker process and
inspects the committed result through the authenticated API. Lease-expiry
integration tests explicitly change disposable lease metadata. Controlled process
termination at commit boundaries is added in the later crash-evidence milestone.

The locking choices follow PostgreSQL's
[row-lock and advisory-lock documentation](https://www.postgresql.org/docs/current/explicit-locking.html).

## Automatic retries

`MAX_ATTEMPTS` defaults to three claims per processing cycle, including abandoned
leases. `RETRY_BASE_MS` defaults to 1,000 milliseconds. Transient synthetic handler
failures use exponential backoff with 20% jitter and a 60-second maximum delay.
The worker uses PostgreSQL's clock and atomically stores the retry deadline with
the failed attempt outcome. Claiming clears the current deadline; the previous
attempt retains its original `retryAt`. A restart does not reset the schedule.

Permanent failures dead-letter immediately. Exhaustion records
`retry_budget_exhausted`; the attempt retains the underlying `failureCode`.
Expired leases also consume the cycle budget, so repeated worker loss cannot
create unbounded automatic attempts. Database errors roll back the transaction
and leave the lease for recovery. They do not fabricate successful effects or
failed-attempt commits. Global attempt numbers never reset.

Persistent synthetic fault rules apply only with `DEMO_MODE=true`. A rule can fail
the first configured attempts or fail permanently. Their classified outcomes are
intentional handler simulations, separate from database failures and real worker
termination. Tests control jitter, compare persisted deadlines, and explicitly
advance disposable retry/lease metadata to avoid wall-clock sleeps. Authenticated
demo controls are added in the later scenario milestone.

## Manual replay

An operator can post `{ "idempotencyKey": "<uuid>", "reason": "<why>" }` to
`/api/events/:id/replay` for a `dead_lettered` event. The request requires an
authenticated operator and a matching local Origin. A viewer has read access only.
The API trims surrounding reason whitespace and requires 1 to 500 characters.

The inbox lock serializes replay with processing and other replay requests. The
transaction records an immutable replay audit and queues a new processing cycle
with a fresh automatic-attempt budget. It preserves original bytes, acceptance,
versions, business identities, and earlier attempts. New attempts link to that
replay request. Audit operator IDs derive from the authenticated session identity,
never from request-supplied operator fields or credentials returned to the client.

Keys are scoped to the trusted source and operator. Reusing one with the same
event and normalized reason returns the original 202 replay receipt, even after
processing finishes. Changed content returns 409. A fresh key cannot replay active,
processed, or stale work. The API never edits a payload to repair it.

Event detail includes the latest 50 replay requests and a pagination offset for
older audit entries. `/api/events/:id/replays` provides bounded source-scoped
history. Clearing a synthetic fault affects subsequent attempts; it does not erase
failure history or itself schedule a replay.
