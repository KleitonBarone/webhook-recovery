import assert from "node:assert/strict";
import test from "node:test";
import { percentile } from "../scripts/workload.js";

test("workload percentiles use nearest rank and preserve raw samples", () => {
  const values = [5, 1, 4, 2, 3];
  assert.equal(percentile(values, 0.5), 3);
  assert.equal(percentile(values, 0.95), 5);
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(values, [5, 1, 4, 2, 3]);
});
