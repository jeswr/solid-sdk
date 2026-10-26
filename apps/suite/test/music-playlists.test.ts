// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import type { PlaylistEntry } from "../src/apps/music/lib/queue";
import {
  MusicQueueError,
  parseM3u,
  parseM3u8,
  parsePls,
  serialiseM3u,
  serialiseM3u8,
  serialisePls,
} from "../src/apps/music/lib/queue";

const base = "https://example.org/music/lists/fictional.m3u";
const playlist: PlaylistEntry[] = [
  {
    url: "https://example.org/music/audio/dawn.mp3",
    title: "Mira Vale — Fictional dawn, part I",
    durationSeconds: 125,
  },
  { url: "http://example.org/live?channel=fictional", title: "", durationSeconds: null },
  { url: "https://example.org/silence.ogg#t=0", title: "Silence", durationSeconds: 0 },
];
function rejects(run: () => unknown, code?: string) {
  expect(run).toThrow(MusicQueueError);
  if (code) expect(run).toThrow(expect.objectContaining({ code }));
}
const pls = (content: string, tail = "NumberOfEntries=1\nVersion=2") =>
  `[playlist]\n${content}\n${tail}\n`;

describe("M3U and M3U8", () => {
  it("round-trips Unicode titles, commas, zero/known/unknown durations and duplicate URLs", () => {
    const entries = [...playlist, playlist[0] as PlaylistEntry];
    const output = serialiseM3u(entries);
    expect(output).toContain("#EXTINF:125,Mira Vale — Fictional dawn, part I\n");
    expect(output).toContain("#EXTINF:-1,\nhttp://example.org/live?channel=fictional\n");
    expect(parseM3u(output, base)).toEqual(entries);
    expect(parseM3u8(serialiseM3u8(entries), base)).toEqual(entries);
    expect(serialiseM3u([])).toBe("#EXTM3U\n");
    expect(parseM3u("", base)).toEqual([]);
    expect(parseM3u("#EXTM3U\n", base)).toEqual([]);
  });
  it("resolves plain relative, absolute, root-relative, network-path, escaped and Unicode IRIs", () => {
    const refs = [
      "../audio/dawn.mp3",
      "https://example.org/other.mp3",
      "/root.mp3",
      "//example.org/radio",
      "./caf%C3%A9.mp3",
      "./été.mp3",
      "?track=1",
    ];
    const result = parseM3u(`\uFEFF# A synthetic fixture\r\n\n${refs.join("\r")}\n`, base);
    expect(result.map((entry) => entry.url)).toEqual([
      "https://example.org/music/audio/dawn.mp3",
      "https://example.org/other.mp3",
      "https://example.org/root.mp3",
      "https://example.org/radio",
      "https://example.org/music/lists/caf%C3%A9.mp3",
      "https://example.org/music/lists/%C3%A9t%C3%A9.mp3",
      "https://example.org/music/lists/fictional.m3u?track=1",
    ]);
    expect(result.every((entry) => entry.title === "" && entry.durationSeconds === null)).toBe(
      true,
    );
    expect(parseM3u("#EXTM3U\n#EXTINF:-1,\n# comment\n../audio/dawn.mp3", base)[0]).toEqual({
      ...playlist[0],
      title: "",
      durationSeconds: null,
    });
  });
  it("rejects misplaced/repeated headers, invalid/dangling metadata and unsupported extensions", () => {
    for (const input of [
      "#EXTM3U\n#EXTM3U",
      "a.mp3\n#EXTM3U",
      "#comment\n#EXTM3U",
      "#EXTINF:1,Title\na.mp3",
      "#EXTM3U\n#EXTINF:1,Title",
      "#EXTM3U\n#EXTINF:1,Title\n#EXTINF:2,Other\na.mp3",
      "#EXTM3U\n#EXTINF:1\na.mp3",
    ]) {
      rejects(() => parseM3u(input, base), "invalid-playlist");
    }
    for (const directive of [
      "#EXT-X-TARGETDURATION:4",
      "#EXTVLCOPT:option=value",
      "#EXTINF",
      "#PLAYLIST:Title",
    ]) {
      rejects(() => parseM3u(`#EXTM3U\n${directive}\na.mp3`, base), "unsupported-playlist");
    }
  });
});

