// AUTHORED-BY Claude Sonnet 5.5

import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { vi } from "vitest";
import type { ObjectUrlApi } from "../src/loader.js";

export const ROOT = "https://pod.example/";
export const MEDIA = `${ROOT}media/`;

export type Part = Uint8Array | readonly number[] | string;

export function concat(...parts: Part[]): Uint8Array {
  const arrays = parts.map((part) =>
    typeof part === "string"
      ? Uint8Array.from(part, (ch) => ch.charCodeAt(0) & 0xff)
      : Uint8Array.from(part),
  );
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const array of arrays) {
    out.set(array, at);
    at += array.length;
  }
  return out;
}

export const u32 = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];
export const u32le = (n: number): number[] => u32(n).reverse();
export const u16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
export const u16le = (n: number): number[] => u16(n).reverse();

// ---- well-formed samples of every default format ----

export const png = (w = 1, h = 1): Uint8Array =>
  concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32(13),
    "IHDR",
    u32(w),
    u32(h),
    [8, 2, 0, 0, 0],
    u32(0),
    u32(0),
    "IEND",
    u32(0),
  );

export const jpeg = (w = 1, h = 1): Uint8Array =>
  concat(
    [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10],
    "JFIF\0",
    [1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc0, 0x00, 0x11, 8],
    u16(h),
    u16(w),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0],
    [0xff, 0xd9],
  );

/** A GIF whose single frame fills a screen of the same size. */
export const gif = (w = 1, h = 1): Uint8Array => gifFrames([w, h], [[w, h]]);

/** A GIF with the given logical screen and one image descriptor per [width, height] frame. */
export const gifFrames = (
  screen: readonly [number, number],
  frames: readonly (readonly [number, number])[],
  options: { globalTable?: boolean; localTable?: boolean; extension?: boolean } = {},
): Uint8Array =>
  concat(
    "GIF89a",
    u16le(screen[0]),
    u16le(screen[1]),
    [options.globalTable ? 0x80 : 0, 0, 0],
    options.globalTable ? new Uint8Array(6) : [],
    ...frames.map(([w, h]) =>
      concat(
        options.extension ? [0x21, 0xf9, 4, 0, 0, 0, 0, 0] : [],
        [0x2c, 0, 0, 0, 0],
        u16le(w),
        u16le(h),
        [options.localTable ? 0x80 : 0],
        options.localTable ? new Uint8Array(6) : [],
        [2, 2, 0x44, 0x01, 0],
      ),
    ),
    [0x3b],
  );

const riff = (form: string, chunk: Uint8Array): Uint8Array =>
  concat("RIFF", u32le(4 + chunk.length), form, chunk);

export const webpLossy = (w = 1, h = 1): Uint8Array =>
  riff("WEBP", concat("VP8 ", u32le(10), [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(w), u16le(h)));
export const webpLossless = (w = 1, h = 1): Uint8Array => {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff("WEBP", concat("VP8L", u32le(5), [0x2f], u32le(bits >>> 0)));
};
export const webpExtended = (w = 1, h = 1): Uint8Array =>
  riff(
    "WEBP",
    concat("VP8X", u32le(10), [0, 0, 0, 0], u32le(w - 1).slice(0, 3), u32le(h - 1).slice(0, 3)),
  );

export const box = (type: string, ...payload: Part[]): Uint8Array => {
  const body = concat(...payload);
  return concat(u32(8 + body.length), type, body);
};
export const ftyp = (major: string, ...compat: string[]): Uint8Array =>
  box("ftyp", major, u32(0), ...compat);

export const avif = (w = 1, h = 1): Uint8Array =>
  concat(
    ftyp("avif", "avif", "mif1"),
    box("meta", u32(0), box("iprp", box("ipco", box("ispe", u32(0), u32(w), u32(h))))),
    box("mdat", [1, 2, 3, 4]),
  );
export const heic = (w = 1, h = 1): Uint8Array =>
  concat(
    ftyp("heic", "mif1"),
    box("meta", u32(0), box("iprp", box("ipco", box("ispe", u32(0), u32(w), u32(h))))),
  );

/** An AVIF image sequence: a tkhd of the given size (version 0 or 1) and, optionally, a decoy ispe. */
export const avis = (
  w: number,
  h: number,
  options: { version?: 0 | 1; ispe?: readonly [number, number] } = {},
): Uint8Array => {
  const prefix = options.version === 1 ? 88 : 76;
  const tkhd = box(
    "tkhd",
    [options.version ?? 0],
    new Uint8Array(prefix - 1),
    u32(w * 65536),
    u32(h * 65536),
    new Uint8Array(4),
  );
  const meta = options.ispe
    ? box(
        "meta",
        u32(0),
        box("iprp", box("ipco", box("ispe", u32(0), u32(options.ispe[0]), u32(options.ispe[1])))),
      )
    : new Uint8Array(0);
  return concat(ftyp("avis", "avis", "msf1"), meta, box("moov", box("trak", tkhd)));
};
export const mp4 = (): Uint8Array => concat(ftyp("isom", "isom", "mp42"), box("mdat", [0, 0]));
export const m4a = (): Uint8Array => concat(ftyp("M4A ", "M4A ", "mp42"), box("mdat", [0, 0]));
export const mov = (): Uint8Array => concat(ftyp("qt  ", "qt  "), box("mdat", [0, 0]));

export const webm = (): Uint8Array =>
  concat(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01],
    [0x42, 0x82, 0x84],
    "webm",
    [0x18, 0x53, 0x80, 0x67, 0x80],
  );
