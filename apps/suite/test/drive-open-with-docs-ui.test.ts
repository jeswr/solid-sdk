// AUTHORED-BY Codex GPT-6.1
import { FileText } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "../src/apps/drive/lib/client/client";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  toast: Object.assign(vi.fn(), {
    loading: vi.fn(() => "loading-id"),
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
  convert: vi.fn(),
  connection: { disabled: false, reason: "You're offline. This needs a connection." },
  probe: vi.fn<typeof fetch>(),
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
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@/shell/sync/requires-online", () => ({ useNeedsConnection: () => mocks.connection }));
vi.mock("../src/apps/docs/hooks/open-with-docs", () => ({ openWithDocs: mocks.convert }));
const ROOT = "https://pod.example/";
let session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: mocks.probe };
const invalidate = vi.fn();
// Stable identities, as DriveProvider memoises them; effects key on the client.
const drive = {
  invalidate,
  driveRoot: `${ROOT}drive/`,
  prefs: { starred: [], openedShared: [], view: "list", sort: { key: "name", dir: "asc" } },
  updatePrefs: vi.fn(),
  changes: { subscribe: () => () => {}, subscribeSubtree: () => () => {} },
  uploads: { tasks: [], enqueue: vi.fn() },
  client: {
    read: async () => new Blob(["# Notes"], { type: "text/markdown" }),
    stat: async () => {
      throw new Error("Metadata unavailable");
    },
  },
};
vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => ({ ...drive, session }),
}));

import { DropdownMenu, DropdownMenuTrigger } from "@jeswr/suite-ui";
import { FileBrowser } from "../src/apps/drive/components/file-browser";
import {
  ContextEntries,
  DropdownEntries,
  type MenuEntry,
  useItemMenu,
} from "../src/apps/drive/components/item-menu";
import { PreviewDialog } from "../src/apps/drive/components/preview";
import { docsHref } from "../src/apps/drive/lib/open-with/docs";
import {
  type OpenWithDocsControl,
  useDocsWritable,
  useOpenWithDocs,
} from "../src/apps/drive/state/open-with-docs";
import { DriveUiProvider, useDriveActions, useDriveUi } from "../src/apps/drive/state/ui";

const file = (path: string, extra: Partial<DriveItem> = {}): DriveItem => ({
  url: `${ROOT}${path}`,
  name: path.split("/").pop() as string,
  kind: "file",
  ...extra,
});
const NOTES = file("drive/notes.md", { contentType: "text/markdown", size: 12 });
const DOC = file("docs/launch.ttl", { contentType: "text/turtle" });
const writable = (modes: string) =>
  mocks.probe.mockImplementation(
    async () => new Response(null, { headers: { "wac-allow": `user="${modes}"` } }),
  );

let control: OpenWithDocsControl | undefined;
function Hook({ item }: { item: DriveItem | undefined }) {
  control = useOpenWithDocs(item);
  return null;
}
beforeEach(() => {
  // A fresh session object per test starts a fresh shared probe.
  session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: mocks.probe };
  mocks.connection.disabled = false;
  writable("read write append");
});
afterEach(() => {
  vi.clearAllMocks();
  control = undefined;
});

