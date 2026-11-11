// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";
import {
  accessible,
  accountAuth,
  cssAccount,
  expect,
  signIn,
  test,
  tabTo as traverseTabs,
  warmLiveRoutes,
} from "./fixtures";

test.beforeAll(async ({ request }) => {
  await warmLiveRoutes(request);
  const root = new URL("alice/drive/", cssAccount("alice").issuer).href;
  expect((await request.get(`/drive/f/${encodeRef(root)}`)).status()).toBe(200);
});
// Two interactive OIDC logins and several real, conditional ACL writes per scenario.
test.setTimeout(120_000);

async function activate(page: Page, target: Locator, keyboardOnly: boolean) {
  if (keyboardOnly) {
    await tabTo(page, target);
    await page.keyboard.press("Enter");
  } else await target.click();
}

async function tabTo(page: Page, target: Locator) {
  // Login and axe can foreground another window in this two-context scenario.
  // Activate Alice's window while preserving the control's real place in the tab order.
  await page.bringToFront();
  try {
    await traverseTabs(page, target);
  } catch (cause) {
    const focus = await page.evaluate(() => ({
      documentFocused: document.hasFocus(),
      active: document.activeElement?.outerHTML.slice(0, 400),
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    }));
    throw new Error(`Cannot reach control by Tab: ${JSON.stringify(focus)}`, { cause });
  }
}

