// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSelectors } from "../src/apps/docs/lib/anchoring";
import {
  analyzeDocument,
  buildOutline,
  DOCUMENT_LIMITS,
  DocumentOutlineError,
  type DocumentOutlineErrorCode,
  documentStatistics,
  type OutlineHeading,
  projectPlainText,
} from "../src/apps/docs/lib/outline";

const text = (value: string) => ({ type: "text", text: value });
const node = (type: string, content: unknown[] = []) => ({ type, content });
const paragraph = (value: string) => node("paragraph", value ? [text(value)] : []);
const doc = (...content: unknown[]) => node("doc", content);
const heading = (level: number, value: string) => ({
  ...node("heading", value ? [text(value)] : []),
  attrs: { level },
});

function expectError(input: unknown, code: DocumentOutlineErrorCode, path?: number[]): void {
  for (const derive of [analyzeDocument, buildOutline, projectPlainText, documentStatistics]) {
    try {
      derive(input);
      expect.fail("Expected typed rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentOutlineError);
      expect(error).toMatchObject({ name: "DocumentOutlineError", code });
      if (path) expect(error).toMatchObject({ path });
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("plain-text projection", () => {
  it("handles empty documents, empty paragraphs and empty block atoms", () => {
    expect(analyzeDocument({ type: "doc" })).toEqual({
      projection: { text: "", spans: [], nodes: [{ path: [], start: 0, end: 0 }] },
      outline: [],
      statistics: { words: 0, characters: 0, charactersWithoutSpaces: 0, readingTimeMinutes: 0 },
    });
    expect(
      projectPlainText(
        doc(
          node("paragraph"),
          node("horizontalRule"),
          {
            type: "image",
            attrs: { src: "https://example.org/fictional-chart.png", alt: "Chart" },
          },
          node("paragraph"),
        ),
      ).text,
    ).toBe("\n\n\n");
    expect(documentStatistics(doc(node("paragraph")))).toEqual({
      words: 0,
      characters: 0,
      charactersWithoutSpaces: 0,
      readingTimeMinutes: 0,
    });
  });

  it("preserves inline text, marks, hard breaks and exact code point positions", () => {
    const input = doc(
      node("paragraph", [
        text("A😀"),
        {
          ...text("e\u0301"),
          marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.org" } }],
        },
        node("hardBreak"),
        text("Z"),
      ]),
      node("paragraph"),
    );
    const projection = projectPlainText(input);
    expect(projection).toEqual({
      text: "A😀e\u0301\nZ\n",
      spans: [
        { start: 0, end: 2, path: [0, 0], kind: "text" },
        { start: 2, end: 4, path: [0, 1], kind: "text" },
        { start: 4, end: 5, path: [0, 2], kind: "hardBreak" },
        { start: 5, end: 6, path: [0, 3], kind: "text" },
        { start: 6, end: 7, path: [], kind: "separator" },
      ],
      nodes: [
        { start: 0, end: 7, path: [] },
        { start: 0, end: 6, path: [0] },
        { start: 0, end: 2, path: [0, 0] },
        { start: 2, end: 4, path: [0, 1] },
        { start: 4, end: 5, path: [0, 2] },
        { start: 5, end: 6, path: [0, 3] },
        { start: 7, end: 7, path: [1] },
      ],
    });
    expect(createSelectors(projection.text, { start: 1, end: 4 }).quote.exact).toBe("😀e\u0301");
    const points = Array.from(projection.text);
    for (const span of projection.spans.filter((span) => span.kind === "text")) {
      const source = input.content[span.path[0] as number] as { content: { text: string }[] };
      expect(points.slice(span.start, span.end).join("")).toBe(
        source.content[span.path[1] as number]?.text,
      );
    }
  });

  it("walks quotes, code, nested lists, tasks and tables in document order", () => {
    const input = doc(
      node("blockquote", [paragraph("Quoted"), paragraph("Second")]),
      node("codeBlock", [text("const x = 1;\n  x++;"), text("\n")]),
      node("bulletList", [
        node("listItem", [
          paragraph("Outer"),
          node("orderedList", [
            node("listItem", [paragraph("Inner")]),
            node("listItem", [paragraph("Next")]),
          ]),
        ]),
      ]),
      node("taskList", [
        {
          ...node("taskItem", [
            paragraph("Done"),
            node("taskList", [
              { ...node("taskItem", [paragraph("Nested")]), attrs: { checked: false } },
            ]),
          ]),
          attrs: { checked: true },
        },
      ]),
      node("table", [
        node("tableRow", [
          node("tableHeader", [paragraph("Name")]),
          node("tableHeader", [paragraph("Value")]),
        ]),
        node("tableRow", [
          node("tableCell", [paragraph("Alex Example"), paragraph("More")]),
          node("tableCell", [paragraph("7")]),
        ]),
      ]),
    );
    expect(projectPlainText(input).text).toBe(
      "Quoted\nSecond\nconst x = 1;\n  x++;\n\nOuter\nInner\nNext\nDone\nNested\nName\tValue\nAlex Example\nMore\t7",
    );
    expect(projectPlainText(input).spans).toContainEqual({
      kind: "separator",
      path: [4, 0],
      start: 68,
      end: 69,
    });
  });

  it("ignores known formatting metadata while preserving text", () => {
    const marks = [
      "bold",
      "italic",
      "underline",
      "strike",
      "subscript",
      "superscript",
      "highlight",
      "code",
      "link",
      "comment",
    ];
    const input = doc({
      ...node("paragraph", [
        { ...text("Fictional"), marks: marks.map((type) => ({ type, attrs: {} })) },
      ]),
      attrs: { textAlign: "center", metadata: [null, true, false, 2.5, { version: 1 }] },
    });
    expect(projectPlainText(input).text).toBe("Fictional");
    const nullPrototype = Object.assign(Object.create(null), { type: "doc", content: [] });
    expect(projectPlainText(nullPrototype).text).toBe("");
  });

  it("keeps spans contiguous and maps each text character back to its node path", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .array(fc.constantFrom("a", " ", "😀", "é", "\n", "中"), {
              minLength: 1,
              maxLength: 15,
            })
            .map((parts) => parts.join("")),
          { maxLength: 12 },
        ),
        (values) => {
          const projection = projectPlainText(doc(...values.map(paragraph)));
          expect(projection.text).toBe(values.join("\n"));
          const points = Array.from(projection.text);
          let offset = 0;
          for (const span of projection.spans) {
            expect(span.start).toBe(offset);
            expect(span.end).toBeGreaterThan(span.start);
            const projected = points.slice(span.start, span.end).join("");
            if (span.kind === "text") expect(projected).toBe(values[span.path[0] as number]);
            else expect(projected).toBe("\n");
            offset = span.end;
          }
          expect(offset).toBe(points.length);
        },
      ),
    );
  });
});

