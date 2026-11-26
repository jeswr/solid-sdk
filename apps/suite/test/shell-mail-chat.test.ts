// AUTHORED-BY Codex GPT-6.1-Sol
// Initialize the DOM before Radix decides whether portals can mount.
import "./drive-ui-dom";

import { defaultShellPreferences, ShellFrame, type ShellPreferences } from "@jeswr/suite-ui/shell";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatApp, ChatLanding } from "../src/apps/chat/components/chat-app";
import { RoomView } from "../src/apps/chat/components/room";
import { ChatSearchPage } from "../src/apps/chat/components/search";
import { ChatClient } from "../src/apps/chat/lib/client";
import { useChat } from "../src/apps/chat/state/chat-context";
import { MailApp } from "../src/apps/mail/components/mail-app";
import { FolderPage } from "../src/apps/mail/components/views";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { AppFrame, AppHeading } from "../src/shell/app-frame";
import { AppSession } from "../src/shell/app-session";
import { isShortcutLayerTarget } from "../src/shell/lib/shortcuts";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import { GlobalShortcuts } from "../src/shell/shortcuts/global-shortcuts";
import {
  type RegisteredShortcut,
  ShortcutsProvider,
  useRegisteredShortcuts,
} from "../src/shell/shortcuts/provider";
import type { SuiteShellProps } from "../src/shell/suite-shell";
import { act, click, h, key, mount } from "./drive-ui-dom";
import { shellTestAccounts } from "./shell-test-accounts";

const mocks = vi.hoisted(() => ({
  session: undefined as PodSession | undefined,
  podProvider: vi.fn(),
  podStatus: "ready" as "ready" | "loading" | "signed-out" | "error",
  mode: "demo" as "demo" | "extension",
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));
vi.mock("../src/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: ReactNode }) => {
    mocks.podProvider();
    return children;
  },
  usePodSessionState: () => ({ status: mocks.podStatus, session: mocks.session, mode: mocks.mode }),
}));
vi.mock("../src/shell/app-frame-loaders", () => ({
  loadShell: async () => ({ SuiteShell: TestShell }),
  loadGuard: async () => ({ SessionGuard: () => h("p", null, "Sign in required") }),
}));

let registered: readonly RegisteredShortcut[] = [];
function ShortcutProbe() {
  registered = useRegisteredShortcuts();
  return null;
}
/** Keep the actual pane and shortcut implementations; omit unrelated account services. */
function TestShell({
  pageTitle,
  sidebar,
  details,
  context,
  actions,
  search,
  children,
}: SuiteShellProps) {
  const [preferences, setPreferences] = useState<ShellPreferences>(defaultShellPreferences);
  return h(
    ShortcutsProvider,
    null,
    h(GlobalShortcuts),
    h(ShortcutProbe),
    h(ShellFrame, {
      pageTitle,
      sidebar: sidebar ?? { label: "Navigation", sections: [] },
      ...(details ? { details } : {}),
      topBar: {
        appName: pageTitle,
        context,
        actions,
        search: search ?? h("input", { "aria-label": "Global search", "data-global-search": "" }),
      },
      rail: null,
      tabBar: null,
      preferences,
      onPreferencesChange: setPreferences,
      children,
    }),
  );
}
const ROOT = "https://alice.example/";
const ME = `${ROOT}profile#me`;
const shell = (children: ReactNode, status?: AccountsContextValue["status"]) =>
  h(AccountsContext, { value: shellTestAccounts(status) }, children);
