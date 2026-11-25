// AUTHORED-BY Claude Sonnet 5.5
import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { fail, MediaFailure, run, toError } from "./errors.js";
import { exposureFromOwnerOnly } from "./exposure.js";
import { loadSource, normaliseDescription, readBounded, sha256Source } from "./io.js";
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
const ftyp = (brand: string, compat: string[] = []) => {
  const bytes = new Uint8Array(Math.max(24, 16 + compat.length * 4));
  bytes.set([0, 0, 0, bytes.length], 0);
  bytes.set(ascii("ftyp", 4), 4);
  bytes.set(ascii(brand, 4), 8);
  compat.forEach((entry, i) => {
    bytes.set(ascii(entry, 4), 16 + i * 4);
  });
  return bytes;
};
/** `count` back-to-back MPEG frames: the header bytes, then the rest of the frame length. */
const mpeg = (header: number[], length: number, count = 2) => {
  const bytes = new Uint8Array(length * count + 4);
  for (let i = 0; i <= count; i++) bytes.set(header, i * length);
  return bytes;
};
const id3 = (...header: number[]) => {
  const bytes = new Uint8Array(32);
  bytes.set(ascii("ID3", 3));
  bytes.set(header, 3);
  return bytes;
};
const ogg = (codec: string) => {
  const bytes = new Uint8Array(64);
  bytes.set(ascii("OggS", 4));
  bytes.set(ascii(codec, codec.length), 28);
  return bytes;
};
const ebml = (doctype: number[]) => {
  const bytes = new Uint8Array(64);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  bytes.set(doctype, 20);
  return bytes;
};
const WEBM = [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];
const utf16 = (text: string) => Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]));

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
    ["avif by compatible brand under mif1", ftyp("mif1", ["miaf", "avif"]), "image/avif", ".avif"],
    ["heic", ftyp("heic"), "image/heic", ".heic"],
    ["heix", ftyp("heix"), "image/heic", ".heic"],
    ["heic under mif1", ftyp("mif1", ["mif1", "heic"]), "image/heic", ".heic"],
    ["mp4 isom", ftyp("isom"), "video/mp4", ".mp4"],
    ["mp4 iso3", ftyp("iso3"), "video/mp4", ".mp4"],
    ["mp4 dash", ftyp("dash"), "video/mp4", ".mp4"],
    ["mp4 mp42", ftyp("mp42"), "video/mp4", ".mp4"],
    ["mp4 M4V", ftyp("M4V "), "video/mp4", ".mp4"],
    ["m4a", ftyp("M4A "), "audio/mp4", ".m4a"],
    ["quicktime", ftyp("qt  "), "video/quicktime", ".mov"],
    ["webm", ebml(WEBM), "video/webm", ".webm"],
    [
      "glb",
      withBytes([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]),
      "model/gltf-binary",
      ".glb",
    ],
    ["ogg vorbis", ogg("\x01vorbis"), "audio/ogg", ".ogg"],
    ["ogg opus", ogg("OpusHead"), "audio/ogg", ".ogg"],
    ["flac", ascii("fLaC"), "audio/flac", ".flac"],
    ["mp3 with an id3v2 header", id3(4, 0, 0, 0, 0, 0x02, 0x01), "audio/mpeg", ".mp3"],
    ["mp3 mpeg1 layer3", mpeg([0xff, 0xfb, 0x90, 0x00], 417), "audio/mpeg", ".mp3"],
    ["mp3 mpeg1 layer3 padded", mpeg([0xff, 0xfb, 0x92, 0x00], 418), "audio/mpeg", ".mp3"],
    ["mp3 mpeg2 layer3", mpeg([0xff, 0xf3, 0x80, 0x00], 208), "audio/mpeg", ".mp3"],
    ["mp3 mpeg2.5 layer3", mpeg([0xff, 0xe3, 0x80, 0x00], 417), "audio/mpeg", ".mp3"],
    ["mp3 mpeg1 layer2", mpeg([0xff, 0xfd, 0x90, 0x00], 522), "audio/mpeg", ".mp3"],
    ["mp3 mpeg2 layer2", mpeg([0xff, 0xf5, 0x80, 0x00], 417), "audio/mpeg", ".mp3"],
    ["mp3 mpeg1 layer1", mpeg([0xff, 0xff, 0x10, 0x00], 32), "audio/mpeg", ".mp3"],
  ];
  it.each(cases)("recognises %s", (_name, bytes, contentType, extension) => {
    expect(defaultSniff(bytes)).toEqual({ contentType, extension });
  });

  it("returns undefined for everything else, SVG, HTML, XML and scripts included", () => {
    const farWebm = new Uint8Array(100);
    farWebm.set([0x1a, 0x45, 0xdf, 0xa3]);
    farWebm.set(WEBM, 90);
    const brokenSecondFrame = mpeg([0xff, 0xfb, 0x90, 0x00], 417, 1);
    brokenSecondFrame.set([0xff, 0xfb, 0xf0, 0x00], 417);
    const refused: Array<[string, Uint8Array]> = [
      ["empty", new Uint8Array()],
      ["svg", ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ["svg with xml prolog", ascii('<?xml version="1.0"?><svg/>')],
      ["html", ascii("<!DOCTYPE html><html>")],
      ["bom html", Uint8Array.from([0xef, 0xbb, 0xbf, ...ascii("<html>")])],
      ["script", ascii("<script>alert(1)</script>")],
      ["javascript", ascii("alert(1)")],
      ["json", ascii("{}")],
      ["matroska", ebml([0x42, 0x82, 0x88, ...ascii("matroska", 8)])],
      ["a webm string that is not the doctype", ebml([...ascii("title=webm", 10)])],
      ["ebml with the doctype past the header", farWebm],
      ["ftyp with an unknown brand", ftyp("zzzz")],
      ["heif without a known compatible brand", ftyp("mif1", ["miaf"])],
      ["ftyp too short to carry a brand", Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70])],
      ["glb v1", withBytes([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0, 12, 0, 0, 0])],
      ["glb short", ascii("glTF", 4)],
      ["riff other", riff("AVI ")],
      ["truncated png", Uint8Array.from([0x89, 0x50, 0x4e])],
      ["jpeg with no marker", withBytes([0xff, 0xd8, 0xff, 0x00])],
      ["jpeg of three bytes", Uint8Array.from([0xff, 0xd8, 0xff])],
      ["ogg video (theora)", ogg("\x80theora")],
      ["ogg with no codec", ascii("OggS")],
      ["id3 alone", ascii("ID3", 3)],
      ["id3 with a flag bit set", id3(4, 0, 1, 0, 0, 0, 0)],
      ["id3 with a size byte over 0x7f", id3(4, 0, 0, 0, 0, 0, 0x80)],
      ["id3 with version ff", id3(0xff, 0, 0, 0, 0, 0, 0)],
      ["id3 with revision ff", id3(4, 0xff, 0, 0, 0, 0, 0)],
      ["a single mpeg frame", mpeg([0xff, 0xfb, 0x90, 0x00], 417, 0)],
      ["two syncs that are not a frame apart", mpeg([0xff, 0xfb, 0x90, 0x00], 100)],
      ["a second frame that is invalid", brokenSecondFrame],
      ["bad mp3 frame", withBytes([0xff, 0xfb, 0xf0, 0x00])],
      ["mp3 free bitrate", withBytes([0xff, 0xfb, 0x00, 0x00])],
      ["mp3 reserved sample rate", withBytes([0xff, 0xfb, 0x9c, 0x00])],
      ["mp3 reserved version", withBytes([0xff, 0xeb, 0x90, 0x00])],
      ["mp3 reserved layer", withBytes([0xff, 0xf9, 0x90, 0x00])],
      ["short ff", Uint8Array.from([0xff, 0xfb])],
      ["ff but not sync", withBytes([0xff, 0x10, 0x90, 0x00])],
      [
        "V6 utf-16 html",
        Uint8Array.from([0xff, 0xfe, ...utf16("<html><script>alert(1)</script>")]),
      ],
      ["V6 utf-16 svg", Uint8Array.from([0xff, 0xfe, ...utf16("<svg onload='x'>")])],
      ["V6 ff ff 10 ff", Uint8Array.from([0xff, 0xff, 0x10, 0xff])],
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
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const lateSvg = withBytes(png, 600);
    lateSvg.set(ascii("<svg onload=x>", 14), 300);
    const lateUtf16 = withBytes(png, 600);
    lateUtf16.set(utf16("<script>"), 200);
    const id3Html = new Uint8Array(64);
    id3Html.set(id3(4, 0, 0, 0, 0, 0, 0));
    id3Html.set(ascii("<html><script>alert(1)</script>"), 12);
    for (const bytes of [gifSvg, pngHtml, jpegXml, gifDoctype, lateSvg, lateUtf16, id3Html]) {
      expect(defaultSniff(bytes)).toBeUndefined();
    }
    // An XMP packet's XML prolog far into a real photo is not a polyglot.
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
    const position = {
      shard: "2026/05",
      shardUrl: "https://pod.example/media/2026/05/",
      page: "https://pod.example/x?page=2",
      offset: 7,
    };
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
      enc([1, "2026/05", null, 0]),
      enc([2, "2026/05", "u", null]),
      enc([2, "bad", "u", null, 0]),
      enc([2, "2026/05", 5, null, 0]),
      enc([2, "2026/05", "u", 5, 0]),
      enc([2, "2026/05", "u", null, 1.5]),
      enc([2, "2026/05", "u", null, -1]),
      enc([2, "2026/05", "u", null, 2_000_000]),
      enc([2, "2026/05", "u", null, "0"]),
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

  it("loadSource enforces the cap before reading, keeps the original body and reads only a head", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fromBytes = await loadSource(bytes, 5, 2);
    expect(fromBytes.body).toBe(bytes);
    expect(fromBytes.size).toBe(5);
    expect([...fromBytes.head]).toEqual([1, 2]);
    const blob = new Blob([bytes]);
    const sliced = vi.spyOn(blob, "slice");
    const arrayBuffer = vi.spyOn(blob, "arrayBuffer");
    const fromBlob = await loadSource(blob, 5, 2);
    expect(fromBlob.body).toBe(blob);
    expect(fromBlob.size).toBe(5);
    expect([...fromBlob.head]).toEqual([1, 2]);
    expect(sliced).toHaveBeenCalledWith(0, 2);
    expect(arrayBuffer).not.toHaveBeenCalled();
    await expect(loadSource(new Uint8Array(4), 3, 2)).rejects.toMatchObject({
      error: { kind: "too-large" },
    });
    const big = new Blob(["abcd"]);
    const bigRead = vi.spyOn(big, "arrayBuffer");
    await expect(loadSource(big, 3, 2)).rejects.toMatchObject({
      error: { kind: "too-large" },
    });
    expect(bigRead).not.toHaveBeenCalled();
    await expect(loadSource("abc" as never, 3, 2)).rejects.toMatchObject({
      error: { reason: "invalid-input" },
    });
  });

  it("sha256Source hashes a Uint8Array or a whole Blob identically", async () => {
    const bytes = new TextEncoder().encode("abc");
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await sha256Source(await loadSource(bytes, 3, 1))).toBe(expected);
    expect(await sha256Source(await loadSource(new Blob(["abc"]), 3, 1))).toBe(expected);
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
