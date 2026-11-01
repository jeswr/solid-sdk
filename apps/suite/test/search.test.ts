// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  createSnippet,
  type SearchDocument,
  SearchIndex,
  SearchIndexError,
  type SearchIndexErrorCode,
  type SearchToken,
  tokenize,
} from "../src/lib/search";

const doc = (id: string, title = "", body = ""): SearchDocument => ({ id, title, body });
const ids = (index: SearchIndex, query: string) =>
  index.search(query).map((hit) => hit.document.id);
function rejects(action: () => unknown, code: SearchIndexErrorCode = "invalid-input") {
  expect(action).toThrow(SearchIndexError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ name: "SearchIndexError", code });
  }
}

describe("Unicode tokenizer", () => {
  it("segments words and retains source UTF-16 offsets", () => {
    const text = "😀 CAFÉ, cafe\u0301! １２３ — ﬁle";
    expect(tokenize(text)).toEqual([
      { term: "cafe", start: 3, end: 7 },
      { term: "cafe", start: 9, end: 14 },
      { term: "123", start: 16, end: 19 },
      { term: "file", start: 22, end: 25 },
    ]);
    expect(tokenize(" \n😀—")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });

  it.each([
    ["Straße STRASSE ẞ", ["strasse", "strasse", "ss"]],
    ["ΟΣ ος οσ", ["οσ", "οσ", "οσ"]],
    ["I İ i ı", ["i", "i", "i", "ı"]],
    ["Ꭰ ꭰ", ["Ꭰ", "Ꭰ"]],
    ["Ᏸ ᏸ", ["Ᏸ", "Ᏸ"]],
    ["ᾀ αι", ["αι", "αι"]],
    ["ſ s ᲀ в", ["s", "s", "в", "в"]],
  ])("folds %s", (text, expected) => {
    expect(tokenize(text).map(({ term }) => term)).toEqual(expected);
  });

  it.each<[string, SearchToken[]]>([
    [
      "ﷺ",
      [
        { term: "صلى", start: 0, end: 1 },
        { term: "الله", start: 0, end: 1 },
        { term: "عليه", start: 0, end: 1 },
        { term: "وسلم", start: 0, end: 1 },
      ],
    ],
    ["㎏", [{ term: "kg", start: 0, end: 1 }]],
    ["½", [{ term: "1⁄2", start: 0, end: 1 }]],
    [
      "a℀b",
      [
        { term: "aa", start: 0, end: 2 },
        { term: "cb", start: 1, end: 3 },
      ],
    ],
    ["\u0345", [{ term: "ι", start: 0, end: 1 }]],
    ["\u037a", [{ term: "ι", start: 0, end: 1 }]],
    ["\u0301", []],
    [
      "สำหรับ",
      [
        { term: "สา", start: 0, end: 2 },
        { term: "ห", start: 2, end: 3 },
        { term: "รบ", start: 3, end: 6 },
      ],
    ],
    ["がっこう", [{ term: "かっこう", start: 0, end: 4 }]],
    ["か\u3099っこう", [{ term: "かっこう", start: 0, end: 5 }]],
    [
      "\u0301😀½ a\u0301\u0327 𐐀",
      [
        { term: "1⁄2", start: 3, end: 4 },
        { term: "a", start: 5, end: 8 },
        { term: "𐐨", start: 9, end: 11 },
      ],
    ],
  ])("segments normalized %s and maps expansions to source graphemes", (text, expected) => {
    expect(tokenize(text)).toEqual(expected);
  });

  it("segments scripts without spaces, Cyrillic and supplementary letters", () => {
    expect(tokenize("你好世界").map(({ term }) => term)).toEqual(["你好", "世界"]);
    expect(tokenize("ПРИВЕТ 𐐀").map(({ term }) => term)).toEqual(["привет", "𐐨"]);
  });

  it.each([
    null,
    42,
    {},
    "\ud800",
    "\udc00",
    "hello\ud800world",
  ])("rejects invalid text %#", (value) => rejects(() => tokenize(value as string)));

  it("fails closed without Intl.Segmenter, including restoration", () => {
    const saved = Intl.Segmenter;
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    try {
      rejects(() => tokenize("hello"), "unsupported-runtime");
      rejects(
        () => SearchIndex.restore(JSON.stringify({ version: 1, documents: [doc("a")] })),
        "invalid-snapshot",
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(Intl.Segmenter).toBe(saved);
  });
});

describe("index lifecycle and query matching", () => {
  it.each([
    ["Use ½ cup milk", "Use 1⁄2 cup milk"],
    ["สำหรับ", "สาหรบ"],
    ["がっこう", "かっこう"],
    ["ﷺ", "صلى الله عليه وسلم"],
    ["㎏", "kg"],
    ["a℀b", "aa/cb"],
  ])("indexes and queries equivalent normalized text: %s", (original, normalized) => {
    const index = new SearchIndex();
    index.add(doc("original", "", original));
    index.add(doc("normalized", "", normalized));
    expect(ids(index, original)).toEqual(["normalized", "original"]);
    expect(index.search(normalized)).toEqual(index.search(original));
    const restored = SearchIndex.restore(index.serialize());
    expect(restored.search(normalized)).toEqual(index.search(original));
    index.update(doc("original", original));
    expect(ids(index, normalized)).toEqual(["original", "normalized"]);
  });

  it("handles empty indexes, empty fields and queries with no words", () => {
    const index = new SearchIndex();
    expect(index.size).toBe(0);
    expect(index.search("word")).toEqual([]);
    index.add(doc("https://example.org/empty"));
    expect(index.size).toBe(1);
    for (const query of ["", "   ", "! 😀", "absent"]) expect(index.search(query)).toEqual([]);
    expect(index.remove("https://example.org/empty")).toBe(true);
    expect(index.size).toBe(0);
  });

  it("matches all terms across fields and expands only the final query term", () => {
    const index = new SearchIndex();
    index.add(doc("a", "Café plans", "fictional Rowan's budget"));
    index.add(doc("b", "Cafeteria plans", "budgeted"));
    index.add(doc("c", "Café", "another subject"));
    expect(ids(index, "CAFE bud")).toEqual(["a"]);
    expect(ids(index, "cafe")).toEqual(["b", "c", "a"]);
    expect(ids(index, "caf budget")).toEqual([]);
    expect(ids(index, "budget caf")).toEqual(["a"]);
    expect(ids(index, "missing café")).toEqual([]);
    expect(ids(index, "cafe absent")).toEqual([]);
    expect(ids(index, "cafe bud ")).toEqual(["a"]);
  });

  it("uses the final original term after deduplication and treats queries as plain text", () => {
    const index = new SearchIndex();
    index.add(doc("a", "cat", "catalog"));
    index.add(doc("b", "catch", "catalog"));
    expect(ids(index, "ca cat ca")).toEqual(["a"]);
    expect(index.search("cat cat")).toEqual(index.search("cat"));
    expect(index.search('"cat"')).toEqual(index.search("cat"));
  });

  it("updates and removes postings/statistics without ghosts", () => {
    const index = new SearchIndex();
    index.add(doc("a", "shared old", "old"));
    index.add(doc("b", "shared"));
    index.update(doc("a", "new", "new"));
    expect(ids(index, "old")).toEqual([]);
    expect(ids(index, "shared")).toEqual(["b"]);
    expect(index.remove("a")).toBe(true);
    expect(index.remove("a")).toBe(false);
    const fresh = new SearchIndex();
    fresh.add(doc("b", "shared"));
    expect(index.search("shared")).toEqual(fresh.search("shared"));
    expect(index.remove("b")).toBe(true);
    index.add(doc("a", "old"));
    expect(ids(index, "old")).toEqual(["a"]);
  });

  it("rejects duplicate adds/missing updates atomically", () => {
    const index = new SearchIndex();
    index.add(doc("a", "original"));
    const before = index.serialize();
    rejects(() => index.add(doc("a", "changed")), "duplicate-id");
    rejects(() => index.update(doc("missing", "changed")), "not-found");
    expect(index.serialize()).toBe(before);
  });

  it.each([
    null,
    [],
    new Date(),
    { id: "a", title: "hi" },
    { ...doc("a"), extra: true },
    { ...doc("a"), [Symbol("extra")]: true },
    { id: "a", title: "", other: "" },
    Object.defineProperty(doc("a"), "title", { enumerable: false }),
    Object.defineProperty(doc("a"), "body", {
      get() {
        throw new Error("Must not evaluate accessor");
      },
    }),
    doc(""),
    doc("\ud800"),
    { ...doc("a"), title: 3 },
    { ...doc("a"), body: null },
    doc("a", "\ud800"),
    doc("a", "fine", "\udc00"),
  ])("rejects malformed documents without altering existing data %#", (value) => {
    const index = new SearchIndex();
    index.add(doc("a", "original"));
    const before = index.serialize();
    rejects(() => index.add(value as SearchDocument));
    rejects(() => index.update(value as SearchDocument));
    expect(index.serialize()).toBe(before);
  });

  it("accepts null-prototype records and opaque prototype-like ids", () => {
    const index = new SearchIndex();
    index.add(Object.assign(Object.create(null), doc("__proto__", "safe")));
    index.add(doc("constructor", "safe"));
    expect(ids(index, "safe")).toEqual(["__proto__", "constructor"]);
    expect(index.remove("__proto__")).toBe(true);
  });

  it("validates queries and removal ids", () => {
    const index = new SearchIndex();
    for (const id of ["", "\ud800", 3]) rejects(() => index.remove(id as string));
    rejects(() => index.search(null as unknown as string));
  });

  it("isolates instances, inputs, search outputs and snippet output", () => {
    const index = new SearchIndex();
    const input = doc("a", "title", "body");
    index.add(input);
    input.body = "changed";
    const hit = index.search("body")[0];
    expect(hit).toBeDefined();
    if (!hit) throw new Error("Expected a hit");
    hit.document.body = "mutated";
    hit.snippet.highlights.splice(0);
    expect(index.search("body")[0]?.document.body).toBe("body");
    expect(index.search("body")[0]?.snippet.highlights).toHaveLength(1);
    expect(new SearchIndex().search("body")).toEqual([]);
  });
});

describe("BM25", () => {
  it("computes weighted term frequency and length normalization numerically", () => {
    const index = new SearchIndex();
    index.add(doc("title", "comet", "other"));
    index.add(doc("body", "other", "comet"));
    const hits = index.search("comet");
    const idf = Math.log1p(0.5 / 2.5);
    expect(hits.map((hit) => hit.document.id)).toEqual(["title", "body"]);
    expect(hits[0]?.score).toBeCloseTo((idf * 3 * 2.2) / (3 + 1.2), 12);
    expect(hits[1]?.score).toBeCloseTo(idf, 12);
  });

  it("rewards frequency with saturation and penalizes longer documents", () => {
    const index = new SearchIndex();
    index.add(doc("once", "", "comet stone stone stone"));
    index.add(doc("twice", "", "comet comet stone stone"));
    index.add(doc("thrice", "", "comet comet comet stone"));
    const scores = new Map(index.search("comet").map((hit) => [hit.document.id, hit.score]));
    const once = scores.get("once") as number;
    const twice = scores.get("twice") as number;
    const thrice = scores.get("thrice") as number;
    expect(twice).toBeGreaterThan(once);
    expect(thrice - twice).toBeLessThan(twice - once);
    index.add(doc("short", "", "comet"));
    expect(ids(index, "comet").indexOf("short")).toBeLessThan(ids(index, "comet").indexOf("once"));
  });

  it("uses union df and combined tf for prefix expansions", () => {
    const index = new SearchIndex();
    index.add(doc("a", "", "cat catalog"));
    index.add(doc("b", "", "catch other"));
    const hits = index.search("cat");
    const idf = Math.log1p(0.5 / 2.5);
    expect(hits[0]?.score).toBeCloseTo((idf * 2 * 2.2) / 3.2, 12);
    expect(hits[1]?.score).toBeCloseTo(idf, 12);
  });

  it("sums term contributions using per-term document frequency", () => {
    const index = new SearchIndex();
    index.add(doc("a", "", "rare common"));
    index.add(doc("b", "", "other common"));
    index.add(doc("c", "", "other words"));
    expect(index.search("rare common")[0]?.score).toBeCloseTo(
      Math.log1p(2.5 / 1.5) + Math.log1p(1.5 / 2.5),
      12,
    );
  });

  it("breaks score ties by id independently of insertion order", () => {
    const index = new SearchIndex();
    for (const id of ["z", "a", "m"]) index.add(doc(id, "comet"));
    expect(ids(index, "comet")).toEqual(["a", "m", "z"]);
    expect(index.search("comet").every((hit) => Number.isFinite(hit.score) && hit.score > 0)).toBe(
      true,
    );
  });
});

describe("JSON snapshots", () => {
  it("round-trips documents and ranking and remains mutable", () => {
    const index = new SearchIndex();
    index.add(doc("https://example.org/rowan", "Café", "fictional Rowan visits a café"));
    index.add(doc("__proto__", "Cafeteria", "menu"));
    const json = index.serialize();
    expect(JSON.parse(json)).toEqual({
      version: 1,
      documents: [
        doc("https://example.org/rowan", "Café", "fictional Rowan visits a café"),
        doc("__proto__", "Cafeteria", "menu"),
      ],
    });
    const restored = SearchIndex.restore(json);
    expect(restored.search("caf")).toEqual(index.search("caf"));
    restored.update(doc("__proto__", "New title"));
    restored.remove("https://example.org/rowan");
    expect(restored.size).toBe(1);
    expect(index.size).toBe(2);
    expect(SearchIndex.restore(new SearchIndex().serialize()).size).toBe(0);
  });

  it.each([
    "not JSON",
    "null",
    "[]",
    "{}",
    '{"version":2,"documents":[]}',
    '{"version":1,"documents":{}}',
    '{"version":1,"documents":[],"extra":1}',
    '{"version":1,"documents":[{}]}',
    JSON.stringify({ version: 1, documents: [doc("a"), doc("a")] }),
    JSON.stringify({ version: 1, documents: [doc("a", "\ud800")] }),
    '{"version":1,"documents":[],"__proto__":{}}',
    42,
    null,
    "\ud800",
  ])("rejects corrupt, ambiguous or unsupported snapshots %#", (json) => {
    rejects(() => SearchIndex.restore(json as string), "invalid-snapshot");
  });

  it("matches rebuilding from source after arbitrary add/update/remove sequences", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom("add", "update", "remove"),
            fc.constantFrom("a", "b", "__proto__"),
            fc.constantFrom("comet", "comet comet", "café", "", "你好"),
          ),
          { maxLength: 30 },
        ),
        (operations) => {
          const model = new Map<string, SearchDocument>();
          const index = new SearchIndex();
          for (const [operation, id, body] of operations) {
            if (operation === "remove") {
              index.remove(id);
              model.delete(id);
            } else if (operation === "add" && !model.has(id)) {
              index.add(doc(id, "title", body));
              model.set(id, doc(id, "title", body));
            } else if (operation === "update" && model.has(id)) {
              index.update(doc(id, "title", body));
              model.set(id, doc(id, "title", body));
            }
          }
          const rebuilt = new SearchIndex();
          for (const document of model.values()) rebuilt.add(document);
          const restored = SearchIndex.restore(index.serialize());
          for (const query of ["co", "title cafe", "你好", "title"]) {
            expect(index.search(query)).toEqual(rebuilt.search(query));
            expect(restored.search(query)).toEqual(rebuilt.search(query));
          }
        },
      ),
      { seed: 871, numRuns: 50 },
    );
  });
});

