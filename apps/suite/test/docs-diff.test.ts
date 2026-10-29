// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  DIFF_LIMITS,
  type DocumentMark,
  type DocumentNode,
  diffDocuments,
} from "../src/apps/docs/lib/diff";
import { myers } from "../src/apps/docs/lib/diff/myers";

const text = (value: string, marks: readonly DocumentMark[] = []): DocumentNode => ({
  type: "text",
  text: value,
  marks,
});
const paragraph = (value: string): DocumentNode => ({
  type: "paragraph",
  content: value ? [text(value)] : [],
});
const doc = (...content: DocumentNode[]): DocumentNode => ({ type: "doc", content });
const bold = { type: "bold" },
  italic = { type: "italic" };
const link = (href: string): DocumentMark => ({ type: "link", attrs: { href } });
function modified(before: DocumentNode, after: DocumentNode) {
  const changes = diffDocuments(doc(before), doc(after));
  expect(changes).toHaveLength(1);
  const change = changes[0];
  if (change?.kind !== "modified") throw new Error("Expected modified block");
  expect(change.beforeIndex).toBe(0);
  expect(change.afterIndex).toBe(0);
  return change;
}
const range = (from: number, to = from) => ({ from, to });

describe("document block alignment", () => {
  it("omits identical and empty documents", () => {
    expect(diffDocuments({ type: "doc" }, doc())).toEqual([]);
    expect(diffDocuments(doc(paragraph("Ada's plan")), doc(paragraph("Ada's plan")))).toEqual([]);
  });
  it("accepts empty root attributes as equivalent to absent attributes", () => {
    for (const content of [[], [paragraph("same")]]) {
      const before = doc(...content);
      const after = { ...before, attrs: {} };
      expect(diffDocuments(before, after)).toEqual([]);
      expect(diffDocuments(after, before)).toEqual([]);
      expect(diffDocuments(after, after)).toEqual([]);
    }
  });
  it("rejects unsupported root attributes instead of silently omitting their changes", () => {
    for (const content of [[], [paragraph("same")]]) {
      const plain = doc(...content);
      const portrait = { ...plain, attrs: { layout: "portrait" } };
      const landscape = { ...plain, attrs: { layout: "landscape" } };
      for (const [before, after] of [
        [portrait, landscape],
        [portrait, portrait],
        [portrait, plain],
        [plain, portrait],
      ] as const) {
        expect(() => diffDocuments(before, after)).toThrow(
          new TypeError("Document root attributes are unsupported"),
        );
      }
    }
  });
  it("reports insertions and deletions with side-specific block indexes", () => {
    const old = doc(paragraph("one"), paragraph("two"));
    const next = doc(paragraph("zero"), paragraph("one"), paragraph("two"), paragraph("three"));
    expect(
      diffDocuments(old, next).map((c) => [c.kind, "afterIndex" in c ? c.afterIndex : -1]),
    ).toEqual([
      ["inserted", 0],
      ["inserted", 3],
    ]);
    expect(
      diffDocuments(next, old).map((c) => [c.kind, "beforeIndex" in c ? c.beforeIndex : -1]),
    ).toEqual([
      ["deleted", 0],
      ["deleted", 3],
    ]);
    expect(diffDocuments(doc(), doc(paragraph("")))[0]).toMatchObject({
      kind: "inserted",
      after: { type: "paragraph" },
    });
    expect(diffDocuments(doc(paragraph("")), doc())[0]).toMatchObject({
      kind: "deleted",
      before: { type: "paragraph" },
    });
  });
  it("pairs unmatched runs positionally, preserving unmatched tails", () => {
    const before = doc(paragraph("a"), paragraph("b"), paragraph("anchor"));
    const after = doc(paragraph("c"), paragraph("anchor"));
    expect(diffDocuments(before, after).map((c) => c.kind)).toEqual(["modified", "deleted"]);
    expect(diffDocuments(after, before).map((c) => c.kind)).toEqual(["modified", "inserted"]);
  });
  it("aligns repeated blocks deterministically and represents moves as delete/insert", () => {
    const before = doc(paragraph("a"), paragraph("b"), paragraph("a"));
    const after = doc(paragraph("b"), paragraph("a"), paragraph("a"));
    const result = diffDocuments(before, after);
    expect(result.map((c) => c.kind)).toEqual(["deleted", "inserted"]);
    expect(result).toEqual(diffDocuments(before, after));
  });
  it("reserves moved blocks across unmatched runs before pairing modifications", () => {
    const before = doc(...["a", "b", "c", "d"].map(paragraph));
    const after = doc(...["b", "a", "d", "c"].map(paragraph));
    const changes = diffDocuments(before, after);
    expect(changes.filter((change) => change.kind === "modified")).toEqual([]);
    expect(changes.filter((change) => change.kind === "deleted")).toMatchObject([
      { beforeIndex: 0, before: { content: [{ text: "a" }] } },
      { beforeIndex: 2, before: { content: [{ text: "c" }] } },
    ]);
    expect(changes.filter((change) => change.kind === "inserted")).toMatchObject([
      { afterIndex: 1, after: { content: [{ text: "a" }] } },
      { afterIndex: 3, after: { content: [{ text: "c" }] } },
    ]);
    const mixed = diffDocuments(
      doc(...(before.content as DocumentNode[]), paragraph("old")),
      doc(...(after.content as DocumentNode[]), paragraph("new")),
    );
    expect(mixed.filter((change) => change.kind !== "modified")).toEqual(changes);
    expect(mixed.filter((change) => change.kind === "modified")).toEqual([
      { ...modified(paragraph("old"), paragraph("new")), beforeIndex: 4, afterIndex: 4 },
    ]);
  });
  it("never reports text modifications for permutations, including duplicate blocks", () => {
    function permutations(values: string[]): string[][] {
      if (values.length === 0) return [[]];
      return values.flatMap((value, i) =>
        permutations(values.filter((_, j) => i !== j)).map((rest) => [value, ...rest]),
      );
    }
    for (const values of [
      ["a", "b", "c", "d"],
      ["a", "a", "b", "b"],
    ]) {
      const before = doc(...values.map(paragraph));
      for (const order of permutations(values)) {
        const after = doc(...order.map(paragraph));
        const changes = diffDocuments(before, after);
        expect(changes.every((change) => change.kind !== "modified")).toBe(true);
        expect(changes).toEqual(diffDocuments(before, after));
      }
    }
  });
  it("reserves only as many moved duplicates as have exact unmatched counterparts", () => {
    const before = doc(...["a", "b", "c", "d", "c", "old"].map(paragraph));
    const after = doc(...["b", "a", "d", "c", "new"].map(paragraph));
    const changes = diffDocuments(before, after);
    expect(changes.filter((change) => change.kind === "modified")).toMatchObject([
      { beforeIndex: 5, afterIndex: 4, before: { content: [{ text: "old" }] } },
    ]);
    expect(changes.filter((change) => change.kind === "deleted")).toMatchObject([
      { beforeIndex: 0 },
      { beforeIndex: 2 },
    ]);
    expect(changes.filter((change) => change.kind === "inserted")).toMatchObject([
      { afterIndex: 1 },
    ]);
  });
  it("retains structural, attribute and atom changes even without text changes", () => {
    const p = paragraph("same");
    const heading = { ...p, type: "heading", attrs: { level: 2, textAlign: "center" } };
    expect(modified(p, heading)).toMatchObject({
      after: { type: "heading", attrs: heading.attrs },
      inline: [],
    });
    for (const type of ["image", "horizontalRule", "hardBreak"]) {
      expect(
        modified(
          { type },
          { type, attrs: { src: "https://example.org/image.png", alt: "Fictional chart" } },
        ).inline,
      ).toEqual([]);
    }
    expect(
      modified(
        { type: "table", content: [] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("")] }] },
          ],
        },
      ).inline,
    ).toEqual([]);
  });
  it("normalizes key order, absent defaults, mark order and split adjacent text runs", () => {
    const before = doc({
      type: "paragraph",
      content: [text("ab", [bold, italic]), text("cd", [italic, bold])],
    });
    const after = doc({
      type: "paragraph",
      attrs: {},
      marks: [],
      content: [text("abcd", [italic, bold])],
    });
    expect(diffDocuments(before, after)).toEqual([]);
    expect(
      diffDocuments(
        doc({ type: "paragraph", attrs: { z: [null, true, 1], a: { b: "x", a: false } } }),
        doc({
          type: "paragraph",
          attrs: { a: { a: false, b: "x" }, z: [null, true, 1] },
          content: [],
        }),
      ),
    ).toEqual([]);
    expect(
      modified(
        { type: "paragraph", content: [{ ...text("a"), attrs: { id: 1 } }, text("b")] },
        paragraph("ab"),
      ).inline,
    ).toEqual([]);
  });
});

