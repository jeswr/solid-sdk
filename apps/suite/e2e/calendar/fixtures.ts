// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";
import { seedDemoSession } from "../demo-session";

const ROOT = "https://alice.demo.pod/";
/** Change the same durable pod another tab reads, then send its real change notification. */
export async function editDemo(
  page: Page,
  edits: { path: string; body: string | null }[] | "no-calendars",
) {
  return page.evaluate(
    async ({ root, edits }) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const originals: { path: string; body: string }[] = [];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pods", "readwrite");
        const store = tx.objectStore("pods");
        const read = store.get(root);
        read.onsuccess = () => {
          const stored = read.result as { revision: string; snapshot: DemoPodSnapshot };
          let resources = [...stored.snapshot.resources];
          let seq = stored.snapshot.etagSeq;
          const changes =
            edits === "no-calendars"
              ? resources
                  .filter(
                    ([url]) =>
                      url.startsWith(`${root}calendar/`) ||
                      url === `${root}settings/privateTypeIndex.ttl`,
                  )
                  .map(([url]) => ({ path: url.slice(root.length), body: null }))
              : edits;
          for (const edit of changes) {
            const url = new URL(edit.path, root).href;
            const previous = resources.find(([key]) => key === url)?.[1];
            if (!previous) throw new Error(`Missing demo fixture: ${edit.path}`);
            originals.push({ path: edit.path, body: new TextDecoder().decode(previous.body) });
            resources = resources.filter(([key]) => key !== url);
            if (edit.body !== null)
              resources.push([
                url,
                {
                  ...previous,
                  body: new TextEncoder().encode(edit.body),
                  etag: `"regression-${++seq}"`,
                },
              ]);
          }
          store.put(
            {
              revision: crypto.randomUUID(),
              snapshot: { ...stored.snapshot, resources, etagSeq: seq },
            },
            root,
          );
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      db.close();
      const channel = new BroadcastChannel("solid-suite-demo-changes");
      channel.postMessage(root);
      channel.close();
      return originals;
    },
    { root: ROOT, edits },
  );
}

export async function accessible(page: Page) {
  await expect(page).toHaveTitle(/Calendar/);
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export function eventEditor(page: Page) {
  return (page.viewportSize()?.width ?? 1280) >= 1024
    ? page.getByRole("dialog", { name: /^(New|Edit) event$/ })
    : page.getByRole("region", { name: /^(New|Edit) event$/ });
}

export async function prepareCalendar(page: Page) {
  await seedDemoSession(page);
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
}