describe("useOpenWithDocs", () => {
  it("is absent for folders, unsupported files and no selection", async () => {
    for (const item of [
      undefined,
      file("drive/photo.png"),
      { ...file("drive/Work/"), kind: "folder" as const },
    ]) {
      const view = await mount(h(Hook, { item }));
      expect(control).toBeUndefined();
      await view.unmount();
    }
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("opens Docs documents in the editor without converting or probing", async () => {
    await mount(h(Hook, { item: DOC }));
    expect(control).toMatchObject({ kind: "open", href: docsHref(DOC.url) });
    await act(() => control?.run());
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(DOC.url));
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("converts into a new document, refreshes it and opens it", async () => {
    mocks.convert.mockResolvedValue({ url: `${ROOT}docs/notes.ttl`, skipped: [] });
    await mount(h(Hook, { item: NOTES }));
    expect(control).toMatchObject({ kind: "convert", pending: false });
    expect(control).not.toHaveProperty("disabledReason");
    await act(() => control?.run());
    expect(mocks.convert).toHaveBeenCalledWith(
      { url: NOTES.url, name: "notes.md" },
      session,
      expect.any(Function),
    );
    // The importer's progress callback is accepted and ignored.
    const progress = mocks.convert.mock.calls[0]?.[2] as (value: unknown) => void;
    progress({ stage: "x" });
    expect(mocks.toast.loading).toHaveBeenCalledWith("Opening notes.md with Docs…");
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("loading-id");
    expect(invalidate).toHaveBeenCalledWith(`${ROOT}docs/notes.ttl`);
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(`${ROOT}docs/notes.ttl`));
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("ignores a second request while converting and reports pending", async () => {
    const result = deferred<{ url: string; skipped: [] }>();
    mocks.convert.mockReturnValue(result.promise);
    await mount(h(Hook, { item: NOTES }));
    let first: Promise<void> | undefined;
    await act(async () => {
      first = control?.run();
    });
    expect(control?.pending).toBe(true);
    await act(() => control?.run());
    expect(mocks.convert).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.resolve({ url: `${ROOT}docs/notes.ttl`, skipped: [] });
      await first;
    });
    expect(control?.pending).toBe(false);
  });

  it("lists skipped items and navigates to the completed document", async () => {
    mocks.convert.mockResolvedValue({
      url: `${ROOT}docs/report.ttl`,
      skipped: [{ label: "Footnotes", count: 1 }],
    });
    await mount(h(Hook, { item: file("drive/report.docx") }));
    await act(() => control?.run());
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(`${ROOT}docs/report.ttl`));
    const [title, options] = mocks.toast.warning.mock.calls[0] as unknown as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe("Some items weren't imported");
    expect(options.description).toBe("Footnotes (1).");
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(`${ROOT}docs/report.ttl`));
  });

  it("navigates after a menu is dismissed during conversion", async () => {
    const result = deferred<{ url: string; skipped: [] }>();
    mocks.convert.mockReturnValue(result.promise);
    const view = await mount(h(Hook, { item: NOTES }));
    const run = control?.run;
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = run?.();
    });
    await view.unmount();
    result.resolve({ url: `${ROOT}docs/notes.ttl`, skipped: [] });
    await pending;
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(`${ROOT}docs/notes.ttl`));
  });

  it.each([
    [new Error("We couldn't open this file"), "We couldn't open this file"],
    [
      new TypeError("Failed to fetch"),
      "Your file wasn't changed. Check your connection and try again.",
    ],
    [new Error(""), "Your file wasn't changed. Check your connection and try again."],
    ["boom", "Your file wasn't changed. Check your connection and try again."],
  ])("fails with a clear toast and never navigates (%s)", async (error, description) => {
    mocks.convert.mockRejectedValue(error);
    await mount(h(Hook, { item: NOTES }));
    await act(() => control?.run());
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("loading-id");
    expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't open notes.md with Docs", {
      description,
    });
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(control?.pending).toBe(false);
  });

  it("is disabled offline and does nothing when run anyway", async () => {
    mocks.connection.disabled = true;
    await mount(h(Hook, { item: NOTES }));
    expect(control).toMatchObject({ kind: "convert", disabledReason: mocks.connection.reason });
    await act(() => control?.run());
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.toast.loading).not.toHaveBeenCalled();
  });

  it("rechecks access at activation before importing", async () => {
    await mount(h(Hook, { item: NOTES }));
    writable("read");
    await act(() => control?.run());
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't open notes.md with Docs", {
      description: "You can't create documents in your Docs folder",
    });
  });

  it("is disabled once the Docs folder is known to be read-only", async () => {
    writable("read");
    await mount(h(Hook, { item: NOTES }));
    expect(control).toMatchObject({
      kind: "convert",
      disabledReason: "You can't create documents in your Docs folder",
    });
    expect(mocks.probe).toHaveBeenCalledWith(`${ROOT}docs/`, expect.anything());
  });
});