describe("inline text and formatting", () => {
  it("coalesces middle insertion and deletion ranges", () => {
    expect(modified(paragraph("ac"), paragraph("abbc")).inline).toEqual([
      { kind: "inserted", before: range(2), after: range(2, 4), text: "bb" },
    ]);
    expect(modified(paragraph("abbc"), paragraph("ac")).inline).toEqual([
      { kind: "deleted", before: range(2, 4), after: range(2), text: "bb" },
    ]);
  });
  it("handles replacements, start/end edits and empty textblocks", () => {
    expect(modified(paragraph("cat"), paragraph("cut")).inline).toEqual([
      { kind: "deleted", before: range(2, 3), after: range(2), text: "a" },
      { kind: "inserted", before: range(3), after: range(2, 3), text: "u" },
    ]);
    expect(modified(paragraph(""), paragraph("hi")).inline).toEqual([
      { kind: "inserted", before: range(1), after: range(1, 3), text: "hi" },
    ]);
    expect(modified(paragraph("hi"), paragraph("")).inline).toEqual([
      { kind: "deleted", before: range(1, 3), after: range(1), text: "hi" },
    ]);
    expect(modified(paragraph("b"), paragraph("abc")).inline.map((c) => c.kind)).toEqual([
      "inserted",
      "inserted",
    ]);
  });
  it("uses UTF-16 offsets without splitting emoji surrogate pairs", () => {
    expect(modified(paragraph("A😀Z"), paragraph("A😺Z")).inline).toEqual([
      { kind: "deleted", before: range(2, 4), after: range(2), text: "😀" },
      { kind: "inserted", before: range(4), after: range(2, 4), text: "😺" },
    ]);
    expect(modified(paragraph("e\u0301"), paragraph("é")).inline).toHaveLength(2);
  });
  it("tracks nested list/table text positions and separates text around atoms", () => {
    const nested = (value: string) => ({
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(value)] }],
    });
    expect(modified(nested("a"), nested("ab")).inline).toEqual([
      { kind: "inserted", before: range(4), after: range(4, 5), text: "b" },
    ]);
    const withBreak = (first: string, last: string): DocumentNode => ({
      type: "paragraph",
      content: [text(first), { type: "hardBreak" }, text(last)],
    });
    expect(modified(withBreak("a", "b"), withBreak("aa", "bb")).inline).toHaveLength(2);
    const table = (value: string) => ({
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableCell", content: [paragraph(value)] }] },
      ],
    });
    expect(modified(table("x"), table("xy")).inline[0]).toMatchObject({
      before: range(5),
      after: range(5, 6),
    });
  });
  it("reports added, removed and attribute-changed marks on surviving text", () => {
    const p = (marks: DocumentMark[]): DocumentNode => ({
      type: "paragraph",
      content: [text("hello", marks)],
    });
    expect(modified(p([]), p([bold])).inline).toEqual([
      {
        kind: "marks",
        before: range(1, 6),
        after: range(1, 6),
        removed: [],
        added: [{ type: "bold", attrs: {} }],
      },
    ]);
    expect(modified(p([bold]), p([])).inline[0]).toMatchObject({
      removed: [{ type: "bold", attrs: {} }],
      added: [],
    });
    expect(
      modified(
        p([bold, link("https://example.org/old")]),
        p([bold, link("https://example.org/new")]),
      ).inline[0],
    ).toMatchObject({
      removed: [link("https://example.org/old")],
      added: [link("https://example.org/new")],
    });
  });
  it("keeps distinct mark transitions and disjoint marked ranges separate", () => {
    const before = { type: "paragraph", content: [text("abcdef")] };
    const after = {
      type: "paragraph",
      content: [text("ab", [bold]), text("c", [italic]), text("d"), text("ef", [bold])],
    };
    expect(modified(before, after).inline.map((c) => [c.kind, c.after])).toEqual([
      ["marks", range(1, 3)],
      ["marks", range(3, 4)],
      ["marks", range(5, 7)],
    ]);
    const prior = { type: "paragraph", content: [text("a", [bold]), text("b", [italic])] };
    expect(modified(prior, paragraph("ab")).inline).toHaveLength(2);
    expect(
      modified(paragraph("ab"), {
        type: "paragraph",
        content: [text("a", [bold]), text("X"), text("b", [bold])],
      }).inline.map((c) => c.kind),
    ).toEqual(["marks", "inserted", "marks"]);
  });
  it("keeps formatting on inserted/deleted text in snapshots rather than mark changes", () => {
    const after = { type: "paragraph", content: [text("a"), text("new", [italic])] };
    const change = modified(paragraph("a"), after);
    expect(change.inline).toEqual([
      { kind: "inserted", before: range(2), after: range(2, 5), text: "new" },
    ]);
    expect(change.after.content?.[1]?.marks).toEqual([{ type: "italic", attrs: {} }]);
  });
  it("handles text to/from leaf blocks and boundary edits", () => {
    expect(modified(paragraph("abc"), { type: "image" }).inline[0]).toMatchObject({
      kind: "deleted",
      text: "abc",
    });
    expect(modified({ type: "image" }, paragraph("abc")).inline[0]).toMatchObject({
      kind: "inserted",
      text: "abc",
    });
  });
  it("anchors deletion after the new block's final atom", () => {
    expect(
      modified({ type: "paragraph", content: [{ type: "image" }, text("tail")] }, { type: "image" })
        .inline,
    ).toEqual([{ kind: "deleted", before: range(2, 6), after: range(1), text: "tail" }]);
  });
  it("does not mutate deeply frozen inputs", () => {
    const before = doc(paragraph("Ada"));
    const after = doc({ type: "paragraph", content: [text("Ada Lovelace", [bold])] });
    function freeze(value: unknown): void {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    }
    freeze(before);
    freeze(after);
    const saved = JSON.stringify([before, after]);
    expect(diffDocuments(before, after)).toHaveLength(1);
    expect(JSON.stringify([before, after])).toBe(saved);
  });
});

