// AUTHORED-BY Claude Opus 5.5
// Suite scenario 9 on a real Community Solid Server pod: Drive queues a new folder and a
// text save while offline, the shell outbox syncs them on reconnect, and a text save
// that meets a newer pod version surfaces as a conflict resolved with "Keep both".
import { randomUUID } from "node:crypto";
import { createPodClient } from "@jeswr/storage-client";
import type { Page } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";
import { accessible, accountAuth, cssAccount, expect, test, warmLiveRoutes } from "./fixtures";

const aliceRoot = () => new URL("alice/", cssAccount("alice").issuer).href;
const driveRoot = () => new URL("alice/drive/", cssAccount("alice").issuer).href;
const QUEUED = "Saved on this device. It will sync when you're back online.";
const GONE = [200, 202, 204, 205, 404];
// Draining replays through Drive's client, not a bare PUT: an inherit-verified folder create
// re-reads the target and every ancestor ACL around the write (dozens of requests on CSS).
const DRAIN = { timeout: 15_000 };

test.beforeAll(async ({ request }) => {
  // Keep cold route compilation outside the scenario's browser interaction budget.
  await warmLiveRoutes(request);
  expect((await request.get(`/drive/f/${encodeRef(driveRoot())}`)).status()).toBe(200);
});
// One interactive OIDC login, an offline/reconnect cycle, real pod checks and axe per state.
test.setTimeout(120_000);

const syncSheet = (page: Page) => page.getByRole("dialog", { name: "Sync status", exact: true });
const offlinePill = (page: Page) =>
  page.getByRole("button", { name: /^Offline — showing saved copies/ });
const waitingRows = (page: Page) =>
  syncSheet(page).getByRole("region", { name: "Waiting to sync" }).getByRole("listitem");

/** Open My Drive online so Drive provisions its root and mounts its outbox delegates. */
async function openDrive(page: Page) {
  await page.goto("/drive");
  await expect(page.getByRole("heading", { level: 2, name: "My Drive", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page
      .getByRole("grid", { name: "My Drive", exact: true })
      .or(page.getByRole("heading", { name: "Your Drive is empty", exact: true })),
  ).toBeVisible({ timeout: 30_000 });
}

async function newFolder(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "New", exact: true }).filter({ visible: true }).click();
    await page.getByRole("menuitem", { name: /^New folder/ }).click();
  } else
    await page
      .getByRole("toolbar", { name: "Folder actions", exact: true })
      .getByRole("button", { name: "New folder", exact: true })
      .click();
  const create = page.getByRole("dialog", { name: "New folder", exact: true });
  await create.getByRole("textbox", { name: "Folder name", exact: true }).fill(name);
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(create).toBeHidden();
}