describe("PLS v2", () => {
  it("round-trips all fields and empty lists with canonical one-based keys", () => {
    const output = serialisePls(playlist);
    expect(output).toContain("Length2=-1\n");
    expect(output).toContain("NumberOfEntries=3\nVersion=2\n");
    expect(parsePls(output, base)).toEqual(playlist);
    expect(serialisePls([])).toBe("[playlist]\nNumberOfEntries=0\nVersion=2\n");
    expect(parsePls(serialisePls([]), base)).toEqual([]);
  });
  it("accepts reordered fields, optional titles/lengths, BOM and CRLF without changing title whitespace", () => {
    const result = parsePls(
      "\uFEFF[playlist]\r\nVersion=2\r\nLength2=-1\r\nFile2=//example.org/live\r\nTitle1= Mira = Vale \r\nNumberOfEntries=2\r\nFile1=../audio/dawn.mp3\r\n\r\n",
      base,
    );
    expect(result).toEqual([
      { ...playlist[0], title: " Mira = Vale ", durationSeconds: null },
      { url: "https://example.org/live", title: "", durationSeconds: null },
    ]);
    expect(
      parsePls(pls("File1=../audio/dawn.mp3\nTitle1=\nLength1=0"), base)[0]?.durationSeconds,
    ).toBe(0);
  });
  it("rejects missing headers, duplicate fields, missing files, sparse/out-of-range indexes and counts", () => {
    for (const input of [
      "",
      "File1=a.mp3",
      pls("File1=a.mp3\nFile1=b.mp3"),
      pls("File1=a.mp3\nTitle1=x\nTitle1=y"),
      pls("File1=a.mp3", "NumberOfEntries=1\nNumberOfEntries=1\nVersion=2"),
      pls("Title1=No file"),
      pls("File2=a.mp3"),
      pls("File1=a.mp3\nFile3=b.mp3", "NumberOfEntries=2\nVersion=2"),
      pls("File9007199254740992=a.mp3"),
      pls("File1=a.mp3", "Version=2"),
      ...["-1", "1.0", "01", "0", "2", "9007199254740993"].map((count) =>
        pls("File1=a.mp3", `NumberOfEntries=${count}\nVersion=2`),
      ),
    ]) {
      rejects(() => parsePls(input, base), "invalid-playlist");
    }
  });
  it("rejects unsupported versions, keys, comments and sections", () => {
    for (const input of [
      pls("File1=a.mp3", "NumberOfEntries=1"),
      pls("File1=a.mp3", "NumberOfEntries=1\nVersion=1"),
      pls("File1=a.mp3\nUnknown=value"),
      pls("[other]"),
      pls("; comment"),
      pls("file1=a.mp3"),
      pls("File01=a.mp3"),
      pls("File0=a.mp3"),
      pls("File1"),
      pls("File1=a.mp3\nVersion=2"),
    ]) {
      rejects(() => parsePls(input, base));
    }
  });
});

describe("fail-closed format boundaries", () => {
  it("rejects unsupported duration syntax rather than rounding or coercing", () => {
    for (const value of [
      "",
      "1.5",
      "-2",
      "NaN",
      "Infinity",
      "+1",
      "01",
      " 1",
      "1 ",
      "1e2",
      "9007199254740992",
    ]) {
      rejects(() => parseM3u(`#EXTM3U\n#EXTINF:${value},Title\na.mp3`, base), "invalid-playlist");
      rejects(() => parsePls(pls(`File1=a.mp3\nLength1=${value}`), base), "invalid-playlist");
    }
  });
  it("rejects invalid text, controls, replacement surrogates and non-text input", () => {
    for (const input of [null, 123, "\u0000", "\t", "\ud800", "\u2028", "\u2029"]) {
      for (const parse of [parseM3u, parsePls]) {
        rejects(() => parse(input as string, base), "invalid-playlist");
      }
    }
  });
  it("rejects invalid URLs and base IRIs, local paths, credentials, controls and malformed escapes", () => {
    const invalid = [
      "",
      " ",
      "a b.mp3",
      "a\\b.mp3",
      "C:\\music\\a.mp3",
      "file:///music/a.mp3",
      "javascript:alert(1)",
      "data:audio/mpeg,AA",
      "https://",
      "https://[invalid]/a.mp3",
      "https:example.org/a.mp3",
      "https://user:password@example.org/a.mp3",
      "https://user@example.org/a.mp3",
      "https://:password@example.org/a.mp3",
      "%ZZ.mp3",
      "%0.mp3",
      "\ud800",
      "a\u0000b.mp3",
      'a"b.mp3',
    ];
    for (const url of invalid) {
      rejects(() => serialiseM3u([{ ...(playlist[0] as PlaylistEntry), url }]), "invalid-url");
      rejects(() => parsePls(pls(`File1=${url}`), base));
      if (url !== "") rejects(() => parseM3u(url, base));
    }
    for (const baseIri of [
      "../lists/a.m3u",
      "ftp://example.org/a.m3u",
      "https://",
      "https://user:secret@example.org/a.m3u",
      null,
    ]) {
      rejects(() => parseM3u("a.mp3", baseIri as string), "invalid-url");
      rejects(() => parsePls(pls("File1=a.mp3"), baseIri as string), "invalid-url");
    }
    expect(() => parseM3u("https://user:secret@example.org/a.mp3", base)).toThrow(
      "Music queue: invalid-url",
    );
  });
  it("rejects invalid serializer entries and relative URLs; preserves input", () => {
    const input = Object.freeze(playlist.map((entry) => Object.freeze({ ...entry })));
    for (const serialise of [serialiseM3u, serialisePls]) {
      expect(serialise(input)).toBeTypeOf("string");
      for (const entries of [
        new Array(1),
        null,
        {},
        [null],
        [{}],
        [{ ...playlist[0], title: 1 }],
        ...["\n", "\r", "\t", "\ud800", "\u2028", "\u2029"].map((title) => [
          { ...playlist[0], title },
        ]),
        ...[undefined, -1, 0.5, NaN, Infinity, "1", 9007199254740992].map((durationSeconds) => [
          { ...playlist[0], durationSeconds },
        ]),
      ]) {
        rejects(() => serialise(entries as readonly PlaylistEntry[]), "invalid-entry");
      }
      rejects(
        () => serialise([{ ...(playlist[0] as PlaylistEntry), url: "a.mp3" }]),
        "invalid-url",
      );
      rejects(
        () => serialise([{ ...(playlist[0] as PlaylistEntry), url: null as never }]),
        "invalid-url",
      );
    }
    expect(input).toEqual(playlist);
  });
});
