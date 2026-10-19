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
