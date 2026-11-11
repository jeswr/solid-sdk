// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, test } from "@playwright/test";
import {
  auditFromTurtle,
  auditHeadToTurtle,
  auditToTurtle,
  sealAudit,
} from "../../src/apps/agent/lib/audit";
import { daemonDouble } from "./daemon-double";
import { agentScreenshot, openAgent } from "./helpers";

test.use({ trace: "on" });

test("10: records check green, then red after a retained record is altered", async ({
  page,
}, info) => {
  await openAgent(page, "activity");
  await expect(page.locator('.agent-timeline-row[data-seq="12"]')).toBeVisible();
  const check = page.getByRole("button", { name: "Check records", exact: true });
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByRole("status").filter({ hasText: "Records check out" })).toBeVisible();
  await expect(
    page.getByText(
      "Checks the records shown here. It can't detect records that were never written.",
      { exact: true },
    ),
  ).toBeVisible();
  await agentScreenshot(page, info, "activity-intact");
  const daemon = daemonDouble(page);
  const url = `${daemon.client.paths.audit}10.ttl`;
  const doc = await daemon.client.graph(url);
  const entry = await auditFromTurtle(doc.text, url);
  const changed = { ...entry, at: "2026-11-01T00:00:00.000Z" };
  await daemon.client.replace(url, await auditToTurtle(url, changed), doc.etag as string);
  // Wait for the reloaded snapshot before checking it; a previous verdict is invalidated.
  await expect(page.getByText("Records check out", { exact: true })).toHaveCount(0);
  await expect(check).toBeEnabled();
  await check.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Record 10 doesn't match" }),
  ).toBeVisible();
  await agentScreenshot(page, info, "activity-tampered");
});
test("records never check out once the record index is deleted", async ({ page }) => {
  await openAgent(page, "activity");
  await expect(page.locator('.agent-timeline-row[data-seq="12"]')).toBeVisible();
  const daemon = daemonDouble(page);
  expect((await daemon.fetch(daemon.client.paths.auditChain, { method: "DELETE" })).ok).toBe(true);
  const check = page.getByRole("button", { name: "Check records", exact: true });
  const verdict = page
    .getByRole("status")
    .filter({ hasText: "These records can't be checked because the record index is missing." });
  // The deletion's notification reloads the range, which invalidates an earlier verdict.
  await expect(async () => {
    await check.click();
    await expect(verdict).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByText("Records check out", { exact: true })).toHaveCount(0);
});
test("activity filters, JSON-LD export, detail chain and sharing fallback", async ({
  page,
}, info) => {
  await openAgent(page, "activity");
  await expect(page.locator('.agent-timeline-row[data-seq="12"]')).toBeVisible();
  await page.getByRole("button", { name: "Message sent", exact: true }).click();
  await expect(page.locator(".agent-timeline-row")).toHaveCount(1);
  await page.getByLabel("From date", { exact: true }).fill("2099-01-01");
  await expect(page.getByText("No records match these filters.")).toBeVisible();
  await page.getByLabel("From date", { exact: true }).fill("");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export records", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("agent-audit.jsonld");
  await page.getByRole("button", { name: "Share with an auditor", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("audit/ and mandates/");
  await sheet.getByLabel("Auditor account ID").fill("https://auditor.example/profile#me");
  await expect(
    sheet.getByRole("button", { name: "Sharing arrives with the suite share dialog" }),
  ).toBeDisabled();
  await agentScreenshot(page, info, "activity-sharing");
  await page.keyboard.press("Escape");
  await page
    .getByRole("group", { name: "Activity kind" })
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await page.locator('.agent-timeline-row[data-seq="12"]').click();
  await expect(page.getByRole("dialog").locator("svg.agent-prov")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Approval key", { exact: true })).toBeVisible();
  await agentScreenshot(page, info, "activity-detail");
  // The first Escape may only dismiss the focused close button's tooltip.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 500 });
  }).toPass();
  await expect(page.locator('.agent-timeline-row[data-seq="12"]')).toBeFocused();
});
test("5000 records scroll for two seconds without long tasks", async ({ page }, info) => {
  await page.goto("/dev/agent-activity");
  const timeline = page.getByRole("region", { name: "Activity timeline", exact: true });
  await expect(timeline.locator("li")).toHaveCount(25);
  await expect(timeline.locator("li").first()).toHaveAttribute("aria-setsize", "5000");
  // Complete hydration and font loading before measuring the scroll itself.
  await page.evaluate(() => document.fonts.ready);
  await timeline.focus();
  await page.keyboard.press("End");
  await expect(timeline.locator("li").first()).not.toHaveAttribute("aria-posinset", "1");
  const tasks = await timeline.evaluate(async (node) => {
    const durations: number[] = [];
    if (!PerformanceObserver.supportedEntryTypes.includes("longtask"))
      throw new Error("Long task observation unavailable");
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: "longtask" });
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / 2000);
        node.scrollTop = progress * (node.scrollHeight - node.clientHeight);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    // Flush records queued by the final animation frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    for (const entry of observer.takeRecords()) durations.push(entry.duration);
    observer.disconnect();
    return durations;
  });
  expect(tasks.filter((duration) => duration > 50)).toEqual([]);
  await expect(timeline.locator("li")).toHaveCount(15);
  await expect(timeline.locator('.agent-timeline-row[data-seq="1"]')).toBeVisible();
  await agentScreenshot(page, info, "activity-5000");
});

test("shared verifier displays and checks current tool-call records", async ({ page }) => {
  await openAgent(page, "activity");
  await expect(page.locator('.agent-timeline-row[data-seq="12"]')).toBeVisible();
  const daemon = daemonDouble(page);
  const latestUrl = `${daemon.client.paths.audit}12.ttl`;
  const latestDoc = await daemon.client.graph(latestUrl);
  const latest = await auditFromTurtle(latestDoc.text, latestUrl);
  const entry = sealAudit(13, new Date().toISOString(), latest.hash, {
    type: "tool-call",
    id: "urn:fixture:tool-call",
    agent: "urn:fixture:agent",
    owner: "urn:fixture:owner",
    taskId: "browser-check",
    conversation: "urn:fixture:conversation",
    modelCall: "urn:fixture:model-call",
    tool: "pod_read",
  });
  const url = `${daemon.client.paths.audit}13.ttl`;
  await daemon.client.create(url, await auditToTurtle(url, entry));
  const head = await daemon.client.graph(daemon.client.paths.auditChain);
  await daemon.client.replace(
    daemon.client.paths.auditChain,
    await auditHeadToTurtle(daemon.client.paths.auditChain, entry),
    head.etag as string,
  );
  await expect(page.locator('.agent-timeline-row[data-seq="13"]')).toContainText("Tool used");
  await page.getByRole("button", { name: "Check records", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Records check out" })).toBeVisible();
});
