import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { retainReports } from "../scripts/reports.js";

test("report rotation removes expired screenshots and orphans without failing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webhook-recovery-reports-"));
  try {
    const ids = Array.from({ length: 6 }, (_, index) => index.toString(16).padStart(16, "0"));
    for (const [index, id] of ids.entries()) {
      const path = join(directory, `${id}.json`);
      await writeFile(path, "{}");
      await utimes(path, index + 1, index + 1);
      await writeFile(join(directory, `${id}.png`), "screenshot");
    }
    await writeFile(join(directory, "ffffffffffffffff.png"), "orphan");
    await retainReports(directory);
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ids.slice(1).flatMap((id) => [`${id}.json`, `${id}.png`]),
    );
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("webhook-recovery-reports-"));
    await rm(directory, { recursive: true });
  }
});
