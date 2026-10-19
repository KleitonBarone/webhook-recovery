# Finite local workload

## Recorded result

On 19 October 2026, run `4e1f366bd5eb811a` measured committed source
[`f1076b7`](https://github.com/KleitonBarone/webhook-recovery/commit/f1076b70eee830feeacbd07d61d38d3204d34a45)
with a clean worktree. [The complete raw report](evidence/local-workload-2026-10-19.json)
includes all 600 delivery rows, environment, fixture hash, and cleanup result.

| Observation | Result |
| --- | ---: |
| Validated 202 receipts | 600 of 600 |
| Request failures / timeouts | 0 / 0 |
| Receipt latency, median / p95 / p99 | 11.95 / 19.12 / 32.38 ms |
| Receipt latency, minimum / maximum | 6.71 / 61.01 ms |
| Acceptance response window | 971.26 ms |
| Validated responses in that window | 617.76 per second |
| All processing observed complete from first dispatch | 8,907.37 ms |
| Observed drain after final response | 7,936.11 ms |
| Unique events per observed completion window | 56.13 per second |
| Inbox / attempts / processing receipts / projections / completions | 500 each |

All eight correctness invariants passed, and owned resources were removed. The
600 responses include 100 duplicates; they are not 600 new business actions. This
is one modest run, not a repeated saturation or capacity experiment.

The host was an AMD Ryzen 7 5700X3D with 16 logical CPUs and 34,282,184,704 bytes
of RAM, running Windows x64 kernel 10.0.26200. API, worker, and client used Node
24.20.0 and pnpm 11.23.0 on Windows. PostgreSQL 18.6 Alpine ran through WSL Ubuntu 24.04.5 LTS,
Docker 29.8.0, and Compose 5.5.1, with the limits described below. Structured logging
was enabled. Other host workloads were not controlled, and these results do not
isolate CPU, database, virtualization, or logging cost.

To reproduce the measured implementation, check out the linked source revision,
follow setup, and run `pnpm measure`. Each run gets a new seed and owned environment.
The recorded seed and committed generator identify its exact fixture bodies.
Request and fixture counts are fixed in the runner. Results on another machine will differ.

## Protocol

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
