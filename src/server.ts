import Fastify from "fastify";
import type { Database } from "./database.js";

export function createServer(connection: Database) {
  const app = Fastify({
    bodyLimit: 65536,
    logger: {
      redact: ["req.headers", "res.headers", "password", "token", "signature"],
    },
  });
  app.get("/health", async () => {
    await connection.client`select 1`;
    return { status: "ready" };
  });
  return app;
}