describe("snippets", () => {
  it.each([
    ["😀 Use ½ cup milk", "1⁄2", [{ start: 7, end: 8 }], ["½"]],
    [
      "😀 สำหรับ",
      "สาหรบ",
      [
        { start: 3, end: 5 },
        { start: 5, end: 6 },
        { start: 6, end: 9 },
      ],
      ["สำ", "ห", "รับ"],
    ],
    ["😀 がっこう", "かっこう", [{ start: 3, end: 7 }], ["がっこう"]],
    ["😀 か\u3099っこう", "かっこう", [{ start: 3, end: 8 }], ["か\u3099っこう"]],
    ["😀 ﷺ", "الله", [{ start: 3, end: 4 }], ["ﷺ"]],
    ["😀 ㎏", "kg", [{ start: 3, end: 4 }], ["㎏"]],
    ["😀 a℀b", "cb", [{ start: 4, end: 6 }], ["℀b"]],
  ] as const)("highlights original graphemes after normalization: %s", (text, query, ranges, slices) => {
    const snippet = createSnippet(text, query);
    expect(snippet).toEqual({ text, start: 0, end: text.length, highlights: ranges });
    expect(snippet.highlights.map(({ start, end }) => snippet.text.slice(start, end))).toEqual(
      slices,
    );
  });

  it("returns raw original text and folded whole-word highlight ranges", () => {
    const text = "😀 CAFÉ cafe\u0301 Straße <script>";
    const snippet = createSnippet(text, "cafe str");
    expect(snippet).toEqual({
      text,
      start: 0,
      end: text.length,
      highlights: [
        { start: 3, end: 7 },
        { start: 8, end: 13 },
        { start: 14, end: 20 },
      ],
    });
    expect(snippet.highlights.map(({ start, end }) => snippet.text.slice(start, end))).toEqual([
      "CAFÉ",
      "cafe\u0301",
      "Straße",
    ]);
  });

  it("centers on the first match and returns relative ranges for late hits", () => {
    const text = "zero one two three comet five six seven";
    const snippet = createSnippet(text, "com", 11);
    expect(snippet.text).toBe("ee comet fi");
    expect(snippet.text).toBe(text.slice(snippet.start, snippet.end));
    expect(snippet.highlights).toEqual([{ start: 3, end: 8 }]);
  });

  it("shifts the window back near the end and enlarges it for long matching words", () => {
    expect(createSnippet("a b comet", "comet", 8)).toEqual({
      text: " b comet",
      start: 1,
      end: 9,
      highlights: [{ start: 3, end: 8 }],
    });
    expect(createSnippet("a encyclopedia z", "ency", 3)).toEqual({
      text: "encyclopedia",
      start: 2,
      end: 14,
      highlights: [{ start: 0, end: 12 }],
    });
  });

  it("preserves surrogate pairs, combining sequences and emoji clusters", () => {
    const text = "👩‍👩‍👧‍👧 e\u0301 comet 😀";
    const snippet = createSnippet(text, "com", 9);
    expect(snippet.text).toBe("e\u0301 comet 😀");
    expect(snippet.highlights).toEqual([{ start: 3, end: 8 }]);
    expect(createSnippet(text, "absent", 1).text).toBe("👩‍👩‍👧‍👧");
    expect(createSnippet("😀𐐀", "𐐨", 1).text).toBe("𐐀");
  });

  it("returns a beginning window with no matches, empty text or empty query", () => {
    expect(createSnippet("first second", "absent", 5)).toEqual({
      text: "first",
      start: 0,
      end: 5,
      highlights: [],
    });
    expect(createSnippet("first", "").highlights).toEqual([]);
    expect(createSnippet("", "word")).toEqual({ text: "", start: 0, end: 0, highlights: [] });
    expect(createSnippet("comet comet", "comet", 7).highlights).toEqual([{ start: 0, end: 5 }]);
  });

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "5",
    null,
  ])("rejects invalid snippet lengths %#", (length) =>
    rejects(() => createSnippet("text", "query", length as number)));

  it("uses the title as snippet source for title-only records", () => {
    const index = new SearchIndex();
    index.add(doc("a", "Comet notes"));
    expect(index.search("com")[0]?.snippet).toEqual(createSnippet("Comet notes", "com"));
  });
});
