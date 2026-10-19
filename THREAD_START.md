# Resume maintenance

The planned local lab is implemented. Read [README.md](README.md),
[DELIVERY.md](DELIVERY.md), [PLAN.md](PLAN.md), and applicable agent instructions
before starting maintenance. Inspect local Git state and GitHub rather than
repeating the original implementation sequence.

Suggested starting prompt:

```text
Work in C:\Users\admin\repos\webhook-recovery. Read the project documents and
current Git/GitHub state first. Preserve unrelated changes and sibling projects.
Use the delivery ledger to identify the current implemented state and evidence.

For the requested change, use one focused branch from updated main. Keep strict
inferred TypeScript types. Reuse the documented Windows Node/pnpm environment and
WSL Docker workflow. Touch only owned local disposable services and data.

Run pnpm check and the relevant existing verification. pnpm verify exercises the
real HTTP, database, worker, crash boundaries, and browser journey. If lifecycle
behavior changes, use pnpm verify:cleanup or its documented browser-only mode.
Keep reports bounded and clean task-owned resources after failures/interruption.
Preserve retained developer data, shared caches, and published evidence.

When a PR is requested, merge latest origin/main, open a draft, link it to this T3
thread, and inspect checks and reviews on the latest pushed SHA. Use the T3 watcher
while waiting. Verify bot findings against source. Gather unresolved human comments
for Kleiton instead of replying. Merge only when the current request authorizes it.
The completed project's historical merge authorization is not permission to merge
unrelated future maintenance.

Keep the setup guide, operational explanations, and comments consistent with
behavior. Re-record evidence only when the change affects what it proves. Identify
the actual source revision and distinguish correctness from workload measurements.
```

Public hosting, live providers, payment actions, production data, and unrelated
repositories remain outside the local lab's scope.
