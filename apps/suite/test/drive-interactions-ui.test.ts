// AUTHORED-BY Codex

import { Fragment } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  createSolidDriveClient,
  type DriveClient,
  type DriveItem,
} from "../src/apps/drive/lib/client/client";
import type { DriveDialog } from "../src/apps/drive/state/ui";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  client: { list: vi.fn(), stat: vi.fn(), move: vi.fn() },
  undoMove: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(),
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
  params: new URLSearchParams(),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => mocks.params,
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => drive }));

import { DriveDialogs } from "../src/apps/drive/components/dialogs";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { TrashView } from "../src/apps/drive/components/views";

vi.mock("../src/apps/drive/state/undo", () => ({ moveWithValidator: mocks.undoMove }));

import { DriveError } from "../src/apps/drive/lib/client/client";
import * as operations from "../src/apps/drive/lib/operations/operations";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";

const ROOT = "https://pod.example/drive/";
const items: DriveItem[] = ["A", "B", "C"].map((name) => ({
  url: `${ROOT}${name}.txt`,
  name: `${name}.txt`,
  kind: "file",
  contentType: "text/plain",
}));
const drive = {
  client: mocks.client as unknown as DriveClient,
  driveRoot: ROOT,
  prefs: { starred: [], openedShared: [], view: "list", sort: { key: "name", dir: "asc" } },
  updatePrefs: vi.fn(),
  uploads: {
    tasks: [] as { id: string; name: string; status: string }[],
    enqueue: vi.fn(),
    resolve: vi.fn(),
  },
  session: {
    webId: "https://pod.example/profile#me",
    storageUrl: "https://pod.example/",
    fetch: vi.fn<typeof globalThis.fetch>(),
  },
  invalidate: vi.fn(),
  changes: {
    subscribe: vi.fn((_folder: string, _listener: () => void) => () => {}),
    subscribeSubtree: vi.fn((_folder: string, _listener: () => void) => () => {}),
  },
};
let ui: ReturnType<typeof useDriveUi>;
let actions: ReturnType<typeof useDriveActions>;
function Probe() {
  ui = useDriveUi();
  actions = useDriveActions();
  return null;
}
function tree(visible: DriveItem[], dialogs = false) {
  return h(
    DriveUiProvider,
    null,
    h(
      Fragment,
      null,
      h(Probe),
      h(FileBrowser, {
        title: "My Drive",
        items: visible,
        folder: ROOT,
        columns: [],
        empty: { title: "Empty", icon: null },
      }),
      dialogs ? h(DriveDialogs) : null,
    ),
  );
}
function row(host: Element, item = items[0]) {
  const found = [...host.querySelectorAll<HTMLElement>("[data-url]")].find(
    (e) => e.dataset.url === item?.url,
  );
  if (!found) throw new Error("Missing row");
  return found;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.client.stat.mockReset();
  mocks.client.move.mockReset();
  mocks.undoMove.mockReset();
  mocks.client.list.mockReset();
  drive.prefs.view = "list";
  mocks.params = new URLSearchParams();
  drive.uploads.tasks = [];
  drive.client = mocks.client as unknown as DriveClient;
  drive.driveRoot = ROOT;
  drive.session.fetch.mockReset();
});

it("folder Undo refuses unrelated nested replacements despite an unchanged root and direct-child set", async () => {
  const pod = createDemoPod({
    root: drive.session.storageUrl,
    seed: [{ path: "drive/A/nested/note", body: "original", contentType: "text/plain" }],
  });
  const client = createSolidDriveClient({ storageUrl: drive.session.storageUrl, fetch: pod.fetch });
  drive.client = client;
  drive.session.fetch.mockImplementation(pod.fetch);
  const actualUndo = await vi.importActual<typeof import("../src/apps/drive/state/undo")>(
    "../src/apps/drive/state/undo",
  );
  mocks.undoMove.mockImplementation(actualUndo.moveWithValidator);
  const folder = await client.stat(`${ROOT}A/`);
  const view = await mount(tree([folder]));
  await act(async () => {
    await actions.move([folder], `${ROOT}B/`);
  });
  const undo = mocks.toast.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => Promise<void> };
  };
  const moved = `${ROOT}B/A/`;
  const before = await client.stat(moved);
  await client.move(`${moved}nested/note`, `${ROOT}elsewhere`);
  await client.write(`${moved}nested/note`, "unrelated", {
    contentType: "text/plain",
    ifNoneMatch: "*",
  });
  expect((await client.stat(moved)).etag).toBe(before.etag);
  await act(async () => undo.action.onClick());
  expect(mocks.toast.error).toHaveBeenCalledWith(
    expect.stringContaining("cannot be safely undone"),
  );
  expect(await (await client.read(`${moved}nested/note`)).text()).toBe("unrelated");
  expect(pod.has(folder.url)).toBe(false);
  await view.unmount();
});

