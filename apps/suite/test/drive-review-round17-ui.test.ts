// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6

import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { DriveApp } from "../src/apps/drive/components/drive-app";
import { PreviewPage } from "../src/apps/drive/components/preview";
import { FolderView, TrashView } from "../src/apps/drive/components/views";
import * as operations from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { useDriveUi } from "../src/apps/drive/state/ui";

const STORAGE = "https://pod.example/";
const ROOT = `${STORAGE}drive/`;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
let ui: ReturnType<typeof useDriveUi>;
function Probe() {
  drive = useDrive();
  ui = useDriveUi();
  return null;
}
function tree(body: ReactNode = h(FolderView)) {
  return h(DriveApp, null, h(Probe), body);
}
async function setup() {
  const pod = createDemoPod({
    root: STORAGE,
    seed: ["A", "B"].map((name) => ({
      path: `drive/${name}.txt`,
      body: name,
      contentType: "text/plain",
    })),
  });
  session = {
    mode: "demo",
    webId: `${STORAGE}profile#me`,
    displayName: "Me",
    storageUrl: STORAGE,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
  return mount(tree());
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function rows(host: Element) {
  return [...host.querySelectorAll<HTMLElement>("[data-url]")];
}
async function openTrash(newerB: boolean) {
  const view = await setup();
  await act(async () => {
    const items = (await drive.client.list(ROOT)).toSorted((a, b) => a.name.localeCompare(b.name));
    const now = new Date();
    if (newerB) {
      for (const [index, item] of items.entries())
        await operations.trashItems(drive.client, ROOT, [item], {
          now: new Date(now.getTime() - (items.length - index) * 1000),
        });
    } else await operations.trashItems(drive.client, ROOT, items, { now });
  });
  await view.render(tree(h(TrashView)));
  // Trash intentionally sorts newest first. Exercise A's action while B is
  // first, without depending on whether two real clock reads cross a millisecond.
  if (newerB) expect(rows(view.host)[0]?.querySelector(".drv-name")?.textContent).toBe("B.txt");
  return view;
}
async function focus(element: HTMLElement) {
  await act(async () => element.focus());
  expect(document.activeElement).toBe(element);
}
async function activate(element: HTMLElement) {
  await focus(element);
  await click(element);
}
async function waitForRemoval(element: HTMLElement, expectedFocus: Element) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      expect(element.isConnected).toBe(false);
      expect(document.activeElement).toBe(expectedFocus);
    },
    { timeout: 10_000 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  ["delete", "row", "operation", false],
  ["delete", "toolbar", "operation", false],
  ["delete", "empty-trash", "operation", false],
  ["restore", "row", "operation", false],
  ["restore", "toolbar", "operation", false],
  ["delete", "row", "listing", false],
  ["restore", "row", "listing", false],
  ["delete", "row", "operation", true],
  ["restore", "row", "operation", true],
] as const)("Trash %s from %s preserves Search focus while awaiting %s (newer B: %s)", async (action, source, delay, newerB) => {
  const view = await openTrash(newerB);
  const removed = button("Restore: A.txt", view.host).closest("tr") as HTMLElement;
  if (source === "toolbar") await click(removed.querySelector("input") as Element);
  const label = action === "delete" ? "Delete for ever" : "Restore";
  const trigger = button(
    source === "row" ? `${label}: A.txt` : source === "empty-trash" ? "Empty trash" : label,
    view.host,
  );
  const pending = deferred<void>();
  const listing = deferred<void>();
  const list = operations.listTrash;
  const listings = new Set<ReturnType<typeof list>>();
  vi.spyOn(operations, "listTrash").mockImplementation((...args) => {
    const flight = (async () => {
      if (delay === "listing") await listing.promise;
      return list(...args);
    })();
    listings.add(flight);
    const settled = () => listings.delete(flight);
    void flight.then(settled, settled);
    return flight;
  });
  const remove = operations.deleteForever;
  const restore = operations.restoreItems;
  const mutation =
    action === "delete"
      ? vi.spyOn(operations, "deleteForever").mockImplementation(async (...args) => {
          await pending.promise;
          return remove(...args);
        })
      : vi.spyOn(operations, "restoreItems").mockImplementation(async (...args) => {
          await pending.promise;
          return restore(...args);
        });
  await activate(trigger);
  if (action === "delete") {
    const returnedFocus = deferred<void>();
    trigger.addEventListener("focus", () => returnedFocus.resolve(), { once: true });
    await activate(
      button(
        source === "empty-trash" ? "Empty trash" : label,
        document.querySelector('[role="alertdialog"]') as Element,
      ),
    );
    // Radix restores focus from a scheduled close callback. Observe that
    // lifecycle event, independent of the runner's polling/time budget.
    await returnedFocus.promise;
    expect(document.activeElement).toBe(trigger);
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 10_000 });
  }
  const search = view.host.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;
  await act(async () => {
    try {
      if (delay === "listing") {
        pending.resolve();
        const result = await mutation.mock.results[0]?.value;
        expect(result?.failed).toEqual([]);
      }
      search.focus();
      expect(document.activeElement).toBe(search);
      pending.resolve();
      const result = await mutation.mock.results[0]?.value;
      expect(result?.failed).toEqual([]);
    } finally {
      // Release the deliberate listing gate before asking React to drain work.
      // Otherwise act can wait for the very listing this test is still holding.
      listing.resolve();
    }
    while (listings.size) await Promise.all([...listings]);
  });
  await waitForRemoval(removed, search);
});

