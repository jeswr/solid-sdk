// AUTHORED-BY Claude Sonnet 5.5
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { fail, MediaFailure, run, toError } from "./errors.js";
import { exposureFromOwnerOnly } from "./exposure.js";
import { defaultSleep, loadBytes, normaliseDescription, readBounded } from "./io.js";
import { createMemoryJournal } from "./journal.js";
import {
  isInsideLibrary,
  isShardKey,
  isShardUrl,
  segmentOf,
  shardChildOf,
  shardKeyOf,
} from "./scope.js";
import { defaultSniff } from "./sniff.js";

const ascii = (text: string, pad = 16) => {
  const bytes = new Uint8Array(Math.max(pad, text.length));
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
};
const withBytes = (head: number[], size = 24) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
};
const riff = (form: string) => {
  const bytes = ascii("RIFF\0\0\0\0", 16);
  bytes.set(ascii(form, 4), 8);
  return bytes;
};
const ftyp = (brand: string) => {
  const bytes = new Uint8Array(24);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set(ascii("ftyp", 4), 4);
  bytes.set(ascii(brand, 4), 8);
  return bytes;
};

describe("defaultSniff", () => {
  const cases: Array<[string, Uint8Array, string, string]> = [
    ["png", withBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", ".png"],
    ["jpeg", withBytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", ".jpg"],
    ["gif87", ascii("GIF87a"), "image/gif", ".gif"],
    ["gif89", ascii("GIF89a"), "image/gif", ".gif"],
    ["webp", riff("WEBP"), "image/webp", ".webp"],
    ["wav", riff("WAVE"), "audio/wav", ".wav"],
    ["avif", ftyp("avif"), "image/avif", ".avif"],
    ["avis", ftyp("avis"), "image/avif", ".avif"],
    ["mp4 isom", ftyp("isom"), "video/mp4", ".mp4"],
    ["mp4 mp42", ftyp("mp42"), "video/mp4", ".mp4"],
    ["mp4 M4V", ftyp("M4V "), "video/mp4", ".mp4"],
    [
      "webm",
      (() => {
        const b = withBytes([0x1a, 0x45, 0xdf, 0xa3], 40);
        b.set(ascii("webm", 4), 20);
        return b;
      })(),
      "video/webm",
      ".webm",
    ],
    [
      "glb",
      withBytes([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]),
      "model/gltf-binary",
      ".glb",
    ],
    ["ogg", ascii("OggS"), "audio/ogg", ".ogg"],
    ["flac", ascii("fLaC"), "audio/flac", ".flac"],
    ["mp3 id3", ascii("ID3"), "audio/mpeg", ".mp3"],
    ["mp3 frame", withBytes([0xff, 0xfb, 0x90, 0x00]), "audio/mpeg", ".mp3"],
  ];
  it.each(cases)("recognises %s", (_name, bytes, contentType, extension) => {
    expect(defaultSniff(bytes)).toEqual({ contentType, extension });
  });

  it("returns undefined for everything else, SVG, HTML, XML and scripts included", () => {
    const refused: Array<[string, Uint8Array]> = [
      ["empty", new Uint8Array()],
      ["svg", ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ["svg with xml prolog", ascii('<?xml version="1.0"?><svg/>')],
      ["html", ascii("<!DOCTYPE html><html>")],
      ["bom html", Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii("<html>")])],
      ["script", ascii("<script>alert(1)</script>")],
      ["javascript", ascii("alert(1)")],
      ["json", ascii("{}")],
      ["matroska", withBytes([0x1a, 0x45, 0xdf, 0xa3], 40)],
      ["heic", ftyp("heic")],
      ["glb v1", withBytes([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0, 12, 0, 0, 0])],
      ["glb short", ascii("glTF", 4)],
      ["riff other", riff("AVI ")],
      ["truncated png", Uint8Array.from([0x89, 0x50, 0x4e])],
      ["bad mp3 frame", withBytes([0xff, 0xfb, 0xf0, 0x00])],
      ["mp3 free bitrate", withBytes([0xff, 0xfb, 0x00, 0x00])],
      ["mp3 reserved version", withBytes([0xff, 0xeb, 0x90, 0x00])],
      ["mp3 reserved layer", withBytes([0xff, 0xf9, 0x90, 0x00])],
      ["short ff", Uint8Array.from([0xff, 0xfb])],
      ["ff but not sync", withBytes([0xff, 0x10, 0x90, 0x00])],
    ];
    for (const [label, bytes] of refused) expect(defaultSniff(bytes), label).toBeUndefined();
  });

  it("refuses polyglots: a valid media header that also carries markup", () => {
    const gifSvg = ascii('GIF89a<svg onload="alert(1)">', 64);
    const pngHtml = withBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64);
    pngHtml.set(ascii("<HTML><script>", 14), 12);
    const jpegXml = withBytes([0xff, 0xd8, 0xff, 0xe0], 64);
    jpegXml.set(ascii("<?xml", 5), 8);
    const gifDoctype = ascii("GIF87a<!doctype html>", 64);
    for (const bytes of [gifSvg, pngHtml, jpegXml, gifDoctype]) {
      expect(defaultSniff(bytes)).toBeUndefined();
    }
    // Markup later in a real file (an XMP packet) is not a polyglot.
    const photo = withBytes([0xff, 0xd8, 0xff, 0xe0], 400);
    photo.set(ascii("<?xml version", 13), 300);
    expect(defaultSniff(photo)?.contentType).toBe("image/jpeg");
  });
});

