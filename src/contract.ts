import { createHmac, timingSafeEqual } from "node:crypto";
import { type } from "arktype";
import { RequestError } from "./errors.js";

export const Event = type({
  schemaVersion: "1",
  type: "'refund.status_changed'",
  eventId: "string.uuid",
  refundId: /^[a-zA-Z0-9_-]{1,64}$/,
  version: "number.integer >= 1 & number <= 2147483647",
  status: "'pending' | 'completed' | 'failed'",
  "+": "reject",
});
export type Event = typeof Event.infer;
export const Receipt = type({ id: "string.uuid", eventId: "string.uuid", acceptedAt: "string" });
export const states = [
  "received",
  "processing",
  "retry_scheduled",
  "processed",
  "ignored_stale",
  "dead_lettered",
] as const;
export const State = type.enumerated(...states);
export const signatureToleranceSeconds = 300;

// Sign the original bytes. JSON normalization changes event identity and the signature.
export function signature(body: Buffer, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
export function verifySignature(body: Buffer, header: unknown, secret: string, now = Date.now()) {
  if (typeof header !== "string" || !/^t=\d{10},v1=[a-f0-9]{64}$/.test(header)) return false;
  const [timestampPart = "", signaturePart = ""] = header.split(",");
  const timestamp = Number(timestampPart.slice(2));
  if (Math.abs(Math.floor(now / 1000) - timestamp) > signatureToleranceSeconds) return false;
  const expected = signature(body, secret, timestamp).split("v1=")[1];
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signaturePart.slice(3), "hex"));
}
export function decodeEvent(body: Buffer) {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    return { payload: Event.assert(JSON.parse(raw)), raw };
  } catch {
    throw new RequestError(400, "Invalid event payload");
  }
}
