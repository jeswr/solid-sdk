// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";
import {
  PopupBlockedError,
  PopupLoginController,
  type MessageEventLike,
  type OpenerWindowLike,
} from "./popup-login";

const ORIGIN = "https://manager.example";
const URL_AUTH = new URL("https://provider.example/authorize?state=check");
const CALLBACK = `${ORIGIN}/callback.html?code=complete&state=check&iss=https%3A%2F%2Fprovider.example%2F`;
function setup() {
  const listeners = new Set<(event: MessageEventLike) => void>();
  const popup = {
    location: { href: "about:blank" },
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
  };
  const windowRef = {
    open: vi.fn(() => popup),
    addEventListener: (_: "message", callback: (event: MessageEventLike) => void) => {
      listeners.add(callback);
    },
    removeEventListener: (_: "message", callback: (event: MessageEventLike) => void) => {
      listeners.delete(callback);
    },
  } satisfies OpenerWindowLike;
  const controller = new PopupLoginController({
    expectedOrigin: ORIGIN,
    windowRef,
    pollMs: 20,
    timeoutMs: 500,
  });
  const message = (overrides: Partial<MessageEventLike> = {}) => {
    for (const listener of listeners)
      listener({ origin: ORIGIN, source: popup, data: CALLBACK, ...overrides });
  };
  return { controller, windowRef, popup, listeners, message };
}
afterEach(() => vi.useRealTimers());
describe("gesture-owned popup", () => {
  it("pre-opens synchronously, navigates without another open, and returns the entire callback", async () => {
    const { controller, windowRef, popup, listeners, message } = setup();
    controller.open();
    expect(windowRef.open).toHaveBeenCalledExactlyOnceWith(
      "about:blank",
      "podManagerLogin",
      expect.any(String),
    );
    const result = controller.getCode(URL_AUTH, new AbortController().signal);
    expect(popup.location.href).toBe(URL_AUTH.href);
    expect(windowRef.open).toHaveBeenCalledOnce();
    for (const bad of [
      { origin: "https://foreign.example" },
      { source: {} },
      { data: 12 },
      { data: "not a URL" },
      { data: `${ORIGIN}/other?code=bad` },
      { data: "https://foreign.example/callback.html?code=bad" },
    ])
      message(bad);
    expect(listeners.size).toBe(1);
    expect(popup.closed).toBe(false);
    message();
    expect(await result).toBe(CALLBACK);
    expect(popup.close).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
  it("declines a code request without a pre-opened window", async () => {
    const { controller, windowRef } = setup();
    await expect(controller.getCode(URL_AUTH, new AbortController().signal)).rejects.toBeInstanceOf(
      CodeRequestCancelledError,
    );
    expect(windowRef.open).not.toHaveBeenCalled();
  });
  it.each([
    "none",
    "none consent",
  ])("always declines prompt=%s, even with a gesture window", async (prompt) => {
    const { controller, windowRef, popup } = setup();
    controller.open();
    const url = new URL(URL_AUTH);
    url.searchParams.set("prompt", prompt);
    await expect(controller.getCode(url, new AbortController().signal)).rejects.toBeInstanceOf(
      CodeRequestCancelledError,
    );
    expect(windowRef.open).toHaveBeenCalledOnce();
    expect(popup.closed).toBe(true);
  });
  it.each([true, false])("closes and rejects on abort (already aborted: %s)", async (early) => {
    const { controller, popup, listeners } = setup();
    controller.open();
    const abort = new AbortController();
    if (early) abort.abort();
    const result = controller.getCode(URL_AUTH, abort.signal);
    if (!early) abort.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(popup.closed).toBe(true);
    expect(listeners.size).toBe(0);
  });
  it("cancel and unused-session cleanup close the window", async () => {
    const { controller, popup, listeners } = setup();
    controller.open();
    const result = controller.getCode(URL_AUTH, new AbortController().signal);
    controller.cancel();
    controller.cancel();
    await expect(result).rejects.toBeInstanceOf(CodeRequestCancelledError);
    expect(popup.close).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    const unused = setup();
    unused.controller.open();
    unused.controller.closeIfOpen();
    expect(unused.popup.closed).toBe(true);
  });
  it("detects user close and timeouts without leaving listeners or timers", async () => {
    vi.useFakeTimers();
    for (const close of [true, false]) {
      const { controller, popup, listeners } = setup();
      controller.open();
      const result = controller.getCode(URL_AUTH, new AbortController().signal);
      const failure = expect(result).rejects.toMatchObject({
        name: close ? "CodeRequestCancelledError" : "PopupTimeoutError",
      });
      if (close) popup.closed = true;
      await vi.advanceTimersByTimeAsync(500);
      await failure;
      expect(listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it("reports blocked windows from the click without navigating", () => {
    const windowRef: OpenerWindowLike = {
      open: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const controller = new PopupLoginController({ expectedOrigin: ORIGIN, windowRef });
    expect(() => controller.open()).toThrow(PopupBlockedError);
    expect(windowRef.addEventListener).not.toHaveBeenCalled();
  });
  it("cleans up when navigation throws", async () => {
    const { controller, popup, listeners } = setup();
    controller.open();
    Object.defineProperty(popup.location, "href", {
      set() {
        throw new Error("closed");
      },
    });
    await expect(controller.getCode(URL_AUTH, new AbortController().signal)).rejects.toThrow(
      "closed",
    );
    expect(listeners.size).toBe(0);
    expect(popup.closed).toBe(true);
  });
});