describe("scope helpers", () => {
  const lib = "https://pod.example/alice/media/";
  it("isInsideLibrary is strict about the library tree", () => {
    expect(isInsideLibrary(lib, `${lib}2026/05/a.png`)).toBe(true);
    for (const url of [
      lib,
      lib.slice(0, -1),
      "https://pod.example/alice/",
      "https://pod.example/alice/media-other/x",
      "https://pod.example/alice/media/../private/x",
      "https://pod.example/alice/media/%2e%2e/private/x",
      "https://pod.example/alice/media/a%2fb",
      "https://evil.example/alice/media/x",
      "http://pod.example/alice/media/x",
      "https://u:p@pod.example/alice/media/x",
      `${lib}x?token=1`,
      `${lib}x#frag`,
      "//pod.example/alice/media/x",
      "file:///alice/media/x",
      "not a url",
      "",
      5 as unknown as string,
    ]) {
      expect(isInsideLibrary(lib, url), String(url)).toBe(false);
    }
  });

  it("shardKeyOf uses UTC and a four-digit year", () => {
    expect(shardKeyOf(new Date("2026-05-31T23:59:59Z"))).toBe("2026/05");
    expect(shardKeyOf(new Date("2026-12-01T00:00:00Z"))).toBe("2026/12");
    expect(shardKeyOf(new Date("1970-01-01T00:00:00Z"))).toBe("1970/01");
    expect(shardKeyOf(new Date("1969-12-31T23:59:59Z"))).toBeUndefined();
    expect(shardKeyOf(new Date(Date.UTC(10_000, 0, 1)))).toBeUndefined();
    expect(shardKeyOf(new Date("x"))).toBeUndefined();
  });

  it("isShardKey, shardChildOf, isShardUrl and segmentOf", () => {
    expect(isShardKey("2026/05")).toBe(true);
    for (const value of ["2026/13", "2026", "2026/05/01", "26/05", 5, "2026/5", "abcd/05"]) {
      expect(isShardKey(value)).toBe(false);
    }
    expect(shardChildOf(lib, `${lib}2026/05/a.png`)).toEqual({
      shardUrl: `${lib}2026/05/`,
      name: "a.png",
    });
    for (const url of [
      `${lib}2026/05/`,
      `${lib}2026/05/a/b`,
      `${lib}2026/13/a`,
      `${lib}x/05/a`,
      `${lib}2026/a`,
      `${lib}a`,
      "https://pod.example/alice/other/2026/05/a",
    ]) {
      expect(shardChildOf(lib, url), url).toBeUndefined();
    }
    expect(isShardUrl(lib, `${lib}2026/05/`)).toBe(true);
    for (const url of [
      `${lib}2026/05`,
      `${lib}2026/`,
      `${lib}2026/05/a/`,
      `${lib}2026/13/`,
      "https://evil.example/2026/05/",
    ]) {
      expect(isShardUrl(lib, url), url).toBe(false);
    }
    expect(segmentOf("https://pod.example/a/b%20c")).toBe("b c");
    expect(segmentOf("https://pod.example/a/b%zz")).toBe("b%zz");
    expect(segmentOf("https://pod.example/a/c/")).toBe("c");
  });
});

