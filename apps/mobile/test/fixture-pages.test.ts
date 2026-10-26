// AUTHORED-BY GPT-5.6 Codex
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const script = (name: string) =>
  readFileSync(new URL(`../e2e/fixture/${name}.js`, import.meta.url), "utf8");
const suiteOrigin = "http://localhost:4173";
const foreignOrigin = "http://localhost:4174";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function hostile(window: object, advance = 0) {
  const postMessage = vi.fn();
  const context = createContext({
    window,
    location: {
      origin: foreignOrigin,
      search: `?parent=${encodeURIComponent(suiteOrigin)}&nonce=probe`,
    },
    URLSearchParams,
    parent: { postMessage },
    setTimeout,
    clearTimeout,
  });
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
  test("reports unavailable native transports", async () => {
    const attempts = await hostile({});
    expect(Object.keys(attempts)).toHaveLength(5);
    for (const attempt of Object.values(attempts))
      expect(attempt).toEqual({ status: "unavailable" });
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
  test("reports exceptions as rejection and tries the nativePromise fallback", async () => {
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
    for (const attempt of Object.values(attempts))
      expect(attempt).toMatchObject({ status: "rejected" });
  });
  test("bounds a non-responding generated plugin wrapper", async () => {
    const attempts = await hostile(
      { Capacitor: { registerPlugin: () => ({ getPending: () => new Promise(() => {}) }) } },
      2000,
    );
    expect(attempts.capacitorPlugin.status).toBe("no-response");
    expect(vi.getTimerCount()).toBe(0);
  });
});

function topFrame(hasPlugin = true) {
  const listeners = new Map<string, (event: object) => void>();
  const contentWindow = {};
  const frame = { contentWindow, src: "" };
  const getPending = vi.fn(async () => ({ batches: [] as object[] }));
  let received: ((batch: object) => void) | undefined;
  const addListener = vi.fn(async (_name: string, callback: (batch: object) => void) => {
    received = callback;
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
    document: { querySelector: () => frame },
    fetch: async () => ({ json: async () => ({ suiteOrigin, foreignOrigin }) }),
    setTimeout,
    clearTimeout,
  });
  runInContext(script("index"), context);
  return {
    context,
    listeners,
    frame,
    contentWindow,
    getPending,
    addListener,
    acknowledge,
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
});

test("navigation fixture attempts the foreign origin and checks the surviving document", async () => {
  const assign = vi.fn();
  const context = createContext({
    window: {},
    location: { origin: suiteOrigin, assign },
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
