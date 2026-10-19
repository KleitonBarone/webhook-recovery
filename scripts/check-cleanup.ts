import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { docker, execute, root, until } from "./runtime.js";

const args = ["--import", "tsx", "scripts/lab.ts"];
const runRoot = join(root, ".local", "runs");
async function inventory() {
  return Promise.all([
    docker(["ps", "-aq", "--filter", "label=recovery.run"]),
    docker(["volume", "ls", "-q", "--filter", "label=recovery.run"]),
    docker(["network", "ls", "-q", "--filter", "label=recovery.run"]),
  ]).then((results) => results.map((result) => result.stdout.trim()));
}
const baseline = await inventory();
for (const fault of ["", "", "startup", "test", "interrupt"]) {
  let result: { stdout: string; stderr: string };
  try {
    result = await execute(process.execPath, [...args, "verify"], {
      cwd: root,
      env: { ...process.env, LAB_FAIL_AT: fault },
      windowsHide: true,
    });
    assert.equal(fault, "");
  } catch (error) {
    const failure = type({ code: "number", stdout: "string", stderr: "string" }).assert(error);
    assert.notEqual(fault, "");
    assert.equal(failure.code, 1);
    result = failure;
  }
  const report = type({ cleaned: "boolean" }).assert(
    JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}"),
  );
  assert.equal(report.cleaned, true, result.stderr);
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
    const found = (await readdir(runRoot)).find((candidate) => !before.includes(candidate));
    if (!found) return false;
    id = found;
    const manifest = type({ processes: "unknown[]", apiPort: "number" }).assert(
      JSON.parse(await readFile(join(runRoot, found, "manifest.json"), "utf8")),
    );
    return (
      manifest.processes.length === 2 &&
      (await fetch(`http://127.0.0.1:${manifest.apiPort}/health`)).ok
    );
  });
} finally {
  child.kill("SIGKILL");
  await exited;
  if (id) {
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
