// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { act, createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { TitleConflictError } from "../src/apps/docs/lib/model";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({ runtime: null as DocumentPersistence | null }));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/docs/d/test",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/apps/docs/hooks/use-document", () => ({
  useDocument: () => ({ runtime: mocks.runtime, error: null, recover: vi.fn() }),
}));
// Keep this focused on the SSR output; editor creation itself only runs after hydration.
vi.mock("@tiptap/react", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useEditor: () => null,
}));

import { DocsSidebar } from "../src/apps/docs/components/common";
import { DeleteDialog } from "../src/apps/docs/components/delete-dialog";
import { DocumentEditor } from "../src/apps/docs/components/document-editor";
import { ModifiedTime } from "../src/apps/docs/components/modified-time";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps Moving to trash visible and the confirmation disabled until the operation settles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const render = (busy: boolean) =>
    root.render(
      createElement(DeleteDialog, {
        open: true,
        busy,
        onConfirm,
        onOpenChange,
      }),
    );
  try {
    await act(async () => render(false));
    const dialog = document.querySelector('[role="alertdialog"]');
    const confirm = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Move to trash",
    );
    expect(confirm).toBeDefined();
    expect(dialog?.querySelector('[role="status"]')).toBeNull();
    await act(async () => confirm?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => render(true));
    expect(dialog?.querySelector('[role="status"]')?.textContent).toBe("Moving to trash…");
    expect(confirm?.disabled).toBe(true);
    expect(
      Array.from(dialog?.querySelectorAll("button") ?? []).every((button) => button.disabled),
    ).toBe(true);
    await act(async () => {
      confirm?.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => render(false));
    expect(dialog?.querySelector('[role="status"]')).toBeNull();
    expect(confirm?.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("hydrates the Docs editor across a minute boundary without changing its initial text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  window.matchMedia = globalThis.matchMedia;
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-26T12:00:59Z"));
  const doc = new Doc();
  const session = { storageUrl: "https://pod.test/", fetch: vi.fn() } as unknown as PodSession;
  mocks.runtime = {
    doc,
    session,
    state: "saved",
    localState: "saved",
    online: true,
    lastSaved: Date.parse("2026-10-26T12:00:00Z"),
    title: "Plan",
    readOnly: false,
    flush: vi.fn(),
  } as unknown as DocumentPersistence;
  const tree = createElement(
    TooltipProvider,
    null,
    createElement(DocumentEditor, { session, resource: undefined }),
  );
  const html = renderToString(tree);
  now.mockReturnValue(Date.parse("2026-10-26T12:01:01Z"));
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const errors: unknown[] = [];
  const root = hydrateRoot(host, tree, { onRecoverableError: (error) => errors.push(error) });
  try {
    await act(async () => {});
    expect(errors).toEqual([]);
    expect(host.textContent).toContain("Saved to your pod · 1 min ago");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    doc.destroy();
  }
});

it("renders a working Docs Trash link to Drive's unfiltered trash route", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToString(createElement(DocsSidebar));
  const link = Array.from(host.querySelectorAll("a")).find((link) => link.textContent === "Trash");
  expect(link?.getAttribute("href")).toBe("/drive/trash");
});
it.each([
  ["saved", "Saved on this device"],
  ["saving", "Saving on this device…"],
  ["retrying", "Not saved — retrying on this device"],
  ["failed", "Couldn't save on this device"],
])("round27 offline and trash banners report the actual local %s state", (localState, message) => {
  const doc = new Doc();
  const session = { storageUrl: "https://pod.test/", fetch: vi.fn() } as unknown as PodSession;
  mocks.runtime = {
    doc,
    session,
    state: "retrying",
    localState,
    online: false,
    trashed: true,
    lastSaved: Date.now(),
    title: "Plan",
    readOnly: false,
  } as unknown as DocumentPersistence;
  try {
    const html = renderToString(
      createElement(
        TooltipProvider,
        null,
        createElement(DocumentEditor, { session, resource: undefined }),
      ),
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.textContent).toContain(`Moved to trash — ${message}`);
    expect(host.textContent).toContain(`Offline — ${message}`);
    expect(html).not.toContain("Saved to your pod");
    if (localState !== "saved") expect(host.textContent).not.toContain("Saved on this device");
  } finally {
    doc.destroy();
    mocks.runtime = null;
  }
});
it.each([
  ["saved", "Saved on this device"],
  ["saving", "Saving on this device…"],
  ["retrying", "Not saved — retrying on this device"],
  ["failed", "Couldn't save on this device"],
])("round27 save-error and title-conflict dialogs report the local %s state", async (localState, message) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  window.matchMedia = globalThis.matchMedia;
  const doc = new Doc();
  const session = { storageUrl: "https://pod.test/", fetch: vi.fn() } as unknown as PodSession;
  mocks.runtime = {
    doc,
    session,
    state: "failed",
    localState,
    online: true,
    lastSaved: Date.now(),
    title: "Plan",
    readOnly: false,
  } as unknown as DocumentPersistence;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(DocumentEditor, { session, resource: undefined }),
      ),
    );
  try {
    await act(async () => render());
    const why = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Why?",
    );
    expect(why).toBeDefined();
    await act(async () => why?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(message);
    await act(async () => root.render(null));
    mocks.runtime.conflict = new TitleConflictError(
      "https://pod.test/docs/plan.ttl",
      "Mine",
      "Theirs",
    );
    await act(async () => render());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      `Choose the title to keep. ${message}.`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    doc.destroy();
    mocks.runtime = null;
  }
});
it("links the separate copy containing edits from a retired log", () => {
  const doc = new Doc();
  const session = { storageUrl: "https://pod.test/", fetch: vi.fn() } as unknown as PodSession;
  mocks.runtime = {
    doc,
    session,
    state: "saved",
    online: true,
    lastSaved: Date.now(),
    title: "Plan",
    recoveredCopy: "https://pod.test/docs/recovered.ttl",
  } as unknown as DocumentPersistence;
  try {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      createElement(DocumentEditor, { session, resource: undefined }),
    );
    const link = [...host.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "a separate copy",
    );
    expect(link?.getAttribute("href")).toMatch(/^\/docs\/d\//);
    expect(host.textContent).toContain("Your pending edits were saved");
  } finally {
    doc.destroy();
    mocks.runtime = null;
  }
});
it("keeps the document non-editable with visible Syncing feedback while opening", () => {
  mocks.runtime = null;
  const html = renderToString(
    createElement(DocumentEditor, { session: {} as PodSession, resource: undefined }),
  );
  expect(html).toContain("Syncing…");
  expect(html).not.toContain('contenteditable="true"');
  expect(html).not.toContain('aria-label="Document title"');
});
it("hydrates list timestamps independently of browser clocks and locale formatting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const value = "2026-10-26T12:00:00Z";
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-26T12:00:59Z"));
  const locale = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(() => {
    throw new Error("locale-dependent render");
  });
  const tree = createElement(ModifiedTime, { value });
  const host = document.createElement("div");
  host.innerHTML = renderToString(tree);
  expect(host.querySelector("time")?.textContent).toBe(value);
  expect(now).not.toHaveBeenCalled();
  now.mockReturnValue(Date.parse("2026-10-26T12:01:01Z"));
  const errors: unknown[] = [];
  const root = hydrateRoot(host, tree, { onRecoverableError: (error) => errors.push(error) });
  try {
    await act(async () => {});
    expect(errors).toEqual([]);
    expect(locale).not.toHaveBeenCalled();
    expect(host.querySelector("time")?.textContent).toBe("1 min ago");
    expect(host.querySelector("time")?.title).toBe(value);
    await act(async () => root.render(createElement(ModifiedTime, { value: undefined })));
    expect(host.textContent).toBe("—");
  } finally {
    await act(async () => root.unmount());
  }
});
