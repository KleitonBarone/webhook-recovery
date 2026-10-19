# Start execution of the webhook recovery plan

Open `C:\Users\admin\repos\webhook-recovery` as its own project and paste:

```text
Execute the complete webhook-recovery engineering portfolio plan. Read README.md,
PLAN.md, the applicable AGENTS.md instructions, and the current Git/GitHub state
first. The repository starts with planning documents only. If execution has already
begun, inspect what actually merged and resume from the first unfinished PR.

This project receives signed events into a durable inbox and processes business
effects asynchronously. It is distinct from my existing webhook-redrive sender.
Do not modify that repository or rebuild outbound webhook delivery here.

I am Kleiton, a senior engineer in Brazil targeting international remote roles.
The demonstration must work in my own local environment with synthetic senders,
events, and database-local effects. Real customers, live providers, payments,
external accounts, public endpoints, and hosting are not required.

I authorize the complete delivery sequence in PLAN.md, including creating local
branches, focused commits, pushing them to this repository, opening draft PRs,
fixing verified review/CI findings, marking the drafts ready after their gates
pass, and actually merging each PR into main. This includes the investigation
console PR and the final documentation/evidence PR. Do not stop at pushing,
opening a PR, or enabling auto-merge. Confirm MERGED and the merge commit in
origin/main before starting the next branch. Preserve the planned work commits
using GitHub merge commits. Do not bypass checks or repository policy.

Use the planned PR/commit breakdown as the starting sequence, and update it if
verified implementation needs require a change. Implement and verify all five
milestones, complete the local walkthrough and evidence, and keep the delivery
ledger accurate. Use one active implementation branch at a time. Do not spawn
subagents for ordinary sequential work. Do not touch sibling repositories.

Use pnpm, strict TypeScript, Fastify, PostgreSQL with Drizzle, a local signed
sender, and React/Vite/Tailwind/TanStack Query for the console. Check package
compatibility when scaffolding. Keep types inferred, avoid any and casting wrappers,
and do not add a broker or unnecessary services. Follow the Docker-through-WSL
skill on this machine and name the exact project-owned resources before touching
them. Check the planned ports without stopping existing listeners.

Implement the environment and verification lifecycle in PLAN.md from PR 1. Use
one documented Windows Node/pnpm setup with PostgreSQL through WSL Docker, pinned
versions, bounded resources/logs, readiness checks, and deterministic synthetic
fixtures. Make pnpm verify provision its own stack, exercise the actual HTTP,
database, worker, and later browser recovery path, save useful bounded evidence,
and always tear its resources down. Keep its database and ports separate from
the retained developer environment. Extend that runner as the application grows.

Track exact owned resources in a run manifest before creating them. Clean up
after successful, failed, and interrupted runs. Provide pnpm dev:down,
pnpm env:status, and idempotent pnpm cleanup --run <run-id>. Bound scratch reports,
container logs, and temporary images/builders so development does not accumulate
resources. Preserve developer data, shared caches, source, and selected published
evidence. Never globally prune Docker or stop unrelated services. Verify cleanup
with before/after inventories and report anything intentionally retained or left
behind. This authorization includes cleanup of resources created as disposable
for this task, not pre-existing resources or retained application data.

Keep intake acceptance distinct from processing success. Verify signatures over
exact bytes, preserve event identity across retries, and scope sender identity and
operator access on the server. Test the relevant database transaction boundaries
with focused integration tests. Never imply exactly-once external side effects.

Touch only project-owned local services and data. Scope resets and fault injection
to this project's disposable environment. Do not stop existing daily-driver
previews. Record actual local evidence and its limits without adoption claims.

Link every PR to this T3 thread immediately. Use T3's PR watcher when waiting for
checks/review and resume when it wakes the thread. If an unresolved human comment
appears, gather context and ask me before replying. Merge authorization is already
given above; do not ask me to approve the same action repeatedly. Ask only for an
actual missing decision or an action outside the authorized scope.

Finish with a clean main synchronized with origin/main, all planned and corrective
PRs confirmed merged, passing final checks, and links to the PRs, merge SHAs,
walkthrough, case study, raw results, and reproduction commands. Public hosting,
live providers, payments, and production changes are outside this plan.
Include verified cleanup results and any retained resource/disk usage in the
handoff. Leave agent-started previews running only if I request it.
```

For a smaller execution session, replace the full-sequence authorization with an
explicit PR range and keep the same acceptance, review, and confirmed-merge gates.
Pasting this execution prompt is a later implementation request. Preparing the
plan alone does not authorize running it.
