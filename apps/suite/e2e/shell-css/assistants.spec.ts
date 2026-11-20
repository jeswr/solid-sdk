// AUTHORED-BY Codex GPT-6.1-Sol

import { randomUUID } from "node:crypto";
import {
  buildConnectionRecord,
  connectionRecordUrl,
  MCP,
  parseConnectionRecord,
} from "@jeswr/mcp-connections";
import { accessible, accountAuth, cssAccount, expect, test } from "./fixtures";

test("the owner disconnects a connection record through the real pod session", async ({ page }) => {
  const account = cssAccount("alice");
  const auth = await accountAuth("alice");
  const root = new URL("alice/", account.issuer).href;
  const resource = "https://mcp.example/mcp";
  const url = await connectionRecordUrl(root, resource, randomUUID());
  const name = `CSS assistant ${randomUUID()}`;
  const body = buildConnectionRecord(url, {
    resource,
    client: "https://assistant.example/app",
    title: name,
    created: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    access: `${MCP}ReadOnly`,
    personalDataMode: `${MCP}OwnerPolicy`,
  });
  try {
    expect(
      (
        await auth.fetch(url, {
          method: "PUT",
          headers: { "content-type": "text/turtle", "if-none-match": "*" },
          body,
        })
      ).ok,
    ).toBe(true);
    await page.goto("/settings/assistants");
    await page.getByRole("button", { name: `Disconnect ${name}`, exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading")).toHaveText(`Disconnect ${name}?`);
    await accessible(page);
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Previously connected assistants" })).toContainText(
      name,
    );
    const read = await auth.fetch(url);
    expect(
      (await parseConnectionRecord(await read.text(), "text/turtle", url)).revokedAt,
    ).toBeDefined();
    await page.reload();
    await expect(page.getByRole("list", { name: "Previously connected assistants" })).toContainText(
      name,
    );
    await accessible(page);
  } finally {
    await auth.fetch(url, { method: "DELETE" });
    await auth.logout();
  }
});
