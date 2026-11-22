// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "../../../../packages/suite-ui/node_modules/@testing-library/react";
import type { PodSession } from "../../src/lib/session/pod-session";
import type { SessionResult } from "../../src/lib/session/types";

const state = vi.hoisted(() => ({ current: { status: "loading" } as SessionResult }));
vi.mock("@/lib/session/pod-session", () => ({ usePodSessionState: () => state.current }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/bookmarks",
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../src/shell/session/accounts-provider", async () => ({
  useAccounts: (await import("../../src/shell/session/accounts-context")).useAccounts,
}));
vi.mock("../../src/shell/notifications/notifications-bell", () => ({
  NotificationsBell: () => null,
}));
vi.mock("../../src/shell/search/search-context", () => ({
  useShellSearchSource: () => ({}),
}));

import { AppFrame, PodSessionGate } from "../../src/shell/app-frame";
import { preloadAppFrame } from "../../src/shell/app-frame-loaders";
import { AccountsContext } from "../../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../../src/shell/session/accounts-provider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("carries the missing sidebar from the app frame through the narrow web shell", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  await preloadAppFrame();
  const accounts = { status: "ready", active: null } as AccountsContextValue;
  render(
    <AccountsContext value={accounts}>
      <AppFrame app="bookmarks" sidebar={null}>
        <p>Placeholder content</p>
      </AppFrame>
    </AccountsContext>,
  );
  expect(await screen.findByRole("heading", { name: "Bookmarks" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Toggle sidebar", hidden: true })).toBeNull();
  expect(fireEvent.keyDown(document, { key: "[" })).toBe(true);
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
});

describe("PodSessionGate", () => {
  it("renders only the active state and passes the error or ready session through", () => {
    const ready = vi.fn((session: PodSession) => <p>{session.displayName}</p>);
    const error = vi.fn((cause: unknown) => <p>{String(cause)}</p>);
    const view = () => (
      <PodSessionGate loading={<p>Opening pod</p>} signedOut={<p>Sign in</p>} error={error}>
        {ready}
      </PodSessionGate>
    );
    const { rerender } = render(view());
    expect(screen.getByText("Opening pod")).toBeTruthy();
    expect(ready).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    state.current = { status: "signed-out" };
    rerender(view());
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByText("Opening pod")).toBeNull();
    const cause = new Error("Cannot open pod");
    state.current = { status: "error", mode: "solid", error: cause };
    rerender(view());
    expect(error).toHaveBeenCalledWith(cause);
    expect(screen.getByText("Error: Cannot open pod")).toBeTruthy();
    const session = { displayName: "Fictional account" } as PodSession;
    state.current = { status: "ready", session };
    rerender(view());
    expect(ready).toHaveBeenCalledWith(session);
    expect(screen.getByText("Fictional account")).toBeTruthy();
    expect(screen.queryByText("Sign in")).toBeNull();
  });
});