it.each([
  "rename",
  "new-folder",
  "move",
] as const)("a slow %s submission cannot close a newer dialog or disable its submission", async (kind) => {
  const pending = deferred<void>();
  const operation =
    kind === "move"
      ? vi.spyOn(operations, "moveItems").mockImplementation(async () => {
          await pending.promise;
          return { done: [], failed: [] };
        })
      : vi
          .spyOn(operations, kind === "rename" ? "renameItem" : "createFolder")
          .mockImplementation(async () => {
            await pending.promise;
            return `${ROOT}Changed.txt`;
          });
  mocks.client.list.mockResolvedValue([]);
  const view = await mount(tree(items, true));
  await act(async () =>
    ui.openDialog(
      kind === "rename"
        ? { kind, item: items[0] as DriveItem }
        : kind === "new-folder"
          ? { kind, parent: ROOT }
          : { kind, items: [items[0] as DriveItem] },
    ),
  );
  if (kind === "move") {
    // The item's parent is already ROOT; use a different source for this submission.
    await act(async () =>
      ui.openDialog({ kind, items: [{ ...(items[0] as DriveItem), url: `${ROOT}Other/A.txt` }] }),
    );
    const target = document.querySelector('[role="treeitem"]') as Element;
    await click(target);
    const move = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Move",
    );
    await click(move as Element);
  } else {
    const input = document.querySelector<HTMLInputElement>(
      'input[autocomplete="off"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, "Changed.txt");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }
  expect(operation).toHaveBeenCalledTimes(1);
  await key(document.querySelector('[role="dialog"]') as Element, "Escape");
  await act(async () => ui.openDialog({ kind: "new-folder", parent: ROOT }));
  const create = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Create",
  );
  expect(create?.disabled).toBe(false);
  await act(async () => pending.resolve());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New folder");
  expect(ui.dialog?.kind).toBe("new-folder");
  await view.unmount();
  operation.mockRestore();
});

it("Trash keeps the latest refresh when an older listing resolves empty", async () => {
  const earlier = deferred<Awaited<ReturnType<typeof operations.listTrash>>>();
  const entry = {
    url: `${ROOT}.trash/slot/A.txt`,
    original: `${ROOT}A.txt`,
    name: "A.txt",
    trashedAt: new Date(),
  };
  const listing = vi
    .spyOn(operations, "listTrash")
    .mockReturnValueOnce(earlier.promise)
    .mockResolvedValue([entry]);
  const view = await mount(h(DriveUiProvider, null, h(Probe), h(TrashView)));
  const refresh = drive.changes.subscribeSubtree.mock.calls.at(-1)?.[1] as () => void;
  await act(async () => refresh());
  expect(view.host.textContent).toContain("A.txt");
  await act(async () => earlier.resolve([]));
  expect(view.host.textContent).toContain("A.txt");
  expect(view.host.textContent).not.toContain("Trash is empty");
  await view.unmount();
  listing.mockRestore();
});

it("Trash ignores an abandoned refresh error after a newer refresh succeeds", async () => {
  const earlier = deferred<Awaited<ReturnType<typeof operations.listTrash>>>();
  const entry = {
    url: `${ROOT}.trash/slot/A.txt`,
    original: `${ROOT}A.txt`,
    name: "A.txt",
    trashedAt: new Date(),
  };
  vi.spyOn(operations, "listTrash").mockReturnValueOnce(earlier.promise).mockResolvedValue([entry]);
  const view = await mount(h(DriveUiProvider, null, h(Probe), h(TrashView)));
  await act(async () => drive.changes.subscribeSubtree.mock.calls.at(-1)?.[1]());
  await act(async () => earlier.reject(new Error("old request failed")));
  expect(view.host.textContent).toContain("A.txt");
  expect(view.host.textContent).not.toContain("Trash is empty");
  await view.unmount();
});

