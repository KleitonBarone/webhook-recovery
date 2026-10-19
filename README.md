# Webhook recovery

An incoming webhook recovery lab. It accepts signed events into a
durable inbox, processes them asynchronously, and gives an operator a way to
investigate and recover failed processing.

The local lab sends duplicate events, delivers older versions late, and stops a
worker at defined failure boundaries. The console shows the event history
and its effect on a synthetic refund projection.

**Status: implementation in progress.** The isolated local PostgreSQL environment,
API/worker entry points, signed durable intake, authenticated inspection, migrations,
versioned refund processing, bounded retries, audited replay, and verification/cleanup
runner are available, including [actual worker crash scenarios](docs/scenarios.md).
The React console provides authenticated inspection, sample controls, and audited replay through
`pnpm dev`. See [local setup](docs/setup.md), the [recovery runbook](docs/recovery.md),
and the remaining [implementation plan](PLAN.md).

Use Node 24.20.0, pnpm 11.23.0, and Docker/Compose in WSL Ubuntu on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm browser:install
pnpm check
pnpm verify
```

Verification creates and removes its own disposable environment. See
[local setup](docs/setup.md) for interactive development, diagnostics, and cleanup.

Everything runs with fictional events and a local sender. No external webhook
provider, customer, payment account, or public endpoint is required. Tests and
measurements will identify their author-performed local environment.

This project is distinct from [Webhook Redrive](https://github.com/KleitonBarone/webhook-redrive),
which delivers outbound webhooks. That repository includes receiver examples, but
this project makes the receiving application's durable processing and recovery
workflow the product. It can run independently; using Redrive as a sender is an
optional later integration.

The intended stack is TypeScript, a small Node.js API and worker, PostgreSQL, and a
React/Vite investigation console. The business effects in the lab stay in one
database transaction. The project will explain that boundary rather than promise
exactly-once effects across arbitrary external services.