describe("bounded untrusted documents", () => {
  const invalid = (value: unknown) => () => diffDocuments(value as DocumentNode, doc());
  it.each([
    undefined,
    null,
    true,
    1,
    "doc",
    {},
    { type: "paragraph" },
    { type: "doc", content: [null] },
    { type: "doc", content: [{}] },
    { type: "doc", content: [{ type: "" }] },
    { type: "doc", content: [{ type: 1 }] },
  ])("rejects invalid roots and node types: %j", (value) =>
    expect(invalid(value)).toThrow(TypeError));
  it.each([
    undefined,
    () => 1,
    Symbol("fixture"),
    BigInt(1),
    NaN,
    Infinity,
    new Date(0),
  ])("rejects non-JSON attributes: %s", (value) =>
    expect(invalid(doc({ type: "paragraph", attrs: { bad: value } } as DocumentNode))).toThrow(
      TypeError,
    ));
  it.each([[], true, 1, "bad"])("rejects invalid attributes: %j", (attrs) => {
    expect(invalid(doc({ type: "paragraph", attrs } as unknown as DocumentNode))).toThrow(
      TypeError,
    );
    expect(
      invalid(
        doc({ type: "paragraph", marks: [{ type: "bold", attrs }] } as unknown as DocumentNode),
      ),
    ).toThrow(TypeError);
  });
  it.each([null, {}, { type: "" }, { type: 1 }])("rejects invalid marks: %j", (mark) =>
    expect(invalid(doc({ type: "paragraph", marks: [mark] } as DocumentNode))).toThrow(TypeError));
  it.each([
    { type: "text" },
    { type: "text", text: "" },
    { type: "text", text: 2 },
    { type: "text", text: "x", content: [] },
    { type: "paragraph", text: "x" },
  ])("rejects invalid text nodes: %j", (value) =>
    expect(invalid(doc(value as DocumentNode))).toThrow(TypeError));
  it("accepts null-prototype attribute maps", () => {
    const attrs = Object.create(null);
    attrs.label = "Synthetic";
    expect(
      diffDocuments(
        doc({ type: "paragraph", attrs }),
        doc({ type: "paragraph", attrs: { label: "Synthetic" } }),
      ),
    ).toEqual([]);
  });
  it("bounds JSON strings, keys, entry counts, depth and cycles", () => {
    expect(
      invalid(doc({ type: "paragraph", attrs: { huge: "x".repeat(DIFF_LIMITS.json) } })),
    ).toThrow(RangeError);
    expect(
      invalid(doc({ type: "paragraph", attrs: { ["x".repeat(DIFF_LIMITS.json)]: null } })),
    ).toThrow(RangeError);
    expect(
      invalid(
        doc({ type: "paragraph", attrs: { values: Array.from({ length: 300_000 }, () => null) } }),
      ),
    ).toThrow(RangeError);
    let deep: DocumentNode = paragraph("");
    for (let i = 0; i < DIFF_LIMITS.depth; i++) deep = { type: "blockquote", content: [deep] };
    expect(invalid(doc(deep))).toThrow(RangeError);
    const cyclic: { type: string; content?: unknown[] } = { type: "doc" };
    cyclic.content = [cyclic];
    expect(invalid(cyclic)).toThrow(RangeError);
  });
  it("bounds node and text counts and accepts their inclusive limits", () => {
    expect(
      diffDocuments(
        doc(paragraph("a".repeat(DIFF_LIMITS.text))),
        doc(paragraph("a".repeat(DIFF_LIMITS.text))),
      ),
    ).toEqual([]);
    expect(invalid(doc(paragraph("a".repeat(DIFF_LIMITS.text + 1))))).toThrow(/text limit/);
    expect(
      diffDocuments(
        doc(...Array.from({ length: DIFF_LIMITS.nodes - 1 }, () => paragraph(""))),
        doc(),
      ),
    ).toHaveLength(DIFF_LIMITS.nodes - 1);
    expect(invalid(doc(...Array.from({ length: DIFF_LIMITS.nodes }, () => paragraph(""))))).toThrow(
      /node limit/,
    );
  });
  it("checks collection bounds before reading entries beyond the budget", () => {
    const values = new Array(DIFF_LIMITS.json + 1);
    Object.defineProperty(values, 0, {
      enumerable: true,
      get() {
        throw new Error("Oversized array entry must not be read");
      },
    });
    const attrs = {
      ["x".repeat(DIFF_LIMITS.json)]: null,
      get late(): never {
        throw new Error("Over-budget object entry must not be read");
      },
    };
    for (const attributes of [{ values }, attrs]) {
      expect(invalid(doc({ type: "paragraph", attrs: attributes }))).toThrow(
        /Document JSON limit exceeded/,
      );
    }
  });
  it("rejects sparse arrays in content, marks and nested attributes", () => {
    const sparse = new Array(3);
    sparse[2] = null;
    for (const value of [
      { type: "doc", content: sparse },
      doc({ type: "paragraph", marks: sparse }),
      doc({ type: "paragraph", attrs: { values: sparse } }),
    ]) {
      expect(invalid(value)).toThrow(/Expected dense JSON array/);
    }
  });
  it("validates non-enumerable array slots and ignores inherited object entries", () => {
    const values = [null];
    Object.defineProperty(values, 0, { enumerable: false, value: undefined });
    expect(invalid(doc({ type: "paragraph", attrs: { values } }))).toThrow(TypeError);
    Object.defineProperty(Object.prototype, "syntheticInheritedDiffAttribute", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: undefined,
    });
    try {
      expect(diffDocuments(doc(paragraph("same")), doc(paragraph("same")))).toEqual([]);
    } finally {
      Reflect.deleteProperty(Object.prototype, "syntheticInheritedDiffAttribute");
    }
  });
  it("throws for worst-case block or inline work instead of returning partial results", () => {
    const many = (letter: string) => doc(...Array.from({ length: 1_100 }, () => paragraph(letter)));
    expect(() => diffDocuments(many("a"), many("b"))).toThrow(/work limit/);
    expect(() => modified(paragraph("a".repeat(1_100)), paragraph("b".repeat(1_100)))).toThrow(
      /work limit/,
    );
  });
  it("handles large nearly-identical text in the work bound", () => {
    expect(
      modified(paragraph("a".repeat(99_999)), paragraph(`${"a".repeat(99_999)}b`)).inline,
    ).toHaveLength(1);
    expect(Object.isFrozen(DIFF_LIMITS)).toBe(true);
  });
  it("charges repeated long-attribute mark deltas against the shared work budget", () => {
    const before = { type: "paragraph", content: [text("abcd", [link("x".repeat(350_000))])] };
    const after = {
      type: "paragraph",
      content: [text("a"), text("b", [bold]), text("c", [italic]), text("d", [bold])],
    };
    expect(() => modified(before, after)).toThrow(/work limit/);
  });
  it("coalesces long marked text without charging its attributes per character", () => {
    const value = "a".repeat(99_999);
    const href = `https://example.org/${"x".repeat(50_000)}`;
    const p = (target: string) => ({ type: "paragraph", content: [text(value, [link(target)])] });
    expect(modified(p(href), p(`${href}b`)).inline).toEqual([
      {
        kind: "marks",
        before: range(1, 100_000),
        after: range(1, 100_000),
        removed: [link(href)],
        added: [link(`${href}b`)],
      },
    ]);
  });
});

