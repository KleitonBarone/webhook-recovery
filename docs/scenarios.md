# Finite recovery scenarios

Run `pnpm scenarios` or `pnpm verify`. Both commands execute the same finite suite
in a new disposable stack and exit nonzero on assertion or cleanup failure. They
do not reuse the retained development database. CI runs `pnpm verify`.

The suite covers signed intake and invalid inputs, concurrent identical/conflicting
deliveries, source permissions, version ordering, completion deduplication,
transaction rollback, retry schedules and budgets, audited replay races, process
restarts, and the crash experiments below. It finishes with the authenticated demo
flow through real signed HTTP intake, repair, and replay.

The last output line is a JSON summary. The bounded report in
`.local/reports/<run-id>.json` adds diagnostic logs, the Git revision and dirty flag,
Node/pnpm, OS/CPU/memory, Docker/Compose and PostgreSQL versions, explicit test
settings, and selected event/attempt/effect evidence. Reports retain the latest
five runs within 100 MiB. Copy selected evidence to a documented deliverable before
rotation. These are correctness results; no throughput or latency benchmark is
implied.

## Actual worker termination

`pnpm verify` runs the crash experiments against its disposable PostgreSQL stack.
Each experiment sends a signed event through HTTP and starts registered worker
processes with a 2-second test lease. The ordinary worker lease remains 30 seconds.
The harness observes a structured barrier, verifies the exact PID and run marker,
and terminates only its own worker. It never kills unrelated services.

The experiments establish these database-local invariants:

- Before commit, the paused transaction has applied handler writes but has not
  reached the final lease fence. Another connection sees no projection, processing
  receipt, or completion entry. Actual process termination rolls that transaction
  back. A replacement reclaims the naturally expired lease, retains the abandoned
  attempt, and commits one receipt and completion.
- After commit, the worker pauses before continuing its loop. The event is already
  processed with one committed effect. Terminating it and starting a replacement
  creates no second attempt or effect. A separate probe event proves that the
  replacement is processing work.
- An old owner pauses after claiming, outside a business transaction. Another
  worker takes over after natural expiry and commits. Resuming the original process
  returns `lost_lease`; its stale attempt cannot change the winner's state or effects.

Pauses require explicit demo mode and a private parent-child IPC channel. They
accept only the configured inbox UUID and one known boundary, and time out after
8 seconds. No fixed sleep chooses when to kill a process. The before-commit pause
precedes the final token/deadline check; it cannot bypass write fencing.

The bounded JSON report records acceptance receipts, observed barrier PIDs and
attempt IDs, test leases, and before/after inbox, attempt, projection, receipt, and
completion evidence. `actual_process_termination` differs from the paused-owner
takeover and from earlier metadata/exception-injection tests. A thrown exception
alone does not count as a process crash.

Worker logs remain capped at 1 MiB per process. Reports retain bounded tails from
the normal and experiment workers. The shared `finally` cleanup removes every
registered child, disposable container, network, volume, and private environment
file after success or failure. Interrupted coordinators retain a manifest for
`pnpm cleanup --run <run-id>`.

These experiments prove local PostgreSQL transaction and lease behavior. They do
not establish exactly-once network delivery or exactly-once external side effects.

## Local simulator controls

These operator-only mutations require a matching local Origin and are registered
only when `DEMO_MODE=true`:

- `POST /api/demo/fixtures` accepts `{ "scenario": "success" }`, `transient`, or
  `permanent`. It creates a synthetic completed refund snapshot and signs an actual
  HTTP request to this API's own loopback webhook listener. Source credentials stay
  on the server. Transient faults fail the first attempt; permanent faults require
  repair.
- `POST /api/demo/events/:id/redeliver` sends the original accepted bytes with a
  fresh signature timestamp. It returns the same acceptance receipt and does not
  create a new processing cycle.
- `POST /api/demo/events/:id/repair` clears the trusted source/refund's synthetic
  fault. The accepted event, earlier attempts, and terminal state stay intact. An
  operator must separately replay the terminal failure with a reason.

Viewer and cross-source actions are denied. Callers cannot supply a different
source, signing credential, or replacement payload. Outside demo mode these routes
return 404, even with a valid operator session. The console uses the same operations
when it is added.

## Reset and cleanup

`pnpm demo:reset -- --run <run-id>` recovers an interrupted disposable demo by
tearing down that exact environment, including its synthetic state and private
files. It validates the manifest, demo mode, Docker labels, and process markers.
It refuses `dev`; it cannot erase retained development history. A following
`pnpm scenarios` provisions a fresh environment with a new run ID. Repeating reset
or cleanup for an already removed disposable run is safe.

`pnpm verify:cleanup` also injects failure while a worker is paused before commit,
then verifies teardown. It checks two successful runs, startup/test failures,
interruption, abrupt coordinator termination, disposable reset, and cleanup twice.
Before/after process, container, volume, and network inventories must match.
