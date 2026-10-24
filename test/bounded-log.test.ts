import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import test from "node:test";
import { createBoundedLog } from "../scripts/bounded-log.js";

test("bounded logs retain later errors after exceeding their disk budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webhook-recovery-log-"));
  try {
    const budget = 1024 * 1024;
    const log = await createBoundedLog(join(directory, "worker.log"), budget);
    log.write(Buffer.alloc(budget, 120));
    log.end("LATER_PROCESSING_FAILURE\n");
    await finished(log);
    const files = (await readdir(directory)).map((name) => join(directory, name));
    const bytes = await Promise.all(files.map((path) => readFile(path)));
    const sizes = await Promise.all(files.map(async (path) => (await stat(path)).size));
    assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= budget);
    assert.ok(Buffer.concat(bytes).includes(Buffer.from("LATER_PROCESSING_FAILURE")));
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("webhook-recovery-log-"));
    await rm(directory, { recursive: true });
  }
});
