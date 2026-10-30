// AUTHORED-BY Codex

import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams({ q: ".txt" }),
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
import {
  FolderView,
  RecentView,
  SearchView,
  StarredView,
  TrashView,
} from "../src/apps/drive/components/views";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";

const STORAGE = "https://pod.example/";
const ROOT = `${STORAGE}drive/`;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  return null;
}
function tree(body: ReactNode = h(FolderView)) {
  return h(DriveApp, null, h(Probe), body);
}
async function setup(count = 3) {
  const pod = createDemoPod({
    root: STORAGE,
    seed: ["A", "B", "C"].slice(0, count).map((name) => ({
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
  const view = await mount(tree());
  // A separate client represents tab B. Only pod subscription events refresh tab A;
  // no local Drive action or invalidate call participates in these removals.
  const remote = createSolidDriveClient({ storageUrl: STORAGE, fetch: pod.fetch });
  return { view, remote };
}
function button(label: string, scope: ParentNode) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function rows(host: Element) {
  return [...host.querySelectorAll<HTMLElement>("[data-url]")];
}
async function focus(element: HTMLElement) {
  await act(async () => element.focus());
  expect(document.activeElement).toBe(element);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const destinations = ["next", "previous", "listing"] as const;
const trashCases = (["checkbox", "row Restore", "toolbar Restore"] as const).flatMap((source) =>
  destinations.map((destination) => ({ source, destination })),
);
it.each(trashCases)("Trash remote restore recovers $source focus to the $destination", async ({
  source,
  destination,
}) => {
  const { view, remote } = await setup(destination === "listing" ? 1 : 3);
  await act(async () => {
    await trashItems(remote, ROOT, await remote.list(ROOT));
  });
  await view.render(tree(h(TrashView)));
  const before = rows(view.host);
  const index = destination === "previous" ? 2 : destination === "next" ? 1 : 0;
  const removed = before[index] as HTMLElement;
  const checkbox = removed.querySelector<HTMLInputElement>("input") as HTMLInputElement;
  if (source === "toolbar Restore") await click(checkbox);
  const control =
    source === "checkbox"
      ? checkbox
      : source === "row Restore"
        ? button(`Restore: ${removed.querySelector(".drv-name")?.textContent}`, removed)
        : button("Restore", view.host);
  await focus(control);
  const entry = (await listTrash(remote, ROOT)).find((entry) => entry.url === removed.dataset.url);
  if (!entry) throw new Error("Missing remote Trash entry");
  await act(async () => {
    expect((await restoreItems(remote, ROOT, [entry])).failed).toHaveLength(0);
  });
  await vi.waitFor(() => expect(removed.isConnected).toBe(false));
  expect(control.isConnected).toBe(false);
  expect(document.activeElement).toBe(
    destination === "listing"
      ? view.host.querySelector("[data-drive-listing]")
      : before[destination === "next" ? index + 1 : index - 1],
  );
});

const browserCases = (["list", "grid"] as const).flatMap((viewMode) =>
  (["row", "row menu", "toolbar"] as const).flatMap((source) =>
    destinations.map((destination) => ({ viewMode, source, destination })),
  ),
);
it.each(
  browserCases,
)("main listing remote removal recovers $viewMode $source focus to the $destination", async ({
  viewMode,
  source,
  destination,
}) => {
  const { view, remote } = await setup(destination === "listing" ? 1 : 3);
  await act(async () => drive.updatePrefs((prefs) => ({ ...prefs, view: viewMode })));
  const before = rows(view.host);
  const index = destination === "previous" ? 2 : destination === "next" ? 1 : 0;
  const removed = before[index] as HTMLElement;
  if (source === "toolbar") await click(removed);
  const control =
    source === "row"
      ? removed
      : source === "row menu"
        ? button(`More actions for ${String.fromCharCode(65 + index)}.txt`, view.host)
        : button("Move to trash", view.host);
  await focus(control);
  await act(async () => remote.remove(removed.dataset.url as string));
  await vi.waitFor(() => expect(removed.isConnected).toBe(false));
  expect(control.isConnected).toBe(false);
  const next =
    destination === "listing"
      ? view.host.querySelector<HTMLElement>("[data-drive-listing]")
      : before[destination === "next" ? index + 1 : index - 1];
  expect(document.activeElement).toBe(next);
  if (destination !== "listing") {
    expect(next?.tabIndex).toBe(0);
    expect(view.host.querySelectorAll('[data-url][tabindex="0"]')).toHaveLength(1);
    await key(next as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(rows(view.host)[0]);
  }
});

it.each([
  "Recent",
  "Starred",
  "Search",
])("%s remote removal recovers grid menu focus after its live refresh", async (kind) => {
  const { view, remote } = await setup();
  await act(async () =>
    drive.updatePrefs((prefs) => ({
      ...prefs,
      view: "grid",
      starred: [`${ROOT}A.txt`, `${ROOT}B.txt`, `${ROOT}C.txt`],
    })),
  );
  await view.render(
    tree(h(kind === "Recent" ? RecentView : kind === "Starred" ? StarredView : SearchView)),
  );
  const before = rows(view.host);
  const removed = before[1] as HTMLElement;
  const item = await remote.stat(removed.dataset.url as string);
  await focus(button(`More actions for ${item.name}`, view.host));
  await act(async () => remote.remove(removed.dataset.url as string));
  await vi.waitFor(() => {
    expect(rows(view.host)).toHaveLength(2);
    expect(document.activeElement).toBe(rows(view.host)[1]);
  });
});

it.each([
  "Trash",
  "main listing",
])("%s remote removal preserves focus moved to Search", async (kind) => {
  const { view, remote } = await setup();
  if (kind === "Trash") {
    await act(async () => {
      await trashItems(remote, ROOT, await remote.list(ROOT));
    });
    await view.render(tree(h(TrashView)));
  }
  const removed = rows(view.host)[0] as HTMLElement;
  await focus((removed.querySelector("input") as HTMLElement | null) ?? removed);
  const search = view.host.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;
  await focus(search);
  await act(async () => {
    if (kind === "Trash") {
      const entry = (await listTrash(remote, ROOT)).find(
        (entry) => entry.url === removed.dataset.url,
      );
      if (!entry) throw new Error("Missing remote Trash entry");
      await restoreItems(remote, ROOT, [entry]);
    } else await remote.remove(removed.dataset.url as string);
  });
  await vi.waitFor(() => expect(removed.isConnected).toBe(false));
  expect(document.activeElement).toBe(search);
});

it.each([
  "success",
  "failure",
])("Recent remote refresh keeps focus during a pending scan and recovers after %s", async (outcome) => {
  const { view, remote } = await setup();
  await view.render(tree(h(RecentView)));
  const before = rows(view.host);
  const removed = before[1] as HTMLElement;
  await focus(removed);
  const pending = deferred<void>();
  const list = drive.client.list;
  const scan = vi.spyOn(drive.client, "list").mockImplementation(async (...args) => {
    await pending.promise;
    if (outcome === "failure") throw new Error("offline");
    return list(...args);
  });
  await act(async () => remote.remove(removed.dataset.url as string));
  expect(scan).toHaveBeenCalled();
  expect(removed.isConnected).toBe(true);
  expect(document.activeElement).toBe(removed);
  await act(async () => pending.resolve());
  await vi.waitFor(() => expect(removed.isConnected).toBe(false));
  expect(document.activeElement).toBe(
    outcome === "success" ? before[2] : view.host.querySelector("[data-drive-listing]"),
  );
});