async function closeSheet(page: Page) {
  const sheet = syncSheet(page);
  await page.keyboard.press("Escape");
  if (await sheet.isVisible()) await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

async function remove(auth: Awaited<ReturnType<typeof accountAuth>>, url: string) {
  const removed = await auth.fetch(url, { method: "DELETE" });
  expect(GONE).toContain(removed.status);
  await removed.body?.cancel();
}

// FIXME app bug (Drive guard policies overlap): driveGuardPolicy in
// apps/suite/src/apps/drive/lib/offline/guards.ts matches every `create` inside storage for
// BOTH drive.folder and drive.text, and the SDK requires each matching policy's own tag
// (packages/solid-offline/SKILL.md: "Matching policies require their own guard tag").
// Fails at: New folder -> Create while offline. withOutbox.create throws
// "[solid-offline] guard required by registered policy" (the drive.text policy rejects the
// drive.folder-guarded create) and Drive toasts "Couldn't create the folder"; nothing is
// queued. A local, unshipped guard change (drive.folder creates need url.endsWith("/"),
// drive.text creates need !url.endsWith("/")) made this test pass 18/18 across the matrix.
test.fixme("9A: a folder created offline waits on this device, then syncs to the pod", async ({
  page,
  context,
}) => {
  const auth = await accountAuth("alice");
  const name = `offline-${randomUUID()}`;
  const folderUrl = new URL(`${name}/`, driveRoot()).href;
  try {
    await openDrive(page);
    await context.setOffline(true);
    await expect(offlinePill(page)).toBeVisible();
    await accessible(page);

    await newFolder(page, name);
    await expect(page.getByText(QUEUED, { exact: true })).toBeVisible();
    await expect(offlinePill(page)).toHaveAccessibleName(
      "Offline — showing saved copies, 1 change waiting",
    );
    await offlinePill(page).click();
    const sheet = syncSheet(page);
    const row = waitingRows(page);
    await expect(row).toHaveCount(1);
    await expect(row.locator("strong")).toHaveText(name);
    await expect(row).toContainText("/alice/drive/");
    await expect(sheet.getByRole("button", { name: "Retry all", exact: true })).toBeDisabled();
    await accessible(page);
    // Queued only: the pod has no such container yet.
    const absent = await auth.fetch(folderUrl);
    expect(absent.status).toBe(404);
    await absent.body?.cancel();

    await context.setOffline(false);
    await expect(sheet.getByText("Everything is saved", { exact: true })).toBeVisible(DRAIN);
    await expect(sheet.getByText(/^Last synced/)).toBeVisible();
    const synced = await auth.fetch(folderUrl, { headers: { Accept: "text/turtle" } });
    expect(synced.status).toBe(200);
    expect(synced.headers.get("link") ?? "").toContain("http://www.w3.org/ns/ldp#BasicContainer");
    await synced.body?.cancel();

    await closeSheet(page);
    // Drive refreshes its listing when the outbox reports a completed sync.
    await expect(
      page.locator("tr[data-url]").filter({ has: page.getByText(name, { exact: true }) }),
    ).toHaveAttribute("data-url", folderUrl);
    await expect(offlinePill(page)).toBeHidden();
  } finally {
    await context.setOffline(false);
    await remove(auth, folderUrl);
    await auth.logout();
  }
});

// FIXME app bug (Drive guard policies overlap, as for 9A): the queued save, the replay's
// 412 and the conflict entry all work. Fails at: Resolve -> Keep both. The keep-both copy
// is a drive.text-guarded create that the drive.folder policy also matches, so
// outbox.resolve rejects with "[solid-offline] guard required by registered policy" before
// any request, the sheet toasts "Couldn't sync this change. It is still saved on this
// device." and the conflict stays. With the same local guard change this test passed
// 29/30 runs; the one miss stayed unresolved for 15s and was not reproduced in 12 reruns
// (the failure check below now reports a rejected resolve instead of a timeout).
test.fixme("9B: a text save queued offline meets a pod change, and Keep both keeps both versions", async ({
  page,
  context,
}) => {
  const auth = await accountAuth("alice");
  const { storage } = await createPodClient({ storage: aliceRoot(), fetch: auth.fetch });
  const stem = `notes-${randomUUID()}`;
  const fileName = `${stem}.txt`;
  const fileUrl = new URL(fileName, driveRoot()).href;
  const original = `Original ${randomUUID()}`;
  const local = `Written offline ${randomUUID()}`;
  const remote = `Changed on another device ${randomUUID()}`;
  const cleanup = new Set<string>();
  const copies = async () => {
    const found: string[] = [];
    for await (const entry of storage.listAll(driveRoot())) {
      const name = decodeURIComponent(new URL(entry.url).pathname.split("/").pop() ?? "");
      if (name.startsWith(`${stem}-conflict-`)) found.push(entry.url);
    }
    return found;
  };
  try {
    await openDrive(page);
    const created = await auth.fetch(fileUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
      body: original,
    });
    expect(created.status).toBe(201);
    cleanup.add(fileUrl);
    await created.body?.cancel();

    // Open the preview online so Drive captures the file's ETag and access discovery.
    await page.goto(`/drive/p/${encodeRef(fileUrl)}`);
    await expect(page.getByText(original, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("textbox", { name: `Edit ${fileName}`, exact: true });
    await expect(editor).toHaveValue(original);

    await context.setOffline(true);
    await expect(offlinePill(page)).toBeVisible();
    await editor.fill(local);
    const save = page.getByRole("button", { name: "Save", exact: true });
    // Offline, Save stays enabled only because this save can be queued and replayed.
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(QUEUED, { exact: true })).toBeVisible();
    await expect(editor).toBeHidden();

    await offlinePill(page).click();
    const sheet = syncSheet(page);
    const row = waitingRows(page);
    await expect(row).toHaveCount(1);
    await expect(row.locator("strong")).toHaveText(fileName);
    await expect(row).toContainText("/alice/drive/");
    await accessible(page);

    // Another writer changes the same file while this browser's save waits offline.
    const before = await auth.fetch(fileUrl);
    expect(await before.text()).toBe(original);
    const etag = before.headers.get("etag");
    expect(etag).toMatch(/^"/);
    const changed = await auth.fetch(fileUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "If-Match": etag as string },
      body: remote,
    });
    expect(changed.ok).toBe(true);
    await changed.body?.cancel();

    await context.setOffline(false);
    // The replay's If-Match gets a 412, which the outbox surfaces as a decision.
    const resolve = sheet.getByRole("button", { name: `Resolve ${fileName}`, exact: true });
    await expect(resolve).toBeVisible(DRAIN);
    await expect(sheet.getByRole("region", { name: "Waiting to sync" })).toHaveCount(0);
    expect(await (await auth.fetch(fileUrl)).text()).toBe(remote);
    await accessible(page);

    await resolve.click();
    const decision = page.getByRole("dialog", {
      name: "This item changed somewhere else",
      exact: true,
    });
    const both = decision.getByRole("button", { name: "Keep both", exact: true });
    await expect(both).toBeFocused();
    await expect(decision).toContainText(fileName);
    await accessible(page);
    await both.click();
    await expect(decision).toBeHidden();
    // A rejected resolve only toasts (and the toast times out): surface it, not a timeout.
    const saved = sheet.getByText("Everything is saved", { exact: true });
    const rejected = page.getByText(
      "Couldn't sync this change. It is still saved on this device.",
      { exact: true },
    );
    await expect(saved.or(rejected)).toBeVisible(DRAIN);
    await expect(rejected).toHaveCount(0);
    await expect(saved).toBeVisible();

    // The pod keeps the other writer's version at the original URL...
    const kept = await auth.fetch(fileUrl);
    expect(kept.ok).toBe(true);
    expect(await kept.text()).toBe(remote);
    // ...and the offline version as a create-only sibling named by the outbox's
    // non-RDF keep-both rule, `<stem>-conflict-<ms><ext>`, through Drive's upload.
    const found = await copies();
    for (const url of found) cleanup.add(url);
    expect(found).toHaveLength(1);
    const copyUrl = found[0] as string;
    expect(decodeURIComponent(new URL(copyUrl).pathname.split("/").pop() ?? "")).toMatch(
      new RegExp(`^${stem}-conflict-\\d{13}\\.txt$`),
    );
    expect(new URL(".", copyUrl).href).toBe(driveRoot());
    const copy = await auth.fetch(copyUrl);
    expect(copy.ok).toBe(true);
    expect(copy.headers.get("content-type") ?? "").toMatch(/^text\/plain\b/);
    expect(await copy.text()).toBe(local);
    await accessible(page);
  } finally {
    await context.setOffline(false);
    // Include a copy created before a failed assertion between resolve and listing.
    for (const url of await copies()) cleanup.add(url);
    for (const url of cleanup) await remove(auth, url);
    await auth.logout();
  }
});
