# Webhook recovery implementation plan

## Current state and planning scope

At the initial inspection on 2026-10-19, local and remote `main` pointed to
`6631fa1` and contained planning documents only. The five milestones below are
now implemented and verified. [DELIVERY.md](DELIVERY.md) records actual PRs,
commits, checks, merge records, and evidence. The original sequence and acceptance
gates remain here as the delivery design. GitHub permitted merge commits with
no branch protections or rulesets at the initial inspection.

The planning sessions prepared this sequence without creating commits or PRs.
Kleiton authorized complete execution, including pushes and actual PR merges, on
2026-10-19. Completion includes the local console, engineering evidence, cleanup,
and every planned PR merged into `main`. Public hosting is outside this scope.

Read the product requirements first, then follow the delivery sequence and the
per-PR Git workflow. `PR 0` through `PR 9` are planning labels, not assigned GitHub
PR numbers. Record actual URLs and commits in the delivery ledger during execution.

## Purpose and audience

Build an incoming webhook inbox with asynchronous processing and an investigation
console. The service must explain what it accepted, which attempts ran, why an
event failed, and what happened when an operator replayed it.

This is the portfolio project aimed primarily at engineers. Its evidence should
come from reproducible failures and the database state after recovery. A small
console makes the same story understandable in a short recorded walkthrough.

All senders, payloads, credentials, and effects are synthetic. Work happens in a
project-owned local environment. No live provider, customer, public endpoint, or
real financial effect is required.

## Distinction from webhook-redrive

