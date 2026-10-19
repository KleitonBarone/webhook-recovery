import Fastify, { LogController } from "fastify";
import type { Configuration } from "./config.js";
import type { Database } from "./database.js";
import { demoRoutes } from "./demo.js";
import { RequestError } from "./errors.js";
import { intakeRoutes } from "./intake.js";
import { diagnostic } from "./observability.js";
import { operatorRoutes } from "./operator.js";

export function createServer(
  connection: Database,
  options: Pick<Configuration, "demo"> = { demo: false },
  logStream?: { write(line: string): void },
) {
  const app = Fastify({
    bodyLimit: 65536,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      redact: ["req.headers", "res.headers", "password", "token", "signature"],
      ...(logStream ? { stream: logStream } : {}),
    },
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "Route not found" }));
  app.addHook("onResponse", async (request, reply) => {
    request.log.info({
      event: "http_completed",
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      statusCode: reply.statusCode,
    });
  });
  app.get("/health", async () => {
    await connection.client`select 1`;
    return { status: "ready" };
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestError)
      return reply.code(error.statusCode).send({ error: error.message });
    const status =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    request.log.error({ event: "request_failed", failure: diagnostic(error) }, "Request failed");
    const code = status >= 400 && status < 500 ? status : 500;
    const message =
      status === 413
        ? "Request body too large"
        : status === 415
          ? "Unsupported media type"
          : "Request failed";
    return reply.code(code).send({ error: message });
  });
  intakeRoutes(app, connection);
  operatorRoutes(app, connection, options.demo);
  if (options.demo) demoRoutes(app, connection);
  return app;
}
