// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { recordToTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
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
import { seedDemoSession } from "../demo-session";
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
  await seedDemoSession(page);
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
  await expect
    .poll(() =>
      page
        .locator("[data-agent-account] img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await expect(
    page.getByText("Two different handles recorded — pick one", { exact: true }).first(),
  ).toBeVisible();
  const conflicts = loadedRecords(await readAccounts(fixture.client)).filter(
    (row) => row.inventory?.identityConflicts.length,
  );
  expect(conflicts.length).toBeGreaterThan(0);
  const warning = page
    .getByRole("alert")
    .filter({ hasText: "Two different handles recorded — pick one" })
    .first();
  await warning.getByText("How to resolve this", { exact: true }).click();
  await expect(warning).toContainText("Only you can make this choice.");
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
  for (const name of ["Read", "Triage", "Draft", "Send"]) {
    await expect(card.getByRole("switch", { name: new RegExp(`^${name} for`) })).not.toBeChecked();
  }
  await read.focus();
  await page.keyboard.press("Space");
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
  await expect(card.getByRole("button", { name: "Connect…", exact: true })).toBeFocused();
  await card.getByRole("link", { name: /^View / }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await inspect(page, `account-disconnect-${info.project.name}`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeFocused();
  expect(
    loadedRecords(await readControl(fixture.client)).some((row) => row.bindingState === "disabled"),
  ).toBe(false);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      loadedRecords(
        await readControl(
          fixture.client,
          createAgentVerifier({ fetch: fixture.fetch, webId: DEMO_WEBID }),
        ),
      ).find(
        (row) =>
          row.target === `${fixture.client.paths.accounts}${account?.id}.ttl` &&
          row.bindingState === "disabled",
      ),
    )
    .toMatchObject({ kind: "SetBindingState", verification: "verified", binding: "gmail" });
  await expect(page.getByRole("button", { name: "Connect…", exact: true })).toBeFocused();
  expect(
    loadedRecords(await readAccounts(fixture.client)).filter(
      (row) => row.inventory?.identityConflicts.length,
    ),
  ).toEqual(conflicts);
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
  await send.focus();
  await page.keyboard.press("Space");
  await expect(send).toBeChecked();
  for (const name of ["Triage", "Draft"]) {
    const toggle = page.getByRole("switch", { name: `${name} for Personal Gmail`, exact: true });
    // Seeded triage is already enabled. Exercise both directions through the signed path.
    const value = (await toggle.getAttribute("aria-checked")) !== "true";
    await toggle.click();
    await expect
      .poll(async () =>
        loadedRecords(
          await readControl(
            daemon.client,
            createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
          ),
        ).some(
          (row) =>
            row.target === `${daemon.client.paths.accounts}gmail.ttl` &&
            row.verification === "verified" &&
            row.restrictions?.[name === "Triage" ? "triage" : "draft"] === value,
        ),
      )
      .toBe(true);
  }
  await expect
    .poll(async () =>
      loadedRecords(
        await readControl(
          daemon.client,
          createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
        ),
      ).some(
        (row) =>
          row.target === `${daemon.client.paths.accounts}gmail.ttl` &&
          row.verification === "verified" &&
          row.restrictions?.send === true,
      ),
    )
    .toBe(true);
  await inspect(page, `account-send-allowed-${info.project.name}`);
});

test("12: account details show account-specific scopes and copy the exact host command with keyboard focus restored", async ({
  page,
  context,
}, info) => {
  await setup(page);
  const daemon = daemonDouble(page);
  const descriptor = {
    ...exampleRecords["channel-capability"],
    id: `${daemon.client.paths.descriptors}gmail-scopes.ttl`,
    binding: "gmail",
    account: `${daemon.client.paths.accounts}gmail.ttl`,
    grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly", "mail.".repeat(80)],
  };
  await daemon.client.create(descriptor.id, await recordToTurtle(descriptor));
  await page.goto("/agent/accounts/gmail");
  await expect(page.getByRole("heading", { name: "Scopes granted", exact: true })).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.locator(".agent-scopes")).toBeVisible();
  await expect(page.locator(".agent-scopes li")).toHaveText(descriptor.grantedScopes);
  await expect(
    page.getByRole("row", { name: "Can carry structured data Yes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: "End-to-end encrypted No", exact: true }),
  ).toBeVisible();
  await inspect(page, `account-detail-${info.project.name}`);
  const connect = page.getByRole("button", { name: "Connect…", exact: true });
  await connect.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator("code")).toHaveText("awp login test-profile");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sheet.getByRole("button", { name: "Copy command", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("awp login test-profile");
  await page.keyboard.press("Escape");
  await expect(connect).toBeFocused();
  await page.reload();
  await expect(page.locator(".agent-scopes li")).toHaveText(descriptor.grantedScopes);
});
