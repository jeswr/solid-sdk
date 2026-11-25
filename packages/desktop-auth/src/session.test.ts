// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5
import { USER_CANCELLED } from "@jeswr/suite-native";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createDesktopAuthSession,
  type DesktopHost,
  HOST_FAILED,
  type IgnoredReason,
  MAX_CALLBACK_LENGTH,
  TIMED_OUT,
} from "./session.js";

const SCHEME = "ai.artcraft.app";
const REDIRECT = `${SCHEME}:/oauth/callback`;
const STATE = "state-1";

function authorizationUrl(params: Record<string, string | string[] | null> = {}): string {
  const url = new URL("https://idp.example/authorize");
  const all: Record<string, string | string[] | null> = {
    response_type: "code",
    redirect_uri: REDIRECT,
    state: STATE,
    ...params,
  };
  for (const [key, value] of Object.entries(all)) {
    if (value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
  }
  return url.href;
}

const callback = (extra = "") =>
  `${REDIRECT}?code=c1&state=${STATE}&iss=https%3A%2F%2Fidp.example%2F${extra}`;

/** A host whose listener and calls the test controls. */
function fakeHost() {
  const events: string[] = [];
  let listener: ((urls: string[]) => void) | null = null;
  let lastHandler: ((urls: string[]) => void) | null = null;
  let resolveListen: (stop: () => void) => void = () => undefined;
  const unlisten = vi.fn(() => {
    events.push("unlisten");
    listener = null;
  });
  const host = {
    openUrl: vi.fn(async (url: string) => {
      events.push(`open ${url}`);
    }),
    onOpenUrl: vi.fn(async (handler: (urls: string[]) => void) => {
      events.push("listen");
      listener = handler;
      lastHandler = handler;
      return unlisten;
    }),
  };
  return {
    host,
    events,
    unlisten,
    deliver(urls: unknown) {
      if (listener === null) throw new Error("not listening");
      listener(urls as string[]);
    },
    /** Delivers through the handler even after the session stopped listening (a misbehaving host). */
    deliverLate(urls: unknown) {
      if (lastHandler === null) throw new Error("never listened");
      lastHandler(urls as string[]);
    },
    /** Make the next onOpenUrl hang until `release` is called. */
    holdListen() {
      host.onOpenUrl.mockImplementationOnce(async (handler) => {
        events.push("listen");
        listener = handler;
        return new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        });
      });
      return () => resolveListen(unlisten);
    },
    get listening() {
      return listener !== null;
    },
  };
}

function timers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    setTimeout: vi.fn((callback: () => void, _ms: number) => {
      next += 1;
      pending.set(next, callback);
      return next;
    }),
    clearTimeout: vi.fn((handle: unknown) => {
      pending.delete(handle as number);
    }),
    fire() {
      const all = [...pending.values()];
      pending.clear();
      for (const callback of all) callback();
    },
    get size() {
      return pending.size;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createDesktopAuthSession configuration", () => {
  test.each([
    ["no host", undefined],
    ["null host", null],
    ["no openUrl", { onOpenUrl: async () => () => undefined }],
    ["no onOpenUrl", { openUrl: async () => undefined }],
    ["openUrl not a function", { openUrl: "x", onOpenUrl: async () => () => undefined }],
  ])("rejects a host with %s", (_name, host) => {
    expect(() => createDesktopAuthSession({ host: host as unknown as DesktopHost })).toThrow(
      TypeError,
    );
  });

  test.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    60 * 60 * 1000 + 1,
  ])("rejects timeoutMs %s", (timeoutMs) => {
    expect(() => createDesktopAuthSession({ host: fakeHost().host, timeoutMs })).toThrow(TypeError);
  });

  test("accepts the one-hour maximum and the default", () => {
    expect(() =>
      createDesktopAuthSession({ host: fakeHost().host, timeoutMs: 60 * 60 * 1000 }),
    ).not.toThrow();
    expect(() => createDesktopAuthSession({ host: fakeHost().host })).not.toThrow();
  });
});

