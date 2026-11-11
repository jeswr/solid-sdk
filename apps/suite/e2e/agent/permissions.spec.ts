// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  loadVerifiedMandate,
  readMandateCredentials,
  statusIndex,
} from "../../src/apps/agent/lib/mandates";
import { loadedRecords, readControl } from "../../src/apps/agent/lib/readers";
import { createAgentVerifier } from "../../src/apps/agent/lib/verify";
import { DEMO_WEBID } from "../../src/lib/demo-pod/constants";
import { seedDemoSession } from "../demo-session";
import { daemonDouble } from "./daemon-double";

async function accessible(page: Page, info: TestInfo, name: string) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  const directory = fileURLToPath(
    new URL("../../../../artifacts/playwright/agent/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
async function open(page: Page) {
  await seedDemoSession(page);
  await page.goto("/agent/permissions");
  await expect(
    page.getByRole("heading", { name: "Current permission", exact: true }),
  ).toBeVisible();
}
async function activate(page: Page) {
  await page.getByRole("button", { name: "Tests between my accounts", exact: true }).click();
  await page.getByRole("button", { name: "Preview permissions", exact: true }).click();
  await page.getByRole("button", { name: "Sign and activate", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Set up approvals on this device" });
  await sheet.getByRole("button", { name: "Set up this device", exact: true }).click();
  await expect(page.getByText("Your permissions have been saved.", { exact: true })).toBeVisible();
}
test("5: activates the exact default template with a verified owner signature and next status index", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "Tests between my accounts", exact: true }).click();
  await page.getByRole("button", { name: "Preview permissions", exact: true }).click();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.locator("pre")).toContainText("Agreement");
  await accessible(page, info, "permission-preview");
  await page.getByRole("button", { name: "Sign and activate", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up this device", exact: true })
    .click();
  await expect(page.getByText("Your permissions have been saved.", { exact: true })).toBeVisible();
  const daemon = daemonDouble(page);
  const m = await loadVerifiedMandate(daemon.client, { fetch: daemon.fetch, webId: DEMO_WEBID });
  expect(m?.autonomous.permissions).toEqual([]);
  const credentials = loadedRecords(await readMandateCredentials(daemon.client));
  expect(credentials.map((c) => statusIndex(c)).sort()).toEqual([0, 1]);
  await accessible(page, info, "permissions-active");
  await page.getByRole("link", { name: "View permission history", exact: true }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Replaced", { exact: true })).toBeVisible();
  await expect(page.getByText(/Signed by approval key: agent-approval-/)).toBeVisible();
  await accessible(page, info, "permission-history");
});
test("5: an explicit own-account-only rule produces Never and disables approval", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "Tests between my accounts", exact: true }).click();
  // Editing a template produces the editor's explicit prohibition on other recipients.
  await page.getByLabel("Daily send limit", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Preview permissions", exact: true }).click();
  await page.getByRole("button", { name: "Sign and activate", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up this device", exact: true })
    .click();
  await expect(page.getByText("Your permissions have been saved.", { exact: true })).toBeVisible();
  await page.goto("/agent/approvals/prohibited-send");
  await expect(page.getByText("Never", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await accessible(page, info, "permissions-prohibited");
});
test("6: revocation refuses a queued item and records the signed owner control", async ({
  page,
}, info) => {
  await open(page);
  await activate(page);
  const daemon = daemonDouble(page);
  const source = (
    await daemon.client.read(
      daemon.client.paths.resolveSlug("proposals", "send-reply"),
      "action-proposal",
    )
  ).record;
  const queued = await daemon.propose("revoked-queued", source);
  expect(await daemon.tick(queued)).toBe("awaiting-approval");
  await page.getByRole("button", { name: "Stop using these permissions", exact: true }).click();
  await expect(
    page.getByText("No verified permissions are active.", { exact: false }),
  ).toBeVisible();
  expect(
    await loadVerifiedMandate(daemon.client, { fetch: daemon.fetch, webId: DEMO_WEBID }),
  ).toBeUndefined();
  expect(await daemon.tick(queued)).toBe("mandate-invalid");
  const controls = loadedRecords(
    await readControl(
      daemon.client,
      createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
    ),
  );
  expect(controls.some((c) => c.kind === "RevokeMandate" && c.verification === "verified")).toBe(
    true,
  );
  const tx = (
    await daemon.client.read(`${daemon.client.paths.outbox}revoked-queued.ttl`, "transmission")
  ).record;
  expect(tx.status).toBe("refused");
  expect(tx.externalId).toBeUndefined();
  await accessible(page, info, "permissions-revoked");
});
test("permissions guard expiry, high authority confirmation and an absent agent introduction", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "Tests between my accounts", exact: true }).click();
  await page.getByLabel("Allow moving money (ask me first)", { exact: true }).check();
  await page.getByRole("button", { name: "Preview permissions", exact: true }).click();
  await expect(page.getByText("Type CONFIRM to allow this", { exact: true }).last()).toBeVisible();
  await page.getByLabel("Type CONFIRM to allow this", { exact: true }).fill("CONFIRM");
  await page.getByLabel("Valid until", { exact: true }).fill("2020-01-01");
  await page.getByRole("button", { name: "Preview permissions", exact: true }).click();
  expect(
    await page
      .getByLabel("Valid until", { exact: true })
      .evaluate((input) => !(input as HTMLInputElement).validity.valid),
  ).toBe(true);
  await accessible(page, info, "permission-validation");
  await daemonDouble(page).fetch("https://alice.demo.pod/agent/descriptors/agent.ttl", {
    method: "DELETE",
  });
  await expect(
    page.getByText("Your agent hasn't introduced itself yet. Start it once, then come back.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview permissions", exact: true }),
  ).toBeDisabled();
});

test("allow similar issues a scoped seven-day rule before approving", async ({ page }, info) => {
  await open(page);
  await activate(page);
  await page.goto("/agent/approvals/send-reply");
  await page
    .getByRole("button", { name: "Approve and allow similar for 7 days", exact: true })
    .click();
  await expect(page.getByText("Approved, the agent will send within a minute")).toBeVisible();
  const daemon = daemonDouble(page);
  // "Approved" is optimistic; the new mandate and the approval land shortly after.
  await expect
    .poll(async () => {
      const mandate = await loadVerifiedMandate(daemon.client, {
        fetch: daemon.fetch,
        webId: DEMO_WEBID,
      });
      return mandate?.autonomous.permissions?.at(-1)?.constraints;
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ leftOperand: "dateTime", operator: "lt" }),
        expect.objectContaining({
          leftOperand: "https://jeswr.org/ns/agent#binding",
          operator: "eq",
          rightOperand: "gmail",
        }),
      ]),
    );
  const proposal = (
    await daemon.client.read(
      daemon.client.paths.resolveSlug("proposals", "send-reply"),
      "action-proposal",
    )
  ).record;
  await expect.poll(() => daemon.tick(proposal)).toBe("sent");
  await accessible(page, info, "permissions-similar-seven-days");
});

async function keyboardActivate(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  for (let index = 0; index < 150; index++) {
    if (await button.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard could not reach ${name}`);
}
test("5 keyboard: review and activate permissions without a pointer", async ({ page }, info) => {
  await open(page);
  await keyboardActivate(page, "Tests between my accounts");
  await keyboardActivate(page, "Preview permissions");
  await expect(
    page.getByRole("heading", { name: "Review your permissions", exact: true }),
  ).toBeVisible();
  await accessible(page, info, "permissions-keyboard-preview");
  await keyboardActivate(page, "Sign and activate");
  await keyboardActivate(page, "Set up this device");
  await expect(page.getByText("Your permissions have been saved.", { exact: true })).toBeVisible();
  const daemon = daemonDouble(page);
  expect(
    await loadVerifiedMandate(daemon.client, { fetch: daemon.fetch, webId: DEMO_WEBID }),
  ).toBeDefined();
  await accessible(page, info, "permissions-keyboard-active");
});
