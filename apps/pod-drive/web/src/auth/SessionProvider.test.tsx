// AUTHORED-BY Codex GPT-6.1-Sol
import { ThemeProvider } from "@jeswr/app-shell";
import { AmbiguousIssuerError, type Identity, IssuerNotAuthorizedError } from "@jeswr/pod-auth";
import {
  createRecentProvidersStore,
  InvalidLoginAddressError,
  NotALoginAddressError,
} from "@jeswr/pod-auth/directory";
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DataFactory, Writer } from "n3";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  fakePodAuth,
  ISSUER,
  identity,
  POD_ROOT,
  WEB_ID,
} from "../../test/fake-pod-auth";

const seams = vi.hoisted(() => ({
  publicFetch: vi.fn<typeof fetch>(),
  getPodAuth: vi.fn(),
  browser: vi.fn(),
}));
vi.mock("./pod-auth", async (original) => ({
  ...(await original<typeof import("./pod-auth")>()),
  publicFetch: seams.publicFetch,
  getPodAuth: seams.getPodAuth,
}));
const resolveSpy = vi.hoisted(() => vi.fn());
vi.mock("@jeswr/pod-auth/directory", async (original) => {
  const actual = await original<typeof import("@jeswr/pod-auth/directory")>();
  return {
    ...actual,
    resolveLoginTarget: (...args: Parameters<typeof actual.resolveLoginTarget>) => {
      resolveSpy(...args);
      return actual.resolveLoginTarget(...args);
    },
  };
});
vi.mock("@jeswr/pod-drive/ui", () => ({
  FileBrowser: (props: unknown) => {
    seams.browser(props);
    return <div data-testid="file-browser" />;
  },
}));
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

import { App } from "../App";
import { signInProviders } from "../LoginScreen";
import { IssuerChoiceRequiredError } from "./issuer-choice";
import { type SessionContextValue, SessionProvider, useSession } from "./SessionProvider";

