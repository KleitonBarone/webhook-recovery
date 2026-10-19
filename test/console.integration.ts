import assert from "node:assert/strict";
import { basename } from "node:path";
import type { Configuration } from "../src/config.js";
import { Detail, InboxPage, Session } from "../src/messages.js";

// Exercise Vite's real HTTP proxy, including the browser's Host and Origin.
export async function verifyConsole(
  base: string,
  config: Configuration,
  id: string | undefined,
  scratch: string,
) {
  const request = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20000) });
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src\/main.tsx/);
  const script = await request("/src/main.tsx");
  assert.equal(script.status, 200);
  assert.equal((await request("/api/session")).status, 401);
  const login = await request("/api/session", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ token: config.viewerToken }),
  });
  assert.equal(login.status, 200);
  assert.equal(Session.assert(await login.json()).role, "viewer");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const events = await request("/api/events?limit=20", { headers: { cookie } });
  assert.equal(events.status, 200);
  assert.ok(InboxPage.assert(await events.json()).items.length);
  assert.ok(id);
  const detail = await request(`/api/events/${id}`, { headers: { cookie } });
  assert.equal(detail.status, 200);
  assert.equal(Detail.assert(await detail.json()).event.id, id);
  const denied = await request("/api/demo/fixtures", {
    method: "POST",
    headers: { cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ scenario: "success" }),
  });
  assert.equal(denied.status, 403);
  for (const path of [
    `/@fs/${scratch.replaceAll("\\", "/")}/app.env`,
    `/.local/runs/${basename(scratch)}/app.env`,
  ]) {
    const response = await request(path);
    const body = await response.text();
    if (path.startsWith("/@fs/")) assert.equal(response.status, 403);
    else if (response.status === 200) assert.match(body, /<html/);
    assert.equal(body.includes("DATABASE_URL="), false);
    for (const secret of [config.sourceSecret, config.operatorToken, config.viewerToken])
      assert.equal(body.includes(secret), false);
  }
}
