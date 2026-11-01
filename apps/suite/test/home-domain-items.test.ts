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

async function registerCustomNote(pod: ReturnType<typeof createDemoPod>) {
  // Outside the first-party and integrations discovery paths.
  await pod.fetch(`${DEMO_ROOT}custom-notes/new.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: '<#it> a <https://schema.org/TextDigitalDocument>; <https://schema.org/name> "Registered later".',
  });
  const index = `${DEMO_ROOT}settings/privateTypeIndex.ttl`;
  const previousIndex = await pod.fetch(index);
  await pod.fetch(index, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `${await previousIndex.text()}\n<#registration> a <http://www.w3.org/ns/solid/terms#TypeRegistration>; <http://www.w3.org/ns/solid/terms#forClass> <https://schema.org/TextDigitalDocument>; <http://www.w3.org/ns/solid/terms#instanceContainer> <${DEMO_ROOT}custom-notes/>.`,
  });
  return index;
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

  it("shares all-domain reads, counts and prepared cards within a session, revalidating registrations on refresh", async () => {
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
    ).toHaveLength(2);
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
    expect(store.getSnapshot().items.map((item) => item.url)).toEqual(
      saved.items.map((item) => item.url),
    );
    vi.stubGlobal("navigator", { onLine: true });
    fetch.mockRejectedValueOnce(new Error("Offline"));
    await store.refresh();
    expect(store.getSnapshot().items.map((item) => item.url)).toEqual(
      saved.items.map((item) => item.url),
    );
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

  it.each([
    { webId: "https://identity.example/card#me", storageUrl: DEMO_ROOT },
    { webId: DEMO_WEBID, storageUrl: `${DEMO_ROOT}private/` },
  ])("reads external profile $webId without the session transport or credentials", async ({
    webId,
    storageUrl,
  }) => {
    const { session, fetch } = await setup();
    const anonymous = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          `<#me> a <http://xmlns.com/foaf/0.1/Person>; <http://xmlns.com/foaf/0.1/name> "Alice".`,
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    vi.stubGlobal("fetch", anonymous);
    const store = domainStore({ ...session, webId, storageUrl });
    await store.refresh();
    expect(store.getSnapshot().status).toBe("ready");
    expect(anonymous).toHaveBeenCalledExactlyOnceWith(
      webId.split("#")[0],
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    expect(fetch.mock.calls.some(([input]) => String(input) === webId.split("#")[0])).toBe(false);
    expect(fetch).toHaveBeenCalled();
  });

  it.each([
    { path: "notes/", failure: 503 },
    { path: "notes/", failure: new TypeError("Connection lost") },
    { path: "notes/weekend.ttl", failure: 503 },
    { path: "notes/weekend.ttl", failure: new TypeError("Connection lost") },
  ])("preserves cached notes after a mid-scan $path failure: $failure", async ({
    path,
    failure,
  }) => {
    const { store, fetch, pod } = await setup();
    await store.refresh();
    const saved = store.getSnapshot();
    const notes = saved.items.filter((item) => item.dataType?.id === "notes");
    expect(notes.length).toBeGreaterThan(0);
    fetch.mockImplementation(async (input, init) => {
      if (String(input) === `${DEMO_ROOT}${path}`) {
        if (failure instanceof Error) throw failure;
        return new Response(null, { status: failure });
      }
      return pod.fetch(input, init);
    });
    await store.refresh();
    const next = store.getSnapshot();
    expect(next.status).toBe("ready");
    expect(next.failures).toHaveLength(1);
    expect(next.items.filter((item) => item.dataType?.id === "notes")).toEqual(notes);
    expect(next.counts.get("documents")).toBe(saved.counts.get("documents"));
    for (const note of notes) expect(next.views.get(note)).toEqual(saved.views.get(note));
    fetch.mockImplementation(pod.fetch);
    await store.refresh();
    expect(store.getSnapshot().failures).toEqual([]);
  });

  it("keeps unvisited registered cards after an index failure while removing confirmed deletions", async () => {
    const { store, pod, fetch } = await setup();
    const index = await registerCustomNote(pod);
    await store.refresh();
    const custom = store.getSnapshot().items.find((item) => item.title === "Registered later");
    expect(custom).toBeDefined();
    await pod.fetch(`${DEMO_ROOT}notes/weekend.ttl`, { method: "DELETE" });
    fetch.mockImplementation(async (input, init) =>
      String(input) === index ? new Response(null, { status: 503 }) : pod.fetch(input, init),
    );
    await store.refresh();
    expect(store.getSnapshot().failures).toHaveLength(1);
    expect(store.getSnapshot().items).toContain(custom);
    expect(
      store.getSnapshot().items.some((item) => item.url === `${DEMO_ROOT}notes/weekend.ttl`),
    ).toBe(false);
    fetch.mockImplementation(async (input, init) =>
      String(input) === index ? new Response(null, { status: 403 }) : pod.fetch(input, init),
    );
    await store.refresh();
    expect(store.getSnapshot().items.some((item) => item.title === "Registered later")).toBe(false);
  });

  it.each([
    401, 403, 404, 410,
  ])("evicts a cached profile after confirmed HTTP %s", async (status) => {
    const { store, session, fetch, pod } = await setup();
    await store.refresh();
    const profileUrl = session.webId.split("#")[0];
    expect(store.getSnapshot().items.some((item) => item.url === profileUrl)).toBe(true);
    fetch.mockImplementation(async (input, init) =>
      String(input) === profileUrl ? new Response(null, { status }) : pod.fetch(input, init),
    );
    await store.refresh();
    expect(store.getSnapshot().items.some((item) => item.url === profileUrl)).toBe(false);
    expect(store.getSnapshot().counts.get("media")).toBe(3);
  });

  it.each([401, 403, 404, 410])("drops cached notes after confirmed HTTP %s", async (status) => {
    const { store, fetch, pod } = await setup();
    await store.refresh();
    expect(store.getSnapshot().items.some((item) => item.dataType?.id === "notes")).toBe(true);
    fetch.mockImplementation(async (input, init) =>
      String(input) === `${DEMO_ROOT}notes/`
        ? new Response(null, { status })
        : pod.fetch(input, init),
    );
    await store.refresh();
    expect(store.getSnapshot().items.some((item) => item.dataType?.id === "notes")).toBe(false);
    expect(store.getSnapshot().counts.get("media")).toBe(3);
  });

  it("loads saved demo pod data on an offline cold open", async () => {
    const { session, fetch } = await setup();
    vi.stubGlobal("navigator", { onLine: false });
    const cold = domainStore({ ...session });
    cold.ensureLoaded();
    await vi.waitFor(() => expect(cold.getSnapshot().status).toBe("ready"));
    expect(cold.getSnapshot().counts.get("media")).toBe(3);
    expect(fetch).toHaveBeenCalled();
  });

  it("settles an offline network cold open without reading the network or another account's cards", async () => {
    const { session } = await setup();
    const network = { ...session, mode: "solid" as const };
    const warm = domainStore(network);
    await warm.refresh();
    expect(warm.getSnapshot().items.length).toBeGreaterThan(0);
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("navigator", { onLine: false });
    const cold = domainStore({ ...network, webId: "https://bob.example/card#me", fetch });
    await cold.refresh();
    expect(cold.getSnapshot().status).toBe("offline");
    expect(cold.getSnapshot().items).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    const saved = warm.getSnapshot();
    await warm.refresh();
    expect(warm.getSnapshot().items).toBe(saved.items);
  });

  it.each([
    "retry",
    "focus",
    "live",
  ])("discovers newly registered containers on %s", async (trigger) => {
    const { store, pod, fetch } = await setup();
    const stop = store.subscribe(vi.fn());
    await store.refresh();
    const index = await registerCustomNote(pod);
    if (trigger === "retry") await store.refresh();
    else if (trigger === "focus") events.dispatchEvent(new Event("focus"));
    else await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() =>
      expect(store.getSnapshot().items.some((item) => item.title === "Registered later")).toBe(
        true,
      ),
    );
    expect(fetch.mock.calls.filter(([url]) => String(url) === index)).toHaveLength(2);
    stop();
  });
});