describe("Myers edit script invariants", () => {
  it("reconstructs every pair of short binary sequences with minimal edit cost", () => {
    const sequences: string[][] = [[]];
    for (let length = 1; length <= 4; length++)
      for (let bits = 0; bits < 2 ** length; bits++)
        sequences.push(Array.from({ length }, (_, i) => String((bits >> i) & 1)));
    for (const before of sequences)
      for (const after of sequences) {
        const edits = myers(before, after, { remaining: 10_000 });
        let x = 0,
          y = 0,
          cost = 0;
        const rebuilt: string[] = [];
        for (const edit of edits) {
          if (edit === "equal") {
            expect(before[x++]).toBe(after[y]);
            rebuilt.push(after[y++] as string);
          } else if (edit === "delete") {
            x++;
            cost++;
          } else {
            rebuilt.push(after[y++] as string);
            cost++;
          }
        }
        expect(x).toBe(before.length);
        expect(y).toBe(after.length);
        expect(rebuilt).toEqual(after);
        const distances = Array.from({ length: before.length + 1 }, (_, i) =>
          Array.from({ length: after.length + 1 }, (_, j) => i + j),
        );
        for (let i = 1; i <= before.length; i++)
          for (let j = 1; j <= after.length; j++) {
            (distances[i] as number[])[j] =
              before[i - 1] === after[j - 1]
                ? (distances[i - 1]?.[j - 1] as number)
                : Math.min(distances[i - 1]?.[j] as number, distances[i]?.[j - 1] as number) + 1;
          }
        expect(cost).toBe(distances[before.length]?.[after.length]);
      }
  });
});
