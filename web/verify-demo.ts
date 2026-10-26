import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { verifyDemoBrowser } from "../test/demo-browser.integration.js";

const server = await preview({
  configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
  mode: "demo",
  preview: { host: "127.0.0.1", port: 0, strictPort: true },
});
try {
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Demo preview port unavailable");
  console.log(JSON.stringify(await verifyDemoBrowser(`http://127.0.0.1:${address.port}`)));
} finally {
  if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
