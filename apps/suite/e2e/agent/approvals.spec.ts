// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { evaluateIntent } from "@jeswr/agent-mandate/verify";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { loadVerifiedMandate, proposalIntent } from "../../src/apps/agent/lib/mandates";
import {
  loadedRecords,
  readApprovals,
  readOutbox,
  readProposals,
} from "../../src/apps/agent/lib/readers";
import { createAgentVerifier } from "../../src/apps/agent/lib/verify";
import { DEMO_WEBID } from "../../src/lib/demo-pod/constants";
import { seedDemoSession } from "../demo-session";
import { daemonDouble } from "./daemon-double";

async function accessible(page: Page, info: TestInfo, state: string) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  const path = fileURLToPath(new URL("../../../../artifacts/playwright/agent/", import.meta.url));
  await mkdir(path, { recursive: true });
  await page.screenshot({ path: `${path}/${state}-${info.project.name}.png`, fullPage: true });
}
async function open(page: Page, route = "approvals") {
  await seedDemoSession(page);
  await page.goto(`/agent/${route}`);
  await page.waitForFunction(() => !!window.__suiteDemoPod);
  await expect(
    page.getByRole("heading", { level: 1 }).filter({ visible: true }).first(),
  ).toBeVisible();
}
async function setup(page: Page) {
  await open(page, "settings");
  await page.getByRole("button", { name: "Set up this device", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up this device", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Key ready", { exact: true })).toBeVisible();
}
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let n = 0; n < 60; n++) {
    // :focus may match nothing before the first Tab. A locator text read would
    // auto-wait for the full timeout instead of advancing the keyboard.
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard could not reach the approval list");
}
async function proposalOnPod(page: Page) {
  const daemon = daemonDouble(page);
  const proposal = await daemon.client.read(
    daemon.client.paths.resolveSlug("proposals", "send-reply"),
    "action-proposal",
  );
  return { daemon, proposal: proposal.record };
}
test("1: first approval sets up this device and publishes assertionMethod", async ({
  page,
}, info) => {
  await open(page, "approvals/send-reply");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Set up approvals on this device" });
  await expect(sheet).toContainText("It stays on this device and can't be copied.");
  await accessible(page, info, "setup-sheet");
  await sheet.getByRole("button", { name: "Not now", exact: true }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await sheet.getByRole("button", { name: "Set up this device", exact: true }).click();
  await expect(page.getByText("This device can now approve", { exact: true })).toBeVisible();
  await expect(page.getByText("Approved (waiting for agent)")).toBeVisible();
  expect(
    await (await daemonDouble(page).fetch("https://alice.demo.pod/profile/card")).text(),
  ).toContain("assertionMethod");
  const nonExtractable = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("solid-suite-agent-keys", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const key = await new Promise<{ privateKey: CryptoKey }>((resolve) => {
      const r = db
        .transaction("keys")
        .objectStore("keys")
        .get(localStorage.getItem("agent.approvalKey") ?? "");
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    try {
      await crypto.subtle.exportKey("jwk", key.privateKey);
      return false;
    } catch {
      return !key.privateKey.extractable;
    }
  });
  expect(nonExtractable).toBe(true);
  await accessible(page, info, "approved");
});
test("2: live queue proposal verifies, sends and appears in Activity", async ({ page }, info) => {
  await setup(page);
  await open(page);
  const { daemon, proposal: template } = await proposalOnPod(page);
  const proposal = await daemon.propose("live-send", {
    ...template,
    intent: {
      ...template.intent,
      parameters: { ...template.intent.parameters, summary: "A live approval" },
    },
  });
  await expect(page.getByRole("link", { name: "Review A live approval", exact: true })).toBeVisible(
    { timeout: 10000 },
  );
  const row = page
    .getByRole("list", { name: "Approval requests" })
    .locator("li")
    .filter({ has: page.getByRole("link", { name: "Review A live approval", exact: true }) });
  await expect(row.locator("svg")).toBeVisible();
  await expect(row).toContainText("send");
  await expect(row).toContainText(proposal.intent.binding);
  await expect(row).toContainText(proposal.intent.recipientHash.slice(0, 8));
  await expect(row).toContainText(
    `${proposal.intent.amount.value} ${proposal.intent.amount.currency}`,
  );
  await expect(row).toContainText("Expires");
  await expect(row).toContainText("Ask first");
  await expect(row).toContainText("Your permissions require approval for this action");
  await accessible(page, info, "queue");
  await page.getByRole("link", { name: "Review A live approval", exact: true }).click();
  await expect(page.getByRole("region", { name: "Preview prepared by the agent" })).toHaveText(
    proposal.renderedPreview,
  );
  await accessible(page, info, "detail");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved (waiting for agent)", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop the agent", exact: true }).last(),
  ).toBeVisible();
  await expect.poll(() => daemon.tick(proposal)).toBe("sent");
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await accessible(page, info, "sent");
  await open(page, "activity");
  await expect(page.getByText(/Sent email to/).first()).toBeVisible();
  await accessible(page, info, "activity-approval");
  await page.locator('.agent-timeline-row[data-seq="13"]').click();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.locator("pre")).toContainText(proposal.id);
  await expect(page.locator("pre")).toContainText("approval");
  await expect(page.locator("pre")).toContainText("transmission");
  await accessible(page, info, "activity-approval-chain");
});
test("2 keyboard: review and approve without a pointer", async ({ page }, info) => {
  await open(page);
  const links = page.getByRole("list", { name: "Approval requests" }).getByRole("link");
  await expect(links).toHaveCount(3);
  await tabTo(page, links.nth(0));
  await expect(links.nth(0)).toBeFocused();
  expect(await links.nth(0).evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
    "solid",
  );
  await page.keyboard.press("ArrowDown");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(links.nth(2)).toBeFocused();
  await expect(
    page.getByRole("link", { name: "Review Project catch-up", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await page.keyboard.press("a");
  await expect(
    page.getByRole("dialog").filter({ hasText: "Set up approvals on this device" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Set up this device", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Approved (waiting for agent)")).toBeVisible();
  const { daemon, proposal } = await proposalOnPod(page);
  await expect.poll(() => daemon.tick(proposal)).toBe("sent");
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await accessible(page, info, "keyboard-sent");
});

test("seeded approvals are readable and a malformed file still shows the warning", async ({
  page,
}) => {
  await open(page, "approvals/send-reply");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await expect(page.getByText(/record.*couldn't be read/)).toHaveCount(0);
  const daemon = daemonDouble(page);
  await daemon.client.create(`${daemon.client.paths.approvals}bad.trig`, "bad", "application/trig");
  await expect(page.getByRole("alert").filter({ hasText: "couldn't be read" })).toContainText(
    "1 record couldn't be read.",
  );
});
test("3: changed terms refuse the old approval and enable a new approval", async ({
  page,
}, info) => {
  await setup(page);
  await open(page, "approvals/send-reply");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved (waiting for agent)")).toBeVisible();
  const { daemon, proposal } = await proposalOnPod(page);
  const changed = await daemon.edit(proposal);
  await expect.poll(() => daemon.tick(changed)).toBe("terms-digest-mismatch");
  await expect(page.getByText("Needs a new approval", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await accessible(page, info, "needs-new-approval");
});
test("4: deny records refusal without an external send", async ({ page }, info) => {
  await setup(page);
  await open(page, "approvals/send-reply");
  await page.keyboard.press("d");
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
  const { daemon, proposal } = await proposalOnPod(page);
  await expect.poll(() => daemon.tick(proposal)).toBe("denied");
  const tx = await daemon.client.read(
    `${daemon.client.paths.outbox}send-reply.ttl`,
    "transmission",
  );
  expect(tx.record.status).toBe("refused");
  expect(tx.record.externalId).toBeUndefined();
  await accessible(page, info, "denied");
});
test("7: Halt stops sending and Resume requires typing RESUME", async ({ page }, info) => {
  await setup(page);
  await page.getByRole("button", { name: "Stop the agent", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "Your agent will stop sending and acting until you resume it.",
  );
  await accessible(page, info, "halt-confirmation");
  await dialog.getByRole("button", { name: "Stop the agent", exact: true }).click();
  await expect(page.getByRole("button", { name: "Agent status: Stopped" }).first()).toBeVisible();
  const { daemon, proposal } = await proposalOnPod(page);
  expect(await daemon.tick(proposal)).toBe("halted");
  await accessible(page, info, "stopped-pill");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(dialog).toContainText("awp resume");
  await expect(dialog.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Type RESUME to confirm" }).fill("resume");
  await expect(dialog.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await accessible(page, info, "resume-confirmation");
  await dialog.getByRole("textbox", { name: "Type RESUME to confirm" }).fill("RESUME");
  await dialog.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Agent status: Agent running" }).first(),
  ).toBeVisible();
  expect(await daemon.tick(proposal)).toBe("awaiting-approval");
  await accessible(page, info, "resumed");
});

test("setup failure can retry, and a restored device appends a replacement audit key", async ({
  page,
}, info) => {
  await open(page, "settings");
  await page.getByRole("button", { name: "Set up this device", exact: true }).click();
  await page.evaluate(() => {
    const { add, put } = IDBObjectStore.prototype;
    const fail = (original: typeof add) =>
      function (this: IDBObjectStore, ...args: Parameters<typeof add>) {
        if (this.transaction.db.name === "solid-suite-agent-keys") {
          IDBObjectStore.prototype.add = add;
          IDBObjectStore.prototype.put = put;
          throw new Error("Fixture storage failure");
        }
        return original.apply(this, args);
      };
    IDBObjectStore.prototype.add = fail(add);
    IDBObjectStore.prototype.put = fail(put);
  });
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Set up this device", exact: true }).click();
  await expect(sheet.getByRole("alert")).toContainText("Couldn't set up this device");
  await accessible(page, info, "setup-error");
  await sheet.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Key ready", { exact: true })).toBeVisible();
  const old = await page.evaluate(async () => {
    const id = localStorage.getItem("agent.approvalKey");
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("solid-suite-agent-keys", 1);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").delete(id ?? "");
      tx.oncomplete = () => resolve();
    });
    db.close();
    return id;
  });
  await page.getByRole("button", { name: "Stop the agent", exact: true }).click();
  await expect(sheet).toContainText("This device cannot approve");
  await accessible(page, info, "device-cannot-approve");
  await sheet.getByRole("button", { name: "Set up this device again", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  const profile = await (
    await daemonDouble(page).fetch("https://alice.demo.pod/profile/card")
  ).text();
  expect(old).not.toBeNull();
  expect(profile).toContain(old as string);
  expect(await page.evaluate(() => localStorage.getItem("agent.approvalKey"))).not.toBe(old);
  await accessible(page, info, "settings-key-ready");
});

test("prohibitions stay disabled, and bulk approval requires matching kinds and recipients", async ({
  page,
}, info) => {
  await setup(page);
  await open(page, "approvals/prohibited-send");
  await expect(page.getByText("Your permissions never allow this", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await accessible(page, info, "prohibited-detail");
  await open(page);
  const { daemon, proposal: template } = await proposalOnPod(page);
  const first = await daemon.propose("bulk-first", {
    ...template,
    intent: { ...template.intent, parameters: { summary: "Bulk first" } },
  });
  const second = await daemon.propose("bulk-second", {
    ...template,
    intent: { ...template.intent, parameters: { summary: "Bulk second" } },
  });
  await page.getByRole("checkbox", { name: "Select Bulk first", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select Calendar invitation", exact: true }).check();
  await expect(page.getByRole("button", { name: "Approve all", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Select Calendar invitation", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Select Bulk second", exact: true }).check();
  await expect(page.getByRole("button", { name: "Approve all", exact: true })).toBeEnabled();
  await accessible(page, info, "bulk-selected");
  await page.getByRole("button", { name: "Approve all", exact: true }).click();
  await expect(page.getByText("Approved (waiting for agent)")).toHaveCount(2);
  await expect.poll(() => daemon.tick(first)).toBe("sent");
  await expect.poll(() => daemon.tick(second)).toBe("sent");
  const approvals = loadedRecords(
    await readApprovals(
      daemon.client,
      createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
    ),
  ).filter((a) => [first.id, second.id].includes(a.approves));
  expect(approvals).toHaveLength(2);
  expect(new Set(approvals.map((a) => a.id)).size).toBe(2);
  expect(approvals.every((a) => a.verification === "verified")).toBe(true);
});

test("bulk approval removes a changed selection and signs only the other reviewed terms", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  const { daemon, proposal: template } = await proposalOnPod(page);
  const first = await daemon.propose("bulk-changing", {
    ...template,
    intent: { ...template.intent, parameters: { summary: "Changing request" } },
  });
  const second = await daemon.propose("bulk-stable", {
    ...template,
    intent: { ...template.intent, parameters: { summary: "Stable request" } },
  });
  const changing = page.getByRole("checkbox", { name: "Select Changing request", exact: true });
  const stable = page.getByRole("checkbox", { name: "Select Stable request", exact: true });
  await changing.check();
  await stable.check();
  await daemon.edit(first);
  await expect(changing).not.toBeChecked();
  await expect(stable).toBeChecked();
  await expect(
    page.getByRole("status").filter({ hasText: "A selected request changed" }),
  ).toContainText("Please review it and select it again.");
  const list = page.getByRole("list", { name: "Approval requests" });
  await expect(list.locator('[role="status"], [aria-live]')).toHaveCount(0);
  await page.getByRole("button", { name: "Approve all", exact: true }).click();
  const decisions = async () =>
    loadedRecords(
      await readApprovals(
        daemon.client,
        createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
      ),
    ).filter((approval) => [first.id, second.id].includes(approval.approves));
  await expect.poll(async () => (await decisions()).length).toBe(1);
  expect(await decisions()).toMatchObject([
    {
      approves: second.id,
      termsDigest: second.intent.termsDigest,
      verification: "verified",
    },
  ]);
});

test("a denied request remains refused in Activity after its approval expires, without a daemon tick", async ({
  page,
}) => {
  await setup(page);
  await open(page, "approvals/send-reply");
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
  const { daemon, proposal } = await proposalOnPod(page);
  await expect
    .poll(async () =>
      loadedRecords(
        await readApprovals(
          daemon.client,
          createAgentVerifier({ fetch: daemon.fetch, webId: DEMO_WEBID }),
        ),
      ).some(
        (approval) =>
          approval.approves === proposal.id &&
          approval.decision === "deny" &&
          approval.verification === "verified",
      ),
    )
    .toBe(true);
  await page.clock.install();
  await page.clock.setFixedTime(new Date(Date.parse(proposal.validUntil) + 1000));
  await open(page, "activity");
  const refused = page.getByRole("region", { name: "Refused approvals" });
  await expect(refused).toContainText("Project catch-up");
  await expect(refused).toContainText("You denied this request.");
  await expect(page.getByRole("region", { name: "Expired approvals" })).not.toContainText(
    "Project catch-up",
  );
  expect(
    loadedRecords(await readOutbox(daemon.client)).some((tx) => tx.proposal === proposal.id),
  ).toBe(false);
});

test("agent-prepared email preview preserves headers, the stored plain body and a muted footer; digest is copyable", async ({
  page,
}, info) => {
  await open(page);
  const { daemon, proposal: template } = await proposalOnPod(page);
  const footer =
    "— Sent by an agent · https://jeswr.org/agent · spec: https://jeswr.org/agentic-web";
  const preview = `Subject: Complete preview\nTo: Alice <alice@example.test>\n\nFirst line\n\n  Indented line <script>literal text</script>\nLast line\n\n${footer}`;
  const proposal = await daemon.propose("prepared-email", {
    ...template,
    renderedPreview: preview,
  });
  await open(page, "approvals/prepared-email");
  await expect(
    page.getByRole("heading", { name: "Preview prepared by the agent", exact: true }),
  ).toBeVisible();
  expect(
    await page.getByRole("region", { name: "Preview prepared by the agent" }).textContent(),
  ).toBe(preview);
  await expect(
    page.getByRole("region", { name: "Preview prepared by the agent" }).locator("script"),
  ).toHaveCount(0);
  await expect(page.locator(".agent-preview-footer")).toHaveText(footer);
  expect(
    await page.locator(".agent-preview-footer").evaluate((el) => getComputedStyle(el).color),
  ).not.toBe(
    await page
      .getByRole("region", { name: "Preview prepared by the agent" })
      .evaluate((el) => getComputedStyle(el).color),
  );
  await expect(page.getByText(/Rule requiring approval:/)).toBeVisible();
  await expect(page.getByText(proposal.intent.termsDigest, { exact: true })).toBeHidden();
  await page.getByText("Advanced", { exact: true }).click();
  await expect(
    page.getByText("Your approval is tied to this terms digest.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Permission rule" }).locator("pre code"),
  ).toContainText('"policy":');
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy digest", exact: true }).click();
  await expect(page.getByText("Digest copied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    proposal.intent.termsDigest,
  );
  await accessible(page, info, "prepared-email-preview");
});

test("chat and remember requests preserve their stored text and canonical kind", async ({
  page,
}, info) => {
  await open(page);
  const { daemon, proposal: template } = await proposalOnPod(page);
  const preview = "Hello\n  Keep this line break and indentation. <b>Plain text</b>";
  await daemon.propose("chat-preview", {
    ...template,
    intent: { ...template.intent, binding: "matrix" },
    renderedPreview: preview,
  });
  await open(page, "approvals/chat-preview");
  expect(
    await page.getByRole("region", { name: "Preview prepared by the agent" }).textContent(),
  ).toBe(preview);
  await expect(
    page.getByRole("region", { name: "Preview prepared by the agent" }).locator("b"),
  ).toHaveCount(0);
  await open(page, "approvals/remember-preference");
  await expect(page.locator(".agent-card .agent-row").first()).toContainText("remember");
  await expect(page.locator(".lucide-brain")).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview prepared by the agent" })).toHaveText(
    "Remember: I prefer afternoon meetings.",
  );
  await accessible(page, info, "remember-preview");
});

test("allow similar signs a separate approval and a rule bounded to seven days", async ({
  page,
}, info) => {
  await setup(page);
  await open(page, "approvals/send-reply");
  const { daemon, proposal } = await proposalOnPod(page);
  const session = { fetch: daemon.fetch, webId: DEMO_WEBID };
  await page
    .getByRole("button", { name: "Approve and allow similar for 7 days", exact: true })
    .click();
  await expect(page.getByText("Approved (waiting for agent)")).toBeVisible();
  await expect
    .poll(async () => {
      const current = await loadVerifiedMandate(daemon.client, session);
      return (
        current?.autonomous.permissions?.some((rule) => rule.action === proposal.intent.action) ??
        false
      );
    })
    .toBe(true);
  const m = await loadVerifiedMandate(daemon.client, session);
  if (!m) throw new Error("Missing signed permissions");
  const allowance = m.autonomous.permissions?.at(-1);
  expect(allowance?.action).toBe(proposal.intent.action);
  const dates = allowance?.constraints?.filter((c) => c.leftOperand === "dateTime");
  const start = String(dates?.find((c) => c.operator === "gteq")?.rightOperand);
  const end = String(dates?.find((c) => c.operator === "lt")?.rightOperand);
  expect(Date.parse(end) - Date.parse(start)).toBe(7 * 86400000);
  expect(
    (await evaluateIntent(m, proposalIntent(proposal, m.subject, new Date(start)))).decision,
  ).toBe("permit");
  expect(
    (await evaluateIntent(m, proposalIntent(proposal, m.subject, new Date(end)))).decision,
  ).toBe("confirm-required");
  await expect
    .poll(
      async () =>
        loadedRecords(await readApprovals(daemon.client, createAgentVerifier(session))).filter(
          (a) => a.approves === proposal.id,
        ).length,
    )
    .toBe(1);
  const approvals = loadedRecords(
    await readApprovals(daemon.client, createAgentVerifier(session)),
  ).filter((a) => a.approves === proposal.id);
  expect(approvals).toHaveLength(1);
  expect(approvals[0]).toMatchObject({
    verification: "verified",
    termsDigest: proposal.intent.termsDigest,
  });
  await accessible(page, info, "allow-similar");
});

test("expired requests leave an empty queue and appear in Activity with reason expired", async ({
  page,
}, info) => {
  await open(page);
  const daemon = daemonDouble(page);
  for (const proposal of loadedRecords(await readProposals(daemon.client))) {
    await daemon.write({ ...proposal, validUntil: new Date(Date.now() - 1).toISOString() });
  }
  await expect(page.getByText("Nothing waiting for you", { exact: true })).toBeVisible();
  await accessible(page, info, "approvals-empty");
  await open(page, "activity");
  const expired = page.getByRole("region", { name: "Expired approvals" });
  await expect(expired).toBeVisible();
  await expect(expired.getByText("Reason: expired", { exact: true })).toHaveCount(3);
  await accessible(page, info, "expired-approvals");
});

test("6: revoking permissions after approval refuses the queued item", async ({ page }, info) => {
  await setup(page);
  await open(page, "approvals/send-reply");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved (waiting for agent)")).toBeVisible();
  const { daemon, proposal } = await proposalOnPod(page);
  await open(page, "permissions");
  await page.getByRole("button", { name: "Stop using these permissions", exact: true }).click();
  await expect(
    page.getByText("No verified permissions are active.", { exact: false }),
  ).toBeVisible();
  await expect.poll(() => daemon.tick(proposal)).toBe("mandate-invalid");
  const tx = loadedRecords(await readOutbox(daemon.client)).find((t) => t.proposal === proposal.id);
  expect(tx).toMatchObject({ status: "refused" });
  expect(tx?.externalId).toBeUndefined();
  await accessible(page, info, "revoked-after-approval");
});

test("returning from approval details restores focus to the reviewed row", async ({ page }) => {
  await open(page);
  await page.getByRole("link", { name: "Review Calendar invitation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Approval details", exact: true })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  } else {
    await page.goBack();
  }
  await expect(
    page.getByRole("link", { name: "Review Calendar invitation", exact: true }),
  ).toBeFocused();
});
