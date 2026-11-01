// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ABSENT,
  createSnapshotReader,
  detectSolidExtension,
  EXTENSION_CHANNEL,
  EXTENSION_MARKER,
  EXTENSION_READY_EVENT,
  type ExtensionWindow,
  readSolidExtension,
  type SolidExtensionApi,
  subscribeSolidExtension,
  useSolidExtension,
} from "../src/lib/session/extension-session";

type Listener = (event?: unknown) => void;

function fakeWindow(options: { marker?: string | null; solid?: SolidExtensionApi } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const attrs = new Map<string, string>();
  if (options.marker != null) attrs.set(EXTENSION_MARKER, options.marker);
  const win = {
    solid: options.solid,
    document: { documentElement: { getAttribute: (name: string) => attrs.get(name) ?? null } },
    addEventListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    setTimeout(handler: () => void) {
      const id = nextTimer++;
      timers.set(id, handler);
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number);
    },
  };
  return {
    win: win as ExtensionWindow & { solid?: SolidExtensionApi },
    set(next: SolidExtensionApi | undefined) {
      win.solid = next;
    },
    announce() {
      attrs.set(EXTENSION_MARKER, "1");
    },
    emit(type: string, event?: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    runTimers() {
      for (const [id, handler] of [...timers]) {
        timers.delete(id);
        handler();
      }
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const granted = (webId: unknown = "https://alice.example/profile/card#me"): SolidExtensionApi =>
  ({ webId, fetch: vi.fn(), requestAccess: vi.fn() }) as unknown as SolidExtensionApi;

describe("readSolidExtension", () => {
  it("is absent with no window, no marker, or no stub", () => {
    expect(readSolidExtension(undefined)).toBe(ABSENT);
    expect(readSolidExtension(fakeWindow({ solid: granted() }).win)).toBe(ABSENT);
    expect(readSolidExtension(fakeWindow({ marker: "1" }).win)).toBe(ABSENT);
    expect(readSolidExtension(fakeWindow({ marker: "0", solid: granted() }).win)).toBe(ABSENT);
  });

  it("is present but not granted while the stub has no fetch", () => {
    const { win } = fakeWindow({ marker: "1", solid: { requestAccess: vi.fn() } });
    expect(readSolidExtension(win)).toEqual({ present: true, granted: false, webId: null });
  });

  it("reports the WebID only while granted and only when it is a string", () => {
    expect(readSolidExtension(fakeWindow({ marker: "1", solid: granted() }).win)).toEqual({
      present: true,
      granted: true,
      webId: "https://alice.example/profile/card#me",
    });
    expect(
      readSolidExtension(fakeWindow({ marker: "1", solid: granted(42) }).win).webId,
    ).toBeNull();
    const ungrantedWithWebId = { webId: "https://x.example/#me" } as SolidExtensionApi;
    expect(readSolidExtension(fakeWindow({ marker: "1", solid: ungrantedWithWebId }).win)).toEqual({
      present: true,
      granted: false,
      webId: null,
    });
  });

  it("treats a throwing page global as absent", () => {
    const win = {
      get solid(): SolidExtensionApi {
        throw new Error("hostile getter");
      },
      document: { documentElement: { getAttribute: () => "1" } },
    } as unknown as ExtensionWindow;
    expect(readSolidExtension(win)).toBe(ABSENT);
  });

  it("treats throwing fetch or webId getters on the stub as absent", () => {
    const hostile = (key: "fetch" | "webId") => {
      const solid = { fetch: vi.fn(), webId: "https://a.example/#me" } as Record<string, unknown>;
      Object.defineProperty(solid, key, {
        get() {
          throw new Error("hostile getter");
        },
      });
      return fakeWindow({ marker: "1", solid: solid as SolidExtensionApi }).win;
    };
    expect(readSolidExtension(hostile("fetch"))).toBe(ABSENT);
    expect(readSolidExtension(hostile("webId"))).toBe(ABSENT);
  });

  it("reads each stub property once", () => {
    let reads = 0;
    const solid = {
      fetch: vi.fn(),
      get webId() {
        reads += 1;
        return reads === 1 ? "https://a.example/#me" : 42;
      },
    } as unknown as SolidExtensionApi;
    expect(readSolidExtension(fakeWindow({ marker: "1", solid }).win).webId).toBe(
      "https://a.example/#me",
    );
    expect(reads).toBe(1);
  });

  it("defaults to the global window (absent under node)", () => {
    expect(readSolidExtension()).toBe(ABSENT);
  });
});

describe("detectSolidExtension", () => {
  it("resolves false without a window", async () => {
    await expect(detectSolidExtension(10, undefined)).resolves.toBe(false);
    await expect(detectSolidExtension()).resolves.toBe(false);
  });

  it("resolves true at once when the sticky marker is already set", async () => {
    const fake = fakeWindow({ marker: "1", solid: {} });
    await expect(detectSolidExtension(10, fake.win)).resolves.toBe(true);
    expect(fake.count(EXTENSION_READY_EVENT)).toBe(0);
  });

  it("resolves true on the ready event and cleans up", async () => {
    const fake = fakeWindow();
    const result = detectSolidExtension(10, fake.win);
    fake.set({});
    fake.announce();
    fake.emit(EXTENSION_READY_EVENT);
    await expect(result).resolves.toBe(true);
    expect(fake.count(EXTENSION_READY_EVENT)).toBe(0);
    fake.runTimers();
  });

  it("resolves false after the timeout and cleans up", async () => {
    const fake = fakeWindow();
    const result = detectSolidExtension(10, fake.win);
    fake.runTimers();
    await expect(result).resolves.toBe(false);
    expect(fake.count(EXTENSION_READY_EVENT)).toBe(0);
  });

  it("a ready event without the marker and stub does not count", async () => {
    const fake = fakeWindow();
    const result = detectSolidExtension(10, fake.win);
    fake.emit(EXTENSION_READY_EVENT);
    await expect(result).resolves.toBe(false);
  });
});

describe("subscribeSolidExtension", () => {
  const stateMessage = (win: unknown, data: unknown) => ({ source: win, data });

  it("notifies on the ready event, focus, and the extension's own state messages", () => {
    const fake = fakeWindow();
    const onChange = vi.fn();
    const stop = subscribeSolidExtension(onChange, fake.win);
    fake.emit(EXTENSION_READY_EVENT);
    fake.emit("focus");
    for (const type of ["SOLID_STATE_UPDATE"]) {
      fake.emit(
        "message",
        stateMessage(fake.win, { channel: EXTENSION_CHANNEL, dir: "to-page", type }),
      );
    }
    expect(onChange).toHaveBeenCalledTimes(3);
    fake.runTimers();
    expect(onChange).toHaveBeenCalledTimes(4);
    stop();
    fake.emit("focus");
    fake.runTimers();
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(fake.count("message")).toBe(0);
  });

  it("re-reads on the next task when it subscribed before the extension's own listener", () => {
    // Our listener runs first; the extension updates the stub only after we have read it.
    const fake = fakeWindow({ marker: "1", solid: { requestAccess: vi.fn() } });
    const read = createSnapshotReader(() => readSolidExtension(fake.win));
    const seen: boolean[] = [];
    subscribeSolidExtension(() => seen.push(read().granted), fake.win);
    fake.win.addEventListener("message", () => fake.set(granted()));
    const update = { channel: EXTENSION_CHANNEL, dir: "to-page", type: "SOLID_STATE_UPDATE" };
    fake.emit("message", stateMessage(fake.win, update));
    expect(seen).toEqual([false]);
    fake.runTimers();
    expect(seen).toEqual([false, true]);
    // And the revoke direction.
    fake.win.addEventListener("message", () => fake.set({ requestAccess: vi.fn() }));
    fake.emit("message", stateMessage(fake.win, update));
    fake.runTimers();
    expect(seen.at(-1)).toBe(false);
  });

  it("cancels pending re-checks on unsubscribe", () => {
    const fake = fakeWindow();
    const onChange = vi.fn();
    const stop = subscribeSolidExtension(onChange, fake.win);
    fake.emit("focus");
    stop();
    fake.runTimers();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores foreign, malformed, outbound and unrelated messages", () => {
    const fake = fakeWindow();
    const onChange = vi.fn();
    subscribeSolidExtension(onChange, fake.win);
    const ok = { channel: EXTENSION_CHANNEL, dir: "to-page", type: "SOLID_STATE_UPDATE" };
    fake.emit("message", stateMessage({}, ok));
    fake.emit("message", stateMessage(fake.win, null));
    fake.emit("message", stateMessage(fake.win, "SOLID_STATE_UPDATE"));
    fake.emit("message", stateMessage(fake.win, { ...ok, channel: "other" }));
    fake.emit("message", stateMessage(fake.win, { ...ok, dir: "to-content" }));
    fake.emit("message", stateMessage(fake.win, { ...ok, type: "SOLID_FETCH_RESPONSE" }));
    // Exact envelopes relayed by content-script.ts: correlated replies aren't broadcasts.
    for (let i = 0; i < 100; i++) {
      fake.emit(
        "message",
        stateMessage(fake.win, {
          ...ok,
          type: "SOLID_ACCESS_RESPONSE",
          requestId: `list-${i}`,
          grants: [],
        }),
      );
      fake.emit(
        "message",
        stateMessage(fake.win, {
          ...ok,
          type: "SOLID_ACCESS_RESPONSE",
          requestId: `consent-${i}`,
          ok: true,
          webId: "https://alice.example/#me",
        }),
      );
      fake.emit(
        "message",
        stateMessage(fake.win, {
          ...ok,
          type: "SOLID_ACTION_RESPONSE",
          actionId: `action-${i}`,
          error: null,
        }),
      );
    }
    fake.emit("message", undefined);
    fake.runTimers();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a no-op without a window", () => {
    expect(subscribeSolidExtension(vi.fn(), undefined)()).toBeUndefined();
    expect(subscribeSolidExtension(vi.fn())()).toBeUndefined();
  });
});

describe("createSnapshotReader", () => {
  it("returns the same object until a field changes", () => {
    let state = { present: true, granted: false, webId: null as string | null };
    const read = createSnapshotReader(() => ({ ...state }));
    const first = read();
    expect(read()).toBe(first);
    state = { present: true, granted: true, webId: "https://a.example/#me" };
    const second = read();
    expect(second).not.toBe(first);
    expect(second).toEqual(state);
    expect(read()).toBe(second);
  });

  it("collapses every absent state to the shared ABSENT object", () => {
    let present = true;
    const read = createSnapshotReader(() =>
      present ? { present: true, granted: false, webId: null } : { ...ABSENT },
    );
    read();
    present = false;
    expect(read()).toBe(ABSENT);
  });
});

describe("useSolidExtension", () => {
  it("renders the absent state on the server", () => {
    function Probe() {
      const state = useSolidExtension();
      return createElement("span", null, `${state.present}/${state.granted}/${state.webId}`);
    }
    expect(renderToString(createElement(Probe))).toBe("<span>false/false/null</span>");
  });
});
