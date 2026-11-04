// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { isDemoImport } from "../src/apps/home/lib/connect";
import { connectionReducer } from "../src/apps/home/lib/connect/connection-state";
import {
  CONNECTORS_KEY,
  connectorKey,
  createConnectorPreferences,
} from "../src/apps/home/state/connectors";

const at = "2026-11-01T12:00:00.000Z";
const url = "https://alice.demo.pod/integrations/spotify/music/top-tracks.ttl";
const start = () => connectionReducer(undefined, { type: "start", at, mode: "demo" });
describe("durable connection state", () => {
  it("keeps untouched demo provenance after a live connection is cancelled", () => {
    const demo = connectionReducer(start(), { type: "written", url });
    const live = connectionReducer(demo, { type: "start", at, mode: "live" });
    const cancelled = connectionReducer(live, { type: "incomplete" });
    expect(isDemoImport(url, { spotify: cancelled })).toBe(true);
    const written = connectionReducer(cancelled, { type: "written", url });
    expect(isDemoImport(url, { spotify: written })).toBe(false);
    const other = `${url}.other`;
    const liveAgain = connectionReducer(written, { type: "written", url: other });
    const demoAgain = connectionReducer(liveAgain, { type: "start", at, mode: "demo" });
    const replaced = connectionReducer(demoAgain, { type: "written", url });
    expect(replaced.resourceUrls).toEqual([other]);
    expect(isDemoImport(url, { spotify: replaced })).toBe(true);
    expect(isDemoImport(other, { spotify: replaced })).toBe(false);
  });
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
    expect(current.resourceUrls).toEqual([]);
    expect(current.demoResourceUrls).toEqual([url]);
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
      resourceUrls: [],
      demoResourceUrls: [url],
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
  it("clears checkpoints when changing modes, including after a cancelled live attempt", () => {
    const demo = connectionReducer(start(), {
      type: "success",
      at,
      added: 3,
      skipped: 0,
      cursor: "fixture-cursor",
    });
    const live = connectionReducer(demo, { type: "start", at, mode: "live" });
    expect(live.cursor).toBeUndefined();
    const retry = connectionReducer(connectionReducer(live, { type: "incomplete" }), {
      type: "start",
      at,
      mode: "live",
    });
    expect(retry.cursor).toBeUndefined();
    const successful = connectionReducer(retry, {
      type: "success",
      at,
      added: 2,
      skipped: 0,
      cursor: "real-cursor",
    });
    expect(connectionReducer(successful, { type: "start", at, mode: "live" }).cursor).toBe(
      "real-cursor",
    );
    expect(
      connectionReducer(successful, { type: "start", at, mode: "demo" }).cursor,
    ).toBeUndefined();
    expect(
      connectionReducer(successful, { type: "start", at, mode: "file" }).cursor,
    ).toBeUndefined();
  });
  it("isolates accounts and strips tokens from storage", () => {
    const values = new Map<string, string>();
    const store = createConnectorPreferences({
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    expect(store.read("alice")).toEqual({});
    store.write("alice", "spotify", {
      ...start(),
      demoResourceUrls: [url],
      accessToken: "secret",
    } as ReturnType<typeof start>);
    expect(store.read("alice").spotify?.mode).toBe("demo");
    expect(store.read("bob")).toEqual({});
    store.write("bob", "netflix", { ...start(), mode: "file" });
    expect(store.read("alice").spotify?.mode).toBe("demo");
    expect(values.get(connectorKey("alice", "spotify"))).not.toContain("secret");
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
      key: () => null,
      length: 0,
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
    store.write("alice", "spotify", start());
    expect(store.read("alice").spotify).toEqual(start());
    expect(() => store.write("alice", "spotify", { ...start(), added: -1 })).toThrow();
  });
  it("can read demo provenance directly without mounting Connect", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () =>
          JSON.stringify({ alice: { spotify: { ...start(), demoResourceUrls: [url] } } }),
      },
    });
    expect(isDemoImport(`${url}#track`)).toBe(true);
    vi.unstubAllGlobals();
    expect(isDemoImport(url)).toBe(false);
  });
  it("reads legacy demo URLs and migrates provenance when starting a live run", () => {
    const { demoResourceUrls: _demo, ...legacy } = start();
    const storage = {
      getItem: () => JSON.stringify({ alice: { spotify: { ...legacy, resourceUrls: [url] } } }),
      setItem: vi.fn(),
      key: () => null,
      length: 0,
    };
    const store = createConnectorPreferences(storage);
    const connection = store.read("alice").spotify;
    if (!connection) throw new Error("Missing legacy connection");
    expect(isDemoImport(url, { spotify: connection })).toBe(true);
    const live = connectionReducer(connection, { type: "start", at, mode: "live" });
    expect(live).toMatchObject({ resourceUrls: [], demoResourceUrls: [url] });
    expect(isDemoImport(url, { spotify: live })).toBe(true);
    expect(isDemoImport(url, { spotify: { ...legacy, mode: "live", resourceUrls: [url] } })).toBe(
      false,
    );
    const demoAgain = connectionReducer(live, { type: "start", at, mode: "demo" });
    expect(connectionReducer(demoAgain, { type: "written", url }).demoResourceUrls).toEqual([url]);
    expect(CONNECTORS_KEY).toBe("suite.connectors.v2");
  });
});
