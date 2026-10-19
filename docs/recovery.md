# Investigating and recovering an event

Start the local stack with `pnpm dev`. Acceptance and processing are separate.
A sender's 202 receipt proves durable intake. Inspect its `id`, the inbox ID, to
learn the processing outcome. The payload's `eventId` identifies sender delivery
deduplication and is a different ID.

Use the operator or viewer credential from `.local/runs/dev/app.env` locally.
Keep it out of URLs, screenshots, source files, and shared output. Viewer sessions
can inspect the permitted source. Only an operator can request replay.

| Processing state | Next action |
| --- | --- |
| `received` or `processing` | Let the worker finish or recover its lease. Replay is unavailable. |
| `retry_scheduled` | Inspect `nextAttemptAt` and the last attempt. Wait for its persisted deadline. |
| `processed` | Inspect the processing receipt, projection, and completion entry. |
| `ignored_stale` | Compare versions. The accepted snapshot was older than the projection. |
| `dead_lettered` | Inspect the reason and retained attempts. Repair the cause before replay. |

`retry_budget_exhausted` means the processing cycle consumed its bounded claims.
The last attempt's `failureCode` retains the handler cause. Abandoned attempts
record lost leases rather than a fabricated successful or failed handler commit.
`equal_version_conflict` means two snapshots disagree at one aggregate version.
Accepted bytes cannot be repaired in place. A sender must issue a valid newer
snapshot; replaying an older event can then legitimately finish as stale.

In demo mode, use the [authenticated simulator controls](scenarios.md) to send a
permanent-failure sample, redeliver it, and repair its synthetic cause. A repair
affects subsequent attempts and does not erase history or automatically replay.

For an existing terminal event, this PowerShell example reads the private local
configuration without printing its credentials:

```powershell
$labSettings = Get-Content .local/runs/dev/app.env -Raw | ConvertFrom-StringData
$recoveryOrigin = "http://127.0.0.1:$($labSettings.API_PORT)"
$recoveryHeaders = @{
  Authorization = "Bearer $($labSettings.OPERATOR_TOKEN)"
  Origin = $recoveryOrigin
}
Invoke-RestMethod "$recoveryOrigin/api/events?state=dead_lettered&limit=20" -Headers $recoveryHeaders
```

Inspect `/api/events/<inbox-id>` for chronological attempts, failure codes,
processing receipt, current projection, completion entry, and replay audit.
The detail view includes the latest 50 attempts/replays. Use `/attempts` or
`/replays` with bounded `limit` and `offset` for older history.

Choose one UUID idempotency key for the intended replay. Keep the same key and
reason when retrying an uncertain HTTP response:

```powershell
$recoveryInboxId = "<inbox-id>"
$recoveryRequest = @{
  idempotencyKey = [guid]::NewGuid().ToString()
  reason = "Repaired the synthetic cause after inspecting the failed attempts"
} | ConvertTo-Json
Invoke-RestMethod "$recoveryOrigin/api/events/$recoveryInboxId/replay" `
  -Method Post -Headers $recoveryHeaders -ContentType application/json -Body $recoveryRequest
```

A 202 replay receipt records a new cycle, not completed business processing.
Its audit and processing intent commit together. Repeating that key returns the
original receipt, even after completion. Changed content or a fresh key against
active/successful/stale work returns 409. Missing permission or a mismatched
Origin creates neither an audit success nor new processing work.

Use `pnpm db:seed` to renew expired configured demo sessions. It requires explicit
demo mode and retains the inbox, ledger, and attempt history. `pnpm dev:down`
stops development services and preserves their database. `pnpm verify` instead
creates disposable resources and removes them after its recovery checks.
