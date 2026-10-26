// AUTHORED-BY GPT-5.6 Codex
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CAPABILITIES, checkFixture } from "../e2e/checks.ts";

const script = (name: string) =>
  readFileSync(new URL(`../e2e/fixture/${name}.js`, import.meta.url), "utf8");
const suiteOrigin = "http://localhost:4173";
const foreignOrigin = "http://localhost:4174";
const verdict = (attempts: unknown) =>
  checkFixture(
    {
      page: "index",
      done: true,
      origin: suiteOrigin,
      topBridge: true,
      listenerReady: true,
      errors: [],
      capabilities: Object.fromEntries(CAPABILITIES.map((key) => [key, true])),
      hostile: { origin: foreignOrigin, attempts },
    },
    suiteOrigin,
    foreignOrigin,
  );
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function hostile(window: object, advance = 0, ios = false) {
  const postMessage = vi.fn();
  const context = createContext({
    window,
    location: {
      origin: foreignOrigin,
      search: `?parent=${encodeURIComponent(suiteOrigin)}&nonce=probe${ios ? "&platform=ios" : ""}`,
    },
    URLSearchParams,
    parent: { postMessage },
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
  });
  if (ios) runInContext(script("ios-probes"), context);
  const completion = runInContext(script("hostile"), context);
  await vi.advanceTimersByTimeAsync(advance);
  await completion;
  expect(postMessage).toHaveBeenCalledOnce();
  expect(postMessage.mock.calls[0]?.[1]).toBe(suiteOrigin);
  const message = postMessage.mock.calls[0]?.[0];
  expect(message.nonce).toBe("probe");
  expect(message.result.origin).toBe(foreignOrigin);
  return message.result.attempts;
}

