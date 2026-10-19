import { configuration } from "./config.js";
import { createServer } from "./server.js";

const config = configuration();
const app = createServer();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close());
}
await app.listen({ host: "127.0.0.1", port: config.port });
