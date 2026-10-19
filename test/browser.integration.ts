import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { browserTools } from "../scripts/browser.js";
import type { Configuration } from "../src/config.js";
import { Detail } from "../src/messages.js";

// One recovery story against the real console, API, worker, and PostgreSQL.
export async function verifyBrowser(
  base: string,
  config: Configuration,
  scratch: string,
  lifecycle: {
    signal: AbortSignal;
    started(pid: number, marker: string, profile: string): Promise<void>;
    stopped(pid: number): Promise<void>;
  },
) {
  const { chromium, expect } = await browserTools();
  const marker = `webhook-recovery-${basename(scratch)}-browser`;
  const server = await chromium.launchServer({
    host: "127.0.0.1",
    args: [`--recovery-run=${marker}`],
    artifactsDir: join(scratch, "browser-artifacts"),
    downloadsPath: join(scratch, "browser-artifacts"),
  });
  const pid = server.process().pid;
  let registered = false;
  try {
    const profile = server
      .process()
      .spawnargs.find((arg) => arg.startsWith("--user-data-dir="))
      ?.slice("--user-data-dir=".length);
    if (!pid || !profile) throw new Error("Browser process ownership unavailable");
    await lifecycle.started(pid, marker, profile);
    registered = true;
    const browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (errors.length < 5) errors.push(error.name);
    });
    try {
      await page.goto(base, { timeout: 20000 });
      await page.getByLabel("Operator or viewer credential").fill(config.operatorToken);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      if (process.env.LAB_FAIL_AT === "browser_hold")
        await new Promise<void>((resolve) =>
          lifecycle.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      await page.getByRole("button", { name: "Exhaust retries", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible(
        {
          timeout: 20000,
        },
      );
      const id = await page.locator(".identifier").innerText();
      async function detail() {
        const response = await page.request.get(`${base}/api/events/${id}`);
        assert.equal(response.status(), 200);
        return Detail.assert(await response.json());
      }
      const failed = await detail();
      if (process.env.LAB_FAIL_AT === "browser") throw new Error("Injected browser failure");
      assert.equal(failed.event.reason, "retry_budget_exhausted");
      assert.deepEqual(
        failed.attempts.map((attempt) => attempt.outcome),
        ["retry_scheduled", "retry_scheduled", "dead_lettered"],
      );
      await expect(page.locator(".attempts > li")).toHaveCount(3);
      await expect(page.getByRole("button", { name: "Request replay" })).toBeDisabled();
      await page.getByRole("button", { name: "Repair demo cause" }).click();
      await expect(
        page.getByText("Demo cause repaired. Request replay to start a new cycle."),
      ).toBeVisible();
      const reason = "Repaired the local sample handler after inspecting exhausted retries";
      await page.getByLabel("Replay reason").fill(reason);
      await page.getByRole("button", { name: "Request replay" }).click();
      await expect(page.getByRole("heading", { name: "Processed", exact: true })).toBeVisible({
        timeout: 20000,
      });
      await expect(page.locator(".attempts > li")).toHaveCount(4);
      await expect(page.locator(".replay-audit > li")).toHaveCount(1);
      await expect(page.getByText("1 entry", { exact: true })).toBeVisible();
      const recovered = await detail();
      assert.equal(recovered.event.id, failed.event.id);
      assert.equal(recovered.event.acceptedAt, failed.event.acceptedAt);
      assert.equal(recovered.event.raw, failed.event.raw);
      assert.equal(recovered.event.bodyHash, failed.event.bodyHash);
      assert.deepEqual(recovered.attempts.slice(0, 3), failed.attempts);
      assert.equal(recovered.attempts[3]?.outcome, "processed");
      assert.equal(recovered.replays[0]?.reason, reason);
      assert.equal(recovered.completions.length, 1);
      await page.getByRole("button", { name: "Redeliver original" }).click();
      await expect(
        page.getByText("Redelivery returned the same acceptance receipt."),
      ).toBeVisible();
      assert.equal((await detail()).attempts.length, 4);
      await expect(page.getByRole("button", { name: "Request replay" })).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.getByRole("button", { name: "Back to inbox" }).click();
      await page.getByLabel("Processing state").selectOption("received");
      await expect(page.getByRole("heading", { name: "No events in this view" })).toBeVisible();
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.getByLabel("Operator or viewer credential").fill(config.viewerToken);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText("Viewer", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Local simulator" })).toHaveCount(0);
      await page.locator(".event-row").first().click();
      await expect(page.getByText("Viewer access is read only.", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Request replay" })).toHaveCount(0);
      const denied = await page.request.post(`${base}/api/events/${id}/replay`, {
        headers: { origin: base },
        data: { idempotencyKey: crypto.randomUUID(), reason: "Viewer must be denied" },
      });
      assert.equal(denied.status(), 403);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      assert.deepEqual(errors, []);
      return {
        engine: browser.version(),
        inboxId: id,
        acceptancePreserved: true,
        earlierAttempts: 3,
        finalAttempts: recovered.attempts.length,
        replays: recovered.replays.length,
        completions: recovered.completions.length,
        viewerDenied: true,
        narrowLayout: true,
      };
    } catch (error) {
      // Never capture the credential entry form or an authentication trace.
      if (
        await page
          .locator(".workspace")
          .isVisible()
          .catch(() => false)
      )
        await page.screenshot({ path: join(scratch, "browser-failure.png") }).catch(() => {});
      throw error;
    }
  } finally {
    await server.close();
    if (registered && pid) await lifecycle.stopped(pid);
  }
}
