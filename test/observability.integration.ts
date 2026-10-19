import assert from "node:assert/strict";
import type { Configuration } from "../src/config.js";
import { database } from "../src/database.js";
import { createServer } from "../src/server.js";

export async function verifyRedaction(config: Configuration) {
  const connection = database(config);
  const lines: string[] = [];
  const app = createServer(
    connection,
    { demo: false },
    {
      write: (line) => {
        lines.push(line);
      },
    },
  );
  const marker = "SYNTHETIC_PRIVATE_MARKER_92751";
  app.get("/log-failure", () => {
    throw new Error(`SQL parameters ${marker}`, { cause: { code: "23514", detail: marker } });
  });
  try {
    for (const url of [
      `/health?token=${marker}`,
      `/missing/${marker}?signature=${marker}`,
      "/log-failure",
    ])
      await app.inject({
        url,
        headers: {
          authorization: `Bearer ${marker}`,
          cookie: `recovery_session=${marker}`,
          "x-recovery-signature": marker,
        },
      });
    await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      payload: { token: marker, payload: marker },
    });
    await app.inject({
      method: "POST",
      url: "/webhooks/demo",
      headers: { "x-recovery-signature": marker, "content-type": "application/json" },
      payload: { marker },
    });
    const output = lines.join("");
    for (const secret of [marker, config.operatorToken, config.sourceSecret, config.viewerToken])
      assert.equal(output.includes(secret), false);
    assert.ok(output.includes('"event":"http_completed"'));
    assert.ok(output.includes('"route":"/webhooks/:sourceId"'));
    assert.ok(output.includes("23514"));
    return { privateMarkersAbsent: true, requestRoutesTemplated: true, safeSqlStateRetained: true };
  } finally {
    await app.close();
    await connection.client.end();
  }
}
