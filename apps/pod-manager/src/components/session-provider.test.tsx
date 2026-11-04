// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PodAuth } from "@jeswr/pod-auth";
import { resolveLoginTarget } from "@jeswr/pod-auth/directory";
import { publicFetch } from "@/lib/source-fetch";
import { IssuerChoiceRequiredError } from "@/lib/sign-in";
import {
  deferred,
  fakePodAuth,
  identity,
  ISSUER,
  POD_ROOT,
  WEB_ID,
} from "@/lib/test-utils-fake-pod-auth";
import { SessionProvider, useSession, type Session } from "./session-provider";

const runtime = vi.hoisted(() => ({ getPodAuth: vi.fn(), popupHolder: { current: null } }));
vi.mock("@/lib/pod-auth", () => runtime);
vi.mock("@/lib/source-fetch", () => ({ publicFetch: vi.fn(), sourceFetch: vi.fn() }));
vi.mock("@jeswr/pod-auth/directory", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-auth/directory")>()),
  resolveLoginTarget: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
let session: Session;
let auth: ReturnType<typeof fakePodAuth>["auth"];
let popup: { location: { href: string }; closed: boolean; close: ReturnType<typeof vi.fn> };
const deleteDatabase = vi.fn();
function Consumer() {
  session = useSession();
  return createElement("p", null, session.status);
}
async function mount(supplied: PodAuth | null = auth, strict = false) {
  await act(async () => {
    const tree = (
      <SessionProvider auth={supplied ?? undefined}>
        <Consumer />
      </SessionProvider>
    );
    root.render(strict ? createElement(StrictMode, null, tree) : tree);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("indexedDB", { deleteDatabase });
  localStorage.clear();
  history.replaceState(null, "", "/");
  auth = fakePodAuth().auth;
  runtime.getPodAuth.mockReset().mockReturnValue(auth);
  deleteDatabase.mockClear();
  vi.mocked(publicFetch)
    .mockReset()
    .mockImplementation(
      async () =>
        new Response(`<${WEB_ID}> <http://xmlns.com/foaf/0.1/name> "Alice" .`, {
          headers: { "content-type": "text/turtle" },
        }),
    );
  vi.mocked(resolveLoginTarget).mockReset().mockResolvedValue({ kind: "webid", webId: WEB_ID });
  popup = {
    location: { href: "about:blank" },
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };
  vi.spyOn(window, "open").mockImplementation(() => {
    popup.closed = false;
    return popup as unknown as Window;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shared Pod auth session", () => {
  it("restores once across StrictMode replay and exposes explicit fetches and the authenticated profile", async () => {
    const restore = deferred<typeof identity | null>();
    auth.restore.mockReturnValue(restore.promise);
    await mount(auth, true);
    expect(auth.restore).toHaveBeenCalledOnce();
    expect(session.status).toBe("loading");
    await act(async () => restore.resolve(identity));
    expect(session.webId).toBe(WEB_ID);
    expect(session.profile?.displayName).toBe("Alice");
    expect(session.activeStorage).toBe(POD_ROOT);
    expect(session.status).toBe("logged-in");
    expect(session.podFetch).toBe(auth.fetch);
    expect(session.issueAssignments).toBeDefined();
    expect(window.open).not.toHaveBeenCalled();
  });
  it.each([
    ["WebID", () => session.loginWithAddress(WEB_ID), { webId: WEB_ID }],
    ["pasted provider", () => session.loginWithAddress(ISSUER), { issuer: ISSUER }],
    ["provider button", () => session.loginWithIssuer(ISSUER), { issuer: ISSUER }],
    ["custom address", () => session.loginWithAddress(ISSUER, "custom"), { issuer: ISSUER }],
    [
      "remembered account",
      () => session.loginWithAccount(WEB_ID),
      { webId: WEB_ID, issuer: ISSUER },
    ],
  ] as const)("passes the %s hint and pre-opens before any async work", async (_label, login, hint) => {
    auth.remembered.mockResolvedValue([
      { webId: WEB_ID, issuer: ISSUER, displayName: "Alice", avatar: "https://example.test/a.png" },
    ]);
    if ("issuer" in hint && !("webId" in hint))
      vi.mocked(resolveLoginTarget).mockResolvedValue({ kind: "issuer", issuer: ISSUER });
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = login();
      expect(window.open).toHaveBeenCalledOnce();
      expect(auth.login).not.toHaveBeenCalled();
      await result;
    });
    expect(auth.login).toHaveBeenCalledExactlyOnceWith(hint, { signal: expect.any(AbortSignal) });
    expect(session.webId).toBe(WEB_ID);
    expect(session.status).toBe("logged-in");
    expect(popup.close).toHaveBeenCalledOnce();
    expect(session.recentAccounts[0]).toEqual({
      webId: WEB_ID,
      name: "Alice",
      photoUrl: "https://example.test/a.png",
    });
    expect(session.recentProviders).toEqual([ISSUER]);
  });
  it("uses a bounded pristine public lookup, then remembers a provider only after login succeeds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const login = deferred<typeof identity>();
    auth.login.mockReturnValue(login.promise);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithAddress(WEB_ID);
    });
    const options = vi.mocked(resolveLoginTarget).mock.calls[0][1];
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(options.fetch).toBe(publicFetch);
    expect(options.allowInsecureLoopback).toBe(false);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(session.recentProviders).toEqual([]);
    expect(session.pending).toEqual({ kind: "webid", key: WEB_ID });
    await act(async () => {
      login.resolve(identity);
      await result;
    });
    expect(session.recentProviders).toEqual([ISSUER]);
    expect(JSON.parse(localStorage.getItem("pod-auth.recentProviders.v1")!)).toEqual([ISSUER]);
  });
  it("offers remembered accounts when restore fails, without treating a public profile as authentication", async () => {
    auth.restore.mockRejectedValue(new Error("private details"));
    auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
    await mount();
    expect(session.status).toBe("logged-out");
    expect(session.webId).toBeUndefined();
    expect(session.recentAccounts).toHaveLength(1);
    expect(session.error).not.toContain("private details");
    expect(publicFetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
  it("does not remember failed logins or display raw protocol errors", async () => {
    auth.login.mockRejectedValue(new Error("access_token=secret&code=private"));
    await mount();
    await act(async () => session.loginWithIssuer(ISSUER));
    expect(session.error).toBe("We couldn't sign you in. Try again.");
    expect(session.recentProviders).toEqual([]);
    expect(session.pending).toBeNull();
    expect(popup.closed).toBe(true);
  });
  it("rejects a blocked popup without starting authentication", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    await mount();
    await act(async () => session.loginWithIssuer(ISSUER));
    expect(auth.login).not.toHaveBeenCalled();
    expect(session.error).toContain("blocked");
  });
  it("cleans legacy credentials once even under StrictMode, leaving unrelated data", async () => {
    localStorage.setItem("solid-pod-manager:active-webid", WEB_ID);
    localStorage.setItem("solid:recent-accounts", "legacy");
    localStorage.setItem("unrelated", "keep");
    await mount(auth, true);
    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("solid-pod-manager:sessions");
    expect(localStorage.getItem("solid-pod-manager:active-webid")).toBeNull();
    expect(localStorage.getItem("solid:recent-accounts")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
  it("retries a failed runtime startup", async () => {
    runtime.getPodAuth.mockImplementationOnce(() => {
      throw new Error("startup secret");
    });
    await mount(null);
    expect(session.startupFailed).toBe(true);
    expect(session.status).toBe("logged-out");
    expect(session.error).toBe("We couldn't start sign-in. Try again.");
    await act(async () => session.retry());
    expect(session.ready).toBe(true);
    expect(session.startupFailed).toBe(false);
    expect(auth.restore).toHaveBeenCalledOnce();
  });
  it("keeps global fetch unchanged through startup, login, reads and logout", async () => {
    const original = globalThis.fetch;
    await mount();
    await act(async () => session.loginWithIssuer(ISSUER));
    await session.podFetch(`${POD_ROOT}private.txt`);
    await act(async () => session.logout());
    expect(auth.fetch).toHaveBeenCalledOnce();
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toBe(original);
    expect(session.status).toBe("logged-out");
    expect(session.profile).toBeUndefined();
    expect(session.recentAccounts).toEqual([]);
  });
  it("fences a deferred restore against logout", async () => {
    const restore = deferred<typeof identity | null>();
    auth.restore.mockReturnValue(restore.promise);
    await mount();
    await act(async () => session.logout());
    await act(async () => restore.resolve(identity));
    expect(session.status).toBe("logged-out");
    expect(session.profile).toBeUndefined();
    expect(publicFetch).not.toHaveBeenCalled();
  });
  it("fences a stale login and its profile read against logout", async () => {
    const profile = deferred<Response>();
    vi.mocked(publicFetch).mockReturnValue(profile.promise);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithIssuer(ISSUER);
    });
    await act(async () => session.logout());
    await act(async () => {
      profile.resolve(new Response(null, { status: 500 }));
      await result;
    });
    expect(session.status).toBe("logged-out");
    expect(session.webId).toBeUndefined();
    expect(session.recentProviders).toEqual([]);
  });
  it("cancels pending login, closes the popup and cannot publish its delayed result", async () => {
    const pending = deferred<typeof identity>();
    auth.login.mockReturnValue(pending.promise);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithIssuer(ISSUER);
    });
    await act(async () => session.cancelLogin());
    await act(async () => {
      pending.resolve(identity);
      await result;
    });
    expect(session.status).toBe("logged-out");
    expect(session.error).toBe("Sign-in was cancelled.");
    expect(popup.closed).toBe(true);
    expect(auth.logout).toHaveBeenCalledOnce();
  });
  it("cancel abandons only the attempt: no logout, so remembered accounts and sessions stay", async () => {
    const pending = deferred<typeof identity>();
    auth.login.mockReturnValue(pending.promise);
    auth.remembered.mockResolvedValue([{ webId: WEB_ID, issuer: ISSUER }]);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithAccount(WEB_ID);
    });
    await act(async () => session.cancelLogin());
    await act(async () => {
      pending.reject(new DOMException("closed", "AbortError"));
      await result;
    });
    expect(session.status).toBe("logged-out");
    expect(session.error).toBe("Sign-in was cancelled.");
    expect(popup.closed).toBe(true);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(session.recentAccounts.map((account) => account.webId)).toEqual([WEB_ID]);
  });
  it("cancel aborts the login inside pod-auth and reopens sign-in without waiting for it", async () => {
    // pod-auth rejects an aborted login at once, whatever the abandoned attempt is still doing.
    let signal: AbortSignal | undefined;
    auth.login.mockImplementation(
      (_hint, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal;
          signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
        }),
    );
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithIssuer(ISSUER);
    });
    expect(signal?.aborted).toBe(false);
    await act(async () => {
      session.cancelLogin();
      await result;
    });
    expect(signal?.aborted).toBe(true);
    expect(session.ready).toBe(true);
    expect(session.status).toBe("logged-out");
    expect(session.error).toBe("Sign-in was cancelled.");
    expect(auth.logout).not.toHaveBeenCalled();
  });
  it("offers a WebID's several providers and keeps the WebID when one is chosen", async () => {
    const other = "https://other.example/";
    auth.login.mockRejectedValueOnce(new IssuerChoiceRequiredError([ISSUER, other]));
    await mount();
    await act(async () => session.loginWithAddress("alice.example"));
    expect(session.issuerChoice).toEqual({ webId: WEB_ID, issuers: [ISSUER, other] });
    expect(session.error).toBe("Your WebID lists more than one provider. Choose yours below.");
    // A cancelled choice keeps the list for another try.
    auth.login.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
    await act(async () => session.loginWithIssuer(other));
    expect(auth.login).toHaveBeenLastCalledWith({ webId: WEB_ID, issuer: other }, { signal: expect.any(AbortSignal) });
    expect(session.issuerChoice?.webId).toBe(WEB_ID);
    await act(async () => session.loginWithIssuer(ISSUER));
    expect(auth.login).toHaveBeenLastCalledWith({ webId: WEB_ID, issuer: ISSUER }, { signal: expect.any(AbortSignal) });
    expect(session.status).toBe("logged-in");
    expect(session.issuerChoice).toBeUndefined();
    // An issuer outside the list is an ordinary provider login without the WebID.
    await act(async () => session.logout());
    await act(async () => session.loginWithIssuer(other));
    expect(auth.login).toHaveBeenLastCalledWith({ issuer: other }, { signal: expect.any(AbortSignal) });
  });
  it("cancel during profile loading drops the session the provider already granted", async () => {
    const profile = deferred<Response>();
    vi.mocked(publicFetch).mockReturnValue(profile.promise);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithIssuer(ISSUER);
    });
    expect(auth.login).toHaveBeenCalledOnce();
    await act(async () => session.cancelLogin());
    await act(async () => {
      profile.resolve(new Response(null, { status: 500 }));
      await result;
    });
    expect(session.status).toBe("logged-out");
    expect(session.webId).toBeUndefined();
    expect(auth.logout).toHaveBeenCalledOnce();
  });
  it("cancel during profile loading then a retry: the stale attempt cannot sign the retry out", async () => {
    const stale = deferred<Response>();
    vi.mocked(publicFetch).mockReturnValueOnce(stale.promise);
    await mount();
    let first!: Promise<void>;
    await act(async () => {
      first = session.loginWithIssuer(ISSUER);
    });
    await act(async () => session.cancelLogin());
    // The granted session is dropped at once, and sign-in reopens after that.
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(session.ready).toBe(true);
    await act(async () => session.loginWithIssuer(ISSUER));
    expect(session.status).toBe("logged-in");
    await act(async () => {
      stale.resolve(new Response(null, { status: 500 }));
      await first;
    });
    expect(session.status).toBe("logged-in");
    expect(session.webId).toBe(WEB_ID);
    expect(auth.logout).toHaveBeenCalledOnce();
  });
  it("ignores duplicate clicks while a login is pending", async () => {
    const pending = deferred<typeof identity>();
    auth.login.mockReturnValue(pending.promise);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithIssuer(ISSUER);
      await session.loginWithAccount(WEB_ID);
    });
    expect(auth.login).toHaveBeenCalledOnce();
    expect(window.open).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(identity);
      await result;
    });
  });
  it("a late old login cannot overwrite a newer account after logout", async () => {
    const first = deferred<typeof identity>();
    const bob = {
      ...identity,
      webId: "https://bob.example/#me",
      subject: "https://bob.example/#me",
    };
    auth.login.mockReturnValueOnce(first.promise).mockResolvedValueOnce(bob);
    await mount();
    let old!: Promise<void>;
    await act(async () => {
      old = session.loginWithIssuer(ISSUER);
    });
    await act(async () => session.logout());
    await act(async () => session.loginWithAccount(bob.webId));
    expect(session.webId).toBe(bob.webId);
    await act(async () => {
      first.resolve(identity);
      await old;
    });
    expect(session.webId).toBe(bob.webId);
    expect(auth.login).toHaveBeenCalledTimes(2);
  });
  it("surfaces logout failures without raw details and still clears the profile", async () => {
    await mount();
    await act(async () => session.loginWithIssuer(ISSUER));
    auth.logout.mockRejectedValue(new Error("secret token"));
    await act(async () => session.logout());
    expect(session.status).toBe("logged-out");
    expect(session.webId).toBeUndefined();
    expect(session.ready).toBe(true);
    expect(session.error).toBe("We couldn't sign you out. Try again.");
  });
  it("consumes an autologin hash as an account suggestion without starting a popup", async () => {
    history.replaceState(null, "", `/#autologin/${encodeURIComponent(WEB_ID)}`);
    await mount(auth, true);
    expect(location.hash).toBe("");
    expect(session.recentAccounts).toEqual([{ webId: WEB_ID }]);
    expect(auth.login).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
  it.each([
    "javascript:alert(1)",
    "https://user:password@example.test/me",
    "not-a-url",
    "http://public.example/me",
  ])("ignores unsafe deep link %s", async (address) => {
    history.replaceState(null, "", `/#autologin/${encodeURIComponent(address)}`);
    await mount();
    expect(session.recentAccounts).toEqual([]);
    expect(auth.login).not.toHaveBeenCalled();
  });
  it("turns the existing WebID deep link into a one-click account row", async () => {
    history.replaceState(null, "", `/?webid=${encodeURIComponent(WEB_ID)}`);
    await mount(auth, true);
    expect(session.recentAccounts).toEqual([{ webId: WEB_ID }]);
    expect(auth.login).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    await act(async () => session.loginWithAccount(WEB_ID));
    expect(auth.login).toHaveBeenCalledWith({ webId: WEB_ID }, { signal: expect.any(AbortSignal) });
  });
  it("removes subscriptions and closes a pending popup on unmount", async () => {
    const pending = deferred<typeof identity>();
    auth.login.mockReturnValue(pending.promise);
    await mount();
    let result!: Promise<void>;
    await act(async () => {
      result = session.loginWithIssuer(ISSUER);
    });
    await act(async () => root.unmount());
    expect(popup.closed).toBe(true);
    expect(auth.logout).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(identity);
      await result;
    });
    expect(publicFetch).not.toHaveBeenCalled();
  });
});
