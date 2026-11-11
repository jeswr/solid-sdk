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
import { MailApp } from "../src/apps/mail/components/mail-app";
import { FolderPage } from "../src/apps/mail/components/views";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { AppFrame, AppHeading } from "../src/shell/app-frame";
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
  usePodSessionState: () => ({ status: "ready", session: mocks.session }),
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
  for (const role of ["dialog", "alertdialog", "menu", "listbox", "textbox"]) {
    const layer = document.createElement("div");
    layer.setAttribute("role", role);
    layer.tabIndex = 0;
    main.append(layer);
    await act(() => layer.focus());
    await key(layer, "/");
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
  await click(drawer.querySelector('a[href="/chat/new"]') as Element);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
