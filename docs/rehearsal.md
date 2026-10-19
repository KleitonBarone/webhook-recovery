# Fresh-checkout rehearsal

On 2026-10-19, a new clone of merged `main` at
`bebc97eed1730ef01320058b8c38614b6186e691` was installed and exercised in
`%TEMP%/webhook-recovery-rehearsal-bebc97e`. It used Windows Node 24.20.0,
pnpm 11.23.0, and PostgreSQL 18.6 Alpine through WSL Ubuntu Docker.
The final documentation PR changes no application, dependency, migration,
test, or lifecycle code, so this evidence applies to that implementation.

The documented commands all returned exit code zero:

```powershell
pnpm install --frozen-lockfile
pnpm browser:install
pnpm env:check
pnpm check
pnpm verify
pnpm verify:cleanup --browser-only
pnpm env:status
```

`check` passed formatting, both TypeScript projects, 12 focused tests, and the
API/console production builds. `verify` passed all 15 groups against an empty
migrated database, including idempotent seeding, signed intake, retries, replay,
permissions, real process termination, and the Chromium recovery journey.
Its [raw report](evidence/fresh-checkout-verification.json) records `dirty: false`
and `cleaned: true`, source revision, environment, crash snapshots, and UI results.

The cleanup exercise passed a normal verification, injected failure while the
browser was open, abrupt coordinator termination, disposable demo reset, and two
successive cleanup calls. It compared process and Docker inventories internally.
The independent [before/after inventory and command results](evidence/fresh-checkout-rehearsal.json)
also show zero owned processes, containers, or volumes and the same 41 pre-existing
Docker network IDs. The reused PostgreSQL image was the only image at that point.

Normal disposable shutdown was exercised by `verify`. The retained developer
database was never created for this rehearsal. The documented `dev:down`
preserves developer data; this evidence does not claim that retained data was
created and deleted during rehearsal. The broader infrastructure failure and
interruption exercise had already passed during lifecycle development.

The temporary clone's source, Git objects, dependencies, and scratch files were
removed after its evidence was preserved. Windows still held the empty top-level
directory open at cleanup time; it contains zero files and no retained data.
Raw command logs and the selected report are kept with the videos at
`C:/Users/admin/Videos/webhook-recovery/2026-10-19-bebc97e`.
PowerShell can render pnpm's normal script announcement on stderr as a
`NativeCommandError` record. The captured native exit code, assertions, and
resulting report determine the outcome.

For routine use, follow [setup](setup.md). Scratch reports retain at most five
JSON/screenshot pairs within 100 MiB. Selected published evidence is retained
explicitly outside that rotating scratch area. No global Docker prune, WSL
shutdown, shared cache deletion, or user-browser shutdown is part of cleanup.

The [post-recording cleanup record](evidence/cleanup.json) includes the final
resource inventory, removed image/cache, intentionally retained disk usage, and
that empty-directory limitation.
