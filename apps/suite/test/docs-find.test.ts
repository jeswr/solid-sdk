// AUTHORED-BY Codex GPT-6.1-Sol
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type DocumentNode,
  FIND_LIMITS,
  FindError,
  type FindErrorCode,
  type FindOptions,
  findText,
  replaceAll,
  replaceOne,
} from "../src/apps/docs/lib/find";

const node = (type: string, content?: DocumentNode[]): DocumentNode =>
  content ? { type, content } : { type };
const text = (value: string, mark?: string): DocumentNode =>
  mark ? { type: "text", text: value, marks: [{ type: mark }] } : { type: "text", text: value };
const paragraph = (...content: DocumentNode[]) => node("paragraph", content);
const doc = (...content: DocumentNode[]) => node("doc", content);
const plain = (value: string) => doc(paragraph(...(value ? [text(value)] : [])));
function error(action: () => unknown, code: FindErrorCode): void {
  expect(action).toThrow(FindError);
  try {
    action();
  } catch (cause) {
    expect(cause).toMatchObject({ name: "FindError", code });
  }
}
const regex = { regex: true, caseSensitive: true };

describe("document find", () => {
  it("finds through marks with absolute UTF-16 ranges", () => {
    const input = doc(
      paragraph(text("😀c", "bold"), text("a", "italic"), text("t cat")),
      paragraph(text("cat")),
    );
    expect(findText(input, "cat")).toEqual([
      { from: 3, to: 6, text: "cat" },
      { from: 7, to: 10, text: "cat" },
      { from: 12, to: 15, text: "cat" },
    ]);
    expect(findText(input, "😀")).toEqual([{ from: 1, to: 3, text: "😀" }]);
  });

  it("does not cross structures, atoms or hard breaks", () => {
    const input = doc(
      paragraph(text("ca"), node("hardBreak"), text("t")),
      node("horizontalRule"),
      { type: "image", attrs: { src: "https://example.org/fictional.png" } },
      node("blockquote", [paragraph(text("cat"))]),
      node("bulletList", [node("listItem", [paragraph(text("cat"))])]),
      node("table", [
        node("tableRow", [
          node("tableCell", [paragraph(text("cat"))]),
          node("tableHeader", [paragraph(text("cat"))]),
        ]),
      ]),
      paragraph(),
      node("codeBlock", [text("cat")]),
    );
    expect(findText(input, "cat").map((match) => match.from)).toEqual([10, 18, 28, 35, 45]);
    expect(findText(input, "ca\nt")).toEqual([]);
    expect(findText(doc(paragraph(text("ca")), paragraph(text("t"))), "cat")).toEqual([]);
    expect(findText(node("doc"), "cat")).toEqual([]);
    expect(findText(doc(node("paragraph")), "cat")).toEqual([]);
  });

  it("supports literal punctuation, Unicode case matching and non-overlap", () => {
    expect(findText(plain("Cat CAT cat"), "cat")).toHaveLength(3);
    expect(findText(plain("Cat CAT cat"), "cat", { caseSensitive: true })).toEqual([
      { from: 9, to: 12, text: "cat" },
    ]);
    expect(findText(plain("Éé Kk"), "é")).toHaveLength(2);
    expect(findText(plain("Éé Kk"), "k")).toHaveLength(2);
    expect(findText(plain("aaaa"), "aa").map((m) => m.from)).toEqual([1, 3]);
    expect(findText(plain("[a].*+?\\^$(){}|/-"), "[a].*+?\\^$(){}|/-")).toHaveLength(1);
    expect(findText(plain("cat"), "")).toEqual([]);
  });

  it("uses Unicode word boundaries across marks", () => {
    const input = doc(
      paragraph(text("cat", "bold"), text("s cat cat_ caté écat cat\u0301 2cat cat2 😀cat!")),
    );
    expect(findText(input, "cat", { wholeWord: true }).map((m) => m.from)).toEqual([6, 42]);
    expect(findText(plain("cat"), "cat", { wholeWord: true })).toHaveLength(1);
    expect(findText(plain("😀"), "😀", { wholeWord: true })).toHaveLength(1);
  });

  it("rejects malformed or unsupported documents with typed errors", () => {
    const cyclic: { type: string; content?: unknown[] } = { type: "doc" };
    cyclic.content = [cyclic];
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const input of [
      null,
      [],
      {},
      cyclic,
      revoked.proxy,
      doc(node("unknown")),
      plain("\ud800"),
      doc(paragraph({ ...text("cat"), marks: [{ type: "unknown" }] })),
      plain("a".repeat(1_000_001)),
    ]) {
      error(() => findText(input, "cat"), "invalid-document");
    }
    error(() => findText(null, ""), "invalid-document");
  });

  it("validates every option and query", () => {
    const invalid = [
      null,
      [],
      1,
      new Date(),
      { unknown: true },
      { regex: undefined },
      { caseSensitive: 1 },
      { wholeWord: "yes" },
      { stepBudget: 0 },
      { stepBudget: -1 },
      { stepBudget: 1.5 },
      { stepBudget: Infinity },
      { stepBudget: FIND_LIMITS.maxSteps + 1 },
      {
        get regex() {
          throw new Error("unread");
        },
      },
      Object.defineProperty({}, "regex", { value: true }),
      { [Symbol("x")]: true },
    ];
    for (const opts of invalid)
      error(() => findText(plain("a"), "a", opts as FindOptions), "invalid-options");
    expect(
      findText(
        plain("a"),
        "a",
        Object.assign(Object.create(null), {
          regex: false,
          wholeWord: false,
          caseSensitive: false,
          stepBudget: FIND_LIMITS.maxSteps,
        }),
      ),
    ).toHaveLength(1);
    for (const query of [null, 1, "\ud800", "x".repeat(FIND_LIMITS.query + 1)])
      error(() => findText(plain("cat"), query as string), "invalid-query");
  });
});

