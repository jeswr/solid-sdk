// AUTHORED-BY Codex GPT-6.1-Sol

import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { IntegrationSyncError } from "./errors.js";
import { createSourceAuth, runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "./testing.js";
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
    expect(report.written).toEqual(written);
    expect(report.indexUrl).toBe("https://memory.test/index");
    expect(resolved).toEqual(["music/songs.ttl"]);
    expect(sourceAuth.fetch).toHaveBeenCalledOnce();
    expect(registerType).toHaveBeenCalledWith([
      { forClass: CLASSES.MusicRecording, container: "https://memory.test/music/" },
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  } finally {
    globalFetch.mockRestore();
  }
});
