// AUTHORED-BY Claude Sonnet 5.5
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { describe, expect, test, vi } from "vitest";
import { createMediaLoader, DEFAULT_ALLOWED_TYPES, INERT_TYPE } from "../src/loader.js";
import {
  avif,
  concat,
  fakeStorage,
  fakeUrls,
  flac,
  gatedStream,
  gif,
  glb,
  heic,
  html,
  id3,
  jpeg,
  MEDIA,
  m4a,
  memoryPod,
  mp3Frames,
  mp4,
  oggOpus,
  oggVorbis,
  png,
  ROOT,
  served,
  streamOf,
  svg,
  utf16,
  wav,
  webm,
  webpExtended,
  webpLossless,
  webpLossy,
} from "./helpers.js";

const LIMITS = { maxBytes: 1 << 20, maxTotalBytes: 8 << 20, maxEntries: 16 };

async function setup(overrides: Record<string, unknown> = {}) {
  const pod = await memoryPod();
  const urls = fakeUrls();
  const loader = createMediaLoader({
    storage: pod.storage,
    scope: [MEDIA],
    ...LIMITS,
    objectUrls: urls.api,
    ...overrides,
  });
  return { ...pod, urls, loader };
}

describe("creation", () => {
  test.each([
    ["maxBytes", { maxBytes: 0 }],
    ["maxBytes fractional", { maxBytes: 1.5 }],
    ["maxTotalBytes", { maxTotalBytes: -1 }],
    ["maxEntries", { maxEntries: Number.NaN }],
    ["maxEntries unsafe", { maxEntries: 2 ** 60 }],
    ["maxPixels", { maxPixels: 0 }],
    ["maxBytes string", { maxBytes: "10" }],
  ])("rejects an invalid %s", async (_name, overrides) => {
    const pod = await memoryPod();
    expect(() =>
      createMediaLoader({ storage: pod.storage, scope: [MEDIA], ...LIMITS, ...overrides } as never),
    ).toThrow(RangeError);
  });

  test.each([
    ["svg", "image/svg+xml"],
    ["html", "text/html"],
    ["xhtml", "application/xhtml+xml"],
    ["xml", "application/xml"],
    ["javascript", "text/javascript"],
    ["json", "application/json"],
    ["octet-stream", "application/octet-stream"],
    ["an image type that names svg", "image/svg"],
    ["image xml", "image/x-xml"],
    ["uppercase", "IMAGE/PNG"],
    ["a wildcard", "image/*"],
    ["not a type", "png"],
    ["not a string", 42],
  ])("never allows %s", async (_name, type) => {
    const pod = await memoryPod();
    expect(() =>
      createMediaLoader({
        storage: pod.storage,
        scope: [MEDIA],
        ...LIMITS,
        allow: [type],
      } as never),
    ).toThrow(TypeError);
  });

  test("the default allowlist is exactly the passive media set", () => {
    expect([...DEFAULT_ALLOWED_TYPES].sort()).toEqual(
      [
        "audio/flac",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "image/avif",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
        "model/gltf-binary",
        "video/mp4",
        "video/webm",
      ].sort(),
    );
    for (const type of DEFAULT_ALLOWED_TYPES) expect(type).not.toMatch(/svg|xml|html|script|text/);
  });

  test("uses the global URL object URLs by default", async () => {
    const pod = await memoryPod();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:global/1");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    try {
      const loader = createMediaLoader({ storage: pod.storage, scope: [MEDIA], ...LIMITS });
      const { url } = await pod.put("a.png", png());
      const result = await loader.acquire(url);
      expect(result.ok && result.value.url).toBe("blob:global/1");
      loader.purge();
      expect(revoke).toHaveBeenCalledWith("blob:global/1");
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });
});

