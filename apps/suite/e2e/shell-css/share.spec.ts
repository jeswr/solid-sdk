// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import { forClientCredentials } from "@jeswr/pod-auth/node";
import type { Locator, Page } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";
import {
  type AccountName,
  accessible,
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

/** Separate credentials for enforcement checks, never injected into either browser session. */
async function accountAuth(name: AccountName, boundary: string) {
  const account = cssAccount(name);
  let cookie = "";
  const json = async (path: string, body?: unknown) => {
    const url = new URL(path, account.issuer);
    expect(url.origin).toBe(new URL(account.issuer).origin);
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    // Never include an account response body (which can contain secrets) in an assertion.
    expect(response.ok).toBe(true);
    return response.json();
  };
  const before = await json(".account/");
  await json(before.controls.password.login, {
    email: account.email,
    password: account.password,
  });
  const after = await json(".account/");
  const credentials = await json(after.controls.account.clientCredentials, {
    name: `shell-share-${randomUUID()}`,
    webId: account.webId,
  });
  return forClientCredentials({
    issuer: account.issuer,
    clientId: credentials.id,
    clientSecret: credentials.secret,
    boundary: [boundary],
    allowInsecureLoopback: true,
  });
}

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
  test(`scenario 7 partial: folder-sharing blocker and real file ACLs (${keyboardOnly ? "keyboard only" : "pointer"})`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("The live CSS harness requires a suite baseURL");
    const folderName = `share-${randomUUID()}`;
    const fileName = "shared.txt";
    const aliceRoot = new URL("alice/", cssAccount("alice").issuer).href;
    const alice = await accountAuth("alice", aliceRoot);
    const bobContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize(),
      colorScheme: info.project.use.colorScheme ?? "light",
      reducedMotion: "reduce",
    });
    let folderUrl: string | undefined;
    let fileUrl: string | undefined;
    let bob: Awaited<ReturnType<typeof accountAuth>> | undefined;
    try {
      await page.goto("/drive");
      await expect(
        page.getByRole("heading", { level: 2, name: "My Drive", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      if ((page.viewportSize()?.width ?? 1280) < 768) {
        await page
          .getByRole("button", { name: "New", exact: true })
          .filter({ visible: true })
          .click();
        await page.getByRole("menuitem", { name: /^New folder/ }).click();
      } else
        await page
          .getByRole("toolbar", { name: "Folder actions", exact: true })
          .getByRole("button", { name: "New folder", exact: true })
          .click();
      const create = page.getByRole("dialog", { name: "New folder", exact: true });
      await create.getByRole("textbox", { name: "Folder name", exact: true }).fill(folderName);
      await create.getByRole("button", { name: "Create", exact: true }).click();
      await expect(create).toBeHidden();
      const folder = page.locator("tr[data-url]").filter({
        has: page.getByText(folderName, { exact: true }),
      });
      await expect(folder).toBeVisible();
      folderUrl = (await folder.getAttribute("data-url")) as string;
      expect(folderUrl.startsWith(aliceRoot)).toBe(true);
      bob = await accountAuth("bob", folderUrl);
      const bobPage = await bobContext.newPage();
      await signIn(bobPage, "bob");
      // Bob's login foregrounds his window. Native Tab navigation needs Alice's
      // document active again; this does not assign focus to any share control.
      await page.bringToFront();

      await test.step("folder sharing explains the blocker and leaves Bob denied by CSS", async () => {
        const dialog = await openShare(page, folder, folderName, keyboardOnly);
        const explanation = dialog.getByRole("status").filter({
          hasText: "Folder sharing is read-only for now",
        });
        await expect(explanation).toContainText(
          "Changes here would not reach the files and folders inside",
        );
        await expect(explanation).toContainText("To change access to a file, share that file.");
        await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
        await expect(
          dialog.getByRole("combobox", { name: "Add people", exact: true }),
        ).toBeDisabled();
        await expect(dialog.getByLabel("Role for added people", { exact: true })).toBeDisabled();
        await expect(dialog.getByLabel("Who can access", { exact: true })).toBeDisabled();
        await accessible(page);
        await anonymousStatus(folderUrl as string, 401);
        const denied = await bob?.fetch(folderUrl as string);
        expect(denied?.status).toBe(403);
        await denied?.body?.cancel();
        const upload = await bob?.fetch(new URL("bob-upload.txt", folderUrl).href, {
          method: "PUT",
          headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
          body: "Bob must not be able to upload before a grant",
        });
        expect(upload?.status).toBe(403);
        await upload?.body?.cancel();
        info.annotations.push({
          type: "blocker",
          description:
            "Scenario 7 folder grant/upload/revocation cannot run: Drive deliberately disables folder sharing until SDK writes support member access. The remaining steps below exercise a file, not folder acceptance.",
        });
        await activate(
          page,
          dialog.getByRole("button", { name: "Done", exact: true }),
          keyboardOnly,
        );
        await expect(dialog).toBeHidden();
      });

      // Keep the supported file path exercised against real CSS; do not seed a grant
      // behind the read-only folder UI and misrepresent it as successful folder sharing.
      // Arrange file bytes through CSS: the separate upload-blocker test below records
      // why Drive's UI upload cannot currently serve as this test's setup on CSS.
      const original = `Alice's private file ${randomUUID()}`;
      fileUrl = new URL(fileName, folderUrl).href;
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
      info.annotations.push({
        type: "blocker",
        description:
          "Stopped at real authenticated 403. Drive has no wired RequestAccess form, pod-inbox delivery or owner approval flow (SDK-APP-06/07); request -> approve -> read is not exercised.",
      });
      await activate(page, dialog.getByRole("button", { name: "Done", exact: true }), keyboardOnly);
      await expect(dialog).toBeHidden();
    } finally {
      await bobContext.close();
      if (fileUrl) expect.soft((await alice.fetch(fileUrl, { method: "DELETE" })).ok).toBe(true);
      if (folderUrl)
        expect.soft((await alice.fetch(folderUrl, { method: "DELETE" })).ok).toBe(true);
      await Promise.all([alice.logout(), bob?.logout()]);
    }
  });
}