it("Trash hides the old account's entries and rejects its delayed listing after a root change", async () => {
  const earlier = deferred<Awaited<ReturnType<typeof operations.listTrash>>>();
  const entry = {
    url: `${ROOT}.trash/slot/A.txt`,
    original: `${ROOT}A.txt`,
    name: "A.txt",
    trashedAt: new Date(),
  };
  vi.spyOn(operations, "listTrash").mockReturnValueOnce(earlier.promise).mockResolvedValue([]);
  const render = () => h(DriveUiProvider, null, h(Probe), h(TrashView));
  const view = await mount(render());
  drive.driveRoot = "https://other.example/drive/";
  await view.render(render());
  await act(async () => earlier.resolve([entry]));
  expect(view.host.textContent).toContain("Trash is empty");
  expect(view.host.textContent).not.toContain("A.txt");
  await view.unmount();
});

it("a reopened Move dialog ignores the older folder-tree listing", async () => {
  const earlier = deferred<DriveItem[]>();
  mocks.client.list
    .mockReturnValueOnce(earlier.promise)
    .mockResolvedValue([{ url: `${ROOT}Current/`, name: "Current", kind: "folder" }]);
  const view = await mount(tree(items, true));
  await act(async () => ui.openDialog({ kind: "move", items }));
  await key(document.querySelector('[role="dialog"]') as Element, "Escape");
  await act(async () => ui.openDialog({ kind: "move", items }));
  expect(document.querySelector('[role="tree"]')?.textContent).toContain("Current");
  await act(async () =>
    earlier.resolve([{ url: `${ROOT}Abandoned/`, name: "Abandoned", kind: "folder" }]),
  );
  expect(document.querySelector('[role="tree"]')?.textContent).not.toContain("Abandoned");
  await view.unmount();
});

it("Undo uses the move response validator even if a replacement is present before a later HEAD", async () => {
  const destination = `${ROOT}Work/A.txt`;
  const original = items[0] as DriveItem;
  const pod = createDemoPod({
    root: drive.session.storageUrl,
    seed: [{ path: "drive/A.txt", body: "original", contentType: "text/plain" }],
  });
  const otherTab = createSolidDriveClient({
    storageUrl: drive.session.storageUrl,
    fetch: pod.fetch,
  });
  let copiedEtag: string | null = null;
  drive.client = createSolidDriveClient({
    storageUrl: drive.session.storageUrl,
    fetch: async (input, init) => {
      const response = await pod.fetch(input, init);
      if (String(input) === destination && init?.method === "PUT")
        copiedEtag = response.headers.get("etag");
      if (String(input) === original.url && init?.method === "DELETE") {
        // Interleave another tab after the DELETE commits, before move returns.
        await otherTab.move(destination, `${ROOT}elsewhere.txt`);
        await otherTab.write(destination, "unrelated", {
          contentType: "text/plain",
          ifNoneMatch: "*",
        });
      }
      return response;
    },
  });
  const stat = vi.spyOn(drive.client, "stat");
  drive.session.fetch.mockImplementation(pod.fetch);
  const actualUndo = await vi.importActual<typeof import("../src/apps/drive/state/undo")>(
    "../src/apps/drive/state/undo",
  );
  mocks.undoMove.mockImplementation(actualUndo.moveWithValidator);
  const view = await mount(tree(items));
  await act(async () => {
    await actions.move([items[0] as DriveItem], `${ROOT}Work/`);
  });
  const options = mocks.toast.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => Promise<void> };
  };
  await act(async () => options.action.onClick());
  expect(mocks.undoMove).toHaveBeenCalledWith(
    expect.any(Object),
    destination,
    items[0]?.url,
    copiedEtag,
  );
  expect(stat).not.toHaveBeenCalled();
  expect(pod.has(original.url)).toBe(false);
  expect(await (await otherTab.read(destination)).text()).toBe("unrelated");
  expect(await (await otherTab.read(`${ROOT}elsewhere.txt`)).text()).toBe("original");
  await view.unmount();
});

