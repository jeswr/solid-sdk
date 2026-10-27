// AUTHORED-BY Codex

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("@/apps/docs/lib/model/type-index", () => ({ ensureTypeRegistrations: vi.fn() }));
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
import { FolderView } from "../src/apps/drive/components/views";
import * as operations from "../src/apps/drive/lib/operations/operations";
import { useDrive } from "../src/apps/drive/state/drive-context";
import { type DriveDialog, useDriveUi } from "../src/apps/drive/state/ui";

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
    seed: ["A.txt", "Preview.txt", "B/one.txt", "C/two.txt"].map((name) => ({
      path: `drive/${name}`,
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
  const view = await mount(tree(h("p", null, "Opening preview…")));
  const item = await drive.client.stat(`${ROOT}Preview.txt`);
  const preview = h(PreviewPage, { item, parent: ROOT });
  await view.render(tree(preview));
  expect(view.host.querySelector("[data-drive-listing]")).toBeNull();
  expect(view.host.querySelector('[aria-label="Back to folder"]')?.getAttribute("href")).toBe(
    "/drive/my",
  );
  return { view, preview };
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function focus(element: HTMLElement) {
  await act(async () => element.focus());
  expect(document.activeElement).toBe(element);
}
async function activate(element: HTMLElement) {
  await focus(element);
  await click(element);
}
function content() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (!dialog) throw new Error("Missing dialog");
  return dialog;
}
async function submitName(value: string) {
  const input = content().querySelector<HTMLInputElement>('input[autocomplete="off"]');
  if (!input) throw new Error("Missing name field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function enqueue(name: string) {
  await act(async () => {
    drive.uploads.enqueue(ROOT, [new File(["text"], name, { type: "text/plain" })]);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const paths = [
  ["new-folder", "cancel"],
  ["new-folder", "escape"],
  ["new-folder", "close"],
  ["new-folder", "submit"],
  ["rename", "cancel"],
  ["rename", "escape"],
  ["rename", "close"],
  ["rename", "submit"],
  ["rename", "unchanged"],
  ["rename", "extension-keep"],
  ["rename", "extension-change"],
  ["rename", "extension-escape"],
  ["move", "cancel"],
  ["move", "escape"],
  ["move", "close"],
  ["move", "submit"],
  ["delete-forever", "cancel"],
  ["delete-forever", "escape"],
  ["delete-forever", "submit"],
  ["empty-trash", "cancel"],
  ["empty-trash", "escape"],
  ["empty-trash", "submit"],
  ["upload-conflict", "skip"],
  ["upload-conflict", "replace"],
  ["upload-conflict", "keep-both"],
  ["upload-conflict", "escape"],
  ["upload-conflict", "close"],
  ["preview-dialog", "escape"],
  ["preview-dialog", "close"],
  ["dock", "close"],
  ["dock", "retry"],
  ["dock", "status"],
] as const;

it.each(
  paths.flatMap(([kind, action]) =>
    ["preview", "main"].map((destination) => ({ kind, action, destination })),
  ),
)("$kind $action restores displaced focus to $destination without a listing after direct preview navigation", async ({
  kind,
  action,
  destination,
}) => {
  const { view, preview } = await setup();
  // Direct preview -> Back to folder -> open an action -> browser Back while it is open.
  await view.render(tree());
  const opener = view.host.querySelector<HTMLElement>("[data-drive-listing]");
  if (!opener) throw new Error("Missing opener listing");
  await focus(opener);
  const upload = vi.spyOn(operations, "uploadFile");
  if (kind === "dock") {
    if (action === "retry") upload.mockRejectedValueOnce(new Error("offline"));
    await enqueue("Upload.txt");
    await vi.waitFor(() =>
      expect(drive.uploads.tasks[0]?.status).toBe(action === "retry" ? "failed" : "done"),
    );
  } else if (kind === "upload-conflict") {
    await enqueue("A.txt");
    await vi.waitFor(() => expect(drive.uploads.tasks[0]?.status).toBe("conflict"));
  } else if (kind === "preview-dialog") {
    const item = await drive.client.stat(`${ROOT}A.txt`);
    await act(async () => ui.setPreview({ items: [item], index: 0 }));
  } else {
    const item = await drive.client.stat(`${ROOT}A.txt`);
    const entries =
      kind === "delete-forever" || kind === "empty-trash"
        ? (await operations.trashItems(drive.client, ROOT, [item])).done
        : [];
    await focus(opener);
    const dialog: DriveDialog =
      kind === "new-folder"
        ? { kind, parent: ROOT }
        : kind === "rename"
          ? { kind, item }
          : kind === "move"
            ? { kind, items: [item] }
            : { kind, entries };
    await act(async () => ui.openDialog(dialog));
    if (kind === "move" && action === "submit")
      await click(content().querySelector(`[data-node="${ROOT}B/"]`) as Element);
  }
  await view.render(tree(destination === "preview" ? preview : h("p", null, "Opening preview…")));
  expect(view.host.querySelector("[data-drive-listing]")).toBeNull();
  expect(opener.isConnected).toBe(false);
  const fallback = view.host.querySelector<HTMLElement>(
    destination === "preview" ? "[data-drive-preview]" : "main",
  );

  if (kind === "dock") {
    if (action === "status") {
      const pending = deferred<void>();
      upload.mockImplementationOnce(async (...args) => {
        await pending.promise;
        return realUpload(...args);
      });
      const close = button("Close uploads", view.host);
      await focus(close);
      await enqueue("Another.txt");
      expect(close.isConnected).toBe(false);
      expect(document.activeElement).toBe(fallback);
      await act(async () => pending.resolve());
      await vi.waitFor(() => expect(drive.uploads.tasks.at(-1)?.status).toBe("done"));
    } else {
      // Retry normally prefers the dock toggle. Exercise its fallback when disabled.
      if (action === "retry") button("Collapse uploads", view.host).disabled = true;
      await activate(button(action === "retry" ? "Retry Upload.txt" : "Close uploads", view.host));
    }
  } else if (action === "escape" || action === "close" || action === "cancel") {
    if (action === "escape") await key(content(), "Escape");
    else await activate(button(action === "close" ? "Close" : "Cancel", content()));
  } else if (kind === "upload-conflict") {
    await activate(
      button(
        action === "skip" ? "Skip" : action === "replace" ? "Replace" : "Keep both",
        content(),
      ),
    );
  } else if (kind === "rename" && action.startsWith("extension-")) {
    await submitName("Renamed.pdf");
    expect(content().getAttribute("role")).toBe("alertdialog");
    expect(content().contains(document.activeElement)).toBe(true);
    if (action === "extension-escape") await key(content(), "Escape");
    else await activate(button(action === "extension-keep" ? "Keep .txt" : "Change", content()));
  } else if (kind === "new-folder" || kind === "rename") {
    await submitName(
      action === "unchanged" ? "A.txt" : kind === "rename" ? "Renamed.txt" : "New folder",
    );
  } else {
    await activate(
      button(
        kind === "move" ? "Move" : kind === "empty-trash" ? "Empty trash" : "Delete for ever",
        content(),
      ),
    );
  }
  await vi.waitFor(() => expect(document.activeElement).toBe(fallback));
});

// Keep the real operation available when a queued upload is deliberately held open.
const realUpload = operations.uploadFile;

it("upload-conflict without a focused opener restores focus to the direct preview", async () => {
  const { view } = await setup();
  expect(document.activeElement).toBe(document.body);
  await enqueue("A.txt");
  await vi.waitFor(() => expect(drive.uploads.tasks[0]?.status).toBe("conflict"));
  await activate(button("Skip", content()));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(view.host.querySelector("[data-drive-preview]")),
  );
});

it.each([
  "new-folder",
  "rename",
  "move",
  "delete-forever",
  "empty-trash",
  "upload-conflict",
  "preview-dialog",
] as const)("%s close preserves focus moved to a surviving control before autofocus", async (kind) => {
  const { view } = await setup();
  const opener = view.host.querySelector<HTMLElement>(
    '[aria-label="Back to folder"]',
  ) as HTMLElement;
  await focus(opener);
  const item = await drive.client.stat(`${ROOT}A.txt`);
  if (kind === "upload-conflict") {
    await enqueue("A.txt");
    await vi.waitFor(() => expect(drive.uploads.tasks[0]?.status).toBe("conflict"));
  } else if (kind === "preview-dialog") {
    await act(async () => ui.setPreview({ items: [item], index: 0 }));
  } else {
    const dialog: DriveDialog =
      kind === "new-folder"
        ? { kind, parent: ROOT }
        : kind === "rename"
          ? { kind, item }
          : kind === "move"
            ? { kind, items: [item] }
            : { kind, entries: [] };
    await act(async () => ui.openDialog(dialog));
  }
  const closed = vi.fn();
  content().addEventListener("focusScope.autoFocusOnUnmount", closed);
  const search = view.host.querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;
  await act(async () => {
    flushSync(() => {
      if (kind === "upload-conflict")
        drive.uploads.resolve(drive.uploads.tasks[0]?.id ?? "", "skip");
      else if (kind === "preview-dialog") ui.setPreview(undefined);
      else ui.closeDialog();
    });
    search.focus();
  });
  await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
  expect(document.activeElement).toBe(search);
});

it("starting another upload with Shift+U restores focus when Close uploads disappears", async () => {
  const { view } = await setup();
  await view.render(tree());
  const original = operations.uploadFile;
  const upload = vi.spyOn(operations, "uploadFile");
  await enqueue("Upload.txt");
  await vi.waitFor(() => expect(drive.uploads.tasks[0]?.status).toBe("done"));
  const close = button("Close uploads", view.host);
  await focus(close);
  const picker = view.host.querySelector<HTMLInputElement>('[data-testid="drive-upload-input"]');
  if (!picker) throw new Error("Missing upload picker");
  const opened = vi.spyOn(picker, "click");
  await key(close, "U", true);
  expect(opened).toHaveBeenCalledOnce();
  const pending = deferred<void>();
  upload.mockImplementationOnce(async (...args) => {
    await pending.promise;
    return original(...args);
  });
  await act(async () => {
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [new File(["text"], "Another.txt", { type: "text/plain" })],
    });
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(close.isConnected).toBe(false);
  const listing = view.host.querySelector("[data-drive-listing]");
  expect(document.activeElement).toBe(listing);
  await act(async () => pending.resolve());
  await vi.waitFor(() => expect(drive.uploads.tasks.at(-1)?.status).toBe("done"));
  expect(document.activeElement).toBe(listing);
});

it.each([
  ["End", "C/"],
  ["ArrowRight", "B/"],
  ["ArrowDown", "B/"],
])("Move tree navigates from its initially focused root with %s", async (firstKey, destination) => {
  const { view } = await setup();
  const item = await drive.client.stat(`${ROOT}A.txt`);
  await act(async () => ui.openDialog({ kind: "move", items: [item] }));
  const root = content().querySelector<HTMLElement>(`[data-node="${ROOT}"]`) as HTMLElement;
  expect(document.activeElement).toBe(root);
  const next = content().querySelector<HTMLElement>(`[data-node="${ROOT}${destination}"]`);
  expect(next).not.toBeNull();
  await key(root, firstKey);
  await vi.waitFor(() => expect(document.activeElement).toBe(next));
  expect(next?.getAttribute("aria-selected")).toBe("true");
  expect(next?.tabIndex).toBe(0);
  expect(root.tabIndex).toBe(-1);
  await key(next as HTMLElement, "Home");
  await vi.waitFor(() => expect(document.activeElement).toBe(root));
  expect(root.getAttribute("aria-selected")).toBe("true");
  expect(button("Move", content()).disabled).toBe(true);
  await key(root, "Escape");
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(view.host.querySelector("[data-drive-preview]")),
  );
});
