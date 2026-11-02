// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { IntegrationSyncError } from "./errors.js";
import { createSourceAuth, runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { Provenance } from "./provenance.js";
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
  const [input, init] = transport.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
  const effective = new Request(input, init);
  expect(effective.headers.get("authorization")).toBe("Bearer fixture-token");
  expect(effective.headers.get("x-source")).toBe("preserved");
  expect(effective.redirect).toBe("manual");
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

it("never attaches a source token to a Request's hidden foreign target", async () => {
  const { vi } = await import("vitest");
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  const auth = createSourceAuth(
    "toy",
    toyAdapter,
    { accessToken: "fixture-token", tokenType: "Bearer" },
    transport,
    ["https://source.test"],
  );
  const request = new Request("https://foreign.test/steal");
  Object.defineProperty(request, "url", { value: "https://source.test/items" });
  await expect(auth.fetch(request)).rejects.toBeInstanceOf(IntegrationSyncError);
  expect(transport).not.toHaveBeenCalled();
});

it("snapshots source URLs and preserves native request body and policies", async () => {
  const { vi } = await import("vitest");
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    await Promise.resolve();
    const effective = new Request(input, init);
    expect(effective.url).toBe("https://source.test/items");
    expect(effective.method).toBe("PUT");
    expect(await effective.text()).toBe("private body");
    expect(effective.headers.get("authorization")).toBe("Bearer fixture-token");
    expect(effective.cache).toBe("no-store");
    expect(effective.mode).toBe("same-origin");
    expect(effective.keepalive).toBe(true);
    expect(effective.credentials).toBe("include");
    expect(effective.integrity).toBe("sha256-fixture");
    // refuseRedirects forwards { ...init, redirect: "manual" } with the Request, as on main,
    // and Fetch resets referrer fields when a Request meets a non-empty init.
    expect(effective.referrer).toBe("about:client");
    expect(effective.referrerPolicy).toBe("");
    expect(effective.redirect).toBe("manual");
    return new Response();
  });
  const auth = createSourceAuth(
    "toy",
    toyAdapter,
    { accessToken: "fixture-token", tokenType: "Bearer" },
    transport,
    ["https://source.test"],
  );
  const request = new Request("https://source.test/items", {
    method: "PUT",
    body: "private body",
    cache: "no-store",
    mode: "same-origin",
    keepalive: true,
    credentials: "include",
    integrity: "sha256-fixture",
    referrer: "https://source.test/referrer",
    referrerPolicy: "no-referrer",
  });
  await auth.fetch(request);
  transport.mockImplementationOnce(async (input, init) => {
    await Promise.resolve();
    expect(new Request(input, init).url).toBe("https://source.test/items");
    return new Response();
  });
  const url = new URL("https://source.test/items");
  const pending = auth.fetch(url);
  url.href = "https://foreign.test/steal";
  await pending;
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

// AUTHORED-BY Claude Opus 5.5
describe("runImport enforces cancellation for adapters that ignore ctx.signal", () => {
  const doc = () => ({
    slug: "music/songs.ttl",
    category: "media",
    forClass: CLASSES.MusicRecording,
    dataset: new Store(),
  });
  function ports(onRegister: () => void = () => {}) {
    const calls: string[] = [];
    const podWriter: import("./types.js").PodWriter = {
      resolve: (slug) => `https://memory.test/${slug}`,
      read: async (slug) => {
        calls.push(`read ${slug}`);
        return undefined;
      },
      write: async (written) => {
        calls.push(`write ${written.slug}`);
        return {
          url: `https://memory.test/${written.slug}`,
          category: written.category,
          forClass: written.forClass,
        };
      },
      writeBinary: async (binary) => {
        calls.push(`binary ${binary.slug}`);
        return { url: `https://memory.test/${binary.slug}` } as never;
      },
      remove: async (slug) => {
        calls.push(`remove ${slug}`);
      },
      registerType: async () => {
        calls.push("register");
        onRegister();
        return { indexUrl: "https://memory.test/index" };
      },
    };
    const sourceAuth = {
      fetch: async () => {
        calls.push("source");
        return Response.json({ songs: [] });
      },
    };
    return { calls, podWriter, sourceAuth };
  }
  const reason = new Error("cancelled by user");

  it("never calls the adapter for an already-cancelled run", async () => {
    const controller = new AbortController();
    controller.abort(reason);
    const { calls, podWriter, sourceAuth } = ports();
    let called = false;
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import() {
        called = true;
        return {};
      },
    };
    await expect(
      runImport({ adapter, mode: "live", podWriter, sourceAuth, signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(called).toBe(false);
    expect(calls).toEqual([]);
  });

  it.each([
    ["api", (ctx: ImportContext) => ctx.api("https://api.toy.test/songs")],
    ["read", (ctx: ImportContext) => ctx.read("music/songs.ttl")],
    ["write", (ctx: ImportContext) => ctx.write(doc())],
    [
      "writeBinary",
      (ctx: ImportContext) =>
        ctx.writeBinary({ slug: "files/a.bin", body: new Uint8Array(), contentType: "x/y" }),
    ],
    ["remove", (ctx: ImportContext) => ctx.remove("music/old.ttl")],
    [
      "progress",
      async (ctx: ImportContext) => ctx.progress({ label: "Saving", done: 1, total: 2 }),
    ],
  ] as const)("refuses ctx.%s once the run is cancelled, then skips registration and provenance", async (_name, step) => {
    const controller = new AbortController();
    const { calls, podWriter, sourceAuth } = ports();
    const progress: string[] = [];
    let refused: unknown;
    let before: string[] = [];
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.api("https://api.toy.test/songs");
        await ctx.write(doc());
        // This adapter never looks at ctx.signal.
        controller.abort(reason);
        before = [...calls];
        try {
          await step(ctx);
        } catch (error) {
          refused = error;
        }
        return {};
      },
    };
    await expect(
      runImport({
        adapter,
        mode: "live",
        podWriter,
        sourceAuth,
        signal: controller.signal,
        onProgress: (p) => progress.push(p.label),
      }),
    ).rejects.toBe(reason);
    expect(refused).toBe(reason);
    // Only the steps before cancellation ran: no registration and no provenance document.
    expect(before).toContain("write music/songs.ttl");
    expect(calls).toEqual(before);
    expect(progress).toEqual([]);
    // The connector is free for the next run.
    await expect(
      runImport({ adapter: { ...toyAdapter }, mode: "live", podWriter, sourceAuth }),
    ).resolves.toMatchObject({ indexUrl: "https://memory.test/index" });
  });

  it("rejects with the abort reason when the cancel surfaces as an adapter error", async () => {
    const controller = new AbortController();
    const { podWriter, sourceAuth } = ports();
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        controller.abort(reason);
        try {
          await ctx.write(doc());
        } catch {
          throw new Error("the source stream ended early");
        }
        return {};
      },
    };
    await expect(
      runImport({ adapter, mode: "live", podWriter, sourceAuth, signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("reports a cancel during the final provenance write as cancelled, not complete", async () => {
    const controller = new AbortController();
    const { podWriter, sourceAuth } = ports();
    const write = podWriter.write;
    podWriter.write = async (doc, condition) => {
      if (doc.slug === "_provenance.ttl") controller.abort(reason);
      return write(doc, condition);
    };
    const states: { lastOutcome?: string; lastSync?: string }[] = [];
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.write(doc());
        return { cursor: "next" };
      },
    };
    await expect(
      runImport({
        adapter,
        mode: "live",
        podWriter,
        sourceAuth,
        signal: controller.signal,
        onState: (state) => states.push(state),
      }),
    ).rejects.toBe(reason);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ lastOutcome: "error", lastSync: undefined });
  });

  it("does not write provenance when cancellation arrives during Type Index registration", async () => {
    const controller = new AbortController();
    const { calls, podWriter, sourceAuth } = ports(() => controller.abort(reason));
    const states: unknown[] = [];
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.write(doc());
        return { cursor: "next" };
      },
    };
    await expect(
      runImport({
        adapter,
        mode: "live",
        podWriter,
        sourceAuth,
        signal: controller.signal,
        onState: (state) => states.push(state),
      }),
    ).rejects.toBe(reason);
    expect(calls.filter((call) => !call.startsWith("read "))).toEqual([
      "write music/songs.ttl",
      "register",
    ]);
    // The failure state never advances the checkpoint.
    expect(states).toHaveLength(1);
    expect((states[0] as { cursor?: string }).cursor).toBeUndefined();
  });

  it("leaves a cancelled run's written documents naming an activity it never records (documented)", async () => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.write(doc());
        controller.abort(reason);
        return {};
      },
    };
    await expect(
      runImport({
        adapter,
        mode: "demo",
        podWriter: createFetchPodWriter({
          adapterId: "toy",
          webId: TEST_WEBID,
          profileDocumentUrl: TEST_PROFILE_DOC,
          podRoot: TEST_POD_ROOT,
          fetch: pod.fetch,
        }),
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    const docUrl = `${TEST_POD_ROOT}integrations/toy/music/songs.ttl`;
    const [activity] = new Provenance(docUrl, pod.dataset(docUrl), DataFactory).generatedBy;
    expect(activity).toMatch(/_provenance\.ttl#run-/);
    // No Pod I/O after cancellation: the run's activity is never described.
    expect(pod.get(`${TEST_POD_ROOT}integrations/toy/_provenance.ttl`)).toBeUndefined();
  });

  it("completes a run whose signal is still live through registration and provenance", async () => {
    const controller = new AbortController();
    const { calls, podWriter, sourceAuth } = ports();
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.write(doc());
        return {};
      },
    };
    const report = await runImport({
      adapter,
      mode: "live",
      podWriter,
      sourceAuth,
      signal: controller.signal,
    });
    expect(report.indexUrl).toBe("https://memory.test/index");
    expect(calls).toContain("register");
    expect(calls.filter((call) => call.startsWith("write ")).length).toBeGreaterThan(1);
  });
});