export const matroska = (): Uint8Array =>
  concat([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01], [0x42, 0x82, 0x88], "matroska");

export const wav = (): Uint8Array => riff("WAVE", concat("fmt ", u32le(16), new Uint8Array(16)));
export const flac = (): Uint8Array => concat("fLaC", [0, 0, 0, 0x22], new Uint8Array(34));
export const glb = (): Uint8Array => {
  const json = concat("{}  ");
  return concat("glTF", u32le(2), u32le(12 + 8 + json.length), u32le(json.length), "JSON", json);
};
export const oggVorbis = (): Uint8Array =>
  concat("OggS", new Uint8Array(23), [1, 30], [1], "vorbis", new Uint8Array(24));
export const oggOpus = (): Uint8Array =>
  concat("OggS", new Uint8Array(23), [1, 19], "OpusHead", new Uint8Array(11));
export const oggTheora = (): Uint8Array =>
  concat("OggS", new Uint8Array(23), [1, 30], [0x80], "theora", new Uint8Array(24));
export const id3 = (): Uint8Array =>
  concat("ID3", [4, 0, 0, 0, 0, 0, 10], new Uint8Array(10), [0xff, 0xfb, 0x90, 0x00]);

/** A valid MPEG-1 Layer III 128 kbps 44.1 kHz frame (417 bytes) repeated `n` times. */
export const mp3Frames = (n = 2): Uint8Array => {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return concat(...Array.from({ length: n }, () => frame));
};

export const svg = (): Uint8Array =>
  concat('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const html = (): Uint8Array => concat("<!DOCTYPE html><html><body>hi</body></html>");

export function utf16(text: string, bigEndian = false): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2 + (bigEndian ? 1 : 0)] = text.charCodeAt(i);
  }
  return out;
}

// ---- object URL fake ----

export function fakeUrls() {
  let n = 0;
  const created = new Map<string, Blob>();
  const revoked: string[] = [];
  const api: ObjectUrlApi = {
    createObjectURL(blob) {
      n++;
      const url = `blob:https://app.example/${n}`;
      created.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  return {
    api,
    created,
    revoked,
    live: () => [...created.keys()].filter((url) => !revoked.includes(url)),
    blobOf: (url: string): Blob => created.get(url) as Blob,
  };
}

// ---- streams and fakes ----

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function streamOf(bytes: Uint8Array, chunkSize = 64): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + chunkSize));
      at += chunkSize;
    },
  });
}

/** A stream the test feeds by hand; `cancelled` records that the reader gave up. */
export function gatedStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    body,
    state,
    push: (chunk: Uint8Array) => controller.enqueue(chunk),
    end: () => controller.close(),
    fail: (error: unknown) => controller.error(error),
  };
}

export interface FakeRead {
  status?: number;
  etag?: string | null;
  contentType?: string | null;
  body?: ReadableStream<Uint8Array> | null;
  /** The declared Content-Length; omitted by default (absent). */
  contentLength?: number | null | string;
}

export interface ReadCall {
  url: string;
  opts: { signal?: AbortSignal; ifNoneMatch?: string } | undefined;
}

/** A StorageClient whose `read` is scripted; `reads` records every request it receives. */
export function fakeStorage(
  read: (url: string, opts: ReadCall["opts"], call: number) => Promise<FakeRead> | FakeRead,
  within: (url: string) => boolean = (url) => url.startsWith(ROOT),
) {
  const reads: ReadCall[] = [];
  const storage = {
    protocol: "solid",
    root: ROOT,
    isWithinStorage: (url: string) => within(url),
    read: vi.fn(async (url: string, opts?: ReadCall["opts"]) => {
      reads.push({ url, opts });
      const result = await read(url, opts, reads.length);
      return {
        url,
        status: result.status ?? 200,
        etag: result.etag === undefined ? '"v1"' : result.etag,
        // Always a lie: the loader must never use it.
        contentType: result.contentType === undefined ? "text/html" : result.contentType,
        body: result.body === undefined ? null : result.body,
        ...(result.contentLength === undefined ? {} : { contentLength: result.contentLength }),
      };
    }),
  };
  return { storage: storage as unknown as StorageClient, reads, spy: storage.read };
}

export const served = (bytes: Uint8Array, extra: FakeRead = {}): FakeRead => ({
  body: streamOf(bytes),
  ...extra,
});

// ---- memory pod ----

export async function memoryPod() {
  const storage = createMemoryStorage({ root: ROOT });
  await storage.create(ROOT, null, { kind: "container", name: "media" });
  const put = async (name: string, bytes: Uint8Array, contentType = "image/png") => {
    const created = await storage.create(MEDIA, bytes, { name, contentType });
    return created;
  };
  return { storage, put };
}

export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** `bytes` followed by zero padding up to exactly `length` bytes (still sniffs as the same type). */
export function padded(bytes: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(Math.max(length, bytes.length));
  out.set(bytes);
  return out;
}

/** A stream of `bytes` in `chunkSize` pieces that calls `onPull(chunkIndex)` as each is requested. */
export function probedStream(
  bytes: Uint8Array,
  chunkSize: number,
  onPull: (index: number) => void,
): ReadableStream<Uint8Array> {
  let at = 0;
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        onPull(index++);
        if (at >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(at, at + chunkSize));
        at += chunkSize;
      },
    },
    { highWaterMark: 0 },
  );
}
