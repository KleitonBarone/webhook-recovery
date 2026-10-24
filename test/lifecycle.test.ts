import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { location, save, startDatabase } from "../scripts/lifecycle.js";
import { execute, root } from "../scripts/runtime.js";

test("failed subnet allocation leaves no unfinished run or credentials", async () => {
  const id = randomBytes(8).toString("hex");
  const path = location(id);
  assert.equal(path, join(root, ".local", "runs", id));
  const failure = new Error("Subnet allocation failed before creating services");
  try {
    await assert.rejects(
      startDatabase(id, async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    await assert.rejects(access(path), { code: "ENOENT" });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("CLI cleanup recovers a partial run before Compose or credential files exist", async () => {
  const id = randomBytes(8).toString("hex");
  const path = location(id);
  assert.equal(path, join(root, ".local", "runs", id));
  await mkdir(path, { recursive: true });
  try {
    await save({
      id,
      project: `webhook-recovery-verify-${id}`,
      disposable: true,
      created: new Date().toISOString(),
      processes: [],
      containers: [],
      volumes: [],
      apiPort: 0,
      composeStarted: false,
    });
    await execute(process.execPath, ["--import", "tsx", "scripts/lab.ts", "cleanup", "--run", id], {
      cwd: root,
    });
    await assert.rejects(access(path), { code: "ENOENT" });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("CLI cleanup removes only empty runs when their manifest is missing", async () => {
  const id = randomBytes(8).toString("hex");
  const path = location(id);
  assert.equal(path, join(root, ".local", "runs", id));
  const cleanup = () =>
    execute(process.execPath, ["--import", "tsx", "scripts/lab.ts", "cleanup", "--run", id], {
      cwd: root,
    });
  await mkdir(path);
  try {
    await cleanup();
    await assert.rejects(access(path), { code: "ENOENT" });
    await cleanup();
    await mkdir(path);
    const retained = join(path, "unknown.txt");
    await writeFile(retained, "Preserve this file");
    await assert.rejects(cleanup());
    assert.equal(await readFile(retained, "utf8"), "Preserve this file");
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
