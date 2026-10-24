import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { configuration } from "../src/config.js";
import { database, migrateDatabase, seedDatabase } from "../src/database.js";
import { diagnostic } from "../src/observability.js";
import { sources } from "../src/schema.js";
import { runSender } from "../src/sender.js";
import { verifyBrowser } from "../test/browser.integration.js";
import { verifyClaims } from "../test/claims.integration.js";
import { verifyConsole } from "../test/console.integration.js";
import { verifyCrashes } from "../test/crash.integration.js";
import { verifyDemo } from "../test/demo.integration.js";
import { verifyIntake } from "../test/intake.integration.js";
import { verifyRedaction } from "../test/observability.integration.js";
import { verifyOperator } from "../test/operator.integration.js";
import { verifyProcessing, verifyWorkerProcess } from "../test/processing.integration.js";
import { verifyRecovery } from "../test/recovery.integration.js";
import { verifyReplay } from "../test/replay.integration.js";
import { verifyRetries } from "../test/retries.integration.js";
import { verifySeedRoles, verifySeedRotation } from "../test/seed.integration.js";
import { readLogTail } from "./bounded-log.js";
import {
  children,
  cleanup,
  compose,
  environment,
  load,
  location,
  type Manifest,
  ownedProcess,
  runs,
  save,
  startConsole,
  startDatabase,
  startProcess,
  startWsl,
  stopProcesses,
} from "./lifecycle.js";
import { retainReports } from "./reports.js";
import {
  browserProfilePath,
  docker,
  execute,
  readyHttp,
  root,
  runtimeInfo,
  until,
} from "./runtime.js";
import { measureWorkload } from "./workload.js";

