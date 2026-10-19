# Reading processing and recovery logs

The API and each worker write structured JSON. `http_completed` includes a route
template, method, status, and request ID. Query strings, unmatched paths, headers,
cookies, signatures, credentials, payloads, and replay reasons are excluded.
`request_failed` and `processing_transaction_failed` keep a safe error name and
SQLSTATE where available. Verification reports apply the same error policy.

Domain records correlate trusted source, inbox, sender event, attempt, replay,
worker, and cycle identities where relevant. `attempt_claimed` precedes handler
work. `processing_finished` includes the resulting state, machine reason, and retry
deadline. The state record also carries a fixed counter snapshot.

| Counter | Meaning |
| --- | --- |
| `accepted` | A new inbox identity committed |
| `duplicate` | Identical bytes returned the existing acceptance receipt |
| `conflicting` | An existing event identity was reused with different bytes |
| `processed` | An observed processing transaction committed an applied/no-op outcome |
| `retry_scheduled` | An observed failed attempt committed a retry deadline |
| `ignored_stale` | An observed older snapshot committed a stale decision |
| `dead_lettered` | An observed attempt or exhausted lease budget became terminal |
| `lost_lease` | A handler returned without committing because ownership was lost |
| `replay_requested` | A new replay audit and processing cycle committed |
| `replay_duplicate` | An existing replay key returned its earlier audit record |

Counter keys are fixed. Event IDs are correlation fields in logs, never counter
labels. Each record carries the PID and process start time. Totals are local to
that process, saturate at the maximum safe integer, and reset after restart. A
delivery duplicate does not count as another processing attempt.

These counters describe observations, not a durable audit. A worker killed after
commit can leave a committed outcome without its next log record. Read inbox,
attempt, processing receipt, replay audit, and completion records for durable
evidence. Database failures roll back business changes; a log cannot replace that
transaction boundary. Direct integration calls may bypass worker observation.

Run `pnpm verify` for real HTTP/PostgreSQL checks, including synthetic markers in
query strings, headers, login bodies, and failure messages. The tests also verify
that safe SQLSTATE information remains useful. Run-owned process logs are capped
at 1 MiB; reports retain bounded tails and rotate to five reports within 100 MiB.
See [setup and cleanup](setup.md) and [crash evidence](scenarios.md).