// AUTHORED-BY Claude Opus 5.5
describe("runImport checks cancellation at the Pod writer boundary", () => {
  const reason = new Error("cancelled by user");
  const doc = () => {
    const dataset = new Store();
    const song = new MusicRecording(
      `${TEST_POD_ROOT}integrations/toy/music/songs.ttl#song-1`,
      dataset,
      DataFactory,
    ).mark();
    song.name = "Demo Song";
    return {
      slug: "music/songs.ttl",
      category: "media",
      forClass: CLASSES.MusicRecording,
      dataset,
    };
  };
  /** Resolves `reached` when the paused call starts; it continues only after `release()`. */
  function pause() {
    let reached!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { started, reached: () => reached(), released, release: () => release() };
  }
  const writes = new Set(["PUT", "PATCH", "POST", "DELETE"]);

  it.each([
    ["session.write's implicit read", "music/songs.ttl", ["read music/songs.ttl"]],
    [
      "finish()'s provenance read",
      "_provenance.ttl",
      ["read music/songs.ttl", "write music/songs.ttl", "register", "read _provenance.ttl"],
    ],
  ] as const)("sends no write when cancelled during %s (custom PodWriter) and reports cancelled", async (_name, pausedSlug, expected) => {
    const controller = new AbortController();
    const gate = pause();
    const calls: string[] = [];
    const podWriter: import("./types.js").PodWriter = {
      resolve: (slug) => `https://memory.test/${slug}`,
      read: async (slug) => {
        calls.push(`read ${slug}`);
        if (slug === pausedSlug) {
          gate.reached();
          await gate.released;
        }
        return undefined;
      },
      write: async (written) => {
        calls.push(`write ${written.slug}`);
        return {
          url: `https://memory.test/${written.slug}`,
          category: written.category,
          forClass: written.forClass,
        };
      },
      registerType: async () => {
        calls.push("register");
        return { indexUrl: "https://memory.test/index" };
      },
    };
    const states: import("./types.js").ConnectorState[] = [];
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.write(doc());
        return { cursor: "next" };
      },
    };
    const run = runImport({
      adapter,
      mode: "demo",
      podWriter,
      signal: controller.signal,
      onState: (state) => states.push(state),
    });
    await gate.started;
    controller.abort(reason);
    gate.release();
    await expect(run).rejects.toBe(reason);
    expect(calls).toEqual(expected);
    // Reported as a failed run: no success state and no advanced checkpoint.
    expect(states).toEqual([expect.objectContaining({ lastOutcome: "error" })]);
    expect(states[0]?.cursor).toBeUndefined();
    // The connector is free for the next run.
    await expect(runImport({ adapter, mode: "demo", podWriter })).resolves.toMatchObject({
      cursor: "next",
    });
  });

  it.each([
    [
      "session.write's implicit read",
      (url: string, method: string) =>
        method === "GET" && url === `${TEST_POD_ROOT}integrations/toy/music/songs.ttl`,
    ],
    [
      "finish()'s provenance read",
      (url: string, method: string) =>
        method === "GET" && url === `${TEST_POD_ROOT}integrations/toy/_provenance.ttl`,
    ],
    [
      "Type Index registration's profile read",
      (url: string, method: string) => method === "GET" && url === TEST_PROFILE_DOC,
    ],
    [
      "writeBinary's replace-mode ETag read",
      (url: string, method: string) =>
        method === "HEAD" && url === `${TEST_POD_ROOT}integrations/toy/files/a.bin`,
    ],
  ] as const)("sends no Pod write request when cancelled during %s (fetch-backed writer)", async (_name, paused) => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const gate = pause();
    const sent: { method: string; url: string; signal?: AbortSignal | null }[] = [];
    let pausedSignal: AbortSignal | null | undefined;
    const transport: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      sent.push({ method, url, signal: init?.signal });
      if (paused(url, method)) {
        pausedSignal = init?.signal;
        gate.reached();
        await gate.released;
      }
      return pod.fetch(input, init);
    };
    const adapter: IntegrationAdapter = {
      ...toyAdapter,
      async import(ctx) {
        await ctx.write(doc());
        await ctx.writeBinary({
          slug: "files/a.bin",
          body: new Uint8Array([1]),
          contentType: "application/octet-stream",
          mode: "replace",
        });
        return {};
      },
    };
    const run = runImport({
      adapter,
      mode: "demo",
      podWriter: createFetchPodWriter({
        adapterId: "toy",
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch: transport,
        signal: controller.signal,
      }),
      signal: controller.signal,
    });
    await gate.started;
    const before = sent.length;
    controller.abort(reason);
    // The signal reaches the request itself, so a transport honouring it aborts in flight.
    expect(pausedSignal?.aborted).toBe(true);
    gate.release();
    await expect(run).rejects.toBe(reason);
    expect(sent.slice(before).filter((request) => writes.has(request.method))).toEqual([]);
    expect(sent.every((request) => request.signal instanceof AbortSignal)).toBe(true);
    expect(pod.get(`${TEST_POD_ROOT}integrations/toy/_provenance.ttl`)).toBeUndefined();
  });

  it("checks every Pod request inside a port, not only the port entry", async () => {
    const pod = createMemoryPod();
    const controller = new AbortController();
    const sent: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      sent.push(`${method} ${input instanceof Request ? input.url : String(input)}`);
      const response = await pod.fetch(input, init);
      // Cancel after Type Index registration's first read completes, inside registerType.
      if (method === "GET" && String(input) === TEST_PROFILE_DOC) controller.abort(reason);
      return response;
    };
    const writer = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: transport,
      signal: controller.signal,
    });
    await expect(
      writer.registerType([
        { forClass: CLASSES.MusicRecording, container: `${TEST_POD_ROOT}integrations/toy/music/` },
      ]),
    ).rejects.toBe(reason);
    const profileRead = sent.indexOf(`GET ${TEST_PROFILE_DOC}`);
    expect(profileRead).toBeGreaterThanOrEqual(0);
    expect(sent.slice(profileRead + 1)).toEqual([]);
  });
});
