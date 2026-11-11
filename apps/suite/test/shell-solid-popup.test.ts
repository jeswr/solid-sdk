// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSolidLoginPopup } from "../src/shell/session/solid-popup";

const redirect = "https://suite.example/auth/callback.html";
const callback = `${redirect}?code=example-code&state=example-state&iss=https%3A%2F%2Fid.example%2F`;
const callbackHtml = readFileSync(new URL("../public/auth/callback.html", import.meta.url), "utf8");
const callbackScript = /<script>([\s\S]*?)<\/script>/u.exec(callbackHtml)?.[1];
if (!callbackScript) throw new Error("Missing callback bridge script");
function harness() {
  const popup = { closed: false, location: { href: "about:blank" }, close: vi.fn() };
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const host = {
    open: vi.fn(() => popup),
    addEventListener: vi.fn((_type: string, handler: (event: MessageEvent<unknown>) => void) => {
      listeners.add(handler);
    }),
    removeEventListener: vi.fn((_type: string, handler: (event: MessageEvent<unknown>) => void) => {
      listeners.delete(handler);
    }),
  };
  vi.stubGlobal("window", host);
  const send = (overrides: Record<string, unknown> = {}) => {
    const event = {
      origin: "https://suite.example",
      source: popup,
      data: { type: "solid-suite:auth-callback", url: callback },
      ...overrides,
    };
    for (const listener of listeners) listener(event as unknown as MessageEvent<unknown>);
  };
  return { popup, host, listeners, send };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Solid authorization popup", () => {
  it("lets the validated opener close even when callback delivery misses a cancellation poll", async () => {
    const h = harness();
    const controller = openSolidLoginPopup(redirect);
    const code = controller.getCode(
      new URL("https://id.example/authorize"),
      new AbortController().signal,
    );
    void code.catch(() => {});
    const close = vi.fn(() => {
      h.popup.closed = true;
    });
    runInNewContext(callbackScript, {
      window: {
        close,
        opener: {
          location: { origin: "https://suite.example" },
          postMessage: (data: unknown, origin: string) => {
            expect(origin).toBe("https://suite.example");
            setTimeout(() => h.send({ data }), 500);
          },
        },
      },
      location: { href: callback, origin: "https://suite.example" },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.listeners.size).toBe(1);
    expect(h.popup.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    await expect(code).resolves.toBe(callback);
    expect(close).not.toHaveBeenCalled();
    expect(h.popup.close).toHaveBeenCalledOnce();
  });

  it("never posts a callback to a foreign opener", () => {
    const postMessage = vi.fn();
    const replace = vi.fn();
    const setItem = vi.fn();
    runInNewContext(callbackScript, {
      window: { opener: { location: { origin: "https://attacker.example" }, postMessage } },
      location: { href: callback, origin: "https://suite.example", replace },
      sessionStorage: { setItem },
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledWith("suite.auth.callback", callback);
    expect(replace).toHaveBeenCalledWith("/signin?callback=1");
  });
  it("opens synchronously and reports popup blocking", () => {
    const h = harness();
    openSolidLoginPopup(redirect);
    expect(h.host.open).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      expect.stringContaining("popup=yes"),
    );
    h.host.open.mockReturnValue(null as unknown as typeof h.popup);
    expect(() => openSolidLoginPopup(redirect)).toThrow("Allow popups");
  });

  it("accepts only the opened window, app origin, message type and exact callback path", async () => {
    const h = harness();
    const controller = openSolidLoginPopup(redirect);
    const code = controller.getCode(
      new URL("https://id.example/authorize"),
      new AbortController().signal,
    );
    expect(h.popup.location.href).toBe("https://id.example/authorize");
    for (const invalid of [
      { origin: "https://attacker.example" },
      { source: {} },
      { data: null },
      { data: callback },
      { data: { type: "other", url: callback } },
      { data: { type: "solid-suite:auth-callback", url: 3 } },
      { data: { type: "solid-suite:auth-callback", url: "not-a-url" } },
      {
        data: {
          type: "solid-suite:auth-callback",
          url: "https://attacker.example/auth/callback.html",
        },
      },
      { data: { type: "solid-suite:auth-callback", url: "https://suite.example/other" } },
      {
        data: {
          type: "solid-suite:auth-callback",
          url: "https://user:pass@suite.example/auth/callback.html",
        },
      },
    ])
      h.send(invalid);
    expect(h.listeners.size).toBe(1);
    expect(h.popup.close).not.toHaveBeenCalled();
    h.send();
    expect(await code).toBe(callback);
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.popup.close).toHaveBeenCalledOnce();
  });

  it.each(["abort", "close", "timeout", "user-close"])("cleans up on %s", async (reason) => {
    const h = harness();
    const controller = openSolidLoginPopup(redirect);
    const abort = new AbortController();
    const code = controller.getCode(new URL("https://id.example/authorize"), abort.signal);
    const failure = expect(code).rejects.toThrow();
    if (reason === "abort") abort.abort();
    if (reason === "close") controller.close();
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(300_000);
    if (reason === "user-close") {
      h.popup.closed = true;
      await vi.advanceTimersByTimeAsync(250);
    }
    await failure;
    expect(h.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors an already aborted signal without navigating", async () => {
    const h = harness();
    const controller = openSolidLoginPopup(redirect);
    await expect(
      controller.getCode(new URL("https://id.example/authorize"), AbortSignal.abort()),
    ).rejects.toThrow();
    expect(h.popup.location.href).toBe("about:blank");
    expect(h.listeners.size).toBe(0);
    expect(h.popup.close).toHaveBeenCalledOnce();
  });
});
