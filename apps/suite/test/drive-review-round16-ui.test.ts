// AUTHORED-BY Codex

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
import { FolderView, StarredView, TrashView } from "../src/apps/drive/components/views";
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
async function setup(names = ["A", "B"]) {
  const pod = createDemoPod({
    root: STORAGE,
    seed: names.map((name) => ({
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
async function activate(element: HTMLElement) {
  await act(async () => element.focus());
  expect(document.activeElement).toBe(element);
  // jsdom requires explicit native button activation after keydown.
  await key(element, "Enter");
  await click(element);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  mocks.params = new URLSearchParams();
});

it.each([
  ["row", "next"],
  ["row", "previous"],
  ["row", "empty"],
  ["toolbar", "next"],
  ["toolbar", "empty"],
  ["empty-trash", "empty"],
  ["immediate", "next"],
  ["delayed-list", "next"],
] as const)("%s permanent delete focuses the %s Trash target after asynchronous removal", async (action, destination) => {
  const view = await setup(destination === "empty" ? ["A"] : ["A", "B"]);
  await act(async () => {
    await operations.trashItems(drive.client, ROOT, await drive.client.list(ROOT));
  });
  await view.render(tree(h(TrashView)));
  const original = rows(view.host);
  const removed = original[destination === "previous" ? 1 : 0] as HTMLElement;
  const remaining = original.find((row) => row !== removed);
  if (action === "toolbar") await click(removed.querySelector("input") as Element);
  const trigger = button(
    action === "row" || action === "immediate" || action === "delayed-list"
      ? `Delete for ever: ${removed.querySelector(".drv-name")?.textContent}`
      : action === "toolbar"
        ? "Delete for ever"
        : "Empty trash",
    view.host,
  );
  const pending = deferred<void>();
  const listing = deferred<void>();
  const list = operations.listTrash;
  if (action === "delayed-list")
    vi.spyOn(operations, "listTrash").mockImplementation(async (...args) => {
      await listing.promise;
      return list(...args);
    });
  const remove = operations.deleteForever;
  const deletion = vi.spyOn(operations, "deleteForever").mockImplementation(async (...args) => {
    await pending.promise;
    return remove(...args);
  });
  if (action === "immediate") pending.resolve();
  await activate(trigger);
  await activate(
    button(
      action === "empty-trash" ? "Empty trash" : "Delete for ever",
      document.querySelector('[role="alertdialog"]') as Element,
    ),
  );
  if (action !== "immediate") await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  await act(async () => {
    pending.resolve();
    await deletion.mock.results[0]?.value;
  });
  if (action === "delayed-list") {
    expect(removed.isConnected).toBe(true);
    expect(document.activeElement).toBe(trigger);
    await act(async () => listing.resolve());
  }
  expect(removed.isConnected).toBe(false);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      remaining ?? view.host.querySelector("[data-drive-listing]"),
    ),
  );
});

it.each([
  "failed",
  "partial",
])("permanent delete preserves the surviving recovery control after a %s batch", async (outcome) => {
  const view = await setup();
  await act(async () => {
    await operations.trashItems(drive.client, ROOT, await drive.client.list(ROOT));
  });
  await view.render(tree(h(TrashView)));
  const original = rows(view.host);
  for (const row of original) await click(row.querySelector("input") as Element);
  const trigger = button("Delete for ever", view.host);
  const remove = operations.deleteForever;
  const deletion = vi
    .spyOn(operations, "deleteForever")
    .mockImplementation(async (client, root, entries) => {
      const result =
        outcome === "partial"
          ? await remove(client, root, entries.slice(0, 1))
          : { done: [], failed: [] };
      return {
        ...result,
        failed: entries
          .slice(outcome === "partial" ? 1 : 0)
          .map(({ url }) => ({ url, error: new Error("offline") })),
      };
    });
  await activate(trigger);
  await activate(
    button("Delete for ever", document.querySelector('[role="alertdialog"]') as Element),
  );
  await act(async () => {
    await deletion.mock.results[0]?.value;
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(rows(view.host)).toHaveLength(outcome === "partial" ? 1 : 2);
  expect(original.at(-1)?.querySelector<HTMLInputElement>("input")?.checked).toBe(true);
});

it.each([
  "topbar",
  "row",
  "removed-opener",
  "removed-row",
])("desktop Details pane close prefers the current row after opening from %s", async (opener) => {
  const view = await setup();
  const row = rows(view.host)[0] as HTMLElement;
  await click(row);
  let trigger: HTMLElement;
  if (opener === "row") {
    trigger = row;
    await act(async () => trigger.focus());
    await key(trigger, "d");
  } else if (opener.startsWith("removed")) {
    trigger = document.createElement("button");
    view.host.append(trigger);
    await act(async () => {
      trigger.focus();
      ui.setDetailsOpen(true);
    });
    trigger.remove();
    if (opener === "removed-row") {
      await act(async () => {
        await drive.client.remove(`${ROOT}A.txt`);
      });
    }
  } else {
    trigger = button("Show details", view.host);
    await activate(trigger);
  }
  expect(view.host.querySelector(".ish-details")).not.toBeNull();
  await activate(button("Close details", view.host));
  expect(view.host.querySelector(".ish-details")).toBeNull();
  expect(document.activeElement).toBe(rows(view.host)[0]);
});

it.each([
  "clear",
  "trash",
  "unstar",
  "trash-last",
  "unstar-last",
  "trash-unselected-focus",
])("selection toolbar %s restores focus when its control disappears", async (action) => {
  const view = await setup(action.endsWith("last") ? ["A"] : ["A", "B"]);
  if (action.startsWith("unstar")) {
    await act(async () =>
      drive.updatePrefs((prefs) => ({ ...prefs, starred: [`${ROOT}A.txt`, `${ROOT}B.txt`] })),
    );
    await view.render(tree(h(StarredView)));
  }
  const [first, next] = rows(view.host) as [HTMLElement, HTMLElement];
  await act(async () => first.focus());
  await click(first);
  if (action === "trash-unselected-focus") {
    // Ctrl-clicking twice deselects B while keeping it as the roving item.
    await act(async () => {
      next.focus();
      for (let count = 0; count < 2; count++)
        next.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    });
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(next.getAttribute("aria-selected")).toBe("false");
  }
  const operation = vi.spyOn(operations, "trashItems");
  await activate(
    button(
      action === "clear"
        ? "Clear selection"
        : action.startsWith("trash")
          ? "Move to trash"
          : "Remove star",
      view.host,
    ),
  );
  if (action.startsWith("trash"))
    await act(async () => {
      await operation.mock.results[0]?.value;
    });
  await act(async () => {});
  expect(document.activeElement).toBe(
    action === "clear" ? first : (next ?? view.host.querySelector("[data-drive-listing]")),
  );
});

it.each([
  ["rename", "row"],
  ["move", "row"],
  ["move", "toolbar"],
] as const)("%s dialog completion from %s retains listing focus after replacing its opener", async (action, opener) => {
  const view = await setup();
  if (action === "move")
    await act(async () => {
      await drive.client.createFolder(`${ROOT}Archive/`);
    });
  const first = rows(view.host).find((row) => row.dataset.url === `${ROOT}A.txt`) as HTMLElement;
  await act(async () => first.focus());
  await click(first);
  if (opener === "toolbar") await activate(button("Move to…", view.host));
  else await key(first, action === "rename" ? "F2" : "m");
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  const mutation = vi.spyOn(operations, action === "rename" ? "renameItem" : "moveItems");
  if (action === "rename") {
    const input = dialog.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Renamed.txt",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input
        .closest("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  } else {
    const target = document.querySelector(`[data-node="${ROOT}Archive/"]`) as HTMLElement;
    await click(target);
    await activate(button("Move", document.querySelector('[role="dialog"]') as Element));
  }
  await act(async () => {
    await mutation.mock.results[0]?.value;
  });
  expect(mutation).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(first.isConnected).toBe(false);
  await vi.waitFor(() =>
    expect([...rows(view.host), view.host.querySelector("[data-drive-listing]")]).toContain(
      document.activeElement,
    ),
  );
});

it("listing Delete retains focus on the next row", async () => {
  const view = await setup();
  const [first, next] = rows(view.host) as [HTMLElement, HTMLElement];
  await act(async () => first.focus());
  await click(first);
  const trash = vi.spyOn(operations, "trashItems");
  await key(first, "Delete");
  await act(async () => {
    await trash.mock.results[0]?.value;
  });
  expect(first.isConnected).toBe(false);
  expect(document.activeElement).toBe(next);
});

it("preview navigation and Details keep focus inside the viewer when controls disappear", async () => {
  const view = await setup();
  const first = rows(view.host)[0] as HTMLElement;
  await act(async () => first.focus());
  await key(first, "Enter");
  for (const label of ["Next file", "Previous file"]) {
    const control = button(label);
    await activate(control);
    expect(control.isConnected).toBe(false);
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(
        true,
      ),
    );
  }
  const details = button("Details", document.querySelector('[role="dialog"]') as Element);
  await activate(details);
  await activate(button("Close details", document.querySelector('[role="dialog"]') as Element));
  expect(document.activeElement).toBe(details);
});

it.each([
  "chip",
  "empty-state",
])("Clear filters from the %s keeps focus in the listing", async (source) => {
  mocks.params = new URLSearchParams({ type: "images" });
  const view = await setup();
  const triggers = [...view.host.querySelectorAll<HTMLButtonElement>("button")].filter(
    (element) => element.textContent?.trim() === "Clear filters",
  );
  const trigger = triggers[source === "chip" ? 0 : 1] as HTMLButtonElement;
  await activate(trigger);
  expect(mocks.router.replace).toHaveBeenLastCalledWith("/drive/my", { scroll: false });
  mocks.params = new URLSearchParams();
  await view.render(tree());
  expect(trigger.isConnected).toBe(false);
  expect(document.activeElement).toBe(view.host.querySelector("[data-drive-listing]"));
});

it.each(["close", "retry"])("upload %s keeps focus when its control disappears", async (action) => {
  const view = await setup();
  const upload = vi.spyOn(operations, "uploadFile");
  if (action === "retry") upload.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    drive.uploads.enqueue(ROOT, [new File(["text"], "Upload.txt", { type: "text/plain" })]);
    await upload.mock.results[0]?.value.catch(() => undefined);
  });
  expect(drive.uploads.tasks[0]?.status).toBe(action === "retry" ? "failed" : "done");
  const toggle = button("Collapse uploads");
  const trigger = button(action === "close" ? "Close uploads" : "Retry Upload.txt");
  await activate(trigger);
  expect(trigger.isConnected).toBe(false);
  expect(document.activeElement).toBe(
    action === "close" ? view.host.querySelector("[data-drive-listing]") : toggle,
  );
});

it.each([false, true])("preview close restores focus after row removal: %s", async (removed) => {
  const view = await setup();
  const first = rows(view.host)[0] as HTMLElement;
  await act(async () => first.focus());
  await key(first, "Enter");
  if (removed)
    await act(async () => {
      await drive.client.remove(`${ROOT}A.txt`);
    });
  await activate(button("Close", document.querySelector('[role="dialog"]') as Element));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      removed ? view.host.querySelector("[data-drive-listing]") : first,
    ),
  );
});
