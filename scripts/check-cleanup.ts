import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { docker, execute, readyHttp, root, until } from "./runtime.js";

const args = ["--import", "tsx", "scripts/lab.ts"];
const runRoot = join(root, ".local", "runs");
async function inventory() {
  const resources = await Promise.all([
    docker(["ps", "-aq", "--filter", "label=recovery.run"]),
    docker(["volume", "ls", "-q", "--filter", "label=recovery.run"]),
    docker(["network", "ls", "-q", "--filter", "label=recovery.run"]),
  ]).then((results) => results.map((result) => result.stdout.trim()));
  const processes =
    process.platform === "win32"
      ? (
          await execute(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -match '--title=webhook-recovery-') -or ($_.Name -eq 'wsl.exe' -and $_.CommandLine -match 'webhook-recovery-(dev|[a-f0-9]{16})-wsl') } | Sort-Object ProcessId | ForEach-Object { $_.ProcessId }",
            ],
            { windowsHide: true },
          )
        ).stdout.trim()
      : (await execute("ps", ["-eo", "args="])).stdout
          .split("\n")
          .filter((line) => /--title=webhook-recovery-/.test(line))
          .sort()
          .join("\n");
  return [...resources, processes];
}
const baseline = await inventory();
const failureReasons = {
  startup: "Injected startup failure",
  test: "Injected test failure",
  interrupt: "Verification interrupted",
  crash_barrier: "Injected crash-barrier failure",
};
for (const fault of ["", "", "startup", "test", "interrupt", "crash_barrier"] as const) {
  let result: { stdout: string; stderr: string };
  let exitCode = 0;
  try {
    result = await execute(process.execPath, [...args, "verify"], {
      cwd: root,
      env: { ...process.env, LAB_FAIL_AT: fault },
      windowsHide: true,
    });
  } catch (error) {
    const failure = type({ code: "number", stdout: "string", stderr: "string" }).assert(error);
    exitCode = failure.code;
    result = failure;
  }
  const report = type({ cleaned: "boolean", "error?": "string" }).assert(
    JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}"),
  );
  assert.equal(report.cleaned, true, result.stderr);
  assert.equal(exitCode, fault ? 1 : 0, report.error ?? result.stderr);
  if (fault) assert.equal(report.error, failureReasons[fault]);
  else assert.equal(report.error, undefined);
  assert.deepEqual(await inventory(), baseline);
  console.log(`Verified cleanup: ${fault || "success"}`);
}

// A forcibly terminated coordinator cannot run finally; recover its exact manifest.
const before = await readdir(runRoot);
const child = spawn(process.execPath, [...args, "verify"], {
  cwd: root,
  env: { ...process.env, LAB_FAIL_AT: "hold" },
  windowsHide: true,
  stdio: "ignore",
});
const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
let id: string | undefined;
try {
  await until(async () => {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Verification coordinator exited before full-stack readiness");
    const found = (await readdir(runRoot)).find((candidate) => !before.includes(candidate));
    if (!found) return false;
    id = found;
    const text = await readFile(join(runRoot, found, "manifest.json"), "utf8").catch(
      (error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (!text) return false;
    const manifest = type({
      processes: type({ marker: "string" }).array(),
      apiPort: "number",
      "uiPort?": "number",
    }).assert(JSON.parse(text));
    return (
      manifest.processes.filter((child) => !child.marker.endsWith("-wsl")).length === 3 &&
      manifest.uiPort !== undefined &&
      (await readyHttp(`http://127.0.0.1:${manifest.apiPort}/health`)) &&
      (await readyHttp(`http://127.0.0.1:${manifest.uiPort}`))
    );
  }, 180000);
} finally {
  child.kill("SIGKILL");
  await exited;
  if (id) {
    await execute(process.execPath, [...args, "demo-reset", "--run", id], {
      cwd: root,
      windowsHide: true,
    });
    await execute(process.execPath, [...args, "cleanup", "--run", id], {
      cwd: root,
      windowsHide: true,
    });
    await execute(process.execPath, [...args, "cleanup", "--run", id], {
      cwd: root,
      windowsHide: true,
    });
  }
}
assert.ok(id);
assert.deepEqual(await inventory(), baseline);
console.log("Verified abrupt coordinator termination, recovery, and repeated cleanup");
