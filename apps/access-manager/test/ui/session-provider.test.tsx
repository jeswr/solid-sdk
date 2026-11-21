// AUTHORED-BY GPT-6.1 Sol
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { IssuerChoiceRequiredError, type Profile } from "@jeswr/app-session";
import {
  SessionProvider,
  type SessionProviderProps,
  useSession as useAuthSession,
} from "@jeswr/app-session/react";
import {
  deferred,
  fakePodAuth,
  ISSUER,
  identity,
  POD_ROOT,
  WEB_ID,
} from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import type { Identity } from "@jeswr/pod-auth";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DataFactory, Writer } from "n3";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME, legacyCredentials } from "../../src/auth/pod-auth.js";
import { type Session, usePublicFetch } from "../../src/auth/SessionContext.js";
import { resolveAgentDisplay } from "../../src/lib/profile.js";
import { App } from "../../src/ui/App.jsx";

const seams = vi.hoisted(() => {
  const publicFetch = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", publicFetch);
  return { publicFetch, browser: vi.fn() };
});
vi.mock("../../src/ui/useAccessData.js", () => ({
  useAccessData: (session: Session) => {
    seams.browser(session, usePublicFetch(session.fetch));
    return {
      storages: [],
      storageRoot: null,
      nodes: [],
      registrations: [],
      inboxUrl: null,
      walking: false,
      error: null,
      refresh: vi.fn(),
    };
  },
}));

