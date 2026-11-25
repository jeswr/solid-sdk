// AUTHORED-BY Claude Sonnet 5.5
import type { Identity } from "@jeswr/pod-auth";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/profile";
import { type SessionContextValue, SessionProvider, useSession } from "../src/SessionProvider";
import { deferred, fakePodAuth, identity, POD_ROOT, WEB_ID } from "../src/testing";

const profile: Profile = { webId: WEB_ID, name: "Alice", storages: [POD_ROOT], oidcIssuers: [] };
const other: Identity = { ...identity, webId: "https://bob.example/profile/card#me" };

let value: SessionContextValue;
function Observer() {
  value = useSession();
  return null;
}
type Reader = (
  webId: string,
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
) => Promise<Profile>;
function mount(fake = fakePodAuth(), readProfile: Reader = async () => profile, timeout?: number) {
  fake.auth.restore.mockResolvedValue(identity);
  const view = render(
    <SessionProvider
      getPodAuth={async () => fake.auth}
      appName="T"
      auth={fake.auth}
      readProfile={readProfile}
      profileTimeoutMs={timeout}
    >
      <Observer />
    </SessionProvider>,
  );
  return { ...view, ...fake };
}
const signedIn = () => waitFor(() => expect(value.session?.webId).toBe(WEB_ID));
const setVisibility = (state: "visible" | "hidden") =>
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cross-tab sign-out detection", () => {
  it("clears the session when the tab becomes visible after a foreign sign-out", async () => {
    const fake = mount();
    await signedIn();
    fake.auth.identity.mockResolvedValue(null);
    setVisibility("visible");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(value.webId).toBeNull());
    expect(value.session).toBeNull();
  });

  it("ignores visibilitychange while hidden", async () => {
    const fake = mount();
    await signedIn();
    fake.auth.identity.mockResolvedValue(null);
    setVisibility("hidden");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(fake.auth.identity).not.toHaveBeenCalled();
    expect(value.webId).toBe(WEB_ID);
  });

  it.each(["focus", "storage"])("clears the session on window %s", async (type) => {
    const fake = mount();
    await signedIn();
    fake.auth.identity.mockResolvedValue(null);
    await act(async () => void window.dispatchEvent(new Event(type)));
    await waitFor(() => expect(value.webId).toBeNull());
    expect(value.session).toBeNull();
  });

  it("leaves a sign-in that is under way alone", async () => {
    const fake = mount();
    await signedIn();
    const login = deferred<Identity>();
    fake.auth.login.mockReturnValue(login.promise);
    await act(async () => void value.loginWithIssuer("https://idp.example/"));
    await waitFor(() => expect(fake.auth.login).toHaveBeenCalledTimes(1));
    fake.auth.identity.mockResolvedValue(null);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    expect(fake.auth.identity).not.toHaveBeenCalled();
    expect(value.webId).toBe(WEB_ID);
    await act(async () => login.resolve(identity));
  });

  it("drops a check that resolves once a sign-in has started", async () => {
    const fake = mount();
    await signedIn();
    const current = deferred<Identity | null>();
    fake.auth.identity.mockReturnValue(current.promise);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    const login = deferred<Identity>();
    fake.auth.login.mockReturnValue(login.promise);
    await act(async () => void value.loginWithIssuer("https://idp.example/"));
    await waitFor(() => expect(fake.auth.login).toHaveBeenCalledTimes(1));
    await act(async () => current.resolve(null));
    expect(value.webId).toBe(WEB_ID);
    await act(async () => login.resolve(identity));
  });

  it("detects a foreign account switch and unmounts the old session", async () => {
    const fake = mount();
    await signedIn();
    fake.auth.identity.mockResolvedValue(other);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(value.webId).toBe(other.webId));
    expect(value.session?.webId).not.toBe(WEB_ID);
  });

  it("changes nothing while the session is still valid", async () => {
    const fake = mount();
    await signedIn();
    fake.auth.identity.mockResolvedValue({ ...identity });
    const before = value.session;
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fake.auth.identity).toHaveBeenCalledTimes(1));
    expect(value.webId).toBe(WEB_ID);
    expect(value.session).toBe(before);
  });

  it("keeps the session when the check itself fails", async () => {
    const fake = mount();
    await signedIn();
    fake.auth.identity.mockRejectedValue(new Error("storage unavailable"));
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(fake.auth.identity).toHaveBeenCalledTimes(1));
    expect(value.webId).toBe(WEB_ID);
  });

  it("shares one check between concurrent triggers, then allows a later one", async () => {
    const fake = mount();
    await signedIn();
    const gate = deferred<Identity | null>();
    fake.auth.identity.mockReturnValueOnce(gate.promise);
    setVisibility("visible");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("storage"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fake.auth.identity).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve(identity));
    fake.auth.identity.mockResolvedValue(identity);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    expect(fake.auth.identity).toHaveBeenCalledTimes(2);
  });

  it("removes its listeners on unmount and ignores a check resolving after unmount", async () => {
    const fake = mount();
    await signedIn();
    const gate = deferred<Identity | null>();
    fake.auth.identity.mockReturnValue(gate.promise);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    const removed = vi.spyOn(window, "removeEventListener");
    const removedDoc = vi.spyOn(document, "removeEventListener");
    cleanup();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["focus", "storage"]),
    );
    expect(removedDoc.mock.calls.map(([type]) => type)).toContain("visibilitychange");
    await act(async () => gate.resolve(null));
    window.dispatchEvent(new Event("focus"));
    expect(fake.auth.identity).toHaveBeenCalledTimes(1);
  });

  it("ignores a check that resolves after a newer identity replaced the one it checked", async () => {
    const fake = mount();
    await signedIn();
    const gate = deferred<Identity | null>();
    fake.auth.identity.mockReturnValue(gate.promise);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    await act(async () => fake.emit("login", other));
    await waitFor(() => expect(value.webId).toBe(other.webId));
    await act(async () => gate.resolve(null));
    expect(value.webId).toBe(other.webId);
  });

  it("does not listen while signed out", async () => {
    const fake = mount();
    await signedIn();
    await act(async () => fake.emit("logout", null));
    window.dispatchEvent(new Event("focus"));
    expect(fake.auth.identity).not.toHaveBeenCalled();
  });
});

