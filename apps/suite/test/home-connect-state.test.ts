// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { isDemoImport } from "../src/apps/home/lib/connect";
import { connectionReducer } from "../src/apps/home/lib/connect/connection-state";
import { CONNECTORS_KEY, createConnectorPreferences } from "../src/apps/home/state/connectors";

const at = "2026-11-01T12:00:00.000Z";
const url = "https://alice.demo.pod/integrations/spotify/music/top-tracks.ttl";
const start = () => connectionReducer(undefined, { type: "start", at, mode: "demo" });
describe("durable connection state", () => {
  it("records start before writes, de-duplicates resources and keeps checkpoints on failure", () => {
    expect(() => connectionReducer(undefined, { type: "error" })).toThrow("Start a connection");
    let current = start();
    expect(current).toMatchObject({
      connectedAt: at,
      lastOutcome: "incomplete",
      added: 0,
      skipped: 0,
    });
    current = connectionReducer(current, { type: "written", url });
    current = connectionReducer(current, { type: "written", url });
    expect(current.resourceUrls).toEqual([url]);
    current = connectionReducer(current, {
      type: "success",
      at,
      added: 3,
      skipped: 1,
      cursor: "checkpoint",
    });
    const restarted = connectionReducer(current, {
      type: "start",
      at: "2026-11-02T12:00:00.000Z",
      mode: "demo",
    });
    expect(restarted).toMatchObject({
      connectedAt: at,
      lastSync: at,
      cursor: "checkpoint",
      added: 3,
      skipped: 1,
      lastOutcome: "incomplete",
      resourceUrls: [url],
    });
    expect(connectionReducer(restarted, { type: "incomplete" })).toEqual(restarted);
    expect(connectionReducer(restarted, { type: "error" })).toEqual({
      ...restarted,
      lastOutcome: "error",
    });
    expect(
      connectionReducer(restarted, { type: "success", at, added: 4, skipped: 0 }).cursor,
    ).toBeUndefined();
  });
  it("isolates accounts and strips tokens from storage", () => {
    const values = new Map<string, string>();
    const store = createConnectorPreferences({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    expect(store.read("alice")).toEqual({});
    store.write("alice", {
      spotify: { ...start(), resourceUrls: [url], accessToken: "secret" } as ReturnType<
        typeof start
      >,
    });
    expect(store.read("alice").spotify?.mode).toBe("demo");
    expect(store.read("bob")).toEqual({});
    store.write("bob", { netflix: { ...start(), mode: "file" } });
    expect(store.read("alice").spotify?.mode).toBe("demo");
    expect(values.get(CONNECTORS_KEY)).not.toContain("secret");
    expect(store.forResource(`${url}#track`)).toEqual(store.read("alice"));
    expect(store.forResource(`${url}.evil`)).toEqual({});
    expect(isDemoImport(`${url}#track`, store.read("alice"))).toBe(true);
    expect(isDemoImport(url, { spotify: { ...start(), mode: "live", resourceUrls: [url] } })).toBe(
      false,
    );
    expect(isDemoImport(url, {})).toBe(false);
    expect(isDemoImport("https://elsewhere.example/", store.read("alice"))).toBe(false);
  });
  it("recovers from corrupt or blocked local storage and retains unsaved updates", () => {
    const storage = {
      getItem: vi.fn(() => "{broken"),
      setItem: vi.fn(() => {
        throw new Error("full");
      }),
    };
    const store = createConnectorPreferences(storage);
    expect(store.read("alice")).toEqual({});
    storage.getItem.mockReturnValue('{"alice":{"spotify":{"accessToken":"bad"}}}');
    expect(store.read("alice")).toEqual({});
    storage.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(store.read("alice")).toEqual({});
    store.write("alice", { spotify: start() });
    expect(store.read("alice").spotify).toEqual(start());
    expect(() => store.write("alice", { spotify: { ...start(), added: -1 } })).toThrow();
  });
  it("can read demo provenance directly without mounting Connect", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => JSON.stringify({ alice: { spotify: { ...start(), resourceUrls: [url] } } }),
      },
    });
    expect(isDemoImport(`${url}#track`)).toBe(true);
    vi.unstubAllGlobals();
    expect(isDemoImport(url)).toBe(false);
  });
});
