// AUTHORED-BY Codex GPT-6.1-Sol
import { strFromU8, Unzip, UnzipPassThrough, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  createPodFetch,
  type ExportPlan,
  exportPod,
  inventoryPod,
  planExport,
} from "../src/index.js";
import { pathAllocator } from "../src/paths.js";
import { abortable, addZipBytes, exportError, HttpError, kindFor, sizeOf } from "../src/scope.js";

const root = "https://pod.example/alice/";
const text = new TextEncoder();
type File = {
  body?: string | Uint8Array;
  type?: string;
  members?: string[];
  link?: string;
  head?: number;
  get?: number;
  size?: string;
  fail?: boolean;
};
function pod(files: Record<string, File>) {
  const calls: { url: string; method: string; accept: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET";
    calls.push({ url, method, accept: new Headers(init?.headers).get("accept") });
    expect(init?.redirect).toBe("manual");
    const item = files[url.slice(root.length)];
    if (!item) return new Response(null, { status: 404 });
    if (item.fail) throw new Error("transport included a secret");
    const status = (method === "HEAD" ? item.head : item.get) ?? 200;
    const body = item.members
      ? `@prefix ldp: <http://www.w3.org/ns/ldp#>. <> a ldp:BasicContainer. ${item.members.length ? `<> ldp:contains ${item.members.map((url) => `<${url.includes(":") || url.startsWith(".") ? url : root + url}>`).join(", ")}.` : ""}`
      : (item.body ?? "hello");
    const headers = new Headers({
      "content-type": item.type ?? (item.members ? "text/turtle" : "application/octet-stream"),
    });
    if (item.link) headers.set("link", item.link);
    if (item.size !== "unknown")
      headers.set(
        "content-length",
        item.size ?? String(typeof body === "string" ? text.encode(body).length : body.length),
      );
    return new Response(method === "HEAD" || status === 204 ? null : (body as BodyInit), {
      status,
      headers,
    });
  };
  return { fetch, calls };
}
function plan(paths: string[]): ExportPlan {
  return {
    root,
    resources: paths.map((path) => ({
      url: root + path,
      kind: path.endsWith("/") ? "container" : "binary",
      contentType: "application/octet-stream",
    })),
    estimatedBytes: 0,
    unknownSizes: paths.length,
  };
}
async function archive(
  fetch: typeof globalThis.fetch,
  planned?: ExportPlan,
  extra: Partial<Parameters<typeof exportPod>[0]> = {},
) {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const byOffset = new Map<number, Uint8Array>();
  const manifest = await exportPod({
    fetch,
    root,
    plan: planned,
    sink(chunk) {
      chunks.push(chunk);
      byOffset.set(offset, chunk);
      offset += chunk.byteLength;
    },
    patch(offset, chunk) {
      byOffset.get(offset)?.set(chunk);
    },
    ...extra,
  });
  const result = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return { manifest, files: unzipSync(result), bytes: result };
}

