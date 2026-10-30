// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentList } from "../src/apps/docs/components/document-list";
import {
  buildDocument,
  DocsStore,
  type DocumentEntry,
  serializeTurtle,
} from "../src/apps/docs/lib/model";
import type { PodSession } from "../src/lib/session/pod-session";

const state = vi.hoisted(() => ({
  store: { list: vi.fn(), read: vi.fn(), save: vi.fn() },
  params: new URLSearchParams(),
  router: { push: vi.fn() },
  trash: vi.fn(),
}));
vi.mock("../src/apps/docs/components/trash-actions", () => ({
  trashDocumentWithUndo: state.trash,
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

it("round52 Rename retries preserve another tab's latest pod body, format and word count", async () => {
  const url = entry("Plan").url;
  const initial = {
    title: "Plan",
    body: "<p>v1</p>",
    format: "text/html",
    wordCount: 1,
    instanceId: "document",
  };
  let body = await serializeTurtle(buildDocument(url, initial));
  let etag = '"v1"';
  const writes: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "PUT") {
      writes.push(String(init.body));
      if (new Headers(init.headers).get("if-match") !== etag)
        return new Response(null, { status: 412 });
      body = String(init.body);
      etag = '"renamed"';
      return new Response(null, { status: 205, headers: { etag } });
    }
    return new Response(body, { headers: { etag, "content-type": "text/turtle" } });
  };
  const store = new DocsStore("https://pod.test/", session.webId, fetchImpl);
  state.store.list.mockResolvedValue([entry("Plan")]);
  state.store.read.mockImplementation(async () => {
    const stored = await store.read(url);
    // Another tab commits after Rename reads the old snapshot.
    body = await serializeTurtle(
      buildDocument(url, { ...initial, body: "# v2 body", format: "text/markdown", wordCount: 3 }),
    );
    etag = '"v2"';
    return stored;
  });
  state.store.save.mockImplementation(store.save.bind(store));
  const { root } = await mount();
  try {
    await act(async () =>
      button("Actions for Plan").dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((node) => node.textContent === "Rename")
        ?.click(),
    );
    const input = document.querySelector<HTMLInputElement>("#rename-title") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Renamed",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.useFakeTimers();
    await act(async () => button("Save title").click());
    await act(async () => vi.runAllTimersAsync());
    const reopened = await store.read(url);
    expect(writes).toHaveLength(2);
    expect(reopened?.data).toMatchObject({
      title: "Renamed",
      body: "# v2 body",
      format: "text/markdown",
      wordCount: 3,
    });
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
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
  401, 403,
])("round47 Refresh reports a denied container (%s) and Retry restores documents", async (status) => {
  const podRoot = "https://pod.test/";
  const container = `${podRoot}docs/`;
  const url = `${container}plan.ttl`;
  const dataset = new Store();
  const listing = new Container(container, dataset, DataFactory);
  listing.type.add("http://www.w3.org/ns/ldp#BasicContainer");
  listing.contains.add(new Resource(url, dataset, DataFactory));
  const bodies = new Map([
    [session.webId, ""],
    [container, await serializeTurtle(dataset)],
    [url, await serializeTurtle(buildDocument(url, { title: "Plan", body: "Body" }))],
  ]);
  let denied = false;
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input) === container && denied) return new Response(null, { status });
    return new Response(bodies.get(String(input)), { headers: { "content-type": "text/turtle" } });
  };
  const store = new DocsStore(podRoot, session.webId, fetchImpl);
  state.store.list.mockImplementation(() => store.list());
  const { host, root } = await mount();
  try {
    expect(host.querySelector("tbody")?.textContent).toContain("Plan");
    denied = true;
    await act(async () => button("Refresh documents").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't load your documents",
    );
    expect(host.textContent).not.toContain("No documents yet");
    denied = false;
    await act(async () => button("Retry").click());
    expect(host.querySelector("tbody")?.textContent).toContain("Plan");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

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
    expect(state.store.save).toHaveBeenCalledWith(expect.anything(), { title: "After" });
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

it.each([
  "first",
  "last",
  "only",
])("round46 keyboard trash restores list position after removing the %s row", async (position) => {
  const first = entry("First");
  const last = { ...entry("Last"), url: "https://pod.test/docs/last.ttl" };
  const entries = position === "only" ? [first] : [first, last];
  const removed = position === "last" ? last : first;
  state.store.list.mockResolvedValue(entries);
  state.trash.mockImplementation(async () => {
    state.store.list.mockResolvedValue(entries.filter((row) => row !== removed));
    return true;
  });
  const { root } = await mount();
  try {
    const trigger = button(`Actions for ${removed.title}`);
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (node) => node.textContent === "Move to trash",
    ) as HTMLElement;
    await act(async () => {
      item.focus();
      item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    const confirm = Array.from(
      document.querySelectorAll<HTMLElement>('[role="alertdialog"] button'),
    ).find((node) => node.textContent === "Move to trash") as HTMLElement;
    await act(async () => {
      confirm.focus();
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    expect(trigger.isConnected).toBe(false);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        position === "only"
          ? button("Refresh documents")
          : button(`Actions for ${position === "last" ? "First" : "Last"}`),
      ),
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("round46 renaming a row out of the active filter restores focus to the remaining list position", async () => {
  state.params = new URLSearchParams({ q: "First" });
  state.store.list.mockResolvedValue([entry("First")]);
  state.store.read.mockResolvedValue({ data: { body: "<p>Body</p>", format: "text/html" } });
  state.store.save.mockImplementation(async () => {
    state.store.list.mockResolvedValue([entry("Renamed")]);
  });
  const { root } = await mount();
  try {
    const trigger = button("Actions for First");
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const rename = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (node) => node.textContent === "Rename",
    ) as HTMLElement;
    await act(async () => {
      rename.focus();
      rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const input = document.querySelector<HTMLInputElement>("#rename-title") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "Renamed",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save title").click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(trigger.isConnected).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Refresh documents")));
  } finally {
    await act(async () => root.unmount());
    state.params = new URLSearchParams();
  }
});
