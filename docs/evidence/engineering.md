# Engineering recovery walkthrough

Recorded from bebc97eed1730ef01320058b8c38614b6186e691. English captions are burned into the live console recording. No voice impersonation or production traffic.

- 00:00:00,448 The architecture is one API, one worker, and PostgreSQL. Signed HTTP acceptance commits first; asynchronous processing has its own durable history.
- 00:00:18,465 Identity is source plus event ID. HMAC covers the exact timestamp and request bytes. Changed bytes under an existing identity are rejected rather than replacing history.
- 00:00:36,474 A transaction combines the refund projection, processing receipt, completion ledger, attempt outcome, and inbox outcome. The guarantee covers these database-local effects.
- 00:00:52,867 Now the normal worker is stopped. Owned test workers will be killed at real commit boundaries. These demonstrations use two-second leases; normal leases are thirty seconds.
- 00:01:02,347 Before commit: no projection, processing receipt, or completion has committed. Killing the actual worker PID 7324 now.
- 00:01:05,706 After commit: the processing receipt and one completion already exist. Killing the actual worker PID 24632 now.
- 00:01:11,428 Before-commit termination rolled back all local effects. After lease expiry, recovery recorded an abandoned attempt and a successful second attempt, with one completion.
- 00:01:38,630 After-commit termination preserved the completed transaction. A replacement worker processed a fresh probe, while this original event kept one attempt and one completion.
- 00:02:02,831 The old owner paused after claiming. A replacement acquired the expired lease and committed. Resuming the old owner produced lost_lease and changed no committed outcome.
- 00:02:24,920 The proof includes actual worker PIDs, barrier observations, database snapshots, and process logs. Run pnpm verify to repeat it; disposable services and secrets are removed afterward.
- 00:02:39,936 Scope: synthetic events and one local database. External payments or network calls need their own idempotency protocol. This finite lab retains deduplication identities without expiry.
