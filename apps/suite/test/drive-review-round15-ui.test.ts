// AUTHORED-BY Codex

import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { FolderView, TrashView } from "../src/apps/drive/components/views";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import * as operations from "../src/apps/drive/lib/operations/operations";
import { listTrash, trashItems } from "../src/apps/drive/lib/operations/operations";
import { DriveProvider, useDrive, useFolder } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider } from "../src/apps/drive/state/ui";
import { type UploadQueue, useUploadQueue } from "../src/apps/drive/state/uploads";

const STORAGE = "https://pod.example/";
const ROOT = `${STORAGE}drive/`;

function sessionFor(pod: ReturnType<typeof createDemoPod>): PodSession {
  return {
    mode: "demo",
    webId: `${STORAGE}profile#me`,
    displayName: "Me",
    storageUrl: STORAGE,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: vi.fn(),
  };
}

let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([
  "Reports/q3",
  "Reports/q3/drafts/approved",
])("refreshes My Drive and every intermediate folder after dropping %s/file.txt", async (path) => {
  const pod = createDemoPod({ root: STORAGE });
  const folders = path
    .split("/")
    .map((_segment, index, segments) => `${ROOT}${segments.slice(0, index + 1).join("/")}/`);
  function Listing({ url }: { url: string }) {
    const listing = useFolder(url);
    return h("output", { "aria-label": url }, JSON.stringify(listing));
  }
  function Listings() {
    return h(
      "aside",
      null,
      folders.map((url) => h(Listing, { key: url, url })),
    );
  }
  const view = await mount(
    h(DriveProvider, {
      session: sessionFor(pod),
      children: h(DriveUiProvider, null, h(Probe), h(FolderView), h(Listings)),
    }),
  );
  expect(view.host.textContent).toContain("Your Drive is empty");
  const file = new File(["quarterly report"], "file.txt", { type: "text/plain" });
  const upload = vi.spyOn(operations, "uploadFile");
  await act(async () => {
    drive.uploads.enqueue(ROOT, [{ file, path: `${path}/file.txt` }]);
    await upload.mock.results[0]?.value;
  });
  expect(drive.uploads.tasks).toMatchObject([{ status: "done" }]);
  expect(await (await drive.client.read(`${ROOT}${path}/file.txt`)).text()).toBe(
    "quarterly report",
  );
  expect(view.host.querySelector(".drv-name")?.textContent).toBe("Reports");
  for (const [index, url] of folders.entries()) {
    const name = path.split("/")[index + 1] ?? "file.txt";
    expect(view.host.querySelector(`[aria-label="${url}"]`)?.textContent).toContain(
      `"name":"${name}"`,
    );
  }
});

it.each([
  { path: "file.txt", target: ROOT, expected: [ROOT] },
  {
    path: "Reports/q3/file.txt",
    target: `${ROOT}Archive/`,
    expected: [`${ROOT}Archive/`, `${ROOT}Archive/Reports/`, `${ROOT}Archive/Reports/q3/`],
  },
])("invalidates each folder once, stopping at the drop target ($path)", async (test) => {
  const pod = createDemoPod({ root: STORAGE });
  const client = createSolidDriveClient({ storageUrl: STORAGE, fetch: pod.fetch });
  const invalidate = vi.fn();
  let queue!: UploadQueue;
  function Queue() {
    queue = useUploadQueue(client, invalidate);
    return null;
  }
  await mount(h(Queue));
  const upload = vi.spyOn(operations, "uploadFile");
  await act(async () => {
    queue.enqueue(test.target, [{ file: new File(["x"], "file.txt"), path: test.path }]);
    await upload.mock.results[0]?.value;
  });
  expect(queue.tasks).toMatchObject([{ status: "done" }]);
  expect(invalidate.mock.calls.flat().sort()).toEqual(test.expected.toSorted());
});

it.each([
  ["toolbar", "next"],
  ["toolbar", "previous"],
  ["toolbar", "empty"],
  ["row", "next"],
  ["row", "previous"],
  ["row", "empty"],
] as const)("%s Restore focuses the %s trash target", async (action, destination) => {
  const pod = createDemoPod({
    root: STORAGE,
    seed: ["A", "B"].map((name) => ({
      path: `drive/${name}.txt`,
      body: name,
      contentType: "text/plain",
    })),
  });
  const session = sessionFor(pod);
  const view = await mount(
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, null, h(Probe)),
    }),
  );
  const items = await drive.client.list(ROOT);
  await act(async () => {
    await trashItems(drive.client, ROOT, destination === "empty" ? items.slice(0, 1) : items);
  });
  await view.render(
    h(DriveProvider, {
      session,
      children: h(DriveUiProvider, null, h(Probe), h(TrashView)),
    }),
  );
  const rows = [...view.host.querySelectorAll<HTMLElement>("tbody tr")];
  const removed = rows[destination === "previous" ? rows.length - 1 : 0];
  if (!removed) throw new Error("Missing Trash row");
  const name = removed.querySelector(".drv-name")?.textContent;
  const remaining = rows.find((row) => row !== removed);
  if (action === "toolbar") {
    const checkbox = removed.querySelector("input");
    if (!checkbox) throw new Error("Missing selection checkbox");
    await click(checkbox);
  }
  const trigger =
    action === "toolbar"
      ? [...view.host.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent === "Restore",
        )
      : removed.querySelector<HTMLButtonElement>(`[aria-label="Restore: ${name}"]`);
  if (!trigger) throw new Error("Missing Restore action");
  await act(async () => trigger.focus());
  expect(document.activeElement).toBe(trigger);
  await key(trigger, "Enter");
  // jsdom does not synthesize the browser's native button activation.
  const restore = vi.spyOn(operations, "restoreItems");
  await act(async () => {
    trigger.click();
    await restore.mock.results[0]?.value;
  });
  expect(removed.isConnected).toBe(false);
  expect(await listTrash(drive.client, ROOT)).toHaveLength(destination === "empty" ? 0 : 1);
  const target = remaining ?? view.host.querySelector<HTMLElement>("[data-drive-listing]");
  expect(target).not.toBeNull();
  expect(document.activeElement).toBe(target);
});