it("does not offer Trash Undo until completion is persisted", async () => {
  const entry = {
    url: `${ROOT}.trash/slot/A.txt`,
    original: items[0]?.url ?? "",
    name: "A.txt",
    trashedAt: new Date(),
  };
  const warning = new operations.TrashIndexWarning(`${ROOT}.trash/index.ttl`, new Error("500"));
  const trash = vi
    .spyOn(operations, "trashItems")
    .mockResolvedValue({ done: [entry], failed: [], warnings: [warning] });
  const view = await mount(tree(items));
  await act(async () => {
    await actions.trash([items[0] as DriveItem]);
  });
  expect(mocks.toast.error).toHaveBeenCalledWith(warning.message);
  expect(mocks.toast.mock.calls.some(([, options]) => options?.action?.label === "Undo")).toBe(
    false,
  );
  await view.unmount();
  trash.mockRestore();
});

it("Trash lists partial recovery copies with a warning", async () => {
  const entry = {
    url: `${ROOT}.trash/00000000-0000-0000-0000-000000000000/Folder/`,
    original: `${ROOT}Folder/`,
    name: "Folder",
    trashedAt: new Date(),
    status: "partial" as const,
    remaining: [`${ROOT}.trash/00000000-0000-0000-0000-000000000000/Folder/nested/note`],
  };
  const listing = vi.spyOn(operations, "listTrash").mockResolvedValue([entry]);
  const view = await mount(h(DriveUiProvider, null, h(Probe), h(TrashView)));
  expect(view.host.querySelector('[role="note"]')?.textContent).toContain("Partly moved to Trash");
  expect(view.host.textContent).toContain("Restore to recover missing items");
  expect(view.host.textContent).toContain("Recovery copies: note");
  await view.unmount();
  listing.mockRestore();
});

it("partial restore reports occupied locations and refreshes both recovery and original listings", async () => {
  const entry = {
    url: `${ROOT}.trash/00000000-0000-0000-0000-000000000000/Folder/`,
    original: `${ROOT}Folder/`,
    name: "Folder",
    trashedAt: new Date(),
    status: "partial" as const,
  };
  const error = new operations.TrashRestorePartialError([
    { url: `${entry.url}note`, error: new DriveError("conflict", 412, `${entry.original}note`) },
  ]);
  vi.spyOn(operations, "restoreItems").mockResolvedValue({
    done: [],
    failed: [{ url: entry.url, error }],
  });
  const view = await mount(tree(items));
  await act(async () => actions.restore([entry]));
  expect(mocks.toast.error).toHaveBeenCalledWith(
    "1 items could not be restored because their location is in use",
  );
  expect(mocks.toast.success).not.toHaveBeenCalled();
  expect(drive.invalidate).toHaveBeenCalledWith(entry.url);
  expect(drive.invalidate).toHaveBeenCalledWith(entry.original);
  await view.unmount();
});

it("catches unexpected trash failures and shows an error toast", async () => {
  const trash = vi.spyOn(operations, "trashItems").mockRejectedValue(new Error("unexpected"));
  const view = await mount(tree(items));
  await act(async () => {
    await expect(actions.trash([items[0] as DriveItem])).resolves.toBeUndefined();
  });
  expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't move to trash");
  await view.unmount();
  trash.mockRestore();
});

it.each([
  "list",
  "grid",
])("Backspace navigates up with an unselected focused %s row", async (mode) => {
  drive.prefs.view = mode;
  const trash = vi.spyOn(operations, "trashItems").mockResolvedValue({ done: [], failed: [] });
  const view = await mount(
    h(
      DriveUiProvider,
      null,
      h(Probe),
      h(FileBrowser, {
        title: "Work",
        items,
        folder: `${ROOT}Work/`,
        columns: [],
        empty: { title: "Empty", icon: null },
      }),
    ),
  );
  const focused = row(view.host);
  await act(async () => focused.focus());
  await key(focused, "Backspace");
  expect(mocks.router.push).toHaveBeenCalledWith("/drive/my");
  expect(trash).not.toHaveBeenCalled();
  await click(focused);
  await key(focused, "Backspace");
  expect(trash).toHaveBeenCalled();
  await view.unmount();
  trash.mockRestore();
});

