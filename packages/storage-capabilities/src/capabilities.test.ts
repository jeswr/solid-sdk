// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-6.1-Sol
import { describe, expect, test, vi } from "vitest";
import { createMemoryCache } from "./cache.js";
import { capabilities } from "./capabilities.js";
import { resolveStorageDescription } from "./resolve.js";
import {
  cssStorage,
  essStorage,
  fixtureFetch,
  nssStorage,
  sparqLwsStorage,
  storageFixtures,
} from "./testing.js";
import type { DescriptionCache, ResolveOptions } from "./types.js";

function options(fetch: typeof globalThis.fetch): ResolveOptions {
  return { fetch, cache: createMemoryCache(), now: () => 1000 };
}

describe("capabilities() over the ADR-002 fixtures", () => {
  test("CSS: websocket live updates (webhook ignored), WAC and N3/SPARQL patch via one probe", async () => {
    const fetch = fixtureFetch(cssStorage);
    const opts = options(fetch);
    const features = await capabilities(cssStorage.resource, opts);
    expect(features.protocol).toBe("solid");
    expect(features.liveUpdates).toMatchObject({
      state: "available",
      detail: {
        channels: ["websocket"],
        endpoint: "https://css.example/.notifications/WebSocketChannel2023/",
      },
    });
    expect(features.accessControl).toMatchObject({ state: "available", detail: { model: "wac" } });
    expect(features.patch.detail.formats).toEqual({
      "text/turtle": ["text/n3", "application/sparql-update"],
    });
    expect(fetch.calls).toEqual([
      "HEAD https://css.example/alice/notes/today.ttl",
      "HEAD https://css.example/alice/notes/",
      "HEAD https://css.example/alice/",
      "GET https://css.example/.well-known/solid",
      "OPTIONS https://css.example/alice/",
    ]);
    // Description and probe are cached together: a sibling needs no network.
    fetch.calls.length = 0;
    expect(await capabilities(`${cssStorage.root}other`, opts)).toEqual(features);
    expect(fetch.calls).toEqual([]);
  });

  test("sparq LWS: webhook live updates, server type index, ODRL grants, move unknown, paging; never probed", async () => {
    const fetch = fixtureFetch(sparqLwsStorage);
    const features = await capabilities(sparqLwsStorage.resource, options(fetch));
    expect(features).toMatchObject({
      protocol: "lws",
      liveUpdates: { state: "available", detail: { channels: ["webhook"] } },
      typeIndex: { state: "available", detail: { mode: "server" } },
      accessControl: { state: "available", detail: { model: "odrl-grants" } },
      move: { state: "unknown" },
      pagination: { state: "available" },
    });
    expect(fetch.calls.some((call) => call.startsWith("OPTIONS"))).toBe(false);
  });

  test("ESS: ACP wins over WAC-Allow through the probe", async () => {
    const fetch = fixtureFetch(essStorage);
    const features = await capabilities(essStorage.resource, options(fetch));
    expect(features.accessControl).toEqual({
      state: "available",
      evidence: "header:Link",
      detail: { model: "acp" },
    });
    expect(features.liveUpdates.detail.channels).toEqual(["websocket"]);
  });

  test("NSS: legacy websockets only; probe finds WAC and SPARQL Update", async () => {
    const fetch = fixtureFetch(nssStorage);
    const opts = options(fetch);
    const description = await resolveStorageDescription(nssStorage.resource, opts);
    expect(description).toMatchObject({ root: nssStorage.root, sources: ["probe"] });
    const features = await capabilities(nssStorage.resource, opts);
    expect(features.liveUpdates.detail).toEqual({
      channels: ["legacy-ws"],
      endpoint: "wss://nss.example/",
    });
    expect(features.serverSearch.state).toBe("unknown");
    expect(features.realtimeCollab.state).toBe("unknown");
    expect(features.accessControl.detail.model).toBe("wac");
    expect(features.patch.detail.formats).toEqual({ "text/turtle": ["application/sparql-update"] });
  });

  test.each(storageFixtures)("fixture $name resolves to its declared root", async (fixture) => {
    const description = await resolveStorageDescription(
      fixture.resource,
      options(fixtureFetch(fixture)),
    );
    expect(description.root).toBe(fixture.root);
  });
});

