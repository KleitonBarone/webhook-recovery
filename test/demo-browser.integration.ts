import assert from "node:assert/strict";
import { browserTools } from "../scripts/browser.js";

export async function verifyDemoBrowser(base: string) {
  const { chromium, expect } = await browserTools();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const requests: string[] = [];
    const errors: string[] = [];
    context.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api")) requests.push(request.url());
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await expect(page.getByText("Interactive simulation", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.locator(".event-row")).toHaveCount(4);
    await page.locator(".event-row").filter({ hasText: "refund_demo_1042" }).click();
    await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
    await expect(page.locator(".attempts > li")).toHaveCount(3);
    await page.getByRole("button", { name: "Repair demo cause" }).click();
    await expect(
      page.getByText("Demo cause repaired. Request replay to start a new cycle."),
    ).toBeVisible();
    await page
      .getByLabel("Replay reason")
      .fill("Repaired the sample handler after inspecting retries");
    await page.getByRole("button", { name: "Request replay", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Processed", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".attempts > li")).toHaveCount(4);
    await expect(page.locator(".replay-audit > li")).toHaveCount(1);
    await expect(page.getByText("1 entry", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Redeliver original" }).click();
    await expect(page.getByText("Redelivery returned the same acceptance receipt.")).toBeVisible();
    await expect(page.locator(".attempts > li")).toHaveCount(4);
    await page.getByRole("button", { name: "Exhaust retries", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".attempts > li")).toHaveCount(3);
    await expect(page.locator(".event-row")).toHaveCount(5);
    const isolated = await context.newPage();
    await isolated.goto(base);
    await expect(isolated.locator(".event-row")).toHaveCount(4);
    await isolated.close();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.getByRole("button", { name: "Back to inbox" }).click();
    await page.getByLabel("Processing state").selectOption("received");
    await expect(page.getByRole("heading", { name: "No events in this view" })).toBeVisible();
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Reset demo", exact: true }).click(),
    ]);
    await expect(page.locator(".event-row")).toHaveCount(4);
    await page.reload();
    await expect(page.locator(".event-row")).toHaveCount(4);
    assert.deepEqual(requests, [], "Static demo must never request the backend");
    assert.deepEqual(errors, []);
    return {
      recovery: true,
      historyPreserved: true,
      tabsIsolated: true,
      reset: true,
      narrowLayout: true,
      backendRequests: requests.length,
    };
  } finally {
    await browser.close();
  }
}