it.each([
  false,
  true,
])("upload conflict Skip restores focus (trigger removed: %s)", async (removed) => {
  const view = await mount(tree(items, true));
  const trigger = row(view.host);
  await act(async () => trigger.focus());
  drive.uploads.tasks = [{ id: "upload", name: "A.txt", status: "conflict" }];
  await view.render(tree(items, true));
  if (removed) await view.render(tree([], true));
  const skip = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Skip",
  );
  if (!skip) throw new Error("Missing Skip");
  await click(skip);
  drive.uploads.tasks = [];
  await view.render(tree(removed ? [] : items, true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.activeElement).toBe(
    removed ? view.host.querySelector("[data-drive-listing]") : trigger,
  );
  await view.unmount();
});

it.each([
  "list",
  "grid",
])("reconciles focus and anchor after removing the focused %s item", async (mode) => {
  drive.prefs.view = mode;
  const view = await mount(tree(items));
  const focused = row(view.host, items[1]);
  await act(async () => focused.focus());
  await click(focused);
  await view.render(tree([items[0] as DriveItem, items[2] as DriveItem]));
  const surviving = row(view.host, items[2]);
  expect(surviving.tabIndex).toBe(0);
  expect(document.activeElement).toBe(surviving);
  expect(view.host.querySelectorAll('[data-url][tabindex="0"]')).toHaveLength(1);
  await key(surviving, "ArrowUp", true);
  expect(
    view.host.querySelectorAll('[data-url][aria-selected="true"], [data-url][aria-pressed="true"]')
      .length,
  ).toBeGreaterThan(0);
  await view.unmount();
});
it("reconciles the range anchor when filters remove the selected item", async () => {
  const photo: DriveItem = {
    url: `${ROOT}photo.jpg`,
    name: "photo.jpg",
    kind: "file",
    contentType: "image/jpeg",
  };
  const view = await mount(tree([...items, photo]));
  await click(row(view.host));
  mocks.params = new URLSearchParams({ type: "images" });
  await view.render(tree([...items, photo]));
  const visible = row(view.host, photo);
  expect(visible.tabIndex).toBe(0);
  await key(visible, "ArrowDown", true);
  expect(visible.getAttribute("aria-selected")).toBe("true");
  await view.unmount();
});
it.each([
  "new-folder",
  "rename",
  "move",
  "delete-forever",
  "empty-trash",
])("restores trigger focus on Escape from the %s dialog", async (kind) => {
  mocks.client.list.mockResolvedValue([]);
  const view = await mount(tree(items, true));
  const trigger = row(view.host);
  await act(async () => trigger.focus());
  const entry = {
    url: `${ROOT}.trash/slot/A.txt`,
    original: items[0]?.url ?? "",
    name: "A.txt",
    trashedAt: new Date(),
  };
  const dialog: DriveDialog =
    kind === "new-folder"
      ? { kind, parent: ROOT }
      : kind === "rename"
        ? { kind, item: items[0] as DriveItem }
        : kind === "move"
          ? { kind, items }
          : { kind: kind as "delete-forever" | "empty-trash", entries: [entry] };
  await act(async () => ui.openDialog(dialog));
  const content = document.querySelector('[role="dialog"], [role="alertdialog"]');
  expect(content).not.toBeNull();
  await key(content as Element, "Escape");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.activeElement).toBe(trigger);
  await view.unmount();
});
it("restores dialog focus to the affected row or listing when its trigger disappears", async () => {
  const view = await mount(tree(items, true));
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  await act(async () => ui.openDialog({ kind: "rename", item: items[0] as DriveItem }));
  trigger.remove();
  await key(document.querySelector('[role="dialog"]') as Element, "Escape");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.activeElement).toBe(row(view.host));
  row(view.host).focus();
  await act(async () => ui.openDialog({ kind: "rename", item: items[0] as DriveItem }));
  await view.render(tree([], true));
  await key(document.querySelector('[role="dialog"]') as Element, "Escape");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.activeElement).toBe(view.host.querySelector(".drv-content"));
  await view.unmount();
});
it("Undo conditions the reverse move on the captured ETag and reports replaced items", async () => {
  const view = await mount(tree(items));
  const destination = `${ROOT}Work/A.txt`;
  mocks.client.move.mockResolvedValueOnce({ url: destination, etag: '"moved-version"' });
  mocks.client.stat.mockResolvedValue({ ...items[0], url: destination, etag: '"moved-version"' });
  await act(async () => {
    await actions.move([items[0] as DriveItem], `${ROOT}Work/`);
  });
  const options = mocks.toast.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => Promise<void> };
  };
  // A different resource now occupies the destination, so the conditional move fails.
  mocks.undoMove.mockRejectedValueOnce(new DriveError("conflict", 412, destination));
  await act(async () => options.action.onClick());
  expect(mocks.undoMove).toHaveBeenLastCalledWith(
    expect.any(Object),
    destination,
    items[0]?.url,
    '"moved-version"',
  );
  expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringContaining("A.txt"));
  await view.unmount();
});
it("Undo restores the exact original URL and reports all failures without stopping the batch", async () => {
  const view = await mount(tree(items));
  mocks.client.move.mockImplementation(async (from: string) => ({
    url: `${ROOT}Work/${from.split("/").pop()}`,
    etag: '"version"',
  }));
  mocks.client.stat.mockResolvedValue({ etag: '"version"' });
  await act(async () => {
    await actions.move(items, `${ROOT}Work/`);
  });
  const options = mocks.toast.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => Promise<void> };
  };
  mocks.undoMove
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(items[1]?.url)
    .mockRejectedValueOnce(new Error("forbidden"));
  await act(async () => options.action.onClick());
  expect(mocks.undoMove).toHaveBeenCalledWith(
    expect.any(Object),
    `${ROOT}Work/B.txt`,
    items[1]?.url,
    '"version"',
  );
  expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/A.txt.*C.txt/));
  await view.unmount();
});
it("Undo fails closed when the moved ETag cannot be captured", async () => {
  const view = await mount(tree(items));
  mocks.client.move.mockResolvedValue({ url: `${ROOT}Work/A.txt` });
  mocks.client.stat.mockRejectedValue(new Error("offline"));
  await act(async () => {
    await actions.move([items[0] as DriveItem], `${ROOT}Work/`);
  });
  const options = mocks.toast.success.mock.calls.at(-1)?.[1];
  expect(options).not.toHaveProperty("action");
  expect(mocks.client.move).toHaveBeenCalledTimes(1);
  expect(mocks.undoMove).not.toHaveBeenCalled();
  expect(mocks.toast.error).not.toHaveBeenCalled();
  await view.unmount();
});

