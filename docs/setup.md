# Local setup and verification

Use Node 24.20.0 and pnpm 11.23.0. On Windows, Docker Engine and Compose run in
WSL Ubuntu. Node processes and dependencies stay on Windows. On Linux, the same
commands call Docker directly. PostgreSQL is pinned to 18.6 Alpine.

On Windows the runner owns a foreground WSL session until Docker teardown finishes.
Its open input pipe keeps Ubuntu alive during Windows-side tests; coordinator exit
closes the pipe. The manifest records its PID and exact run marker for recovery.
This needs no WSL settings changes. Microsoft explains that
[systemd services alone do not keep WSL alive](https://learn.microsoft.com/en-us/windows/wsl/systemd).

```powershell
pnpm install --frozen-lockfile
pnpm browser:install
pnpm env:check
pnpm check
pnpm verify
```

`verify` allocates its own loopback database/API/console ports, a small nonoverlapping
Docker subnet, and a unique Compose project. It migrates an empty database, seeds
twice, starts the real API/worker and Vite console, checks readiness, and exercises implemented
integration scenarios. Its `finally` path removes owned processes, containers,
networks, disposable volumes, and private credential files. It exits nonzero if
verification or cleanup fails. CI uses the same commands and Compose definition.

Reports are in `.local/reports/<run-id>.json`. Keep at most five reports and 100 MiB
of scratch output. Per-process logs rotate across two 512-KiB segments within a
1-MiB budget, retaining recent output; container logs rotate at
10 MiB with two files. Reports retain bounded failure output. Selected engineering
evidence is copied to documented deliverables before scratch report rotation.

The browser install uses one project cache at
`%LOCALAPPDATA%/webhook-recovery-browser-cache` on Windows or
`~/.cache/webhook-recovery-browser-cache` on Linux. `PLAYWRIGHT_BROWSERS_PATH` can
select a different explicit cache. Linux hosts may need
`pnpm browser:install --with-deps`, which CI also uses. No second WSL Node install
or signed-in user browser is used. Reuse this cache during development; remove it
only when it was created for the task and is no longer needed.

Verification includes one real Chromium recovery journey. It exhausts retries,
inspects failure, repairs, replays with a reason, and checks immutable acceptance,
retained history, one completion, viewer denial, and narrow navigation. The
manifest records the browser root PID, exact command marker, and temporary profile.
Normal closure and interrupted-run cleanup remove that owned profile. Failure
screenshots exclude credential entry and stay beside the bounded JSON reports.

For an interactive local developer environment:

```powershell
pnpm dev
```

This creates the retained `webhook-recovery` Compose project and
`webhook_recovery_dev` database. Open the console at http://127.0.0.1:4330.
The API uses 4331 and PostgreSQL uses 55433.
Generated source/operator credentials are in `.local/runs/dev/app.env`, restricted
to the current Windows user or mode 0600 on Linux. Never commit or copy them into
the browser bundle. Sign in with `OPERATOR_TOKEN` or `VIEWER_TOKEN`. The console
uses an HttpOnly session cookie and keeps no credential in browser storage.
Operators can send successful, temporary-failure, permanent-failure, or exhausted-retry
samples from the inbox. Select a failed event, repair its demo cause, enter a replay
reason, and request replay. The detail view preserves earlier attempts and shows
the completion count. Redelivering the original returns its original acceptance
receipt. Viewer sessions can inspect events but cannot invoke these controls.

In a second shell, `pnpm sender -- success` sends one local signed event and
`pnpm sender -- duplicate` concurrently sends the same bytes five times. Both
print acceptance receipts. The worker applies refund snapshots asynchronously;
inspect processing separately through the authenticated API. See
[the contract](contract.md) and [processing](processing.md). Keep generated
credentials out of URLs and shared output.

Ctrl+C stops development services and preserves the database. From another shell,
`pnpm dev:down` performs the same shutdown. `pnpm db:up`, `pnpm db:down`,
`pnpm db:migrate`, and `pnpm db:seed` manage the retained development environment.
Starting development or explicitly running `db:seed` renews the configured demo
sessions for 24 hours. An expired session stays denied until that seed action.
Seeding atomically reconciles the configured signing secrets, credential roles,
and source bindings. Other sessions for the two demo sources expire immediately,
including retired credentials. After editing credentials in the retained
`app.env`, run `pnpm db:seed` and sign in with the updated credential.
Source, operator, and viewer credentials must be distinct. Operator and viewer
credentials must contain 24 to 256 characters, matching the login API. Generated worker
settings live in the private `app.env`, so unrelated shell settings cannot change
an isolated run. Adjust retained development settings there when needed.
On Windows, `db:up` also stays in the foreground to hold its WSL session; keep that
terminal open until finished. Ctrl+C stops PostgreSQL and preserves its volume.
Existing ports and unrelated Docker resources are never stopped or removed.

```powershell
pnpm env:status
pnpm cleanup --run <run-id>
```

An abrupt OS/process termination can skip `finally`. The manifest in
`.local/runs/<run-id>/manifest.json` records owned processes, container/volume IDs,
and the exact project. `cleanup` reconciles the manifest with Docker ownership
labels and process command markers, tears down only that disposable run, and can
be repeated. It refuses the retained `dev` environment. Never use global Docker
pruning or WSL shutdown to recover a test run. Pre-existing networks are preserved,
even if their address pools prevent automatic subnet allocation.
`env:status` also reports registered process ownership, API/console ports, and
scratch bytes so leftover runs are visible before another verification starts.
The manifest records Compose intent before provisioning. A failure or interruption
before that intent is written can be cleaned without Docker or credential files.
Lifecycle management is in `scripts/lifecycle.ts`; `scripts/lab.ts` dispatches
commands and scenarios, and `scripts/bounded-log.ts` handles log retention.

The pinned PostgreSQL image and one pnpm dependency tree are reused during work.
No custom image builds or builders are required. Temporary containers and volumes
are removed after each verification. Record image/disk usage when the development
task ends and remove a task-pulled image only when no retained service needs it.

`pnpm verify:cleanup` performs the infrastructure lifecycle acceptance exercise:
two successful runs, startup/test failures, a handled interruption, and failure
while an experiment worker is paused before commit, and failure with Chromium open.
It also kills a coordinator while its browser is registered,
resets that disposable demo, and runs cleanup twice. It asserts the before/after
Node/WSL/browser process, container, volume, and network inventories match. Run it when
changing lifecycle behavior; normal CI runs isolated verification once. See the
[finite scenario guide](scenarios.md) for the demo controls and reset boundary.
`pnpm verify:cleanup --browser-only` focuses on browser success, failure, and abrupt
coordinator recovery when the other infrastructure paths were already verified.

`pnpm measure` runs the [finite workload](measurements.md) in its own disposable
stack. Its raw rows remain under the same report retention policy. Archive selected
evidence before later runs can rotate it; measurements never use the developer DB.
