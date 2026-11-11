// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";
import {
  loadedRecords,
  readApprovals,
  readControl,
  readTurns,
} from "../../src/apps/agent/lib/readers";
import { createAgentVerifier } from "../../src/apps/agent/lib/verify";
import { DEMO_WEBID } from "../../src/lib/demo-pod/constants";
import { daemonDouble } from "./daemon-double";
import { agentScreenshot, openAgent } from "./helpers";

test("owner turn gets a canned daemon reply within two seconds and read state persists", async ({
  page,
}, info) => {
  await openAgent(page, "chat/c/welcome");
  const daemon = daemonDouble(page);
  const composer = page.getByRole("textbox", { name: "Message your agent" });
  await composer.fill("Hello from the owner");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Hello from the owner", { exact: true })).toBeVisible();
  // Focus returns to the composer instead of dropping to the page.
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("");
  await expect(page.getByRole("status", { name: "Agent is typing", exact: true })).toBeVisible();
  const start = Date.now();
  expect(await daemon.answerOwnerTurn("welcome")).toBe(true);
  await expect(
    page.getByText("I have read your message. What would you like to do next?", { exact: true }),
  ).toBeVisible({ timeout: 2000 });
  expect(Date.now() - start).toBeLessThan(2000);
  await expect(page.getByRole("status", { name: "Agent is typing", exact: true })).toHaveCount(0);
  const turns = loadedRecords(await readTurns(daemon.client, "welcome"));
  expect(turns[0]?.role).toBe("agent");
  expect(turns[1]?.role).toBe("owner");
  const welcome = page
    .getByRole("complementary", { name: "Conversations" })
    .getByRole("listitem")
    .filter({ hasText: "Plan my week" });
  await expect(welcome.getByRole("img", { name: "Unread conversation" })).toHaveCount(0);
  await agentScreenshot(page, info, "chat-replied");
  await page.reload();
  await expect(
    page.getByText("I have read your message. What would you like to do next?", { exact: true }),
  ).toBeVisible();
  await expect(welcome.getByRole("img", { name: "Unread conversation" })).toHaveCount(0);
});
test("inline proposal uses the signed P2 path and Change focuses the composer", async ({
  page,
}, info) => {
  await openAgent(page, "chat/c/welcome");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message your agent" })).toHaveValue("Change: ");
  await expect(page.getByRole("textbox", { name: "Message your agent" })).toBeFocused();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const setup = page.getByRole("dialog");
  await expect(setup).toContainText("Set up approvals on this device");
  await setup.getByRole("button", { name: "Set up this device", exact: true }).click();
  await expect(page.getByText("Approved, waiting for the agent", { exact: true })).toBeVisible();
  const daemon = daemonDouble(page);
  const approvals = loadedRecords(
    await readApprovals(
      daemon.client,
      createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
    ),
  );
  expect(approvals.find((a) => a.approves.endsWith("/send-reply.ttl"))?.verification).toBe(
    "verified",
  );
  await agentScreenshot(page, info, "chat-approved");
});
test("slash commands and Stop use the same confirmed, verified Halt", async ({ page }, info) => {
  await openAgent(page, "chat/c/welcome");
  const composer = page.getByRole("textbox", { name: "Message your agent" });
  await composer.fill("/");
  await page.getByRole("button", { name: "/remember", exact: true }).click();
  await expect(composer).toHaveValue("/remember ");
  await composer.fill("/");
  await page.getByRole("button", { name: "/stop", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up this device", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "Your agent will stop sending and acting until you resume it.",
  );
  await agentScreenshot(page, info, "chat-stop-confirm");
  await dialog.getByRole("button", { name: "Stop the agent", exact: true }).click();
  const daemon = daemonDouble(page);
  await expect
    .poll(async () =>
      loadedRecords(
        await readControl(
          daemon.client,
          createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
        ),
      ).some((c) => c.kind === "Halt" && c.verification === "verified"),
    )
    .toBe(true);
  await agentScreenshot(page, info, "chat-stopped");
});
test("new conversations and offline guidance work at every viewport", async ({ page }, info) => {
  await openAgent(page, "chat");
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await expect(page).toHaveURL(/\/agent\/chat\/c\/[0-9a-f-]+$/);
  await expect(page.getByText("Say hello to your agent", { exact: true })).toBeVisible();
  const daemon = daemonDouble(page);
  await daemon.fetch(daemon.client.paths.heartbeat, { method: "DELETE" });
  await expect(page.getByText(/Your agent hasn't checked in since/)).toBeVisible();
  await page.getByRole("button", { name: "How to start it", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("awp run");
  await agentScreenshot(page, info, "chat-offline");
});
