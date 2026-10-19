# Crash recovery scenarios

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
