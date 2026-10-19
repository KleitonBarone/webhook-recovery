import { type } from "arktype";

const Configuration = type({
  databaseUrl: "string.url",
  port: "number.integer >= 0 & number <= 65535",
  demo: "boolean",
  sourceSecret: "string >= 24",
  operatorToken: "string >= 24",
  viewerToken: "string >= 24",
});

// Configuration never silently falls back to a shared or production database.
export function configuration(env = process.env) {
  const value = Configuration.assert({
    databaseUrl: env.DATABASE_URL,
    port: Number(env.API_PORT ?? 4331),
    demo: env.DEMO_MODE === "true",
    sourceSecret: env.SOURCE_SECRET,
    operatorToken: env.OPERATOR_TOKEN,
    viewerToken: env.VIEWER_TOKEN,
  });
  const url = new URL(value.databaseUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !/^\/webhook_recovery_[a-z0-9_]+$/.test(url.pathname)
  ) {
    throw new Error("This local lab requires a loopback webhook_recovery_* database");
  }
  return value;
}

export type Configuration = ReturnType<typeof configuration>;
