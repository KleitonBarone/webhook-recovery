# Webhook recovery implementation plan

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

- Use pnpm, strict TypeScript, Fastify, PostgreSQL, and typed queries or Drizzle.
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

Reserve UI port 4330, API port 4331, sender port 4332, and database port 55433.
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

- [ ] Scaffold API/database and initial migrations with a local signed sender.
- [ ] Verify exact bytes, source identity, bounded body size, and timestamp tolerance.
- [ ] Persist an immutable event and initial processing intent before returning 202.
- [ ] Add scoped identity deduplication and conflict responses under concurrent intake.
- [ ] Add authenticated event inspection and verified setup/seed/check commands.

Done when identical retries return the same durable event after an API restart,
conflicting bodies create no second event, and invalid signatures create no work.

### 2. Business processing

- [ ] Add a worker with bounded, lease-protected claims.
- [ ] Implement the versioned synthetic refund projection handler.
- [ ] Atomically commit processing receipt, local effect, and successful outcome.
- [ ] Add stale-version handling and business-level completion deduplication.
- [ ] Preserve history for processed, stale, and conflicting events.

Done when concurrent duplicate events and distinct completion events preserve one
completion effect, and an older snapshot cannot roll back a newer projection.

### 3. Failure and recovery

- [ ] Classify transient and terminal handler failures and bound retries.
- [ ] Persist retry timing with the failed attempt outcome using deterministic
  clock/jitter controls in tests.
- [ ] Reclaim expired work safely and fence stale-worker completions.
- [ ] Add authenticated, audited, idempotent manual replay.
- [ ] Demonstrate recovery across actual worker termination on a fresh local stack.

Done when crashes before and after commit preserve correct local effects, retries
survive restart, and replay keeps earlier failure history intact. Do not claim
exactly-once network delivery or arbitrary external side effects.

### 4. Investigation console and focused verification

- [ ] Build an event list with bounded filtering and an event/attempt detail view.
- [ ] Show acceptance, processing status, failure reason, and the next action.
- [ ] Add local simulator controls and a permitted replay action with a reason.
- [ ] Add structured logs and bounded counters for accepted, duplicate, processed,
  retried, stale, and dead-lettered events. Redact credentials and payloads by default.
- [ ] Verify operator permissions, raw-body signing, concurrent intake, claim
  fencing, receipt/effect atomicity, ordering policy, and replay behavior.

Use real PostgreSQL tests for transaction races and crash boundaries, plus small
pure tests for classification and signature vectors. Add one browser journey
showing failure investigation and recovery; avoid exhaustive UI snapshots.

### 5. Reproducible engineering evidence

- [ ] Add a finite scenario runner with machine-readable correctness results.
- [ ] Rehearse a clean checkout and document all working local commands.
- [ ] Record an English walkthrough showing failure, duplicate suppression, and replay.
- [ ] Write a case study explaining acceptance versus processing, transaction
  boundaries, stale-event policy, and known limits.
- [ ] Publish a modest measured workload with revision, hardware, environment,
  fixture count, concurrency, timing validity, and raw results.

Keep latency measurements separate from correctness assertions. A finite local
workload does not establish production throughput, availability, or service SLOs.
The local application and evidence complete this plan; hosting is optional future work.

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
- [Stripe webhook behavior](https://docs.stripe.com/webhooks)
- [Redrive integration and consumer examples](https://github.com/KleitonBarone/webhook-redrive/blob/main/docs/integration.md)

The default source is the local custom simulator. Its versioned event contract is
not a claim that Stripe or another external provider supplies equivalent ordering
or deduplication semantics.
