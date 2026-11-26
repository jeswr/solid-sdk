// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
test.setTimeout(180_000);

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
    // Space toggles selection at every viewport; a phone's row click opens the item.
    // Selection survives closing the share dialog, so only select a row that is not selected.
    await row.focus();
    if ((await row.getAttribute("aria-selected")) !== "true") await row.press("Space");
    await expect(row).toHaveAttribute("aria-selected", "true");
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
    const fileName = "shared.txt";
    const aliceRoot = new URL("alice/", cssAccount("alice").issuer).href;
    const alice = await accountAuth("alice", aliceRoot);
    const sessions = [alice];
    // Cleanup targets, deleted newest first so each folder is empty before its own DELETE.
    const cleanup: string[] = [];
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
      const nameInput = create.getByRole("textbox", { name: "Folder name", exact: true });
      if (keyboardOnly) {
        await tabTo(page, nameInput);
        await page.keyboard.type(folderName);
      } else await nameInput.fill(folderName);
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
      cleanup.push(folderUrl);
      const uploadedUrl = new URL("bob-upload.txt", folderUrl).href;
      // Bob's client may only send its token inside Alice's Drive container: wide enough to
      // probe the private sibling and the container itself, narrower than the pod root.
      const driveUrl = new URL("../", folderUrl).href;
      const bob = await accountAuth("bob", driveUrl);
      sessions.push(bob);
      // A private sibling outside the shared folder: the over-share control.
      const siblingUrl = new URL(`private-sibling-${randomUUID()}.txt`, driveUrl).href;
      const sibling = await alice.fetch(siblingUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
        body: "Alice's private sibling",
      });
      expect(sibling.status).toBe(201);
      cleanup.push(siblingUrl);
      /** Nothing but the folder and what inherits from it may have been shared. */
      const expectOutsideStaysPrivate = async (members: readonly string[]) => {
        for (const url of [siblingUrl, driveUrl, ...members]) {
          await anonymousStatus(url, 401);
          const response = await bob.fetch(url);
          expect(response.status, `Bob must stay denied on ${url}`).toBe(403);
          await response.body?.cancel();
        }
      };
      const bobPage = await bobContext.newPage();
      await signIn(bobPage, "bob", { keyboardOnly });
      await accessible(bobPage);
      // Bob's login foregrounds his window. Native Tab navigation needs Alice's
      // document active again; this does not assign focus to any share control.
      await page.bringToFront();

      await test.step("folder sharing explains descendants and leaves Bob denied before a grant", async () => {
        const dialog = await openShare(page, folder, folderName, keyboardOnly);
        await expect(dialog.getByRole("note")).toContainText(
          "Items inside that have their own sharing won't change. Open an item's sharing to change it.",
        );
        await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
        await expect(
          dialog.getByRole("combobox", { name: "Add people", exact: true }),
        ).toBeEnabled();
        await expect(dialog.getByLabel("Role for added people", { exact: true })).toBeEnabled();
        await expect(dialog.getByLabel("Who can access", { exact: true })).toBeEnabled();
        await accessible(page);
        await anonymousStatus(folderUrl, 401);
        const denied = await bob.fetch(folderUrl);
        expect(denied.status).toBe(403);
        await denied.body?.cancel();
        const upload = await bob.fetch(uploadedUrl, {
          method: "PUT",
          headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
          body: "Bob must not be able to upload before a grant",
        });
        expect(upload.status).toBe(403);
        await upload.body?.cancel();
        await activate(
          page,
          dialog.getByRole("button", { name: "Done", exact: true }),
          keyboardOnly,
        );
        await expect(dialog).toBeHidden();
      });

      // Arrange file bytes through CSS, then exercise file grants and revocation through Drive.
      const original = `Alice's private file ${randomUUID()}`;
      const fileUrl = new URL(fileName, folderUrl).href;
      cleanup.push(fileUrl);
      const created = await alice.fetch(fileUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
        body: original,
      });
      expect(created.status).toBe(201);
      await page.goto(`/drive/f/${encodeRef(folderUrl)}`);
      await expect(
        page.getByRole("heading", { level: 2, name: folderName, exact: true }),
      ).toBeVisible();
      const file = page
        .locator("tr[data-url]")
        .filter({ has: page.getByText(fileName, { exact: true }) });
      await expect(file).toBeVisible();
      await expect(file).toHaveAttribute("data-url", fileUrl);
      await anonymousStatus(fileUrl, 401);
      const before = await bob.fetch(fileUrl);
      expect(before.status).toBe(403);
      await before.body?.cancel();

      const dialog = await openShare(page, file, fileName, keyboardOnly);
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
      if (keyboardOnly)
        await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeFocused();
      await accessible(page);

      const shared = await bob.fetch(fileUrl);
      expect(shared.status).toBe(200);
      expect(await shared.text()).toBe(original);
      const edited = `Bob's edit ${randomUUID()}`;
      const write = await bob.fetch(fileUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: edited,
      });
      expect(write.ok).toBe(true);
      const ownerRead = await alice.fetch(fileUrl);
      expect(ownerRead.status).toBe(200);
      expect(await ownerRead.text()).toBe(edited);
      await anonymousStatus(fileUrl, 401);

      const general = dialog.getByLabel("Who can access", { exact: true });
      if (keyboardOnly) {
        await tabTo(page, general);
        await page.keyboard.press("End");
      } else await general.selectOption("anyone");
      await expect(general).toHaveValue("anyone");
      await expect(general).toBeEnabled();
      await expect(dialog.getByLabel("Link role", { exact: true })).toHaveValue("viewer");
      await expect(
        dialog.getByText("Anyone can access this item without signing in.", { exact: false }),
      ).toBeVisible();
      const publicRead = await fetch(fileUrl, { redirect: "error" });
      expect(publicRead.status).toBe(200);
      expect(await publicRead.text()).toBe(edited);
      const publicBobRead = await bob.fetch(fileUrl);
      expect(publicBobRead.status).toBe(200);
      expect(await publicBobRead.text()).toBe(edited);
      await expect(
        dialog.getByText(
          "Access end dates aren't available in this sharing dialog. Access continues until you remove it.",
          { exact: true },
        ),
      ).toBeVisible();
      info.annotations.push({
        type: "blocker",
        description:
          "CSS/WAC does not enforce grant expiry. Assert the unavailable-expiry explanation instead of expiry chips.",
      });

      // A public Viewer grant would keep Bob able to read after removing his Editor
      // grant. Restrict the link first so the final authenticated denial is meaningful.
      if (keyboardOnly) {
        await tabTo(page, general);
        await page.keyboard.press("Home");
      } else await general.selectOption("restricted");
      await expect(general).toHaveValue("restricted");
      await expect(general).toBeEnabled();
      await anonymousStatus(fileUrl, 401);
      const stillShared = await bob.fetch(fileUrl);
      expect(stillShared.status).toBe(200);
      expect(await stillShared.text()).toBe(edited);
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
      const revoked = await bob.fetch(fileUrl);
      expect(revoked.status).toBe(403);
      await revoked.body?.cancel();
      const revokedWrite = await bob.fetch(fileUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: "A revoked Editor must not be able to write",
      });
      expect(revokedWrite.status).toBe(403);
      await revokedWrite.body?.cancel();
      const retained = await alice.fetch(fileUrl);
      expect(retained.status).toBe(200);
      expect(await retained.text()).toBe(edited);
      // Request access, delivery and approval are tracked in SDK-APP-06/07.
      info.annotations.push({
        type: "blocker",
        description:
          "Stopped at real authenticated 403. Drive has no wired RequestAccess form, pod-inbox delivery or owner approval flow (SDK-APP-06/07); request -> approve -> read is not exercised.",
      });
      await activate(page, dialog.getByRole("button", { name: "Done", exact: true }), keyboardOnly);
      await expect(dialog).toBeHidden();
      await test.step("folder Editor grant lets Bob upload, then a public link and revocation are enforced", async () => {
        // The file section left the file with its own explicit ACL (Bob removed again).
        await page.goto("/drive");
        await expect(
          page.getByRole("heading", { level: 2, name: "My Drive", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(folder).toBeVisible();
        await expectOutsideStaysPrivate([fileUrl]);
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
        cleanup.push(uploadedUrl);
        const ownerRead = await alice.fetch(uploadedUrl);
        expect(ownerRead.status).toBe(200);
        expect(await ownerRead.text()).toBe(bytes);
        await anonymousStatus(folderUrl, 401);
        await anonymousStatus(uploadedUrl, 401);
        // Items with their own sharing and everything outside the folder do not follow it.
        await expectOutsideStaysPrivate([fileUrl]);
        await activate(
          page,
          dialog.getByRole("button", { name: "Done", exact: true }),
          keyboardOnly,
        );
        await expect(dialog).toBeHidden();
        await openShare(page, folder, folderName, keyboardOnly);
        await expect(bobRole).toHaveValue("editor");

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
        await expectOutsideStaysPrivate([fileUrl]);
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
        const revokedOverwrite = await bob.fetch(uploadedUrl, {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: "A revoked Editor must not overwrite the file it uploaded",
        });
        expect(revokedOverwrite.status).toBe(403);
        await revokedOverwrite.body?.cancel();
        await expectOutsideStaysPrivate([fileUrl]);
        const retained = await alice.fetch(uploadedUrl);
        expect(retained.status).toBe(200);
        expect(await retained.text()).toBe(bytes);
        await accessible(page);
        await activate(
          page,
          dialog.getByRole("button", { name: "Done", exact: true }),
          keyboardOnly,
        );
        await expect(dialog).toBeHidden();
      });
    } finally {
      await bobContext.close();
      for (const url of cleanup.reverse()) {
        const removed = await alice.fetch(url, { method: "DELETE" });
        expect.soft([200, 204, 205, 404], `DELETE ${url}`).toContain(removed.status);
        await removed.body?.cancel();
      }
      await Promise.all(sessions.map((session) => session.logout()));
    }
  });
}

// Not covered yet: bob uploading into the shared folder through Drive's UI. CSS answers the
// placeholder PUT with 201 and no ETag, and Drive refuses to overwrite an unconfirmed
// representation (tracked in sst-2vvz). Request access and approval wait on SDK-APP-06/07.
