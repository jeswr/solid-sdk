// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  currentLineAt,
  LYRICS_LIMITS,
  type Lyrics,
  LyricsError,
  parseLrc,
  serialiseLrc,
} from "../src/apps/music/lib/lyrics";

function fails(source: unknown, code: string) {
  expect(() => parseLrc(source as string)).toThrow(LyricsError);
  expect(() => parseLrc(source as string)).toThrow(expect.objectContaining({ code }));
}
const times = (lyrics: Lyrics) => lyrics.lines.map((line) => line.timeMs);

it("preserves Unicode, whitespace, empty lines and normalises BOM/newlines in plain fallback", () => {
  for (const source of [
    "",
    "\n",
    "  Moon song\n\nA fictional café 🎵\t\n",
    "[Chorus]\nWe < sing >",
  ]) {
    const lyrics = parseLrc(source);
    expect(lyrics).toEqual({ kind: "plain", text: source, lines: [], metadata: [], offsetMs: 0 });
    expect(serialiseLrc(lyrics)).toBe(source);
    expect(currentLineAt(lyrics, 0)).toBeNull();
  }
  expect(serialiseLrc(parseLrc("\uFEFFOne\r\nTwo\rThree"))).toBe("One\nTwo\nThree");
});

it("expands multiple timestamps, sorts stably, retains blank cues, metadata and exact lyric text", () => {
  const lyrics = parseLrc(
    [
      "[ar:Mira Example]",
      "[ti:Paper moons]",
      "[source:https://example.org/song]",
      "[ar:Rowan Fiction]",
      "[custom-tag:  value:with:colons  ]",
      "[constructor:opaque]",
      "[00:03.123][00:01]  Chorus 🎵  ",
      "[00:02.5]Second",
      "[00:02.50]Third",
      "[00:04.000]",
      "   ",
    ].join("\r\n"),
  );
  expect(lyrics.kind).toBe("lrc");
  expect(times(lyrics)).toEqual([1000, 2500, 2500, 3123, 4000]);
  expect(lyrics.lines.map((line) => line.text)).toEqual([
    "  Chorus 🎵  ",
    "Second",
    "Third",
    "  Chorus 🎵  ",
    "",
  ]);
  expect(lyrics.text).toBe("  Chorus 🎵  \nSecond\nThird\n  Chorus 🎵  \n");
  expect(lyrics.metadata).toEqual([
    { key: "ar", value: "Mira Example" },
    { key: "ti", value: "Paper moons" },
    { key: "source", value: "https://example.org/song" },
    { key: "ar", value: "Rowan Fiction" },
    { key: "custom-tag", value: "  value:with:colons  " },
    { key: "constructor", value: "opaque" },
  ]);
  expect(parseLrc(serialiseLrc(lyrics))).toEqual(lyrics);
  expect(serialiseLrc(parseLrc("[00:00.1]a\n[10:02.01]b\n[1440:00]c"))).toBe(
    "[00:00.100]a\n[10:02.010]b\n[1440:00.000]c",
  );
});

it("preserves metadata-only documents and normalises one document-wide offset", () => {
  expect(parseLrc("[ar:]\n[by:Mira Example]").lines).toEqual([]);
  expect(serialiseLrc(parseLrc("[ar:]\n[by:Mira Example]"))).toBe("[ar:]\n[by:Mira Example]");
  expect(currentLineAt(parseLrc("[ar:No timing]"), 10)).toBeNull();
  for (const input of ["[offset:0]", "[OFFSET:-0]", "[offset:-86400000]"]) {
    const lyrics = parseLrc(input);
    expect(parseLrc(serialiseLrc(lyrics))).toEqual(lyrics);
  }
  for (const [value, ms] of [
    ["+250", 250],
    [" -250 ", -250],
    ["000", 0],
    ["-0", -0],
    ["86400000", 86400000],
  ] as const) {
    const lyrics = parseLrc(`[00:01]A\n[OFFSET:${value}]`);
    expect(lyrics.offsetMs).toBe(ms || 0);
    // Canonical zero is semantically equivalent, including negative zero.
    expect(parseLrc(serialiseLrc(lyrics)).offsetMs === ms).toBe(true);
  }
});

