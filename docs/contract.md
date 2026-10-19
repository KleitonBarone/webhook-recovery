# Local sender contract

`POST /webhooks/demo` and `/webhooks/other` accept UTF-8 JSON up to 65,536 bytes.
Only `application/json` with identity encoding is supported. Configure each source
on the server; a payload cannot choose its trusted source or operator permissions.

```json
{
  "schemaVersion": 1,
  "type": "refund.status_changed",
  "eventId": "f61bc54b-a577-44fa-8438-2400eed31ed0",
  "refundId": "refund_1",
  "version": 1,
  "status": "completed"
}
```

Refund IDs contain 1–64 ASCII letters, digits, underscores or hyphens. Versions
are positive 32-bit integers. Status is pending, completed, or failed. These are
full synthetic snapshots. Higher versions replace lower snapshots, including a
status change after completion; the immutable completion ledger still records at
most one completion action for that source/refund. Equal versions with identical
business content are no-ops; contradictory equal versions are terminal conflicts.

`X-Recovery-Signature` is `t=<unix-seconds>,v1=<lowercase-hex-HMAC-SHA256>`.
HMAC input is the ASCII timestamp, a period, then the original request bytes.
The server permits at most 300 seconds of past or future skew. A sender retry
re-signs the same bytes with a fresh timestamp. Reserializing JSON changes bytes.

A successful response is 202 with a stable `{id,eventId,acceptedAt}` receipt.
It means acceptance committed to PostgreSQL. The same source/event identity and
bytes return that receipt, even after processing or an API restart. Different
bytes under that identity return 409. Signature/payload failures create no work.
Processing status belongs to authenticated inspection, not the acceptance receipt.

This simulator's monotonic versions are a custom contract. They do not describe
ordering guarantees from an arbitrary real payment provider.

## Operator inspection

Sender signing credentials grant no operator access. Seeded operator and viewer
tokens are separate, expire after 24 hours, and are restricted to one source.
`POST /api/session` accepts `{token}` and sets an HttpOnly, SameSite=Strict cookie
scoped to `/api`. Login and logout require an Origin matching the local request
host. Cookies use HTTP only for this loopback lab. Inspection also accepts
`Authorization: Bearer <operator-token>` for local CLI use. No token belongs in a URL.

`GET /api/session` returns role and source. `DELETE /api/session` clears the cookie.
`GET /api/events` returns items with immutable identity, acceptance time, snapshot,
and current processing state. Optional `state`, `limit` from 1 to 100, and `offset`
from 0 to 10,000 bound each query. The server applies the session's source; callers
cannot supply another source. `nextOffset` is null at the page limit/end.

`GET /api/events/:id` returns the accepted event and original bytes as UTF-8 text.
`GET /api/events/:id/receipt` returns its stable acceptance receipt. A permitted
viewer can inspect; another source sees 404. Missing, expired, or disabled-source
sessions receive 401. Event detail includes processing attempts and replay history;
the bounded `/attempts` and `/replays` endpoints provide older entries. See the
[recovery protocol](processing.md#manual-replay).