let session: SessionContextValue;
function Observer() {
  session = useSession();
  return null;
}
function mount(fake = fakePodAuth(), supplied = true) {
  seams.getPodAuth.mockResolvedValue(fake.auth);
  const view = render(
    <StrictMode>
      <ThemeProvider>
        <SessionProvider auth={supplied ? fake.auth : undefined}>
          <Observer />
          <App />
        </SessionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  return { ...view, ...fake };
}
async function ready() {
  await waitFor(() => expect(session.ready).toBe(true));
}
async function chooseProvider() {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Home provider" }));
}
function submitAddress(value: string, custom = false) {
  if (custom) fireEvent.click(screen.getByRole("button", { name: "Other provider" }));
  const form = screen.getByRole("form", {
    name: custom ? "Sign in with another provider" : "Sign in with your WebID",
  });
  fireEvent.change(within(form).getByRole(custom ? "combobox" : "textbox"), { target: { value } });
  fireEvent.submit(form);
}

function publicProfile(includeStorage = true) {
  const { namedNode: n, literal, quad } = DataFactory;
  const writer = new Writer();
  writer.addQuads([
    quad(n(WEB_ID), n("http://www.w3.org/ns/solid/terms#oidcIssuer"), n(ISSUER)),
    quad(
      n(WEB_ID),
      n(
        includeStorage
          ? "http://www.w3.org/ns/pim/space#storage"
          : "http://www.w3.org/ns/solid/terms#storage",
      ),
      n(POD_ROOT),
    ),
    quad(n(WEB_ID), n("http://xmlns.com/foaf/0.1/name"), literal("Alice Drive")),
    quad(
      n(WEB_ID),
      n("http://www.w3.org/2006/vcard/ns#hasPhoto"),
      n("https://images.example/alice.png"),
    ),
  ]);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  vi.stubEnv("VITE_HOME_IDP", ISSUER);
  vi.stubEnv("VITE_HOME_IDP_NAME", "Home provider");
  vi.stubEnv("VITE_KNOWN_PROVIDERS", `${ISSUER},https://other.example/`);
  const turtle = await publicProfile();
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Drive shared authentication", () => {
  it("restores once under StrictMode, shows the wait, then the app with auth.fetch and public profile details", async () => {
    const before = globalThis.fetch;
    const fake = fakePodAuth();
    const restore = deferred<Identity | null>();
    fake.auth.restore.mockReturnValue(restore.promise);
    mount(fake);
    expect(screen.getByRole("status")).toHaveTextContent("Restoring your session…");
    await waitFor(() => expect(fake.auth.restore).toHaveBeenCalledTimes(1));
    expect(session.restoringSession).toBe(true);
    await act(async () => {
      restore.resolve(identity);
    });
    await screen.findByTestId("file-browser");
    expect(session.restoringSession).toBe(false);
    expect(session.session).toMatchObject({
      podRoot: POD_ROOT,
      displayName: "Alice Drive",
      avatarUrl: "https://images.example/alice.png",
    });
    expect(seams.browser).toHaveBeenLastCalledWith({
      rootUrl: POD_ROOT,
      title: "Your files",
      fetch: fake.auth.fetch,
    });
    expect(seams.publicFetch).toHaveBeenCalled();
    expect(fake.auth.fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(before);
  });

  it.each([
    "WebID",
    "provider pasted as WebID",
    "provider pill",
    "custom provider",
    "account row",
    "autologin row",
  ])("logs in through %s with the right hint and pending key", async (path) => {
    const before = globalThis.fetch;
    const fake = fakePodAuth();
    const result = deferred<Identity>();
    fake.auth.login.mockReturnValue(result.promise);
    if (path === "account row")
      fake.auth.remembered.mockResolvedValue([
        { webId: WEB_ID, issuer: ISSUER, displayName: "Alice" },
      ]);
    if (path === "autologin row")
      history.replaceState(null, "", `/?from=manager#autologin/${encodeURIComponent(WEB_ID)}`);
    mount(fake);
    await ready();
    expect(fake.auth.login).not.toHaveBeenCalled();
    let kind: string;
    let key: string;
    let hint: object;
    if (path.includes("row")) {
      expect(screen.getByRole("heading", { name: "Choose an account" })).toBeVisible();
      fireEvent.click(
        within(screen.getByRole("list", { name: "Recent accounts" })).getAllByRole("button")[0],
      );
      kind = "account";
      key = WEB_ID;
      // A remembered account keeps its issuer; a deep link only knows the WebID.
      hint = path === "account row" ? { webId: WEB_ID, issuer: ISSUER } : { webId: WEB_ID };
    } else if (path === "provider pill") {
      await chooseProvider();
      kind = "provider";
      key = ISSUER;
      hint = { issuer: ISSUER };
    } else {
      const custom = path === "custom provider";
      key = path === "WebID" ? WEB_ID : ISSUER;
      kind = custom ? "custom" : "webid";
      hint = path === "WebID" ? { webId: WEB_ID } : { issuer: ISSUER };
      submitAddress(key, custom);
    }
    await waitFor(() => expect(fake.auth.login).toHaveBeenCalledWith(hint));
    expect(session.pending).toEqual({ kind, key });
    expect(screen.getByRole("button", { busy: true })).toBeDisabled();
    expect(createRecentProvidersStore(localStorage).list()).toEqual([]);
    await act(async () => {
      result.resolve(identity);
    });
    await screen.findByTestId("file-browser");
    expect(session.pending).toBeNull();
    expect(createRecentProvidersStore(localStorage).list()).toEqual([ISSUER]);
    expect(globalThis.fetch).toBe(before);
    if (path === "autologin row") {
      expect(location.hash).toBe("");
      expect(location.search).toBe("?from=manager");
    }
  });

  it.each([
    [new InvalidLoginAddressError("SECRET"), "That address isn't a WebID or a sign-in provider."],
    [new NotALoginAddressError("SECRET"), "That address isn't a WebID or a sign-in provider."],
    [
      new IssuerNotAuthorizedError("https://secret.example/#me", "https://secret.example/"),
      "That account doesn't trust this provider. Try your own provider or your WebID.",
    ],
    [new AmbiguousIssuerError(), "Your WebID lists more than one provider. Choose yours below."],
    [
      new CodeRequestCancelledError(new URL("https://secret.example/?code=SECRET")),
      "Sign-in was cancelled.",
    ],
    [new DOMException("SECRET", "AbortError"), "Sign-in was cancelled."],
    [new Error("SECRET access_token=private"), "We couldn't sign you in. Try again."],
    ["SECRET", "We couldn't sign you in. Try again."],
  ])("maps %s without leaking raw error material", async (failure, message) => {
    const fake = fakePodAuth();
    fake.auth.login.mockRejectedValue(failure);
    mount(fake);
    await chooseProvider();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent("SECRET");
    expect(session.pending).toBeNull();
    expect(session.recentProviders).toEqual([]);
    expect(createRecentProvidersStore(localStorage).list()).toEqual([]);
    expect(screen.getByRole("button", { name: "Home provider" })).toBeEnabled();
  });

  it.each([
    "not a url",
    "https://missing.example/",
  ])("reports a failed address resolution for %s before calling login", async (input) => {
    const { auth } = mount();
    await ready();
    submitAddress(input);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That address isn't a WebID or a sign-in provider.",
    );
    expect(auth.login).not.toHaveBeenCalled();
    expect(session.pending).toBeNull();
  });

  it("offers a WebID's several providers and keeps the WebID when one is chosen", async () => {
    const other = "https://other.example/";
    const fake = fakePodAuth();
    fake.auth.login
      .mockRejectedValueOnce(new IssuerChoiceRequiredError([ISSUER, other]))
      .mockRejectedValueOnce(new CodeRequestCancelledError(new URL(`${other}authorize`)));
    mount(fake);
    await ready();
    submitAddress(WEB_ID);
    expect(await screen.findByText(`Choose the provider for ${new URL(WEB_ID).host}`)).toBeVisible();
    expect(session.issuerChoice).toEqual({ webId: WEB_ID, issuers: [ISSUER, other] });
    expect(screen.getByRole("button", { name: "Home provider" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "other.example" }));
    await waitFor(() =>
      expect(fake.auth.login).toHaveBeenLastCalledWith({ webId: WEB_ID, issuer: other }),
    );
    // A failed choice keeps the list, so the person can pick again.
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in was cancelled.");
    expect(session.issuerChoice?.issuers).toEqual([ISSUER, other]);
    const pick = deferred<Identity>();
    fake.auth.login.mockReturnValueOnce(pick.promise);
    fireEvent.click(screen.getByRole("button", { name: "Home provider" }));
    await waitFor(() =>
      expect(fake.auth.login).toHaveBeenLastCalledWith({ webId: WEB_ID, issuer: ISSUER }),
    );
    // While the pick runs, the card keeps the listed providers instead of remounting.
    expect(session.issuerChoice?.issuers).toEqual([ISSUER, other]);
    await act(async () => pick.resolve(identity));
    await waitFor(() => expect(session.issuerChoice).toBeUndefined());
  });

  it("a provider outside the listed choice signs in with that provider alone", async () => {
    const fake = fakePodAuth();
    fake.auth.login.mockRejectedValueOnce(new IssuerChoiceRequiredError([ISSUER]));
    mount(fake);
    await ready();
    submitAddress(WEB_ID);
    await waitFor(() => expect(session.issuerChoice).toBeDefined());
    await act(async () => session.loginWithIssuer("https://elsewhere.example/"));
    expect(fake.auth.login).toHaveBeenLastCalledWith({ issuer: "https://elsewhere.example/" });
  });

  it("uses recent-provider storage for the custom address suggestions", async () => {
    createRecentProvidersStore(localStorage).remember("https://previous.example/");
    mount();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Other provider" }));
    const input = screen.getByRole("combobox", { name: "Provider address" });
    const datalist = document.getElementById(input.getAttribute("list") ?? "");
    expect(datalist?.querySelector("option")).toHaveAttribute("value", "https://previous.example/");
  });

  it("merges and deduplicates remembered accounts and the deep-link account before mounting the card", async () => {
    const fake = fakePodAuth();
    fake.auth.remembered.mockResolvedValue([
      { webId: WEB_ID, issuer: ISSUER, displayName: "Alice" },
    ]);
    history.replaceState(null, "", `/#autologin/${encodeURIComponent(WEB_ID)}`);
    mount(fake);
    await ready();
    expect(
      within(screen.getByRole("list", { name: "Recent accounts" })).getAllByRole("button"),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Alice/ })).toBeVisible();
    expect(location.hash).toBe("");
    expect(fake.auth.login).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,hello",
    "/profile#me",
    "",
    "%",
    "https://user:pass@example.com/#me",
  ])("strips and ignores the invalid deep link %s", async (value) => {
    history.replaceState(
      null,
      "",
      `/#autologin/${value === "%" ? "%" : encodeURIComponent(value)}`,
    );
    const { auth } = mount();
    await ready();
    expect(location.hash).toBe("");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(session.recentAccounts).toEqual([]);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("retains an unrelated fragment and ignores old full-page OAuth return parameters", async () => {
    history.replaceState(null, "", "/?code=old&state=old#files");
    const { auth } = mount();
    await ready();
    expect(location.hash).toBe("#files");
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("awaits core logout and returns to sign-in without replaying restore", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake);
    await screen.findByTestId("file-browser");
    await ready();
    await act(async () => {
      await session.logout();
    });
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    expect(session.webId).toBeNull();
    expect(session.session).toBeNull();
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
    expect(fake.auth.restore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  it("waits for logout cleanup and safely reports its failure", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    const cleanup = deferred<void>();
    fake.auth.logout.mockImplementation(async () => {
      try {
        await cleanup.promise;
      } finally {
        fake.emit("logout", null);
      }
    });
    mount(fake);
    await screen.findByTestId("file-browser");
    await ready();
    let settled = false;
    let loggingOut!: Promise<void>;
    act(() => {
      loggingOut = session.logout().then(() => {
        settled = true;
      });
    });
    expect(fake.auth.logout).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await act(async () => {
      cleanup.reject(new Error("SECRET"));
      await loggingOut;
    });
    expect(settled).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't sign you out. Try again.",
    );
    expect(document.body).not.toHaveTextContent("SECRET");
  });

  it("falls back to verified core roots when public profile display data is unavailable", async () => {
    seams.publicFetch.mockRejectedValue(new Error("profile temporarily offline"));
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake);
    await screen.findByTestId("file-browser");
    expect(session.session).toMatchObject({ podRoot: POD_ROOT, podRootIsFallback: false });
    expect(fake.auth.fetch).not.toHaveBeenCalled();
  });

  it("uses the existing origin fallback when the profile has no pim:storage", async () => {
    const turtle = await publicProfile(false);
    seams.publicFetch.mockResolvedValue(
      new Response(turtle, { headers: { "content-type": "text/turtle" } }),
    );
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake);
    await screen.findByTestId("file-browser");
    expect(session.session).toMatchObject({
      podRoot: "https://alice.example/",
      podRootIsFallback: true,
    });
    expect(screen.getByRole("note")).toHaveTextContent(
      // pod-auth grants credentials only inside the profile's pim:storage, never this fallback.
      "Your profile doesn't list a storage address, so Drive can only show public files",
    );
  });

  it("does not publish or remember a login result that completes after logout", async () => {
    const fake = fakePodAuth();
    const result = deferred<Identity>();
    fake.auth.login.mockReturnValue(result.promise);
    mount(fake);
    await chooseProvider();
    await waitFor(() => expect(fake.auth.login).toHaveBeenCalledTimes(1));
    await act(async () => {
      await session.logout();
      result.resolve(identity);
    });
    expect(session.webId).toBeNull();
    expect(session.pending).toBeNull();
    expect(session.recentProviders).toEqual([]);
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
  });

  it("does not let a delayed public profile read resurrect an expired session", async () => {
    const profile = deferred<Response>();
    seams.publicFetch.mockReturnValue(profile.promise);
    const fake = fakePodAuth();
    fake.auth.restore.mockResolvedValue(identity);
    mount(fake);
    await ready();
    await waitFor(() => expect(seams.publicFetch).toHaveBeenCalled());
    act(() => {
      fake.emit("expired", null);
    });
    await act(async () => {
      profile.resolve(
        new Response(await publicProfile(), { headers: { "content-type": "text/turtle" } }),
      );
    });
    expect(session.webId).toBeNull();
    expect(session.session).toBeNull();
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
  });

  it("a newer lifecycle event wins over a late restore result", async () => {
    const restore = deferred<Identity | null>();
    const fake = fakePodAuth();
    fake.auth.restore.mockReturnValue(restore.promise);
    mount(fake);
    await waitFor(() => expect(fake.auth.restore).toHaveBeenCalledTimes(1));
    act(() => {
      fake.emit("logout", null);
    });
    await act(async () => {
      restore.resolve(identity);
    });
    await ready();
    expect(session.webId).toBeNull();
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
  });

  it("leaves the restoring state after restore rejection and allows another sign-in", async () => {
    const fake = fakePodAuth();
    fake.auth.restore.mockRejectedValue(new Error("SECRET"));
    mount(fake);
    await ready();
    expect(session.restoringSession).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't restore your last session. Sign in again.",
    );
    expect(document.body).not.toHaveTextContent("SECRET");
    await chooseProvider();
    await screen.findByTestId("file-browser");
    expect(session.error).toBeNull();
  });

  it("runtime initialization failure clears the restoring state and shows a safe error", async () => {
    const fake = fakePodAuth();
    seams.getPodAuth.mockRejectedValueOnce(new Error("SECRET")).mockResolvedValueOnce(fake.auth);
    render(
      <SessionProvider>
        <Observer />
        <App />
      </SessionProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't start sign-in. Try again.",
    );
    expect(session.restoringSession).toBe(false);
    expect(session.ready).toBe(false);
    expect(document.body).not.toHaveTextContent("SECRET");
    // The card is disabled until start-up succeeds; retrying starts the core again.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    expect(seams.getPodAuth).toHaveBeenCalledTimes(2);
    expect(fake.auth.restore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("removes the pre-pod-auth refresh-token store and pointers once on mount", async () => {
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { deleteDatabase });
    localStorage.setItem("pod-drive:remembered-account", '{"webId":"x"}');
    sessionStorage.setItem("pod-drive:autologin-attempted", "1");
    sessionStorage.setItem("pod-drive:pss.autologin.flow", "{}");
    localStorage.setItem("unrelated", "kept");
    mount();
    await ready();
    expect(deleteDatabase).toHaveBeenCalledWith("pod-drive:sessions");
    expect(deleteDatabase).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("pod-drive:remembered-account")).toBeNull();
    expect(sessionStorage.getItem("pod-drive:autologin-attempted")).toBeNull();
    expect(sessionStorage.getItem("pod-drive:pss.autologin.flow")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("kept");
  });

  it("bounds address lookups with a timeout signal", async () => {
    seams.publicFetch.mockImplementation(() => new Promise<Response>(() => {}));
    mount();
    await ready();
    submitAddress(WEB_ID);
    await waitFor(() => expect(resolveSpy).toHaveBeenCalled());
    const options = resolveSpy.mock.calls.at(-1)?.[1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
    expect(options.fetch).toBe(seams.publicFetch);
    // When the signal fires, pending clears and the user sees a specific message.
    expect(session.pending).toMatchObject({ kind: "webid" });
  });

  it("shows a specific message when an address lookup times out", async () => {
    resolveSpy.mockImplementationOnce(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    mount();
    await ready();
    submitAddress(WEB_ID);
    expect(await screen.findByRole("alert")).toHaveTextContent("That address didn't respond.");
    expect(session.pending).toBeNull();
  });

  it.each([
    ["http://alice.example/profile#me", null],
    [`https://alice.example/${"a".repeat(2100)}`, null],
    ["https://alice.example/profile#me", "https://alice.example/profile#me"],
  ])("accepts only safe deep-link WebIDs: %s", async (webId, expected) => {
    history.replaceState(null, "", `/#autologin/${encodeURIComponent(webId)}`);
    mount();
    await ready();
    expect(session.recentAccounts.map((account) => account.webId)).toEqual(
      expected ? [expected] : [],
    );
    expect(location.hash).toBe("");
  });

  it("removes subscriptions on unmount", async () => {
    const view = mount();
    await ready();
    view.unmount();
    for (const listeners of view.listeners.values()) expect(listeners.size).toBe(0);
  });
});

describe("Drive provider configuration", () => {
  it("puts the home issuer first, uses the configured label, and removes its duplicate", () => {
    expect(signInProviders().map(({ issuer, name }) => [issuer, name])).toEqual([
      [ISSUER, "Home provider"],
      ["https://other.example/", "other.example"],
    ]);
  });
  it("uses the host as the home name and the shared directory as fallback", () => {
    vi.stubEnv("VITE_HOME_IDP_NAME", "");
    vi.stubEnv("VITE_KNOWN_PROVIDERS", "");
    const providers = signInProviders();
    expect(providers[0].name).toBe("provider.example");
    expect(providers.some(({ issuer }) => issuer === "https://solidcommunity.net/")).toBe(true);
  });
  it("ignores an invalid home provider instead of crashing the login screen", () => {
    vi.stubEnv("VITE_HOME_IDP", "javascript:alert(1)");
    expect(signInProviders().map(({ issuer }) => issuer)).toEqual([
      ISSUER,
      "https://other.example/",
    ]);
  });
});