describe("inventory", () => {
  it("walks breadth first, deduplicates aliases, estimates HEAD bytes, and records unknown sizes", async () => {
    const server = pod({
      "": { members: ["a/", "b/", "same", "same#alias"] },
      "a/": { members: ["a/file"] },
      "b/": { members: [] },
      same: { body: "hé" },
      "a/file": { size: "unknown" },
    });
    const result = await planExport({ fetch: server.fetch, root });
    expect(result.resources.map((r) => r.url.slice(root.length))).toEqual([
      "",
      "a/",
      "b/",
      "same",
      "a/file",
    ]);
    expect(result.estimatedBytes).toBe(3);
    expect(result.unknownSizes).toBe(1);
    expect(server.calls.filter((c) => c.method === "HEAD").map((c) => c.url)).toEqual(
      result.resources.map((r) => r.url),
    );
  });
  it("selects subtrees, traverses their ancestors, and prunes excluded subtrees", async () => {
    const server = pod({
      "": { members: ["a/", "b/"] },
      "a/": { members: ["a/x", "a/private/"] },
      "a/x": {},
      "a/private/": { members: [] },
      "b/": { members: [] },
    });
    const result = await planExport({
      fetch: server.fetch,
      root,
      include: ["a/x"],
      exclude: ["a/private/"],
    });
    expect(result.resources.map((r) => r.url.slice(root.length))).toEqual(["", "a/", "a/x"]);
    expect(server.calls.some((c) => /private|\/b\//.test(c.url))).toBe(false);
    expect((await planExport({ fetch: server.fetch, root, include: [] })).resources).toEqual([]);
    expect((await planExport({ fetch: server.fetch, root, exclude: [root] })).resources).toEqual(
      [],
    );
  });
  it("rejects escaping members and aliases without fetching them", async () => {
    const server = pod({
      "": {
        members: [
          root,
          `${root}?q`,
          `${root}#self`,
          "https://evil.example/file",
          "../sibling",
          "https://pod.example/alice-other/file",
          "a%2fb",
          "a%5cb",
          "../../secret",
          "ok",
          "bad?query",
        ],
      },
      ok: {},
    });
    const result = await planExport({ fetch: server.fetch, root });
    expect(result.resources.map((r) => r.url)).toEqual([root, `${root}ok`]);
    expect(server.calls.every((c) => c.url === root || c.url === `${root}ok`)).toBe(true);
  });
  it("does not follow escaping, anchored or query auxiliary links; marks readable linked documents", async () => {
    const server = pod({
      "": {
        members: ["one"],
        link: '<.acl>; rel="acl", <https://evil.example/x>; rel="describedby", <other>; rel="acl"; anchor="foreign"',
      },
      one: { link: '<one.meta>; rel="describedby", <one.acl>; rel="acl"' },
      ".acl": { type: "text/turtle" },
      "one.meta": { type: "text/turtle" },
      "one.acl": { type: "text/turtle" },
    });
    const result = await planExport({ fetch: server.fetch, root });
    expect(result.resources.filter((r) => r.kind === "acl").map((r) => r.url)).toEqual([
      `${root}.acl`,
      `${root}one.acl`,
    ]);
    expect(result.resources.find((r) => r.kind === "meta")?.url).toBe(`${root}one.meta`);
    expect(server.calls.some((c) => /evil|other/.test(c.url))).toBe(false);
    const excluded = await planExport({ fetch: server.fetch, root, exclude: [".acl"] });
    expect(excluded.resources.some((r) => r.url === `${root}.acl`)).toBe(false);
  });
  it.each([401, 403, 404, 410, 500, 502, 503])("records HTTP %i on HEAD", async (status) => {
    const server = pod({ "": { members: ["file"] }, file: { head: status } });
    expect((await planExport({ fetch: server.fetch, root })).resources[1]?.error).toEqual({
      status,
      message: `HTTP ${status}`,
    });
  });
  it.each([401, 403, 404, 500])("records HTTP %i on a container GET", async (status) => {
    const server = pod({ "": { members: [], get: status } });
    expect((await planExport({ fetch: server.fetch, root })).resources[0]?.error?.status).toBe(
      status,
    );
  });
  it("permits unsupported HEAD and records transport/parse failures without leaking errors", async () => {
    const server = pod({
      "": { members: ["file", "bad/"] },
      file: { head: 405 },
      "bad/": { body: "invalid Turtle", type: "text/turtle" },
    });
    const result = await planExport({ fetch: server.fetch, root });
    expect(result.resources[1]?.error).toBeUndefined();
    expect(result.resources[2]?.error?.message).toBe("Resource could not be read");
    expect(
      (await planExport({ fetch: pod({ "": { fail: true } }).fetch, root })).resources[0]?.error
        ?.message,
    ).toBe("Resource could not be read");
  });
  it("enforces entry/depth bounds including linked auxiliaries", async () => {
    const server = pod({ "": { members: ["file"] }, file: {} });
    await expect(planExport({ fetch: server.fetch, root, maxEntries: 1 })).rejects.toThrow(
      "maxEntries",
    );
    await expect(planExport({ fetch: server.fetch, root, maxDepth: 0 })).rejects.toThrow(
      "maxDepth",
    );
    const links = pod({ "": { members: [], link: "<.acl>; rel=acl" }, ".acl": {} });
    await expect(planExport({ fetch: links.fetch, root, maxEntries: 1 })).rejects.toThrow(
      "maxEntries",
    );
    expect(
      (
        await planExport({
          fetch: pod({ "": { members: [] } }).fetch,
          root,
          maxDepth: 0,
          maxEntries: 1,
        })
      ).resources,
    ).toHaveLength(1);
  });
  it.each([
    { maxEntries: 0 },
    { maxEntries: 1.1 },
    { maxDepth: -1 },
    { maxDepth: Infinity },
    { include: ["https://evil.example/"] },
    { exclude: ["../"] },
  ])("rejects invalid options %j before requests", async (extra) => {
    const fetch = vi.fn();
    await expect(planExport({ fetch, root, ...extra })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses redirects and dishonest response URLs", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    expect((await planExport({ fetch, root })).resources[0]?.error).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const response = new Response();
    Object.defineProperty(response, "url", { value: "https://evil.example/" });
    expect(
      (await planExport({ fetch: async () => response, root })).resources[0]?.error,
    ).toBeDefined();
  });
  it("cancels stalled fetch and listing reads promptly", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    const pending = planExport({ fetch, root, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const second = new AbortController();
    const server: typeof globalThis.fetch = async (_url, init) =>
      init?.method === "HEAD"
        ? new Response()
        : new Response(
            new ReadableStream({
              start() {
                second.abort();
              },
            }),
            { headers: { "content-type": "text/turtle" } },
          );
    await expect(planExport({ fetch: server, root, signal: second.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("ZIP", () => {
  it("round trips exact binary and Turtle bytes with folders, manifest, linked ACLs and progress", async () => {
    const binary = new Uint8Array([0, 255, 1, 128]);
    const turtle = '<#me> <urn:title> "Héllo".\n';
    const server = pod({
      "": { members: ["folder/", "data.ttl"], link: "<.acl>; rel=acl" },
      "folder/": { members: ["folder/binary"] },
      "folder/binary": { body: binary },
      "data.ttl": { body: turtle, type: "text/turtle" },
      ".acl": { body: turtle, type: "text/turtle" },
    });
    const progress = vi.fn();
    const { manifest, files } = await archive(server.fetch, undefined, { onProgress: progress });
    expect(files["pod/folder/binary"]).toEqual(binary);
    expect(strFromU8(files["pod/data.ttl"] as Uint8Array)).toBe(turtle);
    expect(files["pod/folder/"]).toEqual(new Uint8Array());
    expect(JSON.parse(strFromU8(files["export-manifest.json"] as Uint8Array))).toEqual(manifest);
    expect(manifest.entries.find((entry) => entry.kind === "acl")?.path).toBe("pod/.acl");
    expect(manifest.entries.find((entry) => entry.kind === "rdf")?.bytes).toBe(
      text.encode(turtle).length,
    );
    expect(new Date(manifest.exportedAt).toISOString()).toBe(manifest.exportedAt);
    expect(progress.mock.lastCall?.[0]).toMatchObject({
      files: 3,
      totalFiles: 3,
      bytes: binary.length + text.encode(turtle).length * 2,
    });
    expect(
      server.calls.find((c) => c.method === "GET" && c.url === `${root}data.ttl`)?.accept,
    ).toBe("text/turtle");
    expect(server.calls.find((c) => c.method === "GET" && c.url.endsWith("binary"))?.accept).toBe(
      "*/*",
    );
  });
  it.each([
    401, 403, 404, 410, 500, 502, 503,
  ])("skips GET HTTP %i without breaking the ZIP", async (status) => {
    const server = pod({ bad: { get: status }, good: {} });
    const { files, manifest } = await archive(server.fetch, plan(["bad", "good"]));
    expect(files["pod/bad"]).toBeUndefined();
    expect(strFromU8(files["pod/good"] as Uint8Array)).toBe("hello");
    expect(manifest.entries[0]).toMatchObject({ bytes: 0, error: { status } });
  });
  it("retains planning errors, handles GET transport errors and null bodies", async () => {
    const planned = plan(["a", "b", "c"]);
    if (planned.resources[0]) planned.resources[0].error = { message: "HTTP 403", status: 403 };
    const server = pod({ b: { fail: true }, c: { get: 204 } });
    const { files, manifest } = await archive(server.fetch, planned);
    expect(manifest.entries.slice(0, 2).every((entry) => entry.error)).toBe(true);
    expect(files["pod/c"]).toEqual(new Uint8Array());
    expect(server.calls.some((c) => c.url === `${root}a`)).toBe(false);
  });
  it("discovers auxiliaries advertised only on content GET and deduplicates linked/listed files", async () => {
    const server = pod({
      one: {
        link: "<one.acl>; rel=acl, <one.meta>; rel=describedby, <https://evil.example/x>; rel=acl",
      },
      "one.acl": { link: "<one>; rel=describedby" },
      "one.meta": {},
    });
    const { files, manifest } = await archive(server.fetch, plan(["one", "one.acl"]));
    expect(Object.keys(files)).toContain("pod/one.meta");
    expect(manifest.entries.find((r) => r.url.endsWith("one.acl"))?.kind).toBe("acl");
    expect(server.calls.filter((call) => call.method === "GET")).toHaveLength(3);
  });
  it("limits outstanding requests and preserves streaming backpressure", async () => {
    let active = 0,
      maximum = 0,
      reads = 0,
      writes = 0;
    const fetch: typeof globalThis.fetch = async () => {
      active++;
      maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response(
        new ReadableStream({
          pull(controller) {
            reads++;
            controller.enqueue(text.encode("chunk"));
            controller.close();
          },
        }),
      );
    };
    await exportPod({
      fetch,
      root,
      plan: plan(Array.from({ length: 12 }, (_, i) => `file${i}`)),
      concurrency: 3,
      async sink() {
        writes++;
        await Promise.resolve();
      },
    });
    expect(maximum).toBe(1);
    expect(reads).toBe(12);
    expect(writes).toBeGreaterThan(reads);
  });
  it("aborts mid-stream and cancels a stalled reader", async () => {
    const controller = new AbortController(),
      cancelled = vi.fn();
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(text.encode("first"));
          },
          cancel: cancelled,
        }),
      );
    await expect(
      exportPod({
        fetch,
        root,
        plan: plan(["file"]),
        signal: controller.signal,
        sink() {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalled();
    const second = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const stalled = exportPod({
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull() {
              entered();
            },
          }),
        ),
      root,
      plan: plan(["file"]),
      signal: second.signal,
      sink() {},
    });
    await started;
    second.abort();
    await expect(stalled).rejects.toMatchObject({ name: "AbortError" });
  });
  it("fails on a rejected sink and records a mid-body network failure as partial", async () => {
    const server = pod({ file: {} });
    await expect(
      exportPod({
        fetch: server.fetch,
        root,
        plan: plan(["file"]),
        sink() {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    const { manifest, files } = await archive(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error("broken"));
            },
          }),
        ),
      plan(["file"]),
    );
    expect(manifest.entries[0]?.error).toBeDefined();
    expect(files["pod/file.partial"]).toEqual(new Uint8Array());
    expect(manifest.entries[0]?.partial).toBe(true);
  });
  it("validates reused plans and applies filters and caps again", async () => {
    const fetch = vi.fn();
    await expect(
      archive(fetch, { ...plan(["file"]), root: "https://other.example/" }),
    ).rejects.toThrow("another root");
    await expect(
      archive(fetch, {
        ...plan([]),
        resources: [{ url: "https://evil.example/x", kind: "binary", contentType: "" }],
      }),
    ).rejects.toThrow();
    await expect(archive(fetch, plan(["file"]), { maxDepth: 0 })).rejects.toThrow("maxDepth");
    await expect(archive(fetch, plan(["a", "b"]), { maxEntries: 1 })).rejects.toThrow("maxEntries");
    const result = await archive(fetch, plan(["file"]), { exclude: ["file"] });
    expect(result.manifest.entries).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    for (const concurrency of [0, -1, 1.2, 33, Infinity])
      await expect(archive(fetch, plan([]), { concurrency })).rejects.toThrow("concurrency");
    const controller = new AbortController();
    controller.abort();
    await expect(archive(fetch, plan([]), { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("safe ZIP names and metadata", () => {
  it("sanitises traversal-like names, Unicode, invalid escapes and deterministic hierarchy collisions", () => {
    const path = pathAllocator(root);
    const inputs = [
      "a",
      "a/",
      "a/child",
      "%61",
      "caf%C3%A9",
      "cafe%CC%81",
      "%00",
      "%3A",
      "%2e%2e%20",
      "%ZZ",
    ];
    const paths = inputs.map((name) => path(root + name, name.endsWith("/")));
    expect(paths).toEqual([
      "pod/a",
      "pod/a~2/",
      "pod/a~2/child",
      "pod/a~3",
      "pod/café",
      "pod/café~2",
      "pod/_",
      "pod/_~2",
      "pod/_~3",
      "pod/%ZZ",
    ]);
    expect(paths.every((name) => !name.startsWith("/") && !name.split("/").includes(".."))).toBe(
      true,
    );
    expect(path(`${root}a`, false)).toBe("pod/a");
    expect(path(root, true)).toBe("pod/");
  });
  it("unpacks colliding names to distinct exact bytes regardless of plan ordering", async () => {
    const server = pod({
      a: { body: "first" },
      "%61": { body: "second" },
      "a/": { members: [] },
      "a/child": { body: "third" },
    });
    const result = await archive(server.fetch, plan(["a/child", "a/", "a", "%61"]));
    expect(new Set(result.manifest.entries.map((r) => r.path)).size).toBe(4);
    for (const entry of result.manifest.entries.filter((r) => r.kind !== "container"))
      expect(strFromU8(result.files[entry.path] as Uint8Array)).toBe(
        entry.url.endsWith("child") ? "third" : entry.url.endsWith("%61") ? "second" : "first",
      );
  });
  it("classifies RDF formats and parses only safe nonnegative content lengths", async () => {
    for (const type of [
      "text/turtle",
      "text/n3",
      "application/ld+json",
      "application/rdf+xml",
      "application/trig",
      "application/n-quads",
      "application/n-triples; charset=utf-8",
    ])
      expect(kindFor(`${root}x`, type)).toBe("rdf");
    expect(kindFor(root, "text/turtle")).toBe("container");
    expect(kindFor(`${root}x`, "image/png")).toBe("binary");
    expect(kindFor(`${root}x`, "text/turtle", "meta")).toBe("meta");
    for (const length of [null, "", "-1", "1.2", "9007199254740992", "oops"])
      expect(
        sizeOf(
          new Response(null, { headers: length === null ? {} : { "content-length": length } }),
        ),
      ).toBeUndefined();
    expect(sizeOf(new Response(null, { headers: { "content-length": "0" } }))).toBe(0);
    expect(exportError(new HttpError(401))).toMatchObject({ status: 401 });
    expect(await abortable(Promise.resolve(3))).toBe(3);
  });
});

it("records GET auxiliary limits and cancels the active body on fatal output errors", async () => {
  const server = pod({ file: { link: "<other>; rel=acl" }, other: {} });
  expect(
    (await archive(server.fetch, plan(["file"]), { maxEntries: 1 })).manifest.entries[0]?.error
      ?.message,
  ).toContain("maxEntries");
  const overflow = pod({ "": { members: [], link: "<x>; rel=acl, <y>; rel=acl" }, x: {}, y: {} });
  await expect(planExport({ fetch: overflow.fetch, root, maxEntries: 2 })).rejects.toThrow(
    "maxEntries",
  );
  const cancelled = vi.fn();
  const fetch: typeof globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(text.encode("chunk"));
        },
        cancel: cancelled,
      }),
    );
  await expect(
    exportPod({
      fetch,
      root,
      plan: plan(["a", "b"]),
      sink() {
        throw new Error("sink failed");
      },
    }),
  ).rejects.toThrow("sink failed");
  await Promise.resolve();
  expect(cancelled).toHaveBeenCalledTimes(1);
});
it("cleans up late fetch responses after abort and records unrelated Link relations", async () => {
  let finish!: (response: Response) => void;
  const controller = new AbortController();
  const pending = planExport({
    fetch: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    root,
    signal: controller.signal,
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const cancel = vi.fn();
  finish(new Response(new ReadableStream({ cancel })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancel).toHaveBeenCalled();
  const response = new Response();
  Object.defineProperty(response, "url", { value: root });
  Object.defineProperty(response, "redirected", { value: true });
  expect(
    (await planExport({ fetch: async () => response, root })).resources[0]?.error,
  ).toBeDefined();
  const nonmatching = new Response();
  Object.defineProperty(nonmatching, "url", { value: `${root}other` });
  expect(
    (await planExport({ fetch: async () => nonmatching, root })).resources[0]?.error,
  ).toBeDefined();
  const server = pod({ "": { members: [], link: '<x>; rel="type"' } });
  expect(
    (await planExport({ fetch: server.fetch, root, include: [root.slice(0, -1)] })).resources,
  ).toHaveLength(1);
});
it("propagates fflate errors for oversized names and refuses resource sizes outside classic ZIP", async () => {
  const oversized = "x".repeat(65_536);
  await expect(archive(async () => new Response("hello"), plan([oversized]))).rejects.toThrow();
  const hugeChunk = { byteLength: 0xffffffff } as Uint8Array;
  await expect(
    archive(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(hugeChunk);
              controller.close();
            },
          }),
        ),
      plan(["huge"]),
    ),
  ).rejects.toThrow("4 GiB");
});

it("handles duplicate supplied plans, sink cleanup after a prefetch failure and Link overflow", async () => {
  const duplicate = await archive(pod({ file: {} }).fetch, plan(["file", "file#alias"]));
  expect(duplicate.manifest.entries).toHaveLength(1);
  const fetch: typeof globalThis.fetch = async (url) => {
    if (String(url).endsWith("b")) throw new Error("unavailable");
    return new Response("body");
  };
  await expect(
    exportPod({
      fetch,
      root,
      plan: plan(["a", "b"]),
      sink() {
        throw new Error("failed");
      },
    }),
  ).rejects.toThrow("failed");
  const overflow: typeof globalThis.fetch = async (_input, init) =>
    init?.method === "HEAD"
      ? new Response()
      : new Response("", { headers: { link: `<x>; rel=acl; title="${"x".repeat(65_536)}"` } });
  expect((await planExport({ fetch: overflow, root })).resources[0]?.error).toBeDefined();
  expect(addZipBytes(0, 0xfffffffe)).toBe(0xfffffffe);
  expect(() => addZipBytes(0xfffffffe, 1)).toThrow("4 GiB");
});
it("ignores errors from best-effort body cancellation", async () => {
  const response = () =>
    new Response(
      new ReadableStream({
        cancel() {
          throw new Error("cancel failed");
        },
      }),
      { status: 403 },
    );
  const result = await archive(async () => response(), plan(["file"]));
  expect(result.manifest.entries[0]?.error?.status).toBe(403);
  const controller = new AbortController();
  await expect(
    exportPod({
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(text.encode("data"));
            },
            cancel() {
              throw new Error("cancel failed");
            },
          }),
        ),
      root,
      plan: plan(["file"]),
      signal: controller.signal,
      sink() {
        controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
});
it("filters auxiliary chains and shared ACLs when reusing a plan", async () => {
  const server = pod({
    "": { members: ["a", "b", "shared", "a.acl"] },
    a: { link: "<shared>; rel=acl, <a.acl>; rel=acl" },
    b: { link: "<shared>; rel=acl, <b.acl>; rel=acl" },
    shared: { link: "<shared.meta>; rel=describedby" },
    "a.acl": {},
    "b.acl": {},
    "shared.meta": {},
  });
  const planned = await planExport({ fetch: server.fetch, root });
  expect(planned.resources.find((item) => item.url.endsWith("shared"))?.auxiliaryFor).toEqual([
    `${root}a`,
    `${root}b`,
  ]);
  const { manifest } = await archive(
    server.fetch,
    { ...planned, resources: [...planned.resources].reverse() },
    { include: ["a"] },
  );
  expect(manifest.entries.map((item) => item.url.slice(root.length)).sort()).toEqual([
    "",
    "a",
    "a.acl",
    "shared",
    "shared.meta",
  ]);
  const explicit = await archive(server.fetch, planned, { include: ["b.acl"] });
  expect(explicit.manifest.entries.map((item) => item.url.slice(root.length)).sort()).toEqual([
    "",
    "b.acl",
  ]);
  const excluded = await archive(server.fetch, planned, { exclude: ["a", "b"] });
  expect(excluded.manifest.entries.map((item) => item.url.slice(root.length))).toEqual([""]);
});
it("ignores error representation metadata on HEAD 405 and negotiates unknown resources with a binary fallback", async () => {
  const server = pod({
    "": { members: ["document"] },
    document: { head: 405, type: "text/turtle", body: '<#me> <urn:p> "value".' },
  });
  const planned = await planExport({ fetch: server.fetch, root });
  expect(planned.resources[1]?.contentType).toBe("");
  expect(planned.unknownSizes).toBe(1);
  const { manifest, files } = await archive(server.fetch, planned);
  expect(
    server.calls.find((call) => call.method === "GET" && call.url.endsWith("document"))?.accept,
  ).toBe("text/turtle, */*;q=0.1");
  expect(manifest.entries[1]?.kind).toBe("rdf");
  expect(strFromU8(files["pod/document"] as Uint8Array)).toBe('<#me> <urn:p> "value".');
});
it("keeps empty-segment URL collisions and their container hierarchies distinct", async () => {
  const server = pod({
    "a/": { members: [] },
    "a//": { members: [] },
    "a/b": { body: "normal" },
    "a//b": { body: "double" },
    "/": { members: [] },
  });
  const { manifest, files } = await archive(server.fetch, plan(["a//b", "a/b", "a//", "a/", "/"]));
  expect(new Set(manifest.entries.map((entry) => entry.path)).size).toBe(5);
  for (const entry of manifest.entries) expect(entry.path).not.toContain("//");
  const double = manifest.entries.find((entry) => entry.url === `${root}a//b`);
  const folder = manifest.entries.find((entry) => entry.url === `${root}a//`);
  expect(double?.path.startsWith(folder?.path as string)).toBe(true);
  expect(strFromU8(files[double?.path as string] as Uint8Array)).toBe("double");
  expect(manifest.entries.every((entry) => entry.path.startsWith("pod/"))).toBe(true);
});
it("also separates empty-segment collisions without explicitly listed parent folders", () => {
  const allocate = pathAllocator(root);
  expect(allocate(`${root}a//b`, false)).not.toBe(allocate(`${root}a/b`, false));
});

// Security review regressions (sst-s3gs).
describe("review: inventory and selection boundaries", () => {
  it.each([
    404, 410,
  ])("drops absent auxiliary HTTP %i before entry/depth accounting", async (status) => {
    const server = pod({
      "": { members: [], link: "<deep/missing>; rel=acl" },
      "deep/missing": { head: status },
    });
    const result = await planExport({ fetch: server.fetch, root, maxEntries: 1, maxDepth: 0 });
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.error).toBeUndefined();
    expect(result.unknownSizes).toBe(0);
  });

  it("keeps container identities and processed kinds, bounds auxiliary locations, and ignores ancestor advertisements", async () => {
    const server = pod({
      "": {
        members: ["a/", "b/", "source", "source.acl"],
        link: "<root.acl>; rel=acl, <a/>; rel=acl",
      },
      "a/": { members: ["a/file"], link: "<a.acl>; rel=acl" },
      "b/": { members: [] },
      "a/file": { link: "<../outside.acl>; rel=acl, <file.acl>; rel=acl" },
      "a/file.acl": {},
      source: { link: "<b/>; rel=describedby, <source.acl>; rel=acl" },
      "source.acl": { link: "<source>; rel=describedby" },
      "root.acl": {},
      "a.acl": {},
      "outside.acl": {},
    });
    const planned = await planExport({ fetch: server.fetch, root });
    expect(
      planned.resources
        .filter((r) => r.url.endsWith("a/") || r.url.endsWith("b/"))
        .every((r) => r.kind === "container"),
    ).toBe(true);
    expect(planned.resources.find((r) => r.url.endsWith("source"))?.kind).toBe("binary");
    const selected = await planExport({ fetch: server.fetch, root, include: ["a/file"] });
    expect(selected.resources.map((r) => r.url.slice(root.length))).toEqual([
      "",
      "a/",
      "a/file",
      "a/file.acl",
    ]);
    const reused = await archive(server.fetch, planned, { include: ["a/file"] });
    expect(reused.manifest.entries.map((r) => r.url.slice(root.length)).sort()).toEqual([
      "",
      "a/",
      "a/file",
      "a/file.acl",
    ]);
    const malicious = plan(["a/file"]);
    malicious.resources.push({
      url: `${root}outside.acl`,
      kind: "acl",
      contentType: "",
      auxiliaryFor: [`${root}a/file`],
    });
    expect(
      (await archive(server.fetch, malicious, { include: ["a/file"] })).manifest.entries.some((r) =>
        r.url.endsWith("outside.acl"),
      ),
    ).toBe(false);
  });

  it("counts failed transports against the bound, including failures before HEAD metadata", async () => {
    const server = pod({ "": { members: ["file"] }, file: { fail: true } });
    await expect(planExport({ fetch: server.fetch, root, maxEntries: 1 })).rejects.toThrow(
      "maxEntries",
    );
    await expect(planExport({ fetch: server.fetch, root, maxDepth: 0 })).rejects.toThrow(
      "maxDepth",
    );
  });
});

describe("review: shared migration inventory", () => {
  it("supports strict direct children, semantic readers, auxiliary omission and progress", async () => {
    const server = pod({
      "": { link: "<access>; rel=acl, <described>; rel=describedby" },
      plain: {},
      "child/": {},
      "described/": {},
      "described/file": {},
      described: {},
      late: {},
      advertiser: { link: "<late>; rel=acl, <described>; rel=describedby" },
    });
    const skip = vi.fn();
    const progress = vi.fn();
    const result = await inventoryPod({
      fetch: server.fetch,
      root,
      directChildren: true,
      skipAuxiliaries: true,
      failFast: true,
      readMembers: async (url) =>
        url === root
          ? [
              `${root}plain`,
              `${root}child/`,
              `${root}old.acl`,
              `${root}access`,
              `${root}late`,
              `${root}described/`,
              `${root}advertiser`,
            ]
          : url.endsWith("described/")
            ? [`${root}described/file`]
            : [],
      onHead: () => {},
      onSkipAuxiliary: skip,
      onProgress: progress,
    });
    expect(result.resources.map((r) => r.url.slice(root.length))).toEqual([
      "",
      "plain",
      "child/",
      "described/",
      "advertiser",
      "described/file",
    ]);
    expect(skip).toHaveBeenCalledWith(`${root}old.acl`, false);
    expect(skip).toHaveBeenCalledWith(`${root}access`, false);
    expect(skip).toHaveBeenCalledWith(`${root}late`, true);
    expect(progress.mock.lastCall?.[0].done).toBeGreaterThan(1);
  });

  it("omits late-advertised auxiliary subtrees after traversal", async () => {
    const server = pod({
      "": {},
      "meta/": {},
      "meta/child": {},
      source: { link: "<meta/>; rel=describedby" },
    });
    const result = await inventoryPod({
      fetch: server.fetch,
      root,
      skipAuxiliaries: true,
      directChildren: true,
      readMembers: async (url) =>
        url === root ? [`${root}meta/`, `${root}source`] : [`${root}meta/child`],
    });
    expect(result.resources.map((r) => r.url)).toEqual([root, `${root}source`]);
  });

  it.each([
    "deep/file",
    "deep/",
    "bad?query",
    "https://evil.example/foreign",
  ])("rejects non-child or malformed member %s", async (child) => {
    await expect(
      inventoryPod({
        fetch: pod({ "": {} }).fetch,
        root,
        directChildren: true,
        failFast: true,
        readMembers: async () => [child.startsWith("https:") ? child : root + child],
      }),
    ).rejects.toThrow();
  });

  it("propagates strict read failures and permits omission callbacks to be absent", async () => {
    await expect(
      inventoryPod({ fetch: pod({ "": { head: 405 } }).fetch, root, failFast: true }),
    ).rejects.toThrow("405");
    await expect(
      inventoryPod({
        fetch: pod({ "": {} }).fetch,
        root,
        failFast: true,
        onHead: () => {
          throw new Error("semantic failure");
        },
      }),
    ).rejects.toThrow("semantic failure");
    await inventoryPod({
      fetch: pod({ "": {} }).fetch,
      root,
      skipAuxiliaries: true,
      readMembers: async () => [`${root}a.meta`],
    });
    await inventoryPod({
      fetch: pod({ "": {}, a: { link: "<a>; rel=acl" } }).fetch,
      root,
      skipAuxiliaries: true,
      readMembers: async () => [`${root}a`],
    });
  });
});

describe("review: ZIP resilience and bounded work", () => {
  it.each([404, 410])("drops GET-only advertised missing auxiliary HTTP %i", async (head) => {
    const result = await archive(
      pod({ file: { link: "<missing>; rel=acl" }, missing: { head } }).fetch,
      plan(["file"]),
      { maxEntries: 1 },
    );
    expect(result.manifest.entries).toHaveLength(1);
    expect(result.manifest.entries[0]?.error).toBeUndefined();
  });

  it("records GET link overflow and depth limits, then exports subsequent resources", async () => {
    for (const link of ["<deep/file>; rel=acl", `<x>; rel=acl; title="${"x".repeat(65_536)}"`]) {
      const result = await archive(
        pod({ file: { link }, good: {}, "deep/file": {} }).fetch,
        plan(["file", "good"]),
        { maxDepth: 1 },
      );
      expect(result.manifest.entries[0]?.error).toBeDefined();
      expect(strFromU8(result.files["pod/good"] as Uint8Array)).toBe("hello");
    }
    const result = await archive(
      pod({ file: { link: "<file?query>; rel=acl, <excluded>; rel=acl" }, excluded: {} }).fetch,
      plan(["file"]),
      { exclude: ["excluded"] },
    );
    expect(result.manifest.entries[0]?.error).toBeUndefined();
    expect(result.manifest.entries).toHaveLength(1);
  });

  it("marks cleanly truncated bodies and protects partial-name collisions", async () => {
    const result = await archive(
      pod({ file: { body: "short", size: "10" }, "file.partial": { body: "complete" } }).fetch,
      plan(["file", "file.partial"]),
    );
    const partial = result.manifest.entries[0];
    expect(partial).toMatchObject({
      path: "pod/file.partial",
      partial: true,
      bytes: 5,
      error: { message: "Resource body was truncated" },
    });
    expect(strFromU8(result.files[partial?.path as string] as Uint8Array)).toBe("short");
    expect(result.manifest.entries[1]?.path).not.toBe(partial?.path);
    expect(strFromU8(result.files[result.manifest.entries[1]?.path as string] as Uint8Array)).toBe(
      "complete",
    );
  });

  it("does not mistake a compressed content length for a decoded body length", async () => {
    const result = await archive(
      async () =>
        new Response("decoded", {
          headers: { "content-length": "100", "content-encoding": "gzip" },
        }),
      plan(["file"]),
    );
    expect(result.manifest.entries[0]?.partial).toBeUndefined();
    expect(strFromU8(result.files["pod/file"] as Uint8Array)).toBe("decoded");
  });

  it("keeps forward-only ZIP headers conservative and throttles chunk progress", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-11T00:00:00Z"));
    const progress = vi.fn();
    const result = await archive(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 1000; i++) controller.enqueue(text.encode("x"));
              controller.close();
            },
          }),
        ),
      plan(["file"]),
      { patch: undefined, onProgress: progress },
    );
    clock.mockRestore();
    expect(result.manifest.entries[0]?.path).toBe("pod/file.partial");
    expect(result.manifest.entries[0]?.partial).toBeUndefined();
    expect(result.files["pod/file.partial"]?.length).toBe(1000);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.lastCall?.[0]).toMatchObject({ files: 1, totalFiles: 1, bytes: 1000 });
  });

  it("caps resources at 65,533 while reserving room for the manifest", async () => {
    const fetch = vi.fn();
    const paths = Array.from({ length: 65_534 }, (_, i) => `f${i}/`);
    await expect(archive(fetch, plan(paths), { maxEntries: 100_000 })).rejects.toThrow(
      "ZIP entry limit",
    );
    await expect(
      archive(fetch, plan(paths.slice(0, -1)), {
        maxEntries: 100_000,
        sink() {
          throw new Error("destination reached");
        },
      }),
    ).rejects.toThrow("destination reached");
    expect(fetch).not.toHaveBeenCalled();
  }, 30_000);
});

describe("review: transport and Windows names", () => {
  it("accepts scoped Request/URL inputs and validates response locations and response URLs", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { headers: { location: "same" } }),
    );
    const transport = createPodFetch({ root, fetch });
    await transport(new Request(`${root}same`));
    await transport(new URL(`${root}same`), { signal: new AbortController().signal });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${root}same`);
    const mismatched = createPodFetch({
      root,
      fetch: async () =>
        Object.defineProperty(new Response(), "url", { value: "https://evil.example/file" }),
    });
    await expect(mismatched(new Request(`${root}same`))).rejects.toThrow();
    const escaped = createPodFetch({
      root,
      fetch: async () =>
        new Response(null, { status: 201, headers: { location: "https://evil.example/" } }),
    });
    await expect(escaped(root)).rejects.toThrow();
  });

  it("prefixes reserved Windows basenames with and without extensions", () => {
    for (const name of [
      "CON",
      "prn",
      "Aux",
      "nul",
      ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
      ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
    ]) {
      for (const suffix of ["", ".txt", ".tar.gz"]) {
        const path = pathAllocator(root);
        expect(path(root + name + suffix, false)).toBe(`pod/_${name}${suffix}`);
        expect(path(`${root + name + suffix}/`, true)).toBe(`pod/_${name}${suffix}~2/`);
      }
    }
    expect(pathAllocator(root)(`${root}CONSOLE.txt`, false)).toBe("pod/CONSOLE.txt");
  });
});

it.each([
  404, 410,
])("omits a planned auxiliary that disappears at GET with HTTP %i", async (get) => {
  const server = pod({ file: { link: "<file.acl>; rel=acl" }, "file.acl": { head: 405, get } });
  const planned = plan(["file"]);
  planned.resources.push({
    url: `${root}file.acl`,
    kind: "acl",
    contentType: "text/turtle",
    auxiliaryFor: [`${root}file`],
  });
  const progress = vi.fn();
  const result = await archive(server.fetch, planned, { onProgress: progress });
  expect(result.manifest.entries.map((entry) => entry.url)).toEqual([`${root}file`]);
  expect(progress.mock.lastCall?.[0]).toMatchObject({ files: 1, totalFiles: 1 });
});

it("prunes auxiliary containers of excluded advertisers while retaining listed container ancestors", async () => {
  const server = pod({
    "": { members: ["source", "listed/"] },
    source: { link: "<only-linked/>; rel=describedby, <listed/>; rel=acl" },
    "only-linked/": { members: [] },
    "listed/": { members: [] },
  });
  const planned = await planExport({ fetch: server.fetch, root });
  const result = await archive(server.fetch, planned, { exclude: ["source"] });
  expect(result.manifest.entries.map((entry) => entry.url)).toEqual([root, `${root}listed/`]);
});

it("retains bytes before a mid-body exception and propagates a failed header patch", async () => {
  let reads = 0;
  const result = await archive(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (reads++ === 0) controller.enqueue(text.encode("prefix"));
            else controller.error(new Error("truncated transfer"));
          },
        }),
      ),
    plan(["file"]),
  );
  expect(result.manifest.entries[0]).toMatchObject({
    path: "pod/file.partial",
    bytes: 6,
    partial: true,
  });
  expect(strFromU8(result.files["pod/file.partial"] as Uint8Array)).toBe("prefix");
  await expect(
    archive(pod({ file: {} }).fetch, plan(["file"]), {
      patch() {
        throw new Error("seek failed");
      },
    }),
  ).rejects.toThrow("seek failed");
});

it("retains migration's numeric length estimates as an explicit inventory policy", async () => {
  for (const [length, expected] of [
    ["", 0],
    ["0x10", 16],
    ["-1", undefined],
    ["1.5", undefined],
  ] as const) {
    const result = await inventoryPod({
      fetch: pod({ "": { members: ["file"] }, file: { size: length } }).fetch,
      root,
      numericContentLength: true,
    });
    expect(result.resources[1]?.size).toBe(expected);
  }
});

it("writes matching local and central ZIP names for completed Unicode and partial members", async () => {
  const result = await archive(
    pod({ "caf%C3%A9": { body: "ok" }, bad: { body: "prefix", size: "100" } }).fetch,
    plan(["caf%C3%A9", "bad"]),
  );
  const localNames: string[] = [];
  const streamed = new Unzip((file) => {
    localNames.push(file.name);
    file.ondata = (error) => {
      if (error) throw error;
    };
    file.start();
  });
  streamed.register(UnzipPassThrough);
  streamed.push(result.bytes, true);
  expect(localNames).toEqual(Object.keys(result.files));
  expect(localNames).toEqual(["pod/café", "pod/bad.partial", "export-manifest.json"]);
});

it("compares document identity without fragments in the shared Request transport", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Object.defineProperty(new Response(), "url", { value: `${root}profile` }),
  );
  const scoped = createPodFetch({ root, fetch });
  await scoped(new Request(`${root}profile#me`));
  expect(fetch.mock.calls[0]?.[0]).toBe(`${root}profile`);
});
