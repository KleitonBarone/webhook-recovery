import Fastify from "fastify";
import type { Configuration } from "./config.js";
import type { Database } from "./database.js";
import { demoRoutes } from "./demo.js";
import { RequestError } from "./errors.js";
import { intakeRoutes } from "./intake.js";
import { operatorRoutes } from "./operator.js";

export function createServer(
  connection: Database,
  options: Pick<Configuration, "demo"> = { demo: false },
) {
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
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestError)
      return reply.code(error.statusCode).send({ error: error.message });
    const status =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const failureCode =
      cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    request.log.error(
      {
        failure: error instanceof Error ? error.name : "UnknownError",
        code:
          typeof failureCode === "string" && /^[A-Z0-9_]{1,32}$/.test(failureCode)
            ? failureCode
            : undefined,
      },
      "Request failed",
    );
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