describe("scope: refused without any request", () => {
  async function watched() {
    const base = await setup();
    const read = vi.spyOn(base.storage, "read");
    const head = vi.spyOn(base.storage, "head");
    return { ...base, read, head };
  }

  test.each([
    ["outside the container", `${ROOT}private/a.png`],
    ["the container itself", MEDIA],
    ["a sibling sharing the prefix", `${ROOT}media-evil/a.png`],
    ["dot segments escaping the container", `${MEDIA}../private/a.png`],
    ["another origin", "https://evil.example/media/a.png"],
    ["another scheme", "http://pod.example/media/a.png"],
    ["a query", `${MEDIA}a.png?token=SECRET`],
    ["a fragment", `${MEDIA}a.png#x`],
    ["credentials", "https://user:SECRET@pod.example/media/a.png"],
    ["a data URL", "data:image/png;base64,AAAA"],
    ["a blob URL", "blob:https://pod.example/123"],
    ["an encoded traversal", `${MEDIA}..%2Fprivate%2Fa.png`],
    ["not a URL", "not a url"],
    ["empty", ""],
    ["not a string", 42 as unknown as string],
  ])("%s", async (_name, url) => {
    const { loader, read, head, urls } = await watched();
    const result = await loader.acquire(url);
    expect(result).toMatchObject({ ok: false, error: { code: "out-of-scope" } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|token|pod\.example|evil\.example/);
    expect(read).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(urls.created.size).toBe(0);
  });

  test("a URL the predicate admits but the storage does not own is refused without a request", async () => {
    const urls = fakeUrls();
    const { storage, spy } = fakeStorage(() => served(png()));
    const loader = createMediaLoader({
      storage,
      scope: () => true,
      ...LIMITS,
      objectUrls: urls.api,
    });
    const result = await loader.acquire("https://other.example/media/a.png");
    expect(result).toMatchObject({ ok: false, error: { code: "out-of-scope" } });
    expect(spy).not.toHaveBeenCalled();
  });

  test("a throwing predicate fails closed with no request", async () => {
    const urls = fakeUrls();
    const { storage, spy } = fakeStorage(() => served(png()));
    const loader = createMediaLoader({
      storage,
      scope: () => {
        throw new Error("boom");
      },
      ...LIMITS,
      objectUrls: urls.api,
    });
    expect(await loader.acquire(`${ROOT}a.png`)).toMatchObject({
      ok: false,
      error: { code: "out-of-scope" },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("revalidate applies the same scope", async () => {
    const { loader, read } = await watched();
    expect(await loader.revalidate(`${ROOT}private/a.png`)).toMatchObject({
      ok: false,
      error: { code: "out-of-scope" },
    });
    expect(await loader.revalidate("nonsense")).toMatchObject({
      ok: false,
      error: { code: "out-of-scope" },
    });
    expect(read).not.toHaveBeenCalled();
  });

  test("a storage that throws from isWithinStorage yields a closed failure, not a throw", async () => {
    const urls = fakeUrls();
    const { storage } = fakeStorage(
      () => served(png()),
      () => {
        throw new Error("boom");
      },
    );
    const loader = createMediaLoader({
      storage,
      scope: () => true,
      ...LIMITS,
      objectUrls: urls.api,
    });
    expect(await loader.acquire(`${ROOT}a.png`)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
    expect(await loader.revalidate(`${ROOT}a.png`)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
  });

  test("the caller predicate receives the canonical URL", async () => {
    const urls = fakeUrls();
    const seen: string[] = [];
    const { storage } = fakeStorage(() => served(png()));
    const loader = createMediaLoader({
      storage,
      scope: (url) => {
        seen.push(url);
        return true;
      },
      ...LIMITS,
      objectUrls: urls.api,
    });
    await loader.acquire("HTTPS://POD.EXAMPLE:443/media/a%20b.png");
    expect(seen).toEqual(["https://pod.example/media/a%20b.png"]);
  });
});

describe("sniffed types: every default format, and the server's type is never used", () => {
  const formats: [string, () => Uint8Array, string][] = [
    ["png", png, "image/png"],
    ["jpeg", jpeg, "image/jpeg"],
    ["gif", gif, "image/gif"],
    ["webp lossy", webpLossy, "image/webp"],
    ["webp lossless", webpLossless, "image/webp"],
    ["webp extended", webpExtended, "image/webp"],
    ["avif", avif, "image/avif"],
    ["mp4", mp4, "video/mp4"],
    ["webm", webm, "video/webm"],
    ["mp3 (ID3)", id3, "audio/mpeg"],
    ["mp3 (frames)", () => mp3Frames(2), "audio/mpeg"],
    ["wav", wav, "audio/wav"],
    ["ogg vorbis", oggVorbis, "audio/ogg"],
    ["ogg opus", oggOpus, "audio/ogg"],
    ["flac", flac, "audio/flac"],
    ["glb", glb, "model/gltf-binary"],
  ];

  test.each(formats)("%s", async (_name, make, expected) => {
    const { loader, put, urls } = await setup();
    const bytes = make();
    // The pod labels everything with the most dangerous type it can.
    const { url } = await put("file", bytes, "text/html");
    const result = await loader.acquire(url);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe(expected);
    expect(result.value.bytes).toBe(bytes.length);
    expect(result.value.url).toMatch(/^blob:/);
    const blob = urls.blobOf(result.value.url);
    expect(blob.type).toBe(expected);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  test("a PNG labelled image/svg+xml, text/html or application/javascript is a PNG blob", async () => {
    const { loader, put, urls } = await setup();
    for (const label of ["image/svg+xml", "text/html", "application/javascript", "image/gif"]) {
      const { url } = await put(`p-${label.replace("/", "-")}`, png(), label);
      const result = await loader.acquire(url);
      expect(result.ok && urls.blobOf(result.value.url).type).toBe("image/png");
    }
  });

  test("the declared type of unsupported bytes does not rescue them", async () => {
    const { loader, put, urls } = await setup();
    const { url } = await put("evil.png", svg(), "image/png");
    expect(await loader.acquire(url)).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
    expect(urls.created.size).toBe(0);
  });

  test("a type the sniffer finds but the allowlist omits is refused; allow can add it", async () => {
    const samples: [string, Uint8Array, string][] = [
      ["heic", heic(), "image/heic"],
      ["m4a", m4a(), "audio/mp4"],
    ];
    for (const [name, bytes, type] of samples) {
      const denied = await setup();
      const { url } = await denied.put(name, bytes);
      expect(await denied.loader.acquire(url)).toMatchObject({
        ok: false,
        error: { code: "unsupported-type" },
      });
      const allowed = await setup({ allow: [...DEFAULT_ALLOWED_TYPES, type] });
      const again = await allowed.put(name, bytes);
      const result = await allowed.loader.acquire(again.url);
      expect(result.ok && result.value.contentType).toBe(type);
    }
  });

  test("allow replaces the default list", async () => {
    const { loader, put } = await setup({ allow: ["image/png"] });
    expect((await loader.acquire((await put("a", png())).url)).ok).toBe(true);
    expect(await loader.acquire((await put("b", jpeg())).url)).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
  });

  test("a custom sniffer decides the type but the allowlist still gates it", async () => {
    const sniff = vi.fn((bytes: Uint8Array) =>
      bytes[0] === 0x58
        ? { contentType: "image/x-custom", extension: ".x" }
        : { contentType: "image/svg+xml", extension: ".svg" },
    );
    const { loader, put, urls } = await setup({ sniff, allow: ["image/x-custom"] });
    const good = await loader.acquire((await put("good", concat("XYZ"))).url);
    expect(good.ok && urls.blobOf(good.value.url).type).toBe("image/x-custom");
    const bad = await loader.acquire((await put("bad", concat("abc"))).url);
    expect(bad).toMatchObject({ ok: false, error: { code: "unsupported-type" } });
  });

  test("a throwing custom sniffer is a closed failure", async () => {
    const { loader, put, urls } = await setup({
      sniff: () => {
        throw new Error("boom");
      },
    });
    expect(await loader.acquire((await put("a", png())).url)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
    expect(urls.created.size).toBe(0);
  });
});

describe("content that must never become a blob", () => {
  const cases: [string, Uint8Array][] = [
    ["svg", svg()],
    [
      "svg with prolog and BOM",
      concat([0xef, 0xbb, 0xbf], '<?xml version="1.0"?><svg onload="x()"/>'),
    ],
    ["html", html()],
    ["xml", concat('<?xml version="1.0"?><root/>')],
    ["xhtml", concat('<html xmlns="http://www.w3.org/1999/xhtml"><script>x</script></html>')],
    ["plain text", concat("just some text")],
    ["json", concat('{"@context": "x"}')],
    ["javascript", concat("fetch('/secret')")],
    ["UTF-16LE svg", utf16("<svg xmlns='http://www.w3.org/2000/svg'/>")],
    ["UTF-16BE html", utf16("<html><body>", true)],
    ["UTF-16 with BOM", concat([0xff, 0xfe], utf16("<svg/>"))],
    ["SVG hiding behind PNG-like magic", concat(png().slice(0, 12), "<svg onload=alert(1)>")],
    ["html with image magic later", concat(html(), png())],
    ["PNG magic then script", concat(png().slice(0, 8), "<script>alert(1)</script>")],
    ["GIF header then html", concat("GIF89a", [1, 0, 1, 0, 0, 0, 0], "<html><script>x</script>")],
    ["empty", new Uint8Array(0)],
  ];

  test.each(cases)("%s is refused", async (_name, bytes) => {
    const { loader, put, urls } = await setup();
    const result = await loader.acquire((await put("x", bytes, "image/png")).url);
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported-type" } });
    expect(urls.created.size).toBe(0);
    expect(loader.stats().entries).toBe(0);
  });

  test.each(cases)("%s: inert mode yields only an octet-stream blob", async (_name, bytes) => {
    const { loader, put, urls } = await setup();
    const result = await loader.acquire((await put("x", bytes, "image/png")).url, { inert: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentType).toBe(INERT_TYPE);
    expect(urls.blobOf(result.value.url).type).toBe(INERT_TYPE);
    expect(new Uint8Array(await urls.blobOf(result.value.url).arrayBuffer())).toEqual(bytes);
  });

  test("GIFAR-style: GIF with a zip appended is served as a GIF and nothing else", async () => {
    const { loader, put, urls } = await setup();
    const zip = concat("PK", [3, 4], new Uint8Array(30), "Evil.class");
    const result = await loader.acquire(
      (await put("g", concat(gif(), zip), "application/java-archive")).url,
    );
    expect(result.ok && urls.blobOf(result.value.url).type).toBe("image/gif");
  });

  test("inert mode still returns sniffed media with its sniffed type", async () => {
    const { loader, put } = await setup();
    const result = await loader.acquire((await put("a", png())).url, { inert: true });
    expect(result.ok && result.value.contentType).toBe("image/png");
  });
});

describe("inert and refused entries share nothing unsafely", () => {
  test("an inert (opaque) entry is never handed to a non-inert caller, cached or in flight", async () => {
    const { loader, put } = await setup();
    const { url } = await put("a.svg", svg(), "image/svg+xml");
    const first = await loader.acquire(url, { inert: true });
    expect(first.ok).toBe(true);
    // Cached: the non-inert caller is refused with no new read.
    const second = await loader.acquire(url);
    expect(second).toMatchObject({ ok: false, error: { code: "unsupported-type" } });
    // The refusal took no hold: releasing the only hold lets the entry go.
    if (first.ok) first.value.release();
    expect(loader.stats().entries).toBe(1);
  });

  test("a non-inert and an inert acquire racing on unsupported bytes: only the inert one gets the opaque blob", async () => {
    const { loader, put, storage } = await setup();
    const { url } = await put("a.svg", svg(), "image/svg+xml");
    const readSpy = vi.spyOn(storage, "read");
    const [strict, inert] = await Promise.all([
      loader.acquire(url),
      loader.acquire(url, { inert: true }),
    ]);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(strict).toMatchObject({ ok: false, error: { code: "unsupported-type" } });
    expect(inert.ok && inert.value.contentType).toBe(INERT_TYPE);
    // Only the inert holder remains; releasing it and evicting leaves nothing held.
    expect(loader.stats().entries).toBe(1);
  });

  test("an inert caller reuses a cached media entry", async () => {
    const { loader, put } = await setup();
    const { url } = await put("a.png", png());
    const a = await loader.acquire(url);
    const b = await loader.acquire(url, { inert: true });
    expect(a.ok && b.ok && a.value.url === b.value.url).toBe(true);
  });
});

describe("bounded reads", () => {
  test("a body larger than maxBytes is refused while streaming, whatever Content-Length says", async () => {
    const urls = fakeUrls();
    const big = concat(png(), new Uint8Array(10_000));
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 100;
        controller.enqueue(new Uint8Array(100));
        if (pulled > 1_000_000) controller.close();
      },
    });
    const lying = createSolidBackend({
      root: ROOT,
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { "content-length": "12", "content-type": "image/png", etag: '"v1"' },
        }),
    });
    const loader = createMediaLoader({
      storage: lying,
      scope: [MEDIA],
      maxBytes: 5000,
      maxTotalBytes: 1 << 20,
      maxEntries: 4,
      objectUrls: urls.api,
    });
    expect(big.length).toBeGreaterThan(5000);
    const result = await loader.acquire(`${MEDIA}huge.png`);
    expect(result).toMatchObject({ ok: false, error: { code: "too-large" } });
    expect(pulled).toBeLessThan(100_000);
    expect(urls.created.size).toBe(0);
  });

  test("a truthful small Content-Length does not make an over-limit body acceptable (real Solid backend)", async () => {
    const urls = fakeUrls();
    const bytes = concat(png(), new Uint8Array(4000));
    const backend = createSolidBackend({
      root: ROOT,
      fetch: async () =>
        new Response(bytes as BodyInit, {
          status: 200,
          headers: { "content-length": "20", etag: '"v1"', "content-type": "image/png" },
        }),
    });
    const loader = createMediaLoader({
      storage: backend,
      scope: [MEDIA],
      maxBytes: 1000,
      maxTotalBytes: 1 << 20,
      maxEntries: 4,
      objectUrls: urls.api,
    });
    expect(await loader.acquire(`${MEDIA}a.png`)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  test("exactly maxBytes is accepted, one more is refused", async () => {
    const exact = png();
    const { loader, put } = await setup({ maxBytes: exact.length });
    expect((await loader.acquire((await put("a", exact)).url)).ok).toBe(true);
    const over = concat(exact, [0]);
    expect(await loader.acquire((await put("b", over)).url)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  test("a refused download cancels its stream", async () => {
    const gate = gatedStream();
    const urls = fakeUrls();
    const { storage } = fakeStorage(() => ({ body: gate.body }));
    const loader = createMediaLoader({
      storage,
      scope: [MEDIA],
      maxBytes: 10,
      maxTotalBytes: 100,
      maxEntries: 2,
      objectUrls: urls.api,
    });
    const pending = loader.acquire(`${MEDIA}a.png`);
    await vi.waitFor(() => expect(gate.state.cancelled).toBe(false));
    gate.push(new Uint8Array(11));
    expect(await pending).toMatchObject({ ok: false, error: { code: "too-large" } });
    await vi.waitFor(() => expect(gate.state.cancelled).toBe(true));
  });

  test("maxBytes is clamped to maxTotalBytes", async () => {
    const { loader, put } = await setup({ maxBytes: 1 << 20, maxTotalBytes: png().length });
    expect((await loader.acquire((await put("a", png())).url)).ok).toBe(true);
    const over = await put("b", concat(png(), [0]));
    expect(await loader.acquire(over.url)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  test("a chunk that is not bytes is a closed failure", async () => {
    const urls = fakeUrls();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue("text, not bytes");
        controller.close();
      },
    });
    const { storage } = fakeStorage(() => ({ body: body as ReadableStream<Uint8Array> }));
    const loader = createMediaLoader({ storage, scope: [MEDIA], ...LIMITS, objectUrls: urls.api });
    expect(await loader.acquire(`${MEDIA}a.png`)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
  });

  test("a null body is empty bytes, which sniff to nothing", async () => {
    const urls = fakeUrls();
    const { storage } = fakeStorage(() => ({ body: null }));
    const loader = createMediaLoader({ storage, scope: [MEDIA], ...LIMITS, objectUrls: urls.api });
    expect(await loader.acquire(`${MEDIA}a.png`)).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
  });

  test("a stream that errors mid-body is a closed failure", async () => {
    const gate = gatedStream();
    const urls = fakeUrls();
    const { storage } = fakeStorage(() => ({ body: gate.body }));
    const loader = createMediaLoader({ storage, scope: [MEDIA], ...LIMITS, objectUrls: urls.api });
    const pending = loader.acquire(`${MEDIA}a.png`);
    gate.push(png());
    gate.fail(new Error("reset"));
    expect(await pending).toMatchObject({ ok: false, error: { code: "failed" } });
  });
});

describe("transport results map onto the closed error set", () => {
  const cases: [string, number, string][] = [
    ["404", 404, "not-found"],
    ["410", 410, "not-found"],
    ["403", 403, "forbidden"],
    ["401", 401, "forbidden"],
    ["413", 413, "too-large"],
    ["500", 500, "failed"],
    ["400", 400, "failed"],
  ];

  test.each(cases)("HTTP %s", async (_name, status, code) => {
    const urls = fakeUrls();
    const backend = createSolidBackend({
      root: ROOT,
      fetch: async () => new Response("SECRET-BODY", { status }),
    });
    const loader = createMediaLoader({
      storage: backend,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: urls.api,
    });
    const result = await loader.acquire(`${MEDIA}a.png`);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|pod\.example/);
  });

  test("a network failure is offline", async () => {
    const urls = fakeUrls();
    const backend = createSolidBackend({
      root: ROOT,
      fetch: async () => {
        throw new TypeError("fetch failed https://pod.example/media/a.png?token=SECRET");
      },
    });
    const loader = createMediaLoader({
      storage: backend,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: urls.api,
    });
    const result = await loader.acquire(`${MEDIA}a.png`);
    expect(result).toMatchObject({ ok: false, error: { code: "offline" } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|token/);
  });

  test("a redirect is refused by the storage client and surfaces as a closed failure", async () => {
    const urls = fakeUrls();
    const fetchSpy = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/a.png" } }),
    );
    const backend = createSolidBackend({ root: ROOT, fetch: fetchSpy });
    const loader = createMediaLoader({
      storage: backend,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: urls.api,
    });
    const result = await loader.acquire(`${MEDIA}a.png`);
    expect(result.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(urls.created.size).toBe(0);
  });

  test("storage scope errors, unknown thrown values and odd statuses are closed", async () => {
    const urls = fakeUrls();
    const script: (() => unknown)[] = [
      () => {
        throw { code: "scope" };
      },
      () => {
        throw null;
      },
      () => ({ status: 204 }),
      () => ({ status: 206, body: streamOf(png()) }),
      () => ({ status: 304 }),
    ];
    const { storage } = fakeStorage((_url, _opts, call) => {
      const step = script[call - 1] as () => never;
      return step();
    });
    const loader = createMediaLoader({ storage, scope: [MEDIA], ...LIMITS, objectUrls: urls.api });
    const codes: string[] = [];
    for (let i = 0; i < script.length; i++) {
      const result = await loader.acquire(`${MEDIA}a${i}.png`);
      codes.push(result.ok ? "ok" : result.error.code);
    }
    expect(codes).toEqual(["out-of-scope", "failed", "failed", "failed", "failed"]);
  });

  test("a failed read leaves no entry and the next acquire retries", async () => {
    const urls = fakeUrls();
    let calls = 0;
    const { storage } = fakeStorage(() => {
      calls++;
      if (calls === 1) throw { code: "network" };
      return served(png());
    });
    const loader = createMediaLoader({ storage, scope: [MEDIA], ...LIMITS, objectUrls: urls.api });
    expect(await loader.acquire(`${MEDIA}a.png`)).toMatchObject({
      ok: false,
      error: { code: "offline" },
    });
    expect(loader.stats()).toMatchObject({ entries: 0, inFlight: 0 });
    expect((await loader.acquire(`${MEDIA}a.png`)).ok).toBe(true);
  });

  test("createObjectURL throwing is a closed failure with nothing leaked", async () => {
    const urls = fakeUrls();
    const loader = createMediaLoader({
      storage: fakeStorage(() => served(png())).storage,
      scope: [MEDIA],
      ...LIMITS,
      objectUrls: {
        createObjectURL() {
          throw new Error("quota");
        },
        revokeObjectURL: urls.api.revokeObjectURL,
      },
    });
    expect(await loader.acquire(`${MEDIA}a.png`)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
    expect(loader.stats()).toMatchObject({ entries: 0, bytes: 0, inFlight: 0 });
  });

  test("an options object whose signal getter throws still yields a Result", async () => {
    const { loader, put } = await setup();
    const { url } = await put("a.png", png());
    const hostile = {
      get signal(): AbortSignal {
        throw new Error("boom");
      },
    };
    expect(await loader.acquire(url, hostile)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
    expect(await loader.revalidate(url, hostile)).toMatchObject({
      ok: false,
      error: { code: "failed" },
    });
  });
});

describe("image dimension guard", () => {
  test("refuses decompression bombs before the caller decodes", async () => {
    const { loader, put, urls } = await setup({ maxPixels: 1_000_000 });
    const bombs: [string, Uint8Array][] = [
      ["png", png(30000, 30000)],
      ["jpeg", jpeg(30000, 30000)],
      ["gif", gif(60000, 60000)],
      ["webp lossy", webpLossy(16000, 16000)],
      ["webp lossless", webpLossless(16000, 16000)],
      ["webp extended", webpExtended(30000, 30000)],
      ["avif", avif(30000, 30000)],
    ];
    for (const [name, bytes] of bombs) {
      const result = await loader.acquire((await put(`bomb-${name}`, bytes)).url);
      expect(result, name).toMatchObject({ ok: false, error: { code: "too-large" } });
    }
    expect(urls.created.size).toBe(0);
  });

  test("accepts images at or below the limit", async () => {
    const { loader, put } = await setup({ maxPixels: 1000 * 1000 });
    expect((await loader.acquire((await put("a", png(1000, 1000))).url)).ok).toBe(true);
    expect(await loader.acquire((await put("b", png(1000, 1001))).url)).toMatchObject({
      ok: false,
      error: { code: "too-large" },
    });
  });

  test("refuses images whose header cannot be read, or that claim zero size", async () => {
    const { loader, put } = await setup({ maxPixels: 1_000_000 });
    const truncated = concat(png().slice(0, 12), "IHDR", [0, 0]);
    expect(await loader.acquire((await put("trunc", truncated)).url)).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
    expect(await loader.acquire((await put("zero-w", png(0, 5))).url)).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
    expect(await loader.acquire((await put("zero-h", png(5, 0))).url)).toMatchObject({
      ok: false,
      error: { code: "unsupported-type" },
    });
  });

  test("non-image media is not subject to the pixel limit", async () => {
    const { loader, put } = await setup({ maxPixels: 1 });
    expect((await loader.acquire((await put("v", mp4())).url)).ok).toBe(true);
  });

  test("without maxPixels no header is read", async () => {
    const { loader, put } = await setup();
    expect((await loader.acquire((await put("big", png(30000, 30000))).url)).ok).toBe(true);
  });

  test("inert fallbacks are not treated as images", async () => {
    const { loader, put } = await setup({ maxPixels: 1 });
    const result = await loader.acquire((await put("s", svg())).url, { inert: true });
    expect(result.ok && result.value.contentType).toBe(INERT_TYPE);
  });
});
