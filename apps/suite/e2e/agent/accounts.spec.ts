// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { importRegistry } from "../../../../packages/agent-registry/src/importer";
import { parseRegistryYaml } from "../../../../packages/agent-registry/src/inventory";
import {
  FixedSaltProvider,
  MemoryRegistryReader,
  MemoryStorageClient,
} from "../../../../packages/agent-registry/src/testing";
import { accountBinding } from "../../src/apps/agent/lib/accounts";
import { loadedRecords, readAccounts, readControl } from "../../src/apps/agent/lib/readers";
import { createAgentVerifier } from "../../src/apps/agent/lib/verify";
import { DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/constants";
import { daemonDouble } from "./daemon-double";

async function registryFixture(page: Page) {
  const registry = await readFile(
    new URL(
      "../../../../packages/agent-registry/test/fixtures/registry.synthetic.yaml",
      import.meta.url,
    ),
    "utf8",
  );
  const storage = new MemoryStorageClient();
  const report = await importRegistry(
    { registryPath: "synthetic.yaml", storageRoot: DEMO_ROOT, ownerWebId: DEMO_WEBID },
    {
      reader: new MemoryRegistryReader("synthetic.yaml", registry),
      salt: new FixedSaltProvider(),
      storage,
    },
  );
  const daemon = daemonDouble(page);
  expect((await daemon.fetch(daemon.client.paths.mandatesCurrent, { method: "DELETE" })).ok).toBe(
    true,
  );
  for (const row of loadedRecords(await readAccounts(daemon.client))) {
    const response = await daemon.fetch(row.id, { method: "DELETE" });
    expect(response.ok).toBe(true);
  }
  for (const [url, resource] of storage.resources) await daemon.client.create(url, resource.body);
  const snapshot = parseRegistryYaml(registry);
  return {
    ...daemon,
    report,
    handles: [
      ...snapshot.accounts.flatMap((row) => row.handles),
      ...snapshot.evidence.map((row) => row.identifier),
      "alternate-main@example.org",
    ],
    refs: snapshot.accounts.flatMap((row) => row.refs).filter((ref) => ref.startsWith("op://")),
  };
}

async function setup(page: Page) {
  await page.goto("/agent/settings");
  await page.waitForFunction(() => !!window.__suiteDemoPod);
  await page.getByRole("button", { name: "Set up this device", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up this device", exact: true })
    .click();
  await expect(page.getByText("Key ready", { exact: true })).toBeVisible();
}

async function inspect(page: Page, screenshot: string) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((row) => row.impact === "serious" || row.impact === "critical"),
  ).toEqual([]);
  await page.screenshot({
    path: `../../artifacts/playwright/agent/${screenshot}.png`,
    fullPage: true,
  });
}

test("8: registry accounts stay private, show conflicts and write verified owner switches", async ({
  page,
}, info) => {
  await setup(page);
  const fixture = await registryFixture(page);
  // The fixture contains 28 entries; the registry importer adds its Telegram bot account.
  expect(fixture.report.imported).toBe(29);
  await page.goto("/agent/accounts");
  await expect(page.locator("[data-agent-account]")).toHaveCount(29);
  await expect(
    page.getByText("Two different handles recorded. Pick one on the agent's computer.").first(),
  ).toBeVisible();
  const account = fixture.report.settings.connections.find(
    (row) => row.channel === "email" && row.provider === "google",
  );
  expect(account).toBeDefined();
  const hash = account?.channelHandles[0] as string;
  const card = page
    .locator("[data-agent-account]")
    .filter({ hasText: `Account hash: ${hash.slice(0, 16)}` });
  const send = card.getByRole("switch", { name: /^Send for/ });
  await expect(send).toBeDisabled();
  await expect(
    card.locator(`[title="Your permissions don't let the agent send on this account yet"]`),
  ).toBeVisible();
  const read = card.getByRole("switch", { name: /^Read for/ });
  await read.click();
  await expect(read).toBeChecked();
  await expect
    .poll(async () => {
      const controls = loadedRecords(
        await readControl(
          fixture.client,
          createAgentVerifier({ fetch: fixture.fetch, webId: DEMO_WEBID }),
        ),
      );
      return controls.find(
        (row) =>
          row.kind === "SetBindingState" &&
          row.target === `${fixture.client.paths.accounts}${account?.id}.ttl`,
      );
    })
    .toMatchObject({
      binding: accountBinding({ channel: "email", provider: "google" }),
      verification: "verified",
      restrictions: { read: true },
    });
  await page.reload();
  await expect(card.getByRole("switch", { name: /^Read for/ })).toBeChecked();
  const html = await page.content();
  for (const privateValue of [...fixture.handles, ...fixture.refs])
    expect(html).not.toContain(privateValue);
  await inspect(page, `accounts-${info.project.name}`);
  await card.getByRole("button", { name: "Connect…", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText(
    "Accounts are connected on the computer where your agent runs, so this app never sees your passwords or tokens.",
  );
  await expect(sheet.locator("code")).toHaveText(`awp login email-${account?.id}`);
  for (const privateValue of [...fixture.handles, ...fixture.refs])
    expect(await page.content()).not.toContain(privateValue);
  await inspect(page, `account-connect-${info.project.name}`);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await card.getByRole("link", { name: /^View / }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await inspect(page, `account-disconnect-${info.project.name}`);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
});

test("8: Send becomes available only after verified permissions name its binding", async ({
  page,
}, info) => {
  await setup(page);
  const daemon = daemonDouble(page);
  expect((await daemon.fetch(daemon.client.paths.mandatesCurrent, { method: "DELETE" })).ok).toBe(
    true,
  );
  await page.goto("/agent/accounts/gmail");
  const send = page.getByRole("switch", { name: "Send for Personal Gmail", exact: true });
  await expect(send).toBeDisabled();
  await page.goto("/agent/permissions");
  await page.getByRole("button", { name: "Tests between my accounts", exact: true }).click();
  await page.getByRole("button", { name: "Preview permissions", exact: true }).click();
  await page.getByRole("button", { name: "Sign and activate", exact: true }).click();
  await expect(page.getByText("Your permissions have been saved.", { exact: true })).toBeVisible();
  await page.goto("/agent/accounts/gmail");
  await expect(send).toBeEnabled();
  await inspect(page, `account-send-allowed-${info.project.name}`);
});