it.each([
  "shortcut",
  "topbar",
  "pane",
])("Details close via %s respects the current row and surviving control", async (action) => {
  const view = await setup();
  const [first, second] = rows(view.host) as [HTMLElement, HTMLElement];
  await click(first);
  await focus(first);
  await key(first, "d");
  expect(ui.detailsOpen).toBe(true);
  await click(second);
  await focus(second);
  expect(ui.detailsItems[0]?.url).toBe(`${ROOT}B.txt`);
  const toggle = button("Hide details", view.host);
  if (action === "shortcut") await key(second, "d");
  else await activate(action === "topbar" ? toggle : button("Close details", view.host));
  expect(ui.detailsOpen).toBe(false);
  expect(document.activeElement).toBe(action === "topbar" ? toggle : second);
  if (action !== "topbar") {
    await key(second, "Enter");
    expect(ui.preview?.items[ui.preview.index]?.url).toBe(`${ROOT}B.txt`);
  }
});

it.each([
  "preview",
  "main",
])("upload close falls back to the %s after returning from a folder", async (destination) => {
  const view = await setup();
  const item = await drive.client.stat(`${ROOT}A.txt`);
  // Direct preview -> Back to folder -> upload -> browser Back to preview.
  const preview = h(PreviewPage, { item, parent: ROOT });
  await view.render(tree(preview));
  const back = view.host.querySelector<HTMLAnchorElement>('[aria-label="Back to folder"]');
  expect(back?.getAttribute("href")).toBe("/drive/my");
  await view.render(tree());
  const upload = vi.spyOn(operations, "uploadFile");
  await act(async () => {
    drive.uploads.enqueue(ROOT, [new File(["text"], "Upload.txt", { type: "text/plain" })]);
    await upload.mock.results[0]?.value;
  });
  expect(drive.uploads.tasks[0]?.status).toBe("done");
  await view.render(tree(destination === "preview" ? preview : h("p", null, "Opening preview…")));
  expect(view.host.querySelector("[data-drive-listing]")).toBeNull();
  const trigger = button("Close uploads", view.host);
  await activate(trigger);
  expect(trigger.isConnected).toBe(false);
  expect(document.activeElement).toBe(
    view.host.querySelector(destination === "preview" ? ".drv-preview-page" : "main"),
  );
});

it.each([
  "close",
  "retry",
])("upload %s preserves focus moved outside the removed control", async (action) => {
  const view = await setup();
  const upload = vi.spyOn(operations, "uploadFile");
  if (action === "retry") upload.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    drive.uploads.enqueue(ROOT, [new File(["text"], "Upload.txt", { type: "text/plain" })]);
    await upload.mock.results[0]?.value.catch(() => undefined);
  });
  const trigger = button(action === "close" ? "Close uploads" : "Retry Upload.txt");
  const search = view.host.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;
  await focus(trigger);
  await act(async () => {
    trigger.click();
    // Move focus after the handler captures it but before React removes the control.
    search.focus();
  });
  expect(trigger.isConnected).toBe(false);
  expect(document.activeElement).toBe(search);
});

it("Details pane close preserves focus moved elsewhere before removal commits", async () => {
  const view = await setup();
  const first = rows(view.host)[0] as HTMLElement;
  await focus(first);
  await key(first, "d");
  const close = button("Close details");
  await focus(close);
  const search = view.host.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;
  await act(async () => {
    close.click();
    search.focus();
  });
  expect(close.isConnected).toBe(false);
  expect(document.activeElement).toBe(search);
});

it.each([
  ["row", false],
  ["toolbar", false],
  ["row", true],
  ["toolbar", true],
] as const)("Trash restore from %s replaces focus displaced by removal (newer B: %s)", async (source, newerB) => {
  const view = await openTrash(newerB);
  const removed = button("Restore: A.txt", view.host).closest("tr") as HTMLElement;
  const next = rows(view.host).find((row) => row !== removed) as HTMLElement;
  if (source === "toolbar") await click(removed.querySelector("input") as Element);
  const pending = deferred<void>();
  const restore = operations.restoreItems;
  const mutation = vi.spyOn(operations, "restoreItems").mockImplementation(async (...args) => {
    await pending.promise;
    return restore(...args);
  });
  await activate(button(source === "row" ? "Restore: A.txt" : "Restore"));
  await act(async () => {
    pending.resolve();
    await mutation.mock.results[0]?.value;
  });
  await waitForRemoval(removed, next);
});
