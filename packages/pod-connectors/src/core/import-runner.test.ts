// AUTHORED-BY Codex GPT-6.1-Sol

import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { IntegrationSyncError } from "./errors.js";
import { createSourceAuth, runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "./testing.js";
import type { ImportContext, IntegrationAdapter } from "./types.js";
import { CLASSES, MusicRecording } from "./vocab.js";

/** Minimal adapter exercising the full runner path. */
const toyAdapter: IntegrationAdapter = {
  metadata: {
    id: "toy",
    name: "Toy",
    tier: "A",
    authKind: "oauth-pkce",
    scopes: [],
    categories: ["media"],
    whatYouGet: "One song.",
    requirements: [],
  },
  apiHeaders: { "x-toy": "1" },
  fixtures: () => [
    { url: "https://api.toy.test/songs", json: { songs: [{ id: "s1", title: "Demo Song" }] } },
  ],
  async import(ctx: ImportContext) {
    const res = await ctx.api("https://api.toy.test/songs");
    const { songs } = (await res.json()) as { songs: { id: string; title: string }[] };
    const store = new Store();
    const docUrl = ctx.resolve("music/songs.ttl");
    for (const s of songs) {
      const rec = new MusicRecording(`${docUrl}#song-${s.id}`, store, DataFactory).mark();
      rec.name = s.title;
      rec.identifier = s.id;
    }
    ctx.progress({ label: "Saving songs", done: 1, total: 1 });
    await ctx.write({
      slug: "music/songs.ttl",
      category: "media",
      forClass: CLASSES.MusicRecording,
      dataset: store,
    });
    return { cursor: "after-s1" };
  },
};

describe("runImport (demo mode, memory pod)", () => {
  it("writes fixture data into the adapter container and registers the class", async () => {
    const pod = createMemoryPod();
    const progress: string[] = [];

    const report = await runImport({
      adapter: toyAdapter,
      podWriter: createFetchPodWriter({
        adapterId: "toy",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: pod.fetch,
      }),
      mode: "demo",

      onProgress: (p) => progress.push(p.label),
    });

    const docUrl = `${TEST_POD_ROOT}integrations/toy/music/songs.ttl`;
    expect(report.written.map((w) => w.url)).toEqual([docUrl]);
    expect(report.categories).toEqual(["media"]);
    expect(report.cursor).toBe("after-s1");
    expect(progress).toContain("Saving songs");

    // The exact RDF: typed MusicRecording with the fixture title.
    const ds = pod.dataset(docUrl);
    const rec = new MusicRecording(`${docUrl}#song-s1`, ds, DataFactory);
    expect(rec.types.has(CLASSES.MusicRecording)).toBe(true);
    expect(rec.name).toBe("Demo Song");

    // Registered in the (bootstrapped) type index → appears under My data.
    expect(pod.get(report.indexUrl)).toContain(CLASSES.MusicRecording);
    expect(pod.get(report.indexUrl)).toContain("integrations/toy/music/");
  });

  it("is idempotent: re-import overwrites the same doc, no duplicates", async () => {
    const pod = createMemoryPod();
    const opts = {
      adapter: toyAdapter,
      podWriter: createFetchPodWriter({
        adapterId: "toy",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: pod.fetch,
      }),
      mode: "demo" as const,
    };
    const first = await runImport(opts);
    const urlsAfterFirst = pod.urls();
    const second = await runImport({ ...opts, cursor: first.cursor });

    expect(pod.urls()).toEqual(urlsAfterFirst); // same resources, nothing new
    expect(second.written).toHaveLength(1);
    const ds = pod.dataset(second.written[0].url);
    // Still exactly one song subject — overwritten, not appended.
    expect([...ds].filter((q) => q.predicate.value.endsWith("/name"))).toHaveLength(1);
  });

  it("refuses live mode without a token", async () => {
    const pod = createMemoryPod();
    await expect(
      runImport({
        adapter: toyAdapter,
        podWriter: createFetchPodWriter({
          adapterId: "toy",
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: TEST_POD_ROOT,
          fetch: pod.fetch,
        }),
        mode: "live",
      }),
    ).rejects.toBeInstanceOf(IntegrationSyncError);
  });

  it("injects the bearer token + adapter headers in live mode", async () => {
    const pod = createMemoryPod();
    const seen: Record<string, string | null>[] = [];
    const apiFetch: typeof fetch = async (_input, init) => {
      const h = new Headers(init?.headers);
      seen.push({ authorization: h.get("authorization"), "x-toy": h.get("x-toy") });
      return Response.json({ songs: [] });
    };

    await runImport({
      adapter: toyAdapter,
      podWriter: createFetchPodWriter({
        adapterId: "toy",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: pod.fetch,
      }),
      mode: "live",
      sourceAuth: createSourceAuth(
        "toy",
        toyAdapter,
        { accessToken: "tok-1", tokenType: "Bearer" },
        apiFetch,
      ),
    });

    expect(seen[0]).toEqual({ authorization: "Bearer tok-1", "x-toy": "1" });
  });
});

// AUTHORED-BY Codex GPT-6.1-Sol
it("runs over explicit storage and source ports without using global fetch", async () => {
  const { vi } = await import("vitest");
  const globalFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected global I/O"));
  const resolved: string[] = [];
  const written: import("./types.js").WrittenDoc[] = [];
  const sourceAuth = {
    fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ songs: [] })),
  };
  const registerType = vi.fn().mockResolvedValue({ indexUrl: "https://memory.test/index" });
  const podWriter: import("./types.js").PodWriter = {
    resolve: (slug) => {
      resolved.push(slug);
      return `https://memory.test/${slug}`;
    },
    read: async () => undefined,
    write: async (doc) => {
      const result = {
        url: `https://memory.test/${doc.slug}`,
        category: doc.category,
        forClass: doc.forClass,
      };
      written.push(result);
      return result;
    },
    registerType,
  };
  try {
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        expect(await ctx.read("old.ttl")).toBeUndefined();
        ctx.resolve("music/songs.ttl");
        await ctx.api("https://source.test/songs");
        await ctx.write({
          slug: "music/songs.ttl",
          category: "media",
          forClass: CLASSES.MusicRecording,
          dataset: new Store(),
        });
        return {};
      },
    };
    const report = await runImport({ adapter, mode: "live", podWriter, sourceAuth });
    expect(report.written).toEqual(written.filter((w) => w.category !== "provenance"));
    expect(written.filter((w) => w.category === "provenance")).toHaveLength(1);
    expect(report.indexUrl).toBe("https://memory.test/index");
    expect(resolved).toContain("music/songs.ttl");
    expect(sourceAuth.fetch).toHaveBeenCalledOnce();
    expect(registerType).toHaveBeenCalledWith([
      { forClass: CLASSES.MusicRecording, container: "https://memory.test/music/" },
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  } finally {
    globalFetch.mockRestore();
  }
});

