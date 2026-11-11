// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the @jeswr/app-shell `AccountControl` adoption in pod-money's
// header (cross-app parity with pod-drive — bead suite-tracker-lpo).
//
// The rule under test: when the @jeswr Solid browser extension is present it owns
// the account surface (its pinned avatar menu shows identity + sign-out), so the
// app's full <AccountMenu/> would DUPLICATE it and is hidden — but the app still
// holds its OWN independent SessionProvider session, so a MINIMAL "Sign out" control
// (calling this app's own logout) must remain. When the extension is ABSENT, the
// normal <AccountMenu/> renders.
//
// We drive the branch at the `LoggedIn` seam (the sub-component that owns the header
// + AccountControl render and takes `onLogout`), setting the extension's DOM
// presence marker. The pod-money data modules are stubbed so `useLedgerUrl`'s
// discovery does no network — the header (the surface under test) renders
// synchronously regardless of ledger resolution.
//
// AccountControl and AccountMenu are the real app-shell components: the menu's
// trigger carries `aria-label="Account menu"`, and its "Sign out" item lives inside
// a CLOSED Radix dropdown (not in the DOM until opened) — so a top-level `Sign out`
// button unambiguously distinguishes the extension-present minimal control from the
// AccountMenu's hidden menu item.
import { ThemeProvider } from "@jeswr/app-shell";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the pod-money data layer so `useLedgerUrl`'s discovery never touches the
// network (the header renders regardless of ledger state).
vi.mock("@jeswr/pod-money", () => {
  class MoneyStore {
    static primaryClass = "https://example/#Transaction";
    ledgerUrl: string;
    constructor({ podRoot }: { podRoot: string }) {
      this.ledgerUrl = `${podRoot}finance/ledger.ttl`;
    }
    async discover() {
      return [] as { instance?: string; container?: string }[];
    }
  }
  return { MoneyStore };
});

vi.mock("@jeswr/pod-money/ui", () => ({
  AccountsView: () => <div data-testid="accounts-view" />,
}));

import { LoggedIn } from "./App";

const props = {
  fetch: vi.fn<typeof fetch>(),
  podRoot: "https://alice.example/",
  podRootIsFallback: false,
  webId: "https://alice.example/profile/card#me",
  displayName: "Alice",
  avatarUrl: undefined,
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
});

// The header renders <ThemeToggle/>, which reads the theme context — main.tsx wraps
// the app in <ThemeProvider>, so mirror that here.
function renderInShell(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("header account surface vs the Solid extension (pod-money adoption)", () => {
  it("extension PRESENT → hide AccountMenu, keep a minimal Sign out that calls logout", async () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    const onLogout = vi.fn();
    renderInShell(<LoggedIn {...props} onLogout={onLogout} />);
    await screen.findByTestId("accounts-view");

    // The AccountMenu (its trigger carries aria-label="Account menu") is gone.
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();

    // A minimal top-level "Sign out" control is present and wired to this app's logout.
    const signOut = screen.getByRole("button", { name: /^sign out$/i });
    expect(signOut).toBeInTheDocument();
    fireEvent.click(signOut);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("extension ABSENT → render the normal AccountMenu, no bare Sign out button", async () => {
    renderInShell(<LoggedIn {...props} onLogout={vi.fn()} />);
    await screen.findByTestId("accounts-view");

    // The real AccountMenu trigger renders.
    expect(screen.getByRole("button", { name: /account menu/i })).toBeInTheDocument();

    // Its "Sign out" item lives in a CLOSED dropdown, so no top-level Sign out button
    // exists — confirming we did not fall through to the minimal control.
    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });
});
