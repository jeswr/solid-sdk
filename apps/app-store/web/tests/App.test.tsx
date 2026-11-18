// AUTHORED-BY GPT-6.1 Sol
import type { Profile } from "@jeswr/app-session";
import { SessionProvider } from "@jeswr/app-session/react";
import {
  deferred,
  fakePodAuth,
  ISSUER,
  identity,
  POD_ROOT,
  WEB_ID,
} from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { APP_NAME, getPodAuth, LEGACY_CREDENTIALS } from "../src/auth/pod-auth";

vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

beforeEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv("VITE_HOME_IDP", ISSUER);
  vi.stubEnv("VITE_HOME_IDP_NAME", "Home provider");
  // jsdom has no native dialog lifecycle; preserve its observable open/close events.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const profile: Profile = {
  webId: WEB_ID,
  name: "Alice Store",
  storages: [POD_ROOT],
  oidcIssuers: [ISSUER],
};

function mount(fake = fakePodAuth(), readProfile = async () => profile) {
  render(
    <StrictMode>
      <ThemeProvider>
        <SessionProvider
          auth={fake.auth}
          getPodAuth={getPodAuth}
          appName={APP_NAME}
          dev={import.meta.env.DEV}
          legacyCredentials={LEGACY_CREDENTIALS}
          readProfile={readProfile}
        >
          <App />
        </SessionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  return fake;
}

async function openSignIn() {
  const trigger = await screen.findByRole("button", { name: "Sign in" });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  return screen.findByRole("dialog", { name: "Sign in to App Store" });
}

describe("public App Store with shared sign-in", () => {
  it("clears only the App Store's obsolete credentials once under StrictMode", async () => {
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase });
    localStorage.setItem("solid-app-store:remembered-account", "obsolete pointer");
    localStorage.setItem("app-store:app-shell-theme", "dark");
    localStorage.setItem("pod-docs:remembered-account", "another app");
    sessionStorage.setItem("app-store:pss.autologin.flow", "obsolete private flow");
    sessionStorage.setItem("app-store:autologin-attempted", WEB_ID);
    sessionStorage.setItem("pod-docs:autologin-attempted", WEB_ID);
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
    expect(deleteDatabase.mock.calls).toEqual([["solid-app-store:sessions"]]);
    expect(localStorage.getItem("solid-app-store:remembered-account")).toBeNull();
    expect(sessionStorage.getItem("app-store:pss.autologin.flow")).toBeNull();
    expect(sessionStorage.getItem("app-store:autologin-attempted")).toBeNull();
    expect(localStorage.getItem("app-store:app-shell-theme")).toBe("dark");
    expect(localStorage.getItem("pod-docs:remembered-account")).toBe("another app");
    expect(sessionStorage.getItem("pod-docs:autologin-attempted")).toBe(WEB_ID);
  });

  it("offers inbound account links in the modal without starting login", async () => {
    history.replaceState(null, "", `/#autologin/${encodeURIComponent(WEB_ID)}`);
    const fake = mount();
    await openSignIn();
    expect(location.hash).toBe("");
    expect(fake.auth.login).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Discover the Solid app suite" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /alice.example/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.auth.login).toHaveBeenCalledWith(
      { webId: WEB_ID },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps the catalog and plain launch links available while restore is pending", async () => {
    const fake = fakePodAuth();
    const restore = deferred<null>();
    fake.auth.restore.mockReturnValue(restore.promise);
    const ambient = globalThis.fetch;
    mount(fake);
    expect(screen.getByRole("heading", { name: "Discover the Solid app suite" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Open Pod Docs/ })).toHaveAttribute("href");
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your session…");
    await act(async () => restore.resolve(null));
    await openSignIn();
    expect(screen.getByRole("textbox", { name: "WebID" })).toBeVisible();
    expect(fake.auth.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(ambient);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the catalog available while loading the restored account's profile", async () => {
    const fake = fakePodAuth();
    const readProfile = deferred<Profile>();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake, () => readProfile.promise);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Loading your account…"),
    );
    expect(screen.getByRole("heading", { name: "Discover the Solid app suite" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => readProfile.resolve(profile));
    expect(await screen.findByRole("button", { name: "Account menu" })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    false,
    true,
  ])("signs in and out with WebID launch links (extension: %s)", async (extensionPresent) => {
    if (extensionPresent) document.documentElement.setAttribute("data-solid-extension", "1");
    const fake = mount();
    const modal = await openSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Home provider" }));
    await waitFor(() => expect(modal).not.toHaveAttribute("open"));
    expect(fake.auth.login).toHaveBeenCalledWith(
      { issuer: ISSUER },
      { signal: expect.any(AbortSignal) },
    );
    const launch = screen.getByRole("link", { name: /Launch Pod Docs/ });
    expect(launch.getAttribute("href")).toContain(`#autologin/${encodeURIComponent(WEB_ID)}`);
    expect(screen.getByRole("button", { name: /feedback/i })).toBeVisible();
    if (extensionPresent) {
      expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    } else {
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
      const account = screen.getByRole("button", { name: "Account menu" });
      fireEvent(account, new MouseEvent("pointerdown", { bubbles: true }));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Sign out/i }));
    }
    await waitFor(() => expect(fake.auth.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("link", { name: /Open Pod Docs/ })).not.toHaveAttribute(
      "href",
      expect.stringContaining("#autologin/"),
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(fake.auth.restore).toHaveBeenCalledTimes(1);
  });

  it("keeps the Linked Data route and filters available without signing in", async () => {
    mount();
    fireEvent.click(screen.getByRole("link", { name: "View the catalog as Linked Data" }));
    act(() => {
      history.replaceState(null, "", "/#/catalog");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "Solid App Store — catalog" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Turtle" })).toHaveAttribute("href");
    expect(screen.getByRole("link", { name: "JSON-LD" })).toHaveAttribute("href");
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });
});