describe("profile read timeout", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  const tick = (ms: number) =>
    act(async () => {
      for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(ms / 5);
    });

  it("falls back to the verified storages when the read stalls", async () => {
    let seen: AbortSignal | undefined;
    mount(fakePodAuth(), (_id, _f, signal) => {
      seen = signal;
      return new Promise<Profile>(() => undefined);
    });
    await tick(5);
    expect(seen).toBeDefined();
    await tick(9_000);
    expect(value.session).toBeNull();
    expect(seen?.aborted).toBe(false);
    await tick(1_100);
    expect(seen?.aborted).toBe(true);
    expect(value.session?.podRoot).toBe(POD_ROOT);
    expect(value.session?.displayName).toBeUndefined();
    expect(value.session?.podRoot).toBe(POD_ROOT);
  });

  it("ignores a late response after the timeout", async () => {
    const late = deferred<Profile>();
    mount(fakePodAuth(), () => late.promise, 50);
    await tick(5);
    await tick(100);
    expect(value.session?.displayName).toBeUndefined();
    expect(value.session?.podRoot).toBe(POD_ROOT);
    await act(async () => late.resolve(profile));
    expect(value.session?.displayName).toBeUndefined();
    expect(value.session?.podRoot).toBe(POD_ROOT);
  });

  it("leaves a fast read unaffected and clears its timer", async () => {
    let seen: AbortSignal | undefined;
    mount(fakePodAuth(), async (_id, _f, signal) => {
      seen = signal;
      return profile;
    });
    await tick(5);
    expect(value.session?.displayName).toBe("Alice");
    await tick(20_000);
    expect(value.session?.displayName).toBe("Alice");
    expect(seen?.aborted).toBe(false);
  });

  it("aborts the read when the identity changes or the provider unmounts", async () => {
    const signals: AbortSignal[] = [];
    const view = mount(fakePodAuth(), (_id, _f, signal) => {
      signals.push(signal as AbortSignal);
      return new Promise<Profile>(() => undefined);
    });
    await tick(5);
    await act(async () => view.emit("login", other));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    view.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});
