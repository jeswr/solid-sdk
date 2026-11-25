// AUTHORED-BY Claude Sonnet 5.5
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import {
  allResources,
  harness,
  intercept,
  jpeg,
  must,
  png,
  putInput,
  ROOT,
  sha256Of,
  text,
} from "../test/support.js";

describe.each(["solid", "lws"] as const)("put (%s)", (protocol) => {
  it("creates library, shards, binary, thumbnail and description", async () => {
    const h = await harness(protocol);
    expect(h.store.library).toBeNull();
    const result = await h.store.put(putInput({ thumbnail: { bytes: jpeg(1) } }));
    if (!result.ok) throw new Error(result.error.reason);
    const out = result.value;
    expect(out.existed).toBe(false);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    const library = h.store.library as string;
    expect(library.startsWith(ROOT)).toBe(true);
    for (const url of [out.descriptionUrl, out.binaryUrl, out.thumbnailUrl as string]) {
      expect(url.startsWith(`${library}2026/05/`)).toBe(true);
      expect(h.store.isInsideLibrary(url)).toBe(true);
    }
    expect(h.store.isInsideLibrary(library)).toBe(false);
    expect(h.store.isInsideLibrary(`${ROOT}profile/card`)).toBe(false);
    const head = await h.storage.head(out.binaryUrl);
    expect(head.contentType).toBe("image/png");
    const stored = JSON.parse(await text(h.storage, out.descriptionUrl));
    expect(stored.contentUrl).toBe(out.binaryUrl);
    expect(stored.thumbnailUrl).toBe(out.thumbnailUrl);
    expect(stored.sha256).toBe(out.sha256);
    expect(await allResources(h.storage)).toHaveLength(3);
  });

  it("names resources by content hash and the sniffed extension (Solid)", async () => {
    const h = await harness(protocol);
    must(
      await h.store.put(putInput({ bytes: jpeg(2), contentType: "image/jpeg", extension: "jpeg" })),
    );
    const listing = await allResources(h.storage);
    const binary = listing.find((url) => url.endsWith(".jpg")) as string;
    const digest = await crypto.subtle.digest("SHA-256", jpeg(2) as Uint8Array<ArrayBuffer>);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(binary.endsWith(`/${hex}.jpg`)).toBe(true);
    if (protocol === "solid") expect(listing.some((url) => url.endsWith(`/${hex}`))).toBe(true);
  });

  describe("Blob bodies", () => {
    /** Every body that reached `storage.create`, in order. */
    const spyCreates = (bodies: unknown[]) => (storage: Parameters<typeof intercept>[0]) =>
      intercept(storage, ({ method, args }) => {
        if (method === "create") bodies.push(args[1]);
      });
    const blobs = (bodies: unknown[]) => bodies.filter((body) => body instanceof Blob) as Blob[];

    it("reads the caller's Blob exactly once and sends a Blob, not a typed array", async () => {
      const bytes = png(7, 4096);
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      const thumb = new Blob([jpeg(3) as Uint8Array<ArrayBuffer>]);
      const read = vi.spyOn(blob, "arrayBuffer");
      const sliced = vi.spyOn(blob, "slice");
      const stream = vi.spyOn(blob, "stream");
      const thumbRead = vi.spyOn(thumb, "arrayBuffer");
      const bodies: unknown[] = [];
      const h = await harness(protocol, {}, spyCreates(bodies));
      const out = must(await h.store.put(putInput({ bytes: blob, thumbnail: { bytes: thumb } })));
      expect(read).toHaveBeenCalledTimes(1);
      expect(thumbRead).toHaveBeenCalledTimes(1);
      expect(sliced).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
      // The transport got a Blob for each media create (plus the description document).
      expect(bodies.some((body) => body instanceof Uint8Array)).toBe(false);
      expect(blobs(bodies).filter((body) => body.size === 4096)).toHaveLength(1);
      expect(bodies).not.toContain(blob);
      expect(out.sha256).toBe(await sha256Of(bytes));
      const stored = await h.storage.read(out.binaryUrl);
      expect(new Uint8Array(await new Response(stored.body).arrayBuffer())).toEqual(bytes);
    });

    it("uploads the bytes it hashed even when the caller's Blob answers a second read differently", async () => {
      const first = png(1, 512);
      const second = png(2, 512);
      let reads = 0;
      const unstable = new Blob([first as Uint8Array<ArrayBuffer>]);
      unstable.arrayBuffer = async () => {
        reads += 1;
        const source = reads === 1 ? first : second;
        return source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ) as ArrayBuffer;
      };
      unstable.slice = () => new Blob([second as Uint8Array<ArrayBuffer>]);
      unstable.stream = () => new Blob([second as Uint8Array<ArrayBuffer>]).stream();
      const h = await harness(protocol, {}, spyCreates([]));
      const out = must(await h.store.put(putInput({ bytes: unstable })));
      expect(out.sha256).toBe(await sha256Of(first));
      const stored = await h.storage.read(out.binaryUrl);
      const body = new Uint8Array(await new Response(stored.body).arrayBuffer());
      expect(body).toEqual(first);
      expect(await sha256Of(body)).toBe(out.sha256);
      expect(reads).toBe(1);
      // The description states the real size and hash.
      const description = JSON.parse(await text(h.storage, out.descriptionUrl));
      expect(description.sha256).toBe(out.sha256);
    });

    it("hands build the true size, content type and hash", async () => {
      const seen: Array<{ sha256: string; contentType: string; byteLength: number }> = [];
      const h = await harness(protocol, {
        build: async (url, binaryUrl, input, context) => {
          seen.push({
            sha256: context.sha256,
            contentType: context.contentType,
            byteLength: context.byteLength,
          });
          const { buildModel } = await import("../test/support.js");
          return buildModel(url, binaryUrl, input, context);
        },
      });
      const bytes = png(3, 777);
      const out = must(
        await h.store.put(putInput({ bytes: new Blob([bytes as Uint8Array<ArrayBuffer>]) })),
      );
      expect(seen).toEqual([{ sha256: out.sha256, contentType: "image/png", byteLength: 777 }]);
    });

    it("stores a body larger than the 16 MiB replay limit when maxBytes allows it", async () => {
      const big = png(9, 17 * 1024 * 1024);
      const blob = new Blob([big as Uint8Array<ArrayBuffer>]);
      const bodies: unknown[] = [];
      const h = await harness(protocol, { maxBytes: 20 * 1024 * 1024 }, spyCreates(bodies));
      const out = must(await h.store.put(putInput({ bytes: blob })));
      expect(blobs(bodies).some((body) => body.size === 17 * 1024 * 1024)).toBe(true);
      expect(out.sha256).toBe(await sha256Of(big));
      const stored = await h.storage.read(out.binaryUrl);
      expect((await new Response(stored.body).arrayBuffer()).byteLength).toBe(17 * 1024 * 1024);
    });

    it("still refuses a Blob over maxBytes before reading any of it", async () => {
      const blob = new Blob([png(1, 2048) as Uint8Array<ArrayBuffer>]);
      const read = vi.spyOn(blob, "arrayBuffer");
      const h = await harness(protocol, { maxBytes: 1024 });
      expect(await h.store.put(putInput({ bytes: blob }))).toEqual({
        ok: false,
        error: { kind: "too-large", reason: "bytes-too-large" },
      });
      expect(read).not.toHaveBeenCalled();
    });

    it("sends a Uint8Array body as a Blob too", async () => {
      const bytes = png(5, 256);
      const bodies: unknown[] = [];
      const h = await harness(protocol, {}, spyCreates(bodies));
      must(await h.store.put(putInput({ bytes })));
      expect(bodies.some((body) => body instanceof Uint8Array)).toBe(false);
      expect(blobs(bodies).some((body) => body.size === 256)).toBe(true);
    });

    it("reads an attached thumbnail Blob once and sends a Blob", async () => {
      const bodies: unknown[] = [];
      const h = await harness(protocol, {}, spyCreates(bodies));
      const first = must(await h.store.put(putInput()));
      expect(first.thumbnailUrl).toBeUndefined();
      const thumb = new Blob([jpeg(4) as Uint8Array<ArrayBuffer>]);
      const read = vi.spyOn(thumb, "arrayBuffer");
      bodies.length = 0;
      await h.store.attachThumbnail(first.descriptionUrl, {
        bytes: thumb,
        mutate: async (current, thumbnailUrl) => ({
          contentType: "application/ld+json",
          body: JSON.stringify({ ...JSON.parse(current.body), thumbnailUrl }),
        }),
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toBeInstanceOf(Blob);
      expect(bodies[0]).not.toBe(thumb);
    });
  });

  describe("size and quota failures", () => {
    const failWith =
      (code: "payload-too-large" | "insufficient-storage" | "unsupported-media-type") =>
      (storage: Parameters<typeof intercept>[0]) =>
        intercept(storage, ({ method, args }) => {
          if (method === "create" && args[1] instanceof Blob && args[1].size === 64) {
            throw new StorageError(code, { url: ROOT, method: "POST" });
          }
        });

    it.each([
      ["payload-too-large", "too-large", "payload-too-large"],
      ["insufficient-storage", "too-large", "insufficient-storage"],
      ["unsupported-media-type", "unsupported", "storage"],
    ] as const)("reports a storage %s as %s / %s", async (code, kind, reason) => {
      const h = await harness(protocol, {}, failWith(code));
      const result = await h.store.put(putInput({ bytes: png(1, 64) }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect([result.error.kind, result.error.reason]).toEqual([kind, reason]);
    });
  });

  describe("3D formats", () => {
    const ply = new TextEncoder().encode(
      "ply\nformat binary_little_endian 1.0\nelement vertex 1\nend_header\n\u0000\u0001\u0002",
    );
    const Ngsp = new Uint8Array(48);
    Ngsp.set(new TextEncoder().encode("NGSP"));
    new DataView(Ngsp.buffer).setUint32(4, 4, true);

    it("stores PLY as an opaque model (application/octet-stream, .ply)", async () => {
      const h = await harness(protocol);
      const out = must(
        await h.store.put(
          putInput({ bytes: ply, contentType: "application/octet-stream", extension: ".ply" }),
        ),
      );
      expect((await h.storage.head(out.binaryUrl)).contentType).toBe("application/octet-stream");
      expect(out.binaryUrl.endsWith(".ply")).toBe(true);
    });

    it("stores SPZ only when the declared extension is .spz", async () => {
      const h = await harness(protocol);
      const out = must(
        await h.store.put(
          putInput({ bytes: Ngsp, contentType: "application/octet-stream", extension: ".spz" }),
        ),
      );
      expect(out.binaryUrl.endsWith(".spz")).toBe(true);
      for (const extension of [".gz", ".bin", ".ply"]) {
        expect(
          await h.store.put(
            putInput({ bytes: Ngsp, contentType: "application/octet-stream", extension }),
          ),
        ).toEqual({ ok: false, error: { kind: "unsupported", reason: "unsniffable" } });
      }
    });

    it("keeps refusing glTF JSON, OBJ and FBX, and svg named as a model", async () => {
      const h = await harness(protocol);
      for (const [text, extension] of [
        ['{"asset":{"version":"2.0"}}', ".gltf"],
        ["# obj\nv 0 0 0\n", ".obj"],
        ["Kaydara FBX Binary  \u0000", ".fbx"],
        ['<svg xmlns="http://www.w3.org/2000/svg"/>', ".svg"],
      ] as const) {
        const result = await h.store.put(
          putInput({
            bytes: new TextEncoder().encode(text),
            contentType: "application/octet-stream",
            extension,
          }),
        );
        expect(result).toEqual({
          ok: false,
          error: { kind: "unsupported", reason: "unsniffable" },
        });
      }
    });
  });

  it("finds the library again through the type index and reuses an existing registration", async () => {
    const h = await harness(protocol);
    await h.store.put(putInput());
    const library = h.store.library;
    const again = await h.reopen();
    expect(again.library).toBe(library);
    const second = await again.put(putInput({ seed: 2, description: { name: "second" } }));
    expect(second.ok).toBe(true);
    expect(again.library).toBe(library);
  });

  it("does not register or create anything on open", async () => {
    const h = await harness(protocol);
    expect(await allResources(h.storage)).toEqual([]);
    const containers: string[] = [];
    for await (const entry of h.storage.listAll(ROOT)) containers.push(entry.url);
    expect(containers.some((url) => url.includes("media"))).toBe(false);
  });

  it("uses shards by UTC creation month", async () => {
    const h = await harness(protocol);
    const a = await h.store.put(putInput({ seed: 1, createdAt: new Date("2026-01-31T23:59:59Z") }));
    const b = await h.store.put(putInput({ seed: 2, createdAt: new Date("2026-02-01T00:00:00Z") }));
    if (!a.ok || !b.ok) throw new Error("put failed");
    expect(a.value.descriptionUrl).toContain("/2026/01/");
    expect(b.value.descriptionUrl).toContain("/2026/02/");
  });

  it("accepts a Blob and reports the same hash as the bytes", async () => {
    const h = await harness(protocol);
    const bytes = png(7);
    const a = await h.store.put(
      putInput({ bytes: new Blob([bytes as Uint8Array<ArrayBuffer>]), seed: 7 }),
    );
    const h2 = await harness(protocol);
    const b = await h2.store.put(putInput({ bytes }));
    if (!a.ok || !b.ok) throw new Error("put failed");
    expect(a.value.sha256).toBe(b.value.sha256);
  });

  it("refuses declared types that disagree with the sniffed bytes", async () => {
    const h = await harness(protocol);
    expect(await h.store.put(putInput({ contentType: "image/jpeg" }))).toEqual({
      ok: false,
      error: { kind: "unsupported", reason: "type-mismatch" },
    });
    expect(await h.store.put(putInput({ extension: ".gif" }))).toEqual({
      ok: false,
      error: { kind: "unsupported", reason: "type-mismatch" },
    });
    expect(await allResources(h.storage)).toEqual([]);
  });

  it("refuses bytes the sniffer rejects, SVG and HTML included", async () => {
    const h = await harness(protocol);
    for (const body of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      "<!doctype html><p>x",
      "plain",
    ]) {
      const bytes = new TextEncoder().encode(body);
      const result = await h.store.put(
        putInput({ bytes, contentType: "image/svg+xml", extension: ".svg" }),
      );
      expect(result).toEqual({ ok: false, error: { kind: "unsupported", reason: "unsniffable" } });
    }
    expect(h.store.library).toBeNull();
  });

  it("honours an injected sniffer, validating what it returns", async () => {
    const bad = await harness(protocol, {
      sniff: () => ({ contentType: "text/html; x=1", extension: ".html" }),
    });
    expect((await bad.store.put(putInput())).ok).toBe(false);
    const worse = await harness(protocol, {
      sniff: () => ({ contentType: "image/png", extension: "png" }),
    });
    expect((await worse.store.put(putInput())).ok).toBe(false);
    const ok = await harness(protocol, {
      sniff: () => ({ contentType: "image/x-custom", extension: ".cst" }),
    });
    expect(
      (await ok.store.put(putInput({ contentType: "image/x-custom", extension: "cst" }))).ok,
    ).toBe(true);
  });

  it("enforces maxBytes for Uint8Array, Blob and thumbnails", async () => {
    const h = await harness(protocol, { maxBytes: 16, maxThumbnailBytes: 16 });
    const big = { ok: false, error: { kind: "too-large", reason: "bytes-too-large" } };
    expect(await h.store.put(putInput({ bytes: png(1, 17) }))).toEqual(big);
    expect(
      await h.store.put(putInput({ bytes: new Blob([png(1, 17) as Uint8Array<ArrayBuffer>]) })),
    ).toEqual(big);
    expect(
      await h.store.put(putInput({ bytes: png(1, 16), thumbnail: { bytes: png(2, 17) } })),
    ).toEqual(big);
    expect((await h.store.put(putInput({ bytes: png(1, 16) }))).ok).toBe(true);
  });

  it("rejects a thumbnail that is not a sniffable image, and non-binary input", async () => {
    const h = await harness(protocol);
    const text = new TextEncoder().encode("<svg/>");
    expect(await h.store.put(putInput({ thumbnail: { bytes: text } }))).toEqual({
      ok: false,
      error: { kind: "unsupported", reason: "unsniffable" },
    });
    const audio = new TextEncoder().encode("OggS\0\0\0\0");
    expect((await h.store.put(putInput({ thumbnail: { bytes: audio } }))).ok).toBe(false);
    const invalid = await h.store.put(putInput({ bytes: "not bytes" as unknown as Uint8Array }));
    expect(invalid).toEqual({ ok: false, error: { kind: "failed", reason: "invalid-input" } });
    expect(await h.store.put(putInput({ createdAt: new Date("nope") }))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "invalid-input" },
    });
    expect(await h.store.put(putInput({ createdAt: new Date("1969-12-31T00:00:00Z") }))).toEqual({
      ok: false,
      error: { kind: "failed", reason: "invalid-input" },
    });
  });

  it("returns existed:true and writes nothing when the same bytes are put again", async () => {
    const h = await harness(protocol, protocol === "lws" ? { findByHash: undefined } : {});
    const first = await h.store.put(putInput());
    if (!first.ok) throw new Error("first failed");
    if (protocol === "solid") {
      const before = await allResources(h.storage);
      const again = await h.store.put(putInput());
      expect(again).toEqual({ ok: true, value: { ...first.value, existed: true } });
      expect(await allResources(h.storage)).toEqual(before);
    }
  });

  it("returns the typed result when storage is offline, forbidden or the scope is wrong", async () => {
    const offline = await harness(protocol, {}, (s) =>
      intercept(s, ({ method }) => {
        if (method === "create") {
          throw new StorageError("network", { url: ROOT, method: "POST" });
        }
      }),
    );
    expect(await offline.store.put(putInput())).toEqual({
      ok: false,
      error: { kind: "offline", reason: "storage" },
    });
    const denied = await harness(protocol, {}, (s) =>
      intercept(s, ({ method }) => {
        if (method === "create") throw new StorageError("forbidden", { url: ROOT, method: "POST" });
      }),
    );
    expect((await denied.store.put(putInput())).ok).toBe(false);
    const odd = await harness(protocol, {}, (s) =>
      intercept(s, ({ method }) => {
        if (method === "create") throw new Error("https://pod.example/?token=secret");
      }),
    );
    const result = await odd.store.put(putInput());
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result).toEqual({ ok: false, error: { kind: "failed", reason: "unexpected" } });
  });
});