describe("capabilities() probing policy", () => {
  test("a failed probe keeps features unknown and is retried on the next call", async () => {
    const replay = fixtureFetch(cssStorage);
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
      init?.method === "OPTIONS" || (init?.method === "HEAD" && String(input) === cssStorage.root)
        ? Promise.reject(new TypeError("offline"))
        : replay(input, init),
    );
    const opts = { ...options(fetch), seedHeaders: undefined };
    // Discover first (the root HEAD succeeds through the replay), then break the probe.
    await resolveStorageDescription(cssStorage.resource, { ...opts, fetch: replay });
    const features = await capabilities(cssStorage.resource, opts);
    expect(features.accessControl.state).toBe("unknown");
    expect(features.patch.state).toBe("unknown");
    fetch.mockImplementation(replay);
    expect((await capabilities(cssStorage.resource, opts)).accessControl.state).toBe("available");
  });

  test("an aborted probe rethrows", async () => {
    const replay = fixtureFetch(cssStorage);
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (init?.method === "OPTIONS") {
        controller.abort();
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      return replay(input, init);
    });
    await expect(
      capabilities(cssStorage.resource, { ...options(fetch), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "network" });
  });

  test("non-CapabilitiesError failures from the probe propagate", async () => {
    const replay = fixtureFetch(cssStorage);
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) =>
      init?.method === "OPTIONS"
        ? Promise.resolve(
            Object.defineProperty(new Response(null), "headers", {
              get() {
                throw new RangeError("broken headers");
              },
            }),
          )
        : replay(input, init),
    );
    await expect(capabilities(cssStorage.resource, options(fetch))).rejects.toThrow(
      "broken headers",
    );
  });

  test("does not probe when the description already settles accessControl and patch", async () => {
    const fetch = fixtureFetch({
      ...cssStorage,
      responses: {
        ...cssStorage.responses,
        "GET https://css.example/.well-known/solid": {
          status: 200,
          headers: { "content-type": "text/turtle" },
          body: `@prefix ssd: <https://jeswr.org/ns/solid-sd#> .
<https://css.example/alice/> <https://www.w3.org/ns/lws#capability>
  [ a ssd:AccessControl ; ssd:model ssd:WAC ] ,
  [ a ssd:PatchSupport ; ssd:format [ ssd:source "text/turtle" ; ssd:patchType "text/n3" ] ] .`,
        },
      },
    });
    const features = await capabilities(cssStorage.resource, options(fetch));
    expect(features.accessControl.evidence).toBe("solid-description:AccessControl");
    expect(features.patch.evidence).toBe("solid-description:PatchSupport");
    expect(fetch.calls.some((call) => call.startsWith("OPTIONS"))).toBe(false);
  });

  test("a probe finishing after invalidation does not resurrect the record", async () => {
    const replay = fixtureFetch(cssStorage);
    const cache = createMemoryCache();
    let release: () => void = () => undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (init?.method === "OPTIONS") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return replay(input, init);
    });
    const pending = capabilities(cssStorage.resource, { fetch, cache, now: () => 1000 });
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === "OPTIONS")).toBe(true),
    );
    await cache.delete(cssStorage.root);
    release();
    expect((await pending).accessControl.detail.model).toBe("wac");
    expect(await cache.get(cssStorage.root)).toBeUndefined();
  });

  test("a probe finishing after the record was replaced does not overwrite it", async () => {
    const replay = fixtureFetch(cssStorage);
    const cache = createMemoryCache();
    let release: () => void = () => undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (init?.method === "OPTIONS") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return replay(input, init);
    });
    const pending = capabilities(cssStorage.resource, { fetch, cache, now: () => 1000 });
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === "OPTIONS")).toBe(true),
    );
    const record = await cache.get(cssStorage.root);
    if (!record) throw new Error("missing record");
    const replaced = { description: { ...record.description, fetchedAt: 2000 } };
    await cache.set(cssStorage.root, replaced);
    release();
    await pending;
    expect(await cache.get(cssStorage.root)).toEqual(replaced);
  });

  test("custom caches without attachProbe never persist the probe (no non-atomic write)", async () => {
    const inner = createMemoryCache();
    const set = vi.fn(inner.set);
    const cache: DescriptionCache = {
      get: (id) => inner.get(id),
      set,
      delete: (id) => inner.delete(id),
      lookupPrefix: (url) => inner.lookupPrefix(url),
      rememberPrefix: (root, id) => inner.rememberPrefix(root, id),
    };
    const fetch = fixtureFetch(cssStorage);
    const features = await capabilities(cssStorage.resource, { fetch, cache, now: () => 1000 });
    expect(features.accessControl.detail.model).toBe("wac");
    expect((await cache.get(cssStorage.root))?.probe).toBeUndefined();
    // Only the resolver's description write happened.
    expect(set).toHaveBeenCalledTimes(1);
    fetch.calls.length = 0;
    await capabilities(cssStorage.resource, { fetch, cache, now: () => 1000 });
    expect(fetch.calls.filter((call) => call.startsWith("OPTIONS"))).toHaveLength(1);
  });

  test("uses the shared default cache when none is given", async () => {
    const fetch = fixtureFetch(essStorage);
    await capabilities(essStorage.resource, { fetch, now: () => 1000 });
    fetch.calls.length = 0;
    await capabilities(essStorage.resource, { fetch, now: () => 1000 });
    expect(fetch.calls).toEqual([]);
  });
});

describe("fixtureFetch", () => {
  test("replays Request objects, defaults to GET, and 404s unknown requests", async () => {
    const fetch = fixtureFetch(sparqLwsStorage);
    const response = await fetch(new Request("https://lws.example/.well-known/storage"));
    expect(response.status).toBe(200);
    expect((await fetch("https://lws.example/missing")).status).toBe(404);
    expect(
      (await fetch(new Request("https://lws.example/data/file", { method: "HEAD" }))).headers.get(
        "link",
      ),
    ).toContain("lws#storage");
    expect(fetch.calls).toEqual([
      "GET https://lws.example/.well-known/storage",
      "GET https://lws.example/missing",
      "HEAD https://lws.example/data/file",
    ]);
  });
});