describe("authenticate", () => {
  test("listens before opening the browser and resolves with the matching callback", async () => {
    const fake = fakeHost();
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const url = authorizationUrl();
    const result = session.authenticate({ url, callbackScheme: SCHEME });
    await flush();
    expect(fake.events).toEqual(["listen", `open ${url}`]);
    expect(clock.size).toBe(1);
    fake.deliver([callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(clock.size).toBe(0);
  });

  test("hands the host only the authorization URL", async () => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const url = authorizationUrl();
    const result = session.authenticate({ url, callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await result;
    expect(fake.host.openUrl.mock.calls).toEqual([[url]]);
  });

  test.each([
    ["a non-string", 42],
    ["null", null],
    ["an unparsable URL", "not a url"],
    ["another scheme", `com.other.app:/oauth/callback?state=${STATE}`],
    ["https", `https://evil.example/oauth/callback?state=${STATE}`],
    ["an authority", `${SCHEME}://evil.example/oauth/callback?state=${STATE}`],
    ["another path", `${SCHEME}:/oauth/other?state=${STATE}`],
    ["a path with a segment added", `${SCHEME}:/oauth/callback/x?state=${STATE}`],
    ["a path with a suffix", `${SCHEME}:/oauth/callbackx?state=${STATE}`],
    ["a path with a trailing slash", `${SCHEME}:/oauth/callback/?state=${STATE}`],
    ["a prefix of the path", `${SCHEME}:/oauth?state=${STATE}`],
    ["a state our state is a prefix of", `${SCHEME}:/oauth/callback?code=c1&state=${STATE}x`],
    ["a prefix of our state", `${SCHEME}:/oauth/callback?code=c1&state=state-`],
    ["a state in another case", `${SCHEME}:/oauth/callback?code=c1&state=STATE-1`],
    ["one right and one wrong state", `${SCHEME}:/oauth/callback?state=${STATE}&state=other`],
    ["no state", `${SCHEME}:/oauth/callback?code=c1`],
    ["another state", `${SCHEME}:/oauth/callback?code=c1&state=other`],
    ["an empty state", `${SCHEME}:/oauth/callback?code=c1&state=`],
    ["a repeated state", `${SCHEME}:/oauth/callback?code=c1&state=${STATE}&state=${STATE}`],
  ])("ignores %s and keeps waiting", async (_name, noise) => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([noise]);
    await flush();
    expect(fake.listening).toBe(true);
    expect(fake.unlisten).not.toHaveBeenCalled();
    fake.deliver([noise, callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
  });

  // Forms that match today, pinned so that accepting them stays a deliberate choice. The driver
  // still applies its own checks (it rejects a fragment, for example).
  test.each([
    ["an empty authority", `${SCHEME}:///oauth/callback?code=c1&state=${STATE}`],
    ["a fragment", `${REDIRECT}?code=c1&state=${STATE}#frag`],
    ["a percent-encoded state", `${REDIRECT}?code=c1&state=state%2D1`],
  ])("matches %s", async (_name, accepted) => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([accepted]);
    await expect(result).resolves.toEqual({ url: accepted });
  });

  test("ignores a batch that is not an array", async () => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver(callback());
    fake.deliver(undefined);
    await flush();
    expect(fake.listening).toBe(true);
    fake.deliver([callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
  });

  test("accepts a callback of exactly the maximum length and ignores a longer one", async () => {
    const base = callback("&pad=");
    const exact = base + "a".repeat(MAX_CALLBACK_LENGTH - base.length);
    expect(exact.length).toBe(MAX_CALLBACK_LENGTH);
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([`${exact}a`]);
    await flush();
    expect(fake.listening).toBe(true);
    fake.deliver([exact]);
    await expect(result).resolves.toEqual({ url: exact });
  });

  test("takes the first match in a batch", async () => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback("&n=1"), callback("&n=2")]);
    await expect(result).resolves.toEqual({ url: callback("&n=1") });
  });

  test.each([
    ["an unparsable authorization URL", "not a url"],
    ["no state", authorizationUrl({ state: null })],
    ["an empty state", authorizationUrl({ state: "" })],
    ["two states", authorizationUrl({ state: ["a", "b"] })],
    ["no redirect_uri", authorizationUrl({ redirect_uri: null })],
    ["two redirect_uris", authorizationUrl({ redirect_uri: [REDIRECT, REDIRECT] })],
    ["an unparsable redirect_uri", authorizationUrl({ redirect_uri: "nope" })],
    ["a redirect_uri on another scheme", authorizationUrl({ redirect_uri: "com.other.app:/cb" })],
  ])("fails closed on %s without touching the host", async (_name, url) => {
    const fake = fakeHost();
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    await expect(session.authenticate({ url, callbackScheme: SCHEME })).rejects.toMatchObject({
      code: HOST_FAILED,
    });
    expect(fake.host.onOpenUrl).not.toHaveBeenCalled();
    expect(fake.host.openUrl).not.toHaveBeenCalled();
    expect(clock.size).toBe(0);
  });

  test.each([
    ["a file: URL", "file:///C:/Windows/System32/calc.exe"],
    ["an http: URL", "http://idp.example/authorize"],
    ["a URL with a username", "https://user@idp.example/authorize"],
    ["a URL with a password", "https://:secret@idp.example/authorize"],
  ])("never opens %s", async (_name, target) => {
    const fake = fakeHost();
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const url = new URL(authorizationUrl());
    const request = new URL(target);
    for (const [key, value] of url.searchParams) request.searchParams.append(key, value);
    await expect(
      session.authenticate({ url: request.href, callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.host.onOpenUrl).not.toHaveBeenCalled();
    expect(fake.host.openUrl).not.toHaveBeenCalled();
    expect(clock.size).toBe(0);
  });

  test("fails when the host cannot listen, without opening the browser", async () => {
    const fake = fakeHost();
    fake.host.onOpenUrl.mockRejectedValueOnce(new Error("no deep links"));
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.host.openUrl).not.toHaveBeenCalled();
    expect(clock.size).toBe(0);
  });

  test("fails when the host's listen returns no stop function", async () => {
    const fake = fakeHost();
    fake.host.onOpenUrl.mockResolvedValueOnce("nope" as unknown as () => void);
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.host.openUrl).not.toHaveBeenCalled();
  });

  test("fails and stops listening when the browser cannot open", async () => {
    const fake = fakeHost();
    fake.host.openUrl.mockRejectedValueOnce(new Error("no browser"));
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
  });

  test("times out, stops listening and ignores a late callback", async () => {
    const fake = fakeHost();
    const clock = timers();
    const ignored = vi.fn();
    const session = createDesktopAuthSession({
      host: fake.host,
      ...clock,
      timeoutMs: 1234,
      onIgnored: ignored,
    });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    expect(clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1234);
    clock.fire();
    await expect(result).rejects.toMatchObject({ code: TIMED_OUT });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(fake.listening).toBe(false);
    // The host delivers anyway: neither a genuine callback nor noise has any effect.
    fake.deliverLate([callback(), "not a url"]);
    await flush();
    expect(ignored).not.toHaveBeenCalled();
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(clock.clearTimeout).toHaveBeenCalledTimes(1);
    // The session is free for the next sign-in, which the late callback did not touch.
    const next = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback("&n=2")]);
    await expect(next).resolves.toEqual({ url: callback("&n=2") });
  });

  test("uses the global timers by default", async () => {
    vi.useFakeTimers();
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    const assertion = expect(result).rejects.toMatchObject({ code: TIMED_OUT });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await assertion;
    // A settled sign-in clears its own timer through the global clearTimeout.
    const second = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await vi.advanceTimersByTimeAsync(0);
    fake.deliver([callback()]);
    await expect(second).resolves.toEqual({ url: callback() });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a delivery after the sign-in settled changes nothing", async () => {
    const fake = fakeHost();
    const clock = timers();
    const ignored = vi.fn();
    const session = createDesktopAuthSession({ host: fake.host, ...clock, onIgnored: ignored });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback("&n=1")]);
    await expect(result).resolves.toEqual({ url: callback("&n=1") });
    // A host that keeps delivering after unlisten: no second settle, no timer or stop calls, and
    // not even the ignored-URL hook, which only runs for a live sign-in.
    fake.deliverLate([callback("&n=2")]);
    fake.deliverLate(["not a url"]);
    await flush();
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(clock.clearTimeout).toHaveBeenCalledTimes(1);
    expect(ignored).not.toHaveBeenCalled();
  });

  test("stops at the first match in a batch, without reporting the rest", async () => {
    const fake = fakeHost();
    const ignored = vi.fn();
    const session = createDesktopAuthSession({ host: fake.host, ...timers(), onIgnored: ignored });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback("&n=1"), "not a url"]);
    await expect(result).resolves.toEqual({ url: callback("&n=1") });
    expect(ignored).not.toHaveBeenCalled();
  });

  test("a timer that fires after the sign-in settled changes nothing", async () => {
    const fake = fakeHost();
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const first = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    const staleTimer = clock.setTimeout.mock.calls[0]?.[0] as () => void;
    fake.deliver([callback("&n=1")]);
    await expect(first).resolves.toEqual({ url: callback("&n=1") });
    // The next sign-in is pending when the first one's timer misfires.
    const second = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    staleTimer();
    await flush();
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    await session.cancel();
    await expect(second).rejects.toMatchObject({ code: USER_CANCELLED });
  });

  test("a match delivered inside onOpenUrl, before it resolves, settles once and stops listening", async () => {
    const fake = fakeHost();
    const stop = vi.fn();
    fake.host.onOpenUrl.mockImplementationOnce(async (handler) => {
      handler([callback()]);
      return stop;
    });
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await expect(result).resolves.toEqual({ url: callback() });
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fake.host.openUrl).not.toHaveBeenCalled();
    expect(clock.size).toBe(0);
  });

  test("an old URL delivered before onOpenUrl resolves is ignored", async () => {
    const fake = fakeHost();
    const ignored = vi.fn();
    let live: (urls: string[]) => void = () => undefined;
    fake.host.onOpenUrl.mockImplementationOnce(async (handler) => {
      live = handler;
      handler([`${REDIRECT}?code=old&state=old`]);
      return fake.unlisten;
    });
    const session = createDesktopAuthSession({ host: fake.host, ...timers(), onIgnored: ignored });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    expect(ignored).toHaveBeenCalledWith("wrong-state");
    expect(fake.host.openUrl).toHaveBeenCalledTimes(1);
    live([callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
  });

  test("a synchronous throw from onOpenUrl fails as HOST_FAILED and leaves the session usable", async () => {
    const fake = fakeHost();
    fake.host.onOpenUrl.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.host.openUrl).not.toHaveBeenCalled();
    expect(clock.size).toBe(0);
    const again = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await expect(again).resolves.toEqual({ url: callback() });
  });

  test("a synchronous throw from openUrl fails as HOST_FAILED, stops listening and leaves the session usable", async () => {
    const fake = fakeHost();
    fake.host.openUrl.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    const again = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await expect(again).resolves.toEqual({ url: callback() });
  });

  test("swallows a failing unlisten", async () => {
    const fake = fakeHost();
    fake.unlisten.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
  });

  test("refuses a second sign-in while one is pending, then allows one after", async () => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const first = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    await flush();
    fake.deliver([callback()]);
    await first;
    const again = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await expect(again).resolves.toEqual({ url: callback() });
  });
});

