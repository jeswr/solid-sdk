// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import {
  accessible,
  accountAuth,
  cssAccount,
  expect,
  signIn,
  signedOutTest as test,
} from "./fixtures";

/** Check the actual keyboard focus, including each intermediate Tab stop. */
async function visibleFocus(page: Page) {
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  await expect(focused).toHaveJSProperty("isConnected", true);
  expect(await focused.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
}

async function key(page: Page, value: string) {
  await page.keyboard.press(value);
  await visibleFocus(page);
}

async function reach(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 80; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await visibleFocus(page);
      return;
    }
    const backwards = await target.evaluate((element) =>
      Boolean(
        (document.activeElement?.compareDocumentPosition(element) ?? 0) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ),
    );
    await key(page, backwards ? "Shift+Tab" : "Tab");
  }
  await expect(target).toBeFocused();
}

async function activate(page: Page, target: Locator) {
  await reach(page, target);
  await page.keyboard.press("Enter");
}

test("scenario 7: keyboard-only file share and revoke keep visible focus and restore the trigger", async ({
  page,
}) => {
  // OIDC, keyboard navigation, several axe scans and conditional live ACL writes.
  test.setTimeout(180_000);
  const root = new URL("alice/", cssAccount("alice").issuer).href;
  const name = `keyboard-share-${randomUUID()}.txt`;
  const url = new URL(`drive/${name}`, root).href;
  const alice = await accountAuth("alice", root);
  const bob = await accountAuth("bob", root);
  const original = `Private keyboard sharing fixture ${randomUUID()}`;
  const denied = async () => {
    const response = await bob.fetch(url);
    expect(response.status).toBe(403);
    await response.body?.cancel();
  };
  try {
    const created = await alice.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
      body: original,
    });
    expect(created.status).toBe(201);
    const anonymous = await fetch(url, { redirect: "error" });
    expect(anonymous.status).toBe(401);
    await anonymous.body?.cancel();
    await denied();
    await signIn(page, "alice", { keyboardOnly: true });
    await page.bringToFront();

    // All browser input from here is Tab, Shift+Tab, Enter, Space, Escape or arrows.
    await activate(
      page,
      page.getByRole("link", { name: "Drive", exact: true }).filter({ visible: true }),
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "My Drive", exact: true }),
    ).toBeVisible();
    const row = page.locator("tr[data-url]").filter({ has: page.getByText(name, { exact: true }) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await reach(page, page.locator('tr[data-url][tabindex="0"]'));
    const count = await page.locator("tr[data-url]").count();
    for (let step = 0; step < count; step++) {
      if (await row.evaluate((element) => element === document.activeElement)) break;
      await key(page, "ArrowDown");
    }
    await expect(row).toBeFocused();
    if ((await row.getAttribute("aria-selected")) !== "true") await key(page, "Space");
    await expect(row).toHaveAttribute("aria-selected", "true");
    const trigger = page
      .getByRole("toolbar", { name: "Selection actions", exact: true })
      .getByRole("button", { name: "Share", exact: true });
    const dialog = page.getByRole("dialog", { name: `Share “${name}”`, exact: true });
    const open = async () => {
      await activate(page, trigger);
      await expect(dialog.getByRole("region", { name: "People with access" })).toBeVisible();
      await visibleFocus(page);
    };
    await open();
    await accessible(page);
    const picker = dialog.getByRole("combobox", { name: "Add people", exact: true });
    // Escape first dismisses an open combobox, then its containing dialog.
    if ((await picker.getAttribute("aria-expanded")) === "true") {
      await key(page, "Escape");
      await expect(picker).toHaveAttribute("aria-expanded", "false");
      await expect(dialog).toBeVisible();
    }
    await key(page, "Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await visibleFocus(page);
    await open();
    await reach(page, picker);
    await page.keyboard.type(cssAccount("bob").webId);
    await visibleFocus(page);
    await key(page, "Enter");
    const role = dialog.getByLabel("Role for added people", { exact: true });
    await reach(page, role);
    await key(page, "ArrowDown");
    await expect(role).toHaveValue("editor");
    await activate(page, dialog.getByRole("button", { name: "Share", exact: true }));
    const bobRole = dialog.getByLabel(`Role for ${cssAccount("bob").webId}`, { exact: true });
    await expect(bobRole).toHaveValue("editor");
    await expect(bobRole).toBeEnabled();
    const done = dialog.getByRole("button", { name: "Done", exact: true });
    await expect(done).toBeFocused();
    await visibleFocus(page);
    await accessible(page);

    // These independent DPoP reads/writes prove CSS changed its real WAC policy.
    const shared = await bob.fetch(url);
    expect(shared.status).toBe(200);
    expect(await shared.text()).toBe(original);
    const edited = `Bob's keyboard-granted edit ${randomUUID()}`;
    const write = await bob.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: edited,
    });
    expect(write.ok).toBe(true);
    await activate(page, done);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await visibleFocus(page);

    await open();
    await expect(bobRole).toHaveValue("editor");
    const general = dialog.getByLabel("Who can access", { exact: true });
    await reach(page, general);
    await page.keyboard.press("ArrowDown");
    await expect(general).toHaveValue("anyone");
    await expect(general).toBeEnabled();
    await visibleFocus(page);
    const publicRead = await fetch(url, { redirect: "error" });
    expect(publicRead.status).toBe(200);
    expect(await publicRead.text()).toBe(edited);
    await accessible(page);
    // Remove the public grant first, so Bob's final 403 proves his own grant was revoked.
    await reach(page, general);
    await page.keyboard.press("ArrowUp");
    await expect(general).toHaveValue("restricted");
    await expect(general).toBeEnabled();
    await visibleFocus(page);
    const privateAgain = await fetch(url, { redirect: "error" });
    expect(privateAgain.status).toBe(401);
    await privateAgain.body?.cancel();
    // Traverse backwards as well, checking every stop inside the dialog's focus trap.
    await key(page, "Shift+Tab");
    await activate(
      page,
      dialog.getByRole("button", {
        name: `Remove access for ${cssAccount("bob").webId}`,
        exact: true,
      }),
    );
    await expect(bobRole).toHaveCount(0);
    await expect(done).toBeFocused();
    await visibleFocus(page);
    await denied();
    const revokedWrite = await bob.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "Must be denied",
    });
    expect(revokedWrite.status).toBe(403);
    await revokedWrite.body?.cancel();
    const retained = await alice.fetch(url);
    expect(retained.status).toBe(200);
    expect(await retained.text()).toBe(edited);
    await accessible(page);
    await key(page, "Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await visibleFocus(page);
    await accessible(page);
  } finally {
    // The disposable server owns fixture cleanup. Removing namespace members while
    // another matrix project bootstraps Drive can race its complete-namespace check.
    await Promise.all([alice.logout(), bob.logout()]);
  }
});