const reports = join(root, ".local", "reports");
async function prepare(run: Manifest) {
  const config = configuration(await environment(run));
  const connection = database(config);
  try {
    await connection.client`select 1`;
    const journal = type({
      version: "string",
      dialect: "string",
      entries: type({
        idx: "number",
        version: "string",
        when: "number",
        tag: /^[a-z0-9_]+$/,
        breakpoints: "boolean",
      }).array(),
    }).assert(JSON.parse(await readFile(join(root, "drizzle", "meta", "_journal.json"), "utf8")));
    if (run.disposable && journal.entries.length > 1) {
      const previous = join(location(run.id), "previous-migrations");
      const entries = journal.entries.slice(0, -1);
      await mkdir(join(previous, "meta"), { recursive: true });
      await writeFile(
        join(previous, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries }),
      );
      for (const entry of entries)
        await copyFile(
          join(root, "drizzle", `${entry.tag}.sql`),
          join(previous, `${entry.tag}.sql`),
        );
      await migrate(connection.db, { migrationsFolder: previous });
      await seedDatabase(connection, config);
    }
    await migrateDatabase(connection);
    await seedDatabase(connection, config);
    await seedDatabase(connection, config);
    assert.equal((await connection.db.select().from(sources)).length, 2);
  } finally {
    await connection.client.end();
  }
}
async function diskBytes(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) return 0;
      return entry.isDirectory() ? diskBytes(child) : (await stat(child)).size;
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}
async function verify(mode: "verify" | "measure" = "verify") {
  const unfinished = (await readdir(runs).catch(() => [])).filter((id) => id !== "dev");
  if (unfinished.length)
    throw new Error(`Reconcile unfinished runs first with cleanup --run: ${unfinished.join(", ")}`);
  const id = randomBytes(8).toString("hex");
  let run: Manifest | undefined;
  const report: {
    run: string;
    mode: "verify" | "measure";
    revision: string;
    dirty: boolean;
    node: string;
    checks: string[];
    settings?: {
      leaseMs: number;
      maxAttempts: number;
      retryBaseMs: number;
      restartTestRetryBaseMs?: number;
    };
    error?: string;
    cleaned: boolean;
    logs?: string;
    workerLogs?: string;
    crashes?: Awaited<ReturnType<typeof verifyCrashes>>;
    demos?: Awaited<ReturnType<typeof verifyDemo>>;
    browser?: Awaited<ReturnType<typeof verifyBrowser>>;
    browserScreenshot?: string;
    workload?: Awaited<ReturnType<typeof measureWorkload>>;
    environment?: Awaited<ReturnType<typeof runtimeInfo>>;
    databaseLogs?: string;
  } = {
    run: id,
    mode,
    revision: (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(),
    dirty: !!(await execute("git", ["status", "--porcelain"], { cwd: root })).stdout.trim(),
    node: process.version,
    checks: [],
    cleaned: false,
  };
  const abort = () => {
    throw new Error("Verification interrupted");
  };
  // Convert interruption into the same awaited finally path as assertion failures.
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    run = await startDatabase(id);
    await prepare(run);
    const inspectedDatabase = database(configuration(await environment(run)));
    try {
      const [version] = type({ version: "string" })
        .array()
        .assert(await inspectedDatabase.client`select version() as version`);
      if (!version) throw new Error("PostgreSQL version unavailable");
      report.environment = await runtimeInfo(version.version);
    } finally {
      await inspectedDatabase.client.end();
    }
    report.checks.push("migrate-upgrade-with-seeded-data-and-idempotent-seed");
    if (process.env.LAB_FAIL_AT === "startup") throw new Error("Injected startup failure");
    await startProcess(run, "api", "src/api.ts");
    await startProcess(run, "worker", "src/worker.ts");
    const apiPort = run.apiPort;
    await until(async () => {
      if (controller.signal.aborted) abort();
      return readyHttp(`http://127.0.0.1:${apiPort}/health`);
    });
    report.checks.push("real-http-database-readiness");
    const base = `http://127.0.0.1:${apiPort}`;
    const currentRun = run;
    const config = configuration(await environment(run));
    report.settings = {
      leaseMs: config.leaseMs,
      maxAttempts: config.maxAttempts,
      retryBaseMs: config.retryBaseMs,
      ...(mode === "verify" ? { restartTestRetryBaseMs: 60000 } : {}),
    };
    if (mode === "measure") {
      report.workload = await measureWorkload(base, config, id, controller.signal);
      if (!report.workload.passed) throw new Error("Workload correctness failed");
      report.checks.push("finite-workload-receipts-processing-and-completion-invariants");
      return;
    }
    await verifySeedRoles(base, config);
    await verifySeedRotation(base, config);
    report.checks.push("seeded-credential-roles-rotation-and-retired-token-revocation");
    const accepted = await verifyIntake(base, config, async () => {
      await stopProcesses(currentRun);
      await startProcess(currentRun, "api", "src/api.ts");
      await startProcess(currentRun, "worker", "src/worker.ts");
      await until(() => readyHttp(`${base}/health`));
    });
    report.checks.push("signed-intake-concurrency-conflicts-restart-database-failure");
    await verifyOperator(base, config, accepted);
    report.checks.push("operator-cookie-origin-expiry-source-permissions-bounded-inspection");
    await verifyRedaction(config);
    report.checks.push("structured-log-redaction-in-headers-queries-bodies-and-errors");
    await stopProcesses(currentRun);
    await startProcess(currentRun, "api", "src/api.ts");
    await until(() => readyHttp(`${base}/health`));
    await verifyClaims(base, config);
    report.checks.push("skip-locked-claims-expiry-takeover-and-write-fencing");
    await verifyProcessing(base, config);
    report.checks.push("atomic-effects-receipts-ordering-business-deduplication");
    await verifyRetries(base, config);
    report.checks.push("durable-retry-schedules-classification-and-cycle-budgets");
    await verifyReplay(base, config);
    report.checks.push("audited-idempotent-replay-preserves-acceptance-and-failure-history");
    await verifyRecovery(base, config, async (withWorker) => {
      await stopProcesses(currentRun);
      await startProcess(currentRun, "api", "src/api.ts");
      if (withWorker)
        await startProcess(currentRun, "worker", "src/worker.ts", { RETRY_BASE_MS: "60000" });
      await until(() => readyHttp(`${base}/health`));
    });
    report.checks.push("replay-races-rollback-permissions-cycle-budgets-and-real-worker-restart");
    report.crashes = await verifyCrashes(base, config, {
      start: (name, pause) =>
        startProcess(currentRun, `worker-${name}`, "src/worker.ts", {
          WORKER_LEASE_MS: "2000",
          LAB_PAUSE_AT: pause?.boundary ?? "",
          LAB_PAUSE_INBOX: pause?.inboxId ?? "",
        }),
      stop: async (worker, force = false) => {
        const registered = currentRun.processes.find((entry) => entry.pid === worker.pid);
        if (!registered?.marker.startsWith(`webhook-recovery-${currentRun.id}-worker-`))
          throw new Error("Unowned crash worker");
        const alive = await ownedProcess(registered.pid, registered.marker);
        if (force) assert.equal(alive, true, "Worker exited before planned termination");
        if (alive) {
          process.kill(registered.pid, force ? "SIGKILL" : "SIGTERM");
          await until(async () => !(await ownedProcess(registered.pid, registered.marker)), 5000);
        }
        currentRun.processes = currentRun.processes.filter((entry) => entry.pid !== registered.pid);
        children.delete(registered.pid);
        await save(currentRun);
      },
      resume: async (worker, inboxId) => {
        if (!worker.send || !worker.connected) throw new Error("Crash worker IPC disconnected");
        await new Promise<void>((resolve, reject) =>
          worker.send({ kind: "resume", inboxId }, (error) => (error ? reject(error) : resolve())),
        );
      },
      log: (name) => readFile(join(location(currentRun.id), `worker-${name}.log`), "utf8"),
    });
    report.checks.push("actual-pre-post-commit-termination-and-resumed-owner-fencing");
    await startProcess(currentRun, "worker", "src/worker.ts");
    await verifyWorkerProcess(base, config);
    report.checks.push("real-worker-process-end-to-end");
    report.demos = await verifyDemo(base, config);
    report.checks.push("demo-gates-signed-http-delivery-redelivery-repair-and-replay");
    const consoleBase = await startConsole(currentRun);
    await verifyConsole(consoleBase, config, report.demos[0]?.receipt.id, location(currentRun.id));
    report.checks.push("console-readiness-same-origin-session-proxy-and-private-file-denial");
    report.browser = await verifyBrowser(consoleBase, config, location(currentRun.id), {
      signal: controller.signal,
      started: async (pid, marker, profile) => {
        browserProfilePath(profile);
        if (marker !== `webhook-recovery-${currentRun.id}-browser`)
          throw new Error("Browser ownership mismatch");
        currentRun.processes.push({ pid, marker, profile });
        await save(currentRun);
      },
      stopped: async (pid) => {
        const child = currentRun.processes.find((entry) => entry.pid === pid);
        if (!child?.profile || !child.marker.endsWith("-browser"))
          throw new Error("Browser registration missing");
        if (await ownedProcess(pid, child.marker)) throw new Error("Browser process still alive");
        await rm(browserProfilePath(child.profile), {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 50,
        });
        currentRun.processes = currentRun.processes.filter((entry) => entry.pid !== pid);
        await save(currentRun);
      },
    });
    report.checks.push("browser-exhaustion-investigation-repair-replay-history-and-permissions");
    if (process.env.LAB_FAIL_AT === "hold")
      console.log(JSON.stringify({ event: "lab_ready", run: id, console: consoleBase }));
    if (process.env.LAB_FAIL_AT === "test") throw new Error("Injected test failure");
    if (process.env.LAB_FAIL_AT === "interrupt") {
      controller.abort();
      abort();
    }
    if (process.env.LAB_FAIL_AT === "hold") {
      await new Promise<void>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }
    if (controller.signal.aborted) abort();
  } catch (error) {
    report.error = diagnostic(error);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    report.logs = await readLogTail(join(location(id), "api.log"), 16384).catch(
      () => "API diagnostics unavailable",
    );
    const workerLogs = (await readdir(location(id)).catch(() => []))
      .filter((name) => /^worker(?:-[a-z-]+)?\.log$/.test(name))
      .sort();
    report.workerLogs = (
      await Promise.all(
        workerLogs.map(
          async (name) =>
            `${name}\n${await readLogTail(join(location(id), name), 4096).catch(() => "Worker diagnostics unavailable")}`,
        ),
      )
    )
      .join("\n")
      .slice(-32768);
    if (run)
      report.databaseLogs = (
        await compose(run, ["logs", "--no-color", "--tail", "80", "postgres"]).catch(() => ({
          stdout: "Database diagnostics unavailable",
        }))
      ).stdout
        .split("\n")
        .filter((line) => !/DETAIL:|STATEMENT:|CONTEXT:|parameters:/.test(line))
        .join("\n")
        .slice(-16384);
    try {
      try {
        const screenshot = join(location(id), "browser-failure.png");
        const screenshotInfo = await stat(screenshot).catch(() => null);
        if (screenshotInfo && screenshotInfo.size <= 2 * 1024 * 1024) {
          await mkdir(reports, { recursive: true });
          await copyFile(screenshot, join(reports, `${id}.png`));
          report.browserScreenshot = `.local/reports/${id}.png`;
        }
      } finally {
        if (run) await cleanup(run);
        else if (await readFile(join(location(id), "manifest.json"), "utf8").catch(() => null))
          await cleanup(await load(id));
        report.cleaned = true;
      }
    } finally {
      await mkdir(reports, { recursive: true });
      await writeFile(join(reports, `${id}.json`), JSON.stringify(report, null, 2));
      await retainReports(reports);
      console.log(
        JSON.stringify({
          ...report,
          logs: undefined,
          workerLogs: undefined,
          databaseLogs: undefined,
          workload: report.workload ? { ...report.workload, deliveries: undefined } : undefined,
        }),
      );
    }
  }
}