describe("cancel", () => {
  test("does nothing when no sign-in is pending", async () => {
    const session = createDesktopAuthSession({ host: fakeHost().host, ...timers() });
    await expect(session.cancel()).resolves.toBeUndefined();
  });

  test("rejects the pending sign-in as cancelled and stops listening", async () => {
    const fake = fakeHost();
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    await session.cancel();
    await expect(result).rejects.toMatchObject({ code: USER_CANCELLED });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(clock.size).toBe(0);
  });

  test("before the listener is ready, stops it once ready and never opens the browser", async () => {
    const fake = fakeHost();
    const release = fake.holdListen();
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    await session.cancel();
    await expect(result).rejects.toMatchObject({ code: USER_CANCELLED });
    expect(fake.unlisten).not.toHaveBeenCalled();
    release();
    await flush();
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(fake.host.openUrl).not.toHaveBeenCalled();
  });

  test("a timeout before the listener is ready also stops it once ready", async () => {
    const fake = fakeHost();
    const release = fake.holdListen();
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    clock.fire();
    await expect(result).rejects.toMatchObject({ code: TIMED_OUT });
    release();
    await flush();
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(fake.host.openUrl).not.toHaveBeenCalled();
  });

  test("a browser failure after cancel changes nothing, even for the next sign-in", async () => {
    const fake = fakeHost();
    let failOpen: (error: Error) => void = () => undefined;
    fake.host.openUrl.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failOpen = reject;
        }),
    );
    const clock = timers();
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    await session.cancel();
    await expect(result).rejects.toMatchObject({ code: USER_CANCELLED });
    const second = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    failOpen(new Error("late"));
    await flush();
    // The late failure neither rejected the second sign-in nor unregistered its cancel.
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(clock.clearTimeout).toHaveBeenCalledTimes(1);
    await session.cancel();
    await expect(second).rejects.toMatchObject({ code: USER_CANCELLED });
  });

  test("a sign-in started right after a cancel works while the cancelled one is still registering", async () => {
    const events: string[] = [];
    const handlers: Array<(urls: string[]) => void> = [];
    let releaseFirst: (stop: () => void) => void = () => undefined;
    const stopFirst = vi.fn(() => void events.push("stop first"));
    const stopSecond = vi.fn(() => void events.push("stop second"));
    const openUrl = vi.fn(async (url: string) => void events.push(`open ${url}`));
    const onOpenUrl = vi
      .fn()
      .mockImplementationOnce(async (handler: (urls: string[]) => void) => {
        handlers.push(handler);
        return new Promise<() => void>((resolve) => {
          releaseFirst = resolve;
        });
      })
      .mockImplementationOnce(async (handler: (urls: string[]) => void) => {
        handlers.push(handler);
        return stopSecond;
      });
    const session = createDesktopAuthSession({ host: { openUrl, onOpenUrl }, ...timers() });
    const first = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    await session.cancel();
    await expect(first).rejects.toMatchObject({ code: USER_CANCELLED });
    const url = authorizationUrl({ state: "state-2" });
    const second = session.authenticate({ url, callbackScheme: SCHEME });
    await flush();
    releaseFirst(stopFirst);
    await flush();
    // The first registration is closed on its own, without opening a browser or touching the second.
    expect(stopFirst).toHaveBeenCalledTimes(1);
    expect(stopSecond).not.toHaveBeenCalled();
    expect(events).toEqual([`open ${url}`, "stop first"]);
    handlers[1]?.([`${REDIRECT}?code=c2&state=state-2`]);
    await expect(second).resolves.toEqual({ url: `${REDIRECT}?code=c2&state=state-2` });
    expect(stopSecond).toHaveBeenCalledTimes(1);
  });
});

