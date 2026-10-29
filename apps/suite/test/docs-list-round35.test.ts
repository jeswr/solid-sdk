// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentList } from "../src/apps/docs/components/document-list";
import type { DocumentEntry } from "../src/apps/docs/lib/model";
import type { PodSession } from "../src/lib/session/pod-session";

const state = vi.hoisted(() => ({
  store: { list: vi.fn(), read: vi.fn(), save: vi.fn() },
  params: new URLSearchParams(),
  router: { push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => state.router,
  useSearchParams: () => state.params,
}));
vi.mock("../src/apps/docs/hooks/use-docs-store", () => ({ useDocsStore: () => state.store }));
vi.mock("../src/apps/docs/editor/drafts", () => ({ listLocalDrafts: async () => [] }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children, actions }: { children: ReactNode; actions: ReactNode }) =>
    createElement("div", null, actions, children),
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  state.store.list.mockReset();
  state.store.read.mockReset();
  state.store.save.mockReset();
});

it.each([
  "other document",
  "same document",
  "current dialog",
])("round36 a completed rename cannot close a newer dialog for %s", async (target) => {
  const first = entry("First");
  const second = { ...entry("Second"), url: "https://pod.test/docs/other.ttl" };
  state.store.list.mockResolvedValue([first, second]);
  state.store.read.mockResolvedValue({ data: { body: "<p>Body</p>", format: "text/html" } });
  const save = deferred<void>();
  state.store.save.mockReturnValue(save.promise);
  const { root } = await mount();
  const rename = async (name: string) => {
    await act(async () =>
      button(`Actions for ${name}`).dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (node) => node.textContent === "Rename",
    );
    await act(async () => item?.click());
  };
  try {
    await rename("First");
    await act(async () => button("Save title").click());
    if (target !== "current dialog") {
      await act(async () =>
        (document.querySelector('[role="dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
      await rename(target === "same document" ? "First" : "Second");
    }
    const input = document.querySelector<HTMLInputElement>("#rename-title") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Unsaved title",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => save.resolve());
    expect(document.querySelector("#rename-title")).toBe(input);
    expect(input.value).toBe("Unsaved title");
  } finally {
    await act(async () => root.unmount());
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const entry = (title: string) =>
  ({ url: "https://pod.test/docs/plan.ttl", title }) as DocumentEntry;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = { webId: "https://pod.test/profile#me" } as PodSession;
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(createElement(TooltipProvider, null, createElement(DocumentList, { session }))),
  );
  return { host, root };
}
function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (node) => node.getAttribute("aria-label") === label || node.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

it.each([
  "Rename",
  "Move to trash",
])("round38 Escape from keyboard %s returns focus to the invoking row Actions button", async (action) => {
  state.store.list.mockResolvedValue([
    entry("First"),
    { ...entry("Second"), url: "https://pod.test/docs/second.ttl" },
  ]);
  const { root } = await mount();
  try {
    for (const name of ["First", "Second"]) {
      const trigger = button(`Actions for ${name}`);
      await act(async () => {
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (node) => node.textContent === action,
      ) as HTMLElement;
      expect(item).toBeDefined();
      await act(async () => {
        item.focus();
        item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const selector = action === "Rename" ? '[role="dialog"]' : '[role="alertdialog"]';
      await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
      await act(async () =>
        (document.querySelector(selector) as HTMLElement).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await vi.waitFor(() => expect(document.querySelector(selector)).toBeNull());
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    }
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([
  "success",
  "failure",
])("round35 stale Refresh %s cannot overwrite a rename reload", async (outcome) => {
  const old = deferred<DocumentEntry[]>();
  state.store.list
    .mockResolvedValueOnce([entry("Before")])
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([entry("After")]);
  state.store.read.mockResolvedValue({ data: { body: "<p>Body</p>", format: "text/html" } });
  state.store.save.mockResolvedValue(undefined);
  const { host, root } = await mount();
  try {
    await act(async () => button("Refresh documents").click());
    await act(async () =>
      button("Actions for Before").dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    const rename = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (node) => node.textContent === "Rename",
    ) as HTMLElement;
    expect(rename).toBeDefined();
    await act(async () => rename.click());
    const input = document.querySelector("#rename-title") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "After",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save title").click());
    expect(state.store.save).toHaveBeenCalledWith(
      expect.anything(),
      { title: "After" },
      expect.anything(),
    );
    expect(host.querySelector("tbody")?.textContent).toContain("After");
    await act(async () =>
      outcome === "success" ? old.resolve([entry("Before")]) : old.reject(new Error("Offline")),
    );
    expect(host.querySelector("tbody")?.textContent).toContain("After");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
