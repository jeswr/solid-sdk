// AUTHORED-BY Codex GPT-6.1-Sol
import "./drive-ui-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountsContext } from "../src/shell/session/accounts-context";
import { SuiteShell } from "../src/shell/suite-shell";
import { act, click, h, mount } from "./drive-ui-dom";
import { shellTestAccounts } from "./shell-test-accounts";

const route = vi.hoisted(() => ({ pathname: "/mail/inbox", desktop: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("../src/shell/session/session-guard", () => ({
  SessionGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../src/shell/environment", () => ({ useSuiteEnvironment: () => ({}) }));
vi.mock("../src/shell/account/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("../src/shell/notifications/notifications-bell", () => ({ NotificationsBell: () => null }));
vi.mock("../src/shell/search/search-context", () => ({ useShellSearchSource: () => undefined }));
vi.mock("../src/shell/search/global-search", () => ({ GlobalSearch: () => null }));
vi.mock("../src/shell/sync/offline-provider", () => ({ useRecentTitle: () => {} }));
vi.mock("../src/shell/sync/online", () => ({ useSyncSnapshot: () => ({}) }));
vi.mock("../src/shell/sync/shell-sync-sheet", () => ({ ShellSyncSheet: () => null }));
vi.mock("../src/welcome/walkthrough", () => ({ WalkthroughDock: () => null }));
vi.mock("@jeswr/suite-ui/sync", () => ({ OfflinePill: () => null }));

beforeEach(() => {
  localStorage.clear();
  route.pathname = "/mail/inbox";
  route.desktop = false;
  vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
    matches: media === "(min-width: 1024px)" && route.desktop,
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

function tree(
  app: "mail" | "chat" | "drive" = "mail",
  pageTitle = app === "mail" ? "Mail" : app === "chat" ? "Chat" : "Drive",
) {
  return h(
    AccountsContext,
    { value: shellTestAccounts() },
    h(SuiteShell, {
      app,
      pageTitle,
      sidebar: {
        label: "App navigation",
        sections: [],
        header: h("a", { href: "/mail/archive" }, "Archive"),
      },
      children: h("p", null, "Page content"),
    }),
  );
}

it.each([
  "mail",
  "chat",
  "drive",
] as const)("closes %s's narrow drawer on a route change once", async (app) => {
  const view = await mount(tree(app));
  const toggle = view.host.querySelector('[aria-label="Toggle sidebar"]') as HTMLElement;
  await click(toggle);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  route.pathname = "/mail/archive";
  await view.render(tree(app));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(() => toggle.focus());
  await click(toggle);
  // Re-rendering the same pathname must allow the drawer to remain open.
  await view.render(tree(app));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("keeps the desktop sidebar preference when navigating", async () => {
  route.desktop = true;
  const view = await mount(tree());
  expect(view.host.querySelector(".suite-sidebar-slot")?.hasAttribute("hidden")).toBe(false);
  route.pathname = "/mail/archive";
  await view.render(tree());
  expect(view.host.querySelector(".suite-sidebar-slot")?.hasAttribute("hidden")).toBe(false);
});

it.each([
  "mail",
  "chat",
] as const)("uses an unduplicated %s document title, with optional view context", async (app) => {
  const name = app === "mail" ? "Mail" : "Chat";
  const view = await mount(tree(app));
  expect(document.title).toBe(`${name} · Solid Suite`);
  await view.render(tree(app, "Search"));
  expect(document.title).toBe(`Search · ${name} · Solid Suite`);
});
