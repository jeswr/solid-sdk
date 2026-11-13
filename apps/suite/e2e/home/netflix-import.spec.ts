// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";
import { seedDemoSession } from "../demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));

test("Netflix imports both CSV rows into Home Media without duplicates after re-import", async ({
  page,
}) => {
  const fixture = fileURLToPath(new URL("./fixtures/netflix-viewing-history.csv", import.meta.url));
  const titles = ["The Garden", "A Quiet Weekend"];
  const hrefs: string[] = [];
  for (let run = 0; run < 2; run++) {
    await page.goto("/connect/netflix");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel(/Export file/).setInputFiles(fixture);
    await expect(
      page.getByRole("heading", { name: "Added 2 items to Media", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "See in Media", exact: true }).click();
    await expect(page).toHaveURL("/home/media");
    for (const [index, title] of titles.entries()) {
      const card = page.getByRole("listitem", { name: title, exact: true });
      await expect(card).toHaveCount(1);
      await expect(card).toBeVisible();
      const link = card.getByRole("link", { name: title, exact: true });
      const href = await link.getAttribute("href");
      expect(href).toBeTruthy();
      if (run === 0) hrefs.push(href as string);
      else expect(href).toBe(hrefs[index]);
      await card.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
      // These cards share a document: deleting either card must never delete the sibling.
      await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    expect(new Set(hrefs).size).toBe(2);
  }
  // The subject-specific links open the corresponding records from the shared document.
  for (const title of titles) {
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "More item actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/home/media");
  }
  // A full navigation creates a fresh session: wait for its cache before going offline.
  for (const title of titles)
    await expect(page.getByRole("listitem", { name: title, exact: true })).toBeVisible();
  // Keep the app assets available while signalling that the pod is offline.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  for (const title of titles) {
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /^Showing saved copies as of/ }),
    ).toBeVisible();
    await page.locator(".hm-item-back").click();
    for (const sibling of titles)
      await expect(page.getByRole("listitem", { name: sibling, exact: true })).toBeVisible();
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
  await page.reload();
  for (const title of titles)
    await expect(page.getByRole("listitem", { name: title, exact: true })).toBeVisible();

  // A foreign writer can use equivalent host/port spellings for the record IRIs.
  // Arrange that stored RDF, then reopen the real demo pod and check both card menus.
  await page.evaluate(async () => {
    const root = "https://alice.demo.pod/";
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("pods", "readwrite");
        const pods = transaction.objectStore("pods");
        const request = pods.get(root);
        request.onsuccess = () => {
          const stored = request.result as { snapshot: DemoPodSnapshot; revision: string };
          const history = stored.snapshot.resources.find(([url]) =>
            url.endsWith("/viewing-history.ttl"),
          )?.[1];
          if (!history) return reject(new Error("Imported history missing"));
          const body = new TextDecoder().decode(history.body);
          const aliased = body.replaceAll(root, "https://ALICE.demo.pod:443/");
          if (body === aliased) return reject(new Error("No record IRIs were aliased"));
          const resources = stored.snapshot.resources.map(
            ([url, resource]) =>
              [
                url,
                resource === history
                  ? { ...resource, body: new TextEncoder().encode(aliased) }
                  : resource,
              ] as const,
          );
          pods.put(
            {
              ...stored,
              revision: "netflix-alias-regression",
              snapshot: { ...stored.snapshot, resources },
            },
            root,
          );
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
  for (const title of titles) {
    const card = page.getByRole("listitem", { name: title, exact: true });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});