describe("useDocsWritable", () => {
  function Writable({ enabled, target }: { enabled: boolean; target: typeof session }) {
    const value = useDocsWritable(target, enabled);
    return h("output", null, String(value));
  }
  it("rechecks permissions on later openings and resets per session", async () => {
    const view = await mount(h(Writable, { enabled: false, target: session }));
    expect(view.host.textContent).toBe("undefined");
    expect(mocks.probe).not.toHaveBeenCalled();
    await view.render(h(Writable, { enabled: true, target: session }));
    expect(view.host.textContent).toBe("true");
    await mount(h(Writable, { enabled: true, target: session }));
    expect(mocks.probe).toHaveBeenCalledTimes(2);

    const other = { ...session };
    mocks.probe.mockImplementation(async () => new Response(null, { status: 500 }));
    await view.render(h(Writable, { enabled: true, target: other }));
    expect(view.host.textContent).toBe("undefined");
    writable("read");
    await mount(h(Writable, { enabled: true, target: other }));
    expect(mocks.probe).toHaveBeenCalledTimes(4);
  });
  it("shares a probe while multiple menus mount together", async () => {
    const answer = deferred<Response>();
    mocks.probe.mockReturnValue(answer.promise);
    await mount(
      h(
        "div",
        null,
        h(Writable, { enabled: true, target: session }),
        h(Writable, { enabled: true, target: session }),
      ),
    );
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    await act(async () =>
      answer.resolve(new Response(null, { headers: { "wac-allow": 'user="write"' } })),
    );
  });
  it("drops an answer that arrives after unmounting", async () => {
    const answer = deferred<Response>();
    mocks.probe.mockReturnValue(answer.promise);
    const view = await mount(h(Writable, { enabled: true, target: session }));
    await view.unmount();
    answer.resolve(new Response(null, { headers: { "wac-allow": 'user="write"' } }));
    await act(async () => {});
    expect(view.host.textContent).toBe("");
  });
});

