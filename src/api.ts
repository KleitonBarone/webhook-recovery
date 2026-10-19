import { configuration } from "./config.js";
import { database } from "./database.js";
import { createServer } from "./server.js";

const config = configuration();
const connection = database(config);
const app = createServer(connection, config);
app.addHook("onClose", () => connection.client.end());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close());
}
await app.listen({ host: "127.0.0.1", port: config.port });