it("keeps enhanced words, prefix text and terminal end markers with absolute millisecond timings", () => {
  const lyrics = parseLrc("[00:01]<00:01>Paper <00:01.250>moon<00:02>\n[00:03]  <00:03.5>Glow");
  expect(lyrics.lines[0]).toEqual({
    timeMs: 1000,
    text: "Paper moon",
    words: [
      { timeMs: 1000, text: "Paper " },
      { timeMs: 1250, text: "moon" },
      { timeMs: 2000, text: "" },
    ],
  });
  expect(lyrics.lines[1]?.words).toEqual([
    { timeMs: 3000, text: "  " },
    { timeMs: 3500, text: "Glow" },
  ]);
  expect(parseLrc(serialiseLrc(lyrics))).toEqual(lyrics);
  const repeated = parseLrc("[00:10][00:20][00:05]<00:10>Hello <00:11>moon");
  expect(times(repeated)).toEqual([5000, 10000, 20000]);
  expect(repeated.lines.map((line) => line.words.map((word) => word.timeMs))).toEqual([
    [5000, 6000],
    [10000, 11000],
    [20000, 21000],
  ]);
  expect(parseLrc(serialiseLrc(repeated))).toEqual(repeated);
  expect(parseLrc("[00:01]<00:01><00:01>Moon").lines[0]?.text).toBe("Moon");
});

it("looks up exact boundaries, gaps, duplicates, seeks and the end using the global offset", () => {
  const lyrics = parseLrc(
    "[00:01]First\n[00:02]Second\n[00:02]Translation\n[00:03]\n[offset:+250]",
  );
  for (const [position, text] of [
    [0, null],
    [749.9, null],
    [750, "First"],
    [1749.9, "First"],
    [1750, "Translation"],
    [2750, ""],
    [1e12, ""],
    [800, "First"],
  ] as const) {
    expect(currentLineAt(lyrics, position)?.text ?? null).toBe(text);
  }
  expect(currentLineAt(parseLrc("[offset:-250]\n[00:01]Late"), 1249)).toBeNull();
  expect(currentLineAt(parseLrc("[offset:-250]\n[00:01]Late"), 1250)?.text).toBe("Late");
  expect(currentLineAt(parseLrc("[offset:1000]\n[00:00]At start"), 0)?.text).toBe("At start");
});

it("agrees with a linear oracle for arbitrary timestamps and playback positions", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 59999 }), { maxLength: 80 }),
      fc.integer({ min: 0, max: 60000 }),
      (values, position) => {
        const lyrics = parseLrc(
          values
            .map(
              (ms, i) =>
                `[00:${String(Math.floor(ms / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}]Line ${i}`,
            )
            .join("\n"),
        );
        expect(currentLineAt(lyrics, position)).toBe(
          lyrics.lines.filter((line) => line.timeMs <= position).at(-1) ?? null,
        );
        expect(parseLrc(serialiseLrc(lyrics))).toEqual(lyrics);
      },
    ),
    { seed: 261026, numRuns: 150 },
  );
});