describe("heading outline", () => {
  it("uses the nearest preceding lower level without inserting missing headings", () => {
    const input = doc(
      heading(3, "Opening"),
      heading(2, "Section"),
      heading(3, "Detail"),
      heading(1, "Main"),
      heading(3, "Skipped"),
      heading(2, "Next"),
      heading(2, "Peer"),
      node("blockquote", [heading(3, "Quoted heading")]),
      heading(1, "End"),
    );
    const outline = buildOutline(input);
    const shape = (headings: readonly OutlineHeading[]): unknown =>
      headings.map((h) => [h.level, h.text, shape(h.children)]);
    expect(shape(outline)).toEqual([
      [3, "Opening", []],
      [2, "Section", [[3, "Detail", []]]],
      [
        1,
        "Main",
        [
          [3, "Skipped", []],
          [2, "Next", []],
          [2, "Peer", [[3, "Quoted heading", []]]],
        ],
      ],
      [1, "End", []],
    ]);
    expect(outline[0]).toMatchObject({ anchor: "opening", path: [0], start: 0, end: 7 });
    expect(outline[2]?.children[2]?.children[0]?.path).toEqual([7, 0]);
  });

  it("normalizes accents, Unicode, punctuation, whitespace, empty headings and global collisions", () => {
    const labels = [
      "  Café & PLAN!  ",
      "Cafe plan",
      "cafe-plan-1",
      "CAFÉ PLAN",
      "東京 計画",
      "",
      "!!!",
      "section",
      "a-1",
      "a",
      "a",
      "a-1",
    ];
    expect(
      buildOutline(doc(...labels.map((label) => heading(1, label)))).map((h) => h.anchor),
    ).toEqual([
      "cafe-plan",
      "cafe-plan-1",
      "cafe-plan-1-1",
      "cafe-plan-2",
      "東京-計画",
      "section",
      "section-1",
      "section-2",
      "a-1",
      "a",
      "a-2",
      "a-1-1",
    ]);
    const input = doc({
      ...node("heading", [text(" A  "), node("hardBreak"), text("B ")]),
      attrs: { level: 1 },
    });
    expect(buildOutline(input)[0]).toEqual({
      level: 1,
      text: "A B",
      anchor: "a-b",
      path: [0],
      start: 0,
      end: 7,
      children: [],
    });
    expect(projectPlainText(input).text).toBe(" A  \nB ");
    expect(buildOutline(doc(heading(1, "A\u0085B")))[0]?.text).toBe("A B");
  });

  it("is deterministic, does not mutate frozen input and handles repeated headings efficiently", () => {
    const input = Object.freeze({
      type: "doc",
      content: Object.freeze([
        Object.freeze({
          type: "heading",
          attrs: Object.freeze({ level: 1 }),
          content: Object.freeze([Object.freeze(text("Plan"))]),
        }),
      ]),
    });
    const before = JSON.stringify(input);
    const result = analyzeDocument(input);
    expect(result.outline).toEqual(buildOutline(input));
    expect(result.projection).toEqual(projectPlainText(input));
    expect(result.statistics).toEqual(documentStatistics(input));
    expect(JSON.stringify(input)).toBe(before);
    expect(analyzeDocument(input)).toEqual(result);
    const many = buildOutline(doc(...Array.from({ length: 2000 }, () => heading(1, "Repeated"))));
    expect(many.at(-1)?.anchor).toBe("repeated-1999");
  });
});

