import { setTimeout } from "node:timers/promises";
import { configuration } from "./config.js";

configuration();
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => stop.abort());
}
while (!stop.signal.aborted) {
  await setTimeout(250, undefined, { signal: stop.signal }).catch(() => {});
}