describe("budgeted regular expressions", () => {
  it.each([
    ["c.t", "cat cut c\nt", ["cat", "cut"]],
    ["^cat$", "cat", ["cat"]],
    ["^cat", "xcat cat", []],
    ["cat$", "cat cat", ["cat"]],
    ["ab*bc", "abbbc ac", ["abbbc"]],
    ["a?bc", "abc bc", ["abc", "bc"]],
    ["a+ab", "aaaab", ["aaaab"]],
    ["a{2}", "aaa", ["aa"]],
    ["a{1,2}", "aaa", ["aa", "a"]],
    ["a{2,}", "aaaa", ["aaaa"]],
    ["a{0}b", "ab", ["b"]],
    ["[a-c]+", "abc z", ["abc"]],
    ["[^a-c]+", "abc ZZ", [" ZZ"]],
    ["[\\d]+", "x12", ["12"]],
    ["\\d+\\s\\w+", "12 cat", ["12 cat"]],
    ["\\D\\S\\W", "ab!", ["ab!"]],
    ["\\.\\-\\/", ".-/", [".-/"]],
    ["[\\]\\-]+", "]-", ["]-"]],
    ["😀+", "😀😀", ["😀😀"]],
    ["a*a*b$", "aaac", []],
  ])("matches %s", (pattern, input, expected) => {
    expect(findText(plain(input), pattern, regex).map((m) => m.text)).toEqual(expected);
  });

  it("matches across marks, anchors per run and combines options", () => {
    expect(
      findText(doc(paragraph(text("C", "bold"), text("at")), paragraph(text("cat"))), "^c[a-z]+$", {
        regex: true,
        wholeWord: true,
      }),
    ).toHaveLength(2);
    expect(findText(plain("cats CAT"), "cat", { regex: true, wholeWord: true })).toEqual([
      { from: 6, to: 9, text: "CAT" },
    ]);
  });

  it("backtracks greedy expressions to a valid whole-word boundary", () => {
    expect(findText(plain("cat---cat"), "cat-*", { regex: true, wholeWord: true })).toEqual([
      { from: 1, to: 6, text: "cat--" },
      { from: 7, to: 10, text: "cat" },
    ]);
    expect(
      replaceAll(plain("cat---cat"), "cat-*", "dog", { regex: true, wholeWord: true }).document,
    ).toEqual(doc(paragraph(text("dog"), text("-"), text("dog"))));
  });

  it.each([
    "",
    "^$",
    "a*",
    "a?",
    "a{0}",
    "(cat)",
    "a|b",
    "(?=a)",
    "\\1",
    "\\p{L}",
    "\\n",
    "\\",
    "[]",
    "[^]",
    "[",
    "[a",
    "[[a]",
    "[z-a]",
    "a**",
    "a+?",
    "a{",
    "a{a}",
    "a{2,1}",
    "a{10001}",
    "a{1,10001}",
    "a^",
    "$a",
    "a]",
    "a}",
  ])("rejects unsupported or nullable %s", (pattern) => {
    error(() => findText(plain("cat"), pattern, regex), "unsupported-regex");
  });

  it("enforces a shared deterministic budget and never returns partial matches", () => {
    error(() => findText(plain("aa"), "a", { stepBudget: 1 }), "step-budget-exceeded");
    expect(findText(plain("a"), "a", { stepBudget: 4 })).toHaveLength(1);
    error(
      () => findText(doc(paragraph(text("a")), paragraph(text("a"))), "a", { stepBudget: 4 }),
      "step-budget-exceeded",
    );
    error(
      () =>
        findText(plain(`${"a".repeat(100)}c`), "a*a*a*a*a*b", { regex: true, stepBudget: 1000 }),
      "step-budget-exceeded",
    );
    error(() => replaceAll(plain("aa"), "a", "b", { stepBudget: 4 }), "step-budget-exceeded");
  });

  it("agrees with the native engine on supported non-nullable patterns", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "c"), { maxLength: 20 }),
        fc.constantFrom("a+ab", "a*b+", "[ab]{1,3}c?", "^a+b$", "a*a*b$", "a?b+c*"),
        (chars, pattern) => {
          const input = chars.join("");
          const expected = [...input.matchAll(new RegExp(pattern, "gu"))].map((m) => ({
            from: m.index + 1,
            to: m.index + m[0].length + 1,
            text: m[0],
          }));
          expect(findText(plain(input), pattern, regex)).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("replace and undo", () => {
  it("preserves the first character's complete marks and unaffected JSON", () => {
    const first: DocumentNode = {
      ...text("pre ca", "bold"),
      marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.org/fictional" } }],
    };
    const input = doc({
      ...paragraph(first, text("t", "italic"), text(" suffix", "underline")),
      attrs: { textAlign: "center" },
    });
    const saved = structuredClone(input);
    const result = replaceOne(input, "cat", "$&$1");
    expect(result.document).toEqual(
      doc({
        ...paragraph(
          { ...first, text: "pre " },
          { ...first, text: "$&$1" },
          text(" suffix", "underline"),
        ),
        attrs: { textAlign: "center" },
      }),
    );
    expect(input).toEqual(saved);
    expect(result.changeSet.matches).toEqual([{ from: 5, to: 8, text: "cat" }]);
    expect(result.changeSet.undo(result.document)).toEqual(input);
    expect(result.changeSet.apply(input)).toEqual(result.document);
  });

  it("replaces one indexed match and all original matches without cascading", () => {
    expect(replaceOne(plain("cat cat"), "cat", "dog", 1).document).toEqual(
      doc(paragraph(text("cat "), text("dog"))),
    );
    expect(replaceAll(plain("aa aa"), "aa", "aaaa").document).toEqual(
      doc(paragraph(text("aaaa"), text(" "), text("aaaa"))),
    );
    const input = doc(paragraph(text("CAT")), paragraph(text("cat")));
    const result = replaceOne(input, "c.t", "fox", 0, { regex: true, caseSensitive: true });
    expect(result.document).toEqual(doc(paragraph(text("CAT")), paragraph(text("fox"))));
    expect(result.changeSet.undo(result.document)).toEqual(input);
  });

  it("keeps unmarked insertions unmarked and deletes across multiple leaves", () => {
    const input = doc(
      paragraph(text("a"), text("b", "bold"), text("c", "italic"), text("!", "strike")),
      node("horizontalRule"),
      node("paragraph"),
    );
    expect(replaceAll(input, "abc", "x").document).toEqual(
      doc(paragraph(text("x"), text("!", "strike")), node("horizontalRule"), node("paragraph")),
    );
    const removed = replaceAll(input, "abc!", "");
    expect(removed.document).toEqual(doc(paragraph(), node("horizontalRule"), node("paragraph")));
    expect(removed.changeSet.undo(removed.document)).toEqual(input);
    expect(replaceAll(plain("😀😀"), "😀", "x").document).toEqual(
      doc(paragraph(text("x"), text("x"))),
    );
  });

  it("uses each match's first marks when multiple matches span leaves", () => {
    const input = doc(paragraph(text("a", "bold"), text("bca", "italic"), text("bc", "bold")));
    const result = replaceAll(input, "abc", "z");
    expect(result.document).toEqual(doc(paragraph(text("z", "bold"), text("z", "italic"))));
    expect(result.changeSet.undo(result.document)).toEqual(input);
  });

  it("supports no-op change sets and detached snapshots", () => {
    const input = plain("cat");
    const result = replaceAll(input, "dog", "fox");
    expect(result.document).toEqual(input);
    expect(result.changeSet.matches).toEqual([]);
    expect(result.changeSet.undo(input)).toEqual(input);
    expect(result.changeSet.apply(input)).toEqual(input);
    expect(replaceAll(node("doc"), "cat", "fox").document).toEqual(node("doc"));
    const edited = replaceAll(input, "cat", "dog");
    (edited.document.content as DocumentNode[]).push(paragraph());
    expect(edited.changeSet.apply(input)).toEqual(plain("dog"));
    const restored = edited.changeSet.undo(plain("dog"));
    (restored.content as DocumentNode[]).push(paragraph());
    expect(edited.changeSet.undo(plain("dog"))).toEqual(input);
    error(() => edited.changeSet.undo(edited.document), "stale-document");
    error(() => edited.changeSet.apply(plain("rat")), "stale-document");
    error(() => edited.changeSet.undo(null), "invalid-document");
  });

  it("rejects invalid replacement/index/output instead of partially editing", () => {
    for (const value of [null, 3, "\ud800", "x".repeat(1_000_001)])
      error(() => replaceAll(plain("cat"), "cat", value as string), "invalid-replacement");
    for (const index of [null, "all", -1, 1, 0.5, NaN])
      error(() => replaceOne(plain("cat"), "cat", "dog", index as number), "invalid-match-index");
    error(() => replaceOne(plain("cat"), "dog", "fox"), "invalid-match-index");
    error(() => replaceAll(plain("aa"), "a", "x".repeat(500_001)), "invalid-replacement");
    error(() => replaceAll(plain("cat"), "cat", "x".repeat(1_000_000)), "invalid-document");
  });

  it("round-trips synthetic documents for arbitrary mark boundaries", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "😀"), { minLength: 1, maxLength: 30 }),
        fc.constantFrom("a", "b", "😀"),
        (chars, query) => {
          const input = doc(
            paragraph(...chars.map((char, i) => text(char, i % 2 ? "bold" : "italic"))),
          );
          const result = replaceAll(input, query, "Z");
          expect(result.changeSet.undo(result.document)).toEqual(input);
          expect(findText(result.document, query)).toEqual([]);
          expect(result.changeSet.apply(input)).toEqual(result.document);
        },
      ),
      { numRuns: 100 },
    );
  });
});