describe("document statistics", () => {
  it("counts word-like segments rather than punctuation or emoji", () => {
    expect(documentStatistics(doc(paragraph("Hello, world! 😀")))).toEqual({
      words: 2,
      characters: 15,
      charactersWithoutSpaces: 13,
      readingTimeMinutes: 2 / 230,
    });
    expect(documentStatistics(doc(paragraph("... 😀 !!!"))).words).toBe(0);
  });

  it("counts graphemes across text-node boundaries, accents, skin tones, flags and ZWJ sequences", () => {
    const input = doc(node("paragraph", [text("e"), text("\u0301 👩🏽‍💻 🇺🇳")]));
    expect(documentStatistics(input)).toEqual({
      words: 1,
      characters: 5,
      charactersWithoutSpaces: 3,
      readingTimeMinutes: 1 / 230,
    });
    expect(Array.from(projectPlainText(input).text).length).toBeGreaterThan(5);
  });

  it("excludes Unicode whitespace and generated block/table separators from the no-spaces count", () => {
    const input = doc(
      paragraph("a\u00a0\u2003b\t\r\nc"),
      paragraph("d"),
      node("table", [
        node("tableRow", [
          node("tableCell", [paragraph("e")]),
          node("tableCell", [paragraph("f")]),
        ]),
      ]),
    );
    expect(documentStatistics(input)).toEqual({
      words: 6,
      characters: 13,
      charactersWithoutSpaces: 6,
      readingTimeMinutes: 6 / 230,
    });
    expect(documentStatistics(doc(paragraph("a\u0085\ufeffb"))).charactersWithoutSpaces).toBe(2);
  });

  it("segments CJK and Thai with an explicit locale", () => {
    expect(documentStatistics(doc(paragraph("你好世界")), "zh-CN").words).toBe(2);
    expect(documentStatistics(doc(paragraph("ภาษาไทย")), "th").words).toBe(2);
  });

  it("reports exact minutes at the specified 230 words per minute", () => {
    expect(
      documentStatistics(doc(paragraph(Array(230).fill("word").join(" ")))).readingTimeMinutes,
    ).toBe(1);
    expect(
      documentStatistics(doc(paragraph(Array(345).fill("word").join(" ")))).readingTimeMinutes,
    ).toBe(1.5);
  });

  it.each([
    "",
    "not_a_locale",
    "zz",
    1,
    null,
    [],
  ])("rejects invalid or unsupported locale %j", (locale) => {
    expect(() => documentStatistics(doc(), locale as string)).toThrowError(DocumentOutlineError);
    expect(() => analyzeDocument(doc(), locale as string)).toThrowError(
      expect.objectContaining({ code: "invalid-locale" }),
    );
  });

  it("fails closed without Intl.Segmenter while keeping projection and outline usable", () => {
    vi.stubGlobal("Intl", { Segmenter: undefined });
    expect(() => analyzeDocument(doc())).toThrowError(
      expect.objectContaining({ code: "segmenter-unavailable" }),
    );
    expect(() => documentStatistics(doc())).toThrowError(DocumentOutlineError);
    expect(projectPlainText(doc(paragraph("Still text"))).text).toBe("Still text");
    expect(buildOutline(doc(heading(1, "Still heading")))[0]?.anchor).toBe("still-heading");
  });
});