it("keeps focus in extension confirmation and restores the original rename trigger on close", async () => {
  const view = await mount(tree(items, true));
  const trigger = row(view.host);
  trigger.focus();
  await act(async () => ui.openDialog({ kind: "rename", item: items[0] as DriveItem }));
  const input = document.querySelector<HTMLInputElement>(
    'input[autocomplete="off"]',
  ) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, "A.pdf");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const confirmation = document.querySelector('[role="alertdialog"]');
  expect(confirmation).not.toBeNull();
  expect(confirmation?.contains(document.activeElement)).toBe(true);
  await key(confirmation as Element, "Escape");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.activeElement === trigger).toBe(true);
  await view.unmount();
});

it("captures each moved validator before waiting for later items in the batch", async () => {
  const second = deferred<{ url: string; etag: string }>();
  const view = await mount(tree(items));
  mocks.client.move
    .mockResolvedValueOnce({ url: `${ROOT}Work/A.txt`, etag: '"first-version"' })
    .mockReturnValueOnce(second.promise);
  mocks.client.stat.mockResolvedValue({ etag: '"first-version"' });
  let moving: Promise<unknown> = Promise.resolve();
  await act(async () => {
    moving = actions.move(items.slice(0, 2), `${ROOT}Work/`);
  });
  expect(mocks.client.stat).not.toHaveBeenCalled();
  mocks.client.stat.mockResolvedValue({ etag: '"later-version"' });
  await act(async () => {
    second.resolve({ url: `${ROOT}Work/B.txt`, etag: '"later-version"' });
    await moving;
  });
  const options = mocks.toast.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => Promise<void> };
  };
  await act(async () => options.action.onClick());
  expect(mocks.undoMove).toHaveBeenCalledWith(
    expect.any(Object),
    `${ROOT}Work/A.txt`,
    items[0]?.url,
    '"first-version"',
  );
  await view.unmount();
});

