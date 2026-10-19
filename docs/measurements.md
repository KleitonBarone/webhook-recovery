# Finite local workload

Run `pnpm measure` after the [documented setup](setup.md). It provisions a fresh
disposable PostgreSQL/API/worker stack through the same owned lifecycle as
verification, then tears it down. It does not use the retained developer database.
The raw result is `.local/reports/<run-id>.json`, subject to the five-report limit.
Copy selected evidence before the next run can rotate it.

The fixed workload uses ten sequential warm-up events, waits for their processing,
and excludes warm-up and startup from timing. It then sends 500 distinct completed
refund snapshots followed by 100 identical redeliveries at eight concurrent client
requests. One worker processes them with normal 30-second leases, three attempts
per cycle, and a one-second base retry delay. No faults are injected. PostgreSQL
has a one-CPU, 512-MiB limit. API and worker processes use the host runtime.

Every fixture derives from the reported run seed. The report includes a SHA-256
hash of the ordered fixture bodies, settings, source SHA, clean/dirty state, CPU,
memory, OS, runtime, Docker, Compose, and PostgreSQL versions. Per-delivery rows
retain fixture index, monotonic start/duration, HTTP status, validated acceptance
receipt, and failure classification. Credentials and signatures are excluded.

`receiptLatencyMs` measures client dispatch through a parsed, validated 202
receipt, including signing and HTTP overhead. The acceptance window covers all
600 requests, including duplicate deliveries. Failures/timeouts remain in raw
accounting; successful-response latency percentiles use nearest rank. A request
has a 15-second timeout.

`processingObservedElapsedMs` starts at the first measured dispatch and ends when
a database query observes all 500 events processed. `drainAfterLastResponseMs`
starts after the final acceptance response. This is an upper-bound observation
with 100-ms polling and query overhead, not a per-handler commit latency. Drain
has a 60-second deadline. No wall-clock subtraction measures these durations.

After timing, separate correctness checks require stable duplicate receipts,
unchanged accepted bytes/hashes, 500 processed inbox rows, one successful attempt
and processing receipt per event, 500 completed version-one projections, and
exactly one completion per refund. A failed invariant fails the command and makes
the workload invalid for a successful-run claim.

This finite loopback workload describes this machine, runtime, logging, and
Windows-to-WSL Docker path. It does not establish production capacity, availability,
network latency, steady-state saturation throughput, or an SLO. Correctness and
crash experiments run separately with `pnpm verify`.
