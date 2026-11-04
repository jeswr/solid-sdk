// AUTHORED-BY Codex GPT-6.1-Sol
import { CapabilitiesError } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { cssStorage, fixtureFetch, sparqLwsStorage } from "@jeswr/storage-capabilities/testing";
import { describe, expect, test, vi } from "vitest";
import { createPodClient } from "./index.js";
import type { PodClientOptions } from "./types.js";

describe("createPodClient", () => {
  test.each([
    cssStorage,
    sparqLwsStorage,
  ])("discovers $name and shares its features", async (fixture) => {
    const fetch = fixtureFetch(fixture);
    const cache = createMemoryCache();
    const options = { fetch, storage: fixture.resource, capabilities: cache, clock: () => 1234 };
    const client = await createPodClient(options);
    const protocol = fixture.name === "css" ? "solid" : "lws";
    expect(client.description).toMatchObject({ protocol, root: fixture.root, fetchedAt: 1234 });
    expect(client.storage.protocol).toBe(protocol);
    expect(client.storage.root).toBe(fixture.root);
    expect(client.features.protocol).toBe(protocol);
    expect(client.storage.features).toBe(client.features);
    expect(client.features.liveUpdates.state).toBe("available");
    expect(client.features.accessControl.detail.model).toBe(
      protocol === "solid" ? "wac" : "odrl-grants",
    );
    if (protocol === "solid") {
      expect(client.features.patch.detail.formats["text/turtle"]).toContain("text/n3");
      expect(fetch.calls.filter((call) => call.startsWith("OPTIONS"))).toEqual([
        `OPTIONS ${fixture.root}`,
      ]);
    } else {
      expect(fetch.calls).toHaveLength(2);
      // StorageDescription.id is the CID, not StorageRoot: a root storage link is foreign.
      const resource = await client.storage.head(fixture.resource);
      expect(resource.metadataUrl).toBe(`${fixture.resource}.linkset`);
    }
    const count = fetch.calls.length;
    expect((await createPodClient(options)).description).toEqual(client.description);
    expect(fetch.calls).toHaveLength(count);
    await expect(client.storage.read("https://foreign.example/private")).rejects.toMatchObject({
      code: "scope",
    });
    expect(fetch.calls).toHaveLength(count);
  });

  test.each([
    "solid",
    "lws",
  ] as const)("honours backend override %s and keeps discovery evidence", async (backend) => {
    const fixture = backend === "solid" ? sparqLwsStorage : cssStorage;
    const client = await createPodClient({
      fetch: fixtureFetch(fixture),
      storage: fixture.resource,
      capabilities: createMemoryCache(),
      backend,
    });
    expect(client.storage.protocol).toBe(backend);
    expect(client.features.protocol).toBe(fixture === cssStorage ? "solid" : "lws");
    expect(client.description.protocol).toBe(client.features.protocol);
  });

  test("rejects an invalid backend before discovery", async () => {
    const fetch = vi.fn();
    await expect(
      createPodClient({
        fetch,
        storage: cssStorage.resource,
        backend: "other",
      } as unknown as PodClientOptions),
    ).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("propagates discovery errors without choosing a default", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 404 }));
    await expect(
      createPodClient({
        fetch,
        storage: "https://missing.example/",
        capabilities: createMemoryCache(),
      }),
    ).rejects.toBeInstanceOf(CapabilitiesError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("aborts even with a warm cache and forwards signals with manual redirects", async () => {
    const base = fixtureFetch(sparqLwsStorage);
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => base(input, init));
    const controller = new AbortController();
    const options = {
      fetch,
      storage: sparqLwsStorage.resource,
      capabilities: createMemoryCache(),
      signal: controller.signal,
    };
    await createPodClient(options);
    for (const [, init] of fetch.mock.calls)
      expect(init).toMatchObject({ signal: controller.signal, redirect: "manual" });
    controller.abort();
    await expect(createPodClient(options)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("does not return a client if discovery aborts while reading cached data", async () => {
    const cache = createMemoryCache();
    const fetch = fixtureFetch(sparqLwsStorage);
    await createPodClient({ fetch, storage: sparqLwsStorage.resource, capabilities: cache });
    const controller = new AbortController();
    const get = cache.get.bind(cache);
    cache.get = async (id) => {
      const record = await get(id);
      controller.abort();
      return record;
    };
    await expect(
      createPodClient({
        fetch,
        storage: sparqLwsStorage.resource,
        capabilities: cache,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("uses the shared default cache when none is supplied", async () => {
    const fixture = cssStorage;
    const fetch = fixtureFetch(fixture);
    const client = await createPodClient({ fetch, storage: fixture.resource });
    expect(client.storage.protocol).toBe("solid");
    const count = fetch.calls.length;
    await createPodClient({ fetch, storage: fixture.resource });
    expect(fetch.calls).toHaveLength(count);
  });
});