it.each([
  "restore",
  "delete",
])("toasts index persistence warnings while preserving successful %s feedback", async (operation) => {
  const entry = {
    url: `${ROOT}.trash/00000000-0000-0000-0000-000000000000/A.txt`,
    original: items[0]?.url ?? "",
    name: "A.txt",
    trashedAt: new Date(),
  };
  const warning = new operations.TrashIndexWarning(
    `${ROOT}.trash/index.ttl`,
    new Error("HTTP 500"),
  );
  const restore = vi.spyOn(operations, "restoreItems").mockResolvedValue({
    done: [{ entry, url: entry.original, renamed: false }],
    failed: [],
    warnings: [warning],
  });
  const remove = vi
    .spyOn(operations, "deleteForever")
    .mockResolvedValue({ done: [entry], failed: [], warnings: [warning] });
  const view = await mount(tree(items));
  await act(async () => {
    if (operation === "restore") await actions.restore([entry]);
    else await actions.removeForever([entry]);
  });
  expect(mocks.toast.error).toHaveBeenCalledWith(warning.message);
  expect(mocks.toast.success).toHaveBeenCalledWith(
    operation === "restore" ? "Restored A.txt" : "Deleted for ever",
  );
  expect(drive.invalidate).toHaveBeenCalledWith(entry.url);
  await view.unmount();
  restore.mockRestore();
  remove.mockRestore();
});

it("captures a moved folder's child set immediately for Undo", async () => {
  const folder: DriveItem = { url: `${ROOT}Folder/`, name: "Folder", kind: "folder" };
  const destination = `${ROOT}Work/Folder/`;
  const child = { url: `${destination}note`, name: "note", kind: "file" };
  const view = await mount(tree([folder]));
  mocks.client.move.mockResolvedValue({
    url: destination,
    etag: '"folder-version"',
    children: [child.url],
    tree: [
      { url: destination, etag: '"folder-version"', children: [child.url] },
      { url: child.url, etag: '"file-version"' },
    ],
  });
  mocks.client.stat.mockResolvedValue({ etag: '"folder-version"' });
  mocks.client.list.mockResolvedValue([child]);
  await act(async () => {
    await actions.move([folder], `${ROOT}Work/`);
  });
  const options = mocks.toast.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => Promise<void> };
  };
  mocks.client.list.mockResolvedValue([{ ...child, url: `${destination}replacement` }]);
  await act(async () => options.action.onClick());
  expect(mocks.undoMove).toHaveBeenCalledWith(
    expect.any(Object),
    destination,
    folder.url,
    '"folder-version"',
    [
      { url: destination, etag: '"folder-version"', children: [child.url] },
      { url: child.url, etag: '"file-version"' },
    ],
  );
  await view.unmount();
});

it.each([
  "restore",
  "delete",
])("shows a clear moving message when pending trash %s is refused", async (operation) => {
  const entry = {
    url: `${ROOT}.trash/00000000-0000-0000-0000-000000000000/A.txt`,
    original: items[0]?.url ?? "",
    name: "A.txt",
    trashedAt: new Date(),
  };
  const error = new operations.TrashMovingError();
  const restore = vi
    .spyOn(operations, "restoreItems")
    .mockResolvedValue({ done: [], failed: [{ url: entry.url, error }] });
  const remove = vi
    .spyOn(operations, "deleteForever")
    .mockResolvedValue({ done: [], failed: [{ url: entry.url, error }] });
  const view = await mount(tree(items));
  await act(async () => {
    if (operation === "restore") await actions.restore([entry]);
    else await actions.removeForever([entry]);
  });
  expect(mocks.toast.error).toHaveBeenCalledWith(error.message);
  expect(mocks.toast.success).not.toHaveBeenCalled();
  await view.unmount();
  restore.mockRestore();
  remove.mockRestore();
});
