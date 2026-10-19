import { randomUUID } from "node:crypto";
import type { Configuration } from "./config.js";
import { Event, signature } from "./contract.js";

export function fixture() {
  return Event.assert({
    schemaVersion: 1,
    type: "refund.status_changed",
    eventId: randomUUID(),
    refundId: `refund_${randomUUID().slice(0, 8)}`,
    version: 1,
    status: "completed",
  });
}
export function send(
  base: string,
  secret: string,
  body: string,
  source = "demo",
  timestamp?: number,
) {
  return fetch(`${base}/webhooks/${source}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-recovery-signature": signature(Buffer.from(body), secret, timestamp),
    },
    body,
  });
}
export async function runSender(base: string, config: Configuration, name: string) {
  if (name !== "success" && name !== "duplicate")
    throw new Error("Use sender -- success or sender -- duplicate");
  const body = JSON.stringify(fixture());
  const responses = await Promise.all(
    Array.from({ length: name === "duplicate" ? 5 : 1 }, () =>
      send(base, config.sourceSecret, body),
    ),
  );
  for (const response of responses)
    console.log(JSON.stringify({ status: response.status, receipt: await response.json() }));
  if (responses.some((response) => response.status !== 202))
    throw new Error("Sender acceptance failed");
}
