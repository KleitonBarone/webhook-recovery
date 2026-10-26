# Browser demo and Vercel deployment

The portfolio demo reuses the real investigation console with a typed browser-only
simulator. It needs no API service, database, worker, account, or environment
variables. Every tab owns its own in-memory data. Reset demo and page refresh both
restore the initial examples.

The page labels itself **Interactive simulation**. Its processing history,
retries, and replay illustrate the workflow. The real PostgreSQL transaction,
concurrency, and crash guarantees belong to the [full local lab](setup.md) and
its [recorded engineering evidence](walkthrough.md).

## Run it

Use the repository's Node and pnpm versions, then:

```sh
pnpm install --frozen-lockfile
pnpm demo
```

Open http://127.0.0.1:4173. Select `refund_demo_1042`, which has exhausted three
attempts. Repair its demo cause, enter a replay reason, and request replay. Its
original receipt and three failures remain, followed by one successful attempt,
one replay audit, and one completion entry. Redelivery returns the same receipt.

The inbox also starts with a processed event, an older snapshot, and a permanent
failure. Send new samples to watch queued work, processing, retries, and terminal
outcomes. The simulation advances when the UI reads its state. It uses short,
deterministic delays rather than the backend's scheduling clock. To bound tab
memory, reset after 50 events or 50 processing cycles for one event.

The normal `pnpm dev` and `pnpm build` commands continue to use the real API.
The explicit Vite `demo` mode selects the simulation and removes the API proxy.
No `VITE_` secrets, credential setup, or local-storage persistence are needed.

## Build and verify

```sh
pnpm check
pnpm build:demo
pnpm preview:demo
```

The deployable static files are in `web/dist-demo`. Normal app builds remain in
`web/dist`. Both output directories are ignored by Git and can be regenerated.
Stop either local server with Ctrl+C.

For the automated browser check, install the project-owned Chromium cache once:

```sh
pnpm browser:install
pnpm verify:demo
```

Linux may need `pnpm browser:install --with-deps`. The verification builds and
serves the static output on an ephemeral loopback port. It checks recovery,
preserved history, redelivery, independent tabs, reset, refresh, narrow layout,
and zero `/api` requests. It closes the browser and preview server afterward.
The normal CI runs this journey alongside the full backend verification.

## Deploy on Vercel

1. Import `KleitonBarone/webhook-recovery` as a new Vercel project.
2. Keep **Root Directory** at the repository root, not `web`.
3. The root `vercel.json` sets the Vite preset, install command
   `npx --yes pnpm@11.23.0 install --frozen-lockfile`, build command
   `npx --yes pnpm@11.23.0 build:demo`, and output directory `web/dist-demo`.
   Leave the dashboard overrides aligned with those values. Use Node 24.x.
4. Add no environment variables or storage integrations. Deploy the project.
5. Check the generated Vercel URL using the recovery story above. In the browser's
   Network panel, actions should make no `/api` requests.
6. Add your chosen subdomain, such as `recovery.yourdomain.com`, under the
   project's Domains settings and follow Vercel's displayed DNS instructions.

The configuration publishes static files only. It does not deploy `src/api.ts`,
`src/worker.ts`, or any Vercel Functions. The UI uses query-free navigation in
demo mode, so a refreshed event view returns to a fresh inbox.

Vercel's [Vite guide](https://vercel.com/docs/frameworks/frontend/vite) and
[domain setup guide](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
cover the platform steps. The commands pin pnpm because Vercel's
[package manager defaults](https://vercel.com/docs/package-managers) can select an
older version for a custom install command. This repository is prepared for
import; no Vercel project, public deployment, or DNS record is created by the local
build.
