import assert from "node:assert/strict";
import test from "node:test";
import { configuration } from "../src/config.js";

const env = {
  DATABASE_URL: "postgres://recovery:local@127.0.0.1:55433/webhook_recovery_test",
  SOURCE_SECRET: "test-source-secret-at-least-24",
  OPERATOR_TOKEN: "test-operator-token-at-least-24",
  VIEWER_TOKEN: "test-viewer-token-at-least-24",
};
test("configuration rejects remote or unrelated databases and invalid ports", () => {
  assert.equal(configuration(env).port, 4331);
  assert.throws(() =>
    configuration({ ...env, DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1", "example.com") }),
  );
  assert.throws(() =>
    configuration({
      ...env,
      DATABASE_URL: env.DATABASE_URL.replace("webhook_recovery_test", "customer"),
    }),
  );
  assert.throws(() => configuration({ ...env, API_PORT: "70000" }));
  assert.throws(() => configuration({ ...env, VIEWER_TOKEN: env.OPERATOR_TOKEN }));
  assert.throws(() => configuration({ ...env, OPERATOR_TOKEN: env.SOURCE_SECRET }));
  assert.throws(() => configuration({ ...env, MAX_ATTEMPTS: "0" }));
  assert.throws(() => configuration({ ...env, RETRY_BASE_MS: "99" }));
  assert.throws(() => configuration({}));
});

test("configured operator and viewer credentials fit the login API limit", () => {
  for (const field of ["OPERATOR_TOKEN", "VIEWER_TOKEN"] as const) {
    assert.doesNotThrow(() => configuration({ ...env, [field]: "a".repeat(256) }));
    assert.throws(() => configuration({ ...env, [field]: "a".repeat(257) }));
  }
});
