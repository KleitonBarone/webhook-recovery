# Webhook recovery

A planned incoming webhook processing service. It accepts signed events into a
durable inbox, processes them asynchronously, and gives an operator a way to
investigate and recover failed processing.

The local lab will send duplicate events, deliver older versions late, and stop a
worker at defined failure boundaries. A small console will show the event history
and its effect on a synthetic refund projection.

**Status: planning only.** The service, console, and runnable scenarios have not
been implemented. Start with the [implementation plan](PLAN.md), or copy the
[thread starter](THREAD_START.md) into a separate development conversation.

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