describe("cursor", () => {
  it("round-trips", () => {
    const position = { shard: "2026/05", page: "https://pod.example/x?page=2", offset: 7 };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
    expect(decodeCursor(encodeCursor({ ...position, page: null }))).toEqual({
      ...position,
      page: null,
    });
    expect(encodeCursor(position)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects anything malformed", () => {
    const enc = (value: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
    };
    for (const cursor of [
      "",
      "***",
      "!!!!",
      "abc",
      btoa("not json"),
      enc({ a: 1 }),
      enc([2, "2026/05", null, 0]),
      enc([1, "2026/05", null]),
      enc([1, "bad", null, 0]),
      enc([1, "2026/05", 5, 0]),
      enc([1, "2026/05", null, 1.5]),
      enc([1, "2026/05", null, -1]),
      enc([1, "2026/05", null, 2_000_000]),
      enc([1, "2026/05", null, "0"]),
      "_-8",
    ]) {
      expect(() => decodeCursor(cursor), cursor).toThrow(MediaFailure);
    }
  });
});

describe("errors", () => {
  it("maps storage codes to the closed union and hides everything else", () => {
    const code = (c: ConstructorParameters<typeof StorageError>[0]) =>
      toError(
        new StorageError(c, { url: "https://u:p@x.example/?token=s", method: "GET" }),
        undefined,
      );
    expect(code("unauthenticated").kind).toBe("forbidden");
    expect(code("forbidden").kind).toBe("forbidden");
    expect(code("not-found").kind).toBe("not-found");
    expect(code("conflict").kind).toBe("conflict");
    expect(code("precondition-failed").kind).toBe("conflict");
    expect(code("network").kind).toBe("offline");
    expect(code("payload-too-large").kind).toBe("too-large");
    expect(code("insufficient-storage").kind).toBe("too-large");
    expect(code("unsupported").kind).toBe("unsupported");
    expect(code("unsupported-media-type").kind).toBe("unsupported");
    expect(code("server")).toEqual({ kind: "failed", reason: "storage" });
    expect(code("scope")).toEqual({ kind: "failed", reason: "out-of-scope" });
    expect(JSON.stringify(code("server"))).not.toContain("token");
    expect(toError("weird", undefined)).toEqual({ kind: "failed", reason: "unexpected" });
    expect(toError(fail("conflict", "hash-mismatch"), undefined)).toEqual({
      kind: "conflict",
      reason: "hash-mismatch",
    });
    const controller = new AbortController();
    controller.abort();
    expect(toError(new Error("anything"), controller.signal)).toEqual({
      kind: "failed",
      reason: "aborted",
    });
    expect(new MediaFailure("failed", "storage", ["a"]).error).toEqual({
      kind: "failed",
      reason: "storage",
      orphans: ["a"],
    });
  });

  it("run converts throws and honours a pre-aborted signal", async () => {
    expect(await run(undefined, async () => 5)).toEqual({ ok: true, value: 5 });
    const controller = new AbortController();
    controller.abort();
    expect(await run(controller.signal, async () => 5)).toEqual({
      ok: false,
      error: { kind: "failed", reason: "aborted" },
    });
  });
});

describe("io helpers", () => {
  const streamOf = (...chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

  it("readBounded joins chunks, treats no body as empty and cancels over the cap", async () => {
    expect(await readBounded({ body: null }, 4, () => new Error("big"))).toEqual(new Uint8Array());
    const joined = await readBounded(
      { body: streamOf(Uint8Array.of(1, 2), Uint8Array.of(3)) },
      3,
      () => new Error("big"),
    );
    expect(Array.from(joined)).toEqual([1, 2, 3]);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBounded({ body }, 6, () => new Error("big"))).rejects.toThrow("big");
    expect(cancelled).toBe(true);
  });

  it("loadBytes enforces the cap before reading and rejects other inputs", async () => {
    expect(await loadBytes(new Uint8Array(3), 3)).toHaveLength(3);
    expect(await loadBytes(new Blob(["abc"]), 3)).toHaveLength(3);
    await expect(loadBytes(new Uint8Array(4), 3)).rejects.toMatchObject({
      error: { kind: "too-large" },
    });
    await expect(loadBytes(new Blob(["abcd"]), 3)).rejects.toMatchObject({
      error: { kind: "too-large" },
    });
    await expect(loadBytes("abc" as never, 3)).rejects.toMatchObject({
      error: { reason: "invalid-input" },
    });
  });

  it("normaliseDescription accepts RDF types only and caps the size", () => {
    expect(normaliseDescription("<a> <b> <c> .", 100)).toEqual({
      body: "<a> <b> <c> .",
      contentType: "text/turtle",
    });
    expect(
      normaliseDescription({ body: "{}", contentType: "Application/LD+JSON; charset=utf-8" }, 100)
        .contentType,
    ).toBe("application/ld+json");
    expect(() => normaliseDescription({ body: "{}", contentType: "text/html" }, 100)).toThrow(
      MediaFailure,
    );
    expect(() =>
      normaliseDescription({ body: 1 as never, contentType: "text/turtle" }, 100),
    ).toThrow(MediaFailure);
    expect(() => normaliseDescription("é".repeat(51), 100)).toThrow(MediaFailure);
  });

  it("defaultSleep waits, and rejects at once when aborted", async () => {
    await defaultSleep(1);
    await defaultSleep(1, new AbortController().signal);
    const controller = new AbortController();
    const waiting = defaultSleep(10_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(MediaFailure);
  });
});

describe("journal and exposure adapters", () => {
  it("memory journal replaces by description url", async () => {
    const journal = createMemoryJournal();
    await journal.put({ descriptionUrl: "a", shardUrl: "s", binaryUrl: "b" });
    await journal.put({ descriptionUrl: "a", shardUrl: "s", binaryUrl: "c" });
    await journal.put({ descriptionUrl: "z", shardUrl: "s" });
    expect(await journal.list()).toEqual([
      { descriptionUrl: "a", shardUrl: "s", binaryUrl: "c" },
      { descriptionUrl: "z", shardUrl: "s" },
    ]);
    await journal.delete("a");
    await journal.delete("missing");
    expect(await journal.list()).toHaveLength(1);
  });

  it("exposureFromOwnerOnly: only an explicit non-owner grant is exposed, failures are unknown", async () => {
    const probe = (result: unknown) =>
      exposureFromOwnerOnly(async () => result as never)("https://pod.example/alice/");
    expect(await probe({ private: true })).toBe("private");
    expect(
      await probe({ private: false, reasons: [{ reason: "non-owner", subject: "public" }] }),
    ).toBe("exposed");
    expect(
      await probe({ private: false, reasons: [{ reason: "unknown" }, { reason: "non-owner" }] }),
    ).toBe("exposed");
    expect(await probe({ private: false, reasons: [{ reason: "unknown" }] })).toBe("unknown");
    expect(await probe({ private: false, reasons: [{ reason: "unsupported-model" }] })).toBe(
      "unknown",
    );
    const failing = exposureFromOwnerOnly(async () => {
      throw new Error("boom");
    });
    expect(await failing("https://pod.example/alice/")).toBe("unknown");
    const controller = new AbortController();
    controller.abort();
    await expect(failing("https://pod.example/alice/", controller.signal)).rejects.toThrow("boom");
  });
});
