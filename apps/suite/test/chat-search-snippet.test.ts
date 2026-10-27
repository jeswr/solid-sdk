// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  MAX_SNIPPET_LENGTH,
  type SearchSnippet,
  searchMessages,
} from "../src/apps/chat/lib/search";

function snippet(query: string, text: string): SearchSnippet {
  const result = searchMessages(
    query,
    [
      {
        id: "one",
        roomId: "garden",
        authorName: "Mira Vale",
        authorWebId: "https://example.org/mira#me",
        text,
        createdAt: 0,
        hasAttachment: true,
        inReplyTo: null,
      },
    ],
    "UTC",
  )[0];
  expect(result).toBeDefined();
  return (result as NonNullable<typeof result>).snippet;
}

function check(result: SearchSnippet): void {
  expect(result.text.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
  expect(result.text.isWellFormed()).toBe(true);
  for (const [start, end] of result.ranges) {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual(result.text.length);
    expect(end).toBeGreaterThan(start);
    expect(result.text.slice(start, end).isWellFormed()).toBe(true);
    expect(result.text.slice(0, start).isWellFormed()).toBe(true);
    expect(result.text.slice(end).isWellFormed()).toBe(true);
  }
}

describe("highlight snippets", () => {
  it("maps folded matches back to exact source offsets and excludes negative/filter terms", () => {
    expect(snippet("cafe ffi -rain from:mira", "🌿 Cafe\u0301 and ﬃle")).toEqual({
      text: "🌿 Cafe\u0301 and ﬃle",
      ranges: [
        [3, 8],
        [13, 14],
      ],
    });
    expect(snippet("f", "ﬃ\u0301le")).toEqual({ text: "ﬃ\u0301le", ranges: [[0, 2]] });
    expect(snippet("cafe", "\u0301Café")).toEqual({ text: "\u0301Café", ranges: [[1, 5]] });
    expect(snippet('"blue gate"', "the BLUE GATE!")).toEqual({
      text: "the BLUE GATE!",
      ranges: [[4, 13]],
    });
    expect(snippet("𐐀", "🌿 𐐨abc")).toEqual({ text: "🌿 𐐨abc", ranges: [[3, 5]] });
  });

  it("sorts and merges overlapping, adjacent and repeated match ranges", () => {
    expect(snippet('gate gard garden "garden gate"', "Garden gate, garden gates").ranges).toEqual([
      [0, 11],
      [13, 19],
      [20, 24],
    ]);
    expect(snippet('"a a"', "a a a").ranges).toEqual([[0, 5]]);
    expect(snippet("🌿 🌱", "🌿🌱").ranges).toEqual([[0, 4]]);
    expect(snippet("cafe", "cafe cafe").ranges).toEqual([
      [0, 4],
      [5, 9],
    ]);
  });

  it("accepts the exact snippet bound and truncates bound + 1 including the ellipsis", () => {
    expect(snippet("has:attachment", "x".repeat(MAX_SNIPPET_LENGTH))).toEqual({
      text: "x".repeat(MAX_SNIPPET_LENGTH),
      ranges: [],
    });
    expect(snippet("has:attachment", "x".repeat(MAX_SNIPPET_LENGTH + 1))).toEqual({
      text: `${"x".repeat(MAX_SNIPPET_LENGTH - 1)}…`,
      ranges: [],
    });
    expect(snippet("has:attachment", "")).toEqual({ text: "", ranges: [] });
  });

  it("centres the first source match, adds both ellipses, and omits out-of-window matches", () => {
    const result = snippet("cafe", `${"x ".repeat(150)}café ${"y ".repeat(200)}cafe`);
    check(result);
    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
    expect(result.ranges).toEqual([[41, 45]]);
    expect(result.text.slice(41, 45)).toBe("café");
    const atEnd = snippet("cafe", `${"x ".repeat(150)}café`);
    expect(atEnd.text.startsWith("…")).toBe(true);
    expect(atEnd.text.endsWith("café")).toBe(true);
    check(atEnd);
  });

  it("clips long highlights to the visible window", () => {
    const text = "x".repeat(300);
    expect(snippet(`"${text}"`, text)).toEqual({ text: `${"x".repeat(159)}…`, ranges: [[0, 159]] });
  });

  it("never cuts a surrogate pair at either end or in a clipped highlight", () => {
    for (const padding of [118, 119, 120, 158, 159, 160, 161, 200]) {
      const text = `${"x".repeat(padding)}🌿 ${"z ".repeat(40)}café ${"🌱".repeat(200)}`;
      check(snippet("cafe", text));
      check(snippet("has:attachment", text));
    }
    const startSplit = snippet(
      "cafe",
      `${"x".repeat(118)}🌿${" ".repeat(39)}cafe ${"x".repeat(200)}`,
    );
    expect(startSplit.text.startsWith("…🌿")).toBe(true);
    check(startSplit);
    const endSplit = snippet("has:attachment", `${"x".repeat(158)}🌿xx`);
    expect(endSplit.text).toBe(`${"x".repeat(158)}…`);
    check(endSplit);
    check(snippet('"🌿"', "🌿".repeat(100)));
  });
});
