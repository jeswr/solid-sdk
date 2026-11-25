// AUTHORED-BY Claude Opus 5.5
import { USER_CANCELLED } from "@jeswr/suite-native";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createDesktopAuthSession,
  type DesktopHost,
  HOST_FAILED,
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
    const session = createDesktopAuthSession({ host: fake.host, ...clock, timeoutMs: 1234 });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    expect(clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1234);
    clock.fire();
    await expect(result).rejects.toMatchObject({ code: TIMED_OUT });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(fake.listening).toBe(false);
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
    let captured: ((urls: string[]) => void) | undefined;
    fake.host.onOpenUrl.mockImplementationOnce(async (handler) => {
      captured = handler;
      return () => undefined;
    });
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    captured?.([callback("&n=1")]);
    captured?.([callback("&n=2")]);
    await expect(result).resolves.toEqual({ url: callback("&n=1") });
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

  test("a browser failure after cancel changes nothing", async () => {
    const fake = fakeHost();
    let failOpen: (error: Error) => void = () => undefined;
    fake.host.openUrl.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failOpen = reject;
        }),
    );
    const session = createDesktopAuthSession({ host: fake.host, ...timers() });
    const result = session.authenticate({ url: authorizationUrl(), callbackScheme: SCHEME });
    await flush();
    await session.cancel();
    failOpen(new Error("late"));
    await expect(result).rejects.toMatchObject({ code: USER_CANCELLED });
  });
});
