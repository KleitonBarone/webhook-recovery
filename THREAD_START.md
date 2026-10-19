# Start the webhook recovery thread

Open `C:\Users\admin\repos\webhook-recovery` as its own project and paste:

```text
We are building my webhook-recovery engineering portfolio project. Read README.md
and PLAN.md first. The repository currently contains planning documents only.

This project receives signed events into a durable inbox and processes business
effects asynchronously. It is distinct from my existing webhook-redrive sender.
Do not modify that repository or rebuild outbound webhook delivery here.

I am Kleiton, a senior engineer in Brazil targeting international remote roles.
The demonstration must work in my own local environment with synthetic senders,
events, and database-local effects. Real customers, live providers, payments,
external accounts, public endpoints, and hosting are not required.

Implement milestone 1 completely, verify its acceptance criteria, and update the
plan to match the actual implementation. Defer later milestones until I request
them. Use pnpm, strict TypeScript, a small Node API, PostgreSQL, and a local signed
sender as the starting architecture. Check package compatibility when scaffolding.
Keep types inferred, avoid any and casting wrappers, and do not add a broker or
unnecessary services. Follow applicable Docker-through-WSL instructions if needed.

Keep intake acceptance distinct from processing success. Verify signatures over
exact bytes, preserve event identity across retries, and scope sender identity and
operator access on the server. Test the relevant database transaction boundaries
with focused integration tests. Never imply exactly-once external side effects.

Touch only project-owned local services and data. Scope resets and fault injection
to this project's disposable environment. Do not stop existing daily-driver
previews. Record actual local evidence and its limits without adoption claims.
```