The existing [Webhook Redrive](https://github.com/KleitonBarone/webhook-redrive)
service accepts producer events and delivers outbound signed requests. Its Go and
TypeScript receiver examples verify signatures and atomically deduplicate a local
business action. They demonstrate how a consumer integrates with the sender.

This repository owns the receiving application's durable inbox, asynchronous
business processing, processing failures, stale-event handling, and recovery UI.
Do not rebuild an outbound destination registry, sender rate limits, or its
delivery retry engine here. Redrive is an optional future event source.

## Smallest complete product

Start with a single custom, documented event contract and a local simulator. Use
`refund.status_changed` events containing an event ID, a refund ID, a monotonic
aggregate version, and a full synthetic status snapshot. The simulator supplies
the version contract; arbitrary payment providers may not offer it.

Verify an exact-body HMAC signature with a bounded timestamp tolerance before
accepting an event. Resolve the trusted source from configured credentials and
route configuration, not a caller-supplied tenant or operator field.

An acceptance response means the event is durably recorded, not that business
processing finished. A repeated source/event ID with identical bytes returns the
existing acceptance receipt. Changed bytes under the same identity are a conflict.
Keep processing status behind its own inspection endpoint.

The inbox uses `received`, `processing`, `retry_scheduled`, `processed`,
`ignored_stale`, and `dead_lettered`. Preserve attempt history and explicit reasons.
An invalid signature or payload never creates a processable inbox event.

The sample handler updates a local refund projection. Older snapshot versions must
not overwrite newer state; matching versions with contradictory content are
conflicts. Completing a refund also creates a synthetic completion ledger entry
unique to source/refund/action, so two distinct event IDs cannot repeat that effect.
These are database-local demonstrations, not instructions to send actual refunds.

## Starting architecture

- Use pnpm, strict TypeScript, Fastify, PostgreSQL, and Drizzle for typed queries
  and committed schema migrations.
- Use React/Vite, Tailwind, and TanStack Query for the small investigation console.
- Validate unknown input at boundaries with ArkType; retain inferred types and
  avoid `any` and casting wrappers.
- Keep one codebase with an API process and a worker. PostgreSQL is both the inbox
  and processing scheduler. Start without a message broker or orchestration engine.
- Claim bounded work with database locks and durable leases. Fence attempt
  completion so a stale worker cannot overwrite a newer claimant.
- Commit the local business change, completion receipt, and processing outcome in
  one database transaction. Do not hold a transaction across arbitrary external IO.
- Separate operator authentication from sender verification. The local console may
  use seeded operator sessions; controls and inspection still require permission.

Add configured sources, inbox events, processing attempts, worker leases, replay
requests, operator sessions, audit entries, refund projections, and completion
entries when their milestones need them.

Reserve UI port 4330, API port 4331, and database port 55433. Start with a CLI
sender; port 4332 is reserved only if a later local sender needs a listener.
These are planned local defaults to verify during setup. Use distinct database
names and storage from the two business apps and from webhook-redrive.

## Local scenarios

Provide deterministic fixtures and a controllable clock for:

- A valid event processed successfully.
- The same event delivered repeatedly and concurrently.
- An event identity reused with different signed bytes.
- A newer full snapshot followed by an older version.
- Two distinct events that describe the same business completion.
- A temporary handler failure that recovers within its retry budget.
- A permanent failure that requires inspection and manual replay after repair.
- A worker stopping before its transaction commits.
- A worker stopping after its local business transaction commits.
- A malformed signature, stale signature timestamp, or unauthorized operator.

Simulator controls are available only in an explicit local demo environment.
Fault injection must identify whether it is an exception at a code boundary or
an actual process termination. Record those as different forms of evidence.

A replay creates a new audited processing attempt linked to the immutable event.
It does not rewrite the payload, reset the business identity, or erase failure
history. Repeating the same replay request must not schedule duplicate work.

Reset can replace only this project's explicitly identified disposable database
and local simulator state. Never use broad process kills, shared database cleanup,
or arbitrary filesystem deletion to reset a scenario.

## Milestones

### 1. Durable intake

- [x] Scaffold API/database and initial migrations with a local signed sender.
- [x] Verify exact bytes, source identity, bounded body size, and timestamp tolerance.
- [x] Persist an immutable event and initial processing intent before returning 202.
- [x] Add scoped identity deduplication and conflict responses under concurrent intake.
- [x] Add authenticated event inspection and verified setup/seed/check commands.
- [x] Provide an isolated verification environment with readiness checks, owned
  resource tracking, automatic teardown, and an interruption cleanup command.

Done when identical retries return the same durable event after an API restart,
conflicting bodies create no second event, and invalid signatures create no work.

### 2. Business processing

- [x] Add a worker with bounded, lease-protected claims.
- [x] Implement the versioned synthetic refund projection handler.
- [x] Atomically commit processing receipt, local effect, and successful outcome.
- [x] Add stale-version handling and business-level completion deduplication.
- [x] Preserve history for processed, stale, and conflicting events.

Done when concurrent duplicate events and distinct completion events preserve one
completion effect, and an older snapshot cannot roll back a newer projection.

### 3. Failure and recovery

- [x] Classify transient and terminal handler failures and bound retries.
- [x] Persist retry timing with the failed attempt outcome using deterministic
  clock/jitter controls in tests.
- [x] Reclaim expired work safely and fence stale-worker completions.
- [x] Add authenticated, audited, idempotent manual replay.
- [x] Demonstrate recovery across actual worker termination on a fresh local stack.

Done when crashes before and after commit preserve correct local effects, retries
survive restart, and replay keeps earlier failure history intact. Do not claim
exactly-once network delivery or arbitrary external side effects.

### 4. Investigation console and focused verification

- [x] Build an event list with bounded filtering and an event/attempt detail view.
- [x] Show acceptance, processing status, failure reason, and the next action.
- [x] Add local simulator controls and a permitted replay action with a reason.
- [x] Add structured logs and bounded counters for accepted, duplicate, processed,
  retried, stale, and dead-lettered events. Redact credentials and payloads by default.
- [x] Verify operator permissions, raw-body signing, concurrent intake, claim
  fencing, receipt/effect atomicity, ordering policy, and replay behavior.

Use real PostgreSQL tests for transaction races and crash boundaries, plus small
pure tests for classification and signature vectors. Add one browser journey
showing failure investigation and recovery; avoid exhaustive UI snapshots.

### 5. Reproducible engineering evidence

- [x] Add a finite scenario runner with machine-readable correctness results.
- [x] Rehearse a clean checkout and document all working local commands.
- [x] Prove repeated verification and cleanup leave no temporary services,
  databases, volumes, or accumulating scratch artifacts behind.
- [x] Record an English walkthrough showing failure, duplicate suppression, and replay.
- [x] Write a case study explaining acceptance versus processing, transaction
  boundaries, stale-event policy, and known limits.
- [x] Publish a modest measured workload with revision, hardware, environment,
  fixture count, concurrency, timing validity, and raw results.

Keep latency measurements separate from correctness assertions. A finite local
workload does not establish production throughput, availability, or service SLOs.
The local application and evidence complete this plan; hosting is optional future work.

## Delivery sequence

Use one active implementation branch at a time. Start each branch from updated
`main` after the previous PR has actually merged. This avoids a stack of dependent
unmerged branches and keeps the investigation console on the same delivery path
as the API and worker. A single agent can execute this plan sequentially.

The baseline is ten PRs containing 22 focused work commits, plus ten GitHub merge
commits. Review fixes and merges of newer `origin/main` may add commits. Commit
subjects and PR titles use the plain imperative style already in this repository.
Keep tests, migrations, lockfiles, and relevant documentation with their change.
Do not split implementation and its essential verification just to meet this count.

| Plan label | Branch | PR title | Work commits | Milestone |
| --- | --- | --- | --- | --- |
| PR 0 | `docs/project-delivery-plan` | Complete the project delivery plan | 1 | Planning |
| PR 1 | `chore/local-foundation` | Add a reproducible local development environment | 3 | 1 |
| PR 2 | `feat/durable-intake` | Accept signed events into a durable inbox | 3 | 1 |
| PR 3 | `feat/atomic-processing` | Process refund snapshots without repeating effects | 2 | 2 |
| PR 4 | `feat/retries-and-replay` | Recover failed processing with retries and replay | 3 | 3 |
| PR 5 | `test/crash-recovery` | Prove recovery across worker termination | 2 | 3 |
| PR 6 | `feat/investigation-console` | Investigate and replay events in the console | 2 | 4 |
| PR 7 | `feat/recovery-observability` | Make processing and recovery outcomes inspectable | 2 | 4 |
| PR 8 | `perf/local-evidence` | Measure the local lab and document its limits | 2 | 5 |
| PR 9 | `docs/project-completion` | Finish the walkthrough and project handoff | 2 | 5 |

### PR 0. Record the complete delivery plan

Commit `Complete the project delivery plan` contains this expanded plan and the
updated execution prompt in `THREAD_START.md`.

If these planning edits are still uncommitted on `main`, inspect them and create
`docs/project-delivery-plan` from that inspected HEAD while preserving the edits.
Commit only the intended documents, then fetch and merge `origin/main` before
pushing. Do not discard the edits or commit them directly to `main` just to
satisfy the later clean-worktree starting rule.

Review Markdown links, milestone coverage, planned commit counts, and the merge
instructions. Confirm that the README still accurately says planning only. Push
the documentation branch, open a draft PR, complete its documentation review, and
merge it using the workflow below. No application checks exist at this stage.

### PR 1. Establish the local foundation

1. `Set up the strict TypeScript workspace` creates the pnpm workspace, pinned
   supported Node/pnpm versions, strict compiler settings, lint/format checks,
   and minimal API and worker entry points. Check current package compatibility
   before pinning versions. Keep React dependencies for PR 6.
2. `Add the isolated PostgreSQL development environment` adds project-owned
   Compose configuration, Drizzle migrations and database access, validated
   environment configuration, health/readiness checks, and seed data for a local
   source and scoped viewer/operator sessions. Use separate development and test
   database names and credentials. Add the environment/cleanup lifecycle below,
   resource manifests, bounded container logs, and explicit resource limits.
   Validate ownership before migrations, reset, or teardown.
3. `Run reproducible checks in CI` adds the root command interface below, the
   isolated `pnpm verify` runner, focused configuration/database checks, and a
   GitHub Actions workflow using an isolated PostgreSQL service. Verify teardown
   on success, startup/test failure, and interruption. Run checks on draft PRs,
   ready PRs, and pushes to `main`; do not depend on a readiness-only trigger.

Use the Docker-through-WSL skill on this machine. Inspect the planned ports before
starting anything. Name the exact project-owned services and database before
touching them. An occupied port requires a project-specific override, never
stopping another application's process. Keep PostgreSQL on loopback. Reserve the
Compose project name `webhook-recovery` for explicitly retained development state;
verification uses a unique project per run and disposable storage.

Exit gate: a clean install starts the API and an idle worker, applies migrations,
seeds twice without duplicates, checks readiness, and stops only this project's
resources. Fresh database creation and upgrade from the preceding schema work.
CI performs install, lint, typecheck, focused tests, and build. Update setup docs,
and demonstrate two consecutive verification runs without leftover resources.
Push, review the draft, merge, and verify the merge on `main`.

### PR 2. Finish durable intake

1. `Define and verify the signed event contract` adds the versioned
   `refund.status_changed` schema, exact-byte HMAC verification, a documented
   signature header and signed timestamp format, fixed body/timestamp limits,
   and configured source lookup. Source identity comes from the server's route
   and credentials. Validate event IDs, refund IDs, versions, and status snapshots
   with ArkType. Add signature vectors and invalid input checks with this code.
2. `Persist acceptance receipts and deduplicate intake` adds immutable inbox data,
   original bytes and body hash, stable acceptance receipts, a unique
   source/event identity, and durable initial processing intent. Add the local
   signed sender and real PostgreSQL tests for concurrent duplicates and conflicts.
   A transaction commits before returning 202; a database failure cannot return
   acceptance. The same identity and bytes return the original receipt. Different
   bytes under that identity return 409 without replacing the accepted event.
3. `Expose scoped operator inspection` adds session authentication and bounded
   read endpoints for event lists, receipt/detail, and later attempt history.
   Enforce source permissions on every query. Test unauthorized and cross-source
   access. Intake credentials grant no operator access. Document the HTTP contract
   and a restart/retry exercise. Give receipt lookup the same authorization rules.

Do not include changing processing state in the immutable acceptance receipt.
Keep malformed signatures, expired/future timestamps outside tolerance, oversized
bodies, and invalid payloads out of the processable inbox. Check payload bytes
without reserializing JSON; document compression and content-type handling.

Exit gate: API restart preserves acceptance, repeated and concurrent delivery
produces one inbox row, changed bytes conflict, and invalid or unauthorized
requests create no processing work. Use two seeded sources to verify isolation.
Pass local and CI checks, push, review, merge, and verify on `main`. Milestone 1
is complete only after this merge.

### PR 3. Commit processing and local effects atomically

1. `Claim processing attempts with durable worker leases` adds attempt history,
   bounded database claims, lease expiry, claim tokens, stale-worker fencing, and
   graceful shutdown. Use short claim transactions and PostgreSQL row locking
   with `SKIP LOCKED`. Create the attempt and claim together. Reclaim expired work
   without deleting its abandoned attempt. Test two workers and an expired owner.
2. `Apply refund snapshots and completion receipts atomically` adds the versioned
   refund projection, explicit stale/equal-version decisions, and a unique
   source/refund/completion ledger entry. Commit the local effect, business
   receipt, attempt outcome, and inbox outcome in one transaction. Serialize
   competing updates for the same source/refund, including first-row creation.
   Verify lease ownership at the write boundary so an old claimant cannot commit.

An older snapshot becomes `ignored_stale`. An equal version with identical
business content is a documented no-op. Equal versions with contradictory content
become a terminal conflict with a reason. Different event IDs describing one
completion still create one completion entry. Scope versions and ledger identities
by source. State the permitted synthetic refund statuses and transitions in the
contract, including what a newer snapshot can change after completion.

Exit gate: real PostgreSQL races preserve the highest valid version and one
completion entry. A transaction failure rolls back effects and successful outcomes
together. A stale claimant cannot overwrite the winner. Preserve attempt history
for processed, stale, and conflicted events. Push, review, merge, and verify on
`main`. Milestone 2 is complete.

### PR 4. Add retries and audited replay

1. `Persist bounded retries and terminal failures` adds failure classification,
   per-cycle attempt budgets, bounded backoff/jitter, `next_attempt_at`, and durable
   attempt outcomes. Keep a clock/jitter seam for deterministic tests. Restart
   preserves scheduled work. Database failures roll back state and allow lease
   recovery; they must not strand an event or fabricate a completed attempt.
2. `Schedule audited idempotent manual replay` adds a replay endpoint restricted
   to terminal failures, with a required reason and operator identity. Atomically
   record the audit/replay request and processing intent. Scope replay idempotency
   keys to the trusted operator/source, reject changed content under one key,
   and serialize concurrent replay against processing and other replay requests.
3. `Verify recovery budgets and replay permissions` adds the focused database
   races and restart checks, plus the operator recovery runbook. Verify that
   transient failures recover, permanent/exhausted failures dead-letter, one replay
   key schedules one cycle, active work cannot be replayed, and unauthorized replay
   creates neither audit success nor processing work.

A replay creates a new processing cycle with its own bounded automatic retries.
Attempt history remains append-only and links to the replay request where present.
Replaying never changes event bytes, aggregate version, or business identities.
The repaired synthetic cause lives in local demo configuration, not a payload edit.
Session-based mutations need an Origin/CSRF policy; use HttpOnly session cookies,
explicit local origins, session expiry, and server-side permission checks. Never
put operator or sender credentials in the Vite client bundle.

Exit gate: retry schedules and replay intent survive restart, earlier failures
remain visible, and replay cannot repeat the completion effect. Run checks, push,
review, merge, and verify on `main`. Crash evidence follows in PR 5 before
milestone 3 is marked complete.

### PR 5. Prove crash recovery and finish the scenario runner

1. `Add deterministic worker termination scenarios` adds opt-in local fault
   boundaries, a worker process harness, and actual termination before commit and
   after commit but before the worker continues. Use barriers to identify the
   boundary rather than sleep-based timing. Terminate only worker processes the
   harness started and owns. Demonstrate lease expiry and takeover while an old
   claimant is paused, then show that its resumed write is fenced.
2. `Report finite recovery scenarios as machine-readable evidence` assembles the
   fixtures and assertions from earlier PRs into a finite runner. Include the
   complete local scenario list, bounded timeouts, nonzero exit on failure,
   event/attempt/ledger evidence, and an environment/revision manifest. Add gated,
   authenticated demo controls for sending fixtures and repairing synthetic causes
   so the console can call the same operations later. Run these through the shared
   verification lifecycle, including teardown after a terminated worker or a
   failed assertion, and save bounded diagnostic logs before removing resources.

Keep exception injection, paused-worker experiments, and actual process exits
distinct in reports. Use real PostgreSQL and process restarts for crash assertions.
Require explicit demo mode for fault/control routes and verify those routes are
unavailable outside demo mode. A reset may affect only the configured disposable
project database and simulator state after ownership checks.

Exit gate: a fresh local stack runs every finite scenario. A pre-commit crash
leaves no effect and eventually recovers. A post-commit crash leaves a processed
event and one committed effect with no repeat. Preserve evidence of expired
attempts and reject stale-owner writes. CI runs a bounded deterministic version
of the crash checks. Push, review, merge, and verify on `main`. Milestone 3 is
complete.

### PR 6. Build and merge the investigation console

1. `Add authenticated inbox and attempt views` adds React/Vite, Tailwind, and
   TanStack Query using the existing validated API contracts. Build session entry,
   a bounded/filterable event list, and event detail with immutable acceptance,
   current processing state, chronological attempts, failure reasons, retry times,
   projection state, and completion evidence. Include loading, empty, denied, and
   request failure states with keyboard-accessible navigation.
2. `Connect replay and local simulator controls` adds permitted replay with a
   reason, an audit/history view, duplicate submission handling, and demo-only
   scenario controls. Refresh affected queries after mutations and keep viewer
   sessions read-only. Show acceptance and processing as separate facts. Display
   why replay is unavailable when work is active or the operator lacks permission.

Use server-enforced authentication and permissions from earlier PRs. Prefer a
same-origin API proxy for the local UI; do not loosen CORS or move secrets into
browser storage to make the console work. Fault details and implementation internals
belong in engineering views, not in ordinary action labels.

Exit gate: an operator can send a fixture, investigate a failure, repair its
synthetic cause, replay it, and inspect retained history and one completion entry.
A viewer can inspect permitted events but cannot invoke replay or demo controls.
Verify usable desktop and narrow layouts locally. Build, push the UI branch,
review its draft PR, merge it into `main`, and confirm the merged commit. This
includes the actual console code; no separate site branch remains unmerged.

### PR 7. Finish observability and the browser recovery journey

1. `Add redacted processing logs and bounded counters` standardizes structured
   acceptance/attempt/replay logs and counters for accepted, duplicate, conflicting,
   processed, retried, stale, and dead-lettered outcomes. Include event, attempt,
   replay, and worker correlation IDs in logs. Keep IDs and payloads out of metric
   labels; redact signatures, cookies, credentials, and payloads by default.
2. `Verify failure investigation and recovery in the browser` adds one focused
   automated browser journey against real local API/worker/PostgreSQL. Exhaust a
   failure, inspect its reason, repair the demo cause, replay with a reason, and
   assert both retained history and the completion invariant. Verify denied
   controls and the critical console states without a snapshot matrix. Add this
   bounded journey to CI and document log/counter interpretation. Extend the same
   local verification runner to start the real browser/API/worker stack, retain
   failure diagnostics, and close only its owned browser sessions and processes.

Exit gate: the browser demonstrates the intended recovery story and the backend
proves its outcome. Logs and counters distinguish a delivery retry from a new
processing attempt. Review redaction with synthetic secret markers. Run the
relevant checks once on the final head, push, review, merge, and verify on `main`.
Milestone 4 is complete.

### PR 8. Measure and explain the completed lab

1. `Measure finite local workloads with correctness checks` adds a bounded
   workload runner with explicit fixture count, concurrency, warm-up policy,
   timing definitions, timeout/failure accounting, and correctness checks after
   processing. Commit the runner before recording measurements so the measured
   source has an exact reproducible revision.
2. `Document architecture and measured recovery limits` records the actual local
   results, raw output, hardware/OS/runtime/PostgreSQL versions, configuration,
   code revision, clean/dirty state, and reproduction commands. Add a concise
   case study and architecture/state diagrams covering acceptance versus
   processing, leases/fencing, version policy, transaction boundaries, replay,
   finite receipt retention, and limits on external side effects.

Keep correctness results separate from latency/throughput summaries. Measure
acceptance and eventual processing separately, use monotonic durations, and
include failures and timeouts in the result interpretation. Use a modest local
workload; do not make production throughput, availability, or SLO claims. Keep
large recordings/generated artifacts outside Git and document their location.

Exit gate: a reviewer can rerun the workload and connect every published result
to its committed source and raw output. Documentation matches the shipped behavior.
Push, review, merge, and verify on `main`.

### PR 9. Complete the portfolio delivery and repository handoff

1. `Add recorded recovery walkthroughs and clean-checkout evidence` rehearses
   setup from a fresh checkout of merged `main` in an isolated directory and
   project-owned disposable environment. Follow only the documented commands.
   Record the short English overview below and a longer engineering walkthrough
   containing actual process termination. Record the code revision and accessible
   artifact locations. Include a transcript or captions and selected screenshots.
   Record a before/after resource inventory and rehearse normal shutdown plus
   interrupted-run cleanup using only the documented commands.
2. `Finish project documentation and the completion ledger` updates the README
   to the implemented status, links the setup guide, case study, recordings, raw
   results, and known limits, checks off only proven milestone items, and updates
   `THREAD_START.md` for maintenance. Add a small `DELIVERY.md` ledger containing
   actual PR URLs, work commit ranges, verified head SHAs, check results, merge
   SHAs, and evidence locations for all prior PRs and this PR's ready head.

If rehearsal finds a defect, fix the actual cause and rerun the affected exercise
before recording. A correction can be a focused extra commit or an additional
fix PR when it needs separate review. Include it in the ledger and merge it;
do not hide an unfinished defect behind documentation or a green checklist.

Exit gate: the short and long walkthroughs match the application, a clean checkout
works, all five milestones have evidence, and the final docs contain no invented
results. Push, review, and actually merge this PR. Perform the final audit below
against merged `main`. Milestone 5 and the project are complete only then.

## Development environment and reliable verification

Build this foundation in PR 1 and extend the same runner as capabilities arrive.
Reliable testing and cleanup are acceptance criteria throughout development.

During PR 1 verification, the machine's existing Docker networks exhausted its
automatic address pools. The implementation therefore inspects existing subnets
and WSL routes, allocates an unused /28 from 10.232.0.0/16, labels that project
network, and verifies its removal. It preserves all pre-existing networks and
does not change the daemon's address pools.

### One documented local setup

Use the pinned Windows Node/pnpm installation for API, worker, sender, UI, and
tests, and Docker/Compose in WSL Ubuntu for PostgreSQL. Root commands own the WSL
path translation and pass only required configuration explicitly. Do not install
a second dependency tree in WSL or introduce Docker Desktop as another setup.
CI uses the same runtime/database versions, lockfile, migrations, and fixtures
on Linux. Pin the PostgreSQL image version; do not use a floating `latest` tag.

Preflight checks tool versions, the WSL Docker endpoint, local configuration,
available ports, and database ownership without printing secrets. Apply a
configurable CPU/memory ceiling and log rotation to project containers. Keep
worker concurrency and fixture counts bounded. Start with one database container
per verification run; do not build an environment orchestration service.

Windows runs hold one manifest-owned foreground WSL session until Docker teardown
finishes. Systemd services alone do not keep Ubuntu alive, so Windows Node tests
cannot rely on the Docker daemon to do so. An open input pipe owns that session;
coordinator exit closes it. Keep `dev` and Windows `db:up` in the foreground and
release the session during cleanup, without changing WSL settings.

Separate the retained developer database from verification, scenario, rehearsal,
and measurement data. Every temporary run gets a unique Compose project such as
`webhook-recovery-verify-<run-id>`, labeled resources, disposable volumes, and
loopback-only allocated ports. Pass the actual API/UI/database URLs to every
process, signer, and browser test. Never reuse a running development database or
fixed development ports for verification. Suites within one run execute in a
documented order with their own resettable test databases or schemas.

### End-to-end verification lifecycle

`pnpm verify` owns the complete run and expands as PRs add capabilities:

1. Inventory pre-existing relevant resources. Write an ignored run manifest under
   `.local/runs/<run-id>/` before launching anything. Record the revision, runtime
   versions, Compose project/files, labels, created resource IDs, owned process
   identities, allocated ports, temporary paths, and cleanup state. Keep secrets
   in a separate restricted temporary file and out of logs/reports.
2. Start isolated PostgreSQL and wait for bounded readiness with a real connection,
   then migrate and seed. Start the actual API and worker, and later the console.
   Wait for application readiness and verify the browser can reach the chosen
   origin. A fixed sleep or a listening port alone does not establish readiness.
3. Exercise the real path from signed HTTP intake through PostgreSQL and worker
   effects to authenticated inspection and replay. Add deterministic duplicate,
   ordering, retry, and process-termination scenarios as implemented, then the
   browser recovery journey in PR 7. Stub only the synthetic business fault or
   clock boundary under test; keep storage, authentication, and HTTP real.
4. Assert final inbox/attempt/projection/ledger state with bounded waits and
   nonzero exit on failure. Save a machine-readable result and bounded logs, plus
   browser traces/screenshots on failure. Record test settings separately from
   measurement settings so fast test leases/retries do not become workload claims.
5. In `try/finally` and supported interruption handlers, collect diagnostics and
   tear down owned processes, browser sessions, containers, networks, disposable
   databases/volumes, and temporary secret files. Preserve the original failure
   status. A cleanup failure also fails the run and reports the exact leftovers.

Unit checks can run without containers. `pnpm verify` runs the relevant checks
against a fresh disposable stack and becomes the full local acceptance command
by PR 7. Keep the same settings and assertions available to CI; its job teardown
and diagnostic upload must also run after failures. Verify migration upgrades
from the preceding schema as well as migration of an empty database.

Standalone integration, scenario, browser, and measurement commands must either
use this same lifecycle or require an already validated run manifest. Never fall
back to the developer database when temporary configuration is missing. After each
completed vertical slice, rehearse its user-visible flow against that isolated
stack and inspect the recorded database outcome. In PR 6, use the local console
to walk through intake, failure investigation, repair, and replay before teardown.

### Cleanup during development

Temporary verification services are removed at the end of each run, including
failures. Agent-started previews are temporary unless Kleiton requests that they
stay running. `pnpm dev:down` stops registered project development processes and
its Compose services while retaining the developer database volume.

`pnpm cleanup --run <run-id>` recovers an interrupted temporary run and is safe
to repeat. Reconcile its manifest with actual ownership labels and process
identities before acting; a PID alone is insufficient because it may be reused.
Use the original Compose files and explicit project name for teardown, removing
volumes only for the disposable run. Reject developer/external volumes and
unverified paths. Validate resolved absolute temporary paths stay within the
recorded project scratch directory before deleting them. Never select resources
solely by a broad name prefix. The next startup reports unfinished manifests and
requires their verified reconciliation before reusing their resources.

Track task-created images and any disposable Buildx builder if one is needed.
Remove exact temporary tags, newly pulled images no longer needed or used
elsewhere, and that builder/cache after the task. Reuse the pinned development
image and installed dependencies while needed; do not reinstall or accumulate a
new image, builder, or dependency tree per run. Preserve pre-existing resources.
Never use global Docker pruning, shared pnpm/browser cache deletion, broad process
kills, `wsl --shutdown`, or WSL disk compaction as routine cleanup.

Rotate container logs, remove scratch environments after each run, and bound
generated reports to the latest five runs and at most 100 MiB in total. Capture
bounded diagnostics before teardown; the next run may evict only older verified
scratch reports. Promote selected measurements, walkthroughs, and failure evidence
to documented deliverables before applying that retention rule. Do not silently
delete published evidence, source files, lockfiles, or retained development data.

`pnpm env:status` reports active owned processes/ports, containers/volumes, unfinished
runs, and scratch usage. After cleanup, compare the owned resource inventory with
the baseline and check disk usage when a build or large pull occurred. Report any
intentional retention or failed cleanup explicitly. No cleanup command may erase
the refund ledger or deduplication history in retained developer data; only an
explicit, ownership-validated disposable demo reset may replace that state.

Once teardown is verified, save the non-secret cleanup result with the bounded
report and remove that run's scratch directory. Keep unfinished manifests only
while reconciliation is still needed, so resource tracking does not itself grow
without a limit.

Prove this lifecycle once in PR 1 with two successive runs, a startup failure,
a test failure, and an interruption followed by cleanup twice. Repeat only when
later process/browser additions or a defect change what those checks establish.
The acceptance result must show no task-owned temporary resources left behind,
preserved developer data, and successful cleanup after the worker crash scenarios.

## Planned root command interface

These are commands to implement, not commands available in the planning-only repo.
Update this list if implementation proves a simpler interface is better. Add each
command when its PR introduces the corresponding capability.

| Available from | Command | Purpose |
| --- | --- | --- |
| PR 1 | `pnpm install --frozen-lockfile` | Install pinned dependencies |
| PR 1 | `pnpm env:check` | Validate tools, configuration, ownership, and port availability |
| PR 1 | `pnpm env:status` | Report owned resources, unfinished runs, and scratch disk usage |
| PR 1 | `pnpm db:up` / `pnpm db:down` | Start/stop only the project database; retain its volume |
| PR 1 | `pnpm db:migrate` / `pnpm db:seed` | Apply committed migrations and idempotent local seeds |
| PR 1 | `pnpm dev` | Start API and worker; add the console in PR 6 |
| PR 1 | `pnpm dev:down` | Stop project development services while retaining developer data |
| PR 1 | `pnpm check` | Lint, typecheck, pure tests, and build for existing packages |
| PR 1 | `pnpm test:integration` | Run focused checks against an isolated real test database |
| PR 1 | `pnpm verify` | Provision, exercise, report, and tear down an isolated stack; expand through PR 7 |
| PR 1 | `pnpm cleanup --run <run-id>` | Recover and verify cleanup of one owned disposable run |
| PR 2 | `pnpm sender -- <fixture>` | Send an exact-byte signed local fixture |
| PR 5 | `pnpm scenarios` | Run finite correctness and termination scenarios |
| PR 5 | `pnpm demo:reset` | Reset only verified project-owned disposable demo state |
| PR 7 | `pnpm test:e2e` | Run the single browser recovery journey |
| PR 8 | `pnpm measure -- <config>` | Run the finite measured workload and save its manifest |

Document WSL prerequisites and how the root commands reach Docker on this machine.
CI can use its own isolated PostgreSQL service; it does not need WSL. Keep test,
development, rehearsal, and measurement storage distinct. Apply schema migrations
to both an empty database and the prior PR's schema as the schema evolves.

## Git, push, review, and merge workflow for every PR

The following is a runbook for the later execution session, not an instruction to
run it during planning. Substitute the branch and PR title from the sequence.
Run commands one at a time and stop on a failed exit code. Do not paste these as
an unchecked script.

### 1. Start from the latest merged main

Confirm a clean worktree, the correct remote, and no merge/rebase in progress.
Preserve unrelated changes. Fetch and fast-forward `main`, then create the named
branch. Inspect an existing matching branch or PR before attempting creation again.

```powershell
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <branch>
```

Implement the listed work commits in order. Stage explicit paths only, inspect
the staged diff, and commit each coherent change with its focused verification.
Do not use `git add .`, force pushes, or hook bypasses.

```powershell
git add -- <explicit-paths>
git diff --cached --check
git diff --cached
git commit -m '<planned commit subject>'
```

### 2. Merge newer main, verify, push, and open the draft

Before filing, fetch again and merge any new `origin/main` commits into the work
branch. Resolve conflicts, inspect the final diff, and rerun checks affected by
the merge. PR 0 needs documentation checks; later PRs need their available root
checks, focused integration coverage, and the acceptance gates above.

```powershell
git fetch origin
git merge origin/main
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
git push -u origin <branch>
gh pr list --repo KleitonBarone/webhook-recovery --head <branch> --state all
gh pr create --repo KleitonBarone/webhook-recovery --draft --base main --head <branch> --title '<PR title>' --body-file <body-file>
```

Write the PR body to a task-owned file with real newlines. Open with the concrete
problem and resulting behavior, then include only useful verification and limits.
Register the returned PR URL with T3's `link_pull_request` immediately. Retain the
actual PR number/URL; never assume it equals the plan label. If a command's result
is uncertain, inspect Git/GitHub before retrying to avoid duplicate work.

### 3. Finish review on the latest pushed head

CI must run for draft PRs. Inspect every expected check, not just protected ones,
because the repository currently has no required-check policy. Missing expected
checks, cancelled checks, and a green result for an older SHA do not pass this gate.
Do not change repository protections as an implicit part of this plan.
PR 0 is the documented exception to automated checks: no CI exists yet, so a
`no checks reported` response is expected after the documentation review. PR 1
must introduce working CI before its own merge; later missing checks are a defect.

```powershell
gh pr view <PR URL> --json state,isDraft,headRefOid,mergeable,reviewDecision,statusCheckRollup
gh pr checks <PR URL>
```

Read checks and review comments newer than the last push. Verify bot findings
against the source, fix real defects with focused commits, and dismiss false
positives with a written reason. Separate actual breaks from demonstrated infra
flakes. If a human leaves an unresolved comment, gather context and ask Kleiton
before replying or resolving it. Wait for installed review bots to finish on the
latest head. If no review bots are configured, do not invent that requirement.

Push review fixes with `git push` and repeat the affected checks. If `main`
advances, merge it and repeat the relevant review/check gates. Use T3
`watch_pull_request` when monitoring is needed, then end the active turn until
T3 wakes it. Do not start another polling watcher. Unwatch before handing control
back to Kleiton. A waiting/checking/auto-merge state is not a completed PR.

### 4. Mark ready and actually merge the PR

A later execution request must explicitly authorize merging, for example by using
the prompt in `THREAD_START.md`. Once that authorization is present, continue
through actual merges without asking for the same approval again. A planning
request alone supplies no execution authorization.

After the acceptance gate and all expected checks pass, mark the draft ready.
Check for readiness-triggered reviews/checks before merging. Capture the latest
reviewed head and merge exactly that SHA with a GitHub merge commit. This keeps
the focused work commits in history. Do not bypass checks or use `--admin`.

```powershell
gh pr ready <PR URL>
gh pr checks <PR URL>
gh pr view <PR URL> --json headRefOid,reviewDecision,mergeable,statusCheckRollup
$reviewedHead = gh pr view <PR URL> --json headRefOid --jq '.headRefOid'
gh pr merge <PR URL> --merge --match-head-commit $reviewedHead
gh pr view <PR URL> --json state,mergedAt,mergeCommit,url
```

Only set `$reviewedHead` after checking that it is the SHA whose reviews and checks
passed. If the head changes, repeat that gate. If repository policy later requires
a merge queue, follow that policy and wait for confirmed merge. Do not mistake
queue admission or enabling auto-merge for merging.

### 5. Verify remote merge and synchronize locally

Require GitHub `state: MERGED`, a non-null merge commit, and the merge commit in
`origin/main`. Fetch, fast-forward local `main`, and verify ancestry. Stop on a
failed ancestry check; do not continue to the next PR with an unconfirmed merge.

```powershell
git fetch origin
$mergedCommit = gh pr view <PR URL> --json mergeCommit --jq '.mergeCommit.oid'
git merge-base --is-ancestor $mergedCommit origin/main
git switch main
git pull --ff-only origin main
git status --short --branch
```

Check the push-to-main workflow result for that merge as well. A failure needs a
focused fix PR before the next planned feature. Record each PR's merge result in
the final handoff and, once introduced, the delivery ledger. The GitHub merge
itself records the final PR's merge SHA; do not create an endless series of ledger
commits just to make a document contain its own future merge hash.

Remove temporary verification resources using the lifecycle above before starting
the next PR. Leave merged feature branches alone unless branch cleanup is
separately requested. Disposable rehearsal checkouts created by this task may be
removed after confirming their changes/evidence are preserved and their absolute
paths are inside the recorded scratch root. Preserve user-owned worktrees,
retained volumes, and unrelated branches. Start the next branch only after this PR
is confirmed merged and local `main` is current.

The merge flags and check inspection commands follow the official
[GitHub CLI merge documentation](https://cli.github.com/manual/gh_pr_merge) and
[check documentation](https://cli.github.com/manual/gh_pr_checks).

## Final audit after PR 9 merges

These are post-merge handoff gates. The final documentation PR cannot record its
own future merge SHA or main CI result. Its GitHub record and the final runtime
audit linked from [DELIVERY.md](DELIVERY.md) supply those results after merge.
The checked milestone evidence above is available before that merge.

- [ ] Every planned PR and any corrective PR has an actual URL and `MERGED` state.
- [ ] Each recorded merge commit is an ancestor of `origin/main`; local `main`
  matches the remote and the worktree is clean.
- [ ] T3's `list_thread_pull_requests` contains every PR worked on in this thread;
  link any missing one and stop active PR watches before handoff.
- [ ] The final push-to-main CI run passes all expected checks for the merged SHA.
- [ ] A fresh checkout of final `main` installs, migrates, seeds, runs the console,
  and passes finite scenarios and the recovery journey using documented commands.
  Reuse earlier evidence only if no subsequent change affects what it proves.
- [ ] The UI, API, worker, simulator, retry/replay paths, and PostgreSQL migrations
  all live on `main`, with no required work stranded in an open PR or local branch.
- [ ] Correctness reports, measured results, case study, recordings, and captions
  are linked and identify the source revisions they demonstrate.
- [ ] The README describes what exists and how to run it; all five milestone
  checklists reflect verified behavior and any remaining limits are explicit.
- [ ] Task-owned rehearsal services/processes are stopped; existing daily-driver
  services and shared data are untouched.
- [ ] Verification, crash, browser, and rehearsal runs have no leftover disposable
  containers, networks, volumes, processes, browser sessions, secret files, or
  task-owned builders/images no longer needed. Scratch report retention is bounded.
- [ ] Documented shutdown and interrupted-run cleanup are repeatable, preserve
  retained developer data, and report resource/disk usage and intentional retention.
- [ ] The final report lists PR URLs, merge SHAs, verification, evidence locations,
  and any follow-up outside the agreed scope. No hosting is needed for completion.

## Demonstration script

1. Send a signed event and open its durable acceptance receipt in the console.
2. Resend it several times and show one inbox identity and one local effect.
3. Deliver a newer snapshot before an older one and show the stale decision.
4. Make the handler fail until its retry budget is exhausted.
5. Repair the synthetic cause, replay with a reason, and inspect the complete
   attempt history and unchanged completion ledger invariant.

Keep actual process-termination evidence in a longer engineering walkthrough if
it does not fit the roughly 90-second overview.

## Optional integration and boundaries

The returns application can supply synthetic refund events, and webhook-redrive
can deliver them. Both integrations are optional HTTP adapters after the standalone
lab works. No sibling checkout or shared database is required for this MVP.

Exclude arbitrary provider adapters, payload transformations, routing languages,
live payment actions, enterprise multi-tenancy, multi-region failover, and
distributed external transactions. Receipt retention is explicit and unbounded
for the finite lab; do not add cleanup that silently releases deduplication keys.
Document how replay lifetime would affect any future retention policy.

## Development references

- [Fastify TypeScript reference](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [PostgreSQL row-locking behavior](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [Stripe webhook behavior](https://docs.stripe.com/webhooks)
- [Redrive integration and consumer examples](https://github.com/KleitonBarone/webhook-redrive/blob/main/docs/integration.md)

The default source is the local custom simulator. Its versioned event contract is
not a claim that Stripe or another external provider supplies equivalent ordering
or deduplication semantics.
