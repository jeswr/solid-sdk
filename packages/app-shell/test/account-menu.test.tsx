// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// AccountMenu — initials, the WebID/name display, conditional nav items, and the
// sign-out callback. The Radix dropdown opens on a pointer sequence, so we drive
// it with @testing-library/user-event (jsdom's plain `click` does not trip it).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu, initials } from "../src/components/account-menu.js";

// Radix guards interactions behind a pointer-events check that jsdom layout
// cannot satisfy; disable it so the menu opens under test.
const user = userEvent.setup({ pointerEventsCheck: 0 });

async function openMenu() {
  await user.click(screen.getByRole("button", { name: "Account menu" }));
}

describe("initials", () => {
  it("derives two-letter initials from a full name", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });
  it("uppercases the first two letters of a single-word name", () => {
    expect(initials("ada")).toBe("AD");
  });
  it("uses the first and last of a 3-part name", () => {
    expect(initials("Ada B Lovelace")).toBe("AL");
  });
  it("falls back to ? for an empty name", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("AccountMenu", () => {
  it("shows the display name on the trigger when present", () => {
    render(
      <AccountMenu
        displayName="Ada Lovelace"
        webId="https://ada.example/me"
        onSignOut={() => {}}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("falls back to 'Signed in' on the trigger when there is no display name", () => {
    render(<AccountMenu webId="https://ada.example/me" onSignOut={() => {}} />);
    expect(screen.getByText("Signed in")).toBeInTheDocument();
  });

  it("opens the menu and shows the WebID + Sign out, firing onSignOut", async () => {
    const onSignOut = vi.fn();
    render(
      <AccountMenu
        displayName="Ada Lovelace"
        webId="https://ada.example/me"
        onSignOut={onSignOut}
      />,
    );
    await openMenu();
    expect(await screen.findByText("https://ada.example/me")).toBeInTheDocument();
    await user.click(screen.getByText("Sign out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("renders Profile + Settings items only when their callbacks are provided", async () => {
    const onProfile = vi.fn();
    const onSettings = vi.fn();
    render(
      <AccountMenu
        displayName="Ada"
        webId="https://ada.example/me"
        onSignOut={() => {}}
        onProfile={onProfile}
        onSettings={onSettings}
      />,
    );
    await openMenu();
    await user.click(await screen.findByText("Profile"));
    expect(onProfile).toHaveBeenCalledTimes(1);
    await openMenu();
    await user.click(await screen.findByText("Settings"));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("omits Profile/Settings when no callbacks are given", async () => {
    render(<AccountMenu displayName="Ada" webId="https://ada.example/me" onSignOut={() => {}} />);
    await openMenu();
    // The menu is open (Sign out present) but Profile/Settings are not.
    expect(await screen.findByText("Sign out")).toBeInTheDocument();
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows the initials fallback when no avatar image is supplied", () => {
    render(
      <AccountMenu
        displayName="Ada Lovelace"
        webId="https://ada.example/me"
        onSignOut={() => {}}
      />,
    );
    // Radix Avatar shows the fallback (initials) until/unless an image loads.
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