const command = process.argv[2];
if (command === "verify" || command === "measure") await verify(command);
else if (command === "check") {
  await docker(["version", "--format", "{{.Server.Version}}"]);
  console.log(JSON.stringify({ node: process.version, docker: "available", root }));
} else if (command === "status") {
  console.log(
    (
      await docker([
        "ps",
        "-a",
        "--filter",
        "label=recovery.run",
        "--format",
        "{{.ID}} {{.Names}} {{.Status}}",
      ])
    ).stdout,
  );
  console.log((await docker(["volume", "ls", "--filter", "label=recovery.run"])).stdout);
  const manifests = [];
  for (const id of await readdir(runs).catch(() => [])) {
    const run = await load(id);
    const processes = await Promise.all(
      run.processes.map(async (child) => ({
        ...child,
        alive: await ownedProcess(child.pid, child.marker),
      })),
    );
    manifests.push({
      id,
      retained: !run.disposable,
      apiPort: run.apiPort,
      uiPort: run.uiPort,
      processes,
    });
  }
  console.log(
    JSON.stringify({ runs: manifests, scratchBytes: await diskBytes(join(root, ".local")) }),
  );
} else if (command === "cleanup" || command === "demo-reset") {
  const optionIndex = process.argv.indexOf("--run");
  const id = optionIndex < 0 ? undefined : process.argv[optionIndex + 1];
  if (!id || id === "dev") throw new Error("Provide --run <disposable-run-id>");
  const found = await readFile(join(location(id), "manifest.json"), "utf8").catch(() => null);
  if (found) {
    const run = await load(id);
    if (command === "demo-reset" && (await environment(run)).DEMO_MODE !== "true")
      throw new Error("Reset requires an explicitly disposable demo environment");
    await cleanup(run);
  }
  console.log(
    command === "demo-reset"
      ? JSON.stringify({ reset: true, run: id, method: "disposable_environment_teardown" })
      : `Cleanup verified for ${id}`,
  );
} else if (command === "db-up" || command === "dev") {
  const exists = await readFile(join(location("dev"), "manifest.json"), "utf8").catch(() => null);
  const run = exists ? await load("dev") : await startDatabase("dev");
  if (exists) {
    for (const child of run.processes)
      if (await ownedProcess(child.pid, child.marker))
        throw new Error("Development processes already registered; use dev:down first");
  }
  try {
    if (exists) {
      await stopProcesses(run, false);
      await startWsl(run);
      await compose(run, ["up", "-d", "--wait"]);
    }
    await prepare(run);
    if (command === "dev") {
      await startProcess(run, "api", "src/api.ts");
      await startProcess(run, "worker", "src/worker.ts");
      const consoleBase = await startConsole(run);
      console.log(
        `Console ${consoleBase}; API http://127.0.0.1:${run.apiPort}; credentials in .local/runs/dev/app.env`,
      );
    }
    if (command === "dev" || process.platform === "win32") {
      if (command === "db-up")
        console.log("Database ready; keep this terminal open. Ctrl+C stops it and preserves data.");
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
        for (const child of children.values()) child.once("exit", () => resolve());
      });
    }
  } finally {
    if (command === "dev" || process.platform === "win32") await cleanup(run);
  }
} else if (command === "db-down" || command === "dev-down") await cleanup(await load("dev"));
else if (command === "migrate" || command === "seed") {
  const config = configuration(await environment(await load("dev")));
  const connection = database(config);
  try {
    if (command === "migrate") await migrateDatabase(connection);
    else await seedDatabase(connection, config);
  } finally {
    await connection.client.end();
  }
} else if (command === "sender") {
  const run = await load(process.env.LAB_RUN ?? "dev");
  await runSender(
    `http://127.0.0.1:${run.apiPort}`,
    configuration(await environment(run)),
    (process.argv[3] === "--" ? process.argv[4] : process.argv[3]) ?? "success",
  );
} else throw new Error("Unknown lab command");
