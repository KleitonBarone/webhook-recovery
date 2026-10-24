import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import { parseEnv } from "node:util";
import { type } from "arktype";
import { createBoundedLog } from "./bounded-log.js";
import {
  availablePort,
  availableSubnet,
  browserProfilePath,
  docker,
  execute,
  readyHttp,
  replaceManifest,
  root,
  until,
} from "./runtime.js";

export const runs = join(root, ".local", "runs");
export const children = new Map<number, ChildProcess>();
const logCompletions = new Map<number, Promise<void>>();
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
  "composeStarted?": "boolean",
});
export type Manifest = typeof Manifest.infer;
export function location(id: string) {
  if (!/^(dev|[a-f0-9]{16})$/.test(id)) throw new Error("Invalid run ID");
  const path = resolve(runs, id);
  if (!path.startsWith(`${resolve(runs)}${sep}`)) throw new Error("Invalid scratch path");
  return path;
}
export async function save(run: Manifest) {
  const pending = join(location(run.id), `manifest.${process.pid}.new.json`);
  await writeFile(pending, JSON.stringify(run, null, 2));
  await replaceManifest(pending, join(location(run.id), "manifest.json"));
}
export async function load(id: string) {
  const run = Manifest.assert(
    JSON.parse(await readFile(join(location(id), "manifest.json"), "utf8")),
  );
  const project = id === "dev" ? "webhook-recovery" : `webhook-recovery-verify-${id}`;
  if (run.id !== id || run.project !== project || run.disposable !== (id !== "dev"))
    throw new Error("Run ownership mismatch");
  return run;
}
export function compose(run: Manifest, args: string[]) {
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
export async function environment(run: Manifest) {
  return parseEnv(await readFile(join(location(run.id), "app.env"), "utf8"));
}
export async function ownedProcess(pid: number, marker: string) {
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
export async function stopProcesses(run: Manifest, preserveWsl = true) {
  if (run.processes.length === 0) return;
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
    await logCompletions.get(child.pid)?.catch(() => {});
    logCompletions.delete(child.pid);
    children.delete(child.pid);
  }
  run.processes = preserveWsl ? run.processes.filter((child) => child.marker.endsWith("-wsl")) : [];
  await save(run);
}
export async function cleanup(run: Manifest) {
  try {
    await stopProcesses(run);
    // This intent is saved before Compose can create anything. Older manifests
    // have no flag and keep the original ownership-checked teardown path.
    if (run.composeStarted === false) return;
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
    if (run.composeStarted === false) await rm(location(run.id), { recursive: true });
  }
  if (run.disposable) await rm(location(run.id), { recursive: true });
}
// A foreground command keeps WSL alive. Pipe EOF also releases it if Node dies.
export async function startWsl(run: Manifest) {
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
export async function startProcess(
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
  const env = await environment(run);
  const log = await createBoundedLog(join(location(run.id), `${name}.log`));
  const child = spawn(process.execPath, [`--title=${marker}`, "--import", "tsx", script], {
    cwd: root,
    env: { ...process.env, ...env, ...overrides },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  if (!child.stdout || !child.stderr) throw new Error("Missing child output pipes");
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const logClosed = finished(log);
  void logClosed.catch(() => {});
  log.once("error", () => {
    console.error(JSON.stringify({ event: "log_write_failed", process: name }));
    process.exitCode = 1;
    child.kill("SIGTERM");
  });
  child.once("close", () => log.end());
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) throw new Error("Missing child PID");
  logCompletions.set(child.pid, logClosed);
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
export async function startConsole(run: Manifest) {
  run.uiPort ??= run.id === "dev" ? 4330 : await availablePort();
  await save(run);
  await startProcess(run, "console", "web/dev.ts", { UI_PORT: String(run.uiPort) });
  const base = `http://127.0.0.1:${run.uiPort}`;
  await until(() => readyHttp(base));
  return base;
}
export async function startDatabase(id: string, allocateSubnet = availableSubnet) {
  const run: Manifest = {
    id,
    project: id === "dev" ? "webhook-recovery" : `webhook-recovery-verify-${id}`,
    disposable: id !== "dev",
    created: new Date().toISOString(),
    processes: [],
    containers: [],
    volumes: [],
    apiPort: id === "dev" ? 4331 : await availablePort(),
    composeStarted: false,
  };
  await mkdir(location(id), { recursive: true });
  try {
    await save(run);
    const password = randomBytes(24).toString("hex");
    const subnet = await allocateSubnet();
    const composeEnv = join(location(id), "compose.env");
    await writeFile(
      composeEnv,
      `DB_PASSWORD=${password}\nDB_NAME=webhook_recovery_${id === "dev" ? "dev" : "verify"}\nDB_PORT=${id === "dev" ? 55433 : 0}\nLAB_RUN=${id}\nLAB_SUBNET=${subnet}\n`,
      { mode: 0o600 },
    );
    await restrictFile(composeEnv);
    await startWsl(run);
    run.composeStarted = true;
    await save(run);
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
