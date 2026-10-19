import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { parseEnv } from "node:util";
import { type } from "arktype";
import { configuration } from "../src/config.js";
import { database, migrateDatabase, seedDatabase } from "../src/database.js";
import { sources } from "../src/schema.js";
import { availablePort, availableSubnet, docker, execute, root, until } from "./runtime.js";

const runs = join(root, ".local", "runs");
const reports = join(root, ".local", "reports");
const Manifest = type({
  id: "string",
  project: "string",
  disposable: "boolean",
  created: "string",
  processes: type({ pid: "number.integer", marker: "string" }).array(),
  containers: "string[]",
  volumes: "string[]",
  apiPort: "number.integer",
});
type Manifest = typeof Manifest.infer;
function location(id: string) {
  if (!/^(dev|[a-f0-9]{16})$/.test(id)) throw new Error("Invalid run ID");
  const path = resolve(runs, id);
  if (!path.startsWith(`${resolve(runs)}${sep}`)) throw new Error("Invalid scratch path");
  return path;
}
const save = (run: Manifest) =>
  writeFile(join(location(run.id), "manifest.json"), JSON.stringify(run, null, 2));
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
    return stdout.includes(`--title=${marker}`);
  }
  const command = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  return command.includes(marker);
}
async function stopProcesses(run: Manifest) {
  for (const child of [...run.processes].reverse()) {
    if (!child.marker.startsWith(`webhook-recovery-${run.id}-`))
      throw new Error("Process ownership mismatch");
    if (await ownedProcess(child.pid, child.marker)) {
      process.kill(child.pid, "SIGTERM");
      await until(async () => !(await ownedProcess(child.pid, child.marker)), 5000).catch(
        async () => {
          if (await ownedProcess(child.pid, child.marker)) process.kill(child.pid, "SIGKILL");
        },
      );
    }
  }
  run.processes = [];
  await save(run);
}
async function cleanup(run: Manifest) {
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
    await rm(location(run.id), { recursive: true });
  }
}
async function startProcess(run: Manifest, name: string, script: string) {
  const marker = `webhook-recovery-${run.id}-${name}`;
  const log = createWriteStream(join(location(run.id), `${name}.log`), { flags: "w" });
  const child = spawn(process.execPath, [`--title=${marker}`, "--import", "tsx", script], {
    cwd: root,
    env: { ...process.env, ...(await environment(run)) },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let written = 0;
  const record = (chunk: Buffer) => {
    const bounded = chunk.subarray(0, Math.max(0, 1024 * 1024 - written));
    if (bounded.length) log.write(bounded);
    written += bounded.length;
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  child.once("close", () => log.end());
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) throw new Error("Missing child PID");
  run.processes.push({ pid: child.pid, marker });
  await save(run);
  return child;
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
      `DATABASE_URL=postgres://recovery:${password}@127.0.0.1:${port}/webhook_recovery_${id === "dev" ? "dev" : "verify"}\nAPI_PORT=${run.apiPort}\nDEMO_MODE=true\nSOURCE_SECRET=${randomBytes(24).toString("hex")}\nOPERATOR_TOKEN=${randomBytes(24).toString("hex")}\nVIEWER_TOKEN=${randomBytes(24).toString("hex")}\nLAB_RUN=${id}\n`,
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
  for (const [index, file] of files.entries()) {
    size += file.info.size;
    if (index >= 5 || size > 100 * 1024 * 1024) await rm(file.path);
  }
}
async function verify() {
  const id = randomBytes(8).toString("hex");
  let run: Manifest | undefined;
  const report: {
    run: string;
    revision: string;
    node: string;
    checks: string[];
    error?: string;
    cleaned: boolean;
    logs?: string;
  } = {
    run: id,
    revision: (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(),
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
    report.checks.push("migrate-and-idempotent-seed");
    if (process.env.LAB_FAIL_AT === "startup") throw new Error("Injected startup failure");
    await startProcess(run, "api", "src/api.ts");
    await startProcess(run, "worker", "src/worker.ts");
    const apiPort = run.apiPort;
    await until(async () => {
      if (controller.signal.aborted) abort();
      return (await fetch(`http://127.0.0.1:${apiPort}/health`)).ok;
    });
    report.checks.push("real-http-database-readiness");
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
    report.error = error instanceof Error ? error.message : "Verification failed";
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    report.logs = (await readFile(join(location(id), "api.log"), "utf8").catch(() => "")).slice(
      -16384,
    );
    try {
      if (run) await cleanup(run);
      report.cleaned = true;
    } finally {
      await mkdir(reports, { recursive: true });
      await writeFile(join(reports, `${id}.json`), JSON.stringify(report, null, 2));
      await retainReports();
      console.log(JSON.stringify({ ...report, logs: undefined }));
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
  console.log({ unfinished: await readdir(runs).catch(() => []) });
} else if (command === "cleanup") {
  const id = process.argv[process.argv.indexOf("--run") + 1];
  if (!id || id === "dev") throw new Error("Provide --run <disposable-run-id>");
  const found = await readFile(join(location(id), "manifest.json"), "utf8").catch(() => null);
  if (found) await cleanup(await load(id));
  console.log(`Cleanup verified for ${id}`);
} else if (command === "db-up" || command === "dev") {
  const exists = await readFile(join(location("dev"), "manifest.json"), "utf8").catch(() => null);
  const run = exists ? await load("dev") : await startDatabase("dev");
  if (exists) await compose(run, ["up", "-d", "--wait"]);
  await prepare(run);
  if (command === "dev") {
    if (run.processes.length)
      throw new Error("Development processes already registered; use dev:down first");
    await startProcess(run, "api", "src/api.ts");
    await startProcess(run, "worker", "src/worker.ts");
    console.log(`API http://127.0.0.1:${run.apiPort}; credentials in .local/runs/dev/app.env`);
    try {
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    } finally {
      await cleanup(run);
    }
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
} else throw new Error("Unknown lab command");