// AUTHORED-BY Codex GPT-6.1-Sol
it("retains read preconditions and surfaces a concurrent 412 without clobbering data", async () => {
  const pod = createMemoryPod();
  const port = createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const doc = {
    slug: "music/songs.ttl",
    category: "media",
    forClass: CLASSES.MusicRecording,
    dataset: new Store(),
  };
  await port.write(doc);
  const adapter: IntegrationAdapter = {
    ...toyAdapter,
    async import(ctx) {
      await ctx.read(doc.slug);
      await port.write(doc); // concurrent writer changes the ETag after our read
      await ctx.write(doc);
      return {};
    },
  };
  await expect(runImport({ adapter, mode: "demo", podWriter: port })).rejects.toMatchObject({
    status: 412,
  });
  expect((await port.read(doc.slug))?.etag).toBe('"v2"');
});

it("uses create-only semantics after an absent read and passes explicit conditions", async () => {
  const pod = createMemoryPod();
  const port = createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const doc = {
    slug: "music/songs.ttl",
    category: "media",
    forClass: CLASSES.MusicRecording,
    dataset: new Store(),
  };
  const adapter: IntegrationAdapter = {
    ...toyAdapter,
    async import(ctx) {
      expect(await ctx.read(doc.slug)).toBeUndefined();
      await port.write(doc);
      await expect(ctx.write(doc)).rejects.toMatchObject({ status: 412 });
      await ctx.write(doc, { ifMatch: '"v1"' });
      return {};
    },
  };
  await runImport({ adapter, mode: "demo", podWriter: port });
  expect((await port.read(doc.slug))?.etag).toBe('"v2"');
});

it("restricts bearer credentials to allowed origins and refuses source redirects", async () => {
  const { vi } = await import("vitest");
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  const auth = createSourceAuth(
    "toy",
    toyAdapter,
    { accessToken: "fixture-token", tokenType: "Bearer" },
    transport,
    ["https://source.test"],
  );
  await auth.fetch(
    new Request("https://source.test/items", { headers: { "x-source": "preserved" } }),
  );
  const init = transport.mock.calls[0]![1];
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-token");
  expect(new Headers(init?.headers).get("x-source")).toBe("preserved");
  expect(init?.redirect).toBe("manual");
  await expect(auth.fetch("https://foreign.test/items")).rejects.toBeInstanceOf(
    IntegrationSyncError,
  );
  await expect(auth.fetch("https://user:password@source.test/items")).rejects.toBeInstanceOf(
    IntegrationSyncError,
  );
  await expect(auth.fetch("http://source.test/items")).rejects.toBeInstanceOf(IntegrationSyncError);
  expect(() =>
    createSourceAuth(
      "toy",
      toyAdapter,
      { accessToken: "fixture-token", tokenType: "Bearer" },
      transport,
      ["http://source.test"],
    ),
  ).toThrow();
  expect(transport).toHaveBeenCalledOnce();
  transport.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "https://foreign.test/leak" } }),
  );
  await expect(auth.fetch("https://source.test/items", { redirect: "follow" })).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(2);
  expect(() => createSourceAuth("toy", toyAdapter, undefined, transport)).toThrow();
});

it("forwards explicit file-import write conditions to the Pod port", async () => {
  const { runFileImport } = await import("./file-import.js");
  const { memoryFile } = await import("./testing.js");
  const pod = createMemoryPod();
  const port = createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const adapter: import("./file-import.js").FileImportAdapter = {
    metadata: { ...toyAdapter.metadata, tier: "C", authKind: "export-file" },
    accept: ".txt",
    fileHint: "Synthetic fixture",
    async importFile(_file, ctx) {
      await ctx.write(
        {
          slug: "items.ttl",
          category: "media",
          forClass: CLASSES.MusicRecording,
          dataset: new Store(),
        },
        { ifNoneMatch: "*" },
      );
    },
  };
  const options = { adapter, file: memoryFile("fixture.txt", "fixture"), podWriter: port };
  await runFileImport(options);
  await expect(runFileImport(options)).rejects.toMatchObject({ status: 412 });
});
