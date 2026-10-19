import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

export const execute = promisify(execFile);
export const root = resolve(import.meta.dirname, "..");
const linuxRoot = root
  .replace(/\\/g, "/")
  .replace(/^([A-Z]):/i, (_, drive: string) => `/mnt/${drive.toLowerCase()}`);

export async function docker(args: string[]) {
  const command = process.platform === "win32" ? "wsl" : "docker";
  const prefix =
    process.platform === "win32" ? ["-d", "Ubuntu", "--cd", linuxRoot, "--exec", "docker"] : [];
  return execute(command, [...prefix, ...args], {
    cwd: root,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 120000,
  });
}

export async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No allocated port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

// Allocate a small project subnet without consuming Docker's exhausted default pools.
export function overlaps(left: string, right: string) {
  const range = (cidr: string) => {
    const [address = "", bits = "32"] = cidr.split("/");
    const ip = address.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
    const mask = (0xffffffff << (32 - Number(bits))) >>> 0;
    return { start: (ip & mask) >>> 0, end: ((ip & mask) | ~mask) >>> 0 };
  };
  const a = range(left);
  const b = range(right);
  return a.start <= b.end && b.start <= a.end;
}
export async function availableSubnet() {
  const ids = (await docker(["network", "ls", "-q"])).stdout.trim().split(/\s+/).filter(Boolean);
  const networks = (
    await docker([
      "network",
      "inspect",
      ...ids,
      "--format",
      "{{range .IPAM.Config}}{{println .Subnet}}{{end}}",
    ])
  ).stdout;
  const routes =
    process.platform === "win32"
      ? (
          await execute("wsl", ["-d", "Ubuntu", "--exec", "ip", "-4", "route"], {
            windowsHide: true,
          })
        ).stdout
      : (await execute("ip", ["-4", "route"])).stdout;
  const occupied = [...`${networks}\n${routes}`.matchAll(/\b\d+\.\d+\.\d+\.\d+\/\d+\b/g)].map(
    (match) => match[0],
  );
  for (let slot = 0; slot < 256; slot++) {
    const candidate = `10.232.${slot}.0/28`;
    if (!occupied.some((cidr) => overlaps(candidate, cidr))) return candidate;
  }
  throw new Error("No free project subnet; specify an isolated local environment");
}

export async function until(check: () => Promise<boolean>, timeout = 30000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await setTimeout(100);
  } while (Date.now() < end);
  throw new Error("Readiness/assertion deadline exceeded");
}

// Startup alone may retry connection refusal or a not-yet-ready health response.
export async function readyHttp(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null);
  return response?.ok ?? false;
}