describe("fail-closed document validation", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["primitive", 42],
    ["array root", []],
    ["missing type", {}],
    ["non-string type", { type: 4 }],
    ["wrong root", paragraph("No")],
    ["unknown field", { type: "doc", html: "<p>No</p>" }],
    ["invalid attrs", { type: "doc", attrs: null }],
    ["array attrs", { type: "doc", attrs: [] }],
    ["invalid content", { type: "doc", content: null }],
    ["string content", { type: "doc", content: "No" }],
    ["null child", doc(null)],
    ["array child", doc([])],
    ["inline at root", doc(text("No"))],
    ["block inside paragraph", doc(node("paragraph", [paragraph("No")]))],
    ["nested doc", doc(doc())],
    ["code break", doc(node("codeBlock", [node("hardBreak")]))],
    ["text on nontext", doc({ type: "paragraph", text: "No" })],
    ["empty text", doc(node("paragraph", [text("")]))],
    ["non-string text", doc(node("paragraph", [{ type: "text", text: 7 }]))],
    ["missing text", doc(node("paragraph", [{ type: "text" }]))],
    ["content on text", doc(node("paragraph", [{ ...text("No"), content: [] }]))],
    ["content on atom", doc(node("image", [paragraph("No")]))],
    ["paragraph marks", doc({ type: "paragraph", marks: [] })],
    ["non-array marks", doc(node("paragraph", [{ ...text("No"), marks: {} }]))],
    ["null mark", doc(node("paragraph", [{ ...text("No"), marks: [null] }]))],
    ["missing mark type", doc(node("paragraph", [{ ...text("No"), marks: [{}] }]))],
    ["non-string mark type", doc(node("paragraph", [{ ...text("No"), marks: [{ type: 1 }] }]))],
    [
      "mark field",
      doc(node("paragraph", [{ ...text("No"), marks: [{ type: "bold", extra: true }] }])),
    ],
    [
      "mark attrs",
      doc(node("paragraph", [{ ...text("No"), marks: [{ type: "bold", attrs: null }] }])),
    ],
    ["heading no attrs", doc(node("heading"))],
    ["heading no level", doc({ type: "heading", attrs: {} })],
    ...[0, 4, 1.5, "1", null].map((level): [string, unknown] => [
      "invalid heading level",
      doc({ type: "heading", attrs: { level } }),
    ]),
    ...["bulletList", "orderedList", "taskList", "table", "blockquote"].map(
      (type): [string, unknown] => ["empty container", doc(node(type))],
    ),
    ["empty row", doc(node("table", [node("tableRow")]))],
    ["empty cell", doc(node("table", [node("tableRow", [node("tableCell")])]))],
    ["empty header", doc(node("table", [node("tableRow", [node("tableHeader")])]))],
    ["empty item", doc(node("bulletList", [node("listItem")]))],
    ["item null", doc(node("bulletList", [node("listItem", [null])]))],
    ["item starts heading", doc(node("bulletList", [node("listItem", [heading(1, "No")])]))],
    ["task starts heading", doc(node("taskList", [node("taskItem", [heading(1, "No")])]))],
    ["bad list child", doc(node("bulletList", [paragraph("No")]))],
  ])("rejects %s", (_label, input) => expectError(input, "invalid-document"));

  it.each([
    "unknown",
    "docxFootnote",
    "constructor",
    "__proto__",
    "toString",
  ])("rejects unknown node %s with its node path", (type) => {
    expectError(doc(node("blockquote", [{ type }])), "unsupported-node", [0, 0]);
  });

  it("rejects unknown marks rather than dropping them", () => {
    expectError(
      doc(node("paragraph", [{ ...text("No"), marks: [{ type: "footnote" }] }])),
      "unsupported-mark",
      [0, 0],
    );
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    BigInt(2),
    Symbol("No"),
    () => 1,
    new Date(0),
    new Map(),
    /a/,
    "\ud800",
    "\udfff",
  ])("rejects non-JSON metadata %s", (bad) => {
    expectError({ type: "doc", attrs: { bad } }, "invalid-document");
  });

  it("rejects cycles while allowing shared objects without mistaking them for cycles", () => {
    const cyclic: { type: string; content: unknown[] } = doc();
    cyclic.content.push(cyclic);
    expectError(cyclic, "invalid-document");
    const shared = paragraph("Shared");
    expect(projectPlainText(doc(shared, shared)).text).toBe("Shared\nShared");
  });

  it("rejects getters, hidden fields, symbol keys, sparse arrays and custom prototypes", () => {
    const getter = vi.fn(() => "doc");
    expectError(
      Object.defineProperty({}, "type", { get: getter, enumerable: true }),
      "invalid-document",
    );
    expect(getter).not.toHaveBeenCalled();
    expectError(
      Object.defineProperty({ type: "doc" }, "hidden", { value: true }),
      "invalid-document",
    );
    expectError({ type: "doc", [Symbol("hidden")]: true }, "invalid-document");
    expectError({ type: "doc", content: Array(2) }, "invalid-document");
    expectError({ type: "doc", content: Object.assign([], { extra: true }) }, "invalid-document");
    expectError(
      { type: "doc", content: Object.assign(Array(1), { extra: null }) },
      "invalid-document",
    );
    expectError(Object.assign(Object.create({}), { type: "doc" }), "invalid-document");
    expectError(Object.assign(Object.create(Array.prototype), { type: "doc" }), "invalid-document");
  });

  it("wraps failures from exotic objects without exposing their error messages", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expectError(proxy, "invalid-document");
    const throwing = new Proxy(
      { type: "doc" },
      {
        get() {
          throw new Error("Synthetic private content");
        },
      },
    );
    expectError(throwing, "invalid-document");
    expect(() => analyzeDocument(throwing)).toThrowError("Unable to read plain document JSON");
  });

  it("rejects excessive depth, value count and combined string lengths with typed errors", () => {
    let nested: unknown = null;
    for (let i = 0; i <= DOCUMENT_LIMITS.depth; i++) nested = { nested };
    expectError({ type: "doc", attrs: { nested } }, "limit-exceeded");
    expectError(
      { type: "doc", attrs: { many: Array(DOCUMENT_LIMITS.values).fill(null) } },
      "limit-exceeded",
    );
    expectError(doc(paragraph("a".repeat(DOCUMENT_LIMITS.characters))), "limit-exceeded");
    // The type, attrs and note keys plus the doc value consume 16 code units.
    expect(
      projectPlainText({
        type: "doc",
        attrs: { note: "a".repeat(DOCUMENT_LIMITS.characters - 16) },
      }).text,
    ).toBe("");
  });

  it("rejects oversized sparse arrays before enumerating their keys", () => {
    const ownKeys = vi.fn(() => {
      throw new Error("Oversized array must be rejected before enumerating keys");
    });
    const getOwnPropertyDescriptor = vi.fn(Reflect.getOwnPropertyDescriptor);
    const many = new Proxy(Array(2 ** 32 - 1), { ownKeys, getOwnPropertyDescriptor });
    expectError({ type: "doc", attrs: { many } }, "limit-exceeded");
    expect(ownKeys).not.toHaveBeenCalled();
    expect(getOwnPropertyDescriptor).not.toHaveBeenCalled();
  });

  it.each([
    "array",
    "object",
  ])("checks %s cardinality against the remaining budget before reading descriptors", (kind) => {
    // Root, type, attrs, earlier, its four entries and many consume nine values.
    const entries = Array(DOCUMENT_LIMITS.values - 8).fill(null);
    const target = kind === "array" ? entries : Object.fromEntries(entries.map((v, i) => [i, v]));
    const getOwnPropertyDescriptor = vi.fn(Reflect.getOwnPropertyDescriptor);
    const many = new Proxy(target, { getOwnPropertyDescriptor });
    expectError(
      { type: "doc", attrs: { earlier: [null, null, null, null], many } },
      "limit-exceeded",
    );
    expect(getOwnPropertyDescriptor).not.toHaveBeenCalled();
  });

  it.each(["array", "object"])("accepts a %s at the exact value limit", (kind) => {
    const entries = Array(DOCUMENT_LIMITS.values - (kind === "array" ? 4 : 3)).fill(null);
    const attrs =
      kind === "array" ? { many: entries } : Object.fromEntries(entries.map((v, i) => [i, v]));
    expect(projectPlainText({ type: "doc", attrs }).text).toBe("");
  });

  it.each([
    "array",
    "object",
  ])("inspects %s descriptors incrementally while traversing nested values", (kind) => {
    const first = { nested: "a".repeat(DOCUMENT_LIMITS.characters) };
    const target = kind === "array" ? [first, null] : { first, later: null };
    const inspected: (string | symbol)[] = [];
    const many = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        inspected.push(key);
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    expectError({ type: "doc", attrs: { many } }, "limit-exceeded");
    expect(inspected).toEqual(Array(4).fill(kind === "array" ? "0" : "first"));
  });

  it("counts metadata property names as UTF-16 code units at the character limit", () => {
    const overhead = "type".length + "doc".length + "attrs".length;
    const key = "😀".repeat((DOCUMENT_LIMITS.characters - overhead) / 2);
    expect(projectPlainText({ type: "doc", attrs: { [key]: null } }).text).toBe("");
    expectError({ type: "doc", attrs: { [`${key}a`]: null } }, "limit-exceeded");
  });

  it("shares the character budget across nested property names and string values", () => {
    const overhead = "type".length + "doc".length + "attrs".length;
    const key = "k".repeat(DOCUMENT_LIMITS.characters / 4);
    const value = "v".repeat(DOCUMENT_LIMITS.characters - overhead - key.length * 2);
    const input = { type: "doc", attrs: { [key]: { [key]: value } } };
    expect(projectPlainText(input).text).toBe("");
    expectError({ type: "doc", attrs: { [key]: { [`${key}a`]: value } } }, "limit-exceeded");
    expectError({ type: "doc", attrs: { [key]: { [key]: `${value}a` } } }, "limit-exceeded");
  });
});
