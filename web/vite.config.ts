import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.API_PORT ?? 4331);
const uiPort = Number(process.env.UI_PORT ?? 4330);
for (const port of [apiPort, uiPort])
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid local console port");
const proxy = { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } };
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: uiPort,
    strictPort: true,
    proxy,
    forwardConsole: false,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/.local/**",
        "**/app.env",
        "**/compose.env",
      ],
    },
  },
  preview: { host: "127.0.0.1", port: uiPort, strictPort: true, proxy },
});