test("scenario 7 upload blocker: CSS creation has no write validator", async ({ page }, info) => {
  const name = `upload-${randomUUID()}.txt`;
  const root = new URL("alice/", cssAccount("alice").issuer).href;
  const url = new URL(`drive/${name}`, root).href;
  const alice = await accountAuth("alice", root);
  try {
    await page.goto("/drive");
    await expect(
      page.getByRole("heading", { level: 2, name: "My Drive", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("drive-upload-input")).toBeAttached();
    const created = page.waitForResponse(
      (response) =>
        response.url() === url &&
        response.request().method() === "PUT" &&
        response.status() === 201,
    );
    await page.getByTestId("drive-upload-input").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("This payload must not be mistaken for the empty placeholder"),
    });
    expect(await (await created).headerValue("etag")).toBeNull();
    const uploads = page.getByRole("region", { name: "Uploads", exact: true });
    await expect(
      uploads.getByRole("heading", { name: "0 uploads complete, 1 upload failed", exact: true }),
    ).toBeVisible();
    await expect(uploads).toContainText(
      "This item's version or access discovery could not be confirmed. Refresh and confirm again.",
    );
    await anonymousStatus(url, 401);
    const placeholder = await alice.fetch(url);
    expect(placeholder.status).toBe(200);
    expect(await placeholder.text()).toBe("");
    info.annotations.push({
      type: "blocker",
      description:
        "CSS's placeholder PUT returns 201 without ETag. Drive correctly refuses to overwrite an unconfirmed representation; UI upload leaves an empty private placeholder. No read-after-write substitution or retry is used.",
    });
  } finally {
    expect.soft((await alice.fetch(url, { method: "DELETE" })).ok).toBe(true);
    await alice.logout();
  }
});
