import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { execute, root } from "./runtime.js";

export const browserCache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  join(
    process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? homedir())
      : join(homedir(), ".cache"),
    "webhook-recovery-browser-cache",
  );
export async function browserTools() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache;
  return import("@playwright/test");
}
if (process.argv[2] === "install") {
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  const result = await execute(
    process.execPath,
    [cli, "install", "chromium", ...process.argv.slice(3)],
    {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache },
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    },
  );
  console.log(result.stdout);
}
