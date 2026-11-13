// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(() => "loading"),
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
  create: vi.fn(),
  connection: { disabled: false, reason: "You're offline. This needs a connection." },
  fetch: vi.fn<typeof fetch>(),
  folders: vi.fn(() => ({ status: "ready", items: [], refreshing: false, reload: vi.fn() })),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/drive/my",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shell/sync/requires-online", () => ({ useNeedsConnection: () => mocks.connection }));
vi.mock("../src/apps/sheets/lib/workbook", () => ({
  createWorkbookService: () => ({ createFromCsv: mocks.create }),
}));

const ROOT = "https://pod.example/alice/";
const CSV: DriveItem = {
  url: `${ROOT}drive/Budget.csv`,
  name: "Budget.csv",
  contentType: "text/csv",
  kind: "file",
};
const BOOK: DriveItem = {
  url: `${ROOT}sheets/budget/`,
  name: "Budget",
  kind: "folder",
  workbook: true,
};
let session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: mocks.fetch };
const invalidate = vi.fn();
const client = {
  read: async () => new Blob(["A,B\n1,2"], { type: "text/csv" }),
  stat: vi.fn(async () => CSV),
};
const drive = {
  invalidate,
  client,
  driveRoot: `${ROOT}drive/`,
  prefs: { starred: [], openedShared: [], view: "list", sort: { key: "name", dir: "asc" } },
  updatePrefs: vi.fn(),
  changes: { subscribe: () => () => {}, subscribeSubtree: () => () => {} },
  uploads: { tasks: [], enqueue: vi.fn() },
};
vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => ({ ...drive, session }),
  useFolder: mocks.folders,
}));
vi.mock("../src/lib/route-params", () => ({
  usePageRouteParams: () => ({ ref: encodeRef(BOOK.url) }),
}));

import { ResourceWriteError } from "../src/apps/docs/lib/model/errors";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import { ItemIcon } from "../src/apps/drive/components/item-icon";
import { type MenuEntry, useItemMenu } from "../src/apps/drive/components/item-menu";
import { PreviewDialog } from "../src/apps/drive/components/preview";
import { FolderRefView } from "../src/apps/drive/components/views";
import { SHEETS_READ_ONLY_REASON } from "../src/apps/drive/lib/open-with/sheets";
import {
  type OpenWithSheetsControl,
  useOpenWithSheets,
} from "../src/apps/drive/state/open-with-sheets";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";
import { encodeRef } from "../src/lib/refs";

let control: OpenWithSheetsControl | undefined;
function Hook({ item }: { item: DriveItem | undefined }) {
  return h(DriveUiProvider, null, h(SheetsHook, { item }));
}
function SheetsHook({ item }: { item: DriveItem | undefined }) {
  control = useOpenWithSheets(item);
  return null;
}
beforeEach(() => {
  session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: mocks.fetch };
  mocks.connection.disabled = false;
  mocks.fetch.mockImplementation(async (_url, init) =>
    init?.method === "HEAD"
      ? new Response(null, { headers: { "wac-allow": 'user="read write"' } })
      : new Response("A,B\n1,2"),
  );
  mocks.create.mockResolvedValue({ container: BOOK.url });
  client.stat.mockResolvedValue(CSV);
});
afterEach(() => {
  vi.clearAllMocks();
  control = undefined;
});

