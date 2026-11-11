// AUTHORED-BY Codex GPT-6.1-Sol
import { type ReactNode, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { encodeRef } from "../../src/lib/refs";
import { act, click, deferred, h, key, mount } from "../drive-ui-dom";
import { storage, webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let cache: TasksCache;
let query = "";
let dismissDetails: (() => void) | undefined;
vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/inbox",
  useSearchParams: () => new URLSearchParams(query),
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session: { webId } }),
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({
    children,
    details,
    onDetailsClose,
  }: {
    children: ReactNode;
    details: ReactNode;
    onDetailsClose?: () => void;
  }) => {
    dismissDetails = onDetailsClose;
    return h("main", null, children, details);
  },
}));
vi.mock("../../src/apps/tasks/components/sidebar", () => ({ TasksSidebar: () => null }));
vi.mock("../../src/apps/tasks/components/sort-menu", () => ({ SortMenu: () => null }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({
  TasksProvider: ({ children }: { children: ReactNode }) => children,
  useTasks: () => ({
    ...useSyncExternalStore(cache.subscribe, cache.getSnapshot),
    cache,
    webId,
    storageUrl: storage,
    inboxUrl: cache.inboxUrl,
    createTask: cache.createTask.bind(cache),
    updateTask: cache.updateTask.bind(cache),
    updateProject: cache.updateProject.bind(cache),
  }),
}));

import { TaskDetail } from "../../src/apps/tasks/components/detail/task-detail";
import { TaskRow } from "../../src/apps/tasks/components/task-row";
import { TasksApp } from "../../src/apps/tasks/components/tasks-app";

beforeEach(() => {
  query = "";
  dismissDetails = undefined;
  for (const name of [
    "HTMLFormElement",
    "HTMLTextAreaElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "DocumentFragment",
  ] as const)
    vi.stubGlobal(name, window[name]);
});
afterEach(() => vi.restoreAllMocks());

function DetailAndRow({ url }: { url: string }) {
  const snapshot = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const view = snapshot.views.find((task) => task.url === url);
  const project = snapshot.projects.find((project) => project.url === view?.projectUrl);
  const stored = project && snapshot.tasks[project.url]?.items.find((task) => task.url === url);
  if (!view || !stored || !project) return null;
  return h(
    "main",
    null,
    h(
      "table",
      null,
      h(
        "tbody",
        null,
        h(TaskRow, {
          row: { task: view, depth: 0 },
          tabIndex: 0,
          onFocus: vi.fn(),
          onMove: vi.fn(),
        }),
      ),
    ),
    h(TaskDetail, { stored, project, onClose: vi.fn() }),
  );
}
function button(name: string) {
  const element = [...document.querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === name,
  );
  if (!element) throw new Error(`Missing ${name}`);
  return element;
}
function field() {
  const label = [...document.querySelectorAll("label")].find(
    (label) => label.textContent === "Attachment link",
  );
  const input = label && document.getElementById(label.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing Attachment link");
  return input;
}
async function type(value: string) {
  await act(() => {
    const input = field();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await key(field(), "Enter");
  // jsdom does not perform the browser's implicit Enter submission.
  await act(() =>
    field().form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
const settle = () => act(() => vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([])));
async function setup(attachments: string[] = []) {
  const result = await frameCache();
  cache = result.cache;
  const item = await cache.createTask(result.inbox, { title: "Read brief", attachments });
  if (!item) throw new Error("Missing task");
  const mounted = await mount(h(DetailAndRow, { url: item.url }));
  return { ...result, ...mounted, item };
}

describe("attachment detail and row", () => {
  it("renders decoded names, full URLs, safe new-tab links and a paperclip count", async () => {
    const podLink = `${storage}drive/Project%20brief.pdf`;
    const external = "https://example.org/%E2%9C%93.txt?download=1#part";
    const { host } = await setup([podLink, external]);
    const section = host.querySelector(".tsk-attachments");
    expect(section?.querySelector("h3")?.textContent).toBe("Attachments");
    const links = [...(section?.querySelectorAll("a") ?? [])];
    expect(links.map((link) => link.textContent)).toEqual(["Project brief.pdf", "✓.txt"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/drive/p/${encodeRef(podLink)}`,
      external,
    ]);
    for (const [index, url] of [podLink, external].entries()) {
      expect(links[index]?.title).toBe(url);
      expect(links[index]?.getAttribute("aria-label")).toContain(url);
      expect(links[index]?.target).toBe("_blank");
      expect(links[index]?.rel).toBe("noopener noreferrer");
    }
    expect(button("Remove attachment Project brief.pdf")).toBeDefined();
    const count = host.querySelector('[role="img"][aria-label="2 attachments"]');
    expect(count?.querySelector("svg")).not.toBeNull();
    expect(count?.textContent).toBe("2");
    expect(host.textContent).not.toContain("Choose from Drive");
    await act(() => links[0]?.focus());
    expect(document.activeElement).toBe(links[0]);
    await key(links[0] as Element, "Enter");
  });

  it("focuses the native URL form, adds on Enter and removes with a keyboard-reachable button", async () => {
    const { host, store, item } = await setup();
    expect(host.querySelector(".tsk-attachment-count")).toBeNull();
    const add = button("Add attachment");
    await act(() => add.focus());
    await key(add, "Enter");
    // Native button activation is a browser default, simulated explicitly in jsdom.
    await click(add);
    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    await type("  https://example.org/Project%20brief.pdf  ");
    await submit();
    await settle();
    expect((await store.readTask(item.url)).task.attachments).toEqual([
      "https://example.org/Project%20brief.pdf",
    ]);
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Add attachment")));
    expect(host.querySelector('[aria-label="1 attachments"]')).not.toBeNull();
    const remove = button("Remove attachment Project brief.pdf");
    await act(() => remove.focus());
    await key(remove, " ");
    await click(remove);
    await settle();
    expect((await store.readTask(item.url)).task.attachments).toEqual([]);
    expect(host.querySelector(".tsk-attachment-count")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Add attachment")));
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,hello",
    "relative/path",
  ])("rejects %s without issuing a write", async (url) => {
    const { pod } = await setup();
    await click(button("Add attachment"));
    const before = pod.mutations().length;
    await type(url);
    await submit();
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter an http or https link.",
    );
    expect(pod.mutations()).toHaveLength(before);
    await type("https://example.org/valid");
    expect(field().getAttribute("aria-invalid")).toBe("false");
  });

  it("cancels the URL form with Escape and returns focus without closing details", async () => {
    const { host, pod } = await setup();
    await click(button("Add attachment"));
    await type("https://example.org/draft");
    const before = pod.mutations().length;
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    try {
      await key(field(), "Escape");
    } finally {
      window.removeEventListener("keydown", bubbled);
    }
    expect(bubbled).not.toHaveBeenCalled();
    expect(host.querySelector(".tsk-attachments form")).toBeNull();
    expect(host.querySelector(".tsk-detail")).not.toBeNull();
    expect(pod.mutations()).toHaveLength(before);
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Add attachment")));
  });

  it("keeps details open when the Sheet handles Escape before the URL form", async () => {
    const { item, unmount } = await setup();
    await unmount();
    query = `task=${encodeRef(item.url)}`;
    const replace = vi.spyOn(window.history, "replaceState").mockImplementation(() => undefined);
    await mount(h(TasksApp, null, "List"));
    await click(button("Add attachment"));
    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    const capture = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissDetails?.();
    };
    document.addEventListener("keydown", capture, true);
    try {
      await key(field(), "Escape");
    } finally {
      document.removeEventListener("keydown", capture, true);
    }
    expect(replace).not.toHaveBeenCalled();
    expect(document.querySelector(".tsk-attachments form")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Add attachment")));
  });

  it("keeps a failed draft and rolls the row count back, then retries against refreshed links", async () => {
    const { host, item, store, failures, pod } = await setup();
    const remote = await store.updateTask(item, (task) => {
      task.attachments = ["https://example.org/remote"];
    });
    await click(button("Add attachment"));
    await type("https://example.org/local");
    await submit();
    await settle();
    expect(failures).toHaveBeenCalledOnce();
    expect(field().value).toBe("https://example.org/local");
    expect(host.querySelector('[aria-label="1 attachments"]')).not.toBeNull();
    expect(host.querySelector(".tsk-attachments a")?.textContent).toBe("remote");
    const retry = failures.mock.calls[0]?.[1] as () => void;
    await act(() => retry());
    await settle();
    expect((await store.readTask(item.url)).task.attachments).toEqual([
      "https://example.org/remote",
      "https://example.org/local",
    ]);
    const last = pod.mutations().at(-1);
    expect(last?.headers.get("If-Match")).toBe(remote.etag);
    expect(host.querySelector('[aria-label="2 attachments"]')).not.toBeNull();
  });

  it("retains a newer URL draft while a submitted attachment finishes saving", async () => {
    const { item, pod } = await setup();
    const gate = deferred<Response | undefined>();
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === item.url ? gate.promise : undefined;
    await click(button("Add attachment"));
    await type("https://example.org/first");
    await submit();
    await type("https://example.org/newer-draft");
    await act(() => gate.resolve(undefined));
    await settle();
    expect(field().value).toBe("https://example.org/newer-draft");
    await click(button("Cancel"));
    expect(document.querySelector(".tsk-attachments form")).toBeNull();
  });
});
