import assert from "node:assert/strict";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import type { Configuration } from "../src/config.js";
import { Receipt } from "../src/contract.js";
import { database } from "../src/database.js";
import { sessions, sources } from "../src/schema.js";

export async function verifyOperator(
  base: string,
  config: Configuration,
  accepted: { first: typeof Receipt.infer; otherId: string },
) {
  const auth = { authorization: `Bearer ${config.operatorToken}` };
  assert.equal((await fetch(`${base}/api/events`)).status, 401);
  assert.equal((await fetch(`${base}/api/events/${accepted.first.id}`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/events`, {
        headers: { authorization: `Bearer ${config.sourceSecret}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(`${base}/api/events/${accepted.otherId}`, { headers: auth })).status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/api/events/${accepted.otherId}/receipt`, { headers: auth })).status,
    404,
  );
  for (const query of ["limit=101", "limit=-1", "offset=10001", "state=oops", "sourceId=other"])
    assert.equal((await fetch(`${base}/api/events?${query}`, { headers: auth })).status, 400);
  const list = await fetch(`${base}/api/events?limit=1`, { headers: auth });
  assert.equal(list.status, 200);
  const page = type({
    items: type({ id: "string.uuid" }).array(),
    nextOffset: "number | null",
  }).assert(await list.json());
  assert.equal(page.items.length, 1);
  assert.ok(page.items.every((item) => item.id !== accepted.otherId));
  const receipt = await fetch(`${base}/api/events/${accepted.first.id}/receipt`, { headers: auth });
  assert.deepEqual(Receipt.assert(await receipt.json()), accepted.first);
  const login = (origin: string | undefined, token: string) =>
    fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify({ token }),
    });
  assert.equal((await login(undefined, config.operatorToken)).status, 403);
  assert.equal((await login("http://evil.invalid", config.operatorToken)).status, 403);
  assert.equal((await login(base, config.sourceSecret)).status, 401);
  const entered = await login(base, config.viewerToken);
  assert.equal(entered.status, 200);
  const sessionCookie = entered.headers.get("set-cookie");
  assert.ok(sessionCookie);
  assert.ok(sessionCookie?.includes("HttpOnly"));
  assert.ok(sessionCookie.includes("SameSite=Strict"));
  const cookie = sessionCookie.split(";")[0];
  assert.ok(cookie);
  const headers = { cookie };
  assert.equal((await fetch(`${base}/api/events/${accepted.first.id}`, { headers })).status, 200);
  const info = await fetch(`${base}/api/session`, { headers });
  assert.deepEqual(await info.json(), { sourceId: "demo", role: "viewer" });
  assert.equal((await fetch(`${base}/api/session`, { method: "DELETE", headers })).status, 403);
  assert.equal(
    (
      await fetch(`${base}/api/session`, {
        method: "DELETE",
        headers: { ...headers, origin: base },
      })
    ).status,
    200,
  );

  const connection = database(config);
  try {
    await connection.db.update(sources).set({ enabled: false }).where(eq(sources.id, "demo"));
    assert.equal((await fetch(`${base}/api/events`, { headers: auth })).status, 401);
    await connection.db.update(sources).set({ enabled: true }).where(eq(sources.id, "demo"));
    await connection.db.update(sessions).set({ expiresAt: new Date(0) });
    assert.equal((await fetch(`${base}/api/events`, { headers: auth })).status, 401);
  } finally {
    await connection.db.update(sources).set({ enabled: true }).where(eq(sources.id, "demo"));
    await connection.db.update(sessions).set({ expiresAt: new Date(Date.now() + 86400000) });
    await connection.client.end();
  }
}
