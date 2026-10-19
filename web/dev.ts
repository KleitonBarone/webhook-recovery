import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const app = await createServer({
  configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close());
await app.listen();
console.log(
  JSON.stringify({ event: "console_ready", pid: process.pid, url: app.resolvedUrls?.local[0] }),
);