function setup() {
  const pod = createDemoPod({ root: ROOT });
  mocks.session = {
    mode: "demo",
    fetch: pod.fetch,
    storageUrl: ROOT,
    webId: ME,
    displayName: "Alice",
    reset: async () => {},
    subscribe: pod.subscribe,
  };
  return new ChatClient(pod.fetch, ROOT, ME);
}
beforeEach(() => {
  mocks.podStatus = "ready";
  mocks.mode = "demo";
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
    matches: media === "(min-width: 1024px)",
    media,
    addEventListener() {},
    removeEventListener() {},
    onchange: null,
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
});
// jsdom has no layout; model visible search fields while retaining hidden ancestors.
beforeEach(() => {
  vi.spyOn(HTMLInputElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    return (this.closest("[hidden]") ? [] : [new DOMRect(0, 0, 200, 32)]) as unknown as DOMRectList;
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([
  "home",
  "drive",
  "mail",
  "chat",
] as const)("gives %s one shell h1 and preserves its sidebar landmark", async (app) => {
  const title = app[0]?.toUpperCase() + app.slice(1);
  const view = await mount(
    shell(
      h(AppFrame, {
        app,
        sidebar: h("nav", { "aria-label": "App sections" }, "Sections"),
        children: h(AppHeading, null, "Page content"),
      }),
    ),
  );
  expect([...view.host.querySelectorAll("h1")].map((heading) => heading.textContent)).toEqual([
    title,
  ]);
  expect(view.host.querySelector("main h2")?.textContent).toBe("Page content");
  expect(
    view.host.querySelector(`nav[aria-label="${title} navigation"] nav[aria-label="App sections"]`),
  ).not.toBeNull();
});

it("retains the standalone frame and h1", async () => {
  const view = await mount(
    h(AppFrame, { app: "chat", sidebar: null, children: h(AppHeading, null, "Chat") }),
  );
  expect(view.host.querySelector(".ish-frame")).not.toBeNull();
  expect(view.host.querySelector(".suite-shell")).toBeNull();
  expect(view.host.querySelector("main h1")?.textContent).toBe("Chat");
});

it.each([
  "home",
  "drive",
] as const)("keeps %s details open and calls its existing close callback", async (app) => {
  const close = vi.fn();
  const view = await mount(
    shell(
      h(AppFrame, {
        app,
        sidebar: null,
        details: h("p", null, "Metadata"),
        onDetailsClose: close,
        children: null,
      }),
    ),
  );
  expect(view.host.querySelector(".suite-shell")?.getAttribute("data-details-open")).toBe("true");
  await key(view.host.querySelector("main") as Element, "]");
  expect(close).toHaveBeenCalledOnce();
  // These apps own whether details content is supplied, as before.
  expect(view.host.querySelector(".suite-shell")?.getAttribute("data-details-open")).toBe("true");
  await click(view.host.querySelector('[data-slot="details-pane-close"]') as Element);
  expect(close).toHaveBeenCalledTimes(2);
});

it("closes and reopens controlled details through the shell key and controls", async () => {
  const change = vi.fn();
  const legacyClose = vi.fn();
  function Controlled() {
    const [open, setOpen] = useState(false);
    return h(AppFrame, {
      app: "chat",
      sidebar: null,
      children: null,
      details: h("p", null, "Metadata"),
      detailsOpen: open,
      onDetailsOpenChange: (next) => {
        change(next);
        setOpen(next);
      },
      onDetailsClose: legacyClose,
    });
  }
  const view = await mount(shell(h(Controlled)));
  const main = view.host.querySelector("main") as HTMLElement;
  const frame = view.host.querySelector(".suite-shell");
  expect(frame?.getAttribute("data-details-open")).toBe("false");
  await key(main, "]");
  expect(frame?.getAttribute("data-details-open")).toBe("true");
  await click(view.host.querySelector('[data-slot="details-pane-close"]') as Element);
  expect(frame?.getAttribute("data-details-open")).toBe("false");
  await key(main, "]");
  expect(frame?.getAttribute("data-details-open")).toBe("true");
  await key(main, "]");
  await click(view.host.querySelector('[aria-label="Toggle details pane"]') as Element);
  expect(frame?.getAttribute("data-details-open")).toBe("true");
  expect(change.mock.calls.map(([open]) => open)).toEqual([true, false, true, false, true]);
  expect(legacyClose).not.toHaveBeenCalled();
});

it.each([
  MailApp,
  ChatApp,
])("guards pod providers while the shell session is signed out or restoring (%s)", async (App) => {
  for (const status of ["signed-out", "loading"] as const) {
    const view = await mount(shell(h(App, { children: null }), status));
    expect(view.host.textContent).toBe("Sign in required");
    expect(mocks.podProvider).not.toHaveBeenCalled();
    await view.unmount();
  }
});

it("keeps Mail's search and saving status with h2 folder content", async () => {
  setup();
  const view = await mount(shell(h(MailApp, { children: h(FolderPage, { folderKey: "inbox" }) })));
  expect(view.host.querySelector("main h1")?.textContent).toBe("Mail");
  expect(view.host.querySelector("main h2")?.textContent).toBe("Inbox");
  expect(
    view.host.querySelector('nav[aria-label="Mail navigation"] nav[aria-label="Mail"]'),
  ).not.toBeNull();
  expect(view.host.querySelector('input[placeholder="Search mail"]')).not.toBeNull();
  expect(view.host.querySelector('[aria-label="Mail save status"]')?.textContent).toBe("");
});

it("registers Chat search above global search and lets the shell toggle details exactly once", async () => {
  const client = setup();
  const room = await client.createRoom({ name: "Shell room", members: [] });
  const view = await mount(shell(h(ChatApp, { children: h(RoomView, { url: room.url }) })));
  const main = view.host.querySelector("main") as HTMLElement;
  const frame = view.host.querySelector(".suite-shell");
  expect(main.querySelector("h1")?.textContent).toBe("Chat");
  expect(main.querySelector(".chat-room-heading h2")?.textContent).toBe("Shell room");
  expect(view.host.querySelector(".chat-app-title")).toBeNull();
  expect(registered.find((shortcut) => shortcut.id === "chat.search")).toMatchObject({
    keys: "/",
    scope: "app",
    group: "Chat",
    label: "Focus chat search",
  });
  await act(() => main.focus());
  await key(main, "/");
  expect(document.activeElement).toBe(view.host.querySelector('[data-chat-search="sidebar"]'));
  await act(() => main.focus());
  await key(main, "]");
  expect(frame?.getAttribute("data-details-open")).toBe("true");
  expect(view.host.querySelectorAll('[aria-label="Close details"]')).toHaveLength(1);
  await click(view.host.querySelector('[aria-label="Close details"]') as Element);
  expect(frame?.getAttribute("data-details-open")).toBe("false");
  await key(main, "]");
  expect(frame?.getAttribute("data-details-open")).toBe("true");
  await key(main, "]");
  expect(frame?.getAttribute("data-details-open")).toBe("false");
  // Chat unregisters on leaving the app, so global search owns slash again.
  await view.render(shell(h(AppFrame, { app: "home", sidebar: null, children: null })));
  const home = view.host.querySelector("main") as HTMLElement;
  await act(() => home.focus());
  await key(home, "/");
  expect(document.activeElement).toBe(view.host.querySelector("[data-global-search]"));
});

it("prefers Chat's page field and excludes dialogs, menus, listboxes and editable content in the shell", async () => {
  setup();
  const view = await mount(shell(h(ChatApp, { children: h(ChatSearchPage, { query: "" }) })));
  const main = view.host.querySelector("main") as HTMLElement;
  await act(() => main.focus());
  await key(main, "/");
  expect(document.activeElement).toBe(main.querySelector('[data-chat-search="page"]'));
  for (const role of ["dialog", "alertdialog", "menu", "listbox", "textbox", "combobox"]) {
    const layer = document.createElement("div");
    layer.setAttribute("role", role);
    layer.tabIndex = 0;
    main.append(layer);
    await act(() => layer.focus());
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    await act(() => layer.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(layer);
    layer.remove();
  }
});

it("uses Chat's drawer search ahead of the page field, and navigates to search on narrow screens", async () => {
  setup();
  vi.mocked(window.matchMedia).mockImplementation((media) => ({
    matches: media === "(max-width: 1023px)",
    media,
    addEventListener() {},
    removeEventListener() {},
    onchange: null,
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const view = await mount(shell(h(ChatApp, { children: h(ChatLanding) })));
  const main = view.host.querySelector("main") as HTMLElement;
  await act(() => main.focus());
  await key(main, "/");
  expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/chat/search");
  await view.render(shell(h(ChatApp, { children: h(ChatSearchPage, { query: "" }) })));
  await click(view.host.querySelector('[aria-label="Toggle sidebar"]') as Element);
  const drawer = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(drawer.textContent).toContain("Chat navigation");
  const close = drawer.querySelector('[aria-label="Close chat navigation"]') as HTMLElement;
  await act(() => close.focus());
  await key(close, "/");
  expect(document.activeElement).toBe(drawer.querySelector("[data-chat-search]"));
  await key(close, "Escape");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("navigates slash to Chat search when the desktop sidebar is collapsed", async () => {
  setup();
  const view = await mount(shell(h(ChatApp, { children: h(ChatLanding) })));
  const main = view.host.querySelector("main") as HTMLElement;
  await key(main, "[");
  expect(view.host.querySelector(".suite-sidebar-slot")?.hasAttribute("hidden")).toBe(true);
  await act(() => main.focus());
  await key(main, "/");
  expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/chat/search");
  expect(document.activeElement).toBe(main);
});

it("does not read Chat details while closed, including after invalidation, and uses one toggle", async () => {
  const client = setup();
  const room = await client.createRoom({ name: "Lazy details", members: [] });
  const files = vi.spyOn(ChatClient.prototype, "files");
  const readRoom = vi.spyOn(ChatClient.prototype, "room");
  function Invalidate() {
    const { invalidate } = useChat();
    return h("button", { onClick: invalidate }, "Invalidate");
  }
  const view = await mount(
    shell(h(ChatApp, { children: h("div", null, h(RoomView, { url: room.url }), h(Invalidate)) })),
  );
  const reads = readRoom.mock.calls.length;
  expect(files).not.toHaveBeenCalled();
  expect(view.host.querySelector(".chat-details")).toBeNull();
  expect(view.host.querySelector('[aria-label="Show details"]')).toBeNull();
  const toggle = view.host.querySelector('[aria-label="Toggle details pane"]') as HTMLElement;
  await click(toggle);
  expect(files).toHaveBeenCalledExactlyOnceWith(room.url);
  expect(readRoom.mock.calls.length).toBe(reads + 1);
  expect(
    [...view.host.querySelectorAll("h2")].filter((el) => el.textContent === "Conversation details"),
  ).toHaveLength(1);
  await click(view.host.querySelector('[aria-label="Close details"]') as Element);
  expect(document.activeElement).toBe(toggle);
  expect(view.host.querySelector(".chat-details")).toBeNull();
  files.mockClear();
  await click(
    [...view.host.querySelectorAll("button")].find(
      (el) => el.textContent === "Invalidate",
    ) as Element,
  );
  expect(files).not.toHaveBeenCalled();
});

it("does not repeat Chat's app heading on the empty shell page", async () => {
  setup();
  const view = await mount(shell(h(ChatApp, { children: h(ChatLanding) })));
  expect([...view.host.querySelectorAll("main h1, main h2")].map((el) => el.textContent)).toEqual([
    "Chat",
    "Conversations",
  ]);
});

it.each([MailApp, ChatApp])("gives session states outside AppFrame an h1 (%s)", async (App) => {
  for (const wrapped of [false, true]) {
    for (const status of ["signed-out", "error"] as const) {
      mocks.podStatus = status;
      const content = h(App, { children: null });
      const view = await mount(wrapped ? shell(content) : content);
      expect(view.host.querySelectorAll("h1")).toHaveLength(1);
      expect(view.host.querySelector("h2")).toBeNull();
      expect(view.host.querySelector(".suite-shell")).toBeNull();
      if (status === "error") {
        expect(view.host.textContent).toContain("demo pod's storage");
        expect(view.host.querySelector("button")?.textContent).toBe("Retry");
      }
      await view.unmount();
    }
  }
});

it("shares layer exclusions between app and global shortcuts, with navigation drawer opt-in", () => {
  expect(isShortcutLayerTarget(null)).toBe(false);
  expect(isShortcutLayerTarget(new EventTarget())).toBe(false);
  const dialog = document.createElement("dialog");
  const button = document.createElement("button");
  const nav = document.createElement("nav");
  dialog.append(button, nav);
  expect(isShortcutLayerTarget(button)).toBe(true);
  expect(isShortcutLayerTarget(button, "nav")).toBe(false);
  expect(isShortcutLayerTarget(button, "form")).toBe(true);
});

it("preserves the shared boundary's loading and error copy, and resets providers only on session identity changes", async () => {
  setup();
  mocks.podStatus = "loading";
  const sessionTree = () =>
    h(AppSession, {
      name: "Mail",
      className: "mail-boot",
      retry: true,
      children: () => h(Stateful),
    });
  function Stateful() {
    const [count, setCount] = useState(0);
    return h("button", { onClick: () => setCount(count + 1) }, String(count));
  }
  const view = await mount(sessionTree());
  expect(view.host.querySelector('[role="status"]')?.textContent).toBe("Opening your Mail…");
  mocks.podStatus = "error";
  mocks.mode = "extension";
  await view.render(sessionTree());
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("Solid extension");
  const reload = vi.fn();
  const previousLocation = globalThis.location;
  vi.stubGlobal("location", { reload });
  await click(view.host.querySelector("button") as Element);
  expect(reload).toHaveBeenCalledOnce();
  vi.stubGlobal("location", previousLocation);
  mocks.podStatus = "ready";
  await view.render(sessionTree());
  await click(view.host.querySelector("button") as Element);
  await view.render(sessionTree());
  expect(view.host.querySelector("button")?.textContent).toBe("1");
  if (!mocks.session) throw new Error("Expected session fixture");
  mocks.session = { ...mocks.session, webId: "https://bob.example/#me" };
  await view.render(sessionTree());
  expect(view.host.querySelector("button")?.textContent).toBe("0");
});

it("returns focus to Chat's sole details toggle after closing the narrow sheet", async () => {
  const client = setup();
  const room = await client.createRoom({ name: "Narrow details", members: [] });
  vi.mocked(window.matchMedia).mockImplementation((media) => ({
    matches: media === "(max-width: 1023px)",
    media,
    addEventListener() {},
    removeEventListener() {},
    onchange: null,
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }));
  const view = await mount(shell(h(ChatApp, { children: h(RoomView, { url: room.url }) })));
  const toggle = view.host.querySelector('[aria-label="Toggle details pane"]') as HTMLElement;
  expect(view.host.querySelector('[aria-label="Show details"]')).toBeNull();
  await act(() => toggle.focus());
  await click(toggle);
  expect(document.querySelector('[role="dialog"] .chat-details')).not.toBeNull();
  await click(document.querySelector('[aria-label="Close details"]') as Element);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  // Radix restores focus on a later macrotask, which act() does not wait for.
  await vi.waitFor(() => expect(document.activeElement).toBe(toggle));
});
