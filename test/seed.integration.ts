import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Configuration } from "../src/config.js";
import { database, seedDatabase } from "../src/database.js";
import { send } from "../src/sender.js";

async function session(base: string, token: string) {
  return fetch(`${base}/api/session`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function verifySeedRoles(base: string, config: Configuration) {
  const connection = database(config);
  const swapped = {
    ...config,
    operatorToken: config.viewerToken,
    viewerToken: config.operatorToken,
  };
  try {
    await seedDatabase(connection, swapped);
    assert.deepEqual(await (await session(base, swapped.viewerToken)).json(), {
      sourceId: "demo",
      role: "viewer",
      demo: true,
    });
    assert.deepEqual(await (await session(base, swapped.operatorToken)).json(), {
      sourceId: "demo",
      role: "operator",
      demo: true,
    });
    const denied = await fetch(`${base}/api/demo/fixtures`, {
      method: "POST",
      headers: {
        origin: base,
        "content-type": "application/json",
        authorization: `Bearer ${swapped.viewerToken}`,
      },
      body: JSON.stringify({ scenario: "success" }),
    });
    assert.equal(denied.status, 403);
  } finally {
    await seedDatabase(connection, config);
    await connection.client.end();
  }
}

export async function verifySeedRotation(base: string, config: Configuration) {
  const connection = database(config);
  const rotated = {
    ...config,
    sourceSecret: randomBytes(24).toString("hex"),
    operatorToken: randomBytes(24).toString("hex"),
    viewerToken: randomBytes(24).toString("hex"),
  };
  try {
    await seedDatabase(connection, rotated);
    // A validated signature reaches payload validation without creating inbox work.
    assert.equal((await send(base, rotated.sourceSecret, '{"invalid":true}')).status, 400);
    assert.equal((await send(base, config.sourceSecret, '{"invalid":true}')).status, 401);
    assert.equal((await session(base, config.operatorToken)).status, 401);
    assert.equal((await session(base, config.viewerToken)).status, 401);
    assert.equal((await session(base, rotated.operatorToken)).status, 200);
    assert.equal((await session(base, rotated.viewerToken)).status, 200);
  } finally {
    await seedDatabase(connection, config);
    await connection.client.end();
  }
}
