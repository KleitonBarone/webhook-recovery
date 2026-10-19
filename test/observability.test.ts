import assert from "node:assert/strict";
import test from "node:test";
import { type } from "arktype";
import { createObserver, diagnostic } from "../src/observability.js";

test("observations use fixed counters and exclude extra credential/payload fields", () => {
  const lines: string[] = [];
  const record = createObserver((line) => lines.push(line));
  const input = {
    inboxId: "inbox",
    payload: "PRIVATE_PAYLOAD",
    token: "PRIVATE_TOKEN",
    headers: "PRIVATE_HEADERS",
  };
  record("accepted", input);
  record("duplicate", input);
  record("duplicate", input);
  record("attempt_claimed", input);
  const Observation = type({ counters: { "[string]": "number" } });
  const values = lines.map((line) => Observation.assert(JSON.parse(line)));
  const latest = values.at(-1);
  assert.ok(latest);
  assert.deepEqual(
    values.map((value) => value.counters.duplicate),
    [0, 1, 2, 2],
  );
  assert.equal(latest.counters.accepted, 1);
  assert.equal(Object.keys(latest.counters).length, 10);
  assert.equal(lines.join("").includes("PRIVATE_"), false);
  assert.equal(Object.keys(latest.counters).includes("inbox"), false);
});
test("diagnostics retain controlled failures and SQLSTATE without messages or parameters", () => {
  const error = new Error("SQL and PRIVATE_TOKEN", {
    cause: { code: "23514", parameters: "PRIVATE_PAYLOAD" },
  });
  assert.equal(diagnostic(error), "Error (23514)");
  assert.equal(diagnostic(new Error("Injected test failure")), "Injected test failure");
  error.name = "PRIVATE_TOKEN";
  assert.equal(diagnostic(error), "Error (23514)");
});