describe("fail closed", () => {
  it("rejects malformed Unicode, controls and nonstrings with content-free typed errors", () => {
    for (const source of [
      null,
      undefined,
      1,
      {},
      "\uD800",
      "\uDC00",
      "\uFEFF\uFEFFMoon",
      "a\0b",
      "a\x1bb",
      "a\u2028b",
      "a\u2029b",
    ])
      fails(source, "invalid-input");
    expect(new LyricsError("invalid-lrc").name).toBe("LyricsError");
    expect(new LyricsError("invalid-lrc").message).toBe("Lyrics: invalid-lrc");
  });
  it("rejects malformed, mixed, unsupported and ambiguous LRC instead of falling back", () => {
    for (const source of [
      "[00:01]Timed\nUntimed",
      "Untimed\n[00:01]Timed",
      " [00:01]Indented",
      "[ti:Bad]trailing",
      "[ar:Nested[bad]]",
      "[offset]",
      "[00:01]Text [00:02]More",
      "<00:01>Only words",
      "[00:01]Text [ar:Mira]",
      "[ar:Mira]\n[Chorus]",
      "[00:01]<00:02",
      "[00:01]><00:02>Moon",
      "[00:01]<00:02>Moon<oops",
      "[00:01]<00:02>Moon>tail",
      "[00:01]<00:02>Moon[aside]",
      "[00:01]<00:02>Moon<00:03",
      "[00:01]Text [offset:2]",
      "[00:01]Text > stray",
      "[00:01]Text <bad",
    ])
      fails(source, "invalid-lrc");
  });
  it("rejects malformed and out-of-range timestamps, descending words and shifted overflow", () => {
    for (const source of [
      "[00:60]Bad",
      "[00:01.1234]Bad",
      "[0:01]Bad",
      "[00:1]Bad",
      "[00:01,25]Bad",
      "[00:01",
      "[00:01:02]Bad",
      "[1440:00.001]Bad",
      "[9999:59]Bad",
      "[00:02]<00:01>Early",
      "[00:01]<00:03>First<00:02>Back",
      "[00:01]<00:xx>Bad",
      "[00:01]<bad>Ambiguous",
      "[00:00][1440:00]<00:01>Overflow",
    ])
      fails(source, "invalid-timestamp");
  });
  it("rejects invalid offsets and repeated offset declarations", () => {
    for (const value of ["", "+", "NaN", "Infinity", "1.5", "86400001", "-86400001", "1e3", "0x10"])
      fails(`[offset:${value}]`, "invalid-offset");
    fails("[offset:0]\n[offset:0]", "invalid-offset");
    fails("[offset:1]\n[OFFSET:2]", "invalid-offset");
  });
  it("bounds raw size, physical lines, line length and expanded canonical output", () => {
    const { maxCodeUnits, maxLines, maxLineCodeUnits } = LYRICS_LIMITS;
    fails("a".repeat(maxCodeUnits + 1), "limit-exceeded");
    fails("\n".repeat(maxLines), "limit-exceeded");
    fails("a".repeat(maxLineCodeUnits + 1), "limit-exceeded");
    expect(parseLrc("\n".repeat(maxLines - 1)).kind).toBe("plain");
    expect(parseLrc("a".repeat(maxLineCodeUnits)).text).toHaveLength(maxLineCodeUnits);
    const exactSize = `${"a".repeat(9999)}\n`.repeat(100);
    expect(parseLrc(exactSize).text).toHaveLength(maxCodeUnits);
    fails(`[00:01]${"a".repeat(maxLineCodeUnits - 7)}`, "limit-exceeded");
    const repeats = "[00:01]".repeat(100);
    fails(Array(101).fill(repeats).join("\n"), "limit-exceeded");
    fails(
      Array(100)
        .fill(`${repeats}${"a".repeat(1000)}`)
        .join("\n"),
      "limit-exceeded",
    );
    fails(`[00:01]${"a".repeat(maxLineCodeUnits)}`, "limit-exceeded");
    // Raw input and expanded cues separately fit; together with metadata they overflow.
    fails(
      `${Array(80)
        .fill(`[ar:${"a".repeat(10000)}]`)
        .join("\n")}\n${"[00:01]".repeat(50)}${"a".repeat(5000)}`,
      "limit-exceeded",
    );
  });
  it("freezes every parsed structure and refuses foreign, cloned or mutated documents", () => {
    const lyrics = parseLrc("[ar:Mira]\n[00:01]<00:01>Moon");
    for (const item of [
      lyrics,
      lyrics.lines,
      lyrics.metadata,
      lyrics.metadata[0],
      lyrics.lines[0],
      lyrics.lines[0]?.words,
      lyrics.lines[0]?.words[0],
    ])
      expect(Object.isFrozen(item)).toBe(true);
    expect(() => {
      (lyrics.lines as unknown[]).push({});
    }).toThrow(TypeError);
    for (const document of [null, {}, { ...lyrics }, structuredClone(lyrics)]) {
      expect(() => serialiseLrc(document as Lyrics)).toThrow(
        expect.objectContaining({ code: "invalid-document" }),
      );
      expect(() => currentLineAt(document as Lyrics, 0)).toThrow(
        expect.objectContaining({ code: "invalid-document" }),
      );
    }
    for (const position of [NaN, Infinity, -Infinity, -1, "1", null])
      expect(() => currentLineAt(lyrics, position as number)).toThrow(
        expect.objectContaining({ code: "invalid-position" }),
      );
  });
});
