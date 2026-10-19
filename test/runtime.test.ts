import assert from "node:assert/strict";
import test from "node:test";
import { overlaps, until } from "../scripts/runtime.js";

test("subnet allocation rejects nested and adjacent network conflicts", () => {
  assert.equal(overlaps("10.232.0.0/28", "10.0.0.0/8"), true);
  assert.equal(overlaps("10.232.0.0/28", "10.232.0.8/29"), true);
  assert.equal(overlaps("10.232.0.0/28", "10.232.0.16/28"), false);
  assert.equal(overlaps("10.232.0.0/28", "172.17.0.0/16"), false);
});
test("verification surfaces an assertion error instead of retrying it as pending work", async () => {
  const failure = new Error("Unexpected inspection response");
  await assert.rejects(
    until(async () => {
      throw failure;
    }, 1),
    (error) => error === failure,
  );
});
