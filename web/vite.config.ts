import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  const apiPort = Number(process.env.API_PORT ?? 4331);
  const uiPort = Number(process.env.UI_PORT ?? (demo ? 4173 : 4330));
  for (const port of demo ? [uiPort] : [apiPort, uiPort])
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid local console port");
  const proxy = demo
    ? {}
    : { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } };
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [react(), tailwindcss()],
    build: { outDir: demo ? "dist-demo" : "dist" },
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
  };
});
