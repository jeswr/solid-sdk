// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domainStore, type HomeSession } from "../src/apps/home/state/use-domain-items";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

let events: EventTarget;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup(liveUpdates = true) {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const fetch = vi.fn(pod.fetch);
  const subscribe = vi.fn(pod.subscribe);
  const session: HomeSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    storageUrl: DEMO_ROOT,
    fetch,
    subscribe,
    reset: async () => {},
    caps: { liveUpdates },
  };
  return { pod, fetch, subscribe, session, store: domainStore(session) };
}

describe("Home session discovery cache", () => {
  it("retries registrations that failed rather than permanently caching their failure", async () => {
    const { store, fetch, pod } = await setup();
    fetch.mockImplementation(async (input, init) =>
      String(input).includes("privateTypeIndex")
        ? new Response("Unavailable", { status: 403 })
        : pod.fetch(input, init),
    );
    await store.refresh();
    expect(store.getSnapshot().failures).toHaveLength(1);
    fetch.mockImplementation(pod.fetch);
    await store.refresh();
    expect(store.getSnapshot().failures).toEqual([]);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes("privateTypeIndex")),
    ).toHaveLength(2);
  });
  it("queues one reconciliation for changes received during an in-flight scan", async () => {
    const { store, fetch, pod } = await setup();
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetch.mockImplementationOnce(async (input, init) => {
      await barrier;
      return pod.fetch(input, init);
    });
    const first = store.refresh();
    expect(store.refresh()).toBe(first);
    release();
    await first;
    await vi.waitFor(() => expect(store.getSnapshot().updated).toBe(1));
    expect(store.getSnapshot().refreshing).toBe(false);
  });

  it("shares all-domain reads, counts and prepared cards within a session, loading registrations once", async () => {
    const { store, session, fetch } = await setup();
    expect(domainStore(session)).toBe(store);
    expect(domainStore({ ...session })).not.toBe(store);
    expect(store.getSnapshot().status).toBe("loading");
    await store.refresh();
    const first = store.getSnapshot();
    expect(first.status).toBe("ready");
    expect(first.counts.get("media")).toBe(3);
    expect(first.counts.get("socials")).toBe(2);
    expect(first.counts.get("mobility")).toBe(0);
    expect(first.views.size).toBe(first.items.length);
    expect(first.used).toBeGreaterThan(0);
    const count = fetch.mock.calls.length;
    store.ensureLoaded();
    expect(fetch).toHaveBeenCalledTimes(count);
    const refreshing = store.refresh();
    expect(store.getSnapshot().refreshing).toBe(true);
    expect(store.getSnapshot().items).toBe(first.items);
    await refreshing;
    expect(store.getSnapshot().updated).toBe(1);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes("privateTypeIndex")),
    ).toHaveLength(1);
  });
  it("debounces live changes and removes the subscription when the last consumer leaves", async () => {
    const { pod, store, subscribe } = await setup();
    const changed = vi.fn();
    const stop = store.subscribe(changed);
    const stopSecond = store.subscribe(vi.fn());
    expect(subscribe).toHaveBeenCalledTimes(1);
    store.ensureLoaded();
    store.ensureLoaded();
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
    await pod.fetch(`${DEMO_ROOT}notes/new.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: '<#it> a <https://schema.org/TextDigitalDocument>; <https://schema.org/name> "New note".',
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(store.getSnapshot().updated).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(store.getSnapshot().updated).toBe(1));
    expect(store.getSnapshot().items.some((item) => item.title === "New note")).toBe(true);
    stop();
    stopSecond();
    changed.mockClear();
    await pod.fetch(`${DEMO_ROOT}notes/new.ttl`, { method: "DELETE" });
    await vi.advanceTimersByTimeAsync(500);
    expect(changed).not.toHaveBeenCalled();
  });
  it("uses focus refresh when live updates are disabled, at most once per minute", async () => {
    const { store, subscribe } = await setup(false);
    const stop = store.subscribe(vi.fn());
    await store.refresh();
    expect(subscribe).not.toHaveBeenCalled();
    events.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(store.getSnapshot().updated).toBe(1));
    events.dispatchEvent(new Event("focus"));
    expect(store.getSnapshot().refreshing).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    events.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(store.getSnapshot().updated).toBe(2));
    stop();
  });
  it("retains saved cards offline and after transport failures, and resumes on reconnect", async () => {
    const { store, fetch } = await setup();
    const stop = store.subscribe(vi.fn());
    await store.refresh();
    const saved = store.getSnapshot();
    vi.stubGlobal("navigator", { onLine: false });
    await store.refresh();
    expect(store.getSnapshot()).toBe(saved);
    vi.stubGlobal("navigator", { onLine: true });
    fetch.mockRejectedValueOnce(new Error("Offline"));
    await store.refresh();
    expect(store.getSnapshot().items).toBe(saved.items);
    expect(store.getSnapshot().failures).toHaveLength(1);
    events.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(store.getSnapshot().failures).toEqual([]));
    stop();
  });
  it("exposes first-load errors and permits retry", async () => {
    const { store, fetch } = await setup();
    fetch.mockRejectedValueOnce(new Error("Unavailable"));
    await store.refresh();
    expect(store.getSnapshot().status).toBe("error");
    await store.refresh();
    expect(store.getSnapshot().status).toBe("ready");
  });
  it("retains partial cards with failures and retries the scan", async () => {
    const { store, fetch, pod } = await setup();
    fetch.mockImplementation(async (input, init) =>
      String(input).endsWith("notes/")
        ? new Response("Unavailable", { status: 403 })
        : pod.fetch(input, init),
    );
    await store.refresh();
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().failures).toHaveLength(1);
    expect(store.getSnapshot().counts.get("media")).toBe(3);
    fetch.mockImplementation(pod.fetch);
    await store.refresh();
    expect(store.getSnapshot().failures).toEqual([]);
    expect(store.getSnapshot().items.some((item) => item.dataType?.id === "notes")).toBe(true);
  });
});