describe("hostile-frame JavaScript", () => {
  test("iOS sends a typed getPending message and the actual Capacitor prompt command", async () => {
    const postMessage = vi.fn();
    const prompt = vi.fn(() => null);
    const attempts = await hostile(
      { webkit: { messageHandlers: { bridge: { postMessage } } }, prompt },
      2000,
      true,
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: "message",
      callbackId: "mob07-hostile-probe-webkit",
      pluginId: "SuiteShareIntake",
      methodName: "getPending",
      options: {},
    });
    expect(prompt).toHaveBeenCalledWith(JSON.stringify({ type: "CapacitorCookies.isEnabled" }));
    expect(attempts).toEqual({
      webkitBridge: {
        status: "no-response",
        callbackId: "mob07-hostile-probe-webkit",
        observedMs: 2000,
        data: undefined,
      },
      prompt: { status: "no-response", observedMs: 2000, value: null },
    });
  });
  test("iOS records native effects and preserves normal callback delivery", async () => {
    const original = vi.fn();
    const window = {
      Capacitor: { fromNative: original },
      webkit: {
        messageHandlers: {
          bridge: {
            postMessage: (call: object) => {
              window.Capacitor.fromNative({ ...call, success: true, data: { batches: [] } });
            },
          },
        },
      },
      prompt: vi.fn(() => "false"),
    };
    const attempts = await hostile(window, 2000, true);
    expect(attempts.webkitBridge.status).toBe("resolved");
    expect(attempts.prompt.status).toBe("response");
    expect(original).toHaveBeenCalledOnce();
  });
  test("missing or throwing iOS transports fail instead of claiming isolation", async () => {
    const attempts = await hostile(
      {
        prompt: () => {
          throw new Error("broken");
        },
      },
      0,
      true,
    );
    expect(attempts.webkitBridge.status).toBe("error");
    expect(attempts.prompt.status).toBe("error");
  });
  test("reports unavailable native transports", async () => {
    const attempts = await hostile({});
    expect(Object.keys(attempts)).toHaveLength(5);
    for (const attempt of Object.values(attempts))
      expect(attempt).toEqual({ status: "unavailable" });
    expect(verdict(attempts)).toEqual([]);
  });
  test("calls the real interface methods and fails even when isEnabled returns false", async () => {
    const postMessage = vi.fn();
    const cookies = vi.fn(() => false);
    const http = vi.fn(() => false);
    const getPending = vi.fn(async () => ({ batches: [] }));
    const attempts = await hostile({
      androidBridge: { postMessage },
      CapacitorCookiesAndroidInterface: { isEnabled: cookies },
      CapacitorHttpAndroidInterface: { isEnabled: http },
      Capacitor: { Plugins: { SuiteShareIntake: { getPending } } },
    });
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0])).toEqual({
      callbackId: "mob07-hostile-probe",
      pluginId: "SuiteShareIntake",
      methodName: "getPending",
      options: {},
    });
    expect(cookies).toHaveBeenCalledOnce();
    expect(http).toHaveBeenCalledOnce();
    expect(getPending).toHaveBeenCalledOnce();
    for (const attempt of Object.values(attempts)) expect(attempt).toEqual({ status: "exposed" });
  });
  test("exposed interfaces fail even when every call throws", async () => {
    const reject = () => {
      throw new Error("Blocked");
    };
    const nativePromise = vi.fn(async () => {
      throw new Error("Blocked");
    });
    const attempts = await hostile({
      androidBridge: { postMessage: reject },
      CapacitorCookiesAndroidInterface: { isEnabled: reject },
      CapacitorHttpAndroidInterface: { isEnabled: reject },
      Capacitor: { nativePromise },
    });
    expect(nativePromise).toHaveBeenCalledWith("SuiteShareIntake", "getPending", {});
    for (const [key, attempt] of Object.entries(attempts)) {
      expect(attempt).toMatchObject({ status: key === "capacitorPlugin" ? "error" : "exposed" });
      expect(verdict(attempts)).toContain(
        `Hostile frame native surface accessible or unproven: ${key}`,
      );
    }
  });
  test.each([
    null,
    {},
    () => {},
  ])("presence fails when the native surface has a different method shape: %j", async (surface) => {
    const attempts = await hostile({
      androidBridge: surface,
      CapacitorCookiesAndroidInterface: surface,
      CapacitorHttpAndroidInterface: surface,
    });
    for (const key of [
      "androidBridge",
      "webMessage",
      "CapacitorCookiesAndroidInterface",
      "CapacitorHttpAndroidInterface",
    ]) {
      expect(attempts[key]).toMatchObject({ status: "exposed" });
      expect(attempts[key].detail).toContain("TypeError");
      expect(verdict(attempts)).toContain(
        `Hostile frame native surface accessible or unproven: ${key}`,
      );
    }
  });
  test.each([
    { Plugins: { SuiteShareIntake: {} } },
    { Plugins: { SuiteShareIntake: null } },
    { nativePromise: false },
    {
      registerPlugin: () => {
        throw new TypeError("bad registration");
      },
    },
    {
      nativePromise: async () => {
        throw new Error("Blocked");
      },
    },
    {
      Plugins: {
        SuiteShareIntake: {
          getPending: () => {
            throw new TypeError("bad proxy");
          },
        },
      },
    },
  ])("plugin probe errors cannot establish isolation: %j", async (Capacitor) => {
    const attempts = await hostile({ Capacitor });
    expect(attempts.capacitorPlugin.status).toBe("error");
    expect(verdict(attempts)).toContain(
      "Hostile frame native surface accessible or unproven: capacitorPlugin",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  test("accepts the identified Capacitor missing-plugin rejection", async () => {
    const attempts = await hostile({
      Capacitor: {
        nativePromise: async () => {
          throw Object.assign(new Error('"SuiteShareIntake" plugin is not implemented on web'), {
            code: "UNIMPLEMENTED",
          });
        },
      },
    });
    expect(attempts.capacitorPlugin.status).toBe("rejected");
    expect(verdict(attempts)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  test("bounds a non-responding generated plugin wrapper", async () => {
    const attempts = await hostile(
      { Capacitor: { registerPlugin: () => ({ getPending: () => new Promise(() => {}) }) } },
      2000,
    );
    expect(attempts.capacitorPlugin.status).toBe("no-response");
    expect(verdict(attempts)).toEqual([]);
    attempts.androidBridge = { status: "exposed" };
    expect(verdict(attempts)).toContain(
      "Hostile frame native surface accessible or unproven: capacitorPlugin",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

function topFrame(hasPlugin = true, ios = false) {
  const listeners = new Map<string, (event: object) => void>();
  const contentWindow = {};
  const frame = { contentWindow, src: "" };
  const result = { value: "" };
  const getPending = vi.fn(async () => ({ batches: [] as object[] }));
  let received: ((batch: object) => void) | undefined;
  const addListener = vi.fn((_name: string, callback: (batch: object) => void) => {
    received = callback;
    const handle = { remove: async () => {} };
    // Capacitor iOS returns the JS removal handle synchronously, without a native response.
    return ios ? handle : Promise.resolve(handle);
  });
  const acknowledge = vi.fn(async () => {});
  const window = {
    isSecureContext: true,
    crypto: { subtle: {} },
    Capacitor: hasPlugin
      ? { Plugins: { SuiteShareIntake: { getPending, addListener, acknowledge } } }
      : undefined,
    addEventListener: (name: string, callback: (event: object) => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const context = createContext({
    window,
    location: { origin: suiteOrigin },
    navigator: { locks: {}, serviceWorker: {} },
    crypto: { randomUUID: () => "nonce" },
    document: { querySelector: (selector: string) => (selector === "#hostile" ? frame : result) },
    fetch: async () => ({ json: async () => ({ suiteOrigin, foreignOrigin }) }),
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
  });
  if (ios) {
    Object.assign(window, {
      webkit: {
        messageHandlers: {
          bridge: {
            postMessage: (call: object) => {
              queueMicrotask(() =>
                context.window.Capacitor.fromNative({
                  ...call,
                  success: true,
                  data: { batches: [] },
                }),
              );
            },
          },
        },
      },
      prompt: vi.fn(() => "false"),
    });
    runInContext(script("ios-probes"), context);
  }
  runInContext(script("index"), context);
  return {
    context,
    listeners,
    frame,
    contentWindow,
    getPending,
    addListener,
    acknowledge,
    result,
    receive: (batch: object) => received?.(batch),
  };
}

describe("top-frame fixture JavaScript", () => {
  test("accepts only the hostile iframe's source, origin, type and nonce", async () => {
    const top = topFrame();
    await vi.advanceTimersByTimeAsync(0);
    const state = top.context.window.__e2e;
    expect(state.topBridge).toBe(true);
    expect(state.listenerReady).toBe(true);
    expect(state.documentId).toBe("nonce");
    expect(state.done).toBe(false);
    expect(top.frame.src).toBe(
      `${foreignOrigin}/hostile.html?parent=${encodeURIComponent(suiteOrigin)}&nonce=nonce`,
    );
    const valid = {
      source: top.contentWindow,
      origin: foreignOrigin,
      data: {
        type: "mob07-hostile",
        nonce: "nonce",
        result: { origin: foreignOrigin, attempts: {} },
      },
    };
    for (const invalid of [
      { ...valid, source: {} },
      { ...valid, origin: suiteOrigin },
      { ...valid, data: { ...valid.data, nonce: "other" } },
      { ...valid, data: { ...valid.data, type: "other" } },
      { ...valid, data: null },
    ]) {
      top.listeners.get("message")?.(invalid);
      await vi.advanceTimersByTimeAsync(0);
      expect(state.done).toBe(false);
    }
    top.listeners.get("message")?.(valid);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.done).toBe(true);
    expect(state.hostile).toEqual(valid.data.result);
    expect(state.errors).toEqual([]);
    expect(top.listeners.has("message")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  test("records events, refreshes pending shares, and acknowledges before clearing events", async () => {
    const top = topFrame();
    await vi.advanceTimersByTimeAsync(0);
    const batch = { id: "batch", items: [{ kind: "text", text: "exact text" }] };
    top.receive(batch);
    top.getPending.mockResolvedValueOnce({ batches: [batch] });
    expect((await top.context.window.__e2eRefreshShares()).pending).toEqual([batch]);
    expect(top.context.window.__e2e.shares.events).toEqual([batch]);
    const cleared = await top.context.window.__e2eAcknowledge("batch");
    expect(top.acknowledge).toHaveBeenCalledWith({ batchId: "batch" });
    expect(cleared).toEqual({ pending: [], events: [] });
  });
  test("fails when the native plugin is missing", async () => {
    const top = topFrame(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(top.context.window.__e2e.done).toBe(true);
    expect(top.context.window.__e2e.errors).toContain("Error: SuiteShareIntake is unavailable");
  });
  test("does not pass without a hostile-frame response", async () => {
    const top = topFrame();
    await vi.advanceTimersByTimeAsync(10000);
    expect(top.context.window.__e2e.done).toBe(true);
    expect(top.context.window.__e2e.hostile).toBeNull();
    expect(top.context.window.__e2e.errors).toContain(
      "Error: Native call or hostile frame timed out",
    );
  });
  test("renders iOS evidence and watches hostile replies delivered to the top frame", async () => {
    const top = topFrame(true, true);
    await vi.advanceTimersByTimeAsync(2000);
    const state = top.context.window.__e2e;
    expect(state.ios.top.webkitBridge).toMatchObject({ status: "resolved", data: { batches: [] } });
    expect(state.ios.top.prompt).toMatchObject({ status: "response", value: "false" });
    expect(state.listenerSubscriptionRequested).toBe(true);
    expect(state).not.toHaveProperty("listenerReady");
    expect(top.frame.src).toContain("&platform=ios");
    top.context.window.Capacitor.fromNative({
      callbackId: "mob07-hostile-nonce-webkit",
      success: true,
      data: { batches: [] },
    });
    top.listeners.get("message")?.({
      source: top.contentWindow,
      origin: foreignOrigin,
      data: {
        type: "mob07-hostile",
        nonce: "nonce",
        result: {
          origin: foreignOrigin,
          attempts: {
            webkitBridge: {
              status: "no-response",
              callbackId: "mob07-hostile-nonce-webkit",
              observedMs: 2000,
            },
            prompt: { status: "no-response", observedMs: 2000, value: null },
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(top.result.value)).toMatchObject({ done: true, platform: "ios" });
    expect(checkFixture(state, suiteOrigin, foreignOrigin, "ios")).toContain(
      "Hostile frame native effect accessible or unproven: webkitBridge",
    );
  });
});

test("navigation fixture attempts the foreign origin and checks the surviving document", async () => {
  const assign = vi.fn();
  const context = createContext({
    window: {},
    location: { origin: suiteOrigin, href: `${suiteOrigin}/navigation.html`, search: "", assign },
    crypto: { randomUUID: () => "navigation-id" },
    URLSearchParams,
    document: { querySelector: () => ({ value: "", addEventListener: vi.fn() }) },
    setTimeout,
    fetch: async () => ({ json: async () => ({ suiteOrigin, foreignOrigin }) }),
  });
  runInContext(script("navigation"), context);
  await vi.advanceTimersByTimeAsync(0);
  expect(assign).toHaveBeenCalledWith(`${foreignOrigin}/foreign.html`);
  expect(context.window.__e2e.done).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  expect(context.window.__e2e).toMatchObject({
    done: true,
    navigation: { attempted: true, refused: true },
  });
});

test("manual navigation exposes a pre-attempt result and waits for a real link activation", async () => {
  const assign = vi.fn();
  const result = { value: "" };
  let click: ((event: { preventDefault: () => void }) => void) | undefined;
  const link = {
    href: "",
    addEventListener: (_name: string, callback: typeof click) => {
      click = callback;
    },
  };
  const location = {
    origin: suiteOrigin,
    href: `${suiteOrigin}/navigation.html?manual=1`,
    search: "?manual=1",
    assign,
  };
  const context = createContext({
    window: {},
    location,
    crypto: { randomUUID: () => "navigation-id" },
    URLSearchParams,
    document: { querySelector: (selector: string) => (selector === "#e2e-result" ? result : link) },
    setTimeout,
    fetch: async () => ({ json: async () => ({ suiteOrigin, foreignOrigin }) }),
  });
  runInContext(script("navigation"), context);
  await vi.advanceTimersByTimeAsync(0);
  expect(assign).not.toHaveBeenCalled();
  expect(link.href).toBe(`${foreignOrigin}/foreign.html`);
  expect(JSON.parse(result.value)).toMatchObject({
    done: false,
    documentId: "navigation-id",
    navigation: { attempted: false },
  });
  const preventDefault = vi.fn();
  click?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(assign).toHaveBeenCalledWith(`${foreignOrigin}/foreign.html`);
  await vi.advanceTimersByTimeAsync(2000);
  expect(JSON.parse(result.value)).toMatchObject({
    done: true,
    href: location.href,
    origin: suiteOrigin,
    navigation: { refused: true },
  });
});
