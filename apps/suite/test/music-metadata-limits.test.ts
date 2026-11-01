// AUTHORED-BY Codex GPT-6
import * as parser from "music-metadata";
import { describe, expect, it, vi } from "vitest";
import { extractAudioMetadata } from "../src/apps/music/lib/metadata";
import { id3, join, mpeg, syncsafe, text, unsynchronisedId3v23 } from "./music-metadata-fixtures";

vi.mock("music-metadata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("music-metadata")>();
  return { ...actual, parseBuffer: vi.fn(actual.parseBuffer) };
});

const limit = 64 * 1024 * 1024;

describe("ID3v2.3 normalization allocation limits", () => {
  it.each([
    "tag",
    "consecutive tags",
    "audio",
  ] as const)("rejects oversized %s input before allocating or scanning its body", async (kind) => {
    const fixture = new Uint8Array(limit + 11);
    if (kind === "tag") {
      fixture.set(join(text("ID3"), new Uint8Array([3, 0, 0x80]), syncsafe(limit + 1)));
    } else if (kind === "consecutive tags") {
      // Each encoded tag is individually below the limit; their reconstruction is not.
      const size = Math.floor(fixture.length / 2) - 10;
      const header = join(text("ID3"), new Uint8Array([3, 0, 0x80]), syncsafe(size));
      fixture.set(header);
      fixture.set(header, size + 10);
    } else {
      fixture.set(unsynchronisedId3v23());
    }
    const allocations: number[] = [];
    vi.stubGlobal(
      "Uint8Array",
      new Proxy(Uint8Array, {
        construct(target, args) {
          if (typeof args[0] === "number") {
            allocations.push(args[0]);
            // Fail fast if the regression returns, without scanning a 64 MiB body.
            throw new Error("Unexpected normalization allocation");
          }
          return Reflect.construct(target, args);
        },
      }),
    );
    try {
      await expect(extractAudioMetadata(fixture.buffer)).rejects.toBeInstanceOf(
        parser.UnexpectedFileContentError,
      );
      expect(allocations).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses one buffer at the inclusive limit and preserves mixed tags and trailing bytes", async () => {
    const tag = id3(3);
    const encoded = unsynchronisedId3v23(tag);
    const prefix = join(tag, encoded, tag, encoded, mpeg());
    const expectedPrefix = join(tag, tag, tag, tag, mpeg());
    const fixture = new Uint8Array(limit);
    fixture.set(prefix);
    fixture.set([1, 2, 3, 4], limit - 4);
    const metadata = await parser.parseBuffer(expectedPrefix);
    const parse = vi.mocked(parser.parseBuffer).mockClear().mockResolvedValueOnce(metadata);
    const allocations: number[] = [];
    vi.stubGlobal(
      "Uint8Array",
      new Proxy(Uint8Array, {
        construct(target, args) {
          if (typeof args[0] === "number") allocations.push(args[0]);
          return Reflect.construct(target, args);
        },
      }),
    );
    try {
      await expect(extractAudioMetadata(fixture.buffer)).resolves.toMatchObject({
        title: "Paper Moon",
        artist: "Mira Example",
      });
      expect(allocations.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(limit);
      const normalized = parse.mock.calls[0]?.[0] as Uint8Array;
      expect(normalized.length).toBe(limit - (prefix.length - expectedPrefix.length));
      expect(normalized.subarray(0, expectedPrefix.length)).toEqual(expectedPrefix);
      expect(Array.from(normalized.subarray(-4))).toEqual([1, 2, 3, 4]);
      expect(normalized.buffer).not.toBe(fixture.buffer);
      expect(fixture.subarray(0, prefix.length)).toEqual(prefix);
      expect(Array.from(fixture.subarray(-4))).toEqual([1, 2, 3, 4]);
    } finally {
      vi.unstubAllGlobals();
      parse.mockReset();
    }
  });

  it("does not copy large inputs that need no normalization", async () => {
    const tag = join(id3(4), mpeg());
    const fixture = new Uint8Array(limit + 1);
    fixture.set(tag);
    const metadata = await parser.parseBuffer(tag);
    const parse = vi.mocked(parser.parseBuffer).mockClear().mockResolvedValueOnce(metadata);
    try {
      await extractAudioMetadata(fixture.buffer);
      expect(parse.mock.calls[0]?.[0].buffer).toBe(fixture.buffer);
    } finally {
      parse.mockReset();
    }
  });
});