describe("Drive surfaces", () => {
  let menu: ReturnType<typeof useItemMenu> = [];
  let actions: ReturnType<typeof useDriveActions> | undefined;
  function Menu({ items }: { items: DriveItem[] }) {
    actions = useDriveActions();
    menu = useItemMenu(actions, items, items);
    return h(
      "div",
      null,
      h(
        DropdownMenu,
        { open: true },
        h(DropdownMenuTrigger, null, "More"),
        h(DropdownEntries, { entries: menu }),
      ),
    );
  }
  const openWith = () =>
    menu.find((entry) => entry !== "separator" && entry.id === "open-with") as
      | {
          submenu: {
            id: string;
            label: string;
            disabled?: boolean;
            hint?: string;
            onSelect(): void;
          }[];
        }
      | undefined;

  it.each(["Enter", "double-click"])("opens Docs from the listing with %s", async (activation) => {
    const view = await mount(
      h(
        DriveUiProvider,
        null,
        h(FileBrowser, {
          title: "Docs",
          items: [DOC],
          folder: `${ROOT}docs/`,
          columns: [],
          empty: { title: "Empty", icon: null },
        }),
      ),
    );
    const row = view.host.querySelector("[data-url]") as HTMLElement;
    expect(row).not.toBeNull();
    if (activation === "Enter") await key(row, "Enter");
    else await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(DOC.url));
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("adds Open with › Docs after Open for a single convertible file", async () => {
    mocks.convert.mockResolvedValue({ url: `${ROOT}docs/notes.ttl`, skipped: [] });
    await mount(h(DriveUiProvider, null, h(Menu, { items: [NOTES] })));
    const ids = menu.map((entry) => (entry === "separator" ? "-" : entry.id));
    expect(ids.slice(0, 3)).toEqual(["open", "open-with", "-"]);
    const [docs] = openWith()?.submenu ?? [];
    expect(docs).toMatchObject({ id: "open-with-docs", label: "Docs", disabled: false });
    expect(docs).not.toHaveProperty("hint");
    expect(document.body.textContent).toContain("Open with");
    await act(async () => docs?.onSelect());
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(`${ROOT}docs/notes.ttl`));
  });

  it("explains a disabled conversion under the menu label", async () => {
    mocks.connection.disabled = true;
    await mount(h(DriveUiProvider, null, h(Menu, { items: [NOTES] })));
    expect(openWith()?.submenu[0]).toMatchObject({
      disabled: true,
      hint: mocks.connection.reason,
    });
  });

  it("offers Open with › Docs for Docs documents and opens them on Open", async () => {
    await mount(h(DriveUiProvider, null, h(Menu, { items: [DOC] })));
    expect(openWith()?.submenu[0]).toMatchObject({ disabled: false });
    const open = menu.find((entry) => entry !== "separator" && entry.id === "open") as {
      onSelect(): void;
    };
    await act(async () => open.onSelect());
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(DOC.url));
  });

  it("leaves the menu alone for other files and multiple selections", async () => {
    await mount(h(DriveUiProvider, null, h(Menu, { items: [file("drive/photo.png")] })));
    expect(openWith()).toBeUndefined();
    await mount(h(DriveUiProvider, null, h(Menu, { items: [NOTES, DOC] })));
    expect(openWith()).toBeUndefined();
  });

  it("renders submenus and hints in both menu forms", async () => {
    const onSelect = vi.fn();
    const entries: MenuEntry[] = [
      {
        id: "open-with",
        label: "Open with",
        icon: FileText,
        submenu: [
          {
            id: "docs",
            label: "Docs",
            icon: FileText,
            disabled: true,
            hint: "Offline",
            onSelect,
          },
        ],
      },
      "separator" as const,
      { id: "star", label: "Star", icon: FileText, shortcut: "S", destructive: true, onSelect },
    ];
    const { ContextMenu, ContextMenuTrigger } = await import("@jeswr/suite-ui");
    const view = await mount(
      h(
        "div",
        null,
        h(
          DropdownMenu,
          { open: true },
          h(DropdownMenuTrigger, null, "More"),
          h(DropdownEntries, { entries }),
        ),
        h(ContextMenu, null, h(ContextMenuTrigger, null, "Row"), h(ContextEntries, { entries })),
      ),
    );
    expect(document.body.textContent).toContain("Open with");
    const row = [...view.host.querySelectorAll("span")].find((e) => e.textContent === "Row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 }));
    });
    expect(document.querySelectorAll('[data-slot="context-menu-sub-trigger"]').length).toBe(1);
    expect(document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"]').length).toBe(1);
  });

  it("shows Open with Docs in the preview header and explains when it's unavailable", async () => {
    mocks.convert.mockResolvedValue({ url: `${ROOT}docs/notes.ttl`, skipped: [] });
    let ui: ReturnType<typeof useDriveUi> | undefined;
    function Open() {
      ui = useDriveUi();
      return ui.preview ? h(PreviewDialog) : null;
    }
    const view = await mount(h(DriveUiProvider, null, h(Open)));
    await act(async () => ui?.setPreview({ items: [NOTES], index: 0 }));
    const button = () =>
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Open with Docs");
    expect(button()?.disabled).toBe(false);
    await click(button() as HTMLButtonElement);
    expect(mocks.router.push).toHaveBeenCalledWith(docsHref(`${ROOT}docs/notes.ttl`));

    mocks.connection.disabled = true;
    await act(async () => ui?.setPreview({ items: [{ ...NOTES }], index: 0 }));
    expect(button()?.disabled).toBe(true);
    expect(document.querySelector(`[aria-label="${mocks.connection.reason}"]`)).not.toBeNull();

    await act(async () => ui?.setPreview({ items: [file("drive/photo.png")], index: 0 }));
    expect(button()).toBeUndefined();
    await view.unmount();
  });
});