let authSession: ReturnType<typeof useAuthSession>;
function Observer() {
  authSession = useAuthSession();
  return null;
}
function mount(
  fake = fakePodAuth(),
  profileOptions: Pick<SessionProviderProps, "readProfile"> = {},
) {
  const getPodAuth = vi.fn(async () => fake.auth);
  return {
    ...render(
      <StrictMode>
        <ThemeProvider>
          <SessionProvider
            getPodAuth={getPodAuth}
            appName={APP_NAME}
            dev={false}
            legacyCredentials={legacyCredentials}
            {...profileOptions}
          >
            <Observer />
            <App />
          </SessionProvider>
        </ThemeProvider>
      </StrictMode>,
    ),
    ...fake,
  };
}
async function ready() {
  await waitFor(() => expect(authSession.ready).toBe(true));
}
function chooseAccount() {
  const account = within(screen.getByRole("list", { name: "Recent accounts" })).getAllByRole(
    "button",
  )[0];
  if (!account) throw new Error("No remembered account was rendered");
  fireEvent.click(account);
}
function submitAddress(input: string, custom = false) {
  if (custom) fireEvent.click(screen.getByRole("button", { name: "Other provider" }));
  const form = screen.getByRole("form", {
    name: custom ? "Sign in with another provider" : "Sign in with your WebID",
  });
  fireEvent.change(within(form).getByRole(custom ? "combobox" : "textbox"), {
    target: { value: input },
  });
  fireEvent.submit(form);
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  vi.stubEnv("VITE_HOME_IDP", ISSUER);
  vi.stubEnv("VITE_HOME_IDP_NAME", "Home provider");
  vi.stubEnv("VITE_KNOWN_PROVIDERS", `${ISSUER},https://other.example/`);
  const { namedNode: n } = DataFactory;
  const writer = new Writer();
  writer.addQuad(n(WEB_ID), n("http://www.w3.org/ns/solid/terms#oidcIssuer"), n(ISSUER));
  writer.addQuad(n(WEB_ID), n("http://www.w3.org/ns/pim/space#storage"), n(POD_ROOT));
  const turtle = await new Promise<string>((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
  seams.publicFetch.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === WEB_ID || url === WEB_ID.split("#")[0])
      return new Response(turtle, { headers: { "content-type": "text/turtle" } });
    if (url === `${ISSUER}.well-known/openid-configuration`)
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}authorize` });
    return new Response("missing", { status: 404 });
  });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-solid-extension");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Access Manager with shared app sessions", () => {
  it("gates the access views through startup, restore and profile loading", async () => {
    const fake = fakePodAuth();
    const restore = deferred<Identity | null>();
    const profile = deferred<Profile>();
    fake.auth.restore.mockReturnValue(restore.promise);
    const view = mount(fake, { readProfile: () => profile.promise });
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    expect(seams.browser).not.toHaveBeenCalled();
    expect(
      view.container.querySelector(
        "main.login-screen[aria-busy=true] > section.login-card > h1 + p.login-sub",
      ),
    ).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(APP_NAME);

    await waitFor(() => expect(fake.auth.restore).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your session…");
    await act(async () => restore.resolve(identity));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your account…");
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    expect(seams.browser).not.toHaveBeenCalled();

    await act(async () =>
      profile.resolve({ webId: WEB_ID, storages: [POD_ROOT], oidcIssuers: [ISSUER] }),
    );
    expect(await screen.findByRole("tab", { name: "Shared" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the configured login screen after restore finds no session", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Home provider" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(seams.browser).not.toHaveBeenCalled();
  });

  it("offers sign-in after a restore failure", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockRejectedValue(new Error("private restore details"));
    mount(fake);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't restore your last session. Sign in again.",
    );
    expect(screen.queryByText("private restore details")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps sign-out working with extension presence %s", async (extension) => {
    if (extension) document.documentElement.setAttribute("data-solid-extension", "1");
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake);
    await screen.findByRole("tab", { name: "Shared" });
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change colour theme" })).toBeInTheDocument();
    if (extension) {
      expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    } else {
      expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
      fireEvent(
        screen.getByRole("button", { name: "Account menu" }),
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    }
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
  });

  it("restores once under StrictMode and threads the original session shape and pristine profile fetch", async () => {
    const before = globalThis.fetch;
    const fake = fakePodAuth();
    const restore = deferred<Identity | null>();
    fake.auth.restore.mockReturnValue(restore.promise);
    mount(fake);
    await waitFor(() => expect(fake.auth.restore).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your session…");
    await act(async () => restore.resolve(identity));
    await screen.findByRole("tab", { name: "Shared" });
    const [session, publicFetch] = seams.browser.mock.calls.at(-1) as [Session, typeof fetch];
    expect(session).toEqual({ webId: WEB_ID, fetch: fake.auth.fetch });
    expect(publicFetch).not.toBe(fake.auth.fetch);
    await publicFetch(WEB_ID, { credentials: "include" });
    expect(seams.publicFetch).toHaveBeenLastCalledWith(WEB_ID, { credentials: "omit" });
    expect(globalThis.fetch).toBe(before);
  });

  it.each([
    "WebID",
    "provider address",
    "provider button",
    "custom provider",
    "remembered account",
    "deep link",
  ])("signs in through the shared card using %s", async (path) => {
    const fake = fakePodAuth();
    const result = deferred<Identity>();
    fake.auth.login.mockReturnValue(result.promise);
    if (path === "remembered account")
      fake.auth.remembered.mockResolvedValue([
        { webId: WEB_ID, issuer: ISSUER, displayName: "Alice" },
      ]);
    if (path === "deep link")
      history.replaceState(null, "", `/#autologin/${encodeURIComponent(WEB_ID)}`);
    mount(fake);
    await ready();
    expect(fake.auth.login).not.toHaveBeenCalled();
    let hint: object;
    if (path === "remembered account" || path === "deep link") {
      expect(screen.getByRole("heading", { name: "Choose an account" })).toBeVisible();
      chooseAccount();
      hint = path === "remembered account" ? { webId: WEB_ID, issuer: ISSUER } : { webId: WEB_ID };
    } else if (path === "provider button") {
      fireEvent.click(screen.getByRole("button", { name: "Home provider" }));
      hint = { issuer: ISSUER };
    } else {
      const input = path === "WebID" ? WEB_ID : ISSUER;
      submitAddress(input, path === "custom provider");
      hint = path === "WebID" ? { webId: WEB_ID } : { issuer: ISSUER };
    }
    await waitFor(() =>
      expect(fake.auth.login).toHaveBeenCalledWith(hint, { signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole("button", { busy: true })).toBeDisabled();
    await act(async () => result.resolve(identity));
    await screen.findByRole("tab", { name: "Shared" });
    expect(seams.browser.mock.calls.at(-1)?.[0]).toEqual({ webId: WEB_ID, fetch: fake.auth.fetch });
    expect(location.hash).toBe("");
  });

  it("offers the WebID's issuers explicitly and retains that WebID on selection", async () => {
    const fake = fakePodAuth();
    fake.auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
    fake.auth.login.mockRejectedValueOnce(
      new IssuerChoiceRequiredError([ISSUER, "https://other.example/"]),
    );
    mount(fake);
    await ready();
    chooseAccount();
    await screen.findByText(`Choose the provider for ${new URL(WEB_ID).host}`);
    fireEvent.click(screen.getByRole("button", { name: "other.example" }));
    await screen.findByRole("tab", { name: "Shared" });
    expect(fake.auth.login).toHaveBeenLastCalledWith(
      { webId: WEB_ID, issuer: "https://other.example/" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("removes exactly the old app's stores once and preserves preferences and other apps", async () => {
    const keys = [
      ...(legacyCredentials.localStorage ?? []),
      "access-manager:app-shell-theme",
      "pod-docs:old",
      "unrelated",
    ];
    for (const key of keys) {
      localStorage.setItem(key, "keep");
      sessionStorage.setItem(key, "keep");
    }
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase });
    try {
      mount();
      await ready();
      expect(deleteDatabase.mock.calls).toEqual([["solid-access-manager:sessions"]]);
      for (const key of legacyCredentials.localStorage ?? [])
        expect(localStorage.getItem(key)).toBeNull();
      for (const key of keys.slice(2)) expect(localStorage.getItem(key)).toBe("keep");
      for (const key of keys) expect(sessionStorage.getItem(key)).toBe("keep");
    } finally {
      vi.stubGlobal("indexedDB", undefined);
    }
  });

  it.each([
    "logout",
    "expired",
  ] as const)("%s clears the app's views and profile-display cache", async (event) => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake);
    await screen.findByRole("tab", { name: "Shared" });
    await resolveAgentDisplay(WEB_ID, seams.publicFetch);
    const reads = seams.publicFetch.mock.calls.length;
    act(() => fake.emit(event, null));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
    await resolveAgentDisplay(WEB_ID, seams.publicFetch);
    expect(seams.publicFetch.mock.calls.length).toBeGreaterThan(reads);
  });

  it("awaits logout cleanup and never replays restore", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    const done = deferred<void>();
    fake.auth.logout.mockReturnValue(done.promise);
    mount(fake);
    await screen.findByRole("tab", { name: "Shared" });
    let settled = false;
    let loggingOut!: Promise<void>;
    act(() => {
      loggingOut = authSession.logout().then(() => {
        settled = true;
      });
    });
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await act(async () => {
      done.resolve();
      await loggingOut;
    });
    expect(settled).toBe(true);
    expect(fake.auth.restore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tab", { name: "Shared" })).not.toBeInTheDocument();
  });

  it("aborts login on unmount and removes subscriptions without logging out", async () => {
    const view = mount();
    view.auth.login.mockReturnValue(new Promise(() => {}));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Home provider" }));
    await waitFor(() => expect(view.auth.login).toHaveBeenCalledTimes(1));
    const signal = view.auth.login.mock.calls[0]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(view.auth.logout).not.toHaveBeenCalled();
    for (const listeners of view.listeners.values()) expect(listeners.size).toBe(0);
  });
});
