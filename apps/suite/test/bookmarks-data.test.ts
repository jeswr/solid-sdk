// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { verifyPrivateDemoAccess } from "@jeswr/pod-access/roles";
import { createBookmarkRepository } from "@jeswr/solid-bookmark/pod";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { fixtureFetch, sparqLwsStorage } from "@jeswr/storage-capabilities/testing";
import { createPodClient } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/bookmarks/demo/sample";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

describe("bookmark demo pod", () => {
  it("seeds real generated resources, registers their class and leaves an emptied library empty", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.now(), { calendar: false }),
    });
    const { storage } = await createPodClient({
      storage: DEMO_ROOT,
      fetch: pod.fetch,
      capabilities: createMemoryCache(),
    });
    const options = { mode: "demo", fetch: pod.fetch, storageUrl: DEMO_ROOT, webId: DEMO_WEBID };
    const repository = createBookmarkRepository({
      storage,
      profile: DEMO_WEBID,
      fetch: pod.fetch,
      verifyOwnerOnly: (url) => verifyPrivateDemoAccess(options, url, DEMO_WEBID),
    });
    await ensureSample(options, repository, new Date("2026-11-11T12:00:00Z"));
    const { items } = await repository.list();
    expect(items).toHaveLength(6);
    expect(items.filter((item) => item.data.archived)).toHaveLength(2);
    expect(repository.registration).toBe("registered");
    for (const item of items) await repository.remove(item);
    await ensureSample(options, repository);
    expect((await repository.list()).items).toEqual([]);
  });
  it("does not seed real accounts or overwrite unreadable demo storage", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.now(), { calendar: false }),
    });
    const { storage } = await createPodClient({
      storage: DEMO_ROOT,
      fetch: pod.fetch,
      capabilities: createMemoryCache(),
    });
    const repository = createBookmarkRepository({
      storage,
      profile: DEMO_WEBID,
      fetch: pod.fetch,
    });
    await ensureSample({ mode: "solid", fetch: pod.fetch, storageUrl: DEMO_ROOT }, repository);
    const denied = async () => new Response(null, { status: 403 });
    await expect(
      ensureSample({ mode: "demo", fetch: denied, storageUrl: DEMO_ROOT }, repository),
    ).rejects.toThrow("check sample");
  });
});

it.each([
  ["sibling resource", "elsewhere/entry", "elsewhere/", "DataResource"],
  ["auxiliary resource", "bookmarks/entry.acl", "bookmarks/", "DataResource"],
  ["wrong kind", "bookmarks/entry/", "bookmarks/", "Container"],
])("refuses an LWS create Location for a %s before reading, writing or cleaning it up", async (_, path, parent, kind) => {
  const fixture = fixtureFetch(sparqLwsStorage);
  const root = sparqLwsStorage.root;
  const container = `${root}bookmarks/`;
  const destination = `${root}${path}`;
  const lws = "https://www.w3.org/ns/lws#";
  const describe = (type: string, up: string) =>
    new Response(null, {
      headers: { Link: `<${lws}${type}>; rel="type", <${up}>; rel="up"`, ETag: '"v1"' },
    });
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const url = String(input);
    if (url === container && init?.method === "HEAD")
      return Promise.resolve(describe("Container", root));
    if (url === container && init?.method === "POST")
      return Promise.resolve(
        new Response(null, { status: 201, headers: { Location: destination } }),
      );
    if (url === destination && init?.method === "HEAD")
      return Promise.resolve(describe(kind, `${root}${parent}`));
    return fixture(input, init);
  });
  const { storage } = await createPodClient({
    storage: sparqLwsStorage.resource,
    fetch,
    capabilities: createMemoryCache(),
  });
  const repo = createBookmarkRepository({
    storage,
    profile: "https://id.example/person#me",
    fetch,
    verifyOwnerOnly: async () => true,
  });
  await expect(
    repo.create({ url: "https://example.org/", notes: "Private" }),
  ).rejects.toMatchObject({
    code: "invalid-response",
  });
  expect(
    fetch.mock.calls.some(([url, init]) => String(url) === container && init?.method === "POST"),
  ).toBe(true);
  expect(
    fetch.mock.calls.filter(
      ([url, init]) => String(url) === destination && init?.method !== "HEAD",
    ),
  ).toEqual([]);
});

it("bounds a streaming child read and keeps healthy siblings with their response ETags", async () => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  const cancelled = vi.fn();
  let oversized: string | undefined;
  let readSignal: AbortSignal | null | undefined;
  const fetch: typeof globalThis.fetch = (input, init) => {
    if (String(input) === oversized && init?.method === "GET") {
      readSignal = init.signal;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(256 * 1024));
            },
            cancel: cancelled,
          }),
          { headers: { "Content-Type": "text/turtle" } },
        ),
      );
    }
    return pod.fetch(input, init);
  };
  const { storage } = await createPodClient({
    storage: DEMO_ROOT,
    fetch,
    capabilities: createMemoryCache(),
  });
  const repo = createBookmarkRepository({
    storage,
    profile: DEMO_WEBID,
    fetch,
    verifyOwnerOnly: (url) =>
      verifyPrivateDemoAccess(
        { mode: "demo", fetch, storageUrl: DEMO_ROOT, webId: DEMO_WEBID },
        url,
        DEMO_WEBID,
      ),
  });
  const good = await repo.create({ url: "https://example.org/good" });
  const large = await repo.create({ url: "https://example.org/large" });
  oversized = large.url;
  const deadline = vi.spyOn(AbortSignal, "timeout");
  try {
    expect(await repo.list()).toMatchObject({
      items: [{ url: good.url, etag: good.etag }],
      skipped: [{ url: large.url, reason: "payload-too-large" }],
    });
    expect(deadline).toHaveBeenCalledWith(10_000);
  } finally {
    deadline.mockRestore();
  }
  expect(cancelled).toHaveBeenCalledOnce();
  expect(readSignal).toBeInstanceOf(AbortSignal);
});
