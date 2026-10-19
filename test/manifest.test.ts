import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { replaceManifest } from "../scripts/runtime.js";

test("Windows manifest replacement tolerates a brief reader lock", {
  skip: process.platform !== "win32",
  timeout: 10000,
}, async () => {
  const folder = await mkdtemp(join(tmpdir(), "webhook-recovery-manifest-"));
  const target = join(folder, "manifest.json");
  const pending = join(folder, "manifest.new.json");
  await writeFile(target, "old");
  await writeFile(pending, "new");
  const reader = spawn(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "$file=[IO.File]::Open($env:RENAME_TEST_PATH,'Open','Read','ReadWrite'); try { [Console]::WriteLine('locked'); [Console]::ReadLine() } finally { $file.Dispose() }",
    ],
    {
      env: { ...process.env, RENAME_TEST_PATH: target },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    },
  );
  const exited = new Promise<void>((resolve) => reader.once("exit", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      reader.once("error", reject);
      reader.stdout.once("data", () => resolve());
      reader.once("exit", (code) => {
        if (code) reject(new Error("Lock reader failed"));
      });
    });
    const release = setTimeout(250).then(() => {
      if (!reader.stdin.writableEnded) reader.stdin.end("release\n");
    });
    await replaceManifest(pending, target);
    await release;
    assert.equal(await readFile(target, "utf8"), "new");
  } finally {
    if (!reader.stdin.writableEnded) reader.stdin.end("release\n");
    await exited;
    await rm(folder, { recursive: true });
  }
});