describe("injected timers", () => {
  test("a throwing setTimeout fails the sign-in as HOST_FAILED and leaves the session usable", async () => {
    const fake = fakeHost();
    const clock = timers();
    clock.setTimeout.mockImplementationOnce(() => {
      throw new Error("no timers");
    });
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    await expect(
      session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME }),
    ).rejects.toMatchObject({ code: HOST_FAILED });
    expect(fake.host.onOpenUrl).not.toHaveBeenCalled();
    expect(fake.host.openUrl).not.toHaveBeenCalled();
    const again = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await expect(again).resolves.toEqual({ url: callback() });
  });

  test("a throwing clearTimeout does not stop the sign-in settling or the listener closing", async () => {
    const fake = fakeHost();
    const clock = timers();
    clock.clearTimeout.mockImplementationOnce(() => {
      throw new Error("cannot clear");
    });
    const session = createDesktopAuthSession({ host: fake.host, ...clock });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("stop functions", () => {
  test("an async stop function that rejects causes no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const fake = fakeHost();
      const stop = vi.fn(async () => {
        throw new Error("async boom");
      });
      fake.host.onOpenUrl.mockImplementationOnce(async () => stop);
      const session = createDesktopAuthSession({ host: fake.host, ...timers() });
      const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
      await flush();
      await session.cancel();
      await expect(result).rejects.toMatchObject({ code: USER_CANCELLED });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stop).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("onIgnored", () => {
  const tooLong = `${REDIRECT}?state=${STATE}&pad=${"a".repeat(MAX_CALLBACK_LENGTH)}`;
  test.each<[IgnoredReason, unknown]>([
    ["not-a-string", 42],
    ["too-long", tooLong],
    ["not-a-url", "not a url"],
    ["wrong-redirect", `com.other.app:/oauth/callback?state=${STATE}`],
    ["wrong-redirect", `${REDIRECT}/x?state=${STATE}`],
    ["wrong-state", `${REDIRECT}?code=c1`],
    ["wrong-state", `${REDIRECT}?state=other`],
    ["wrong-state", `${REDIRECT}?state=${STATE}&state=${STATE}`],
  ])("reports %s", async (reason, noise) => {
    const fake = fakeHost();
    const ignored = vi.fn();
    const session = createDesktopAuthSession({ host: fake.host, ...timers(), onIgnored: ignored });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver([noise]);
    expect(ignored.mock.calls).toEqual([[reason]]);
    fake.deliver([callback()]);
    await result;
    expect(ignored).toHaveBeenCalledTimes(1);
  });

  test("reports once for each ignored URL in a batch and never passes the URL", async () => {
    const fake = fakeHost();
    const ignored = vi.fn();
    const session = createDesktopAuthSession({ host: fake.host, ...timers(), onIgnored: ignored });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    const secret = `${REDIRECT}?code=secret-code&state=secret-state`;
    fake.deliver([secret, "not a url", tooLong, callback()]);
    await result;
    expect(ignored.mock.calls).toEqual([["wrong-state"], ["not-a-url"], ["too-long"]]);
    for (const call of ignored.mock.calls) {
      expect(call).toHaveLength(1);
      expect(JSON.stringify(call)).not.toContain("secret");
    }
  });

  test("swallows a throwing hook and keeps waiting", async () => {
    const fake = fakeHost();
    const session = createDesktopAuthSession({
      host: fake.host,
      ...timers(),
      onIgnored: () => {
        throw new Error("log failed");
      },
    });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    fake.deliver(["not a url", callback()]);
    await expect(result).resolves.toEqual({ url: callback() });
  });

  test("rejects a hook that is not a function", () => {
    expect(() =>
      createDesktopAuthSession({
        host: fakeHost().host,
        onIgnored: "log" as unknown as () => void,
      }),
    ).toThrow(TypeError);
  });
});
