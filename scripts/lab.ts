import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { parseEnv } from "node:util";
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
import {
  availablePort,
  availableSubnet,
  browserProfilePath,
  docker,
  execute,
  readyHttp,
  replaceManifest,
  root,
  runtimeInfo,
  until,
} from "./runtime.js";

const runs = join(root, ".local", "runs");
const reports = join(root, ".local", "reports");
const children = new Map<number, ChildProcess>();
const Manifest = type({
  id: "string",
  project: "string",
  disposable: "boolean",
  created: "string",
  processes: type({ pid: "number.integer", marker: "string", "profile?": "string" }).array(),
  containers: "string[]",
  volumes: "string[]",
  apiPort: "number.integer",
  "uiPort?": "number.integer",
});
type Manifest = typeof Manifest.infer;
function location(id: string) {
  if (!/^(dev|[a-f0-9]{16})$/.test(id)) throw new Error("Invalid run ID");
  const path = resolve(runs, id);
  if (!path.startsWith(`${resolve(runs)}${sep}`)) throw new Error("Invalid scratch path");
  return path;
}
async function save(run: Manifest) {
  const pending = join(location(run.id), `manifest.${process.pid}.new.json`);
  await writeFile(pending, JSON.stringify(run, null, 2));
  await replaceManifest(pending, join(location(run.id), "manifest.json"));
}
async function load(id: string) {
  const run = Manifest.assert(
    JSON.parse(await readFile(join(location(id), "manifest.json"), "utf8")),
  );
  const project = id === "dev" ? "webhook-recovery" : `webhook-recovery-verify-${id}`;
  if (run.id !== id || run.project !== project || run.disposable !== (id !== "dev"))
    throw new Error("Run ownership mismatch");
  return run;
}
function compose(run: Manifest, args: string[]) {
  return docker([
    "compose",
    "-p",
    run.project,
    "--env-file",
    `.local/runs/${run.id}/compose.env`,
    "-f",
    "compose.yaml",
    ...args,
  ]);
}
async function restrictFile(path: string) {
  if (process.platform === "win32") {
    await execute(
      "icacls",
      [path, "/inheritance:r", "/grant:r", `${process.env.USERDOMAIN}\\${process.env.USERNAME}:F`],
      { windowsHide: true },
    );
  }
}
async function environment(run: Manifest) {
  return parseEnv(await readFile(join(location(run.id), "app.env"), "utf8"));
}
async function ownedProcess(pid: number, marker: string) {
  if (!marker.startsWith(`webhook-recovery-`)) throw new Error("Invalid process marker");
  if (process.platform === "win32") {
    const { stdout } = await execute(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
      ],
      { windowsHide: true },
    );
    if (marker.endsWith("-browser")) return stdout.includes(`--recovery-run=${marker}`);
    return marker.endsWith("-wsl")
      ? stdout.includes("--exec bash") && stdout.includes(marker)
      : stdout.includes(`--title=${marker}`);
  }
  const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  return command.includes(marker);
}
async function stopProcesses(run: Manifest, preserveWsl = true) {
  for (const child of [...run.processes].reverse()) {
    if (!child.marker.startsWith(`webhook-recovery-${run.id}-`))
      throw new Error("Process ownership mismatch");
    if (preserveWsl && child.marker.endsWith("-wsl")) continue;
    if (await ownedProcess(child.pid, child.marker)) {
      children.get(child.pid)?.stdin?.end();
      try {
        if (child.marker.endsWith("-browser") && process.platform === "win32")
          await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            timeout: 5000,
          });
        else if (child.marker.endsWith("-browser")) process.kill(-child.pid, "SIGTERM");
        else process.kill(child.pid, "SIGTERM");
      } catch (error) {
        if (await ownedProcess(child.pid, child.marker)) throw error;
      }
      await until(async () => !(await ownedProcess(child.pid, child.marker)), 5000).catch(
        async () => {
          if (await ownedProcess(child.pid, child.marker)) process.kill(child.pid, "SIGKILL");
        },
      );
    }
    if (child.profile) {
      if (!child.marker.endsWith("-browser")) throw new Error("Profile without browser ownership");
      await rm(browserProfilePath(child.profile), {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 50,
      });
    }
    children.delete(child.pid);
  }
  run.processes = preserveWsl ? run.processes.filter((child) => child.marker.endsWith("-wsl")) : [];
  await save(run);
}
async function cleanup(run: Manifest) {
  try {
    await stopProcesses(run);
    const { stdout } = await docker([
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${run.project}`,
    ]);
    for (const id of stdout.trim().split(/\s+/).filter(Boolean)) {
      const inspected = await docker([
        "inspect",
        "--format",
        '{{index .Config.Labels "recovery.run"}}',
        id,
      ]);
      if (inspected.stdout.trim() !== run.id) throw new Error("Container ownership mismatch");
    }
    const volumeList = await docker([
      "volume",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${run.project}`,
    ]);
    for (const volume of volumeList.stdout.trim().split(/\s+/).filter(Boolean)) {
      const inspected = await docker([
        "volume",
        "inspect",
        "--format",
        '{{index .Labels "recovery.run"}}',
        volume,
      ]);
      if (inspected.stdout.trim() !== run.id) throw new Error("Volume ownership mismatch");
    }
    await compose(run, ["down", ...(run.disposable ? ["--volumes"] : []), "--remove-orphans"]);
    const remaining = await docker([
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${run.project}`,
    ]);
    assert.equal(remaining.stdout.trim(), "", "Containers left behind");
    const networks = await docker([
      "network",
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${run.project}`,
    ]);
    assert.equal(networks.stdout.trim(), "", "Networks left behind");
    if (run.disposable) {
      const volumes = await docker([
        "volume",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${run.project}`,
      ]);
      assert.equal(volumes.stdout.trim(), "", "Volumes left behind");
    }
  } finally {
    await stopProcesses(run, false);
  }
  if (run.disposable) await rm(location(run.id), { recursive: true });
}
// A foreground command keeps WSL alive. Pipe EOF also releases it if Node dies.
async function startWsl(run: Manifest) {
  if (process.platform !== "win32") return;
  const marker = `webhook-recovery-${run.id}-wsl`;
  const child = spawn(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--exec",
      "bash",
      "--noprofile",
      "--norc",
      "-c",
      "printf 'ready\\n'; read -r line",
      marker,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let ready = false;
  child.stdout.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("ready")) ready = true;
  });
  child.stderr.resume();
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) throw new Error("Missing WSL holder PID");
  children.set(child.pid, child);
  run.processes.push({ pid: child.pid, marker });
  await save(run);
  await until(async () => {
    if (child.exitCode !== null) throw new Error("WSL foreground session exited during startup");
    return ready;
  });
}
async function startProcess(
  run: Manifest,
  name: string,
  script: string,
  overrides: Partial<
    Record<
      "RETRY_BASE_MS" | "WORKER_LEASE_MS" | "LAB_PAUSE_AT" | "LAB_PAUSE_INBOX" | "UI_PORT",
      string
    >
  > = {},
) {
  const marker = `webhook-recovery-${run.id}-${name}`;
  const log = createWriteStream(join(location(run.id), `${name}.log`), { flags: "w" });
  const child = spawn(process.execPath, [`--title=${marker}`, "--import", "tsx", script], {
    cwd: root,
    env: { ...process.env, ...(await environment(run)), ...overrides },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let written = 0;
  const record = (chunk: Buffer) => {
    const bounded = chunk.subarray(0, Math.max(0, 1024 * 1024 - written));
    if (bounded.length) log.write(bounded);
    written += bounded.length;
  };
  if (!child.stdout || !child.stderr) throw new Error("Missing child output pipes");
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.once("close", () => log.end());
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) throw new Error("Missing child PID");
  children.set(child.pid, child);
  run.processes.push({ pid: child.pid, marker });
  await save(run);
  const readyEvent =
    script === "src/worker.ts"
      ? "worker_ready"
      : script === "src/api.ts"
        ? "api_ready"
        : script === "web/dev.ts"
          ? "console_ready"
          : undefined;
  if (readyEvent) {
    const ready = `"pid":${child.pid}`;
    await until(async () => {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Owned ${name} exited before readiness; inspect its bounded log`);
      return (
        await readFile(join(location(run.id), `${name}.log`), "utf8").catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
          throw error;
        })
      )
        .split("\n")
        .some((line) => line.includes(`"event":"${readyEvent}"`) && line.includes(ready));
    });
  }
  return child;
}
async function startConsole(run: Manifest) {
  run.uiPort ??= run.id === "dev" ? 4330 : await availablePort();
  await save(run);
  await startProcess(run, "console", "web/dev.ts", { UI_PORT: String(run.uiPort) });
  const base = `http://127.0.0.1:${run.uiPort}`;
  await until(() => readyHttp(base));
  return base;
}
async function startDatabase(id: string) {
  await mkdir(location(id), { recursive: true });
  const run: Manifest = {
    id,
    project: id === "dev" ? "webhook-recovery" : `webhook-recovery-verify-${id}`,
    disposable: id !== "dev",
    created: new Date().toISOString(),
    processes: [],
    containers: [],
    volumes: [],
    apiPort: id === "dev" ? 4331 : await availablePort(),
  };
  await save(run);
  const password = randomBytes(24).toString("hex");
  const subnet = await availableSubnet();
  const composeEnv = join(location(id), "compose.env");
  await writeFile(
    composeEnv,
    `DB_PASSWORD=${password}\nDB_NAME=webhook_recovery_${id === "dev" ? "dev" : "verify"}\nDB_PORT=${id === "dev" ? 55433 : 0}\nLAB_RUN=${id}\nLAB_SUBNET=${subnet}\n`,
    { mode: 0o600 },
  );
  await restrictFile(composeEnv);
  try {
    await startWsl(run);
    await compose(run, ["up", "-d", "--wait", "--wait-timeout", "60"]);
    run.containers = (await compose(run, ["ps", "-q"])).stdout.trim().split(/\s+/).filter(Boolean);
    run.volumes = (
      await docker([
        "volume",
        "ls",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${run.project}`,
      ])
    ).stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const published = (await compose(run, ["port", "postgres", "5432"])).stdout.trim();
    const port = Number(published.split(":").at(-1));
    const appEnv = join(location(id), "app.env");
    await writeFile(
      appEnv,
      `DATABASE_URL=postgres://recovery:${password}@127.0.0.1:${port}/webhook_recovery_${id === "dev" ? "dev" : "verify"}\nAPI_PORT=${run.apiPort}\nDEMO_MODE=true\nSOURCE_SECRET=${randomBytes(24).toString("hex")}\nOPERATOR_TOKEN=${randomBytes(24).toString("hex")}\nVIEWER_TOKEN=${randomBytes(24).toString("hex")}\nLAB_RUN=${id}\nWORKER_LEASE_MS=30000\nMAX_ATTEMPTS=3\nRETRY_BASE_MS=1000\n`,
      { mode: 0o600 },
    );
    await restrictFile(appEnv);
    await save(run);
    return run;
  } catch (error) {
    await cleanup(run);
    throw error;
  }
}
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
async function retainReports() {
  const entries = await readdir(reports, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^[a-f0-9]{16}\.json$/.test(entry.name))
      .map(async (entry) => ({
        path: join(reports, entry.name),
        info: await stat(join(reports, entry.name)),
      })),
  );
  files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  let size = 0;
  const kept = new Set<string>();
  for (const [index, file] of files.entries()) {
    const imagePath = file.path.replace(/\.json$/, ".png");
    const imageInfo = await stat(imagePath).catch(() => null);
    size += file.info.size + (imageInfo?.size ?? 0);
    if (index >= 5 || size > 100 * 1024 * 1024) {
      await rm(file.path);
      await rm(imagePath, { force: true });
    } else kept.add(file.path.replace(/\.json$/, ""));
  }
  for (const entry of entries)
    if (
      entry.isFile() &&
      /^[a-f0-9]{16}\.png$/.test(entry.name) &&
      !kept.has(join(reports, entry.name.replace(/\.png$/, "")))
    )
      await rm(join(reports, entry.name));
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
async function verify() {
  const unfinished = (await readdir(runs).catch(() => [])).filter((id) => id !== "dev");
  if (unfinished.length)
    throw new Error(`Reconcile unfinished runs first with cleanup --run: ${unfinished.join(", ")}`);
  const id = randomBytes(8).toString("hex");
  let run: Manifest | undefined;
  const report: {
    run: string;
    revision: string;
    dirty: boolean;
    node: string;
    checks: string[];
    settings?: {
      leaseMs: number;
      maxAttempts: number;
      retryBaseMs: number;
      restartTestRetryBaseMs: number;
    };
    error?: string;
    cleaned: boolean;
    logs?: string;
    workerLogs?: string;
    crashes?: Awaited<ReturnType<typeof verifyCrashes>>;
    demos?: Awaited<ReturnType<typeof verifyDemo>>;
    browser?: Awaited<ReturnType<typeof verifyBrowser>>;
    browserScreenshot?: string;
    environment?: Awaited<ReturnType<typeof runtimeInfo>>;
    databaseLogs?: string;
  } = {
    run: id,
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
      restartTestRetryBaseMs: 60000,
    };
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
    report.logs = (await readFile(join(location(id), "api.log"), "utf8").catch(() => "")).slice(
      -16384,
    );
    const workerLogs = (await readdir(location(id)).catch(() => []))
      .filter((name) => /^worker(?:-[a-z-]+)?\.log$/.test(name))
      .sort();
    report.workerLogs = (
      await Promise.all(
        workerLogs.map(
          async (name) =>
            `${name}\n${(await readFile(join(location(id), name), "utf8")).slice(-4096)}`,
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
      await retainReports();
      console.log(
        JSON.stringify({
          ...report,
          logs: undefined,
          workerLogs: undefined,
          databaseLogs: undefined,
        }),
      );
    }
  }
}

const command = process.argv[2];
if (command === "verify") await verify();
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
