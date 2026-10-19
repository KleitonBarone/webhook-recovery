# Delivery ledger

The implementation was delivered on 2026-10-19 as sequential draft PRs, reviewed
against current main, then merged with GitHub merge commits. The plan's PR labels
start at zero; actual GitHub numbers start at one.

## Confirmed implementation merges

Each row is confirmed `MERGED`. Work commits appear in order; the last is the
reviewed head whose check passed. Full SHAs, subjects, timestamps, PR check URLs,
and successful push-to-main runs are in [the machine-readable ledger](docs/evidence/delivery-prs.json).
PR #1 predates CI and follows the plan's explicit documentation-only exception.

| Plan PR | Actual PR | Work commits, last reviewed | PR check | Merge commit |
| --- | --- | --- | --- | --- |
| 0 | [#1](https://github.com/KleitonBarone/webhook-recovery/pull/1) Complete the project delivery plan | [`2dbe3aa`](https://github.com/KleitonBarone/webhook-recovery/commit/2dbe3aab4b9258deac488588acfa60f64d8e30d4) | No CI existed | [`4223f1b`](https://github.com/KleitonBarone/webhook-recovery/commit/4223f1b6fa09a6d42c6be9d593953ec4f6ec9401) |
| 1 | [#2](https://github.com/KleitonBarone/webhook-recovery/pull/2) Add a reproducible local development environment | [`a85ceee`](https://github.com/KleitonBarone/webhook-recovery/commit/a85ceeed08023f5cd51ee8891133394e51d85f05), [`8f2c93e`](https://github.com/KleitonBarone/webhook-recovery/commit/8f2c93e1b084d2d298a9d8907a49bf477c5cdb46), [`422f0ab`](https://github.com/KleitonBarone/webhook-recovery/commit/422f0abfdda94863eb4df03729ce8ceab35d2b49) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39262065785/job/118092011137) | [`84b0921`](https://github.com/KleitonBarone/webhook-recovery/commit/84b09214883ee92f4bd341769d52e799ea943b10) |
| 2 | [#3](https://github.com/KleitonBarone/webhook-recovery/pull/3) Accept signed events into a durable inbox | [`b9a0c1d`](https://github.com/KleitonBarone/webhook-recovery/commit/b9a0c1d125da9c752ae42a879626c3a7b6319584), [`db428dc`](https://github.com/KleitonBarone/webhook-recovery/commit/db428dcf79ea2d19f02bea07392a051e6d420c17), [`21815cd`](https://github.com/KleitonBarone/webhook-recovery/commit/21815cdb9fd884ffd6bfe9ced24c43ec6c059ddb) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39264120867/job/118099126038) | [`78cb43d`](https://github.com/KleitonBarone/webhook-recovery/commit/78cb43d157b77ec686153e05c31f41462f69cb64) |
| 3 | [#4](https://github.com/KleitonBarone/webhook-recovery/pull/4) Process refund snapshots without repeating effects | [`5bd20cc`](https://github.com/KleitonBarone/webhook-recovery/commit/5bd20cccf01eeb70ae064eeeaba0f2dc3800c3c7), [`684a07e`](https://github.com/KleitonBarone/webhook-recovery/commit/684a07ee44d75ac1344d970f28f8a1402b37c4a3) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39270272643/job/118120418266) | [`e2e5913`](https://github.com/KleitonBarone/webhook-recovery/commit/e2e59132e6e3043986ccc64bd7001023325d1255) |
| 4 | [#5](https://github.com/KleitonBarone/webhook-recovery/pull/5) Recover failed processing with retries and replay | [`e13341a`](https://github.com/KleitonBarone/webhook-recovery/commit/e13341a22a479dbf660e08b2751a24b06b557604), [`48100ef`](https://github.com/KleitonBarone/webhook-recovery/commit/48100efd4edf629d0ee6dd0ea680efbd09e0f543), [`0edd31f`](https://github.com/KleitonBarone/webhook-recovery/commit/0edd31fc72e95f51bb04ecd08201fbf82b916f78) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39272898201/job/118129579922) | [`e7a9d1d`](https://github.com/KleitonBarone/webhook-recovery/commit/e7a9d1d491508b4576792d84fcaf967b8f38f3d7) |
| 5 | [#6](https://github.com/KleitonBarone/webhook-recovery/pull/6) Prove recovery across worker termination | [`0104a39`](https://github.com/KleitonBarone/webhook-recovery/commit/0104a39bda396a0eba826b6ecd817035427faf80), [`3a30912`](https://github.com/KleitonBarone/webhook-recovery/commit/3a30912facd3ba997cf82b3a565c33844d403742) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39276325710/job/118141454727) | [`75fd0b5`](https://github.com/KleitonBarone/webhook-recovery/commit/75fd0b5c05a5f958223c260cabd12e1ba4e92689) |
| 6 | [#7](https://github.com/KleitonBarone/webhook-recovery/pull/7) Investigate and replay events in the console | [`f19545e`](https://github.com/KleitonBarone/webhook-recovery/commit/f19545e29153873cdbba86d5dcf471704e349c4a), [`1d06980`](https://github.com/KleitonBarone/webhook-recovery/commit/1d069802fa04aa1d86f1140088e4b1b31de94aca), [`1f4fe23`](https://github.com/KleitonBarone/webhook-recovery/commit/1f4fe23ff37b2a2bf6e4f310e7e4f09ae7db4a0a), [`312258a`](https://github.com/KleitonBarone/webhook-recovery/commit/312258ae9b8b92ae6af11e0db9fd83dea22bac9f) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39307769703/job/118249177263) | [`9c46ddf`](https://github.com/KleitonBarone/webhook-recovery/commit/9c46ddfdd37932d62bdf97c0a95eba10d5ef8ebd) |
| 7 | [#8](https://github.com/KleitonBarone/webhook-recovery/pull/8) Make processing and recovery outcomes inspectable | [`af3cfbc`](https://github.com/KleitonBarone/webhook-recovery/commit/af3cfbc7f146b2b3c150ecaa3a8630eecd41e247), [`f71f16d`](https://github.com/KleitonBarone/webhook-recovery/commit/f71f16d8cf1eb4c1cf8fb37a74b9a0d6c0c318b9) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39310086353/job/118257102419) | [`c43ecda`](https://github.com/KleitonBarone/webhook-recovery/commit/c43ecdae982ca7720c15978f8e20e8bf2b90cb34) |
| 8 | [#9](https://github.com/KleitonBarone/webhook-recovery/pull/9) Measure the local lab and document its limits | [`f1076b7`](https://github.com/KleitonBarone/webhook-recovery/commit/f1076b70eee830feeacbd07d61d38d3204d34a45), [`b0d3e87`](https://github.com/KleitonBarone/webhook-recovery/commit/b0d3e8757312f34fdd61bd41929c5d4ef0a4d8ba) | [Passed](https://github.com/KleitonBarone/webhook-recovery/actions/runs/39311768855/job/118262890822) | [`bebc97e`](https://github.com/KleitonBarone/webhook-recovery/commit/bebc97eed1730ef01320058b8c38614b6186e691) |

The two extra console-stage commits fix verified Windows manifest reader locks
and require readiness from the owned API/console processes. They are included
in #7 rather than leaving corrective work on an unmerged branch.

## Final documentation PR

The `docs/project-completion` branch contains the two planned work commits:

1. [`a415918`](https://github.com/KleitonBarone/webhook-recovery/commit/a415918):
   `Add recorded recovery walkthroughs and clean-checkout evidence`.
2. `Finish project documentation and the completion ledger`.

Its [GitHub PR #10 record](https://github.com/KleitonBarone/webhook-recovery/pull/10)
is the authority for its final reviewed head, successful check, actual merge SHA,
and merged status. [Main workflow runs](https://github.com/KleitonBarone/webhook-recovery/actions/workflows/check.yml?query=branch%3Amain)
record the check for that merge. This document cannot contain its own future
commit or merge SHA. The final handoff verifies those records, ancestry, and local
`main == origin/main` after the merge rather than creating another ledger PR.

There were 22 planned work commits. Two verified console corrections bring the
completed sequence to 24 work commits plus ten GitHub merge commits.

## Evidence and reproduction

- [Fresh-checkout rehearsal](docs/rehearsal.md), seven successful documented
  commands, all 15 integration groups, clean source revision, and matching resource
  inventories. The final PR changes documentation/evidence only.
- [English walkthroughs](docs/walkthrough.md), exact media checksums, captions,
  transcripts, screenshots, and raw actual-process-termination proof.
- [Case study](docs/case-study.md), transaction boundaries, ordering, fencing,
  retention, and external-effect limitations.
- [Finite workload](docs/measurements.md), 600 validated acceptance responses,
  500 unique outcomes, no failures/timeouts, raw per-delivery timings, and eight
  verified invariants at the measured revision.
- [Setup](docs/setup.md), [scenario guide](docs/scenarios.md), and
  [recovery runbook](docs/recovery.md) for repeating the behavior.

Selected large media and raw command/process logs are intentionally retained at
`C:/Users/admin/Videos/webhook-recovery/2026-10-19-bebc97e`, outside Git and
rotating scratch reports. There is no public hosting dependency.

## Cleanup and final handoff gates

Verification, browser-failure, coordinator-interruption, reset, and repeated
cleanup exercises passed. The independent rehearsal inventory has no owned
processes, containers, or volumes, and preserves all 41 existing Docker networks.
The clone's contents, owned recording browser/profile, unused task-pulled PostgreSQL
image, and 718 MiB task-only browser cache were removed after preserving evidence.
Windows held the empty rehearsal directory open; it has no files or retained data.
See the [cleanup record](docs/evidence/cleanup.json) for the measured inventory.
Source, one Windows dependency tree, the shared pnpm store, existing networks,
user tools, and published evidence are intentional retention. No retained developer
database was created. No global prune or WSL shutdown was used.

The final handoff checks every linked PR, merge ancestry, latest main CI, clean
local main, exact resource inventory, and disk usage. Its runtime audit is preserved
beside the recordings as `final-audit.json`; this captures facts available only
after this document's PR is merged. Future maintenance uses [THREAD_START.md](THREAD_START.md).
