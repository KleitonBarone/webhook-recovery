import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pauseSettings } from "../src/worker-pause.js";

test("worker pauses require explicit demo mode, owned IPC, and a valid event boundary", () => {
  const env = { LAB_PAUSE_INBOX: randomUUID(), LAB_PAUSE_AT: "before_commit" };
  assert.equal(pauseSettings(false, false, {}), null);
  assert.throws(() => pauseSettings(false, true, env));
  assert.throws(() => pauseSettings(true, false, env));
  assert.throws(() => pauseSettings(true, true, { ...env, LAB_PAUSE_AT: "arbitrary" }));
  assert.throws(() => pauseSettings(true, true, { LAB_PAUSE_AT: "claimed" }));
  assert.deepEqual(pauseSettings(true, true, env), {
    inboxId: env.LAB_PAUSE_INBOX,
    boundary: "before_commit",
  });
});
