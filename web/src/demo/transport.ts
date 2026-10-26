import { type } from "arktype";
import { DemoScenario, State } from "../../../src/messages.js";
import { HttpError } from "../errors.js";
import { createDemoStore } from "./store.js";

const store = createDemoStore();
const Fixture = type({ scenario: DemoScenario, "+": "reject" });
const Replay = type({ idempotencyKey: "string.uuid", reason: "1 <= string <= 500", "+": "reject" });
const Pagination = type({
  limit: /^(?:[1-9]|[1-9][0-9]|100)$/,
  offset: /^(?:0|[1-9][0-9]{0,3}|10000)$/,
});
function body(init: RequestInit): unknown {
  try {
    if (typeof init.body !== "string") throw new Error("Missing body");
    return JSON.parse(init.body);
  } catch {
    throw new HttpError("Invalid demo action", 400);
  }
}

// Deliberately no network fallback: demo builds can never reach the real API.
export async function demoRequest(path: string, init: RequestInit = {}) {
  try {
    const data = await store;
    const url = new URL(path, "https://browser-demo.invalid");
    const method = init.method ?? "GET";
    if (url.pathname === "/session" && method === "GET")
      return Response.json({ sourceId: "demo", role: "operator", demo: true });
    const pagination = Pagination({
      limit: url.searchParams.get("limit") ?? "50",
      offset: url.searchParams.get("offset") ?? "0",
    });
    if (pagination instanceof type.errors) throw new HttpError("Invalid pagination", 400);
    const limit = Number(pagination.limit);
    const offset = Number(pagination.offset);
    if (url.pathname === "/events" && method === "GET") {
      const state = url.searchParams.get("state") ?? undefined;
      if (state !== undefined && !State.allows(state))
        throw new HttpError("Invalid state filter", 400);
      return Response.json(data.list(state, limit, offset));
    }
    if (url.pathname === "/demo/fixtures" && method === "POST") {
      const input = Fixture(body(init));
      if (input instanceof type.errors) throw new HttpError("Invalid sample", 400);
      return Response.json(await data.sample(input.scenario), { status: 202 });
    }
    const route =
      /^\/(demo\/)?events\/([a-f\d-]{36})(?:\/(repair|redeliver|replay|receipt|attempts|replays))?$/i.exec(
        url.pathname,
      );
    const id = route?.[2];
    const action = route?.[3];
    if (!id) throw new HttpError("Demo action not found", 404);
    if (method === "GET") {
      if (!action) return Response.json(data.detail(id));
      if (action === "receipt") return Response.json(data.receipt(id));
      if (action === "attempts" || action === "replays")
        return Response.json(data.history(id, action, limit, offset));
    }
    if (method === "POST") {
      if (action === "repair") return Response.json(data.repair(id));
      if (action === "redeliver") return Response.json(data.redeliver(id), { status: 202 });
      if (action === "replay") {
        const input = Replay(body(init));
        if (input instanceof type.errors) throw new HttpError("Invalid replay request", 400);
        return Response.json(data.replay(id, input), { status: 202 });
      }
    }
    throw new HttpError("Demo action not found", 404);
  } catch (error) {
    if (error instanceof HttpError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
