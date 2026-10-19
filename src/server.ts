import Fastify from "fastify";

export function createServer() {
  const app = Fastify({
    bodyLimit: 65536,
    logger: {
      redact: ["req.headers", "res.headers", "password", "token", "signature"],
    },
  });
  app.get("/health", async () => ({ status: "ready" }));
  return app;
}