async function selectRow(page: Page, row: Locator, keyboardOnly: boolean) {
  if (!keyboardOnly) {
    // Space selects at every viewport; a phone's row click opens the item.
    await row.focus();
    await row.press("Space");
    return;
  }
  await tabTo(page, page.locator('tr[data-url][tabindex="0"]'));
  await page.keyboard.press("Home");
  const count = await page.locator("tr[data-url]").count();
  for (let step = 0; step < count; step++) {
    if (await row.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function openShare(page: Page, row: Locator, name: string, keyboardOnly: boolean) {
  await selectRow(page, row, keyboardOnly);
  await activate(
    page,
    page
      .getByRole("toolbar", { name: "Selection actions", exact: true })
      .getByRole("button", { name: "Share", exact: true }),
    keyboardOnly,
  );
  const dialog = page.getByRole("dialog", { name: `Share “${name}”`, exact: true });
  await expect(dialog.getByRole("region", { name: "People with access" })).toBeVisible();
  return dialog;
}

async function anonymousStatus(url: string, status: number) {
  const response = await fetch(url, { redirect: "error" });
  expect(response.status).toBe(status);
  await response.body?.cancel();
}

for (const keyboardOnly of [false, true]) {
  test(`scenario 7: folder Editor, member upload, public link and revocation (${keyboardOnly ? "keyboard only" : "pointer"})`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("The live CSS harness requires a suite baseURL");
    const folderName = `share-${randomUUID()}`;
    const aliceRoot = new URL("alice/", cssAccount("alice").issuer).href;
    const alice = await accountAuth("alice", aliceRoot);
    const bob = await accountAuth("bob", aliceRoot);
    const bobContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize(),
      colorScheme: info.project.use.colorScheme ?? "light",
      reducedMotion: "reduce",
    });
    try {
      await page.goto("/drive");
      await expect(
        page.getByRole("heading", { level: 2, name: "My Drive", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      if ((page.viewportSize()?.width ?? 1280) < 768) {
        await activate(
          page,
          page.getByRole("button", { name: "New", exact: true }).filter({ visible: true }),
          keyboardOnly,
        );
        await activate(page, page.getByRole("menuitem", { name: /^New folder/ }), keyboardOnly);
      } else {
        await activate(
          page,
          page
            .getByRole("toolbar", { name: "Folder actions", exact: true })
            .getByRole("button", { name: "New folder", exact: true }),
          keyboardOnly,
        );
      }
      const create = page.getByRole("dialog", { name: "New folder", exact: true });
      const name = create.getByRole("textbox", { name: "Folder name", exact: true });
      if (keyboardOnly) {
        await tabTo(page, name);
        await page.keyboard.type(folderName);
      } else await name.fill(folderName);
      await activate(
        page,
        create.getByRole("button", { name: "Create", exact: true }),
        keyboardOnly,
      );
      await expect(create).toBeHidden();
      const folder = page.locator("tr[data-url]").filter({
        has: page.getByText(folderName, { exact: true }),
      });
      await expect(folder).toBeVisible();
      const folderUrl = await folder.getAttribute("data-url");
      if (!folderUrl?.startsWith(aliceRoot))
        throw new Error("Created folder is outside Alice's pod");
      const uploadedUrl = new URL("bob-upload.txt", folderUrl).href;
      await anonymousStatus(folderUrl, 401);
      const denied = await bob.fetch(folderUrl);
      expect(denied.status).toBe(403);
      await denied.body?.cancel();
      const deniedUpload = await bob.fetch(uploadedUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
        body: "Must be denied before sharing",
      });
      expect(deniedUpload.status).toBe(403);
      await deniedUpload.body?.cancel();
      const bobPage = await bobContext.newPage();
      await signIn(bobPage, "bob", { keyboardOnly });
      await accessible(bobPage);
      await page.bringToFront();

      const dialog = await openShare(page, folder, folderName, keyboardOnly);
      const picker = dialog.getByRole("combobox", { name: "Add people", exact: true });
      if (keyboardOnly) {
        await tabTo(page, picker);
        await page.keyboard.type(cssAccount("bob").webId);
        await page.keyboard.press("Enter");
      } else {
        await picker.fill(cssAccount("bob").webId);
        await dialog.getByRole("button", { name: "Add person", exact: true }).click();
      }
      const addedRole = dialog.getByLabel("Role for added people", { exact: true });
      if (keyboardOnly) {
        await tabTo(page, addedRole);
        await page.keyboard.press("End");
      } else await addedRole.selectOption("editor");
      await expect(addedRole).toHaveValue("editor");
      await activate(
        page,
        dialog.getByRole("button", { name: "Share", exact: true }),
        keyboardOnly,
      );
      const bobRole = dialog.getByLabel(`Role for ${cssAccount("bob").webId}`, { exact: true });
      await expect(bobRole).toHaveValue("editor");
      await expect(bobRole).toBeEnabled();
      await accessible(page);

      // An independent DPoP client proves both folder and inherited member permissions.
      const shared = await bob.fetch(folderUrl);
      expect(shared.status).toBe(200);
      await shared.body?.cancel();
      const bytes = `Bob's folder upload ${randomUUID()}`;
      const upload = await bob.fetch(uploadedUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
        body: bytes,
      });
      expect(upload.status).toBe(201);
      const ownerRead = await alice.fetch(uploadedUrl);
      expect(ownerRead.status).toBe(200);
      expect(await ownerRead.text()).toBe(bytes);
      await anonymousStatus(uploadedUrl, 401);
      await activate(page, dialog.getByRole("button", { name: "Done", exact: true }), keyboardOnly);
      await expect(dialog).toBeHidden();
      await openShare(page, folder, folderName, keyboardOnly);

      const general = dialog.getByLabel("Who can access", { exact: true });
      if (keyboardOnly) {
        await tabTo(page, general);
        await page.keyboard.press("End");
      } else await general.selectOption("anyone");
      await expect(general).toHaveValue("anyone");
      await expect(general).toBeEnabled();
      await expect(dialog.getByLabel("Link role", { exact: true })).toHaveValue("viewer");
      await anonymousStatus(folderUrl, 200);
      const publicRead = await fetch(uploadedUrl, { redirect: "error" });
      expect(publicRead.status).toBe(200);
      expect(await publicRead.text()).toBe(bytes);
      await expect(
        dialog.getByText(
          "Access end dates aren't available in this sharing dialog. Access continues until you remove it.",
          { exact: true },
        ),
      ).toBeVisible();
      await accessible(page);

      // A public Viewer grant would keep Bob able to read after removing his Editor grant.
      if (keyboardOnly) {
        await tabTo(page, general);
        await page.keyboard.press("Home");
      } else await general.selectOption("restricted");
      await expect(general).toHaveValue("restricted");
      await expect(general).toBeEnabled();
      await anonymousStatus(folderUrl, 401);
      await anonymousStatus(uploadedUrl, 401);
      const stillShared = await bob.fetch(uploadedUrl);
      expect(stillShared.status).toBe(200);
      expect(await stillShared.text()).toBe(bytes);
      await activate(
        page,
        dialog.getByRole("button", {
          name: `Remove access for ${cssAccount("bob").webId}`,
          exact: true,
        }),
        keyboardOnly,
      );
      await expect(bobRole).toHaveCount(0);
      await expect(general).toBeEnabled();
      for (const url of [folderUrl, uploadedUrl]) {
        const revoked = await bob.fetch(url);
        expect(revoked.status).toBe(403);
        await revoked.body?.cancel();
      }
      const revokedWrite = await bob.fetch(new URL("revoked.txt", folderUrl).href, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: "Must be denied after revocation",
      });
      expect(revokedWrite.status).toBe(403);
      await revokedWrite.body?.cancel();
      const retained = await alice.fetch(uploadedUrl);
      expect(retained.status).toBe(200);
      expect(await retained.text()).toBe(bytes);
      info.annotations.push({
        type: "blocker",
        description:
          "CSS/WAC has no grant expiry. Request-access delivery and owner approval still wait on SDK-APP-06/07; the test stops at real authenticated 403.",
      });
      await accessible(page);
      await activate(page, dialog.getByRole("button", { name: "Done", exact: true }), keyboardOnly);
      await expect(dialog).toBeHidden();
    } finally {
      await bobContext.close();
      // Keep unique pod fixtures until this run's in-memory CSS stops; deleting a
      // namespace member can race another project's complete-namespace admission.
      await Promise.all([alice.logout(), bob.logout()]);
    }
  });
}
