import { type } from "arktype";
import type { Claim } from "./claims.js";

export const Boundary = type.enumerated("claimed", "before_commit", "after_commit");
export type Boundary = typeof Boundary.infer;
const Pause = type({ inboxId: "string.uuid", boundary: Boundary });
const Resume = type({ kind: "'resume'", inboxId: "string.uuid" });

export function pauseSettings(demo: boolean, ipc: boolean, env = process.env) {
  if (!env.LAB_PAUSE_INBOX && !env.LAB_PAUSE_AT) return null;
  if (!demo || !ipc) throw new Error("Worker pause requires demo mode and an owned IPC channel");
  return Pause.assert({ inboxId: env.LAB_PAUSE_INBOX, boundary: env.LAB_PAUSE_AT });
}

// The harness resumes this exact event over its private parent-child IPC channel.
export function workerPause(demo: boolean) {
  const selected = pauseSettings(demo, process.connected ?? false);
  let used = false;
  return async (boundary: Boundary, owned: Claim) => {
    if (!selected || used || selected.boundary !== boundary || selected.inboxId !== owned.event.id)
      return;
    used = true;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(deadline);
        process.off("message", resume);
        process.off("disconnect", disconnected);
        if (error) reject(error);
        else resolve();
      };
      const resume = (message: unknown) => {
        if (Resume.allows(message) && message.inboxId === owned.event.id) finish();
      };
      const disconnected = () => finish(new Error("Worker pause parent disconnected"));
      const deadline = setTimeout(() => finish(new Error("Worker pause deadline exceeded")), 8000);
      process.on("message", resume);
      process.once("disconnect", disconnected);
      console.log(
        JSON.stringify({
          event: "worker_paused",
          boundary,
          inboxId: owned.event.id,
          attemptId: owned.attemptId,
          pid: process.pid,
        }),
      );
    });
  };
}