describe("Drive Sheets conversion control", () => {
  it("ignores missing selection, folders and unsupported files; opens workbooks without I/O", async () => {
    for (const item of [
      undefined,
      { ...CSV, name: "photo.png", contentType: "image/png" },
      { ...CSV, kind: "folder" as const },
    ]) {
      const view = await mount(h(Hook, { item }));
      expect(control).toBeUndefined();
      await view.unmount();
    }
    await mount(h(Hook, { item: BOOK }));
    await act(() => control?.run());
    expect(mocks.router.push).toHaveBeenCalledWith(`/sheets/s/${encodeRef(BOOK.url)}`);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("respects an unsaved preview edit before opening and after converting", async () => {
    let allow = false;
    function Guarded({ item }: { item: DriveItem }) {
      const ui = useDriveUi();
      if (!guarded) guarded = ui.registerPreviewGuard(() => allow);
      control = useOpenWithSheets(item);
      return null;
    }
    let guarded: (() => void) | undefined;
    await mount(h(DriveUiProvider, null, h(Guarded, { item: BOOK })));
    await act(() => control?.run());
    expect(mocks.router.push).not.toHaveBeenCalled();
    guarded?.();
    guarded = undefined;
    const result = deferred<{ container: string }>();
    mocks.create.mockReturnValue(result.promise);
    allow = true;
    await mount(h(DriveUiProvider, null, h(Guarded, { item: CSV })));
    let pending: Promise<void> | undefined;
    await act(() => {
      pending = control?.run();
    });
    // The user starts another unsaved edit while the conversion runs.
    allow = false;
    await act(async () => {
      result.resolve({ container: BOOK.url });
      await pending;
    });
    expect(invalidate).toHaveBeenCalledWith(BOOK.url);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("converts once, shows progress, invalidates the workbook and opens its editor", async () => {
    const result = deferred<{ container: string }>();
    mocks.create.mockReturnValue(result.promise);
    await mount(h(Hook, { item: CSV }));
    let pending: Promise<void> | undefined;
    await act(() => {
      pending = control?.run();
    });
    expect(control?.pending).toBe(true);
    await act(() => control?.run());
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.resolve({ container: BOOK.url });
      await pending;
    });
    expect(control?.pending).toBe(false);
    expect(mocks.create).toHaveBeenCalledWith({ title: "Budget", csv: "A,B\n1,2" });
    expect(mocks.toast.loading).toHaveBeenCalledWith("Opening Budget.csv with Sheets…");
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("loading");
    expect(invalidate).toHaveBeenCalledWith(BOOK.url);
    expect(mocks.router.push).toHaveBeenCalledWith(`/sheets/s/${encodeRef(BOOK.url)}`);
  });

  it("disables offline and read-only conversions and rechecks Write at activation", async () => {
    mocks.connection.disabled = true;
    const view = await mount(h(Hook, { item: CSV }));
    expect(control).toMatchObject({ kind: "convert", disabledReason: mocks.connection.reason });
    await act(() => control?.run());
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.connection.disabled = false;
    mocks.fetch.mockResolvedValue(new Response(null, { headers: { "wac-allow": 'user="read"' } }));
    await view.render(h(Hook, { item: CSV }));
    expect(control).toMatchObject({ disabledReason: SHEETS_READ_ONLY_REASON });
    await act(() => control?.run());
    expect(mocks.create).not.toHaveBeenCalled();
    await view.unmount();
    session = { ...session };
    mocks.fetch.mockImplementation(async () => new Response(null));
    await mount(h(Hook, { item: CSV }));
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 403 }));
    await act(() => control?.run());
    expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't open Budget.csv with Sheets", {
      description: SHEETS_READ_ONLY_REASON,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    [new Error("Invalid CSV"), "Invalid CSV"],
    [new Error(""), "Your file wasn't changed. Check your connection and try again."],
    [
      new TypeError("Failed to fetch"),
      "Your file wasn't changed. Check your connection and try again.",
    ],
    ["offline", "Your file wasn't changed. Check your connection and try again."],
  ])("reports importer failures and clears progress (%s)", async (error, description) => {
    await mount(h(Hook, { item: CSV }));
    mocks.create.mockRejectedValueOnce(error);
    await act(() => control?.run());
    expect(mocks.toast.error).toHaveBeenLastCalledWith("Couldn't open Budget.csv with Sheets", {
      description,
    });
    expect(control?.pending).toBe(false);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("shares concurrent permission probes and ignores a probe after unmount", async () => {
    const response = deferred<Response>();
    mocks.fetch.mockReturnValue(response.promise);
    const first = await mount(h(Hook, { item: CSV }));
    const second = await mount(h(Hook, { item: CSV }));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await first.unmount();
    await second.unmount();
    await act(() => response.resolve(new Response(null)));
  });

  it("uses the Docs fallback for storage failures without exposing resource URLs", async () => {
    await mount(h(Hook, { item: CSV }));
    for (const error of [
      ...[401, 403, 500].map((status) => new ResourceWriteError(`${ROOT}sheets/private/`, status)),
      { status: 401 },
      { status: 403 },
      { status: 500 },
      null,
    ]) {
      mocks.create.mockRejectedValueOnce(error);
      await act(() => control?.run());
      expect(mocks.toast.error).toHaveBeenLastCalledWith("Couldn't open Budget.csv with Sheets", {
        description: "Your file wasn't changed. Check your connection and try again.",
      });
    }
  });
});

let entries: MenuEntry[] = [];
function Menu({ item }: { item: DriveItem }) {
  entries = useItemMenu(useDriveActions(), [item], [item]);
  return null;
}
function Preview({ item = CSV }: { item?: DriveItem }) {
  const ui = useDriveUi();
  return h("button", { onClick: () => ui.setPreview({ items: [item], index: 0 }) }, "Preview item");
}
describe("Drive Sheets menu, preview and workbook presentation", () => {
  it("opens a workbook from the preview without converting or probing Write access", async () => {
    client.stat.mockResolvedValue(BOOK);
    const preview = await mount(
      h(DriveUiProvider, null, h(Preview, { item: BOOK }), h(PreviewDialog)),
    );
    await click(preview.host.querySelector("button") as Element);
    const button = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Open with Sheets"),
    );
    expect(button).toBeDefined();
    await click(button as Element);
    expect(mocks.router.push).toHaveBeenCalledWith(`/sheets/s/${encodeRef(BOOK.url)}`);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("offers Sheets from the item menu and the preview", async () => {
    const menu = await mount(h(DriveUiProvider, null, h(Menu, { item: CSV })));
    const submenu = entries.find((entry) => entry !== "separator" && entry.id === "open-with");
    expect(
      submenu &&
        submenu !== "separator" &&
        "submenu" in submenu &&
        submenu.submenu.map((entry) => entry.label),
    ).toEqual(["Sheets"]);
    if (submenu && submenu !== "separator" && "submenu" in submenu)
      await act(() => submenu.submenu[0]?.onSelect());
    expect(mocks.router.push).toHaveBeenCalledWith(`/sheets/s/${encodeRef(BOOK.url)}`);
    await menu.unmount();
    const preview = await mount(h(DriveUiProvider, null, h(Preview), h(PreviewDialog)));
    await click(preview.host.querySelector("button") as Element);
    const button = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Open with Sheets"),
    );
    expect(button).toBeDefined();
    await click(button as Element);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("shows a table icon and hides rename, move, download and copy for a workbook", async () => {
    await mount(
      h(DriveUiProvider, null, h(Menu, { item: BOOK }), h(ItemIcon, { item: BOOK, size: 24 })),
    );
    const ids = entries.filter((entry) => entry !== "separator").map((entry) => entry.id);
    expect(ids).toContain("trash");
    for (const id of ["rename", "move", "copy", "download"]) expect(ids).not.toContain(id);
    expect(document.querySelector('[data-glyph="table-2"]')).not.toBeNull();
    const open = entries.find((entry) => entry !== "separator" && entry.id === "open");
    if (open && open !== "separator" && "onSelect" in open) await act(() => open.onSelect());
    expect(mocks.router.push).toHaveBeenCalledWith(`/sheets/s/${encodeRef(BOOK.url)}`);
  });

  it("prevents workbook rename/move shortcuts and drag actions in the browser", async () => {
    client.stat.mockResolvedValue(BOOK);
    const view = await mount(
      h(
        DriveUiProvider,
        null,
        h(FileBrowser, {
          title: "Sheets",
          folder: `${ROOT}sheets/`,
          items: [BOOK],
          columns: ["modified", "size"],
          empty: { title: "Empty", icon: null },
        }),
      ),
    );
    const row =
      view.host.querySelector(`[data-item-url="${BOOK.url}"]`) ??
      view.host.querySelector("tbody tr");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("draggable")).toBe("false");
    await click(row as Element);
    await key(row as Element, "F2");
    await key(row as Element, "m");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const move = [...view.host.querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === "Move to…",
    );
    expect(move).toBeUndefined();
  });

  it("opens an existing Drive folder link in Sheets after validating the workbook metadata", async () => {
    client.stat.mockResolvedValue(BOOK);
    const view = await mount(h(DriveUiProvider, null, h(FolderRefView)));
    expect(mocks.router.replace).toHaveBeenCalledWith(`/sheets/s/${encodeRef(BOOK.url)}`);
    expect(view.host.querySelector("a")?.getAttribute("href")).toBe(
      `/sheets/s/${encodeRef(BOOK.url)}`,
    );
    expect(mocks.folders).not.toHaveBeenCalled();
  });

  it("keeps an ordinary folder at the same URL browsable when it has no workbook metadata", async () => {
    client.stat.mockResolvedValue({ url: BOOK.url, name: "budget", kind: "folder" });
    await mount(h(DriveUiProvider, null, h(FolderRefView)));
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.folders).toHaveBeenCalledWith(BOOK.url);
  });
});
