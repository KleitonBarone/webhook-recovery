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
  assert.throws(() => configuration({}));
});
